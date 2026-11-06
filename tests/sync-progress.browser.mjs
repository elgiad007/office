import assert from 'node:assert/strict';

export async function testSyncProgress(page,url){
  let calls=0,releaseFirst,releaseSecond;const batchCounts=[];
  const first=new Promise(resolve=>releaseFirst=resolve),second=new Promise(resolve=>releaseSecond=resolve);
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences:{}};
    else if(action==='connections')json={connections:[]};
    else if(action==='accounts')json={accounts:[{id:'sync-fixture',label:'Progress fixture',type:'imap'}]};
    else if(action==='records')json={records:[]};
    else if(action==='activity')json={entries:[]};
    else if(action==='sync'){
      calls++;batchCounts.push(route.request().postDataJSON().batches);if(calls===1)await first;if(calls===2)await second;json={count:100,more:true};
    }else throw Error('Unexpected sync progress route '+action);
    await route.fulfill({json});
  });
  try{
    await page.goto(url+'?sync-progress#mail');
    await page.locator('#sync-status').filter({hasText:'batch 1'}).waitFor();
    const bounds=()=>page.evaluate(()=>['.topbar','#main','#mail-toolbar','.work-grid','#items','#detail'].map(selector=>{
      const node=document.querySelector(selector),rect=node.getBoundingClientRect();
      return {selector,top:rect.top,height:rect.height};
    }));
    const initialBounds=await bounds();
    assert.equal(await page.locator('#main > .view-head').count(),0,'Mail uses the topbar instead of a title panel');
    assert.equal(await page.locator('.topbar h1').textContent(),'Mail');
    assert.equal(await page.locator('#mail-toolbar [data-action="new"]').textContent(),'+ Compose');
    assert.equal(await page.locator('#list-count').textContent(),'0 cached messages');
    assert.match(await page.locator('#list-count').getAttribute('title'),/older mail/);
    releaseFirst();await page.locator('#sync-status').filter({hasText:'batch 2 · downloading older mail'}).waitFor();
    assert.deepEqual(await bounds(),initialBounds,'Refreshing Mail and changing sync progress must keep pane positions steady');
    assert.equal(await page.locator('#sync-button').isDisabled(),true);
    releaseSecond();await page.locator('#sync-status').filter({hasText:'Older mail remains · continues on next check'}).waitFor();
    assert.equal(calls,2,'IMAP continues older history without reconnecting for every header window');
    assert.deepEqual(batchCounts,[1,4],'one check retains the five-batch allowance');assert.equal(await page.locator('#sync-button').isEnabled(),true);
    assert.deepEqual(await bounds(),initialBounds,'Completing sync must keep pane positions steady');
    await page.locator('#mail-actions-menu summary').click();
    assert.equal(await page.locator('#mail-actions-menu [data-action="import"]').isVisible(),true);
    assert.equal(await page.locator('#mail-actions-menu [data-action="export-all"]').isVisible(),true);
    await page.locator('#mail-actions-menu summary').click();
    await page.locator('[data-app="wiki"]').click();
    assert.equal(await page.locator('#mail-toolbar').isVisible(),false,'Mail actions are hidden in other apps');
    assert.equal(await page.locator('.topbar h1').textContent(),'Wiki');
    assert.equal(await page.locator('#main > .view-head').count(),0,'Wiki also uses the shared topbar');
    // Isolate the activity controller from the app to test streamed progress ownership.
    await page.route(url+'progress-fixture',route=>route.fulfill({contentType:'text/html',body:'<footer id="activity-status"><div id="notice"></div><button id="view-activity"></button></footer><dialog id="activity-dialog"></dialog>'}));
    await page.goto(url+'progress-fixture');
    const result=await page.evaluate(async()=>{
      const {createActivity}=await import('/activity.js');
      const activity=createActivity({csrf:()=>''});activity.configure(true);
      const id=activity.queued('Fixture: Synchronizing mail…');activity.running(id);
      const entry={id:1,time:new Date().toISOString(),level:'info',account:'Fixture',operation:'Synchronize account',message:'Downloading older mail · Archive · batch message 4 of 100 · 296 messages still to cache.',duration_ms:null,phase:'sync-progress'};
      activity.receive(entry);const progress=document.querySelector('#notice').textContent;
      activity.receive({...entry,id:2,message:'IMAP: finished reading message data.',phase:'progress'});
      const afterTransport=document.querySelector('#notice').textContent;
      activity.done(id);
      return {progress,afterTransport};
    });
    assert.match(result.progress,/Archive · batch message 4 of 100/);assert.equal(result.afterTransport,result.progress,'transport detail cannot replace folder progress');
    await page.locator('#notice').filter({hasText:'Ready.'}).waitFor();
    console.log('PASS sync progress: cached counts, account batches, older-mail continuation, released sync button, persistent folder progress and idle completion.');
  }finally{releaseFirst();releaseSecond();await page.unroute(routes);}
}
