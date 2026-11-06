import assert from 'node:assert/strict';
import {openMailMore} from './mail-reader-ui.mjs';

export async function testMailReaderSync(page,url) {
  await page.goto('about:blank');
  const gate=()=>{let release,arrived;return {promise:new Promise(resolve=>release=resolve),seen:new Promise(resolve=>arrived=resolve),release:()=>release(),arrived:()=>arrived()};};
  const syncGates=new Map(Array.from({length:4},(_,i)=>[i+1,gate()]));
  const recordGates=new Map(Array.from({length:7},(_,i)=>[i+2,gate()]));
  const account={id:'reader-sync',type:'imap',label:'Reader sync fixture'};
  const records=['a','b'].map(id=>({id,kind:'mail',title:'Reader sync '+id,body:'',revision:1,meta:{remote:true,account:account.id,folder:'Inbox',from:'sender@example.com',to:'recipient@example.com',date:'2026-11-02T12:00:00Z',read:true,hasAttachments:false}}));
  let syncCalls=0,recordCalls=0;
  const activeRoutes=new Set(),routes=t=>t.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const handled=(async()=>{
      const action=new URL(route.request().url()).searchParams.get('r');let json;
      if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences:{}};
      else if(action==='connections')json={connections:[]};
      else if(action==='accounts')json={accounts:[account]};
      else if(action==='activity')json={entries:[]};
      else if(action==='records'){
        const call=++recordCalls,held=recordGates.get(call);held?.arrived();if(held)await held.promise;
        json={records:records.map(record=>({...record,body:`Reader ${record.id} refresh ${call}`}))};
      }else if(action==='sync'){
        const call=++syncCalls,held=syncGates.get(call);held?.arrived();if(held)await held.promise;
        json={count:1,more:call===1};
      }else throw Error('Unexpected reader sync route '+action);
      await route.fulfill({json});
    })();
    activeRoutes.add(handled);try{await handled;}finally{activeRoutes.delete(handled);}
  });
  const more=()=>page.locator('#detail [data-mail-disclosure="more"]');
  const focusExport=async()=>{await openMailMore(page);await page.locator('#detail [data-action="export"]').focus();};
  const refreshed=async(call,id='a')=>page.locator('#detail .mail-body').filter({hasText:`Reader ${id} refresh ${call}`}).waitFor();
  const assertOpen=async()=>{
    assert.equal(await more().evaluate(node=>node.open),true,'Background refresh preserves More');
    assert.equal(await page.locator('#detail [data-action="export"]').evaluate(node=>node===document.activeElement),true,'Background refresh preserves the focused action');
  };
  try {
    await page.goto(url+'?reader-sync-test#mail');await refreshed(1);await syncGates.get(1).seen;
    await focusExport();syncGates.get(1).release();await recordGates.get(2).seen;
    recordGates.get(2).release();await refreshed(2);await assertOpen();await syncGates.get(2).seen;
    syncGates.get(2).release();await recordGates.get(3).seen;recordGates.get(3).release();await refreshed(3);await assertOpen();
    await recordGates.get(4).seen;recordGates.get(4).release();await refreshed(4);await assertOpen();
    await page.screenshot({path:'test-results/mail-reader-sync-more.png',fullPage:true});

    await page.locator('#sync-button').click();await syncGates.get(3).seen;await focusExport();
    syncGates.get(3).release();await recordGates.get(5).seen;
    await page.keyboard.press('Escape');assert.equal(await more().evaluate(node=>node.open),false);
    recordGates.get(5).release();await refreshed(5);assert.equal(await more().evaluate(node=>node.open),false,'Closing while records are pending is respected');
    assert.equal(await more().locator('summary').evaluate(node=>node===document.activeElement),true,'Focused closed summary survives refresh');
    await recordGates.get(6).seen;recordGates.get(6).release();await refreshed(6);assert.equal(await more().evaluate(node=>node.open),false);

    await page.locator('#sync-button').click();await syncGates.get(4).seen;await focusExport();
    syncGates.get(4).release();await recordGates.get(7).seen;
    await page.locator('#items [data-id="b"]').click();assert.equal(await more().evaluate(node=>node.open),false,'Selecting another message closes More');
    recordGates.get(7).release();await refreshed(7,'b');assert.equal(await more().evaluate(node=>node.open),false);
    await recordGates.get(8).seen;recordGates.get(8).release();await refreshed(8,'b');assert.equal(await more().evaluate(node=>node.open),false);
    assert.equal(await page.locator('#items [data-id="b"]').evaluate(node=>node===document.activeElement),true,'Refresh keeps list focus outside the disclosure');
    assert.equal(syncCalls,4);assert.equal(recordCalls,8);
    console.log('PASS reader sync: More and action/summary focus survive batch/final refresh; closing or changing message while records are pending stays closed.');
  } finally {
    for(const held of [...syncGates.values(),...recordGates.values()])held.release();
    await Promise.allSettled(activeRoutes);await page.goto('about:blank');await page.unroute(routes);await page.goto(url+'#mail',{waitUntil:'domcontentloaded'});
  }
}

export async function testHtmlReaderSync(page,url) {
  await page.goto('about:blank');
  let release,arrive;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>arrive=resolve);
  let syncCalls=0,recordCalls=0,frameRequests=0;
  const account={id:'html-sync',type:'imap',label:'HTML sync fixture'};
  const apiRoute=t=>t.pathname.endsWith('/api.php'),frameRoute=t=>t.pathname.endsWith('/mail-view.php');
  await page.route(frameRoute,async route=>{frameRequests++;await route.fulfill({contentType:'text/html',body:'<html><body style="height:6000px">HTML scroll fixture</body></html>'});});
  await page.route(apiRoute,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences:{}};
    else if(action==='connections')json={connections:[]};
    else if(action==='accounts')json={accounts:[account]};
    else if(action==='activity')json={entries:[]};
    else if(action==='records'){
      recordCalls++;json={records:[{id:'html-sync-message',kind:'mail',title:'HTML refresh '+recordCalls,body:'Text alternative',bodyHash:recordCalls>4?'body-two':'body-one',revision:recordCalls,meta:{remote:true,account:account.id,folder:'Inbox',from:'sender@example.com',read:true,hasHtml:true}}]};
    }else if(action==='sync'){if(++syncCalls===1){arrive();await gate;}json={count:1,more:syncCalls===1};}
    else throw Error('Unexpected HTML sync route '+action);
    await route.fulfill({json});
  });
  try {
    await page.goto(url+'?html-reader-sync-test#mail');await seen;
    const frame=page.locator('#detail iframe');await frame.waitFor();
    await frame.evaluate(node=>{window.savedReaderFrame=node;window.savedReaderWindow=node.contentWindow;node.focus();});
    await page.frames().find(frame=>frame.url().includes('mail-view.php')).evaluate(()=>scrollTo(0,900));
    release();await page.getByRole('heading',{name:'HTML refresh 4',exact:true}).waitFor();
    assert.equal(recordCalls,4);assert.equal(frameRequests,1,'Sync batches do not request HTML again');
    assert.equal(await frame.evaluate(node=>node===window.savedReaderFrame&&node.contentWindow===window.savedReaderWindow),true,'Same iframe and browsing context survive sync');
    assert.equal(await frame.evaluate(node=>document.activeElement===node),true,'Iframe retains focus');
    assert.equal(await page.frames().find(frame=>frame.url().includes('mail-view.php')).evaluate(()=>scrollY),900,'HTML scroll position survives');
    await page.locator('#sync-button').click();await page.getByRole('heading',{name:'HTML refresh 6',exact:true}).waitFor();
    assert.equal(await frame.evaluate(node=>node!==window.savedReaderFrame),true,'Changed body fingerprint replaces the frame');
    await frame.evaluate(node=>{window.savedReaderFrame=node;});
    await openMailMore(page);await page.locator('[data-mail-colors]').click();
    await page.waitForFunction(()=>document.querySelector('#detail iframe')!==window.savedReaderFrame);
    assert.equal(await page.locator('#detail iframe').getAttribute('src').then(src=>src.includes('colors=original')),true,'Display changes replace the HTML frame');
    console.log('PASS HTML reader sync: iframe, window, focus, scroll and one request across batch/final refresh; display changes reload.');
  } finally {release();await page.goto('about:blank');await page.unroute(apiRoute);await page.unroute(frameRoute);}
}
