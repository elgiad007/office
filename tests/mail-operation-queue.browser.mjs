import assert from 'node:assert/strict';

export async function testMailOperationQueue(page,url) {
  // Finish the previous page before installing held-request fixtures; otherwise
  // its late boot can start a read in a second, soon-to-be-discarded JS context.
  await page.goto('about:blank');
  const make=(id,read=true)=>({id,kind:'mail',title:'Concurrent '+id,body:'Body '+id,revision:1,meta:{remote:true,account:'race-account',read,folder:'Inbox',source:'imap-folder:INBOX:3:'+id,serverFolder:'INBOX',uidValidity:'3',providerId:id}});
  let records=[],accounts=[],active=0,maxActive=0,readGate=null,syncGate=null,syncStarted=false,conflictMode=null;
  const calls=[];let runNumber=0,mutationVersion=0;
  const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
  const routes=target=>target.pathname.endsWith('/api.php') && target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,csrf:'fixture',preferences:{}}});
    if(action==='accounts')return route.fulfill({json:{accounts}});
    if(action==='records')return route.fulfill({json:{records}});
    if(action==='google-settings')return route.fulfill({json:{configured:false}});
    assert.ok(['sync','mail-action'].includes(action),'Unexpected fixture route '+action);
    const input=route.request().postDataJSON();calls.push({route:action,...input});active++;maxActive=Math.max(maxActive,active);
    let responded=false;
    const respond=payload=>{active--;responded=true;return route.fulfill(payload);};
    try {
      if(action==='sync') {
        const generation=mutationVersion;
        syncStarted=true;if(syncGate)await syncGate.promise;
        if(generation===mutationVersion)records=records.map(r=>({...r,revision:r.revision+1}));
        return await respond({json:{count:0}});
      }
      if(input.action==='read'&&input.id==='1'&&readGate)await readGate.promise;
      let record=records.find(r=>r.id===input.id);assert.ok(record,'Record exists for '+input.id);
      if(input.action==='trash'&&conflictMode) {
        record={...record,revision:record.revision+1,meta:{...record.meta}};
        if(conflictMode==='moved')record.meta.source='imap-folder:INBOX:4:'+input.id;
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
  const reset=async({unread=false,sync=false,mode=null}={})=>{
    await page.waitForFunction(()=>!document.querySelector('#dialog[open]'));
    for(let i=0;active&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(active,0);calls.length=0;maxActive=0;syncStarted=false;conflictMode=mode;mutationVersion=0;
    records=['1','2','3'].map(id=>make(id,!unread));accounts=sync?[{id:'race-account',label:'Race account',type:'imap'}]:[];
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

    // A moved source is refreshed and restored, without retrying the user's old target.
    await reset({mode:'moved'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Message changed. Reopen it.');
    assert.equal(calls.filter(c=>c.action==='trash').length,1);await item('1').click();
    conflictMode=null;await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Moved to Trash.');
    assert.equal(records.find(r=>r.id==='1').meta.folder,'Trash','An intentional second attempt uses the refreshed revision');

    await reset({mode:'again'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Message changed. Reopen it.');
    assert.equal(calls.filter(c=>c.action==='trash').length,2,'A second conflict stops the retry');
    await reset({mode:'uncertain'});await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await notice('Move could not be confirmed.');
    assert.equal(calls.filter(c=>c.action==='trash').length,1,'Uncertain provider writes are never retried');
    console.log('PASS mail operation queue: rapid unread deletion, interactive actions during held sync, safe single retry, refreshed rollback, changed-source protection and no uncertain-write retry.');
  } finally {
    readGate?.release();syncGate?.release();await page.unroute(routes);await page.reload();
  }
}
