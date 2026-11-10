import assert from 'node:assert/strict';
import {addDays,dayKey} from '../public/calendar.js';
export async function testCalendar(page,url){
 const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const weekStart=addDays(now,14-now.getDay());
 const [first,middle,last,after]=Array.from({length:4},(_,i)=>dayKey(addDays(weekStart,i)));
 let rows=Array.from({length:5},(_,i)=>({id:'cal-'+i,kind:'calendar',title:'Event '+i,body:'Notes',revision:1,meta:{start:day+'T09:00:00',end:day+'T10:00:00'}}));
 rows.push({id:'remote',kind:'calendar',title:'Remote event',body:'Read only',revision:1,meta:{start:day,end:day,remote:true,account:'caldav'}});
 rows.push({id:'past',kind:'calendar',title:'Past event',body:'Notes',revision:1,meta:{start:'2000-01-01',end:'2000-01-02',remote:true,account:'caldav'}});
 const saved=[],providerSaves=[],searches=[];let nextSaveError='';let preferences={theme:'dark'},addGoogle=false;const routes=u=>u.pathname.endsWith('/api.php')&&u.searchParams.get('r')!=='activity';
 await page.route(routes,async route=>{const action=new URL(route.request().url()).searchParams.get('r');if(action==='save'){
  if(nextSaveError){const error=nextSaveError;nextSaveError='';await route.fulfill({status:400,json:{error}});return;}
  const input=route.request().postDataJSON();saved.push(input);const record={...input,id:input.id||`created-${saved.length}`,revision:(input.revision||0)+1};rows=rows.filter(r=>r.id!==record.id).concat(record);await route.fulfill({json:{record}});return;
 }if(action==='calendar-series'){
  const row=rows.find(r=>r.id==='writable-event');
  await route.fulfill({json:{record:{...row,title:'Series master',meta:{...row.meta,calendarOccurrence:'',calendarRules:'RRULE:FREQ=WEEKLY',calendarEtag:'"series"'}}}});return;
 }if(action==='calendar-save'){
  const input=route.request().postDataJSON();providerSaves.push(input);
  if(nextSaveError){const error=nextSaveError;nextSaveError='';await route.fulfill({status:409,json:{error}});return;}
  rows=rows.map(row=>row.id===input.id?{...row,body:input.changes.body??row.body,revision:row.revision+1}:row);
  await route.fulfill({json:{}});return;
 }if(action==='preferences'){preferences=route.request().postDataJSON().preferences;await route.fulfill({json:{ok:true}});return;}
 if(action==='calendar-search'){
  const request=route.request().postDataJSON();searches.push(request);
  if(request.account==='caldav'){await route.fulfill({status:503,json:{error:'Provider unavailable.'}});return;}
  const matches=request.page?[{id:'provider-only',title:'Past provider event',body:'Historic notes',location:'Old office',start:'1999-01-01',end:'1999-01-02',recurring:!request.from}]:[];
  await route.fulfill({json:{matches,next:request.page?'':'next-page',warning:''}});return;
 }
 const accounts=[{id:'caldav',type:'caldav',label:'Work'}];
 if(addGoogle)accounts.push({id:'google',type:'google',label:'Personal'});
 const responses={sync:{count:0},'google-settings':{configured:false},'mail-junk-settings':{rules:[],folder:'Junk'},connections:{items:[],links:[],more:false},status:{authenticated:true,csrf:'fixture',preferences},accounts:{accounts},records:{records:rows}};assert.ok(action in responses,action);await route.fulfill({json:responses[action]});});
 try{
  const initialRows=rows;
  const initialPreferences=preferences;
  preferences={...preferences,calendarDisplay:{month:1}};
  const hoursAfter=(date,hours)=>new Date(+date+hours*3600000);
  const navigationEvent=(id,start)=>({id,kind:'calendar',title:id,body:'Notes',revision:1,meta:{
   start:start.toISOString(),end:hoursAfter(start,0.5).toISOString(),
  }});
  const upcomingDay=addDays(now,1);
  upcomingDay.setHours(10,0,0,0);
  const hiddenEvent=navigationEvent('Hidden upcoming event',hoursAfter(now,1));
  Object.assign(hiddenEvent.meta,{remote:true,account:'caldav'});
  rows=[initialRows.find(row=>row.id==='past'),navigationEvent('previous',hoursAfter(now,-1)),hiddenEvent,
   navigationEvent('upcoming',upcomingDay),navigationEvent('following',hoursAfter(upcomingDay,1))];
  const selectWithKey=async (key,id,view='month')=>{
   await page.keyboard.press(key);
   const selected=page.locator(`#selected-item[data-id="${id}"]`);
   await selected.waitFor();
   assert.equal(await selected.evaluate(node=>node===document.activeElement),true);
   assert.equal(await page.locator(`[data-view=${view}]`).getAttribute('aria-pressed'),'true');
  };
  await page.goto(url+'#calendar');await page.reload();
  await page.locator('[data-source=caldav]').uncheck();
  await page.locator('#main').focus();
  await selectWithKey('j','upcoming');
  const moreOnUpcomingDay=page.locator(`.calendar-more[data-jump="${dayKey(upcomingDay)}"]`);
  assert.equal(await moreOnUpcomingDay.textContent(),'+1 more');
  assert.equal(await page.locator('#items [data-id=following]').count(),0);
  await selectWithKey('j','following');
  assert.equal(await moreOnUpcomingDay.textContent(),'+1 more');
  assert.equal(await page.locator('#items [data-id=upcoming]').count(),0);
  await selectWithKey('k','upcoming');
  await moreOnUpcomingDay.click();
  assert.equal(await page.locator('[data-view=day]').getAttribute('aria-pressed'),'true');
  for(const view of ['month','week','day','agenda']){
   await page.reload();
   await page.locator(`[data-view=${view}]`).click();
   await page.locator('#main').focus();
   await selectWithKey('k','previous',view);
   await selectWithKey('k','past',view);
   await selectWithKey('j','previous',view);
  }
  rows=initialRows;
  preferences=initialPreferences;
  await page.goto(url+'#calendar');await page.reload();await page.locator('.calendar-month').waitFor();
  await page.getByRole('button',{name:'Rename calendar Work',exact:true}).click();
  await page.getByRole('textbox',{name:'Calendar alias',exact:true}).fill('Work schedule');
  await page.getByRole('button',{name:'Save alias',exact:true}).click();
  await page.getByRole('checkbox',{name:'Work schedule',exact:true}).waitFor();
  assert.deepEqual(preferences.calendarAliases,{caldav:'Work schedule'});
  await page.reload();await page.getByRole('checkbox',{name:'Work schedule',exact:true}).waitFor();
  await page.getByRole('button',{name:'Rename calendar Work schedule',exact:true}).click();
  const alias=page.getByRole('textbox',{name:'Calendar alias',exact:true});
  assert.equal(await alias.inputValue(),'Work schedule');
  await alias.fill('');
  await page.getByRole('button',{name:'Save alias',exact:true}).click();
  await page.getByRole('checkbox',{name:'Work',exact:true}).waitFor();
  assert.deepEqual(preferences.calendarAliases,{});
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
  rows.push({id:'writable-event',kind:'calendar',title:'Writable event',body:'Notes',revision:1,meta:{
   start:day,end:dayKey(addDays(now,1)),remote:true,account:'caldav',calendarWritable:true,calendarSeries:'meeting.ics',
   calendarOccurrence:day,calendarEtag:'"occurrence"',calendarExtra:'CLASS:PRIVATE',calendarGuests:true}});
  await page.reload();await page.locator('[data-view=agenda]').click();await page.locator('[data-period=today]').click();
  await page.locator('#items [data-id=writable-event]').click();
  const notes=page.locator('#detail [name=body]');
  await notes.fill('Provider notes');
  await page.waitForTimeout(900);assert.equal(providerSaves.length,0,'Provider edits wait for explicit Save');
  await save.click();await page.getByRole('dialog').getByRole('button',{name:'Save event',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved');
  assert.deepEqual(providerSaves.at(-1).changes,{body:'Provider notes'});
  assert.equal(providerSaves.at(-1).scope,'occurrence');assert.equal(providerSaves.at(-1).confirmed,true);
  await page.getByRole('button',{name:'Edit entire series',exact:true}).click();
  await page.getByText('You are editing the entire series.',{exact:true}).waitFor();
  await page.getByText('Repeat and exceptions',{exact:true}).click();
  await page.getByLabel('Number of occurrences',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Apply repeat pattern',exact:true}).click();
  const recurrence=page.locator('#detail [name=calendarRules]');
  assert.equal(await recurrence.inputValue(),'RRULE:FREQ=WEEKLY;COUNT=5');
  const conflict='Event changed at the provider.';nextSaveError=conflict;
  await save.click();await page.getByRole('dialog').getByRole('button',{name:'Save event',exact:true}).click();
  await page.getByText(conflict,{exact:true}).waitFor();
  assert.equal(providerSaves.at(-1).scope,'series');assert.equal(providerSaves.at(-1).version,'"series"');
  assert.equal(await recurrence.inputValue(),'RRULE:FREQ=WEEKLY;COUNT=5');
  addGoogle=true;
  const tomorrow=dayKey(addDays(now,1));
  const yesterday=dayKey(addDays(now,-1));
  addEvent('earlier-event',yesterday+'T09:00',yesterday+'T10:00');
  addEvent('upcoming-one',tomorrow+'T09:00',tomorrow+'T10:00');
  addEvent('upcoming-two',tomorrow+'T11:00',tomorrow+'T12:00');
  await page.reload();
  await page.locator('[data-app=settings]').click();
  await page.getByRole('button',{name:'Calendar settings',exact:true}).click();
  const settings=page.locator('#calendar-preferences');
  for(const name of ['month','agenda','header'])await settings.locator(`[name=${name}]`).fill('1');
  await settings.getByRole('button',{name:'Save calendar preferences'}).click();
  await page.getByText('Calendar preferences saved.',{exact:true}).waitFor();
  assert.deepEqual(preferences.calendarDisplay,{month:1,agenda:1,header:1});
  await page.reload();
  await page.locator('[data-app=calendar]').click();
  await page.locator('[data-view=month]').click();
  const cell=page.locator('.calendar-day').filter({has:page.locator(`[data-day="${day}"]`)});
  assert.equal(await cell.locator('.calendar-event').count(),1);
  await cell.locator('.calendar-more').click();
  assert.ok(await page.locator('.calendar-time-day .calendar-event').count()>1);
  await page.locator('[data-view=agenda]').click();
  assert.equal(await page.locator('.calendar-agenda .calendar-event').count(),1);
  await page.locator('[data-agenda-more]').click();
  assert.equal(await page.locator('.calendar-agenda .calendar-event').count(),2);
  if(yesterday.slice(0,7)===day.slice(0,7)){
   await page.locator('[data-agenda-earlier]').click();
   await page.locator('.calendar-agenda [data-id=earlier-event]').waitFor();
  }
  await page.locator('#top-agenda summary').click();
  await page.locator('[data-header-agenda-more]').waitFor();
  assert.equal(await page.locator('[data-agenda-event]').count(),1);
  await page.locator('[data-header-agenda-more]').click();
  assert.equal(await page.locator('[data-agenda-event]').count(),2);
  await page.keyboard.press('Escape');
  await page.locator('[data-source=caldav]').uncheck();
  await page.getByRole('searchbox',{name:'Search calendar',exact:true}).fill('Event');
  assert.ok(await page.locator('.calendar-agenda .calendar-event').count()>1,'Search ignores the agenda display count.');
  await page.getByRole('searchbox',{name:'Search calendar',exact:true}).fill('  Past event  ');
  await page.locator('[data-id=past]').waitFor();
  assert.match(await page.locator('.calendar-agenda').innerText(),/Work/);
  await page.getByRole('button',{name:'Search connected calendars',exact:true}).click();
  await page.getByText('1 match from connected calendars.',{exact:true}).waitFor();
  await page.getByText('Work — Provider unavailable.',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Past provider event.*Recurring series/}).click();
  await page.getByText('Historic notes',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Open stored event'}).count(),0);
  await page.getByLabel('From',{exact:true}).fill('1999-01-01');
  await page.getByLabel('Through',{exact:true}).fill('1999-01-31');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:/Past provider event/}).waitFor();
  assert.deepEqual(searches.map(({account,page,from})=>[account,page,from]),[
   ['caldav','',''],['google','',''],['google','next-page',''],
   ['caldav','','1999-01-01'],['google','','1999-01-01'],['google','next-page','1999-01-01'],
  ]);
  await page.keyboard.press('Escape');
 }finally{await page.unroute(routes);}
}
