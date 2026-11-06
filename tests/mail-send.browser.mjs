import assert from 'node:assert/strict';

export async function testMailSend(page,url) {
  let preferences={},sequence=0,sends=[],rejectSave=false,failSend=false,holdSend=false,releaseSend;
  const received={id:'send-received',kind:'mail',title:'Received fixture',body:'Received body',revision:1,meta:{read:true,remote:true,account:'send-account',folder:'Inbox',from:'sender@example.com'}};
  let records=[received];
  const routes=target=>target.pathname.endsWith('/api.php') && target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r'),input=route.request().method()==='POST'?route.request().postDataJSON():{};let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences};
    else if(action==='accounts')json={accounts:[{id:'send-account',label:'Send fixture',type:'imap'}]};
    else if(action==='records')json={records};
    else if(action==='sync')json={count:0};
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='mail-junk-settings')json={rules:[],folder:'Junk'};
    else if(action==='google-settings')json={configured:false};
    else if(action==='preferences'){preferences=input.preferences;json={ok:true};}
    else if(action==='save'){
      if(rejectSave)return route.fulfill({status:500,json:{error:'Draft save failed for test'}});
      const record={...input,id:input.id||'send-draft-'+(++sequence),revision:(input.revision||0)+1,updated:new Date().toISOString()};
      records=records.filter(r=>r.id!==record.id);records.push(record);json={record};
    }else if(action==='send'){
      const record=records.find(r=>r.id===input.id);assert.ok(record);assert.equal(record.meta.folder,'Drafts');assert.equal(input.revision,record.revision);
      sends.push(structuredClone(record));
      if(holdSend)await new Promise(resolve=>releaseSend=resolve);
      record.meta.folder=failSend?'Delivery uncertain':'Sent';record.revision++;
      if(failSend)return route.fulfill({status:500,json:{error:'Delivery uncertain for test'}});
      json={ok:true};
    }else throw Error('Unexpected send fixture API: '+action);
    await route.fulfill({json});
  });
  const body=page.locator('[name="body"]'),sendButton=page.locator('#detail [data-action="send"]');
  const progress=page.getByRole('dialog',{name:'Sending message…'});
  const compose=async(save=true)=>{
    await page.getByRole('button',{name:'+ Compose',exact:true}).click();await body.waitFor();
    await page.getByLabel('To (one recipient)',{exact:true}).fill('recipient@example.com');
    if(save){await page.keyboard.press('Control+s');await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();}
    await body.fill('Send body '+sequence);
  };
  const settings=async enabled=>{
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Mail settings',exact:true}).click();
    const checkbox=page.getByLabel('Confirm before sending',{exact:true});await checkbox.waitFor();
    if(enabled===undefined)return checkbox.isChecked();
    await checkbox.setChecked(enabled);await page.getByRole('button',{name:'Save mail preferences',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Mail preferences saved.'}).waitFor();
  };
  const sent=()=>page.locator('#notice').filter({hasText:'Message accepted by the provider.'}).waitFor();
  try{
    await page.goto(url+'#mail');await page.reload();await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    await page.locator('#main').focus();await page.keyboard.press('Control+Enter');assert.equal(sends.length,0,'Received mail cannot be sent');
    await compose(false);await page.keyboard.press('Control+Enter');await page.locator('#confirm:focus').waitFor();
    assert.equal(await progress.count(),0,'Progress starts after confirmation');
    assert.equal(sends.length,0);assert.equal(sequence,0,'Opening confirmation does not save a new draft');
    await page.keyboard.press('Control+Enter');assert.equal(sends.length,0,'Shortcut does not send through a modal');
    await page.locator('#cancel').click();await page.waitForFunction(()=>!document.querySelector('#detail [data-action="send"]').disabled);
    assert.equal(sequence,0,'Canceling confirmation leaves the message unsaved');
    assert.equal(await body.inputValue(),'Send body 0');
    await sendButton.click();await page.locator('#confirm:focus').waitFor();await page.keyboard.press('Enter');await sent();
    assert.equal(sends.length,1,'Enter confirms sending a new message');
    assert.equal(sends[0].body,'Send body 0');
    assert.equal(await settings(),true,'Confirmation defaults to enabled');
    await settings(false);await page.reload();
    assert.equal(await page.getByLabel('Confirm before sending',{exact:true}).isChecked(),false,'Checkbox persists across reload');
    await page.getByRole('button',{name:'Mail',exact:true}).click();
    const folder=page.locator('#mail-folder');
    await folder.selectOption('Archive');await compose();
    holdSend=true;await page.keyboard.press('Control+Enter');
    await page.waitForFunction(()=>document.querySelector('#detail [data-action="send"]').disabled);
    while(!releaseSend)await new Promise(resolve=>setTimeout(resolve,10));
    await progress.waitFor();
    assert.equal(await folder.inputValue(),'Drafts','Composer stays open while delivery is pending');
    await page.keyboard.press('Escape');
    assert.equal(await progress.isVisible(),true,'Escape cannot dismiss a pending send');
    await page.keyboard.press('Control+Enter');await page.keyboard.press('Control+Enter');
    await page.evaluate(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,repeat:true,bubbles:true,cancelable:true})));
    assert.equal(sends.length,2,'Repeated shortcuts cannot create duplicate sends');assert.equal(await page.locator('#dialog[open]').count(),0);
    holdSend=false;releaseSend();await progress.waitFor({state:'detached'});await sent();
    assert.equal(await folder.inputValue(),'Archive','Sending returns to the original folder');
    await compose();await sendButton.click();await sent();assert.equal(sends.length,3,'Button also skips disabled confirmation');
    await compose();await body.focus();await page.keyboard.press('Alt+Enter');assert.equal(sends.length,3,'Alt+Enter no longer sends');
    await page.keyboard.press('Control+Shift+Enter');assert.equal(sends.length,3,'Extra modifiers do not send');
    await page.getByLabel('To (one recipient)',{exact:true}).fill('');await body.focus();await page.keyboard.press('Control+Enter');assert.equal(sends.length,3,'Recipient validation applies to shortcut');
    await page.getByLabel('To (one recipient)',{exact:true}).fill('recipient@example.com');
    await page.getByLabel('Send using',{exact:true}).selectOption('');await body.focus();await page.keyboard.press('Control+Enter');
    await page.locator('#notice').filter({hasText:'Choose a sending account first.'}).waitFor();assert.equal(sends.length,3);
    await page.getByLabel('Send using',{exact:true}).selectOption('send-account');await body.fill('Unsaved after error');rejectSave=true;
    await page.keyboard.press('Control+Enter');await page.locator('#notice').filter({hasText:'Draft save failed for test'}).waitFor();assert.equal(sends.length,3);
    assert.equal(await progress.count(),0,'Progress closes if saving fails');
    rejectSave=false;failSend=true;await body.focus();await page.keyboard.press('Control+Enter');
    await page.locator('#notice').filter({hasText:'Delivery uncertain for test'}).waitFor();assert.equal(sends.length,4);
    assert.equal(await progress.count(),0,'Progress closes if delivery fails');
    await page.locator('#main').focus();await page.keyboard.press('Control+Enter');assert.equal(sends.length,4,'Uncertain delivery is not resent');
    failSend=false;await settings(true);await page.getByRole('button',{name:'Mail',exact:true}).click();await compose();
    await page.keyboard.press('Control+Enter');await page.locator('#confirm').waitFor();
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#detail [data-action="send"]').disabled);
    await page.keyboard.press('Control+Enter');await page.locator('#confirm').click();await sent();assert.equal(sends.length,5,'Confirmation can be re-enabled and Escape cancels');
    console.log('PASS mail sending: Ctrl+Enter while typing, saved edits, default confirmation/cancel, persistent checkbox, button parity, repeated keys, validation, save/send failures and uncertain-delivery guard.');
  }finally{releaseSend?.();await page.unroute(routes);await page.reload();}
}
