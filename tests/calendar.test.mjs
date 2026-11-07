import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDate,dayKey,addDays,eventBounds,eventsOn,timedLayout,upcomingEvents} from '../public/calendar.js';
process.env.TZ='America/New_York';
const event=(id,start,end)=>({id,title:id,meta:{start,end}});
test('date-only events use local dates and exclusive ends across DST',()=>{
 const r=event('all','2026-03-08','2026-03-09');
 assert.equal(dayKey(calendarDate('2026-03-08')),'2026-03-08');
 assert.equal(dayKey(addDays(calendarDate('2026-03-08'),1)),'2026-03-09');
 assert.equal(eventsOn([r],calendarDate('2026-03-08')).length,1);
 assert.equal(eventsOn([r],calendarDate('2026-03-09')).length,0);
 assert.equal(eventBounds(r).end-eventBounds(r).start,23*3600000);
});
test('overnight timed events appear on both days but exclude midnight end',()=>{
 const r=event('night','2026-11-03T23:00:00-05:00','2026-11-04T01:00:00-05:00');
 assert.equal(eventsOn([r],calendarDate('2026-11-03')).length,1);
 assert.equal(timedLayout([r],calendarDate('2026-11-04'))[0].start,0);
 assert.equal(timedLayout([r],calendarDate('2026-11-04'))[0].end,60);
 assert.equal(eventsOn([event('mid','2026-11-03T23:00:00-05:00','2026-11-04T00:00:00-05:00')],calendarDate('2026-11-04')).length,0);
});
test('overlap groups use separate columns and touching events share full width',()=>{
 const rows=[event('a','2026-11-03T09:00','2026-11-03T11:00'),event('b','2026-11-03T10:00','2026-11-03T12:00'),event('c','2026-11-03T12:00','2026-11-03T13:00')];
 const layout=timedLayout(rows,calendarDate('2026-11-03'));
 assert.deepEqual(layout.map(x=>[x.column,x.columns]),[[0,2],[1,2],[0,1]]);
});
test('missing dates remain identifiable and missing all-day ends last one date',()=>{
 assert.equal(eventBounds(event('bad','','')),null);
 assert.equal(dayKey(eventBounds(event('one','2026-11-03','')).end),'2026-11-04');
});
test('upcoming events include ongoing and all-day events within seven local days',()=>{
 const rows=[
   event('later','2026-03-12T10:00','2026-03-12T11:00'),
   event('outside','2026-03-14T10:00','2026-03-14T11:00'),
   event('ongoing','2026-03-07T09:00','2026-03-07T11:00'),
   event('ended','2026-03-07T09:00','2026-03-07T10:00'),
   event('today','2026-03-07','2026-03-08'),
   event('undated','',''),
 ];
 const entries=upcomingEvents(rows,calendarDate('2026-03-07T10:00'));
 assert.deepEqual(entries.map(({record,allDay})=>[record.id,allDay]),[
   ['today',true],['ongoing',false],['later',false],
 ]);
});
