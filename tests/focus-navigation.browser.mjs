import assert from 'node:assert/strict';

export async function testFocusNavigation(page,url) {
  const long=Array.from({length:180},(_,i)=>`Content line ${i}`).join('\n');
  let kind='mail';
  const routes=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    const records=[0,1,2].map(i=>({id:`focus-${kind}-${i}`,kind,title:`Focus ${kind} ${i}`,body:kind==='documents'?long.replaceAll('\n','<br>'):long,revision:1,meta:kind==='mail'?{folder:'Inbox',read:true,from:'sender@example.com'}:kind==='sheets'?{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}:{}}));
    const responses={status:{authenticated:true,csrf:'fixture',preferences:{theme:'dark',accent:'plum',keys:{down:'J',up:'K'}}},accounts:{accounts:[]},records:{records},'google-settings':{configured:false}};
    assert.ok(action in responses,`Unexpected focus API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  try {
    await page.setViewportSize({width:1440,height:800});
    for(kind of ['mail','calendar','tasks','contacts','documents','wiki','sheets']){
      await page.goto(url+'#'+kind);await page.reload();
      await page.locator('#items .item').nth(1).click();
      const selected=await page.locator('#selected-item').getAttribute('data-id');
      const entry=kind==='mail'?'.mail-body':kind==='sheets'?'.sheet-wrap':'#detail';
      const owner=kind==='mail'?'#detail':kind==='sheets'?'.sheet-wrap':kind==='documents'?'#rich-editor':'textarea.body-editor';
      const scrollOffset=()=>page.evaluate(selector=>{const node=document.querySelector(selector);return(node&&node.scrollHeight>node.clientHeight?node:document.querySelector('#detail')).scrollTop;},owner);
      const box=await page.locator('#detail').boundingBox();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(entry).evaluate(node=>node===document.activeElement),true,kind+' enters nonediting content');
      assert.equal(await page.locator('#detail').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
      assert.deepEqual(await page.locator('#detail').boundingBox(),box,'Focus ring causes no layout shift');
      await page.keyboard.press('J');
      assert.ok(await scrollOffset()>0,kind+' scrolls actual content with remapped down');
      await page.keyboard.press('G');
      const end=await scrollOffset();
      assert.ok(end>0,kind+' reaches content end');
      await page.keyboard.press('g');await page.keyboard.press('g');
      assert.equal(await scrollOffset(),0,kind+' reaches content start');
      assert.equal(await page.locator('#selected-item').getAttribute('data-id'),selected,kind+' keeps selected object');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),true);
      assert.equal(await page.locator('.list-pane').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
      await page.keyboard.press('J');
      await page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id!==id,selected);
      if(kind==='sheets'){
        await page.keyboard.press('l');assert.equal(await page.locator('[data-cell=A1]').evaluate(node=>node===document.activeElement),true);
        await page.keyboard.press('Tab');assert.equal(await page.locator('[data-cell=B1]').evaluate(node=>node===document.activeElement),true);
        await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[data-cell=A1]').evaluate(node=>node===document.activeElement),true);
      }else if(kind!=='mail'&&kind!=='wiki'){
        await page.locator('.title-input').focus();await page.keyboard.press('Tab');
        assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),false,'Editor Tab remains native');
      }
    }
  }finally{await page.unroute(routes);await page.goto(url+'#mail');await page.reload();}
}
