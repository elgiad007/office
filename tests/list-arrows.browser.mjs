import assert from 'node:assert/strict';

export async function testListArrows(page,url) {
  let kind='mail';
  const routes=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    const records=[0,1,2].map(i=>({id:`arrows-${kind}-${i}`,kind,title:`Arrows ${kind} ${i}`,body:'Fixture content',revision:1,meta:kind==='mail'?{folder:'Inbox',read:true,from:'sender@example.com'}:kind==='sheets'?{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}:{}}));
    const responses={status:{authenticated:true,csrf:'fixture',preferences:{keys:{down:'J',up:'K'}}},accounts:{accounts:[]},records:{records},connections:{items:[],links:[],more:false},'google-settings':{configured:false}};
    assert.ok(action in responses,`Unexpected list-arrow API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  try {
    await page.setViewportSize({width:1440,height:800});
    for(kind of ['mail','calendar','tasks','contacts','documents','wiki','sheets']){
      await page.goto(url+'#'+kind);await page.reload();
      await page.locator('#items .item').nth(1).click();
      const check=async index=>{
        await page.locator(`#selected-item[data-id="arrows-${kind}-${index}"]`).waitFor();
        assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),true,kind+' keeps list focus');
      };
      for(const [key,index] of [['ArrowDown',2],['ArrowDown',2],['ArrowUp',1],['ArrowLeft',0],['ArrowLeft',0],['ArrowRight',1],['J',2],['K',1]]){
        await page.keyboard.press(key);await check(index);
      }
      await page.keyboard.down('ArrowDown');await check(2);
      await page.keyboard.down('ArrowDown');await check(2);
      await page.keyboard.up('ArrowDown');
      if(kind==='sheets'){
        await page.locator('[data-cell=A1]').focus();
        for(const [key,cell] of [['ArrowRight','B1'],['ArrowDown','B2'],['ArrowLeft','A2'],['ArrowUp','A1']]){
          await page.keyboard.press(key);
          assert.equal(await page.locator(`[data-cell=${cell}]`).evaluate(node=>node===document.activeElement),true,'Sheets '+key+' moves between cells');
          assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'arrows-sheets-2');
        }
      }
    }
  } finally {await page.unroute(routes);await page.goto(url+'#mail');await page.reload();}
}
