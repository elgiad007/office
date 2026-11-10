import assert from 'node:assert/strict';

export async function testAccountSetup(page, url) {
  const modal = page.getByRole('dialog');
  const selectProvider = value => modal.getByLabel('Connection type', {exact:true}).selectOption(value);
  const next = () => modal.getByRole('button', {name:'Next',exact:true}).click();
  const back = () => modal.getByRole('button', {name:'Back',exact:true}).click();
  const open = () => page.getByRole('button', {name:'Add account',exact:true}).click();
  const done = async () => { await modal.getByRole('button', {name:'Done',exact:true}).click(); await modal.waitFor({state:'hidden'}); };
  const testPredicate = target => target.pathname.endsWith('/api.php') && target.searchParams.get('r') === 'account-test';
  const authPredicate = target => target.pathname.endsWith('/api.php') && target.searchParams.get('r') === 'google-connect';
  const discoveryPredicate = target => target.pathname.endsWith('/api.php') && target.searchParams.get('r') === 'account-find-calendars';
  let imapChecks = 0;
  await page.route(testPredicate, async route => {
    if (!['imap','gmail'].includes(route.request().postDataJSON().type)) return route.continue();
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
    await page.getByRole('button',{name:'Accounts settings',exact:true}).click();
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
    await modal.getByText('Use an HTTPS calendar collection URL on port 443, 8443, or 2080, without embedded credentials.',{exact:true}).waitFor();
    assert.equal(await modal.getByLabel('Password / app password',{exact:true}).inputValue(),'fixture-calendar-secret');
    await modal.getByLabel('Calendar collection URL',{exact:true}).fill('https://calendar.example.invalid/personal/');
    await modal.getByRole('button',{name:'Guided setup',exact:true}).click();
    assert.equal(await modal.getByLabel('Account label',{exact:true}).inputValue(),'Manual calendar fixture');
    await modal.getByRole('button',{name:'Manual setup',exact:true}).click();
    await page.screenshot({path:'test-results/account-manual.png',fullPage:true});
    await modal.getByRole('button',{name:'Save account',exact:true}).click();
    await modal.getByRole('heading',{name:'Account saved',exact:true}).waitFor(); await done();
    await open(); await modal.getByRole('button',{name:'Guided setup',exact:true}).click();
    await selectProvider('gmail');
    await modal.getByLabel('Account label',{exact:true}).fill('Gmail app password fixture');
    await modal.getByLabel('Sender email',{exact:true}).fill('fixture@gmail.com');
    await next();
    assert.equal(await modal.getByLabel('IMAP server (TLS 993)',{exact:true}).count(),0);
    assert.equal(await modal.locator('a[href="https://myaccount.google.com/apppasswords"]').count(),1);
    await modal.getByLabel('Google app password',{exact:true}).fill('abcd efgh ijkl mnop');
    await modal.getByRole('button',{name:'Manual setup',exact:true}).click();
    assert.equal(await modal.getByLabel('Google app password',{exact:true}).inputValue(),'abcd efgh ijkl mnop');
    await modal.getByRole('button',{name:'Guided setup',exact:true}).click();
    await next();
    assert.ok(!(await modal.innerHTML()).includes('abcd efgh ijkl mnop'));
    await modal.getByRole('button',{name:'Test connection',exact:true}).click();
    await modal.getByText('Connection checks passed',{exact:true}).waitFor();
    await back(); await back();
    await modal.getByLabel('Sender email',{exact:true}).fill('updated@gmail.com');
    await next(); await next();
    assert.equal(await modal.locator('.setup-checks').count(),0);
    const savedGmailRequest=page.waitForRequest(request=>request.url().endsWith('api.php?r=account-save') && request.postDataJSON().type==='gmail');
    await modal.getByRole('button',{name:'Save account',exact:true}).click();
    assert.equal((await savedGmailRequest).postDataJSON().email,'updated@gmail.com');
    await modal.getByRole('heading',{name:'Account saved',exact:true}).waitFor(); await done();
    const accounts = (await (await page.request.get(url+'api.php?r=accounts')).json()).accounts;
    assert.equal(accounts.length,3);
    const gmail=accounts.find(account=>account.label==='Gmail app password fixture');
    assert.equal(gmail.type,'imap');
    assert.ok(!JSON.stringify(accounts).includes('abcdefghijklmnop'));
    const imap=accounts.find(account=>account.label==='Guided IMAP fixture');
    await page.getByRole('button',{name:'Edit account Guided IMAP fixture',exact:true}).click();
    await modal.getByRole('heading',{name:'Edit account',exact:true}).waitFor();
    assert.equal(await modal.getByLabel('IMAP server (TLS 993)',{exact:true}).inputValue(),'imap.example.invalid');
    assert.equal(await modal.getByLabel('Password / app password',{exact:true}).inputValue(),'');
    assert.ok(!(await modal.innerHTML()).includes('fixture-imap-secret'));
    await modal.getByLabel('Account label',{exact:true}).fill('Renamed IMAP fixture');
    await modal.getByRole('button',{name:'Save changes',exact:true}).click();
    await modal.getByRole('heading',{name:'Account saved',exact:true}).waitFor(); await done();
    const edited=(await (await page.request.get(url+'api.php?r=accounts')).json()).accounts;
    assert.equal(edited.length,3);
    assert.equal(edited.find(account=>account.id===imap.id).label,'Renamed IMAP fixture');
    await page.getByRole('button',{name:'Edit account Renamed IMAP fixture',exact:true}).click();
    await modal.getByLabel('CalDAV server or collection URL',{exact:true}).fill('https://calendar.example.invalid:2080/');
    const confirm=page.waitForEvent('dialog').then(async dialog=>{
      assert.match(dialog.message(),/Change calendar discovery settings/);
      await dialog.accept();
    });
    await modal.getByRole('button',{name:'Save changes',exact:true}).click();
    await confirm;
    await modal.getByRole('heading',{name:'Account saved',exact:true}).waitFor(); await done();
    await page.getByRole('button',{name:'Edit account Renamed IMAP fixture',exact:true}).click();
    assert.equal(await modal.getByLabel('CalDAV server or collection URL',{exact:true}).inputValue(),'https://calendar.example.invalid:2080/');
    await page.route(discoveryPredicate,async route=>{
      assert.deepEqual(route.request().postDataJSON(),{id:imap.id});
      await route.fulfill({json:{calendars:[],checked:1,approval:'https://provider.example.invalid/dav/'}});
    });
    await modal.getByRole('button',{name:'Find calendars',exact:true}).click();
    await modal.getByText(/Allow Office to use the mailbox login at provider\.example\.invalid/).waitFor();
    await modal.getByRole('button',{name:'Use discovered URL',exact:true}).click();
    assert.equal(await modal.getByLabel('CalDAV server or collection URL',{exact:true}).inputValue(),'https://provider.example.invalid/dav/');
    await modal.getByRole('button',{name:'Close dialog',exact:true}).click();
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
    await page.reload(); await page.getByRole('button',{name:'Add account',exact:true}).waitFor();
    console.log('PASS account setup and editing: guided/manual paths, provider-specific checks, in-place updates, blank passwords, calendar discovery approval, keyboard and mobile.');
  } finally {
    await page.unroute(testPredicate);
    await page.unroute(authPredicate);
    await page.unroute(discoveryPredicate);
  }
}
