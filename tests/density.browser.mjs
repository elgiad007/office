import assert from 'node:assert/strict';

export async function testDensity(page) {
  const spacing = () => page.evaluate(() => {
    const css = selector => getComputedStyle(document.querySelector(selector));
    return {
      header: parseFloat(css('.topbar').height),
      card: parseFloat(css('.card').paddingTop),
      input: parseFloat(css('#preferences select').paddingTop),
      nav: parseFloat(css('.nav button').paddingTop),
      gap: parseFloat(css('.settings-grid').gap),
    };
  });
  const saveDensity = async value => {
    await page.getByLabel('Density', {exact:true}).selectOption(value);
    await page.getByRole('button', {name:'Save preferences', exact:true}).click();
    await page.waitForFunction(compact => document.documentElement.classList.contains('compact') === compact, value === 'compact');
  };
  await saveDensity('comfortable');
  const comfortable = await spacing();
  await saveDensity('compact');
  const compact = await spacing();
  for (const key of Object.keys(comfortable)) {
    assert.ok(compact[key] <= comfortable[key] * 0.7, `${key} should be substantially tighter`);
  }
  await page.reload();
  await page.getByLabel('Density', {exact:true}).waitFor();
  assert.equal(await page.getByLabel('Density', {exact:true}).inputValue(), 'compact');
  assert.deepEqual(await spacing(), compact);
  await page.screenshot({path:'test-results/settings-compact.png', fullPage:true});
  await page.getByRole('button', {name:'Keyboard shortcuts', exact:true}).click();
  assert.equal(await page.locator('#dialog').evaluate(node => getComputedStyle(node).paddingTop), '14px');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Tasks', exact:true}).click();
  assert.equal(await page.locator('.item').first().evaluate(node => getComputedStyle(node).paddingTop), '7px');
  await page.screenshot({path:'test-results/tasks-compact.png', fullPage:true});
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.detail').evaluate(node => getComputedStyle(node).paddingTop), '0px');
  await page.emulateMedia({media:'screen'});
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.setViewportSize({width:390, height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path:'test-results/settings-compact-mobile.png', fullPage:true});
  await page.getByRole('button', {name:'Tasks', exact:true}).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.setViewportSize({width:1440, height:1000});
  await saveDensity('comfortable');
  assert.deepEqual(await spacing(), comfortable);
}
