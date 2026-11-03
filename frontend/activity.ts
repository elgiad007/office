import {isPresent} from './utils.js';
import type {ActivityEntry} from './types.js';
import {escapeHtml as e} from './formats.js';

export function createActivity({csrf}: {csrf: () => string}) {
  const bar=document.querySelector<HTMLElement>('#activity-status')!,status=document.querySelector<HTMLElement>('#notice')!,button=document.querySelector<HTMLButtonElement>('#view-activity')!,dialog=document.querySelector<HTMLDialogElement>('#activity-dialog')!;
  let enabled=false,entries: ActivityEntry[]=[],cursor=0,polling=false,generation=0,lastMessage='Ready.',lastError=false,sequence=0;
  const tasks=new Map<number, {message: string; active: boolean; syncProgress?: boolean}>();
  let idle=true,localErrorHeld=false,commandErrorHeld=false,idleTimer: ReturnType<typeof setTimeout>;
  const markBusy=()=>{clearTimeout(idleTimer);idle=false;localErrorHeld=false;commandErrorHeld=false;};
  const settle=()=>{
    clearTimeout(idleTimer);
    if(!tasks.size)idleTimer=setTimeout(()=>{idle=true;localErrorHeld=false;commandErrorHeld=false;renderStatus();},lastError?8000:1200);
  };
  const request=async(data?: {action: string; message?: string; error?: boolean}): Promise<{entries?: ActivityEntry[]}>=>{
    const response=await fetch('api.php?r=activity'+(data?'':'&after='+cursor),{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-CSRF-Token':csrf()}:undefined,body:data?JSON.stringify(data):undefined,cache:'no-store'});
    if(!response.ok)throw Error('Activity log could not be loaded.');return response.json() as Promise<{entries?: ActivityEntry[]}>;
  };
  function renderStatus() {
    const active=[...tasks.values()].filter(task=>task.active),queued=tasks.size-active.length;
    status.textContent=idle&&!tasks.size?'Ready.':lastError?lastMessage+(tasks.size?` · ${tasks.size} pending`:''):active.length?active.at(-1)!.message+(queued?` · ${queued} queued`:''):queued?`${queued} operation(s) queued…`:lastMessage;
    status.className='show';status.setAttribute('role',lastError&&!idle?'alert':'status');
    bar.dataset.level=lastError&&!idle?'error':tasks.size?'busy':'info';
    bar.dataset.busy=String(tasks.size>0);bar.setAttribute('aria-busy',String(tasks.size>0));
    const errors=entries.filter(entry=>entry.level==='error').length,warnings=entries.filter(entry=>entry.level==='warning').length;
    const attention=errors?'error':warnings?'warning':'';
    const counts=[errors?`${errors} ${errors===1?'error':'errors'}`:'',warnings?`${warnings} ${warnings===1?'warning':'warnings'}`:''].filter(Boolean);
    const icon=attention?`<svg class="activity-attention-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${errors?'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>':'<path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v.01"/>'}</svg>`:'';
    button.dataset.attention=attention;
    button.innerHTML=icon+`<span>View activity${counts.length?' ('+counts.join(', ')+')':''}</span>`;
  }
  function filtered() {
    const level=dialog.querySelector<HTMLSelectElement>('#activity-level')!?.value||'',account=dialog.querySelector<HTMLSelectElement>('#activity-account')!?.value||'';
    return entries.filter(entry=>(!level||entry.level===level)&&(!account||entry.account===account));
  }
  function renderEntries() {
    if(!dialog.open)return;
    const select=dialog.querySelector<HTMLSelectElement>('#activity-account')!,selected=select.value;
    select.innerHTML='<option value="">All accounts</option>'+[...new Set(entries.map(entry=>entry.account).filter(isPresent))].sort().map(account=>`<option ${account===selected?'selected':''}>${e(account)}</option>`).join('');
    const rows=filtered().slice().reverse();
    dialog.querySelector<HTMLElement>('#activity-entries')!.innerHTML=rows.length?rows.map(entry=>`<li data-level="${e(entry.level)}"><div><time datetime="${e(entry.time)}">${e(new Date(entry.time).toLocaleString())}</time> · ${e(entry.level)}${entry.account?' · '+e(entry.account):''}${entry.duration_ms!==null?' · '+e(entry.duration_ms)+' ms':''}</div><strong>${e(entry.operation)}</strong><p>${e(entry.message)}</p></li>`).join(''):'<li>No recent activity matches these filters.</li>';
    dialog.querySelector<HTMLElement>('#activity-count')!.textContent=`${rows.length} of ${entries.length} recent entries · latest 500 retained`;
  }
  function receive(newEntries: ActivityEntry[]) {
    const byId=new Map(entries.map(entry=>[entry.id,entry]));for(const entry of newEntries)byId.set(entry.id,entry);
    entries=[...byId.values()].sort((a,b)=>a.id-b.id).slice(-500);cursor=entries.at(-1)?.id||cursor;
    if(localErrorHeld){renderStatus();renderEntries();return;}
    const latest=entries.filter(entry=>entry.phase!=='diagnostic').at(-1);if(!latest){renderStatus();renderEntries();return;}
    lastMessage=(latest.account?latest.account+': ':'')+latest.message;lastError=latest.level==='error';
    if(['progress','sync-progress'].includes(latest.phase)&&tasks.size){
      const active=[...tasks.values()].filter(task=>task.active),task=active.find(task=>latest.account&&task.message.startsWith(latest.account+': '))||(!latest.account?active.at(-1):undefined);
      if(task&&(latest.phase==='sync-progress'||!task.syncProgress)){
        task.message=lastMessage;task.syncProgress=latest.phase==='sync-progress';
      }
    }
    renderStatus();renderEntries();
  }
  async function poll() {
    if(!enabled||polling||document.hidden||tasks.size)return;
    polling=true;const currentGeneration=generation;
    try {
      const result=await request();if(currentGeneration!==generation||!enabled)return;
      if(result.entries?.length)receive(result.entries);
      renderStatus();renderEntries();
    }catch{if(dialog.open)dialog.querySelector<HTMLElement>('#activity-feedback')!.textContent='Activity log could not be loaded. Retrying shortly.';}
    finally{polling=false;}
  }
  function open(level: '' | 'error' | 'warning' = '') {
    if(!enabled)return;
    if(dialog.open){dialog.querySelector<HTMLSelectElement>('#activity-level')!.value=level;renderEntries();void poll();return;}
    dialog.innerHTML=`<div class="dialog-head"><h2 id="activity-title">Recent activity</h2><button type="button" id="activity-close" aria-label="Close activity">✕</button></div>
      <p>Connection progress and recent Office activity. Passwords, tokens, mail contents and raw commands are excluded.</p>
      <div class="activity-tools"><label>Level<select id="activity-level" aria-label="Level"><option value="">All levels</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="success">Success</option><option value="info">Information</option></select></label><label>Account<select id="activity-account" aria-label="Account"><option value="">All accounts</option></select></label><button type="button" id="activity-copy">Copy visible log</button><button type="button" id="activity-clear">Clear log</button></div>
      <p id="activity-count"></p><p id="activity-feedback" role="status"></p><ol id="activity-entries" tabindex="0" aria-label="Recent activity entries"></ol>`;
    dialog.querySelector<HTMLSelectElement>('#activity-level')!.value=level;
    dialog.showModal();dialog.querySelector<HTMLButtonElement>('#activity-close')!.onclick=()=>dialog.close();
    dialog.querySelectorAll<HTMLSelectElement>('select').forEach(select=>select.onchange=renderEntries);
    dialog.querySelector<HTMLButtonElement>('#activity-copy')!.onclick=async()=>{
      const text=filtered().map(entry=>`${entry.time} [${entry.level}] ${entry.account?entry.account+' · ':''}${entry.operation}: ${entry.message}${entry.duration_ms!==null?' ('+entry.duration_ms+' ms)':''}`).join('\n');
      try{await navigator.clipboard.writeText(text);dialog.querySelector<HTMLElement>('#activity-feedback')!.textContent='Visible log copied.';}
      catch{dialog.querySelector<HTMLElement>('#activity-feedback')!.textContent='Clipboard access is unavailable. Select and copy the log text.';}
    };
    dialog.querySelector<HTMLButtonElement>('#activity-clear')!.onclick=async()=>{
      generation++;const clear=dialog.querySelector<HTMLButtonElement>('#activity-clear')!;clear.disabled=true;
      try{await request({action:'clear'});entries=[];cursor=0;lastMessage='Activity log cleared.';lastError=false;localErrorHeld=false;commandErrorHeld=false;renderEntries();renderStatus();}
      catch{dialog.querySelector<HTMLElement>('#activity-feedback')!.textContent='Activity log could not be cleared.';}
      finally{clear.disabled=false;}
    };
    renderEntries();void poll();
  }
  button.onclick=()=>open();
  dialog.addEventListener('close',()=>button.focus());
  setInterval(()=>void poll(),2000);
  renderStatus();
  return {
    open,
    receive(entry: ActivityEntry): void{if(enabled)receive([entry]);},
    configure(value: boolean){enabled=value;button.disabled=!value;if(!value){generation++;entries=[];cursor=0;tasks.clear();clearTimeout(idleTimer);idle=true;localErrorHeld=false;commandErrorHeld=false;lastMessage='Ready.';lastError=false;if(dialog.open)dialog.close();renderStatus();}else void poll();},
    clearCommandError(){if(!commandErrorHeld)return;clearTimeout(idleTimer);localErrorHeld=false;commandErrorHeld=false;lastError=false;lastMessage='Ready.';idle=!tasks.size;renderStatus();},
    notice(message: string,error=false,{log=true}: {log?: boolean}={}){lastMessage=message;lastError=error;markBusy();localErrorHeld=error;commandErrorHeld=error&&!log;settle();renderStatus();if(enabled&&log)void request({action:'notice',message:String(message).slice(0,1000),error}).then(()=>poll()).catch(()=>{});},
    diagnostic(message: string){if(enabled)void request({action:'diagnostic',message:message.slice(0,1000)}).catch(()=>{});},
    queued(message: string | null){if(!message)return null;markBusy();lastError=false;const id=++sequence;tasks.set(id,{message,active:false});renderStatus();return id;},
    running(id: number | null){if(id!==null&&tasks.has(id)){markBusy();lastError=false;tasks.get(id)!.active=true;renderStatus();}},
    done(id: number | null){if(id===null)return;const task=tasks.get(id);if(task){if(!enabled&&!lastError)lastMessage='Finished: '+task.message.replace(/…$/,'');tasks.delete(id);settle();renderStatus();void poll();}},
  };
}
