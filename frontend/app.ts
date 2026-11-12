import {openHelp} from './help.js';
import {createKeyboardScroller, vimScrollDirection, type ScrollDirection} from './keyboard-scroll.js';
import {CommandError,resolveCommand} from './commands.js';
import {createConnections} from './connections.js';
import {asError,isPresent} from './utils.js';
import type {ActivityEntry, ActivityProgress, ApiData, ApiResponse, ApiRoute, AppName, AppState, CalendarSearchMatch, Cells, ConnectionDeletionChoices, DeleteMail, ItemInput, ItemKind, ItemMeta, MailScope, MutationResult, OfficeRecord, Status, Preferences, RecordList} from './types.js';

interface WireResult {record?: OfficeRecord | null; records?: OfficeRecord[]; removedIds?: string[]; error?: string; code?: string; connectionCounts?: Record<string,number>}
interface RequestPayload {id?: string; revision?: number; action?: string; account?: string; summary?: boolean}
type MailSnapshot = Pick<OfficeRecord, 'id' | 'kind' | 'contentHash' | 'meta'>;

import {escapeHtml as e, markdown, safeDocument, csvParse, sheetCsv, colName, cellPosition, cellValue, icsExport, vcardExport, vcardParse} from './formats.js';
import {openAccountSetup} from './account-setup.js';
import {renderGoogleSettings} from './google-settings.js';
import {captureFolderActions, renderMailFolders, matchesMailScope, syncOpenFolder, fileMail, quickMoveMail, canQuickMoveMail, accountInboxScope, openAccountInbox, backOutOfMailFolder} from './mail-folders.js';
import {renderMailRules} from './mail-rules.js';
import {mailBody, mailDisplayControls, bindMailReader} from './mail-reader.js';
import {messageHeaders,setupHeaderViewer} from './mail-headers.js';
import {attachmentSection, bindAttachments, waitForAttachments} from './mail-attachments.js';
import {installItemMenus} from './item-menus.js';
import {installRowSwipes,itemSwipeActions,mailSwipeActions,swipePreferences,type SwipePreferences} from './swipe.js';
import {compareMail} from './mail-sort.js';
import {mailView,mailViewPreferences,revealMailGroup} from './mail-view.js';
import {taskView,taskViewPreferences,taskPriority,taskDue} from './task-view.js';
import {bindChecklist,checklistContent,checklistEntry,checklistProgress,moveChecklistFocus} from './checklist.js';
import {renderMailListCopy, renderMailListIcon, bindMailFavicons, bindMailListSettings} from './mail-list.js';
import {createActivity} from './activity.js';
import {addDays,agendaEventLabel,calendarDate,calendarDisplayFields,calendarDisplayLimit,calendarSources,connectedCalendarSources,createCalendar,dateOnly,dayKey,upcomingEvents} from './calendar.js';
import {timestampLabel, configureTimeLabels, refreshTimeLabels} from './time-labels.js';
import {panelSplitter, setupPanelSizing} from './panel-sizing.js';
import {mobileActionLabel, mobileDisclosure, mobileIcon, phoneLayout, setDisclosure} from './mobile-layout.js';

const apps: Record<string, {name: string; singular: string; empty: string; hint: string; icon: string}> = {
  mail:{name:'Mail', singular:'message', empty:'No messages yet.',hint:'Connect an account in Settings, import an EML file, or compose your first message.',icon:'M3 5h18v14H3z M3 5l9 7 9-7'},
  calendar:{name:'Calendar',singular:'event',empty:'No events yet.',hint:'Add an event, import a calendar, or connect Google Calendar or CalDAV.',icon:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16'},
  tasks:{name:'Tasks',singular:'task',empty:'No tasks yet.',hint:'Add a task and an optional due date.',icon:'M9 5h12 M9 12h12 M9 19h12 M2 5l2 2 3-4 M2 12l2 2 3-4 M2 19l2 2 3-4'},
  contacts:{name:'Contacts',singular:'contact',empty:'No contacts yet.',hint:'Add a contact or import a vCard address book.',icon:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M20 8v6 M17 11h6'},
  documents:{name:'Documents',singular:'document',empty:'No documents yet.',hint:'Create a document or import an HTML or text file.',icon:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8'},
  wiki:{name:'Wiki',singular:'page',empty:'No pages yet.',hint:'Write Markdown pages, organize namespaces, and link pages with [[wiki links]].',icon:'M3 4h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-3H3z M13 7a3 3 0 0 1 3-3h6v15h-5a4 4 0 0 0-4 3'},
  sheets:{name:'Sheets',singular:'workbook',empty:'No workbooks yet.',hint:'Create a workbook or import a CSV file.',icon:'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18'},
  lists:{name:'Lists',singular:'list',empty:'No lists yet.',hint:'Create a named list and add items to check off.',icon:'M2 3h7v7H2z M3 6l2 2 4-5 M2 14h7v7H2z M13 6h9 M13 17h9'},
};
const defaultKeys: Record<string, string> = {down:'j',up:'k',left:'h',right:'l',pageDown:'d',pageUp:'u',edit:'i',new:'c',search:'/',help:'?',select:'v',save:'s',archive:'a',reply:'r',move:'m',delete:'D',undoDelete:'U',completeTask:'x',connections:'L',addChecklistItem:'o',fullScreen:'z'};
const state: AppState = {app:'mail',rows:[],current:null,csrf:'',accounts:[],prefs:{},search:'',mode:'normal',dirty:false,selected:new Set(),sheet:0,cell:'A1',wikiEditing:false,lastActivity:Date.now(),syncing:false,savePromise:null,mailFolder:'Inbox',mailScope:null,folderOpen:new Set()};
const sqliteBackupType='application/vnd.sqlite3';
let backupRequest: AbortController | undefined;
let preparedBackup: {file: Blob; name: string} | undefined;
let backupMessage='';
const lastSelectedItems=new Map<AppName,string>();
let appEntryVersion=0;
let mailCache: {rows: OfficeRecord[]; page?: RecordList['mailPage']; expires: number; view: MailDraftOrigin; limit: number; scrollTop: number} | undefined;
let mailPage: (NonNullable<RecordList['mailPage']> & {context: string}) | undefined;
let listLoadVersion=0;
let mailQueryTimer: ReturnType<typeof setTimeout>;
function mailQueryContext() {
  const p=mailViewPreferences(state.prefs.mailView);
  return JSON.stringify([state.mailFolder,state.mailScope?.account,state.mailScope?.folder,state.search,p.group,p.sort,p.collapsed]);
}
function recordsRoute(fullMail=false): `records&${string}` {
  if(state.app!=='mail')return `records&kind=${state.app}`;
  if(fullMail)return 'records&kind=mail&summaries=1';
  const prefs=mailViewPreferences(state.prefs.mailView);
  const paged=!state.search&&prefs.group!=='sender'&&prefs.sort==='date-desc'&&!prefs.collapsed.length&&mailListLimit<=10000;
  const params=new URLSearchParams({kind:'mail',summaries:'1',view:'1',folder:state.mailScope?.folder??state.mailFolder});
  if(state.mailScope)params.set('account',state.mailScope.account);
  if(paged){params.set('page','1');params.set('limit',String(mailListLimit));}
  return `records&${params}`;
}
function scheduleMailQuery() {
  clearTimeout(mailQueryTimer);
  mailQueryTimer=setTimeout(()=>{if(state.app==='mail')void attempt(refreshMailQuery);},150);
}
async function refreshMailQuery() {
  clearTimeout(mailQueryTimer);
  const request=++listLoadVersion,entry=appEntryVersion,context=mailQueryContext(),route=recordsRoute();
  const viewport=captureMailListViewport();let result: RecordList,version;
  try {
    do {
      version=mailDeleteVersion+mailReadVersion;result=await api(route);
      if(state.app!=='mail'||entry!==appEntryVersion||request!==listLoadVersion||context!==mailQueryContext())return;
    }while(version!==mailDeleteVersion+mailReadVersion);
  }catch(error){
    if(state.app==='mail'&&entry===appEntryVersion&&request===listLoadVersion&&context===mailQueryContext()){
      const list=document.querySelector<HTMLElement>('#items')!;
      list.innerHTML='<div class="list-empty" role="alert">Couldn’t load messages. <button type="button">Try again</button></div>';
      list.querySelector('button')!.onclick=()=>{void attempt(refreshMailQuery);};
    }
    throw error;
  }
  mailPage=result.mailPage?{...result.mailPage,context}:undefined;
  state.rows=result.records.filter(r=>!pendingMailDeletes.has(r.id)).sort(compareMail);
  if(state.current&&!state.dirty&&!isUnsavedDraft())state.current=state.rows.find(row=>row.id===state.current?.id)??state.current;
  const visible=new Set(matchingRows().map(row=>row.id));
  for(const id of state.selected)if(!visible.has(id))state.selected.delete(id);
  // A search or view change must never replace an editor or unsaved draft.
  renderList();restoreMailListViewport(viewport);
}
let mailCacheTimer: number | undefined;
let pendingWrites=0;
const mailCacheLifetime=30_000;
const mailCacheBudget=8*1024*1024;
function clearMailCache() {
  clearTimeout(mailCacheTimer);
  mailCache=undefined;
}
function retainMailRows() {
  clearMailCache();
  if(pendingWrites||state.syncing)return;
  if(mailPage&&(mailPage.context!==mailQueryContext()||(mailPage.more&&state.rows.length<mailListLimit)))return;
  let remaining=mailCacheBudget;
  const fits=(value: unknown): boolean=>{
    remaining-=typeof value==='string'?32+2*value.length:64;
    if(remaining<0)return false;
    if(Array.isArray(value))return value.every(fits);
    if(value&&typeof value==='object'){
      for(const key in value){
        if(!fits(key)||!fits((value as Record<string,unknown>)[key]))return false;
      }
    }
    return true;
  };
  if(!fits(state.rows))return;
  mailCache={
    rows:state.rows,
    page:mailPage,
    expires:Date.now()+mailCacheLifetime,
    view:mailDraftOrigin(false),
    limit:mailListLimit,
    scrollTop:document.querySelector('#items')?.scrollTop??0,
  };
  mailCacheTimer=window.setTimeout(clearMailCache,mailCacheLifetime);
}
const appEntryVisible=()=>!!document.querySelector('#main[data-app-entry]');
function rememberSelection() {
  if(state.current)lastSelectedItems.set(state.app,state.current.id);
}
const root=document.querySelector<HTMLElement>('#app')!, dialog=document.querySelector<HTMLDialogElement>('#dialog')!;
const activity=createActivity({csrf:()=>state.csrf,keys:()=>keys(),openItem:openActivityRecord,onSessionExpired:()=>void lockExpiredSession()});
let remoteSenderIcons=false,lastSessionActivity=Date.now();
const calendar=createCalendar({query:()=>state.search,allRows:()=>state.rows,rows:()=>filteredRows(),accounts:()=>state.accounts,aliases:()=>state.prefs.calendarAliases,display:()=>state.prefs.calendarDisplay,rename:renameCalendar,renameIcon:mobileIcon('edit'),current:()=>state.current?.id,compact:()=>phoneLayout.matches,create:(start,end)=>createRecord({meta:{start,end}}),before:leaveEditor,error:action=>{void attempt(action);}});
const connections=createConnections({api,icon,keys:()=>keys(),current:()=>state.current?.id,open:openConnectedRecord,closed:restoreConnectionsFocus,modal,dialog,notice,command:value=>openCommand(value),confirmation,attempt});
let pendingLinkedSource: {draft:string;source:string}|undefined;
let unsavedDraft: OfficeRecord | null=null;
class DraftCancelled extends Error {}
let calendarSaveFailure: {id: string; message: string} | undefined;
let calendarSeriesEditor: OfficeRecord | undefined;
const providerCalendar = (record: OfficeRecord | null) => record?.kind==='calendar' && !!record.meta.remote && !!record.meta.calendarWritable && !record.meta.calendarAbsent;
const isUnsavedDraft=()=>!!unsavedDraft && state.current===unsavedDraft;
interface MailDraftOrigin {folder: string; scope: MailScope | null; search: string; selectedId?: string}
const mailDraftOrigins=new Map<string,MailDraftOrigin>();
let lastMailView: MailDraftOrigin={folder:'Inbox',scope:null,search:''};
function mailDraftOrigin(inherit=true): MailDraftOrigin {
  return structuredClone((inherit?mailDraftOrigins.get(state.current?.id||''):undefined) ||
    (!state.mailScope&&state.mailFolder==='Drafts'?lastMailView:{folder:state.mailFolder,scope:state.mailScope,search:state.search,selectedId:state.current?.id}));
}
function returnFromMailDraft(id: string) {
  const origin=mailDraftOrigins.get(id)||lastMailView;mailDraftOrigins.delete(id);
  state.mailFolder=origin.folder;state.mailScope=structuredClone(origin.scope);state.search=origin.search;
  state.selected.clear();selectionAnchor=null;keyboardSelection=false;
  state.current=navigableRows().find(r=>r.id===origin.selectedId)||navigableRows()[0]||null;
  mobileItemOpen=false;
  renderWorkspace();setMode('normal');focusList();
}
let saveTimer: ReturnType<typeof setTimeout>, keySequence='', sequenceTime=0;
let selectionAnchor: string | null=null,keyboardSelection=false;
let sendingMail=false;
let pendingSend: OfficeRecord | null=null;
const isPendingSend=(id: string | undefined)=>!!pendingSend&&pendingSend.id===id;
const viewingPendingSend=()=>state.app==='mail'&&isPendingSend(state.current?.id)&&(!phoneLayout.matches||mobileItemOpen);
function renderSendStatus() {
  document.querySelector<HTMLElement>('#mail-send-status')!.hidden=!pendingSend||viewingPendingSend();
}
const pendingMailDeletes=new Set<string>();
interface MailDeleteGesture {receipts: {token: string; account?: string; id: string; postId?: string}[]; done: Promise<void>; finish: () => void; currentId?: string; nextId?: string; context: string}
let lastMailDelete: MailDeleteGesture | undefined,undoingMailDelete=false;
const failedMailActions=new Map<string,string>();
let mailDeleteVersion=0;
const pendingMailReads=new Map<string, Promise<(MutationResult & {previousRevision: number}) | void>>();
const mailAccountQueue=new Map<string, Promise<WireResult>>(),mailSnapshots=new Map<string, Map<number, MailSnapshot>>(),mailLatest=new Map<string, OfficeRecord>(),trashedMailCopies=new Map<string, OfficeRecord>();
let mailReadVersion=0, displayedMailId: string | null=null;
function icon(name: string) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${apps[name]?.icon || 'M12 3v18 M3 12h18'}"/></svg>`;
}
const headerActionPaths = {
  compose: 'M13 5H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9 M10 14l1-4 8-8 3 3-8 8-4 1z',
  new: 'M12 5v14 M5 12h14',
  import: 'M12 15V3 M8 7l4-4 4 4 M4 15v5h16v-5',
  'export-all': 'M12 3v12 M8 11l4 4 4-4 M4 15v5h16v-5',
};

function headerAction(action: 'new' | 'import' | 'export-all', label: string, glyph: keyof typeof headerActionPaths = action) {
  return `<button class="header-action ${action==='new'?'primary':'quiet'}" data-action="${action}" aria-label="${e(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${headerActionPaths[glyph]}"/></svg><span class="header-action-label" aria-hidden="true">${e(label)}</span></button>`;
}
function mailExportMenu() {
  return `<details id="mail-export-menu"><summary class="header-action quiet" aria-label="Mail export options" title="Mail export options"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${headerActionPaths['export-all']}"/></svg></summary><div class="mail-export-options"><button type="button" data-action="export-cached-mail">Export cached mail</button><button type="button" data-action="export-full-mail">Export with missing bodies</button></div></details>`;
}

const keys = () => Object.fromEntries(Object.keys(defaultKeys).map(action=>{
  const saved=state.prefs.keys?.[action];
  // Upgrade the former defaults when reading older saved bindings. Settings
  // displays these effective values and persists them on the next save.
  const legacy=action==='delete'&&saved==='d'||action==='undoDelete'&&saved==='u';
  return [action,legacy?defaultKeys[action]:saved||defaultKeys[action]];
}));
const editable = (node: EventTarget | null) => node instanceof HTMLElement &&
  (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)&&!node.matches('[data-checklist-row] input'));
const dateLabel = (value: string) => { const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00':value); return timestampLabel(value,Number.isNaN(+date)?value:date.toLocaleDateString(undefined,{month:'short',day:'numeric'})); };
setInterval(()=>{if(!document.hidden)refreshTimeLabels();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTimeLabels();});
const field = (label: string,name: string,value='',type='text',extra='') => `<label>${e(label)}<input type="${type}" name="${name}" value="${e(value)}" ${extra}></label>`;
const busyButton = (button: HTMLButtonElement | null,busy: boolean) => { if (button) button.disabled=busy; };
function notice(text: string,error=false) { activity.notice(text,error); }
let commandInput: HTMLInputElement | null=null,commandFocus: HTMLElement | null=null,commandBusy=false;
let commandSuggestions: ReturnType<typeof connections.autocomplete>|undefined;
function closeCommand(restore=false) {
  commandSuggestions?.close();commandSuggestions=undefined;
  const input=commandInput;commandInput=null;input?.remove();
  document.querySelector<HTMLElement>('#notice')!.hidden=false;setMode('normal');
  if(restore)(commandFocus?.isConnected?commandFocus:document.querySelector<HTMLElement>('#main'))?.focus({preventScroll:true});
  commandFocus=null;
}
async function signOut() {await waitForAttachments();await leaveEditor();clearSwipeActions();await api('logout',{});await boot();}
const commandHandlers={
  mail:async(accountQuery?:string)=>{
    if(accountQuery===undefined){await changeApp('mail');return;}
    const scope=accountInboxScope(resolveAccount(mailAccounts(),accountQuery));
    if(!await changeApp('mail',false,scope))return;
    if(state.app==='mail'&&state.mailScope===scope){
      try{await syncOpenFolder(mailFolderEnv());}
      finally{if(state.mailScope===scope&&document.activeElement===document.body)focusList();}
    }
  },
  calendar:()=>changeApp('calendar'),
  tasks:()=>changeApp('tasks'),
  contacts:()=>changeApp('contacts'),
  docs:()=>changeApp('documents'),
  sheets:()=>changeApp('sheets'),
  wiki:()=>changeApp('wiki'),
  lists:()=>changeApp('lists'),
  settings:()=>changeApp('settings'),
  backup:()=>changeApp('settings',false,undefined,'backups'),
  sync:(account?:string)=>syncAccounts(true,account),
  head:async()=>{if(state.app!=='mail'||!state.current)throw new CommandError('Select a mail message before using :head.');await viewMessageHeaders();},
  q:signOut,
  log:()=>activity.open(),
  errors:()=>activity.open('error'),
  warnings:()=>activity.open('warning'),
  new:async(type?: string,title?: string)=>{
    const target=type as AppName | undefined;
    if(!target&&!apps[state.app])throw new CommandError('Specify an item type for :new in Settings.');
    if(target&&(target!==state.app||appEntryVisible())){if(!await changeApp(target))return;}
    if(appEntryVisible())return;
    await createRecord({title});
  },
};
function openCommand(value=':') {
  if(commandBusy||commandInput)return;
  commandFocus=document.activeElement as HTMLElement;keySequence='';setMode('command');
  const input=document.createElement('input');commandInput=input;
  input.id='command-input';input.setAttribute('aria-label','Command');input.autocomplete='off';input.spellcheck=false;input.value=value;
  document.querySelector<HTMLElement>('#notice')!.hidden=true;
  document.querySelector<HTMLElement>('#activity-status')!.prepend(input);input.focus();
  commandSuggestions=connections.autocomplete(input,command=>command==='mail'?mailAccounts():state.accounts);
  if(value!==':')input.dispatchEvent(new Event('input'));
  input.addEventListener('blur',()=>{if(commandInput===input){closeCommand();if(editable(document.activeElement))setMode('insert');}});
  input.addEventListener('keydown',event=>{
    state.lastActivity=Date.now();event.stopPropagation();
    if(commandSuggestions?.key(event))return;
    if(event.key==='Escape'){event.preventDefault();closeCommand(true);return;}
    if(event.key!=='Enter'||event.isComposing)return;
    event.preventDefault();if(event.repeat||commandBusy)return;
    let command: ReturnType<typeof resolveCommand>;
    try{
      command=resolveCommand(input.value);
      if(command.name==='sync'||command.name==='mail')command.argument=commandSuggestions?.selectedAccountId()??command.argument;
    }catch(cause){activity.notice(asError(cause).message,true,{log:!(cause instanceof CommandError)});closeCommand(true);return;}
    activity.clearCommandError();
    commandBusy=true;closeCommand(true);
    void (async()=>{try{
      if(command.name==='link'||command.name==='unlink')await connections.mutate(command.name,command.argument!,command.kind);
      else if(command.name==='links')await connections.view(command.argument==='all');
      else if(command.name==='new'&&command.linked){
        if(!state.current)throw new CommandError('Select an item before creating a linked item.');
        const source=state.current;
        await leaveEditor();
        if(!state.rows.some(row=>row.id===source.id))throw new CommandError('Linked creation cancelled because the source draft was discarded.');
        const sourceId=source.id;
        await commandHandlers.new(command.argument,command.title);
        if(isUnsavedDraft())pendingLinkedSource={draft:state.current!.id,source:sourceId};
      }else await commandHandlers[command.name](command.argument,command.title);
    }catch(cause){if(!(cause instanceof DraftCancelled))activity.notice(asError(cause).message,true,{log:!(cause instanceof CommandError)});}finally{commandBusy=false;}})();
  });
}
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
async function requestApi(route: ApiRoute, data?: ApiData, signal?: AbortSignal): Promise<WireResult> {
  let payload = data as RequestPayload | undefined;
  if(route==='mail-action')payload={...payload,summary:true};
  const file=route==='restore'&&data instanceof File?data:undefined;
  const response=await fetch('api.php?r='+route,{method:payload===undefined?'GET':'POST',headers:payload===undefined?{}:{'Content-Type':file?sqliteBackupType:'application/json','X-CSRF-Token':state.csrf,'X-Office-Progress':'1'},body:file??(payload===undefined?undefined:JSON.stringify(payload)),cache:'no-store',signal});
  let result!: WireResult,status=response.status;
  let cacheRefresh: Promise<void> | undefined;
  if(response.headers.get('Content-Type')?.includes('application/x-ndjson')){
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
    const consume=(line: string)=>{
      if(!line.trim())return;
      const event=JSON.parse(line) as {type: 'activity'; entry: ActivityEntry} | {type: 'activity-progress'; entry: ActivityProgress} | {type: 'result'; body: WireResult; status: number};
      if(event.type==='activity'||event.type==='activity-progress'){
        if(event.type==='activity')activity.receive(event.entry);
        else activity.progress(event.entry);
        if(route==='sync' && event.entry.phase==='mail-cache-ready' && state.app==='mail' && !state.dirty && !document.hidden){
          cacheRefresh??=load(undefined,{preserveSelection:true,selectFirst:false}).catch(cause=>notice(asError(cause).message,true));
        }
      }
      if(event.type==='result'){result=event.body;status=event.status;finished=true;}
    };
    const syncRequest=route==='sync'||route==='mail-folder-sync';
    const syncInterrupted='Mail sync ended before Office received a result. Some messages may already be cached. Check the PHP error log for the cause, then retry sync.';
    while(true){
      const {value,done}=await reader.read().catch(cause=>{
        signal?.throwIfAborted();
        if(syncRequest&&!finished)throw Error(syncInterrupted,{cause});
        throw cause;
      });
      buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
      let newline;while((newline=buffer.indexOf('\n'))!==-1){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
      if(done){if(buffer.trim())consume(buffer);break;}
    }
    if(!finished)throw Error(syncRequest?syncInterrupted:'The connection ended before the operation was confirmed. Check recent activity and sync before retrying.');
  }else try { result=await response.json() as WireResult; } catch { signal?.throwIfAborted();throw Error('The server did not return JSON. Check PHP configuration and upload limits.'); }
  await cacheRefresh;
  if (status>=400) {
    if(status===409&&result.code==='mail_revision_conflict'&&result.record)refreshMailRecord(result.record);
    if (status===401 && route!=='login') await lockExpiredSession();
    throw Object.assign(Error(result.error || 'Request failed.'),{status,code:result.code,record:result.record});
  }
  for(const record of result.records||[])rememberMail(record);
  rememberMail(result.record);
  if(result.connectionCounts){
    for(const row of [...state.rows,...(state.current?[state.current]:[])])if(row.id in result.connectionCounts)row.connectionCount=result.connectionCounts[row.id];
    document.querySelectorAll<HTMLElement>('#items .item[data-id]').forEach(item=>{
      const count=result.connectionCounts![item.dataset.id!],badge=item.querySelector<HTMLElement>('.mail-list-connections');
      if(count===undefined||!badge)return;
      badge.hidden=count===0;badge.title=`${count} ${count===1?'connection':'connections'}`;badge.setAttribute('aria-label',badge.title);badge.querySelector('span')!.textContent=String(count);
    });
  }
  if(route==='mail-action'&&payload?.action==='trash'&&result.record?.meta?.folder==='Trash'){
    for(const id of result.removedIds||[])trashedMailCopies.set(id,result.record);
  }
  return result;
}
function api(route: 'google-settings', data: ApiData): Promise<{ok: boolean}>;
function api<R extends ApiRoute>(route: R, data?: ApiData, signal?: AbortSignal): Promise<ApiResponse<R>>;
async function api<R extends ApiRoute>(route: R, data?: ApiData, signal?: AbortSignal): Promise<ApiResponse<R>> {
  let payload = data as RequestPayload | undefined;
  const expected=mailSnapshots.get(payload?.id!)?.get(payload?.revision!);
  // Let an in-flight read update finish before another mutation uses its revision.
  if(payload?.id && ['save','delete','mail-action','mail-files'].includes(route) && pendingMailReads.has(payload.id)) {
    const result=await pendingMailReads.get(payload.id);
    if(result && payload.revision===result.previousRevision)payload={...payload,revision:result.record.revision};
  }
  const account=route==='mail-undo'?payload?.account:['mail-action','mail-files'].includes(route)?expected?.meta.account||latestMail(payload?.id)?.meta.account
    :['sync','account-save','account-find-calendars'].includes(route)?payload?.id:['mail-content','mail-export-batch','mail-folder-sync','mail-folders','mail-folder-manage'].includes(route)?payload?.account:null;
  const names: Partial<Record<ApiRoute, string>>={'mail-undo':'Undoing mail deletion','mail-action':({trash:'Moving mail to Trash',archive:'Archiving mail',restore:'Restoring mail to Inbox',read:'Marking mail read',unread:'Marking mail unread',move:'Moving mail',discard:'Discarding cached copy','keep-local':'Saving local copy'})[payload?.action||'']||'Updating mail',sync:'Synchronizing mail','mail-folders':'Discovering folders','mail-folder-sync':'Refreshing folder','mail-folder-manage':'Updating folders','account-test':'Testing connection',save:'Saving item',delete:'Deleting item',restore:'Restoring backup',import:'Importing items','import-items':'Importing items'};
  const label=state.accounts.find(row=>row.id===account)?.label;
  const tracking=activity.queued(names[route]?(label?label+': ':'')+names[route]+'…':null);
  const run=async()=>{
    const moved=trashedMailCopies.get(payload?.id!);
    if(route==='mail-action'&&payload?.action==='trash'&&moved&&latestMail(moved.id)?.meta.folder==='Trash')return {record:moved,removedIds:[payload!.id!]};
    const latest=latestMail(payload?.id);
    if(route==='mail-action'&&sameMailActionTarget(expected,latest))payload={...payload,revision:latest!.revision};
    for(let attempt=0;;attempt++){
      try{return await requestApi(route,payload,signal);}
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
  const trackedRun=async()=>{
    signal?.throwIfAborted();
    activity.running(tracking);
    if(data){pendingWrites++;clearMailCache();}
    try{return await run();}
    finally{
      if(data){pendingWrites--;clearMailCache();}
      activity.done(tracking);
    }
  };
  if(!account)return await trackedRun() as ApiResponse<R>;
  const queueAccount=['sync','mail-folder-sync','account-save','account-find-calendars'].includes(route)?'sync:'+account:account;
  const previous=mailAccountQueue.get(queueAccount)||Promise.resolve();
  const pending=previous.catch(()=>{}).then(trackedRun);
  mailAccountQueue.set(queueAccount,pending);
  try{return await pending as ApiResponse<R>;}
  finally{if(mailAccountQueue.get(queueAccount)===pending)mailAccountQueue.delete(queueAccount);}
}
function applyTheme() {
  configureTimeLabels(state.prefs.showElapsedTime!==false);
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
  clearSwipeActions();
  setItemFullScreen(false);
  mobileItemOpen=false;
  mobileListPosition=undefined;
  navigationHistory.length=0;
  mobileBackId=undefined;
  appEntryVersion++;
  backupRequest?.abort();
  backupRequest=undefined;
  preparedBackup=undefined;
  backupMessage='';
  clearMailCache();
  state.rows=[];
  state.current=null;
  document.querySelector<HTMLElement>('#sync-status')!.hidden=true;
  lastMailDelete=undefined;
  try { const status=await api('status'); state.csrf=status.csrf;activity.configure(!!status.authenticated&&!!status.activity); if (!status.authenticated) { authView(status); return; }
    remoteSenderIcons=status.remoteSenderIcons===true;
    lastSessionActivity=status.lastInteraction?Math.min(Date.now(),status.lastInteraction*1000):Date.now();
    state.prefs=status.preferences||{}; applyTheme();
    const hash=location.hash.slice(1); state.app=apps[hash]||hash==='settings'?hash as AppName:'mail';
    mailListLimit=100;mailPage=undefined;
    const initial=state.app==='settings'?null:api(recordsRoute());
    const [accounts,records]=await Promise.all([api('accounts'),initial]);state.accounts=accounts.accounts;
    shell(); await load(undefined,{enteringApp:true},records??undefined);
    if (state.accounts.length) void syncAccounts(false);
  } catch(cause) { const error=asError(cause); root.innerHTML=`<main class="auth"><h1>Workspace unavailable</h1><p class="error">${e(error.message)}</p><p>Requires PHP 8.2+, PDO SQLite and a writable private data directory. Point the domain at <code>public/</code>.</p><button id="retry">Try again</button></main>`; document.querySelector<HTMLElement>('#retry')!.onclick=boot; }
}
async function lockExpiredSession() {
  if(!root.querySelector('.shell'))return;
  state.dirty=false;
  root.replaceChildren();
  if(dialog.open)dialog.close();
  dialog.replaceChildren();
  activity.configure(false);
  await boot();
}
function reportSessionActivity() {
  const now=Date.now();
  if(document.hidden||!root.querySelector('.shell')||now-lastSessionActivity<30_000)return;
  lastSessionActivity=now;
  void requestApi('session-activity',{}).catch(()=>{});
}
let panelSizing: ReturnType<typeof setupPanelSizing>;
window.addEventListener('resize',()=>panelSizing?.refresh());
function shell() {
  const syncStatus=document.querySelector<HTMLElement>('#sync-status')!;
  syncStatus.textContent='Automatic sync';syncStatus.hidden=false;
  root.innerHTML=`<div class="shell"><aside id="app-sidebar" class="sidebar" aria-label="Application navigation"><div class="brand"><div><strong>Office</strong></div></div><button type="button" class="mobile-only mobile-menu-close mobile-icon-button" data-action="mobile-menu-close" aria-label="Close menu" title="Close menu">${mobileIcon('close')}</button><p class="eyebrow nav-label">Applications</p><nav class="nav application-nav">${Object.entries(apps).map(([id,a],i)=>`<button data-app="${id}" title="${a.name} · g ${i+1}" aria-label="${a.name}">${icon(id)}<span>${a.name}</span><kbd>${i+1}</kbd></button>${id==='mail'?`<div id="mobile-folder-control" class="mobile-only">${mobileDisclosure('mail-folder-navigation','Mail folders','mobile-folder-toggle')}</div><section id="mail-folder-navigation" aria-label="Mail folders"></section>`:''}`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button data-action="connections" title="All connections" aria-label="All connections">${icon('wiki')}<span>Connections</span></button><button data-app="settings" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 4v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/></svg><span>Settings</span></button><button data-action="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${icon('wiki')}<span>Keyboard shortcuts</span><kbd>?</kbd></button></nav><div class="privacy-note"><span class="privacy-dot"></span> Stored in your application folder.</div></div>${panelSplitter('sidebar')}</aside><div class="mobile-only mobile-menu-backdrop" data-mobile-menu-backdrop></div><div class="workspace"><header class="topbar"><div class="breadcrumb"><button type="button" id="mobile-menu" class="mobile-only mobile-icon-button" data-action="mobile-menu" aria-controls="app-sidebar" aria-expanded="false" aria-label="Menu" title="Menu">${mobileIcon('menu')}</button><h1 id="crumb"></h1></div><div id="header-controls" class="topbar-controls"><div class="header-action-group" id="mail-toolbar" hidden>${headerAction('new','Compose','compose')}${headerAction('import','Import')}${mailExportMenu()}<span class="mail-export-status" id="mail-export-status" role="status"></span><button type="button" class="quiet" id="cancel-mail-export" hidden>Cancel export</button></div><div class="app-toolbar" id="app-toolbar" hidden></div><div class="top-actions"><button type="button" class="quiet mobile-icon-button" data-action="sync" id="sync-button" aria-label="Sync now" title="Refresh connected accounts">${mobileIcon('refresh')}<span class="mobile-icon-label" aria-hidden="true">↻</span><span class="mobile-icon-label">Sync now</span></button>${mobileDisclosure('header-controls','More','mobile-header-more','more')}<span class="mode" id="mode">NORMAL</span><details id="top-agenda" class="top-agenda"><summary class="mobile-icon-button" title="Upcoming agenda"><time></time><span class="mobile-only">${icon('calendar')}</span></summary><section class="top-agenda-panel" aria-label="Upcoming agenda"><time class="mobile-only top-agenda-clock"></time><h2>Upcoming agenda</h2><div class="top-agenda-events"></div></section></details><div class="top-actions-overflow"><button class="avatar" data-action="logout" title="Sign out" aria-label="Sign out">ME</button></div></div></div></header><main id="main" tabindex="-1"></main></div></div>`;
  panelSizing=setupPanelSizing(root.querySelector<HTMLElement>('.shell')!,()=>setMailFolderPanel(false));
  setupTopAgenda();
  root.onclick=handleClick;
}
let topClockTimer: number;
function updateTopClock() {
  window.clearTimeout(topClockTimer);
  const clocks=document.querySelectorAll<HTMLTimeElement>('#top-agenda time');
  if(!clocks.length)return;
  const now=new Date();
  const dateTime=now.toISOString();
  const label=now.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  clocks.forEach(clock=>{clock.dateTime=dateTime;clock.textContent=label;});
  topClockTimer=window.setTimeout(updateTopClock,60000-now.getTime()%60000);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateTopClock();});
function setupTopAgenda() {
  const agenda=document.querySelector<HTMLDetailsElement>('#top-agenda')!;
  const trigger=agenda.querySelector('summary')!;
  const events=agenda.querySelector<HTMLElement>('.top-agenda-events')!;
  let request=0;
  let upcoming: ReturnType<typeof upcomingEvents>=[];
  let visible=0;
  function renderAgenda() {
    const rows=upcoming.slice(0,visible);
    const more=upcoming.length-visible;
    events.innerHTML=rows.map(({record,...bounds})=>
      `<button type="button" data-agenda-event="${e(record.id)}"><strong>${e(record.title||'Untitled event')}</strong><small>${e(agendaEventLabel(bounds))}</small></button>`
    ).join('')+(more>0?`<button type="button" data-header-agenda-more>Show more (${more} remaining)</button>`:'')
      ||'<p role="status">No events in the next seven days.</p>';
  }
  async function loadAgenda() {
    const version=++request;
    const isCurrent=()=>agenda.isConnected&&agenda.open&&version===request;
    events.innerHTML='<p role="status">Loading events…</p>';
    try {
      const {records}=await api('records&kind=calendar');
      if(!isCurrent())return;
      upcoming=upcomingEvents(records,new Date());
      visible=calendarDisplayLimit('header',state.prefs.calendarDisplay);
      renderAgenda();
    } catch {
      if(isCurrent())events.innerHTML='<p role="status">Could not load calendar events.</p><button type="button" data-agenda-retry>Retry</button>';
    }
  }
  agenda.ontoggle=()=>{if(agenda.open)void loadAgenda();else request++;};
  agenda.onkeydown=event=>{
    if(event.key!=='Tab')event.stopPropagation();
    if(event.key==='Escape'&&agenda.open){
      event.preventDefault();agenda.open=false;trigger.focus();
    }
  };
  events.onclick=event=>{
    const button=(event.target as HTMLElement).closest('button');
    if(!button)return;
    if(button.hasAttribute('data-agenda-retry')){trigger.focus();void loadAgenda();return;}
    if(button.hasAttribute('data-header-agenda-more')){
      const firstNew=visible;
      visible+=calendarDisplayLimit('header',state.prefs.calendarDisplay);
      renderAgenda();
      events.querySelectorAll<HTMLButtonElement>('[data-agenda-event]')[firstNew]?.focus();
      return;
    }
    agenda.open=false;trigger.focus();
    void attempt(()=>openConnectedRecord(button.dataset.agendaEvent!));
  };
  updateTopClock();
}
function setMailFolderPanel(open: boolean,restoreFocus=false) {
  const shell=root.querySelector<HTMLElement>('.shell')!;
  const trigger=shell.querySelector<HTMLButtonElement>('#desktop-mail-folders');
  const panel=shell.querySelector<HTMLElement>('#mail-folder-navigation')!;
  const available=trigger&&!phoneLayout.matches&&shell.classList.contains('sidebar-collapsed')&&state.app==='mail';
  open=open&&!!available;
  const wasOpen=shell.classList.contains('folders-open');
  shell.classList.toggle('folders-open',open);
  trigger?.setAttribute('aria-expanded',String(open));
  if(open){
    const bounds=trigger!.getBoundingClientRect();
    panel.style.setProperty('--folder-flyout-top',`${bounds.bottom+4}px`);
    panel.style.setProperty('--folder-flyout-left',`${bounds.left}px`);
    panel.querySelector<HTMLElement>('#mail-folder')?.focus({preventScroll:true});
  }else if(available&&wasOpen&&restoreFocus){
    trigger.focus({preventScroll:true});
  }
}
function mailFolderEnv() { return {state,api,commit:leaveEditor,load,notice,modal,dialog,e,field,confirmation,attempt,withRecentSignIn,mailDeletionReload,captureSidebarFocus,closeFolderPanel:()=>{
  mobileItemOpen=false;
  if(phoneLayout.matches)showMobileMenu(false,true);
  setMailFolderPanel(false,true);
}}; }
function mailLocation(record: OfficeRecord) {
  const m=record.meta, account=state.accounts.find(a=>a.id===m.account);
  if(!m.remote || ['Recovery copies','Not in Inbox'].includes(m.folder||''))return m.folder||'';
  if(account?.type==='google')return [m.folder,...(account.folders||[]).filter(f=>!f.protected&&(m.labelIds||[]).includes(f.id)).map(f=>f.name)].filter(isPresent).join(' · ');
  return m.folder==='Custom folder'?(account?.folders?.find(f=>f.id===m.serverFolder)?.name||m.serverFolder||m.folder):m.folder;
}
function searchableText(record: OfficeRecord) {
  if(record.kind==='lists')return [record.title,...(record.meta.checklist??[]).map(item=>item.text)].join(' ').toLocaleLowerCase();
  const {rawBase64,raw,headersBase64,...meta}=record.meta;
  return (record.title+' '+record.body+' '+JSON.stringify(meta)).toLocaleLowerCase();
}
function inMailView(record: OfficeRecord) {
  if(isPendingSend(record.id))return false;
  const folder=record.meta.folder||'Archive';
  if(state.mailScope)return matchesMailScope(record,state.mailScope,state.accounts);
  if(state.mailFolder==='all')return !['Recovery copies','Not in Inbox','Trash','Junk'].includes(folder);
  if(state.mailFolder==='Recovery copies')return ['Recovery copies','Not in Inbox'].includes(folder);
  if(state.mailFolder==='Suspected Junk')return folder==='Inbox'&&!!record.meta.junkReason&&!record.meta.junkReviewed;
  if(state.mailFolder==='Local Junk')return folder==='Junk'&&!record.meta.remote;
  return folder===state.mailFolder;
}
function matchingRows() { const q=(state.app==='calendar'?state.search.trim():state.search).toLocaleLowerCase(); return state.rows.filter(r=>!swipeHidesRow(r.id)&&(state.app!=='calendar'||q||calendar.isVisible(r))&&(state.app!=='mail'||inMailView(r))&&(!q||searchableText(r).includes(q))); }
function filteredRows() {const rows=matchingRows();return state.app==='mail'?mailView(rows,state.prefs.mailView).rows:state.app==='tasks'?taskView(rows,state.prefs.taskView).rows:rows;}
function navigableRows() {return state.app==='mail'?mailView(matchingRows(),state.prefs.mailView).visible:state.app==='tasks'?taskView(matchingRows(),state.prefs.taskView).visible:filteredRows();}
async function deleteMailImmediately(rows: OfficeRecord[],operation: Parameters<DeleteMail>[1],undoable=false) {
  const inMail=state.app==='mail'&&!appEntryVisible();
  const pane=activePane();
  const ids=new Set(rows.map(r=>r.id)),visible=inMail?navigableRows().map(r=>r.id):[],currentId=inMail?state.current?.id:undefined;
  const context=JSON.stringify([state.mailFolder,state.mailScope,state.search]);
  const completingDraft=rows.some(r=>r.id===currentId&&r.meta.folder==='Drafts');
  let gesture: MailDeleteGesture | undefined;
  if(undoable){
    if(undoingMailDelete)throw Error('Wait for deletion undo to finish.');
    let finish!: () => void;const done=new Promise<void>(resolve=>{finish=resolve;});
    gesture={receipts:[],done,finish,currentId,context};lastMailDelete=gesture;
  }
  for(const id of ids){pendingMailDeletes.add(id);failedMailActions.delete(id);}
  mailDeleteVersion++;
  const index=visible.indexOf(currentId!);
  if(inMail){
    state.rows=state.rows.filter(r=>!ids.has(r.id));state.selected.clear();itemMenus.close();
    const advance=ids.has(currentId!);
    if(advance){
      const next=[...visible.slice(index+1),...visible.slice(0,index).reverse()].find(id=>!ids.has(id));
      state.current=state.rows.find(r=>r.id===next)||null;
    }
    renderList();if(advance)renderDetail();
    restorePane(pane);
    document.querySelector<HTMLElement>('#selected-item')?.scrollIntoView({block:'nearest'});
  }
  const nextId=state.current?.id;
  if(gesture)gesture.nextId=state.current?.id;
  let count=0;
  const reconciled=new Set<string>();
  const refresh=()=>{
    if(state.app!=='mail'||appEntryVisible())return;
    const focused=(document.activeElement as HTMLElement)?.closest<HTMLElement>('#items [data-id]')?.dataset.id!;
    renderList();
    if(focused)document.querySelector<HTMLElement>(`#items [data-id="${CSS.escape(focused)}"]`)!?.focus({preventScroll:true});
  };
  try{
    for(const row of rows){
      if(reconciled.has(row.id)){count++;pendingMailDeletes.delete(row.id);continue;}
      const result=await operation(row);count++;pendingMailDeletes.delete(row.id);mailDeleteVersion++;
      if(gesture&&result.undoToken)gesture.receipts.push({token:result.undoToken,account:row.meta.account,id:row.id,postId:result.record?.id});
      for(const id of result?.removedIds||[])reconciled.add(id);
      if(state.app==='mail'&&!appEntryVisible()&&result?.removedIds?.length){
        state.rows=state.rows.filter(r=>!reconciled.has(r.id));
        for(const id of reconciled)state.selected.delete(id);
        if(reconciled.has(state.current?.id!)){
          const visibleIds=new Set(navigableRows().map(r=>r.id));
          const next=[...visible.slice(index+1),...visible.slice(0,index).reverse()].find(id=>!ids.has(id)&&!reconciled.has(id)&&visibleIds.has(id));
          state.current=state.rows.find(r=>r.id===next)||null;renderList();renderDetail();
          restorePane(pane);
        }
      }
      // Keep confirmed moves available when switching folders.
      if(state.app==='mail'&&row.meta.remote&&result?.record){state.rows=state.rows.filter(r=>r.id!==row.id&&r.id!==result.record!.id);state.rows.push(result.record);state.rows.sort(compareMail);}
    }
    if(completingDraft&&state.app==='mail'&&!appEntryVisible()&&state.current?.id===nextId&&context===JSON.stringify([state.mailFolder,state.mailScope,state.search]))returnFromMailDraft(currentId!);
    for(const row of rows)mailDraftOrigins.delete(row.id);
  }catch(cause) { const error=asError(cause);
    const remaining=rows.slice(count);
    for(const row of remaining){pendingMailDeletes.delete(row.id);failedMailActions.set(row.id,error.message);}
    mailDeleteVersion++;
    if(state.app==='mail'&&!appEntryVisible()){
      for(const row of remaining)if(!state.rows.some(r=>r.id===row.id))state.rows.push(structuredClone(latestMail(row.id)||row));
      state.rows.sort(compareMail);
      if(!state.current&&context===JSON.stringify([state.mailFolder,state.mailScope,state.search])){
        state.current=navigableRows()[0]||null;renderDetail();
      }
    }
    throw Error((rows.length>1?`${count} of ${rows.length} items updated. `:'')+`Mail action failed; ${remaining.length===1?'message restored':'remaining messages restored'}. ${error.message}`);
  }finally{gesture?.finish();refresh();}
}
async function undoMailDelete() {
  if(state.app!=='mail'||undoingMailDelete)return;
  const pane=activePane();
  const gesture=lastMailDelete;if(!gesture){notice('No mail deletion to undo.');return;}
  undoingMailDelete=true;
  const selectedAtUndo=state.current?.id;
  try{
    await gesture.done;
    const failures: string[]=[],restored: string[]=[];
    for(const receipt of [...gesture.receipts]){
      try{
        const result=await api('mail-undo',{token:receipt.token,account:receipt.account});
        mailDeleteVersion++;
        gesture.receipts=gesture.receipts.filter(r=>r!==receipt);restored.push(result.record.id);
        for(const [id,copy] of trashedMailCopies)if(copy.id===receipt.id||copy.id===receipt.postId||id===receipt.id)trashedMailCopies.delete(id);
      }catch(cause){failures.push(asError(cause).message);}
    }
    if(state.app==='mail'&&restored.length){
      const sameContext=gesture.context===JSON.stringify([state.mailFolder,state.mailScope,state.search])&&selectedAtUndo===gesture.nextId&&state.current?.id===selectedAtUndo;
      await load(sameContext&&restored.includes(gesture.currentId!)?gesture.currentId:undefined,{preserveSelection:true,selectFirst:false});
      if(sameContext)restorePane(pane);
    }
    if(!gesture.receipts.length&&lastMailDelete===gesture)lastMailDelete=undefined;
    if(failures.length)throw Error(`${restored.length} messages restored. ${failures.join(' ')}`);
    notice(restored.length?`${restored.length} ${restored.length===1?'message':'messages'} restored.`:'No confirmed deletions to undo.');
  }finally{undoingMailDelete=false;}
}
function mailDeletionReload() {
  const currentId=state.current?.id!, ids=navigableRows().map(r=>r.id);
  const context=()=>JSON.stringify([state.app,state.mailFolder,state.mailScope,state.search]);
  const originalContext=context(),pane=activePane();
  return async (removedIds: string[])=>{
    let advance=ids.includes(currentId)&&removedIds.includes(currentId)&&state.current?.id===currentId&&context()===originalContext;
    if(state.current?.id!==currentId)return;
    await load(undefined,{selectFirst:false});
    if(context()!==originalContext||(state.current&&state.current.id!==currentId))return;
    if(state.app==='tasks'&&ids.includes(currentId)&&!filteredRows().some(r=>r.id===currentId))advance=true;
    if(!advance){restorePane(pane);return;}
    const visible=new Set(navigableRows().map(r=>r.id)),removed=new Set(removedIds),index=ids.indexOf(currentId);
    const nextId=[...ids.slice(index+1),...ids.slice(0,index).reverse()].find(id=>!removed.has(id)&&visible.has(id));
    state.current=state.rows.find(r=>r.id===nextId)||null;
    renderList();if(state.app==='calendar'&&nextId)calendar.ensureVisible(nextId);renderDetail();
    restorePane(pane);
    document.querySelector<HTMLElement>('#selected-item')!?.scrollIntoView({block:'nearest'});
  };
}
interface MailReaderSnapshot {id: string; open: string[]; focus?: {disclosure: string; selector: string}}
interface MailListViewport {scrollTop: number; visible: {id: string; top: number}[]}
function captureMailListViewport(): MailListViewport | undefined {
  if(state.app!=='mail')return;
  const list=document.querySelector<HTMLElement>('#items');
  if(!list)return;
  const bounds=list.getBoundingClientRect();
  return {scrollTop:list.scrollTop,visible:Array.from(list.querySelectorAll<HTMLElement>('[data-id]'))
    .filter(row=>{const rect=row.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom;})
    .map(row=>({id:row.dataset.id!,top:row.getBoundingClientRect().top-bounds.top}))};
}
function restoreMailListViewport(snapshot: MailListViewport | undefined) {
  if(!snapshot)return;
  const list=document.querySelector<HTMLElement>('#items');
  if(!list)return;
  if(snapshot.scrollTop===0){list.scrollTop=0;return;}
  const anchor=snapshot.visible.find(row=>list.querySelector(`[data-id="${CSS.escape(row.id)}"]`));
  if(anchor){
    const row=list.querySelector<HTMLElement>(`[data-id="${CSS.escape(anchor.id)}"]`)!;
    list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-anchor.top;
  }else list.scrollTop=snapshot.scrollTop;
}
function captureMailReader(): MailReaderSnapshot | undefined {
  const panel=document.querySelector<HTMLElement>('#detail');
  if(state.app!=='mail'||!displayedMailId||!panel?.classList.contains('mail-reader'))return;
  const snapshot: MailReaderSnapshot={id:displayedMailId,open:Array.from(panel.querySelectorAll<HTMLDetailsElement>('[data-mail-disclosure][open]'),d=>d.dataset.mailDisclosure!)};
  const focused=document.activeElement as HTMLElement,disclosure=focused?.closest<HTMLElement>('[data-mail-disclosure]');
  if(disclosure&&panel.contains(disclosure)){
    const attribute=Array.from(focused.attributes).find(a=>a.name.startsWith('data-'));
    const selector=focused.matches('summary')?'summary':attribute?`[${attribute.name}="${CSS.escape(attribute.value)}"]`:'';
    if(selector)snapshot.focus={disclosure:disclosure.dataset.mailDisclosure!,selector};
  }
  return snapshot;
}
async function load(preferId?: string,{selectFirst=true,preserveSelection=false,enteringApp=false,revealMail=false,revealTask=false,keepSidebar=false,entryVersion,navigation}: {selectFirst?: boolean;preserveSelection?: boolean;enteringApp?: boolean;revealMail?: boolean;revealTask?: boolean;keepSidebar?: boolean;entryVersion?: number;navigation?: NavigationView}={},initialRecords?: RecordList) {
  clearTimeout(mailQueryTimer);
  const requestVersion=++listLoadVersion,queryContext=mailQueryContext();
  const versionAtStart=appEntryVersion;
  renderSendStatus();
  await waitForAttachments();
  if(versionAtStart!==appEntryVersion||(appEntryVisible()&&entryVersion!==appEntryVersion))return;
  // A background refresh must never replace an in-memory draft.
  if(isUnsavedDraft() || (preserveSelection && state.dirty))return;
  if(state.app!=='mail')displayedMailId=null;
  itemMenus.close();
  if(!preserveSelection){selectionAnchor=null;keyboardSelection=false;state.selected.clear();}
  const selectionContext=JSON.stringify([state.app,state.mailFolder,state.mailScope,state.search]);
  document.querySelectorAll<HTMLElement>('[data-app]').forEach(b=>{ const active=b.dataset.app===state.app; b.classList.toggle('active',active); if (active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  document.querySelector<HTMLElement>('#crumb')!.textContent=apps[state.app]?.name||'Settings';
  document.querySelector<HTMLElement>('.shell')!.classList.toggle('mail-active',state.app==='mail');
  panelSizing.refresh();
  document.querySelector<HTMLElement>('#mail-toolbar')!.hidden=state.app!=='mail';
  document.querySelector<HTMLElement>('#mail-folder-navigation')!.hidden=state.app!=='mail';
  document.querySelector<HTMLElement>('#mobile-folder-control')!.hidden=state.app!=='mail';
  if(state.app!=='mail')setMailFolderPanel(false);
  if(entryVersion!==undefined&&!initialRecords&&!document.hidden){
    // Let the loading screen paint before a fast response triggers rendering.
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    if(entryVersion!==appEntryVersion)return;
  }
  if (state.app==='settings') {
    state.current=null;renderSettings(entryVersion);
    if(enteringApp&&(!keepSidebar||!document.activeElement?.closest('.sidebar')))focusList();
    return;
  }
  // Retry snapshots taken across a deletion, rollback or read update.
  const app=state.app;let result: RecordList,version;
  const route=recordsRoute(!!preferId&&!initialRecords&&!navigation);
  do{version=mailDeleteVersion+mailReadVersion;result=initialRecords??await api(route);initialRecords=undefined;if(state.app!==app||versionAtStart!==appEntryVersion||requestVersion!==listLoadVersion||(app==='mail'&&queryContext!==mailQueryContext()))return;}while(app==='mail'&&version!==mailDeleteVersion+mailReadVersion);
  if(isUnsavedDraft() || (preserveSelection && state.dirty))return;
  if(preserveSelection&&selectionContext!==JSON.stringify([state.app,state.mailFolder,state.mailScope,state.search]))return;
  const contentFocused=preserveSelection&&activePane()==='content'&&!editable(document.activeElement as HTMLElement);
  const listViewport=preserveSelection?captureMailListViewport():undefined;
  const readerSnapshot=preserveSelection?captureMailReader():undefined;
  const focusedId=preserveSelection?(document.activeElement as HTMLElement)?.closest<HTMLElement>('#items [data-id]')?.dataset.id:undefined;
  mailPage=app==='mail'&&result.mailPage?{...result.mailPage,context:queryContext}:undefined;
  state.rows=result.records.filter(r=>!pendingMailDeletes.has(r.id));
  if (state.app==='mail') state.rows.sort(compareMail);
  if (state.app==='calendar') state.rows.sort((a,b)=>(a.meta.start||'').localeCompare(b.meta.start||''));
  const previousId=state.current?.id;
  state.current=state.rows.find(r=>r.id===(preferId||previousId))||null;
  if(state.app==='wiki') {
    if(navigation)state.wikiEditing=navigation.wikiEditing;
    else if(enteringApp||state.current?.id!==previousId)state.wikiEditing=false;
  }
  if(state.app==='mail'&&revealMail&&state.current){
    // Use the freshly loaded location: a connection's earlier record can move during navigation.
    const record=state.current;
    mailListLimit=100;
    state.mailScope=null;
    state.mailFolder=record.meta.folder==='Not in Inbox'?'Recovery copies':record.meta.folder==='Custom folder'?'all':record.meta.folder||'Archive';
    if(record.meta.folder==='Custom folder'&&record.meta.remote&&record.meta.account){
      const account=state.accounts.find(a=>a.id===record.meta.account);
      const folder=account?.type==='google'?account.folders?.find(f=>!f.protected&&record.meta.labelIds?.includes(f.id))?.id:record.meta.serverFolder;
      const scope={account:record.meta.account,folder:folder||'',limit:100};
      if(folder&&matchesMailScope(record,scope,state.accounts))state.mailScope=scope;
    }
    const prefs=revealMailGroup(record,state.prefs.mailView);
    if(JSON.stringify(prefs.collapsed)!==JSON.stringify(mailViewPreferences(state.prefs.mailView).collapsed)){
      state.prefs={...state.prefs,mailView:prefs};
      mailViewSave=mailViewSave.catch(()=>{}).then(()=>api('preferences',{preferences:state.prefs}));
      void attempt(()=>mailViewSave);
    }
  }
  if(state.app==='mail'){
    const editingDraft=state.current&&!state.current!.meta.remote&&state.current!.meta.folder==='Drafts';
    if(state.mailScope&&state.current&&!editingDraft&&!matchesMailScope(state.current,state.mailScope,state.accounts))state.current=null;
    if(!state.current&&selectFirst)state.current=navigableRows()[0]||null;
  }
  if(enteringApp&&app!=='calendar'){
    const rows=navigableRows();
    state.current=rows.find(r=>r.id===(preferId||lastSelectedItems.get(app)))||rows[0]||null;
  }
  if(state.app==='tasks'&&(!state.current||(!revealTask&&!filteredRows().some(r=>r.id===state.current?.id))))state.current=selectFirst?navigableRows()[0]||null:null;
  if(preserveSelection){
    const rows=filteredRows(),visible=new Set(rows.map(r=>r.id));
    for(const id of state.selected)if(!visible.has(id))state.selected.delete(id);
    if(selectionAnchor&&!visible.has(selectionAnchor))selectionAnchor=null;
    if(listViewport?.scrollTop){
      const bottommostSurvivor=[...listViewport.visible].reverse().find(row=>visible.has(row.id));
      // Keep a viewport of rows after the anchor so the restored offset does not clamp at the paging cutoff.
      if(bottommostSurvivor)mailListLimit=Math.max(mailListLimit,navigableRows().findIndex(row=>row.id===bottommostSurvivor.id)+1+listViewport.visible.length);
    }
  }
  const reuseWorkspace=preserveSelection&&state.app==='mail'&&!!readerSnapshot&&!!document.querySelector('#detail.mail-reader');
  const restoreSidebar=captureSidebarFocus();
  if(reuseWorkspace){document.querySelector('#mail-folder-navigation .account-folders')?.remove();renderMailFolders(mailFolderEnv());renderList();renderDetail(readerSnapshot);}else renderWorkspace(navigation?.mailReader??readerSnapshot,!!navigation);
  if(enteringApp&&app==='calendar'&&!state.current)calendar.showAgendaDate();
  restoreSidebar();
  if(focusedId)document.querySelector<HTMLElement>(`#items [data-id="${CSS.escape(focusedId)}"]`)?.focus({preventScroll:true});
  restoreMailListViewport(listViewport);
  if(contentFocused&&!document.activeElement?.closest('#detail'))restorePane('content');
  if(enteringApp){setMode('normal');if(!keepSidebar||!document.activeElement?.closest('.sidebar'))focusList();document.querySelector<HTMLElement>('#selected-item')?.scrollIntoView({block:'nearest'});}
}
function renderAppHeader() {
  const toolbar=document.querySelector<HTMLElement>('#app-toolbar')!;
  const a=apps[state.app];
  toolbar.hidden=state.app==='mail'||state.app==='settings';
  toolbar.innerHTML=toolbar.hidden?'':`${state.app==='calendar'?`<input id="search" type="search" aria-label="Search calendar" placeholder="Search calendar events" value="${e(state.search)}">`:''}<div class="header-action-group">${headerAction('new','New '+a.singular)}${headerAction('import','Import')}${headerAction('export-all','Export')}</div>`;
}
let fullScreenItemId: string | undefined;
let mobileItemOpen=false;
let mobileListPosition: {context: string; top: number; id?: string} | undefined;
const mobileListContext=()=>JSON.stringify([state.app,state.mailFolder,state.mailScope?.account,state.mailScope?.folder,state.search]);
const mobileListScroller=()=>document.querySelector<HTMLElement>(state.app==='calendar'?'#calendar-surface':'#items');
const mobileItemControls=`<div class="mobile-item-controls"><button type="button" class="mobile-back mobile-icon-button" data-action="mobile-back" aria-label="Back to list" title="Back to list">${mobileIcon('back')}</button><button type="button" data-action="help">Help</button></div>`;

const navigationScrollers=['#main','#calendar-surface','#items','.calendar-time-scroll','#detail','.sheet-wrap'] as const;
interface NavigationView {
  app: AppName;
  itemId?: string;
  pane: 'content'|'list';
  search: string;
  mailFolder: string;
  mailScope: MailScope|null;
  mailLimit: number;
  mailViewport?: MailListViewport;
  mailReader?: MailReaderSnapshot;
  settingsPage: string;
  calendar?: ReturnType<typeof calendar.position>;
  mobileItemOpen: boolean;
  mobileListPosition: typeof mobileListPosition;
  mobileBackId?: number;
  fullScreen: boolean;
  wikiEditing: boolean;
  sheet: number;
  cell: string;
  scroll: {top:number;left:number}[];
}
const navigationHistory: {id:number;view:NavigationView;returnToOrigin:boolean}[]=[];
let navigationId=0;
let mobileBackId: number|undefined;
let navigatingBack=false;

function rememberNavigation(returnToOrigin=false) {
  if(appEntryVisible())return;
  const view: NavigationView={
    app:state.app,itemId:state.current?.id,pane:activePane(),search:state.search,
    mailFolder:state.mailFolder,mailScope:state.mailScope,mailLimit:mailListLimit,
    mailViewport:captureMailListViewport(),mailReader:captureMailReader(),
    settingsPage,calendar:state.app==='calendar'?calendar.position():undefined,
    mobileItemOpen:phoneLayout.matches?mobileItemOpen:activePane()==='content',
    mobileListPosition,mobileBackId,fullScreen:!!fullScreenItemId,
    wikiEditing:state.wikiEditing,sheet:state.sheet,cell:state.cell,
    scroll:navigationScrollers.map(selector=>{
      const node=document.querySelector(selector);
      return {top:node?.scrollTop??0,left:node?.scrollLeft??0};
    }),
  };
  const id=++navigationId;
  navigationHistory.push({id,view,returnToOrigin});
  if(navigationHistory.length>50)navigationHistory.shift();
  return id;
}

async function navigateBack() {
  const entry=navigationHistory.at(-1);
  if(!entry||navigatingBack)return;
  navigatingBack=true;
  const version=appEntryVersion;
  try {
    await waitForAttachments();await leaveEditor();
    if(version!==appEntryVersion||entry!==navigationHistory.at(-1))return;
    navigationHistory.pop();
    const view=entry.view;
    rememberSelection();
    showMobileMenu(false);
    setDisclosure(document.querySelector('#mobile-header-more'),false);
    state.app=view.app;state.current=null;state.search=view.search;
    state.mailFolder=view.mailFolder;state.mailScope=view.mailScope;mailListLimit=view.mailLimit;
    state.sheet=view.sheet;state.cell=view.cell;
    mobileItemOpen=view.mobileItemOpen;mobileListPosition=view.mobileListPosition;mobileBackId=view.mobileBackId;
    if(view.calendar)calendar.restorePosition(view.calendar);
    if(view.app==='settings')selectSettingsPage(view.settingsPage);
    setMode('normal');location.hash=view.app;
    await showAppEntry(view.app,async entryVersion=>{
      await load(view.itemId,{selectFirst:false,revealTask:true,entryVersion,navigation:view});
      if(entryVersion!==appEntryVersion)return;
      if(view.fullScreen&&!phoneLayout.matches)setItemFullScreen(true);
      restorePane(state.current?view.pane:'list');
      navigationScrollers.forEach((selector,index)=>{
        const node=document.querySelector(selector);
        if(node)node.scrollTo(view.scroll[index]);
      });
      if(!phoneLayout.matches||!mobileItemOpen)restoreMailListViewport(view.mailViewport);
    });
  } finally {navigatingBack=false;}
}

function backFromMobileItem() {
  const entry=navigationHistory.at(-1);
  return entry?.returnToOrigin&&entry.id===mobileBackId?navigateBack():returnToItemList();
}

function showMobileMenu(open: boolean, restoreFocus=false) {
  const trigger=document.querySelector<HTMLElement>('#mobile-menu');
  const wasOpen=trigger?.getAttribute('aria-expanded')==='true';
  setDisclosure(trigger,open);
  if(open)focusSidebar();
  else if(wasOpen&&restoreFocus)trigger?.focus({preventScroll:true});
}

function openMobileItem(id?: string) {
  if(!mobileItemOpen){
    mobileBackId=undefined;
    const list=mobileListScroller();
    if(list)mobileListPosition={context:mobileListContext(),top:list.scrollTop,id};
  }
  mobileItemOpen=true;
}

function applyMobilePane() {
  if(!state.current)mobileItemOpen=false;
  document.querySelector('.shell')?.classList.toggle('mobile-item-open',mobileItemOpen);
  const back=document.querySelector<HTMLElement>('.mobile-back');
  const entry=navigationHistory.at(-1);
  const label=entry?.returnToOrigin&&entry.id===mobileBackId?'Back':'Back to list';
  back?.setAttribute('aria-label',label);
  if(back)back.title=label;
}

async function returnToItemList() {
  await waitForAttachments();
  const calendarEventId=state.app==='calendar'?state.current?.id:undefined;
  await leaveEditor();
  const entry=navigationHistory.at(-1);
  if(entry&&entry.id===mobileBackId&&!entry.returnToOrigin)navigationHistory.pop();
  mobileBackId=undefined;
  mobileItemOpen=false;
  if(state.app==='calendar')state.current=null;
  setItemFullScreen(false);
  renderDetail();
  if(state.app==='calendar'){
    const timeGrid=document.querySelector('.calendar-time-scroll');
    const left=timeGrid?.scrollLeft??0,top=timeGrid?.scrollTop??0;
    renderList();
    document.querySelector('.calendar-time-scroll')?.scrollTo(left,top);
  }
  setMode('normal');
  lastPane='list';
  const position=mobileListPosition;
  mobileListPosition=undefined;
  const list=mobileListScroller();
  const sameList=position?.context===mobileListContext();
  if(sameList&&list)list.scrollTop=position.top;
  const rowId=calendarEventId??(sameList?position.id:undefined);
  const row=rowId&&list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(rowId)}"]`);
  if(row){row.focus({preventScroll:true});return;}
  focusList();
}

phoneLayout.addEventListener('change',()=>{
  const panel=document.querySelector<HTMLElement>('#detail');
  if(!panel)return;
  showMobileMenu(false);
  setMailFolderPanel(false);
  if(phoneLayout.matches){
    if(fullScreenItemId||isUnsavedDraft()||state.dirty||document.activeElement?.closest('#detail'))openMobileItem();
    const toggleFocused=document.activeElement?.matches('[data-action="item-fullscreen"]');
    setItemFullScreen(false);
    if(toggleFocused&&mobileItemOpen)document.querySelector<HTMLElement>('.mobile-back')?.focus({preventScroll:true});
  }
  applyMobilePane();
  // An active editor stays mounted when rotating or resizing.
  if(state.app==='calendar'&&!state.dirty)calendar.render();
  if(!state.dirty&&!document.activeElement?.closest('#detail'))renderDetail();
});

// Safari can shrink only the visual viewport when the keyboard opens.
function fitMobileKeyboard() {
  const viewport=window.visualViewport;
  const editing=editable(document.activeElement);
  const keyboard=phoneLayout.matches&&viewport?.scale===1&&editing&&innerHeight-viewport.height>120;
  if(keyboard)document.documentElement.style.setProperty('--office-keyboard-height',`${Math.round(viewport.height)}px`);
  else document.documentElement.style.removeProperty('--office-keyboard-height');
}
window.visualViewport?.addEventListener('resize',fitMobileKeyboard);
phoneLayout.addEventListener('change',fitMobileKeyboard);
document.addEventListener('focusout',()=>requestAnimationFrame(fitMobileKeyboard));

function itemPane(label: string, calendar=false) {
  return `<div class="item-pane${calendar?' calendar-item-pane':''}"${calendar?' hidden':''}><div class="item-pane-actions" hidden><button type="button" data-action="item-fullscreen" aria-controls="detail">${mobileIcon('expand')}<span>Full Screen</span></button></div><section class="detail" id="detail" aria-label="${label}"></section></div>`;
}

function setItemFullScreen(expanded: boolean) {
  fullScreenItemId=expanded?state.current?.id:undefined;
  const pane=document.querySelector<HTMLElement>('.item-pane');
  const workspace=pane?.parentElement;
  const active=!!fullScreenItemId;
  if(!workspace||workspace.classList.contains('item-fullscreen')===active)return;
  workspace.classList.toggle('item-fullscreen',active);
  pane.querySelector('[data-action="item-fullscreen"]')!.innerHTML=`${mobileIcon(active?'collapse':'expand')}<span>${active?'Exit Full Screen':'Full Screen'}</span>`;
}

function toggleItemFullScreen() {
  if(!state.current||phoneLayout.matches)return;
  const expanded=!fullScreenItemId;
  const focused=document.activeElement;
  setItemFullScreen(expanded);
  if(focused===document.body||(expanded&&!focused?.closest('.item-pane'))){
    document.querySelector<HTMLElement>('[data-action="item-fullscreen"]')?.focus({preventScroll:true});
  }
  if(!editable(document.activeElement))setMode('normal');
}

function renderWorkspace(readerSnapshot?: MailReaderSnapshot,restoringNavigation=false) {
  renderAppHeader();
  const previousFolderActions=captureFolderActions();
  const restoreFolderButton=document.activeElement?.id==='desktop-mail-folders';
  const a=apps[state.app];
  if(state.app==='calendar'){
    document.querySelector<HTMLElement>('#main')!.innerHTML=`<div class="calendar-workspace">${mobileItemControls}<section id="calendar-surface"></section>${itemPane('Selected event',true)}</div>`;
    document.querySelector<HTMLInputElement>('#search')!.oninput=event=>{state.search=(event.target as HTMLInputElement).value;renderList();};
    calendar.render();
    if(!restoringNavigation&&state.current&&(!phoneLayout.matches||mobileItemOpen))calendar.ensureVisible(state.current.id);
    renderDetail();return;
  }
  const folderButtons=state.app==='mail'? `<button type="button" class="mobile-only mobile-icon-button" data-action="mobile-folders" aria-label="Folders" title="Folders">${mobileIcon('folder')}</button>
    <button type="button" id="desktop-mail-folders" data-action="toggle-mail-folders" aria-label="Folders" title="Folders" aria-controls="mail-folder-navigation" aria-expanded="${!!root.querySelector('.folders-open')}">${mobileIcon('folder')}</button>`:'';
  document.querySelector<HTMLElement>('#main')!.innerHTML=`<div class="work-grid">${mobileItemControls}<section id="item-list-pane" class="list-pane" aria-label="${a.name} list"><div class="search-wrap">${folderButtons}<label><span class="file-input">Search ${a.name}</span><input id="search" type="search" value="${e(state.search)}" placeholder="Search ${a.name.toLowerCase()}…   /" autocomplete="off"></label></div><div class="list-summary"><span id="list-count"></span><span id="selection-count"></span></div><div class="items" id="items" role="region" aria-label="Items"></div><div class="bottom-hint"><span><kbd>j</kbd> <kbd>k</kbd> navigate</span><span><kbd>i</kbd> edit</span><span><kbd>?</kbd> help</span></div>${panelSplitter('list')}</section>${itemPane('Selected '+a.singular)}</div>`;
  panelSizing.bindList(document.querySelector<HTMLElement>('[data-resize-panel="list"]')!);
  document.querySelector<HTMLInputElement>('#search')!.oninput=event=>{state.search=(event.target as HTMLInputElement).value;mailListLimit=100;renderList();};
  if(state.app==='tasks')bindTaskViewControls();
  if(state.app==='mail'){
    bindMailViewControls();
    const folderNavigation=document.querySelector<HTMLElement>('#mail-folder-navigation')!;
    folderNavigation.innerHTML='<div class="mail-folder-panel-head"><strong>Mail folders</strong><button data-action="close-mail-folders" aria-label="Close mail folders">✕</button></div>';
    folderNavigation.insertAdjacentHTML('beforeend',`<select id="mail-folder" aria-label="Mail folder"><option value="all">All cached mail</option>${['Inbox','Drafts','Sent','Archive','Junk','Local Junk','Suspected Junk','Trash','Local mail','Recovery copies','Sending','Delivery uncertain'].map(folder=>`<option ${state.mailFolder===folder?'selected':''}>${folder}</option>`).join('')}</select>`);
    document.querySelector<HTMLSelectElement>('#mail-folder')!.onchange=event=>void attempt(async()=>{
      const select=(event.target as HTMLSelectElement), folder=select.value, restoreSidebar=captureSidebarFocus(); select.disabled=true;
      try {
        await leaveEditor();
        mobileItemOpen=false;
        state.mailFolder=folder; state.mailScope=null;mailListLimit=100; state.current=navigableRows()[0]||null; state.selected.clear(); selectionAnchor=null;keyboardSelection=false;setMode('normal');
        if(state.current?.meta.folder==='Drafts')mailDraftOrigins.set(state.current.id,mailDraftOrigin(false));
        await load();
        if(phoneLayout.matches)showMobileMenu(false,true);
        setMailFolderPanel(false,true);
      } finally { select.value=state.mailFolder; select.disabled=false; restoreSidebar(); }
    });
    if(state.mailScope){const select=document.querySelector<HTMLSelectElement>('#mail-folder')!;select.insertAdjacentHTML('afterbegin','<option value="account-folder">Selected account folder</option>');select.value='account-folder';}
    renderMailFolders(mailFolderEnv(),previousFolderActions);
  }
  renderList(); renderDetail(readerSnapshot);
  if(restoreFolderButton)document.getElementById('desktop-mail-folders')?.focus({preventScroll:true});
}
let mailListLimit=100;
let mailViewSave: Promise<unknown>=Promise.resolve();
function setMailView(value: unknown) {
  state.prefs={...state.prefs,mailView:mailViewPreferences(value)};mailListLimit=100;renderList();
  // Serialize rapid menu/header changes so an older request cannot overwrite the latest view.
  mailViewSave=mailViewSave.catch(()=>{}).then(()=>api('preferences',{preferences:state.prefs}));
  void attempt(()=>mailViewSave);
}
function bindMailViewControls() {
  const prefs=mailViewPreferences(state.prefs.mailView);
  const options=(values: Record<string,string>,selected: string)=>Object.entries(values).map(([key,label])=>`<option value="${key}" ${key===selected?'selected':''}>${label}</option>`).join('');
  document.querySelector('.list-summary')!.insertAdjacentHTML('beforeend',`<details id="mail-list-view"><summary class="mobile-icon-button" aria-label="List view" title="List view">${mobileIcon('listView')}<span class="mobile-icon-label">List view</span></summary><div class="mail-view-menu"><label>Group by<select aria-label="Group mail by" data-mail-group>${options({date:'Date',sender:'Sender',none:'None'},prefs.group)}</select></label><label>Sort by<select aria-label="Sort mail by" data-mail-sort>${options({'date-desc':'Date · newest first','date-asc':'Date · oldest first','sender-asc':'Sender · A–Z','sender-desc':'Sender · Z–A','subject-asc':'Subject · A–Z','subject-desc':'Subject · Z–A'},prefs.sort)}</select></label><div><button type="button" data-mail-expand>Expand all</button><button type="button" data-mail-collapse>Collapse all</button></div></div></details>`);
  const menu=document.querySelector<HTMLDetailsElement>('#mail-list-view')!;
  menu.querySelector<HTMLSelectElement>('[data-mail-group]')!.onchange=event=>setMailView({...mailViewPreferences(state.prefs.mailView),group:(event.target as HTMLSelectElement).value});
  menu.querySelector<HTMLSelectElement>('[data-mail-sort]')!.onchange=event=>setMailView({...mailViewPreferences(state.prefs.mailView),sort:(event.target as HTMLSelectElement).value});
  menu.querySelector<HTMLButtonElement>('[data-mail-expand]')!.onclick=()=>{const p=mailViewPreferences(state.prefs.mailView);setMailView({...p,collapsed:p.collapsed.filter(key=>!key.startsWith(p.group+':'))});};
  menu.querySelector<HTMLButtonElement>('[data-mail-collapse]')!.onclick=()=>{const p=mailViewPreferences(state.prefs.mailView);if(p.group!=='none')setMailView({...p,collapsed:[...p.collapsed.filter(key=>!key.startsWith(p.group+':')),p.group+':*']});};
  menu.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();menu.open=false;menu.querySelector('summary')!.focus();}});
  document.addEventListener('pointerdown',event=>{if(menu.isConnected&&!menu.contains(event.target as Node))menu.open=false;},{signal:mailViewControlSignal()});
}
let mailViewControlAbort: AbortController | undefined;
function mailViewControlSignal() {mailViewControlAbort?.abort();mailViewControlAbort=new AbortController();return mailViewControlAbort.signal;}
function setTaskView(value: unknown) {
  void attempt(async()=>{
    await leaveEditor();
    state.prefs={...state.prefs,taskView:taskViewPreferences(value)};
    const rows=navigableRows(),ids=new Set(rows.map(r=>r.id));
    for(const id of state.selected)if(!ids.has(id))state.selected.delete(id);
    selectionAnchor=null;
    if(state.current&&!ids.has(state.current.id)){state.current=rows[0]||null;renderDetail();}
    renderList();
    mailViewSave=mailViewSave.catch(()=>{}).then(()=>api('preferences',{preferences:state.prefs}));
    await mailViewSave;
  });
}
function bindTaskViewControls() {
  const p=taskViewPreferences(state.prefs.taskView);
  const options=(values: Record<string,string>,selected: string)=>Object.entries(values).map(([key,label])=>`<option value="${e(key)}" ${key===selected?'selected':''}>${e(label)}</option>`).join('');
  const priorities: Record<string,string>={all:'All priorities',High:'High',Normal:'Normal',Low:'Low'};
  for(const row of state.rows)priorities[taskPriority(row)]=taskPriority(row);
  if(!(p.priority in priorities))priorities[p.priority]=p.priority;
  document.querySelector('.list-summary')!.insertAdjacentHTML('beforeend',`<details id="task-list-view"><summary class="mobile-icon-button" aria-label="List view" title="List view">${mobileIcon('listView')}<span class="mobile-icon-label">List view</span></summary><div class="mail-view-menu task-view-menu">${[
    ['status','Show tasks',{unfinished:'Unfinished',completed:'Completed',all:'All tasks'},p.status],
    ['priority','Filter task priority',priorities,p.priority],
    ['due','Filter task due date',{all:'Any due date',overdue:'Overdue',today:'Due today',upcoming:'Upcoming',undated:'No due date'},p.due],
    ['group','Group tasks by',{none:'None',due:'Due date',status:'Status',priority:'Priority'},p.group],
    ['sort','Sort tasks by',{'due-asc':'Due date · earliest first','due-desc':'Due date · latest first','priority-desc':'Priority · high first','priority-asc':'Priority · low first','title-asc':'Title · A–Z','title-desc':'Title · Z–A','updated-desc':'Updated · newest first','updated-asc':'Updated · oldest first'},p.sort],
  ].map(([key,label,values,selected])=>`<label>${label}<select data-task-pref="${key}" aria-label="${label}">${options(values as Record<string,string>,selected as string)}</select></label>`).join('')}<div><button type="button" data-task-expand>Expand all</button><button type="button" data-task-collapse>Collapse all</button></div></div></details>`);
  const menu=document.querySelector<HTMLDetailsElement>('#task-list-view')!;
  menu.querySelectorAll<HTMLSelectElement>('[data-task-pref]').forEach(select=>select.onchange=()=>{
    menu.open=false;
    menu.querySelector('summary')!.focus();
    setTaskView({...taskViewPreferences(state.prefs.taskView),[select.dataset.taskPref!]:select.value});
  });
  menu.querySelector<HTMLButtonElement>('[data-task-expand]')!.onclick=()=>{const p=taskViewPreferences(state.prefs.taskView);setTaskView({...p,collapsed:p.collapsed.filter(k=>!k.startsWith(p.group+':'))});};
  menu.querySelector<HTMLButtonElement>('[data-task-collapse]')!.onclick=()=>{const p=taskViewPreferences(state.prefs.taskView);if(p.group!=='none')setTaskView({...p,collapsed:[...p.collapsed.filter(k=>!k.startsWith(p.group+':')),p.group+':*']});};
  menu.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();menu.open=false;menu.querySelector('summary')!.focus();}});
  document.addEventListener('pointerdown',event=>{if(menu.isConnected&&!menu.contains(event.target as Node))menu.open=false;},{signal:mailViewControlSignal()});
}
function taskBadges(row: OfficeRecord) {
  const priority=taskPriority(row),due=taskDue(row),level=priority.toLowerCase();
  return `<span class="task-badges"><span class="badge task-status">${row.meta.done?'✓ Completed':'○ Unfinished'}</span><span class="badge task-priority ${['high','normal','low'].includes(level)?'task-priority-'+level:''}">${level==='high'?'↑':level==='low'?'↓':'•'} ${e(priority)}</span>${!row.meta.done&&['overdue','today'].includes(due)?`<span class="badge task-due-${due}">${due==='overdue'?'! Overdue':'◷ Due today'}</span>`:''}</span>`;
}
function renderList() {
  if(state.app==='mail'&&mailPage&&mailPage.context!==mailQueryContext()){
    document.querySelector<HTMLElement>('#items')!.innerHTML='<div class="list-empty" role="status">Loading messages…</div>';
    document.querySelector<HTMLElement>('#list-count')!.textContent='Loading…';
    scheduleMailQuery();return;
  }
  if(state.app==='mail'&&(state.mailScope||state.mailFolder!=='Drafts'))lastMailView={folder:state.mailFolder,scope:structuredClone(state.mailScope),search:state.search,selectedId:state.current?.meta.folder==='Drafts'?undefined:state.current?.id};
  if(state.app==='calendar'){calendar.render();return;}
  const model=state.app==='mail'?mailView(matchingRows(),state.prefs.mailView):state.app==='tasks'?taskView(matchingRows(),state.prefs.taskView):undefined;
  const rows=model?.rows||filteredRows(),count=document.querySelector<HTMLElement>('#list-count')!;
  count.textContent=state.app==='mail'?`${mailPage?.more?rows.length+' of '+mailPage.total:rows.length} cached ${rows.length===1&&!mailPage?.more?'message':'messages'}`:`${rows.length} ${rows.length===1?apps[state.app].singular:'items'}`;
  count.title=state.app==='mail'?'Messages stored in Office for this view. This count can grow as older mail downloads.':'';
  document.querySelector<HTMLElement>('#selection-count')!.textContent=state.selected.size?`${state.selected.size} selected`:'';
  const expanded=model?.visible||rows;
  if(state.app==='mail')mailListLimit=Math.max(mailListLimit,expanded.findIndex(r=>r.id===state.current?.id)+1);
  const visible=state.app==='mail'?expanded.slice(0,mailListLimit):expanded;
  const item=(r: OfficeRecord)=>{
    const hint=state.app==='mail'?(r.meta.from||r.meta.to||r.meta.folder||'Local archive'):state.app==='calendar'?(r.meta.start?dateLabel(r.meta.start)+' · ':'')+e(r.meta.location||''):state.app==='tasks'?(r.meta.done?'Completed':r.meta.due?'Due '+dateLabel(r.meta.due):'No due date'):state.app==='contacts'?e(r.meta.email||r.meta.company||''):state.app==='wiki'?e(r.title.includes(':')?r.title.split(':').slice(0,-1).join(':'):'Root namespace'):state.app==='lists'?checklistProgress(r.meta.checklist??[]):'Edited '+dateLabel(r.updated);
    const selected=state.current?.id===r.id;
    const displayed=state.app==='mail'?swipeMailDisplay(r):r;
    const readState=state.app==='mail'?(displayed.meta.read?'read':'unread'):'';
    const readStatus=readState?`<span class="mail-read-status"><span class="file-input">${readState==='unread'?'Unread':'Read'}</span></span>`:'';
    const badges=state.app==='mail'?'':`<span>${r.meta.folder?`<span class="badge">${e(r.meta.folder)}</span>`:''}${r.meta.remote?'<span class="badge">Synced</span>':''}</span>`;
    const itemIcon=state.app==='mail'?renderMailListIcon(r,state.selected.has(r.id),icon('mail'),remoteSenderIcons):`<span class="item-icon">${state.selected.has(r.id)?'✓':icon(state.app)}</span>`;
    return `<button class="item ${state.app==='tasks'&&r.meta.done?'task-completed':''} ${readState?'mail-'+readState:''} ${selected?'selected':''} ${state.selected.has(r.id)?'multi-selected':''}" data-id="${r.id}" aria-pressed="${state.selected.has(r.id)||selected}" aria-haspopup="menu" ${selected?'id="selected-item"':''}>${readStatus}${itemIcon}${state.app==='mail'?renderMailListCopy(displayed,state.prefs.mailList,failedMailActions.get(r.id)):`<span class="item-copy"><strong>${e(r.title)}</strong><small>${hint}</small>${state.app==='tasks'?taskBadges(r):''}</span>`}${badges}</button>`;
  };
  const list=document.querySelector<HTMLElement>('#items')!,focusedGroup=(document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-mail-group-key]')?.dataset.mailGroupKey;
  const included=new Set(visible.map(row=>row.id));
  list.innerHTML=rows.length?(model&&(state.app==='tasks'?taskViewPreferences(state.prefs.taskView):mailViewPreferences(state.prefs.mailView)).group!=='none'?model.groups.map(group=>{
    const rendered=group.rows.filter(row=>included.has(row.id));
    if(!group.collapsed&&!rendered.length)return '';
    return `<button type="button" class="mail-group-header" data-mail-group-key="${e(group.key)}" aria-expanded="${!group.collapsed}"><span aria-hidden="true">${group.collapsed?'▸':'▾'}</span><span class="mail-group-label">${e(group.label)}</span><span class="mail-group-count">${group.rows.length}${state.app==='mail'&&mailPage?.more?' loaded':''}</span></button>${rendered.map(item).join('')}`;
  }).join(''):visible.map(item).join('')):`<div class="list-empty">${state.app==='tasks'?'No tasks match this view. Adjust List view filters or add a task.':state.search?'No matching items. Try a different search.':'No items yet.'}</div>`;
  if(state.app==='mail'&&remoteSenderIcons)bindMailFavicons(list);
  list.querySelectorAll<HTMLButtonElement>('[data-mail-group-key]').forEach(button=>button.onclick=()=>{
    const p=state.app==='tasks'?taskViewPreferences(state.prefs.taskView):mailViewPreferences(state.prefs.mailView),key=button.dataset.mailGroupKey!;
    const collapsed=button.getAttribute('aria-expanded')==='false',all=p.collapsed.includes(p.group+':*'),exception=p.group+':!'+key;
    const retained=p.collapsed.filter(value=>value!==key&&value!==exception);
    (state.app==='tasks'?setTaskView:setMailView)({...p,collapsed:collapsed?(all?[...retained,exception]:retained):(all?retained:[...retained,key])});
  });
  if(focusedGroup)list.querySelector<HTMLElement>(`[data-mail-group-key="${CSS.escape(focusedGroup)}"]`)?.focus({preventScroll:true});
  if(state.app==='mail'&&(visible.length<expanded.length||mailPage?.more)){const button=document.createElement('button');button.textContent='Show next 100 messages';button.onclick=()=>{mailListLimit+=100;if(mailPage?.more&&mailListLimit>expanded.length){button.disabled=true;void attempt(async()=>{try{await refreshMailQuery();}finally{button.disabled=false;}});}else renderList();};list.append(button);}
}
const bodyDownloads=new Set<string>(),bodyFailures=new Set<string>();
async function hydrateMailBody(record: OfficeRecord,manual=false) {
  if(bodyDownloads.has(record.id)||(!manual&&bodyFailures.has(record.id)))return;
  bodyDownloads.add(record.id);
  const button=document.querySelector<HTMLButtonElement>('[data-download-body]');if(button)button.disabled=true;
  const status=document.querySelector<HTMLElement>('[data-body-status]');if(status)status.textContent=' Downloading…';
  try {
    await pendingMailReads.get(record.id);
    const result=await api('mail-content',{id:record.id,account:record.meta.account,summary:true});
    refreshMailRecord(result.record);bodyFailures.delete(record.id);
    if(state.app==='mail'){updateMailListItem(record.id);if(state.current?.id===record.id)renderDetail();}
  }catch(cause){bodyFailures.add(record.id);if(state.app==='mail'&&state.current?.id===record.id){if(status)status.textContent=' '+asError(cause).message;if(button)button.disabled=false;}}
  finally{bodyDownloads.delete(record.id);}
}
let displayedMailBody: string | undefined;
function renderDetail(readerSnapshot=captureMailReader(),toolbarOnly=false) {
  applyMobilePane();
  renderSendStatus();
  const scrollingPanel=document.querySelector<HTMLElement>('#detail');
  if(scrollingPanel)keyboardScrollers.get(scrollingPanel)?.cancel();
  const panel=document.querySelector<HTMLElement>('#detail')!, r=state.current, a=apps[state.app];
  setItemFullScreen(!!r&&r.id===fullScreenItemId);
  panel.parentElement!.querySelector<HTMLElement>('.item-pane-actions')!.hidden=!r;
  if(state.app==='calendar')panel.parentElement!.hidden=!r;
  if(phoneLayout.matches&&!mobileItemOpen){
    displayedMailId=null;
    if(!toolbarOnly)panel.replaceChildren();
    return;
  }
  if(viewingPendingSend()){
    panel.classList.remove('mail-reader');
    if(!panel.querySelector('.mail-send-progress'))panel.innerHTML='<div class="empty mail-send-progress" role="status" tabindex="-1"><span class="connection-opening-spinner" aria-hidden="true"></span><h2>Sending message…</h2><p>You can keep working while Office sends this message.</p></div>';
    return;
  }
  if(state.app==='calendar'&&!r){panel.innerHTML='';return;}
  const contentFocused=!!r&&document.activeElement===contentEntry();
  if(r&&state.app==='wiki'&&!state.wikiEditing)panel.tabIndex=-1;
  const openedMail=state.app==='mail'&&r?r.id:null, newlyOpened=openedMail!==displayedMailId;
  const restore=readerSnapshot?.id===openedMail?readerSnapshot:undefined;
  displayedMailId=openedMail;
  const viewingMail=state.app==='mail'&&!!r&&r.meta.folder!=='Drafts';
  panel.classList.toggle('mail-reader',viewingMail);
  if (!r) {
    const emptyMail=state.app==='mail'&&!filteredRows().length;
    const heading=emptyMail?(state.search?'No matching messages.':'No messages in this folder.'):(state.rows.length?'Select a '+a.singular:a.empty);
    panel.innerHTML=`<div class="empty"><span class="empty-symbol">${state.app==='mail'?'↗':state.app==='wiki'?'Aa':state.app==='sheets'?'∑':'○'}</span><h2>${heading}</h2><p>${emptyMail?(state.search?'Try a different search or choose another folder.':'Choose another folder or write a new message.'):a.hint}</p><button data-action="new">${state.app==='mail'?'Write a message':'Create '+a.singular} <span aria-hidden="true">↗</span></button></div>`; return;
  }
  const fillSender=state.app==='mail' && !r.meta.remote && r.meta.folder==='Drafts' && !r.meta.sendAccount ? draftAccount(r) : '';
  if (fillSender) r.meta.sendAccount=fillSender;
  const remote=!!r.meta.remote, canEditProvider=providerCalendar(r);
  const mailBadges=state.app==='mail'?`${r.meta.folder?`<span class="badge">${e(mailLocation(r))}</span>`:''}${remote?'<span class="badge">Cached</span>':''}`:'';
  const bodyKey=viewingMail?JSON.stringify([r.id,r.body,r.bodyHash,mailBody(r,state.prefs)]):undefined;
  const retainBody=viewingMail&&!newlyOpened&&bodyKey===displayedMailBody&&!!panel.querySelector('.mail-reader-header');
  displayedMailBody=bodyKey;
  const discardDraft=isUnsavedDraft()||r.kind==='mail'&&r.meta.folder==='Drafts';
  const markup=`${viewingMail?'':`<div class="detail-toolbar"><div class="left ${state.app==='mail'?'mail-detail-heading':''}"><span class="eyebrow">${remote?(state.app==='mail'?'Cached message':canEditProvider?'Synced event':'Synced · read only'):a.singular}</span>${mailBadges}</div><div class="right"><span class="save-status" id="save-status">${remote&&!canEditProvider?'Cached copy':isUnsavedDraft()?'Unsaved draft':state.dirty?'Unsaved changes':'Saved'}</span>${!isUnsavedDraft()&&['wiki','documents'].includes(state.app)?'<button class="quiet" data-action="history">History</button>':''}${state.app==='wiki'?`<button data-action="wiki-mode">${state.wikiEditing?'View page':'Edit source'}</button>`:''}<button class="quiet" data-action="export">Export</button>${!remote||canEditProvider?`<button type="button" class="primary mobile-icon-button" data-action="save" aria-label="Save" title="Save"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 3v6h9V3 M7 21v-8h10v8"/></svg></button>`:''}${!remote?`<button class="quiet danger${discardDraft?'':' mobile-icon-button'}" data-action="delete" title="${discardDraft?'Discard Draft':'Delete selected item'}" aria-label="${discardDraft?'Discard Draft':'Delete'}">${discardDraft?'Discard Draft':mobileActionLabel('trash','Delete')}</button>`:''}</div></div><div class="print-only">${state.app==='documents'?'':`<h1>${e(r.title)}</h1>`}</div>`}${detailContent(r)}`;
  const template=document.createElement('template');template.innerHTML=markup;
  const toolbar=template.content.querySelector('.detail-toolbar .right');
  if(toolbar){
    const secondary=template.content.querySelectorAll('.detail-toolbar [data-action="history"],.detail-toolbar [data-action="export"],.detail-toolbar [data-action="delete"]');
    toolbar.insertAdjacentHTML('beforeend',mobileDisclosure('item-secondary-actions','More actions',undefined,'more')+'<div id="item-secondary-actions" class="item-secondary-actions mobile-collapsible"></div>');
    const actions=toolbar.lastElementChild!;
    secondary.forEach(button=>actions.append(button));
  }
  if(toolbarOnly){
    for(const selector of ['.detail-toolbar','.print-only'])panel.querySelector(selector)?.replaceWith(template.content.querySelector(selector)!);
    updateSaveButton();
    void connections.section();
    return;
  }
  if(retainBody){
    // Keep the body connected: moving an iframe reloads its browsing context.
    panel.querySelector('.mail-reader-header')!.replaceWith(template.content.querySelector('.mail-reader-header')!);
    panel.querySelector('.mail-action-failure')?.remove();
  }else panel.replaceChildren(template.content);
  updateSaveButton();
  void connections.section();
  panel.querySelectorAll<HTMLDetailsElement>('[data-mail-disclosure]').forEach(d=>d.open=!!restore?.open.includes(d.dataset.mailDisclosure!));
  const failure=state.app==='mail'?failedMailActions.get(r.id):undefined;
  if(failure)panel.insertAdjacentHTML('afterbegin',`<p class="mail-action-failure" role="status">Mail action failed; message restored. ${e(failure)}</p>`);
  const form=panel.querySelector<HTMLFormElement>('#record-form')!;
  if (state.app==='mail' && r.meta.folder!=='Drafts') bindMailReader(panel,r,renderDetail,keys(),reportSessionActivity);
  if(contentFocused)focusContent();
  if(state.app==='mail')bindAttachments(panel,r,{api,commit:requireSaved,notice,modal,update:record=>{
    if(state.current?.id===record.id){state.current.revision=record.revision;state.current.meta.attachments=record.meta.attachments;state.current.meta.hasAttachments=record.meta.hasAttachments;}
    const row=state.rows.find(row=>row.id===record.id);if(row){row.revision=record.revision;row.meta.attachments=record.meta.attachments;row.meta.hasAttachments=record.meta.hasAttachments;}
  }});
  if(restore?.focus){
    const disclosure=panel.querySelector<HTMLDetailsElement>(`[data-mail-disclosure="${CSS.escape(restore.focus.disclosure)}"]`);
    const control=disclosure?.querySelector<HTMLElement>(restore.focus.selector);
    const target=control&&!control.matches(':disabled')&&(control.matches('summary')||disclosure?.open)?control:disclosure?.querySelector<HTMLElement>('summary');
    target?.focus({preventScroll:true});
  }
  if(newlyOpened && openedMail)markOpenedMailRead(r);
  const bodyButton=panel.querySelector<HTMLButtonElement>('[data-download-body]');
  if(bodyButton){bodyButton.onclick=()=>void hydrateMailBody(r,true);if(Number(r.meta.messageSize||0)<=1400000&&!['Recovery copies','Not in Inbox'].includes(r.meta.folder||''))void hydrateMailBody(r);}
  if (form) { form.oninput=()=>markDirty(); form.onsubmit=ev=>{
    ev.preventDefault();void attempt(async()=>{
      await commit(true);
      if(r.kind==='lists'&&state.current===r)panel.querySelector<HTMLInputElement>('.checklist-add input')?.focus();
    });
  }; }
  if(state.app==='lists')bindChecklist(panel,r,{changed:markDirty,normal:()=>setMode('normal'),rename:()=>enterEdit(true),modal,dialog,confirmation});
  if(state.app==='calendar'){
    const close=document.createElement('button');close.textContent='Close event';close.className='calendar-close';close.onclick=()=>void attempt(returnToItemList);panel.prepend(close);
    if(form&&(!remote||canEditProvider))bindCalendarDates(form);
    form?.querySelector<HTMLButtonElement>('[data-apply-repeat]')?.addEventListener('click',()=>applyCalendarRepeat(form));
    panel.querySelector<HTMLButtonElement>('[data-calendar-scope]')?.addEventListener('click',event=>{
      const button=event.currentTarget as HTMLButtonElement;
      void attempt(()=>openCalendarScope(button.dataset.calendarScope==='series'));
    });
  }
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
  if(r.kind==='lists')return checklistContent(r);
  const m=r.meta, disabled=m.remote&&!providerCalendar(r)?'disabled':'';
  if (state.app==='mail' && m.folder!=='Drafts') {
    const recovery=!!m.remote && ['Recovery copies','Not in Inbox'].includes(m.folder||'');
    const actions=recovery?'<button data-action="keep-local">Save locally</button><button class="danger quiet" data-action="discard-copy">Discard copy</button>':`${m.folder!=='Archive'?`<button data-action="archive">${m.remote?'Archive':'Archive locally'}</button>`:''}${m.remote?m.folder==='Trash'?'<button data-action="restore-mail">Restore to Inbox</button>':`<button data-action="trash-mail" class="mobile-icon-button" aria-label="Move to Trash">${mobileActionLabel('trash','Move to Trash')}</button>`:`<button class="danger quiet mobile-icon-button" data-action="delete" aria-label="Delete">${mobileActionLabel('trash','Delete')}</button>`}`;
    const date=m.date||m.sentAt||'',parsed=new Date(date),validDate=Number.isFinite(parsed.getTime());
    const compactDate=validDate?parsed.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):date;
    const account=state.accounts.find(a=>a.id===m.account);
    const metadata=[['From',m.from||'Unknown'],['To',m.to||''],['Date',date],...(validDate?[['Local time',parsed.toLocaleString()]]:[]),...(m.account?[['Account',account?.label||m.account]]:[]),['Location',mailLocation(r)],...(m.serverFolder?[['Server folder',m.serverFolder]]:[]),...(m.source?[['Source',m.source]]:[])];
    const provenance=m.remote?`<p class="muted">Downloaded copy from ${e(mailLocation(r))}. Mail actions update the provider; Sync now refreshes its location.${m.headerOnly?' Only headers are cached.':''}</p>`:'';
    return `<header class="mail-reader-header"><div class="mail-subject-row"><h1>${e(r.title)}</h1><div class="mail-header-badges">${m.folder?`<span class="badge">${e(mailLocation(r))}</span>`:''}${m.remote?'<span class="badge">Cached</span>':''}</div></div><div class="mail-envelope-row"><span class="mail-correspondents" title="${e((m.from||'Unknown')+' → '+(m.to||''))}">${e(m.from||'Unknown')} <span aria-hidden="true">→</span><span class="file-input">to</span> ${e(m.to||'Unspecified recipient')}</span><span class="mail-compact-date" title="${e(date)}">${timestampLabel(date,compactDate)}</span><details data-mail-disclosure="metadata" class="mail-metadata"><summary>Details</summary><div class="mail-reader-popover mail-metadata-popover"><dl>${metadata.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${label==='Date'||label==='Local time'?timestampLabel(date,value||''):e(value)}</dd></div>`).join('')}</dl>${provenance}<button data-action="message-headers">View message headers</button></div></details></div>${recovery?'<p class="recurrence-note" role="status">This copy is absent from its synchronized folders. It may have moved elsewhere or been deleted. Save locally keeps an independent copy; Discard copy removes only this cached copy.</p>':''}<div class="head-actions mail-reader-actions">${m.from?'<button data-action="reply">Reply</button>':''}<button data-action="forward">Forward</button>${actions}${attachmentSection(r)}<details data-mail-disclosure="more" class="mail-reader-more"><summary class="mobile-icon-button" aria-label="More" title="More">${mobileIcon('more')}<span class="mobile-icon-label">More</span></summary><div class="mail-reader-popover mail-more-popover">${!recovery?`<button data-action="mail-junk-${m.folder==='Junk'?'not-junk':'junk'}">${m.folder==='Junk'?'Not Junk':'Mark as Junk'}</button>`:''}${!recovery&&m.remote?'<button data-action="file-mail">Move / Labels</button>':''}${!recovery?`<button data-action="read">Mark ${m.read?'unread':'read'}</button>`:''}<button data-action="export">Export</button>${(m.rawBase64||m.raw||r.hasOriginal)?'<button data-action="eml">Download original EML</button>':''}${mailDisplayControls(r,state.prefs)}</div></details></div></header>${mailBody(r,state.prefs)}`;
  }
  if (state.app==='wiki' && !state.wikiEditing) return `<span class="eyebrow">${e(r.title.split(':').slice(0,-1).join(' / ')||'Root namespace')}</span><h1>${e(r.title.split(':').at(-1))}</h1><article class="article">${markdown(r.body)}</article><div class="wiki-layout"><span class="eyebrow">Backlinks</span>${state.rows.filter(x=>x.id!==r.id && x.body.includes('[['+r.title+']]')).map(x=>`<p><button class="wiki-link" data-wiki="${e(x.title)}">${e(x.title)}</button></p>`).join('')||'<p class="muted">No pages link here yet.</p>'}</div>`;
  let content=`<form id="record-form" class="detail-form">${state.app==='documents'
    ?`<label class="file-name-field"><span>File name</span><input class="title-input file-name-input" name="title" value="${e(r.title)}" required ${disabled} aria-label="File name"></label>`
    :`<label><span class="file-input">${state.app==='wiki'?'Page ID (namespace:page)':'Title'}</span><input class="title-input" name="title" value="${e(r.title)}" required ${disabled} aria-label="Title"></label>`}`;
  if (state.app==='tasks') content+=`<div class="task-detail-badges">${taskBadges(r)}</div><div class="fields">${field('Due date','due',m.due,'date')}<label>Priority<select name="priority" aria-label="Priority" ${disabled}>${[...new Set(['High','Normal','Low',taskPriority(r)])].map(value=>`<option value="${e(value)}" ${value===taskPriority(r)?'selected':''}>${e(value)}</option>`).join('')}</select></label><label class="check-label"><input type="checkbox" name="done" ${m.done?'checked':''} ${disabled}> Completed</label></div>`;
  if (state.app==='contacts') content+=`<div class="fields">${field('Email','email',m.email,'email')}${field('Phone','phone',m.phone,'tel')}${field('Company','company',m.company)}${field('Group','group',m.group)}</div>`;
  if (state.app==='calendar') {
    const allDay=dateOnly(m.start), type=allDay?'date':'datetime-local';
    const storedEnd=calendarDate(m.end||'');
    const end=allDay?(Number.isFinite(+storedEnd)?dayKey(new Date(+storedEnd-1)):m.start):localInput(m.end);
    const writable=providerCalendar(r),series=calendarSeriesEditor===r;
    const scope=writable&&m.calendarOccurrence?'<button type="button" data-calendar-scope="series">Edit entire series</button>'
      :series?'<button type="button" data-calendar-scope="occurrence">Back to this occurrence</button>':'';
    const rules=writable&&!m.calendarOccurrence?`<details><summary>Repeat and exceptions</summary>
      ${calendarRepeatControls(m.calendarRules||'')}
      <p class="muted">Use RDATE for extra dates and EXDATE for skipped dates. Advanced rules can be edited below.</p>
      <label>Recurrence rules<textarea name="calendarRules" rows="3">${e(m.calendarRules||'')}</textarea></label></details>`:'';
    const advanced=m.calendarExtra!==undefined?`<details><summary>CalDAV properties</summary>
      <p class="muted">iCalendar properties for attendees, reminders, availability, privacy, categories, links, attachments, and custom fields.</p>
      <label>Additional iCalendar properties<textarea name="calendarExtra" rows="6" ${disabled}>${e(m.calendarExtra)}</textarea></label>
      ${m.calendarManaged?`<label>Provider-managed properties<textarea readonly rows="3">${e(m.calendarManaged)}</textarea></label>`:''}</details>`
      :m.calendarExtraOmitted?'<p class="muted">The additional iCalendar properties exceed the editor’s size limit. Office preserves them when saving.</p>':'';
    content+=`<div id="calendar-event-error" class="error" role="alert"></div>
      ${scope}${series||m.calendarSeries&&!m.calendarOccurrence?'<p class="recurrence-note">You are editing the entire series.</p>':m.calendarOccurrence?'<p class="recurrence-note">Recurring event · this occurrence</p>':''}
      <label class="check-label"><input type="checkbox" name="allDay" ${allDay?'checked':''} ${disabled}> All day</label>
      <div class="fields">
        ${field('Start (local time)','start',allDay?m.start:localInput(m.start),type,disabled)}
        <label><span id="calendar-end-label">${calendarEndLabel(allDay)}</span>
          <input name="end" type="${type}" value="${e(end)}" ${disabled}>
        </label>
        ${field('Location','location',m.location,'text',disabled)}
        ${writable?field('Event time zone (times shown in your local zone)','calendarZone',m.calendarZone):''}
      </div>${rules}${advanced}${m.rawIcs||m.raw||m.calendarOriginalRemote?'<button type="button" data-action="original-ics">Download original ICS</button>':''}${m.recurrence&&!writable?`<p class="recurrence-note">Recurring series: ${e(m.recurrence)}</p>`:''}`;
  }
  if (state.app==='mail') content+=`<div class="fields">${field('To (one recipient)','to',m.to,'email','required')}<label>Send using<select name="sendAccount" aria-label="Send using"><option value="">Choose an account</option>${m.sendAccount&&!mailAccounts().some(a=>a.id===m.sendAccount)?`<option value="${e(m.sendAccount)}" selected>Unavailable account — choose another</option>`:''}${mailAccounts().map(a=>`<option value="${a.id}" ${m.sendAccount===a.id?'selected':''}>${e(a.label)}</option>`).join('')}</select></label></div>`;
  if (state.app==='documents') content+=`<div class="document-content">${mobileDisclosure('document-formatting','Formatting',undefined,'formatting')}<div id="document-formatting" class="rich-toolbar mobile-collapsible" role="toolbar" aria-label="Document formatting"><button type="button" data-format="bold" aria-label="Bold"><b>B</b></button><button type="button" data-format="italic" aria-label="Italic"><i>I</i></button><button type="button" data-format="formatBlock" data-value="h1">Heading 1</button><button type="button" data-format="formatBlock" data-value="h2">Heading 2</button><button type="button" data-format="formatBlock" data-value="p">Paragraph</button><button type="button" data-format="insertUnorderedList">List</button><button type="button" data-format="insertOrderedList">1. List</button><button type="button" data-format="table">Table</button><button type="button" data-action="link">Link</button><button type="button" data-action="image">Image</button><button type="button" data-format="undo">Undo</button><button type="button" data-format="redo">Redo</button><button type="button" data-action="text">Plain text</button><button type="button" data-action="print">Print / PDF</button></div><div id="rich-editor" class="rich-editor" contenteditable="true" role="textbox" aria-label="Document content" aria-multiline="true">${safeDocument(r.body)}</div></div><p class="muted document-hint">Basic formatting · HTML / plain text export · Vim navigation outside the editing area</p>`;
  else if (state.app==='sheets') content+=sheetContent(r);
  else content+=`<label>${state.app==='wiki'?'Markdown source':state.app==='mail'?'Message':'Notes'}<textarea class="body-editor" name="body" ${disabled}>${e(r.body)}</textarea></label>`;
  if (state.app==='mail') content+=attachmentSection(r)+`<div class="head-actions compose-send-actions"><button type="button" class="primary" data-action="send" title="Send message (Ctrl+Enter)" ${sendingMail?'disabled':''}>Send message</button><span class="muted">Ctrl+Enter to send. Saved drafts are never sent automatically.</span></div>`;
  return content+'</form>';
}
function localInput(value?: string) { if (!value) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value+'T00:00'; if (!/[Zz]|[+-]\d\d:\d\d$/.test(value)) return value.slice(0,16); const d=new Date(value); return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function calendarRepeatControls(rules:string) {
  const rule=rules.split('\n').find(line=>/^RRULE:/i.test(line))?.slice(6)||'';
  const parts=new URLSearchParams(rule.replaceAll(';','&'));
  const frequency=parts.get('FREQ')||'';
  const frequencies=[['','Does not repeat'],['DAILY','Daily'],['WEEKLY','Weekly'],['MONTHLY','Monthly'],['YEARLY','Yearly']];
  if([...parts.keys()].some(key=>!['FREQ','INTERVAL','BYDAY','COUNT','UNTIL'].includes(key))||!frequencies.some(([value])=>value===frequency)
      ||parts.has('BYDAY')&&frequency!=='WEEKLY')return '<p class="muted">This series uses an advanced repeat pattern. Edit its recurrence rules below.</p>';
  const days=parts.get('BYDAY')?.split(',')||[];
  const until=parts.get('UNTIL')||'';
  return `<div class="fields">
    <label>Repeat<select data-repeat-frequency>${frequencies.map(([value,label])=>`<option value="${value}" ${frequency===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label>Interval<input data-repeat-interval type="number" min="1" value="${e(parts.get('INTERVAL')||'1')}"></label>
    <label>Number of occurrences<input data-repeat-count type="number" min="1" value="${e(parts.get('COUNT')||'')}"></label>
    <label>Or repeat through<input data-repeat-until type="date" value="${e(until.replace(/^(\d{4})(\d{2})(\d{2}).*$/,'$1-$2-$3'))}"></label>
  </div><fieldset><legend>Repeat days for weekly events</legend><div class="fields">${[['MO','Mon'],['TU','Tue'],['WE','Wed'],['TH','Thu'],['FR','Fri'],['SA','Sat'],['SU','Sun']].map(([value,label])=>`<label class="check-label"><input type="checkbox" data-repeat-day value="${value}" ${days.includes(value)?'checked':''}> ${label}</label>`).join('')}</div></fieldset>
  <button type="button" data-apply-repeat>Apply repeat pattern</button>`;
}
function applyCalendarRepeat(form:HTMLFormElement) {
  const read=(selector:string)=>form.querySelector<HTMLInputElement>(selector)!;
  const frequency=read('[data-repeat-frequency]').value;
  const interval=read('[data-repeat-interval]'),count=read('[data-repeat-count]'),until=read('[data-repeat-until]').value;
  if(!interval.reportValidity()||!count.reportValidity())return;
  if(count.value&&until){notice('Choose a repeat count or an end date.',true);return;}
  const days=Array.from(form.querySelectorAll<HTMLInputElement>('[data-repeat-day]:checked'),day=>day.value);
  const field=form.elements.namedItem('calendarRules') as HTMLTextAreaElement;
  const lines=field.value.split('\n').filter(line=>line&&!/^RRULE:/i.test(line));
  if(frequency){
    const parts=['FREQ='+frequency];
    if(Number(interval.value)>1)parts.push('INTERVAL='+interval.value);
    if(frequency==='WEEKLY'&&days.length)parts.push('BYDAY='+days.join(','));
    if(count.value)parts.push('COUNT='+count.value);
    if(until){
      const allDay=(form.elements.namedItem('allDay') as HTMLInputElement).checked;
      const zone=(form.elements.namedItem('calendarZone') as HTMLInputElement).value;
      const date=until.replaceAll('-','');
      if(!allDay&&!zone&&state.current?.meta.start?.length===19)parts.push('UNTIL='+date+'T235959');
      else if(allDay)parts.push('UNTIL='+date);
      else{
        try{
          const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone||'UTC',dateStyle:'short',timeStyle:'medium',hourCycle:'h23'});
          const wall=Date.parse(until+'T23:59:59Z');
          let instant=wall;
          for(let pass=0;pass<2;pass++)instant+=wall-Date.parse(formatter.format(instant).replace(' ','T')+'Z');
          parts.push('UNTIL='+new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g,''));
        }catch{notice('For this time zone, enter UNTIL as a UTC date and time in the recurrence rules.',true);return;}
      }
    }
    lines.unshift('RRULE:'+parts.join(';'));
  }
  field.value=lines.join('\n');
  markDirty();
}
function calendarEndLabel(allDay: boolean) { return allDay?'End (last day)':'End (local time)'; }
function calendarEndIsInvalid(start: HTMLInputElement,end: HTMLInputElement) {
  if(!start.value||!end.value)return false;
  const order=+calendarDate(end.value)-+calendarDate(start.value);
  return order<0||(order===0&&end.type!=='date');
}
function bindCalendarDates(form: HTMLFormElement) {
  const start=form.querySelector<HTMLInputElement>('[name="start"]')!;
  const end=form.querySelector<HTMLInputElement>('[name="end"]')!;
  const allDay=form.querySelector<HTMLInputElement>('[name="allDay"]')!;
  form.oninput=event=>{
    calendarSaveFailure=undefined;
    if(event.target===allDay){
      const startValue=start.value,endValue=end.value;
      const validRange=startValue&&endValue&&!calendarEndIsInvalid(start,end);
      start.type=end.type=allDay.checked?'date':'datetime-local';
      start.value=allDay.checked?startValue.slice(0,10):localInput(startValue);
      end.value=allDay.checked
        ?(validRange?dayKey(new Date(+calendarDate(endValue)-1)):endValue.slice(0,10))
        :(endValue?localInput(dayKey(addDays(calendarDate(endValue),1))):'');
      form.querySelector('#calendar-end-label')!.textContent=calendarEndLabel(allDay.checked);
    }
    if((event.target===start||event.target===allDay)&&start.value&&(!end.value||calendarEndIsInvalid(start,end))){
      if(allDay.checked)end.value=start.value;
      else {
        const date=calendarDate(start.value);
        date.setHours(date.getHours()+1);
        end.value=localInput(date.toISOString());
      }
    }
    markDirty();
  };
}
function validateCalendarEnd() {
  if(state.current?.kind!=='calendar'||state.current.meta.remote&&!providerCalendar(state.current))return true;
  const end=document.querySelector<HTMLInputElement>('#record-form [name="end"]');
  if(!end)return true;
  const start=end.form!.querySelector<HTMLInputElement>('[name="start"]')!;
  const invalid=calendarEndIsInvalid(start,end);
  const error=end.form!.querySelector('#calendar-event-error')!;
  const dateError=end.type==='date'?'End date cannot be before start date.':'End must be after start.';
  const message=invalid?dateError:calendarSaveFailure?.id===state.current.id?calendarSaveFailure.message:'';
  if(error.textContent!==message)error.textContent=message;
  if(invalid){
    end.setAttribute('aria-invalid','true');
    end.setAttribute('aria-describedby',error.id);
  }else{
    end.removeAttribute('aria-invalid');
    end.removeAttribute('aria-describedby');
  }
  return !invalid;
}
function providerCalendarChanges() {
  const form=document.querySelector<HTMLFormElement>('#record-form');
  const changes:Record<string,string>={};
  if(!form)return changes;
  const allDay=form.elements.namedItem('allDay') as HTMLInputElement;
  for(const key of ['title','body','location','calendarZone','calendarRules','calendarExtra','start','end']){
    const field=form.elements.namedItem(key) as HTMLInputElement|HTMLTextAreaElement|null;
    const changedType=(key==='start'||key==='end')&&allDay.checked!==allDay.defaultChecked;
    if(!field||(!changedType&&field.value===field.defaultValue))continue;
    if(key==='start'||key==='end'){
      if(!field.value)changes[key]='';
      else if(allDay.checked)changes[key]=key==='end'?dayKey(addDays(calendarDate(field.value),1)):field.value;
      else changes[key]=new Date(field.value).toISOString();
    }else changes[key]=field.value;
  }
  return changes;
}
async function openCalendarScope(series:boolean) {
  const current=state.current;
  if(!current||!providerCalendar(current))return;
  await leaveEditor();
  if(state.current!==current)return;
  const original=state.rows.find(row=>row.id===current.id);
  if(!original)return;
  if(series){
    const result=await api('calendar-series',{id:original.id,revision:original.revision,scope:'series'});
    if(state.current!==current||state.dirty)return;
    calendarSeriesEditor=result.record;
    state.current=calendarSeriesEditor;
  }else{
    calendarSeriesEditor=undefined;
    state.current=original;
  }
  calendarSaveFailure=undefined;
  renderDetail();
  document.querySelector<HTMLInputElement>('#record-form [name="title"]')?.focus();
}
async function saveProviderCalendar(record:OfficeRecord) {
  if(!validateCalendarEnd())throw new DraftCancelled();
  const changes=providerCalendarChanges();
  if(!Object.keys(changes).length)return;
  const series=calendarSeriesEditor===record;
  const form=document.querySelector<HTMLFormElement>('#record-form')!;
  const title=form.elements.namedItem('title') as HTMLInputElement;
  if(!title.reportValidity())throw new DraftCancelled();
  const confirm=record.meta.calendarGuests||/^ATTENDEE[;:]/mi.test(changes.calendarExtra||'');
  if(confirm){
    const accepted=await new Promise<boolean>(resolve=>{
      confirmation('Save event with guests','Saving may send updates to event guests.',()=>resolve(true),'Save event');
      dialog.addEventListener('close',()=>resolve(false),{once:true});
    });
    if(!accepted||state.current!==record)throw new DraftCancelled();
  }
  form.inert=true;
  calendarSaveFailure=undefined;
  let saved=false;
  state.savePromise=(async()=>{
    try{
      const result=await api('calendar-save',{id:record.id,revision:record.revision,scope:series?'series':'occurrence',version:record.meta.calendarEtag,changes,confirmed:!!confirm,browserZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      saved=true;state.dirty=false;
      if(result.warning)notice(result.warning,true);
    }catch(cause){
      calendarSaveFailure={id:record.id,message:asError(cause).message};
      throw new DraftCancelled();
    }finally{
      state.savePromise=null;form.inert=false;updateSaveButton();
    }
  })();
  updateSaveButton();
  await state.savePromise;
  if(saved&&state.current===record){
    calendarSeriesEditor=undefined;
    try{await load(record.id,{selectFirst:false,preserveSelection:true});}
    catch{renderDetail();notice('The provider saved the event. Use Sync now to refresh the Office copy.',true);}
  }
}
function workbook(r: OfficeRecord) {
  r.meta.workbook??={sheets:[{name:'Sheet 1',cells:{}}]};
  for (const s of r.meta.workbook.sheets) if (Array.isArray(s.cells)) s.cells={...s.cells};
  return r.meta.workbook;
}
function sheetContent(r: OfficeRecord) {
  const w=workbook(r); state.sheet=Math.min(state.sheet,w.sheets.length-1); const sheet=w.sheets[state.sheet];
  return `<div><div class="sheet-tabs">${w.sheets.map((s,i)=>`<button type="button" data-sheet="${i}" class="${i===state.sheet?'primary':''}">${e(s.name)}</button>`).join('')}<button type="button" data-action="add-sheet" class="mobile-icon-button" aria-label="Add sheet">${mobileActionLabel('add','+')}</button><button type="button" data-action="rename-sheet" class="mobile-icon-button" aria-label="Rename sheet">${mobileActionLabel('edit','Rename')}</button></div><label class="formula-bar"><code id="cell-label">${state.cell}</code><span class="file-input">Cell formula or value</span><input id="formula" value="${e(sheet.cells[state.cell]||'')}" autocomplete="off" aria-label="Cell formula or value"></label><div class="sheet-wrap"><table class="sheet" aria-label="Spreadsheet"><thead><tr><th></th>${Array.from({length:12},(_,c)=>`<th scope="col">${colName(c)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:30},(_,row)=>`<tr><th scope="row">${row+1}</th>${Array.from({length:12},(_,col)=>{ const ref=colName(col)+(row+1); return `<td><button type="button" data-cell="${ref}" class="${state.cell===ref?'cell-selected':''}" tabindex="${state.cell===ref?'0':'-1'}" aria-label="${ref}: ${e(cellValue(sheet.cells,ref))}">${e(cellValue(sheet.cells,ref))}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">30 × 12 visible cells · + − * / ^ · SUM, AVERAGE, MIN, MAX, COUNT · A1:B5 ranges. Use i or Enter to edit, Escape to return, Tab/arrows to move. Cross-sheet formulas are deferred.</p></div>`;
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
  // PHP returns empty metadata as []; JSON would drop named properties added to it.
  if(Array.isArray(state.current!.meta))state.current!.meta={...state.current!.meta};
  const m=state.current!.meta;
  for (const key of ['due','priority','email','phone','company','group','location','to','sendAccount'] as const) if (key in values) m[key]=values[key];
  for (const key of ['start','end'] as const) if (key in values) m[key]=values[key]?(dateOnly(values[key])?values[key]:new Date(values[key]).toISOString()):'';
  // The editor includes the last day. Stored all-day ranges end the next day.
  if(dateOnly(values.start)&&dateOnly(values.end))m.end=dayKey(addDays(calendarDate(values.end),1));
  if (state.app==='tasks') m.done=values.done==='on';
  if (state.app==='documents') state.current!.body=safeDocument(document.querySelector<HTMLElement>('#rich-editor')!.innerHTML);
}
function updateSaveButton() {
  const button=document.querySelector<HTMLButtonElement>('#detail [data-action="save"]');
  if(!button)return;
  const valid=validateCalendarEnd();
  button.disabled=!!state.savePromise||!state.dirty||!valid;
}
function markDirty() {
  const provider=providerCalendar(state.current);
  if(provider)calendarSaveFailure=undefined;else collect();
  state.dirty=provider?Object.keys(providerCalendarChanges()).length>0:true;
  updateSaveButton();
  const status=document.querySelector<HTMLElement>('#save-status');
  if(status)status.textContent=isUnsavedDraft()?'Unsaved draft':state.dirty?'Unsaved changes':'Saved';
  clearTimeout(saveTimer);
  if(!provider&&!isUnsavedDraft())saveTimer=setTimeout(()=>void attempt(()=>commit()),800);
}
async function completeTask() {
  if(state.app!=='tasks'||!state.current||state.current.meta.remote)return;
  const checkbox=document.querySelector<HTMLInputElement>('#record-form input[name="done"]');
  if(!checkbox||checkbox.checked)return;
  const pane=activePane();
  checkbox.checked=true;markDirty();await commit();
  if(state.app==='tasks')restorePane(pane);
}
async function requireSaved() {
  if(isUnsavedDraft())throw Error('Save this draft first.');
  await commit();
}
function discardUnsavedDraft() {
  const draft=unsavedDraft;
  clearTimeout(saveTimer);unsavedDraft=null;pendingLinkedSource=undefined;state.current=null;state.dirty=false;
  if(draft?.kind==='mail'){returnFromMailDraft(draft.id);return;}
  renderList();renderDetail();
}
async function leaveEditor() {
  if(state.savePromise)await state.savePromise;
  if(providerCalendar(state.current)&&state.dirty){
    const discard=await new Promise<boolean>(resolve=>{
      modal('Unsaved event changes','<p>Discard your edits to this event?</p><div class="dialog-actions"><button data-close-editor>Keep editing</button><button class="danger" data-discard-event>Discard changes</button></div>');
      dialog.addEventListener('close',()=>resolve(false),{once:true});
      dialog.querySelector<HTMLButtonElement>('[data-close-editor]')!.onclick=()=>dialog.close();
      dialog.querySelector<HTMLButtonElement>('[data-discard-event]')!.onclick=()=>{resolve(true);dialog.close();};
    });
    if(!discard)throw new DraftCancelled();
    state.dirty=false;calendarSaveFailure=undefined;renderDetail();
  }
  if(isUnsavedDraft()){
    collect();
    const choice=await new Promise<string>(resolve=>{
      modal('Unsaved draft','<p>Save this draft before leaving?</p><div class="dialog-actions"><button data-draft-choice="cancel">Cancel</button><button data-draft-choice="discard">Discard Draft</button><button class="primary" data-draft-choice="save">Save</button></div>');
      dialog.addEventListener('close',()=>resolve('cancel'),{once:true});
      dialog.querySelectorAll<HTMLButtonElement>('[data-draft-choice]').forEach(button=>button.onclick=()=>{resolve(button.dataset.draftChoice!);dialog.close();});
      dialog.querySelector<HTMLButtonElement>('[data-draft-choice="cancel"]')!.focus();
    });
    if(choice==='cancel')throw new DraftCancelled();
    if(choice==='discard')discardUnsavedDraft();else await commit(true);
  }else await commit();
}
async function commit(explicit=false): Promise<void> {
  clearTimeout(saveTimer); if(state.savePromise) await state.savePromise; if(!state.dirty || !state.current) return;
  if(providerCalendar(state.current)){
    if(!explicit)throw new DraftCancelled();
    return saveProviderCalendar(state.current);
  }
  if(!validateCalendarEnd())throw new DraftCancelled();
  collect();if(isUnsavedDraft()&&!explicit)return;
  const taskOrder=state.app==='tasks'?[...document.querySelectorAll<HTMLElement>('#items [data-id]')].map(el=>el.dataset.id!):[];
  const taskPane=activePane();
  const firstSave=isUnsavedDraft(),payload=structuredClone(state.current); state.dirty=false; const id=payload.id;
  if(payload.kind==='calendar')calendarSaveFailure=undefined;
  const input=firstSave?{kind:payload.kind,title:payload.title,body:payload.body,meta:payload.meta,...(pendingLinkedSource?.draft===id?{linkedTo:pendingLinkedSource.source}:{})}:payload;
  state.savePromise=(async()=>{try { const result=await api('save',input); if(state.current?.id===id) {
    if(firstSave){
      const origin=mailDraftOrigins.get(id);
      if(origin){mailDraftOrigins.set(result.record.id,origin);mailDraftOrigins.delete(id);}
      Object.assign(state.current!,{id:result.record.id,revision:result.record.revision,created:result.record.created,updated:result.record.updated});
      if(fullScreenItemId===id)fullScreenItemId=result.record.id;
      unsavedDraft=null;pendingLinkedSource=undefined;state.rows.push(state.current!);
    }
    else {state.current!.revision=result.record.revision;state.current!.updated=result.record.updated;const pos=state.rows.findIndex(r=>r.id===id);if(pos>=0)state.rows[pos]=state.current;}
  }
    const s=document.querySelector<HTMLElement>('#save-status')!; if(s) s.textContent=state.dirty?'Unsaved changes':'Saved';
    const listFocused=state.app==='lists'&&!!document.activeElement?.closest('#items');
    renderList();if(listFocused)focusList();
  } catch(cause) {
    const error=asError(cause);state.dirty=true;
    const status=document.querySelector<HTMLElement>('#save-status');
    if(payload.kind==='calendar'&&state.current?.id===id&&document.querySelector('#calendar-event-error')){
      calendarSaveFailure={id,message:error.message};
      if(status)status.textContent=firstSave?'Unsaved draft':'Unsaved changes';
      throw new DraftCancelled();
    }
    if(status)status.textContent='Save failed · keep this page open';
    throw error;
  } finally { state.savePromise=null; updateSaveButton(); }})();
  updateSaveButton();
  await state.savePromise; if(state.dirty) await commit();
  if(state.app==='tasks'&&state.current&&(firstSave||state.current.id===id)&&!state.dirty){
    if(!filteredRows().some(r=>r.id===state.current?.id)){
      const visible=navigableRows(),ids=new Set(visible.map(r=>r.id)),index=taskOrder.indexOf(id);
      const next=taskOrder.slice(index+1).find(id=>ids.has(id))||taskOrder.slice(0,Math.max(0,index)).reverse().find(id=>ids.has(id));
      state.selected.delete(state.current!.id);selectionAnchor=null;
      state.current=visible.find(r=>r.id===next)||visible[0]||null;
      renderList();renderDetail();restorePane(taskPane);
    }else{
      const badges=document.querySelector('.task-detail-badges');if(badges)badges.innerHTML=taskBadges(state.current!);
    }
  }
  if(firstSave)renderDetail(undefined,true);
  if(firstSave)void connections.section();
}
async function openActivityRecord(id: string,dismiss: () => boolean) {
  const record=(await api(`record&id=${encodeURIComponent(id)}`)).record;
  if(!dismiss())return;
  try{await openConnectedRecord(id,record);}
  catch(cause){
    if(cause instanceof DraftCancelled)document.querySelector<HTMLElement>('#view-activity')!.focus();
    else activity.notice(asError(cause).message,true,{log:false});
  }
}
async function openConnectedRecord(id:string,activityRecord?: OfficeRecord){
  await waitForAttachments();await leaveEditor();
  const version=appEntryVersion;
  const record=activityRecord??(await api(`record&id=${encodeURIComponent(id)}`)).record;
  if(version!==appEntryVersion)return;
  if(!apps[record.kind])throw new CommandError('This item type is not available in this version.');
  rememberSelection();
  mobileBackId=rememberNavigation(true);
  mobileItemOpen=true;
  mobileListPosition=undefined;
  if(record.kind==='mail')clearMailCache();
  state.app=record.kind;state.current=null;state.search='';state.sheet=0;state.cell='A1';setMode('normal');location.hash=record.kind;
  if(record.kind==='mail'){
    state.mailScope=null;
    state.mailFolder=record.meta.folder==='Not in Inbox'?'Recovery copies':record.meta.folder==='Custom folder'?'all':record.meta.folder||'Archive';
  }
  const opened=await showAppEntry(record.kind,async entryVersion=>{
    await load(record.id,{selectFirst:!activityRecord&&record.kind!=='mail',revealMail:record.kind==='mail',revealTask:!!activityRecord,entryVersion});
    if(entryVersion!==appEntryVersion)return;
    if(record.kind==='calendar')calendar.ensureVisible(record.id,{reveal:true});
    if(record.kind==='lists'||phoneLayout.matches&&mobileItemOpen||(activityRecord&&record.kind==='tasks'&&!document.querySelector('#selected-item')))focusContent();else focusList();
    document.querySelector<HTMLElement>('#selected-item')?.scrollIntoView({block:'nearest'});
  });
  if(opened&&(state.current as OfficeRecord|null)?.id!==record.id){
    if(activityRecord)throw new CommandError('This item is no longer available.');
    if(record.kind==='mail')throw new CommandError('This linked item is no longer available. Reopen the connections window and try again.');
  }
}
async function changeApp(name: AppName,keepSidebar=false,mailScope?: MailScope,settingsDestination?: typeof settingsPages[number][0]) {
  await waitForAttachments();await leaveEditor();rememberSelection();
  if(name!==state.app||mailScope||settingsDestination&&settingsDestination!==settingsPage||state.search||phoneLayout.matches&&mobileItemOpen)rememberNavigation();
  mobileItemOpen=false;
  mobileListPosition=undefined;
  mobileBackId=undefined;
  showMobileMenu(false);
  setDisclosure(document.querySelector('#mobile-header-more'),false);
  if(settingsDestination)selectSettingsPage(settingsDestination);
  if(state.app==='mail'&&name!=='mail'&&!appEntryVisible()){
    retainMailRows();
    state.rows=[];
  }
  let cached=name==='mail'&&!state.syncing&&!pendingWrites&&mailCache&&Date.now()<mailCache.expires?mailCache:undefined;
  if(name==='mail')clearMailCache();
  if(name==='mail'&&(state.app!=='mail'||mailScope)){state.mailFolder='Inbox';state.mailScope=mailScope??null;}
  state.app=name;state.current=null;state.search='';state.sheet=0;state.cell='A1';state.mode='normal';location.hash=name;
  return showAppEntry(name,async entryVersion=>{
    const initial=cached;
    cached=undefined;
    const view=mailScope?undefined:initial?.view;
    if(view){
      state.mailFolder=view.folder;
      state.mailScope=view.scope;
      state.search=view.search;
      mailListLimit=initial!.limit;
    }
    if(!initial)mailListLimit=100;
    await load(view?.selectedId,{enteringApp:true,keepSidebar,entryVersion},initial&&!mailScope?{records:initial.rows,mailPage:initial.page}:undefined);
    if(view&&entryVersion===appEntryVersion){
      const list=document.querySelector('#items');
      if(list)list.scrollTop=initial!.scrollTop;
    }
  },!!cached);
}
async function showAppEntry(name: AppName,open: (version: number)=>Promise<void>,warm=false) {
  setItemFullScreen(false);
  document.querySelector('.shell')?.classList.remove('mobile-item-open');
  const version=++appEntryVersion;
  const main=document.querySelector<HTMLElement>('#main')!;
  const controls=document.querySelectorAll<HTMLElement>('#app-toolbar,#mail-toolbar,#mail-folder-navigation');
  controls.forEach(control=>{control.inert=true;});
  main.dataset.appEntry='';
  const label=apps[name]?.name||'Settings';
  if(!warm)main.innerHTML=`<div class="app-entry-screen" role="status"><span class="app-entry-spinner" aria-hidden="true"></span><p>Loading ${e(label)}…</p></div>`;
  try {
    await open(version);
    if(version!==appEntryVersion)return false;
    delete main.dataset.appEntry;
    controls.forEach(control=>{control.inert=false;});
    return true;
  } catch(cause) {
    if(version!==appEntryVersion)return false;
    const focusRetry=document.activeElement===document.body||main.contains(document.activeElement);
    main.innerHTML=`<div class="app-entry-screen"><div role="alert"><h2>Couldn’t load ${e(label)}</h2><p>${e(asError(cause).message)}</p></div><button type="button">Try again</button></div>`;
    const retry=main.querySelector('button')!;
    retry.onclick=()=>{void attempt(()=>showAppEntry(name,open));};
    if(focusRetry)retry.focus({preventScroll:true});
    throw cause;
  }
}
function updateMailListItem(id: string) {
  const record=state.rows.find(r=>r.id===id),button=document.querySelector<HTMLElement>(`#items [data-id="${CSS.escape(id)}"]`)!;
  if(!record||!button)return;
  const row=swipeMailDisplay(record);
  const selected=state.current?.id===id;
  const copy=button.querySelector('.item-copy');if(copy)copy.outerHTML=renderMailListCopy(row,state.prefs.mailList,failedMailActions.get(row.id));
  button.classList.toggle('selected',selected);button.classList.toggle('mail-read',!!row.meta.read);button.classList.toggle('mail-unread',!row.meta.read);
  button.setAttribute('aria-pressed',String(selected||state.selected.has(id)));
  if(selected)button.id='selected-item';else button.removeAttribute('id');
  const label=button.querySelector<HTMLInputElement>('.mail-read-status .file-input')!;if(label)label.textContent=row.meta.read?'Read':'Unread';
}
async function selectRecord(id: string,focus: boolean|'list-without-scroll'=false,openItem: boolean|'linked'=false,{preserveCalendarView=false}={}) {
  const pane=activePane();
  await waitForAttachments();await leaveEditor();
  const previous=state.current?.id,origin=mailDraftOrigin(false);
  const record=state.rows.find(r=>r.id===id)||null;
  const backId=record&&openItem&&(previous!==id||phoneLayout.matches&&!mobileItemOpen)
    ?rememberNavigation(openItem==='linked'):undefined;
  state.current=record;
  if(record&&openItem){
    openMobileItem(id);
    if(backId!==undefined)mobileBackId=backId;
  }
  if(state.app==='wiki'){state.wikiEditing=false;setMode('normal');}
  if(state.app==='mail'&&state.current?.meta.folder==='Drafts'&&previous!==id)mailDraftOrigins.set(id,origin);
  state.sheet=0;state.cell='A1';
  if(state.app==='mail'){
    if(!document.querySelector('#items [data-id="'+CSS.escape(id)+'"]'))renderList();
    if(previous)updateMailListItem(previous);
    if(state.current)updateMailListItem(state.current.id);
  }else renderList();
  if(state.app==='calendar')calendar.ensureVisible(id,{preserveView:preserveCalendarView});
  renderDetail();
  if(phoneLayout.matches&&mobileItemOpen){
    if(previous!==id||openItem)document.querySelector<HTMLElement>('#detail')!.scrollTop=0;
    document.querySelector<HTMLElement>('.mobile-back')?.focus({preventScroll:true});return;
  }
  if(focus===true&&pane==='content'){focusContent();document.querySelector<HTMLElement>('#selected-item')?.scrollIntoView({block:'nearest'});}else if(focus){
  const selected=document.querySelector<HTMLElement>('#selected-item');
  selected?.focus({preventScroll:true});
  if(focus===true)selected?.scrollIntoView({block:'nearest',inline:'nearest'});
} }
function selectRecordFromKeyboard(id: string) {
  return selectRecord(id,true,false,{preserveCalendarView:true});
}
async function clickRecord(id: string,event: MouseEvent) {
  await leaveEditor();
  if(event.shiftKey){
    keyboardSelection=false;
    const rows=navigableRows(),to=rows.findIndex(r=>r.id===id),anchor=rows.findIndex(r=>r.id===(selectionAnchor||state.current?.id)),from=anchor<0?to:anchor;
    if(!event.ctrlKey&&!event.metaKey)state.selected.clear();
    for(const r of rows.slice(Math.max(0,Math.min(from,to)),Math.max(from,to)+1))state.selected.add(r.id);
  }else if(event.ctrlKey||event.metaKey){
    keyboardSelection=false;
    if(!state.selected.size&&state.current)state.selected.add(state.current!.id);
    if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);
    selectionAnchor=id;
  }else{if(!keyboardSelection)state.selected.clear();selectionAnchor=id;}
  renderList();await selectRecord(id,true,!event.shiftKey&&!event.ctrlKey&&!event.metaKey);
}
function mailAccounts() { return state.accounts.filter(a=>['imap','google'].includes(a.type)); }
function draftAccount(context?: OfficeRecord | null) {
  const accounts=mailAccounts();
  return [context?.meta.sendAccount,context?.meta.account,state.prefs.defaultMailAccount,accounts.length===1?accounts[0].id:''].find(id=>accounts.some(a=>a.id===id)) || '';
}
async function createRecord(initial: Partial<ItemInput>={}, {keepMailList=false,focusBody=false}={}) {
  await waitForAttachments(); await leaveEditor(); const kind=state.app;
  if (!apps[kind]) return;
  const previous=state.current;
  const backId=rememberNavigation();
  openMobileItem(previous?.id);
  mobileBackId=backId;
  const origin=kind==='mail'?mailDraftOrigin():undefined;
  const record: ItemInput={kind:kind as ItemKind,title:initial.title||'Untitled '+apps[kind].singular,body:initial.body||'',meta:{...(kind==='mail'?{folder:'Drafts'}:{}),...initial.meta}};
  if(kind==='mail' && !record.meta.sendAccount)record.meta.sendAccount=draftAccount(previous);
  if(kind==='calendar'&&!record.meta.start) { const start=new Date(); start.setMinutes(0,0,0); record.meta.start=start.toISOString(); record.meta.end=new Date(+start+3600000).toISOString(); }
  if(kind==='sheets')record.meta.workbook={sheets:[{name:'Sheet 1',cells:{}}]};
  if(kind==='lists')record.meta.checklist=[];
  if(kind==='mail'&&!keepMailList&&!phoneLayout.matches){state.mailScope=null;if(state.mailFolder!=='all')state.mailFolder='Drafts';}
  try {
    const now=new Date().toISOString();
    state.current={...record,id:'draft-'+crypto.randomUUID(),revision:0,created:now,updated:now};unsavedDraft=state.current;
    if(origin)mailDraftOrigins.set(state.current.id,origin);
    state.dirty=true;state.wikiEditing=true;state.sheet=0;state.cell='A1';
    state.selected.clear();selectionAnchor=null;keyboardSelection=false;
    renderWorkspace();
    if(kind==='mail'&&focusBody){
      const body=document.querySelector<HTMLTextAreaElement>('#detail [name="body"]')!;
      body?.focus();body?.setSelectionRange(0,0);setMode('insert');
    }else enterEdit(true);
  }
  catch(cause) { const error=asError(cause); state.current=previous;renderDetail();throw error; }
}
async function viewWikiPage() {
  const record=state.current;
  await commit();
  if(state.app!=='wiki'||state.current!==record||!state.wikiEditing)return;
  state.wikiEditing=false;
  setMode('normal');
  renderDetail();
  focusContent();
}
function enterEdit(preferTitle=false) {
  if (state.current?.meta.remote&&!providerCalendar(state.current)) {notice('This synced copy is read-only.');return;}
  if(phoneLayout.matches&&state.current&&!mobileItemOpen){openMobileItem(state.current.id);renderDetail();}
  if(state.app==='wiki'&&!state.wikiEditing){state.wikiEditing=true;renderDetail();}
  const title=preferTitle||state.app==='lists';
  const target=state.app==='sheets'?document.querySelector<HTMLInputElement>('#formula')!:title?document.querySelector<HTMLInputElement>('.title-input')!:state.app==='documents'?document.querySelector<HTMLElement>('#rich-editor')!:document.querySelector<HTMLTextAreaElement>('#detail [name=body]')!;
  target?.focus();if(target instanceof HTMLInputElement&&(title||target.id==='formula'))target.select();setMode('insert');
}
function setMode(mode: string) {state.mode=mode;const m=document.querySelector<HTMLElement>('#mode')!;if(m)m.textContent=mode.toUpperCase();}
async function attempt<T>(fn: () => T | Promise<T>) { try{return await fn();}catch(cause) { if(cause instanceof DraftCancelled)return;const error=asError(cause);notice(error.message,true);} }
function modal(title: string,body: string) { dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button class="quiet" data-close aria-label="Close dialog">✕</button></div>${body}`; dialog.querySelector<HTMLElement>('[data-close]')!.onclick=()=>dialog.close(); dialog.showModal(); }
function openCalendarSearch() {
  const calendars=calendarSources(state.rows,state.accounts,state.prefs.calendarAliases);
  const sources=connectedCalendarSources(state.accounts,calendars);
  modal('Search connected calendars',`<form class="calendar-search-form">
    <label>Search terms<input type="search" name="query" required maxlength="256" value="${e(state.search.trim())}"></label>
    <p>Leave dates blank to search all dates and find recurring series. Enter both dates to find individual occurrences in that range (up to 366 days).</p>
    <div class="calendar-search-dates"><label>From<input type="date" name="from"></label><label>Through<input type="date" name="through"></label></div>
    <button class="primary">Search</button>
  </form><p id="calendar-search-status" role="status"></p><ul id="calendar-search-warnings"></ul>
  <div id="calendar-search-results"></div><section id="calendar-search-preview" hidden></section>`);
  const form=dialog.querySelector<HTMLFormElement>('form')!;
  const status=dialog.querySelector<HTMLElement>('#calendar-search-status')!;
  const warnings=dialog.querySelector<HTMLElement>('#calendar-search-warnings')!;
  const results=dialog.querySelector<HTMLElement>('#calendar-search-results')!;
  const preview=dialog.querySelector<HTMLElement>('#calendar-search-preview')!;
  let controller: AbortController|undefined;
  dialog.addEventListener('close',()=>controller?.abort(),{once:true});
  function appendMatch(match: CalendarSearchMatch,label: string) {
    const start=calendarDate(match.start);
    const date=Number.isFinite(+start)?start.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'No date';
    const subtitle=[date,label,match.recurring?'Recurring series':''].filter(Boolean).join(' · ');
    const button=document.createElement('button');
    button.type='button';
    button.innerHTML=`<strong>${e(match.title)}</strong><small>${e(subtitle)}</small>`;
    button.onclick=()=>{
      const end=calendarDate(match.end);
      const when=Number.isFinite(+start)&&Number.isFinite(+end)&&end>start
        ?agendaEventLabel({start,end,allDay:dateOnly(match.start)}):date;
      const stored=match.id&&state.rows.some(row=>row.id===match.id);
      preview.innerHTML=`<button type="button" data-search-back>Back to results</button><h3>${e(match.title)}</h3>
        <p>${e(label)} · ${e(when)}${match.recurring?' · Recurring series':''}</p>
        ${match.location?`<p>${e(match.location)}</p>`:''}${match.body?`<p class="calendar-search-description">${e(match.body)}</p>`:''}
        ${stored?'<button type="button" data-search-open>Open stored event</button>':''}`;
      results.hidden=true;preview.hidden=false;
      const back=preview.querySelector<HTMLButtonElement>('[data-search-back]')!;
      back.onclick=()=>{preview.hidden=true;results.hidden=false;button.focus();};
      back.focus();
      const open=preview.querySelector<HTMLButtonElement>('[data-search-open]');
      if(open)open.onclick=()=>{dialog.close();void attempt(()=>openConnectedRecord(match.id!));};
    };
    results.append(button);
  }
  async function search() {
    controller?.abort();
    const signal=(controller=new AbortController()).signal;
    results.replaceChildren();warnings.replaceChildren();preview.hidden=true;results.hidden=false;
    const fields=new FormData(form);
    const query=String(fields.get('query')??'').trim();
    const from=String(fields.get('from')??''),through=String(fields.get('through')??'');
    const days=(Date.parse(through)-Date.parse(from))/86400000+1;
    if(!query||!!from!==!!through||from&&(days<1||days>366)){
      status.textContent=query?'Choose both dates in order, up to 366 days apart.':'Enter search terms.';
      return;
    }
    const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    let count=0;
    for(const {label,...source} of sources){
      status.textContent=`Searching ${label}… ${count} matches so far.`;
      const warn=(message: string)=>{
        const entry=document.createElement('li');entry.textContent=`${label} — ${message}`;warnings.append(entry);
      };
      try{
        let page='';
        const seen=new Set<string>();
        do {
          const result=await api('calendar-search',{...source,query,from,through,timeZone,page},signal);
          if(signal.aborted||!form.isConnected)return;
          for(const match of result.matches){appendMatch(match,label);count++;}
          if(result.warning)warn(result.warning);
          page=result.next;
          if(page&&seen.has(page))throw Error('The provider repeated a search page.');
          seen.add(page);
        } while(page);
      }catch(cause){
        if(signal.aborted||!form.isConnected)return;
        warn(asError(cause).message);
      }
    }
    status.textContent=sources.length?`${count} ${count===1?'match':'matches'} from connected calendars.`:'No connected calendars are available.';
  }
  form.onsubmit=event=>{event.preventDefault();void search();};
  void search();
}
function renameCalendar(source:{id:string;label:string;originalLabel:string}) {
  const alias=state.prefs.calendarAliases?.[source.id]??'';
  modal('Rename calendar',`<form id="calendar-alias-form">
    ${field('Calendar alias','alias',alias,'text','maxlength="80" aria-describedby="calendar-alias-help"')}
    <p id="calendar-alias-help">Leave blank to use ${e(source.originalLabel)}. This name is only used in Office.</p>
    <p id="calendar-alias-error" class="error" role="alert"></p>
    <div class="dialog-actions"><button type="submit" class="primary">Save alias</button></div>
  </form>`);
  const form=dialog.querySelector<HTMLFormElement>('#calendar-alias-form')!;
  const input=form.elements.namedItem('alias') as HTMLInputElement;
  const save=form.querySelector<HTMLButtonElement>('button')!;
  const close=dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  const preventBusyClose=(event:Event)=>{if(save.disabled)event.preventDefault();};
  dialog.addEventListener('cancel',preventBusyClose);
  dialog.addEventListener('close',()=>{
    dialog.removeEventListener('cancel',preventBusyClose);
    document.querySelector<HTMLButtonElement>(`[data-rename-calendar="${CSS.escape(source.id)}"]`)?.focus();
  },{once:true});
  input.focus();input.select();
  form.onsubmit=async event=>{
    event.preventDefault();
    if(save.disabled)return;
    const value=input.value.trim();
    const calendarAliases={...state.prefs.calendarAliases};
    if(value)calendarAliases[source.id]=value;else delete calendarAliases[source.id];
    save.disabled=close.disabled=true;
    try {
      await api('preferences',{preferences:{...state.prefs,calendarAliases}});
      state.prefs={...state.prefs,calendarAliases};
      calendar.render();
      dialog.close();
    } catch(cause) {
      form.querySelector<HTMLElement>('#calendar-alias-error')!.textContent=asError(cause).message;
    } finally {
      save.disabled=close.disabled=false;
    }
  };
}
function confirmation(title: string,message: string,action: () => unknown,confirmLabel=title) { modal(title,`<p>${e(message)}</p><div class="dialog-actions"><button id="cancel">Cancel</button><button class="primary" id="confirm">${e(confirmLabel)}</button></div>`); dialog.querySelector<HTMLElement>('#cancel')!.onclick=()=>dialog.close();dialog.querySelector<HTMLElement>('#cancel')!.focus();dialog.querySelector<HTMLElement>('#confirm')!.onclick=async()=>{dialog.close();await attempt(action);}; }
let passwordConfirmation: Promise<boolean> | undefined;
function confirmOwnerPassword(): Promise<boolean> {
  passwordConfirmation??=new Promise<boolean>(resolve=>{
    const previousMode=state.mode;
    modal('Confirm your password',`<form id="confirm-password">${field('Office password','password','','password','required autocomplete="current-password"')}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Confirm</button></div></form>`);
    const form=dialog.querySelector<HTMLFormElement>('#confirm-password')!;
    const password=form.querySelector<HTMLInputElement>('input')!;
    const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    let verified=false;
    dialog.addEventListener('close',()=>{password.value='';setMode(previousMode);resolve(verified);},{once:true});
    form.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick=()=>dialog.close();
    password.focus();
    form.onsubmit=async event=>{
      event.preventDefault();
      if(button.disabled)return;
      busyButton(button,true);
      const value=password.value;
      password.value='';
      try {
        await requestApi('reauthenticate',{password:value});
        if(form.isConnected&&dialog.open){verified=true;dialog.close();}
      } catch(cause) {
        form.querySelector<HTMLElement>('.error')!.textContent=asError(cause).message;
        password.focus();
      } finally {busyButton(button,false);}
    };
  }).finally(()=>{passwordConfirmation=undefined;});
  return passwordConfirmation;
}
async function withRecentSignIn<T>(operation: () => Promise<T>): Promise<T> {
  try {return await operation();}
  catch(cause) {
    if(asError(cause).status!==428)throw cause;
    if(!await confirmOwnerPassword())throw new DraftCancelled();
    return operation();
  }
}
function download(name: string,text: BlobPart,type='text/plain') { const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function originalMail(record: OfficeRecord) { return record.meta.rawBase64 ? Uint8Array.from(atob(record.meta.rawBase64),c=>c.charCodeAt(0)) : record.meta.raw || ''; }
async function viewMessageHeaders() {
  const original=state.current!;
  // Read the local record only: mail-content can contact the provider.
  const record=original.summary?(await api(`record&id=${encodeURIComponent(original.id)}`)).record:original;
  if(state.current?.id!==original.id||state.app!=='mail')return;
  const headers=messageHeaders(record.meta);
  const metadata=document.querySelector<HTMLDetailsElement>('#detail [data-mail-disclosure="metadata"]')!;
  const returnFocus=document.activeElement as HTMLElement;
  const fromDetails=metadata.open;
  metadata.open=false;
  modal('Message headers',headers?'<div class="message-headers-tools"><label>Search headers <input type="search" data-header-search aria-describedby="header-search-help" autocomplete="off" spellcheck="false"></label><span data-header-count role="status"></span><button data-header-previous disabled>Previous</button><button data-header-next disabled>Next</button><button data-header-copy>Copy all headers</button></div><p id="header-search-help" class="recurrence-note">/ focuses search; n / p move between matches. In search, Enter / Shift+Enter move between matches.</p><p data-header-status role="status"></p><pre class="message-headers" tabindex="0" aria-label="Original message headers"></pre>':'<p>Original message headers are unavailable for this message.</p>');
  if(headers)setupHeaderViewer(dialog,headers,keys());
  dialog.addEventListener('close',()=>{
    if(state.current?.id===original.id){
      const target=fromDetails||!returnFocus?.isConnected
        ?document.querySelector<HTMLElement>('#detail [data-mail-disclosure="metadata"] > summary'):returnFocus;
      target?.focus();
    }
  },{once:true});
}
async function fullMailRecord(record: OfficeRecord) {
  if(record.meta.headerOnly){
    await pendingMailReads.get(record.id);
    return (await api('mail-content',{id:record.id,account:record.meta.account})).record;
  }
  if(!record.summary)return record;
  const cached=latestMail(record.id);
  if(cached && !cached.summary && cached.revision===record.revision && sameMailTarget(record,cached))return cached;
  return (await api(`record&id=${encodeURIComponent(record.id)}`)).record;
}
function downloadRecordArchive(name: string, records: OfficeRecord[]) {
  download(name+'.json',JSON.stringify({format:'portable-office-items',version:1,records},null,2),'application/json');
}
function waitForMailExport<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    if(signal.aborted)abort();
    else signal.addEventListener('abort',abort,{once:true});
    void work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
let mailExportStatusTimer: ReturnType<typeof setTimeout> | undefined;
async function exportAllMail(complete: boolean) {
  const menu=document.querySelector<HTMLDetailsElement>('#mail-export-menu')!;
  if(menu.inert)return;
  clearTimeout(mailExportStatusTimer);
  const status=document.querySelector<HTMLElement>('#mail-export-status')!;
  const cancel=document.querySelector<HTMLButtonElement>('#cancel-mail-export')!;
  const controller=new AbortController(), signal=controller.signal;
  menu.open=false;
  menu.inert=true;
  cancel.hidden=false;
  cancel.onclick=()=>controller.abort();
  cancel.focus();
  status.textContent='Preparing mail export…';
  try {
    await waitForMailExport(commit(),signal);
    let warning: string | undefined;
    if(complete){
      const {batches}=await api('mail-export-plan',undefined,AbortSignal.any([signal,AbortSignal.timeout(60_000)]));
      const total=batches.reduce((count,batch)=>count+batch.ids.length,0);
      let checked=0;
      for(const batch of batches){
        if(!menu.isConnected)return;
        status.textContent=`Fetching missing bodies · ${checked} of ${total} checked`;
        const deadline=AbortSignal.timeout(60_000);
        const batchSignal=AbortSignal.any([signal,deadline]);
        try{
          const result=await waitForMailExport(api('mail-export-batch',batch,batchSignal),batchSignal);
          warning??=result.warning??undefined;
        }catch(cause){
          signal.throwIfAborted();
          warning??=deadline.aborted?'A message batch timed out.':asError(cause).message;
        }
        checked+=batch.ids.length;
      }
    }
    if(!menu.isConnected)return;
    status.textContent='Preparing mail download…';
    const response=await fetch('api.php?r=mail-export'+(complete?'&complete=1':''),{cache:'no-store',signal});
    if(!response.ok){
      const error=await response.json().catch(()=>null);
      throw Error(error?.error||'The mail archive could not be downloaded.');
    }
    const countHeader=response.headers.get('X-Office-Mail-Count');
    if(countHeader===null)throw Error('The server did not return a mail archive.');
    const count=Number(countHeader),missing=Number(response.headers.get('X-Office-Mail-Header-Only'));
    if(!count){
      await response.body?.cancel();
      if(complete&&missing)throw Error(warning||'No message bodies are available.');
      status.textContent='There is nothing to export yet.';
      return;
    }
    const archive=await response.blob();
    signal.throwIfAborted();
    if(!menu.isConnected)return;
    const name=complete?'mail.sqlite':'mail-cached.sqlite';
    download(name,archive,'application/vnd.sqlite3');
    const result=`Download started · ${name}`+(missing?` · ${missing} ${complete?'skipped':'header-only'}`:'');
    status.textContent=result;
    mailExportStatusTimer=setTimeout(()=>{status.textContent='';},5000);
    if(warning)notice(`${result}. First issue: ${warning}`);
  } catch(cause) {
    if(!menu.isConnected)return;
    if(signal.aborted){
      status.textContent='Mail export canceled';
      return;
    }
    status.textContent='Mail export failed';
    notice(`Mail export failed: ${asError(cause).message}`,true);
  } finally {
    const restoreFocus=document.activeElement===cancel;
    cancel.hidden=true;
    cancel.onclick=null;
    menu.inert=false;
    if(restoreFocus)menu.querySelector('summary')?.focus();
  }
}
async function exportRecords(all=false,selectedRecords: OfficeRecord[] | null=null) {
  await commit(); let records=selectedRecords|| (all&&state.app==='mail'?(await api('records&kind=mail&summaries=1')).records:all?state.rows:[state.current].filter(isPresent)); if(!records.length){notice('There is nothing to export yet.');return;}
  if(state.app==='mail')records=await Promise.all(records.map(record=>fullMailRecord(record)));
  all=all||records.length>1;
  const name=all?state.app:records[0].title;
  if(state.app==='calendar')download(name+'.ics',icsExport(records),'text/calendar');
  else if(state.app==='contacts')download(name+'.vcf',vcardExport(records),'text/vcard');
  else if(state.app==='sheets'&&!all){
    const sheet=workbook(records[0]).sheets[state.sheet];
    modal('Export sheet',`<p>Values only exports calculated results and protects formula-like text. Formulas exports raw cells for use with trusted files.</p><div class="dialog-actions"><button type="button" data-csv="formulas">Export with formulas</button><button type="button" class="primary" data-csv="values">Export values only</button></div>`);
    dialog.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach(button=>button.onclick=()=>void attempt(()=>{
      const csv=sheetCsv(sheet.cells,button.dataset.csv==='formulas'?'formulas':'values');
      dialog.close();
      download(name+'.csv',csv,'text/csv');
    }));
    dialog.querySelector<HTMLButtonElement>('[data-csv=values]')!.focus();
  }
  else if(state.app==='wiki'&&!all)download(name+'.md',records[0].body,'text/markdown');
  else if(state.app==='documents'&&!all)download(name+'.html','<!doctype html><html lang="en"><meta charset="utf-8"><body>'+safeDocument(records[0].body)+'</body></html>','text/html');
  else if(state.app==='mail'&&!all&&(records[0].meta.rawBase64||records[0].meta.raw))download(name+'.eml',originalMail(records[0]),'message/rfc822');
  else downloadRecordArchive(name,records);
}
function renderBackupStatus() {
  const prepare=document.querySelector<HTMLButtonElement>('#backup');
  if(!prepare)return;
  prepare.disabled=!!backupRequest;
  document.querySelector<HTMLProgressElement>('#backup-progress')!.hidden=!backupRequest;
  document.querySelector<HTMLButtonElement>('#backup-download')!.hidden=!preparedBackup;
  document.querySelector<HTMLElement>('#backup-status')!.textContent=backupMessage;
}
async function prepareBackup() {
  if(backupRequest)return;
  const request=new AbortController();
  backupRequest=request;
  preparedBackup=undefined;
  backupMessage='Preparing SQLite backup…';
  renderBackupStatus();
  const tracking=activity.queued(backupMessage);
  activity.running(tracking);
  try {
    const response=await withRecentSignIn(async()=>{
      const result=await fetch('api.php?r=backup',{cache:'no-store',signal:request.signal});
      if(result.status===428)throw Object.assign(Error('Confirm your password to continue.'),{status:428});
      return result;
    });
    if(response.status===401){await lockExpiredSession();return;}
    if(!response.ok){
      const error=await response.json().catch(()=>null);
      throw Error(error?.error||'Could not prepare the backup.');
    }
    if(response.headers.get('Content-Type')!==sqliteBackupType)throw Error('The server did not return a SQLite backup.');
    backupMessage='Receiving SQLite backup…';
    renderBackupStatus();
    const file=await response.blob();
    if(!file.size)throw Error('The SQLite backup was empty.');
    if(backupRequest!==request)return;
    const name=response.headers.get('Content-Disposition')?.match(/filename="(office-backup-\d{4}-\d{2}-\d{2}\.sqlite)"/)?.[1]||'office-backup.sqlite';
    preparedBackup={file,name};
    backupMessage='SQLite backup ready to download.';
  } catch(cause) {
    if(backupRequest===request)backupMessage=cause instanceof DraftCancelled?'Backup canceled.':asError(cause).message;
  } finally {
    activity.done(tracking);
    if(backupRequest===request){backupRequest=undefined;renderBackupStatus();}
  }
}
function confirmBackupRestore(data: File | {backup: object},preferences: Preferences={}) {
  confirmation('Restore backup','Restore into this empty workspace? Synced copies become local archives. Reconnect provider accounts after restoring.',async()=>{
    const result=await api('restore',data);
    state.prefs=result.preferences??preferences;
    applyTheme();await load();notice(`Restored ${result.count} items.`);
  });
}
async function importFile(backupOnly=false) {
  await leaveEditor();const input=document.createElement('input');input.type='file';input.accept=backupOnly?'.sqlite,.json':'.json,.md,.txt,.html,.htm,.csv,.ics,.vcf,.eml';
  input.onchange=()=>void attempt(async()=>{const file=input.files?.[0];if(!file)return;
    const ext=file.name.split('.').at(-1)!.toLowerCase();
    if(backupOnly&&ext==='sqlite'){confirmBackupRestore(file);return;}
    if(backupOnly&&ext!=='json')throw Error('Choose an Office SQLite or JSON backup.');
    if(file.size>8*1024*1024)throw Error('Import files up to 8 MB.');const text=await file.text();let records: ItemInput[]=[];
    if(ext==='ics'||ext==='eml'){const payload: {format: string; text: string; base64?: string}={format:ext,text:ext==='ics'?text:''};if(ext==='eml'){if(file.size>1400000)throw Error('Original EML import supports up to 1.4 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));payload.base64=btoa(binary);}const r=await api('import',payload);notice(`Imported ${r.count} items locally.`);await load();return;}
    if(ext==='json'){const data=JSON.parse(text) as {format?: string; version?: number; records?: ItemInput[]; preferences?: Preferences};if(data.format==='portable-office'){confirmBackupRestore({backup:data},data.preferences);return;}if(backupOnly||data.format!=='portable-office-items'||data.version!==1||!Array.isArray(data.records))throw Error('Unsupported JSON file.');records=data.records;}
    else if(ext==='vcf')records=vcardParse(text);
    else if(ext==='csv') {const rows=csvParse(text);if(rows.length>100||rows.some(r=>r.length>26))throw Error('CSV import supports 100 rows and 26 columns.');const cells: Cells={};rows.forEach((row,r)=>row.forEach((value,c)=>{if(value)cells[colName(c)+(r+1)]=value;}));records=[{kind:'sheets',title:file.name.replace(/\.csv$/i,''),body:'',meta:{workbook:{sheets:[{name:'Sheet 1',cells}]}}}];}
    else if(['md','txt','html','htm'].includes(ext)) {const kind=state.app==='wiki'?'wiki':'documents';const body=kind==='wiki'?text:['html','htm'].includes(ext)?safeDocument(text):text.split('\n').map(line=>'<p>'+e(line)+'</p>').join('');records=[{kind,title:file.name.replace(/\.[^.]+$/,''),body,meta:{}}];}
    else throw Error('Unsupported format.');
    if(records.length>500)throw Error('Import up to 500 items at a time.');
    const result=await api('import-items',{records});await load();notice(`Imported ${result.count} items locally.`);
  });input.click();
}
function resolveAccount(accounts: AppState['accounts'],query: string) {
  const exact=accounts.find(account=>account.id===query);
  if(exact)return exact;
  const matches=accounts.filter(account=>account.label.trim().toLocaleLowerCase()===query.toLocaleLowerCase());
  if(!matches.length)throw new CommandError('No matching account. Use Tab to fill an account from the suggestions.');
  if(matches.length>1)throw new CommandError('Several accounts have that name. Use Tab to select the account you want.');
  return matches[0];
}
async function syncAccounts(manual=true,accountQuery?:string) {
  const accounts=accountQuery===undefined?[...state.accounts]:[resolveAccount(state.accounts,accountQuery)];
  if(updateInstalling || state.syncing || document.hidden || (!manual && Date.now()-state.lastActivity>120000))return;
  if(!accounts.length){if(manual){notice('Add an account in Settings to start syncing.');settingsPage='accounts';await changeApp('settings');}return;}
  if(state.dirty){if(manual)await commit();else return;}
  if(state.syncing)return;
  state.syncing=true;busyButton(document.querySelector<HTMLButtonElement>('#sync-button')!,true);let errors=0;
  const queue=accounts.map(account=>({account,batch:0}));let next=0;
  const active=new Map<string,string>(),pendingHistory=new Set<string>();
  let mailRefresh: Promise<void> | undefined;
  let mailRefreshRequested=false;
  function refreshSyncedMail() {
    mailRefreshRequested=true;
    // A batch finishing during a read needs a follow-up snapshot, but the two
    // workers should never download and render the mailbox concurrently.
    return mailRefresh??=(async()=>{
      try {
        while(mailRefreshRequested){
          mailRefreshRequested=false;
          if(state.app==='mail'&&!state.dirty)await load(undefined,{preserveSelection:true});
        }
      } finally {mailRefresh=undefined;}
    })();
  }
  const showActive=()=>{const status=document.querySelector<HTMLElement>('#sync-status');if(status)status.textContent='Syncing '+[...active.values()].join('; ')+'…';};
  const worker=async()=>{
    while(next<queue.length){
      if(document.hidden || (!manual && Date.now()-state.lastActivity>120000))return;
      const {account:a,batch}=queue[next++];
      try{
        const batchCount=a.type==='imap' && state.prefs.mailOffline!==true && batch>0?5-batch:1;
        active.set(a.id,`${a.label} · batch ${batch+1}${pendingHistory.has(a.id)?' · downloading older mail':''}`);showActive();
        const result=await api('sync',{id:a.id,batches:batchCount});
        if(result.more)pendingHistory.add(a.id);else pendingHistory.delete(a.id);
        if(state.app==='mail'&&!state.dirty)await refreshSyncedMail();
        // Give every account a first pass before continuing older history.
        if(result.more && batch+batchCount<5 && !document.hidden)queue.push({account:a,batch:batch+batchCount});
      }catch(cause) { const error=asError(cause);errors++;if(manual)notice(a.label+': '+error.message,true);}finally{active.delete(a.id);if(active.size)showActive();}
    }
  };
  // Two accounts at a time leave PHP workers available for local browsing and
  // interactive requests. The per-account operation queue still serializes writes.
  try{await Promise.all([worker(),worker()]);}
  finally{state.syncing=false;busyButton(document.querySelector<HTMLButtonElement>('#sync-button'),false);}
  const s=document.querySelector<HTMLElement>('#sync-status');if(s){
    const checked=new Date();s.innerHTML=errors?'Sync needs attention':pendingHistory.size?'Older mail remains · continues on next check':'Checked '+timestampLabel(checked.toISOString(),checked.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
    s.title=pendingHistory.size?'Older messages are still being downloaded for '+accounts.filter(a=>pendingHistory.has(a.id)).map(a=>a.label).join(', ')+'. Each check processes up to five batches.':'';
  }
  state.accounts=(await api('accounts')).accounts;
  // The standard scan already refreshed Inbox/Archive/Trash/Junk. Only custom scopes
  // need another scan (or a larger requested download window).
  const scope=state.mailScope,scopeAccount=state.accounts.find(a=>a.id===scope?.account),scopeFolder=scopeAccount?.folders?.find(f=>f.id===scope?.folder);
  if(!appEntryVisible()&&state.app==='mail'&&scope&&(accountQuery===undefined||scope.account===accounts[0].id)&&!state.dirty&&(scope.limit>100||!['Inbox','Archive','Trash','Junk'].includes(scopeFolder?.role||''))){try{await syncOpenFolder(mailFolderEnv());}catch(cause) { const error=asError(cause);if(manual)notice(error.message,true);}}
  // Never replace an active editor with network data.
  if(state.app==='settings')refreshSettingsAccountStatus();else if(state.app!=='lists'&&!state.dirty&&!editable((document.activeElement as HTMLElement)))await load(undefined,{preserveSelection:state.app==='mail'});
}
function help(button?: HTMLElement) {
  const app=state.app,mobile=phoneLayout.matches;
  const sidebar=(button||document.activeElement)?.closest('.sidebar');
  const pane=sidebar?'sidebar':activePane();
  const record=state.current?.kind===app&&(!mobile||mobileItemOpen)&&!viewingPendingSend()?state.current:null;
  const draft=app==='mail'&&record?.meta.folder==='Drafts';
  const unsaved=!!record&&isUnsavedDraft(),readOnly=!!record&&(!!record.meta.remote&&!providerCalendar(record)||app==='mail'&&!draft);
  let heading: string,guidance: string;
  if(app==='settings'){
    heading='Settings · '+settingsPages.find(([id])=>id===settingsPage)![1];
    guidance=mobile?'Tap Settings categories to switch sections.':'Choose a category, then use Tab to move through its controls.';
    if(settingsPage==='keyboard')guidance+=' Change and save your single-key bindings here.';
  }else{
    const {name,singular,hint}=apps[app];
    heading=record?name+' · '+(draft?'Draft':singular[0].toUpperCase()+singular.slice(1)):name;
    guidance=hint;
    if(app==='mail'&&!record)guidance=mobile?'Tap Folders to choose a mailbox, or tap a message to open it.':'Choose a folder from the sidebar and select a message to read it.';
    if(record){
      if(draft&&!readOnly)guidance='Save the draft to keep working on it later. Use Send message when it’s ready.';
      else if(app==='mail'&&!draft)guidance='Use the message actions to reply or file the message. Open Details to view its original headers.';
      else if(readOnly)guidance='This synced copy is read-only.';
      else if(unsaved)guidance='Save this draft to add it to your workspace.';
      else if(app==='sheets')guidance='Select a cell to navigate the grid or edit its value or formula.';
      else if(app==='lists')guidance='Use the add field to create checklist entries. Select a checkbox to mark an entry done.';
      else if(app==='wiki')guidance='Use Edit source to switch from the rendered page to its Markdown.';
      else guidance='Open a field to edit it. Use Save to keep your changes.';
    }
  }
  const item=record?{
    draft,unsaved,readOnly,complete:!!record.meta.done,
    deletable:app==='mail'?!protectedMail(record):!readOnly&&!record.meta.remote,
    move:app==='mail'&&canQuickMoveMail(state.selected.size?state.rows.filter(row=>state.selected.has(row.id)):[record]),
    reply:app==='mail'&&!!record.meta.from,
  }:undefined;
  const opener=mobile&&sidebar?document.querySelector<HTMLElement>('#mobile-menu'):button;
  openHelp(dialog,keys(),{app,heading,guidance,pane,mobile,item},e,()=>setMode('normal'),()=>{
    if(record?.id!==state.current?.id){notice('The selected item changed. Reopen Help to link it.',true);return;}
    openCommand(':link ');
  },opener);
}
async function history() {await requireSaved();const r=await api(`history&id=${state.current!.id}`);modal('Revision history',r.revisions.map(h=>`<button class="history-row" data-revision="${h.revision}">Revision ${h.revision} · ${e(h.snapshot.title)}</button>`).join('')||'<p>No saved revisions.</p>');dialog.querySelectorAll<HTMLButtonElement>('[data-revision]').forEach(b=>b.onclick=()=>{const h=r.revisions.find(x=>x.revision===Number(b.dataset.revision!))!;modal('Revision '+h.revision,`<pre class="mail-body">${e(h.snapshot.body)}</pre><button id="restore-revision">Restore this content</button>`);dialog.querySelector<HTMLButtonElement>('#restore-revision')!.onclick=()=>void attempt(async()=>{state.current!.title=h.snapshot.title;state.current!.body=h.snapshot.body;state.current!.meta=h.snapshot.meta;state.dirty=true;dialog.close();renderDetail();await commit();});});}
async function handleClick(event: MouseEvent) {
  const agenda=document.querySelector<HTMLDetailsElement>('#top-agenda');
  if(agenda?.open&&!event.composedPath().includes(agenda))agenda.open=false;
  const exportMenu=document.querySelector<HTMLDetailsElement>('#mail-export-menu[open]');
  if(exportMenu&&!event.composedPath().includes(exportMenu))exportMenu.open=false;
  const disclosure=(event.target as HTMLElement).closest<HTMLElement>('[data-mail-disclosure]')?.dataset.mailDisclosure;
  document.querySelectorAll<HTMLDetailsElement>('#detail [data-mail-disclosure][open]').forEach(d=>{if(d.dataset.mailDisclosure!==disclosure)d.open=false;});
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;
  await attempt(async()=>{
    if(button.dataset.app){
      const app=button.dataset.app as AppName;
      if(phoneLayout.matches&&app===state.app&&!appEntryVisible()){
        if(mobileItemOpen)await returnToItemList();
        showMobileMenu(false,true);
      }else if(!phoneLayout.matches&&app==='mail'&&state.app===app&&!appEntryVisible()&&button.closest('.sidebar-collapsed')){
        setMailFolderPanel(false);
      }else await changeApp(app,event.detail===0&&document.activeElement===button);
      return;
    }
    if(button.dataset.action==='mobile-menu'){showMobileMenu(button.getAttribute('aria-expanded')!=='true',true);return;}
    if(button.dataset.action==='mobile-menu-close'){showMobileMenu(false,true);return;}
    if(button.dataset.action==='mobile-disclosure'){setDisclosure(button,button.getAttribute('aria-expanded')!=='true');return;}
    if(appEntryVisible()&&button.dataset.action!=='logout')return;
    if(button.dataset.id!){await clickRecord(button.dataset.id!,event);return;}
    if(button.dataset.wiki!){const page=state.rows.find(r=>r.title===button.dataset.wiki!);if(page){await selectRecord(page.id,false,'linked');}else{confirmation('Create page',`Create “${button.dataset.wiki!}”?`,()=>createRecord({title:button.dataset.wiki!}));}return;}
    if(button.dataset.cell!){selectCell(button.dataset.cell!,true);return;}
    if(button.dataset.sheet!==undefined){await commit();state.sheet=Number(button.dataset.sheet!);state.cell='A1';renderDetail();return;}
    const action=button.dataset.action!;
    if(action==='calendar-search'){openCalendarSearch();return;}
    if(action==='mobile-back'){await backFromMobileItem();return;}
    if(action==='mobile-folders'){
      setDisclosure(document.querySelector('#mobile-folder-toggle'),true);
      showMobileMenu(true);
      document.querySelector<HTMLElement>('#mail-folder')?.focus();
      return;
    }
    if(phoneLayout.matches&&button.closest('.topbar')&&action!=='sync'){
      const more=document.querySelector<HTMLElement>('#mobile-header-more');
      if(more?.getAttribute('aria-expanded')==='true'){setDisclosure(more,false);more.focus({preventScroll:true});}
    }
    if(phoneLayout.matches&&button.closest('.sidebar-bottom'))showMobileMenu(false,true);
    if(action==='item-fullscreen'){toggleItemFullScreen();return;}
    if(action==='connections'){await connections.view(true);return;}
    if(action==='toggle-mail-folders'){setMailFolderPanel(!button.closest('.folders-open'));return;}
    if(action==='close-mail-folders')setMailFolderPanel(false,true);
    if(action==='new')await createRecord();
    if(action==='save')await commit(true);
    if(action==='help')help(button);
    if(action==='sync')await syncAccounts();
    if(action==='file-mail')await fileMail(mailFolderEnv());
    if(action?.startsWith('mail-junk-')&&state.current)await itemMenus.run(action.slice('mail-junk-'.length),[state.current.id],'mail');
    if(action==='trash-mail')await deleteSelectedMail();
    if(action==='restore-mail')await mailAction('restore');
    if(action==='keep-local')await mailAction('keep-local');
    if(action==='discard-copy'){const record=state.current!;await connections.confirmDeletion([record],'Discard copy','Permanently remove this cached recovery copy from Office? Your server mailbox is unaffected.',choices=>mailAction('discard',record,choices));}
    if(action==='import')await importFile();
    if(action==='export')await exportRecords();
    if(action==='export-all')await exportRecords(true);
    if(action==='export-cached-mail'||action==='export-full-mail')await exportAllMail(action==='export-full-mail');
    if(action==='print'){await commit();window.print();}
    if(action==='image')insertImage();
    if(action==='link')insertLink();
    if(action==='text'){await commit();const html=safeDocument(state.current!.body).replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi,'\n').replace(/<br\s*\/?\s*>/gi,'\n');const doc=new DOMParser().parseFromString(html,'text/html');download(state.current!.title+'.txt',doc.body.textContent);}
    if(action==='wiki-mode'){
      if(state.wikiEditing)await viewWikiPage();
      else {await commit();enterEdit();}
    }
    if(action==='history')await history();
    if(action==='delete'){
      if(state.savePromise)await state.savePromise;
      if(isUnsavedDraft()){confirmation('Discard Draft','Discard this unsaved draft?',discardUnsavedDraft);return;}
      if(state.app==='mail')await deleteSelectedMail();
      else {await commit();const record=state.current!;await connections.confirmDeletion([record],'Delete item','Delete this item and its revision history? Export a copy first if you need it.',async choices=>{await commit();const reload=mailDeletionReload();await api('delete',{id:record.id,revision:record.revision,...choices[record.id]});await reload([record.id]);notice('Item deleted.');});}
    }
    if(action==='logout')await signOut();
    if(action==='message-headers')await viewMessageHeaders();
    if(action==='eml'){const record=await fullMailRecord(state.current!);download(record.title+'.eml',originalMail(record),'message/rfc822');}
    if(action==='original-ics'){
      const record=state.current!;
      const ics=record.meta.rawIcs||record.meta.raw||(await api(`calendar-original&id=${encodeURIComponent(record.id)}`)).ics;
      download(record.title+'.ics',ics,'text/calendar');
    }
    if(action==='read')await readMail();
    if(action==='archive')await archiveLocal();
    if(action==='reply'){const original=state.current!;const r=original.meta.headerOnly?await fullMailRecord(original):original;if(state.current?.id!==original.id)return;const match=(r.meta.from||'').match(/<([^>]+)>/);await createRecord({title:/^Re:/i.test(r.title)?r.title:'Re: '+r.title,body:'\n\nOn '+(r.meta.date||'')+', '+(r.meta.from||'')+' wrote:\n'+r.body.split('\n').map(l=>'> '+l).join('\n'),meta:{to:match?match[1]:r.meta.from}},{keepMailList:true,focusBody:true});}
    if(action==='forward'){
      const original=state.current!;await waitForAttachments();await commit();await pendingMailReads.get(original.id);
      const origin=mailDraftOrigin();
      const source=original.meta.headerOnly?await fullMailRecord(original):original;
      const response=await api('mail-files',{id:source.id,action:'forward'});
      mailDraftOrigins.set(response.record.id,origin);
      if(state.app!=='mail'||state.current?.id!==original.id)return;
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
  let accepted=false;
  try{
    await waitForAttachments();
    if(state.app!=='mail'||state.current!==record)return;
    collect();
    if(!mailAccounts().some(a=>a.id===record.meta.sendAccount))throw Error('Choose a sending account first.');
    if(state.prefs.confirmBeforeSend!==false){
      const confirmed=await new Promise(resolve=>{
        confirmation('Send message',`Send this message to ${record.meta.to}?`,()=>resolve(true));
        const confirm=dialog.querySelector<HTMLButtonElement>('#confirm')!;
        confirm.onkeydown=event=>{
          if(event.key==='Enter'&&(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey))event.preventDefault();
        };
        confirm.focus();
        dialog.addEventListener('close',()=>resolve(false),{once:true});
      });
      if(!confirmed)return;
    }
    if(state.app!=='mail'||state.current!==record)return;
    pendingSend=record;
    state.selected.delete(record.id);
    renderList();renderDetail();setMode('normal');
    document.querySelector<HTMLElement>('.mail-send-progress')?.focus({preventScroll:true});
    await commit(true);
    try{
      const result=await api('send',{id:record.id,revision:record.revision,account:record.meta.sendAccount});
      mailReadVersion++;refreshMailRecord(result.record);
      accepted=true;
    }catch(cause){
      const error=asError(cause);
      // Reconcile the draft when a connection drops before a result arrives.
      const latest=error.record??(error.status===undefined?await api(`record&id=${encodeURIComponent(record.id)}`).then(result=>result.record,()=>undefined):undefined);
      if(latest){mailReadVersion++;refreshMailRecord(latest);}
      throw error;
    }
  }finally{
    const stayed=viewingPendingSend(),started=!!pendingSend;
    pendingSend=null;renderSendStatus();
    sendingMail=false;busyButton(document.querySelector<HTMLButtonElement>('#detail [data-action="send"]')!,false);
    if(stayed&&accepted)returnFromMailDraft(record.id);
    else if(started&&state.app==='mail'&&document.querySelector('#detail[aria-label="Selected message"]')){
      renderList();
      if(stayed){const focused=document.activeElement?.matches('.mail-send-progress');renderDetail();if(focused)focusContent();}
    }
    if(accepted)mailDraftOrigins.delete(record.id);
  }
  notice('Message accepted by the provider.');
}
const protectedMail=(r: OfficeRecord)=>r.meta.remote&&['Trash','Recovery copies','Not in Inbox'].includes(r.meta.folder||'');
async function deleteSelectedMail() {
  if(state.app!=='mail')return;
  if(isUnsavedDraft()){document.querySelector<HTMLButtonElement>('#detail [data-action="delete"]')?.click();return;}
  await commit();
  const visible=filteredRows();
  const rows=state.selected.size?visible.filter(r=>state.selected.has(r.id)):[state.current].filter(isPresent).filter(r=>!isPendingSend(r.id));
  if(!rows.length)return;
  if(rows.some(protectedMail)){
    if(rows.length===1)throw Error(rows[0].meta.folder==='Trash'?'This email is already in Trash. Use Restore to Inbox to return it to your inbox.':'This is a recovery copy. Use Save locally to keep it or Discard copy to remove only the cached copy.');
    throw Error('The selection includes messages in Trash or recovery copies. Deselect them before deleting.');
  }
  const ids=rows.map(r=>r.id),local=rows.filter(r=>!r.meta.remote).length;
  const apply=async(choices:ConnectionDeletionChoices)=>{
    if(state.app!=='mail')throw Error('The application changed. Select the messages again.');
    await commit();
    const current=ids.map(id=>state.rows.find(r=>r.id===id));
    if(current.some(r=>!r||protectedMail(r)||!!r.meta.remote!==!!rows.find(original=>original.id===r.id)!.meta.remote))throw Error('The selected messages changed. Select them again.');
    await deleteMailImmediately(current.filter(isPresent),r=>r.meta.remote?api('mail-action',{id:r.id,revision:r.revision,action:'trash',undoable:true}):api('delete',{id:r.id,revision:r.revision,undoable:true,...choices[r.id]}),true);
    notice(rows.length===1?(local?'Item deleted.':'Moved to Trash.'):`${rows.length} items updated.`);
  };
  const singleDraft=rows.length===1&&rows[0].meta.folder==='Drafts';
  await connections.confirmDeletion(rows,singleDraft?'Discard Draft':local?(rows.length===1?'Delete item':'Delete selected messages'):'Move to Trash',singleDraft?'Discard this saved draft? Undo is available for fifteen minutes.':`Delete ${local} local message(s)${local<rows.length?` and move ${rows.length-local} provider message(s) to Trash`:''}? Undo is available for fifteen minutes.`,apply,!local);
}
async function archiveLocal() {
  if(state.app!=='mail')return;await commit();const ids=(state.selected.size?[...state.selected]:[state.current?.id].filter(isPresent)).filter(id=>!isPendingSend(id));let count=0;
  if(!ids.length)return;
  const rows=ids.map(id=>state.rows.find(r=>r.id===id)).filter(isPresent);
  if(rows.length && rows.every(r=>r.meta.remote && r.meta.folder!=='Archive')){
    await deleteMailImmediately(rows,r=>api('mail-action',{id:r.id,revision:r.revision,action:'archive'}));
    notice(`Archived ${rows.length} messages.`);return;
  }
  const reconciled=new Set<string>(),reload=mailDeletionReload();
  try {
    for(const id of ids){if(reconciled.has(id)){count++;continue;}const r=state.rows.find(r=>r.id===id)!;await pendingMailReads.get(id!);if(r.meta.remote){const result=await api('mail-action',{id:r.id,revision:r.revision,action:'archive'});for(const related of result.removedIds||[])reconciled.add(related);}else{r.meta.folder='Archive';await api('save',r);}count++;}
  } catch(cause) { const error=asError(cause);
    // The provider check may have corrected cached membership even when the move failed.
    try { await load(); } catch {}
    throw error;
  }
  await reload(ids);notice(`Archived ${count} messages.`);
}
async function mailAction(action: string,record=state.current,choices:ConnectionDeletionChoices={}) {
  if(state.app!=='mail'||!record)return;await commit();
  if(['trash','discard'].includes(action)){
    await deleteMailImmediately([record],r=>api('mail-action',{id:r.id,revision:r.revision,action,undoable:action==='trash',...choices[r.id]}),action==='trash');
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
  finally {state.syncing=false;busyButton(button,false);busyButton(document.querySelector<HTMLButtonElement>('#sync-button')!,false);state.accounts=(await api('accounts')).accounts;if(state.app==='settings')refreshSettingsAccountStatus();else await load();}
}
function applyMailReadResult(original: OfficeRecord,previousRevision: number,updated: OfficeRecord) {
  const identity=(row: OfficeRecord)=>JSON.stringify([row.id,row.kind,...(['remote','account','source','serverFolder','uidValidity','providerId','folder'] as const).map(key=>row.meta[key])]);
  if(identity(original)!==identity(updated))return;
  const update=(row: OfficeRecord | null)=>{
    if(row&&identity(row)===identity(original)&&row.revision<=updated.revision&&(row.revision===previousRevision||sameMailTarget(row,updated))){
      row.meta.read=updated.meta.read;row.revision=updated.revision;row.updated=updated.updated;
    }
  };
  update(original);
  if(state.app==='mail'){
    state.rows.forEach(update);update(state.current);updateMailListItem(original.id);
    if(state.current?.id===original.id){const button=document.querySelector<HTMLButtonElement>('#detail [data-action="read"]');if(button)button.textContent=`Mark ${state.current.meta.read?'unread':'read'}`;}
  }
}
async function setMailRead(record: OfficeRecord,read: boolean) {
  await pendingMailReads.get(record.id);
  const current=state.app==='mail'?state.rows.find(row=>row.id===record.id):undefined;
  const target=current||record,previousRevision=target.revision;
  const snapshot=structuredClone(target);
  mailReadVersion++;
  const pending=(async()=>{
    try {
      const result=await api(target.meta.remote?'mail-action':'save',target.meta.remote?{id:target.id,revision:previousRevision,action:read?'read':'unread'}:{...snapshot,meta:{...snapshot.meta,read}});
      if(!result.record)throw Error('The server did not return the updated message.');
      applyMailReadResult(snapshot,previousRevision,result.record);
      return {...result,record:result.record,previousRevision};
    }finally{pendingMailReads.delete(record.id);mailReadVersion++;}
  })();
  pendingMailReads.set(record.id,pending);
  await pending;
}
function markOpenedMailRead(record: OfficeRecord) {
  if(record.meta.read || ['Drafts','Sending','Delivery uncertain','Recovery copies','Not in Inbox'].includes(record.meta.folder||'') || pendingMailReads.has(record.id)||pendingSwipeActions.has(record.id))return;
  const previousRevision=record.revision;
  mailReadVersion++;
  // Rendering and navigation remain synchronous; only mutations of this message wait.
  const pending=(async()=>{
    try {
      const result=await api(record.meta.remote?'mail-action':'save',record.meta.remote?{id:record.id,revision:previousRevision,action:'read'}:{...record,meta:{...record.meta,read:true}});
      const updatedRecord=result.record;
      if(!updatedRecord)throw Error('The server did not return the updated message.');
      applyMailReadResult(record,previousRevision,updatedRecord);
      return {...result,record:updatedRecord,previousRevision};
    } catch(cause) { const error=asError(cause); notice('Could not mark message as read: '+error.message,true); }
    finally { pendingMailReads.delete(record.id);mailReadVersion++; }
  })();
  pendingMailReads.set(record.id,pending);
}
async function readMail() {
  if(state.app!=='mail'||!state.current)return;await commit();const r=state.current;
  await pendingMailReads.get(r.id);
  await setMailRead(r,!r.meta.read);
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
function renderJunkSettings() {
  const container=document.querySelector<HTMLElement>('#mail-junk-settings')!;
  const accounts=mailAccounts();
  container.innerHTML=`<h3>Junk mail</h3><p>Spam verdicts in message headers flag suspected junk for review. Block rules move future Inbox arrivals to Junk when Office syncs.</p>${accounts.length?`<label>Mail account<select aria-label="Junk mail account">${accounts.map(a=>`<option value="${e(a.id)}">${e(a.label)}</option>`).join('')}</select></label><div data-junk-rules></div>`:'<p>Connect a mail account to add block rules.</p>'}`;
  if(!accounts.length)return;
  const select=container.querySelector('select')!,panel=container.querySelector<HTMLElement>('[data-junk-rules]')!;
  const render=async()=>{
    const account=select.value;
    const current=accounts.find(a=>a.id===account)!;
    panel.textContent='Loading junk settings…';
    try {
      const settings=await api('mail-junk-settings',{account});
      if(select.value===account)draw(settings);
    } catch(cause) {
      if(select.value===account)panel.textContent=asError(cause).message;
    }
    function draw(settings: ApiResponse<'mail-junk-settings'>) {
      panel.innerHTML=`<ul>${settings.rules.map((rule,index)=>`<li>${rule.type==='domain'?'Domain':'Sender'} · ${e(rule.target)} <button type="button" data-unblock="${index}" class="mobile-icon-button" aria-label="Unblock ${e(rule.target)}">${mobileActionLabel('close','Remove')}</button></li>`).join('')}</ul>
        <form data-block-rule><label>Rule type<select name="type"><option value="sender">Sender</option><option value="domain">Exact domain</option></select></label><label>Email address or domain<input name="target" required maxlength="254"></label><button class="mobile-icon-button" aria-label="Add block rule">${mobileActionLabel('add','Add block rule')}</button></form>
        ${current.type==='imap'?`<form data-junk-folder><label>IMAP Junk folder override<input name="folder" value="${e(settings.folder)}" maxlength="500"></label><p>Enter an existing folder’s full path, or leave blank to discover it automatically.</p><button>Save Junk folder</button></form>`:''}`;
      const update=(data: ApiData)=>void attempt(async()=>{
        const result=await api('mail-junk-settings',{account,...data});
        if(select.value===account)draw(result);
        notice('Junk settings saved.');
      });
      panel.querySelectorAll<HTMLButtonElement>('[data-unblock]').forEach(button=>button.onclick=()=>update({operation:'remove',...settings.rules[Number(button.dataset.unblock)]}));
      panel.querySelector<HTMLFormElement>('[data-block-rule]')!.onsubmit=event=>{
        event.preventDefault();
        update({operation:'add',...Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement))});
      };
      const folderForm=panel.querySelector<HTMLFormElement>('[data-junk-folder]');
      if(folderForm)folderForm.onsubmit=event=>{
        event.preventDefault();
        update({operation:'folder',folder:new FormData(folderForm).get('folder')});
      };
    }
  };
  select.onchange=()=>void render();
  void render();
}
const settingsPages=[['appearance','Appearance'],['mail','Mail'],['mail-rules','Mail Rules'],['calendar','Calendar'],['accounts','Accounts'],['activity-log','Activity Log'],['connections','Connections'],['keyboard','Keyboard'],['backups','Backups'],['swipe','Swipe Actions'],['updates','Updates']] as const;
let updateInstalling=false;
let updateChecking=false;
let updateRelease: ApiResponse<'update-check'> | undefined;
let updateMessage='';

function renderUpdateStatus() {
  const panel=document.querySelector<HTMLElement>('#settings-updates');
  if(!panel)return;
  panel.querySelector<HTMLElement>('#update-status')!.textContent=updateMessage;
  panel.querySelector<HTMLButtonElement>('#check-update')!.disabled=updateChecking||updateInstalling;
  const release=updateRelease;
  const notes=panel.querySelector<HTMLAnchorElement>('#update-notes')!;
  const download=panel.querySelector<HTMLAnchorElement>('#update-download')!;
  const install=panel.querySelector<HTMLButtonElement>('#install-update')!;
  notes.hidden=!release?.notes;
  download.hidden=!release?.download;
  install.hidden=!release?.canInstall;
  install.disabled=!release?.canInstall||updateInstalling||updateChecking;
  if(release?.notes)notes.href=release.notes;
  if(release?.download)download.href=release.download;
}

async function checkOfficeUpdate() {
  updateChecking=true;
  updateRelease=undefined;
  updateMessage='Checking for updates…';
  renderUpdateStatus();
  try {
    updateRelease=await api('update-check');
    const {latest,available,canInstall}=updateRelease;
    updateMessage=available
      ?`Office ${latest} is available. ${canInstall?'Install it when you’re ready to restart.':'Download the package to update this installation.'}`
      :latest?'Office is up to date.':'No signed update is available. You can check GitHub Releases.';
  } catch(cause) {updateMessage=asError(cause).message;}
  finally {updateChecking=false;renderUpdateStatus();}
}

async function installOfficeUpdate(version: string) {
  await leaveEditor();
  if(state.syncing||pendingWrites||mailAccountQueue.size)throw Error('Wait for current Office operations to finish, then try again.');
  updateInstalling=true;
  updateMessage='Preparing the update…';
  renderUpdateStatus();
  try {
    const {job}=await withRecentSignIn(()=>api('update-install',{version}));
    const phaseMessages: Record<string,string>={
      downloading:'Downloading and verifying the Windows release…',
      waiting:'Waiting for active requests to finish…',
      installing:'Creating a recovery snapshot and restarting Office…',
    };
    const deadline=Date.now()+15*60*1000;
    while(Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,2000));
      let phase: string | undefined;
      try {
        const response=await fetch('api.php?r=update-progress&job='+encodeURIComponent(job),{cache:'no-store',signal:AbortSignal.timeout(4000)});
        if(response.ok)phase=(await response.json() as {phase: string}).phase;
      } catch { /* The local server is briefly offline during restart. */ }
      if(phase==='complete'){
        if(state.dirty||state.savePromise)updateMessage='Office updated. Reload this tab after saving your edits.';
        else location.reload();
        return;
      }
      if(phase==='failed')throw Error('The update did not finish. Office kept or restored the previous version. See the private update log for details.');
      if(phase==='recovery')throw Error('The update needs recovery. Follow the Windows recovery instructions in the Office README.');
      updateMessage=phaseMessages[phase??'']??'Waiting for Office to come back online…';
      renderUpdateStatus();
    }
    throw Error('The update did not report a result. Check the Windows update log and recovery instructions.');
  } catch(cause) {
    updateMessage=cause instanceof DraftCancelled?'Update cancelled.':asError(cause).message;
  } finally {updateInstalling=false;renderUpdateStatus();}
}
const settingsPageKey='office-settings-page';
let settingsPage='appearance';
try {
  const savedPage=sessionStorage.getItem(settingsPageKey);
  if(savedPage&&settingsPages.some(([id])=>id===savedPage))settingsPage=savedPage;
} catch {/* Storage may be unavailable. */}
function selectSettingsPage(page: string) {
  settingsPage=page;
  try {sessionStorage.setItem(settingsPageKey,page);} catch {/* Keep the in-page choice. */}
}
function settingsAccountStatus(account:AppState['accounts'][number]) {
  const checked=account.last_sync?'Last checked '+timestampLabel(account.last_sync,new Date(account.last_sync).toLocaleString()):'Not checked yet';
  const calendar=account.calendar;
  const count=calendar?.calendars.length??0;
  const calendarMessage=calendar?.approval?'Calendar connection needs approval in Edit'
    :calendar?.error?'Calendar connection needs attention in Edit'
    :count ? count+(count===1?' calendar connected':' calendars connected'):'';
  return checked+(account.error?' · '+e(account.error):'')+(calendarMessage?' · '+e(calendarMessage):'');
}
function refreshSettingsAccountStatus() {
  for(const status of document.querySelectorAll<HTMLElement>('#settings-accounts [data-account-status]')){
    const account=state.accounts.find(a=>a.id===status.dataset.accountStatus);
    if(account)status.innerHTML=settingsAccountStatus(account);
  }
}
function renderSettings(entryVersion?: number) {
  if(state.app!=='settings'||(appEntryVisible()&&entryVersion!==appEntryVersion))return;
  renderAppHeader();
  const p=state.prefs;
  const swipe=swipePreferences(p.swipe);
  const swipeSelect=(scope: keyof SwipePreferences,direction: 'left' | 'right')=>{
    const options=scope==='mail'?mailSwipeActions:itemSwipeActions;
    return `<label>Swipe ${direction}<select name="${scope}-${direction}">${Object.entries(options).map(([action,label])=>`<option value="${action}"${swipe[scope][direction]===action?' selected':''}>${label}</option>`).join('')}</select></label>`;
  };
  const linkLimit=p.linkAutocomplete?.limit??20;
  const linkSortOptions={
    'modified-desc':'Date modified · newest first',
    'modified-asc':'Date modified · oldest first',
    'title-asc':'Title · A–Z',
    'title-desc':'Title · Z–A',
  };
  const main=document.querySelector<HTMLElement>('#main')!;
  const focused=document.activeElement as HTMLElement|null;
  const focusedCategory=focused?.closest<HTMLElement>('[data-settings-category]')?.dataset.settingsCategory;
  const focusedPage=focused?.closest<HTMLElement>('[data-settings-page]')?.dataset.settingsPage;
  main.innerHTML=`<div class="settings">
    ${mobileDisclosure('settings-categories',e(settingsPages.find(([id])=>id===settingsPage)![1])+' · Settings categories')}
    <nav id="settings-categories" class="settings-navigation mobile-collapsible" aria-label="Settings categories">
      ${settingsPages.map(([id,label])=>`<button type="button" data-settings-category="${id}" aria-label="${label} settings" aria-controls="settings-${id}" aria-current="${settingsPage===id?'page':'false'}" tabindex="${settingsPage===id?0:-1}">${label}</button>`).join('')}
    </nav>
    <section class="settings-grid" id="settings-appearance" data-settings-page="appearance"${settingsPage==='appearance'?'':' hidden'}>
      <section class="card"><h2>Look & feel</h2><p>Choose a theme, accent color, and density.</p><form id="preferences">
        <label>Theme<select name="theme" aria-label="Theme">${['system','light','dark'].map(x=>`<option ${p.theme===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Accent<select name="accent" aria-label="Accent">${['green','blue','plum'].map(x=>`<option ${p.accent===x?'selected':''}>${x}</option>`).join('')}</select></label>
        <label>Density<select name="density" aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact" ${p.density==='compact'?'selected':''}>Compact</option></select></label>
        <label class="check-label"><input type="checkbox" name="showElapsedTime" ${p.showElapsedTime!==false?'checked':''}> Show elapsed time beside dates</label>
        <button class="primary">Save preferences</button>
      </form></section>
    </section>
    <section class="settings-grid" id="settings-mail" data-settings-page="mail"${settingsPage==='mail'?'':' hidden'}>
      <section class="card"><h2>Reading and sending</h2><form id="mail-preferences">
        <label>Default email display<select name="mailDisplay" aria-label="Default email display"><option value="html" ${p.mailDisplay!=='text'?'selected':''}>HTML</option><option value="text" ${p.mailDisplay==='text'?'selected':''}>Text only</option></select></label>
        <label class="check-label"><input type="checkbox" name="mailOffline" ${p.mailOffline===true?'checked':''}> Download message contents during sync for offline use</label>
        <label>Default mail account<select name="defaultMailAccount" aria-label="Default mail account"><option value="">Automatic (only account, when available)</option>${mailAccounts().map(a=>`<option value="${e(a.id)}" ${p.defaultMailAccount===a.id?'selected':''}>${e(a.label)}</option>`).join('')}</select></label><p>New drafts use the selected message’s account first, then this default. Saved drafts keep their chosen account.</p><label class="check-label"><input type="checkbox" name="confirmBeforeSend" ${p.confirmBeforeSend!==false?'checked':''}> Confirm before sending</label>
        <button class="primary">Save mail preferences</button>
      </form></section>
      <section class="card" id="mail-list-settings"></section>
      <section class="card"><h2>Junk and recovery</h2><div id="mail-junk-settings"></div><h3>Recovery copies</h3><label class="check-label"><input id="keep-recovery" type="checkbox" ${p.keepRecoveryCopies!==false?'checked':''}> Keep recovery copies of messages absent from synchronized folders</label><p>Recovery copies are excluded from All cached mail. Save them in Local mail or discard them. Turning this off removes absent cached copies on the next successful sync; local mail is kept.</p></section>
    </section>
    <section class="settings-grid" id="settings-mail-rules" data-settings-page="mail-rules"${settingsPage==='mail-rules'?'':' hidden'}>
      <section class="card" id="mail-rules-panel"><h2>Mail Rules</h2><p>Loading rules…</p></section>
    </section>
    <section class="settings-grid" id="settings-calendar" data-settings-page="calendar"${settingsPage==='calendar'?'':' hidden'}>
      <section class="card"><h2>Calendar display</h2><form id="calendar-preferences">
        ${calendarDisplayFields.map(({name,label,max})=>`<label>${label}<input type="number" name="${name}" min="1" max="${max}" step="1" required value="${calendarDisplayLimit(name,p.calendarDisplay)}"></label>`).join('')}
        <button class="primary">Save calendar preferences</button>
      </form></section>
    </section>
    <section class="settings-grid" id="settings-accounts" data-settings-page="accounts"${settingsPage==='accounts'?'':' hidden'}>
      <section class="card"><h2>Connected accounts</h2><div>${state.accounts.map(a=>`<div class="account"><div><strong>${e(a.label)} <span class="badge">${e(a.type)}</span></strong><small data-account-status="${e(a.id)}">${settingsAccountStatus(a)}</small></div><div class="actions"><button data-edit-account="${e(a.id)}" aria-label="Edit account ${e(a.label)}">Edit</button>${['imap','google'].includes(a.type)?`<button data-repair-account="${a.id}">Repair / resync</button>`:''}${a.type==='google'?`<button data-google="${a.id}">Authorize</button>${a.googleCalendarEnabled===false?`<button data-google="${a.id}" data-enable-calendar>Enable Calendar</button>`:''}`:''}<button class="danger quiet mobile-icon-button" data-remove-account="${a.id}" aria-label="Remove account ${e(a.label)}">${mobileActionLabel('close','Remove')}</button></div></div>`).join('')||'<p>No accounts connected. Your local apps work without a provider.</p>'}</div><button id="add-account" class="mobile-icon-button" aria-label="Add account">${mobileActionLabel('add','+ Add account')}</button></section>
      <section class="card" id="google-integration"><h2>Google integration</h2><p>Loading…</p></section>
      <section class="card"><details><summary>Sync and connection details</summary><p>Office checks accounts every two minutes while the app is visible and you’ve used it in the last two minutes. You can also choose Sync now. Inbox, Archive, Trash and Junk: headers download in resumable batches of 100, including older history. Message bodies download when opened, or during sync when offline downloads are enabled. Folder membership is reconciled against the server. Agenda: previous week through next 90 days, up to 100 events. Previously downloaded mail remains available offline.</p><p>IMAP uses TLS port 993; SMTP uses TLS port 465 with the same credentials. Office looks for CalDAV calendars on non-Google IMAP accounts. Edit the account to retry or enter a calendar URL. Public hostnames only. For Gmail email without Google integration setup, choose Gmail — app password in Add account. For Google sign-in and optional Calendar access, use the Google integration settings.</p></details></section>
    </section>
    <section class="settings-grid" id="settings-connections" data-settings-page="connections"${settingsPage==='connections'?'':' hidden'}>
      <section class="card"><h2>Link autocomplete</h2><form id="link-preferences">
        <label>Maximum suggestions<input name="limit" type="number" min="1" max="100" step="1" required value="${Number.isInteger(linkLimit)&&linkLimit>=1&&linkLimit<=100?linkLimit:20}"></label>
        <label>Sort suggestions by<select name="sort">${Object.entries(linkSortOptions).map(([key,label])=>`<option value="${key}" ${p.linkAutocomplete?.sort===key?'selected':''}>${label}</option>`).join('')}</select></label>
        <button class="primary">Save link preferences</button>
      </form></section>
    </section>
    <section class="settings-grid" id="settings-keyboard" data-settings-page="keyboard"${settingsPage==='keyboard'?'':' hidden'}>
      <section class="card"><h2>Keyboard bindings</h2><p>Home-row navigation is on by default. Remap single-character actions below. Full Vim text operators and visual selections inside document editors are future work.</p><form id="key-form"><div class="fields">${Object.entries(defaultKeys).map(([action,key])=>field(action,'key_'+action,keys()[action],'text','required maxlength="1"')).join('')}</div><button class="primary">Save bindings</button></form></section>
    </section>
    <section class="settings-grid" id="settings-activity-log" data-settings-page="activity-log"${settingsPage==='activity-log'?'':' hidden'}>
      <section class="card"><h2>Activity Log</h2><form id="activity-log-preferences">
        <label>Logging level<select id="activity-log-level" name="activityLogLevel" aria-label="Logging level" aria-describedby="activity-log-level-help">
          <option value="summary">Summary (default)</option>
          <option value="warnings" ${p.activityLogLevel==='warnings'?'selected':''}>Warnings and errors</option>
          <option value="detailed" ${p.activityLogLevel==='detailed'?'selected':''}>Detailed</option>
        </select></label>
        <div id="activity-log-level-help">
          <p><strong>Summary</strong> saves operation outcomes and distinct warnings and errors. Completed item actions keep their links.</p>
          <p><strong>Warnings and errors</strong> saves only warnings and errors. <strong>Detailed</strong> also saves folder checks, batch progress and connection diagnostics.</p>
          <p>Changes apply to new operations. Live progress appears in the status bar at every level.</p>
        </div>
        <button class="primary">Save logging level</button>
      </form></section>
    </section>
    <section class="settings-grid" id="settings-backups" data-settings-page="backups"${settingsPage==='backups'?'':' hidden'}>
      <section class="card"><h2>Backups</h2><p>SQLite backups include local records, cached messages, saved attachments, revisions, connections and preferences. Account credentials and your password are excluded.</p><button id="backup">Prepare backup</button> <button id="backup-download" hidden>↓ Download SQLite backup</button><div><progress id="backup-progress" aria-label="Backup progress" hidden></progress><div id="backup-status" role="status"></div></div><p>Restore a SQLite or JSON backup into an empty installation. Synced copies become local archives. Reconnect provider accounts after restoring.</p><button id="restore">↑ Restore backup</button></section>
    </section>
    <section class="settings-grid" id="settings-updates" data-settings-page="updates"${settingsPage==='updates'?'':' hidden'}>
      <section class="card"><h2>Office updates</h2>
        <p>Installed version ${e(document.querySelector<HTMLMetaElement>('meta[name="office-version"]')?.content||'unknown')}</p>
        <div class="actions"><button id="check-update">Check for updates</button> <button class="primary" id="install-update" hidden>Install and restart</button></div>
        <p id="update-status" role="status"></p>
        <p><a id="update-download" hidden>Download ZIP</a> <a id="update-notes" target="_blank" rel="noopener noreferrer" hidden>Release notes</a> <a href="https://github.com/elgiad007/office/releases" target="_blank" rel="noopener noreferrer">GitHub Releases</a></p>
      </section>
    </section>
    <section class="settings-grid" id="settings-swipe" data-settings-page="swipe"${settingsPage==='swipe'?'':' hidden'}>
      <section class="card"><h2>Swipe actions</h2><p>Swipe across a row on a touchscreen or with a pen. Move to folder opens the folder picker for synced mail.</p>
        <form id="swipe-preferences">
          <fieldset><legend>Mail</legend>${swipeSelect('mail','left')}${swipeSelect('mail','right')}</fieldset>
          <fieldset><legend>Other items</legend>${swipeSelect('items','left')}${swipeSelect('items','right')}</fieldset>
          <button class="primary">Save swipe actions</button>
        </form>
      </section>
    </section>
  </div>`;
  const categories=main.querySelectorAll<HTMLButtonElement>('[data-settings-category]');
  const pages=main.querySelectorAll<HTMLElement>('[data-settings-page]');
  let rulesLoaded=false;
  const loadRules=()=>{
    if(settingsPage!=='mail-rules'||rulesLoaded)return;
    rulesLoaded=true;
    void renderMailRules(main.querySelector<HTMLElement>('#mail-rules-panel')!,{request:api,accounts:mailAccounts(),escape:e,notice});
  };
  loadRules();
  pages.forEach(page=>{
    page.tabIndex=-1;
    page.setAttribute('aria-label',settingsPages.find(([id])=>id===page.dataset.settingsPage)![1]+' settings');
    page.addEventListener('focusin',()=>categories.forEach(category=>category.tabIndex=category.dataset.settingsCategory===settingsPage?0:-1));
  });
  main.querySelector<HTMLElement>('.settings-navigation')!.addEventListener('focusin',event=>{
    categories.forEach(category=>category.tabIndex=category===event.target?0:-1);
  });
  categories.forEach(button=>button.onclick=()=>{
    selectSettingsPage(button.dataset.settingsCategory!);
    categories.forEach(category=>category.setAttribute('aria-current',category===button?'page':'false'));
    pages.forEach(page=>page.hidden=page.dataset.settingsPage!==settingsPage);
    const categoryToggle=main.querySelector<HTMLElement>('#settings-categories-toggle')!;
    categoryToggle.textContent=button.textContent+' · Settings categories';
    if(phoneLayout.matches){setDisclosure(categoryToggle,false);categoryToggle.focus({preventScroll:true});}
    loadRules();
    main.scrollTop=0;
  });
  bindMailListSettings(document.querySelector<HTMLElement>('#mail-list-settings')!,p.mailList,async layout=>{await attempt(async()=>{const preferences={...state.prefs,mailList:layout};await api('preferences',{preferences});state.prefs=preferences;notice('List appearance saved.');});});
  void renderGoogleSettings(document.querySelector<HTMLElement>('#google-integration')!,api);
  document.querySelector<HTMLFormElement>('#preferences')!.onsubmit=ev=>{ev.preventDefault();void attempt(async()=>{const form=ev.target as HTMLFormElement,preferences={...state.prefs,...Object.fromEntries(new FormData(form)),showElapsedTime:(form.elements.namedItem('showElapsedTime') as HTMLInputElement).checked};await api('preferences',{preferences});state.prefs=preferences;applyTheme();notice('Preferences saved.');});};
  document.querySelector<HTMLFormElement>('#calendar-preferences')!.onsubmit=event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget as HTMLFormElement);
    const calendarDisplay={month:Number(form.get('month')),agenda:Number(form.get('agenda')),header:Number(form.get('header'))};
    void attempt(async()=>{
      const preferences={...state.prefs,calendarDisplay};
      await api('preferences',{preferences});
      state.prefs=preferences;
      notice('Calendar preferences saved.');
    });
  };
  document.querySelector<HTMLFormElement>('#swipe-preferences')!.onsubmit=event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget as HTMLFormElement);
    const preferences={...state.prefs,swipe:swipePreferences({
      mail:{left:form.get('mail-left'),right:form.get('mail-right')},
      items:{left:form.get('items-left'),right:form.get('items-right')},
    })};
    void attempt(async()=>{
      await api('preferences',{preferences});state.prefs=preferences;notice('Swipe actions saved.');
    });
  };
  document.querySelector<HTMLFormElement>('#activity-log-preferences')!.onsubmit=event=>{
    event.preventDefault();
    const level=document.querySelector<HTMLSelectElement>('#activity-log-level')!.value;
    const activityLogLevel=level==='warnings'||level==='detailed'?level:'summary';
    void attempt(async()=>{
      const preferences: Preferences={...state.prefs,activityLogLevel};
      await api('preferences',{preferences});state.prefs=preferences;notice('Logging level saved.');
    });
  };
  renderJunkSettings();
  document.querySelector<HTMLFormElement>('#link-preferences')!.onsubmit=event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget as HTMLFormElement);
    const linkAutocomplete={limit:Number(form.get('limit')),sort:String(form.get('sort'))};
    void attempt(async()=>{
      const preferences={...state.prefs,linkAutocomplete};
      await api('preferences',{preferences});state.prefs=preferences;notice('Link preferences saved.');
    });
  };
  document.querySelector<HTMLFormElement>('#mail-preferences')!.onsubmit=event=>{event.preventDefault();void attempt(async()=>{const preferences={...state.prefs,...Object.fromEntries(new FormData(event.target as HTMLFormElement)),mailOffline:((event.target as HTMLFormElement).elements.namedItem('mailOffline') as HTMLInputElement).checked,confirmBeforeSend:((event.target as HTMLFormElement).elements.namedItem('confirmBeforeSend') as HTMLInputElement).checked};await api('preferences',{preferences});state.prefs=preferences;notice('Mail preferences saved.');});};
  document.querySelector<HTMLFormElement>('#key-form')!.onsubmit=ev=>{ev.preventDefault();void attempt(async()=>{const map=Object.fromEntries([...new FormData(ev.target as HTMLFormElement)].map(([k,v])=>[k.slice(4),v as string]));if(new Set(Object.values(map)).size!==Object.values(map).length)throw Error('Choose a different key for each action.');if(Object.values(map).some(v=>'gGnN0123456789'.includes(v)||/\s/.test(v)))throw Error('g/G, n/N, numbers and whitespace are reserved.');state.prefs.keys=map;await api('preferences',{preferences:state.prefs});notice('Bindings saved.');});};
  document.querySelector<HTMLButtonElement>('#backup')!.onclick=()=>void prepareBackup();
  document.querySelector<HTMLButtonElement>('#backup-download')!.onclick=()=>{
    if(preparedBackup)download(preparedBackup.name,preparedBackup.file,sqliteBackupType);
  };
  renderBackupStatus();
  main.querySelector<HTMLButtonElement>('#check-update')!.onclick=()=>void checkOfficeUpdate();
  main.querySelector<HTMLButtonElement>('#install-update')!.onclick=()=>{
    const version=updateRelease?.latest;
    if(version&&updateRelease?.canInstall&&!updateInstalling)confirmation('Install Office '+version,'Office will restart after downloading the update. Save any open edits in other Office tabs first.',()=>installOfficeUpdate(version),'Install and restart');
  };
  renderUpdateStatus();
  document.querySelector<HTMLButtonElement>('#restore')!.onclick=()=>void attempt(()=>importFile(true));
  document.querySelector<HTMLButtonElement>('#add-account')!.onclick=()=>void accountDialog();
  document.querySelectorAll<HTMLButtonElement>('[data-edit-account]').forEach(b=>b.onclick=()=>void attempt(()=>accountDialog(b.dataset.editAccount)));
  document.querySelector<HTMLInputElement>('#keep-recovery')!.onchange=event=>void attempt(async()=>{state.prefs={...state.prefs,keepRecoveryCopies:(event.target as HTMLInputElement).checked};await api('preferences',{preferences:state.prefs});notice('Recovery preference saved.');});
  document.querySelectorAll<HTMLButtonElement>('[data-repair-account]').forEach(b=>b.onclick=()=>void repairMail(b.dataset.repairAccount!,b));
  document.querySelectorAll<HTMLButtonElement>('[data-google]').forEach(b=>b.onclick=()=>void attempt(async()=>{const r=await api('google-connect',{id:b.dataset.google!,...(b.hasAttribute('data-enable-calendar')?{calendar:true}:{})});location.href=r.url;}));
  document.querySelectorAll<HTMLButtonElement>('[data-remove-account]').forEach(b=>b.onclick=()=>confirmation('Remove account','Remove the saved credentials and downloaded cache from this workspace? The provider account is unaffected.',async()=>{await api('account-delete',{id:b.dataset.removeAccount!});state.accounts=(await api('accounts')).accounts;renderSettings();}));
  if(focusedCategory)focusSettingsCategory(focusedCategory);
  else if(focusedPage===settingsPage){
    const panel=activeSettingsPanel();
    const replacement=focused?.id&&document.getElementById(focused.id);
    if(replacement&&panel?.contains(replacement))replacement.focus({preventScroll:true});
    if(document.activeElement===document.body)panel?.focus({preventScroll:true});
  }
}
function activeSettingsPanel() {
  return document.querySelector<HTMLElement>('[data-settings-page]:not([hidden])');
}
function focusSettingsCategory(category=settingsPage) {
  const button=document.querySelector<HTMLButtonElement>(`[data-settings-category="${CSS.escape(category)}"]`);
  button?.focus({preventScroll:true});
  button?.scrollIntoView({block:'nearest',inline:'nearest'});
}
async function accountDialog(id?: string) {
  if(dialog.open)return;
  const existing=id?await api('account-details',{id}):undefined;
  if(dialog.open||state.app!=='settings')return;
  const refresh=async()=>{
    state.accounts=(await api('accounts')).accounts;
    renderSettings();
  };
  openAccountSetup({dialog,request:api,existing,onSaved:refresh,onCalendarUpdate:refresh});
}
const itemMenus=installItemMenus({confirmDeletion:connections.confirmDeletion,state,e,commit:leaveEditor,renderList,selectRecord,enterEdit,api,load,mailDeletionReload,deleteMailImmediately,notice,confirmation,attempt,exportRecords,setMailRead,waitForMailRead:id=>pendingMailReads.get(id),capturePane:()=>{const pane=activePane();return ()=>restorePane(pane);},mouseSelection:()=>{keyboardSelection=false;},fileMail:()=>fileMail(mailFolderEnv())});
interface PendingSwipeAction {timer?: number; read?: boolean}
const pendingSwipeActions=new Map<string,PendingSwipeAction>();
const swipeUndoPanel=document.querySelector<HTMLElement>('#swipe-undo')!;
const swipeUndoWindow=5000;
function swipeHidesRow(id: string) {
  const pending=pendingSwipeActions.get(id);
  return pending?.timer!==undefined&&pending.read===undefined;
}
function swipeMailDisplay(row: OfficeRecord) {
  const pending=pendingSwipeActions.get(row.id);
  return pending?.timer!==undefined&&pending.read!==undefined?{...row,meta:{...row.meta,read:pending.read}}:row;
}
function clearSwipeActions() {
  for(const pending of pendingSwipeActions.values())window.clearTimeout(pending.timer);
  pendingSwipeActions.clear();
  swipeUndoPanel.replaceChildren();swipeUndoPanel.hidden=true;
}
function refreshSwipeRows(row: OfficeRecord,focusRestoredRow=false) {
  if(state.app!==row.kind||appEntryVisible()||!document.querySelector('#items'))return;
  const focused=(document.activeElement as HTMLElement|null)?.closest<HTMLElement>('#items .item[data-id]');
  const viewport=captureMailListViewport();
  renderList();
  restoreMailListViewport(viewport);
  if(focusRestoredRow||focused){
    const id=focusRestoredRow?row.id:focused?.dataset.id||'';
    const button=document.querySelector<HTMLElement>(`#items .item[data-id="${CSS.escape(id)}"]`);
    if(button)button.focus({preventScroll:true});else focusList();
  }
}
function deferSwipeAction(row: OfficeRecord,label: string,read: boolean | undefined,apply: () => Promise<void>) {
  if(state.app!==row.kind||pendingSwipeActions.has(row.id))return;
  const revision=row.revision;
  const toast=document.createElement('div');toast.className='swipe-undo-action';
  const status=document.createElement('span');status.setAttribute('role','status');status.textContent=`${label} · ${row.title}`;
  const button=document.createElement('button');button.type='button';button.textContent='Undo';
  button.setAttribute('aria-label',`Undo ${label.toLowerCase()} for ${row.title}`);
  toast.append(status,button);
  const dismiss=()=>{
    const focused=toast.contains(document.activeElement);
    toast.remove();swipeUndoPanel.hidden=!swipeUndoPanel.childElementCount;
    return focused;
  };
  const undo=()=>{
    if(pending.timer===undefined)return;
    window.clearTimeout(pending.timer);
    pending.timer=undefined;
    pendingSwipeActions.delete(row.id);
    refreshSwipeRows(row,dismiss());
    notice('Swipe action undone.');
  };
  const pending: PendingSwipeAction={read};
  button.onclick=undo;
  // A browser can suppress the click immediately following a touch swipe.
  let tap: {pointer: number; x: number; y: number} | undefined;
  button.onpointerdown=event=>{
    if(event.isPrimary&&event.pointerType==='touch')tap={pointer:event.pointerId,x:event.clientX,y:event.clientY};
  };
  button.onpointercancel=()=>{tap=undefined;};
  button.onpointerup=event=>{
    if(!tap||event.pointerId!==tap.pointer)return;
    const distance=Math.hypot(event.clientX-tap.x,event.clientY-tap.y);
    tap=undefined;
    if(distance<10&&button.contains(document.elementFromPoint(event.clientX,event.clientY))){
      suppressSwipeClick();
      undo();
    }
  };
  pending.timer=window.setTimeout(()=>{
    pending.timer=undefined;
    const focused=dismiss();
    if(focused&&!dialog.open)focusList();
    void attempt(async()=>{
      const current=state.rows.find(record=>record.id===row.id);
      if((current&&current.revision!==revision)||(state.current?.id===row.id&&(state.dirty||state.savePromise)))throw Error('The swiped item changed. Swipe it again to apply the action.');
      await apply();
    }).finally(()=>{
      if(pendingSwipeActions.get(row.id)!==pending)return;
      pendingSwipeActions.delete(row.id);
      refreshSwipeRows(row);
    });
  },swipeUndoWindow);
  pendingSwipeActions.set(row.id,pending);
  swipeUndoPanel.append(toast);swipeUndoPanel.hidden=false;
  refreshSwipeRows(row);
}
window.addEventListener('pagehide',clearSwipeActions);
window.addEventListener('pageshow',event=>{
  if(event.persisted&&document.querySelector('#items')&&!appEntryVisible())renderList();
});
let swipeActionRunning=false;
const suppressSwipeClick=installRowSwipes((button,direction)=>{
  if(swipeActionRunning||dialog.open)return;
  const {app}=state;
  const row=state.rows.find(record=>record.id===button.dataset.id);
  if(!row||isPendingSend(row.id)||pendingMailDeletes.has(row.id)||pendingSwipeActions.has(row.id))return;
  const prefs=swipePreferences(state.prefs.swipe);
  const action=prefs[app==='mail'?'mail':'items'][direction];
  if(action==='off')return;
  const id=action==='delete'&&app==='mail'&&row.meta.remote?'trash':action;
  if(id==='move'?!canQuickMoveMail([row]):!itemMenus.actions([row]).some(option=>option.id===id))return;
  if(id==='archive'&&protectedMail(row))return;
  const label=id==='trash'?'Move to Trash':id==='delete'&&row.meta.folder==='Drafts'?'Discard Draft':mailSwipeActions[action];
  return {
    label,
    danger:action==='delete',
    run:()=>{
      if(state.app!==app||swipeActionRunning||dialog.open)return;
      swipeActionRunning=true;
      void attempt(async()=>{
        const defer=(target: OfficeRecord,apply: () => Promise<void>)=>deferSwipeAction(target,label,id==='read'?true:id==='unread'?false:undefined,apply);
        if(id==='move')await quickMoveMail(mailFolderEnv(),row.id,defer);
        else await itemMenus.run(id,[row.id],app,defer);
      }).finally(()=>{swipeActionRunning=false;});
    },
  };
});
function contentEntry() {
  const panel=document.querySelector<HTMLElement>('#detail');
  if(state.app==='lists'&&panel)return checklistEntry(panel)||panel;
  return panel?.querySelector<HTMLElement>('.mail-html, .mail-body, .sheet-wrap')||panel;
}
function focusContent() {
  if(!state.current)return;
  const entry=contentEntry();
  if(entry){if(!entry.matches('[data-checklist-row] input'))entry.tabIndex=-1;entry.focus({preventScroll:true});}
}
function restoreConnectionsFocus(opener:HTMLElement|null) {
  if(opener?.isConnected&&!editable(opener))opener.focus({preventScroll:true});
  if(document.activeElement!==opener||editable(document.activeElement))focusList();
  setMode('normal');
}
function focusList() {
  if(fullScreenItemId){focusContent();return;}
  if(phoneLayout.matches&&mobileItemOpen){focusContent();return;}
  if(state.app==='settings'&&activeSettingsPanel()){
    if(phoneLayout.matches)document.querySelector<HTMLElement>('#settings-categories-toggle')?.focus({preventScroll:true});
    else focusSettingsCategory();
    return;
  }
  const entry=document.querySelector<HTMLElement>('#selected-item')||document.querySelector<HTMLElement>('#items')||document.querySelector<HTMLElement>('#main');
  if(entry){if(entry.id!=='selected-item')entry.tabIndex=-1;entry.focus({preventScroll:true});}
}
let lastSidebarEntry='';
function sidebarEntries() {
  return [...document.querySelectorAll<HTMLElement>('.sidebar :is(button,summary,select):not(:disabled)')].filter(node=>{
    if(!node.getClientRects().length||getComputedStyle(node).visibility!=='visible')return false;
    for(const group of document.querySelectorAll('.sidebar details:not([open])')){
      if(group.contains(node)&&!group.querySelector(':scope > summary')?.contains(node))return false;
    }
    return !node.closest('[popover]:not(:popover-open)');
  });
}
function sidebarEntrySelector(entry: HTMLElement) {
  const owner=entry.matches('summary')?entry.parentElement!:entry;
  if(owner.id)return '#'+CSS.escape(owner.id);
  const attributes=owner.getAttributeNames().filter(name=>name.startsWith('data-'));
  return attributes.length?owner.localName+attributes.map(name=>'['+name+'="'+CSS.escape(owner.getAttribute(name)!)+'"]').join('')+(owner!==entry?' > summary':''):'';
}
function focusSidebar(selector=lastSidebarEntry) {
  const entries=sidebarEntries();
  const entry=(selector&&entries.find(node=>node.matches(selector)))||
    entries.find(node=>node.matches('[data-app][aria-current="page"]'))||entries[0];
  if(entry){entry.focus({preventScroll:true});entry.scrollIntoView({block:'nearest',inline:'nearest'});}
}
function captureSidebarFocus() {
  const entry=document.activeElement?.closest<HTMLElement>('.sidebar :is(button,summary,select)');
  const selector=entry&&sidebarEntrySelector(entry);
  return ()=>{
    if(!selector)return;
    if(document.activeElement===document.body||document.activeElement===entry&&!sidebarEntries().includes(entry))focusSidebar(selector);
  };
}
function handleSidebarKey(event: KeyboardEvent,target: HTMLElement) {
  if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  const k=keys(), key=event.key;
  const account=target.matches('[data-account-tree] > summary')?target.parentElement?.dataset.accountTree:undefined;
  if(key==='Enter'&&account){
    event.preventDefault();
    if(!event.repeat)void attempt(()=>openAccountInbox(mailFolderEnv(),account));
    return;
  }
  if(key==='Backspace'&&state.app==='mail'){
    event.preventDefault();
    if(!event.repeat)void attempt(()=>{
      const parent=backOutOfMailFolder(mailFolderEnv());
      if(parent)return parent;
      setMailFolderPanel(false);
      focusSidebar('[data-app="mail"]');
    });
    return;
  }
  if(key===k.left||key===k.right){
    event.preventDefault();
    if(key===k.right)focusList();
    return;
  }
  if(key===k.help){event.preventDefault();if(!event.repeat)help();return;}
  const next=key===k.down||key==='ArrowDown', previous=key===k.up||key==='ArrowUp';
  if(!next&&!previous)return;
  if(target.matches('select')&&key.startsWith('Arrow'))return;
  event.preventDefault();
  const entries=sidebarEntries(), index=entries.indexOf(target);
  const entry=entries[Math.max(0,Math.min(entries.length-1,index+(next?1:-1)))];
  if(entry){entry.focus({preventScroll:true});entry.scrollIntoView({block:'nearest',inline:'nearest'});}
}
const keyboardScrollers=new WeakMap<HTMLElement,ReturnType<typeof createKeyboardScroller>>();
const scrollKeys: Record<string,ScrollDirection>={ArrowUp:'up',ArrowDown:'down',PageUp:'page-up',PageDown:'page-down',Home:'start',End:'end'};
function handleSettingsKey(event: KeyboardEvent,target: HTMLElement) {
  if(state.app!=='settings'||!target.closest('.settings')||event.isComposing)return false;
  const category=target.closest<HTMLButtonElement>('[data-settings-category]');
  const panel=activeSettingsPanel();
  const key=event.key,k=keys();
  const vimDirection=target===panel?vimScrollDirection(event):undefined;
  if(!vimDirection&&(event.ctrlKey||event.metaKey||event.altKey||['Enter',' ','Tab'].includes(key)))return false;
  if(category&&(key===k.left||key===k.right)){
    if(key===k.left)focusSidebar();
    else panel?.focus();
  }else if(category&&(key===k.up||key===k.down||['ArrowUp','ArrowDown','Home','End'].includes(key))){
    const index=settingsPages.findIndex(([id])=>id===category.dataset.settingsCategory);
    const next=key==='Home'?0:key==='End'?settingsPages.length-1:index+(key==='ArrowDown'||key!=='ArrowUp'&&key===k.down?1:-1);
    focusSettingsCategory(settingsPages[Math.max(0,Math.min(settingsPages.length-1,next))][0]);
  }else if(panel?.contains(target)&&key===k.left&&!vimDirection){
    focusSettingsCategory();
  }else if(target===panel){
    const direction=vimDirection||scrollKeys[key]||
      (key===k.down?'down':key===k.up?'up':key===k.pageDown?'half-page-down':key===k.pageUp?'half-page-up':undefined);
    if(!direction)return false;
    scrollFocusedPane(target,direction);
  }else return false;
  event.preventDefault();keySequence='';setMode('normal');
  return true;
}
function scrollMailBody(target: HTMLElement,direction: ScrollDirection) {
  const frame=target.closest<HTMLIFrameElement>('.mail-html');
  if(frame){frame.contentWindow?.postMessage({type:'office-mail-scroll',direction},'*');return;}
  const panel=document.querySelector<HTMLElement>('#detail');if(!panel)return;
  let scroll=keyboardScrollers.get(panel);
  if(!scroll){scroll=createKeyboardScroller(panel);keyboardScrollers.set(panel,scroll);}
  scroll(direction);
}
let pendingListPage: Promise<unknown> | undefined;
function afterListPage(action: () => unknown,track=false) {
  const previous=pendingListPage;
  const app=state.app;
  const pending=previous?previous.then(()=>{
    if(state.app===app&&activePane()==='list')return attempt(action);
  }):attempt(action);
  if(!previous&&!track)return;
  pendingListPage=pending;
  void pending.then(()=>{if(pendingListPage===pending)pendingListPage=undefined;});
}
async function pageItemList(list: HTMLElement,down: boolean) {
  keyboardScrollers.get(list)?.cancel();
  const height=list.clientHeight;
  const top=Math.max(0,Math.min(list.scrollHeight-height,list.scrollTop+(down?1:-1)*Math.max(1,height/2)));
  const bounds=list.getBoundingClientRect();
  const viewportTop=bounds.top+list.clientTop;
  const selected=list.querySelector('#selected-item')?.getBoundingClientRect();
  const anchor=selected&&selected.bottom>viewportTop&&selected.top<viewportTop+height?
    Math.max(0,Math.min(height,(selected.top+selected.bottom)/2-viewportTop)):height/2;
  const nextTop=viewportTop+top-list.scrollTop;
  let closest: HTMLElement | undefined;
  let distance=Infinity;
  for(const row of list.querySelectorAll<HTMLElement>('.item[data-id]')){
    const rect=row.getBoundingClientRect();
    if(rect.bottom<=nextTop||rect.top>=nextTop+height)continue;
    const offset=Math.abs((rect.top+rect.bottom)/2-nextTop-anchor);
    if(offset<distance){closest=row;distance=offset;}
  }
  if(closest&&closest.id!=='selected-item')await selectRecord(closest.dataset.id!,'list-without-scroll');
  const updatedList=list.isConnected?list:document.activeElement?.closest<HTMLElement>('#items');
  updatedList?.scrollTo({top,behavior:'instant'});
}
function scrollFocusedPane(target: HTMLElement,direction: ScrollDirection) {
  if(target.closest('.mail-html')){scrollMailBody(target,direction);return;}
  const pane=state.app==='settings'&&target.matches('[data-settings-page]')?
    document.querySelector<HTMLElement>('#main'):target.closest<HTMLElement>('#items,#detail')||document.querySelector<HTMLElement>(activePane()==='content'?'#detail':'#items');
  if(!pane)return false;
  let panel=pane.id==='main'?(document.scrollingElement as HTMLElement|null)||pane:pane;
  for(let node: HTMLElement|null=target;node&&pane.contains(node);node=node.parentElement){
    if(node.scrollHeight>node.clientHeight&&/auto|scroll/.test(getComputedStyle(node).overflowY)){panel=node;break;}
    if(node===pane)break;
  }
  if(panel.id==='items'&&(direction==='half-page-down'||direction==='half-page-up')&&
    (state.app!=='calendar'||panel.querySelector('.calendar-agenda'))){
    afterListPage(()=>{
      const list=document.querySelector<HTMLElement>('#items');
      if(list)return pageItemList(list,direction==='half-page-down');
    },true);
    return true;
  }
  let scroll=keyboardScrollers.get(panel);
  if(!scroll){scroll=createKeyboardScroller(panel);keyboardScrollers.set(panel,scroll);}
  scroll(direction);
  return true;
}
let lastPane: 'content'|'list'='list';
function activePane(): 'content'|'list' {
  if(phoneLayout.matches)return mobileItemOpen?'content':'list';
  const node=document.activeElement;
  if(fullScreenItemId||node?.closest('.item-pane'))return 'content';
  if(node?.closest('#items'))return 'list';
  return lastPane;
}
document.addEventListener('focusin',event=>{
  const node=event.target as HTMLElement;
  if(phoneLayout.matches&&!node.closest('#app-sidebar,#mobile-menu,dialog')&&document.querySelector('#app-sidebar.mobile-expanded'))showMobileMenu(false);
  if(node.closest('.item-pane'))lastPane='content';
  else if(node.closest('#items,#main'))lastPane='list';
  else if(node.closest('.sidebar')){lastSidebarEntry=sidebarEntrySelector(node);keySequence='';setMode('normal');}
});
function restorePane(pane: 'content'|'list') {
  if(pane==='content'){if(state.current)focusContent();else{const panel=document.querySelector<HTMLElement>(state.app==='calendar'?'#items':'#detail');if(panel){panel.tabIndex=-1;panel.focus({preventScroll:true});}}}
  else focusList();
}
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented)return;
  if(commandInput){if(event.key==='Escape'){event.preventDefault();closeCommand(true);}return;}
  if(!document.querySelector('.shell'))return;
  state.lastActivity=Date.now();if(document.querySelector<HTMLDialogElement>('dialog[open]')!)return;
  const target=event.target as HTMLElement;
  if(phoneLayout.matches&&event.key==='Escape'&&document.querySelector('#app-sidebar.mobile-expanded')){
    event.preventDefault();showMobileMenu(false,true);return;
  }
  if(phoneLayout.matches&&event.key==='Escape'){
    const toggle=[...document.querySelectorAll<HTMLElement>('.mobile-disclosure[aria-expanded="true"]')].find(button=>
      button===target||document.getElementById(button.getAttribute('aria-controls')!)?.contains(target));
    if(toggle){event.preventDefault();setDisclosure(toggle,false);toggle.focus({preventScroll:true});return;}
  }
  if(target.closest('[data-mail-disclosure]')&&!(fullScreenItemId&&['Escape',':'].includes(event.key)))return;
  const exportMenu=target.closest<HTMLDetailsElement>('#mail-export-menu[open]');
  if(event.key==='Escape'&&exportMenu){
    exportMenu.open=false;
    exportMenu.querySelector('summary')?.focus();
    event.preventDefault();
    return;
  }
  if(keySequence==='g'&&event.key==='b'&&Date.now()-sequenceTime<=900
    &&!event.isComposing&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!editable(target)){
    keySequence='';event.preventDefault();
    if(!event.repeat)void attempt(navigateBack);
    return;
  }
  const appJump=keySequence==='g'&&/^[1-8]$/.test(event.key);
  if(appEntryVisible()&&!['g',':'].includes(event.key)&&!appJump)return;
  if(event.key==='Escape'&&document.querySelector('.folders-open')){setMailFolderPanel(false,true);event.preventDefault();return;}
  if(event.key==='Escape'&&state.app==='calendar'&&state.current&&!event.isComposing){
    event.preventDefault();
    if(!event.repeat)void attempt(returnToItemList);
    return;
  }
  const inSidebar=!!target.closest('.sidebar');
  if(inSidebar&&event.key!==':'&&event.key!=='g'&&!appJump){
    keySequence='';handleSidebarKey(event,target);return;
  }
  if(event.key==='Enter'&&event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&!event.isComposing&&state.app==='mail'&&state.current?.meta.folder==='Drafts'&&!state.current!.meta.remote){
    event.preventDefault();if(!event.repeat)void attempt(sendMail);return;
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void attempt(()=>commit(true));return;}
  if(state.app==='lists'&&target.id==='search'&&(event.key==='Enter'||event.key==='Escape')&&!event.isComposing){
    event.preventDefault();setMode('normal');focusList();
    const row=navigableRows()[0];
    if(event.key==='Enter'&&row&&(phoneLayout.matches||row.id!==state.current?.id)){
      void attempt(()=>selectRecord(row.id,true,true));
    }
    return;
  }
  if(state.app==='lists'&&event.key==='Escape'&&target.matches('.checklist-add input,.checklist-title input')&&!event.isComposing){
    event.preventDefault();setMode('normal');focusContent();void attempt(commit);return;
  }
  if(event.key==='Escape'&&state.app==='wiki'&&state.wikiEditing&&state.current&&(!editable(target)||target.closest('#detail'))){
    if(event.isComposing)return;
    event.preventDefault();
    if(!event.repeat)void attempt(viewWikiPage);
    return;
  }
  if(event.key==='Escape'&&fullScreenItemId&&!editable(target)&&!event.isComposing){if(!event.repeat)toggleItemFullScreen();event.preventDefault();return;}
  if(event.key==='Escape'){setMode('normal');if(editable((event.target as HTMLElement))){(event.target as HTMLElement).blur();setMode('normal');event.preventDefault();void attempt(commit);if((event.target as HTMLElement).id==='formula')selectCell(state.cell,true);}else{const pane=activePane();state.selected.clear();if(state.app!=='settings'){renderList();restorePane(pane);}}return;}
  if(editable(target)&&!inSidebar){setMode('insert');return;}
  if(handleSettingsKey(event,target))return;
  const vimDirection=vimScrollDirection(event);
  if(vimDirection){if(scrollFocusedPane(event.target as HTMLElement,vimDirection)!==false){event.preventDefault();keySequence='';}return;}
  if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  if(!phoneLayout.matches&&!fullScreenItemId&&event.key==='Tab'&&event.shiftKey&&target===contentEntry()){event.preventDefault();keySequence='';focusList();return;}
  const checklistRow=target.closest<HTMLElement>('[data-checklist-row]');
  const checklistArrow=checklistRow&&(event.key==='ArrowUp'||event.key==='ArrowDown');
  if(!checklistArrow&&target.closest('button:not(#items [data-id]):not([data-cell]),a,summary,select,input')&&['Enter',' ','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
  if(!phoneLayout.matches&&event.key==='Tab'&&!event.shiftKey&&(target.matches('#selected-item')||state.current&&target.id==='items')){event.preventDefault();keySequence='';focusContent();return;}
  if(event.key===':'&&!event.isComposing&&state.mode==='normal'){event.preventDefault();if(!event.repeat)openCommand();return;}
  const k=keys(), key=event.key;setMode('normal');
  const mailBody=state.app==='mail'&&state.current&&state.current.meta.folder!=='Drafts'&&!!target.closest('.mail-body,.mail-html');
  if(Date.now()-sequenceTime>900)keySequence='';sequenceTime=Date.now();
  if(event.repeat&&key==='g'){event.preventDefault();return;}
  if(keySequence==='g'&&appJump){event.preventDefault();keySequence='';void attempt(()=>changeApp(Object.keys(apps)[Number(key)-1] as AppName));return;}
  if(keySequence==='g'&&key==='g'){keySequence='';event.preventDefault();if(inSidebar){focusSidebar('');return;}if(mailBody){scrollMailBody(target,'start');return;}if(checklistRow){moveChecklistFocus(checklistRow,'first');return;}const row=navigableRows()[0];if(row)void attempt(()=>selectRecordFromKeyboard(row.id));return;}
  if(key==='g'){keySequence='g';event.preventDefault();return;}keySequence='';
  const listArrow=activePane()==='list'?(key==='ArrowUp'||key==='ArrowLeft'?'up':key==='ArrowDown'||key==='ArrowRight'?'down':undefined):undefined;
  const action=(checklistArrow?(key==='ArrowUp'?'up':'down'):listArrow)||Object.keys(k).find(action=>k[action]===key);
  if(action==='pageDown'||action==='pageUp'){if(scrollFocusedPane(target,action==='pageDown'?'half-page-down':'half-page-up')!==false)event.preventDefault();return;}
  if(mailBody&&scrollKeys[key]){event.preventDefault();scrollMailBody(target,scrollKeys[key]);return;}
  if(event.repeat&&action&&!['down','up','left','right'].includes(action)){event.preventDefault();return;}
  if(mailBody&&(action==='down'||action==='up'||key==='G')){event.preventDefault();scrollMailBody(target,key==='G'?'end':action==='up'?'up':'down');return;}
  if((action==='down'||action==='up')&&state.app==='wiki'&&!state.wikiEditing&&state.current&&target.closest('.item-pane')){
    event.preventDefault();
    scrollFocusedPane(target,action);
    return;
  }
  if(action==='help'){event.preventDefault();help();return;}
  if(action==='left'){
    event.preventDefault();
    if(phoneLayout.matches){if(mobileItemOpen)void attempt(backFromMobileItem);else showMobileMenu(true);}
    else if(state.app!=='settings'&&activePane()==='content')focusList();else focusSidebar();
    return;
  }
  if(action==='right'){
    event.preventDefault();
    afterListPage(async()=>{
      if(phoneLayout.matches&&!mobileItemOpen&&state.current)await selectRecord(state.current.id,false,true);
      if(state.app==='sheets'&&state.current)selectCell(state.cell,true);else focusContent();
    });
    return;
  }
  if(state.app==='settings')return;
  if(action==='fullScreen'&&state.current&&!phoneLayout.matches){event.preventDefault();toggleItemFullScreen();return;}
  if(state.app==='lists'&&action==='addChecklistItem'&&activePane()==='content'){
    event.preventDefault();document.querySelector<HTMLInputElement>('.checklist-add input')?.focus();return;
  }
  if(checklistRow){
    if(action==='up'||action==='down'||key==='G'){
      event.preventDefault();moveChecklistFocus(checklistRow,key==='G'?'last':action==='up'?'up':'down');return;
    }
    const control=action==='completeTask'?'input':action==='edit'?'[data-checklist-edit]':action==='delete'?'[data-checklist-delete]':undefined;
    if(control){event.preventDefault();if(!event.repeat)checklistRow.querySelector<HTMLElement>(control)?.click();return;}
  }
  if(action==='search'){
    event.preventDefault();
    void attempt(async()=>{
      if(phoneLayout.matches&&mobileItemOpen)await returnToItemList();
      setItemFullScreen(false);
      if(phoneLayout.matches&&state.app==='calendar')setDisclosure(document.querySelector('#mobile-header-more'),true);
      document.querySelector<HTMLInputElement>('#search')?.focus();
    });
    return;
  }
  if(action==='connections'){event.preventDefault();if(!event.repeat)void attempt(()=>connections.view());return;}
  if(action==='new'){event.preventDefault();void attempt(createRecord);return;}
  if(action==='completeTask'&&state.app==='tasks'&&!event.shiftKey){event.preventDefault();void attempt(completeTask);return;}
  if(action==='edit'||(state.app==='sheets'&&key==='Enter')){event.preventDefault();enterEdit();return;}
  if(action==='save'){event.preventDefault();void attempt(()=>commit(true));return;}
  if(action==='delete'){
    event.preventDefault();
    if(!event.repeat){
      if(state.app==='mail')void attempt(deleteSelectedMail);
      else if(state.current)document.querySelector<HTMLButtonElement>('#detail [data-action="delete"]')!?.click();
    }
    return;
  }
  if(action==='undoDelete'&&state.app==='mail'){event.preventDefault();if(!event.repeat&&!event.isComposing)void attempt(undoMailDelete);return;}
  if(action==='archive'){event.preventDefault();if(event.repeat)return;void attempt(archiveLocal);return;}
  if(action==='move'&&state.app==='mail'){event.preventDefault();if(!event.repeat)void attempt(()=>quickMoveMail(mailFolderEnv()));return;}
  if(action==='reply'&&state.app==='mail'){event.preventDefault();document.querySelector<HTMLButtonElement>('[data-action=reply]')!?.click();return;}
  if(action==='select'&&state.current){event.preventDefault();const id=state.current!.id;selectionAnchor=id;keyboardSelection=true;if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);const pane=activePane();renderList();restorePane(pane);return;}
  if(state.app==='sheets'&&state.current&&target.closest<HTMLElement>('[data-cell]')&&(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Tab'].includes(key))){event.preventDefault();let [r,c]=cellPosition(state.cell);if(key==='ArrowLeft'||key==='Tab'&&event.shiftKey)c--;else if(key==='ArrowRight'||key==='Tab')c++;else if(key==='ArrowUp')r--;else r++;selectCell(colName(Math.max(0,Math.min(11,c)))+(Math.max(0,Math.min(29,r))+1),true);return;}
  if(action==='down'||action==='up'||key==='n'||key==='N'||key==='G'){event.preventDefault();afterListPage(async()=>{
    let rows=navigableRows();const backwards=action==='up'||key==='N';
    if(state.app==='mail'&&mailPage?.more&&(key==='G'||(!backwards&&rows.at(-1)?.id===state.current?.id))){
      const context=mailQueryContext();mailListLimit=key==='G'?mailPage.total:mailListLimit+100;await refreshMailQuery();
      if(state.app!=='mail'||context!==mailQueryContext())return;rows=navigableRows();
    }
    const index=rows.findIndex(r=>r.id===state.current?.id);
    if(state.app==='calendar'&&!state.search.trim()&&index<0&&(action==='down'||action==='up')){
      const now=Date.now();
      let closest: OfficeRecord|undefined, closestDistance=Infinity;
      for(const row of rows){
        const offset=+calendarDate(row.meta.start||'')-now;
        const distance=Math.abs(offset);
        if((backwards?offset<0:offset>=0)&&distance<closestDistance){
          closest=row;
          closestDistance=distance;
        }
      }
      if(closest)return selectRecordFromKeyboard(closest.id);
      return;
    }
    const next=key==='G'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(backwards?-1:1)));if(rows[next])return selectRecordFromKeyboard(rows[next].id);
  },true);}
});
document.addEventListener('focusin',event=>{const target=event.target as HTMLElement;if(!target.closest('.connections-view,.sidebar')&&target.id!=='command-input'&&editable(target))setMode('insert');});
document.addEventListener('mousedown',event=>{
  // Keep the caret or selection in the item when a pointer toggles its layout.
  if(event.button===0&&document.activeElement?.closest('#detail')&&(event.target as Element).closest('[data-action="item-fullscreen"]'))event.preventDefault();
});
document.addEventListener('pointerdown',event=>{
  state.lastActivity=Date.now();
  if((event.target as Element).closest('[data-mobile-menu-backdrop]'))showMobileMenu(false,true);
  if(document.querySelector('.folders-open')&&!(event.target as Element).closest('#mail-folder-navigation,#desktop-mail-folders'))setMailFolderPanel(false);
},{passive:true});
document.addEventListener('wheel',()=>state.lastActivity=Date.now(),{passive:true});
for(const type of ['keydown','pointerdown','wheel'])document.addEventListener(type,event=>{
  if(event.isTrusted)reportSessionActivity();
},{capture:true,passive:true});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.savePromise){event.preventDefault();event.returnValue='';}});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
let mailCalendarDay=new Date().toDateString();
function refreshMailCalendarDay() {const day=new Date().toDateString();if(day!==mailCalendarDay){mailCalendarDay=day;if(state.app==='mail'&&document.querySelector('#items'))renderList();}}
setInterval(refreshMailCalendarDay,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshMailCalendarDay();});
window.addEventListener('focus',refreshMailCalendarDay);
setInterval(()=>{if(document.querySelector<HTMLElement>('.shell')!)void attempt(()=>syncAccounts(false));},120000);
void boot();
