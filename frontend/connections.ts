import {connectionQuery,CommandError} from './commands.js';
import {itemTypes, type ItemKind} from './item-types.js';
import {escapeHtml as e} from './formats.js';
import type {ConnectionItem,ConnectionList,RequestApi} from './types.js';

const label=(kind:string)=>itemTypes[kind as ItemKind]?.label||kind;
const detail=(item:ConnectionItem)=>Object.entries(item.meta).filter(([key])=>itemTypes[item.kind as ItemKind]?.fields.some(field=>field===key)).map(([,value])=>value).join(' · ');
export function createConnections(env:{api:RequestApi;current:()=>string|undefined;open:(id:string)=>Promise<void>;modal:(title:string,body:string)=>void;dialog:HTMLDialogElement;notice:(message:string,error?:boolean)=>void;command:(value:string)=>void}) {
  async function search(value:string) {
    const query=connectionQuery(value);if(!query)return [];
    const id=env.current();if(!id||id.startsWith('draft-'))return [];
    if(query.name==='unlink'){
      let offset=0,all:ConnectionItem[]=[];
      for(;;){const result=await env.api(`connections&id=${encodeURIComponent(id)}&offset=${offset}`);all.push(...result.items.filter(item=>item.id!==id));if(!result.more)break;offset+=result.links.length;}
      const text=query.query.toLocaleLowerCase();return all.filter(item=>(!query.kind||item.kind===query.kind)&&(item.id===query.query||(item.title+' '+item.excerpt+' '+detail(item)).toLocaleLowerCase().includes(text))).slice(0,20);
    }
    return (await env.api(`connection-search&q=${encodeURIComponent(query.query)}&kind=${encodeURIComponent(query.kind||'')}&exclude=${encodeURIComponent(id)}`)).items;
  }
  function autocomplete(input:HTMLInputElement) {
    const list=document.createElement('div');list.id='connection-suggestions';list.className='connection-suggestions';list.setAttribute('role','listbox');list.setAttribute('aria-label','Matching items');list.hidden=true;input.after(list);
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
    let version=0,timer:ReturnType<typeof setTimeout>,items:ConnectionItem[]=[],index=0;
    const hide=()=>{version++;clearTimeout(timer);list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
    const accept=()=>{if(!items[index])return;const query=connectionQuery(input.value)!;input.value=':'+query.name+' '+items[index].id;hide();input.focus();};
    function render(){
      list.innerHTML=items.length?items.map((item,i)=>`<div role="option" id="connection-option-${i}" aria-selected="${i===index}" data-index="${i}"><strong>${e(label(item.kind))} · ${e(item.title)}</strong><small>${e(detail(item))} · ${e(item.id)}</small><span>${e(item.excerpt)}</span></div>`).join(''):'<p role="status">No matching items.</p>';
      list.hidden=false;input.setAttribute('aria-expanded','true');if(items.length){input.setAttribute('aria-activedescendant','connection-option-'+index);list.children[index]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
    }
    list.onpointerdown=event=>{event.preventDefault();const option=(event.target as HTMLElement).closest<HTMLElement>('[data-index]');if(option){index=Number(option.dataset.index);accept();}};
    input.addEventListener('input',()=>{
      hide();if(!connectionQuery(input.value))return;const request=version;
      timer=setTimeout(()=>{void search(input.value).then(result=>{if(request!==version||!input.isConnected)return;items=result;index=0;render();}).catch(error=>{if(request===version){items=[];list.innerHTML=`<p role="status">${e(error.message)}</p>`;list.hidden=false;input.setAttribute('aria-expanded','true');}});},150);
    });
    return {
      key(event:KeyboardEvent){
        if(event.isComposing||list.hidden)return false;
        if(event.key==='Escape'){event.preventDefault();hide();return true;}
        if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(items.length){index=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;render();}return true;}
        if(event.key==='Tab'){event.preventDefault();accept();return true;}
        return false;
      },
      close(){hide();list.remove();},
    };
  }
  async function mutate(action:'link'|'unlink',query:string,kind?:string){
    const id=env.current();if(!id||id.startsWith('draft-'))throw new CommandError('Save and select an item before linking.');
    const type=kind?itemTypes[kind as ItemKind]?.command:undefined;
    const results=await search(':'+action+' '+(type?type+' ':'')+query);
    const matching=results.filter(item=>!kind||item.kind===kind);
    const exact=matching.filter(item=>item.id===query);
    // Names are safe only when the entire search result is unambiguous.
    const target=exact[0]||(matching.length===1?matching[0]:undefined);
    if(!target)throw new CommandError(matching.length?'Several items match. Use Tab to select an exact item.':'No matching item found.');
    await env.api('connection',{id,target:target.id,action:action==='link'?'add':'remove'});env.notice(action==='link'?'Items linked.':'Connection removed.');
    await section();
  }
  async function section(){
    const id=env.current(),panel=document.querySelector('#detail');if(!id||!panel)return;
    let host=panel.querySelector<HTMLElement>('.item-connections');
    if(!host){host=document.createElement('section');host.className='item-connections';host.setAttribute('aria-label','Connections');panel.append(host);}
    const target=host;
    if(id.startsWith('draft-')){target.innerHTML='<h3>Connections</h3><p class="muted">Connections become available when this draft is saved.</p>';return;}
    try{
      const result=await env.api(`connections&id=${encodeURIComponent(id)}`);if(env.current()!==id||!target.isConnected)return;
      const items=result.items.filter(item=>item.id!==id);
      target.innerHTML=`<div class="connection-heading"><h3>Connections (${result.links.length}${result.more?'+':''})</h3><button data-connections-view>View connections</button><button data-connections-add>Link item</button></div>${items.length?Object.entries(itemTypes).map(([kind,type])=>{const group=items.filter(item=>item.kind===kind);return group.length?`<h4>${e(type.label)}</h4>${group.map(item=>`<p><button class="wiki-link" data-connection-open="${e(item.id)}">${e(item.title)}</button> <button class="quiet" data-connection-remove="${e(item.id)}" aria-label="Remove connection to ${e(item.title)}">Unlink</button></p>`).join('')}`:'';}).join(''):'<p class="muted">No connections yet.</p>'}`;
      target.querySelector<HTMLButtonElement>('[data-connections-view]')!.onclick=()=>void view(false).catch(error=>env.notice(error.message,true));
      target.querySelector<HTMLButtonElement>('[data-connections-add]')!.onclick=()=>env.command(':link ');
      target.querySelectorAll<HTMLButtonElement>('[data-connection-open]').forEach(button=>button.onclick=()=>void env.open(button.dataset.connectionOpen!).catch(error=>env.notice(error.message,true)));
      target.querySelectorAll<HTMLButtonElement>('[data-connection-remove]').forEach(button=>button.onclick=()=>void mutate('unlink',button.dataset.connectionRemove!).catch(error=>env.notice(error.message,true)));
    }catch(error){if(target.isConnected)target.innerHTML=`<h3>Connections</h3><p role="status">${e((error as Error).message)}</p>`;}
  }
  async function view(all=false){
    const source=all?'':env.current();if(source===undefined||source?.startsWith('draft-'))throw new CommandError('Save and select an item first, or use :links all.');
    env.modal(all?'All connections':'Item connections','<div class="connections-view"><label>Search connections<input data-connection-filter type="search"></label><p class="muted">Select a node to focus its connections. Open an item from the list.</p><div data-connection-graph></div><div data-connection-list></div><button data-connection-more hidden>Load more connections</button><p role="status" data-connection-status></p></div>');
    const dialog=env.dialog,filter=dialog.querySelector<HTMLInputElement>('[data-connection-filter]')!,more=dialog.querySelector<HTMLButtonElement>('[data-connection-more]')!;
    let data:ConnectionList={items:[],links:[],more:false},request=0,focus=source||'';
    function render(){
      const shown=focus?data.links.filter(link=>link.a===focus||link.b===focus):data.links;
      const ids=new Set(shown.flatMap(link=>[link.a,link.b])),items=data.items.filter(item=>ids.has(item.id));
      const graphItems=items.slice(0,80),graphIds=new Set(graphItems.map(item=>item.id));
      const positions=new Map(graphItems.map((item,i)=>[item.id,{x:400+300*Math.cos(i*2*Math.PI/graphItems.length),y:220+170*Math.sin(i*2*Math.PI/graphItems.length)}]));
      dialog.querySelector('[data-connection-graph]')!.innerHTML=`<button data-reset-graph>Show loaded connections</button><svg viewBox="0 0 800 440" role="group" aria-label="Connection graph">${shown.filter(link=>graphIds.has(link.a)&&graphIds.has(link.b)).map(link=>{const a=positions.get(link.a)!,b=positions.get(link.b)!;return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}).join('')}${graphItems.map(item=>{const p=positions.get(item.id)!;return `<g role="button" tabindex="0" data-node="${e(item.id)}" aria-label="Focus ${e(item.title)}"><title>${e(label(item.kind)+' · '+item.title)}</title><circle cx="${p.x}" cy="${p.y}" r="9"/><text x="${p.x}" y="${p.y+24}" text-anchor="middle">${e(item.title.slice(0,22))}</text></g>`;}).join('')}</svg>${items.length>80?'<p>Graph shows the first 80 items. The list includes all loaded connections.</p>':''}`;
      const byId=new Map(data.items.map(item=>[item.id,item]));
      dialog.querySelector('[data-connection-list]')!.innerHTML=shown.length?shown.map(link=>`<p>${[link.a,link.b].map(id=>`<button class="wiki-link" data-open="${e(id)}">${e(label(byId.get(id)!.kind))} · ${e(byId.get(id)!.title)}</button>`).join(' ↔ ')}</p>`).join(''):'<p>No connections found.</p>';
      dialog.querySelectorAll<HTMLElement>('[data-node]').forEach(node=>{const activate=()=>{focus=node.dataset.node!;render();};node.onclick=activate;node.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();activate();}};});
      dialog.querySelector<HTMLButtonElement>('[data-reset-graph]')!.onclick=()=>{focus='';render();};
      dialog.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button=>button.onclick=()=>{dialog.close();void env.open(button.dataset.open!).catch(error=>env.notice(error.message,true));});
      more.hidden=!data.more;
    }
    async function fetchPage(reset:boolean){
      const version=++request;more.disabled=true;
      try{const result=await env.api(`connections&id=${encodeURIComponent(source||'')}&q=${encodeURIComponent(filter.value)}&offset=${reset?0:data.links.length}`);if(version!==request||!dialog.open||!filter.isConnected)return;
        data=reset?result:{links:[...data.links,...result.links],items:[...new Map([...data.items,...result.items].map(item=>[item.id,item])).values()],more:result.more};render();dialog.querySelector('[data-connection-status]')!.textContent=data.links.length+' connections loaded.';
      }catch(error){if(version===request&&filter.isConnected)dialog.querySelector('[data-connection-status]')!.textContent=(error as Error).message;}finally{if(version===request)more.disabled=false;}
    }
    filter.oninput=()=>void fetchPage(true);more.onclick=()=>void fetchPage(false);await fetchPage(true);filter.focus();
  }
  return {autocomplete,mutate,section,view};
}
