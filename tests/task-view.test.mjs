import test from 'node:test';
import assert from 'node:assert/strict';
import {taskView,taskViewPreferences,taskDue,taskPriority} from '../public/task-view.js';
const now=new Date(2026,10,4,0,1);
const task=(id,due='',priority='Normal',done=false)=>({id,title:id,kind:'tasks',body:'',updated:'2026-11-04T12:00:00Z',meta:{due,priority,done}});
const rows=[task('undated'),task('later','2026-11-10','Low'),task('today','2026-11-04','High'),task('overdue','2026-11-01'),task('finished','2026-10-01','High',true)];
const ids=model=>model.rows.map(r=>r.id);
test('defaults hide completed tasks and order deadlines with undated last',()=>{
  assert.deepEqual(ids(taskView(rows,null,now)),['overdue','today','later','undated']);
  assert.deepEqual(ids(taskView(rows,{sort:'due-desc'},now)),['later','today','overdue','undated']);
  assert.deepEqual(ids(taskView(rows,{status:'completed'},now)),['finished']);
});
test('completion, priority, due and search-subset filters compose',()=>{
  assert.deepEqual(ids(taskView(rows,{status:'all',priority:'High'},now)),['finished','today']);
  assert.deepEqual(ids(taskView(rows,{due:'overdue'},now)),['overdue']);
  assert.deepEqual(ids(taskView(rows,{due:'today',priority:'High'},now)),['today']);
  assert.deepEqual(ids(taskView(rows.slice(0,2),{due:'upcoming'},now)),['later']);
  assert.deepEqual(ids(taskView(rows,{due:'undated'},now)),['undated']);
});
test('priority/title sorting and grouping are deterministic',()=>{
  assert.deepEqual(ids(taskView(rows,{sort:'priority-desc'},now)),['today','overdue','undated','later']);
  assert.deepEqual(ids(taskView(rows,{sort:'title-desc'},now)),['undated','today','overdue','later']);
  assert.deepEqual(taskView(rows,{group:'due'},now).groups.map(g=>g.label),['Overdue','Due today','Upcoming','No due date']);
  assert.deepEqual(taskView(rows,{group:'status',status:'all'},now).groups.map(g=>g.label),['Unfinished','Completed']);
  assert.deepEqual(taskView(rows,{group:'priority'},now).groups.map(g=>g.label),['High','Normal','Low']);
  assert.deepEqual(taskView(rows,{group:'priority',sort:'priority-asc'},now).groups.map(g=>g.label),['Low','Normal','High']);
});
test('collapsed groups retain counts but leave navigation; collapse-all allows exceptions',()=>{
  const model=taskView(rows,{group:'due',collapsed:['due:*','due:!due:Due today']},now);
  assert.equal(model.rows.length,4);
  assert.deepEqual(model.visible.map(r=>r.id),['today']);
  assert.equal(model.groups[0].rows.length,1);
});
test('dates respect local calendar day, leap years and invalid/empty dates',()=>{
  assert.equal(taskDue(task('today','2026-11-04'),now),'today');
  assert.equal(taskDue(task('yesterday','2026-11-03'),now),'overdue');
  for(const due of ['2026-02-30','bad','','2026-13-01'])assert.equal(taskDue(task('invalid',due),now),'undated');
  assert.equal(taskDue(task('leap','2024-02-29'),new Date(2024,1,29)),'today');
});
test('legacy priorities survive, defaults and persisted collapse state are bounded',()=>{
  assert.equal(taskPriority(task('a','','hIGH')),'High');
  assert.equal(taskPriority(task('a','','')),'Normal');
  assert.equal(taskPriority(task('a','','Urgent')),'Urgent');
  const p=taskViewPreferences({group:'invalid',sort:'toString',status:'bad',due:'bad',collapsed:[null,'x',...Array.from({length:100},(_,i)=>'priority:'+i+'é'.repeat(100))]});
  assert.equal(p.group,'none');assert.equal(p.sort,'due-asc');assert.equal(p.status,'unfinished');assert.equal(p.due,'all');
  assert.ok(JSON.stringify(p).replace(/[^\x00-\x7f]/g,'\\u0000').length<2500);
});
