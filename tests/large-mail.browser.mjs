import assert from 'node:assert/strict';

export async function testLargeMail(page,url) {
  await page.goto('about:blank');
  let record={id:'large-mail-fixture',kind:'mail',title:'Large mail fixture',body:'',revision:1,meta:{remote:true,account:'large-account',folder:'Inbox',read:true,from:'sender@example.com',headerOnly:true,messageSize:8124123,gmailMessageId:'99001',providerId:'1',serverFolder:'INBOX',uidValidity:'1',source:'imap-folder:INBOX:1:1'}};
  const routes=target=>target.pathname.endsWith('/api.php')&&['records','accounts','mail-action'].includes(target.searchParams.get('r'));
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records')return route.fulfill({json:{records:[record]}});
    const input=route.request().postDataJSON();assert.equal(input.action,'trash');assert.equal(input.revision,record.revision);
    record={...record,revision:record.revision+1,meta:{...record.meta,folder:'Trash',serverFolder:'[Gmail]/Trash'}};
    return route.fulfill({json:{record}});
  });
  try {
    await page.goto(url+'?large-mail-test#mail');
    await page.getByRole('heading',{name:'Large mail fixture',exact:true}).waitFor();
    const note=page.locator('.mail-body .recurrence-note');
    assert.ok((await note.textContent()).includes('8.1 MB'));assert.ok((await note.textContent()).includes('headers'));
    assert.equal(await page.getByRole('button',{name:'Download original EML',exact:true}).count(),0);
    assert.equal(await page.getByText('This email contains only text.',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Moved to Trash.'}).waitFor();
    await page.locator('#mail-folder').selectOption('Trash');await page.getByRole('button',{name:'Restore to Inbox',exact:true}).waitFor();
    assert.ok((await note.textContent()).includes('8.1 MB'));
    console.log('PASS large-mail reader: header-only size notice, no fake original EML, Gmail Trash action and retained metadata.');
  }finally{await page.unroute(routes);await page.reload();}
}
