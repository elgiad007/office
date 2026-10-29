import assert from 'node:assert/strict';

export async function testMailHtml(page,url) {
  const status=await (await page.request.get(url+'api.php?r=status')).json();
  const headers={'X-CSRF-Token':status.csrf};
  const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=';
  const html='<html><head><style>.hero{color:rgb(180, 30, 60);font-size:24px}body{background-image:url(https://mail-images.invalid/background.png)}</style><meta http-equiv="refresh" content="0;url=https://mail-images.invalid/redirect"></head><body><table><tr><td class="hero">Styled newsletter</td></tr></table><img alt="Embedded logo" src="cid:logo"><img alt="Remote logo" src="https://mail-images.invalid/logo.png" onerror="parent.mailExecuted=true"><script>parent.mailExecuted=true</script><form action="https://mail-images.invalid/form"><input name="secret"></form><a href="https://example.com">Visit website</a></body></html>';
  const raw=['Subject: HTML reader verification','Content-Type: multipart/related; boundary=related','','--related','Content-Type: multipart/alternative; boundary=alternative','','--alternative','Content-Type: text/plain; charset=UTF-8','','Newsletter text alternative','--alternative','Content-Type: text/html; charset=UTF-8','',''+html,'--alternative--','--related','Content-Type: image/png','Content-ID: <logo>','Content-Disposition: inline; filename=logo.png','Content-Transfer-Encoding: base64','',pixel,'--related--',''].join('\r\n');
  const imported=await page.request.post(url+'api.php?r=import',{headers,data:{format:'eml',base64:Buffer.from(raw).toString('base64')}});
  assert.equal(imported.status(),200);
  let remoteRequests=0;
  const routePattern='https://mail-images.invalid/**';
  await page.route(routePattern,route=>{remoteRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from(pixel,'base64')});});
  try {
    await page.goto(url+'#mail');await page.reload();
    await page.locator('#mail-folder').selectOption('all');
    await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
    const frame=page.frameLocator('.mail-html');
    await frame.getByText('Styled newsletter',{exact:true}).waitFor();
    assert.equal(await frame.locator('.hero').evaluate(node=>getComputedStyle(node).color),'rgb(180, 30, 60)');
    assert.equal(await frame.locator('script,form,iframe,meta[http-equiv]').count(),0);
    assert.equal(await frame.getByAltText('Embedded logo').evaluate(img=>img.complete && img.naturalWidth),1);
    assert.equal(await frame.getByAltText('Remote logo').getAttribute('src'),null);
    assert.equal(remoteRequests,0);
    assert.equal(await page.evaluate(()=>window.mailExecuted),undefined);
    assert.equal(await frame.getByRole('link').getAttribute('target'),'_blank');
    const src=await page.locator('.mail-html').getAttribute('src');
    const response=await page.request.get(url+src);
    assert.match(response.headers()['content-security-policy'],/sandbox allow-popups/);
    const anonymous=await fetch(url+src);assert.equal(anonymous.status,401);
    await page.screenshot({path:'test-results/mail-html.png',fullPage:true});
    await page.getByRole('button',{name:'Text only',exact:true}).click();
    assert.equal(await page.locator('.mail-body').textContent(),'Newsletter text alternative');
    assert.equal(await page.locator('.mail-html').count(),0);
    await page.getByRole('button',{name:'HTML',exact:true}).click();
    await page.getByRole('button',{name:'Load images',exact:true}).click();
    await frame.getByAltText('Remote logo').evaluate(img=>img.decode());
    assert.ok(remoteRequests>0);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByLabel('Default email display',{exact:true}).selectOption('text');
    await page.getByRole('button',{name:'Save mail preferences',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Mail preferences saved.'}).waitFor();
    await page.goto(url+'#mail');await page.reload();await page.locator('#mail-folder').selectOption('all');
    await page.locator('.item').filter({hasText:'HTML reader verification'}).click();
    assert.equal(await page.locator('.mail-body').textContent(),'Newsletter text alternative');
    assert.equal(await page.locator('.mail-html').count(),0);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'HTML',exact:true}).click();
    await frame.getByText('Styled newsletter',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'test-results/mail-html-mobile.png',fullPage:true});
  } finally {
    await page.setViewportSize({width:1440,height:1000});
    await page.unroute(routePattern);
    await page.request.post(url+'api.php?r=preferences',{headers,data:{preferences:status.preferences}});
  }
}
