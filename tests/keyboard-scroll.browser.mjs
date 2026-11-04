import assert from 'node:assert/strict';
import {settleScroll} from './keyboard-scroll-ui.mjs';
import {openMailMore} from './mail-reader-ui.mjs';

export async function testKeyboardScroll(page,url) {
  const status=await (await page.request.get(url+'api.php?r=status')).json();
  const text=Array.from({length:300},(_,i)=>`Keyboard scroll line ${i}`).join('\n');
  const raw=['Subject: Smooth keyboard fixture','Content-Type: multipart/alternative; boundary=scroll','','--scroll','Content-Type: text/plain; charset=UTF-8','',text,'--scroll','Content-Type: text/html; charset=UTF-8','',`<html><body><pre>${text}</pre></body></html>`,'--scroll--',''].join('\r\n');
  const imported=await page.request.post(url+'api.php?r=import',{headers:{'X-CSRF-Token':status.csrf},data:{format:'eml',base64:Buffer.from(raw).toString('base64')}});
  assert.equal(imported.status(),200);
  await page.goto(url+'#mail');await page.reload();
  await page.locator('#mail-folder').selectOption('all');
  await page.locator('.item').filter({hasText:'Smooth keyboard fixture'}).click();
  const selected=await page.locator('#selected-item').getAttribute('data-id');
  try {
    for(const mode of ['html','text']){
      await openMailMore(page);
      await page.locator(`[data-mail-mode="${mode}"]`).click();
      const entry=page.locator(mode==='html'?'.mail-html':'.mail-body');
      const owner=mode==='html'?page.frameLocator('.mail-html').locator('html'):page.locator('#detail');
      await owner.waitFor();
      await page.locator('#selected-item').focus();await page.keyboard.press('Tab');
      assert.equal(await entry.evaluate(node=>node===document.activeElement),true);
      const top=()=>owner.evaluate(node=>node.scrollTop);
      const press=async key=>{await page.keyboard.press(key);await settleScroll(owner);};
      await press('Home');assert.equal(await top(),0);
      await press('j');assert.equal(await top(),56,mode+' configured shortcut distance');
      await press('ArrowDown');assert.equal(await top(),112,mode+' arrow distance matches');
      await press('ArrowUp');assert.equal(await top(),56);
      await press('PageDown');assert.ok(await top()>112);
      await press('PageUp');assert.ok(Math.abs(await top()-56)<=1);
      // OS repeat sends further keydown events without a keyup.
      await page.keyboard.down('j');
      for(let i=0;i<12;i++)await page.keyboard.down('j');
      await page.keyboard.up('j');
      await owner.evaluate(()=>new Promise(resolve=>{let frames=0;const tick=()=>++frames===4?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
      const reversing=await top();
      await press('k');assert.ok(await top()<reversing,mode+' reversal cancels pending forward distance');
      await press('End');assert.equal(await top(),await owner.evaluate(node=>node.scrollHeight-node.clientHeight));
      await press('ArrowDown');assert.equal(await top(),await owner.evaluate(node=>node.scrollHeight-node.clientHeight));
      await press('Home');assert.equal(await top(),0);
      // Verify actual movement over several animation frames.
      await page.keyboard.press('j');
      const moving=await owner.evaluate(node=>new Promise(resolve=>{
        const values=[];const tick=()=>{values.push(node.scrollTop);if(values.length===18)resolve(values);else requestAnimationFrame(tick);};requestAnimationFrame(tick);
      }));
      await settleScroll(owner);
      assert.ok(new Set(moving).size>2,mode+' scroll animates over multiple frames');
      assert.equal(await top(),56);
      await page.emulateMedia({reducedMotion:'reduce'});
      await press('Home');await press('j');assert.equal(await top(),56,mode+' reduced motion retains distance');
      await page.emulateMedia({reducedMotion:'no-preference'});
      assert.equal(await page.locator('#selected-item').getAttribute('data-id'),selected);
    }
  } finally {await page.emulateMedia({reducedMotion:'no-preference'});}
}
