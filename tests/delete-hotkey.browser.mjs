import assert from 'node:assert/strict';

export async function testDeleteHotkey(page,url) {
  const status=await(await page.request.get(url+'api.php?r=status')).json();
  for(const [kind,app] of Object.entries({tasks:'Tasks',documents:'Documents',sheets:'Sheets',contacts:'Contacts',calendar:'Calendar',wiki:'Wiki',mail:'Mail'})) {
    const title='Delete shortcut '+kind;
    const meta=kind==='sheets'?{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}:{};
    const response=await page.request.post(url+'api.php?r=import-items',{headers:{'X-CSRF-Token':status.csrf},data:{records:[{kind,title,body:'',meta}]}});
    assert.equal(response.status(),200);
    await page.getByRole('button',{name:app,exact:true}).click();
    if(kind==='mail')await page.locator('#mail-folder').selectOption('all');
    await page.locator('.item').filter({hasText:title}).click();
    await page.locator('#search').fill('d');
    await page.keyboard.press('d');
    assert.equal(await page.locator('#search').inputValue(),'dd');
    assert.equal(await page.locator('#dialog[open]').count(),0);
    await page.locator('#search').fill('');
    await page.locator('#main').focus();
    await page.keyboard.press('Alt+d');
    assert.equal(await page.locator('#dialog[open]').count(),0);
    await page.locator('#main').focus();
    await page.keyboard.press('d');
    await page.getByRole('heading',{name:'Delete item',exact:true}).waitFor();
    await page.keyboard.press('d');
    assert.equal(await page.locator('#dialog[open]').count(),1);
    await page.locator('#cancel').click();
    assert.equal(await page.locator('.item').filter({hasText:title}).count(),1);
    await page.locator('#main').focus();await page.keyboard.press('d');
    await page.locator('#confirm').click();
    await page.locator('.item').filter({hasText:title}).waitFor({state:'detached'});
    await page.locator('#notice').filter({hasText:'Item deleted.'}).waitFor();
    assert.equal(await page.locator('.item').filter({hasText:title}).count(),0);
  }
  console.log('PASS delete shortcut: all seven local apps, confirmation, cancellation, typing, modifiers, and modal guard.');
}
