import assert from 'node:assert/strict';

export async function testAccountFolders(page,url) {
  const accounts=[
    {id:'imap-a',label:'Personal IMAP',type:'imap',folders:[]},
    {id:'imap-b',label:'Work IMAP',type:'imap',folders:[{id:'Travel',name:'Travel',delimiter:'/',protected:false}]},
    {id:'gmail-a',label:'Personal Gmail',type:'google',folders:[{id:'Label_travel',name:'Travel',delimiter:'/',protected:false},{id:'Label_orders',name:'Order Confirmations',delimiter:'/',protected:false},{id:'INBOX',name:'Inbox',delimiter:'/',protected:true}]},
  ];
  const discovered=[{id:'INBOX',name:'Inbox',delimiter:'/',protected:true},{id:'Travel',name:'Travel',delimiter:'/',protected:false},{id:'Travel/Orders',name:'Travel/Orders',delimiter:'/',protected:false}];
  const mail=(id,account,path,extra={})=>({id,kind:'mail',title:id,body:'Cached fixture body',revision:1,meta:{read:true,account,remote:true,folder:'Custom folder',serverFolder:path,providerId:id,from:'sender@example.com',...extra}});
  let records=[mail('Personal trip','imap-a','Travel'),mail('Personal booking','imap-a','Travel'),mail('Nested receipt','imap-a','Travel/Orders'),mail('Work trip','imap-b','Travel'),mail('Label message','gmail-a','',{folder:'Inbox',labelIds:['INBOX','Label_travel','Label_orders']})];
  let failed=false,requests=[],holdNext=false,releaseSync;
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r'),input=route.request().postDataJSON();let json;
    requests.push({action,input});
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts};
    else if(action==='sync')json={count:0};
    else if(action==='records')json={records};
    else if(action==='save'){
      const record={...input,id:input.id||'new-local-draft',revision:(input.revision||0)+1};records=records.filter(r=>r.id!==record.id);records.push(record);json={record};
    }
    else if(action==='mail-folders'){
      const a=accounts.find(a=>a.id===input.account);if(a.id==='imap-a'&&!a.folders.length)a.folders=structuredClone(discovered);json={folders:a.folders};
    }else if(action==='mail-folder-sync'){
      if(holdNext){holdNext=false;await new Promise(resolve=>releaseSync=resolve);}
      if(failed){await route.fulfill({status:503,json:{error:'Folder connection unavailable'}});return;}
      json={count:2};
    }else if(action==='mail-folder-manage'){
      const a=accounts.find(a=>a.id===input.account);
      if(input.action==='create')a.folders.push({id:input.name,name:input.name,delimiter:'/',protected:false});
      if(input.action==='rename'){const f=a.folders.find(f=>f.id===input.folder);f.id=input.name;f.name=input.name;}
      if(input.action==='delete')a.folders=a.folders.filter(f=>f.id!==input.folder);
      json={folders:a.folders};
    }else if(action==='mail-action'){
      const r=records.find(r=>r.id===input.id);assert.equal(input.revision,r.revision);r.revision++;
      if(r.meta.account.startsWith('imap'))r.meta.serverFolder=input.folder;
      else if(input.action==='unlabel')r.meta.labelIds=r.meta.labelIds.filter(l=>l!==input.folder);
      else {r.meta.labelIds=[...new Set([...r.meta.labelIds,input.folder])];if(input.action==='move'){r.meta.labelIds=r.meta.labelIds.filter(l=>!['INBOX','TRASH'].includes(l));r.meta.folder='Archive';}}
      json={record:r};
    }else throw Error('Unexpected custom folder API: '+action);
    await route.fulfill({json});
  });
  const open=async(account,folder)=>{const tree=page.locator(`[data-account-tree="${account}"]`);if(!await tree.evaluate(d=>d.open))await tree.locator(':scope > summary').click();await tree.locator('[data-open-folder]').filter({hasText:folder}).last().click();await page.waitForFunction(()=>document.querySelector('#folder-refresh')&&!document.querySelector('#sync-button').disabled);};
  try{
    await page.goto(url+'#mail');await page.reload();await page.locator('.shell').waitFor();
    assert.equal(await page.locator('.sidebar #mail-folder-navigation .account-folders').count(),1,'account folders belong to the application sidebar');
    assert.equal(await page.locator('.search-wrap .account-folders, .search-wrap #mail-folder').count(),0,'message search area contains no folder navigation');
    assert.ok(await page.locator('[data-app="mail"]').evaluate(button=>button.compareDocumentPosition(document.querySelector('#mail-folder-navigation'))&Node.DOCUMENT_POSITION_FOLLOWING));
    assert.ok(await page.locator('#mail-folder-navigation').evaluate(panel=>panel.compareDocumentPosition(document.querySelector('[data-app="calendar"]'))&Node.DOCUMENT_POSITION_FOLLOWING));
    await page.locator('[data-account-tree="imap-a"] > summary').click();
    await page.locator('[data-refresh-folders="imap-a"]').click();
    await page.locator('[data-open-folder="Travel/Orders"]').waitFor();
    await open('imap-a','Travel');await page.locator('.item').filter({hasText:'Personal trip'}).waitFor();
    assert.equal(await page.locator('.item').count(),2,'same-named folders stay account scoped');
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'Personal booking','Opening an account folder selects its first message');
    await page.locator('.item').filter({hasText:'Personal trip'}).click();
    await page.locator('#folder-more').click();
    await page.waitForFunction(()=>document.querySelector('.folder-current small').textContent.includes('20 recent'));
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'Personal trip','Folder refresh preserves the selected message');
    assert.ok(requests.some(r=>r.action==='mail-folder-sync'&&r.input.limit===20));
    await page.locator('.item').filter({hasText:'Personal trip'}).click();await page.locator('#main').focus();await page.keyboard.press('v');
    await page.locator('.item').filter({hasText:'Personal booking'}).click();await page.locator('#main').focus();await page.keyboard.press('v');
    await page.getByRole('button',{name:'Move / Labels',exact:true}).click();
    await page.locator('#file-mail-form [name="folder"]').selectOption('Travel/Orders');await page.locator('#file-mail-form button').click();
    await page.getByRole('heading',{name:'No messages in this folder.',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.action==='mail-action').length,2,'bulk move files each selected message');
    await open('imap-a','Orders');await page.locator('.item').filter({hasText:'Personal booking'}).waitFor();assert.equal(await page.locator('.item').count(),3);
    failed=true;await page.locator('#folder-refresh').click();await page.getByText('Folder connection unavailable',{exact:true}).waitFor();assert.equal(await page.locator('.item').count(),3,'failed refresh keeps cached messages');failed=false;
    await open('imap-b','Travel');await page.locator('.item').filter({hasText:'Work trip'}).waitFor();assert.equal(await page.locator('.item').count(),1);
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'Work trip','Switching accounts selects mail from the new account');
    await open('gmail-a','Travel');await page.locator('.item').filter({hasText:'Label message'}).click();
    await page.getByRole('button',{name:'Move / Labels',exact:true}).click();
    await page.getByRole('heading',{name:'Organize with labels',exact:true}).waitFor();
    assert.equal(await page.locator('#file-mail-form [name="folder"] option[value="INBOX"]').count(),0,'Gmail organization offers custom labels');
    await page.locator('#file-mail-form [name="folder"]').selectOption('Label_travel');await page.locator('#file-mail-form [name="action"]').selectOption('unlabel');await page.locator('#file-mail-form button').click();
    await page.getByRole('heading',{name:'No messages in this folder.',exact:true}).waitFor();
    assert.deepEqual(records.find(r=>r.id==='Label message').meta.labelIds,['INBOX','Label_orders']);
    await open('gmail-a','Order Confirmations');await page.locator('.item').filter({hasText:'Label message'}).waitFor();
    await page.locator('[data-manage-folder="create"][data-folder-account="gmail-a"]').click();
    await page.locator('#folder-name-form input').fill('New label');await page.locator('#folder-name-form button').click();await page.locator('[data-open-folder="New label"]').waitFor();
    await open('gmail-a','New label');await page.locator('[data-manage-folder="rename"]').click();await page.locator('#folder-name-form input').fill('Renamed label');await page.locator('#folder-name-form button').click();await page.locator('[data-open-folder="Renamed label"]').waitFor();
    await open('gmail-a','Renamed label');await page.locator('[data-manage-folder="delete"]').click();await page.locator('#confirm').click();await page.waitForFunction(()=>!document.querySelector('[data-open-folder="Renamed label"]'));
    await open('gmail-a','Inbox');assert.equal(await page.locator('[data-manage-folder="delete"], [data-manage-folder="rename"]').count(),0,'system folder has no rename/delete controls');
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.locator('#mail-folder-navigation').isVisible(),false);
    await page.locator('#mail-folders-toggle').click();await page.locator('#mail-folder-navigation').waitFor({state:'visible'});
    await page.screenshot({path:'test-results/account-folders-mobile.png',fullPage:true});
    await open('imap-b','Travel');await page.locator('#mail-folder-navigation').waitFor({state:'hidden'});
    assert.equal(await page.locator('#mail-folders-toggle').getAttribute('aria-expanded'),'false');
    await page.setViewportSize({width:1440,height:1000});await open('imap-a','Orders');await page.screenshot({path:'test-results/account-folders.png',fullPage:true});
    holdNext=true;await page.locator('#folder-refresh').click();
    await page.waitForFunction(()=>document.querySelector('#folder-refresh').disabled);
    await page.getByRole('button',{name:'+ Compose',exact:true}).click();
    await page.locator('[name="body"]').fill('Keep typing while a folder request finishes.');
    const refreshed=page.waitForResponse(r=>r.url().includes('r=mail-folder-sync'));releaseSync();await refreshed;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[name="body"]').inputValue(),'Keep typing while a folder request finishes.','late folder response cannot replace a dirty draft');
    await page.keyboard.press('Escape');await page.getByText('Saved',{exact:true}).waitFor();
    console.log('PASS account folders: discovery, nesting, account isolation, load more, cached failure, bulk filing, Gmail labels, management, system protection, mobile.');
  }finally{await page.unroute(routes);await page.goto(url+'#mail');await page.reload();await page.locator('.shell').waitFor();}
}
