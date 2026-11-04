import assert from 'node:assert/strict';

export async function testMailView(page,url) {
  let preferences={},writes=0,reads=0;
  const day=new Date(),date=(offset,hour)=>new Date(day.getFullYear(),day.getMonth(),day.getDate()+offset,hour).toISOString();
  const mail=(id,when,from,title)=>({id,kind:'mail',title,body:'Body '+id,revision:1,meta:{date:when,from,folder:'Inbox',read:true,remote:true,account:'view-account'}});
  let records=[mail('a',date(0,14),'Zed <z@example.com>','Zebra'),mail('b',date(0,13),'Amy <a@example.com>','Alpha'),mail('c',date(-1,12),'Beta <b@example.com>','Charlie'),mail('u','invalid','','Undated')];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences};
    else if(action==='accounts')json={accounts:[{id:'view-account',type:'imap',label:'View fixture'}]};
    else if(action==='records'){reads++;json={records};}
    else if(action==='sync')json={count:0};
    else if(action==='preferences'){preferences=route.request().postDataJSON().preferences;writes++;json={ok:true};}
    else if(action==='activity')json={entries:[]};
    else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='mail-action'){
      const input=route.request().postDataJSON(),record=records.find(r=>r.id===input.id);
      assert.equal(input.action,'trash');record.meta.folder='Trash';record.revision++;json={record};
    }else throw Error('Unexpected view fixture API: '+action);
    await route.fulfill({json});
  });
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const header=label=>page.locator('[data-mail-group-key]').filter({has:page.locator('.mail-group-label',{hasText:new RegExp('^'+label+'$')})});
  const order=()=>page.locator('#items .item').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  const open=async()=>{if(!await page.locator('#mail-list-view').evaluate(node=>node.open))await page.locator('#mail-list-view > summary').click();};
  const save=async action=>{const before=writes;const response=page.waitForResponse(r=>r.url().includes('r=preferences'));await action();await(await response).finished();assert.ok(writes>before);};
  const choose=async(label,value)=>{await open();await save(()=>page.getByLabel(label,{exact:true}).selectOption(value));};
  const sync=async()=>{const before=reads;await page.locator('#sync-button').click();await page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent.startsWith('Checked '));assert.ok(reads>before);};
  try{
    await page.goto('about:blank');await page.goto(url+'#mail');await selected('a');
    assert.deepEqual(await order(),['a','b','c','u']);
    assert.deepEqual(await page.locator('.mail-group-label').allTextContents(),['Today','Yesterday','Undated']);
    await choose('Sort mail by','subject-asc');assert.deepEqual(await order(),['b','a','c','u']);
    await choose('Group mail by','sender');assert.deepEqual(await order(),['b','c','u','a']);
    await choose('Sort mail by','sender-desc');assert.deepEqual(await order(),['a','u','c','b']);
    await choose('Group mail by','none');assert.equal(await page.locator('.mail-group-header').count(),0);
    await choose('Group mail by','date');await choose('Sort mail by','date-desc');
    await item('b').click();await page.keyboard.press('v');
    await save(()=>header('Today').click());
    assert.equal(await header('Today').getAttribute('aria-expanded'),'false');
    assert.deepEqual(await order(),['c','u']);assert.equal(await page.locator('#selection-count').textContent(),'1 selected');
    assert.equal(await page.locator('#detail h1').last().textContent(),'Alpha');
    await sync();assert.deepEqual(await order(),['c','u']);assert.equal(await page.locator('#selection-count').textContent(),'1 selected');
    await header('Today').focus();await page.keyboard.press('j');await selected('c');
    await item('c').click();await item('u').click({modifiers:['Shift']});
    assert.deepEqual(await page.locator('.multi-selected').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),['c','u']);
    await page.reload();await header('Today').waitFor();assert.deepEqual(await order(),['c','u']);
    await header('Today').focus();await save(()=>page.keyboard.press('Enter'));assert.equal(await header('Today').getAttribute('aria-expanded'),'true');
    await save(()=>page.keyboard.press('Space'));assert.equal(await header('Today').getAttribute('aria-expanded'),'false');
    await open();await save(()=>page.getByRole('button',{name:'Collapse all',exact:true}).click());
    assert.deepEqual(await order(),[]);
    await page.reload();await header('Today').waitFor();assert.deepEqual(await order(),[]);
    assert.equal(await page.locator('#selected-item').count(),0);
    await header('Today').focus();await save(()=>page.keyboard.press('Enter'));assert.deepEqual(await order(),['a','b']);
    await open();await save(()=>page.getByRole('button',{name:'Expand all',exact:true}).click());assert.equal((await order()).length,4);
    await page.locator('#mail-list-view > summary').click();
    await item('a').click();await save(()=>header('Today').click());
    await item('c').click();await page.keyboard.press('D');await selected('u');
    assert.deepEqual(await order(),['u'],'Delete advances within the expanded order');
    await page.locator('#mail-folder').selectOption('Trash');assert.equal(await page.getByLabel('Group mail by').inputValue(),'date');
    await page.locator('#mail-folder').selectOption('Inbox');assert.equal(await header('Today').getAttribute('aria-expanded'),'false');

    // Paging counts messages, skips collapsed rows, and can navigate past the cutoff.
    preferences={mailView:{group:'sender',sort:'date-desc',collapsed:[]}};
    records=Array.from({length:220},(_,n)=>mail((n<110?'a':'b')+String(n%110).padStart(3,'0'),'invalid',n<110?'Amy <a@example.com>':'Beta <b@example.com>','Page '+n));
    await page.reload();await selected('a000');assert.equal((await order()).length,100);
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();assert.equal((await order()).length,200);
    await save(()=>header('Amy <a@example.com>').click());assert.equal((await order()).length,100);assert.equal((await order())[0],'b000');
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();assert.equal((await order()).length,110);
    await header('Amy <a@example.com>').focus();await save(()=>page.keyboard.press('Enter'));
    await item('a000').click();await page.keyboard.press('G');await selected('b109');assert.equal((await order()).length,220);
    await open();await page.screenshot({path:'test-results/mail-view-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mail-view-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    const menu=await page.locator('.mail-view-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=390);
    console.log('PASS mail list view: grouping/sorting, collapse and native keyboard activation, hidden selection/reader and sync, persistence, expanded navigation/range/delete order, collapse-all, paging and mobile menu.');
  }finally{await page.setViewportSize({width:1440,height:1000});await page.unroute(routes);await page.goto('about:blank');}
}
