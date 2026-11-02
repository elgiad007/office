import assert from 'node:assert/strict';

export async function testMailOperationQueue(page,url) {
  // Finish the previous page before installing held-request fixtures; otherwise
  // its late boot can start a read in a second, soon-to-be-discarded JS context.
  await page.goto('about:blank');
  const make=(id,read=true)=>({id,kind:'mail',title:'Concurrent '+id,body:'Body '+id,revision:1,meta:{remote:true,account:'race-account',read,folder:'Inbox',source:'imap-folder:INBOX:3:'+id,serverFolder:'INBOX',uidValidity:'3',providerId:id}});
  let records=[],accounts=[],active=0,maxActive=0,readGate=null,bodyGate=null,syncGate=null,syncStarted=false,conflictMode=null;
  const calls=[],diagnostics=[];let runNumber=0,mutationVersion=0,streamed=false;
  const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,activity:true,csrf:'fixture',preferences:{}}});
    if(action==='activity'){
      if(route.request().method()==='POST')diagnostics.push(route.request().postDataJSON().message||'');
      return route.fulfill({json:{entries:[]}});
    }
    if(action==='accounts')return route.fulfill({json:{accounts}});
    if(action==='records')return route.fulfill({json:{records}});
    if(action==='google-settings')return route.fulfill({json:{configured:false}});
    assert.ok(['sync','mail-action','mail-content'].includes(action),'Unexpected fixture route '+action);
    const input=route.request().postDataJSON();calls.push({route:action,...input});active++;maxActive=Math.max(maxActive,active);
    let responded=false;
    const respond=payload=>{active--;responded=true;return route.fulfill(streamed&&action==='mail-action'?{contentType:'application/x-ndjson',body:JSON.stringify({type:'result',status:payload.status||200,body:payload.json})+'\n'}:payload);};
    try {
      if(action==='sync') {
        const generation=mutationVersion;
        syncStarted=true;if(syncGate)await syncGate.promise;
        if(generation===mutationVersion)records=records.map(r=>({...r,revision:r.revision+1}));
        return await respond({json:{count:0}});
      }
      if(input.action==='read'&&input.id==='1'&&readGate)await readGate.promise;
      if(action==='mail-content'&&input.id==='1'&&bodyGate)await bodyGate.promise;
      let record=records.find(r=>r.id===input.id);assert.ok(record,'Record exists for '+input.id);
      const hydrate=r=>({...r,revision:r.revision+1,contentHash:'downloaded-'+r.id,body:'Downloaded body '+r.id,meta:{...r.meta,headerOnly:false}});
      if(action==='mail-content'){
        record=hydrate(record);records=records.map(r=>r.id===record.id?record:r);
        return await respond({json:{record}});
      }
      if(input.action==='trash'&&conflictMode) {
        record={...record,revision:record.revision+1,meta:{...record.meta}};
        if(conflictMode==='moved')record.meta.source='imap-folder:INBOX:4:'+input.id;
        if(conflictMode==='hydrated'){record=hydrate(record);conflictMode=null;}
        if(conflictMode==='content'){record.contentHash='refreshed-cache';conflictMode=null;}
        if(conflictMode==='folder')record.meta.folder='Archive';
        if(conflictMode==='account')record.meta.account='other-account';
        if(conflictMode==='uid')record.meta.providerId='999';
        if(conflictMode==='hydrated-moved'){record=hydrate(record);record.meta.uidValidity='4';}
        records=records.map(r=>r.id===record.id?record:r);
        if(conflictMode==='uncertain')return await respond({status:500,json:{error:'Move could not be confirmed.'}});
      }
      if(input.revision!==record.revision)return await respond({status:409,json:{error:'Message changed. Reopen it.',code:'mail_revision_conflict',record}});
      record={...record,revision:record.revision+1,meta:{...record.meta}};
      if(input.action==='trash')record.meta.folder='Trash';else record.meta.read=input.action==='read';
      records=records.map(r=>r.id===record.id?record:r);
      mutationVersion++;
      return await respond({json:{record}});
    } finally {if(!responded)active--;}
  });
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const notice=text=>page.locator('#notice').filter({hasText:text}).waitFor();
  const reset=async({unread=false,sync=false,mode=null,headers=false,incomplete=false,gmail=false,stream=false}={})=>{
    await page.waitForFunction(()=>!document.querySelector('#dialog[open]'));
    for(let i=0;active&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(active,0);calls.length=0;diagnostics.length=0;maxActive=0;syncStarted=false;conflictMode=mode;mutationVersion=0;streamed=stream;
    records=['1','2','3'].map(id=>make(id,!unread));accounts=sync?[{id:'race-account',label:'Race account',type:'imap'}]:[];
    if(headers)records=records.map(r=>({...r,contentHash:'headers-'+r.id,meta:{...r.meta,headerOnly:true,messageSize:2000000}}));
    if(incomplete)records.forEach(r=>delete r.meta.uidValidity);
    if(gmail)records=records.map(r=>({...r,meta:{...r.meta,source:'gmail:'+r.id,serverFolder:undefined,uidValidity:undefined}}));
    await page.goto(url+'?operation-race='+ ++runNumber+'#mail');await item('1').waitFor();
  };
  try {
    // Opening the next unread message must not compete with two quick deletions.
    readGate=gate();await reset({unread:true});
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();
    await item('2').waitFor();await page.keyboard.press('d');await item('3').waitFor();
    assert.equal(await item('1').count(),0);assert.equal(await item('2').count(),0);
    readGate.release();readGate=null;
    await page.waitForFunction(()=>document.querySelectorAll('#items .item').length===1);
    await notice('Moved to Trash.');
    for(let i=0;records.filter(r=>r.meta.folder==='Trash').length<2&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(records.filter(r=>r.meta.folder==='Trash').length,2);assert.equal(maxActive,1,'One provider operation per account at a time: '+JSON.stringify(calls));

    // Interactive deletes complete while a background scan is still held.
    syncGate=gate();await reset({sync:true});
    for(let i=0;!syncStarted&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(syncStarted,true);
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await item('2').waitFor();await page.keyboard.press('d');
    for(let i=0;records.filter(r=>r.meta.folder==='Trash').length<2&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(records.filter(r=>r.meta.folder==='Trash').length,2,'Deletes do not wait for a held sync');assert.equal(maxActive,2);
    assert.equal(calls.filter(c=>c.action==='trash'&&c.id==='1').length,1);
    assert.equal(calls.filter(c=>c.action==='trash'&&c.id==='2').length,1);
    syncGate.release();syncGate=null;

    // A queued delete captured before a body download uses the downloaded
    // revision, including when its unread successor is deleted immediately.
    await reset({headers:true,unread:true});
    bodyGate=gate();await page.getByRole('button',{name:'Download message body',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-body-status]')?.textContent.includes('Downloading'));
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await item('2').waitFor();await page.keyboard.press('d');await item('3').waitFor();
    bodyGate.release();bodyGate=null;
    for(let i=0;records.filter(r=>r.meta.folder==='Trash').length<2&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(records.filter(r=>r.meta.folder==='Trash').length,2,'Both rapid deletes survive body hydration and read updates');
    assert.equal(calls.filter(c=>c.action==='trash'&&c.id==='1').length,1,'Known hydration rebases before contacting the server');
    assert.equal(calls.find(c=>c.action==='trash'&&c.id==='1').revision,3);
    assert.equal(maxActive,1);

    // A download by another client/sync is discovered through one safe retry.
    await reset({headers:true,mode:'hydrated'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Moved to Trash.');
    assert.equal(calls.filter(c=>c.action==='trash').length,2);
    assert.equal(records.find(r=>r.id==='1').meta.folder,'Trash');

    // A changed local fingerprint is not a changed immutable server message.
    // Include streamed responses, as used by the real PHP activity endpoint.
    for(const scenario of [{mode:'content',stream:true},{mode:'content',gmail:true}]){
      await reset(scenario);await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Moved to Trash.');
      assert.equal(records.find(r=>r.id==='1').meta.folder,'Trash','Cache refresh must not restore deleted mail');
      assert.equal(calls.filter(c=>c.action==='trash').length,2);
      for(let i=0;!diagnostics.some(s=>s.includes('Mail conflict:'))&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
      const diagnostic=diagnostics.find(s=>s.includes('Mail conflict:'));
      assert.match(diagnostic,/requested revision=1; current revision=2; changed fields=contentHash; retrying once/);
      assert.ok(!diagnostic.includes('Body 1')&&!diagnostic.includes('refreshed-cache'),'Diagnostics exclude mail contents and fingerprint values');
      await page.reload();assert.equal(await item('1').count(),0,'Successful delete stays removed after reload');
    }

    for(const scenario of [{incomplete:true,mode:'content'},{headers:true,mode:'hydrated-moved'},{mode:'folder'},{mode:'account'},{mode:'uid'}]){
      await reset(scenario);await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Message changed. Reopen it.');
      assert.equal(calls.filter(c=>c.action==='trash').length,1,'Incomplete or changed identity must not be retried');
      if(scenario.mode!=='folder')await item('1').locator('.mail-action-failure').waitFor();
    }

    // A moved source is refreshed and restored, without retrying the user's old target.
    await reset({mode:'moved'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Message changed. Reopen it.');
    assert.equal(calls.filter(c=>c.action==='trash').length,1);await item('1').click();
    await page.locator('#detail .mail-action-failure').filter({hasText:'message restored'}).waitFor();
    conflictMode=null;await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Moved to Trash.');
    assert.equal(records.find(r=>r.id==='1').meta.folder,'Trash','An intentional second attempt uses the refreshed revision');
    assert.equal(await page.locator('#items .mail-action-failure').count(),0,'A successful new attempt clears the failure marker');

    await reset({mode:'again'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Message changed. Reopen it.');
    assert.equal(calls.filter(c=>c.action==='trash').length,2,'A second conflict stops the retry');
    await reset({mode:'uncertain'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Move could not be confirmed.');
    assert.equal(calls.filter(c=>c.action==='trash').length,1,'Uncertain provider writes are never retried');
    console.log('PASS mail operation queue: rapid unread deletion, body hydration rebasing and retry, held sync, content/identity protection, bounded retry and no uncertain-write retry.');
  } finally {
    readGate?.release();bodyGate?.release();syncGate?.release();await page.unroute(routes);await page.reload();
  }
}
