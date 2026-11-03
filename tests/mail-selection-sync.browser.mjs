import assert from 'node:assert/strict';

export async function testMailSelectionSync(page,url) {
  let messages=[],reads=0,removeId=null,holdRecords=false,releaseRecords;
  const fixture=id=>({id,kind:'mail',title:'Sync '+id,body:'Message '+id,revision:1,updated:'2026-11-01T12:00:00Z',meta:{read:true,folder:'Inbox',from:'sender@example.com',remote:true,account:'selection-sync'}});
  const routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences:{}};
    else if(action==='accounts')json={accounts:[{id:'selection-sync',label:'Selection sync',type:'imap'}]};
    else if(action==='activity')json={entries:[]};
    else if(action==='sync'){
      if(removeId){messages=messages.filter(r=>r.id!==removeId);removeId=null;}
      json={count:1,more:false};
    }else if(action==='records'){
      if(holdRecords){holdRecords=false;await new Promise(resolve=>releaseRecords=resolve);}
      reads++;json={records:messages.map(r=>({...r,title:r.title+' refresh '+reads}))};
    }else if(action==='mail-action'){
      const input=route.request().postDataJSON();assert.equal(input.action,'trash');
      const record=messages.find(r=>r.id===input.id);record.meta.folder='Trash';record.revision++;
      json={record};
    }else throw Error('Unexpected selection sync route '+action);
    await route.fulfill({json});
  });
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const selection=async ids=>assert.deepEqual(await page.locator('.multi-selected').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)),ids);
  const settled=async target=>{
    await page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent.startsWith('Checked '));
    // Sync refreshes once per batch and again after refreshing account metadata.
    for(let i=0;reads<target&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(reads>=target);
    await item('a').filter({hasText:'refresh '+reads}).waitFor();
  };
  const reset=async()=>{
    messages=['a','b','c','d'].map(fixture);reads=0;
    await page.goto('about:blank');await page.goto(url+'?selection-sync#mail');await settled(3);
  };
  const sync=async()=>{const target=reads+2;await page.locator('#sync-button').dispatchEvent('click');await settled(target);};
  try{
    await reset();await item('a').click();await page.keyboard.press('v');await page.keyboard.press('j');await page.keyboard.press('v');
    await sync();await selection(['a','b']);assert.equal(await page.locator('#selection-count').textContent(),'2 selected');
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'b');
    assert.equal(await page.locator('#selected-item').evaluate(n=>n===document.activeElement),true);
    await page.keyboard.press('j');await page.keyboard.press('v');await selection(['a','b','c']);
    await page.keyboard.press('d');await item('a').waitFor({state:'detached'});await item('b').waitFor({state:'detached'});await item('c').waitFor({state:'detached'});
    await page.locator('#notice').filter({hasText:'3 items updated.'}).waitFor();

    await reset();await item('a').click();await item('c').click({modifiers:['Control']});await sync();await selection(['a','c']);
    await item('d').click({modifiers:['Shift']});await selection(['c','d']);
    removeId='c';await sync();await selection(['d']);
    await page.keyboard.press('d');await item('d').waitFor({state:'detached'});

    // Selection changes made while a refresh is pending must take precedence.
    await reset();await item('a').click();await page.keyboard.press('v');holdRecords=true;
    const target=reads+2;
    await Promise.all([page.waitForRequest(r=>r.url().includes('r=records')),page.locator('#sync-button').dispatchEvent('click')]);
    await page.keyboard.press('Escape');releaseRecords();await settled(target);await selection([]);
    await page.locator('#mail-folder').selectOption('Trash');await selection([]);
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Mail',exact:true}).click();await selection([]);
    console.log('PASS mail multi-selection survives sync, preserves keyboard mode, mouse range anchor and focus, prunes missing messages and respects clearing.');
  }finally{releaseRecords?.();await page.unroute(routes);await page.reload();}
}
