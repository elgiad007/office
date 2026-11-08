import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';

const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try {
    const file=pathname==='/'?'index.php':pathname.slice(1);
    let data=await readFile(new URL('../public/'+file,import.meta.url));
    if(file==='index.php')data=data.toString().replace(/^<\?php[\s\S]*?\?>/,'');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(data);
  } catch {res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({hasTouch:true,viewport:{width:1280,height:760}});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[];
  page.setDefaultTimeout(6500);
  page.on('pageerror',error=>errors.push(error.message));
  const makeRecord=(id,kind='mail')=>({id,kind,title:`Swipe ${id}`,body:'Fixture',revision:1,updated:'2026-11-04T12:00:00Z',meta:kind==='mail'?{folder:'Inbox',read:true,remote:true,account:'test',providerId:id,serverFolder:'INBOX',from:'sender@example.com'}:{}});
  const archive=makeRecord('local');
  archive.meta={folder:'Inbox',read:true};
  let accounts=[{id:'test',type:'imap',label:'Test',folders:[{id:'Project',name:'Project'}]}];
  let records=[makeRecord('a'),makeRecord('b'),makeRecord('c'),archive,makeRecord('t','tasks'),...Array.from({length:25},(_,i)=>makeRecord(`z${i}`))];
  let prefs={mailView:{group:'none'},taskView:{group:'none'}},trashed,rejectId;
  const mutations=[];
  await page.route(url=>url.pathname.endsWith('/api.php'),async route=>{
    const query=new URL(route.request().url()).searchParams;
    const action=query.get('r'),input=route.request().postDataJSON();
    let json={};
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:prefs};
    if(action==='accounts')json={accounts};
    if(action==='records')json={records:records.filter(row=>row.kind===query.get('kind'))};
    if(action==='connections')json={items:[],links:[],more:false};
    if(action==='activity')json={entries:[]};
    if(action==='sync')json={count:0};
    if(action==='preferences')prefs=input.preferences;
    if(action==='mail-action'){
      const row=records.find(row=>row.id===input.id);
      mutations.push(input);
      if(row.id===rejectId)return route.fulfill({status:503,json:{error:'Test provider failure'}});
      if(input.action==='trash')trashed=structuredClone(row);
      if(input.action==='unread')row.meta.read=false;
      else {
        row.meta.folder=input.action==='trash'?'Trash':input.action==='archive'?'Archive':'Custom folder';
        row.meta.serverFolder=input.folder||row.meta.folder;
      }
      row.revision++;
      json={record:row,undoToken:input.undoable?'undo-swipe':undefined};
    }
    if(action==='mail-undo'){
      assert.equal(input.token,'undo-swipe');
      records=records.map(row=>row.id===trashed.id?trashed:row);
      json={record:trashed};
    }
    if(action==='delete'){
      mutations.push(input);
      records=records.filter(row=>row.id!==input.id);
      json={ok:true};
    }
    await route.fulfill({json});
  });
  const url='http://127.0.0.1:'+server.address().port+'/';
  const item=id=>page.locator(`#items .item[data-id="${id}"]`);
  const preview=page.locator('.swipe-preview');
  const undo=id=>page.locator('#swipe-undo').getByRole('button',{name:new RegExp(`for Swipe ${id}$`)});
  async function swipe(id,dx,dy=0,{cancel=false,label}={}){
    const {x,y}=await item(id).evaluate(row=>{
      row.scrollIntoView({block:'nearest'});
      const bounds=row.getBoundingClientRect();
      return {x:Math.round(bounds.x+bounds.width/2),y:Math.round(bounds.y+bounds.height/2)};
    });
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(const fraction of [.25,.5,.75,1])await cdp.send('Input.dispatchTouchEvent',{
      type:'touchMove',touchPoints:[{x:Math.round(x+dx*fraction),y:Math.round(y+dy*fraction)}],
    });
    if(label){await preview.waitFor();assert.equal(await preview.textContent(),label);}
    await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    await preview.waitFor({state:'detached'});
  }
  const openApp=name=>page.getByRole('button',{name,exact:true}).click();
  await page.goto(url+'?swipes#mail');
  await item('a').waitFor();
  await item('b').tap();
  assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b');
  await swipe('a',-36,0,{label:'Move to Trash'});
  await swipe('a',-115,0,{label:'Move to Trash',cancel:true});
  await swipe('a',115);
  assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b');
  assert.equal(mutations.length,0);

  await item('b').click({modifiers:['Control']});
  await item('c').click({modifiers:['Control']});
  assert.equal(await page.locator('.multi-selected').count(),2);
  await swipe('a',-115,0,{label:'Move to Trash'});
  await item('a').waitFor({state:'detached'});
  await swipe('c',-115,0,{label:'Move to Trash'});
  await undo('c').waitFor();
  assert.equal(await undo('a').isVisible(),true,'each swipe has its own Undo button');
  assert.equal(mutations.length,0,'no provider writes while undo is available');
  await undo('a').click();
  await item('a').waitFor();
  assert.equal(await undo('c').isVisible(),true,'undoing one swipe leaves the other pending');
  await undo('c').click();
  await item('c').waitFor();
  await swipe('a',-115,0,{label:'Move to Trash'});
  await page.locator('#notice').filter({hasText:'1 item updated.'}).waitFor();
  assert.deepEqual(mutations.map(({id,action,undoable})=>({id,action,undoable})),[{id:'a',action:'trash',undoable:true}]);
  await page.locator('#main').focus();
  await page.keyboard.press('U');
  await item('a').waitFor();
  await swipe('local',-115,0,{label:'Delete'});
  await page.locator('#cancel').click();
  assert.equal(mutations.length,1,'local mail asks before deleting');

  await openApp('Settings');
  await page.getByRole('button',{name:'Swipe Actions settings'}).click();
  const setting=name=>page.locator(`#swipe-preferences [name="${name}"]`);
  assert.equal(await setting('mail-left').inputValue(),'delete');
  assert.equal(await setting('mail-right').inputValue(),'off');
  await setting('mail-right').selectOption('move');
  await page.getByRole('button',{name:'Save swipe actions'}).click();
  await page.locator('#notice').filter({hasText:'Swipe actions saved.'}).waitFor();
  await page.goto(url+'?swipes-reload#mail');
  await item('b').waitFor();
  await item('b').click({modifiers:['Control']});
  await item('c').click({modifiers:['Control']});
  await swipe('a',115,0,{label:'Move to folder'});
  const folder=page.locator('#quick-move-search');
  await folder.fill('Project');
  await folder.press('Enter');
  await folder.waitFor({state:'hidden'});
  await undo('a').click();
  await item('a').waitFor();
  assert.equal(mutations.length,1,'undo cancels a chosen folder move');
  await swipe('a',115,0,{label:'Move to folder'});
  await folder.fill('Project');
  await folder.press('Enter');
  await page.locator('#notice').filter({hasText:'Moved 1 message(s)'}).waitFor();
  assert.deepEqual(mutations.slice(1).map(({id,action,folder})=>({id,action,folder})),[{id:'a',action:'move',folder:'Project'}]);

  await swipe('b',-6,-170);
  const scrollTop=await page.locator('#items').evaluate(node=>node.scrollTop);
  assert.ok(scrollTop>0,'vertical touch scroll moves the list');
  assert.equal(mutations.length,2);

  await openApp('Tasks');
  await item('t').waitFor();
  await swipe('t',-115,0,{label:'Delete'});
  await page.locator('#cancel').click();
  assert.equal(mutations.length,2);
  await swipe('t',-115,0,{label:'Delete'});
  await page.locator('#confirm').click();
  await item('t').waitFor({state:'detached'});
  await undo('t').click();
  await item('t').waitFor();
  assert.equal(mutations.length,2,'undo cancels a confirmed permanent deletion');
  await swipe('t',-115,0,{label:'Delete'});
  await page.locator('#confirm').click();
  await openApp('Mail');
  await page.locator('#notice').filter({hasText:'1 item updated.'}).waitFor();
  assert.deepEqual(mutations.slice(2).map(({id})=>id),['t']);

  await page.setViewportSize({width:390,height:844});
  accounts=[]; // Keep the phone gesture independent of the startup refresh.
  await page.goto(url+'?swipes-phone#mail');
  await item('c').waitFor();
  await swipe('c',-115,0,{label:'Move to Trash'});
  await item('c').waitFor({state:'detached'});
  await undo('c').tap();
  await item('c').waitFor();
  assert.equal(mutations.length,3,'tapping Undo on a phone cancels the write');
  rejectId='c';
  await swipe('c',-115,0,{label:'Move to Trash'});
  await page.locator('#notice').filter({hasText:'Test provider failure'}).waitFor();
  await item('c').waitFor();
  assert.equal(mutations.at(-1).id,'c');

  prefs.swipe.mail={left:'unread',right:'archive'};
  await page.goto(url+'?swipes-status#mail');
  await item('c').waitFor();
  await swipe('c',-115,0,{label:'Mark as unread'});
  assert.match(await item('c').getAttribute('class'),/mail-unread/);
  await undo('c').tap();
  assert.match(await item('c').getAttribute('class'),/mail-read/);
  await swipe('c',115,0,{label:'Archive'});
  await item('c').waitFor({state:'detached'});
  await undo('c').tap();
  await item('c').waitFor();
  assert.equal(mutations.length,4,'undo cancels archive and read status writes');

  records.find(row=>row.id==='c').title=`Long subject ${'W'.repeat(200)}`;
  await page.setViewportSize({width:280,height:740});
  await page.goto(url+'?swipes-narrow#mail');
  await item('c').waitFor();
  await swipe('c',-110,0,{label:'Mark as unread'});
  const longUndo=page.locator('#swipe-undo').getByRole('button',{name:/Undo mark as unread for Long subject/});
  await longUndo.waitFor();
  const geometry=await longUndo.evaluate(button=>{
    const panel=button.closest('#swipe-undo');
    const subject=button.previousElementSibling;
    const panelBounds=panel.getBoundingClientRect(),buttonBounds=button.getBoundingClientRect();
    return {
      panelFits:panelBounds.left>=12&&panelBounds.right<=innerWidth-12&&panelBounds.width<=300,
      buttonFits:buttonBounds.left>=panelBounds.left&&buttonBounds.right<=panelBounds.right&&buttonBounds.height>=44,
      subjectTruncates:subject.scrollWidth>subject.clientWidth&&getComputedStyle(subject).textOverflow==='ellipsis',
    };
  });
  assert.deepEqual(geometry,{panelFits:true,buttonFits:true,subjectTruncates:true});
  const rowBounds=await item('c').boundingBox();
  await page.locator('#swipe-undo').evaluate((panel,center)=>{
    // Guarantee a row under the button regardless of the fixture's list height.
    panel.style.top=`${center-panel.getBoundingClientRect().height/2}px`;
    panel.style.bottom='auto';
  },rowBounds.y+rowBounds.height/2);
  const undoBounds=await longUndo.boundingBox();
  const point={x:undoBounds.x+undoBounds.width/2,y:undoBounds.y+undoBounds.height/2};
  const pointer={pointerType:'touch',pointerId:99,isPrimary:true,clientX:point.x,clientY:point.y};
  await longUndo.dispatchEvent('pointerdown',pointer);
  await longUndo.dispatchEvent('pointerup',pointer);
  assert.match(await item('c').getAttribute('class'),/mail-read/);
  const followUp=await page.evaluate(({x,y})=>{
    const target=document.elementFromPoint(x,y);
    const row=target?.closest('#items .item[data-id]');
    // Emulate a browser retargeting the tap's click after the Undo button disappears.
    const canceled=target&&!target.dispatchEvent(new MouseEvent('click',{
      bubbles:true,cancelable:true,detail:1,clientX:x,clientY:y,
    }));
    return {id:row?.dataset.id,canceled};
  },point);
  assert.ok(followUp.id,'the Undo button covered a mail row');
  assert.equal(followUp.canceled,true,'the tap’s follow-up click is swallowed');
  assert.equal(await page.locator('.shell.mobile-item-open').count(),0);
  await page.mouse.click(point.x,point.y);
  await page.locator('.shell.mobile-item-open').waitFor();
  assert.equal(await page.locator('#selected-item').getAttribute('data-id'),followUp.id);
  assert.deepEqual(errors,[]);
  console.log('PASS swipe actions: independent undo buttons, delayed writes, folder moves, failed-write recovery, status and archive previews, narrow-screen truncation, phone taps without click-through and touch scrolling.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
