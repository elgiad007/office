import assert from 'node:assert/strict';

export async function testItemMenus(page,url) {
  const status=await(await page.request.get(url+'api.php?r=status')).json();
  const menu=page.getByRole('menu',{name:'Item actions'});
  const item=title=>page.locator('#items .item').filter({hasText:title});
  const action=name=>menu.getByRole('menuitem',{name,exact:true});
  const records=async kind=>(await(await page.request.get(url+'api.php?r=records&kind='+kind)).json()).records;
  const importItems=async records=>assert.equal((await page.request.post(url+'api.php?r=import-items',{headers:{'X-CSRF-Token':status.csrf},data:{records}})).status(),200);
  for(const [kind,name] of Object.entries({mail:'Mail',calendar:'Calendar',tasks:'Tasks',contacts:'Contacts',documents:'Documents',wiki:'Wiki',sheets:'Sheets'})){
    await importItems([{kind,title:'Menu '+kind,body:'Menu content',meta:kind==='sheets'?{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}:kind==='mail'?{folder:'Inbox',from:'sender@example.com'}:{}}]);
    await page.getByRole('button',{name,exact:true}).click();
    if(kind==='mail')await page.locator('#mail-folder').selectOption('all');
    await item('Menu '+kind).click({button:'right'});
    await menu.waitFor();
    assert.equal(await action('Export').count(),1);
    assert.equal(await action('Delete…').count(),1);
    await page.keyboard.press('End');assert.equal(await page.locator(':focus').textContent(),'Delete…');
    await page.keyboard.press('Home');assert.equal(await page.locator(':focus').textContent(),'Open');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
    assert.equal(await item('Menu '+kind).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Shift+F10');await menu.waitFor();
    await action('Open').click();await menu.waitFor({state:'detached'});
    assert.ok((await page.locator('#detail').textContent()).includes('Menu '+kind));
  }
  await importItems([1,2,3].map(n=>({kind:'tasks',title:'Menu task '+n,body:'',meta:{}})));
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.locator('#search').fill('Menu task ');
  const ordered=await page.locator('#items .item strong').allTextContents();
  await item(ordered[0]).click();await item(ordered[1]).click({modifiers:['Control']});
  assert.equal(await page.locator('.multi-selected').count(),2);
  await item(ordered[0]).click({button:'right'});await menu.waitFor();
  assert.equal(await action('Edit').count(),0);
  assert.equal(await menu.locator('.context-selection').textContent(),'2 selected');
  await action('Mark complete').click();
  await page.locator('#notice').filter({hasText:'2 items updated.'}).waitFor();
  assert.equal((await records('tasks')).filter(r=>ordered.slice(0,2).includes(r.title)&&r.meta.done).length,2);
  await item(ordered[0]).click();await item(ordered[2]).click({modifiers:['Shift']});
  assert.equal(await page.locator('.multi-selected').count(),3);
  await item(ordered[0]).click({button:'right'});await menu.waitFor();
  const download=page.waitForEvent('download');await action('Export selected').click();
  const exported=await download;
  const stream=await exported.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);
  assert.equal(JSON.parse(Buffer.concat(chunks).toString()).records.length,3);
  await item(ordered[0]).click({button:'right'});await menu.waitFor();
  await action('Delete 3 items…').click();await page.locator('#cancel').click();
  assert.equal(await page.locator('#items .item').count(),3);
  await item(ordered[2]).click();await item(ordered[2]).click({button:'right'});await menu.waitFor();
  await action('Delete…').click();await page.locator('#confirm').click();
  await item(ordered[2]).waitFor({state:'detached'});
  // A right click outside the previous selection must replace its targets.
  await item(ordered[0]).click({button:'right'});await menu.waitFor();await page.keyboard.press('Escape');
  await item(ordered[1]).click({button:'right'});await menu.waitFor();
  assert.equal(await menu.locator('.context-selection').textContent(),'1 selected');
  await action('Mark incomplete').click();await page.locator('#notice').filter({hasText:'1 item updated.'}).waitFor();
  assert.equal((await records('tasks')).find(r=>r.title===ordered[1]).meta.done,false);
  await item(ordered[0]).click();await item(ordered[1]).click({modifiers:['Control']});
  await item(ordered[0]).click({button:'right'});await menu.waitFor();await action('Delete 2 items…').click();await page.locator('#confirm').click();
  await item(ordered[0]).waitFor({state:'detached'});await item(ordered[1]).waitFor({state:'detached'});
  assert.equal((await records('tasks')).filter(r=>ordered.includes(r.title)).length,0);
  await page.locator('#search').fill('');
  await item('Menu tasks').click({button:'right'});await menu.waitFor();
  await page.locator('#search').click();await menu.waitFor({state:'detached'});
  const native=await page.locator('#search').evaluate(el=>{const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(ev);return !ev.defaultPrevented;});
  assert.equal(native,true);
  await page.locator('#search').fill('');
  await page.getByRole('button',{name:'Documents',exact:true}).click();
  await item('Menu documents').click({button:'right'});await menu.waitFor();
  await action('Revision history').click();await page.getByRole('heading',{name:'Revision history',exact:true}).waitFor();await page.keyboard.press('Escape');
  await item('Menu documents').click({button:'right'});await menu.waitFor();await action('Edit').click();
  assert.equal(await page.locator('#rich-editor').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('#rich-editor').evaluate(el=>{const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el.dispatchEvent(ev);return !ev.defaultPrevented;}),true);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Mail',exact:true}).click();await page.locator('#mail-folder').selectOption('all');
  await item('Menu mail').click({button:'right'});await menu.waitFor();await action('Mark as read').click();
  await page.locator('#notice').filter({hasText:'1 item updated.'}).waitFor();
  assert.equal((await records('mail')).find(r=>r.title==='Menu mail').meta.read,true);
  await item('Menu mail').click({button:'right'});await menu.waitFor();await action('Reply').click();
  await page.locator('.title-input').waitFor();
  assert.equal(await page.locator('.title-input').inputValue(),'Re: Menu mail');
  await page.keyboard.press('Escape');
  // Provider fixtures are intercepted: these checks never contact a mail server.
  const remote=[
    {id:'remote-menu-1',kind:'mail',revision:1,title:'Menu remote',body:'',meta:{read:true,remote:true,account:'test',folder:'Inbox',from:'sender@example.com'}},
    {id:'remote-menu-2',kind:'mail',revision:1,title:'Menu recovery',body:'',meta:{read:true,remote:true,account:'test',folder:'Recovery copies'}},
    {id:'remote-menu-3',kind:'mail',revision:1,title:'Menu trash',body:'',meta:{read:true,remote:true,account:'test',folder:'Trash'}},
  ];
  const calls=[];
  const route='**/api.php?r=*';
  const handler=async route=>{
    const request=route.request(),r=new URL(request.url()).searchParams.get('r');
    if(r==='records'&&new URL(request.url()).searchParams.get('kind')==='mail')return route.fulfill({json:{records:remote}});
    if(r==='mail-action'){
      const body=request.postDataJSON();calls.push(body);
      if(body.action==='trash')remote.find(row=>row.id===body.id).meta.folder='Trash';
      return route.fulfill(calls.length===2?{status:409,json:{error:'Simulated stale message'}}:{json:{record:remote[0]}});
    }
    return route.continue();
  };
  await page.route(route,handler);
  try{
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Mail',exact:true}).click();
    await item('Menu remote').click({button:'right'});await menu.waitFor();
    assert.equal(await action('Delete…').count(),0);assert.equal(await action('Edit').count(),0);assert.equal(await action('Move / Labels…').count(),1);
    await action('Move to Trash').click();await page.locator('#notice').filter({hasText:'1 item updated.'}).waitFor();
    assert.equal(calls[0].action,'trash');
    await page.locator('#mail-folder').selectOption('Recovery copies');
    await item('Menu recovery').click({button:'right'});await menu.waitFor();
    assert.equal(await action('Move to Trash').count(),0);assert.equal(await action('Save locally').count(),1);
    await action('Discard copy…').click();await page.locator('#cancel').click();assert.equal(calls.length,1);
    await page.locator('#mail-folder').selectOption('Trash');
    await item('Menu trash').click({button:'right'});await menu.waitFor();assert.equal(await action('Restore to Inbox').count(),1);await page.keyboard.press('Escape');
    await page.locator('#mail-folder').selectOption('all');
    // Add another live fixture, then force the second item to fail.
    remote[0].meta.folder='Inbox';
    remote.push({...remote[0],id:'remote-menu-4',title:'Menu remote second'});
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Mail',exact:true}).click();
    await item('Menu remote second').click();await item('Menu remote').filter({hasNotText:'second'}).click({modifiers:['Control']});
    await item('Menu remote second').click({button:'right'});await menu.waitFor();
    calls.length=0;await action('Mark as read').click();
    await page.locator('#notice').filter({hasText:'1 of 2 items updated. Simulated stale message'}).waitFor();
    assert.equal(calls.length,2);
  }finally{await page.unroute(route,handler);}
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await item('Menu tasks').click({button:'right'});await menu.waitFor();
  await page.screenshot({path:'test-results/item-menus.png',fullPage:true});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await item('Menu tasks').click({button:'right'});await menu.waitFor();await page.keyboard.press('Escape');
  await item('Menu tasks').evaluate(el=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:389,clientY:843})));await menu.waitFor();
  const bounds=await menu.boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844,JSON.stringify(bounds));
  await page.screenshot({path:'test-results/item-menus-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});
  console.log('PASS item menus: seven apps, mouse and keyboard selection, bulk completion/export, targeting, delete confirmation, native editing menus, mail actions and partial failure.');
}
