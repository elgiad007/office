import type {ItemMeta} from './types.js';
import {createKeyboardScroller, vimScrollDirection, type ScrollDirection} from './keyboard-scroll.js';

/** Keep the original field order, repeated fields and folding; never include a MIME body. */
export function messageHeaders(meta: ItemMeta): string {
  const encoded=meta.rawBase64||meta.headersBase64;
  const source=encoded?new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))):meta.raw||'';
  return source.split(/\r\n\r\n|\n\n|\r\r/,1)[0];
}

/** Literal, non-overlapping matches with offsets into the unchanged source text. */
export function headerMatches(source: string, query: string): number[] {
  if(!query)return [];
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return Array.from(source.matchAll(new RegExp(escaped,'gi')),match=>match.index!);
}

export function setupHeaderViewer(dialog: HTMLDialogElement, headers: string, keys: Record<string,string>) {
  const content=dialog.querySelector<HTMLElement>('.message-headers')!;
  const input=dialog.querySelector<HTMLInputElement>('[data-header-search]')!;
  const count=dialog.querySelector<HTMLElement>('[data-header-count]')!;
  const previous=dialog.querySelector<HTMLButtonElement>('[data-header-previous]')!;
  const next=dialog.querySelector<HTMLButtonElement>('[data-header-next]')!;
  const copy=dialog.querySelector<HTMLButtonElement>('[data-header-copy]')!;
  const status=dialog.querySelector<HTMLElement>('[data-header-status]')!;
  const scroll=createKeyboardScroller(content);
  let matches: HTMLElement[]=[], active=0;
  const select=(step=0)=>{
    scroll.cancel();
    if(matches.length){matches[active]?.classList.remove('active');active=(active+step+matches.length)%matches.length;matches[active].classList.add('active');matches[active].scrollIntoView({block:'nearest',inline:'nearest'});}
    count.textContent=input.value?(matches.length?`${active+1} of ${matches.length}`:'No results'):'';
    previous.disabled=next.disabled=!matches.length;
  };
  input.oninput=()=>{
    const fragment=document.createDocumentFragment();let offset=0;matches=[];active=0;
    for(const start of headerMatches(headers,input.value)){
      fragment.append(document.createTextNode(headers.slice(offset,start)));
      const mark=document.createElement('mark');mark.textContent=headers.slice(start,start+input.value.length);fragment.append(mark);matches.push(mark);offset=start+input.value.length;
    }
    fragment.append(document.createTextNode(headers.slice(offset)));content.replaceChildren(fragment);select();
  };
  previous.onclick=()=>select(-1);next.onclick=()=>select(1);
  copy.onclick=async()=>{
    status.textContent='';
    try {await navigator.clipboard.writeText(headers);status.textContent='Headers copied.';}
    catch {status.textContent='Could not copy headers. Select the headers and copy them manually.';}
  };
  const scrollKeys: Record<string,ScrollDirection>={ArrowDown:'down',ArrowUp:'up',PageDown:'page-down',PageUp:'page-up',Home:'start',End:'end',G:'end',
    [keys.down]:'down',[keys.up]:'up',[keys.pageDown]:'half-page-down',[keys.pageUp]:'half-page-up'};
  let lastG=0;
  const keyboard=(event: KeyboardEvent)=>{
    if(event.altKey||event.isComposing)return;
    if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='f'){
      event.preventDefault();input.focus();input.select();return;
    }
    const target=event.target as HTMLElement;
    if(target===content){
      const direction=vimScrollDirection(event);
      if(direction){event.preventDefault();lastG=0;scroll(direction);return;}
    }
    if(event.ctrlKey||event.metaKey)return;
    if(target===input){if(event.key==='Enter'){event.preventDefault();select(event.shiftKey?-1:1);}return;}
    if(target.closest('input, textarea, select, [contenteditable="true"]'))return;
    if(event.key==='/'){event.preventDefault();input.focus();}
    else if(event.key==='n'||event.key==='p'){event.preventDefault();select(event.key==='n'?1:-1);}
    else if(target===content){
      if(event.key==='g'){
        event.preventDefault();
        if(event.repeat)return;
        const now=performance.now();
        if(lastG&&now-lastG<=900){scroll('start');lastG=0;}
        else lastG=now;
        return;
      }
      const direction=Object.hasOwn(scrollKeys,event.key)?scrollKeys[event.key]:undefined;
      if(direction){event.preventDefault();scroll(direction);}
    }
    lastG=0;
  };
  content.addEventListener('blur',()=>{lastG=0;});
  dialog.addEventListener('keydown',keyboard);
  dialog.addEventListener('close',()=>{scroll.cancel();dialog.removeEventListener('keydown',keyboard);},{once:true});
  content.textContent=headers;select();content.focus();
}
