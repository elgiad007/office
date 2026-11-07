import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Isolated browser fixtures: no live database, provider or mail is accessed.
const require=createRequire(process.env.OFFICE_NODE_MODULES||new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const publicRoot=new URL('../public/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=pathname==='/'?'index.php':pathname.slice(1);
    assert.equal(path.basename(file),file);
    let content=await readFile(new URL(file,publicRoot));
    if(file==='index.php')content=Buffer.from(content.toString().replace(/^<\?php[\s\S]*?\?>/,''));
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.OFFICE_BROWSER_CHANNEL?{channel:process.env.OFFICE_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let records=[],writes=[],reject=false,sequence=0,saveGate;
  await page.route('**/api.php?*',async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[{id:'fixture',label:'Fixture',type:'imap'}]};
    else if(action==='records')json={records:records.filter(r=>r.kind===new URL(route.request().url()).searchParams.get('kind'))};
    else if(action==='sync')json={count:0};
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='save'){
      const input=route.request().postDataJSON();writes.push(input);
      if(saveGate)await saveGate;
      if(reject)return route.fulfill({status:500,json:{error:'Fixture save failure'}});
      const record={...input,id:input.id||`saved-${++sequence}`,revision:(input.revision||0)+1,created:input.created||new Date().toISOString(),updated:new Date().toISOString()};
      records=records.filter(r=>r.id!==record.id);records.push(record);json={record};
    }else if(action==='delete'){records=records.filter(r=>r.id!==route.request().postDataJSON().id);json={ok:true};}
    else throw Error('Unexpected draft fixture API: '+action);
    await route.fulfill({json});
  });
  const saved=()=>page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();
  const saveButton=page.locator('#detail [data-action="save"]');
  const checkSaveButton=async(label,disabled)=>{
    await saveButton.filter({hasText:label}).waitFor();
    assert.equal(await saveButton.textContent(),label);
    assert.equal(await saveButton.isDisabled(),disabled);
  };
  const create=async()=>{await page.locator('[data-action="new"]:visible').first().click();await page.locator('#save-status').filter({hasText:'Unsaved draft'}).waitFor();};
  const discard=async()=>{await page.locator('#detail [data-action="delete"]').click();await page.locator('#confirm').click();await page.locator('#record-form').waitFor({state:'detached'});};
  for(const app of ['documents','wiki','sheets','tasks','contacts','calendar','mail']){
    await page.goto(url+'#'+app);await page.reload();await page.locator('[data-action="new"]:visible').first().waitFor();
    await create();const before=writes.length;
    await checkSaveButton('Save',false);
    await page.locator('.title-input').fill('Manual '+app);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    assert.equal(writes.length,before,app+' does not save on creation, typing, timeout or Escape');
    assert.equal(await page.locator('#detail [data-action="delete"]').textContent(),'Discard Draft');
    if(app==='wiki'){
      await page.locator('[name="body"]').fill('# Preview stays in memory');
      await page.locator('[data-action="wiki-mode"]').click();
      assert.equal(writes.length,before);await page.locator('[data-action="wiki-mode"]').click();
      assert.equal(await page.locator('[name="body"]').inputValue(),'# Preview stays in memory');
    }
    if(app==='sheets'){
      await page.locator('#formula').fill('42');await page.locator('[data-action="add-sheet"]').click();
      assert.equal(writes.length,before);
    }
    if(app==='mail'){
      await page.locator('[name="to"]').fill('fixture@example.com');
      await page.locator('[data-attach-input]').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
      await page.locator('[data-file-status]').filter({hasText:'Save this draft first.'}).waitFor();
      assert.equal(writes.length,before,'attachments cannot implicitly save');
    }
    await discard();assert.equal(writes.length,before,app+' discard has no save');
    await create();await page.locator('.title-input').fill('Saved '+app);
    if(app==='documents')await page.locator('#rich-editor').fill('Document content');
    const editor=await page.locator('#record-form').elementHandle();
    await page.keyboard.press('Control+s');await saved();
    await checkSaveButton('Saved',true);
    assert.equal(await editor.evaluate(node=>node.isConnected),true,'first save preserves the editor');
    assert.equal(writes.length,before+1);assert.equal(writes.at(-1).id,undefined,'initial save omits temporary ID');
    const stored=records.find(r=>r.kind===app);assert.equal(stored.title,'Saved '+app);
    if(app==='documents')assert.match(stored.body,/Document content/);
    await page.locator('.title-input').fill('Autosaved '+app);
    await checkSaveButton('Save',false);
    await saved();
    await checkSaveButton('Saved',true);
    assert.equal(writes.length,before+2,app+' autosaves after manual first save');
    assert.equal(writes.at(-1).id,stored.id);
  }
  await page.goto(url+'#documents');await page.reload();await page.locator('[data-action="new"]:visible').first().waitFor();
  await checkSaveButton('Saved',true);
  await create();await page.locator('.title-input').fill('Keep this draft');
  await page.locator('#rich-editor').fill('Keep this content');const before=writes.length;
  await page.locator('[data-app="tasks"]').click();await page.locator('[data-draft-choice="cancel"]').click();
  assert.equal(await page.locator('.title-input').inputValue(),'Keep this draft');assert.equal(writes.length,before);
  // Export and sync keep the editor open and do not save it.
  const download=page.waitForEvent('download');await page.locator('#detail [data-action="export"]').click();await download;
  await page.locator('#sync-button').click();await page.waitForTimeout(150);
  assert.equal(writes.length,before);assert.equal(await page.locator('#rich-editor').textContent(),'Keep this content');
  let releaseSave;
  saveGate=new Promise(resolve=>{releaseSave=resolve;});
  reject=true;await saveButton.click();
  await checkSaveButton('Saving…',true);
  releaseSave();saveGate=undefined;
  await page.locator('#save-status').filter({hasText:'Save failed'}).waitFor();
  await checkSaveButton('Save',false);
  assert.equal(await page.locator('#rich-editor').textContent(),'Keep this content');
  assert.equal(await page.locator('#detail [data-action="delete"]').textContent(),'Discard Draft');
  await page.locator('[data-app="tasks"]').click();await page.locator('[data-draft-choice="save"]').click();
  await page.locator('#save-status').filter({hasText:'Save failed'}).waitFor();
  assert.equal(await page.locator('#crumb').textContent(),'Documents','failed save prevents navigation');
  reject=false;await page.locator('[data-app="tasks"]').click();await page.locator('[data-draft-choice="save"]').click();
  await page.waitForFunction(()=>document.querySelector('#crumb')?.textContent==='Tasks');
  assert.match(records.find(r=>r.title==='Keep this draft').body,/Keep this content/);
  await create();const discardBefore=writes.length;
  await page.locator('[data-app="documents"]').click();await page.locator('[data-draft-choice="discard"]').click();
  await page.waitForFunction(()=>document.querySelector('#crumb')?.textContent==='Documents');
  assert.equal(writes.length,discardBefore);
  const {testDraftFolders}=await import('./draft-folders.browser.mjs');await testDraftFolders(page,url);
  if(process.argv.includes('--regressions')){
    for(const [file,name] of [['mail-reply','testMailReply'],['mail-sender','testMailSender'],['mail-send','testMailSend'],['commands','testCommands']]){
      if(process.argv.includes('--commands')&&file!=='commands')continue;
      const test=await import('./'+file+'.browser.mjs');await test[name](page,url);
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS drafts: all seven apps, manual first save, subsequent autosave, discard, save/cancel/discard navigation, failed save and retry, preview/sheets/export/sync/attachment gates.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
