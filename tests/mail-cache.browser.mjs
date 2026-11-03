import assert from 'node:assert/strict';
import {openMailMore} from './mail-reader-ui.mjs';

export async function testMailCache(page,url) {
  await page.goto('about:blank');
  const raw='Subject: Cached original\r\n\r\nFull original bytes';
  const record={id:'cache-fixture',kind:'mail',title:'Cached original',body:'Searchable message body',revision:1,contentHash:'fixture-hash',meta:{remote:true,account:'cache-account',source:'imap-folder:INBOX:1:1',serverFolder:'INBOX',uidValidity:'1',providerId:'1',folder:'Inbox',read:true,rawBase64:Buffer.from(raw).toString('base64')}};
  const summary={...record,summary:true,hasOriginal:true,meta:{...record.meta}};delete summary.meta.rawBase64;
  let originals=0;
  const routes=t=>t.pathname.endsWith('/api.php') && t.searchParams.get('r')!=='activity';
  await page.route(routes,async route=>{
    const target=new URL(route.request().url()),action=target.searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,csrf:'fixture',preferences:{}}});
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='records'){assert.equal(target.searchParams.get('summaries'),'1');return route.fulfill({json:{records:[summary]}});}
    if(action==='record'){originals++;return route.fulfill({json:{record}});}
    throw Error('Unexpected cache fixture route '+action);
  });
  try{
    await page.goto(url+'?mail-cache-test#mail');
    await page.getByRole('heading',{name:'Cached original',exact:true}).waitFor();
    assert.equal(originals,0,'Browsing text does not fetch original blobs');
    await page.locator('#search').fill('Searchable message body');assert.equal(await page.locator('#items .item').count(),1,'Body search works without originals');
    for(let attempt=0;attempt<2;attempt++){
      await openMailMore(page);
      const downloaded=page.waitForEvent('download');
      await page.getByRole('button',{name:'Download original EML',exact:true}).click();
      const download=await downloaded;assert.equal(download.suggestedFilename(),'Cached original.eml');
      const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(),raw,'Lazy original download preserves exact bytes');
    }
    assert.equal(originals,1,'Unchanged original is reused for repeated exports');
    console.log('PASS mail cache: lightweight lists, body search, lazy original export and repeated-export cache.');
  }finally{await page.unroute(routes);await page.reload();}
}
