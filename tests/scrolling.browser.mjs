import assert from 'node:assert/strict';

export async function testScrolling(page, url) {
  const records = Array.from({length:80}, (_, i) => ({id:`scroll-${i}`, kind:'mail', title:`Scroll message ${i}`, body:Array.from({length:150}, (_, n) => `Message line ${n}`).join('\n'), revision:1, meta:{read:true,folder:'Inbox', from:'sender@example.com'}}));
  let density = 'comfortable';
  const routes = target => target.pathname.endsWith('/api.php');
  await page.route(routes, async route => {
    const action = new URL(route.request().url()).searchParams.get('r');
    const responses = {status:{authenticated:true, csrf:'fixture', preferences:{density}}, accounts:{accounts:[]}, records:{records}, 'google-settings':{configured:false}};
    assert.ok(action in responses, `Unexpected scrolling fixture API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  const positions = () => page.evaluate(() => ({list:document.querySelector('#items').scrollTop, detail:document.querySelector('#detail').scrollTop, main:document.querySelector('#main').scrollTop, page:window.scrollY}));
  const wheel = async (selector, delta) => {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, delta);
  };
  try {
    for (density of ['comfortable', 'compact']) {
      for (const viewport of [{width:1440,height:1000}, {width:900,height:650}, {width:390,height:844}]) {
        await page.setViewportSize(viewport);
        await page.goto(url+'#mail');
        await page.reload();
        await page.locator('#items .item').first().click();
        await page.locator('.mail-body').waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1), 'Workspace must fit the viewport');
        await wheel('#detail', 400);
        await page.waitForFunction(() => document.querySelector('#detail').scrollTop > 0);
        const detailScrolled = await positions();
        assert.equal(detailScrolled.list, 0);
        assert.equal(detailScrolled.main, 0);
        assert.equal(detailScrolled.page, 0);
        await wheel('#items', 300);
        await page.waitForFunction(() => document.querySelector('#items').scrollTop > 0);
        assert.equal((await positions()).detail, detailScrolled.detail, 'List scrolling must leave the message in place');
        // At the bottom, further wheel input must stay inside the hovered pane.
        for (const selector of ['#items', '#detail']) {
          await page.locator(selector).evaluate(node => { node.scrollTop = node.scrollHeight; });
          const before = await positions();
          await wheel(selector, 500);
          await page.waitForTimeout(150);
          assert.deepEqual(await positions(), before);
        }
        await page.screenshot({path:`test-results/scrolling-${density}-${viewport.width}.png`});
        await page.locator('#main').focus();
        await page.keyboard.press('h');
        assert.equal(await page.locator('#selected-item').evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('l');
        assert.equal(await page.locator('#detail').evaluate(node => node === document.activeElement), true);
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('#detail').evaluate(node => getComputedStyle(node).overflowY), 'visible');
        assert.equal(await page.locator('.shell').evaluate(node => getComputedStyle(node).overflowY), 'visible');
        await page.emulateMedia({media:'screen'});
        await page.getByRole('button', {name:'Settings',exact:true}).click();
        await page.locator('#preferences').waitFor();
        await page.locator('#main').evaluate(node => { node.scrollTop = node.scrollHeight; });
        assert.ok(await page.locator('#main').evaluate(node => node.scrollTop > 0), 'Settings must remain scrollable');
      }
    }
  } finally {
    await page.emulateMedia({media:'screen'});
    await page.unroute(routes);
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(url+'#settings');
    await page.reload();
    await page.locator('#preferences').waitFor();
  }
}
