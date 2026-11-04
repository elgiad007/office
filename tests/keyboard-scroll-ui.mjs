// Wait for animation to settle rather than assuming a keypress scrolls instantly.
export async function settleScroll(locator) {
  await locator.evaluate(node=>new Promise(resolve=>{
    let previous=node.scrollTop,stable=0,frames=0;
    const tick=()=>{
      const top=node.scrollTop;
      stable=top===previous?stable+1:0;previous=top;
      if(stable>=8||++frames>240){resolve();return;}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}
