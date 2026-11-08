export type SwipeDirection = 'left' | 'right';
export type ItemSwipeAction = 'off' | 'delete';
export type MailSwipeAction = ItemSwipeAction | 'archive' | 'move' | 'read' | 'unread';
export interface SwipePreferences {
  mail: Record<SwipeDirection, MailSwipeAction>;
  items: Record<SwipeDirection, ItemSwipeAction>;
}

export const itemSwipeActions = {off:'Off', delete:'Delete'};
export const mailSwipeActions = {
  ...itemSwipeActions, archive:'Archive', move:'Move to folder', read:'Mark as read', unread:'Mark as unread',
};

export function swipePreferences(value?: Partial<Record<keyof SwipePreferences, Partial<Record<SwipeDirection,unknown>>>>): SwipePreferences {
  const read = <Action extends string>(action: unknown, options: Record<Action,string>, fallback: Action) =>
    typeof action==='string'&&Object.hasOwn(options,action) ? action as Action : fallback;
  return {
    mail:{left:read(value?.mail?.left,mailSwipeActions,'delete'),right:read(value?.mail?.right,mailSwipeActions,'off')},
    items:{left:read(value?.items?.left,itemSwipeActions,'delete'),right:read(value?.items?.right,itemSwipeActions,'off')},
  };
}

interface SwipeAction {label: string; danger?: boolean; run: () => void}
interface Gesture {
  row: HTMLElement;
  pointer: number;
  x: number;
  y: number;
  bounds: DOMRect;
  viewport: DOMRect;
  action?: SwipeAction;
  direction?: SwipeDirection;
  preview?: HTMLElement;
}

export function installRowSwipes(actionFor: (row: HTMLElement, direction: SwipeDirection) => SwipeAction | undefined) {
  let gesture: Gesture | undefined;
  let suppressClick = false;
  const cancel = () => {
    if(!gesture)return;
    gesture.row.classList.remove('row-swiping');
    gesture.row.style.removeProperty('--swipe-offset');
    gesture.row.style.removeProperty('--swipe-clip');
    gesture.preview?.remove();
    gesture=undefined;
  };
  const threshold = (g: Gesture) => Math.min(96,Math.max(40,g.bounds.width*.28));

  document.addEventListener('pointerdown',event=>{
    cancel();
    if(!event.isPrimary)return;
    suppressClick=false;
    if(event.button!==0||!['touch','pen'].includes(event.pointerType))return;
    const row=(event.target as Element).closest<HTMLElement>('#items:not(.calendar-board) .item[data-id], #items :is(.calendar-agenda,.calendar-undated) .item[data-id]');
    if(!row||row.matches(':disabled')||(event.target as Element).closest('a,input,select,textarea,[contenteditable]'))return;
    gesture={row,pointer:event.pointerId,x:event.clientX,y:event.clientY,bounds:row.getBoundingClientRect(),viewport:row.closest('#items')!.getBoundingClientRect()};
  },true);

  document.addEventListener('pointermove',event=>{
    const g=gesture;
    if(!g||event.pointerId!==g.pointer)return;
    if(!g.row.isConnected){cancel();return;}
    const dx=event.clientX-g.x,dy=event.clientY-g.y,distance=Math.abs(dx);
    if(!g.direction){
      if(Math.abs(dy)>10&&Math.abs(dy)>=distance){cancel();return;}
      if(distance<12||distance<Math.abs(dy)*1.4)return;
      suppressClick=true;
      g.direction=dx<0?'left':'right';
      g.action=actionFor(g.row,g.direction);
      if(!g.action){cancel();return;}
      g.preview=document.createElement('div');
      g.preview.className='swipe-preview';
      g.preview.setAttribute('aria-hidden','true');
      g.preview.classList.toggle('danger',!!g.action.danger);
      g.preview.textContent=g.action.label;
      const top=Math.max(0,g.bounds.top,g.viewport.top),bottom=Math.min(innerHeight,g.bounds.bottom,g.viewport.bottom);
      g.preview.style.top=`${top}px`;
      g.preview.style.height=`${Math.max(0,bottom-top)}px`;
      document.body.append(g.preview);
      g.row.setPointerCapture(event.pointerId);
    }
    const sign=g.direction==='left'?-1:1;
    const revealed=Math.min(Math.max(0,sign*dx),Math.max(threshold(g),Math.min(160,g.bounds.width*.8)));
    g.row.classList.add('row-swiping');
    g.row.style.setProperty('--swipe-offset',`${sign*revealed}px`);
    g.row.style.setProperty('--swipe-clip',sign<0?`0 0 0 ${revealed}px`:`0 ${revealed}px 0 0`);
    g.preview!.style.left=`${sign<0?g.bounds.right-revealed:g.bounds.left}px`;
    g.preview!.style.width=`${revealed}px`;
    g.preview!.classList.toggle('armed',revealed>=threshold(g));
  },true);

  document.addEventListener('pointerup',event=>{
    const g=gesture;
    if(!g||event.pointerId!==g.pointer)return;
    const distance=(event.clientX-g.x)*(g.direction==='left'?-1:1);
    cancel();
    if(g.row.isConnected&&distance>=threshold(g))g.action?.run();
  },true);
  document.addEventListener('pointercancel',event=>{
    if(event.pointerId===gesture?.pointer)cancel();
  },true);
  document.addEventListener('lostpointercapture',event=>{
    // Transferring implicit capture from a child to the row also fires this event.
    if(event.pointerId===gesture?.pointer&&event.target===gesture.row)cancel();
  },true);
  document.addEventListener('click',event=>{
    if(!suppressClick||event.detail===0)return;
    suppressClick=false;
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);
  document.addEventListener('contextmenu',event=>{
    cancel();
    if(!suppressClick)return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);
  window.addEventListener('scroll',cancel,true);
  window.addEventListener('resize',cancel);
  window.addEventListener('blur',cancel);
  return () => {suppressClick=true;};
}
