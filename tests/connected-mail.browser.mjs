import assert from 'node:assert/strict';

export async function testConnectedMail(page,url) {
  let preferences={},omitId='',actions=[];
  const now=new Date().toISOString();
  const task={id:'source-task',kind:'tasks',title:'Linked email task',body:'Task notes',revision:1,created:now,updated:now,meta:{}};
  const mail=(id,folder='Inbox',extra={})=>({id,kind:'mail',title:'Linked '+id,body:'Message '+id,revision:1,created:now,updated:now,meta:{folder,account:'imap-account',remote:true,read:true,from:'Linked <linked@example.test>',date:'2020-01-01T12:00:00Z',...extra}});
  const targets=[mail('ordinary'),mail('trashed','Trash'),mail('recovery','Not in Inbox'),mail('moved','Trash'),mail('custom','Custom folder',{serverFolder:'Projects'}),mail('labelled','Custom folder',{account:'google-account',labelIds:['work-label']}),mail('missing')];
  const records=[task,...targets,mail('other-today','Inbox',{from:'Other <other@example.test>',date:now}),...Array.from({length:135},(_,n)=>mail('filler-'+n,'Inbox',{from:'Other <other@example.test>',date:'2020-02-02T12:00:00Z'}))];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const request=route.request(),params=new URL(request.url()).searchParams,action=params.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences};
    else if(action==='accounts')json={accounts:[{id:'imap-account',type:'imap',label:'IMAP',folders:[{id:'Projects',name:'Projects'}]},{id:'google-account',type:'google',label:'Google',folders:[{id:'work-label',name:'Work'}]}]};
    else if(action==='sync')json={count:0};
    else if(action==='records')json={records:records.filter(r=>r.kind===params.get('kind')&&r.id!==omitId)};
    else if(action==='record'){
      const record=structuredClone(records.find(r=>r.id===params.get('id')));
      // Simulate a move between fetching the connection target and the mail list.
      if(record.id==='moved')record.meta.folder='Inbox';
      json={record};
    }else if(action==='connections'){
      const id=params.get('id');
      json=id==='source-task'?{links:targets.map(r=>({a:task.id,b:r.id,created:now})),items:[task,...targets].map(r=>({id:r.id,kind:r.kind,title:r.title,excerpt:'',meta:{}})),more:false}:{links:[],items:[],more:false};
    }else if(action==='preferences'){preferences=request.postDataJSON().preferences;json={ok:true};}
    else if(action==='mail-action'){
      const input=request.postDataJSON();actions.push(input);
      const record=records.find(r=>r.id===input.id);record.meta.folder=input.action==='restore'?'Inbox':'Trash';record.revision++;
      json={record,removedIds:[record.id]};
    }else if(action==='activity')json={entries:[]};
    else throw Error('Unexpected connected-mail fixture API: '+action);
    await route.fulfill({json});
  });
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  const open=async(id,view={group:'date',sort:'date-desc',collapsed:['date:Older','date:Today']},popover=false)=>{
    preferences={mailView:view};
    await page.goto('about:blank');await page.goto(url+'#tasks');
    await selected(task.id);
    await page.keyboard.press('v'); // A task selection must not become the mail action's target.
    await page.locator('.connection-count').click();
    if(popover)await page.locator(`[data-connection-open="${id}"]`).click();
    else{
      await page.getByRole('button',{name:'View map',exact:true}).click();
      await page.locator(`.connections-view [data-open="${id}"]`).click();
    }
    if(id===omitId)return;
    await selected(id);
    assert.equal(await page.locator('#selected-item').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#selected-item').evaluate(el=>document.activeElement===el),true);
    assert.ok(await page.locator('#selected-item').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('#items').getBoundingClientRect();return r.top>=p.top-1&&r.bottom<=p.bottom+1;}),'Connected message is scrolled into the list viewport');
    assert.equal(await page.locator('#selection-count').textContent(),'');
    assert.equal(await page.locator('#detail h1').textContent(),'Linked '+id);
  };
  try{
    await open('ordinary');
    assert.equal(await page.locator('#mail-folder').inputValue(),'Inbox');
    assert.equal(await page.locator('[data-mail-group-key="date:Today"]').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('[data-mail-group-key="date:Older"]').getAttribute('aria-expanded'),'true');
    assert.ok(await page.locator('#items .item').count()>100,'Reveal includes a target beyond the paging limit');
    await page.keyboard.press('D');
    await page.waitForFunction(()=>!document.querySelector('#items [data-id="ordinary"]'));
    assert.deepEqual(actions.map(a=>[a.id,a.action]),[['ordinary','trash']]);

    await open('custom',{group:'sender',sort:'date-desc',collapsed:['sender:*']},true);
    assert.match(await page.locator('.folder-current').textContent(),/IMAP \/ Projects/);
    assert.ok(preferences.mailView.collapsed.includes('sender:!sender:email:linked@example.test'));
    await open('labelled');assert.match(await page.locator('.folder-current').textContent(),/Google \/ Work/);
    await open('moved');assert.equal(await page.locator('#mail-folder').inputValue(),'Trash');

    const before=actions.length;
    await open('trashed');
    assert.ok(await page.getByRole('button',{name:'Restore to Inbox',exact:true}).isVisible());
    await page.keyboard.press('D');
    await page.locator('#notice').filter({hasText:'This email is already in Trash.'}).waitFor();
    assert.equal(actions.length,before);
    await open('recovery');assert.equal(await page.locator('#mail-folder').inputValue(),'Recovery copies');
    assert.ok(await page.getByRole('button',{name:'Save locally',exact:true}).isVisible());
    assert.ok(await page.getByRole('button',{name:'Discard copy',exact:true}).isVisible());
    await page.keyboard.press('D');
    await page.locator('#notice').filter({hasText:'This is a recovery copy.'}).waitFor();assert.equal(actions.length,before);
    await page.screenshot({path:'test-results/connected-mail-recovery.png',fullPage:true});

    omitId='missing';await open('missing');
    await page.locator('#notice').filter({hasText:'This linked item is no longer available.'}).waitFor();
    assert.equal(await page.locator('#selected-item').count(),0);
    await page.keyboard.press('D');assert.equal(actions.length,before);
    console.log('PASS connected mail: task connections window/popover, collapsed date/sender groups, collapse-all, paging, focus/scroll, exact deletion target, IMAP/Gmail folders, moved targets, protected-copy actions, and missing targets.');
  }finally{await page.goto('about:blank');await page.unroute(routes);}
}
