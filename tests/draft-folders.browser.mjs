import assert from 'node:assert/strict';

export async function testDraftFolders(page,url) {
  let sequence=0,failSend=false,failDelete=false;
  const message=(id,folder,account='folder-a',serverFolder)=>({id,kind:'mail',title:id,body:'Source body',revision:1,created:new Date().toISOString(),updated:new Date().toISOString(),meta:{folder,account,serverFolder,remote:true,read:true,from:'sender@example.com'}});
  let records=[message('inbox-source','Inbox'),message('archive-source','Archive'),message('orders-a','Custom folder','folder-a','Orders'),message('orders-b','Custom folder','folder-b','Orders')];
  const routes=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r'),input=route.request().method()==='POST'?route.request().postDataJSON():{};let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{confirmBeforeSend:false}};
    else if(action==='accounts')json={accounts:['a','b'].map(id=>({id:'folder-'+id,label:'Folder '+id,type:'imap',folders:[{id:'Orders',name:'Orders',protected:false}]}))};
    else if(action==='records')json={records};
    else if(['sync','mail-folder-sync'].includes(action))json={count:0};
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='save'){
      const record={...input,id:input.id||'draft-'+(++sequence),revision:(input.revision||0)+1,created:new Date().toISOString(),updated:new Date().toISOString()};
      records=records.filter(r=>r.id!==record.id);records.push(record);json={record};
    }else if(action==='delete'){
      if(failDelete)return route.fulfill({status:500,json:{error:'Fixture discard failed'}});
      records=records.filter(r=>r.id!==input.id);json={ok:true};
    }else if(action==='send'){
      if(failSend)return route.fulfill({status:500,json:{error:'Fixture send failed'}});
      const record=records.find(r=>r.id===input.id);record.meta.folder='Sent';record.revision++;json={ok:true};
    }else if(action==='mail-files'&&input.action==='forward'){
      const record={...message('forward-'+(++sequence),'Drafts'),title:'Forwarded fixture',meta:{folder:'Drafts',sendAccount:'folder-a'}};
      records.push(record);json={record,attachments:[]};
    }else throw Error('Unexpected draft folder API: '+action);
    await route.fulfill({json});
  });
  const folder=page.locator('#mail-folder');
  const compose=async()=>{await page.getByRole('button',{name:'+ Compose',exact:true}).click();await page.locator('#save-status').filter({hasText:'Unsaved draft'}).waitFor();};
  const save=async()=>{await page.keyboard.press('Control+s');await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();};
  const discard=async()=>{await page.locator('#detail [data-action="delete"]').click();await page.locator('#confirm').click();await page.locator('#record-form').waitFor({state:'detached'});};
  const send=async()=>{
    await page.locator('[name="to"]').fill('recipient@example.com');await page.locator('[name="sendAccount"]').selectOption('folder-a');
    await page.locator('[data-action="send"]').click();await page.locator('#notice').filter({hasText:'Message accepted'}).waitFor();
  };
  const openScope=async(account,id)=>{
    const tree=page.locator(`[data-account-tree="${account}"]`);
    if(!await tree.evaluate(node=>node.open))await tree.locator(':scope > summary').click();
    await tree.locator('[data-open-folder="Orders"]').click();await page.locator('#folder-refresh:not([disabled])').waitFor();
    await page.locator(`[data-id="${id}"]`).click();
  };
  const expectScope=async(account,id)=>{
    assert.equal(await folder.inputValue(),'account-folder');
    assert.equal(await page.locator(`[data-account-tree="${account}"] [data-open-folder="Orders"]`).getAttribute('aria-current'),'location');
    assert.deepEqual(await page.locator('#items [data-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),[id]);
  };
  try{
    await page.goto(url+'#mail');await page.reload();await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    for(const origin of ['Inbox','Archive','Local mail','all']){
      await folder.selectOption(origin);await compose();await discard();assert.equal(await folder.inputValue(),origin,'unsaved discard returns to '+origin);
      await compose();await save();assert.equal(await folder.inputValue(),origin==='all'?'all':'Drafts','Save keeps composition open');
      await discard();assert.equal(await folder.inputValue(),origin,'saved discard returns to '+origin);
      await compose();await send();assert.equal(await folder.inputValue(),origin,'successful send returns to '+origin);
    }
    for(const [account,id] of [['folder-a','orders-a'],['folder-b','orders-b']]){
      await openScope(account,id);await page.locator('#search').fill(id);
      await compose();await discard();await expectScope(account,id);assert.equal(await page.locator('#search').inputValue(),id);
      await compose();await send();await expectScope(account,id);
      await page.getByRole('button',{name:'Reply',exact:true}).click();await save();await discard();await expectScope(account,id);
      await page.getByRole('button',{name:'Forward',exact:true}).click();await page.locator('.title-input').filter({visible:true}).waitFor();await discard();await expectScope(account,id);
      await page.locator('#search').fill('');
    }
    await folder.selectOption('Inbox');await compose();await save();
    await folder.selectOption('Archive');await folder.selectOption('Drafts');await page.locator('#items [data-id]').first().click();
    await discard();assert.equal(await folder.inputValue(),'Archive','reopening uses the most recently visited folder');
    await compose();await save();
    await page.locator('#selected-item').click({button:'right'});await page.getByRole('menuitem',{name:'Discard Draft…',exact:true}).click();
    await page.locator('#confirm').click();await page.waitForFunction(()=>document.querySelector('#mail-folder')?.value==='Archive');
    await compose();
    await page.locator('#detail [data-action="delete"]').click();await page.locator('#cancel').click();assert.equal(await folder.inputValue(),'Drafts');
    await save();failSend=true;
    await page.locator('[name="to"]').fill('recipient@example.com');await page.locator('[name="sendAccount"]').selectOption('folder-a');
    await page.locator('[data-action="send"]').click();await page.locator('#notice').filter({hasText:'Fixture send failed'}).waitFor();
    assert.equal(await folder.inputValue(),'Drafts');assert.equal(await page.locator('#record-form').count(),1);failSend=false;
    failDelete=true;await page.locator('#detail [data-action="delete"]').click();await page.locator('#confirm').click();
    await page.locator('#notice').filter({hasText:'Fixture discard failed'}).waitFor();assert.equal(await folder.inputValue(),'Drafts');failDelete=false;
    await discard();assert.equal(await folder.inputValue(),'Archive');
    // A saved draft reopened after reloading uses the most recently visited folder.
    await compose();await save();await page.reload();await folder.waitFor();
    await folder.selectOption('Archive');await folder.selectOption('Drafts');
    await page.locator('#items [data-id]').first().click();await discard();assert.equal(await folder.inputValue(),'Archive');
    console.log('PASS draft folders: standard/custom folders, account isolation, search, compose/reply/forward, saved/unsaved discard, send, cancel/failures and reopened drafts.');
  }finally{await page.unroute(routes);await page.reload();}
}
