import assert from 'node:assert/strict';

export async function testQuickMove(page,url){
  const accounts=[
    {id:'personal',type:'imap',label:'Personal',folders:[{id:'Travel',name:'Travel',role:'Custom folder'},{id:'Travel/Orders',name:'Travel/Orders',role:'Custom folder',delimiter:'/'}]},
    {id:'work',type:'google',label:'Work',folders:[{id:'INBOX',name:'Inbox',protected:true},{id:'SENT',name:'Sent',protected:true},{id:'travel-label',name:'Travel',protected:false}]},
  ];
  let records=['a','b','c'].map((id,i)=>({id,kind:'mail',title:'Quick move '+id,body:'Body',revision:1,updated:'2026-11-01T12:00:00Z',meta:{remote:true,account:'personal',providerId:id,source:'source-'+id,serverFolder:'INBOX',folder:'Inbox',read:true,from:'sender@example.com',date:`2026-11-0${3-i}T12:00:00Z`}}));
  const calls=[];let reject=false;
  const routes=t=>t.pathname.endsWith('/api.php')&&t.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r'),input=route.request().postDataJSON();let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{keys:{read:'m'}}};
    else if(action==='accounts')json={accounts};
    else if(action==='records')json={records};
    else if(action==='sync')json={count:0};
    else if(action==='google-settings')json={configured:false,redirectUri:'http://localhost/callback'};
    else if(action==='mail-action'){
      calls.push(input);assert.equal(input.action,'move','m never toggles read/unread');
      if(reject){await route.fulfill({status:503,json:{error:'Destination unavailable'}});return;}
      const r=records.find(r=>r.id===input.id);assert.equal(input.revision,r.revision);
      r.revision++;r.meta.account=input.destinationAccount;r.meta.serverFolder=input.folder;r.meta.folder='Custom folder';json={record:r};
    }else if(action==='mail-folders')json={folders:accounts.find(a=>a.id===input.account).folders};
    else throw Error('Unexpected Quick Move API: '+action);
    await route.fulfill({json});
  });
  try{
    await page.goto(url+'?quick-move#mail');await page.locator('#selected-item[data-id="a"]').waitFor();
    await page.locator('#main').focus();await page.keyboard.press('m');
    const input=page.locator('#quick-move-search'),options=page.locator('#quick-move-results [role="option"]');
    await input.waitFor();assert.equal(await input.evaluate(el=>document.activeElement===el),true);
    await input.fill('trav');assert.equal(await options.count(),3,'matches include nested folders and both accounts');
    assert.match(await options.nth(0).textContent(),/TravelPersonal/);assert.match(await options.nth(1).textContent(),/TravelWork/);
    await page.keyboard.press('ArrowDown');assert.equal(await input.getAttribute('aria-activedescendant'),'quick-folder-1');
    await page.keyboard.press('Escape');await input.waitFor({state:'hidden'});assert.equal(calls.length,0,'Escape does not move');
    await page.locator('#main').focus();await page.keyboard.press('m');await input.fill('not-a-folder');assert.equal(await options.count(),0);
    await page.keyboard.press('Enter');assert.equal(calls.length,0,'no match cannot submit');
    await input.fill('trav');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    await input.waitFor({state:'hidden'});assert.equal(calls.length,1);assert.equal(calls[0].destinationAccount,'work');assert.equal(calls[0].folder,'travel-label');
    await page.locator('#selected-item[data-id="b"]').waitFor();
    await page.locator('#main').focus();await page.keyboard.press('v');
    await page.locator('#items [data-id="c"]').click();await page.locator('#main').focus();await page.keyboard.press('v');await page.keyboard.press('m');
    await input.fill('orders');assert.equal(await options.count(),1);
    reject=true;await page.keyboard.press('Enter');await page.locator('#notice').filter({hasText:'Destination unavailable'}).waitFor();
    assert.equal(await input.isVisible(),true,'failure leaves picker available');assert.equal(calls.length,2);
    reject=false;await page.keyboard.press('Enter');await input.waitFor({state:'hidden'});assert.deepEqual(calls.slice(2).map(c=>c.id).sort(),['b','c'],'bulk move retains original selection');
    assert.ok(calls.slice(2).every(c=>c.folder==='Travel/Orders'&&c.destinationAccount==='personal'));
    await page.locator('#mail-folder').selectOption('all');
    await page.locator('#items [data-id="b"]').click();await page.keyboard.press('Tab');await page.keyboard.press('m');
    await input.fill('trav');await page.keyboard.press('Enter');await input.waitFor({state:'hidden'});
    await page.locator('#selected-item[data-id="c"]').waitFor();
    assert.equal(await page.locator('#items [data-id="b"]').count(),1,'All cached retains the moved record');
    assert.equal(await page.locator('#detail').evaluate(node=>node.contains(document.activeElement)),true,'Quick Move advances middle item and retains content focus');
    await page.locator('#main').focus();await page.keyboard.press('?');
    assert.match(await page.locator('#dialog').textContent(),/Quick Move to folder/);assert.doesNotMatch(await page.locator('#dialog').textContent(),/Toggle read \/ unread/);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('[name="key_move"]').inputValue(),'m');assert.equal(await page.locator('[name="key_read"]').count(),0,'legacy read binding is removed');
    console.log('PASS Quick Move: focused search, all accounts, duplicate names, nested folders, keyboard selection, Enter/Escape, no match, failure recovery, bulk selection, legacy preferences and help.');
  }finally{await page.unroute(routes);}
}
