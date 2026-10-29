import assert from 'node:assert/strict';

export async function testMailArchive(page, url) {
  const message={id:'archive-fixture',kind:'mail',title:'Archive verification fixture',body:'Fixture body',revision:1,updated:new Date().toISOString(),meta:{remote:true,account:'archive-account',folder:'Inbox',from:'sender@example.com'}};
  let reject=true;
  const routes=target=>target.pathname.endsWith('/api.php') && ['records','accounts','sync','mail-action'].includes(target.searchParams.get('r'));
  await page.route(routes,async route=>{
    const target=new URL(route.request().url());
    const action=target.searchParams.get('r');
    if(action==='records') {
      if(target.searchParams.get('kind')!=='mail') return route.continue();
      return route.fulfill({json:{records:[message]}});
    }
    if(action==='accounts') return route.fulfill({json:{accounts:[{id:'archive-account',label:'Archive fixture',type:'imap'}]}});
    if(action==='sync') return route.fulfill({json:{count:0}});
    assert.equal(route.request().postDataJSON().id,message.id);
    if(reject) return route.fulfill({status:400,json:{error:'Archive could not be confirmed. The message is still in the server Inbox.'}});
    message.meta.folder='Archive';message.revision++;
    return route.fulfill({json:{record:message}});
  });
  try {
    await page.goto(url+'#mail');await page.reload();
    await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    await page.locator('#mail-folder').selectOption('Inbox');
    await page.locator('.item').filter({hasText:message.title}).click();
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Inbox','Synced']);
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Archive could not be confirmed'}).waitFor();
    assert.equal(await page.locator('.item').filter({hasText:message.title}).count(),1);
    reject=false;
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Archived 1 messages.'}).waitFor();
    assert.equal(await page.locator('.item').filter({hasText:message.title}).count(),0);
    await page.locator('#mail-folder').selectOption('Archive');
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Archive','Synced']);
    await page.reload();
    await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Archive','Synced']);
    const synced=page.waitForResponse(response=>new URL(response.url()).searchParams.get('r')==='sync');
    await page.locator('#sync-button').click();await synced;
    await page.locator('#sync-button:not([disabled])').waitFor();
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Archive','Synced']);
    await page.screenshot({path:'test-results/mail-archive.png',fullPage:true});
    console.log('PASS mail archive UI: rejected move retains Inbox; confirmed archive leaves Inbox and shows Archive + Synced after reload and sync.');
  } finally { await page.unroute(routes); await page.reload(); }
}
