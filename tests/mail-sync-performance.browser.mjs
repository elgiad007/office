import assert from 'node:assert/strict';

export async function testSyncScheduling(page,url){
  const accounts=['a','b','c'].map(id=>({id,type:'imap',label:'Account '+id.toUpperCase()}));
  let recordCalls=0,contentReads=0;
  const record=()=>({id:'early',kind:'mail',title:'Early Inbox arrival',body:contentReads?'Fixture body':'',revision:1,meta:{account:'a',remote:true,folder:'Inbox',from:'sender@example.com',date:new Date().toISOString(),read:true,headerOnly:contentReads===0,hasAttachments:false}});
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.addInitScript(()=>{
    if(!location.search.includes('sync-scheduling'))return;
    const original=window.fetch;
    const fixture=window.syncFixture={calls:[],batchCounts:[],active:new Set(),finish:{},overlap:false};
    window.fetch=async(input,options)=>{
      if(new URL(input,location.href).searchParams.get('r')!=='sync')return original(input,options);
      const {id,batches}=JSON.parse(options.body);fixture.batchCounts.push(batches);
      if(fixture.active.has(id)||fixture.active.size>=2)fixture.overlap=true;
      fixture.active.add(id);fixture.calls.push(id);
      if(fixture.calls.length===1){
        return new Response(new ReadableStream({start(controller){
          const encode=event=>new TextEncoder().encode(JSON.stringify(event)+'\n');
          fixture.finish[id]=()=>{fixture.active.delete(id);controller.enqueue(encode({type:'result',status:200,body:{count:1,more:true}}));controller.close();};
          controller.enqueue(encode({type:'activity',entry:{id:1,time:new Date().toISOString(),level:'info',account:'Account A',operation:'Synchronize account',message:'Inbox ready · 1 new messages cached.',duration_ms:null,run:'early-inbox',phase:'mail-cache-ready'}}));
        }}),{headers:{'Content-Type':'application/x-ndjson'}});
      }
      return new Promise(resolve=>{fixture.finish[id]=()=>{fixture.active.delete(id);resolve(new Response(JSON.stringify({count:0,more:false}),{headers:{'Content-Type':'application/json'}}));};});
    };
  });
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences:{}};
    else if(action==='connections')json={connections:[]};
    else if(action==='accounts')json={accounts};
    else if(action==='activity')json={entries:[]};
    else if(action==='records')json={records:++recordCalls>1?[record()]:[]};
    else if(action==='mail-content'){contentReads++;json={record:record()};}
    else throw Error('Unexpected scheduling route '+action);
    await route.fulfill({json});
  });
  try{
    await page.goto(url+'?sync-scheduling#mail');
    await page.locator('#items').getByText('Early Inbox arrival',{exact:true}).waitFor();
    assert.equal(await page.locator('#sync-button').isDisabled(),true,'Inbox arrivals display before the streamed sync completes');
    assert.deepEqual(await page.evaluate(()=>window.syncFixture.calls),['a','b']);
    assert.equal(contentReads,0,'early refresh does not select a new message and start a provider read');
    await page.evaluate(()=>window.syncFixture.finish.a());
    await page.waitForFunction(()=>window.syncFixture.calls.includes('c'));
    assert.deepEqual(await page.evaluate(()=>window.syncFixture.calls),['a','b','c'],'third account gets its first check before older history in the first account');
    await page.evaluate(()=>window.syncFixture.finish.c());
    await page.waitForFunction(()=>window.syncFixture.calls.length===4);
    assert.deepEqual(await page.evaluate(()=>window.syncFixture.calls),['a','b','c','a']);
    assert.deepEqual(await page.evaluate(()=>window.syncFixture.batchCounts),[1,1,1,4],'only the IMAP continuation combines four header windows');
    await page.evaluate(()=>{window.syncFixture.finish.a();window.syncFixture.finish.b();});
    await page.locator('#sync-button:enabled').waitFor();
    assert.equal(await page.evaluate(()=>window.syncFixture.overlap),false,'two workers never overlap batches from the same account');
    console.log('PASS early streamed Inbox refresh and fair account scheduling.');
  }finally{await page.unroute(routes);}
}

export async function testOfflineSyncWindows(page,url){
  const batches=[],routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences:{mailOffline:true}};
    else if(action==='connections')json={connections:[]};
    else if(action==='accounts')json={accounts:[{id:'offline',type:'imap',label:'Offline fixture'}]};
    else if(action==='records')json={records:[]};
    else if(action==='activity')json={entries:[]};
    else if(action==='sync'){batches.push(route.request().postDataJSON().batches);json={count:100,more:true};}
    else throw Error('Unexpected offline sync route '+action);
    await route.fulfill({json});
  });
  try{
    await page.goto(url+'?offline-sync#mail');
    await page.locator('#sync-status').filter({hasText:'Older mail remains · continues on next check'}).waitFor();
    assert.deepEqual(batches,[1,1,1,1,1],'offline body downloads retain five small requests');
    console.log('PASS offline downloads retain bounded body windows.');
  }finally{await page.unroute(routes);}
}
