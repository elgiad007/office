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
    const id=messages.some(r=>r.id==='a')?'a':'r000';
    // Sync refreshes once per batch and again after refreshing account metadata.
    await page.waitForFunction(({target,id})=>{
      const text=document.querySelector(`#items [data-id="${id}"]`)?.textContent||'';
      return document.querySelector('#sync-status')?.textContent.startsWith('Checked ')
        && Number(text.match(/refresh (\d+)/)?.[1])>=target;
    },{target,id});
    assert.ok(reads>=target);
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
    await page.keyboard.press('D');await item('a').waitFor({state:'detached'});await item('b').waitFor({state:'detached'});await item('c').waitFor({state:'detached'});
    await page.locator('#notice').filter({hasText:'3 items updated.'}).waitFor();

    await reset();await item('a').click();await item('c').click({modifiers:['Control']});await sync();await selection(['a','c']);
    await item('d').click({modifiers:['Shift']});await selection(['c','d']);
    removeId='c';await sync();await selection(['d']);
    await page.keyboard.press('D');await item('d').waitFor({state:'detached'});

    // Selection changes made while a refresh is pending must take precedence.
    await reset();await item('a').click();await page.keyboard.press('v');holdRecords=true;
    const target=reads+2;
    await Promise.all([page.waitForRequest(r=>r.url().includes('r=records')),page.locator('#sync-button').dispatchEvent('click')]);
    await page.keyboard.press('Escape');releaseRecords();await settled(target);await selection([]);
    await page.locator('#mail-folder').selectOption('Trash');await selection([]);
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'Mail',exact:true}).click();await selection([]);

    // A newly downloaded batch can push the visible rows beyond the paging cutoff.
    messages=Array.from({length:220},(_,n)=>fixture('r'+String(n).padStart(3,'0')));reads=0;
    await page.goto('about:blank');await page.goto(url+'?selection-scroll#mail');await settled(3);
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();
    const scrollTo=async(id,top=25)=>page.evaluate(({id,top})=>{
      const list=document.querySelector('#items'),row=list.querySelector(`[data-id="${id}"]`);
      list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-top;
    },{id,top});
    const viewport=async id=>page.evaluate(id=>{
      const list=document.querySelector('#items'),row=list.querySelector(`[data-id="${id}"]`);
      return {scrollTop:list.scrollTop,top:row?.getBoundingClientRect().top-list.getBoundingClientRect().top};
    },id);
    const sameTop=(before,after,label)=>assert.ok(Math.abs(after.top-before.top)<2,`${label}: row moved from ${before.top} to ${after.top}`);
    await scrollTo('r195');const beforePrepend=await viewport('r195');assert.ok(beforePrepend.scrollTop>0);
    messages.unshift(...Array.from({length:18},(_,n)=>fixture('n'+String(n).padStart(3,'0'))));
    await sync();sameTop(beforePrepend,await viewport('r195'),'prepend across 200 row limit');
    assert.equal(await item('r199').count(),1,'bottom visible rows remain rendered after prepend');

    // Scroll during an in-flight records request; restoration uses the latest viewport.
    holdRecords=true;const targetScroll=reads+2;
    await Promise.all([page.waitForRequest(r=>r.url().includes('r=records')),page.locator('#sync-button').dispatchEvent('click')]);
    await scrollTo('r100');const beforeDelayed=await viewport('r100');releaseRecords();await settled(targetScroll);
    sameTop(beforeDelayed,await viewport('r100'),'scroll while request pending');

    messages.push(...Array.from({length:12},(_,n)=>fixture('z'+String(n).padStart(3,'0'))));
    const beforeOlder=await viewport('r100');await sync();
    sameTop(beforeOlder,await viewport('r100'),'older mail appended below viewport');

    // If the first visible row disappears, use the next surviving row.
    await scrollTo('r080',0);const beforeRemoval=await viewport('r081');
    messages=messages.filter(r=>r.id!=='r080');await sync();
    sameTop(beforeRemoval,await viewport('r081'),'removed first visible row');

    // If every visible row disappears, retain the old scroll offset within the new bounds.
    await scrollTo('r100',0);
    const oldScroll=await page.locator('#items').evaluate(list=>list.scrollTop);
    const visibleIds=await page.locator('#items').evaluate(list=>{
      const bounds=list.getBoundingClientRect();
      return [...list.querySelectorAll('[data-id]')].filter(row=>{
        const rect=row.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom;
      }).map(row=>row.dataset.id);
    });
    messages=messages.filter(r=>!visibleIds.includes(r.id));await sync();
    const fallback=await page.locator('#items').evaluate(list=>({top:list.scrollTop,max:list.scrollHeight-list.clientHeight}));
    assert.ok(Math.abs(fallback.top-Math.min(oldScroll,fallback.max))<2,'removed viewport uses clamped scroll offset');

    // At the top, new messages should appear without shifting the viewport.
    await page.locator('#items').evaluate(list=>list.scrollTop=0);
    messages.unshift(fixture('m000'));await sync();
    assert.equal((await viewport('r000')).scrollTop,0,'top stays at top when new mail arrives');
    await page.locator('#mail-folder').selectOption('Trash');
    assert.equal(await page.locator('#items').evaluate(list=>list.scrollTop),0,'folder navigation resets list scroll');
    console.log('PASS mail selection and scroll survive sync, paging, delayed refresh, prepends, appends and removed anchors; navigation resets the viewport.');
  }finally{releaseRecords?.();await page.unroute(routes);await page.reload();}
}
