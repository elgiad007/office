import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

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
    else if(action==='mail-export')return route.fulfill({json:{records:[]},headers:{'X-Office-Mail-Count':'0','X-Office-Mail-Header-Only':'0'}});
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
    const toolbar=page.locator('#mail-toolbar');
    const compose=toolbar.getByRole('button',{name:'Compose',exact:true});
    const importButton=toolbar.getByRole('button',{name:'Import',exact:true});
    const exportMenu=toolbar.locator('summary[aria-label="Mail export options"]');
    assert.equal(await exportMenu.isVisible(),true);
    assert.equal(await page.locator('#list-count').textContent(),'0 cached messages');
    assert.match(await page.locator('#list-count').getAttribute('title'),/older mail/);
    releaseFirst();await page.locator('#sync-status').filter({hasText:'batch 2 · downloading older mail'}).waitFor();
    assert.deepEqual(await bounds(),initialBounds,'Refreshing Mail and changing sync progress must keep pane positions steady');
    assert.equal(await page.locator('#sync-button').isDisabled(),true);
    releaseSecond();await page.locator('#sync-status').filter({hasText:'Older mail remains · continues on next check'}).waitFor();
    assert.equal(calls,2,'IMAP continues older history without reconnecting for every header window');
    assert.deepEqual(batchCounts,[1,4],'one check retains the five-batch allowance');assert.equal(await page.locator('#sync-button').isEnabled(),true);
    assert.deepEqual(await bounds(),initialBounds,'Completing sync must keep pane positions steady');
    await compose.hover();
    assert.equal(await compose.getByText('Compose',{exact:true}).isVisible(),true);
    await page.mouse.move(0,0);
    await compose.focus();
    await page.keyboard.press('Tab');
    assert.equal(await importButton.getByText('Import',{exact:true}).isVisible(),true);
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),importButton.click()]);
    await chooser.setFiles([]);
    await exportMenu.click();
    await toolbar.getByRole('button',{name:'Export cached mail',exact:true}).click();
    await page.getByText('There is nothing to export yet.',{exact:true}).waitFor();
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
  await testMailExport(page,url);
}

async function testMailExport(page,url){
  const raw='Subject: Available message\r\n\r\nOriginal body';
  const available={id:'available',kind:'mail',title:'Available message',body:'Original body',revision:1,meta:{folder:'Inbox',read:true,raw}};
  const missing={id:'missing',kind:'mail',title:'Missing message',body:'',revision:1,meta:{folder:'Archive',headerOnly:true,remote:true,account:'export-fixture',read:true}};
  const recovered={...missing,body:'Recovered body',meta:{...missing.meta,headerOnly:false}};
  const recovery={...missing,id:'recovery',meta:{...missing.meta,folder:'Recovery copies'}};
  const folderError='This message is no longer in its synchronized folder.';
  let records=[available,missing,recovery],batchMode='hydrate';
  let batchCalls=0,planCalls=0,archiveCalls=0;
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const url=new URL(route.request().url());
    const action=url.searchParams.get('r');
    if(action==='mail-export-plan'){
      planCalls++;
      return route.fulfill({json:{batches:[{account:'export-fixture',ids:[missing.id]}]}});
    }
    if(action==='mail-export-batch'){
      batchCalls++;
      assert.deepEqual(route.request().postDataJSON(),{account:'export-fixture',ids:[missing.id]});
      if(batchMode==='stall')return;
      if(batchMode==='hydrate'){
        records=records.map(row=>row.id===missing.id?recovered:row);
        return route.fulfill({json:{warning:null}});
      }
      return route.fulfill({json:{warning:folderError}});
    }
    if(action==='mail-export'){
      archiveCalls++;
      const included=url.searchParams.get('complete')==='1'?records.filter(row=>!row.meta.headerOnly):records;
      return route.fulfill({
        json:{format:'portable-office-items',version:1,records:included},
        headers:{'X-Office-Mail-Count':String(included.length),'X-Office-Mail-Header-Only':String(records.filter(row=>row.meta.headerOnly).length)}
      });
    }
    const responses={
      status:{authenticated:true,csrf:'fixture',activity:false,preferences:{}},
      accounts:{accounts:[]},connections:{connections:[]},records:{records},activity:{entries:[]}
    };
    if(!responses[action])throw Error('Unexpected export fixture route '+action);
    await route.fulfill({json:responses[action]});
  });
  const menu=page.locator('#mail-export-menu');
  const status=page.locator('#mail-export-status');
  const cancel=page.getByRole('button',{name:'Cancel export',exact:true});
  const choose=async name=>{
    await menu.locator('summary').click();
    await menu.getByRole('button',{name,exact:true}).click();
  };
  const cached=()=>choose('Export cached mail');
  const complete=()=>choose('Export with missing bodies');
  const readArchive=async downloading=>JSON.parse(await readFile(await (await downloading).path(),'utf8')).records;
  const isBatch=request=>new URL(request.url()).searchParams.get('r')==='mail-export-batch';
  try{
    await page.goto(url+'?mail-export#mail');
    await page.locator('#items [data-id="available"]').waitFor();
    const [cachedDownload]=await Promise.all([page.waitForEvent('download'),cached()]);
    assert.equal(cachedDownload.suggestedFilename(),'mail-cached.json');
    assert.deepEqual(await readArchive(cachedDownload),records);
    assert.deepEqual([archiveCalls,planCalls,batchCalls],[1,0,0],'Cached export uses one request and no provider work');
    await status.getByText('Download started · mail-cached.json · 2 header-only',{exact:true}).waitFor();

    const [completeDownload]=await Promise.all([page.waitForEvent('download'),complete()]);
    assert.equal(completeDownload.suggestedFilename(),'mail.json');
    assert.deepEqual(await readArchive(completeDownload),[available,recovered]);
    assert.deepEqual([archiveCalls,planCalls,batchCalls],[2,1,1]);
    await status.getByText('Download started · mail.json · 1 skipped',{exact:true}).waitFor();

    await page.locator('#items [data-id="available"]').click();
    const more=page.locator('#detail [data-mail-disclosure="more"]');
    await more.locator('summary').click();
    const [message]=await Promise.all([page.waitForEvent('download'),more.getByRole('button',{name:'Export',exact:true}).click()]);
    assert.equal(message.suggestedFilename(),'Available message.eml');
    assert.equal(await readFile(await message.path(),'utf8'),raw);

    records=[missing];
    batchMode='fail';
    await complete();
    await status.getByText('Mail export failed',{exact:true}).waitFor();
    assert.equal(await page.locator('#notice').textContent(),'Mail export failed: '+folderError);

    records=[available,missing];
    batchMode='stall';
    await Promise.all([page.waitForRequest(isBatch),complete()]);
    await status.getByText('Fetching missing bodies · 0 of 1 checked',{exact:true}).waitFor();
    const archivesBeforeCancel=archiveCalls;
    await Promise.all([page.waitForEvent('requestfailed',isBatch),cancel.click()]);
    await status.getByText('Mail export canceled',{exact:true}).waitFor();
    assert.equal(await cancel.isVisible(),false);
    assert.equal(archiveCalls,archivesBeforeCancel);

    const restoreTimeout=await page.evaluateHandle(()=>{
      const original=AbortSignal.timeout;
      AbortSignal.timeout=milliseconds=>original(Math.min(milliseconds,300));
      return ()=>{AbortSignal.timeout=original;};
    });
    try{
      const downloading=page.waitForEvent('download');
      await Promise.all([page.waitForEvent('requestfailed',isBatch),complete()]);
      assert.deepEqual(await readArchive(downloading),[available]);
      await status.getByText('Download started · mail.json · 1 skipped',{exact:true}).waitFor();
      assert.match(await page.locator('#notice').textContent(),/A message batch timed out/);
      assert.equal(await cancel.isVisible(),false);
    }finally{
      await restoreTimeout.evaluate(restore=>restore());
      await restoreTimeout.dispose();
    }
    console.log('PASS cached and full mail export, partial results, EML, cancellation and timeout.');
  }finally{await page.unroute(routes);}
}
