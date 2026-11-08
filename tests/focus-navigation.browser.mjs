import {settleScroll} from './keyboard-scroll-ui.mjs';
import assert from 'node:assert/strict';

export async function testFocusNavigation(page,url) {
  const long=Array.from({length:180},(_,i)=>`Content line ${i}`).join('\n');
  let kind='mail';const removed=new Set();
  const routes=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='delete'){removed.add(route.request().postDataJSON().id);await route.fulfill({json:{ok:true}});return;}
    const records=[0,1,2].map(i=>({id:`focus-${kind}-${i}`,kind,title:`Focus ${kind} ${i}`,body:kind==='documents'?long.replaceAll('\n','<br>'):long,revision:1,meta:kind==='mail'?{folder:'Inbox',read:true,from:'sender@example.com'}:kind==='sheets'?{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}:{}})).filter(row=>!removed.has(row.id));
    const responses={status:{authenticated:true,csrf:'fixture',preferences:{theme:'dark',accent:'plum',keys:{down:'J',up:'K'}}},accounts:{accounts:[]},records:{records},connections:{items:[],links:[]},'google-settings':{configured:false}};
    assert.ok(action in responses,`Unexpected focus API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  try {
    await page.setViewportSize({width:1440,height:800});
    for(kind of ['mail','calendar','tasks','contacts','documents','wiki','sheets']){
      await page.goto(url+'#'+kind);await page.reload();
      await page.locator('#items .item').nth(1).click();
      const selected=await page.locator('#selected-item').getAttribute('data-id');
      const entry=kind==='mail'?'.mail-body':kind==='sheets'?'.sheet-wrap':'#detail';
      const owner=kind==='mail'?'#detail':kind==='sheets'?'.sheet-wrap':kind==='documents'?'#rich-editor':'textarea.body-editor';
      const scrollOffset=()=>page.evaluate(selector=>{const node=document.querySelector(selector);return(node&&node.scrollHeight>node.clientHeight?node:document.querySelector('#detail')).scrollTop;},owner);
      const box=await page.locator('#detail').boundingBox();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(entry).evaluate(node=>node===document.activeElement),true,kind+' enters nonediting content');
      if(['mail','tasks','calendar'].includes(kind)){
        await page.locator('#search').fill('no matching focus records');
        assert.equal(await page.locator('#items [data-id]').count(),0,kind+' filter hides selected row');
        assert.equal(await page.locator('#detail').textContent().then(text=>text.includes(`Focus ${kind} 1`)),true,kind+' filter retains content');
        await page.locator(entry).focus();
        for(const key of ['h','ArrowLeft','Shift+Tab']){
          await page.keyboard.press(key);
          assert.equal(await page.locator('#items').evaluate(node=>node===document.activeElement),true,kind+' '+key+' focuses empty list');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#items').evaluate(node=>node===document.activeElement),true,kind+' empty-list restoration keeps focus');
          await page.keyboard.press('Tab');
          assert.equal(await page.locator(entry).evaluate(node=>node===document.activeElement),true,kind+' empty list Tab returns to retained content');
        }
        await page.locator('#search').fill('');
        await page.locator('#selected-item').focus();
        await page.keyboard.press('Tab');
      }
      assert.equal(await page.locator('#detail').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
      assert.deepEqual(await page.locator('#detail').boundingBox(),box,'Focus ring causes no layout shift');
      if(kind==='mail'){
        await page.keyboard.press('J');await settleScroll(page.locator('#detail'));assert.ok(await scrollOffset()>0,'Remapped Mail down scrolls plain text');
        const down=await scrollOffset();await page.keyboard.press('K');await settleScroll(page.locator('#detail'));assert.ok(await scrollOffset()<down,'Remapped Mail up scrolls plain text');
        await page.keyboard.press('G');await settleScroll(page.locator('#detail'));assert.ok(await scrollOffset()>down,'Mail G reaches bottom');
        await page.keyboard.press('g');await page.keyboard.press('g');await settleScroll(page.locator('#detail'));assert.equal(await scrollOffset(),0,'Mail gg reaches top');
        assert.equal(await page.locator('#selected-item').getAttribute('data-id'),selected,'Mail scrolling keeps the message');
        await page.keyboard.press('n');await page.locator('#selected-item[data-id="focus-mail-2"]').waitFor();
        await page.keyboard.press('N');await page.locator('#selected-item[data-id="focus-mail-1"]').waitFor();
      }else{
        await page.keyboard.press('J');
        await page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id!==id,selected);
        await page.keyboard.press('G');await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id?.endsWith('-2'));
        await page.keyboard.press('g');await page.keyboard.press('g');await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id?.endsWith('-0'));
      }
      assert.equal(await page.locator(entry).evaluate(node=>node===document.activeElement),true,kind+' keeps content focus');
      await page.keyboard.press('v');
      assert.equal(await page.locator(entry).evaluate(node=>node===document.activeElement),true,kind+' selection retains content focus');
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menu',{name:'Item actions'}).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator(entry).evaluate(node=>node===document.activeElement),true,kind+' menu restores content focus');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),true);
      assert.equal(await page.locator('.list-pane').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
      await page.keyboard.press('J');
      await page.waitForFunction(suffix=>document.querySelector('#selected-item')?.dataset.id?.endsWith(suffix),kind==='mail'?'-2':'-1');
      if(kind==='sheets'){
        await page.keyboard.press('l');assert.equal(await page.locator('[data-cell=A1]').evaluate(node=>node===document.activeElement),true);
        await page.keyboard.press('Tab');assert.equal(await page.locator('[data-cell=B1]').evaluate(node=>node===document.activeElement),true);
        await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[data-cell=A1]').evaluate(node=>node===document.activeElement),true);
      }else if(kind!=='mail'&&kind!=='wiki'){
        await page.locator('.title-input').focus();await page.keyboard.press('Tab');
        assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),false,'Editor Tab remains native');
      }
      if(kind!=='mail'){
        await page.locator('#items [data-id="focus-'+kind+'-1"]').click();
        await page.keyboard.press('Tab');
        for(const next of ['2','0',null]){
          await page.keyboard.press('D');await page.locator('#confirm').click();
          if(next!==null){
            await page.locator('#selected-item[data-id="focus-'+kind+'-'+next+'"]').waitFor();
            assert.equal(await page.locator('#detail').evaluate(node=>node.contains(document.activeElement)),true,kind+' deletion keeps content focus');
          }else{
            await page.waitForFunction(()=>!document.querySelector('#selected-item'));
            assert.equal(await page.locator(kind==='calendar'?'#items':'#detail').evaluate(node=>node===document.activeElement),true,kind+' empty workspace keeps focus');
            await page.keyboard.press('h');
            assert.equal(await page.locator('#items').evaluate(node=>node===document.activeElement),true,kind+' empty workspace focuses list');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#items').evaluate(node=>node===document.activeElement),true,kind+' empty workspace restores list');
            await page.keyboard.press('Tab');
            assert.equal(await page.locator('#items').evaluate(node=>node===document.activeElement),false,kind+' empty workspace Tab is not trapped');
          }
        }
      }

    }
  }finally{await page.unroute(routes);await page.goto(url+'#mail');await page.reload();}
}

export async function testSettingsNavigation(page,url) {
  let keys={};
  const routes=target=>target.pathname.endsWith('/api.php')&&target.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    const responses={status:{authenticated:true,csrf:'fixture',preferences:{keys}},accounts:{accounts:[{id:'fixture',label:'Fixture mail',type:'imap'}]},'google-settings':{configured:false},'mail-junk-settings':{rules:[],folder:''},sync:{ok:true}};
    assert.ok(action in responses,`Unexpected Settings API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  const focused=async selector=>assert.equal(await page.locator(selector).evaluate(node=>node===document.activeElement),true,`${selector} should have focus`);
  const category=name=>`[data-settings-category="${name}"]`;
  try {
    for(const remapped of [false,true]){
      keys=remapped?{left:'H',right:'L',down:'J',up:'K',pageDown:'F'}:{};
      const [left,right,down,up]=remapped?['H','L','J','K']:['h','l','j','k'];
      await page.setViewportSize(remapped?{width:900,height:450}:{width:1440,height:600});
      await page.goto(url+'#settings');
      await page.evaluate(()=>sessionStorage.removeItem('office-settings-page'));
      await page.reload();
      const sidebar=page.locator('[data-app="settings"]');
      await sidebar.focus();
      await page.keyboard.press(right);await focused(category('appearance'));
      await page.keyboard.press(down);await focused(category('mail'));
      assert.equal(await page.locator(category('appearance')).getAttribute('aria-current'),'page');
      await page.keyboard.press(up);await focused(category('appearance'));
      await page.keyboard.press('Tab');await focused('[name="theme"]');
      await page.keyboard.press('ArrowDown');await focused('[name="theme"]');
      await page.keyboard.press('Shift+Tab');await focused(category('appearance'));
      await page.keyboard.press('End');await focused(category('backups'));
      await page.keyboard.press('ArrowUp');await focused(category('keyboard'));
      await page.keyboard.press('Space');
      assert.equal(await page.locator(category('keyboard')).getAttribute('aria-current'),'page');
      await page.keyboard.press(right);await focused('#settings-keyboard');
      const scroll=()=>page.evaluate(()=>Math.max(document.querySelector('#main').scrollTop,document.scrollingElement.scrollTop));
      await page.keyboard.press('Home');
      await page.waitForFunction(()=>!document.querySelector('#main').scrollTop&&!document.scrollingElement.scrollTop);
      await page.keyboard.press(remapped?'F':'Control+f');
      await page.waitForFunction(()=>document.querySelector('#main').scrollTop>0||document.scrollingElement.scrollTop>0);
      assert.ok(await scroll()>0);
      const panel=await page.locator('#settings-keyboard').elementHandle();
      await page.locator('#sync-button').evaluate(button=>button.click());
      await page.waitForFunction(node=>!node.isConnected,panel);
      await focused('#settings-keyboard');
      await page.keyboard.press('Tab');await focused('[name="key_down"]');
      await page.keyboard.press(left);await focused('[name="key_down"]');
      await page.keyboard.press('Shift+Tab');await focused(category('keyboard'));
      await page.keyboard.press('Home');await focused(category('appearance'));
      await page.keyboard.press('ArrowDown');await focused(category('mail'));
      await page.keyboard.press('Enter');
      await page.keyboard.press(right);await focused('#settings-mail');
      await page.keyboard.press(left);await focused(category('mail'));
      await page.keyboard.press(left);await focused('[data-app="settings"]');
    }
  }finally{await page.unroute(routes);await page.setViewportSize({width:1440,height:800});await page.goto(url+'#mail');await page.reload();}
}
