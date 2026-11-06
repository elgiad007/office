import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';

const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
let preferences={},kind='mail';
const stamp=new Date(Date.now()-125000).toISOString();
const record=()=>({id:'elapsed-fixture',kind,title:'Elapsed fixture',body:'Example content',created:stamp,updated:stamp,revision:1,meta:kind==='mail'?{folder:'Inbox',from:'sender@example.com',to:'reader@example.com',date:stamp,hasHtml:true,hasAttachments:false,read:true}:kind==='tasks'?{due:new Date(Date.now()+2*86400000).toISOString().slice(0,10)}:{}});
const activity={id:1,time:stamp,level:'info',operation:'Fixture',message:'Example log entry',phase:'complete',duration_ms:20};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api.php'){
    const action=url.searchParams.get('r');
    if(action==='preferences'){
      let body='';for await(const chunk of req)body+=chunk;
      preferences=JSON.parse(body).preferences;
    }
    const result={status:{authenticated:true,activity:true,csrf:'fixture',preferences},accounts:{accounts:[]},records:{records:[record()]},record:{record:record()},content:{record:record()},connections:{items:[],links:[]},activity:{entries:[activity]},'google-settings':{configured:false},preferences:{ok:true}}[action];
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result||{}));return;
  }
  if(url.pathname==='/mail-view.php'){res.setHeader('Content-Type','text/html');res.end('<p>HTML email fixture</p>');return;}
  try{
    const file=url.pathname==='/'?'index.php':url.pathname.slice(1);
    if(!/^[\w.-]+$/.test(file))throw Error('Invalid file');
    let data=await readFile(new URL('../public/'+file,import.meta.url));
    if(file==='index.php')data=data.toString().replace(/^<\?php[\s\S]*?\?>/,'');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const url='http://127.0.0.1:'+server.address().port+'/';
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.goto(url+'#mail');
  const item=page.locator('#items [data-id="elapsed-fixture"]');await item.click();
  assert.match(await item.locator('.mail-field-date').textContent(),/\(\d+ minutes ago\)/);
  assert.match(await page.locator('.mail-compact-date').textContent(),/\(\d+ minutes ago\)/);
  await page.locator('iframe.mail-html').waitFor();
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../test-results/time-labels-mail.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await page.evaluate(async()=>{window.elapsedFrame=document.querySelector('iframe.mail-html');document.querySelector('.mail-reader-actions button').focus();window.elapsedFocus=document.activeElement;document.querySelector('.mail-compact-date [data-elapsed-time]').dataset.elapsedTime=new Date(Date.now()-59000).toISOString();const {refreshTimeLabels}=await import('./time-labels.js');refreshTimeLabels();});
  assert.match(await page.locator('.mail-compact-date').textContent(),/\(now\)/);
  await page.clock.runFor(1000);
  assert.match(await page.locator('.mail-compact-date').textContent(),/\(now\)/,'No per-second refresh at the one-minute boundary');
  await page.clock.runFor(59000);
  assert.match(await page.locator('.mail-compact-date').textContent(),/\(1 minute ago\)/);
  assert.equal(await page.evaluate(()=>window.elapsedFrame===document.querySelector('iframe.mail-html')&&window.elapsedFocus===document.activeElement),true);
  await page.getByRole('button',{name:'View activity',exact:false}).click();
  assert.match(await page.locator('#activity-entries').textContent(),/\(\d+ minutes ago\)/);
  await page.getByRole('button',{name:'Close activity'}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Appearance settings',exact:true}).click();
  const checkbox=page.getByRole('checkbox',{name:'Show elapsed time beside dates'});
  assert.equal(await checkbox.isChecked(),true);await checkbox.uncheck();
  await Promise.all([page.waitForResponse(response=>response.url().includes('r=preferences')&&response.request().method()==='POST'),page.getByRole('button',{name:'Save preferences',exact:true}).click()]);
  assert.equal(preferences.showElapsedTime,false);
  await page.reload();assert.equal(await checkbox.isChecked(),false);
  await page.getByRole('button',{name:'Mail',exact:true}).click();await item.click();
  assert.doesNotMatch(await item.locator('.mail-field-date').innerText(),/ago\)/);
  assert.doesNotMatch(await page.locator('.mail-compact-date').innerText(),/ago\)/);
  await page.getByRole('button',{name:'View activity',exact:false}).click();
  assert.doesNotMatch(await page.locator('#activity-entries').innerText(),/ago\)/);
  await page.getByRole('button',{name:'Close activity'}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Appearance settings',exact:true}).click();await checkbox.check();
  await Promise.all([page.waitForResponse(response=>response.url().includes('r=preferences')&&response.request().method()==='POST'),page.getByRole('button',{name:'Save preferences',exact:true}).click()]);
  kind='documents';await page.goto(url+'#documents');await page.reload();
  await page.locator('#items .item').waitFor();
  assert.match(await page.locator('#items .item').textContent(),/Edited .*\(\d+ minutes ago\)/);
  kind='tasks';await page.goto(url+'#tasks');await page.reload();
  await page.locator('#items .item').waitFor();
  assert.match(await page.locator('#items .item').textContent(),/Due .*\(in \d+ (hours?|days?)\)/);
  assert.deepEqual(errors,[]);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../test-results/time-labels.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  console.log('PASS elapsed labels, in-place updates, iframe/focus preservation, default-on setting, persistence, disabling, modified dates and future due dates.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
