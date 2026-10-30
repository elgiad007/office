import assert from 'node:assert/strict';

export async function testMailSort(page,url) {
  const mail=(id,date,extra={})=>({id,kind:'mail',title:'Sort '+id,body:'Body '+id,revision:1,updated:'2026-10-29T20:00:00Z',meta:{remote:true,account:'sort-account',folder:'Inbox',from:'sender@example.com',date,...extra}});
  let records=[
    mail('undated-b','invalid date'),mail('old','Tue, 01 Jan 2019 12:00:00 +0000'),
    mail('tie-b','Thu, 29 Oct 2026 08:00:00 -0400'),mail('undated-a',''),
    mail('newest','Thu, 29 Oct 2026 15:00:00 +0000'),mail('tie-a','2026-10-29T12:00:00Z'),
    mail('sent','',{sentAt:'2026-10-29T14:00:00Z'}),
  ],syncs=0;
  const expected=['newest','sent','tie-a','tie-b','old','undated-a','undated-b'];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',preferences:{}};
    else if(action==='accounts')json={accounts:[{id:'sort-account',type:'imap',label:'Sort fixture'}]};
    else if(action==='records')json={records};
    else if(action==='sync'){
      syncs++;records.reverse();records.forEach((r,i)=>r.updated=new Date(Date.UTC(2026,9,30,0,0,i)).toISOString());json={count:0};
    }else if(action==='mail-action'){
      const input=route.request().postDataJSON(),record=records.find(r=>r.id===input.id);assert.ok(record);
      record.revision++;record.updated='2099-01-01T00:00:00Z';
      if(input.action==='trash')record.meta.folder='Trash';else record.meta.read=input.action==='read';
      records=[record,...records.filter(r=>r.id!==record.id)];json={record};
    }else throw Error('Unexpected sort fixture API: '+action);
    await route.fulfill({json});
  });
  const order=()=>page.locator('#items .item').evaluateAll(items=>items.map(item=>item.dataset.id));
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  try{
    await page.goto(url+'#mail');await page.reload();await page.locator('#sync-status').filter({hasText:'Checked'}).waitFor();
    await selected('newest');assert.deepEqual(await order(),expected);
    await page.locator('[data-id="tie-a"]').click();
    await page.getByRole('button',{name:'Mark read',exact:true}).click();
    await page.getByRole('button',{name:'Mark unread',exact:true}).waitFor();
    assert.deepEqual(await order(),expected);await selected('tie-a');
    await page.getByRole('button',{name:'Mark unread',exact:true}).click();
    await page.getByRole('button',{name:'Mark read',exact:true}).waitFor();assert.deepEqual(await order(),expected);
    const refreshed=page.waitForResponse(response=>response.url().includes('r=records'));
    await page.locator('#sync-button').click();await (await refreshed).finished();
    await selected('tie-a');assert.deepEqual(await order(),expected);assert.ok(syncs>=2);
    await page.locator('#search').fill('Sort old');assert.deepEqual(await order(),['old']);
    await page.locator('#search').fill('');
    await page.getByRole('button',{name:'Move to Trash',exact:true}).click();await selected('tie-b');
    assert.deepEqual(await order(),expected.filter(id=>id!=='tie-a'));
    console.log('PASS mail sorting: newest first, timezone equivalence, equal-date ties, missing/invalid dates, sentAt fallback, sync/read stability, search, first and next selection.');
  }finally{await page.unroute(routes);await page.reload();}
}
