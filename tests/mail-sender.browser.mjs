import assert from 'node:assert/strict';

export async function testMailSender(page,url) {
  let accounts=[{id:'mail-a',label:'Account A',type:'imap'},{id:'mail-b',label:'Account B',type:'google'},{id:'calendar',label:'Calendar only',type:'caldav'}];
  let preferences={defaultMailAccount:'mail-b'}, sequence=0;
  const message={id:'received',kind:'mail',title:'Sender selection fixture',body:'Hello',revision:1,meta:{read:true,folder:'Inbox',remote:true,account:'mail-a',from:'sender@example.com'}};
  let records=[message];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    const input=route.request().method()==='POST'?route.request().postDataJSON():{};
    let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences};
    else if(action==='accounts')json={accounts};
    else if(action==='records')json={records};
    else if(action==='sync')json={count:0};
    else if(action==='google-settings')json={configured:false};
    else if(action==='preferences'){preferences=input.preferences;json={ok:true};}
    else if(action==='save'){
      const record={...input,id:input.id||'draft-'+(++sequence),revision:(input.revision||0)+1,updated:new Date().toISOString()};
      records=records.filter(r=>r.id!==record.id);records.push(record);json={record};
    } else throw Error('Unexpected fixture API: '+action);
    await route.fulfill({json});
  });
  const sender=page.getByLabel('Send using',{exact:true});
  const compose=async()=>{await page.getByRole('button',{name:'+ Compose',exact:true}).click();await sender.waitFor();};
  const reload=async()=>{await page.goto(url+'#mail');await page.reload();await page.getByRole('button',{name:'+ Compose',exact:true}).waitFor();};
  const settings=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Default mail account',{exact:true}).waitFor();};
  try {
    await reload();
    await page.locator('.item').filter({hasText:message.title}).click();
    await page.getByRole('button',{name:'Reply',exact:true}).click();await sender.waitFor();
    assert.equal(await sender.inputValue(),'mail-a','Reply uses the receiving account ahead of the default');
    assert.equal(records.at(-1).meta.sendAccount,'mail-a','Initial sender is saved with the draft');
    await sender.selectOption('mail-b');
    await compose();
    assert.equal(await sender.inputValue(),'mail-b','Compose uses the selected draft’s explicit sender');
    await reload();await page.locator('#mail-folder').selectOption('Drafts');
    await page.locator('.item').filter({hasText:'Re: '+message.title}).click();
    assert.equal(await sender.inputValue(),'mail-b','Manual selection survives reopening');

    await settings();
    assert.equal(await page.getByLabel('Default mail account',{exact:true}).inputValue(),'mail-b');
    assert.equal(await page.getByLabel('Default mail account',{exact:true}).locator('option').count(),3,'Calendar accounts are excluded');
    await page.getByLabel('Default mail account',{exact:true}).selectOption('mail-a');
    await page.getByRole('button',{name:'Save mail preferences',exact:true}).click();
    await page.getByText('Mail preferences saved.',{exact:true}).waitFor();
    await page.reload();
    assert.equal(await page.getByLabel('Default mail account',{exact:true}).inputValue(),'mail-a','Default survives reload');
    await page.getByRole('button',{name:'Mail',exact:true}).click();await page.locator('#mail-folder').selectOption('Sent');await compose();
    assert.equal(await sender.inputValue(),'mail-a','Compose without a selected message uses the default');

    preferences={};accounts=accounts.filter(a=>a.id!=='mail-b');
    await reload();await compose();
    assert.equal(await sender.inputValue(),'mail-a','One mail account is selected automatically');
    await reload();await page.locator('#mail-folder').selectOption('Drafts');
    await page.locator('.item').filter({hasText:'Re: '+message.title}).click();
    assert.equal(await sender.inputValue(),'mail-b','A removed explicit sender is not silently replaced');
    assert.match(await sender.locator('option:checked').textContent(),/Unavailable account/);
    await sender.selectOption('mail-a');await page.keyboard.press('Escape');
    await page.getByText('Saved',{exact:true}).waitFor();

    accounts.push({id:'mail-c',label:'Account C',type:'imap'});preferences={defaultMailAccount:'removed'};
    records.push({id:'old-draft',kind:'mail',title:'Old draft without sender',body:'',revision:1,meta:{folder:'Drafts'}});
    await reload();await page.locator('#mail-folder').selectOption('Sent');await compose();
    assert.equal(await sender.inputValue(),'','A removed default is ignored when multiple accounts remain');
    preferences={defaultMailAccount:'mail-c'};
    await reload();await page.locator('#mail-folder').selectOption('Drafts');
    await page.locator('.item').filter({hasText:'Old draft without sender'}).click();
    assert.equal(await sender.inputValue(),'mail-c','Existing blank drafts receive the default');
    await page.locator('#main').focus();await page.keyboard.press('s');
    await page.getByText('Saved',{exact:true}).waitFor();
    assert.equal(records.find(r=>r.id==='old-draft').meta.sendAccount,'mail-c');

    accounts=[{id:'calendar',label:'Calendar only',type:'caldav'}];
    await reload();await compose();
    assert.equal(await sender.inputValue(),'','No mail account leaves the choice blank');
    console.log('PASS mail sender: context, replies, defaults, persistence, single account, removed accounts and old drafts.');
  } finally {await page.unroute(routes);await page.goto(url+'#mail');await page.reload();await page.locator('.shell').waitFor();}
}
