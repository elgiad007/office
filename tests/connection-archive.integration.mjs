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
 await page.getByLabel('Create password (at least 12 characters)',{exact:true}).fill('connection-tests-only-123');await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByRole('button',{name:'Compose',exact:true}).waitFor();
 const api=async(route,body)=>{
  const csrf=(await (await page.request.get(url+'api.php?r=status')).json()).csrf;
  const response=body?await page.request.post(url+'api.php?r='+route,{data:body,headers:{'X-CSRF-Token':csrf}}):await page.request.get(url+'api.php?r='+route);
  const json=await response.json();if(!response.ok())throw Error(json.error);return json;
 };
 const save=async(kind,title,body='',meta={})=>(await api('save',{kind,title,body,meta})).record;
 const source=await save('tasks','A archive project','Preserved task');
 const mail=await save('mail','B archived mail','Preserved mail',{folder:'Local mail'});
 const doc=await save('documents','C document','<p>Preserved document</p>');
 const peer=await save('contacts','D contact');
 const other=await save('tasks','Other project'),otherPeer=await save('mail','Other mail','Other mail body',{folder:'Local mail'});
 for(const [a,b] of [[source,mail],[source,doc],[doc,peer],[other,otherPeer]])await api('connection',{id:a.id,target:b.id});
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.locator('#items [data-id="'+source.id+'"]').click();await page.locator('#main').focus();await page.keyboard.press('L');
 const loaded=text=>page.locator('[data-connection-status]').filter({hasText:text}).waitFor();
 const setView=async view=>{await page.locator('[data-connection-visibility]').selectOption(view);await page.waitForFunction(()=>document.querySelector('.connections-view')?.getAttribute('aria-busy')==='false');};
 const edge=page.locator(`[data-connection-edge="${[source.id,mail.id].sort().join('|')}"]`);
 await loaded('2 of 2 connections loaded');assert.equal(await page.locator('[data-connection-visibility]').inputValue(),'active');
 // Build a cached path, then verify mutations invalidate it rather than resurrecting hidden edges.
 await page.locator('[data-node="'+doc.id+'"]').focus();await page.keyboard.press('Enter');await loaded('2 of 2 connections loaded');await page.keyboard.press('Backspace');await loaded('2 of 2 connections loaded');
 await edge.locator('[data-archive-action="archive"]').click();await loaded('Archived 1 connections.');assert.equal((await api('connections&id='+source.id)).total,1);assert.equal(await edge.count(),0);
 assert.equal((await api('records&kind=mail')).records.find(r=>r.id===mail.id).connectionCount,0);assert.equal((await api('record&id='+mail.id)).record.body,'Preserved mail');
 await page.getByRole('button',{name:'Forward in connections'}).click();await loaded('2 of 2 connections loaded');await page.keyboard.press('Backspace');await loaded('1 of 1 connections loaded');assert.equal(await edge.count(),0);
 await setView('archived');await loaded('1 of 1 connections loaded');assert.equal(await edge.locator('.connection-archive-badge').textContent(),'Archived');assert.equal(await page.locator('.connection-archived-edge').count(),1);
 await edge.locator('[data-archive-action="restore"]').click();await loaded('Restored 1 connections.');assert.equal((await api('connections&id='+source.id)).total,2);assert.equal(await page.locator('[data-connection-visibility]').inputValue(),'active');assert.equal(await edge.count(),1);assert.equal(await edge.locator('.connection-archive-badge').count(),0);
 await setView('active');await loaded('2 of 2 connections loaded');
 await page.locator('[data-selection] [data-archive-action="archive"]').click();await loaded('Archived 2 connections.');assert.equal((await api('connections&id='+source.id)).total,0);assert.equal((await api('connections&id='+doc.id)).total,1);
 await setView('archived');await loaded('2 of 2 connections loaded');await page.locator('[data-selection] [data-archive-action="restore"]').click();await loaded('Restored 2 connections.');assert.equal(await page.locator('[data-connection-visibility]').inputValue(),'active');assert.equal(await page.locator('[data-connection-edge]').count(),2);assert.equal(await page.locator('[data-node="'+source.id+'"]').evaluate(node=>node===document.activeElement),true);
 await setView('all');await loaded('2 of 2 connections loaded');await edge.locator('[data-archive-action="archive"]').click();await loaded('Archived 1 connections.');assert.equal(await edge.locator('.connection-archive-badge').textContent(),'Archived');
 await edge.locator('[data-archive-action="restore"]').click();await loaded('Restored 1 connections.');assert.equal(await page.locator('[data-connection-visibility]').inputValue(),'all');assert.equal(await edge.locator('.connection-archive-badge').count(),0);await edge.locator('[data-archive-action="archive"]').click();await loaded('Archived 1 connections.');
 await page.screenshot({path:'test-results/connection-archive-all.png'});
 await setView('active');await page.getByRole('button',{name:'Workspace overview',exact:true}).click();await page.locator('[data-group-node]').first().waitFor();
 const project=(await api('connections&mode=overview')).groups.find(group=>group.title==='A archive project');assert.ok(project);
 const groupRow=page.locator('.connection-list-row').filter({has:page.locator('[data-group="'+project.id+'"]')});await groupRow.locator('[data-archive-action="archive"]').click();await loaded('Archived 2 connections.');assert.equal((await api('connections&mode=overview')).groupTotal,1);assert.equal((await api('connections&id='+other.id)).total,1);
 await setView('archived');const archived=(await api('connections&mode=overview&visibility=archived')).groups.find(group=>group.title==='A archive project');assert.equal(archived.links,3);assert.equal(archived.archivedLinks,3);
 const archivedRow=page.locator('.connection-list-row').filter({has:page.locator('[data-group="'+archived.id+'"]')});await archivedRow.locator('[data-archive-action="restore"]').click();await loaded('Restored 3 connections.');assert.equal((await api('connections&mode=overview')).groupTotal,2);
 assert.equal(await page.locator('[data-connection-visibility]').inputValue(),'active');assert.equal(await page.locator('[data-group-node]').count(),2);const restoredFocus=(await api('connections&mode=overview')).groups.find(group=>group.title==='A archive project');assert.equal(await page.locator('[data-group-node="'+restoredFocus.id+'"]').evaluate(node=>node===document.activeElement),true);
 // Group toolbar actions use the complete component, not just the selected item's links.
 await setView('active');const restored=(await api('connections&mode=overview')).groups.find(group=>group.title==='A archive project');await page.locator('[data-group-node="'+restored.id+'"]').press('Enter');await loaded('3 of 3 connections loaded');
 await page.locator('[data-group-actions] [data-archive-action="archive"]').click();await loaded('Archived 3 connections.');await setView('archived');await page.screenshot({path:'test-results/connection-archive-groups.png'});
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.locator('#items [data-id="'+source.id+'"]').click();await page.locator('#detail [data-action="delete"]').click();await page.locator('[data-preserve]').waitFor();assert.equal(await page.locator('[data-preserve]').isChecked(),true);await page.locator('#cancel').click();
 const backup=await api('backup');assert.equal(backup.connections.filter(link=>link.archived===1).length,3);
 await assert.rejects(api('restore',{backup:{...backup,connections:backup.connections.map(link=>({...link,archived:'yes'}))}}),/archive status/);
 for(const record of backup.records)await api('delete',{id:record.id,revision:record.revision});await api('restore',{backup});
 assert.equal((await api('connections&mode=overview')).groupTotal,1);assert.equal((await api('connections&mode=overview&visibility=archived')).total,3);
 const legacy={...backup,connections:backup.connections.map(({archived,...link})=>link)};for(const record of backup.records)await api('delete',{id:record.id,revision:record.revision});await api('restore',{backup:legacy});assert.equal((await api('connections&mode=overview')).total,4);assert.equal((await api('connections&mode=overview&visibility=archived')).total,0);
 await page.reload();await page.locator('[data-action="connections"]').click();await page.locator('[data-group-node]').first().waitFor();assert.equal(await page.locator('[data-connection-visibility]').inputValue(),'active');
 // A failed archive leaves controls usable and does not change stored edges.
 const projectAfterRestore=(await api('connections&mode=overview')).groups.find(group=>group.title==='A archive project');await page.locator('[data-group-node="'+projectAfterRestore.id+'"]').press('Enter');await loaded('3 of 3 connections loaded');
 const failRoute=url=>url.pathname.endsWith('/api.php')&&url.searchParams.get('r')==='connection';await page.route(failRoute,route=>route.fulfill({status:500,json:{error:'Archive failure fixture'}}));
 await page.locator('[data-archive-scope="edge"]').first().click();await loaded('Could not archive connections: Archive failure fixture');assert.equal(await page.locator('[data-archive-scope="edge"]').first().isEnabled(),true);assert.equal(await page.locator('.connections-view').getAttribute('aria-busy'),'false');assert.equal((await api('connections&mode=overview')).total,4);await page.unroute(failRoute);
 // Dialog search/select controls must not leave Mail in Insert mode after restoring links.
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.locator('#items [data-id="'+source.id+'"]').click();await page.locator('.connection-count').filter({hasText:'Connections · 2'}).click();await page.locator('[data-connection-open="'+mail.id+'"]').click();await page.waitForURL('**/#mail');await page.locator('#selected-item[data-id="'+mail.id+'"]').waitFor();
 await page.locator('.connection-count').filter({hasText:'Connections · 1'}).click();await page.locator('[data-connections-view]').click();await loaded('1 of 1 connections loaded');await page.locator('[data-selection] [data-archive-action="archive"]').click();await loaded('Archived 1 connections.');await setView('archived');await loaded('1 of 1 connections loaded');assert.equal(await page.locator('#mode').textContent(),'NORMAL');
 await page.locator('[data-selection] [data-archive-action="restore"]').click();await loaded('Restored 1 connections.');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#mode')?.textContent==='NORMAL'&&document.activeElement?.id==='selected-item');assert.equal(await page.locator('#dialog').isVisible(),false);
 await page.keyboard.press('L');await loaded('1 of 1 connections loaded');await page.keyboard.press('/');assert.equal(await page.locator('#mode').textContent(),'NORMAL');await page.locator('[data-close]').click();await page.waitForFunction(()=>document.querySelector('#mode')?.textContent==='NORMAL');
 await page.keyboard.press('g');await page.keyboard.press('g');const firstMail=await page.locator('#selected-item').getAttribute('data-id');await page.keyboard.press('j');await page.waitForFunction(id=>document.querySelector('#selected-item')?.getAttribute('data-id')!==id,firstMail);assert.equal(await page.locator('#mode').textContent(),'NORMAL');
 assert.deepEqual(errors,[]);console.log('PASS archive: real API, edge/item/group controls, active/archived/all, badges, search/count consistency, history invalidation, other groups, backup and legacy restore.');
}catch(error){if(page){console.error((await page.locator('body').innerText()).slice(-1800));await page.screenshot({path:'test-results/connection-archive-failure.png'});}throw error;}
finally{await browser?.close();server.kill();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
