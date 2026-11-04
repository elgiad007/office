import assert from 'node:assert/strict';

export async function testMailUndo(page,url) {
  await page.goto('about:blank');
  let records=[],prefs={},held=null,failDelete=null,failUndo=null;
  const calls=[],receipts=new Map();
  const message=(id,remote=true)=>({id,kind:'mail',title:'Undo '+id,body:'Full body '+id,revision:1,updated:'2026-11-02T12:00:00Z',meta:{folder:'Inbox',read:true,from:'sender@example.com',...(remote?{remote:true,account:'undo-account',providerId:id,source:'gmail:'+id}:{})}});
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,activity:true,csrf:'fixture',preferences:prefs}});
    if(action==='activity')return route.fulfill({json:{entries:[]}});
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='connections')return route.fulfill({json:{items:[],links:[],more:false}});
    if(action==='records')return route.fulfill({json:{records:records.filter(r=>r.kind===(new URL(route.request().url()).searchParams.get('kind')))}});
    const input=route.request().postDataJSON();calls.push({route:action,...input});
    if(action==='mail-undo'){
      if(input.token===failUndo)return route.fulfill({status:409,json:{error:'Retry after preflight failure'}});
      const before=receipts.get(input.token);assert.ok(before,'only confirmed receipts undone');
      records=records.filter(r=>r.id!==before.id);records.push(structuredClone(before));receipts.delete(input.token);
      return route.fulfill({json:{record:before}});
    }
    if(action==='mail-action'||action==='delete'){
      if(held)await held.promise;
      if(input.id===failDelete)return route.fulfill({status:400,json:{error:'Test deletion failure'}});
      const record=records.find(r=>r.id===input.id);assert.ok(record);
      let undoToken;
      if(input.undoable){undoToken='receipt-'+input.id;receipts.set(undoToken,structuredClone(record));}
      if(action==='delete')records=records.filter(r=>r!==record);
      else {assert.equal(input.action,'trash');record.meta.folder='Trash';record.revision++;}
      return route.fulfill({json:{ok:true,record:action==='delete'?undefined:record,undoToken}});
    }
    return route.fulfill({json:{configured:false}});
  });
  const reset=async(remote=true,keys={})=>{
    records=['a','b','c'].map(id=>message(id,remote));prefs={keys};calls.length=0;receipts.clear();failDelete=null;failUndo=null;
    await page.goto(url+'#mail');await page.reload();await page.locator('#mail-folder').selectOption('Inbox');await page.locator('#items [data-id="a"]').click();
  };
  const press=async key=>{await page.locator('#main').focus();await page.keyboard.press(key);};
  const deleted=()=>page.locator('#items [data-id="a"]').waitFor({state:'detached'});
  try{
    await reset(true,{delete:'d',undoDelete:'u'});
    let release;held={promise:new Promise(resolve=>release=resolve)};
    await press('v');await press('j');await press('v');await press('D');await deleted();await press('U');
    assert.equal(calls.filter(c=>c.route==='mail-undo').length,0,'undo waits for deletion gesture');
    await page.locator('#main').evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'U',shiftKey:true,repeat:true,bubbles:true})));
    held=null;release();
    await page.locator('#notice').filter({hasText:'2 messages restored.'}).waitFor();
    assert.equal(calls.filter(c=>c.route==='mail-undo').length,2,'one undo restores whole batch, repeats ignored');
    assert.equal(await page.locator('#items .item').count(),3);
    await reset();failDelete='b';
    await press('v');await press('j');await press('v');await press('D');
    await page.locator('#notice').filter({hasText:'Test deletion failure'}).waitFor();
    failUndo='receipt-a';await press('U');await page.locator('#notice').filter({hasText:'Retry after preflight failure'}).waitFor();
    failUndo=null;await press('U');await page.locator('#notice').filter({hasText:'1 message restored.'}).waitFor();
    assert.deepEqual(calls.filter(c=>c.route==='mail-undo').map(c=>c.token),['receipt-a','receipt-a'],'failed receipt retained, failed deletion excluded');
    await reset(false);
    await page.locator('#items [data-id="a"]').click({button:'right'});await page.getByRole('menuitem',{name:'Delete…',exact:true}).click();await page.locator('#confirm').click();await deleted();
    await press('U');await page.locator('#notice').filter({hasText:'1 message restored.'}).waitFor();
    assert.equal(await page.locator('#items [data-id="a"]').count(),1,'context-menu local deletion undo');
    await reset();await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await deleted();
    await page.locator('#items [data-id="c"]').click();await press('U');await page.locator('#notice').filter({hasText:'1 message restored.'}).waitFor();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'c','user navigation remains selected');
    await reset(true,{undoDelete:'z'});await press('D');await deleted();
    await page.locator('#search').fill('u');await page.keyboard.press('z');assert.equal(await page.locator('#search').inputValue(),'uz');await page.locator('#search').fill('');
    await press('Control+z');await press('Alt+z');await press('U');assert.equal(calls.filter(c=>c.route==='mail-undo').length,0,'typing/modifiers and old binding ignored');
    await page.getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();await page.keyboard.press('z');assert.equal(calls.filter(c=>c.route==='mail-undo').length,0,'dialog guard');await page.locator('#dialog [data-close]').click();await page.locator('#dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await press('z');assert.equal(calls.filter(c=>c.route==='mail-undo').length,0,'mail-only binding');
    await page.getByRole('button',{name:'Mail',exact:true}).click();await press('z');await page.locator('#notice').filter({hasText:'1 message restored.'}).waitFor();
    console.log('PASS mail undo: pending batch, repeat guard, partial failure/retry, local context menu, toolbar, navigation, remapping, typing/modifiers/dialog and mail-only guards.');
  }finally{
    if(held)held=null;
    await page.unroute(routes);await page.goto(url);await page.reload();
  }
}
