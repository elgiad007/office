import assert from 'node:assert/strict';

export async function testScrolling(page, url) {
  const records = Array.from({length:80}, (_, i) => ({id:`scroll-${i}`, kind:'mail', title:`Scroll message ${i}`, body:Array.from({length:150}, (_, n) => `Message line ${n}`).join('\n'), revision:1, meta:{read:true,folder:'Inbox', from:'sender@example.com'}}));
  let density = 'comfortable';
  const routes = target => target.pathname.endsWith('/api.php') && target.searchParams.get('r')!=='activity';
  await page.route(routes, async route => {
    const action = new URL(route.request().url()).searchParams.get('r');
    const responses = {status:{authenticated:true, csrf:'fixture', preferences:{density}}, accounts:{accounts:[]}, records:{records}, 'google-settings':{configured:false}};
    assert.ok(action in responses, `Unexpected scrolling fixture API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  const positions = () => page.evaluate(() => ({list:document.querySelector('#items').scrollTop, detail:document.querySelector('#detail').scrollTop, main:document.querySelector('#main').scrollTop, shell:document.querySelector('.shell').scrollTop, page:window.scrollY}));
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
        const dimensions=await page.evaluate(()=>({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,viewportHeight:innerHeight,viewportWidth:innerWidth,elements:['.shell','.workspace','#main','.work-grid','.detail'].map(selector=>{const node=document.querySelector(selector),style=getComputedStyle(node);return {selector,height:node.getBoundingClientRect().height,overflow:style.overflow,minHeight:style.minHeight,display:style.display};})}));
        assert.ok(dimensions.height<=dimensions.viewportHeight+1 && dimensions.width<=dimensions.viewportWidth+1, 'Workspace must fit the viewport: '+JSON.stringify(dimensions));
        const frame = await page.evaluate(() => {
          const shell=document.querySelector('.shell'), main=document.querySelector('#main');
          const overflow=shell.scrollHeight-shell.clientHeight;
          // Focus and browser scroll anchoring can request tiny outer scrolls.
          shell.scrollTop=1;main.scrollTop=1;
          return {overflow,shell:shell.scrollTop,main:main.scrollTop};
        });
        assert.ok(frame.overflow<=1, 'Hidden labels must not expand the outer Mail frame: '+JSON.stringify(frame));
        assert.equal(frame.shell,0,'The outer frame must reject one-pixel scrolls');
        assert.equal(frame.main,0,'Mail panes must scroll independently of the main frame');
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
        const navigate = async (key, index) => {
          await page.keyboard.press(key);
          await page.waitForFunction(index => {
            const selected=document.querySelector('#selected-item'), list=document.querySelector('#items');
            if(!selected || list.querySelectorAll('.item')[index]!==selected || document.activeElement!==selected)return false;
            const row=selected.getBoundingClientRect(), pane=list.getBoundingClientRect();
            return row.top>=pane.top-1 && row.bottom<=pane.bottom+1;
          }, index);
          assert.equal((await positions()).main, 0);
          assert.equal((await positions()).shell, 0);
          assert.equal((await positions()).page, 0);
        };
        await navigate('g', 0);
        await navigate('g', 0);
        for(let i=1;i<=15;i++)await navigate(i%2?'j':'n', i);
        await navigate('G', 79);
        for(let i=78;i>=64;i--)await navigate(i%2?'k':'N', i);
        await page.keyboard.press('g');
        await navigate('g', 0);
        await page.keyboard.press('l');
        assert.equal(await page.locator('#detail').evaluate(node => node === document.activeElement), true);
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('#detail').evaluate(node => getComputedStyle(node).overflowY), 'visible');
        assert.equal(await page.locator('.shell').evaluate(node => getComputedStyle(node).overflowY), 'visible');
        await page.emulateMedia({media:'screen'});
        await page.getByRole('button', {name:'Settings',exact:true}).click();
        await page.getByRole('button',{name:'Mail settings',exact:true}).click();
        await page.locator('#mail-preferences').waitFor();
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
    await page.getByRole('button',{name:'Appearance settings',exact:true}).click();
    await page.locator('#preferences').waitFor();
  }
}
