import assert from 'node:assert/strict';

export async function testActivity(page,url) {
  let streamingAccount=false;
  let syncHold=null,releaseSync;
  let entries=[
    {id:1,time:new Date().toISOString(),level:'info',account:'Gmail fixture',operation:'Move to Trash',message:'IMAP: signing in.',duration_ms:10,phase:'progress'},
    {id:2,time:new Date().toISOString(),level:'error',account:'Gmail fixture',operation:'Move to Trash',message:'IMAP timed out while moving message.',duration_ms:20000,phase:'error'},
    {id:3,time:new Date().toISOString(),level:'success',account:'Other account',operation:'Synchronize account',message:'Completed: Synchronize account',duration_ms:50,phase:'complete'},
  ];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,activity:true,csrf:'fixture',preferences:{}}});
    if(action==='records')return route.fulfill({json:{records:[]}});
    if(action==='accounts')return route.fulfill({json:{accounts:streamingAccount?[{id:'stream-account',label:'Stream account',type:'imap'}]:[]}});
    if(action==='sync'){if(syncHold)await syncHold;return route.fulfill({contentType:'application/x-ndjson',body:[
      {type:'activity',entry:{id:5,time:new Date().toISOString(),level:'info',account:'Stream account',operation:'Synchronize account',message:'IMAP: reconnecting once.',duration_ms:null,phase:'progress'}},
      {type:'activity',entry:{id:6,time:new Date().toISOString(),level:'error',account:'Stream account',operation:'Synchronize account',message:'IMAP: connection closed while opening folder.',duration_ms:20,phase:'error'}},
      {type:'result',status:503,body:{error:'Fixture: streamed connection failure'}},
    ].map(event=>JSON.stringify(event)).join('\n')+'\n'});}
    if(action==='activity'){
      if(route.request().method()==='POST'){const data=route.request().postDataJSON();if(data.action==='clear')entries=[];return route.fulfill({json:{ok:true}});}
      return route.fulfill({json:{entries:entries.filter(entry=>entry.id>Number(new URL(route.request().url()).searchParams.get('after')||0))}});
    }
    throw Error('Unexpected activity fixture route '+action);
  });
  try {
    await page.goto(url+'?activity-test#mail');
    await page.locator('#notice').filter({hasText:'Ready.'}).waitFor();
    const activityButton=page.locator('#view-activity');
    await page.getByRole('button',{name:'View activity (1 error)',exact:true}).waitFor();
    assert.equal(await activityButton.getAttribute('data-attention'),'error');
    assert.equal(await activityButton.locator('svg[aria-hidden=true] circle').count(),1);
    const before=await page.locator('#notice').textContent();
    await page.waitForTimeout(2100);assert.equal(await page.locator('#notice').textContent(),before,'Historical log polling keeps the idle status Ready');
    await page.getByRole('button',{name:/View activity/}).click();
    const modal=page.locator('#activity-dialog');await modal.getByText('IMAP timed out while moving message.',{exact:true}).waitFor();
    await modal.getByLabel('Level',{exact:true}).selectOption('error');assert.equal(await modal.locator('#activity-entries li').count(),1);
    await modal.getByLabel('Level',{exact:true}).selectOption('');await modal.getByLabel('Account',{exact:true}).selectOption({label:'Gmail fixture'});assert.equal(await modal.locator('#activity-entries li').count(),2);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.activityCopied=text;}}}));
    await modal.getByRole('button',{name:'Copy visible log',exact:true}).click();
    assert.ok((await page.evaluate(()=>window.activityCopied)).includes('IMAP timed out'));assert.ok(!(await page.evaluate(()=>window.activityCopied)).includes('Other account'));
    await modal.getByRole('button',{name:'Close activity',exact:true}).click();
    entries.push({id:4,time:new Date().toISOString(),level:'warning',account:'Gmail fixture',operation:'Synchronize account',message:'Connection retried.',duration_ms:null,phase:'progress'});
    await page.getByRole('button',{name:'View activity (1 error, 1 warning)',exact:true}).waitFor();
    assert.equal(await activityButton.getAttribute('data-attention'),'error','Errors take priority over warnings');
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      const bounds=await page.evaluate(()=>({bar:document.querySelector('#activity-status').getBoundingClientRect().toJSON(),shell:document.querySelector('.shell').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight}));
      assert.ok(bounds.shell.bottom<=bounds.bar.top+1,'Status bar reserves content space');assert.ok(bounds.bar.bottom<=bounds.height+1&&bounds.bar.right<=bounds.width+1);
      assert.ok(await activityButton.evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}),'Attention icon and counts fit the viewport');
      await page.getByRole('button',{name:/View activity/}).click();assert.ok(await modal.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
      await page.screenshot({path:`test-results/activity-${viewport.width}.png`});await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
    }
    streamingAccount=true;syncHold=new Promise(resolve=>releaseSync=resolve);await page.reload();
    await page.locator('#activity-status[data-busy=true]').waitFor();
    const sweep=()=>page.locator('#activity-status').evaluate(node=>({animation:getComputedStyle(node,'::before').animationName,transform:getComputedStyle(node,'::before').transform}));
    const first=await sweep();assert.equal(first.animation,'office-activity-sweep');
    assert.ok(await page.locator('#notice').evaluate(node=>{const text=node.getBoundingClientRect(),bar=node.parentElement.getBoundingClientRect();return text.top>=bar.top&&text.bottom<=bar.bottom;}),'Activity text stays inside the animated bar');
    await page.waitForTimeout(250);assert.notEqual((await sweep()).transform,first.transform,'Activity band moves while work is pending');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal((await sweep()).animation,'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#activity-status').evaluate(node=>node.getAnimations({subtree:true}).forEach(animation=>{animation.currentTime=3500;}));
    await page.screenshot({path:'test-results/activity-sweep.png'});
    releaseSync();syncHold=null;await page.locator('#notice').filter({hasText:'connection closed while opening folder'}).waitFor();
    await page.locator('#sync-status').filter({hasText:'Sync needs attention'}).waitFor({state:'attached'});streamingAccount=false;
    await page.locator('#activity-status[data-busy=false]').waitFor();await page.locator('#notice').filter({hasText:'Ready.'}).waitFor();assert.equal((await sweep()).animation,'none');
    await page.getByRole('button',{name:/View activity/}).click();await modal.getByText('IMAP: connection closed while opening folder.',{exact:true}).waitFor();await modal.getByRole('button',{name:'Clear log',exact:true}).click();
    await modal.getByText('No recent activity matches these filters.',{exact:true}).waitFor();await page.keyboard.press('Escape');
    assert.equal(await activityButton.getAttribute('data-attention'),'');
    assert.equal(await activityButton.locator('svg').count(),0,'Clearing the log removes the indicator');
    entries.push({id:7,time:new Date().toISOString(),level:'warning',account:'Gmail fixture',operation:'Synchronize account',message:'Connection retried.',duration_ms:null,phase:'progress'});
    await page.getByRole('button',{name:'View activity (1 warning)',exact:true}).waitFor();
    assert.equal(await activityButton.getAttribute('data-attention'),'warning');
    assert.equal(await activityButton.locator('svg path').count(),1);
    const warningColor=await activityButton.locator('svg').evaluate(node=>getComputedStyle(node).color);
    await activityButton.evaluate(()=>document.documentElement.dataset.theme='dark');
    assert.notEqual(await activityButton.locator('svg').evaluate(node=>getComputedStyle(node).color),warningColor,'Warning icon adapts to the dark theme');
    await page.screenshot({path:'test-results/activity-warning-dark.png'});
    await page.reload();await page.getByRole('button',{name:'View activity (1 warning)',exact:true}).waitFor();
    await activityButton.click();await modal.getByRole('button',{name:'Clear log',exact:true}).click();await modal.getByText('No recent activity matches these filters.',{exact:true}).waitFor();await page.keyboard.press('Escape');
    await page.reload();await page.getByRole('button',{name:/View activity/}).click();await modal.getByText('No recent activity matches these filters.',{exact:true}).waitFor();await page.keyboard.press('Escape');
    entries.push({id:8,time:new Date().toISOString(),level:'success',account:'Gmail fixture',operation:'Synchronize account',message:'Completed successfully.',duration_ms:50,phase:'complete'});
    await activityButton.click();await modal.getByText('Completed successfully.',{exact:true}).waitFor();await page.keyboard.press('Escape');
    assert.equal(await activityButton.textContent(),'View activity');assert.equal(await activityButton.locator('svg').count(),0,'Success entries do not draw attention');
    console.log('PASS persistent activity bar, log filters, copy, clear, reload, keyboard and desktop/mobile layout.');
  }finally{releaseSync?.();await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1000});await page.unroute(routes);await page.reload();}
}
