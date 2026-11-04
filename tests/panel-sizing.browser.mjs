import assert from 'node:assert/strict';

export async function testPanelSizing(page, url) {
  let density = 'comfortable', kind = 'tasks', empty = false, html = false;
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
    const responses = {status: {authenticated: true, csrf: 'fixture', preferences: {density}}, records: {records}, accounts: {accounts: []}, connections: {items: [], links: [], more: false}, activity: {events: []}, 'google-settings': {configured: false}};
    assert.ok(action in responses, `Unexpected panel sizing API: ${action}`);
    await route.fulfill({json: responses[action]});
  });
  const overflow = selector => page.locator(selector).evaluate(node => node.scrollHeight - node.clientHeight);
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
        await page.locator('#detail .empty').waitFor();
        assert.ok(await overflow('#detail') <= 1, `${density}, ${viewport.width}: empty state fits`);
      }
      empty = false;
    }
  } finally {
    await page.unroute(routes);
    await page.unroute(mailRoute);
    await page.emulateMedia({media: 'screen'});
    await page.setViewportSize({width: 1440, height: 1000});
  }
}

