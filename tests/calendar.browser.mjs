import assert from 'node:assert/strict';
import {addDays,dayKey} from '../public/calendar.js';
export async function testCalendar(page,url){
 const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const weekStart=addDays(now,14-now.getDay());
 const [first,middle,last,after]=Array.from({length:4},(_,i)=>dayKey(addDays(weekStart,i)));
 let rows=Array.from({length:5},(_,i)=>({id:'cal-'+i,kind:'calendar',title:'Event '+i,body:'Notes',revision:1,meta:{start:day+'T09:00:00',end:day+'T10:00:00'}}));
 rows.push({id:'remote',kind:'calendar',title:'Remote event',body:'Read only',revision:1,meta:{start:day,end:day,remote:true,account:'caldav'}});
 rows.push({id:'past',kind:'calendar',title:'Past event',body:'Notes',revision:1,meta:{start:'2000-01-01',end:'2000-01-02',remote:true,account:'caldav'}});
 const saved=[];let nextSaveError='';const routes=u=>u.pathname.endsWith('/api.php')&&u.searchParams.get('r')!=='activity';
 await page.route(routes,async route=>{const action=new URL(route.request().url()).searchParams.get('r');if(action==='save'){
  if(nextSaveError){const error=nextSaveError;nextSaveError='';await route.fulfill({status:400,json:{error}});return;}
  const input=route.request().postDataJSON();saved.push(input);const record={...input,id:input.id||`created-${saved.length}`,revision:(input.revision||0)+1};rows=rows.filter(r=>r.id!==record.id).concat(record);await route.fulfill({json:{record}});return;
 }const responses={sync:{count:0},connections:{items:[],links:[],more:false},status:{authenticated:true,csrf:'fixture',preferences:{theme:'dark'}},accounts:{accounts:[{id:'caldav',type:'caldav',label:'Work'}]},records:{records:rows}};assert.ok(action in responses,action);await route.fulfill({json:responses[action]});});
 try{
  await page.goto(url+'#calendar');await page.reload();await page.locator('.calendar-month').waitFor();
  const closeEvent=page.getByRole('button',{name:'Close event',exact:true});
  assert.equal(await closeEvent.count(),0);
  assert.equal(await page.locator('.calendar-date.today').getAttribute('data-day'),day);
  assert.equal(await page.locator('.calendar-day').count(),42);await page.screenshot({path:'test-results/calendar-month.png',fullPage:true});
  await page.locator(`[data-jump="${day}"].calendar-more`).click();await page.locator('.calendar-time-day').waitFor();assert.equal(await page.locator('.calendar-time-day .calendar-event').count(),5);assert.equal(await page.locator('.calendar-time-day .calendar-event').first().evaluate(n=>getComputedStyle(n).position),'absolute');assert.notEqual(await page.locator('.calendar-time-day .calendar-event').first().evaluate(n=>getComputedStyle(n).borderLeftColor),'rgba(0, 0, 0, 0)');
  await page.getByRole('button',{name:'Remote event',exact:true}).click();assert.equal(await page.locator('#detail [name=title]').isDisabled(),true);await page.keyboard.press('Escape');await closeEvent.waitFor({state:'hidden'});
  await page.locator('[data-source=caldav]').uncheck();assert.equal(await page.getByRole('button',{name:'Remote event',exact:true}).count(),0);assert.equal(await page.locator('[data-source=caldav]').evaluate(n=>n===document.activeElement),true);
  await page.locator('#items [data-id=cal-0]').click();await page.keyboard.press('G');assert.equal(await page.locator('#selected-item').getAttribute('data-id'),'cal-4','Navigation honors hidden source');
  await page.getByRole('button',{name:'Full Screen',exact:true}).click();await page.locator('.calendar-workspace.item-fullscreen').waitFor();
  await page.locator('#detail [name=title]').fill('Updated event');await page.keyboard.press('Escape');await closeEvent.waitFor({state:'hidden'});
  assert.equal(saved.at(-1).title,'Updated event');assert.equal(await page.locator('.calendar-workspace.item-fullscreen').count(),0);
  assert.equal(await page.locator('#items [data-id=cal-4]').evaluate(node=>node===document.activeElement),true);
  await page.locator('[data-view=month]').click();await page.locator(`.calendar-day [data-day="${day}"]`).click();await page.locator('#detail [name=start]').waitFor();assert.equal(await page.locator('#detail [name=start]').inputValue(),day);assert.equal(await page.locator('#detail [name=start]').getAttribute('type'),'date');
  await page.keyboard.press('Escape');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await closeEvent.waitFor();
  const start=page.locator('#detail [name=start]'),end=page.locator('#detail [name=end]');
  const endError=page.locator('#detail #calendar-event-error'),save=page.getByRole('button',{name:'Save',exact:true});
  const beforeDraft=saved.length;
  assert.equal(await end.inputValue(),day,'A date-cell draft starts as a one-day event');
  await start.fill(first);assert.equal(await end.inputValue(),first);assert.ok(await save.isEnabled());
  await end.fill(day);assert.equal(await end.inputValue(),day);
  assert.equal(await endError.textContent(),'End date cannot be before start date.');assert.ok(await save.isDisabled());
  await page.keyboard.press('Control+s');assert.equal(saved.length,beforeDraft);
  await end.fill(last);
  assert.equal(await end.inputValue(),last);assert.equal(await endError.textContent(),'');
  await page.locator('#detail [name=title]').fill('All day saved');
  const rejection='Could not save this event.';
  nextSaveError=rejection;await save.click();
  await page.locator('#detail').getByText(rejection,{exact:true}).waitFor();
  assert.ok(!(await page.locator('#notice').textContent()).includes(rejection));
  assert.equal(await end.inputValue(),last);
  await save.click();
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved');
  assert.equal(await endError.textContent(),'');
  assert.equal(saved.length,beforeDraft+1);
  assert.equal(saved.at(-1).meta.start,first);assert.equal(saved.at(-1).meta.end,after);
  assert.equal(await end.inputValue(),last);
  await closeEvent.click();await page.getByRole('button',{name:'New event',exact:true}).click();
  const allDay=page.getByRole('checkbox',{name:'All day',exact:true});
  await start.fill('2040-11-21T09:00');await allDay.check();
  assert.equal(await page.getByLabel('End (last day)',{exact:true}).inputValue(),'2040-11-21');
  await allDay.uncheck();assert.equal(await page.getByLabel('End (local time)',{exact:true}).inputValue(),'2040-11-22T00:00');
  await end.fill('2040-11-21T10:00');
  await start.fill('2040-11-21T23:30');assert.equal(await end.inputValue(),'2040-11-22T00:30');
  await save.click();await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved');
  const beforeEdit=saved.length;
  await end.fill('2040-11-21T23:30');assert.equal(await end.getAttribute('aria-invalid'),'true');
  await page.waitForTimeout(900);assert.equal(saved.length,beforeEdit,'Autosave skips invalid end');
  await end.fill('2040-11-22T01:00');
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved');
  assert.equal(saved.length,beforeEdit+1);
  await page.getByRole('button',{name:'Close event',exact:true}).click();await page.locator('[data-view=week]').click();assert.equal(await page.locator('.calendar-time-day').count(),7);assert.equal(await page.locator('.calendar-time-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),8);assert.equal(await page.locator('[data-source=local]').evaluate(n=>getComputedStyle(n).accentColor),'rgb(58, 140, 114)');await page.screenshot({path:'test-results/calendar-week.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);for(const node of await page.locator('.calendar-toolbar h2,.calendar-toolbar > div').all()){const box=await node.boundingBox();assert.ok(box.x+box.width<=390.5,'Mobile toolbar stays within viewport');}await page.screenshot({path:'test-results/calendar-mobile.png',fullPage:true});
  const mobileEventTitle=page.locator('#detail [name=title]');
  await page.locator('#items [data-id=cal-0]').click();await mobileEventTitle.waitFor();await page.keyboard.press('Escape');await mobileEventTitle.waitFor({state:'hidden'});
  assert.equal(await page.locator('.shell.mobile-item-open, #selected-item').count(),0);
  await page.reload();await page.locator(`[data-agenda-date="${day}"]`).waitFor();assert.equal(await closeEvent.count(),0);
  await page.setViewportSize({width:1440,height:900});
  for(const view of ['month','week','day','agenda']){
   const toggle=page.locator(`[data-view="${view}"]`);
   await toggle.click();await page.locator('[data-period=today]').click();
   assert.equal(await page.locator('.calendar-mini .primary').getAttribute('data-jump'),day);
   await page.locator('[data-period=next]').click();
   const browsedDate=await page.locator('.calendar-mini .primary').getAttribute('data-jump');assert.notEqual(browsedDate,day);
   await page.locator('[data-app=tasks]').click();await page.waitForFunction(()=>document.querySelector('#crumb')?.textContent==='Tasks'&&!document.querySelector('#main[data-app-entry]'));
   await page.locator('[data-app=calendar]').click();await page.locator(`.calendar-mini .primary[data-jump="${browsedDate}"]`).waitFor();
   assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert.equal(await closeEvent.count(),0);
  }
  const allDayIds=Array.from({length:4},(_,i)=>`multi-all-day-${i}`);
  const addEvent=(id,start,end)=>rows.push({id,kind:'calendar',title:id,body:'',revision:1,meta:{start,end}});
  for(const id of allDayIds)addEvent(id,first,after);
  allDayIds.push(rows.find(r=>r.title==='All day saved').id);
  addEvent('multi-timed',first+'T18:00',last+'T01:00');
  addEvent('single-busy',middle+'T08:00',middle+'T09:00');
  await page.reload();await page.locator('[data-view=week]').click();await page.locator('[data-period=today]').click();
  await page.locator('[data-period=next]').click();await page.locator('[data-period=next]').click();
  const assertDay=async (date,view,index)=>{
   const allDayColumn=page.locator(view==='month'?'.calendar-day':'.calendar-all-day').filter({has:page.locator(`[data-day="${date}"]`)});
   const timedColumn=view==='month'?allDayColumn:page.locator('.calendar-time-day').nth(index);
   for(const id of allDayIds)assert.equal(await allDayColumn.locator(`[data-id="${id}"]`).count(),date===after?0:1,`${view} ${date} ${id}`);
   const timed=timedColumn.locator('[data-id=multi-timed]');
   assert.equal(await timed.count(),date===after?0:1,`${view} ${date} timed event`);
   if(date===after)return;
   assert.equal(await timed.locator('time').count(),date===first?1:0);
   if(view!=='month'){
    assert.deepEqual(await timed.evaluate(node=>[node.style.top,node.style.height]),
     date===first?['864px','288px']:date===middle?['0px','1152px']:['0px','48px']);
   }
  };
  const scheduledDays=[first,middle,last,after];
  for(const [index,date] of scheduledDays.entries())await assertDay(date,'week',index);
  await page.locator('[data-view=month]').click();
  for(const date of scheduledDays)await assertDay(date,'month',0);
  assert.equal(await page.locator(`.calendar-more[data-jump="${middle}"]`).textContent(),'+1 more');
  for(const date of scheduledDays){
   await page.locator(`.calendar-mini [data-jump="${date}"]`).click();
   await assertDay(date,'day',0);
  }
 }finally{await page.unroute(routes);}
}
