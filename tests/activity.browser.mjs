import assert from 'node:assert/strict';

export async function testActivityKeyboard(page,url) {
  let preferences={},entries=Array.from({length:40},(_,index)=>({id:index+1,time:new Date().toISOString(),level:index%2?'info':'warning',account:'Fixture',operation:'Keyboard fixture',message:'Event '+(index+1),duration_ms:null,phase:'diagnostic'}));
  const records=[
    {id:'completed-task',kind:'tasks',title:'Completed fixture task',body:'Task opened from activity.',meta:{done:true},revision:1,updated:new Date().toISOString()},
    {id:'filed-mail',kind:'mail',title:'Filed fixture message',body:'Mail opened from activity.',meta:{folder:'Archive',read:true},revision:1,updated:new Date().toISOString()},
  ];
  entries[39].record_id='deleted-item';
  entries[38].record_id=records[0].id;
  Object.assign(entries[36],{run:'move-mail',phase:'start',record_id:'previous-mail-id'});
  Object.assign(entries[37],{run:'move-mail',phase:'complete',record_id:records[1].id});
  const lookups=[];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,route=>{
    const params=new URL(route.request().url()).searchParams,action=params.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,activity:true,csrf:'fixture',preferences}});
    if(action==='records')return route.fulfill({json:{records:records.filter(record=>record.kind===params.get('kind'))}});
    if(action==='record'){
      const id=params.get('id'),record=records.find(record=>record.id===id);lookups.push(id);
      return record?route.fulfill({json:{record}}):route.fulfill({status:404,json:{error:'Item not found.'}});
    }
    if(action==='connections')return route.fulfill({json:{links:[],items:[]}});
    if(action==='accounts')return route.fulfill({json:{accounts:[]}});
    if(action==='activity'){
      if(route.request().method()==='POST'){entries=[];return route.fulfill({json:{ok:true}});}
      return route.fulfill({json:{entries:entries.filter(entry=>entry.id>Number(new URL(route.request().url()).searchParams.get('after')||0))}});
    }
    throw Error('Unexpected activity keyboard route '+action);
  });
  const list=page.locator('#activity-entries'),selected=list.locator('[aria-selected=true]');
  const expectSelected=async id=>{assert.equal(await selected.getAttribute('data-entry-id'),String(id));assert.equal(await list.getAttribute('aria-activedescendant'),'activity-entry-'+id);};
  const focused=()=>list.evaluate(node=>node===document.activeElement);
  try {
    await page.goto(url+'?activity-keyboard#mail');
    await page.getByRole('button',{name:/View activity \(/}).click();
    assert.equal(await focused(),true);await expectSelected(40);
    const unselectedLink=list.locator('[data-entry-id="39"]'),unlinked=list.locator('[data-entry-id="36"]');
    assert.equal(await unselectedLink.getByText('Linked item',{exact:true}).isVisible(),true);
    assert.equal(await unselectedLink.locator('.activity-linked-badge svg').count(),1);
    assert.equal(await unselectedLink.getByText('Enter to open item',{exact:true}).isVisible(),false);
    assert.equal(await selected.getByText('Enter to open item',{exact:true}).isVisible(),true);
    assert.equal(await unlinked.getByText('Linked item',{exact:true}).count(),0);
    for(const [key,id] of [['ArrowDown',39],['ArrowRight',38],['ArrowLeft',39],['ArrowUp',40],['j',39],['k',40],['n',39],['N',40],['G',1],['Home',40],['End',1]]){
      await page.keyboard.press(key);await expectSelected(id);
    }
    assert.ok(await list.evaluate(node=>node.scrollTop>0),'Last event scrolls into view');
    await page.keyboard.press('g');await page.keyboard.press('g');await expectSelected(40);
    await page.keyboard.press('G');
    const selectedBounds=await selected.boundingBox(),listBounds=await list.boundingBox();
    assert.ok(selectedBounds.y>=listBounds.y&&selectedBounds.y+selectedBounds.height<=listBounds.y+listBounds.height+1);
    entries.push({...entries[0],id:41,message:'New event'});
    await list.locator('[data-entry-id="41"]').waitFor();
    await expectSelected(1);assert.equal(await focused(),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#activity-clear').evaluate(node=>node===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await focused(),true);
    await page.locator('#activity-level').focus();await page.locator('#activity-level').selectOption('info');
    await expectSelected(40);
    assert.equal(await page.locator('#activity-level').evaluate(node=>node===document.activeElement),true,'Filtering keeps control focus');
    await list.focus();await page.keyboard.press('j');await expectSelected(38);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#view-activity').evaluate(node=>node===document.activeElement),true);
    preferences={keys:{down:'z',up:'q'}};
    await page.reload();await page.getByRole('button',{name:/View activity \(/}).click();
    await expectSelected(41);await page.keyboard.press('z');await expectSelected(40);await page.keyboard.press('q');await expectSelected(41);
    await page.keyboard.press('j');await expectSelected(41);
    const modal=page.locator('#activity-dialog');
    await page.keyboard.press('Enter');await expectSelected(41);
    await page.keyboard.press('z');
    assert.equal(await selected.getByText('Enter to open item',{exact:true}).isVisible(),true);
    await page.keyboard.press('Enter');
    await modal.getByText('This item is no longer available.',{exact:true}).waitFor();
    await expectSelected(40);assert.equal(await focused(),true);
    await page.keyboard.press('z');await expectSelected(39);await page.keyboard.press('Enter');
    await modal.waitFor({state:'hidden'});
    await page.waitForURL(/#tasks$/);
    await page.locator('#detail').getByText('Completed fixture task',{exact:true}).waitFor({state:'attached'});
    assert.equal(await page.locator('#detail').evaluate(node=>node.contains(document.activeElement)||node===document.activeElement),true);
    await page.getByRole('button',{name:/View activity/}).click();
    for(let i=0;i<4;i++)await page.keyboard.press('z');
    await expectSelected(37);await page.keyboard.press('Enter');
    await modal.waitFor({state:'hidden'});
    await page.locator('#detail').getByRole('heading',{name:'Filed fixture message'}).waitFor();
    assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'filed-mail');
    assert.equal(await page.locator('#selected-item').evaluate(node=>node===document.activeElement),true);
    assert.deepEqual(lookups,['deleted-item','completed-task','filed-mail']);
    await page.getByRole('button',{name:/View activity/}).click();
    await page.getByRole('button',{name:'Clear log',exact:true}).click();
    await list.getByText('No recent activity matches these filters.',{exact:true}).waitFor();
    await list.focus();await page.keyboard.press('j');await page.keyboard.press('G');
    assert.equal(await list.getAttribute('aria-activedescendant'),null);
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'View activity',exact:true}).click();assert.equal(await focused(),true);
    await page.keyboard.press('Escape');
    console.log('PASS activity keyboard selection, filters, focus, Enter navigation and unavailable items.');
  } finally {await page.unroute(routes);}
}

export async function testActivity(page,url) {
  let streamingAccount=false;
  let syncHold=null,releaseSync;
  let entries=[
    {id:1,time:new Date().toISOString(),level:'info',account:'Gmail fixture',operation:'Move to Trash',message:'IMAP: signing in.',duration_ms:10,phase:'progress'},
    {id:2,time:new Date().toISOString(),level:'error',account:'Gmail fixture',operation:'Move to Trash',message:'IMAP timed out while moving message.',duration_ms:20000,phase:'error'},
    {id:3,time:new Date().toISOString(),level:'success',account:'Other account',operation:'Synchronize account',message:'Completed: Synchronize account',duration_ms:50,phase:'complete'},
    {id:4,time:new Date().toISOString(),level:'info',account:'',operation:'Office',message:'Mail conflict diagnostic fixture',duration_ms:null,phase:'diagnostic'},
  ];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');
    if(action==='status')return route.fulfill({json:{authenticated:true,activity:true,csrf:'fixture',preferences:{}}});
    if(action==='records')return route.fulfill({json:{records:[]}});
    if(action==='accounts')return route.fulfill({json:{accounts:streamingAccount?[{id:'stream-account',label:'Stream account',type:'imap'}]:[]}});
    if(action==='sync'){if(syncHold)await syncHold;return route.fulfill({contentType:'application/x-ndjson',body:[
      {type:'activity',entry:{id:6,time:new Date().toISOString(),level:'info',account:'Stream account',operation:'Synchronize account',message:'IMAP: reconnecting once.',duration_ms:null,phase:'progress'}},
      {type:'activity',entry:{id:7,time:new Date().toISOString(),level:'error',account:'Stream account',operation:'Synchronize account',message:'IMAP: connection closed while opening folder.',duration_ms:20,phase:'error'}},
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
    assert.ok(!(await page.locator('#notice').textContent()).includes('diagnostic fixture'),'Diagnostics do not replace the user-facing status');
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
    entries.push({id:5,time:new Date().toISOString(),level:'warning',account:'Gmail fixture',operation:'Synchronize account',message:'Connection retried.',duration_ms:null,phase:'progress'});
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
