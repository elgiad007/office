export type ScrollDirection = 'up'|'down'|'page-up'|'page-down'|'start'|'end';

// Use the same animation in the outer reader and the sandboxed HTML reader.
export function createKeyboardScroller(panel: HTMLElement) {
  let frame=0,target=panel.scrollTop,position=panel.scrollTop,lastTime=0,lastDirection=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const cancel=()=>{cancelAnimationFrame(frame);frame=0;lastDirection=0;};
  const clamp=(value: number)=>Math.max(0,Math.min(panel.scrollHeight-panel.clientHeight,value));
  const tick=(time: number)=>{
    if(!panel.isConnected){cancel();return;}
    target=clamp(target);
    const delta=target-position;
    if(reduced.matches||Math.abs(delta)<1){panel.scrollTop=target;cancel();return;}
    const elapsed=Math.min(50,Math.max(1,time-lastTime));lastTime=time;
    position+=delta*(1-Math.exp(-elapsed/55));
    panel.scrollTop=position;
    frame=requestAnimationFrame(tick);
  };
  panel.addEventListener('wheel',cancel,{passive:true});
  panel.addEventListener('pointerdown',cancel,{passive:true});
  panel.addEventListener('focusout',cancel);
  const scroll=(direction: ScrollDirection)=>{
    const sign=direction==='up'||direction==='page-up'||direction==='start'?-1:1;
    const step=direction.startsWith('page-')?Math.max(56,panel.clientHeight*.85):56;
    // Reverse immediately and cap the distance ahead during rapid key repeat.
    if(!frame||sign!==lastDirection)target=position=panel.scrollTop;
    target=clamp(direction==='start'?0:direction==='end'?panel.scrollHeight:
      panel.scrollTop+sign*Math.min(Math.abs(target-panel.scrollTop)+step,step*3));
    lastDirection=sign;
    if(reduced.matches){panel.scrollTop=target;cancel();return;}
    if(!frame){lastTime=performance.now();frame=requestAnimationFrame(tick);}
  };
  return Object.assign(scroll,{cancel});
}
