import assert from 'node:assert/strict';
export async function testCommands(page,url) {
  await page.goto('about:blank');
  let authenticated=true,creates=[],logout=0,saves=0,releaseCreate,createStarted,failLogout=false;
  const notices=[];
  let backupCalls=0,finishBackup,backupStarted;
  const backupPending=new Promise(resolve=>{backupStarted=resolve;});
  const synced=[];
  const openedFolders=[];
  const accounts=[{id:'work-mail',label:'Work Account',type:'imap'},{id:'work-calendar',label:'Work Account',type:'caldav'},{id:'personal-mail',label:'Personal',type:'imap'}];
  const records=[{id:'headers',kind:'mail',title:'Header fixture',body:'Body',revision:1,meta:{folder:'Inbox',read:true,raw:'Subject: Header fixture\r\n\r\nBody'}}];
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated,activity:true,csrf:'fixture',preferences:{}};
    else if(action==='google-settings')json={configured:false,client_id:'',redirect:''};
    else if(action==='accounts')json={accounts};
    else if(action==='mail-junk-settings')json={rules:[],folder:'Junk'};
    else if(action==='backup'){
      backupCalls++;
      if(backupCalls===1){await route.fulfill({status:503,json:{error:'Backup temporarily unavailable.'}});return;}
      await new Promise(resolve=>{finishBackup=resolve;backupStarted();});
      await route.fulfill({contentType:'application/vnd.sqlite3',body:'SQLite format 3\0'});
      return;
    }
    else if(action==='sync'){synced.push(route.request().postDataJSON().id);json={more:false};}
    else if(action==='mail-folder-sync'){openedFolders.push(route.request().postDataJSON());json={more:false};}
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='activity'){if(route.request().method()==='POST')notices.push(route.request().postDataJSON());json={entries:['error','warning','info'].map((level,i)=>({id:i+1,time:'2026-11-03T00:00:00Z',level,phase:'diagnostic',operation:'fixture',message:level+' fixture',duration_ms:null}))};}
    else if(action==='records')json={records:records.filter(r=>r.kind===new URL(route.request().url()).searchParams.get('kind'))};
    else if(action==='save'){const data=route.request().postDataJSON();saves++;if(!data.id&&releaseCreate)await new Promise(resolve=>{releaseCreate.resolve=resolve;createStarted();});const record={...data,id:data.id||'created-'+saves,revision:saves,meta:data.meta||{}};if(!data.id){creates.push(data.kind);records.push(record);}else records.splice(records.findIndex(r=>r.id===data.id),1,record);json={record};}
    else if(action==='logout'){if(failLogout){await route.fulfill({status:500,json:{error:'Logout fixture failed'}});return;}logout++;authenticated=false;json={ok:true};}
    else throw Error('Unexpected command route '+action);
    await route.fulfill({json});
  });
  const saveDraft=async()=>{await page.keyboard.press('Control+s');await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();};
  const run=async text=>{await page.keyboard.press('Escape');await page.locator('#main').focus();await page.keyboard.press(':');await page.locator('#command-input').fill(text);await page.keyboard.press('Enter');};
  const navigate=async(text,target)=>{
    await page.locator('#mode').filter({hasText:'NORMAL'}).waitFor();
    const previous=await page.locator('#main > :first-child').elementHandle();
    await page.locator('#main').focus();await page.keyboard.press(':');await page.locator('#command-input').fill(text);await page.keyboard.press('Enter');
    await page.waitForFunction(element=>!element.isConnected,previous);
    await previous.dispose();
    assert.equal(new URL(page.url()).hash,'#'+target);
  };
  try{
    await page.goto(url+'?command-test#tasks');await page.locator('#main').waitFor();
    const activityColors=await page.evaluate(()=>{
      const probe=document.createElement('span');probe.style.color='var(--danger)';document.body.append(probe);
      const colors={button:getComputedStyle(document.querySelector('#view-activity')).color,danger:getComputedStyle(probe).color};probe.remove();return colors;
    });
    await page.locator('#main').focus();await page.keyboard.press(':');
    assert.equal(await page.locator('#mode').textContent(),'COMMAND');
    await page.locator('#command-input').fill(':new doc');
    await page.evaluate(()=>{document.querySelector('#notice').textContent='Background work';});
    assert.equal(await page.locator('#command-input').inputValue(),':new doc');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#main').evaluate(e=>e===document.activeElement),true);assert.equal(creates.length,0);
    for(const invalid of [':bogus',':new bad',':new linked bad',':q extra',':head extra']){await run(invalid);assert.equal(creates.length,0);assert.equal(logout,0);}
    for(const invalid of [':log extra',':errors extra',':warnings extra']){await run(invalid);assert.equal(await page.locator('#activity-dialog[open]').count(),0);}
    for(const [command,message] of [[':frob','Unknown command: frob'],[':new banana','Unknown parameter: banana']]){
      await run(command);assert.equal(await page.locator('#notice').textContent(),message);
      assert.equal(await page.locator('#view-activity').evaluate(e=>getComputedStyle(e).color),activityColors.button);
      assert.equal(await page.locator('#notice').evaluate(e=>getComputedStyle(e).color),activityColors.danger);
    }
    await run(':<img>');assert.equal(await page.locator('#notice').textContent(),'Unknown command: <img>');assert.equal(await page.locator('#notice img').count(),0);
    assert.equal(notices.length,0);
    await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    synced.length=0;
    await run(':sync Work Account');
    await page.locator('#notice').filter({hasText:'Several accounts have that name'}).waitFor();
    await run(':sync Missing Account');
    await page.locator('#notice').filter({hasText:'No matching account'}).waitFor();
    assert.deepEqual(synced,[]);
    await page.keyboard.press(':');
    await page.locator('#command-input').fill(':sync ');
    assert.equal(await page.getByRole('listbox',{name:'Matching accounts'}).getByRole('option').count(),3);
    await page.locator('#command-input').fill(':sync work-cal');
    assert.equal(await page.getByRole('listbox',{name:'Matching accounts'}).getByRole('option').count(),1);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#command-input').inputValue(),':sync "Work Account"');
    await page.keyboard.press('Enter');
    await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    assert.deepEqual(synced,['work-calendar']);
    synced.length=0;
    await page.locator('#main').focus();
    await page.keyboard.press(':');
    await page.locator('#command-input').fill(':sync personal');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#command-input').inputValue(),':sync Personal');
    await page.locator('#command-input').fill(':sync "Work Account"');
    await page.keyboard.press('Enter');
    await page.locator('#notice').filter({hasText:'Several accounts have that name'}).waitFor();
    assert.deepEqual(synced,[]);
    await run(':sync');
    await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    assert.deepEqual(synced.sort(),['personal-mail','work-calendar','work-mail']);
    accounts.push({id:'work-gmail',label:'Work Account',type:'google'});
    records.push({id:'gmail-inbox',kind:'mail',title:'Gmail Inbox fixture',body:'Body',revision:1,meta:{folder:'Inbox',read:true,remote:true,account:'work-gmail',labelIds:['INBOX']}});
    await page.reload();await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    await run(':mail Work Account');
    await page.locator('#notice').filter({hasText:'Several accounts have that name'}).waitFor();
    assert.equal(new URL(page.url()).hash,'#tasks');
    await page.keyboard.press(':');
    await page.locator('#command-input').fill(':m ');
    assert.equal(await page.getByRole('listbox',{name:'Matching accounts'}).getByRole('option').count(),3);
    await page.locator('#command-input').fill(':m work-gmail');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#command-input').inputValue(),':m "Work Account"');
    await page.keyboard.press('Enter');
    await page.locator('.folder-current').getByText(/Work Account \/ Inbox/i).waitFor();
    await page.locator('#selected-item[data-id=gmail-inbox]').waitFor();
    await page.waitForFunction(()=>!document.querySelector('#sync-button').disabled);
    assert.deepEqual(openedFolders.map(({account,folder})=>[account,folder]),[['work-gmail','INBOX']]);
    await navigate(':t','tasks');
    for(const [command,level,count] of [['errors','error',1],['warnings','warning',1],['log','',3]]){
      await run(':bogus');
      await run(':'+command);await page.locator('#activity-dialog[open]').waitFor();
      assert.equal(await page.locator('#notice').textContent(),'Ready.');
      assert.equal(await page.locator('#activity-level').inputValue(),level);
      await page.waitForFunction(expected=>document.querySelectorAll('#activity-entries li[data-level]').length===expected,count);
      await page.keyboard.press(':');assert.equal(await page.locator('#command-input').count(),0);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:/View activity/}).click();assert.equal(await page.locator('#activity-level').inputValue(),'');await page.keyboard.press('Escape');
    for(const [type,kind] of Object.entries({mail:'mail',event:'calendar',task:'tasks',contact:'contacts',doc:'documents',page:'wiki',sheet:'sheets'})){
      await run(': new '+type);await page.waitForFunction(()=>Boolean(document.activeElement?.closest('#detail'))); await saveDraft();assert.equal(creates.at(-1),kind);
    }
    assert.equal(creates.length,7);
    const navigation={mail:['mail','m'],calendar:['calendar','cal'],tasks:['tasks','t'],contacts:['contacts','con'],documents:['docs','doc','d'],sheets:['sheets','sh'],wiki:['wiki','w'],settings:['settings','set']};
    for(const [target,names] of Object.entries(navigation))for(const name of names){
      await run(':bogus');
      await navigate(':'+name,target);
      assert.doesNotMatch(await page.locator('#notice').textContent(),/Unknown command|Unknown parameter/);
      assert.equal(creates.length,7);
      const before=page.url();await run(':'+name+' extra');assert.equal(page.url(),before);
      assert.equal(await page.locator('#notice').textContent(),target==='mail'
        ?'No matching account. Use Tab to fill an account from the suggestions.'
        :'Unknown parameter: extra');
    }
    await page.locator('#main').focus();await page.keyboard.press(':');
    await page.locator('#command-input').fill(':bac');
    await page.getByRole('listbox',{name:'Matching commands'}).getByRole('option',{name:/:backup/}).waitFor();
    await page.keyboard.press('Tab');assert.equal(await page.locator('#command-input').inputValue(),':backup');
    await page.keyboard.press('Enter');
    const prepare=page.getByRole('button',{name:'Prepare backup',exact:true});
    const backupDownload=page.getByRole('button',{name:/Download SQLite backup/});
    await prepare.waitFor();
    assert.equal(new URL(page.url()).hash,'#settings');assert.equal(backupCalls,0);
    assert.equal(await page.getByRole('button',{name:'Backups settings'}).getAttribute('aria-current'),'page');
    await prepare.click();
    await page.locator('#backup-status').getByText('Backup temporarily unavailable.').waitFor();
    assert.equal(await backupDownload.isVisible(),false);
    await prepare.click();
    await page.getByRole('progressbar',{name:'Backup progress'}).waitFor();
    assert.equal(await prepare.isDisabled(),true);
    assert.equal(await backupDownload.isVisible(),false);
    await backupPending;
    finishBackup();
    await backupDownload.waitFor();
    assert.match(await page.locator('#backup-status').textContent(),/ready to download/i);
    assert.equal(await page.getByRole('progressbar',{name:'Backup progress'}).isVisible(),false);
    await page.locator('#main').focus();await page.keyboard.press('?');
    for(const alias of ['cal','con','doc','sh','set','backup']){
      await page.locator('[data-help-search]').fill(':'+alias);
      assert.ok(await page.locator('.help-table tbody tr').count());
      assert.match(await page.locator('.help-table tbody').textContent(),new RegExp(':'+alias));
    }
    await page.getByRole('button',{name:'Close help',exact:true}).click();
    await navigate(':t','tasks');
    await page.locator('#items [data-id]').first().click();
    await page.locator('#main').focus();
    await page.getByRole('textbox',{name:'Title',exact:true}).evaluate(input=>{input.value='Saved by navigation';input.dispatchEvent(new Event('input',{bubbles:true}));});
    const savesBeforeNavigation=saves;
    await navigate(':cal','calendar');
    assert.ok(saves>savesBeforeNavigation);
    assert.equal(records.find(record=>record.kind==='tasks').title,'Saved by navigation');assert.equal(creates.length,7);
    for(const kind of ['mail','calendar','tasks','contacts','documents','wiki','sheets']){
      await page.locator('[data-app="'+kind+'"]').first().click();
      const before=creates.length;await run(':new "Current app title"');
      await page.waitForFunction(()=>document.activeElement?.closest('#detail')!==null);
      await saveDraft();assert.equal(creates.length,before+1);assert.equal(creates.at(-1),kind);
      assert.equal(records.at(-1).title,'Current app title');
    }
    await page.locator('[data-app="mail"]').first().click();await page.locator('[data-id="headers"]').click();
    await run(':head');await page.locator('.message-headers').waitFor();assert.match(await page.locator('.message-headers').textContent(),/Subject: Header fixture/);await page.keyboard.press('Escape');
    await page.locator('#main').focus();await page.keyboard.press(':');await page.locator('#search').click();assert.equal(await page.locator('#command-input').count(),0);
    await page.locator('#search').pressSequentially(':');assert.equal(await page.locator('#command-input').count(),0);await page.keyboard.press('Escape');

    await page.getByRole('button',{name:'Settings',exact:true}).click();await run(':new');assert.equal(creates.length,14);
    assert.equal(await page.locator('#notice').textContent(),'Specify an item type for :new in Settings.');
    await run(':head');assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#notice').textContent(),'Select a mail message before using :head.');assert.equal(notices.length,0);
    failLogout=true;const loggedFailure=page.waitForResponse(response=>response.url().includes('r=activity')&&response.request().method()==='POST');
    await run(':q');await loggedFailure;await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Logout fixture failed');
    assert.equal(notices.at(-1)?.message,'Logout fixture failed');failLogout=false;
    releaseCreate={};const started=new Promise(resolve=>{createStarted=resolve;});await run(':new task Pending command save');
    await page.locator('#save-status').filter({hasText:/^Unsaved draft$/}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Pending command save');await page.keyboard.press('Control+s');
    await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('Create did not start')),5000))]);
    assert.equal(await page.locator('#save-status').textContent(),'Unsaved draft');
    await page.keyboard.press('Control+s');await page.keyboard.press('Control+s');
    releaseCreate.resolve();releaseCreate=null;await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();
    await page.getByRole('textbox',{name:'Title',exact:true}).fill('Pending command save');assert.equal(creates.length,15);
    await page.keyboard.press('Escape');await page.locator('#search').fill('');await page.locator('#search').pressSequentially(':new');assert.equal(await page.locator('#command-input').count(),0);
    await run(':q');await page.locator('#auth-form').waitFor();assert.equal(logout,1);assert.equal(authenticated,false);assert.equal(records.at(-1).title,'Pending command save');
    await page.getByLabel('Password',{exact:true}).pressSequentially(':q');assert.equal(await page.locator('#command-input').count(),0);
  }finally{releaseCreate?.resolve?.();await page.unroute(routes);await page.goto(url);await page.locator('.shell').waitFor();}
}
