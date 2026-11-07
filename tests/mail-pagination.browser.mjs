import assert from 'node:assert/strict';

export async function testMailPagination(page,url) {
  const records=Array.from({length:235},(_,i)=>({id:`paged-${String(i).padStart(3,'0')}`,kind:'mail',title:`Message ${i}`,body:i===234?'Needle beyond first page':'Body',revision:1,summary:true,meta:{folder:i<230?'Inbox':'Archive',date:new Date(1760000000000-i*1000).toISOString(),from:'sender@example.com',read:true,hasAttachments:false}}));
  records[229].body='Hidden inbox needle';
  let preferences={},fail=false,hold=false,release;const requests=[];
  const routes=t=>t.pathname.endsWith('/api.php')&&t.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const params=new URL(route.request().url()).searchParams,action=params.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,csrf:'fixture',preferences}});
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='connections')return route.fulfill({json:{links:[],items:[],more:false}});
    if(action==='preferences'){preferences=route.request().postDataJSON().preferences;return route.fulfill({json:{ok:true}});}
    if(action==='records'){
      if(params.get('kind')!=='mail')return route.fulfill({json:{records:[]}});
      requests.push(Object.fromEntries(params));
      if(fail){fail=false;return route.fulfill({status:503,json:{error:'Fixture list failure'}});}
      const matching=params.has('view')?records.filter(r=>r.meta.folder===params.get('folder')):records;
      const limit=params.get('page')==='1'?Number(params.get('limit')||100):matching.length;
      if(hold){hold=false;await new Promise(resolve=>release=resolve);}
      return route.fulfill({json:{records:matching.slice(0,limit),...(params.has('view')?{mailPage:{total:matching.length,offset:0,more:limit<matching.length}}:{})}});
    }
    throw Error('Unexpected pagination request '+action);
  });
  const items=page.locator('#items .item');
  const count=async n=>page.waitForFunction(n=>document.querySelectorAll('#items .item').length===n,n);
  try {
    await page.goto(url+'?pagination#mail');await count(100);
    assert.match(await page.locator('#list-count').textContent(),/100 of 230/);
    assert.equal(requests[0].page,'1');assert.equal(requests[0].folder,'Inbox');
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();await count(200);
    await page.locator('#items [data-id="paged-199"]').click();await page.keyboard.press('j');
    await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id==='paged-200');
    await count(230);
    // Search loads the entire folder, including rows beyond the first page.
    await page.locator('#search').fill('Hidden inbox needle');await count(1);
    assert.equal(await items.first().getAttribute('data-id'),'paged-229');assert.equal(requests.at(-1).page,undefined);
    await page.locator('#search').fill('');await count(100);
    // Cache reuse must retain the "more" marker, not misrepresent 100 as all mail.
    await page.getByRole('button',{name:'Tasks',exact:true}).click();
    await page.getByRole('button',{name:'Mail',exact:true}).click();await count(100);
    assert.match(await page.locator('#list-count').textContent(),/100 of 230/);
    await page.locator('#items .item').first().focus();await page.keyboard.press('G');
    await page.waitForFunction(()=>document.querySelector('#selected-item')?.dataset.id==='paged-229');
    // Alternate sorts receive the full view before doing locale-aware sorting.
    await page.locator('#mail-list-view summary').click();
    await page.getByLabel('Group mail by',{exact:true}).selectOption('none');
    await page.getByLabel('Sort mail by',{exact:true}).selectOption('subject-desc');await count(100);
    await page.waitForFunction(()=>document.querySelector('#items .item')?.dataset.id==='paged-229');
    assert.equal(requests.at(-1).page,undefined);
    await page.locator('#mail-list-view summary').click();
    await page.locator('#mail-folder').selectOption('Archive');await count(5);
    assert.equal(requests.at(-1).folder,'Archive');
    // A failed query stays retryable and cannot show a partial result as complete.
    fail=true;await page.locator('#search').fill('Needle');
    await page.getByRole('button',{name:'Try again',exact:true}).click();await count(1);
    assert.equal(await items.first().getAttribute('data-id'),'paged-234');
    // A delayed old search cannot overwrite a newer query.
    hold=true;await page.locator('#search').fill('Body');
    await page.waitForTimeout(250);
    await page.locator('#search').fill('Needle');await count(1);release();
    await page.waitForTimeout(100);
    assert.equal(await items.first().getAttribute('data-id'),'paged-234');
    console.log('PASS paginated mail: bounds, older keyboard navigation, full search/sort, cache, folders, retry and stale responses.');
  }finally{release?.();await page.unroute(routes);}
}
