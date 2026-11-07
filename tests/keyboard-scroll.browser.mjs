import assert from 'node:assert/strict';
import {settleScroll} from './keyboard-scroll-ui.mjs';
import {openMailMore} from './mail-reader-ui.mjs';

export async function testKeyboardScroll(page,url) {
  const status=await (await page.request.get(url+'api.php?r=status')).json();
  const text=Array.from({length:300},(_,i)=>`Keyboard scroll line ${i}`).join('\n');
  const raw=['Subject: Smooth keyboard fixture','Content-Type: multipart/alternative; boundary=scroll','','--scroll','Content-Type: text/plain; charset=UTF-8','',text,'--scroll','Content-Type: text/html; charset=UTF-8','',`<html><body><pre>${text}</pre></body></html>`,'--scroll--',''].join('\r\n');
  const imported=await page.request.post(url+'api.php?r=import',{headers:{'X-CSRF-Token':status.csrf},data:{format:'eml',base64:Buffer.from(raw).toString('base64')}});
  assert.equal(imported.status(),200);
  const legacy=await page.request.post(url+'api.php?r=preferences',{headers:{'X-CSRF-Token':status.csrf},data:{preferences:{...status.preferences,keys:{...status.preferences?.keys,delete:'d',undoDelete:'u'}}}});
  assert.equal(legacy.status(),200);
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
      const height=await owner.evaluate(node=>node.clientHeight);
      await press('d');assert.ok(Math.abs(await top()-height*.5)<=1,mode+' plain d half page down with legacy delete binding');
      await press('u');assert.ok(await top()<=1,mode+' plain u half page up with legacy undo binding');
      await press('Home');
      await press('Control+d');assert.ok(Math.abs(await top()-height*.5)<=1,mode+' half page down');
      await press('Control+u');assert.equal(await top(),0,mode+' half page up');
      await press('Control+f');assert.ok(Math.abs(await top()-Math.max(56,height*.85))<=1,mode+' page down');
      await press('Control+b');assert.equal(await top(),0,mode+' page up');
      await press('Control+Shift+d');assert.equal(await top(),0,mode+' extra modifiers ignored');
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
    const response=await page.request.post(url+'api.php?r=import-items',{headers:{'X-CSRF-Token':status.csrf},data:{records:Array.from({length:80},(_,i)=>({kind:'tasks',title:'Vim page fixture '+i,body:'',meta:{priority:i<6?'High':'Normal'}}))}});
    assert.equal(response.status(),200);
    await page.getByRole('button',{name:'Tasks',exact:true}).click();
    await page.locator('#task-list-view summary').click();
    await page.getByLabel('Group tasks by').selectOption('priority');
    await page.locator('#items [data-mail-group-key]').nth(1).waitFor();
    await page.locator('#items .item').first().click();
    const list=page.locator('#items'),selectedTask=await page.locator('#selected-item').getAttribute('data-id');
    await list.evaluate(node=>{node.scrollTop=0;});
    await page.locator('#selected-item').focus();
    const listHeight=await list.evaluate(node=>node.clientHeight);
    for(const [key,distance] of [['d',listHeight*.5],['Control+d',listHeight*.5],['Control+f',Math.max(56,listHeight*.85)]]){
      await list.evaluate(node=>{node.scrollTop=0;});
      await page.keyboard.press(key);await settleScroll(list);
      assert.ok(Math.abs(await list.evaluate(node=>node.scrollTop)-distance)<=1,key+' scrolls focused list');
      if(key!=='Control+f'){
        assert.notEqual(await page.locator('#selected-item').getAttribute('data-id'),selectedTask);
        assert.ok(await page.locator('#selected-item').evaluate(node=>{
          const row=node.getBoundingClientRect(),pane=node.closest('#items').getBoundingClientRect();
          return document.activeElement===node&&row.bottom>pane.top&&row.top<pane.bottom;
        }),key+' focuses a row in the new viewport');
      }
      await page.keyboard.press(key==='d'?'u':key==='Control+d'?'Control+u':'Control+b');await settleScroll(list);
      assert.ok(await list.evaluate(node=>node.scrollTop)<=1,'reverse returns to top within pixel rounding');
    }
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),selectedTask);
    await page.keyboard.down('d');
    await page.keyboard.down('d');
    await page.keyboard.up('d');
    const index=()=>list.evaluate(node=>[...node.querySelectorAll('.item')].indexOf(node.querySelector('#selected-item')));
    await page.waitForFunction(height=>document.querySelector('#items').scrollTop>=height-1,listHeight);
    const pagedIndex=await index();
    await page.keyboard.press('k');
    await page.waitForFunction(expected=>{
      const rows=[...document.querySelectorAll('#items .item')];
      return rows.indexOf(document.querySelector('#selected-item'))===expected;
    },pagedIndex-1);
    await page.keyboard.press('l');
    assert.equal(await index(),pagedIndex-1);
    assert.ok(await list.evaluate(node=>node.scrollTop)>listHeight/2,'k and l continue from the paged selection');
    await page.locator('#selected-item').evaluate(node=>node.focus({preventScroll:true}));
    await list.evaluate(node=>{node.scrollTop=node.scrollHeight;});
    await page.keyboard.press('d');
    await page.waitForFunction(()=>{
      const list=document.querySelector('#items'),selected=list.querySelector('#selected-item');
      return list.scrollTop===list.scrollHeight-list.clientHeight &&
        selected.getBoundingClientRect().bottom>list.getBoundingClientRect().top &&
        document.activeElement===selected;
    });
    assert.equal(await page.locator('#dialog[open]').count(),0,'Ctrl+d does not delete');
    for(const field of [page.locator('#search'),page.locator('#detail textarea').first()]){
      await field.focus();
      for(const key of ['f','b','d','u'])assert.equal(await field.evaluate((node,key)=>node.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true})),key),true,'typing keeps Ctrl+'+key);
    }
  } finally {
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.request.post(url+'api.php?r=preferences',{headers:{'X-CSRF-Token':status.csrf},data:{preferences:status.preferences}});
  }
}
