import {escapeHtml as e} from './formats.js';
import {itemTypes,type ItemKind} from './item-types.js';
import {connectionLayout,connectionGroupLayout,connectionTitleLines,connectionNeighbor,visibleConnectionItems,GRAPH_LIMIT,GROUP_CARD} from './connection-layout.js';
import type {ConnectionItem,ConnectionList,RequestApi} from './types.js';

type Place={mode:'overview'|'graph'|'items';id:string;group:string;q:string;kind:string};
type Camera={x:number;y:number;w:number;h:number};
type HistoryEntry={place:Place;snapshot?:{data:ConnectionList;selected:string;focusedId:string;view:Camera;fitWidth:number;listPage:number;scroll:number;width:number;height:number}};
type Env={api:RequestApi;keys?:()=>Record<string,string>;dialog:HTMLDialogElement;modal:(title:string,body:string)=>void;open:(id:string)=>Promise<void>;notice:(message:string,error?:boolean)=>void};
const typeLabel=(kind:string)=>itemTypes[kind as ItemKind]?.label||kind;
const symbols:Record<string,string>={mail:'✉',calendar:'▦',tasks:'✓',contacts:'♙',documents:'▤',wiki:'◇',sheets:'▦'};

export async function openConnectionExplorer(env:Env,source='') {
  const opener=document.activeElement as HTMLElement|null;
  env.modal('Connections',`<div class="connections-view">
    <div class="connection-tools"><div class="connection-history"><button data-history="-1" aria-label="Back in connections">←</button><button data-history="1" aria-label="Forward in connections">→</button><button data-overview>Workspace overview</button></div>
      <label>Find connected items<input data-connection-filter type="search" placeholder="Search the whole workspace" maxlength="500"></label>
      <label>Item type<select data-connection-kind><option value="">All types</option>${Object.entries(itemTypes).map(([kind,type])=>`<option value="${kind}">${e(type.label)}</option>`).join('')}</select></label>
      <button data-toggle-panel aria-expanded="true" aria-controls="connection-panel">Hide details</button></div>
    <p class="connection-location" data-location></p>
    <div class="connection-workspace"><section class="connection-map-pane" aria-label="Connections map">
      <div class="connection-map-tools"><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="out" aria-label="Zoom out">−</button><button data-fit>Fit view</button><button data-center>Center selection</button><button data-reset-graph>Reset view</button><span data-zoom-level></span></div>
      <div data-connection-graph tabindex="0" role="region" aria-label="Interactive map. Arrow keys or your movement bindings navigate cards. Enter explores, Space selects, slash searches. Shift and arrows pan; plus and minus zoom."><svg xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Connection graph"><g data-edges></g><g data-nodes></g></svg></div>
      <p class="connection-map-note" data-map-note></p>
      <div class="connection-legend" aria-label="Item type legend">${Object.entries(itemTypes).map(([kind,type])=>`<span class="connection-type" data-kind="${kind}">${symbols[kind]} ${e(type.label)}</span>`).join('')}</div>
    </section><aside id="connection-panel" class="connection-panel" aria-label="Connection details and list"><section data-selection></section><h3 data-list-title tabindex="-1">Connections</h3><div data-connection-list></div><div class="connection-list-pages"><button data-list-page="-1">Previous page</button><span data-list-range></span><button data-list-page="1">Next page</button></div><button data-connection-more hidden>Load more connections</button></aside></div>
    <p role="status" aria-live="polite" data-connection-status></p></div>`);
  const dialog=env.dialog,host=dialog.querySelector<HTMLElement>('.connections-view')!;
  const query=<T extends Element>(s:string)=>host.querySelector<T>(s)!;
  const filter=query<HTMLInputElement>('[data-connection-filter]'),kind=query<HTMLSelectElement>('[data-connection-kind]');
  const more=query<HTMLButtonElement>('[data-connection-more]'),svg=query<SVGSVGElement>('svg'),map=query<HTMLElement>('[data-connection-graph]');
  const status=query<HTMLElement>('[data-connection-status]');
  const textMeasure=document.createElement('canvas').getContext('2d');
  const titleLines=(title:string,maxWidth:number)=>{if(textMeasure)textMeasure.font=`600 14px ${getComputedStyle(svg).fontFamily}`;return connectionTitleLines(title,40,textMeasure?text=>textMeasure.measureText(text).width:undefined,maxWidth);};
  let place:Place={mode:source?'graph':'overview',id:source,group:'',q:'',kind:''};
  let data:ConnectionList={links:[],items:[],more:false},selected=source,focusedId='',sequenceTime=0,request=0,busy=false,listPage=0,timer:ReturnType<typeof setTimeout>|undefined;
  let points=new Map<string,{x:number;y:number}>(),width=900,height=600,view={x:-100,y:-100,w:900,h:600},fitWidth=900;
  let history:HistoryEntry[]=[{place:{...place}}],historyIndex=0,disposed=false;
  const active=()=>!disposed&&host.isConnected&&dialog.open;
  const cleanup=()=>{disposed=true;++request;clearTimeout(timer);observer.disconnect();resize.disconnect();dialog.removeEventListener('close',onClose);dialog.removeEventListener('cancel',cancel);};
  const onClose=()=>{cleanup();if(opener?.isConnected)opener.focus({preventScroll:true});};
  const cancel=()=>clearTimeout(timer);
  dialog.addEventListener('close',onClose,{once:true});dialog.addEventListener('cancel',cancel);
  const observer=new MutationObserver(()=>{if(!host.isConnected)cleanup();});observer.observe(dialog,{childList:true});
  const size=()=>{const rect=svg.getBoundingClientRect();width=Math.max(rect.width,1);height=Math.max(rect.height,1);};
  const updateView=()=>{svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);query('[data-zoom-level]').textContent=`${Math.round(width/view.w*100)}%`;};
  function fit(){size();const values=[...points.values()];if(!values.length){view={x:-100,y:-100,w:width,h:height};fitWidth=view.w;updateView();return;}
    const overview=place.mode==='overview',padX=overview?GROUP_CARD.width/2+GROUP_CARD.padding:140,padY=overview?GROUP_CARD.height/2+GROUP_CARD.padding:48;
    const xs=values.map(p=>p.x),ys=values.map(p=>p.y),x=Math.min(...xs)-padX,y=Math.min(...ys)-padY,w=Math.max(...xs)-x+padX,h=Math.max(...ys)-y+padY;
    const unit=Math.max(w/width,h/height,overview?1:.65);view={x:x+w/2-width*unit/2,y:y+h/2-height*unit/2,w:width*unit,h:height*unit};fitWidth=view.w;updateView();}
  function zoom(factor:number,px=width/2,py=height/2){size();const w=Math.max(width*.25,Math.min(Math.max(fitWidth*4,width*8),view.w*factor)),f=w/view.w;view={x:view.x+px/width*view.w*(1-f),y:view.y+py/height*view.h*(1-f),w,h:view.h*f};updateView();}
  function centerSelection(){const p=points.get(selected);if(p){size();view={x:p.x-width/2,y:p.y-height/2,w:width,h:height};updateView();}}
  const resize=new ResizeObserver(()=>{if(!active())return;const oldW=width,oldH=height;size();if(place.mode==='overview'){renderMap();fit();}else{view.w*=width/oldW;view.h*=height/oldH;updateView();if(map.contains(document.activeElement))reveal(focusedId);}});resize.observe(map);
  const panel=query<HTMLElement>('#connection-panel');
  const itemButtons=(item:ConnectionItem)=>`<button data-explore="${e(item.id)}">Explore connections</button><button class="wiki-link" data-open="${e(item.id)}">Open item</button>`;
  const openItem=(id:string)=>{dialog.close();void env.open(id).catch(error=>env.notice(error.message,true));};
  function wireItems(root:Element){
    root.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(button=>button.onclick=()=>select(button.dataset.select!));
    root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button=>button.onclick=()=>openItem(button.dataset.open!));
    root.querySelectorAll<HTMLButtonElement>('[data-explore]').forEach(button=>button.onclick=()=>void navigate({mode:'graph',id:button.dataset.explore!,group:'',q:'',kind:''}));
    root.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(button=>button.onclick=()=>void navigate({mode:'graph',id:'',group:button.dataset.group!,q:'',kind:''}));
  }
  function selection(){const item=data.items.find(item=>item.id===selected),section=query<HTMLElement>('[data-selection]');
    section.innerHTML=item?`<h3>${e(item.title)}</h3><p class="connection-type" data-kind="${e(item.kind)}">${symbols[item.kind]||'●'} ${e(typeLabel(item.kind))} · ${item.degree??'—'} total connections</p><p>${e(Object.values(item.meta).join(' · '))}</p><div class="connection-selection-actions">${itemButtons(item)}</div>`:'<h3>Explore your connections</h3><p>Select an item to see its full title and connections. Explore fetches its direct neighbors.</p>';
    wireItems(section);
    const peers=new Set([selected]);for(const link of data.links)if(link.a===selected||link.b===selected){peers.add(link.a);peers.add(link.b);}
    svg.querySelectorAll<SVGGElement>('[data-node]').forEach(node=>{node.classList.toggle('selected',node.dataset.node===selected);node.classList.toggle('dimmed',!!item&&!peers.has(node.dataset.node!));node.setAttribute('aria-pressed',String(node.dataset.node===selected));});
    svg.querySelectorAll<SVGLineElement>('line').forEach(line=>{const related=line.dataset.a===selected||line.dataset.b===selected;line.classList.toggle('highlighted',related);line.classList.toggle('dimmed',!!item&&!related);});
    query<HTMLButtonElement>('[data-center]').disabled=!points.has(selected);
  }
  function select(id:string){const oldIds=[...points.keys()].join();selected=id;
    if(!points.has(id)&&place.mode!=='overview'){renderMap();fit();}else selection();
    if(oldIds!==[...points.keys()].join())status.textContent='Map updated to include the selected item. The list contains all loaded results.';
  }
  const mapNodes=()=>[...svg.querySelectorAll<SVGGElement>('[data-node],[data-group-node]')];
  const nodeId=(node:SVGGElement)=>node.dataset.node||node.dataset.groupNode!;
  function reveal(id:string){const p=points.get(id);if(!p)return;
    const halfW=place.mode==='overview'?GROUP_CARD.width/2:120,halfH=place.mode==='overview'?GROUP_CARD.height/2:32;
    if(p.x-halfW<view.x||p.x+halfW>view.x+view.w||p.y-halfH<view.y||p.y+halfH>view.y+view.h){view.x=p.x-view.w/2;view.y=p.y-view.h/2;updateView();}
  }
  function focusMap(preferred=focusedId){const nodes=mapNodes(),candidate=nodes.find(node=>nodeId(node)===preferred);
    const visible=nodes.find(node=>{const p=points.get(nodeId(node))!;return p.x>=view.x&&p.x<=view.x+view.w&&p.y>=view.y&&p.y<=view.y+view.h;});
    const node=candidate||visible||nodes[0];if(node)node.focus({preventScroll:true});else map.focus({preventScroll:true});
  }
  function exploreFocused(){const node=mapNodes().find(node=>nodeId(node)===focusedId);if(!node)return;
    if(node.dataset.node&&place.mode==='graph'&&place.id===node.dataset.node&&selected===node.dataset.node){openItem(node.dataset.node);return;}
    void navigate({mode:'graph',id:node.dataset.node||'',group:node.dataset.groupNode||'',q:'',kind:''});
  }
  function renderMap(){
    const restoreFocus=map.contains(document.activeElement);
    if(place.mode==='overview'){
      const groups=(data.groups||[]).slice(0,GRAPH_LIMIT);
      size();points=new Map(connectionGroupLayout(groups.map(group=>group.id),width,height).map(p=>[p.id,p]));
      query('[data-edges]').innerHTML='';query('[data-nodes]').innerHTML=groups.map(group=>{const p=points.get(group.id)!,lines=titleLines(group.title,228);return `<g role="button" tabindex="0" data-group-node="${e(group.id)}" data-kind="${e(group.kind)}" aria-label="Explore group ${e(typeLabel(group.kind))}: ${e(group.title)}, ${group.items} items, ${group.links} connections" transform="translate(${p.x} ${p.y})"><rect x="-150" y="-52" width="300" height="104" rx="14"/><text class="connection-group-symbol" x="-132" y="-9" aria-hidden="true">${symbols[group.kind]||'●'}</text><text class="connection-group-title" text-anchor="middle">${lines.map((line,i)=>`<tspan x="16" y="${-19+i*19}">${e(line)}</tspan>`).join('')}</text><text class="connection-group-count" y="31" text-anchor="middle">${group.items} items · ${group.links} connections</text><title>${e(typeLabel(group.kind)+' · '+group.title)}</title></g>`;}).join('');
      query('[data-map-note]').textContent=`Map: ${groups.length} of ${(data.groups||[]).length} loaded groups. Each group contains items joined by a path of connections. Select a group to explore it.`;
    }else{
      const visible=visibleConnectionItems(data.items,data.links,selected,place.id||place.group);points=new Map(connectionLayout(visible,data.links,place.id||place.group).map(p=>[p.id,p]));
      const eligible=data.links.filter(link=>points.has(link.a)&&points.has(link.b));
      const related=eligible.filter(link=>link.a===selected||link.b===selected),others=eligible.filter(link=>link.a!==selected&&link.b!==selected);
      const edges=[...related,...others].slice(0,500);
      query('[data-edges]').innerHTML=edges.map(link=>{const a=points.get(link.a)!,b=points.get(link.b)!;return `<line data-a="${e(link.a)}" data-b="${e(link.b)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}).join('');
      query('[data-nodes]').innerHTML=visible.map(item=>{const p=points.get(item.id)!,lines=titleLines(item.title,185);return `<g role="button" tabindex="0" data-node="${e(item.id)}" data-kind="${e(item.kind)}" aria-label="Select ${e(typeLabel(item.kind))}: ${e(item.title)}" aria-pressed="false" transform="translate(${p.x} ${p.y})"><rect x="-120" y="-32" width="240" height="64" rx="8"/><text class="connection-node-symbol" x="-105" y="5">${symbols[item.kind]||'●'}</text><text class="connection-node-title">${lines.map((line,i)=>`<tspan x="-81" y="${-12+i*17}">${e(line)}</tspan>`).join('')}</text><text class="connection-node-subtitle" x="-81" y="23">${e(typeLabel(item.kind))} · ${item.degree??'—'} links</text><title>${e(typeLabel(item.kind)+' · '+item.title)}</title></g>`;}).join('');
      query('[data-map-note]').textContent=`Map: ${visible.length} of ${data.items.length} loaded items · ${edges.length} of ${data.links.length} loaded connections drawn. ${data.items.length>GRAPH_LIMIT||eligible.length>500?`Map limited to ${GRAPH_LIMIT} items and 500 lines; select from the list or explore a smaller neighborhood. `:''}Drag to pan · Wheel/pinch to zoom · Select to highlight.`;
    }
    selection();
    const nodes=mapNodes();if(!nodes.some(node=>nodeId(node)===focusedId))focusedId=nodes.some(node=>nodeId(node)===selected)?selected:nodes[0]?nodeId(nodes[0]):'';
    for(const node of nodes){node.tabIndex=nodeId(node)===focusedId?0:-1;
      node.onfocus=()=>{focusedId=nodeId(node);for(const peer of nodes)peer.tabIndex=peer===node?0:-1;reveal(focusedId);if(node.dataset.node)select(focusedId);};
      node.onclick=()=>{node.focus({preventScroll:true});if(node.dataset.groupNode)exploreFocused();};
    }
    if(restoreFocus)focusMap();
  }
  function render(reset:boolean){
    query('[data-location]').textContent=place.mode==='overview'?'Workspace overview':place.mode==='items'?'Search results across the workspace':place.id?`Connections of ${data.items.find(item=>item.id===place.id)?.title||'selected item'}`:'Connected group';
    query('[data-list-title]').textContent=place.mode==='overview'?'Connected groups':place.mode==='items'?'Matching items':'Loaded connections';
    const list=query<HTMLElement>('[data-connection-list]'),byId=new Map(data.items.map(item=>[item.id,item])),start=listPage*50;
    list.innerHTML=place.mode==='overview'?(data.groups||[]).slice(start,start+50).map(group=>`<div class="connection-list-row" data-kind="${e(group.kind)}"><strong><span class="connection-group-symbol" role="img" aria-label="${e(typeLabel(group.kind))}">${symbols[group.kind]||'●'}</span> ${e(group.title)}</strong><span>${group.items} items · ${group.links} connections</span><button data-group="${e(group.id)}">Explore group</button></div>`).join(''):place.mode==='items'?data.items.slice(start,start+50).map(item=>`<div class="connection-list-row"><button data-select="${e(item.id)}">${e(item.title)}</button><span>${e(typeLabel(item.kind))} · ${item.degree} connections</span>${itemButtons(item)}</div>`).join(''):data.links.slice(start,start+50).map(link=>`<div class="connection-list-row">${[link.a,link.b].map(id=>{const item=byId.get(id)!;return `<button data-select="${e(id)}">${symbols[item.kind]||'●'} ${e(item.title)}</button>`;}).join('<span aria-label="connected to">↔</span>')}</div>`).join('');
    if(!list.childElementCount)list.innerHTML='<p>No connections found. Try a different search or item type.</p>';
    wireItems(list);more.hidden=!data.more;more.textContent=place.mode==='overview'?'Load more groups':place.mode==='items'?'Load more items':'Load more connections';
    renderMap();if(reset){fit();if(place.mode==='graph')centerSelection();}
    const loaded=place.mode==='overview'?(data.groups||[]).length:place.mode==='items'?data.items.length:data.links.length;
    query('[data-list-range]').textContent=loaded?`${start+1}–${Math.min(start+50,loaded)} of ${loaded}`:'0 results';
    host.querySelectorAll<HTMLButtonElement>('[data-list-page]').forEach(button=>button.disabled=Number(button.dataset.listPage)<0?listPage===0:start+50>=loaded);
    status.textContent=place.mode==='overview'?`${loaded} of ${data.groupTotal??loaded} groups loaded · ${data.itemTotal??0} items · ${data.total??0} total connections.`:`${loaded} of ${data.total??loaded} ${place.mode==='items'?'matching items':'connections'} loaded. ${data.more?'Load more to continue.':''}`;
    host.querySelectorAll<HTMLButtonElement>('[data-history]').forEach(button=>button.disabled=Number(button.dataset.history)<0?historyIndex===0:historyIndex===history.length-1);
  }
  async function fetchPage(reset:boolean){
    const version=++request;busy=true;
    if(reset){data={items:[],links:[],more:false};listPage=0;render(true);}
    more.disabled=true;status.textContent='Loading connections…';host.setAttribute('aria-busy','true');
    const offset=reset?0:place.mode==='overview'?(data.groups||[]).length:place.mode==='items'?data.items.length:data.links.length;
    const route=`connections&mode=${place.mode}&id=${encodeURIComponent(place.id)}&group=${encodeURIComponent(place.group)}&q=${encodeURIComponent(place.q)}&kind=${encodeURIComponent(place.kind)}&offset=${offset}` as const;
    try{const result=await env.api(route);if(version!==request||!active())return;
      listPage=reset?0:Math.floor(offset/50);
      data=reset?result:{...result,links:[...new Map([...data.links,...result.links].map(link=>[link.a+'|'+link.b,link])).values()],items:[...new Map([...data.items,...result.items].map(item=>[item.id,item])).values()],groups:[...(data.groups||[]),...(result.groups||[])]};render(reset||place.mode==='overview');
      if(reset&&document.activeElement!==filter&&document.activeElement!==kind)focusMap(selected||focusedId);
    }catch(error){if(version===request&&active()){status.textContent=`Could not load connections: ${(error as Error).message}. Use Reset view to retry.`;}}
    finally{if(version===request&&active()){busy=false;more.disabled=false;host.setAttribute('aria-busy','false');}}
  }
  function remember(){if(!busy)history[historyIndex].snapshot={data,selected,focusedId,view:{...view},fitWidth,listPage,scroll:panel.scrollTop,width,height};}
  async function navigate(next:Place,record=true){clearTimeout(timer);sequenceTime=0;if(record){remember();history=history.slice(0,historyIndex+1);history.push({place:{...next}});historyIndex++;}place={...next};selected=place.id||place.group;focusedId=selected;filter.value=place.q;kind.value=place.kind;panel.scrollTop=0;await fetchPage(true);}
  function moveHistory(delta:number){const index=historyIndex+delta;if(index<0||index>=history.length)return;
    remember();historyIndex=index;const entry=history[index],snapshot=entry.snapshot;
    if(!snapshot){void navigate(entry.place,false);return;}
    clearTimeout(timer);++request;busy=false;place={...entry.place};filter.value=place.q;kind.value=place.kind;data=snapshot.data;selected=snapshot.selected;focusedId=snapshot.focusedId;listPage=snapshot.listPage;render(false);
    size();view={...snapshot.view,w:snapshot.view.w*width/snapshot.width,h:snapshot.view.h*height/snapshot.height};fitWidth=snapshot.fitWidth;updateView();panel.scrollTop=snapshot.scroll;more.disabled=false;host.setAttribute('aria-busy','false');focusMap(focusedId||selected);
  }
  host.querySelectorAll<HTMLButtonElement>('[data-history]').forEach(button=>button.onclick=()=>moveHistory(Number(button.dataset.history)));
  query<HTMLButtonElement>('[data-overview]').onclick=()=>void navigate({mode:'overview',id:'',group:'',q:'',kind:''});
  const runSearch=()=>navigate({mode:filter.value.trim()||kind.value?'items':'overview',id:'',group:'',q:filter.value.trim(),kind:kind.value});
  const search=()=>{clearTimeout(timer);++request;busy=false;more.disabled=true;timer=setTimeout(()=>void runSearch(),220);};filter.oninput=search;kind.onchange=search;
  more.onclick=()=>{if(!busy)void fetchPage(false);};
  host.querySelectorAll<HTMLButtonElement>('[data-list-page]').forEach(button=>button.onclick=()=>{listPage+=Number(button.dataset.listPage);render(false);query<HTMLElement>('[data-list-title]').focus();});
  query<HTMLButtonElement>('[data-fit]').onclick=fit;
  query<HTMLButtonElement>('[data-reset-graph]').onclick=()=>void navigate({...place},false);
  query<HTMLButtonElement>('[data-center]').onclick=centerSelection;
  host.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(button=>button.onclick=()=>zoom(button.dataset.zoom==='in'?.8:1.25));
  query<HTMLButtonElement>('[data-toggle-panel]').onclick=event=>{const button=event.currentTarget as HTMLButtonElement;panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));button.textContent=panel.hidden?'Show details':'Hide details';};
  map.addEventListener('wheel',event=>{event.preventDefault();const rect=svg.getBoundingClientRect();zoom(Math.exp(Math.max(-.35,Math.min(.35,event.deltaY*.002))),event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
  const pointers=new Map<number,{x:number;y:number}>();
  map.onpointerdown=event=>{if(event.button!==0)return;if((event.target as Element).closest('[data-node],[data-group-node]'))return;map.focus({preventScroll:true});map.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});};
  map.onpointermove=event=>{const old=pointers.get(event.pointerId);if(!old)return;const others=[...pointers.entries()].filter(([id])=>id!==event.pointerId);if(others.length){const other=others[0][1],before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y),rect=svg.getBoundingClientRect();if(before>0&&after>0)zoom(before/after,(event.clientX+other.x)/2-rect.left,(event.clientY+other.y)/2-rect.top);}else{view.x-=(event.clientX-old.x)*view.w/width;view.y-=(event.clientY-old.y)*view.h/height;updateView();}pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});};
  const end=(event:PointerEvent)=>{pointers.delete(event.pointerId);};map.onpointerup=end;map.onpointercancel=end;map.onlostpointercapture=end;
  host.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    const target=event.target as Element,typing=!!target.closest('input,textarea,select,[contenteditable="true"]');
    if(typing){if(target===filter&&event.key==='Escape'){event.preventDefault();focusMap();}else if(target===filter&&event.key==='Enter'){event.preventDefault();const value=filter.value.trim();clearTimeout(timer);void runSearch().then(()=>{if(active()&&filter.value.trim()===value&&document.activeElement===filter)focusMap();});}return;}
    if(event.key==='Backspace'){event.preventDefault();sequenceTime=0;if(event.repeat)return;
      if(historyIndex>0)moveHistory(-1);
      else if(place.mode!=='overview'){
        // Make the overview a parent, preserving Forward without creating a Backspace loop.
        remember();history.unshift({place:{mode:'overview',id:'',group:'',q:'',kind:''}});historyIndex=1;moveHistory(-1);
      }
      return;
    }
    const bindings={left:'h',right:'l',up:'k',down:'j',search:'/',...env.keys?.()};
    if(event.key==='/'||event.key===bindings.search){event.preventDefault();sequenceTime=0;filter.focus();filter.select();return;}
    if(!map.contains(target))return;
    const directions:Record<string,'left'|'right'|'up'|'down'>={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
    const direction=directions[event.key]||(['left','right','up','down'] as const).find(action=>bindings[action]===event.key);
    if(direction){event.preventDefault();sequenceTime=0;if(event.shiftKey&&directions[event.key]){view.x+=(direction==='left'?-1:direction==='right'?1:0)*view.w*.12;view.y+=(direction==='up'?-1:direction==='down'?1:0)*view.h*.12;updateView();return;}
      const next=connectionNeighbor([...points].map(([id,p])=>({id,...p})),focusedId,direction,!directions[event.key]);focusMap(next||focusedId);return;}
    if(event.key==='Enter'){event.preventDefault();if(!event.repeat)exploreFocused();return;}
    if(event.key===' '){event.preventDefault();if(place.mode!=='overview')select(focusedId);return;}
    if(event.key==='g'){event.preventDefault();if(!event.repeat){const now=Date.now();if(sequenceTime&&now-sequenceTime<900){const first=mapNodes()[0];if(first)focusMap(nodeId(first));sequenceTime=0;}else sequenceTime=now;}return;}
    sequenceTime=0;
    if(event.key==='G'||event.key==='Home'||event.key==='End'){event.preventDefault();const nodes=mapNodes(),node=event.key==='Home'?nodes[0]:nodes.at(-1);if(node)focusMap(nodeId(node));return;}
    if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?1.25:.8);}
  });
  await fetchPage(true);if(active()&&document.activeElement!==filter&&document.activeElement!==kind)focusMap(selected||focusedId);
}
