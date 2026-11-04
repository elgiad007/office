import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(process.env.OFFICE_NODE_MODULES || new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
const page=await browser.newPage();
const url=process.env.OFFICE_TEST_URL||'http://127.0.0.1:8787/';
const routeApi=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
let recordsRequests=0,releaseAccounts,accountsRequested;
const accountsSeen=new Promise(resolve=>accountsRequested=resolve);
let recordsRequested;
const recordsSeen=new Promise(resolve=>recordsRequested=resolve);
const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
await page.route(routeApi,async route=>{
  const action=new URL(route.request().url()).searchParams.get('r');
  if(action==='status')return route.fulfill({json:{authenticated:true,csrf:'fixture',preferences:{}}});
  if(action==='accounts'){
    accountsRequested();
    await new Promise(resolve=>releaseAccounts=resolve);
    return route.fulfill({json:{accounts:[]}});
  }
  if(action==='records'){
    recordsRequests++;recordsRequested();
    return route.fulfill({json:{records:[{id:'startup',kind:'mail',title:'Startup fixture',body:'Searchable body',revision:1,summary:true,meta:{folder:'Inbox',read:true,hasAttachments:false}}]}});
  }
  throw Error('Unexpected startup request '+action);
});
try{
  await page.goto(url+'?startup-overlap#mail');
  await Promise.race([Promise.all([accountsSeen,recordsSeen]),new Promise((_,reject)=>setTimeout(()=>reject(Error('Startup did not request accounts and records concurrently within 5 seconds.')),5000))]);
  assert.equal(await page.locator('.shell').count(),0,'Render waits for account metadata');
  assert.equal(recordsRequests,1,'Records request starts while accounts response is held');
  releaseAccounts();
  await page.locator('#items [data-id="startup"]').waitFor();
  assert.equal(recordsRequests,1,'Startup reuses prefetched records');
  await page.unroute(routeApi);
  await page.route(routeApi,route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,csrf:'fixture',preferences:{}}});
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records')return route.fulfill({status:503,json:{error:'List unavailable'}});
    throw Error('Unexpected failure-path request '+action);
  });
  await page.reload();
  await page.getByRole('heading',{name:'Workspace unavailable'}).waitFor();
  assert.match(await page.locator('.auth .error').textContent(),/List unavailable/);
  assert.deepEqual(pageErrors,[],'Startup failures are caught without page errors');
  console.log('PASS startup overlap: records requested before accounts completes, rendered once, no duplicate list request.');
}finally{releaseAccounts?.();await browser.close();}
