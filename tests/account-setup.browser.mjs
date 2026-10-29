import assert from 'node:assert/strict';

export async function testAccountSetup(page, url) {
  const modal = page.getByRole('dialog');
  const selectProvider = value => modal.getByLabel('Connection type', {exact:true}).selectOption(value);
  const next = () => modal.getByRole('button', {name:'Next',exact:true}).click();
  const back = () => modal.getByRole('button', {name:'Back',exact:true}).click();
  const open = () => page.getByRole('button', {name:'+ Add account',exact:true}).click();
  const done = async () => { await modal.getByRole('button', {name:'Done',exact:true}).click(); await modal.waitFor({state:'hidden'}); };
  const testPredicate = target => target.pathname.endsWith('/api.php') && target.searchParams.get('r') === 'account-test';
  const authPredicate = target => target.pathname.endsWith('/api.php') && target.searchParams.get('r') === 'google-connect';
  let imapChecks = 0;
  await page.route(testPredicate, async route => {
    if (route.request().postDataJSON().type !== 'imap') return route.continue();
    imapChecks++;
    await route.fulfill({json:{status:imapChecks === 1 ? 'failed' : 'ok',checks:[
      {label:'IMAP inbox · TLS 993',status:'ok',message:'Connection and authentication succeeded.'},
      {label:'SMTP login · TLS 465',status:imapChecks === 1 ? 'error' : 'ok',message:imapChecks === 1 ? 'Fixture: SMTP authentication failed. Check your app password.' : 'Connection and authentication succeeded.'},
    ]}});
  });
  let authorizeEmail;
  await page.route(authPredicate, async route => {
    const data = route.request().postDataJSON();
    authorizeEmail = data.email;
    assert.deepEqual(Object.keys(data), ['email','calendar']);
    assert.equal(data.calendar,true);
    await route.fulfill({status:400,json:{error:'Fixture: Google authorization unavailable. Try again.'}});
  });
  try {
    await page.getByLabel('Google OAuth client ID',{exact:true}).fill('browser.apps.googleusercontent.com');
    await page.getByLabel('Google OAuth client secret',{exact:true}).fill('browser-google-secret');
    assert.equal(await page.getByLabel('Google callback URL',{exact:true}).inputValue(),url+'api.php?r=oauth-callback');
    await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text => {window.copiedCallback=text;}}}));
    await page.getByRole('button',{name:'Copy this location’s callback',exact:true}).click();
    assert.equal(await page.evaluate(() => window.copiedCallback),url+'api.php?r=oauth-callback');
    await page.getByRole('button',{name:'Save Google integration',exact:true}).click();
    await page.getByText('Google integration saved. You can now add a Gmail account.',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Google OAuth client secret',{exact:true}).inputValue(),'');
    await open();
    assert.equal(await modal.getByRole('button',{name:'Guided setup',exact:true}).evaluate(node => node === document.activeElement),true);
    await page.keyboard.press('Enter');
    await selectProvider('google');
    await modal.getByRole('button',{name:'Connect with Google',exact:true}).click();
    assert.equal(authorizeEmail,undefined);
    await modal.getByLabel('Gmail address',{exact:true}).fill('guided@example.com');
    await modal.getByLabel('Include Google Calendar (read-only)',{exact:true}).check();
    await modal.getByRole('button',{name:'Manual setup',exact:true}).click();
    assert.equal(await modal.getByLabel('Gmail address',{exact:true}).inputValue(),'guided@example.com');
    assert.equal(await modal.getByLabel('Google OAuth client secret',{exact:true}).count(),0);
    await modal.getByRole('button',{name:'Connect with Google',exact:true}).click();
    await modal.getByText('Fixture: Google authorization unavailable. Try again.',{exact:true}).waitFor();
    assert.equal(authorizeEmail,'guided@example.com');
    assert.equal((await (await page.request.get(url+'api.php?r=accounts')).json()).accounts.length,0);
    await page.screenshot({path:'test-results/account-google-connect.png',fullPage:true});
    await modal.getByRole('button',{name:'Close dialog',exact:true}).click();

    await open();
    await modal.getByRole('button',{name:'Guided setup',exact:true}).click();
    assert.equal(await modal.getByLabel('Account label',{exact:true}).inputValue(),'');
    await modal.getByLabel('Account label',{exact:true}).fill('Guided IMAP fixture');
    await modal.getByLabel('Sender email',{exact:true}).fill('imap@example.com');
    await next();
    assert.equal(await modal.getByLabel('Username',{exact:true}).inputValue(),'imap@example.com');
    await modal.getByLabel('IMAP server (TLS 993)',{exact:true}).fill('imap.example.invalid');
    await modal.getByLabel('SMTP server (TLS 465)',{exact:true}).fill('smtp.example.invalid');
    await modal.getByLabel('Password / app password',{exact:true}).fill('fixture-imap-secret');
    await modal.getByRole('button',{name:'Test connection',exact:true}).click();
    await modal.getByText('Connection checks need attention',{exact:true}).waitFor();
    await modal.getByText('Fixture: SMTP authentication failed. Check your app password.',{exact:false}).waitFor();
    await modal.getByLabel('SMTP server (TLS 465)',{exact:true}).fill('smtp2.example.invalid');
    assert.equal(await modal.locator('.setup-checks').count(),0);
    await modal.getByRole('button',{name:'Test connection',exact:true}).click();
    await modal.getByText('Connection checks passed',{exact:true}).waitFor();
    await next();
    assert.ok(!(await modal.innerHTML()).includes('fixture-imap-secret'));
    await back();
    assert.equal(await modal.getByLabel('Password / app password',{exact:true}).inputValue(),'fixture-imap-secret');
    await next();
    await page.screenshot({path:'test-results/account-imap-review.png',fullPage:true});
    await modal.getByRole('button',{name:'Save account',exact:true}).click();
    await modal.getByRole('heading',{name:'Account saved',exact:true}).waitFor(); await done();

    await open(); await modal.getByRole('button',{name:'Manual setup',exact:true}).click();
    await selectProvider('caldav');
    await modal.getByLabel('Account label',{exact:true}).fill('Manual calendar fixture');
    await modal.getByLabel('Calendar collection URL',{exact:true}).fill('http://calendar.example.invalid/personal/');
    await modal.getByLabel('Username',{exact:true}).fill('calendar-user');
    await modal.getByLabel('Password / app password',{exact:true}).fill('fixture-calendar-secret');
    await modal.getByRole('button',{name:'Save account',exact:true}).click();
    await modal.getByText('Use an HTTPS calendar collection URL on port 443 or 8443, without embedded credentials.',{exact:true}).waitFor();
    assert.equal(await modal.getByLabel('Password / app password',{exact:true}).inputValue(),'fixture-calendar-secret');
    await modal.getByLabel('Calendar collection URL',{exact:true}).fill('https://calendar.example.invalid/personal/');
    await modal.getByRole('button',{name:'Guided setup',exact:true}).click();
    assert.equal(await modal.getByLabel('Account label',{exact:true}).inputValue(),'Manual calendar fixture');
    await modal.getByRole('button',{name:'Manual setup',exact:true}).click();
    await page.screenshot({path:'test-results/account-manual.png',fullPage:true});
    await modal.getByRole('button',{name:'Save account',exact:true}).click();
    await modal.getByRole('heading',{name:'Account saved',exact:true}).waitFor(); await done();
    const accounts = (await (await page.request.get(url+'api.php?r=accounts')).json()).accounts;
    assert.equal(accounts.length,2);
    // Mobile and Escape close work without retaining the last draft's secrets.
    await page.setViewportSize({width:390,height:844});
    await open(); await modal.getByRole('button',{name:'Guided setup',exact:true}).click();
    await selectProvider('google');
    assert.equal(await modal.getByLabel('Gmail address',{exact:true}).inputValue(),'');
    await modal.getByLabel('Gmail address',{exact:true}).fill('mobile@example.com');
    await page.screenshot({path:'test-results/account-mobile.png',fullPage:true});
    assert.ok(await modal.evaluate(node => node.scrollWidth <= node.clientWidth+1));
    await page.keyboard.press('Escape'); await modal.waitFor({state:'hidden'});
    const status = await (await page.request.get(url+'api.php?r=status')).json();
    for (const account of accounts) {
      const response = await page.request.post(url+'api.php?r=account-delete',{headers:{'X-CSRF-Token':status.csrf},data:{id:account.id}});
      assert.equal(response.status(),200);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.reload(); await page.getByRole('button',{name:'+ Add account',exact:true}).waitFor();
    console.log('PASS account setup: guided/manual paths, required fields, drafts across provider/mode/back changes, Google connection with optional Calendar and no premature save, masked review, connection results/invalidation, save/error recovery, cleared secrets, keyboard and mobile.');
  } finally {
    await page.unroute(testPredicate);
    await page.unroute(authPredicate);
  }
}
