import assert from 'node:assert/strict';

export async function testTaskView(page,url) {
  let preferences={},writes=0;
  const day=new Date(),date=offset=>{const d=new Date(day.getFullYear(),day.getMonth(),day.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const task=(id,due,priority='Normal',done=false)=>({id,kind:'tasks',title:id,body:'Notes '+id,revision:1,created:day.toISOString(),updated:day.toISOString(),meta:{due,priority,done}});
  let records=[task('undated',''),task('later',date(7),'Low'),task('today',date(0),'High'),task('overdue',date(-2)),task('finished',date(-10),'High',true),task('custom',date(8),'Urgent')];
  const routes=target=>target.pathname.endsWith('/api.php');
  await page.route(routes,async route=>{
    const action=new URL(route.request().url()).searchParams.get('r');let json;
    if(action==='status')json={authenticated:true,csrf:'fixture',activity:false,preferences};
    else if(action==='accounts')json={accounts:[]};
    else if(action==='records')json={records};
    else if(action==='preferences'){preferences=route.request().postDataJSON().preferences;writes++;json={ok:true};}
    else if(action==='save'){
      const input=route.request().postDataJSON(),index=records.findIndex(r=>r.id===input.id);
      records[index]={...input,revision:input.revision+1};json={record:records[index]};
    }else if(action==='connections')json={links:[],items:[],more:false};
    else if(action==='activity')json={entries:[]};
    else throw Error('Unexpected task fixture API: '+action);
    await route.fulfill({json});
  });
  const order=()=>page.locator('#items .item').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
  const item=id=>page.locator(`#items [data-id="${id}"]`);
  const selected=id=>page.waitForFunction(id=>document.querySelector('#selected-item')?.dataset.id===id,id);
  const open=async()=>{if(!await page.locator('#task-list-view').evaluate(n=>n.open))await page.locator('#task-list-view > summary').click();};
  const save=async action=>{const before=writes;const response=page.waitForResponse(r=>r.url().includes('r=preferences'));await action();await(await response).finished();assert.ok(writes>before);};
  const choose=async(label,value)=>{await open();await save(()=>page.getByLabel(label,{exact:true}).selectOption(value));await page.locator('#task-list-view > summary').click();};
  try{
    await page.goto(url+'#tasks');await selected('overdue');
    assert.deepEqual(await order(),['overdue','today','later','custom','undated']);
    assert.match(await item('today').textContent(),/High.*Due today/);
    assert.match(await item('overdue').textContent(),/Unfinished.*Overdue/);
    await choose('Filter task priority','High');assert.deepEqual(await order(),['today']);
    await choose('Show tasks','all');assert.deepEqual(await order(),['finished','today']);
    await choose('Filter task due date','today');assert.deepEqual(await order(),['today']);
    await choose('Filter task due date','all');await choose('Filter task priority','all');
    await choose('Group tasks by','status');assert.deepEqual(await page.locator('.mail-group-label').allTextContents(),['Unfinished','Completed']);
    await open();await save(()=>page.getByRole('button',{name:'Collapse all',exact:true}).click());assert.deepEqual(await order(),[]);
    await page.reload();await page.locator('.mail-group-header').first().waitFor();assert.deepEqual(await order(),[]);
    const unfinished=page.locator('[data-mail-group-key="status:Unfinished"]');
    await unfinished.focus();await save(()=>page.keyboard.press('Enter'));assert.equal((await order()).length,5);
    await item('overdue').click();await page.keyboard.press('j');await selected('today');
    await choose('Group tasks by','priority');assert.deepEqual(await page.locator('.mail-group-label').allTextContents(),['High','Normal','Low','Urgent']);
    await choose('Group tasks by','none');await choose('Show tasks','unfinished');await choose('Sort tasks by','due-desc');
    assert.deepEqual(await order(),['custom','later','today','overdue','undated']);
    await choose('Sort tasks by','due-asc');
    await page.getByLabel('Search Tasks',{exact:true}).fill('later');assert.deepEqual(await order(),['later']);
    await page.getByLabel('Search Tasks',{exact:true}).fill('');
    await item('overdue').click();await page.keyboard.press('x');await selected('today');
    assert.equal(records.find(r=>r.id==='overdue').meta.done,true);assert.equal(await item('overdue').count(),0);
    await page.getByLabel('Completed',{exact:true}).check();await selected('later');
    assert.equal(records.find(r=>r.id==='today').meta.done,true);
    await item('custom').click();assert.equal(await page.getByLabel('Priority',{exact:true}).inputValue(),'Urgent');
    await page.getByLabel('Priority',{exact:true}).selectOption('High');
    await page.waitForResponse(r=>r.url().includes('r=save'));assert.match(await item('custom').textContent(),/High/);
    await choose('Show tasks','completed');assert.deepEqual(await order(),['finished','overdue','today']);
    await item('overdue').click();await page.getByLabel('Completed',{exact:true}).uncheck();await selected('today');
    assert.equal(records.find(r=>r.id==='overdue').meta.done,false);
    await choose('Show tasks','unfinished');await choose('Group tasks by','due');
    await page.reload();await page.locator('.mail-group-header').first().waitFor();
    assert.equal(preferences.taskView.group,'due');assert.equal(preferences.taskView.status,'unfinished');
    await item('later').click({button:'right'});
    await page.getByRole('menuitem',{name:'Mark complete',exact:true}).click();await selected('custom');
    assert.equal(records.find(r=>r.id==='later').meta.done,true);
    await page.setViewportSize({width:390,height:844});
    await open();assert.ok(await page.getByLabel('Sort tasks by').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'test-results/task-view-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'test-results/task-view-desktop.png',fullPage:true});
    console.log('PASS task view: defaults, badges, combined filters, search, groups, collapse persistence, keyboard navigation, completion advancement, legacy priority, preferences and mobile layout.');
  }finally{await page.unroute(routes);}
}
