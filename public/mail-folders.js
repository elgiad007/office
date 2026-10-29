export function matchesMailScope(row,scope,accounts) {
  if (!row.meta.remote || row.meta.account!==scope.account || ['Recovery copies','Not in Inbox'].includes(row.meta.folder)) return false;
  return accounts.find(a=>a.id===scope.account)?.type==='google'
    ? (row.meta.labelIds||[]).includes(scope.folder) : row.meta.serverFolder===scope.folder;
}
async function busy(env,run) {
  if(env.state.syncing)throw Error('Wait for the current mail operation to finish.');
  env.state.syncing=true;
  const buttons=[...document.querySelectorAll('#sync-button, #folder-refresh, #folder-more, [data-open-folder], [data-refresh-folders], [data-manage-folder]')].map(button=>[button,button.disabled]);
  buttons.forEach(([button])=>button.disabled=true);
  try {return await run();} finally {env.state.syncing=false;buttons.forEach(([button,disabled])=>button.disabled=disabled);}
}
async function reloadMail(env) {
  // A request may finish after the owner has opened an editor in another app.
  if(env.state.app==='mail'&&!env.state.dirty&&!env.state.savePromise)await env.load();
}
export async function syncOpenFolder(env,more=false) {
  const scope=env.state.mailScope;if(!scope)return;
  const limit=more?Math.min(500,scope.limit+10):scope.limit;
  await busy(env,()=>env.api('mail-folder-sync',{account:scope.account,folder:scope.folder,limit}));
  scope.limit=limit;await reloadMail(env);
}
function tree(folders,e,account,path='',depth=0) {
  // Construct missing parent containers as well as selectable nested folders.
  if(depth>50)return '';
  const nodes=new Map();
  for(const f of folders){
    const parts=f.delimiter?f.name.split(f.delimiter):[f.name];
    const prefix=parts.slice(0,depth).join(f.delimiter);
    if(prefix!==path || parts.length<=depth)continue;
    const name=parts[depth], key=parts.slice(0,depth+1).join(f.delimiter);
    if(!nodes.has(key))nodes.set(key,{name,key,folder:null,children:[]});
    const node=nodes.get(key);if(parts.length===depth+1)node.folder=f;else node.children.push(f);
  }
  return [...nodes.values()].map(n=>{
    const button=n.folder?`<button class="folder-link" data-open-folder="${e(n.folder.id)}" data-folder-account="${e(account)}">${e(n.name)}</button>`:`<span>${e(n.name)}</span>`;
    return n.children.length?`<details open><summary>${button}</summary><div class="folder-children">${tree(n.children,e,account,n.key,depth+1)}</div></details>`:button;
  }).join('');
}
export function renderMailFolders(env) {
  const {state,e}=env, navigation=document.querySelector('#mail-folder-navigation'), controls=document.querySelector('.search-wrap'), host=document.querySelector('.shell');
  const scope=state.mailScope, account=state.accounts.find(a=>a.id===scope?.account), folder=account?.folders?.find(f=>f.id===scope.folder);
  navigation.insertAdjacentHTML('beforeend',`<div class="account-folders" aria-label="Account folders">${state.accounts.filter(a=>['imap','google'].includes(a.type)).map(a=>`<details class="folder-account" ${state.folderOpen.has(a.id)?'open':''} data-account-tree="${e(a.id)}"><summary>${e(a.label)}${a.type==='google'?' · Labels':''}</summary><div class="folder-tools"><button data-refresh-folders="${e(a.id)}">Refresh folders</button><button data-manage-folder="create" data-folder-account="${e(a.id)}">New ${a.type==='google'?'label':'folder'}</button></div>${tree(a.folders||[],e,a.id)||'<p class="muted">Refresh folders to discover this account’s folders.</p>'}</details>`).join('')}</div>`);
  controls.insertAdjacentHTML('beforeend',scope?`<div class="folder-current"><strong>${e(account?.label||'Account')} / ${e(folder?.name||scope.folder)}</strong><div class="folder-tools"><button id="folder-refresh">Refresh mail</button><button id="folder-more" ${scope.limit>=500?'disabled':''}>Load more</button>${folder&&!folder.protected?`<button data-manage-folder="rename" data-folder-account="${e(scope.account)}">Rename</button><button data-manage-folder="delete" data-folder-account="${e(scope.account)}">Delete</button>`:''}</div><small>Downloaded copies · up to ${scope.limit} recent messages, plus previously cached mail.</small></div>`:'');
  host.querySelectorAll('[data-account-tree]').forEach(d=>d.ontoggle=()=>{if(d.open)state.folderOpen.add(d.dataset.accountTree);else state.folderOpen.delete(d.dataset.accountTree);});
  host.querySelectorAll('[data-refresh-folders]').forEach(b=>b.onclick=()=>env.attempt(async()=>{
    await env.commit();b.disabled=true;
    try {const result=await busy(env,()=>env.api('mail-folders',{account:b.dataset.refreshFolders}));state.accounts.find(a=>a.id===b.dataset.refreshFolders).folders=result.folders;await reloadMail(env);}
    finally {b.disabled=false;}
  }));
  host.querySelectorAll('[data-open-folder]').forEach(b=>b.onclick=()=>env.attempt(async()=>{
    await env.commit();state.mailScope={account:b.dataset.folderAccount,folder:b.dataset.openFolder,limit:10};state.current=null;state.selected.clear();
    if(matchMedia('(max-width: 800px)').matches)env.closeFolderPanel?.();
    await reloadMail(env);await syncOpenFolder(env);
  }));
  host.querySelectorAll('[data-open-folder]').forEach(b=>{if(scope?.account===b.dataset.folderAccount&&scope.folder===b.dataset.openFolder)b.setAttribute('aria-current','location');});
  host.querySelectorAll('[data-manage-folder]').forEach(b=>b.onclick=()=>env.attempt(()=>manageFolder(env,b.dataset.folderAccount,b.dataset.manageFolder)));
  const refresh=host.querySelector('#folder-refresh'),more=host.querySelector('#folder-more');
  if(refresh)refresh.onclick=()=>env.attempt(()=>syncOpenFolder(env));
  if(more)more.onclick=()=>env.attempt(()=>syncOpenFolder(env,true));
}
async function manageFolder(env,accountId,action) {
  const {state,e}=env;await env.commit();
  const account=state.accounts.find(a=>a.id===accountId),scope=state.mailScope;
  const folder=action==='create'?null:account.folders.find(f=>f.id===scope?.folder);
  const save=async name=>{
    const result=await busy(env,()=>env.api('mail-folder-manage',{account:accountId,action,folder:folder?.id||'',name}));
    account.folders=result.folders;
    if(action!=='create') {state.mailScope=null;state.current=null;state.selected.clear();}
    env.dialog.close();await reloadMail(env);env.notice(action==='delete'?'Folder removed.':'Folder saved.');
  };
  if(action==='delete') {
    env.confirmation('Delete '+(account.type==='google'?'label':'folder'),account.type==='google'?`Delete label “${folder.name}” from this account and all messages? The messages themselves will remain.`:`Delete empty folder “${folder.name}” from this account? Move messages and subfolders out first.`,()=>save(''));
    return;
  }
  env.modal(action==='create'?'New folder or label':'Rename folder or label',`<form id="folder-name-form">${env.field('Name (full path for nested folders)','name',folder?.name||'','text','required maxlength="500"')}<p class="muted">${account.type==='google'?'Use / for nested label names. Renaming changes this label only.':'Use the account’s folder separator for nested paths. Renaming also moves its subfolders.'}</p><button class="primary">Save folder</button></form>`);
  env.dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;void env.attempt(async()=>{try{await save(new FormData(event.target).get('name'));}finally{button.disabled=false;}});};
}
export async function fileMail(env) {
  await env.commit();const {state,e}=env;
  const rows=state.selected.size?state.rows.filter(r=>state.selected.has(r.id)):[state.current].filter(Boolean);
  if(!rows.length || rows.some(r=>!r.meta.remote || ['Recovery copies','Not in Inbox'].includes(r.meta.folder)))throw Error('Select connected mail from one account.');
  const account=state.accounts.find(a=>a.id===rows[0].meta.account);
  if(!account || rows.some(r=>r.meta.account!==account.id))throw Error('Select messages from the same account.');
  const result=await busy(env,()=>env.api('mail-folders',{account:account.id}));account.folders=result.folders;
  const folders=result.folders.filter(f=>account.type!=='google'||!f.protected);
  if(!folders.length)throw Error('Create a custom folder or label first using the account’s folder list.');
  env.modal(account.type==='google'?'Organize with labels':'Move to folder',`<form id="file-mail-form"><p>${rows.length} selected message(s) · ${e(account.label)}</p><label>Destination<select name="folder" required>${folders.map(f=>`<option value="${e(f.id)}">${e(f.name)}</option>`).join('')}</select></label>${account.type==='google'?'<label>Action<select name="action"><option value="label">Add label (keep Inbox and other labels)</option><option value="unlabel">Remove label</option><option value="move">Move here (remove Inbox and Trash, keep other labels)</option></select></label>':''}<button class="primary">Apply</button></form>`);
  env.dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const form=new FormData(event.target),button=event.target.querySelector('button');button.disabled=true;void env.attempt(async()=>{
    let count=0;
    try {await busy(env,async()=>{for(const row of rows){await env.api('mail-action',{id:row.id,revision:row.revision,action:form.get('action')||'move',folder:form.get('folder')});count++;}});env.dialog.close();env.notice(`Organized ${count} message(s).`);}
    catch(error){throw Error(`${count} of ${rows.length} messages organized. ${error.message}`);}
    finally{button.disabled=false;await reloadMail(env);}
  });};
}
