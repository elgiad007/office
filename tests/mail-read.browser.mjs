import assert from 'node:assert/strict';
import {openMailMore} from './mail-reader-ui.mjs';

export async function testMailRead(page,url) {
  await page.goto('about:blank');
  const mail=(id,extra={})=>({id,kind:'mail',title:'Read fixture '+id,body:'Body '+id,revision:1,meta:{folder:'Inbox',from:'sender@example.com',date:'2026-10-29T12:00:00Z',read:false,...extra}});
  let records=[mail('a',{remote:true,account:'imap'}),mail('b',{remote:true,account:'google',hasHtml:true}),mail('c'),mail('d'),mail('draft',{folder:'Drafts'}),mail('recovery',{remote:true,account:'imap',folder:'Recovery copies'})];
  const calls=[],held=new Map();let reject=null,frameRequests=0;
  const frameRoute=t=>t.pathname.endsWith('/mail-view.php');
  await page.route(frameRoute,async route=>{frameRequests++;await route.fulfill({contentType:'text/html',body:'<body style="height:6000px">Read fixture HTML</body>'});});
  const hold=id=>{let release;const promise=new Promise(resolve=>release=resolve);held.set(id,{promise,release});};
  const release=id=>{held.get(id)?.release();held.delete(id);};
  const routes=target=>target.pathname.endsWith('/api.php') && target.searchParams.get('r')!=='activity';
  const activeRoutes=new Set();
  await page.route(routes,async route=>{
    const handled=(async()=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[]};
    else if(action==='google-settings')json={configured:false};
    else if(action==='records')json={records};
    else if(['save','mail-action'].includes(action)){
      const input=route.request().postDataJSON();calls.push({route:action,...input});
      if(['read','unread'].includes(input.action)&&held.has(input.id))await held.get(input.id).promise;
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
    })();
    activeRoutes.add(handled);try{await handled;}finally{activeRoutes.delete(handled);}
  });
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  const button=name=>page.getByRole('button',{name,exact:true,includeHidden:true});
  const readCalls=id=>calls.filter(c=>c.id===id&&(c.action==='read'||c.route==='save'));
  try {
    hold('a');hold('b');await page.goto(url+'?read-test#mail');await selected('a');
    await item('a').evaluate(el=>window.mailNavigationProbe=el);
    // Navigation must not wait for the IMAP read request.
    await item('a').focus();await page.keyboard.press('j');await selected('b');
    const frame=page.locator('#detail iframe');await frame.waitFor();
    await page.frames().find(frame=>frame.url().includes('mail-view.php')).evaluate(()=>scrollTo(0,850));
    await frame.evaluate(node=>{window.readFrame=node;window.readWindow=node.contentWindow;node.focus();});
    const assertFrame=async()=>{
      assert.equal(await frame.evaluate(node=>node===window.readFrame&&node.contentWindow===window.readWindow),true,'Read updates preserve iframe and browsing context');
      assert.equal(await page.frames().find(frame=>frame.url().includes('mail-view.php')).evaluate(()=>scrollY),850,'Read updates preserve HTML scroll');
      assert.equal(frameRequests,1,'Read updates do not reload HTML');
    };
    release('b');await button('Mark unread').waitFor({state:'attached'});await assertFrame();
    assert.equal(await frame.evaluate(node=>document.activeElement===node),true,'Automatic read preserves HTML focus');
    await item('b').focus();assert.equal(records.find(r=>r.id==='b').meta.read,true);
    release('a');await item('a').filter({has:page.locator('.mail-read-status',{hasText:'Read'})}).waitFor();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b','Late response does not steal selection');
    assert.equal(await item('b').evaluate(el=>el===document.activeElement),true,'Late response preserves keyboard focus');
    assert.equal(await item('a').evaluate(el=>el===window.mailNavigationProbe),true,'Navigation and read responses preserve existing list rows');
    assert.equal(readCalls('a').length,1);assert.equal(readCalls('b').length,1);

    await openMailMore(page);await button('Mark unread').click();await button('Mark read').waitFor({state:'attached'});await openMailMore(page);
    assert.equal(records.find(r=>r.id==='b').meta.read,false,'Explicit unread survives metadata update');await assertFrame();
    await frame.evaluate(node=>node.focus());await frame.dispatchEvent('contextmenu',{clientX:500,clientY:300});
    await page.locator('[data-menu-action=read]').focus();await page.keyboard.press('Enter');await button('Mark unread').waitFor({state:'attached'});await assertFrame();
    await frame.evaluate(node=>node.focus());await frame.dispatchEvent('contextmenu',{clientX:500,clientY:300});
    await page.locator('[data-menu-action=unread]').focus();await page.keyboard.press('Enter');await button('Mark read').waitFor({state:'attached'});await assertFrame();
    await button('Text only').click();assert.equal(readCalls('b').length,2,'Reader rerender does not mark it read again');
    await item('c').click();await openMailMore(page);await button('Mark unread').waitFor();
    assert.equal(records.find(r=>r.id==='c').meta.read,true,'Imported/local mail is saved as read');
    await item('b').click();await openMailMore(page);await button('Mark unread').waitFor();assert.equal(readCalls('b').length,3,'Reopening marks it read');
    await button('Mark unread').click();await button('Mark read').waitFor({state:'attached'});await openMailMore(page);
    await button('Settings').click();await button('Mail').click();await item('b').click();await openMailMore(page);await button('Mark unread').waitFor();
    assert.equal(records.find(r=>r.id==='b').meta.read,true,'Leaving Mail resets the viewing session');

    reject='d';await item('d').click();await page.locator('#notice').filter({hasText:'Could not mark message as read: Read update unavailable'}).waitFor();
    assert.equal(records.find(r=>r.id==='d').meta.read,false);assert.ok((await item('d').getAttribute('class')).includes('mail-unread'));
    reject=null;await item('c').click();await item('d').click();await openMailMore(page);await button('Mark unread').waitFor();
    assert.equal(records.find(r=>r.id==='d').meta.read,true,'Reopening retries a failed update');

    await item('b').click();await openMailMore(page);await button('Mark unread').waitFor();
    hold('b');const manualRequest=page.waitForRequest(request=>request.url().includes('r=mail-action')&&request.postDataJSON()?.id==='b'&&request.postDataJSON()?.action==='unread');await button('Mark unread').click();
    await manualRequest;
    await item('c').click();await item('c').focus();release('b');
    await item('b').filter({has:page.locator('.mail-read-status',{hasText:'Unread'})}).waitFor();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'c','Delayed manual read response preserves newer selection');
    assert.equal(await item('c').evaluate(node=>node===document.activeElement),true,'Delayed manual read response preserves newer focus');

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
    await page.reload();await selected('b');await openMailMore(page);await button('Mark unread').waitFor();
    assert.equal(readCalls('c').length,1,'Read status survives reload without redundant saves');
    console.log('PASS automatic mail read: IMAP/Gmail action routing, local persistence, keyboard/mouse navigation, delayed responses, focus, explicit unread, reopen, failures, exclusions and pending-read archive revision.');
  } finally {for(const id of held.keys())release(id);await Promise.allSettled(activeRoutes);await page.unroute(routes);await page.unroute(frameRoute);await page.reload();await page.locator('.shell').waitFor();}
}
