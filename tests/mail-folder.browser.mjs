import assert from 'node:assert/strict';

export async function testMailFolder(page,url) {
  const message={id:'inbox-message',kind:'mail',title:'Inbox folder fixture',body:'Inbox message body',revision:1,meta:{folder:'Inbox',from:'sender@example.com'}};
  const draft={id:'folder-draft',kind:'mail',title:'Folder draft fixture',body:'Original draft',revision:1,meta:{folder:'Drafts'}};
  const second={...message,id:'second-inbox-message',title:'Second inbox fixture'};
  let records=[message,second,draft], failSave=false;
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[]};
    else if(action==='records')json={records};
    else if(action==='save'){
      if(failSave){await route.fulfill({status:500,json:{error:'Folder switch save failed'}});return;}
      const input=route.request().postDataJSON();
      const record={...input,revision:input.revision+1,updated:new Date().toISOString()};
      records=records.map(r=>r.id===record.id?record:r);json={record};
    }else throw Error('Unexpected fixture API: '+action);
    await route.fulfill({json});
  });
  const folder=page.locator('#mail-folder');
  const open=title=>page.locator('.item').filter({hasText:title}).click();
  try {
    await page.goto(url+'#mail');await page.reload();await folder.waitFor();
    await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id==='inbox-message');
    assert.equal(await page.locator('#detail .mail-body').textContent(),message.body,'Opening Mail displays the first message');
    await open(second.title);
    await page.getByRole('button',{name:'Mark unread',exact:true}).waitFor();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),second.id,'Reloading after an action preserves selection');
    await page.getByRole('button',{name:'Contacts',exact:true}).click();
    await page.getByRole('button',{name:'Mail',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id==='inbox-message');
    await open(message.title);
    await page.locator('#main').focus();await page.keyboard.press('v');
    assert.equal(await page.locator('#selection-count').textContent(),'1 selected');
    await folder.selectOption('Sent');
    await page.getByRole('heading',{name:'No messages in this folder.',exact:true}).waitFor();
    assert.equal(await page.locator('#detail .mail-body, #detail [data-action="reply"]').count(),0,'Empty folder clears the previous message and actions');
    assert.equal(await page.locator('#selection-count').textContent(),'','Folder switch clears bulk selection');

    await folder.selectOption('Inbox');
    await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id==='inbox-message');
    await open(message.title);await folder.selectOption('Drafts');
    await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id==='folder-draft');
    assert.equal(await page.locator('#detail .mail-body').count(),0,'Populated folder also clears the previous message');
    await open(draft.title);
    await page.locator('[name="body"]').fill('Saved before leaving the folder');
    await folder.selectOption('Sent');
    await page.getByRole('heading',{name:'No messages in this folder.',exact:true}).waitFor();
    assert.equal(records.find(r=>r.id===draft.id).body,'Saved before leaving the folder');
    await folder.selectOption('Drafts');await open(draft.title);
    assert.equal(await page.locator('[name="body"]').inputValue(),'Saved before leaving the folder');

    failSave=true;
    await page.locator('[name="body"]').fill('Keep this unsaved draft visible');
    await folder.selectOption('Sent');
    await page.getByText('Folder switch save failed',{exact:true}).waitFor();
    assert.equal(await folder.inputValue(),'Drafts','Save failure restores the folder selector');
    assert.equal(await folder.isEnabled(),true);
    assert.equal(await page.locator('[name="body"]').inputValue(),'Keep this unsaved draft visible','Save failure preserves the editor');
    failSave=false;await folder.selectOption('Sent');
    await page.getByRole('heading',{name:'No messages in this folder.',exact:true}).waitFor();
    console.log('PASS mail folders: first-message selection on startup, reopening and folder switches, selection preserved on reload, empty folders, bulk selection, draft save and failed-save recovery.');
  } finally {await page.unroute(routes);await page.goto(url+'#mail');await page.reload();await page.locator('.shell').waitFor();}
}
