import {connectionShape} from './connection-shapes.js';
import {escapeHtml as e} from './formats.js';
import {showProgressDialog} from './utils.js';
import {itemTypes,type ItemKind} from './item-types.js';
import {connectionLayout,connectionGroupLayout,connectionTitleLines,connectionNeighbor,connectionArrivalPoint,visibleConnectionItems,GRAPH_LIMIT,GROUP_CARD} from './connection-layout.js';
import type {ConnectionItem,ConnectionList,ConnectionVisibility,RequestApi} from './types.js';

type Place={mode:'overview'|'graph'|'items';id:string;group:string;q:string;kind:string};
type Camera={x:number;y:number;w:number;h:number};
type NavigationOrigin={id:string;title:string;kind:string;role:'item'|'group'|'overview'|'search'};
type HistoryEntry={place:Place;from?:NavigationOrigin;snapshot?:{data:ConnectionList;selected:string;focusedId:string;view:Camera;fitWidth:number;listPage:number;scroll:number;width:number;height:number}};
type Env={api:RequestApi;keys?:()=>Record<string,string>;changed?:()=>void;closed?:(opener:HTMLElement|null)=>void;dialog:HTMLDialogElement;modal:(title:string,body:string)=>void;open:(id:string)=>Promise<void>;notice:(message:string,error?:boolean)=>void};
const typeLabel=(kind:string)=>itemTypes[kind as ItemKind]?.label||kind;
const symbols:Record<string,string>={mail:'✉',calendar:'▦',tasks:'✓',contacts:'♙',documents:'▤',wiki:'◇',sheets:'▦'};
const ORIGIN_ID='navigation-origin';
const NEIGHBOR_HIGHLIGHT_KEY='office.connections.highlightDirect';

export async function openConnectionExplorer(env:Env,source='') {
  const opener=document.activeElement as HTMLElement|null;
  env.modal('Connections',`<div class="connections-view">
    <div class="connection-tools"><div class="connection-history"><button data-history="-1" aria-label="Back in connections">←</button><button data-history="1" aria-label="Forward in connections">→</button><button data-overview>Workspace overview</button></div>
      <label>Find connected items<input data-connection-filter type="search" placeholder="Search the whole workspace" maxlength="500"></label>
      <label>Item type<select data-connection-kind><option value="">All types</option>${Object.entries(itemTypes).map(([kind,type])=>`<option value="${kind}">${e(type.label)}</option>`).join('')}</select></label>
      <label>Connections<select data-connection-visibility aria-label="Connection visibility"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
      <button data-toggle-panel aria-expanded="true" aria-controls="connection-panel">Hide details</button></div>
    <p class="connection-location" data-location></p>
    <div class="connection-workspace"><section class="connection-map-pane" aria-label="Connections map">
      <div class="connection-map-tools"><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="out" aria-label="Zoom out">−</button><button data-fit>Fit view</button><button data-center>Center selection</button><button data-reset-graph>Reset view</button><span data-zoom-level></span><button data-neighbor-highlight aria-pressed="true">Highlight direct connections</button><span data-group-actions></span></div>
      <div data-connection-graph tabindex="0" role="region" aria-label="Interactive map. Arrow keys or your movement bindings navigate cards. Enter explores, Space selects, slash searches. Shift and arrows pan; plus and minus zoom."><svg xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Connection graph"><g data-neighbor-area aria-hidden="true"></g><g data-edges></g><g data-navigation-path></g><g data-nodes></g></svg></div>
      <p class="connection-map-note" data-map-note></p>
      <div class="connection-legend" aria-label="Item type legend">${Object.entries(itemTypes).map(([kind,type])=>`<span class="connection-type" data-kind="${kind}">${symbols[kind]} ${e(type.label)}</span>`).join('')}</div>
    </section><aside id="connection-panel" class="connection-panel" aria-label="Connection details and list"><section data-selection></section><h3 data-list-title tabindex="-1">Connections</h3><div data-connection-list></div><div class="connection-list-pages"><button data-list-page="-1">Previous page</button><span data-list-range></span><button data-list-page="1">Next page</button></div><button data-connection-more hidden>Load more connections</button></aside></div>
    <p role="status" aria-live="polite" data-connection-status></p></div>`);
  const dialog=env.dialog,host=dialog.querySelector<HTMLElement>('.connections-view')!;
  const query=<T extends Element>(s:string)=>host.querySelector<T>(s)!;
  const filter=query<HTMLInputElement>('[data-connection-filter]'),kind=query<HTMLSelectElement>('[data-connection-kind]');
  const visibilityControl=query<HTMLSelectElement>('[data-connection-visibility]');
  let visibility:ConnectionVisibility='active',mutating=false;
  const more=query<HTMLButtonElement>('[data-connection-more]'),svg=query<SVGSVGElement>('svg'),map=query<HTMLElement>('[data-connection-graph]');
  const status=query<HTMLElement>('[data-connection-status]');
  const highlightToggle=query<HTMLButtonElement>('[data-neighbor-highlight]');
  let highlightNeighbors=true;
  try{highlightNeighbors=localStorage.getItem(NEIGHBOR_HIGHLIGHT_KEY)!=='off';}catch{/* Storage may be unavailable. */}
  highlightToggle.setAttribute('aria-pressed',String(highlightNeighbors));
  highlightToggle.onclick=()=>{
    highlightNeighbors=!highlightNeighbors;
    highlightToggle.setAttribute('aria-pressed',String(highlightNeighbors));
    try{localStorage.setItem(NEIGHBOR_HIGHLIGHT_KEY,highlightNeighbors?'on':'off');}catch{/* Keep the in-page choice. */}
    selection();
  };
  const textMeasure=document.createElement('canvas').getContext('2d');
  const titleLines=(title:string,maxWidth:number)=>{if(textMeasure)textMeasure.font=`600 14px ${getComputedStyle(svg).fontFamily}`;return connectionTitleLines(title,40,textMeasure?text=>textMeasure.measureText(text).width:undefined,maxWidth);};
  let place:Place={mode:source?'graph':'overview',id:source,group:'',q:'',kind:''};
  let data:ConnectionList={links:[],items:[],more:false},selected=source,focusedId='',sequenceTime=0,request=0,busy=false,listPage=0,timer:ReturnType<typeof setTimeout>|undefined;
  let points=new Map<string,{x:number;y:number}>(),width=900,height=600,view={x:-100,y:-100,w:900,h:600},fitWidth=900;
  let originNodeId=ORIGIN_ID;
  let history:HistoryEntry[]=[{place:{...place}}],historyIndex=0,disposed=false;
  const active=()=>!disposed&&host.isConnected&&dialog.open;
  const cleanup=()=>{disposed=true;++request;clearTimeout(timer);observer.disconnect();resize.disconnect();dialog.removeEventListener('close',onClose);dialog.removeEventListener('cancel',cancel);};
  const onClose=()=>{cleanup();if(env.closed)env.closed(opener);else if(opener?.isConnected)opener.focus({preventScroll:true});};
  const cancel=()=>clearTimeout(timer);
  dialog.addEventListener('close',onClose,{once:true});dialog.addEventListener('cancel',cancel);
  const observer=new MutationObserver(()=>{if(!host.isConnected)cleanup();});observer.observe(dialog,{childList:true});
  const size=()=>{const rect=svg.getBoundingClientRect();width=Math.max(rect.width,1);height=Math.max(rect.height,1);};
  const updateView=()=>{svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);query('[data-zoom-level]').textContent=`${Math.round(width/view.w*100)}%`;};
  function itemCard(kind:string,title:string,subtitle:string){
    const shape=connectionShape(kind),lines=titleLines(title,shape.width);
    return shape.markup+`<text class="connection-node-title">${lines.map((line,i)=>`<tspan x="${shape.x}" y="${shape.y+i*17}">${e(line)}</tspan>`).join('')}</text><text class="connection-node-subtitle" x="${shape.x}" y="${shape.y+(lines.length-1)*17+17}">${e(subtitle)}</text>`;
  }
  function fit(padding=0){size();const values=[...points.values()];if(!values.length){view={x:-100,y:-100,w:width,h:height};fitWidth=view.w;updateView();return;}
    const overview=place.mode==='overview',padX=overview?GROUP_CARD.width/2+GROUP_CARD.padding:140,padY=overview?GROUP_CARD.height/2+GROUP_CARD.padding:104;
    const xs=values.map(p=>p.x),ys=values.map(p=>p.y),x=Math.min(...xs)-padX,y=Math.min(...ys)-padY,w=Math.max(...xs)-x+padX,h=Math.max(...ys)-y+padY;
    const inset=Math.min(padding,width/4,height/4);
    const unit=Math.max(w/(width-2*inset),h/(height-2*inset),overview?1:.65);view={x:x+w/2-width*unit/2,y:y+h/2-height*unit/2,w:width*unit,h:height*unit};fitWidth=view.w;updateView();}
  function zoom(factor:number,px=width/2,py=height/2){size();const w=Math.max(width*.25,Math.min(Math.max(fitWidth*4,width*8),view.w*factor)),f=w/view.w;view={x:view.x+px/width*view.w*(1-f),y:view.y+py/height*view.h*(1-f),w,h:view.h*f};updateView();}
  function centerSelection(){const p=points.get(selected);if(p){size();const from=selected===(place.id||place.group)?points.get(originNodeId):undefined;
    if(from){const left=Math.min(p.x,from.x)-140,right=Math.max(p.x,from.x)+140,top=Math.min(p.y,from.y)-104,bottom=Math.max(p.y,from.y)+88,unit=Math.max(1,(right-left)/width,(bottom-top)/height);view={x:(left+right)/2-width*unit/2,y:(top+bottom)/2-height*unit/2,w:width*unit,h:height*unit};}
    else view={x:p.x-width/2,y:p.y-height/2,w:width,h:height};updateView();}}
  const resize=new ResizeObserver(()=>{if(!active())return;const oldW=width,oldH=height;size();if(place.mode==='overview'){renderMap();fit();}else{if(points.has(originNodeId)||(oldW>=640)!==(width>=640))renderMap();view.w*=width/oldW;view.h*=height/oldH;updateView();if(points.has(originNodeId)&&selected===(place.id||place.group))centerSelection();else if(map.contains(document.activeElement))reveal(focusedId);}});resize.observe(map);
  const panel=query<HTMLElement>('#connection-panel');
  const archiveButtons=(scope:'group'|'item'|'edge',id:string,active:number,archived:number,target='')=>[
    ...(visibility!=='archived'&&active>0?['archive']:[]),...(visibility!=='active'&&archived>0?['restore']:[])
  ].map(action=>`<button data-archive-action="${action}" data-archive-scope="${scope}" data-archive-id="${e(id)}" data-archive-target="${e(target)}" ${mutating?'disabled':''}>${action==='archive'?'Archive':'Restore'}${scope==='group'?' group':scope==='item'?' connections':''}</button>`).join('');
  const itemButtons=(item:ConnectionItem)=>`<button data-explore="${e(item.id)}">Explore connections</button><button class="wiki-link" data-open="${e(item.id)}">Open item</button>${archiveButtons('item',item.id,item.activeDegree??(visibility!=='archived'?item.degree||0:0),item.archivedDegree??(visibility==='archived'?item.degree||0:0))}`;
  const archiveBadge=(count:number,total:number)=>count?`<span class="connection-archive-badge">${count===total?'Archived':count+' archived'}</span>`:'';
  let openingItem=false;
  const openItem=async(id:string)=>{
    if(openingItem)return;openingItem=true;
    const title=data.items.find(item=>item.id===id)?.title||'selected item';
    dialog.close();
    const closeProgress=showProgressDialog('connection-opening',`Opening ${title}…`,'Redirecting to the selected item. Please wait.');
    let failure:Error|undefined;
    try{await env.open(id);}catch(error){failure=error instanceof Error?error:new Error(String(error));}
    finally{
      closeProgress();openingItem=false;
      const target=!failure?document.querySelector<HTMLElement>('#selected-item'):null;
      if(target)target.focus({preventScroll:true});else if(opener?.isConnected)opener.focus({preventScroll:true});
    }
    if(failure)env.notice(failure.message,true);
  };
  function wireItems(root:Element){
    root.querySelectorAll<HTMLButtonElement>('[data-archive-action]').forEach(button=>button.onclick=()=>void archiveConnections(button));
    root.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(button=>button.onclick=()=>select(button.dataset.select!));
    root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button=>button.onclick=()=>openItem(button.dataset.open!));
    root.querySelectorAll<HTMLButtonElement>('[data-explore]').forEach(button=>button.onclick=()=>void navigate({mode:'graph',id:button.dataset.explore!,group:'',q:'',kind:''}));
    root.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(button=>button.onclick=()=>void navigate({mode:'graph',id:'',group:button.dataset.group!,q:'',kind:''}));
  }
  function renderNeighborArea(peers:Set<string>){
    const layer=query<SVGGElement>('[data-neighbor-area]'),center=points.get(selected);
    layer.innerHTML='';
    if(!highlightNeighbors||place.mode==='overview'||!center)return;
    const neighbors=[...points].filter(([id])=>id!==selected&&id!==ORIGIN_ID&&peers.has(id));
    if(!neighbors.length)return;
    const included=[center,...neighbors.map(([,point])=>point)];
    const xs=included.map(point=>point.x),ys=included.map(point=>point.y);
    const left=Math.min(...xs)-140,top=Math.min(...ys)-102;
    const bounds=`x="${left}" y="${top}" width="${Math.max(...xs)-left+140}" height="${Math.max(...ys)-top+102}"`;
    const halo=(point:{x:number;y:number},fill:string,padding=0)=>`<rect x="${point.x-134-padding}" y="${point.y-92-padding}" width="${268+padding*2}" height="${176+padding*2}" rx="${18+padding}" fill="${fill}"/>`;
    // A connector band can cross another card. Cut out that card and its surrounding space.
    const exclusions=[...points].filter(([id])=>id===ORIGIN_ID||!peers.has(id));
    const bands=neighbors.map(([,point])=>`<path d="M${center.x} ${center.y} L${point.x} ${point.y}" fill="none" stroke="currentColor" stroke-width="32"/>`).join('');
    layer.innerHTML=`<mask id="connection-neighbor-mask" maskUnits="userSpaceOnUse" ${bounds}><rect ${bounds} fill="white"/>${exclusions.map(([,point])=>halo(point,'black',5)).join('')}</mask><g mask="url(#connection-neighbor-mask)">${bands}${included.map(point=>halo(point,'currentColor')).join('')}</g>`;
  }
  function selection(){const item=data.items.find(item=>item.id===selected),section=query<HTMLElement>('[data-selection]');
    section.innerHTML=item?`<h3>${e(item.title)}</h3><p class="connection-type" data-kind="${e(item.kind)}">${symbols[item.kind]||'●'} ${e(typeLabel(item.kind))} · ${item.degree??'—'} ${visibility==='all'?'total':visibility} connections</p><p>${e(Object.values(item.meta).join(' · '))}</p><div class="connection-selection-actions">${itemButtons(item)}</div>`:'<h3>Explore your connections</h3><p>Select an item to see its full title and connections. Explore fetches its direct neighbors.</p>';
    wireItems(section);
    const peers=new Set([selected]);for(const link of data.links)if(link.a===selected||link.b===selected){peers.add(link.a);peers.add(link.b);}
    svg.querySelectorAll<SVGGElement>('[data-node]').forEach(node=>{node.classList.toggle('selected',node.dataset.node===selected);node.classList.toggle('dimmed',!!item&&!peers.has(node.dataset.node!));node.setAttribute('aria-pressed',String(node.dataset.node===selected));});
    svg.querySelectorAll<SVGLineElement>('[data-edges] line').forEach(line=>{const related=line.dataset.a===selected||line.dataset.b===selected;line.classList.toggle('highlighted',related);line.classList.toggle('dimmed',!!item&&!related);});
    renderNeighborArea(peers);
    query<HTMLButtonElement>('[data-center]').disabled=!points.has(selected);
  }
  function select(id:string){const oldIds=[...points.keys()].join();selected=id;
    if(!points.has(id)&&place.mode!=='overview'){renderMap();fit();}else selection();
    if(oldIds!==[...points.keys()].join())status.textContent='Map updated to include the selected item. The list contains all loaded results.';
  }
  const mapNodes=()=>[...svg.querySelectorAll<SVGGElement>('[data-node],[data-group-node],[data-origin-node]')];
  const nodeId=(node:SVGGElement)=>node.dataset.node||node.dataset.groupNode||node.dataset.originNode!;
  function reveal(id:string){const p=points.get(id);if(!p)return;
    const halfW=place.mode==='overview'?GROUP_CARD.width/2:124,halfH=place.mode==='overview'?GROUP_CARD.height/2:94;
    if(p.x-halfW<view.x||p.x+halfW>view.x+view.w||p.y-halfH<view.y||p.y+halfH>view.y+view.h){view.x=p.x-view.w/2;view.y=p.y-view.h/2;updateView();}
  }
  function focusMap(preferred=focusedId){const nodes=mapNodes(),candidate=nodes.find(node=>nodeId(node)===preferred);
    const visible=nodes.find(node=>{const p=points.get(nodeId(node))!;return p.x>=view.x&&p.x<=view.x+view.w&&p.y>=view.y&&p.y<=view.y+view.h;});
    const node=candidate||visible||nodes[0];if(node)node.focus({preventScroll:true});else map.focus({preventScroll:true});
  }
  function exploreNode(node=mapNodes().find(node=>nodeId(node)===focusedId)){if(!node)return;
    if(node.dataset.originNode){moveHistory(-1);return;}
    if(node.dataset.node&&place.mode==='graph'&&place.id===node.dataset.node&&selected===node.dataset.node){openItem(node.dataset.node);return;}
    void navigate({mode:'graph',id:node.dataset.node||'',group:node.dataset.groupNode||'',q:'',kind:''});
  }
  function navigationOrigin(next:Place):NavigationOrigin|undefined {
    if(next.mode!=='graph')return;
    if(next.mode===place.mode&&next.id===place.id&&next.group===place.group)return history[historyIndex].from;
    if(place.mode==='graph'){
      if(place.id){const item=data.items.find(item=>item.id===place.id);if(item)return {id:item.id,title:item.title,kind:item.kind,role:'item'};}
      if(place.group){const prior=history[historyIndex].from,item=data.items.find(item=>item.id===place.group);return prior?.role==='group'&&prior.id===place.group?prior:{id:place.group,title:item?.title||'Connected group',kind:item?.kind||'',role:'group'};}
    }
    if(place.mode==='overview'&&next.group){const group=data.groups?.find(group=>group.id===next.group);if(group)return {id:group.id,title:group.title,kind:group.kind,role:'group'};}
    return {id:'',title:place.mode==='items'?'Search results':'Workspace overview',kind:'',role:place.mode==='items'?'search':'overview'};
  }
  function renderArrival(){const layer=query<SVGGElement>('[data-navigation-path]');layer.innerHTML='';
    if(place.mode!=='graph')return;
    const focal=place.id||place.group,current=points.get(focal),from=history[historyIndex].from;
    const focalNode=svg.querySelector<SVGGElement>(`[data-node="${CSS.escape(focal)}"]`);
    if(focalNode){focalNode.classList.add('connection-focal');focalNode.setAttribute('aria-label','Current focal item. '+focalNode.getAttribute('aria-label'));focalNode.insertAdjacentHTML('beforeend','<text class="connection-context-label" x="-122" y="-89">Current</text>');}
    if(!current||!from)return;
    const position=connectionArrivalPoint([...points].map(([id,p])=>({id,...p})),focal,width,height)!;points.set(originNodeId,position);
    const description=from.role==='group'?'Group':from.role==='item'?typeLabel(from.kind):'View';
    layer.innerHTML=`<line class="connection-navigation-line" aria-hidden="true" x1="${position.x}" y1="${position.y}" x2="${current.x}" y2="${current.y}"/><g class="connection-origin" data-origin-node="${e(originNodeId)}" data-kind="${e(from.kind)}" role="button" tabindex="-1" aria-label="From ${e(description)}: ${e(from.title)}. Return to previous view." transform="translate(${position.x} ${position.y})"><text class="connection-context-label" x="-122" y="-89">From</text>${itemCard(from.role==='item'?from.kind:'',from.title,description+' · Return')}<title>${e('From '+description+': '+from.title+' — Return to previous view')}</title></g>`;
  }
  function renderMap(){
    const restoreFocus=map.contains(document.activeElement);
    originNodeId=ORIGIN_ID;
    if(place.mode==='overview'){
      const groups=(data.groups||[]).slice(0,GRAPH_LIMIT);
      size();points=new Map(connectionGroupLayout(groups.map(group=>group.id),width,height).map(p=>[p.id,p]));
      query('[data-edges]').innerHTML='';query('[data-nodes]').innerHTML=groups.map(group=>{const p=points.get(group.id)!,lines=titleLines(group.title,228);return `<g role="button" tabindex="0" data-group-node="${e(group.id)}" data-kind="${e(group.kind)}" aria-label="Explore group ${e(typeLabel(group.kind))}: ${e(group.title)}, ${group.items} items, ${group.links} connections" transform="translate(${p.x} ${p.y})"><rect x="-150" y="-52" width="300" height="104" rx="14"/><text class="connection-group-symbol" x="-132" y="-9" aria-hidden="true">${symbols[group.kind]||'●'}</text><text class="connection-group-title" text-anchor="middle">${lines.map((line,i)=>`<tspan x="16" y="${-19+i*19}">${e(line)}</tspan>`).join('')}</text><text class="connection-group-count" y="31" text-anchor="middle">${group.items} items · ${group.links} connections</text>${group.archivedLinks?'<text class="connection-archive-label" y="47" text-anchor="middle">'+(group.archivedLinks===group.links?'Archived':group.archivedLinks+' archived')+'</text>':''}<title>${e(typeLabel(group.kind)+' · '+group.title)}</title></g>`;}).join('');
      query('[data-map-note]').textContent=`Map: ${groups.length} of ${(data.groups||[]).length} loaded groups. Each group contains items joined by a path of connections. Select a group to explore it.`;
      renderArrival();
    }else{
      const focal=place.id||place.group,from=history[historyIndex].from;
      const visible=visibleConnectionItems(data.items,data.links,selected,focal);
      if(place.mode==='graph'&&from?.role==='item'&&from.id!==focal&&visible.some(item=>item.id===focal)&&visible.some(item=>item.id===from.id))originNodeId=from.id;
      const cards=visible.filter(item=>item.id!==originNodeId);
      points=new Map(connectionLayout(cards,data.links,focal).map(p=>[p.id,p]));
      query('[data-nodes]').innerHTML=cards.map(item=>{const p=points.get(item.id)!;return `<g role="button" tabindex="0" data-node="${e(item.id)}" data-kind="${e(item.kind)}" aria-label="Explore ${e(typeLabel(item.kind))}: ${e(item.title)}" aria-pressed="false" transform="translate(${p.x} ${p.y})">${itemCard(item.kind,item.title,`${typeLabel(item.kind)} · ${item.degree??'—'} ${visibility==='archived'?'archived links':'links'}`)}<title>${e(typeLabel(item.kind)+' · '+item.title)}</title></g>`;}).join('');
      renderArrival();
      const eligible=data.links.filter(link=>points.has(link.a)&&points.has(link.b));
      const related=eligible.filter(link=>link.a===selected||link.b===selected),others=eligible.filter(link=>link.a!==selected&&link.b!==selected);
      const edges=[...related,...others].slice(0,500);
      const arrivalEdge=edges.find(link=>(link.a===originNodeId&&link.b===focal)||(link.b===originNodeId&&link.a===focal));
      if(arrivalEdge)query('[data-navigation-path] line').remove();
      query('[data-edges]').innerHTML=edges.map(link=>{const a=points.get(link.a)!,b=points.get(link.b)!;return `<line class="${link===arrivalEdge?'connection-navigation-line ':''}${link.archived?'connection-archived-edge':''}" data-a="${e(link.a)}" data-b="${e(link.b)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}).join('');
      query('[data-map-note]').textContent=`Map: ${visible.length} of ${data.items.length} loaded items · ${edges.length} of ${data.links.length} loaded connections drawn. ${data.items.length>GRAPH_LIMIT||eligible.length>500?`Map limited to ${GRAPH_LIMIT} items and 500 lines; select from the list or explore a smaller neighborhood. `:''}Drag to pan · Wheel/pinch to zoom · Click or press Enter to explore.`;
    }
    if(points.has(originNodeId))query('[data-map-note]').textContent+=' Dashed line shows your navigation path.';
    selection();
    const nodes=mapNodes();if(!nodes.some(node=>nodeId(node)===focusedId))focusedId=nodes.some(node=>nodeId(node)===selected)?selected:nodes[0]?nodeId(nodes[0]):'';
    for(const node of nodes){node.tabIndex=nodeId(node)===focusedId?0:-1;
      node.onfocus=()=>{focusedId=nodeId(node);for(const peer of nodes)peer.tabIndex=peer===node?0:-1;reveal(focusedId);if(node.dataset.node)select(focusedId);};
      node.onclick=()=>{node.focus({preventScroll:true});exploreNode(node);};
    }
    if(restoreFocus)focusMap();
  }
  function render(reset:boolean){
    query('[data-location]').textContent=place.mode==='overview'?'Workspace overview':place.mode==='items'?'Search results across the workspace':place.id?`Connections of ${data.items.find(item=>item.id===place.id)?.title||'selected item'}`:'Connected group';
    query('[data-list-title]').textContent=place.mode==='overview'?'Connected groups':place.mode==='items'?'Matching items':'Loaded connections';
    const list=query<HTMLElement>('[data-connection-list]'),byId=new Map(data.items.map(item=>[item.id,item])),start=listPage*50;
    list.innerHTML=place.mode==='overview'?(data.groups||[]).slice(start,start+50).map(group=>`<div class="connection-list-row" data-kind="${e(group.kind)}"><strong><span class="connection-group-symbol" role="img" aria-label="${e(typeLabel(group.kind))}">${symbols[group.kind]||'●'}</span> ${e(group.title)}</strong><span>${group.items} items · ${group.links} connections</span>${archiveBadge(group.archivedLinks||0,group.links)}<button data-group="${e(group.id)}">Explore group</button>${archiveButtons('group',group.id,group.links-(group.archivedLinks||0),group.archivedLinks||0)}</div>`).join(''):place.mode==='items'?data.items.slice(start,start+50).map(item=>`<div class="connection-list-row"><button data-select="${e(item.id)}">${e(item.title)}</button><span>${e(typeLabel(item.kind))} · ${item.degree} ${visibility==='all'?'total':visibility} connections</span>${itemButtons(item)}</div>`).join(''):data.links.slice(start,start+50).map(link=>`<div class="connection-list-row" data-connection-edge="${e(link.a)}|${e(link.b)}">${[link.a,link.b].map(id=>{const item=byId.get(id)!;return `<button data-select="${e(id)}">${symbols[item.kind]||'●'} ${e(item.title)}</button>`;}).join('<span aria-label="connected to">↔</span>')}${archiveBadge(link.archived?1:0,1)}${archiveButtons('edge',link.a,link.archived?0:1,link.archived?1:0,link.b)}</div>`).join('');
    if(!list.childElementCount)list.innerHTML='<p>No connections found. Try a different search or item type.</p>';
    wireItems(list);more.hidden=!data.more;more.textContent=place.mode==='overview'?'Load more groups':place.mode==='items'?'Load more items':'Load more connections';
    const groupActions=query<HTMLElement>('[data-group-actions]');groupActions.innerHTML=place.group?archiveButtons('group',place.group,data.activeTotal??data.links.filter(link=>!link.archived).length,data.archivedTotal??data.links.filter(link=>link.archived).length):'';wireItems(groupActions);
    renderMap();if(reset){fit();if(place.mode==='graph')centerSelection();}
    const loaded=place.mode==='overview'?(data.groups||[]).length:place.mode==='items'?data.items.length:data.links.length;
    query('[data-list-range]').textContent=loaded?`${start+1}–${Math.min(start+50,loaded)} of ${loaded}`:'0 results';
    host.querySelectorAll<HTMLButtonElement>('[data-list-page]').forEach(button=>button.disabled=Number(button.dataset.listPage)<0?listPage===0:start+50>=loaded);
    status.textContent=`${visibility==='all'?'All':visibility==='active'?'Active':'Archived'} · `+(place.mode==='overview'?`${loaded} of ${data.groupTotal??loaded} groups loaded · ${data.itemTotal??0} items · ${data.total??0} total connections.`:`${loaded} of ${data.total??loaded} ${place.mode==='items'?'matching items':'connections'} loaded. ${data.more?'Load more to continue.':''}`);
    host.querySelectorAll<HTMLButtonElement>('[data-history]').forEach(button=>button.disabled=Number(button.dataset.history)<0?historyIndex===0:historyIndex===history.length-1);
  }
  async function fetchPage(reset:boolean){
    const version=++request;busy=true;
    if(reset){data={items:[],links:[],more:false};listPage=0;render(true);}
    more.disabled=true;status.textContent='Loading connections…';host.setAttribute('aria-busy','true');
    const offset=reset?0:place.mode==='overview'?(data.groups||[]).length:place.mode==='items'?data.items.length:data.links.length;
    const route=`connections&mode=${place.mode}&id=${encodeURIComponent(place.id)}&group=${encodeURIComponent(place.group)}&q=${encodeURIComponent(place.q)}&kind=${encodeURIComponent(place.kind)}&visibility=${visibility}&offset=${offset}` as const;
    try{const result=await env.api(route);if(version!==request||!active())return;
      listPage=reset?0:Math.floor(offset/50);
      data=reset?result:{...result,links:[...new Map([...data.links,...result.links].map(link=>[link.a+'|'+link.b,link])).values()],items:[...new Map([...data.items,...result.items].map(item=>[item.id,item])).values()],groups:[...(data.groups||[]),...(result.groups||[])]};render(reset||place.mode==='overview');
      if(reset&&document.activeElement!==filter&&document.activeElement!==kind&&document.activeElement!==visibilityControl)focusMap(selected||focusedId);
    }catch(error){if(version===request&&active()){status.textContent=`Could not load connections: ${(error as Error).message}. Use Reset view to retry.`;}}
    finally{if(version===request&&active()){busy=false;more.disabled=false;host.setAttribute('aria-busy','false');}}
  }
  function remember(){if(!busy&&!mutating)history[historyIndex].snapshot={data,selected,focusedId,view:{...view},fitWidth,listPage,scroll:panel.scrollTop,width,height};}
  function invalidateHistory(){for(const entry of history){delete entry.snapshot;delete entry.from;}}
  async function archiveConnections(button:HTMLButtonElement){
    if(mutating)return;mutating=true;clearTimeout(timer);++request;busy=false;more.disabled=true;host.setAttribute('aria-busy','true');filter.value=place.q;kind.value=place.kind;
    host.querySelectorAll<HTMLButtonElement>('[data-archive-action]').forEach(button=>button.disabled=true);
    const action=button.dataset.archiveAction!,scope=button.dataset.archiveScope!,targetId=button.dataset.archiveId!,targetGroup=data.groups?.find(group=>group.id===targetId);status.textContent=action==='archive'?'Archiving connections…':'Restoring connections…';
    try{
      const result=await env.api('connection',{action,scope,id:button.dataset.archiveId!,target:button.dataset.archiveTarget||'',visibility});
      invalidateHistory();env.changed?.();
      if(!active())return;
      if(action==='restore'&&visibility==='archived'){visibility='active';visibilityControl.value='active';}
      if(scope==='group'&&action==='archive'&&visibility==='active')await navigate({mode:'overview',id:'',group:'',q:'',kind:''});else await fetchPage(true);
      if(action==='restore'&&active()){
        const restoredGroup=place.mode==='overview'?data.groups?.find(group=>group.id===targetId)||data.groups?.find(group=>targetGroup&&group.title===targetGroup.title&&group.kind===targetGroup.kind):undefined;
        focusMap(restoredGroup?.id||(scope==='item'?targetId:selected||focusedId));
      }
      if(active()){const message=`${action==='archive'?'Archived':'Restored'} ${result.changed??0} connections.`;status.textContent=message+' '+status.textContent;env.notice(message);}
    }catch(error){if(active())status.textContent=`Could not ${action==='archive'?'archive':'restore'} connections: ${(error as Error).message}`;}
    finally{mutating=false;if(active()){if(!busy){more.disabled=false;host.setAttribute('aria-busy','false');}host.querySelectorAll<HTMLButtonElement>('[data-archive-action]').forEach(button=>button.disabled=false);}}
  }
  async function navigate(next:Place,record=true){clearTimeout(timer);sequenceTime=0;if(record){const from=navigationOrigin(next);remember();history=history.slice(0,historyIndex+1);history.push({place:{...next},from});historyIndex++;}place={...next};selected=place.id||place.group;focusedId=selected;filter.value=place.q;kind.value=place.kind;panel.scrollTop=0;await fetchPage(true);}
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
  visibilityControl.onchange=()=>{visibility=visibilityControl.value as ConnectionVisibility;clearTimeout(timer);invalidateHistory();void fetchPage(true);};
  more.onclick=()=>{if(!busy)void fetchPage(false);};
  host.querySelectorAll<HTMLButtonElement>('[data-list-page]').forEach(button=>button.onclick=()=>{listPage+=Number(button.dataset.listPage);render(false);query<HTMLElement>('[data-list-title]').focus();});
  query<HTMLButtonElement>('[data-fit]').onclick=()=>fit(32);
  query<HTMLButtonElement>('[data-reset-graph]').onclick=()=>void navigate({...place},false);
  query<HTMLButtonElement>('[data-center]').onclick=centerSelection;
  host.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(button=>button.onclick=()=>zoom(button.dataset.zoom==='in'?.8:1.25));
  query<HTMLButtonElement>('[data-toggle-panel]').onclick=event=>{const button=event.currentTarget as HTMLButtonElement;panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));button.textContent=panel.hidden?'Show details':'Hide details';};
  map.addEventListener('wheel',event=>{event.preventDefault();const rect=svg.getBoundingClientRect();zoom(Math.exp(Math.max(-.35,Math.min(.35,event.deltaY*.002))),event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
  const pointers=new Map<number,{x:number;y:number}>();
  map.onpointerdown=event=>{if(event.button!==0)return;if((event.target as Element).closest('[data-node],[data-group-node],[data-origin-node]'))return;map.focus({preventScroll:true});map.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});};
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
    if(event.key==='Enter'){event.preventDefault();if(!event.repeat)exploreNode();return;}
    if(event.key===' '){event.preventDefault();if(focusedId===originNodeId){if(!event.repeat)exploreNode();}else if(place.mode!=='overview')select(focusedId);return;}
    if(event.key==='g'){event.preventDefault();if(!event.repeat){const now=Date.now();if(sequenceTime&&now-sequenceTime<900){const first=mapNodes()[0];if(first)focusMap(nodeId(first));sequenceTime=0;}else sequenceTime=now;}return;}
    sequenceTime=0;
    if(event.key==='G'||event.key==='Home'||event.key==='End'){event.preventDefault();const nodes=mapNodes(),node=event.key==='Home'?nodes[0]:nodes.at(-1);if(node)focusMap(nodeId(node));return;}
    if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?1.25:.8);}
  });
  await fetchPage(true);if(active()&&document.activeElement!==filter&&document.activeElement!==kind)focusMap(selected||focusedId);
}
