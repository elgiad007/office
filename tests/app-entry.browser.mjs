import assert from 'node:assert/strict';

export async function testAppEntry(page,url) {
  const kinds=['mail','calendar','tasks','contacts','documents','wiki','sheets'];
  const removed=new Set(),empty=new Set();
  let nextMailRequest;
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const query=new URL(route.request().url()).searchParams,action=query.get('r'),kind=query.get('kind');
    if(action==='records'&&kind==='mail'&&nextMailRequest){
      const intercept=nextMailRequest;
      nextMailRequest=undefined;
      if(await intercept(route))return;
    }
    const date=new Date().toISOString();
    const records=empty.has(kind)?[]:[0,1,2].map(i=>({id:`entry-${kind}-${i}`,kind,title:`Entry ${kind} ${i}`,body:'Item body',revision:1,created:date,updated:date,meta:kind==='mail'?{folder:'Inbox',read:true}:kind==='calendar'?{start:date,end:date}:kind==='sheets'?{workbook:{sheets:[{name:'Sheet 1',cells:{}}]}}:{}})).filter(r=>!removed.has(r.id));
    const responses={status:{authenticated:true,csrf:'fixture',preferences:{}},accounts:{accounts:[]},records:{records},connections:{items:[],links:[],more:false},'google-settings':{configured:false},activity:{entries:[]}};
    assert.ok(action in responses,`Unexpected app entry API: ${action}`);
    await route.fulfill({json:responses[action]});
  });
  const check=async id=>{
    await page.locator(`#selected-item[data-id="${id}"]`).waitFor();
    await page.waitForFunction(()=>document.activeElement===document.querySelector('#selected-item'));
  };
  const checkCalendarList=()=>page.waitForFunction(()=>document.activeElement?.id==='items'&&!document.querySelector('#selected-item'));
  const enter=async kind=>{
    await page.locator(`[data-app="${kind}"]`).click();
    await page.waitForFunction(kind=>document.querySelector('#crumb')?.textContent===kind,kind==='wiki'?'Wiki':kind[0].toUpperCase()+kind.slice(1));
  };
  try {
    await page.goto(url+'#mail');
    await check('entry-mail-0');
    for(const kind of kinds){
      if(kind!=='mail')await enter(kind);
      if(kind==='calendar'){await checkCalendarList();await page.keyboard.press('j');}
      await check(`entry-${kind}-0`);
      await page.keyboard.press('j');
      await page.locator('#selected-item[data-id="entry-'+kind+'-1"]').waitFor();
    }
    for(const kind of kinds){
      await enter(kind);if(kind==='calendar')await checkCalendarList();else await check(`entry-${kind}-1`);
    }
    for(const kind of kinds){
      await enter('settings');removed.add(`entry-${kind}-1`);
      await enter(kind);if(kind==='calendar')await checkCalendarList();else await check(`entry-${kind}-0`);
      await enter('settings');empty.add(kind);
      await enter(kind);
      await page.waitForFunction(()=>document.activeElement?.id==='items'&&!document.querySelector('#selected-item'));
      assert.equal(await page.locator('#items [data-id]').count(),0,kind+' empty list');
    }
    empty.clear();removed.clear();
    await page.goto(url+'#tasks');await page.reload();
    await check('entry-tasks-0');

    const loading=page.getByRole('status').filter({hasText:'Loading Mail…'});
    const holdMail=()=>{
      let release,started;
      const gate=new Promise(resolve=>{release=resolve;});
      const request=new Promise(resolve=>{started=resolve;});
      nextMailRequest=async route=>{started(route);return gate;};
      return {request,release};
    };
    const stale=holdMail();
    await page.keyboard.press('g');
    await page.keyboard.press('1');
    await loading.waitFor();
    const staleRoute=await stale.request;
    assert.equal(await page.locator('#items').count(),0);
    await enter('tasks');
    await check('entry-tasks-0');
    const current=holdMail();
    await enter('mail');
    await loading.waitFor();
    const currentRoute=await current.request;
    await staleRoute.fulfill({json:{records:[]}});
    stale.release(true);
    await currentRoute.fulfill({status:500,json:{error:'Mail request failed'}});
    current.release(true);
    const error=page.getByRole('alert').filter({hasText:'Couldn’t load Mail'});
    await error.waitFor();
    assert.match(await error.textContent(),/Mail request failed/);
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    await check('entry-mail-0');
    assert.equal(await loading.count(),0);
  } finally {await page.unroute(routes);}
}
