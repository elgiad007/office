import test from 'node:test';
import assert from 'node:assert/strict';
import {mailDateGroup,mailSender,mailView,mailViewPreferences,localWeekStart,revealMailGroup} from '../public/mail-view.js';
import {messageTime} from '../public/mail-sort.js';
import {renderMailListCopy} from '../public/mail-list.js';
const mail=(id,date,from='Alex <alex@example.com>',title=id)=>({id,title,kind:'mail',body:'',meta:{date,from}});
const at=(year,month,day,hour=12)=>new Date(year,month-1,day,hour).toISOString();
const ids=model=>model.rows.map(row=>row.id);
test('view defaults, imported values and collapsed storage are validated and bounded',()=>{
  assert.deepEqual(mailViewPreferences(null),{group:'date',sort:'date-desc',collapsed:[]});
  assert.deepEqual(mailViewPreferences({group:'bogus',sort:'toString',collapsed:[null,3,'x','date:Today','date:Today']}),{group:'date',sort:'date-desc',collapsed:['date:Today']});
  const prefs=mailViewPreferences({group:'sender',sort:'subject-asc',collapsed:Array.from({length:800},(_,i)=>'sender:'+i+'é'.repeat(100))});
  assert.ok(JSON.stringify(prefs).replace(/[^\x00-\x7f]/g,'\\u0000').length<4200);
  assert.equal(localWeekStart('en-US'),0);assert.equal(localWeekStart('en-GB'),1);
});
test('local calendar buckets use first match, omit empty groups, and honor week starts',()=>{
  const now=new Date(2026,10,19,15); // Thursday
  const samples=[[at(2026,11,20),'Future'],[at(2026,11,19),'Today'],[at(2026,11,18),'Yesterday'],[at(2026,11,16),'This Week'],[at(2026,11,11),'Last Week'],[at(2026,11,2),'This Month'],[at(2026,10,30),'Last Month'],[at(2026,9,30),'Older'],['bad','Undated']];
  for(const [date,bucket] of samples)assert.equal(mailDateGroup(mail(bucket,date),now,1),bucket);
  assert.equal(mailDateGroup(mail('sunday',at(2026,11,15)),now,0),'This Week');
  assert.equal(mailDateGroup(mail('sunday',at(2026,11,15)),now,1),'Last Week');
  const groups=mailView([mail('a',at(2026,11,19)),mail('b','bad')],{},now,1).groups;
  assert.deepEqual(groups.map(g=>g.label),['Today','Undated']);
});
test('midnight, year/month overlap, leap day and DST boundaries use local dates',()=>{
  const jan=new Date(2027,0,1,0,1);
  assert.equal(mailDateGroup(mail('y',new Date(2026,11,31,23,59).toISOString()),jan,0),'Yesterday');
  assert.equal(mailDateGroup(mail('w',at(2026,12,28)),jan,0),'This Week');
  assert.equal(mailDateGroup(mail('leap',at(2024,2,29)),new Date(2024,2,1),0),'Yesterday');
  for(const [month,day] of [[3,8],[11,1]]){
    const now=new Date(2026,month-1,day+1,0,1);
    assert.equal(mailDateGroup(mail('dst',new Date(2026,month-1,day,0,1).toISOString()),now,0),'Yesterday');
  }
});
test('one valid date fallback drives display, grouping and sorting; undated remains last',()=>{
  const fallback=mail('fallback','invalid');fallback.meta.sentAt=at(2026,11,19);
  const primary=mail('primary',at(2026,11,18));primary.meta.sentAt=at(2099,1,1);
  assert.equal(messageTime(fallback),Date.parse(fallback.meta.sentAt));assert.equal(messageTime(primary),Date.parse(primary.meta.date));
  assert.match(renderMailListCopy(fallback),/Nov 19, 2026/);
  assert.match(renderMailListCopy(mail('bad','bad')),/Date unavailable/);
  assert.deepEqual(ids(mailView([primary,fallback,mail('undated','bad')],{group:'none',sort:'date-desc'})),['fallback','primary','undated']);
  assert.deepEqual(ids(mailView([primary,fallback,mail('undated','bad')],{group:'none',sort:'date-asc'})),['primary','fallback','undated']);
});
test('sender identity ignores address case/display-name changes and keeps same-name addresses separate',()=>{
  const rows=[mail('a','', 'Alex <ONE@example.com>'),mail('b','', '"Alex Updated" <one@example.com>'),mail('c','', 'Alex <two@example.com>'),mail('u','','')];
  assert.equal(mailSender(rows[0]).key,mailSender(rows[1]).key);
  const groups=mailView(rows,{group:'sender'}).groups;
  assert.equal(groups.length,3);assert.equal(groups.find(g=>g.rows.some(r=>r.id==='a')).rows.length,2);
  assert.equal(groups.find(g=>g.rows[0].id==='u').label,'Unknown sender');
  assert.notEqual(mailSender(mail('wildcard','','*')).key,'*','Sender names cannot collide with collapse-all state');
  assert.notEqual(mailSender(mail('unknown','','unknown')).key,mailSender(rows[3]).key);
});
test('sort controls order rows inside groups and reverse only matching group order',()=>{
  const now=new Date(2026,10,19),rows=[mail('b',at(2026,11,19,13),'Zed <z@example.com>','Beta'),mail('a',at(2026,11,19,12),'Amy <a@example.com>','Alpha'),mail('c',at(2026,11,18),'Bob <b@example.com>','Gamma')];
  const expected={'date-desc':['b','a','c'],'date-asc':['c','a','b'],'sender-asc':['a','b','c'],'sender-desc':['b','a','c'],'subject-asc':['a','b','c'],'subject-desc':['b','a','c']};
  for(const [sort,order] of Object.entries(expected))assert.deepEqual(ids(mailView(rows,{group:'date',sort},now)),order,sort);
  assert.deepEqual(ids(mailView(rows,{group:'sender',sort:'date-asc'},now)),['a','c','b']);
  assert.deepEqual(ids(mailView(rows,{group:'sender',sort:'sender-desc'},now)),['b','c','a']);
  assert.deepEqual(ids(mailView(rows,{group:'none',sort:'subject-desc'},now)),['c','b','a']);
});
test('collapse retains all ordered rows while navigation excludes them, including collapse-all exceptions',()=>{
  const rows=[mail('a',at(2026,11,19)),mail('b',at(2026,11,18))],now=new Date(2026,10,19);
  const model=mailView(rows,{collapsed:['date:Today']},now);
  assert.deepEqual(ids(model),['a','b']);assert.deepEqual(model.visible.map(r=>r.id),['b']);
  assert.equal(mailView(rows,{collapsed:['date:*']},now).visible.length,0);
  assert.deepEqual(mailView(rows,{collapsed:['date:*','date:!date:Yesterday']},now).visible.map(r=>r.id),['b']);
  assert.equal(mailView(rows,{group:'none',collapsed:['date:*']},now).visible.length,2);
});
test('opening a linked message reveals only its date or sender group, including collapse-all',()=>{
  const record=mail('linked',new Date().toISOString(),'Alex <alex@example.com>');
  const key=mailView([record],{}).groups[0].key;
  assert.deepEqual(revealMailGroup(record,{collapsed:[key,'date:Older']}).collapsed,['date:Older']);
  const p=revealMailGroup(record,{collapsed:['date:*','sender:email:other@example.com']});
  assert.deepEqual(p.collapsed,['date:*','sender:email:other@example.com','date:!'+key]);
  assert.equal(mailView([record],p).visible.length,1);
  const sender=revealMailGroup(record,{group:'sender',collapsed:['sender:*','date:Older']});
  assert.deepEqual(sender.collapsed,['sender:*','date:Older','sender:!sender:email:alex@example.com']);
  assert.deepEqual(revealMailGroup(record,{group:'none',collapsed:[key]}).collapsed,[key]);
});
