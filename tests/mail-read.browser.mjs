import assert from 'node:assert/strict';

export async function testMailRead(page,url) {
  const mail=(id,extra={})=>({id,kind:'mail',title:'Read fixture '+id,body:'Body '+id,revision:1,meta:{folder:'Inbox',from:'sender@example.com',date:'2026-10-29T12:00:00Z',read:false,...extra}});
  let records=[mail('a',{remote:true,account:'imap'}),mail('b',{remote:true,account:'google'}),mail('c'),mail('d'),mail('draft',{folder:'Drafts'}),mail('recovery',{remote:true,account:'imap',folder:'Recovery copies'})];
  const calls=[],held=new Map();let reject=null;
  const hold=id=>{let release;const promise=new Promise(resolve=>release=resolve);held.set(id,{promise,release});};
  const release=id=>{held.get(id)?.release();held.delete(id);};
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[]};
    else if(action==='google-settings')json={configured:false};
    else if(action==='records')json={records};
    else if(['save','mail-action'].includes(action)){
      const input=route.request().postDataJSON();calls.push({route:action,...input});
      if(input.action==='read'&&held.has(input.id))await held.get(input.id).promise;
      if(input.id===reject){await route.fulfill({status:503,json:{error:'Read update unavailable'}});return;}
      const old=records.find(r=>r.id===input.id);assert.equal(input.revision,old.revision,'Mutations use the latest revision');
      const record=action==='save'?structuredClone(input):structuredClone(old);
      if(action==='mail-action'){
        if(input.action==='archive')record.meta.folder='Archive';
        else record.meta.read=input.action==='read';
      }
      record.revision++;record.updated=new Date().toISOString();
      records=records.map(r=>r.id===record.id?record:r);json={record};
    }else throw Error('Unexpected read fixture API: '+action);
    await route.fulfill({json});
  });
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  const button=name=>page.getByRole('button',{name,exact:true});
  const readCalls=id=>calls.filter(c=>c.id===id&&(c.action==='read'||c.route==='save'));
  try {
    hold('a');await page.goto(url+'?read-test#mail');await selected('a');
    // Navigation must not wait for the IMAP read request.
    await item('a').focus();await page.keyboard.press('j');await selected('b');
    await button('Mark unread').waitFor();assert.equal(records.find(r=>r.id==='b').meta.read,true);
    release('a');await item('a').filter({has:page.locator('.mail-read-status',{hasText:'Read'})}).waitFor();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b','Late response does not steal selection');
    assert.equal(await item('b').evaluate(el=>el===document.activeElement),true,'Late response preserves keyboard focus');
    assert.equal(readCalls('a').length,1);assert.equal(readCalls('b').length,1);

    await button('Mark unread').click();await button('Mark read').waitFor();
    assert.equal(records.find(r=>r.id==='b').meta.read,false,'Explicit unread survives action reload');
    await button('Text only').click();assert.equal(readCalls('b').length,1,'Reader rerender does not mark it read again');
    await item('c').click();await button('Mark unread').waitFor();
    assert.equal(records.find(r=>r.id==='c').meta.read,true,'Imported/local mail is saved as read');
    await item('b').click();await button('Mark unread').waitFor();assert.equal(readCalls('b').length,2,'Reopening marks it read');
    await button('Mark unread').click();await button('Mark read').waitFor();
    await button('Settings').click();await button('Mail').click();await item('b').click();await button('Mark unread').waitFor();
    assert.equal(records.find(r=>r.id==='b').meta.read,true,'Leaving Mail resets the viewing session');

    reject='d';await item('d').click();await page.locator('#notice').filter({hasText:'Could not mark message as read: Read update unavailable'}).waitFor();
    assert.equal(records.find(r=>r.id==='d').meta.read,false);assert.ok((await item('d').getAttribute('class')).includes('mail-unread'));
    reject=null;await item('c').click();await item('d').click();await button('Mark unread').waitFor();
    assert.equal(records.find(r=>r.id==='d').meta.read,true,'Reopening retries a failed update');

    await page.locator('#mail-folder').selectOption('Drafts');await selected('draft');
    assert.equal(records.find(r=>r.id==='draft').revision,1,'Drafts are not marked read');
    await page.locator('#mail-folder').selectOption('Recovery copies');await selected('recovery');
    assert.equal(readCalls('recovery').length,0,'Recovery copies do not trigger provider actions');

    // Archive while a read request is pending: preserve order and the new revision.
    records.find(r=>r.id==='a').meta.read=false;
    hold('a');await page.reload();await selected('a');
    const archived=page.waitForResponse(r=>r.url().includes('r=mail-action')&&r.request().postDataJSON()?.action==='archive');
    await button('Archive').click();release('a');await archived;
    await page.locator('#notice').filter({hasText:'Archived 1 messages.'}).waitFor();
    assert.equal(records.find(r=>r.id==='a').meta.read,true);assert.equal(records.find(r=>r.id==='a').meta.folder,'Archive');
    await page.reload();await selected('b');await button('Mark unread').waitFor();
    assert.equal(readCalls('c').length,1,'Read status survives reload without redundant saves');
    console.log('PASS automatic mail read: IMAP/Gmail action routing, local persistence, keyboard/mouse navigation, delayed responses, focus, explicit unread, reopen, failures, exclusions and pending-read archive revision.');
  } finally {for(const id of held.keys())release(id);await page.unroute(routes);await page.reload();await page.locator('.shell').waitFor();}
}
