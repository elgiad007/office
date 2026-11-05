import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const requests=[],errors=[];
let groupCount=6;
const groupKinds=['documents','mail','tasks','calendar','contacts','wiki','sheets'];
const items=Array.from({length:1201},(_,i)=>({id:'n'+i,title:i?'Project item '+String(i).padStart(4,'0'):'Project hub',kind:i%2?'tasks':'documents',degree:i?1:1200,meta:{},excerpt:''}));
const links=items.slice(1).map(item=>({a:'n0',b:item.id,created:'2026-11-04'}));
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api.php'){
  requests.push(url.search);const mode=url.searchParams.get('mode'),id=url.searchParams.get('id'),offset=Number(url.searchParams.get('offset')||0),q=url.searchParams.get('q')||'',kind=url.searchParams.get('kind');let result;
  if(mode==='overview')result={items:[],links:[],groups:Array.from({length:groupCount},(_,i)=>({id:i?'group'+i:'n0',kind:groupKinds[i%groupKinds.length],title:i?'Workspace group '+i+' with a longer readable title':'Project hub',items:1201,links:1200})),groupTotal:groupCount,itemTotal:1201,total:1200,more:false};
  else if(mode==='items'){const found=items.filter(item=>item.title.toLowerCase().includes(q.toLowerCase())&&(!kind||item.kind===kind));result={items:found.slice(offset,offset+50),links:[],total:found.length,more:offset+50<found.length};}
  else{const found=id?links.filter(link=>link.a===id||link.b===id):links;const edges=found.slice(offset,offset+100),ids=new Set(edges.flatMap(link=>[link.a,link.b]));if(id)ids.add(id);result={items:items.filter(item=>ids.has(item.id)),links:edges,total:found.length,more:offset+100<found.length};}
  // An older search must never replace a newer navigation.
  if(q==='Project item 0001')await new Promise(r=>setTimeout(r,600));
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;
 }
 if(url.pathname==='/'){
  res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/theme.css"></head><body><button id="launch">Connections</button><button id="replace">Replace dialog</button><dialog id="dialog" aria-labelledby="dialog-title"></dialog><script type="module">
   import {openConnectionExplorer} from '/connection-explorer.js';const dialog=document.querySelector('dialog');
   const env={dialog,keys:()=>window.testKeys||{},api:async route=>{const r=await fetch('/api.php?r='+route);return r.json();},modal:(title,body)=>{dialog.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+title+'</h2><button data-close>Close</button></div>'+body;dialog.querySelector('[data-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();},open:async id=>{window.opened=id;},notice:message=>{throw Error(message);}};
   document.querySelector('#launch').onclick=()=>openConnectionExplorer(env);
   window.replace=()=>{dialog.innerHTML='<button>Other dialog</button>';};
  </script></body></html>`);return;
 }
 const path=url.pathname.slice(1);if(!/^[\w-]+\.(js|css)$/.test(path)){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('../public/'+path,import.meta.url)));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
await mkdir('test-results',{recursive:true});let browser,page;
try{
 browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.locator('#launch').click();await page.locator('[data-group-node]').first().waitFor();
 assert.equal(await page.locator('[data-group-node]').count(),6);assert.equal(await page.locator('[data-zoom-level]').textContent(),'100%');
 for(const direction of ['-1','1']){const button=page.locator(`[data-history="${direction}"]`);assert.equal(await button.isDisabled(),true);assert.equal(await button.evaluate(node=>getComputedStyle(node).cursor),'default');}
 assert.equal(await page.locator('[data-group-node="n0"]').getAttribute('data-kind'),'documents');assert.match(await page.locator('[data-group-node="n0"]').getAttribute('aria-label'),/Document/);
 assert.equal(await page.locator('[data-group-node="n0"] .connection-group-symbol').textContent(),'▤');assert.equal(await page.locator('[data-connection-list] [role="img"][aria-label="Document"]').count(),1);
 const focusedId=()=>page.evaluate(()=>document.activeElement?.getAttribute('data-group-node')||document.activeElement?.getAttribute('data-node'));
 assert.equal(await focusedId(),'n0');await page.keyboard.press('j');assert.equal(await focusedId(),'group2');await page.keyboard.press('l');assert.equal(await focusedId(),'group3');await page.keyboard.press('k');assert.equal(await focusedId(),'group1');await page.keyboard.press('h');assert.equal(await focusedId(),'n0');
 await page.evaluate(()=>window.testKeys={down:'J',right:'L'});await page.keyboard.press('J');assert.equal(await focusedId(),'group2');await page.keyboard.press('L');assert.equal(await focusedId(),'group3');await page.keyboard.press('ArrowUp');assert.equal(await focusedId(),'group1');
 await page.keyboard.press('g');await page.keyboard.press('g');assert.equal(await focusedId(),'n0');await page.keyboard.press('G');assert.equal(await focusedId(),'group5');
 await page.keyboard.press('/');assert.equal(await page.locator('[data-connection-filter]').evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await focusedId(),'group5');assert.equal(await page.locator('dialog').isVisible(),true);
 await page.keyboard.press('Home');assert.equal(await focusedId(),'n0');await page.evaluate(()=>window.testKeys={});
 await page.keyboard.press('l');assert.equal(await focusedId(),'group1');await page.keyboard.press('l');assert.equal(await focusedId(),'group2');await page.keyboard.press('h');assert.equal(await focusedId(),'group1');
 await page.evaluate(()=>window.testKeys={right:'L',left:'H'});await page.keyboard.press('L');assert.equal(await focusedId(),'group2');await page.keyboard.press('H');assert.equal(await focusedId(),'group1');await page.evaluate(()=>window.testKeys={});await page.keyboard.press('Home');
 const checkCards=async()=>assert.ok(await page.locator('svg').evaluate(svg=>{const map=svg.getBoundingClientRect(),cards=[...svg.querySelectorAll('[data-group-node] rect')].map(node=>node.getBoundingClientRect());return cards.every(card=>card.left>=map.left&&card.right<=map.right&&card.top>=map.top&&card.bottom<=map.bottom)&&cards.every((card,i)=>cards.every((other,j)=>i===j||card.right<=other.left||card.left>=other.right||card.bottom<=other.top||card.top>=other.bottom));}));
 await checkCards();await page.screenshot({path:'test-results/connection-overview-readable.png'});
 assert.ok(await page.locator('[data-group-node]').evaluateAll(nodes=>nodes.every(node=>{const rect=node.querySelector('rect').getBBox(),title=node.querySelector('.connection-group-title').getBBox(),icon=node.querySelector('.connection-group-symbol').getBBox();return title.x>=rect.x&&title.x+title.width<=rect.x+rect.width&&icon.x+icon.width<title.x;})));
 await page.setViewportSize({width:1200,height:1000});await page.waitForTimeout(150);assert.equal(await page.locator('[data-zoom-level]').textContent(),'100%');await checkCards();
 await page.setViewportSize({width:1440,height:1000});groupCount=30;await page.locator('[data-reset-graph]').click();await page.locator('[data-group-node]').nth(29).waitFor();assert.ok(parseInt(await page.locator('[data-zoom-level]').textContent())<100);await checkCards();
 for(const kind of groupKinds)assert.ok(await page.locator(`[data-group-node][data-kind="${kind}"] .connection-group-symbol`).count()>0);
 groupCount=1;await page.locator('[data-reset-graph]').click();await page.locator('[data-connection-status]').filter({hasText:'1 of 1 groups'}).waitFor();
 const box=await page.locator('dialog').boundingBox();assert.equal(box.width,1440);assert.equal(box.height,1000);assert.equal(box.x,0);assert.equal(box.y,0);
 await page.screenshot({path:'test-results/connection-explorer-overview.png'});
 await page.locator('[data-group-node]').press('Enter');await page.locator('[data-connection-status]').filter({hasText:'100 of 1200'}).waitFor();
 assert.equal(await page.locator('[data-node]').count(),101);assert.equal(await page.locator('.connection-list-row').count(),50);
 assert.equal(await page.locator('[data-history="-1"]').isDisabled(),false);assert.equal(await page.locator('[data-history="-1"]').evaluate(node=>getComputedStyle(node).cursor),'pointer');assert.equal(await page.locator('[data-history="1"]').evaluate(node=>getComputedStyle(node).cursor),'default');
 assert.equal(await focusedId(),'n0');await page.keyboard.press('l');assert.equal(await focusedId(),'n1');assert.equal(await page.locator('[data-node].selected').getAttribute('data-node'),'n1');
 await page.keyboard.press('Enter');await page.locator('[data-connection-status]').filter({hasText:'1 of 1'}).waitFor();assert.equal(await focusedId(),'n1');
 await page.keyboard.press('k');assert.equal(await focusedId(),'n0');await page.keyboard.press('j');assert.equal(await focusedId(),'n1');await page.keyboard.press('j');assert.equal(await focusedId(),'n1');
 await page.evaluate(()=>window.testKeys={up:'K',down:'J'});await page.keyboard.press('K');assert.equal(await focusedId(),'n0');await page.keyboard.press('J');assert.equal(await focusedId(),'n1');await page.keyboard.press('ArrowUp');assert.equal(await focusedId(),'n1');await page.evaluate(()=>window.testKeys={});
 await page.getByRole('button',{name:'Back in connections'}).click();await page.locator('[data-connection-status]').filter({hasText:'100 of 1200'}).waitFor();assert.equal(await focusedId(),'n1');
 await page.locator('[data-select="n1"]').first().click();await page.locator('[data-selection] h3').filter({hasText:'Project item 0001'}).waitFor();
 assert.equal(await page.locator('line.highlighted').count(),1);assert.ok(await page.locator('[data-node].dimmed').count()>0);
 const initial=await page.locator('svg').getAttribute('viewBox');await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.notEqual(await page.locator('svg').getAttribute('viewBox'),initial);
 await page.getByRole('button',{name:'Center selection',exact:true}).click();
 await page.locator('[data-connection-graph]').focus();const before=await page.locator('svg').getAttribute('viewBox');await page.keyboard.press('Shift+ArrowRight');assert.notEqual(await page.locator('svg').getAttribute('viewBox'),before);
 const graph=await page.locator('[data-connection-graph]').boundingBox();await page.mouse.move(graph.x+10,graph.y+10);await page.mouse.down();await page.mouse.move(graph.x+100,graph.y+70);await page.mouse.up();assert.notEqual(await page.locator('svg').getAttribute('viewBox'),before);
 await page.locator('[data-connection-more]').click();await page.locator('[data-connection-status]').filter({hasText:'200 of 1200'}).waitFor();assert.equal(await page.locator('[data-node]').count(),160);assert.equal(await page.locator('.connection-list-row').count(),50);
 await page.locator('[data-selection] [data-explore]').click();await page.locator('[data-connection-status]').filter({hasText:'1 of 1'}).waitFor();
 assert.ok(requests.some(query=>query.includes('id=n1')));await page.getByRole('button',{name:'Back in connections',exact:true}).click();await page.locator('[data-connection-status]').filter({hasText:'200 of 1200'}).waitFor();assert.equal(await page.locator('[data-node].selected').getAttribute('data-node'),'n1');
 await page.locator('[data-connection-filter]').fill('Project item 1199');await page.locator('[data-list-title]').filter({hasText:'Matching items'}).waitFor();await page.locator('[data-select="n1199"]').waitFor();
 await page.locator('[data-connection-filter]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-node')==='n1199');
 await page.keyboard.press('Enter');await page.locator('[data-connection-status]').filter({hasText:'1 of 1'}).waitFor();assert.ok(requests.some(query=>query.includes('id=n1199')));
 await page.locator('[data-connection-filter]').fill('Project item 0001');await page.waitForTimeout(260);await page.locator('[data-overview]').click();await page.locator('[data-group-node]').waitFor();await page.waitForTimeout(650);assert.equal(await page.locator('[data-group-node]').count(),1);
 await page.locator('[data-connection-kind]').selectOption('tasks');await page.locator('[data-list-title]').filter({hasText:'Matching items'}).waitFor();assert.equal(await page.locator('.connection-list-row').count(),50);assert.equal(await page.locator('[data-node][data-kind="documents"]').count(),0);
 await page.locator('[data-overview]').click();await page.locator('[data-group-node]').click();await page.locator('[data-node]').first().waitFor();
 await page.getByRole('button',{name:'Fit view',exact:true}).click();await page.screenshot({path:'test-results/connection-explorer-desktop.png'});
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.getByRole('button',{name:'Fit view',exact:true}).click();assert.ok(await page.locator('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  const map=await page.locator('[data-connection-graph]').boundingBox();assert.ok(map.height>=100);assert.ok(map.y+map.height<=viewport.height);
  await page.locator('[data-toggle-panel]').click();assert.equal(await page.locator('#connection-panel').isVisible(),false);await page.locator('[data-toggle-panel]').click();assert.equal(await page.locator('#connection-panel').isVisible(),true);
  await page.screenshot({path:`test-results/connection-explorer-${viewport.width}.png`});
 }
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').isVisible(),false);assert.equal(await page.locator('#launch').evaluate(node=>node===document.activeElement),true);
 // A search result drills into its neighborhood, then Enter opens its content without another fetch.
 await page.locator('#launch').click();await page.locator('[data-group-node]').waitFor();await page.keyboard.press('/');await page.locator('[data-connection-filter]').fill('Project item 1199');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-node')==='n1199');
 await page.keyboard.press('Enter');await page.locator('[data-connection-status]').filter({hasText:'1 of 1'}).waitFor();assert.equal(await focusedId(),'n1199');
 const leafRequests=requests.length;await page.keyboard.press('Enter');await page.waitForFunction(()=>window.opened==='n1199');assert.equal(await page.locator('dialog').isVisible(),false);assert.equal(requests.length,leafRequests);
 // Group exploration still drills down before opening, even when its representative is selected.
 await page.locator('#launch').click();await page.locator('[data-group-node]').waitFor();await page.keyboard.press('Enter');await page.locator('[data-connection-status]').filter({hasText:'100 of 1200'}).waitFor();
 const groupRequests=requests.length;await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.connections-view')?.getAttribute('aria-busy')==='false');assert.ok(requests.length>groupRequests);assert.equal(await page.locator('dialog').isVisible(),true);
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.opened==='n0');assert.equal(await page.locator('dialog').isVisible(),false);
 await page.locator('#launch').click();await page.locator('[data-group-node]').waitFor();await page.locator('[data-connection-filter]').fill('Project item 0001');await page.waitForTimeout(260);await page.evaluate(()=>window.replace());await page.waitForTimeout(650);assert.equal(await page.getByRole('button',{name:'Other dialog'}).count(),1);
 assert.deepEqual(errors,[]);console.log('PASS explorer: full screen, 1,200-edge fixture, grouping, bounded map/list, selection, zoom/pan, neighborhood requests, global search, type filters, history, stale responses, responsive views and lifecycle.');
}catch(error){if(page)await page.screenshot({path:'test-results/connection-explorer-failure.png'});throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
