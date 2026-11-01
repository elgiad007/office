import assert from 'node:assert/strict';

export async function testMailHeaders(page,url) {
  await page.goto('about:blank');
  const records=Array.from({length:230},(_,n)=>({id:'header-'+n,kind:'mail',title:'Header message '+n,body:'',revision:1,meta:{remote:true,account:'header-account',source:'imap-folder:INBOX:1:'+(n+1),serverFolder:'INBOX',uidValidity:'1',providerId:String(n+1),folder:'Inbox',read:true,from:'sender@example.com',date:new Date(Date.UTC(2026,0,1,0,0,230-n)).toISOString(),headerOnly:true,messageSize:200}}));
  let attempts=0;
  const routes=t=>t.pathname.endsWith('/api.php')&&['records','accounts','mail-content'].includes(t.searchParams.get('r'));
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records')return route.fulfill({json:{records}});
    attempts++;
    if(attempts===1)return route.fulfill({status:503,json:{error:'Fixture connection unavailable. Retry downloading.'}});
    const id=route.request().postDataJSON().id,record=records.find(r=>r.id===id);
    const full={...record,revision:2,body:'Body fetched on demand',meta:{...record.meta,headerOnly:false,rawBase64:Buffer.from('Subject: Header\r\n\r\nBody fetched on demand').toString('base64')}};
    records[records.indexOf(record)]=full;
    return route.fulfill({json:{record:full}});
  });
  try {
    await page.goto(url+'?headers-test#mail');
    await page.locator('[data-body-status]').filter({hasText:'Fixture connection unavailable'}).waitFor();
    assert.equal(await page.locator('#items .item').count(),100,'large list initially renders 100 rows');
    await page.getByRole('button',{name:'Download message body',exact:true}).click();
    await page.locator('.mail-body').filter({hasText:'Body fetched on demand'}).waitFor();
    assert.equal(attempts,2,'failed download can be retried without losing headers');
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();
    assert.equal(await page.locator('#items .item').count(),200);
    await page.getByRole('button',{name:'Show next 100 messages',exact:true}).click();
    assert.equal(await page.locator('#items .item').count(),230,'all cached messages remain reachable');
    await page.locator('#search').fill('Header message 229');
    assert.equal(await page.locator('#items .item').count(),1,'header search spans the full cache');
    console.log('PASS headers-first reader: lazy body, offline failure/retry, large-list paging and header search.');
  } finally { await page.unroute(routes);await page.reload(); }
}
