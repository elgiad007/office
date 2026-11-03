import {asError} from './utils.js';
import {isPresent} from './utils.js';
import type {ActivityEntry, ApiData, ApiResponse, ApiRoute, AppName, AppState, Cells, DeleteMail, ItemInput, ItemKind, ItemMeta, MutationResult, OfficeRecord, Status, Preferences} from './types.js';

interface WireResult {record?: OfficeRecord | null; records?: OfficeRecord[]; removedIds?: string[]; error?: string; code?: string}
interface RequestPayload {id?: string; revision?: number; action?: string; account?: string; summary?: boolean}
type MailSnapshot = Pick<OfficeRecord, 'id' | 'kind' | 'contentHash' | 'meta'>;

import {escapeHtml as e, markdown, safeDocument, csvParse, csvWrite, colName, cellPosition, cellValue, icsExport, vcardExport, vcardParse} from './formats.js';
import {openAccountSetup} from './account-setup.js';
import {renderGoogleSettings} from './google-settings.js';
import {renderMailFolders, matchesMailScope, syncOpenFolder, fileMail, quickMoveMail} from './mail-folders.js';
import {mailBody, bindMailReader} from './mail-reader.js';
import {attachmentSection, bindAttachments, waitForAttachments} from './mail-attachments.js';
import {installItemMenus} from './item-menus.js';
import {compareMail} from './mail-sort.js';
import {renderMailListCopy, bindMailListSettings} from './mail-list.js';
import {createActivity} from './activity.js';

const apps: Record<string, {name: string; singular: string; empty: string; hint: string; icon: string}> = {
  mail:{name:'Mail', singular:'message', empty:'No messages yet.',hint:'Connect an account in Settings, import an EML file, or compose your first message.',icon:'M3 5h18v14H3z M3 5l9 7 9-7'},
  calendar:{name:'Calendar',singular:'event',empty:'No events yet.',hint:'Add an event, import a calendar, or connect Google Calendar or CalDAV.',icon:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16'},
  tasks:{name:'Tasks',singular:'task',empty:'No tasks yet.',hint:'Add a task and an optional due date.',icon:'M9 5h12 M9 12h12 M9 19h12 M2 5l2 2 3-4 M2 12l2 2 3-4 M2 19l2 2 3-4'},
  contacts:{name:'Contacts',singular:'contact',empty:'No contacts yet.',hint:'Add a contact or import a vCard address book.',icon:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M20 8v6 M17 11h6'},
  documents:{name:'Documents',singular:'document',empty:'No documents yet.',hint:'Create a document or import an HTML or text file.',icon:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8'},
  wiki:{name:'Wiki',singular:'page',empty:'No pages yet.',hint:'Write Markdown pages, organize namespaces, and link pages with [[wiki links]].',icon:'M3 4h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-3H3z M13 7a3 3 0 0 1 3-3h6v15h-5a4 4 0 0 0-4 3'},
  sheets:{name:'Sheets',singular:'workbook',empty:'No workbooks yet.',hint:'Create a workbook or import a CSV file.',icon:'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18'},
};
const defaultKeys: Record<string, string> = {down:'j',up:'k',left:'h',right:'l',edit:'i',new:'c',search:'/',help:'?',select:'v',save:'s',archive:'a',reply:'r',move:'m',delete:'d'};
const state: AppState = {app:'mail',rows:[],current:null,csrf:'',accounts:[],prefs:{},search:'',mode:'normal',dirty:false,selected:new Set(),sheet:0,cell:'A1',wikiPreview:true,lastActivity:Date.now(),syncing:false,savePromise:null,mailFolder:'Inbox',mailScope:null,folderOpen:new Set()};
const root=document.querySelector<HTMLElement>('#app')!, dialog=document.querySelector<HTMLDialogElement>('#dialog')!;
const activity=createActivity({csrf:()=>state.csrf});
let saveTimer: ReturnType<typeof setTimeout>, keySequence='', sequenceTime=0;
let selectionAnchor: string | null=null,keyboardSelection=false;
let sendingMail=false;
const pendingMailDeletes=new Set<string>();
const failedMailActions=new Map<string,string>();
let mailDeleteVersion=0;
const pendingMailReads=new Map<string, Promise<(MutationResult & {previousRevision: number}) | void>>();
const mailAccountQueue=new Map<string, Promise<WireResult>>(),mailSnapshots=new Map<string, Map<number, MailSnapshot>>(),mailLatest=new Map<string, OfficeRecord>(),trashedMailCopies=new Map<string, OfficeRecord>();
let mailReadVersion=0, displayedMailId: string | null=null;
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${apps[name]?.icon || 'M12 3v18 M3 12h18'}"/></svg>`;
const keys = () => Object.fromEntries(Object.keys(defaultKeys).map(action=>[action,state.prefs.keys?.[action]||defaultKeys[action]]));
const editable = (node: EventTarget | null): node is HTMLElement => (node as HTMLElement)?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test((node as HTMLElement)?.tagName);
const dateLabel = (value: string) => { const date=new Date(value); return Number.isNaN(+date)?value:date.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
const field = (label: string,name: string,value='',type='text',extra='') => `<label>${e(label)}<input type="${type}" name="${name}" value="${e(value)}" ${extra}></label>`;
const busyButton = (button: HTMLButtonElement | null,busy: boolean) => { if (button) button.disabled=busy; };
function notice(text: string,error=false) { activity.notice(text,error); }
function rememberMail(record?: OfficeRecord | null) {
  if(record?.kind!=='mail')return;
  let revisions=mailSnapshots.get(record.id);
  if(!revisions){revisions=new Map();mailSnapshots.set(record.id,revisions);}
  const fields: (keyof ItemMeta)[]=['remote','account','source','serverFolder','uidValidity','providerId','folder','headerOnly'];
  revisions.set(record.revision,{id:record.id,kind:record.kind,contentHash:record.contentHash??record.meta.rawBase64,meta:Object.fromEntries(fields.map(key=>[key,record.meta[key]]))});
  if(!mailLatest.has(record.id)||mailLatest.get(record.id)!.revision<=record.revision)mailLatest.set(record.id,structuredClone(record));
  if(revisions.size>16)revisions.delete(revisions.keys().next().value!);
}
function latestMail(id?: string) {
  return id ? mailLatest.get(id) : undefined;
}
function sameMailIdentity(a?: MailSnapshot,b?: MailSnapshot | null) {
  if(!a||!b||a.id!==b.id||a.kind!=='mail'||b.kind!=='mail')return false;
  const x=a.meta,y=b.meta;
  return !!x.remote && !!y.remote && x.account===y.account && !!x.source && x.source===y.source
    && x.serverFolder===y.serverFolder && x.uidValidity===y.uidValidity && x.providerId===y.providerId
    && x.folder===y.folder;
}
function sameMailTarget(a?: MailSnapshot,b?: MailSnapshot | null) {
  return sameMailIdentity(a,b) && (a!.contentHash??a!.meta.rawBase64)===(b!.contentHash??b!.meta.rawBase64);
}
function sameMailActionTarget(a?: MailSnapshot,b?: MailSnapshot | null) {
  if(!sameMailIdentity(a,b))return false;
  const m=a!.meta;
  // IMAP UIDs identify immutable messages within a mailbox/UIDVALIDITY.
  // Gmail message IDs are immutable across content downloads as well.
  const complete=!!m.account && !!m.folder && !!m.providerId && (
    (!!m.serverFolder && /^[1-9][0-9]*$/.test(m.uidValidity||'') && /^[1-9][0-9]*$/.test(m.providerId)
      && m.source===`imap-folder:${encodeURIComponent(m.serverFolder).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}:${m.uidValidity}:${m.providerId}`)
    || m.source===`gmail:${m.providerId}`);
  return complete;
}
function logMailConflict(expected: MailSnapshot | undefined,current: OfficeRecord | undefined,payload: RequestPayload | undefined,retry: boolean) {
  const fields=['account','source','serverFolder','uidValidity','providerId','folder','remote','headerOnly'] as const;
  const changed: string[]=expected&&current?fields.filter(key=>expected.meta[key]!==current.meta[key]):['snapshot unavailable'];
  if(expected&&current&&expected.contentHash!==current.contentHash)changed.push('contentHash');
  activity.diagnostic(`Mail conflict: action=${payload?.action}; record=${payload?.id}; requested revision=${payload?.revision}; current revision=${current?.revision}; changed fields=${changed.join(', ')||'none'}; ${retry?'retrying once with verified server identity':'stopped; no automatic retry'}.`);
}
function refreshMailRecord(record: OfficeRecord) {
  rememberMail(record);
  if(state.app!=='mail'||pendingMailDeletes.has(record.id))return;
  state.rows=state.rows.map(row=>row.id===record.id?structuredClone(record):row);
  if(state.current?.id===record.id)state.current=state.rows.find(row=>row.id===record.id)||null;
}
async function requestApi(route: ApiRoute, data?: ApiData): Promise<WireResult> {
  let payload = data as RequestPayload | undefined;
  if(route==='mail-action')payload={...payload,summary:true};
  const response=await fetch('api.php?r='+route,{method:payload===undefined?'GET':'POST',headers:payload===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf,'X-Office-Progress':'1'},body:payload===undefined?undefined:JSON.stringify(payload),cache:'no-store'});
  let result!: WireResult,status=response.status;
  if(response.headers.get('Content-Type')?.includes('application/x-ndjson')){
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
    const consume=(line: string)=>{if(!line.trim())return;const event=JSON.parse(line) as {type: 'activity'; entry: ActivityEntry} | {type: 'result'; body: WireResult; status: number};if(event.type==='activity')activity.receive(event.entry);if(event.type==='result'){result=event.body;status=event.status;finished=true;}};
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let newline;while((newline=buffer.indexOf('\n'))!==-1){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}if(done){if(buffer.trim())consume(buffer);break;}}
    if(!finished)throw Error('The connection ended before the operation was confirmed. Check recent activity and sync before retrying.');
  }else try { result=await response.json() as WireResult; } catch { throw Error('The server did not return JSON. Check PHP configuration and upload limits.'); }
  if (status>=400) {
    if(status===409&&result.code==='mail_revision_conflict'&&result.record)refreshMailRecord(result.record);
    if (status===401 && route!=='login') { state.dirty=false; await boot(); }
    throw Object.assign(Error(result.error || 'Request failed.'),{status,code:result.code,record:result.record});
  }
  for(const record of result.records||[])rememberMail(record);
  rememberMail(result.record);
  if(route==='mail-action'&&payload?.action==='trash'&&result.record?.meta?.folder==='Trash'){
    for(const id of result.removedIds||[])trashedMailCopies.set(id,result.record);
  }
  return result;
}
function api(route: 'google-settings', data: ApiData): Promise<{ok: boolean}>;
function api<R extends ApiRoute>(route: R, data?: ApiData): Promise<ApiResponse<R>>;
async function api<R extends ApiRoute>(route: R, data?: ApiData): Promise<ApiResponse<R>> {
  let payload = data as RequestPayload | undefined;
  const expected=mailSnapshots.get(payload?.id!)?.get(payload?.revision!);
  // Let an in-flight read update finish before another mutation uses its revision.
  if(payload?.id && ['save','delete','mail-action','mail-files'].includes(route) && pendingMailReads.has(payload.id)) {
    const result=await pendingMailReads.get(payload.id);
    if(result && payload.revision===result.previousRevision)payload={...payload,revision:result.record.revision};
  }
  const account=['mail-action','mail-files'].includes(route)?expected?.meta.account||latestMail(payload?.id)?.meta.account
    :route==='sync'?payload?.id:['mail-content','mail-folder-sync','mail-folders','mail-folder-manage'].includes(route)?payload?.account:null;
  const names: Partial<Record<ApiRoute, string>>={'mail-action':({trash:'Moving mail to Trash',archive:'Archiving mail',restore:'Restoring mail to Inbox',read:'Marking mail read',unread:'Marking mail unread',move:'Moving mail',discard:'Discarding cached copy','keep-local':'Saving local copy'})[payload?.action||'']||'Updating mail',sync:'Synchronizing mail','mail-folders':'Discovering folders','mail-folder-sync':'Refreshing folder','mail-folder-manage':'Updating folders','account-test':'Testing connection',save:'Saving item',delete:'Deleting item',send:'Sending mail',backup:'Preparing backup',restore:'Restoring backup',import:'Importing items','import-items':'Importing items'};
  const label=state.accounts.find(row=>row.id===account)?.label;
  const tracking=activity.queued(names[route]?(label?label+': ':'')+names[route]+'…':null);
  const run=async()=>{
    const moved=trashedMailCopies.get(payload?.id!);
    if(route==='mail-action'&&payload?.action==='trash'&&moved&&latestMail(moved.id)?.meta.folder==='Trash')return {record:moved,removedIds:[payload!.id!]};
    const latest=latestMail(payload?.id);
    if(route==='mail-action'&&sameMailActionTarget(expected,latest))payload={...payload,revision:latest!.revision};
    for(let attempt=0;;attempt++){
      try{return await requestApi(route,payload);}
      catch(cause) { const error=asError(cause);
        // Only explicit pre-write revision rejections can be retried. A network
        // failure or an unconfirmed provider write must never repeat a move.
        if(route!=='mail-action'||error.status!==409||error.code!=='mail_revision_conflict')throw error;
        const retry=attempt===0&&sameMailActionTarget(expected,error.record);
        logMailConflict(expected,error.record,payload,retry);
        if(!retry)throw error;
        payload={...payload,revision:error.record!.revision};
      }
    }
  };
  const trackedRun=async()=>{activity.running(tracking);try{return await run();}finally{activity.done(tracking);}};
  if(!account)return await trackedRun() as ApiResponse<R>;
  const queueAccount=['sync','mail-folder-sync'].includes(route)?'sync:'+account:account;
  const previous=mailAccountQueue.get(queueAccount)||Promise.resolve();
  const pending=previous.catch(()=>{}).then(trackedRun);
  mailAccountQueue.set(queueAccount,pending);
  try{return await pending as ApiResponse<R>;}
  finally{if(mailAccountQueue.get(queueAccount)===pending)mailAccountQueue.delete(queueAccount);}
}
function applyTheme() {
  let theme=state.prefs.theme||'system'; if (theme==='system') theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  document.documentElement.dataset.theme=theme; document.documentElement.classList.toggle('compact',state.prefs.density==='compact');
  // Fixed palettes avoid injecting arbitrary CSS through imported preferences.
  document.documentElement.dataset.accent=['green','blue','plum'].includes(state.prefs.accent||'')?state.prefs.accent:'green';
  document.querySelectorAll<HTMLIFrameElement>('iframe.mail-html').forEach(frame=>{
    const url=new URL(frame.src);
    url.searchParams.set('theme',theme); url.searchParams.set('accent',document.documentElement.dataset.accent!);
    if(url.href!==frame.src) frame.src=url.href;
  });
}
function authView(status: Status) {
  mailSnapshots.clear();mailLatest.clear();trashedMailCopies.clear();failedMailActions.clear();
  const setup=status.setup;
  root.innerHTML=`<main class="auth"><div class="brand"><div class="brandmark">o.</div><div><strong>Office</strong></div></div><h1>${setup?'Set up Office':'Sign in'}</h1><p>${setup?'Create your owner password to get started. Retrieve the setup token from <code>data/setup-token.txt</code> using your local file manager or cPanel File Manager.':'Enter your password.'}</p><form id="auth-form">${setup?field('Setup token','token','','text','required autocomplete="off"'):''}${field(setup?'Create password (at least 12 characters)':'Password','password','','password',`required ${setup?'minlength="12" autocomplete="new-password"':'autocomplete="current-password"'}`)}<button class="primary">${setup?'Create workspace':'Open workspace'}</button><p id="auth-error" class="error" role="alert"></p></form><p class="foot">PHP / SQLite · no scheduled jobs required</p></main>`;
  document.querySelector<HTMLFormElement>('#auth-form')!.onsubmit=async event=>{event.preventDefault(); const button=(event.target as HTMLElement).querySelector<HTMLButtonElement>('button')!; busyButton(button,true); try { const r=await api(setup?'setup':'login',Object.fromEntries(new FormData(event.target as HTMLFormElement))); state.csrf=r.csrf; await boot(); } catch(cause) { const error=asError(cause); document.querySelector<HTMLElement>('#auth-error')!.textContent=error.message; } finally { busyButton(button,false); } };
}
async function boot() {
  try { const status=await api('status'); state.csrf=status.csrf;activity.configure(!!status.authenticated&&!!status.activity); if (!status.authenticated) { authView(status); return; }
    state.prefs=status.preferences||{}; applyTheme(); state.accounts=(await api('accounts')).accounts;
    const hash=location.hash.slice(1); state.app=apps[hash]||hash==='settings'?hash as AppName:'mail'; shell(); await load();
    if (state.accounts.length) void syncAccounts(false);
  } catch(cause) { const error=asError(cause); root.innerHTML=`<main class="auth"><h1>Workspace unavailable</h1><p class="error">${e(error.message)}</p><p>Requires PHP 8.2+, PDO SQLite and a writable private data directory. Point the domain at <code>public/</code>.</p><button id="retry">Try again</button></main>`; document.querySelector<HTMLElement>('#retry')!.onclick=boot; }
}
function shell() {
  root.innerHTML=`<div class="shell"><aside class="sidebar" aria-label="Application navigation"><div class="brand"><div class="brandmark">o.</div><div><strong>Office</strong></div></div><p class="eyebrow nav-label">Applications</p><nav class="nav application-nav">${Object.entries(apps).map(([id,a],i)=>`<button data-app="${id}" title="${a.name} · g ${i+1}" aria-label="${a.name}">${icon(id)}<span>${a.name}</span><kbd>${i+1}</kbd></button>${id==='mail'?'<button id="mail-folders-toggle" class="mail-folders-toggle" data-action="toggle-mail-folders" aria-label="Show mail folders" aria-controls="mail-folder-navigation" aria-expanded="false">▤</button><section id="mail-folder-navigation" aria-label="Mail folders"></section>':''}`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button data-app="settings" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 4v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/></svg><span>Settings</span></button><button data-action="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${icon('wiki')}<span>Keyboard shortcuts</span><kbd>?</kbd></button></nav><div class="privacy-note"><span class="privacy-dot"></span> Stored in your application folder.</div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><span>Office</span><span>/</span><strong id="crumb"></strong></div><div class="top-actions"><span class="sync-label" id="sync-status">Automatic sync</span><button class="quiet" data-action="sync" id="sync-button" title="Refresh connected accounts">↻ <span>Sync now</span></button><span class="mode" id="mode">NORMAL</span><button class="avatar" data-action="logout" title="Sign out" aria-label="Sign out">ME</button></div></header><main id="main" tabindex="-1"></main></div></div>`;
  root.onclick=handleClick;
}
function setMailFolderPanel(open: boolean) {
  document.querySelector<HTMLElement>('.shell')!?.classList.toggle('folders-open',open);
  document.querySelector<HTMLElement>('#mail-folders-toggle')!?.setAttribute('aria-expanded',String(open));
}
function mailFolderEnv() { return {state,api,commit,load,notice,modal,dialog,e,field,confirmation,attempt,mailDeletionReload,closeFolderPanel:()=>setMailFolderPanel(false)}; }
function mailLocation(record: OfficeRecord) {
  const m=record.meta, account=state.accounts.find(a=>a.id===m.account);
  if(!m.remote || ['Recovery copies','Not in Inbox'].includes(m.folder||''))return m.folder||'';
  if(account?.type==='google')return [m.folder,...(account.folders||[]).filter(f=>!f.protected&&(m.labelIds||[]).includes(f.id)).map(f=>f.name)].filter(isPresent).join(' · ');
  return m.folder==='Custom folder'?(account?.folders?.find(f=>f.id===m.serverFolder)?.name||m.serverFolder||m.folder):m.folder;
}
function searchableText(record: OfficeRecord) {
  const {rawBase64,raw,headersBase64,...meta}=record.meta;
  return (record.title+' '+record.body+' '+JSON.stringify(meta)).toLocaleLowerCase();
}
function filteredRows() { const q=state.search.toLocaleLowerCase(); return state.rows.filter(r=>(state.app!=='mail'||(state.mailScope?matchesMailScope(r,state.mailScope,state.accounts):state.mailFolder==='all'?!['Recovery copies','Not in Inbox','Trash'].includes(r.meta.folder||''):state.mailFolder==='Recovery copies'?['Recovery copies','Not in Inbox'].includes(r.meta.folder||''):(r.meta.folder||'Archive')===state.mailFolder))&&(!q||searchableText(r).includes(q))); }
async function deleteMailImmediately(rows: OfficeRecord[],operation: Parameters<DeleteMail>[1]) {
  const ids=new Set(rows.map(r=>r.id)),visible=filteredRows().map(r=>r.id),currentId=state.current?.id!;
  const context=JSON.stringify([state.mailFolder,state.mailScope,state.search]);
  for(const id of ids){pendingMailDeletes.add(id);failedMailActions.delete(id);}
  mailDeleteVersion++;
  state.rows=state.rows.filter(r=>!ids.has(r.id));state.selected.clear();itemMenus.close();
  const advance=ids.has(currentId),index=visible.indexOf(currentId);
  if(advance){
    const next=[...visible.slice(index+1),...visible.slice(0,index).reverse()].find(id=>!ids.has(id));
    state.current=state.rows.find(r=>r.id===next)||null;
  }
  renderList();if(advance)renderDetail();
  (document.querySelector<HTMLElement>('#selected-item')!||document.querySelector<HTMLElement>('#main')!)?.focus({preventScroll:true});
  document.querySelector<HTMLElement>('#selected-item')!?.scrollIntoView({block:'nearest'});
  let count=0;
  const reconciled=new Set<string>();
  const refresh=()=>{
    if(state.app!=='mail')return;
    const focused=(document.activeElement as HTMLElement)?.closest<HTMLElement>('#items [data-id]')?.dataset.id!;
    renderList();
    if(focused)document.querySelector<HTMLElement>(`#items [data-id="${CSS.escape(focused)}"]`)!?.focus({preventScroll:true});
  };
  try{
    for(const row of rows){
      if(reconciled.has(row.id)){count++;pendingMailDeletes.delete(row.id);continue;}
      const result=await operation(row);count++;pendingMailDeletes.delete(row.id);mailDeleteVersion++;
      for(const id of result?.removedIds||[])reconciled.add(id);
      if(state.app==='mail' && result?.removedIds?.length){
        state.rows=state.rows.filter(r=>!reconciled.has(r.id));
        for(const id of reconciled)state.selected.delete(id);
        if(reconciled.has(state.current?.id!)){
          state.current=filteredRows()[0]||null;renderList();renderDetail();
          (document.querySelector<HTMLElement>('#selected-item')!||document.querySelector<HTMLElement>('#main')!)?.focus({preventScroll:true});
        }
      }
      // Keep confirmed moves available when switching folders.
      if(state.app==='mail'&&row.meta.remote&&result?.record){state.rows=state.rows.filter(r=>r.id!==row.id&&r.id!==result.record!.id);state.rows.push(result.record);state.rows.sort(compareMail);}
    }
  }catch(cause) { const error=asError(cause);
    const remaining=rows.slice(count);
    for(const row of remaining){pendingMailDeletes.delete(row.id);failedMailActions.set(row.id,error.message);}
    mailDeleteVersion++;
    if(state.app==='mail'){
      for(const row of remaining)if(!state.rows.some(r=>r.id===row.id))state.rows.push(structuredClone(latestMail(row.id)||row));
      state.rows.sort(compareMail);
      if(!state.current&&context===JSON.stringify([state.mailFolder,state.mailScope,state.search])){
        state.current=filteredRows()[0]||null;renderDetail();
      }
    }
    throw Error((rows.length>1?`${count} of ${rows.length} items updated. `:'')+`Mail action failed; ${remaining.length===1?'message restored':'remaining messages restored'}. ${error.message}`);
  }finally{refresh();}
}
function mailDeletionReload() {
  const currentId=state.current?.id!, ids=filteredRows().map(r=>r.id);
  const context=()=>JSON.stringify([state.app,state.mailFolder,state.mailScope,state.search]);
  const originalContext=context(),mail=state.app==='mail';
  return async (removedIds: string[])=>{
    const advance=mail&&ids.includes(currentId)&&removedIds.includes(currentId)&&state.current?.id===currentId&&context()===originalContext;
    await load(undefined,{selectFirst:false});
    if(!advance||context()!==originalContext||(state.current&&state.current!.id!==currentId))return;
    const visible=new Set(filteredRows().map(r=>r.id)),removed=new Set(removedIds),index=ids.indexOf(currentId);
    const nextId=[...ids.slice(index+1),...ids.slice(0,index).reverse()].find(id=>!removed.has(id)&&visible.has(id));
    state.current=state.rows.find(r=>r.id===nextId)||null;
    renderList();renderDetail();
    const target=document.querySelector<HTMLElement>('#selected-item')!||document.querySelector<HTMLElement>('#main')!;
    target?.focus({preventScroll:true});
    document.querySelector<HTMLElement>('#selected-item')!?.scrollIntoView({block:'nearest'});
  };
}
async function load(preferId?: string,{selectFirst=true,preserveSelection=false}={}) {
  await waitForAttachments();
  if(state.app!=='mail')displayedMailId=null;
  itemMenus.close();
  if(!preserveSelection){selectionAnchor=null;keyboardSelection=false;state.selected.clear();}
  const selectionContext=JSON.stringify([state.app,state.mailFolder,state.mailScope,state.search]);
  document.querySelectorAll<HTMLElement>('[data-app]').forEach(b=>{ const active=b.dataset.app===state.app; b.classList.toggle('active',active); if (active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  document.querySelector<HTMLElement>('#crumb')!.textContent=apps[state.app]?.name||'Settings';
  document.querySelector<HTMLElement>('.shell')!.classList.toggle('mail-active',state.app==='mail');
  document.querySelector<HTMLElement>('#mail-folder-navigation')!.hidden=state.app!=='mail';
  document.querySelector<HTMLElement>('#mail-folders-toggle')!.hidden=state.app!=='mail';
  if(state.app!=='mail')setMailFolderPanel(false);
  if (state.app==='settings') { state.current=null; renderSettings(); return; }
  // Retry snapshots taken across a deletion, rollback or read update.
  const app=state.app;let records,version;
  do{version=mailDeleteVersion+mailReadVersion;records=(await api(`records&kind=${app}${app==='mail'?'&summaries=1':''}`)).records;if(state.app!==app)return;}while(app==='mail'&&version!==mailDeleteVersion+mailReadVersion);
  if(preserveSelection&&selectionContext!==JSON.stringify([state.app,state.mailFolder,state.mailScope,state.search]))return;
  const focusedId=preserveSelection?(document.activeElement as HTMLElement)?.closest<HTMLElement>('#items [data-id]')?.dataset.id:undefined;
  state.rows=records.filter(r=>!pendingMailDeletes.has(r.id));
  if (state.app==='mail') state.rows.sort(compareMail);
  if (state.app==='calendar') state.rows.sort((a,b)=>(a.meta.start||'').localeCompare(b.meta.start||''));
  state.current=state.rows.find(r=>r.id===(preferId||state.current?.id))||null;
  if(state.app==='mail'){
    const editingDraft=state.current&&!state.current!.meta.remote&&state.current!.meta.folder==='Drafts';
    if(state.mailScope&&state.current&&!editingDraft&&!matchesMailScope(state.current,state.mailScope,state.accounts))state.current=null;
    if(!state.current&&selectFirst)state.current=filteredRows()[0]||null;
  }
  if(preserveSelection){
    const visible=new Set(filteredRows().map(r=>r.id));
    for(const id of state.selected)if(!visible.has(id))state.selected.delete(id);
    if(selectionAnchor&&!visible.has(selectionAnchor))selectionAnchor=null;
  }
  renderWorkspace();
  if(focusedId)document.querySelector<HTMLElement>(`#items [data-id="${CSS.escape(focusedId)}"]`)?.focus({preventScroll:true});
}
function renderWorkspace() {
  const a=apps[state.app];
  document.querySelector<HTMLElement>('#main')!.innerHTML=`<section class="view-head"><div><h1>${a.name}</h1></div><div class="head-actions"><button class="quiet" data-action="import">↑ Import</button><button class="quiet" data-action="export-all">↓ Export</button><button class="primary" data-action="new">+ ${state.app==='mail'?'Compose':'New '+a.singular}</button></div></section><div class="work-grid"><section class="list-pane" aria-label="${a.name} list"><div class="search-wrap"><label><span class="file-input">Search ${a.name}</span><input id="search" type="search" value="${e(state.search)}" placeholder="Search ${a.name.toLowerCase()}…   /" autocomplete="off"></label></div><div class="list-summary"><span id="list-count"></span><span id="selection-count"></span></div><div class="items" id="items" role="region" aria-label="Items"></div><div class="bottom-hint"><span><kbd>j</kbd> <kbd>k</kbd> navigate</span><span><kbd>i</kbd> edit</span><span><kbd>?</kbd> help</span></div></section><section class="detail" id="detail" aria-label="Selected ${a.singular}"></section></div>`;
  document.querySelector<HTMLInputElement>('#search')!.oninput=event=>{state.search=(event.target as HTMLInputElement).value; renderList();};
  if(state.app==='mail'){
    const folderNavigation=document.querySelector<HTMLElement>('#mail-folder-navigation')!;
    folderNavigation.innerHTML='<div class="mail-folder-panel-head"><strong>Mail folders</strong><button data-action="close-mail-folders" aria-label="Close mail folders">✕</button></div>';
    folderNavigation.insertAdjacentHTML('beforeend',`<select id="mail-folder" aria-label="Mail folder"><option value="all">All cached mail</option>${['Inbox','Drafts','Sent','Archive','Trash','Local mail','Recovery copies','Sending','Delivery uncertain'].map(folder=>`<option ${state.mailFolder===folder?'selected':''}>${folder}</option>`).join('')}</select>`);
    document.querySelector<HTMLSelectElement>('#mail-folder')!.onchange=event=>void attempt(async()=>{
      const select=(event.target as HTMLSelectElement), folder=select.value; select.disabled=true;
      try {
        await commit();
        state.mailFolder=folder; state.mailScope=null; state.current=filteredRows()[0]||null; state.selected.clear(); selectionAnchor=null;keyboardSelection=false;setMode('normal');
        renderWorkspace();
        if(matchMedia('(max-width: 800px)').matches)setMailFolderPanel(false);
      } finally { select.value=state.mailFolder; select.disabled=false; }
    });
    if(state.mailScope){const select=document.querySelector<HTMLSelectElement>('#mail-folder')!;select.insertAdjacentHTML('afterbegin','<option value="account-folder">Selected account folder</option>');select.value='account-folder';}
    renderMailFolders(mailFolderEnv());
  }
  renderList(); renderDetail();
}
let mailListLimit=100;
function renderList() {
  const rows=filteredRows(),count=document.querySelector<HTMLElement>('#list-count')!;
  count.textContent=state.app==='mail'?`${rows.length} cached ${rows.length===1?'message':'messages'}`:`${rows.length} ${rows.length===1?apps[state.app].singular:'items'}`;
  count.title=state.app==='mail'?'Messages stored in Office for this view. This count can grow as older mail downloads.':'';
  document.querySelector<HTMLElement>('#selection-count')!.textContent=state.selected.size?`${state.selected.size} selected`:'';
  if(state.app==='mail')mailListLimit=Math.max(mailListLimit,rows.findIndex(r=>r.id===state.current?.id)+1);
  const visible=state.app==='mail'?rows.slice(0,mailListLimit):rows;
  document.querySelector<HTMLElement>('#items')!.innerHTML=rows.length?visible.map(r=>{
    const hint=state.app==='mail'?(r.meta.from||r.meta.to||r.meta.folder||'Local archive'):state.app==='calendar'?(r.meta.start?dateLabel(r.meta.start)+' · ':'')+(r.meta.location||''):state.app==='tasks'?(r.meta.done?'Completed':r.meta.due?'Due '+dateLabel(r.meta.due):'No due date'):state.app==='contacts'?(r.meta.email||r.meta.company||''):state.app==='wiki'?(r.title.includes(':')?r.title.split(':').slice(0,-1).join(':'):'Root namespace'):'Edited '+dateLabel(r.updated);
    const selected=state.current?.id===r.id;
    const readState=state.app==='mail'?(r.meta.read?'read':'unread'):'';
    const readStatus=readState?`<span class="mail-read-status"><span class="file-input">${readState==='unread'?'Unread':'Read'}</span></span>`:'';
    const badges=state.app==='mail'?'':`<span>${r.meta.folder?`<span class="badge">${e(r.meta.folder)}</span>`:''}${r.meta.remote?'<span class="badge">Synced</span>':''}</span>`;
    return `<button class="item ${readState?'mail-'+readState:''} ${selected?'selected':''} ${state.selected.has(r.id)?'multi-selected':''}" data-id="${r.id}" aria-pressed="${state.selected.has(r.id)||selected}" aria-haspopup="menu" ${selected?'id="selected-item"':''}>${readStatus}<span class="item-icon">${state.selected.has(r.id)?'✓':icon(state.app)}</span>${state.app==='mail'?renderMailListCopy(r,state.prefs.mailList,failedMailActions.get(r.id)):`<span class="item-copy"><strong>${e(r.title)}</strong><small>${e(hint)}</small></span>`}${badges}</button>`;
  }).join(''):`<div class="list-empty">${state.search?'No matching items. Try a different search.':'No items yet.'}</div>`;
  if(visible.length<rows.length){const button=document.createElement('button');button.textContent='Show next 100 messages';button.onclick=()=>{mailListLimit+=100;renderList();};document.querySelector('#items')!.append(button);}
}
const bodyDownloads=new Set<string>(),bodyFailures=new Set<string>();
async function hydrateMailBody(record: OfficeRecord,manual=false) {
  if(bodyDownloads.has(record.id)||(!manual&&bodyFailures.has(record.id)))return;
  bodyDownloads.add(record.id);
  const button=document.querySelector<HTMLButtonElement>('[data-download-body]');if(button)button.disabled=true;
  const status=document.querySelector<HTMLElement>('[data-body-status]');if(status)status.textContent=' Downloading…';
  try {
    await pendingMailReads.get(record.id);
    const result=await api('mail-content',{id:record.id,account:record.meta.account});
    refreshMailRecord(result.record);bodyFailures.delete(record.id);
    if(state.app==='mail'){updateMailListItem(record.id);if(state.current?.id===record.id)renderDetail();}
  }catch(cause){bodyFailures.add(record.id);if(state.app==='mail'&&state.current?.id===record.id){if(status)status.textContent=' '+asError(cause).message;if(button)button.disabled=false;}}
  finally{bodyDownloads.delete(record.id);}
}
function renderDetail() {
  const panel=document.querySelector<HTMLElement>('#detail')!, r=state.current, a=apps[state.app];
  const openedMail=state.app==='mail'&&r?r.id:null, newlyOpened=openedMail!==displayedMailId;
  displayedMailId=openedMail;
  if (!r) {
    const emptyMail=state.app==='mail'&&!filteredRows().length;
    const heading=emptyMail?(state.search?'No matching messages.':'No messages in this folder.'):(state.rows.length?'Select a '+a.singular:a.empty);
    panel.innerHTML=`<div class="empty"><span class="empty-symbol">${state.app==='mail'?'↗':state.app==='wiki'?'Aa':state.app==='sheets'?'∑':'○'}</span><h2>${heading}</h2><p>${emptyMail?(state.search?'Try a different search or choose another folder.':'Choose another folder or write a new message.'):a.hint}</p><button data-action="new">${state.app==='mail'?'Write a message':'Create '+a.singular} <span aria-hidden="true">↗</span></button></div>`; return;
  }
  const fillSender=state.app==='mail' && !r.meta.remote && r.meta.folder==='Drafts' && !r.meta.sendAccount ? draftAccount(r) : '';
  if (fillSender) r.meta.sendAccount=fillSender;
  const remote=!!r.meta.remote;
  const mailBadges=state.app==='mail'?`${r.meta.folder?`<span class="badge">${e(mailLocation(r))}</span>`:''}${remote?'<span class="badge">Cached</span>':''}`:'';
  panel.innerHTML=`<div class="detail-toolbar"><div class="left ${state.app==='mail'?'mail-detail-heading':''}"><span class="eyebrow">${remote?(state.app==='mail'?'Cached message':'Synced · read only'):a.singular}</span>${mailBadges}</div><div class="right"><span class="save-status" id="save-status">${remote?'Cached copy':'Saved'}</span>${['wiki','documents'].includes(state.app)?'<button class="quiet" data-action="history">History</button>':''}${state.app==='wiki'?`<button data-action="wiki-mode">${state.wikiPreview?'Edit':'Preview'}</button>`:''}<button class="quiet" data-action="export">Export</button>${!remote?'<button class="quiet danger" data-action="delete" title="Delete selected item">Delete</button>':''}</div></div><div class="print-only"><h1>${e(r.title)}</h1></div>${detailContent(r)}`;
  const failure=state.app==='mail'?failedMailActions.get(r.id):undefined;
  if(failure)panel.insertAdjacentHTML('afterbegin',`<p class="mail-action-failure" role="status">Mail action failed; message restored. ${e(failure)}</p>`);
  const form=panel.querySelector<HTMLFormElement>('#record-form')!;
  if (state.app==='mail' && r.meta.folder!=='Drafts') bindMailReader(panel,r,renderDetail);
  if(state.app==='mail')bindAttachments(panel,r,{api,commit,notice,modal,update:record=>{
    if(state.current?.id===record.id){state.current.revision=record.revision;state.current.meta.attachments=record.meta.attachments;state.current.meta.hasAttachments=record.meta.hasAttachments;}
    const row=state.rows.find(row=>row.id===record.id);if(row){row.revision=record.revision;row.meta.attachments=record.meta.attachments;row.meta.hasAttachments=record.meta.hasAttachments;}
  }});
  if(newlyOpened && openedMail)markOpenedMailRead(r);
  const bodyButton=panel.querySelector<HTMLButtonElement>('[data-download-body]');
  if(bodyButton){bodyButton.onclick=()=>void hydrateMailBody(r,true);if(Number(r.meta.messageSize||0)<=1400000&&!['Recovery copies','Not in Inbox'].includes(r.meta.folder||''))void hydrateMailBody(r);}
  if (form) { form.oninput=()=>markDirty(); form.onsubmit=async ev=>{ev.preventDefault(); await attempt(()=>commit());}; }
  if (fillSender) markDirty();
  panel.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button=>{
    button.onmousedown=event=>event.preventDefault();
    button.onclick=()=>{ const rich=panel.querySelector<HTMLElement>('#rich-editor')!; rich.focus(); const command=button.dataset.format!; if (command==='table') document.execCommand('insertHTML',false,'<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>'); else document.execCommand(command!,false,button.dataset.value||undefined); markDirty(); };
  });
  const rich=panel.querySelector<HTMLElement>('#rich-editor')!;
  if (rich) { rich.onpaste=event=>{ event.preventDefault(); const html=event.clipboardData!.getData('text/html'); if (html) document.execCommand('insertHTML',false,safeDocument(html)); else document.execCommand('insertText',false,event.clipboardData!.getData('text/plain')); markDirty(); }; rich.ondrop=event=>event.preventDefault(); }
  const formula=panel.querySelector<HTMLInputElement>('#formula')!; if (formula) formula.oninput=()=>{const workbook=state.current!.meta.workbook!; workbook.sheets[state.sheet].cells[state.cell]=formula.value; markDirty(); updateCells();};
}
function detailContent(r: OfficeRecord) {
  const m=r.meta, disabled=m.remote?'disabled':'';
  if (state.app==='mail' && m.folder!=='Drafts') {
    const recovery=!!m.remote && ['Recovery copies','Not in Inbox'].includes(m.folder||'');
    const actions=recovery?'<button data-action="keep-local">Save locally</button><button class="danger quiet" data-action="discard-copy">Discard copy</button>':`${m.remote?'<button data-action="file-mail">Move / Labels</button>':''}${m.folder!=='Archive'?`<button data-action="archive">${m.remote?'Archive':'Archive locally'}</button>`:''}${m.remote?m.folder==='Trash'?'<button data-action="restore-mail">Restore to Inbox</button>':'<button data-action="trash-mail">Move to Trash</button>':''}<button data-action="read">Mark ${m.read?'unread':'read'}</button>`;
    return `<h1>${e(r.title)}</h1><div class="meta-strip"><span>From: ${e(m.from||'Unknown')}</span><span>To: ${e(m.to||'')}</span><span>${e(m.date||'')}</span></div>${m.remote?`<p class="recurrence-note">${recovery?'This copy is absent from its synchronized folders. It may have moved elsewhere or been deleted. Save locally keeps an independent copy; Discard copy removes only this cached copy.':'Downloaded copy from '+e(mailLocation(r))+'. Mail actions update the provider; Sync now refreshes its location.'}</p>`:''}<div class="head-actions">${m.from?'<button data-action="reply">Reply</button>':''}<button data-action="forward">Forward</button>${(m.rawBase64||m.raw||r.hasOriginal)?'<button data-action="eml">Download original EML</button>':''}${actions}</div><hr>${attachmentSection(r)}${mailBody(r,state.prefs)}`;
  }
  if (state.app==='wiki' && state.wikiPreview) return `<span class="eyebrow">${e(r.title.split(':').slice(0,-1).join(' / ')||'Root namespace')}</span><h1>${e(r.title.split(':').at(-1))}</h1><article class="article">${markdown(r.body)}</article><div class="wiki-layout"><span class="eyebrow">Backlinks</span>${state.rows.filter(x=>x.id!==r.id && x.body.includes('[['+r.title+']]')).map(x=>`<p><button class="wiki-link" data-wiki="${e(x.title)}">${e(x.title)}</button></p>`).join('')||'<p class="muted">No pages link here yet.</p>'}</div>`;
  let content=`<form id="record-form" class="detail-form"><label><span class="file-input">${state.app==='wiki'?'Page ID (namespace:page)':'Title'}</span><input class="title-input" name="title" value="${e(r.title)}" required ${disabled} aria-label="Title"></label>`;
  if (state.app==='tasks') content+=`<div class="fields">${field('Due date','due',m.due,'date')}${field('Priority','priority',m.priority||'Normal')}<label class="check-label"><input type="checkbox" name="done" ${m.done?'checked':''}> Completed</label></div>`;
  if (state.app==='contacts') content+=`<div class="fields">${field('Email','email',m.email,'email')}${field('Phone','phone',m.phone,'tel')}${field('Company','company',m.company)}${field('Group','group',m.group)}</div>`;
  if (state.app==='calendar') content+=`<div class="fields">${field('Start (local time)','start',localInput(m.start),'datetime-local',disabled)}${field('End (local time)','end',localInput(m.end),'datetime-local',disabled)}${field('Location','location',m.location,'text',disabled)}</div>${m.rawIcs||m.raw?'<button type="button" data-action="original-ics">Download original ICS</button>':''}${m.recurrence?`<p class="recurrence-note">Recurring series: ${e(m.recurrence)}. This version displays the master event only; exceptions and generated occurrences are not expanded. Export the original ICS for full fidelity.</p>`:''}`;
  if (state.app==='mail') content+=`<div class="fields">${field('To (one recipient)','to',m.to,'email','required')}<label>Send using<select name="sendAccount" aria-label="Send using"><option value="">Choose an account</option>${m.sendAccount&&!mailAccounts().some(a=>a.id===m.sendAccount)?`<option value="${e(m.sendAccount)}" selected>Unavailable account — choose another</option>`:''}${mailAccounts().map(a=>`<option value="${a.id}" ${m.sendAccount===a.id?'selected':''}>${e(a.label)}</option>`).join('')}</select></label></div>`;
  if (state.app==='documents') content+=`<div class="document-content"><div class="rich-toolbar" role="toolbar" aria-label="Document formatting"><button type="button" data-format="bold" aria-label="Bold"><b>B</b></button><button type="button" data-format="italic" aria-label="Italic"><i>I</i></button><button type="button" data-format="formatBlock" data-value="h1">Heading 1</button><button type="button" data-format="formatBlock" data-value="h2">Heading 2</button><button type="button" data-format="formatBlock" data-value="p">Paragraph</button><button type="button" data-format="insertUnorderedList">List</button><button type="button" data-format="insertOrderedList">1. List</button><button type="button" data-format="table">Table</button><button type="button" data-action="link">Link</button><button type="button" data-action="image">Image</button><button type="button" data-format="undo">Undo</button><button type="button" data-format="redo">Redo</button><button type="button" data-action="text">Plain text</button><button type="button" data-action="print">Print / PDF</button></div><div id="rich-editor" class="rich-editor" contenteditable="true" role="textbox" aria-label="Document content" aria-multiline="true">${safeDocument(r.body)}</div></div><p class="muted">Basic formatting · HTML / plain text export · Vim navigation outside the editing area</p>`;
  else if (state.app==='sheets') content+=sheetContent(r);
  else content+=`<label>${state.app==='wiki'?'Markdown source':state.app==='mail'?'Message':'Notes'}<textarea class="body-editor" name="body" ${disabled}>${e(r.body)}</textarea></label>`;
  if (state.app==='mail') content+=attachmentSection(r)+`<div class="head-actions"><button type="button" class="primary" data-action="send" title="Send message (Ctrl+Enter)" ${sendingMail?'disabled':''}>Send message</button><span class="muted">Ctrl+Enter to send. Saved drafts are never sent automatically.</span></div>`;
  return content+'</form>';
}
function localInput(value?: string) { if (!value) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value+'T00:00'; if (!/[Zz]|[+-]\d\d:\d\d$/.test(value)) return value.slice(0,16); const d=new Date(value); return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function workbook(r: OfficeRecord) {
  r.meta.workbook??={sheets:[{name:'Sheet 1',cells:{}}]};
  for (const s of r.meta.workbook.sheets) if (Array.isArray(s.cells)) s.cells={...s.cells};
  return r.meta.workbook;
}
function sheetContent(r: OfficeRecord) {
  const w=workbook(r); state.sheet=Math.min(state.sheet,w.sheets.length-1); const sheet=w.sheets[state.sheet];
  return `<div><div class="sheet-tabs">${w.sheets.map((s,i)=>`<button type="button" data-sheet="${i}" class="${i===state.sheet?'primary':''}">${e(s.name)}</button>`).join('')}<button type="button" data-action="add-sheet" aria-label="Add sheet">+</button><button type="button" data-action="rename-sheet">Rename</button></div><label class="formula-bar"><code id="cell-label">${state.cell}</code><span class="file-input">Cell formula or value</span><input id="formula" value="${e(sheet.cells[state.cell]||'')}" autocomplete="off" aria-label="Cell formula or value"></label><div class="sheet-wrap"><table class="sheet" aria-label="Spreadsheet"><thead><tr><th></th>${Array.from({length:12},(_,c)=>`<th scope="col">${colName(c)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:30},(_,row)=>`<tr><th scope="row">${row+1}</th>${Array.from({length:12},(_,col)=>{ const ref=colName(col)+(row+1); return `<td><button type="button" data-cell="${ref}" class="${state.cell===ref?'cell-selected':''}" tabindex="${state.cell===ref?'0':'-1'}" aria-label="${ref}: ${e(cellValue(sheet.cells,ref))}">${e(cellValue(sheet.cells,ref))}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">30 × 12 visible cells · + − * / ^ · SUM, AVERAGE, MIN, MAX, COUNT · A1:B5 ranges. Use i or Enter to edit, Escape to return, Tab/arrows to move. Cross-sheet formulas are deferred.</p></div>`;
}
function updateCells() { const cells=workbook(state.current!).sheets[state.sheet].cells; document.querySelectorAll<HTMLElement>('[data-cell]').forEach(b=>{ const v=cellValue(cells,b.dataset.cell!); b.textContent=String(v); b.setAttribute('aria-label',b.dataset.cell!+': '+v); }); }
function selectCell(ref: string,focus=false) {
  state.cell=ref; const sheet=workbook(state.current!).sheets[state.sheet];
  document.querySelector<HTMLElement>('#cell-label')!.textContent=ref; document.querySelector<HTMLInputElement>('#formula')!.value=sheet.cells[ref]||'';
  document.querySelectorAll<HTMLElement>('[data-cell]').forEach(b=>{ const selected=b.dataset.cell===ref; b.classList.toggle('cell-selected',selected); b.tabIndex=selected?0:-1; if(selected&&focus) b.focus(); });
}
function collect() {
  if (!state.current) return; const form=document.querySelector<HTMLFormElement>('#record-form')!; if (!form) return; const values=Object.fromEntries(new FormData(form)) as Record<string, string>;
  state.current!.title=values.title||state.current!.title; if ('body' in values) state.current!.body=values.body;
  const m=state.current!.meta;
  for (const key of ['due','priority','email','phone','company','group','location','to','sendAccount'] as const) if (key in values) m[key]=values[key];
  for (const key of ['start','end'] as const) if (key in values) m[key]=values[key]?new Date(values[key]).toISOString():'';
  if (state.app==='tasks') m.done=values.done==='on';
  if (state.app==='documents') state.current!.body=safeDocument(document.querySelector<HTMLElement>('#rich-editor')!.innerHTML);
}
function markDirty() { state.dirty=true; const s=document.querySelector<HTMLElement>('#save-status')!; if(s) s.textContent='Unsaved changes'; clearTimeout(saveTimer); saveTimer=setTimeout(()=>void attempt(()=>commit()),800); }
async function commit(): Promise<void> {
  clearTimeout(saveTimer); if(state.savePromise) await state.savePromise; if(!state.dirty || !state.current) return;
  collect(); const payload=structuredClone(state.current); state.dirty=false; const id=payload.id;
  state.savePromise=(async()=>{try { const result=await api('save',payload); if(state.current?.id===id) { state.current!.revision=result.record.revision; state.current!.updated=result.record.updated; const pos=state.rows.findIndex(r=>r.id===id); if(pos>=0)state.rows[pos]=state.current; }
    const s=document.querySelector<HTMLElement>('#save-status')!; if(s) s.textContent=state.dirty?'Unsaved changes':'Saved'; renderList();
  } catch(cause) { const error=asError(cause); state.dirty=true; const s=document.querySelector<HTMLElement>('#save-status')!; if(s) s.textContent='Save failed · keep this page open'; throw error; } finally { state.savePromise=null; }})();
  await state.savePromise; if(state.dirty) await commit();
}
async function changeApp(name: AppName) { await waitForAttachments(); await commit(); if(name==='mail'&&state.app!=='mail'){state.mailFolder='Inbox';state.mailScope=null;} state.app=name; state.current=null; state.search=''; state.sheet=0; state.cell='A1'; state.mode='normal'; location.hash=name; await load(); }
function updateMailListItem(id: string) {
  const row=state.rows.find(r=>r.id===id),button=document.querySelector<HTMLElement>(`#items [data-id="${CSS.escape(id)}"]`)!;
  if(!row||!button)return;
  const selected=state.current?.id===id;
  const copy=button.querySelector('.item-copy');if(copy)copy.outerHTML=renderMailListCopy(row,state.prefs.mailList,failedMailActions.get(row.id));
  button.classList.toggle('selected',selected);button.classList.toggle('mail-read',!!row.meta.read);button.classList.toggle('mail-unread',!row.meta.read);
  button.setAttribute('aria-pressed',String(selected||state.selected.has(id)));
  if(selected)button.id='selected-item';else button.removeAttribute('id');
  const label=button.querySelector<HTMLInputElement>('.mail-read-status .file-input')!;if(label)label.textContent=row.meta.read?'Read':'Unread';
}
async function selectRecord(id: string,focus=false) { await waitForAttachments(); await commit(); const previous=state.current?.id;state.current=state.rows.find(r=>r.id===id)||null; state.sheet=0; state.cell='A1'; if(state.app==='mail'){if(!document.querySelector('#items [data-id="'+CSS.escape(id)+'"]'))renderList();if(previous)updateMailListItem(previous);if(state.current)updateMailListItem(state.current!.id);}else renderList(); renderDetail(); if(focus){
  const selected=document.querySelector<HTMLElement>('#selected-item');
  selected?.focus({preventScroll:true});
  selected?.scrollIntoView({block:'nearest',inline:'nearest'});
} }
async function clickRecord(id: string,event: MouseEvent) {
  await commit();
  if(event.shiftKey){
    keyboardSelection=false;
    const rows=filteredRows(),to=rows.findIndex(r=>r.id===id),anchor=rows.findIndex(r=>r.id===(selectionAnchor||state.current?.id)),from=anchor<0?to:anchor;
    if(!event.ctrlKey&&!event.metaKey)state.selected.clear();
    for(const r of rows.slice(Math.max(0,Math.min(from,to)),Math.max(from,to)+1))state.selected.add(r.id);
  }else if(event.ctrlKey||event.metaKey){
    keyboardSelection=false;
    if(!state.selected.size&&state.current)state.selected.add(state.current!.id);
    if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);
    selectionAnchor=id;
  }else{if(!keyboardSelection)state.selected.clear();selectionAnchor=id;}
  renderList();await selectRecord(id,true);
}
function mailAccounts() { return state.accounts.filter(a=>['imap','google'].includes(a.type)); }
function draftAccount(context?: OfficeRecord | null) {
  const accounts=mailAccounts();
  return [context?.meta.sendAccount,context?.meta.account,state.prefs.defaultMailAccount,accounts.length===1?accounts[0].id:''].find(id=>accounts.some(a=>a.id===id)) || '';
}
async function createRecord(initial: Partial<ItemInput>={}, {keepMailList=false,focusBody=false}={}) {
  await waitForAttachments(); await commit(); const kind=state.app;
  if (!apps[kind]) return;
  // Remove the previous editor before the network round-trip, so fast typing cannot overwrite it.
  const previous=state.current;
  document.querySelector<HTMLElement>('#detail')!.innerHTML='<p class="muted" role="status">Creating item…</p>';
  const record: ItemInput={kind:kind as ItemKind,title:initial.title||'Untitled '+apps[kind].singular,body:initial.body||'',meta:{...(kind==='mail'?{folder:'Drafts'}:{}),...initial.meta}};
  if(kind==='mail' && !record.meta.sendAccount)record.meta.sendAccount=draftAccount(previous);
  if(kind==='calendar') { const start=new Date(); start.setMinutes(0,0,0); record.meta.start=start.toISOString(); record.meta.end=new Date(+start+3600000).toISOString(); }
  if(kind==='sheets')record.meta.workbook={sheets:[{name:'Sheet 1',cells:{}}]};
  if(kind==='mail'&&!keepMailList){state.mailScope=null;if(state.mailFolder!=='all')state.mailFolder='Drafts';}
  try {
    const result=await api('save',record);state.wikiPreview=false;
    if(kind==='mail'&&keepMailList){
      state.rows.push(result.record);state.rows.sort(compareMail);state.current=result.record;
      state.selected.clear();selectionAnchor=null;keyboardSelection=false;
      renderList();renderDetail();
    }else await load(result.record.id);
    if(kind==='mail'&&focusBody){
      const body=document.querySelector<HTMLTextAreaElement>('#detail [name="body"]')!;
      body?.focus();body?.setSelectionRange(0,0);setMode('insert');
    }else enterEdit(true);
  }
  catch(cause) { const error=asError(cause); state.current=previous;renderDetail();throw error; }
}
function enterEdit(preferTitle=false) {
  if (state.current?.meta.remote) {notice('This synced copy is read-only.');return;}
  if(state.app==='wiki'&&state.wikiPreview){state.wikiPreview=false;renderDetail();}
  const target=state.app==='sheets'?document.querySelector<HTMLInputElement>('#formula')!:preferTitle?document.querySelector<HTMLInputElement>('.title-input')!:state.app==='documents'?document.querySelector<HTMLElement>('#rich-editor')!:state.app==='wiki'?document.querySelector<HTMLTextAreaElement>('[name=body]')!:document.querySelector<HTMLInputElement>('.title-input')!;
  target?.focus();if(target instanceof HTMLInputElement&&(preferTitle||target.id==='formula'))target.select();setMode('insert');
}
function setMode(mode: string) {state.mode=mode;const m=document.querySelector<HTMLElement>('#mode')!;if(m)m.textContent=mode.toUpperCase();}
async function attempt<T>(fn: () => T | Promise<T>) { try{return await fn();}catch(cause) { const error=asError(cause);notice(error.message,true);} }
function modal(title: string,body: string) { dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button class="quiet" data-close aria-label="Close dialog">✕</button></div>${body}`; dialog.querySelector<HTMLElement>('[data-close]')!.onclick=()=>dialog.close(); dialog.showModal(); }
function confirmation(title: string,message: string,action: () => unknown) { modal(title,`<p>${e(message)}</p><div class="dialog-actions"><button id="cancel">Cancel</button><button class="primary" id="confirm">${e(title)}</button></div>`); dialog.querySelector<HTMLElement>('#cancel')!.onclick=()=>dialog.close();dialog.querySelector<HTMLElement>('#cancel')!.focus();dialog.querySelector<HTMLElement>('#confirm')!.onclick=async()=>{dialog.close();await attempt(action);}; }
function download(name: string,text: BlobPart,type='text/plain') { const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function originalMail(record: OfficeRecord) { return record.meta.rawBase64 ? Uint8Array.from(atob(record.meta.rawBase64),c=>c.charCodeAt(0)) : record.meta.raw || ''; }
async function fullMailRecord(record: OfficeRecord) {
  if(record.meta.headerOnly){await pendingMailReads.get(record.id);return (await api('mail-content',{id:record.id,account:record.meta.account})).record;}
  if(!record.summary)return record;
  const cached=latestMail(record.id);
  if(cached && !cached.summary && cached.revision===record.revision && sameMailTarget(record,cached))return cached;
  return (await api(`record&id=${encodeURIComponent(record.id)}`)).record;
}
async function exportRecords(all=false,selectedRecords: OfficeRecord[] | null=null) {
  await commit(); let records=selectedRecords|| (all?state.rows:[state.current].filter(isPresent)); if(!records.length){notice('There is nothing to export yet.');return;}
  if(state.app==='mail')records=await Promise.all(records.map(fullMailRecord));
  all=all||records.length>1;
  const name=all?state.app:records[0].title;
  if(state.app==='calendar')download(name+'.ics',icsExport(records),'text/calendar');
  else if(state.app==='contacts')download(name+'.vcf',vcardExport(records),'text/vcard');
  else if(state.app==='sheets'&&!all){const sheet=workbook(records[0]).sheets[state.sheet]; const refs=Object.keys(sheet.cells).map(ref=>cellPosition(ref));const rows=Math.max(1,...refs.map(x=>x[0]+1)),cols=Math.max(1,...refs.map(x=>x[1]+1));download(name+'.csv',csvWrite(Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>sheet.cells[colName(c)+(r+1)]||''))),'text/csv');}
  else if(state.app==='wiki'&&!all)download(name+'.md',records[0].body,'text/markdown');
  else if(state.app==='documents'&&!all)download(name+'.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>'+e(name)+'</title><body>'+safeDocument(records[0].body)+'</body></html>','text/html');
  else if(state.app==='mail'&&!all&&(records[0].meta.rawBase64||records[0].meta.raw))download(name+'.eml',originalMail(records[0]),'message/rfc822');
  else download(name+'.json',JSON.stringify({format:'portable-office-items',version:1,records},null,2),'application/json');
}
async function importFile() {
  await commit();const input=document.createElement('input');input.type='file';input.accept='.json,.md,.txt,.html,.htm,.csv,.ics,.vcf,.eml';
  input.onchange=()=>void attempt(async()=>{const file=input.files?.[0];if(!file)return;if(file.size>8*1024*1024)throw Error('Import files up to 8 MB.');const text=await file.text(), ext=file.name.split('.').at(-1)!.toLowerCase();let records: ItemInput[]=[];
    if(ext==='ics'||ext==='eml'){const payload: {format: string; text: string; base64?: string}={format:ext,text:ext==='ics'?text:''};if(ext==='eml'){if(file.size>1400000)throw Error('Original EML import supports up to 1.4 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));payload.base64=btoa(binary);}const r=await api('import',payload);notice(`Imported ${r.count} items locally.`);await load();return;}
    if(ext==='json'){const data=JSON.parse(text) as {format?: string; version?: number; records?: ItemInput[]; preferences?: Preferences};if(data.format==='portable-office'){confirmation('Restore backup','Restore into this empty workspace? Remote copies become local archives. Accounts and credentials are not restored.',async()=>{const r=await api('restore',{backup:data});state.prefs=data.preferences||{};applyTheme();await load();notice(`Restored ${r.count} items.`);});return;}if(data.format!=='portable-office-items'||data.version!==1||!Array.isArray(data.records))throw Error('Unsupported JSON file.');records=data.records;}
    else if(ext==='vcf')records=vcardParse(text);
    else if(ext==='csv') {const rows=csvParse(text);if(rows.length>100||rows.some(r=>r.length>26))throw Error('CSV import supports 100 rows and 26 columns.');const cells: Cells={};rows.forEach((row,r)=>row.forEach((value,c)=>{if(value)cells[colName(c)+(r+1)]=value;}));records=[{kind:'sheets',title:file.name.replace(/\.csv$/i,''),body:'',meta:{workbook:{sheets:[{name:'Sheet 1',cells}]}}}];}
    else if(['md','txt','html','htm'].includes(ext)) {const kind=state.app==='wiki'?'wiki':'documents';const body=kind==='wiki'?text:['html','htm'].includes(ext)?safeDocument(text):text.split('\n').map(line=>'<p>'+e(line)+'</p>').join('');records=[{kind,title:file.name.replace(/\.[^.]+$/,''),body,meta:{}}];}
    else throw Error('Unsupported format.');
    if(records.length>500)throw Error('Import up to 500 items at a time.');
    const result=await api('import-items',{records});await load();notice(`Imported ${result.count} items locally.`);
  });input.click();
}
async function syncAccounts(manual=true) {
  if(state.syncing || document.hidden || (!manual && Date.now()-state.lastActivity>120000))return;
  if(!state.accounts.length){if(manual){notice('Add an account in Settings to start syncing.');await changeApp('settings');}return;}
  if(state.dirty){if(manual)await commit();else return;}
  state.syncing=true;busyButton(document.querySelector<HTMLButtonElement>('#sync-button')!,true);let errors=0;
  const accounts=[...state.accounts];let next=0;
  const active=new Map<string,string>(),pendingHistory=new Set<string>();
  const showActive=()=>{const status=document.querySelector<HTMLElement>('#sync-status');if(status)status.textContent='Syncing '+[...active.values()].join('; ')+'…';};
  const worker=async()=>{
    while(next<accounts.length){
      if(document.hidden || (!manual && Date.now()-state.lastActivity>120000))return;
      const a=accounts[next++];
      try{for(let batch=0;batch<5;batch++){
        active.set(a.id,`${a.label} · batch ${batch+1}${pendingHistory.has(a.id)?' · downloading older mail':''}`);showActive();
        const result=await api('sync',{id:a.id});
        if(result.more)pendingHistory.add(a.id);else pendingHistory.delete(a.id);
        if(state.app==='mail'&&!state.dirty)await load(undefined,{preserveSelection:true});if(!result.more||document.hidden)break;
      }}catch(cause) { const error=asError(cause);errors++;if(manual)notice(a.label+': '+error.message,true);}finally{active.delete(a.id);if(active.size)showActive();}
    }
  };
  // Two accounts at a time leave PHP workers available for local browsing and
  // interactive requests. The per-account operation queue still serializes writes.
  try{await Promise.all([worker(),worker()]);}
  finally{state.syncing=false;busyButton(document.querySelector<HTMLButtonElement>('#sync-button'),false);}
  const s=document.querySelector<HTMLElement>('#sync-status');if(s){
    s.textContent=errors?'Sync needs attention':pendingHistory.size?'Older mail remains · continues on next check':'Checked '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    s.title=pendingHistory.size?'Older messages are still being downloaded for '+accounts.filter(a=>pendingHistory.has(a.id)).map(a=>a.label).join(', ')+'. Each check processes up to five batches.':'';
  }
  state.accounts=(await api('accounts')).accounts;
  // The standard scan already refreshed Inbox/Archive/Trash. Only custom scopes
  // need another scan (or a larger requested download window).
  const scope=state.mailScope,scopeAccount=state.accounts.find(a=>a.id===scope?.account),scopeFolder=scopeAccount?.folders?.find(f=>f.id===scope?.folder);
  if(state.app==='mail'&&scope&&!state.dirty&&(scope.limit>100||!['Inbox','Archive','Trash'].includes(scopeFolder?.role||''))){try{await syncOpenFolder(mailFolderEnv());}catch(cause) { const error=asError(cause);if(manual)notice(error.message,true);}}
  // Never replace an active editor with network data.
  if(state.app==='settings')renderSettings();else if(!state.dirty&&!editable((document.activeElement as HTMLElement)))await load(undefined,{preserveSelection:state.app==='mail'});
}
function help() {
  const k=keys();modal('Keyboard shortcuts',`<p class="muted">Normal mode navigates. Insert mode types. Standard Tab navigation always works. Rich-text editing uses browser editing keys; full Vim operators are planned.</p>${[[k.down+' / '+k.up,'Next / previous item'],[k.left+' / '+k.right,'Focus list / selected item'],['gg / G','First / last item'],['g 1 … g 7','Switch applications'],[k.search,'Search this application'],['n / N','Next / previous search result'],[k.new,'Create an item / compose'],[k.edit,'Enter edit mode'],['Escape','Leave editing and save'],[k.select,'Toggle selection'],[k.save+' / Ctrl or Cmd+S','Save changes'],[k.delete,'Delete selected mail, or current item; connected mail moves to Trash'],[k.archive,'Archive selected messages'],[k.move,'Quick Move to folder'],[k.reply,'Reply to message'],['Ctrl+Enter','Send current draft'],['Sheets: h j k l / arrows','Move between cells'],['Sheets: i / Enter','Edit selected cell'],['Sheets: Tab / Shift+Tab','Next / previous cell']].map(([key,meaning])=>`<div class="help-row"><span>${meaning}</span><kbd>${e(key)}</kbd></div>`).join('')}<p class="muted">Remap single-key actions in Settings. Local deletion requires confirmation. Connected mail moves to Trash; messages already in Trash and synced read-only items are protected. Send confirmation can be disabled under Settings → Mail.</p>`);
}
async function history() {await commit();const r=await api(`history&id=${state.current!.id}`);modal('Revision history',r.revisions.map(h=>`<button class="history-row" data-revision="${h.revision}">Revision ${h.revision} · ${e(h.snapshot.title)}</button>`).join('')||'<p>No saved revisions.</p>');dialog.querySelectorAll<HTMLButtonElement>('[data-revision]').forEach(b=>b.onclick=()=>{const h=r.revisions.find(x=>x.revision===Number(b.dataset.revision!))!;modal('Revision '+h.revision,`<pre class="mail-body">${e(h.snapshot.body)}</pre><button id="restore-revision">Restore this content</button>`);dialog.querySelector<HTMLButtonElement>('#restore-revision')!.onclick=()=>void attempt(async()=>{state.current!.title=h.snapshot.title;state.current!.body=h.snapshot.body;state.current!.meta=h.snapshot.meta;state.dirty=true;dialog.close();renderDetail();await commit();});});}
async function handleClick(event: MouseEvent) {
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;
  await attempt(async()=>{
    if(button.dataset.app!){await changeApp(button.dataset.app! as AppName);return;}
    if(button.dataset.id!){await clickRecord(button.dataset.id!,event);return;}
    if(button.dataset.wiki!){const page=state.rows.find(r=>r.title===button.dataset.wiki!);if(page){state.wikiPreview=true;await selectRecord(page.id);}else{confirmation('Create page',`Create “${button.dataset.wiki!}”?`,()=>createRecord({title:button.dataset.wiki!}));}return;}
    if(button.dataset.cell!){selectCell(button.dataset.cell!,true);return;}
    if(button.dataset.sheet!==undefined){await commit();state.sheet=Number(button.dataset.sheet!);state.cell='A1';renderDetail();return;}
    const action=button.dataset.action!;
    if(action==='toggle-mail-folders')setMailFolderPanel(!document.querySelector<HTMLElement>('.shell')!.classList.contains('folders-open'));
    if(action==='close-mail-folders'){setMailFolderPanel(false);document.querySelector<HTMLElement>('#mail-folders-toggle')!?.focus();}
    if(action==='new')await createRecord();
    if(action==='help')help();
    if(action==='sync')await syncAccounts();
    if(action==='file-mail')await fileMail(mailFolderEnv());
    if(action==='trash-mail')await deleteSelectedMail();
    if(action==='restore-mail')await mailAction('restore');
    if(action==='keep-local')await mailAction('keep-local');
    if(action==='discard-copy'){const record=state.current!;confirmation('Discard copy','Permanently remove this cached recovery copy from Office? Your server mailbox is unaffected.',()=>mailAction('discard',record));}
    if(action==='import')await importFile();
    if(action==='export')await exportRecords();
    if(action==='export-all')await exportRecords(true);
    if(action==='print'){await commit();window.print();}
    if(action==='image')insertImage();
    if(action==='link')insertLink();
    if(action==='text'){await commit();const html=safeDocument(state.current!.body).replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi,'\n').replace(/<br\s*\/?\s*>/gi,'\n');const doc=new DOMParser().parseFromString(html,'text/html');download(state.current!.title+'.txt',doc.body.textContent);}
    if(action==='wiki-mode'){await commit();state.wikiPreview=!state.wikiPreview;renderDetail();if(!state.wikiPreview)enterEdit();}
    if(action==='history')await history();
    if(action==='delete'){
      if(state.app==='mail')await deleteSelectedMail();
      else confirmation('Delete item','Delete this item and its revision history? Export a copy first if you need it.',async()=>{await commit();const record=state.current!;await api('delete',{id:record.id,revision:record.revision});await load();notice('Item deleted.');});
    }
    if(action==='logout'){await commit();await api('logout',{});await boot();}
    if(action==='eml'){const record=await fullMailRecord(state.current!);download(record.title+'.eml',originalMail(record),'message/rfc822');}
    if(action==='original-ics')download(state.current!.title+'.ics',state.current!.meta.rawIcs||state.current!.meta.raw||'','text/calendar');
    if(action==='read')await readMail();
    if(action==='archive')await archiveLocal();
    if(action==='reply'){const original=state.current!;const r=original.meta.headerOnly?await fullMailRecord(original):original;if(state.current?.id!==original.id)return;const match=(r.meta.from||'').match(/<([^>]+)>/);await createRecord({title:/^Re:/i.test(r.title)?r.title:'Re: '+r.title,body:'\n\nOn '+(r.meta.date||'')+', '+(r.meta.from||'')+' wrote:\n'+r.body.split('\n').map(l=>'> '+l).join('\n'),meta:{to:match?match[1]:r.meta.from}},{keepMailList:true,focusBody:true});}
    if(action==='forward'){
      const original=state.current!;await waitForAttachments();await commit();await pendingMailReads.get(original.id);
      const source=original.meta.headerOnly?await fullMailRecord(original):original;
      const response=await api('mail-files',{id:source.id,action:'forward'});
      state.mailScope=null;state.mailFolder='Drafts';await load(response.record.id);enterEdit();
    }
    if(action==='send')await sendMail();
    if(action==='add-sheet'){await commit();const w=workbook(state.current!);if(w.sheets.length>=10)throw Error('Up to 10 sheets per workbook.');w.sheets.push({name:'Sheet '+(w.sheets.length+1),cells:{}});state.sheet=w.sheets.length-1;state.cell='A1';renderDetail();markDirty();}
    if(action==='rename-sheet'){modal('Rename sheet',`<form id="rename-form">${field('Name','name',workbook(state.current!).sheets[state.sheet].name,'text','required maxlength="60"')}<button class="primary">Rename</button></form>`);dialog.querySelector<HTMLFormElement>('form')!.onsubmit=ev=>{ev.preventDefault();collect();workbook(state.current!).sheets[state.sheet].name=new FormData(ev.target as HTMLFormElement).get('name') as string;dialog.close();renderDetail();markDirty();};}
  });
}
async function sendMail() {
  const record=state.current;
  if(sendingMail||dialog.open||state.app!=='mail'||!record||record.meta.remote||record.meta.folder!=='Drafts')return;
  const form=document.querySelector<HTMLFormElement>('#record-form')!;
  if(!form||!form.reportValidity())return;
  sendingMail=true;busyButton(document.querySelector<HTMLButtonElement>('#detail [data-action="send"]')!,true);
  try{
    await waitForAttachments();
    await commit();
    if(state.app!=='mail'||state.current?.id!==record.id)return;
    if(!mailAccounts().some(a=>a.id===record.meta.sendAccount))throw Error('Choose a sending account first.');
    if(state.prefs.confirmBeforeSend!==false){
      const confirmed=await new Promise(resolve=>{
        confirmation('Send message',`Send this saved draft to ${record.meta.to}?`,()=>resolve(true));
        dialog.addEventListener('close',()=>resolve(false),{once:true});
      });
      if(!confirmed)return;
    }
    try{
      await api('send',{id:record.id,revision:record.revision,account:record.meta.sendAccount});
      notice('Message accepted by the provider.');
    }finally{
      if(state.app==='mail'&&state.current?.id===record.id&&!state.dirty&&!state.savePromise)await load();
    }
  }finally{
    sendingMail=false;busyButton(document.querySelector<HTMLButtonElement>('#detail [data-action="send"]')!,false);
  }
}
async function deleteSelectedMail() {
  if(state.app!=='mail')return;
  await commit();
  const visible=filteredRows();
  const rows=state.selected.size?visible.filter(r=>state.selected.has(r.id)):[state.current].filter(isPresent);
  if(!rows.length)return;
  const protectedMail=(r: OfficeRecord)=>r.meta.remote&&['Trash','Recovery copies','Not in Inbox'].includes(r.meta.folder||'');
  if(rows.some(protectedMail))throw Error('The selection includes protected mail. Deselect messages in Trash or recovery copies before deleting.');
  const ids=rows.map(r=>r.id),local=rows.filter(r=>!r.meta.remote).length;
  const apply=async()=>{
    if(state.app!=='mail')throw Error('The application changed. Select the messages again.');
    await commit();
    const current=ids.map(id=>state.rows.find(r=>r.id===id));
    if(current.some(r=>!r||protectedMail(r)||!!r.meta.remote!==!!rows.find(original=>original.id===r.id)!.meta.remote))throw Error('The selected messages changed. Select them again.');
    await deleteMailImmediately(current.filter(isPresent),r=>r.meta.remote?api('mail-action',{id:r.id,revision:r.revision,action:'trash'}):api('delete',{id:r.id,revision:r.revision}));
    notice(rows.length===1?(local?'Item deleted.':'Moved to Trash.'):`${rows.length} items updated.`);
  };
  if(local)confirmation(rows.length===1?'Delete item':'Delete selected messages',`Permanently delete ${local} local message(s) and their revision history?${local<rows.length?` Also move ${rows.length-local} connected message(s) to Trash.`:''}`,apply);
  else await apply();
}
async function archiveLocal() {
  if(state.app!=='mail')return;await commit();const ids=state.selected.size?[...state.selected]:[state.current?.id].filter(isPresent);let count=0;
  const rows=ids.map(id=>state.rows.find(r=>r.id===id)).filter(isPresent);
  if(rows.length && rows.every(r=>r.meta.remote && r.meta.folder!=='Archive')){
    await deleteMailImmediately(rows,r=>api('mail-action',{id:r.id,revision:r.revision,action:'archive'}));
    notice(`Archived ${rows.length} messages.`);return;
  }
  const reconciled=new Set<string>();
  try {
    for(const id of ids){if(reconciled.has(id)){count++;continue;}const r=state.rows.find(r=>r.id===id)!;await pendingMailReads.get(id!);if(r.meta.remote){const result=await api('mail-action',{id:r.id,revision:r.revision,action:'archive'});for(const related of result.removedIds||[])reconciled.add(related);}else{r.meta.folder='Archive';await api('save',r);}count++;}
  } catch(cause) { const error=asError(cause);
    // The provider check may have corrected cached membership even when the move failed.
    try { await load(); } catch {}
    throw error;
  }
  await load();notice(`Archived ${count} messages.`);
}
async function mailAction(action: string,record=state.current) {
  if(state.app!=='mail'||!record)return;await commit();
  if(['trash','discard'].includes(action)){
    await deleteMailImmediately([record],r=>api('mail-action',{id:r.id,revision:r.revision,action}));
    notice(action==='trash'?'Moved to Trash.':'Cached copy discarded.');return;
  }
  const reload=mailDeletionReload(),removed=[];
  try { await api('mail-action',{id:record.id,revision:record.revision,action});if(['trash','discard'].includes(action))removed.push(record.id); }
  finally { await reload(removed); }
  notice(action==='keep-local'?'Saved in Local mail.':action==='discard'?'Cached copy discarded.':action==='trash'?'Moved to Trash.':'Restored to Inbox.');
}
async function repairMail(accountId: string,button: HTMLButtonElement) {
  if(state.syncing){notice('Wait for the current sync to finish.',true);return;}
  await commit();state.syncing=true;busyButton(button,true);busyButton(document.querySelector<HTMLButtonElement>('#sync-button')!,true);
  try {await api('sync',{id:accountId,repair:true});notice('Mail folders resynchronized. Local mail and credentials were kept.');}
  catch(cause) { const error=asError(cause);notice(error.message,true);}
  finally {state.syncing=false;busyButton(button,false);busyButton(document.querySelector<HTMLButtonElement>('#sync-button')!,false);state.accounts=(await api('accounts')).accounts;if(state.app==='settings')renderSettings();else await load();}
}
function markOpenedMailRead(record: OfficeRecord) {
  if(record.meta.read || ['Drafts','Sending','Delivery uncertain','Recovery copies','Not in Inbox'].includes(record.meta.folder||'') || pendingMailReads.has(record.id))return;
  const previousRevision=record.revision;
  mailReadVersion++;
  // Rendering and navigation remain synchronous; only mutations of this message wait.
  const pending=(async()=>{
    try {
      const result=await api(record.meta.remote?'mail-action':'save',record.meta.remote?{id:record.id,revision:previousRevision,action:'read'}:{...record,meta:{...record.meta,read:true}});
      const updatedRecord=result.record;
      if(!updatedRecord)throw Error('The server did not return the updated message.');
      const update=(row: OfficeRecord | null)=>{if(row?.id===record.id && (row.revision===previousRevision || (row.revision<=updatedRecord.revision&&sameMailTarget(row,updatedRecord)))){row.meta.read=updatedRecord.meta.read;row.revision=updatedRecord.revision;row.updated=updatedRecord.updated;}};
      update(record);
      if(state.app==='mail'){
        state.rows.forEach(update);update(state.current);
        updateMailListItem(record.id);
        if(state.current?.id===record.id){const button=document.querySelector<HTMLButtonElement>('#detail [data-action="read"]')!;if(button)button.textContent=`Mark ${state.current!.meta.read?'unread':'read'}`;}
      }
      return {...result,record:updatedRecord,previousRevision};
    } catch(cause) { const error=asError(cause); notice('Could not mark message as read: '+error.message,true); }
    finally { pendingMailReads.delete(record.id);mailReadVersion++; }
  })();
  pendingMailReads.set(record.id,pending);
}
async function readMail() {
  if(state.app!=='mail'||!state.current)return;await commit();const r=state.current;
  if(pendingMailReads.has(r.id))await pendingMailReads.get(r.id);
  if(r.meta.remote)await api('mail-action',{id:r.id,revision:r.revision,action:r.meta.read?'unread':'read'});
  else{r.meta.read=!r.meta.read;await api('save',r);}await load(r.id);
}
function editorSelection() {
  const editor=document.querySelector<HTMLElement>('#rich-editor')!, selection=getSelection()!;
  const range=selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)?selection.getRangeAt(0).cloneRange():null;
  return ()=>{if(!document.contains(editor))throw Error('The document changed before insertion. Reopen it and try again.');editor.focus();const selection=getSelection()!;selection.removeAllRanges();if(range)selection.addRange(range);else{const end=document.createRange();end.selectNodeContents(editor);end.collapse(false);selection.addRange(end);}};
}
function insertImage() {
  const restore=editorSelection(), input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/gif,image/webp';
  input.onchange=()=>void attempt(async()=>{const file=input.files?.[0];if(!file)return;if(file.size>900000)throw Error('Choose an image smaller than 900 KB.');if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type))throw Error('Use PNG, JPEG, GIF or WebP.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Cannot read image.'));reader.readAsDataURL(file);});restore();document.execCommand('insertHTML',false,safeDocument('<img src="'+e(data)+'" alt="'+e(file.name)+'">'));markDirty();});input.click();
}
function insertLink() {
  const restore=editorSelection();modal('Insert link',`<form id="link-form">${field('URL','url','https://','url','required')}<button class="primary">Apply link to selection</button></form>`);
  dialog.querySelector<HTMLFormElement>('form')!.onsubmit=event=>{event.preventDefault();const url=new FormData(event.target as HTMLFormElement).get('url') as string;if(!/^(https?:|mailto:)/i.test(url)){notice('Use an HTTP(S) or mailto URL.',true);return;}dialog.close();restore();if(getSelection()!.isCollapsed)document.execCommand('insertHTML',false,'<a href="'+e(url)+'" rel="noreferrer noopener">'+e(url)+'</a>');else document.execCommand('createLink',false,url);markDirty();};
}
function renderSettings() {
  const p=state.prefs;
  document.querySelector<HTMLElement>('#main')!.innerHTML=`<section class="view-head"><div><h1>Settings</h1><p>Preferences, connected accounts, and backups.</p></div></section><div class="settings"><div class="settings-grid"><section class="card"><h2>Look & feel</h2><p>Choose a theme, accent color, and density.</p><form id="preferences"><label>Theme<select name="theme" aria-label="Theme">${['system','light','dark'].map(x=>`<option ${p.theme===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Accent<select name="accent" aria-label="Accent">${['green','blue','plum'].map(x=>`<option ${p.accent===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Density<select name="density" aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact" ${p.density==='compact'?'selected':''}>Compact</option></select></label><button class="primary">Save preferences</button></form></section><section class="card"><h2>Data and backups</h2><p>Your database and content live inside this application folder. Backups include local records, cached messages, revisions and preferences. Account credentials and your password are excluded.</p><button id="backup">↓ Download full backup</button><p>Restore into an empty installation. Synced copies become local archives; reconnect providers separately. Never copy a live SQLite file as a backup.</p><button id="restore">↑ Restore backup</button><p>Documents: basic formatting and HTML/text. Calendar: agenda, no local recurrence expansion or invitations. Sheets: simple formulas. See README for version limits.</p></section><section class="card full"><h2>Mail</h2><form id="mail-preferences"><label>Default email display<select name="mailDisplay" aria-label="Default email display"><option value="html" ${p.mailDisplay!=='text'?'selected':''}>HTML</option><option value="text" ${p.mailDisplay==='text'?'selected':''}>Text only</option></select></label><label class="check-label"><input type="checkbox" name="mailOffline" ${p.mailOffline===true?'checked':''}> Download message contents during sync for offline use</label><label>Default mail account<select name="defaultMailAccount" aria-label="Default mail account"><option value="">Automatic (only account, when available)</option>${mailAccounts().map(a=>`<option value="${e(a.id)}" ${p.defaultMailAccount===a.id?'selected':''}>${e(a.label)}</option>`).join('')}</select></label><p>New drafts use the selected message’s account first, then this default. Saved drafts keep their chosen account.</p><button class="primary">Save mail preferences</button></form></section><section class="card full" id="google-integration"><h2>Google integration</h2><p>Loading…</p></section><section class="card full"><h2>Connected accounts</h2><p>Only checked while this page is visible and you have used it within two minutes. Automatic checks every two minutes; Sync now is always available. Inbox, Archive and Trash: headers download in resumable batches of 100, including older history. Message bodies download when opened, or during sync when offline downloads are enabled. Folder membership is reconciled against the server. Agenda: previous week through next 90 days, up to 100 events. Previously downloaded mail remains available offline.</p><div>${state.accounts.map(a=>`<div class="account"><div><strong>${e(a.label)} <span class="badge">${e(a.type)}</span></strong><small>${a.last_sync?'Last checked '+e(new Date(a.last_sync).toLocaleString()):'Not checked yet'}${a.error?' · '+e(a.error):''}</small></div><div class="actions">${['imap','google'].includes(a.type)?`<button data-repair-account="${a.id}">Repair / resync</button>`:''}${a.type==='google'?`<button data-google="${a.id}">Authorize</button>`:''}<button class="danger quiet" data-remove-account="${a.id}">Remove</button></div></div>`).join('')||'<p>No accounts connected. Your local apps work without a provider.</p>'}</div><button id="add-account">+ Add account</button><label class="check-label"><input id="keep-recovery" type="checkbox" ${p.keepRecoveryCopies!==false?'checked':''}> Keep recovery copies of messages absent from synchronized folders</label><p>Recovery copies are excluded from All cached mail. Save them in Local mail or discard them. Turning this off removes absent cached copies on the next successful sync; local mail is kept.</p><p>IMAP uses TLS port 993; SMTP uses TLS port 465 with the same credentials. CalDAV requires the calendar collection URL. Public hostnames only. For Gmail email without Google integration setup, choose Gmail — app password in Add account. For Google sign-in and optional Calendar access, configure Google integration once above.</p></section><section class="card full"><h2>Keyboard bindings</h2><p>Home-row navigation is on by default. Remap single-character actions below. Full Vim text operators and visual selections inside document editors are future work.</p><form id="key-form"><div class="fields">${Object.entries(defaultKeys).map(([action,key])=>field(action,'key_'+action,keys()[action],'text','required maxlength="1"')).join('')}</div><button class="primary">Save bindings</button></form></section></div></div>`;
  document.querySelector('#mail-preferences')!.closest('section')!.insertAdjacentHTML('afterend','<section class="card full" id="mail-list-settings"></section>');
  bindMailListSettings(document.querySelector<HTMLElement>('#mail-list-settings')!,p.mailList,async layout=>{await attempt(async()=>{const preferences={...state.prefs,mailList:layout};await api('preferences',{preferences});state.prefs=preferences;notice('List appearance saved.');});});
  document.querySelector<HTMLButtonElement>('#mail-preferences button')!.insertAdjacentHTML('beforebegin',`<label class="check-label"><input type="checkbox" name="confirmBeforeSend" ${p.confirmBeforeSend!==false?'checked':''}> Confirm before sending</label>`);
  void renderGoogleSettings(document.querySelector<HTMLElement>('#google-integration')!,api);
  document.querySelector<HTMLFormElement>('#preferences')!.onsubmit=ev=>{ev.preventDefault();void attempt(async()=>{state.prefs={...state.prefs,...Object.fromEntries(new FormData(ev.target as HTMLFormElement))};await api('preferences',{preferences:state.prefs});applyTheme();notice('Preferences saved.');});};
  document.querySelector<HTMLFormElement>('#mail-preferences')!.onsubmit=event=>{event.preventDefault();void attempt(async()=>{const preferences={...state.prefs,...Object.fromEntries(new FormData(event.target as HTMLFormElement)),mailOffline:((event.target as HTMLFormElement).elements.namedItem('mailOffline') as HTMLInputElement).checked,confirmBeforeSend:((event.target as HTMLFormElement).elements.namedItem('confirmBeforeSend') as HTMLInputElement).checked};await api('preferences',{preferences});state.prefs=preferences;notice('Mail preferences saved.');});};
  document.querySelector<HTMLFormElement>('#key-form')!.onsubmit=ev=>{ev.preventDefault();void attempt(async()=>{const map=Object.fromEntries([...new FormData(ev.target as HTMLFormElement)].map(([k,v])=>[k.slice(4),v as string]));if(new Set(Object.values(map)).size!==Object.values(map).length)throw Error('Choose a different key for each action.');if(Object.values(map).some(v=>'gGnN0123456789'.includes(v)||/\s/.test(v)))throw Error('g/G, n/N, numbers and whitespace are reserved.');state.prefs.keys=map;await api('preferences',{preferences:state.prefs});notice('Bindings saved.');});};
  document.querySelector<HTMLButtonElement>('#backup')!.onclick=()=>void attempt(async()=>download('office-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(await api('backup'),null,2),'application/json'));
  document.querySelector<HTMLButtonElement>('#restore')!.onclick=()=>void attempt(importFile);
  document.querySelector<HTMLButtonElement>('#add-account')!.onclick=accountDialog;
  document.querySelector<HTMLInputElement>('#keep-recovery')!.onchange=event=>void attempt(async()=>{state.prefs={...state.prefs,keepRecoveryCopies:(event.target as HTMLInputElement).checked};await api('preferences',{preferences:state.prefs});notice('Recovery preference saved.');});
  document.querySelectorAll<HTMLButtonElement>('[data-repair-account]').forEach(b=>b.onclick=()=>void repairMail(b.dataset.repairAccount!,b));
  document.querySelectorAll<HTMLButtonElement>('[data-google]').forEach(b=>b.onclick=()=>void attempt(async()=>{const r=await api('google-connect',{id:b.dataset.google!});location.href=r.url;}));
  document.querySelectorAll<HTMLButtonElement>('[data-remove-account]').forEach(b=>b.onclick=()=>confirmation('Remove account','Remove the saved credentials and downloaded cache from this workspace? The provider account is unaffected.',async()=>{await api('account-delete',{id:b.dataset.removeAccount!});state.accounts=(await api('accounts')).accounts;renderSettings();}));
}
function accountDialog() {
  openAccountSetup({dialog,request:api,onSaved:async()=>{
    state.accounts=(await api('accounts')).accounts;
    renderSettings();
  }});
}
const itemMenus=installItemMenus({state,e,commit,selectRecord,enterEdit,api,load,mailDeletionReload,deleteMailImmediately,notice,confirmation,attempt,exportRecords,waitForMailRead:id=>pendingMailReads.get(id),mouseSelection:()=>{keyboardSelection=false;},fileMail:()=>fileMail(mailFolderEnv())});
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented)return;
  state.lastActivity=Date.now();if(document.querySelector<HTMLDialogElement>('dialog[open]')!)return;
  if(event.key==='Enter'&&event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&!event.isComposing&&state.app==='mail'&&state.current?.meta.folder==='Drafts'&&!state.current!.meta.remote){
    event.preventDefault();if(!event.repeat)void attempt(sendMail);return;
  }
  if(event.key==='Escape'&&document.querySelector<HTMLElement>('.shell')!?.classList.contains('folders-open')){setMailFolderPanel(false);document.querySelector<HTMLElement>('#mail-folders-toggle')!?.focus();event.preventDefault();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void attempt(commit);return;}
  if(event.key==='Escape'){if(editable((event.target as HTMLElement))){(event.target as HTMLElement).blur();setMode('normal');event.preventDefault();void attempt(commit);if((event.target as HTMLElement).id==='formula')selectCell(state.cell,true);}else{state.selected.clear();if(state.app!=='settings')renderList();}return;}
  if(editable((event.target as HTMLElement))){setMode('insert');return;}
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const k=keys(), key=event.key;setMode('normal');
  if(Date.now()-sequenceTime>900)keySequence='';sequenceTime=Date.now();
  if(keySequence==='g'&&/^[1-7]$/.test(key)){event.preventDefault();keySequence='';void attempt(()=>changeApp(Object.keys(apps)[Number(key)-1] as AppName));return;}
  if(keySequence==='g'&&key==='g'){keySequence='';event.preventDefault();const row=filteredRows()[0];if(row)void attempt(()=>selectRecord(row.id,true));return;}
  if(key==='g'){keySequence='g';event.preventDefault();return;}keySequence='';
  const action=Object.keys(k).find(action=>k[action]===key);
  if(action==='help'){event.preventDefault();help();return;}
  if(state.app==='settings')return;
  if(action==='search'){event.preventDefault();document.querySelector<HTMLInputElement>('#search')!?.focus();return;}
  if(action==='new'){event.preventDefault();void attempt(createRecord);return;}
  if(action==='edit'||(state.app==='sheets'&&key==='Enter')){event.preventDefault();enterEdit();return;}
  if(action==='save'){event.preventDefault();void attempt(commit);return;}
  if(action==='delete'){
    event.preventDefault();
    if(!event.repeat){
      if(state.app==='mail')void attempt(deleteSelectedMail);
      else if(state.current)document.querySelector<HTMLButtonElement>('#detail [data-action="delete"]')!?.click();
    }
    return;
  }
  if(action==='archive'){event.preventDefault();void attempt(archiveLocal);return;}
  if(action==='move'&&state.app==='mail'){event.preventDefault();if(!event.repeat)void attempt(()=>quickMoveMail(mailFolderEnv()));return;}
  if(action==='reply'&&state.app==='mail'){event.preventDefault();document.querySelector<HTMLButtonElement>('[data-action=reply]')!?.click();return;}
  if(action==='select'&&state.current){event.preventDefault();const id=state.current!.id;selectionAnchor=id;keyboardSelection=true;if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);renderList();document.querySelector<HTMLElement>('#selected-item')?.focus({preventScroll:true});return;}
  if(state.app==='sheets'&&state.current&&(event.target as HTMLElement).closest<HTMLElement>('.sheet-wrap')&&([k.left,k.right,k.down,k.up,'ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Tab'].includes(key))){event.preventDefault();let [r,c]=cellPosition(state.cell);if(key===k.left||key==='ArrowLeft'||key==='Tab'&&event.shiftKey)c--;else if(key===k.right||key==='ArrowRight'||key==='Tab')c++;else if(key===k.up||key==='ArrowUp')r--;else r++;selectCell(colName(Math.max(0,Math.min(11,c)))+(Math.max(0,Math.min(29,r))+1),true);return;}
  if(action==='left'){event.preventDefault();document.querySelector<HTMLElement>('#selected-item')!?.focus();return;}
  if(action==='right'){event.preventDefault();if(state.app==='sheets'&&state.current)selectCell(state.cell,true);else{document.querySelector<HTMLElement>('#detail')!?.setAttribute('tabindex','-1');document.querySelector<HTMLElement>('#detail')!?.focus();}return;}
  if(action==='down'||action==='up'||key==='n'||key==='N'||key==='G'){event.preventDefault();const rows=filteredRows();const index=rows.findIndex(r=>r.id===state.current?.id);const next=key==='G'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(action==='up'||key==='N'?-1:1)));if(rows[next])void attempt(()=>selectRecord(rows[next].id,true));}
});
document.addEventListener('focusin',event=>{if(editable((event.target as HTMLElement)))setMode('insert');});
document.addEventListener('pointerdown',()=>state.lastActivity=Date.now(),{passive:true});
document.addEventListener('wheel',()=>state.lastActivity=Date.now(),{passive:true});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.savePromise){event.preventDefault();event.returnValue='';}});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
setInterval(()=>{if(document.querySelector<HTMLElement>('.shell')!)void attempt(()=>syncAccounts(false));},120000);
void boot();
