import {asError} from './utils.js';
import type {AppName, MenuEnvironment, OfficeRecord} from './types.js';
// Item menus share the application's persistence and provider operations.
export function installItemMenus(env: MenuEnvironment) {
  const {state,e}=env;
  let menu: HTMLDivElement | null=null,origin: string | null=null,generation=0,restoreOrigin: (()=>void)|undefined;
  function close(restore=false) {
    generation++;
    menu?.remove();menu=null;
    if(restore)restoreOrigin?.();
  }
  const recovery=(r: OfficeRecord)=>r.meta.remote&&['Recovery copies','Not in Inbox'].includes(r.meta.folder||'');
  function actions(rows: OfficeRecord[]) {
    const single=rows.length===1,r=rows[0],local=rows.every(r=>!r.meta.remote),result: {id: string; label: string; danger: boolean}[]=[];
    const add=(id: string,label: string,danger=false)=>result.push({id,label,danger});
    if(single){add('open','Open');if(local&&(state.app!=='mail'||r.meta.folder==='Drafts'))add('edit','Edit');}
    if(state.app==='mail'){
      const live=rows.every(r=>r.meta.remote&&!recovery(r));
      const ordinary=rows.every(r=>!recovery(r)&&!['Drafts','Sending','Delivery uncertain'].includes(r.meta.folder||''));
      if(single&&r.meta.from)add('reply','Reply');
      if(ordinary){
        add('read','Mark as read');add('unread','Mark as unread');
        if(rows.every(r=>r.meta.folder!=='Archive'))add('archive',local?'Archive locally':'Archive');
      }
      if(live){
        if(new Set(rows.map(r=>r.meta.account)).size===1)add('file','Move / Labels…');
        if(rows.every(r=>r.meta.folder==='Trash'))add('restore','Restore to Inbox');
        else if(rows.every(r=>r.meta.folder!=='Trash'))add('trash','Move to Trash');
      }
      if(rows.every(recovery)){add('keep-local','Save locally');add('discard','Discard copy…',true);}
      if(single&&(r.meta.rawBase64||r.meta.raw))add('eml','Download original EML');
    }
    if(state.app==='tasks'&&local){add('complete','Mark complete');add('incomplete','Mark incomplete');}
    if(single&&local&&['documents','wiki'].includes(state.app))add('history','Revision history');
    add('export',single?'Export':'Export selected');
    if(local)add('delete',single&&r.kind==='mail'&&r.meta.folder==='Drafts'?'Discard Draft…':single?'Delete…':`Delete ${rows.length} items…`,true);
    return result;
  }
  async function run(id: string,ids: string[],app: AppName) {
    if(state.app!==app)throw Error('The application changed. Open the menu again.');
    await env.commit();
    const rows=ids.map(id=>state.rows.find(r=>r.id===id)!);
    if(rows.some(r=>!r)||!actions(rows).some(a=>a.id===id))throw Error('The selected items changed. Open the menu again.');
    if(['open','edit','reply','history','eml'].includes(id)){
      await env.selectRecord(rows[0].id,true);
      if(id==='edit')env.enterEdit();
      if(['reply','history','eml'].includes(id))document.querySelector<HTMLButtonElement>(`#detail [data-action="${id}"]`)!?.click();
      return;
    }
    if(id==='export'){await env.exportRecords(false,rows);return;}
    if(id==='file'){
      state.selected=new Set(ids);await env.fileMail();return;
    }
    const apply=async()=>{
      if(state.app!==app)throw Error('The application changed. Open the menu again.');
      await env.commit();let count=0;
      if(app==='mail'&&(['delete','trash','discard'].includes(id)||(id==='archive'&&rows.every(row=>row.meta.remote)))){
        await env.deleteMailImmediately(rows,row=>id==='delete'?env.api('delete',{id:row.id,revision:row.revision,undoable:true}):env.api('mail-action',{id:row.id,revision:row.revision,action:id,undoable:id==='trash'}),['delete','trash'].includes(id));
        env.notice(`${rows.length} ${rows.length===1?'item':'items'} updated.`);return;
      }
      if(app==='mail'&&(id==='read'||id==='unread')){
        try{for(const row of rows){await env.setMailRead(row,id==='read');count++;}}
        catch(cause){throw Error(`${count} of ${rows.length} items updated. ${asError(cause).message}`);}
        env.notice(`${count} ${count===1?'item':'items'} updated.`);return;
      }
      const reload=env.mailDeletionReload(),removed=[],reconciled=new Set<string>();
      try{
        for(const row of rows){
          if(reconciled.has(row.id)){count++;continue;}
          await env.waitForMailRead(row.id);
          if(id==='delete')await env.api('delete',{id:row.id,revision:row.revision});
          else if(row.meta.remote){const result=await env.api('mail-action',{id:row.id,revision:row.revision,action:id});for(const related of result.removedIds||[])reconciled.add(related);}
          else{
            const copy=structuredClone(row);
            // PHP encodes empty metadata as []; named array properties are lost in JSON.
            copy.meta={...copy.meta};
            if(id==='complete'||id==='incomplete')copy.meta.done=id==='complete';
            else if(id==='archive')copy.meta.folder='Archive';
            else copy.meta.read=id==='read';
            await env.api('save',copy);
          }
          count++;
          if(['delete','trash','discard','archive'].includes(id))removed.push(row.id);
        }
      }catch(cause) { const error=asError(cause);throw Error(`${count} of ${rows.length} items updated. ${error.message}`);}
      finally{await reload(removed);}
      env.notice(`${count} ${count===1?'item':'items'} updated.`);
    };
    if(id==='delete'||id==='discard')env.confirmation(id==='delete'?(app==='mail'&&rows.length===1&&rows[0].meta.folder==='Drafts'?'Discard Draft':'Delete selected items'):'Discard copies',id==='delete'?(app==='mail'?`Delete ${rows.length} selected message(s)? Undo is available for fifteen minutes.`:`Delete ${rows.length} selected item(s) and their revision history? This cannot be undone.`):`Discard ${rows.length} recovery copy/copies from Office? Your server mailbox is unaffected.`,apply);
    else await apply();
  }
  async function open(row: HTMLElement,x: number,y: number) {
    const restore=env.capturePane();close();restoreOrigin=restore;const token=generation,app=state.app,id=row.dataset.id!;
    await env.commit();
    if(token!==generation||state.app!==app)return;
    env.mouseSelection();
    if(!state.selected.has(id)){state.selected.clear();state.selected.add(id);}
    if(state.current?.id===id)env.renderList();else await env.selectRecord(id);
    if(token!==generation||state.app!==app)return;
    origin=id;
    const rows=state.rows.filter(r=>state.selected.has(r.id)),ids=rows.map(r=>r.id);
    if(!rows.length)return;
    menu=document.createElement('div');menu.className='item-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Item actions');
    menu.innerHTML=`<div class="context-selection" role="presentation">${rows.length} selected</div>`+actions(rows).map(a=>`<button role="menuitem" tabindex="-1" data-menu-action="${a.id}" class="${a.danger?'danger':''}">${e(a.label)}</button>`).join('');
    document.body.append(menu);
    const bounds=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(x,innerWidth-bounds.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,innerHeight-bounds.height-8))+'px';
    menu.querySelector<HTMLButtonElement>('button')!?.focus();
    menu.onclick=event=>{const b=(event.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');if(!b)return;const action=b.dataset.menuAction!;close(true);void env.attempt(()=>run(action,ids,app));};
  }
  document.addEventListener('contextmenu',event=>{
    const target=event.target as HTMLElement;
    const detail=target.closest('#detail');
    if(detail&&(target.closest('input,textarea,select,[contenteditable],a,button,summary')||getSelection()?.toString()))return;
    const row=target.closest<HTMLElement>('#items [data-id]')||(detail?document.querySelector<HTMLElement>('#selected-item'):null);
    if(!row){close();return;}
    event.preventDefault();void env.attempt(()=>open(row,event.clientX,event.clientY));
  });
  document.addEventListener('keydown',event=>{
    if(menu){
      event.preventDefault();
      const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(event.key==='Escape'||event.key==='Tab')close(true);
      else if(event.key==='ArrowDown'||event.key==='ArrowUp')buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();
      else if(event.key==='Home')buttons[0]?.focus();
      else if(event.key==='End')buttons.at(-1)?.focus();
      else if(event.key==='Enter'||event.key===' ')(document.activeElement as HTMLElement)?.click();
      return;
    }
    if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
    const target=event.target as HTMLElement;
    if((target.closest('input,textarea,select,[contenteditable],a,button,summary')&&!target.closest('#items'))||target.closest('#detail')&&getSelection()?.toString())return;
    const row=target.closest<HTMLElement>('#items [data-id]')||(target.closest('#detail')?document.querySelector<HTMLElement>('#selected-item'):null);if(!row)return;
    event.preventDefault();const rect=row.getBoundingClientRect();void env.attempt(()=>open(row,rect.left+20,rect.top+20));
  });
  document.addEventListener('pointerdown',event=>{if(!menu?.contains((event.target as HTMLElement)))close();});
  document.addEventListener('focusin',event=>{if(menu&&!menu.contains((event.target as HTMLElement)))close();});
  document.addEventListener('scroll',event=>{if(menu&&!menu.contains((event.target as HTMLElement)))close();},true);
  window.addEventListener('resize',()=>close());
  window.addEventListener('blur',()=>close());
  return {close};
}
