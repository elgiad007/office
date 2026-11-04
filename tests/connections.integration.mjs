import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url)),{chromium}=require('playwright');
await mkdir('.runtime',{recursive:true});await mkdir('test-results',{recursive:true});
const data=await mkdtemp(resolve('.runtime/connections-integration-'));
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const proxy=createHttpServer((incoming,outgoing)=>{
 const upstream=httpRequest({host:'127.0.0.1',port,path:incoming.url,method:incoming.method,headers:{...incoming.headers,connection:'close'},agent:false},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});
 upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});incoming.pipe(upstream);
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${proxy.address().port}/`;
const php=process.env.OFFICE_PHP||(process.platform==='win32'?resolve('runtime/windows/php.exe'):'php');
const ext=process.env.OFFICE_PHP_EXT||(process.platform==='win32'?resolve('runtime/windows/ext'):null);
const server=spawn(php,[...(ext?['-d','extension_dir='+ext]:[]),'-S',`127.0.0.1:${port}`,'-t',resolve('public')],{env:{...process.env,OFFICE_DATA_DIR:data},windowsHide:true,stdio:'ignore'});
let browser,page;const errors=[];
try{
 for(let i=0;i<60;i++){try{if((await fetch(url+'api.php?r=status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.getByLabel('Setup token',{exact:true}).fill((await readFile(data+'/setup-token.txt','utf8')).trim());
 await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('connection-tests-only-123');await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByRole('button',{name:'+ Compose',exact:true}).waitFor();
 const api=async(route,body)=>{
  const csrf=(await (await page.request.get(url+'api.php?r=status')).json()).csrf;
  const response=body?await page.request.post(url+'api.php?r='+route,{data:body,headers:{'X-CSRF-Token':csrf}}):await page.request.get(url+'api.php?r='+route);
  const json=await response.json();if(!response.ok())throw Error(json.error);return json;
 };
 const save=async(kind,title,body='',meta={})=>(await api('save',{kind,title,body,meta})).record;
 const source=await save('tasks','Planning hub','Quarterly planning');
 const first=await save('calendar','Budget review A','Review forecast alpha',{start:'2026-11-05T14:00:00Z'});
 const second=await save('calendar','Budget review B','Review forecast beta',{start:'2026-11-06T14:00:00Z'});
 await save('contacts','Finance lead','Discuss forecasts',{email:'finance@example.test'});
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.locator('#items [data-id="'+source.id+'"]').click();
 const command=async text=>{await page.keyboard.press('Escape');await page.locator('#main').focus();await page.keyboard.press(':');await page.locator('#command-input').fill(text);};
 const run=async text=>{await command(text);await page.keyboard.press('Enter');};
 const openConnections=async()=>{await page.locator('.connection-count').filter({hasText:/Connections · \d/}).waitFor();await page.locator('.connection-count').click();await page.locator('.connection-popover:popover-open').waitFor();};
 await command(':link event forecast');await page.locator('#connection-suggestions [role="option"]').first().waitFor();
 assert.equal(await page.locator('#connection-suggestions [role="option"]').count(),2);
 const popup=await page.locator('#connection-suggestions').boundingBox();assert.ok(await page.evaluate(({x,y,width,height})=>!!document.elementFromPoint(x+width/2,y+height/2)?.closest('#connection-suggestions'),popup));
 await page.keyboard.press('Escape');assert.equal(await page.locator('#command-input').inputValue(),':link event forecast');assert.equal(await page.locator('#mode').textContent(),'COMMAND');assert.equal(await page.locator('#connection-suggestions').isVisible(),false);
 await page.locator('#command-input').fill(':link event Budget');await page.locator('#connection-suggestions [role="option"]').first().waitFor();
 await page.keyboard.press('ArrowDown');const selected=await page.locator('#connection-suggestions [aria-selected="true"] small').textContent();
 await page.keyboard.press('Tab');const chosen=(await page.locator('#command-input').inputValue()).slice(6);assert.ok(selected.includes(chosen));await page.keyboard.press('Enter');
 await page.locator('#notice').filter({hasText:'Items linked.'}).waitFor();assert.equal((await api('connections&id='+source.id)).links.length,1);
 await run(':link '+chosen);await page.locator('#notice').filter({hasText:'Items linked.'}).waitFor();assert.equal((await api('connections&id='+source.id)).links.length,1);
 await openConnections();await page.locator('.item-connections [data-connection-open]').click();await page.waitForURL('**/#calendar');await page.locator('.item-connections [data-connection-open="'+source.id+'"]').waitFor({state:'attached'});
 await openConnections();await page.locator('.item-connections [data-connection-open="'+source.id+'"]').click();await page.waitForURL('**/#tasks');await page.locator('.item-connections [data-connection-open="'+chosen+'"]').waitFor({state:'attached'});
 await run(':new linked mail');await page.waitForURL('**/#mail');await page.locator('#save-status').filter({hasText:/^Unsaved draft$/}).waitFor();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Linked draft');
 assert.equal(await page.locator('.connection-count').isDisabled(),true);assert.equal(await page.locator('[data-connections-add]').isDisabled(),true);
 assert.equal((await api('connections&id='+source.id)).links.length,1);
 await page.keyboard.press('Control+s');await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();await page.locator('.item-connections [data-connection-open="'+source.id+'"]').waitFor({state:'attached'});
 assert.equal((await api('records&kind=mail')).records[0].title,'Linked draft');
 assert.equal((await api('connections&id='+source.id)).links.length,2);
 await openConnections();await page.locator('.item-connections [data-connection-open="'+source.id+'"]').click();await page.locator('.item-connections [data-connection-open="'+chosen+'"]').waitFor({state:'attached'});
 await run(':new linked event');await page.waitForURL('**/#calendar');await page.getByRole('button',{name:'Discard Draft',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Discard Draft',exact:true}).click();
 assert.equal((await api('connections&id='+source.id)).links.length,2);
 await run(':links all');await page.locator('.connections-view svg').waitFor();assert.equal(await page.locator('.connections-view [data-open]').count(),4);
 assert.ok((await page.locator('.connections-view svg').boundingBox()).height>200);assert.equal(await page.locator('[data-connection-more]').isVisible(),false);
 await page.locator('[data-node]').first().focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Show loaded connections'}).click();
 await page.screenshot({path:'test-results/connections-graph.png'});await page.keyboard.press('Escape');
 const backup=await api('backup');assert.equal(backup.connections.length,2);
 const before=(await api('records&kind=tasks')).records.length;
 await assert.rejects(api('save',{kind:'tasks',title:'Must rollback',body:'',meta:{},linkedTo:'missing'}));assert.equal((await api('records&kind=tasks')).records.length,before);
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.locator('#items [data-id="'+source.id+'"]').click();await command(':unlink ');await page.locator('#connection-suggestions [role="option"]').first().waitFor();assert.equal(await page.locator('#connection-suggestions [role="option"]').count(),2);await page.keyboard.press('Tab');await page.keyboard.press('Enter');await page.locator('#notice').filter({hasText:'Connection removed.'}).waitFor();assert.equal((await api('connections&id='+source.id)).links.length,1);
 // Restore full backups through the real API, retaining the older no-connections format.
 for(const record of backup.records)await api('delete',{id:record.id,revision:record.revision});
 await api('restore',{backup});assert.equal((await api('backup')).connections.length,2);
 await page.reload();await page.locator('#items [data-id="'+source.id+'"]').click();await page.locator('.item-connections [data-connection-open]').first().waitFor({state:'attached'});
 await page.setViewportSize({width:390,height:844});await command(':link forecast');await page.locator('#connection-suggestions').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/connections-mobile.png'});
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 // Header controls work in every app, including the received-mail header and wiki preview.
 const examples=[source,first,await save('mail','Received linked message','Message content\n'.repeat(80),{folder:'Inbox',from:'sender@example.test'}),await save('contacts','Header contact'),await save('documents','Header document','<p>Document content</p>'),await save('wiki','header:page','Wiki content'),await save('sheets','Header sheet','',{workbook:{sheets:[{name:'Sheet 1',cells:{A1:'Content'}}]}})];
 for(const item of examples)if(item.id!==source.id)await api('connection',{id:source.id,target:item.id});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const item of examples){
   await page.locator('[data-app="'+item.kind+'"]').first().click();await page.locator('#items [data-id="'+item.id+'"]').click();
   if(item.kind==='wiki'&&await page.locator('[data-action="wiki-mode"]').textContent()==='Preview')await page.locator('[data-action="wiki-mode"]').click();
   const count=page.locator('.connection-count');await count.filter({hasText:/Connections · \d/}).waitFor();
   assert.equal(await page.locator('#detail > .item-connections').count(),0);
   assert.equal(await page.locator((item.kind==='mail'?'.mail-reader-header':'.detail-toolbar')+' .item-connections').count(),1);
   assert.ok((await count.boundingBox()).height<=22);
   const contentHeight=await page.locator('#detail').evaluate(panel=>panel.scrollHeight);
   await count.focus();await page.keyboard.press('ArrowDown');await page.locator('.connection-popover:popover-open').waitFor();
   assert.equal(await page.locator('#detail').evaluate(panel=>panel.scrollHeight),contentHeight);
   const box=await page.locator('.connection-popover').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1&&box.y>=0&&box.y+box.height<=viewport.height+1);
   assert.ok(await page.evaluate(({x,y,width,height})=>!!document.elementFromPoint(x+width/2,y+height/2)?.closest('.connection-popover'),box));
   await page.keyboard.press('Escape');assert.equal(await count.evaluate(button=>button===document.activeElement),true);assert.equal(await count.getAttribute('aria-expanded'),'false');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(item.kind==='mail')await page.screenshot({path:`test-results/connections-header-mail-${viewport.width}.png`});
  }
 }
 await openConnections();await page.locator('[data-connections-view]').click();await page.locator('.connections-view [data-open]').first().waitFor();assert.equal(await page.locator('.connections-view [data-open]').count(),2);await page.keyboard.press('Escape');
 await openConnections();await page.locator('[data-connection-remove]').first().click();await page.locator('#notice').filter({hasText:'Connection removed.'}).waitFor();await page.locator('.connection-count').filter({hasText:'Connections · 0'}).waitFor();
 await page.locator('#main').click({position:{x:5,y:5}});await page.locator('.connection-count[aria-expanded="false"]').waitFor();
 await page.locator('[data-connections-add]').click();await page.locator('#command-input').waitFor();assert.equal(await page.locator('#command-input').inputValue(),':link ');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS connections: real API, autocomplete arrows/Tab/Escape, linked draft save/discard, navigation, graph, unlink, atomic rollback, backup/restore, persistence and mobile layout.');
}catch(error){if(page){console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:'test-results/connections-failure.png'});}throw error;}
finally{await browser?.close();server.kill();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
