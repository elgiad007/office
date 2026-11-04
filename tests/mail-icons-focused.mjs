import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import net from 'node:net';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
await mkdir('.runtime',{recursive:true});
const dir=await mkdtemp(resolve('.runtime/mail-icons-'));
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const port=listener.address().port;await new Promise(r=>listener.close(r));
const url=`http://127.0.0.1:${port}/`;
const php=process.env.OFFICE_PHP||'php';
const extensions=process.env.OFFICE_PHP_EXT?['-d','extension_dir='+resolve(process.env.OFFICE_PHP_EXT),...['pdo_sqlite','openssl','curl','dom'].flatMap(name=>['-d','extension='+name])]:[];
const server=spawn(php,[...extensions,'-S',`127.0.0.1:${port}`,'-t',resolve('public')],{env:{...process.env,OFFICE_DATA_DIR:dir},windowsHide:true,stdio:'ignore'});
let browser;
try{
  for(let i=0;i<60;i++){try{await fetch(url+'api.php?r=status');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let csrf;
  async function api(route,data){
    const response=await context.request.fetch(url+'api.php?r='+route,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'X-CSRF-Token':csrf},data});
    const result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));return result;
  }
  csrf=(await api('status')).csrf;
  csrf=(await api('setup',{token:(await readFile(dir+'/setup-token.txt','utf8')).trim(),password:'test-password-only-123'})).csrf;
  const mail=(await api('save',{kind:'mail',title:'Favicon with connections',body:'Body preview',meta:{from:'Alex <alex@example.com>',folder:'Inbox',read:true,date:'2026-11-04T12:00:00Z'}})).record;
  const missing=(await api('save',{kind:'mail',title:'Missing favicon',body:'Fallback',meta:{from:'user@missing.example',folder:'Inbox',read:true}})).record;
  const task=(await api('save',{kind:'tasks',title:'Connected task',body:'',meta:{}})).record;
  const doc=(await api('save',{kind:'documents',title:'Connected document',body:'',meta:{}})).record;
  await api('connection',{id:mail.id,target:task.id});await api('connection',{id:mail.id,target:doc.id});
  const rows=(await api('records&kind=mail&summaries=1')).records;
  assert.equal(rows.find(r=>r.id===mail.id).connectionCount,2);assert.equal(rows.find(r=>r.id===missing.id).connectionCount,0);
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await mkdir(dir+'/favicons');
  for(const [domain,icon] of [['example.com',{type:'image/png',body:png}],['missing.example',null]])await writeFile(dir+'/favicons/'+createHash('sha256').update(domain).digest('hex')+'.json',JSON.stringify({expires:Math.floor(Date.now()/1000)+3600,icon}));
  const cached=await context.request.get(url+'sender-favicon.php?domain=example.com');assert.equal(cached.headers()['content-type'],'image/png');assert.equal(cached.status(),200);
  assert.equal((await context.request.get(url+'sender-favicon.php?domain=127.0.0.1')).status(),400);
  assert.equal((await context.request.get(url+'sender-favicon.php?domain=missing.example')).status(),204);
  const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(url+'sender-favicon.php?domain=example.com')).status(),401);await anonymous.close();
  await page.goto(url+'#mail');
  const item=page.locator(`#items .item[data-id="${mail.id}"]`),fallback=page.locator(`#items .item[data-id="${missing.id}"]`);
  await item.locator('.mail-sender-favicon.loaded').waitFor();
  await page.waitForFunction(id=>!document.querySelector(`[data-id="${id}"] .mail-sender-favicon`),missing.id);
  assert.equal(await item.locator('.mail-list-connections').innerText(),'2');
  assert.equal(await fallback.locator('.mail-list-connections').isVisible(),false);
  assert.equal(await fallback.locator('.mail-sender-icon > svg').isVisible(),true);
  for(const theme of ['light','dark'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const icon=await item.locator('.mail-sender-icon').boundingBox(),badge=await item.locator('.mail-list-connections').boundingBox(),row=await item.boundingBox();
    assert.ok(badge.y>=icon.y+icon.height);assert.ok(badge.y+badge.height<=row.y+row.height);
  }
  await page.setViewportSize({width:1440,height:1000});await item.click();
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/mail-icons.png'});
  await page.locator('#connection-count').click();
  await page.getByRole('button',{name:'Remove connection to Connected task',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector(`[data-id="${id}"] .mail-list-connections span`)?.textContent==='1',mail.id);
  assert.equal((await api('record&id='+mail.id)).record.connectionCount,1);
  await page.waitForFunction(()=>document.querySelector('#connection-count')?.textContent==='Connections · 1');
  if(await page.locator('#connection-count').getAttribute('aria-expanded')!=='true')await page.locator('#connection-count').click();
  await page.getByRole('button',{name:'Remove connection to Connected document',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector(`[data-id="${id}"] .mail-list-connections`)?.hidden,mail.id);
  await item.focus();await page.keyboard.press('v');assert.match(await item.locator('.mail-sender-icon').innerText(),/✓/);
  await page.keyboard.press('v');await item.locator('.mail-sender-favicon.loaded').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS favicon cache/auth/fallback, layout in both themes and narrow views, selection and live unlink counts.');
}finally{await browser?.close();server.kill();}
