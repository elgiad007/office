import {escapeHtml as e, markdown, safeDocument, csvParse, csvWrite, colName, cellPosition, cellValue, icsExport, vcardExport, vcardParse} from './formats.js';
import {openAccountSetup} from './account-setup.js';
import {renderGoogleSettings} from './google-settings.js';
import {renderMailFolders, matchesMailScope, syncOpenFolder, fileMail} from './mail-folders.js';
import {mailBody, bindMailReader} from './mail-reader.js';

const apps = {
  mail:{name:'Mail', singular:'message', empty:'No messages yet.',hint:'Connect an account in Settings, import an EML file, or compose your first message.',icon:'M3 5h18v14H3z M3 5l9 7 9-7'},
  calendar:{name:'Calendar',singular:'event',empty:'No events yet.',hint:'Add an event, import a calendar, or connect Google Calendar or CalDAV.',icon:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16'},
  tasks:{name:'Tasks',singular:'task',empty:'No tasks yet.',hint:'Add a task and an optional due date.',icon:'M9 5h12 M9 12h12 M9 19h12 M2 5l2 2 3-4 M2 12l2 2 3-4 M2 19l2 2 3-4'},
  contacts:{name:'Contacts',singular:'contact',empty:'No contacts yet.',hint:'Add a contact or import a vCard address book.',icon:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M20 8v6 M17 11h6'},
  documents:{name:'Documents',singular:'document',empty:'No documents yet.',hint:'Create a document or import an HTML or text file.',icon:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8'},
  wiki:{name:'Wiki',singular:'page',empty:'No pages yet.',hint:'Write Markdown pages, organize namespaces, and link pages with [[wiki links]].',icon:'M3 4h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-3H3z M13 7a3 3 0 0 1 3-3h6v15h-5a4 4 0 0 0-4 3'},
  sheets:{name:'Sheets',singular:'workbook',empty:'No workbooks yet.',hint:'Create a workbook or import a CSV file.',icon:'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18'},
};
const defaultKeys = {down:'j',up:'k',left:'h',right:'l',edit:'i',new:'c',search:'/',help:'?',select:'v',save:'s',archive:'a',reply:'r',read:'m',delete:'d'};
const state = {app:'mail',rows:[],current:null,csrf:'',accounts:[],prefs:{},search:'',mode:'normal',dirty:false,selected:new Set(),sheet:0,cell:'A1',wikiPreview:true,lastActivity:Date.now(),syncing:false,savePromise:null,mailFolder:'Inbox',mailScope:null,folderOpen:new Set()};
const root=document.querySelector('#app'), dialog=document.querySelector('#dialog');
let noticeTimer, saveTimer, keySequence='', sequenceTime=0;
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${apps[name]?.icon || 'M12 3v18 M3 12h18'}"/></svg>`;
const keys = () => ({...defaultKeys,...state.prefs.keys});
const editable = node => node?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName);
const dateLabel = value => { const date=new Date(value); return Number.isNaN(+date)?value:date.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
const field = (label,name,value='',type='text',extra='') => `<label>${e(label)}<input type="${type}" name="${name}" value="${e(value)}" ${extra}></label>`;
const busyButton = (button,busy) => { if (button) button.disabled=busy; };
function notice(text,error=false) { const n=document.querySelector('#notice'); n.textContent=text; n.className='show'; n.setAttribute('role',error?'alert':'status'); clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>n.className='',error?10000:4500); }
async function api(route,data) {
  const response=await fetch('api.php?r='+route,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store'});
  let result; try { result=await response.json(); } catch { throw Error('The server did not return JSON. Check PHP configuration and upload limits.'); }
  if (!response.ok) { if (response.status===401 && route!=='login') { state.dirty=false; await boot(); } throw Error(result.error || 'Request failed.'); }
  return result;
}
function applyTheme() {
  let theme=state.prefs.theme||'system'; if (theme==='system') theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  document.documentElement.dataset.theme=theme; document.documentElement.classList.toggle('compact',state.prefs.density==='compact');
  // Fixed palettes avoid injecting arbitrary CSS through imported preferences.
  document.documentElement.dataset.accent=['green','blue','plum'].includes(state.prefs.accent)?state.prefs.accent:'green';
}
function authView(status) {
  const setup=status.setup;
  root.innerHTML=`<main class="auth"><div class="brand"><div class="brandmark">o.</div><div><strong>Office</strong></div></div><h1>${setup?'Set up Office':'Sign in'}</h1><p>${setup?'Create your owner password to get started. Retrieve the setup token from <code>data/setup-token.txt</code> using your local file manager or cPanel File Manager.':'Enter your password.'}</p><form id="auth-form">${setup?field('Setup token','token','','text','required autocomplete="off"'):''}${field(setup?'Create password (at least 12 characters)':'Password','password','','password',`required ${setup?'minlength="12" autocomplete="new-password"':'autocomplete="current-password"'}`)}<button class="primary">${setup?'Create workspace':'Open workspace'}</button><p id="auth-error" class="error" role="alert"></p></form><p class="foot">PHP / SQLite · no scheduled jobs required</p></main>`;
  document.querySelector('#auth-form').onsubmit=async event=>{event.preventDefault(); const button=event.target.querySelector('button'); busyButton(button,true); try { const r=await api(setup?'setup':'login',Object.fromEntries(new FormData(event.target))); state.csrf=r.csrf; await boot(); } catch(error) { document.querySelector('#auth-error').textContent=error.message; } finally { busyButton(button,false); } };
}
async function boot() {
  try { const status=await api('status'); state.csrf=status.csrf; if (!status.authenticated) { authView(status); return; }
    state.prefs=status.preferences||{}; applyTheme(); state.accounts=(await api('accounts')).accounts;
    const hash=location.hash.slice(1); state.app=apps[hash]||hash==='settings'?hash:'mail'; shell(); await load();
    if (state.accounts.length) void syncAccounts(false);
  } catch(error) { root.innerHTML=`<main class="auth"><h1>Workspace unavailable</h1><p class="error">${e(error.message)}</p><p>Requires PHP 8.2+, PDO SQLite and a writable private data directory. Point the domain at <code>public/</code>.</p><button id="retry">Try again</button></main>`; document.querySelector('#retry').onclick=boot; }
}
function shell() {
  root.innerHTML=`<div class="shell"><aside class="sidebar" aria-label="Application navigation"><div class="brand"><div class="brandmark">o.</div><div><strong>Office</strong></div></div><p class="eyebrow nav-label">Applications</p><nav class="nav application-nav">${Object.entries(apps).map(([id,a],i)=>`<button data-app="${id}" title="${a.name} · g ${i+1}" aria-label="${a.name}">${icon(id)}<span>${a.name}</span><kbd>${i+1}</kbd></button>${id==='mail'?'<button id="mail-folders-toggle" class="mail-folders-toggle" data-action="toggle-mail-folders" aria-label="Show mail folders" aria-controls="mail-folder-navigation" aria-expanded="false">▤</button><section id="mail-folder-navigation" aria-label="Mail folders"></section>':''}`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button data-app="settings" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 4v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/></svg><span>Settings</span></button><button data-action="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${icon('wiki')}<span>Keyboard shortcuts</span><kbd>?</kbd></button></nav><div class="privacy-note"><span class="privacy-dot"></span> Stored in your application folder.</div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><span>Office</span><span>/</span><strong id="crumb"></strong></div><div class="top-actions"><span class="sync-label" id="sync-status">Automatic sync</span><button class="quiet" data-action="sync" id="sync-button" title="Refresh connected accounts">↻ <span>Sync now</span></button><span class="mode" id="mode">NORMAL</span><button class="avatar" data-action="logout" title="Sign out" aria-label="Sign out">ME</button></div></header><main id="main" tabindex="-1"></main></div></div>`;
  root.onclick=handleClick;
}
function setMailFolderPanel(open) {
  document.querySelector('.shell')?.classList.toggle('folders-open',open);
  document.querySelector('#mail-folders-toggle')?.setAttribute('aria-expanded',String(open));
}
function mailFolderEnv() { return {state,api,commit,load,notice,modal,dialog,e,field,confirmation,attempt,closeFolderPanel:()=>setMailFolderPanel(false)}; }
function mailLocation(record) {
  const m=record.meta, account=state.accounts.find(a=>a.id===m.account);
  if(!m.remote || ['Recovery copies','Not in Inbox'].includes(m.folder))return m.folder||'';
  if(account?.type==='google')return [m.folder,...(account.folders||[]).filter(f=>!f.protected&&(m.labelIds||[]).includes(f.id)).map(f=>f.name)].filter(Boolean).join(' · ');
  return m.folder==='Custom folder'?(account?.folders?.find(f=>f.id===m.serverFolder)?.name||m.serverFolder||m.folder):m.folder;
}
function filteredRows() { const q=state.search.toLocaleLowerCase(); return state.rows.filter(r=>(state.app!=='mail'||(state.mailScope?matchesMailScope(r,state.mailScope,state.accounts):state.mailFolder==='all'?!['Recovery copies','Not in Inbox','Trash'].includes(r.meta.folder):state.mailFolder==='Recovery copies'?['Recovery copies','Not in Inbox'].includes(r.meta.folder):(r.meta.folder||'Archive')===state.mailFolder))&&(r.title+' '+r.body+' '+JSON.stringify(r.meta)).toLocaleLowerCase().includes(q)); }
async function load(preferId) {
  document.querySelectorAll('[data-app]').forEach(b=>{ const active=b.dataset.app===state.app; b.classList.toggle('active',active); if (active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  document.querySelector('#crumb').textContent=apps[state.app]?.name||'Settings';
  document.querySelector('.shell').classList.toggle('mail-active',state.app==='mail');
  document.querySelector('#mail-folder-navigation').hidden=state.app!=='mail';
  document.querySelector('#mail-folders-toggle').hidden=state.app!=='mail';
  if(state.app!=='mail')setMailFolderPanel(false);
  if (state.app==='settings') { state.current=null; renderSettings(); return; }
  state.rows=(await api('records&kind='+state.app)).records;
  if (state.app==='calendar') state.rows.sort((a,b)=>(a.meta.start||'').localeCompare(b.meta.start||''));
  state.current=state.rows.find(r=>r.id===(preferId||state.current?.id))||null; state.selected.clear(); renderWorkspace();
  if(state.app==='mail'&&state.mailScope&&state.current&&!matchesMailScope(state.current,state.mailScope,state.accounts)){state.current=null;renderList();renderDetail();}
}
function renderWorkspace() {
  const a=apps[state.app];
  document.querySelector('#main').innerHTML=`<section class="view-head"><div><h1>${a.name}</h1></div><div class="head-actions"><button class="quiet" data-action="import">↑ Import</button><button class="quiet" data-action="export-all">↓ Export</button><button class="primary" data-action="new">+ ${state.app==='mail'?'Compose':'New '+a.singular}</button></div></section><div class="work-grid"><section class="list-pane" aria-label="${a.name} list"><div class="search-wrap"><label><span class="file-input">Search ${a.name}</span><input id="search" type="search" value="${e(state.search)}" placeholder="Search ${a.name.toLowerCase()}…   /" autocomplete="off"></label></div><div class="list-summary"><span id="list-count"></span><span id="selection-count"></span></div><div class="items" id="items" role="region" aria-label="Items"></div><div class="bottom-hint"><span><kbd>j</kbd> <kbd>k</kbd> navigate</span><span><kbd>i</kbd> edit</span><span><kbd>?</kbd> help</span></div></section><section class="detail" id="detail" aria-label="Selected ${a.singular}"></section></div>`;
  document.querySelector('#search').oninput=event=>{state.search=event.target.value; renderList();};
  if(state.app==='mail'){
    const folderNavigation=document.querySelector('#mail-folder-navigation');
    folderNavigation.innerHTML='<div class="mail-folder-panel-head"><strong>Mail folders</strong><button data-action="close-mail-folders" aria-label="Close mail folders">✕</button></div>';
    folderNavigation.insertAdjacentHTML('beforeend',`<select id="mail-folder" aria-label="Mail folder"><option value="all">All cached mail</option>${['Inbox','Drafts','Sent','Archive','Trash','Local mail','Recovery copies','Sending','Delivery uncertain'].map(folder=>`<option ${state.mailFolder===folder?'selected':''}>${folder}</option>`).join('')}</select>`);
    document.querySelector('#mail-folder').onchange=event=>void attempt(async()=>{
      const select=event.target, folder=select.value; select.disabled=true;
      try {
        await commit();
        state.mailFolder=folder; state.mailScope=null; state.current=null; state.selected.clear(); setMode('normal');
        renderWorkspace();
        if(matchMedia('(max-width: 800px)').matches)setMailFolderPanel(false);
      } finally { select.value=state.mailFolder; select.disabled=false; }
    });
    if(state.mailScope){const select=document.querySelector('#mail-folder');select.insertAdjacentHTML('afterbegin','<option value="account-folder">Selected account folder</option>');select.value='account-folder';}
    renderMailFolders(mailFolderEnv());
  }
  renderList(); renderDetail();
}
function renderList() {
  const rows=filteredRows(); document.querySelector('#list-count').textContent=`${rows.length} ${rows.length===1?apps[state.app].singular:'items'}`;
  document.querySelector('#selection-count').textContent=state.selected.size?`${state.selected.size} selected`:'';
  document.querySelector('#items').innerHTML=rows.length?rows.map(r=>{
    const hint=state.app==='mail'?(r.meta.from||r.meta.to||r.meta.folder||'Local archive'):state.app==='calendar'?(r.meta.start?dateLabel(r.meta.start)+' · ':'')+(r.meta.location||''):state.app==='tasks'?(r.meta.done?'Completed':r.meta.due?'Due '+dateLabel(r.meta.due):'No due date'):state.app==='contacts'?(r.meta.email||r.meta.company||''):state.app==='wiki'?(r.title.includes(':')?r.title.split(':').slice(0,-1).join(':'):'Root namespace'):'Edited '+dateLabel(r.updated);
    const selected=state.current?.id===r.id;
    const badges=state.app==='mail'?'':`<span>${r.meta.folder?`<span class="badge">${e(r.meta.folder)}</span>`:''}${r.meta.remote?'<span class="badge">Synced</span>':''}</span>`;
    return `<button class="item ${selected?'selected':''}" data-id="${r.id}" aria-pressed="${selected}" ${selected?'id="selected-item"':''}><span class="item-icon">${state.selected.has(r.id)?'✓':icon(state.app)}</span><span class="item-copy"><strong>${e(r.title)}</strong><small>${e(hint)}</small></span>${badges}</button>`;
  }).join(''):`<div class="list-empty">${state.search?'No matching items. Try a different search.':'No items yet.'}</div>`;
}
function renderDetail() {
  const panel=document.querySelector('#detail'), r=state.current, a=apps[state.app];
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
  const form=panel.querySelector('#record-form');
  if (state.app==='mail' && r.meta.folder!=='Drafts') bindMailReader(panel,r,renderDetail);
  if (form) { form.oninput=()=>markDirty(); form.onsubmit=async ev=>{ev.preventDefault(); await attempt(()=>commit());}; }
  if (fillSender) markDirty();
  panel.querySelectorAll('[data-format]').forEach(button=>{
    button.onmousedown=event=>event.preventDefault();
    button.onclick=()=>{ const rich=panel.querySelector('#rich-editor'); rich.focus(); const command=button.dataset.format; if (command==='table') document.execCommand('insertHTML',false,'<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>'); else document.execCommand(command,false,button.dataset.value||null); markDirty(); };
  });
  const rich=panel.querySelector('#rich-editor');
  if (rich) { rich.onpaste=event=>{ event.preventDefault(); const html=event.clipboardData.getData('text/html'); if (html) document.execCommand('insertHTML',false,safeDocument(html)); else document.execCommand('insertText',false,event.clipboardData.getData('text/plain')); markDirty(); }; rich.ondrop=event=>event.preventDefault(); }
  const formula=panel.querySelector('#formula'); if (formula) formula.oninput=()=>{const workbook=state.current.meta.workbook; workbook.sheets[state.sheet].cells[state.cell]=formula.value; markDirty(); updateCells();};
}
function detailContent(r) {
  const m=r.meta, disabled=m.remote?'disabled':'';
  if (state.app==='mail' && m.folder!=='Drafts') {
    const recovery=!!m.remote && ['Recovery copies','Not in Inbox'].includes(m.folder);
    const actions=recovery?'<button data-action="keep-local">Save locally</button><button class="danger quiet" data-action="discard-copy">Discard copy</button>':`${m.remote?'<button data-action="file-mail">Move / Labels</button>':''}${m.folder!=='Archive'?`<button data-action="archive">${m.remote?'Archive':'Archive locally'}</button>`:''}${m.remote?m.folder==='Trash'?'<button data-action="restore-mail">Restore to Inbox</button>':'<button data-action="trash-mail">Move to Trash</button>':''}<button data-action="read">Mark ${m.read?'unread':'read'}</button>`;
    return `<h1>${e(r.title)}</h1><div class="meta-strip"><span>From: ${e(m.from||'Unknown')}</span><span>To: ${e(m.to||'')}</span><span>${e(m.date||'')}</span></div>${m.remote?`<p class="recurrence-note">${recovery?'This copy is absent from its synchronized folders. It may have moved elsewhere or been deleted. Save locally keeps an independent copy; Discard copy removes only this cached copy.':'Downloaded copy from '+e(mailLocation(r))+'. Mail actions update the provider; Sync now refreshes its location.'}</p>`:''}<div class="head-actions">${m.from?'<button data-action="reply">Reply</button>':''}${(m.rawBase64||m.raw)?'<button data-action="eml">Download original EML</button>':''}${actions}</div><hr>${mailBody(r,state.prefs)}`;
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
  if (state.app==='mail') content+='<div class="head-actions"><button type="button" class="primary" data-action="send">Send message</button><span class="muted">Saved drafts are never sent automatically.</span></div>';
  return content+'</form>';
}
function localInput(value) { if (!value) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value+'T00:00'; if (!/[Zz]|[+-]\d\d:\d\d$/.test(value)) return value.slice(0,16); const d=new Date(value); return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function workbook(r) {
  r.meta.workbook??={sheets:[{name:'Sheet 1',cells:{}}]};
  for (const s of r.meta.workbook.sheets) if (Array.isArray(s.cells)) s.cells={...s.cells};
  return r.meta.workbook;
}
function sheetContent(r) {
  const w=workbook(r); state.sheet=Math.min(state.sheet,w.sheets.length-1); const sheet=w.sheets[state.sheet];
  return `<div><div class="sheet-tabs">${w.sheets.map((s,i)=>`<button type="button" data-sheet="${i}" class="${i===state.sheet?'primary':''}">${e(s.name)}</button>`).join('')}<button type="button" data-action="add-sheet" aria-label="Add sheet">+</button><button type="button" data-action="rename-sheet">Rename</button></div><label class="formula-bar"><code id="cell-label">${state.cell}</code><span class="file-input">Cell formula or value</span><input id="formula" value="${e(sheet.cells[state.cell]||'')}" autocomplete="off" aria-label="Cell formula or value"></label><div class="sheet-wrap"><table class="sheet" aria-label="Spreadsheet"><thead><tr><th></th>${Array.from({length:12},(_,c)=>`<th scope="col">${colName(c)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:30},(_,row)=>`<tr><th scope="row">${row+1}</th>${Array.from({length:12},(_,col)=>{ const ref=colName(col)+(row+1); return `<td><button type="button" data-cell="${ref}" class="${state.cell===ref?'cell-selected':''}" tabindex="${state.cell===ref?'0':'-1'}" aria-label="${ref}: ${e(cellValue(sheet.cells,ref))}">${e(cellValue(sheet.cells,ref))}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">30 × 12 visible cells · + − * / ^ · SUM, AVERAGE, MIN, MAX, COUNT · A1:B5 ranges. Use i or Enter to edit, Escape to return, Tab/arrows to move. Cross-sheet formulas are deferred.</p></div>`;
}
function updateCells() { const cells=workbook(state.current).sheets[state.sheet].cells; document.querySelectorAll('[data-cell]').forEach(b=>{ const v=cellValue(cells,b.dataset.cell); b.textContent=v; b.setAttribute('aria-label',b.dataset.cell+': '+v); }); }
function selectCell(ref,focus=false) {
  state.cell=ref; const sheet=workbook(state.current).sheets[state.sheet];
  document.querySelector('#cell-label').textContent=ref; document.querySelector('#formula').value=sheet.cells[ref]||'';
  document.querySelectorAll('[data-cell]').forEach(b=>{ const selected=b.dataset.cell===ref; b.classList.toggle('cell-selected',selected); b.tabIndex=selected?0:-1; if(selected&&focus) b.focus(); });
}
function collect() {
  if (!state.current) return; const form=document.querySelector('#record-form'); if (!form) return; const values=Object.fromEntries(new FormData(form));
  state.current.title=values.title||state.current.title; if ('body' in values) state.current.body=values.body;
  const m=state.current.meta;
  for (const key of ['due','priority','email','phone','company','group','location','to','sendAccount']) if (key in values) m[key]=values[key];
  for (const key of ['start','end']) if (key in values) m[key]=values[key]?new Date(values[key]).toISOString():'';
  if (state.app==='tasks') m.done=values.done==='on';
  if (state.app==='documents') state.current.body=safeDocument(document.querySelector('#rich-editor').innerHTML);
}
function markDirty() { state.dirty=true; const s=document.querySelector('#save-status'); if(s) s.textContent='Unsaved changes'; clearTimeout(saveTimer); saveTimer=setTimeout(()=>void attempt(()=>commit()),800); }
async function commit() {
  clearTimeout(saveTimer); if(state.savePromise) await state.savePromise; if(!state.dirty || !state.current) return;
  collect(); const payload=structuredClone(state.current); state.dirty=false; const id=payload.id;
  state.savePromise=(async()=>{try { const result=await api('save',payload); if(state.current?.id===id) { state.current.revision=result.record.revision; state.current.updated=result.record.updated; const pos=state.rows.findIndex(r=>r.id===id); if(pos>=0)state.rows[pos]=state.current; }
    const s=document.querySelector('#save-status'); if(s) s.textContent=state.dirty?'Unsaved changes':'Saved'; renderList();
  } catch(error) { state.dirty=true; const s=document.querySelector('#save-status'); if(s) s.textContent='Save failed · keep this page open'; throw error; } finally { state.savePromise=null; }})();
  await state.savePromise; if(state.dirty) await commit();
}
async function changeApp(name) { await commit(); if(name==='mail'&&state.app!=='mail'){state.mailFolder='Inbox';state.mailScope=null;} state.app=name; state.current=null; state.search=''; state.sheet=0; state.cell='A1'; state.mode='normal'; location.hash=name; await load(); }
async function selectRecord(id,focus=false) { await commit(); state.current=state.rows.find(r=>r.id===id)||null; state.sheet=0; state.cell='A1'; renderList(); renderDetail(); if(focus)document.querySelector('#selected-item')?.focus({preventScroll:true}); }
function mailAccounts() { return state.accounts.filter(a=>['imap','google'].includes(a.type)); }
function draftAccount(context) {
  const accounts=mailAccounts();
  return [context?.meta.sendAccount,context?.meta.account,state.prefs.defaultMailAccount,accounts.length===1?accounts[0].id:''].find(id=>accounts.some(a=>a.id===id)) || '';
}
async function createRecord(initial={}) {
  await commit(); const kind=state.app;
  if (!apps[kind]) return;
  // Remove the previous editor before the network round-trip, so fast typing cannot overwrite it.
  const previous=state.current;
  document.querySelector('#detail').innerHTML='<p class="muted" role="status">Creating item…</p>';
  const record={kind,title:initial.title||'Untitled '+apps[kind].singular,body:initial.body||'',meta:{...(kind==='mail'?{folder:'Drafts'}:{}),...initial.meta}};
  if(kind==='mail' && !record.meta.sendAccount)record.meta.sendAccount=draftAccount(previous);
  if(kind==='calendar') { const start=new Date(); start.setMinutes(0,0,0); record.meta.start=start.toISOString(); record.meta.end=new Date(+start+3600000).toISOString(); }
  if(kind==='sheets')record.meta.workbook={sheets:[{name:'Sheet 1',cells:{}}]};
  if(kind==='mail'){state.mailScope=null;if(state.mailFolder!=='all')state.mailFolder='Drafts';}
  try { const result=await api('save',record); state.wikiPreview=false; await load(result.record.id); enterEdit(true); }
  catch(error) { state.current=previous;renderDetail();throw error; }
}
function enterEdit(preferTitle=false) {
  if (state.current?.meta.remote) {notice('This synced copy is read-only.');return;}
  if(state.app==='wiki'&&state.wikiPreview){state.wikiPreview=false;renderDetail();}
  const target=state.app==='sheets'?document.querySelector('#formula'):preferTitle?document.querySelector('.title-input'):state.app==='documents'?document.querySelector('#rich-editor'):state.app==='wiki'?document.querySelector('[name=body]'):document.querySelector('.title-input');
  target?.focus();if(target?.select&&(preferTitle||target.id==='formula'))target.select();setMode('insert');
}
function setMode(mode) {state.mode=mode;const m=document.querySelector('#mode');if(m)m.textContent=mode.toUpperCase();}
async function attempt(fn) { try{return await fn();}catch(error){notice(error.message,true);} }
function modal(title,body) { dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button class="quiet" data-close aria-label="Close dialog">✕</button></div>${body}`; dialog.querySelector('[data-close]').onclick=()=>dialog.close(); dialog.showModal(); }
function confirmation(title,message,action) { modal(title,`<p>${e(message)}</p><div class="dialog-actions"><button id="cancel">Cancel</button><button class="primary" id="confirm">${e(title)}</button></div>`); dialog.querySelector('#cancel').onclick=()=>dialog.close();dialog.querySelector('#cancel').focus();dialog.querySelector('#confirm').onclick=async()=>{dialog.close();await attempt(action);}; }
function download(name,text,type='text/plain') { const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function originalMail(record) { return record.meta.rawBase64 ? Uint8Array.from(atob(record.meta.rawBase64),c=>c.charCodeAt(0)) : record.meta.raw || ''; }
async function exportRecords(all=false) {
  await commit(); const records=all?state.rows:[state.current].filter(Boolean); if(!records.length){notice('There is nothing to export yet.');return;}
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
  input.onchange=()=>void attempt(async()=>{const file=input.files[0];if(!file)return;if(file.size>8*1024*1024)throw Error('Import files up to 8 MB.');const text=await file.text(), ext=file.name.split('.').at(-1).toLowerCase();let records=[];
    if(ext==='ics'||ext==='eml'){const payload={format:ext,text:ext==='ics'?text:''};if(ext==='eml'){if(file.size>1400000)throw Error('Original EML import supports up to 1.4 MB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));payload.base64=btoa(binary);}const r=await api('import',payload);notice(`Imported ${r.count} items locally.`);await load();return;}
    if(ext==='json'){const data=JSON.parse(text);if(data.format==='portable-office'){confirmation('Restore backup','Restore into this empty workspace? Remote copies become local archives. Accounts and credentials are not restored.',async()=>{const r=await api('restore',{backup:data});state.prefs=data.preferences||{};applyTheme();await load();notice(`Restored ${r.count} items.`);});return;}if(data.format!=='portable-office-items'||data.version!==1||!Array.isArray(data.records))throw Error('Unsupported JSON file.');records=data.records;}
    else if(ext==='vcf')records=vcardParse(text);
    else if(ext==='csv') {const rows=csvParse(text);if(rows.length>100||rows.some(r=>r.length>26))throw Error('CSV import supports 100 rows and 26 columns.');const cells={};rows.forEach((row,r)=>row.forEach((value,c)=>{if(value)cells[colName(c)+(r+1)]=value;}));records=[{kind:'sheets',title:file.name.replace(/\.csv$/i,''),body:'',meta:{workbook:{sheets:[{name:'Sheet 1',cells}]}}}];}
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
  state.syncing=true;busyButton(document.querySelector('#sync-button'),true);let errors=0;
  for(const a of state.accounts){if(document.hidden || (!manual && Date.now()-state.lastActivity>120000))break;const s=document.querySelector('#sync-status');if(s)s.textContent='Syncing '+a.label+'…';try{await api('sync',{id:a.id});}catch(error){errors++;if(manual)notice(a.label+': '+error.message,true);}}
  state.syncing=false;busyButton(document.querySelector('#sync-button'),false);const s=document.querySelector('#sync-status');if(s)s.textContent=errors?'Sync needs attention':'Checked '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  state.accounts=(await api('accounts')).accounts;
  if(state.app==='mail'&&state.mailScope&&!state.dirty){try{await syncOpenFolder(mailFolderEnv());}catch(error){if(manual)notice(error.message,true);}}
  // Never replace an active editor with network data.
  if(state.app==='settings')renderSettings();else if(!state.dirty&&!editable(document.activeElement))await load();
}
function help() {
  const k=keys();modal('Keyboard shortcuts',`<p class="muted">Normal mode navigates. Insert mode types. Standard Tab navigation always works. Rich-text editing uses browser editing keys; full Vim operators are planned.</p>${[[k.down+' / '+k.up,'Next / previous item'],[k.left+' / '+k.right,'Focus list / selected item'],['gg / G','First / last item'],['g 1 … g 7','Switch applications'],[k.search,'Search this application'],['n / N','Next / previous search result'],[k.new,'Create an item / compose'],[k.edit,'Enter edit mode'],['Escape','Leave editing and save'],[k.select,'Toggle selection'],[k.save+' / Ctrl or Cmd+S','Save changes'],[k.delete,'Delete current item / move connected mail to Trash'],[k.archive,'Archive selected messages'],[k.read,'Toggle read / unread'],[k.reply,'Reply to message'],['Sheets: h j k l / arrows','Move between cells'],['Sheets: i / Enter','Edit selected cell'],['Sheets: Tab / Shift+Tab','Next / previous cell']].map(([key,meaning])=>`<div class="help-row"><span>${meaning}</span><kbd>${e(key)}</kbd></div>`).join('')}<p class="muted">Remap single-key actions in Settings. Local deletion requires confirmation. Connected mail moves to Trash; messages already in Trash and synced read-only items are protected. No send shortcut is enabled.</p>`);
}
async function history() {await commit();const r=await api('history&id='+state.current.id);modal('Revision history',r.revisions.map(h=>`<button class="history-row" data-revision="${h.revision}">Revision ${h.revision} · ${e(h.snapshot.title)}</button>`).join('')||'<p>No saved revisions.</p>');dialog.querySelectorAll('[data-revision]').forEach(b=>b.onclick=()=>{const h=r.revisions.find(x=>x.revision===Number(b.dataset.revision));modal('Revision '+h.revision,`<pre class="mail-body">${e(h.snapshot.body)}</pre><button id="restore-revision">Restore this content</button>`);dialog.querySelector('#restore-revision').onclick=()=>void attempt(async()=>{state.current.title=h.snapshot.title;state.current.body=h.snapshot.body;state.current.meta=h.snapshot.meta;state.dirty=true;dialog.close();renderDetail();await commit();});});}
async function handleClick(event) {
  const button=event.target.closest('button');if(!button)return;
  await attempt(async()=>{
    if(button.dataset.app){await changeApp(button.dataset.app);return;}
    if(button.dataset.id){await selectRecord(button.dataset.id);return;}
    if(button.dataset.wiki){const page=state.rows.find(r=>r.title===button.dataset.wiki);if(page){state.wikiPreview=true;await selectRecord(page.id);}else{confirmation('Create page',`Create “${button.dataset.wiki}”?`,()=>createRecord({title:button.dataset.wiki}));}return;}
    if(button.dataset.cell){selectCell(button.dataset.cell,true);return;}
    if(button.dataset.sheet!==undefined){await commit();state.sheet=Number(button.dataset.sheet);state.cell='A1';renderDetail();return;}
    const action=button.dataset.action;
    if(action==='toggle-mail-folders')setMailFolderPanel(!document.querySelector('.shell').classList.contains('folders-open'));
    if(action==='close-mail-folders'){setMailFolderPanel(false);document.querySelector('#mail-folders-toggle')?.focus();}
    if(action==='new')await createRecord();
    if(action==='help')help();
    if(action==='sync')await syncAccounts();
    if(action==='file-mail')await fileMail(mailFolderEnv());
    if(action==='trash-mail')await mailAction('trash');
    if(action==='restore-mail')await mailAction('restore');
    if(action==='keep-local')await mailAction('keep-local');
    if(action==='discard-copy'){const record=state.current;confirmation('Discard copy','Permanently remove this cached recovery copy from Office? Your server mailbox is unaffected.',()=>mailAction('discard',record));}
    if(action==='import')await importFile();
    if(action==='export')await exportRecords();
    if(action==='export-all')await exportRecords(true);
    if(action==='print'){await commit();window.print();}
    if(action==='image')insertImage();
    if(action==='link')insertLink();
    if(action==='text'){await commit();const html=safeDocument(state.current.body).replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi,'\n').replace(/<br\s*\/?\s*>/gi,'\n');const doc=new DOMParser().parseFromString(html,'text/html');download(state.current.title+'.txt',doc.body.textContent);}
    if(action==='wiki-mode'){await commit();state.wikiPreview=!state.wikiPreview;renderDetail();if(!state.wikiPreview)enterEdit();}
    if(action==='history')await history();
    if(action==='delete')confirmation('Delete item','Delete this item and its revision history? Export a copy first if you need it.',async()=>{await commit();await api('delete',{id:state.current.id,revision:state.current.revision});state.current=null;await load();notice('Item deleted.');});
    if(action==='logout'){await commit();await api('logout',{});await boot();}
    if(action==='eml')download(state.current.title+'.eml',originalMail(state.current),'message/rfc822');
    if(action==='original-ics')download(state.current.title+'.ics',state.current.meta.rawIcs||state.current.meta.raw,'text/calendar');
    if(action==='read')await readMail();
    if(action==='archive')await archiveLocal();
    if(action==='reply'){const r=state.current;const match=(r.meta.from||'').match(/<([^>]+)>/);await createRecord({title:/^Re:/i.test(r.title)?r.title:'Re: '+r.title,body:'\n\nOn '+(r.meta.date||'')+', '+(r.meta.from||'')+' wrote:\n'+r.body.split('\n').map(l=>'> '+l).join('\n'),meta:{to:match?match[1]:r.meta.from}});}
    if(action==='send'){await commit();if(!state.current.meta.sendAccount)throw Error('Choose a sending account first.');confirmation('Send message',`Send this saved draft to ${state.current.meta.to}?`,async()=>{button.disabled=true;try{await api('send',{id:state.current.id,revision:state.current.revision,account:state.current.meta.sendAccount});notice('Message accepted by the provider.');}finally{await load();}});}
    if(action==='add-sheet'){await commit();const w=workbook(state.current);if(w.sheets.length>=10)throw Error('Up to 10 sheets per workbook.');w.sheets.push({name:'Sheet '+(w.sheets.length+1),cells:{}});state.sheet=w.sheets.length-1;state.cell='A1';renderDetail();markDirty();}
    if(action==='rename-sheet'){modal('Rename sheet',`<form id="rename-form">${field('Name','name',workbook(state.current).sheets[state.sheet].name,'text','required maxlength="60"')}<button class="primary">Rename</button></form>`);dialog.querySelector('form').onsubmit=ev=>{ev.preventDefault();collect();workbook(state.current).sheets[state.sheet].name=new FormData(ev.target).get('name');dialog.close();renderDetail();markDirty();};}
  });
}
async function archiveLocal() {
  if(state.app!=='mail')return;await commit();const ids=state.selected.size?[...state.selected]:[state.current?.id].filter(Boolean);let count=0;
  try {
    for(const id of ids){const r=state.rows.find(r=>r.id===id);if(r.meta.remote)await api('mail-action',{id:r.id,revision:r.revision,action:'archive'});else{r.meta.folder='Archive';await api('save',r);}count++;}
  } catch(error) {
    // The provider check may have corrected cached membership even when the move failed.
    try { await load(); } catch {}
    throw error;
  }
  await load();notice(`Archived ${count} messages.`);
}
async function mailAction(action,record=state.current) {
  if(state.app!=='mail'||!record)return;await commit();
  try { await api('mail-action',{id:record.id,revision:record.revision,action}); }
  finally { await load(); }
  notice(action==='keep-local'?'Saved in Local mail.':action==='discard'?'Cached copy discarded.':action==='trash'?'Moved to Trash.':'Restored to Inbox.');
}
async function repairMail(accountId,button) {
  if(state.syncing){notice('Wait for the current sync to finish.',true);return;}
  await commit();state.syncing=true;busyButton(button,true);busyButton(document.querySelector('#sync-button'),true);
  try {await api('sync',{id:accountId,repair:true});notice('Mail folders resynchronized. Local mail and credentials were kept.');}
  catch(error){notice(error.message,true);}
  finally {state.syncing=false;busyButton(button,false);busyButton(document.querySelector('#sync-button'),false);state.accounts=(await api('accounts')).accounts;if(state.app==='settings')renderSettings();else await load();}
}
async function readMail() {
  if(state.app!=='mail'||!state.current)return;await commit();const r=state.current;
  if(r.meta.remote)await api('mail-action',{id:r.id,revision:r.revision,action:r.meta.read?'unread':'read'});
  else{r.meta.read=!r.meta.read;await api('save',r);}await load(r.id);
}
function editorSelection() {
  const editor=document.querySelector('#rich-editor'), selection=getSelection();
  const range=selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)?selection.getRangeAt(0).cloneRange():null;
  return ()=>{if(!document.contains(editor))throw Error('The document changed before insertion. Reopen it and try again.');editor.focus();const selection=getSelection();selection.removeAllRanges();if(range)selection.addRange(range);else{const end=document.createRange();end.selectNodeContents(editor);end.collapse(false);selection.addRange(end);}};
}
function insertImage() {
  const restore=editorSelection(), input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/gif,image/webp';
  input.onchange=()=>void attempt(async()=>{const file=input.files[0];if(!file)return;if(file.size>900000)throw Error('Choose an image smaller than 900 KB.');if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type))throw Error('Use PNG, JPEG, GIF or WebP.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Cannot read image.'));reader.readAsDataURL(file);});restore();document.execCommand('insertHTML',false,safeDocument('<img src="'+e(data)+'" alt="'+e(file.name)+'">'));markDirty();});input.click();
}
function insertLink() {
  const restore=editorSelection();modal('Insert link',`<form id="link-form">${field('URL','url','https://','url','required')}<button class="primary">Apply link to selection</button></form>`);
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const url=new FormData(event.target).get('url');if(!/^(https?:|mailto:)/i.test(url)){notice('Use an HTTP(S) or mailto URL.',true);return;}dialog.close();restore();if(getSelection().isCollapsed)document.execCommand('insertHTML',false,'<a href="'+e(url)+'" rel="noreferrer noopener">'+e(url)+'</a>');else document.execCommand('createLink',false,url);markDirty();};
}
function renderSettings() {
  const p=state.prefs;
  document.querySelector('#main').innerHTML=`<section class="view-head"><div><h1>Settings</h1><p>Preferences, connected accounts, and backups.</p></div></section><div class="settings"><div class="settings-grid"><section class="card"><h2>Look & feel</h2><p>Choose a theme, accent color, and density.</p><form id="preferences"><label>Theme<select name="theme" aria-label="Theme">${['system','light','dark'].map(x=>`<option ${p.theme===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Accent<select name="accent" aria-label="Accent">${['green','blue','plum'].map(x=>`<option ${p.accent===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Density<select name="density" aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact" ${p.density==='compact'?'selected':''}>Compact</option></select></label><button class="primary">Save preferences</button></form></section><section class="card"><h2>Data and backups</h2><p>Your database and content live inside this application folder. Backups include local records, cached messages, revisions and preferences. Account credentials and your password are excluded.</p><button id="backup">↓ Download full backup</button><p>Restore into an empty installation. Synced copies become local archives; reconnect providers separately. Never copy a live SQLite file as a backup.</p><button id="restore">↑ Restore backup</button><p>Documents: basic formatting and HTML/text. Calendar: agenda, no local recurrence expansion or invitations. Sheets: simple formulas. See README for version limits.</p></section><section class="card full"><h2>Mail</h2><form id="mail-preferences"><label>Default email display<select name="mailDisplay" aria-label="Default email display"><option value="html" ${p.mailDisplay!=='text'?'selected':''}>HTML</option><option value="text" ${p.mailDisplay==='text'?'selected':''}>Text only</option></select></label><label>Default mail account<select name="defaultMailAccount" aria-label="Default mail account"><option value="">Automatic (only account, when available)</option>${mailAccounts().map(a=>`<option value="${e(a.id)}" ${p.defaultMailAccount===a.id?'selected':''}>${e(a.label)}</option>`).join('')}</select></label><p>New drafts use the selected message’s account first, then this default. Saved drafts keep their chosen account.</p><button class="primary">Save mail preferences</button></form></section><section class="card full" id="google-integration"><h2>Google integration</h2><p>Loading…</p></section><section class="card full"><h2>Connected accounts</h2><p>Only checked while this page is visible and you have used it within two minutes. Automatic checks every two minutes; Sync now is always available. Inbox, Archive and Trash: up to 10 recent messages per folder, plus previously cached mail. Folder membership is reconciled against the server. Agenda: previous week through next 90 days, up to 100 events. These are cached windows, not complete archives.</p><div>${state.accounts.map(a=>`<div class="account"><div><strong>${e(a.label)} <span class="badge">${e(a.type)}</span></strong><small>${a.last_sync?'Last checked '+e(new Date(a.last_sync).toLocaleString()):'Not checked yet'}${a.error?' · '+e(a.error):''}</small></div><div class="actions">${['imap','google'].includes(a.type)?`<button data-repair-account="${a.id}">Repair / resync</button>`:''}${a.type==='google'?`<button data-google="${a.id}">Authorize</button>`:''}<button class="danger quiet" data-remove-account="${a.id}">Remove</button></div></div>`).join('')||'<p>No accounts connected. Your local apps work without a provider.</p>'}</div><button id="add-account">+ Add account</button><label class="check-label"><input id="keep-recovery" type="checkbox" ${p.keepRecoveryCopies!==false?'checked':''}> Keep recovery copies of messages absent from synchronized folders</label><p>Recovery copies are excluded from All cached mail. Save them in Local mail or discard them. Turning this off removes absent cached copies on the next successful sync; local mail is kept.</p><p>IMAP uses TLS port 993; SMTP uses TLS port 465 with the same credentials. CalDAV requires the calendar collection URL. Public hostnames only. Configure Google integration once above, then connect each Gmail account through Google sign-in.</p></section><section class="card full"><h2>Keyboard bindings</h2><p>Home-row navigation is on by default. Remap single-character actions below. Full Vim text operators and visual selections inside document editors are future work.</p><form id="key-form"><div class="fields">${Object.entries(defaultKeys).map(([action,key])=>field(action,'key_'+action,keys()[action],'text','required maxlength="1"')).join('')}</div><button class="primary">Save bindings</button></form></section></div></div>`;
  void renderGoogleSettings(document.querySelector('#google-integration'),api);
  document.querySelector('#preferences').onsubmit=ev=>{ev.preventDefault();void attempt(async()=>{state.prefs={...state.prefs,...Object.fromEntries(new FormData(ev.target))};await api('preferences',{preferences:state.prefs});applyTheme();notice('Preferences saved.');});};
  document.querySelector('#mail-preferences').onsubmit=event=>{event.preventDefault();void attempt(async()=>{const preferences={...state.prefs,...Object.fromEntries(new FormData(event.target))};await api('preferences',{preferences});state.prefs=preferences;notice('Mail preferences saved.');});};
  document.querySelector('#key-form').onsubmit=ev=>{ev.preventDefault();void attempt(async()=>{const map=Object.fromEntries([...new FormData(ev.target)].map(([k,v])=>[k.slice(4),v]));if(new Set(Object.values(map)).size!==Object.values(map).length)throw Error('Choose a different key for each action.');if(Object.values(map).some(v=>'gGnN0123456789'.includes(v)||/\s/.test(v)))throw Error('g/G, n/N, numbers and whitespace are reserved.');state.prefs.keys=map;await api('preferences',{preferences:state.prefs});notice('Bindings saved.');});};
  document.querySelector('#backup').onclick=()=>void attempt(async()=>download('office-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(await api('backup'),null,2),'application/json'));
  document.querySelector('#restore').onclick=()=>void attempt(importFile);
  document.querySelector('#add-account').onclick=accountDialog;
  document.querySelector('#keep-recovery').onchange=event=>void attempt(async()=>{state.prefs={...state.prefs,keepRecoveryCopies:event.target.checked};await api('preferences',{preferences:state.prefs});notice('Recovery preference saved.');});
  document.querySelectorAll('[data-repair-account]').forEach(b=>b.onclick=()=>void repairMail(b.dataset.repairAccount,b));
  document.querySelectorAll('[data-google]').forEach(b=>b.onclick=()=>void attempt(async()=>{const r=await api('google-connect',{id:b.dataset.google});location.href=r.url;}));
  document.querySelectorAll('[data-remove-account]').forEach(b=>b.onclick=()=>confirmation('Remove account','Remove the saved credentials and downloaded cache from this workspace? The provider account is unaffected.',async()=>{await api('account-delete',{id:b.dataset.removeAccount});state.accounts=(await api('accounts')).accounts;renderSettings();}));
}
function accountDialog() {
  openAccountSetup({dialog,request:api,onSaved:async()=>{
    state.accounts=(await api('accounts')).accounts;
    renderSettings();
  }});
}
document.addEventListener('keydown',event=>{
  state.lastActivity=Date.now();if(dialog.open)return;
  if(event.key==='Escape'&&document.querySelector('.shell')?.classList.contains('folders-open')){setMailFolderPanel(false);document.querySelector('#mail-folders-toggle')?.focus();event.preventDefault();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void attempt(commit);return;}
  if(event.key==='Escape'){if(editable(event.target)){event.target.blur();setMode('normal');event.preventDefault();void attempt(commit);if(event.target.id==='formula')selectCell(state.cell,true);}else{state.selected.clear();if(state.app!=='settings')renderList();}return;}
  if(editable(event.target)){setMode('insert');return;}
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const k=keys(), key=event.key;setMode('normal');
  if(Date.now()-sequenceTime>900)keySequence='';sequenceTime=Date.now();
  if(keySequence==='g'&&/^[1-7]$/.test(key)){event.preventDefault();keySequence='';void attempt(()=>changeApp(Object.keys(apps)[Number(key)-1]));return;}
  if(keySequence==='g'&&key==='g'){keySequence='';event.preventDefault();const row=filteredRows()[0];if(row)void attempt(()=>selectRecord(row.id,true));return;}
  if(key==='g'){keySequence='g';event.preventDefault();return;}keySequence='';
  const action=Object.keys(k).find(action=>k[action]===key);
  if(action==='help'){event.preventDefault();help();return;}
  if(state.app==='settings')return;
  if(action==='search'){event.preventDefault();document.querySelector('#search')?.focus();return;}
  if(action==='new'){event.preventDefault();void attempt(createRecord);return;}
  if(action==='edit'||(state.app==='sheets'&&key==='Enter')){event.preventDefault();enterEdit();return;}
  if(action==='save'){event.preventDefault();void attempt(commit);return;}
  if(action==='delete'){
    event.preventDefault();
    // Use the current item's available action, preserving confirmation and read-only restrictions.
    if(!event.repeat&&state.current)document.querySelector('#detail [data-action="trash-mail"], #detail [data-action="delete"]')?.click();
    return;
  }
  if(action==='archive'){event.preventDefault();void attempt(archiveLocal);return;}
  if(action==='read'){event.preventDefault();void attempt(readMail);return;}
  if(action==='reply'&&state.app==='mail'){event.preventDefault();document.querySelector('[data-action=reply]')?.click();return;}
  if(action==='select'&&state.current){event.preventDefault();const id=state.current.id;if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);renderList();return;}
  if(state.app==='sheets'&&state.current&&event.target.closest('.sheet-wrap')&&([k.left,k.right,k.down,k.up,'ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Tab'].includes(key))){event.preventDefault();let [r,c]=cellPosition(state.cell);if(key===k.left||key==='ArrowLeft'||key==='Tab'&&event.shiftKey)c--;else if(key===k.right||key==='ArrowRight'||key==='Tab')c++;else if(key===k.up||key==='ArrowUp')r--;else r++;selectCell(colName(Math.max(0,Math.min(11,c)))+(Math.max(0,Math.min(29,r))+1),true);return;}
  if(action==='left'){event.preventDefault();document.querySelector('#selected-item')?.focus();return;}
  if(action==='right'){event.preventDefault();if(state.app==='sheets'&&state.current)selectCell(state.cell,true);else{document.querySelector('#detail')?.setAttribute('tabindex','-1');document.querySelector('#detail')?.focus();}return;}
  if(action==='down'||action==='up'||key==='n'||key==='N'||key==='G'){event.preventDefault();const rows=filteredRows();const index=rows.findIndex(r=>r.id===state.current?.id);const next=key==='G'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(action==='up'||key==='N'?-1:1)));if(rows[next])void attempt(()=>selectRecord(rows[next].id,true));}
});
document.addEventListener('focusin',event=>{if(editable(event.target))setMode('insert');});
document.addEventListener('pointerdown',()=>state.lastActivity=Date.now(),{passive:true});
document.addEventListener('wheel',()=>state.lastActivity=Date.now(),{passive:true});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.savePromise){event.preventDefault();event.returnValue='';}});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
setInterval(()=>{if(document.querySelector('.shell'))void attempt(()=>syncAccounts(false));},120000);
void boot();
