import assert from 'node:assert/strict';

export async function testMailList(page,url) {
  let preferences={};
  const records=[
    {id:'layout-a',kind:'mail',title:'Project update',body:'\n  First body line with <safe> text '+ 'long text '.repeat(60)+'\nSecond line must stay hidden',revision:1,meta:{from:'Alex Morgan <alex@example.com>',date:'2026-11-01T14:00:00Z',folder:'Inbox',read:true,hasAttachments:true}},
    {id:'layout-b',kind:'mail',title:'Headers only',body:'',revision:1,meta:{from:'other@example.com',date:'2026-10-31T14:00:00Z',folder:'Inbox',read:false,headerOnly:true,messageSize:2000000}},
    {id:'layout-c',kind:'mail',title:'No attachment',body:'Plain body',revision:1,meta:{from:'third@example.com',folder:'Inbox',read:false,hasAttachments:false}},
  ];
  const routes=t=>t.pathname.endsWith('/api.php')&&t.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    const json=action==='status'?{authenticated:true,csrf:'fixture',preferences}:action==='accounts'?{accounts:[]}:action==='records'?{records}:action==='google-settings'?{configured:false}:action==='preferences'?(preferences=route.request().postDataJSON().preferences,{ok:true}):null;
    assert.ok(json,'Unexpected layout request: '+action);await route.fulfill({json});
  });
  const item=()=>page.locator('#items [data-id="layout-a"]');
  const settings=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Mail settings',exact:true}).click();await page.locator('#mail-list-settings').waitFor();};
  const save=async()=>{await page.getByRole('button',{name:'Save list appearance',exact:true}).click();await page.getByText('List appearance saved.',{exact:true}).waitFor();};
  try {
    await page.goto(url+'?layout-test#mail');await item().waitFor();
    assert.equal(await item().locator('.mail-list-line').count(),3);
    assert.equal(await item().locator('.mail-field-sender').textContent(),'Alex Morgan <alex@example.com>');
    assert.ok((await item().locator('.mail-field-preview').textContent()).startsWith('First body line with <safe>'));
    assert.ok(!(await item().locator('.mail-field-preview').textContent()).includes('Second line'));
    await item().getByRole('img',{name:'Has attachments',exact:true}).waitFor();
    await page.locator('[data-id="layout-b"]').getByRole('img',{name:'Attachment status unknown',exact:true}).waitFor();
    assert.equal(await page.locator('[data-id="layout-c"] .mail-field-attachment').textContent(),'');
    for(const theme of ['light','dark'])for(const compact of [false,true]) {
      await page.evaluate(({theme,compact})=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('compact',compact);},{theme,compact});
      assert.equal(await item().locator('.mail-field-sender').evaluate(el=>getComputedStyle(el).fontWeight),'400');
      assert.equal(await page.locator('[data-id="layout-b"] .mail-field-subject').evaluate(el=>getComputedStyle(el).fontWeight),'700');
      assert.ok(await item().locator('.mail-field-preview').evaluate(el=>el.scrollWidth>el.clientWidth&&getComputedStyle(el).textOverflow==='ellipsis'));
    }
    await settings();
    await page.getByLabel('Sender format',{exact:true}).selectOption('email');
    await page.getByLabel('Line 1 left field',{exact:true}).selectOption('subject');
    await page.getByLabel('Line 1 left text size',{exact:true}).selectOption('large');
    await page.getByLabel('Line 2 left field',{exact:true}).selectOption('sender');
    await page.getByLabel('Line 3 left field',{exact:true}).selectOption('none');
    assert.equal(await page.locator('.mail-layout-preview .mail-list-line').count(),2);
    assert.equal(await page.locator('.mail-layout-preview .mail-field-sender').textContent(),'alex@example.com');
    await save();await page.getByRole('button',{name:'Mail',exact:true}).click();
    assert.equal(await item().locator('.mail-list-line').count(),2);
    assert.equal(await item().locator('.mail-list-line').first().locator('.mail-list-large').textContent(),'Project update');
    await page.reload();await item().waitFor();assert.equal(await item().locator('.mail-field-sender').textContent(),'alex@example.com');
    await settings();await page.getByRole('button',{name:'Reset to default',exact:true}).click();await save();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.getByRole('button',{name:'Mail',exact:true}).click();await item().waitFor();
    assert.equal(await item().locator('.mail-list-line').count(),3);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:'test-results/mail-list-mobile.png'});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'test-results/mail-list-default.png'});
    preferences={mailList:{sender:'bad',rows:[null,null,null]}};await page.reload();await item().waitFor();
    assert.equal(await item().locator('.mail-list-line').count(),3,'Malformed imported preferences fall back safely');
    console.log('PASS mail list: default lines, escaping, attachments, unknown status, truncation, themes/density, live preview, customization, persistence, reset, mobile and malformed preferences.');
  } finally {await page.setViewportSize({width:1440,height:1000});await page.unroute(routes);await page.reload();}
}
