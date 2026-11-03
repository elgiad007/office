import assert from 'node:assert/strict';

export async function testMessageHeaders(page,url) {
  await page.goto('about:blank');
  const headers='Received: first\r\nReceived: second\r\n\tfolded\r\nSubject: <img src=x onerror=alert(1)> café';
  const records=['raw','legacy','cached','missing'].map(id=>({id,kind:'mail',title:id,body:'Body secret',revision:1,summary:id==='raw',meta:{folder:'Inbox',read:true,from:'sender@example.com',...(id==='legacy'?{raw:headers+'\n\nBody secret'}:id==='cached'?{headerOnly:true,headersBase64:Buffer.from(headers).toString('base64')}: {})}}));
  let localReads=0;
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[]};
    else if(action==='activity')json={entries:[]};
    else if(action==='records')json={records};
    else if(action==='record'){localReads++;json={record:{...records[0],summary:false,meta:{...records[0].meta,rawBase64:Buffer.from(headers+'\r\n\r\nBody secret').toString('base64')}}};}
    else throw Error('Unexpected headers route '+action);
    await route.fulfill({json});
  });
  try {
    await page.goto(url+'?message-headers-test#mail');
    for(const id of ['raw','legacy','cached','missing']) {
      await page.locator(`#items [data-id="${id}"]`).click();
      const summary=page.locator('#detail [data-mail-disclosure="metadata"] > summary');
      await summary.focus();await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'View message headers',exact:true}).focus();await page.keyboard.press('Enter');
      await page.getByRole('dialog').waitFor();
      if(id==='missing')assert.match(await page.locator('#dialog').textContent(),/headers are unavailable/);
      else {
        assert.equal(await page.locator('.message-headers').textContent(),headers);
        assert.equal(await page.locator('#dialog img').count(),0);
        assert.doesNotMatch(await page.locator('#dialog').textContent(),/Body secret/);
        await page.evaluate(()=>{window.headerCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.headerCopies.push(text)}});});
        const search=page.getByRole('searchbox',{name:'Search headers'});
        await page.locator('.message-headers').focus();await page.keyboard.press('/');
        assert.equal(await search.evaluate(el=>el===document.activeElement),true);
        await search.fill('received');
        assert.equal(await page.locator('[data-header-count]').textContent(),'1 of 2');
        await page.keyboard.press('Enter');assert.equal(await page.locator('[data-header-count]').textContent(),'2 of 2');
        await page.keyboard.press('Enter');assert.equal(await page.locator('[data-header-count]').textContent(),'1 of 2');
        await page.keyboard.press('Shift+Enter');assert.equal(await page.locator('[data-header-count]').textContent(),'2 of 2');
        await page.locator('.message-headers').focus();await page.keyboard.press('n');assert.equal(await page.locator('[data-header-count]').textContent(),'1 of 2');
        await page.keyboard.press('p');assert.equal(await page.locator('[data-header-count]').textContent(),'2 of 2');
        await search.fill('<img');assert.equal(await page.locator('.message-headers mark').textContent(),'<img');
        assert.equal(await page.locator('#dialog img').count(),0);
        await search.fill('.*');assert.equal(await page.locator('[data-header-count]').textContent(),'No results');
        assert.equal(await page.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
        await page.getByRole('button',{name:'Copy all headers'}).click();
        await page.getByText('Headers copied.',{exact:true}).waitFor();
        assert.deepEqual(await page.evaluate(()=>window.headerCopies),[headers]);
        await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Denied');};});
        await page.getByRole('button',{name:'Copy all headers'}).click();await page.getByText(/Could not copy headers/).waitFor();
        await search.fill('');await search.pressSequentially('np/');assert.equal(await search.inputValue(),'np/');
        await search.fill('');assert.equal(await page.locator('.message-headers').textContent(),headers);
        assert.equal(await page.locator('.message-headers mark').count(),0);
        await page.locator('.message-headers').focus();await page.keyboard.press('Control+a');
      }
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
      assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
    }
    assert.equal(localReads,1);
    console.log('PASS message headers: local summary lookup, original/legacy/header-only sources, folding, repeated fields, UTF-8, safe text, body exclusion, unavailable, keyboard and focus return.');
  } finally {await page.goto('about:blank');await page.unroute(routes);}
}
