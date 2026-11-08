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
    };
    await route.fulfill({json:responses[action]||{entries:[],count:0}});
  });

  const button=name=>page.getByRole('button',{name,exact:true});
  const detail=page.locator('#detail');
  const go=async name=>{await button('Menu').tap();await button(name).tap();await page.locator('#crumb').getByText(name,{exact:true}).waitFor();};
  const back=()=>button('← Back to list').tap();
  const fit=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  try{
    await page.goto(url+'#mail');
    await page.locator('#items .item').first().waitFor();
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
    await page.waitForFunction(()=>document.querySelector('#items [data-id="mail-20"]')?.classList.contains('mail-read'));
    assert.deepEqual(reads,['mail-20']);
    assert.equal(await page.locator('#items').isVisible(),false);
    await back();
    assert.equal(await search.inputValue(),'Phone mail');
    assert.equal(await page.locator('#items').evaluate(node=>node.scrollTop),top);
    assert.equal(await mail.evaluate(node=>node===document.activeElement),true);

    await button('Compose').tap();
    await page.getByRole('textbox',{name:'Title',exact:true}).fill('Mobile draft');
    await detail.getByLabel('Message',{exact:true}).fill('Unsaved content');
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
        await page.locator('[data-cell="B1"]').tap();
        await page.locator('#formula').fill('=A1*3');
        assert.equal(await page.locator('[data-cell="B1"]').textContent(),'6');
      }
      await detail.getByRole('textbox',{name:app==='Lists'?'List name':'Title',exact:true}).fill('Edited '+app);
      await detail.getByRole('button',{name:'Save',exact:true}).tap();
      await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved');
      assert.equal(saves.at(-1).title,'Edited '+app);
      await back();
      assert.equal(await detail.isVisible(),false);
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
    for(const viewport of [{width:320,height:568},{width:844,height:390},{width:768,height:1024}]){
      await page.setViewportSize(viewport);
      await button('Menu').waitFor();
      assert.ok(await fit(),JSON.stringify(viewport));
    }

    await page.setViewportSize({width:1440,height:1000});
    await button('Tasks').click();
    await page.locator('#items [data-id="task"]').click();
    await detail.waitFor();
    assert.equal(await page.locator('#items').isVisible(),true);
    assert.equal(await button('Menu').isVisible(),false);
    await page.locator('#selected-item').focus();
    await page.keyboard.press('l');
    assert.equal(await detail.evaluate(node=>node===document.activeElement),true);
    assert.deepEqual(errors,[]);
    console.log('PASS touch navigation, mail list return, drafts, all item editors, and phone/tablet layouts.');
  } finally {await page.close();}
}
