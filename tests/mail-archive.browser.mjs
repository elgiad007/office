import assert from 'node:assert/strict';

export async function testMailArchive(page, url) {
  const message={id:'archive-fixture',kind:'mail',title:'Archive verification fixture',body:'Fixture body',revision:1,updated:new Date().toISOString(),meta:{remote:true,account:'archive-account',folder:'Inbox',from:'sender@example.com'}};
  let messages=[message],reject=true,recover=false,providerWrites=0,repairs=0;
  const routes=target=>target.pathname.endsWith('/api.php') && ['records','accounts','sync','mail-action'].includes(target.searchParams.get('r'));
  await page.route(routes,async route=>{
    const target=new URL(route.request().url()), action=target.searchParams.get('r');
    if(action==='records') {
      if(target.searchParams.get('kind')!=='mail') return route.continue();
      return route.fulfill({json:{records:messages}});
    }
    if(action==='accounts') return route.fulfill({json:{accounts:[{id:'archive-account',label:'Archive fixture',type:'imap'}]}});
    const input=route.request().postDataJSON();
    if(action==='sync') {
      if(input.repair){repairs++;messages.push({...message,id:'repaired-message',title:'Repaired server message',body:'Fresh server content',meta:{...message.meta,remote:true,folder:'Inbox'}});}
      if(recover){message.meta.folder='Recovery copies';message.revision++;recover=false;}
      return route.fulfill({json:{count:0}});
    }
    const r=messages.find(r=>r.id===input.id);assert.ok(r);
    if(input.action==='discard'){messages=messages.filter(x=>x.id!==r.id);return route.fulfill({json:{record:null}});}
    if(input.action==='keep-local'){delete r.meta.remote;delete r.meta.account;r.meta.folder='Local mail';r.revision++;return route.fulfill({json:{record:r}});}
    if(reject) return route.fulfill({status:400,json:{error:'Archive could not be confirmed. Use Sync now to update its location.'}});
    providerWrites++;
    r.meta.folder=input.action==='trash'?'Trash':input.action==='restore'?'Inbox':'Archive';r.revision++;
    return route.fulfill({json:{record:r}});
  });
  const folder=async value=>page.locator('#mail-folder').selectOption(value);
  const select=async title=>page.locator('.item').filter({hasText:title}).click();
  const sync=async()=>{await page.locator('#sync-button').click();await page.locator('#sync-button:not([disabled])').waitFor();};
  try {
    await page.goto(url+'#mail');await page.reload();
    await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    await folder('Inbox');await select(message.title);
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Inbox','Cached']);
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Archive could not be confirmed'}).waitFor();
    assert.equal(await page.locator('.item').count(),1);
    reject=false;
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Archived 1 messages.'}).waitFor();
    assert.equal(await page.locator('.item').count(),0);
    await folder('Archive');await select(message.title);
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Archive','Cached']);
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Moved to Trash.'}).waitFor();
    assert.equal(await page.locator('.item').count(),0);
    await folder('Trash');await select(message.title);
    await page.getByRole('button',{name:'Restore to Inbox',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Restored to Inbox.'}).waitFor();
    await folder('Inbox');await select(message.title);
    reject=true;recover=true;
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Archive could not be confirmed'}).waitFor();
    await sync();
    assert.equal(await page.locator('.item').count(),0);
    await folder('all');assert.equal(await page.locator('.item').count(),0);
    await folder('Recovery copies');await select(message.title);
    assert.equal(await page.getByRole('button',{name:'Archive',exact:true}).count(),0);
    const writesBefore=providerWrites;
    await page.getByRole('button',{name:'Save locally',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Saved in Local mail.'}).waitFor();
    await folder('Local mail');await select(message.title);
    assert.deepEqual(await page.locator('.item .badge').allTextContents(),['Local mail']);
    messages.push({...message,id:'discard-fixture',title:'Discard recovery fixture',meta:{remote:true,account:'archive-account',folder:'Recovery copies'}});
    await sync();await folder('Recovery copies');await select('Discard recovery fixture');
    await page.getByRole('button',{name:'Discard copy',exact:true}).click();
    await page.locator('#dialog').getByRole('button',{name:'Discard copy',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Cached copy discarded.'}).waitFor();
    assert.equal(await page.locator('.item').count(),0);assert.equal(providerWrites,writesBefore);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Repair / resync',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Mail folders resynchronized.'}).waitFor();
    assert.equal(repairs,1);
    await page.getByRole('button',{name:'Mail',exact:true}).click();await folder('Inbox');await select('Repaired server message');
    assert.ok((await page.locator('.mail-body').textContent()).includes('Fresh server content'));
    await folder('Local mail');assert.equal(await page.locator('.item').count(),1);
    await page.screenshot({path:'test-results/mail-archive.png',fullPage:true});
    console.log('PASS mail UI: verified archive, Trash/restore, separate recovery, local save/discard without server writes, and Repair / resync preserving local mail.');
  } finally { await page.unroute(routes); await page.reload(); }
}
