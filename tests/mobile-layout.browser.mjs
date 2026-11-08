import assert from 'node:assert/strict';

export async function testMobileLayout(browser, url) {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const now=new Date().toISOString();
  const row=(kind,id,title,meta={})=>({kind,id,title,meta,body:'Original content',created:now,updated:now,revision:1});
  let rows=[
    ...Array.from({length:50},(_,index)=>row('mail','mail-'+index,'Phone mail '+index,{folder:'Inbox',from:'reader@example.com',read:false})),
    row('calendar','event','Phone event',{start:now,end:new Date(Date.now()+3600000).toISOString()}),
    row('tasks','task','Phone task'),
    row('contacts','contact','Phone contact'),
    row('documents','document','Phone document'),
    row('wiki','page','phone:page'),
    row('sheets','sheet','Phone workbook',{workbook:{sheets:[{name:'Sheet 1',cells:{A1:'2'}}]}}),
    row('lists','list','Phone list',{checklist:[]}),
    row('lists','empty-list','Empty checklist',{checklist:[]}),
  ];
  const reads=[],saves=[];
  await page.route('**/api.php?*',async route=>{
    const query=new URL(route.request().url()).searchParams,action=query.get('r');
    const input=route.request().postDataJSON();
    if(action==='save'){
      if(input.kind==='mail'&&input.meta.read)reads.push(input.id);
      const record={...input,id:input.id||'new-'+saves.length,created:now,updated:now,revision:(input.revision||0)+1};
      saves.push(record);
      rows=rows.filter(item=>item.id!==record.id).concat(record);
      await route.fulfill({json:{record}});
      return;
    }
    const responses={
      status:{authenticated:true,csrf:'fixture',preferences:{}},
      accounts:{accounts:[]},
      records:{records:rows.filter(item=>item.kind===query.get('kind'))},
      connections:query.get('id')==='document'
        ?{items:rows.filter(item=>item.id==='contact'),links:[{}]}
        :{items:[],links:[]},
    };
    await route.fulfill({json:responses[action]||{entries:[],count:0}});
  });

  const button=name=>page.getByRole('button',{name,exact:true});
  const iconButton=async name=>{
    const control=button(name);
    await control.waitFor();
    assert.equal(await control.locator('svg[aria-hidden="true"]').isVisible(),true);
    assert.equal((await control.innerText()).trim(),'');
    const bounds=await control.boundingBox();
    assert.ok(bounds.width>=44&&bounds.height>=44,name+' has a full-size touch target');
    return control;
  };
  const detail=page.locator('#detail');
  const listTitle=detail.getByRole('textbox',{name:'List name',exact:true});
  const listTitleSize=()=>listTitle.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  const assertListTitleAlignment=async()=>{
    const [input,header,rename]=await Promise.all([
      listTitle.boundingBox(),
      detail.locator('.checklist-title').boundingBox(),
      button('Rename list').boundingBox(),
    ]);
    assert.ok(Math.abs(input.x-header.x)<1,'List title starts at the left edge of its header');
    assert.ok(Math.abs(input.y-header.y)<1&&Math.abs(rename.y-header.y)<1,'List title and rename button align with the top of the header');
    assert.ok(header.height<65,'List title header does not grow to fill the pane');
  };
  const go=async name=>{await button('Menu').tap();await button(name).tap();await page.locator('#crumb').getByText(name,{exact:true}).waitFor();};
  const back=()=>button('Back to list').tap();
  const fit=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  try{
    await page.goto(url+'#mail');
    await page.locator('#items .item').first().waitFor();
    for(const name of ['Menu','Compose','More','Folders'])await iconButton(name);
    const shortcuts=button('Keyboard shortcuts');
    const shortcutsHeading=page.getByRole('heading',{name:'Keyboard shortcuts and commands',exact:true});
    const viewHelp=page.getByRole('tabpanel',{name:'This view'});
    const allHelp=page.getByRole('tabpanel',{name:'All help'});
    const closeHelp=()=>button('Close help').tap();
    for(const viewport of [{width:320,height:568},{width:844,height:390}]){
      await page.setViewportSize(viewport);
      const landscape=viewport.width>viewport.height;
      await button(landscape?'Folders':'Menu').tap();
      if(landscape)await page.locator('#mail-folder').waitFor();
      await shortcuts.scrollIntoViewIfNeeded();
      const drawer=await shortcuts.evaluate(node=>{
        const sidebar=node.closest('#app-sidebar');
        const {top,bottom}=sidebar.getBoundingClientRect();
        const row=node.getBoundingClientRect();
        return {
          scrolled:sidebar.scrollTop>0,
          rowVisible:row.top>=top&&row.bottom<=bottom,
          outline:getComputedStyle(sidebar).outlineStyle,
          scrollableOutline:getComputedStyle(sidebar,'::after').content,
        };
      });
      assert.deepEqual(drawer,{scrolled:true,rowVisible:true,outline:'solid',scrollableOutline:'none'});
      if(landscape){
        await shortcuts.focus();
        await page.keyboard.press('Enter');
      }else await shortcuts.tap();
      await shortcutsHeading.waitFor();
      await viewHelp.getByRole('heading',{name:'Mail',exact:true}).waitFor();
      await page.getByRole('tab',{name:'All help'}).tap();
      const helpBounds=await allHelp.evaluate(node=>({fits:node.scrollWidth<=node.clientWidth,scrolls:node.scrollHeight>node.clientHeight}));
      assert.equal(helpBounds.fits,true,'Help fits without sideways scrolling');
      assert.equal(helpBounds.scrolls,true,'Help can scroll vertically');
      await allHelp.getByRole('searchbox').fill('Quick Move');
      await allHelp.getByText('Quick Move to folder',{exact:true}).waitFor();
      await closeHelp();
      await shortcutsHeading.waitFor({state:'hidden'});
    }
    await page.setViewportSize({width:390,height:844});
    const listView=page.locator('#mail-list-view > summary[aria-label="List view"]');
    assert.equal(await listView.locator('svg').isVisible(),true);
    assert.equal((await listView.innerText()).trim(),'');
    await listView.tap();
    await page.getByLabel('Sort mail by').waitFor();
    await listView.tap();
    assert.equal(await detail.isVisible(),false);
    assert.deepEqual(reads,[]);
    assert.equal(await button('Import').isVisible(),false);
    await button('More').tap();
    assert.equal(await button('Import').isVisible(),true);
    await button('More').tap();
    await button('Folders').tap();
    await page.locator('#mail-folder').selectOption('Inbox');
    await button('Menu').waitFor();
    assert.equal(await page.locator('#app-sidebar').isVisible(),false);
    const search=page.getByRole('searchbox');
    await search.fill('Phone mail');
    const mail=page.locator('#items [data-id="mail-20"]');
    await mail.scrollIntoViewIfNeeded();
    const top=await page.locator('#items').evaluate(node=>node.scrollTop);
    assert.ok(top>0);
    await mail.tap();
    await detail.getByRole('heading',{name:'Phone mail 20'}).waitFor();
    assert.equal(await button('Back to list').locator('svg').isVisible(),true);
    await button('Help').tap();
    await viewHelp.getByRole('heading',{name:'Mail · Message',exact:true}).waitFor();
    assert.equal(await viewHelp.getByText('Reply to message').isVisible(),true);
    assert.equal(await viewHelp.getByText('Quick Move to folder').count(),0,'Local mail has no Quick Move shortcut');
    await closeHelp();
    assert.equal(await button('Help').evaluate(node=>node===document.activeElement),true);
    await page.waitForFunction(()=>document.querySelector('#items [data-id="mail-20"]')?.classList.contains('mail-read'));
    assert.deepEqual(reads,['mail-20']);
    assert.equal(await page.locator('#items').isVisible(),false);
    await back();
    assert.equal(await search.inputValue(),'Phone mail');
    assert.equal(await page.locator('#items').evaluate(node=>node.scrollTop),top);
    assert.equal(await mail.evaluate(node=>node===document.activeElement),true);

    await button('Compose').tap();
    await iconButton('Add files');
    await page.getByRole('textbox',{name:'Title',exact:true}).fill('Mobile draft');
    await detail.getByLabel('Message',{exact:true}).fill('Unsaved content');
    await button('Help').tap();
    await viewHelp.getByRole('heading',{name:'Mail · Draft',exact:true}).waitFor();
    assert.equal(await viewHelp.getByText('Send current message').isVisible(),true);
    assert.equal(await viewHelp.getByText('Reply to message').count(),0);
    await closeHelp();
    await page.setViewportSize({width:390,height:410});
    const sendBounds=await button('Send message').boundingBox();
    assert.ok(sendBounds.y>=0&&sendBounds.y+sendBounds.height<=410,'Send remains reachable when the keyboard reduces the viewport');
    await back();
    await button('Cancel').tap();
    assert.equal(await detail.getByLabel('Message',{exact:true}).inputValue(),'Unsaved content');
    await back();
    await button('Discard Draft').tap();
    assert.equal(await detail.isVisible(),false);
    assert.equal(await search.inputValue(),'Phone mail');
    await page.setViewportSize({width:390,height:844});

    for(const [app,id] of [['Calendar','event'],['Tasks','task'],['Contacts','contact'],['Documents','document'],['Wiki','page'],['Sheets','sheet'],['Lists','list']]){
      await go(app);
      if(app==='Calendar'){
        await page.locator('.calendar-agenda').waitFor();
        await page.locator('.calendar-sources summary').tap();
        await page.locator('[data-source="local"]').waitFor();
      }
      await page.locator(`#items [data-id="${id}"]`).tap();
      await detail.waitFor();
      assert.ok(await fit(),app+' fits the phone width');
      if(app==='Wiki')await button('Edit source').tap();
      if(app==='Documents'){
        await button('Formatting').tap();
        assert.equal(await button('Bold').isVisible(),true);
        await detail.getByRole('textbox',{name:'Document content'}).fill('Edited on a phone');
      }
      if(app==='Sheets'){
        await iconButton('Add sheet');
        await iconButton('Rename sheet');
        await page.locator('[data-cell="B1"]').tap();
        await page.locator('#formula').fill('=A1*3');
        assert.equal(await page.locator('[data-cell="B1"]').textContent(),'6');
      }
      await detail.getByRole('textbox',{name:app==='Lists'?'List name':'Title',exact:true}).fill('Edited '+app);
      await detail.getByRole('button',{name:'Save',exact:true}).tap();
      await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved');
      assert.equal(saves.at(-1).title,'Edited '+app);
      await button('More actions').tap();
      const deleteItem=await iconButton('Delete');
      if(app==='Tasks'){
        await deleteItem.tap();
        const dialog=page.getByRole('dialog',{name:'Delete item',exact:true});
        await dialog.getByRole('button',{name:'Delete item',exact:true}).waitFor();
        await dialog.getByRole('button',{name:'Cancel',exact:true}).tap();
      }
      if(app==='Documents'){
        await iconButton('Link item');
        await page.locator('#connection-count').tap();
        await iconButton('Remove connection to Edited Contacts');
        await page.keyboard.press('Escape');
      }
      if(app==='Lists'){
        await iconButton('Rename list');
        await assertListTitleAlignment();
        const emptySize=await listTitleSize();
        assert.ok(emptySize>27,`An empty list has room for a larger title (got ${emptySize}px)`);
        const add=await iconButton('Add item');
        await detail.getByRole('textbox',{name:'New checklist item'}).fill('Budget review');
        await add.tap();
        await iconButton('Edit Budget review');
        const remove=await iconButton('Remove Budget review');
        await remove.tap();
        const dialog=page.getByRole('dialog',{name:'Remove checklist item',exact:true});
        await dialog.getByRole('button',{name:'Remove item',exact:true}).tap();
        assert.equal(await remove.count(),0);
        const entry=detail.getByRole('textbox',{name:'New checklist item'});
        const pasteItems=count=>entry.evaluate((input,count)=>{
          const clipboardData=new DataTransfer();
          clipboardData.setData('text/plain',Array.from({length:count},(_,index)=>`Item ${index+1}`).join('\n'));
          input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
        },count);
        await pasteItems(4);
        const shortSize=await listTitleSize();
        assert.ok(shortSize<emptySize);
        await pasteItems(8);
        const longSize=await listTitleSize();
        assert.ok(longSize<shortSize&&longSize>=22);
        await assertListTitleAlignment();
        assert.ok(await fit(),'Long lists fit the phone width');
      }
      await back();
      await detail.waitFor({state:'hidden'});
    }

    await go('Tasks');
    await button('New task').tap();
    await detail.getByRole('textbox',{name:'Title',exact:true}).fill('Created on a phone');
    await back();
    await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).tap();
    await page.locator('#items').getByText('Created on a phone',{exact:true}).waitFor();
    assert.equal(await detail.isVisible(),false);

    await go('Settings');
    await page.getByRole('button',{name:/Settings categories/}).tap();
    await button('Mail settings').tap();
    assert.equal(await button('Mail settings').isVisible(),false);
    await page.getByRole('button',{name:/Settings categories/}).tap();
    await button('Accounts settings').tap();
    await iconButton('Add account');
    await button('Menu').tap();
    await shortcuts.tap();
    await viewHelp.getByRole('heading',{name:'Settings · Accounts',exact:true}).waitFor();
    await closeHelp();
    for(const viewport of [{width:320,height:568},{width:844,height:390},{width:768,height:1024}]){
      await page.setViewportSize(viewport);
      await button('Menu').waitFor();
      assert.ok(await fit(),JSON.stringify(viewport));
    }

    await page.setViewportSize({width:1440,height:1000});
    await button('Lists').focus();
    assert.equal(await page.locator('#app-sidebar').evaluate(node=>getComputedStyle(node,'::after').borderTopStyle),'solid');
    await button('Lists').click();
    await page.locator('#items [data-id="empty-list"]').click();
    await assertListTitleAlignment();
    const desktopEmptySize=await listTitleSize();
    await page.locator('#items [data-id="list"]').click();
    const desktopLongSize=await listTitleSize();
    assert.ok(desktopLongSize<desktopEmptySize&&desktopLongSize>=22);
    await assertListTitleAlignment();
    await page.setViewportSize({width:1440,height:500});
    assert.ok(await listTitleSize()<desktopLongSize,'A shorter detail pane reduces title size');
    await page.setViewportSize({width:1440,height:1000});
    await button('Tasks').click();
    await page.locator('#items [data-id="task"]').click();
    await detail.waitFor();
    assert.equal(await page.locator('#items').isVisible(),true);
    assert.equal(await button('Menu').isVisible(),false);
    const desktopDelete=detail.getByRole('button',{name:'Delete',exact:true});
    assert.equal(await desktopDelete.locator('.mobile-icon-label').isVisible(),true);
    assert.equal(await desktopDelete.locator('svg').isVisible(),false);
    await page.locator('#selected-item').focus();
    await page.keyboard.press('l');
    assert.equal(await detail.evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('?');
    await viewHelp.getByRole('heading',{name:'Tasks · Task',exact:true}).waitFor();
    assert.equal(await viewHelp.getByText('Mark current task complete').isVisible(),true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'All help',selected:true}).evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Tab');
    const helpSearch=allHelp.getByRole('searchbox');
    assert.equal(await helpSearch.evaluate(node=>node===document.activeElement),true);
    await helpSearch.fill(':warnings');
    assert.equal(await allHelp.getByRole('row').count(),2,'Search shows the header and the matching command');
    await page.keyboard.press('Escape');
    await shortcutsHeading.waitFor({state:'hidden'});
    assert.equal(await detail.evaluate(node=>node===document.activeElement),true);
    assert.deepEqual(errors,[]);
    console.log('PASS touch navigation, mail list return, drafts, all item editors, and phone/tablet layouts.');
  } finally {await page.close();}
}
