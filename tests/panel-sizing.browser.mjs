import assert from 'node:assert/strict';

export async function testPanelSizing(page, url) {
  let density = 'comfortable', kind = 'tasks', empty = false, html = false;
  const accounts = [];
  const mailRoute = target => target.pathname.endsWith('/mail-view.php');
  await page.route(mailRoute, route => route.fulfill({contentType: 'text/html', body: '<!doctype html>' + (new URL(route.request().url()).searchParams.get('id').endsWith('true') ? '<p>Long HTML content</p>'.repeat(100) : '<p>Short HTML content</p>')}));
  const routes = target => target.pathname.endsWith('/api.php');
  await page.route(routes, async route => {
    const action = new URL(route.request().url()).searchParams.get('r');
    const records = empty ? [] : [false, true].map(long => ({
      id: `sizing-${kind}-${long}`, kind, title: long ? 'Long item' : 'Short item', revision: 1,
      body: long ? Array.from({length: 100}, (_, i) => kind === 'documents' ? `<p>Line ${i}</p>` : `Line ${i}`).join('\n') : 'Short content',
      meta: kind === 'mail' ? {folder: 'Inbox', read: true, from: 'sender@example.com', hasHtml: html} : {},
    }));
    const responses = {status: {authenticated: true, csrf: 'fixture', preferences: {density}}, records: {records}, accounts: {accounts}, connections: {items: [], links: [], more: false}, activity: {events: []}, 'google-settings': {configured: false}, sync: {count: 0}, 'mail-folder-sync': {count: 0}};
    assert.ok(action in responses, `Unexpected panel sizing API: ${action}`);
    await route.fulfill({json: responses[action]});
  });
  const overflow = selector => page.locator(selector).evaluate(node => node.scrollHeight - node.clientHeight);
  const width = selector => page.locator(selector).evaluate(node => node.offsetWidth);
  const sidebar = page.getByRole('separator', {name: 'Application sidebar width'});
  const list = page.getByRole('separator', {name: 'Item list width'});
  const mail = page.getByRole('button', {name: 'Mail', exact: true});
  const folders = page.locator('#mail-folder-navigation');
  const drag = async (splitter, delta) => {
    const {x, y, width, height} = await splitter.boundingBox();
    await page.mouse.move(x + width / 2, y + height / 2);
    await page.mouse.down();
    await page.mouse.move(x + width / 2 + delta, y + height / 2, {steps: 5});
    await page.mouse.up();
  };
  try {
    for (density of ['comfortable', 'compact']) {
      for (const viewport of [{width: 1440, height: 1000}, {width: 900, height: 650}]) {
        await page.setViewportSize(viewport);
        for (kind of ['tasks', 'contacts', 'documents', 'wiki', 'mail']) {
          await page.goto(url + '#' + kind);
          await page.reload();
          await page.locator('#items [data-id$="false"]').click();
          await page.locator('#detail').getByText('Short content', {exact: true}).waitFor();
          assert.ok(await overflow('#detail') <= 1, `${kind}, ${density}, ${viewport.width}: short item fits`);
          await page.locator('#items [data-id$="true"]').click();
          if (await page.locator('.body-editor').count()) {
            assert.ok(await overflow('.body-editor') > 0, `${kind}: long notes remain scrollable`);
          } else {
            assert.ok(await overflow('#detail') > 0, `${kind}: long content remains scrollable`);
          }
        }
      }
      html = true;
      kind = 'mail';
      for (const viewport of [{width: 900, height: 650}, {width: 390, height: 844}]) {
        await page.setViewportSize(viewport);
        await page.goto(url + '#mail');
        await page.reload();
        await page.locator('#items [data-id$="false"]').click();
        await page.frameLocator('.mail-html').getByText('Short HTML content').waitFor();
        assert.ok(await overflow('#detail') <= 1, `${density}, ${viewport.width}: HTML frame fits below its header`);
        assert.ok(await page.frameLocator('.mail-html').locator('html').evaluate(node => node.scrollHeight <= innerHeight + 1), 'Short HTML content has no inner scrollbar');
        if(viewport.width===390)await page.locator('.mobile-back').click();
        await page.locator('#items [data-id$="true"]').click();
        await page.frameLocator('.mail-html').getByText('Long HTML content').first().waitFor();
        assert.ok(await page.frameLocator('.mail-html').locator('html').evaluate(node => node.scrollHeight > innerHeight), 'Long HTML content remains scrollable');
        await page.emulateMedia({media: 'print'});
        assert.equal(await page.locator('#detail').evaluate(node => getComputedStyle(node).display), 'block');
        await page.emulateMedia({media: 'screen'});
      }
      html = false;
      empty = true;
      for (const viewport of [{width: 900, height: 650}, {width: 390, height: 844}]) {
        await page.setViewportSize(viewport);
        await page.goto(url + '#mail');
        await page.reload();
        if(viewport.width===390){
          await page.locator('#items .list-empty').waitFor();
          assert.equal(await page.locator('#detail').isVisible(),false);
        }else{
          await page.locator('#detail .empty').waitFor();
          assert.ok(await overflow('#detail') <= 1, `${density}, ${viewport.width}: empty state fits`);
        }
      }
      empty = false;
    }
    await page.setViewportSize({width: 1440, height: 1000});
    kind = 'tasks';
    await page.goto(url + '#tasks');
    await page.reload();
    const task = page.locator('#items [data-id$="true"]');
    await task.click();
    const selected = await task.getAttribute('id');
    const originalListWidth = await width('#item-list-pane');
    await drag(list, 74);
    assert.equal(await width('#item-list-pane'), originalListWidth + 74);
    assert.equal(await task.getAttribute('id'), selected);
    await list.press('End');
    assert.ok(await width('#detail') >= 320);
    await list.press('Home');
    assert.equal(await width('#item-list-pane'), 180);
    await drag(sidebar, -130);
    assert.equal(await width('#app-sidebar'), 65);
    assert.equal(await mail.locator('span').isVisible(), false);
    await page.reload();
    await task.waitFor();
    assert.equal(await width('#app-sidebar'), 65);
    assert.equal(await width('#item-list-pane'), 180);

    kind = 'mail';
    await mail.press('Enter');
    await folders.waitFor({state: 'visible'});
    assert.equal(await mail.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#mail-folder').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await mail.evaluate(node => node === document.activeElement), true);
    assert.equal(await folders.isVisible(), false);
    await mail.click();
    await folders.waitFor({state: 'visible'});
    await page.locator('#mail-folder').selectOption('all');
    await folders.waitFor({state: 'hidden'});
    assert.equal(await mail.getAttribute('aria-expanded'), 'false');
    await mail.click();
    await folders.waitFor({state: 'visible'});
    await page.locator('#mode').click();
    assert.equal(await folders.isVisible(), false);
    await drag(sidebar, 165);
    assert.equal(await width('#app-sidebar'), 230);
    assert.equal(await folders.isVisible(), true);
    assert.equal(await mail.getAttribute('aria-expanded'), null);

    await page.getByRole('button', {name: 'Compose', exact: true}).click();
    const draft = page.locator('#detail [name="body"]');
    await draft.fill('Keep this unsaved draft while resizing.');
    await drag(list, 60);
    await sidebar.press('Home');
    assert.equal(await width('#app-sidebar'), 65);
    await sidebar.press('ArrowRight');
    assert.equal(await width('#app-sidebar'), 150);
    assert.equal(await draft.inputValue(), 'Keep this unsaved draft while resizing.');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await sidebar.count(), 0);
    assert.equal(await list.count(), 0);
    assert.equal(await page.locator('.mobile-back').isVisible(),true);
    assert.equal(await draft.inputValue(), 'Keep this unsaved draft while resizing.');
    await page.setViewportSize({width: 1440, height: 1000});
    assert.equal(await width('#app-sidebar'), 150);
    assert.equal(await draft.inputValue(), 'Keep this unsaved draft while resizing.');
    kind = 'tasks';
    await page.getByRole('button', {name: 'Tasks', exact: true}).click();
    await page.locator('dialog[open] [data-draft-choice="discard"]').click();
    await task.waitFor();

    accounts.push({id: 'imap', type: 'imap', label: 'Test account', folders: [
      {id: 'Projects/Office', name: 'Projects/Office', delimiter: '/', protected: false},
    ]});
    await page.reload();
    await task.waitFor();
    await page.getByText(/Checked /).first().waitFor();
    await sidebar.press('Home');
    kind = 'mail';
    await mail.press('Enter');
    await folders.getByText('Test account', {exact: true}).click();
    await folders.getByRole('button', {name: 'Office', exact: true}).click();
    await folders.waitFor({state: 'hidden'});
    await page.getByText('Test account / Projects/Office', {exact: true}).waitFor();
    assert.equal(await mail.evaluate(node => node === document.activeElement), true);
  } finally {
    await page.evaluate(() => {
      localStorage.removeItem('office-panel-width-sidebar');
      localStorage.removeItem('office-panel-width-list');
    });
    await page.unroute(routes);
    await page.unroute(mailRoute);
    await page.emulateMedia({media: 'screen'});
    await page.setViewportSize({width: 1440, height: 1000});
  }
}

