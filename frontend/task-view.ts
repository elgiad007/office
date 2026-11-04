import type {OfficeRecord,TaskViewPreferences} from './types.js';

export function taskViewPreferences(value: unknown): TaskViewPreferences {
  const p=value as Partial<TaskViewPreferences> | null;
  let size=0;
  const choice=<T extends string>(value: unknown,values: readonly T[],fallback: T): T=>values.includes(value as T)?value as T:fallback;
  return {
    group:choice(p?.group,['none','due','status','priority'],'none'),
    sort:choice(p?.sort,['due-asc','due-desc','priority-desc','priority-asc','title-asc','title-desc','updated-desc','updated-asc'],'due-asc'),
    status:choice(p?.status,['unfinished','completed','all'],'unfinished'),
    priority:typeof p?.priority==='string'?p.priority.slice(0,200):'all',
    due:choice(p?.due,['all','overdue','today','upcoming','undated'],'all'),
    collapsed:Array.isArray(p?.collapsed)?[...new Set(p.collapsed.filter((k): k is string=>typeof k==='string'&&/^(due|status|priority):/.test(k)&&k.length<250))].reverse().filter(k=>(size+=JSON.stringify(k).replace(/[^\x00-\x7f]/g,'\\u0000').length+1)<=2000).reverse():[],
  };
}
export function taskPriority(row: OfficeRecord) {
  const raw=(row.meta.priority||'').trim();
  return ['high','normal','low'].includes(raw.toLowerCase())?raw[0].toUpperCase()+raw.slice(1).toLowerCase():raw||'Normal';
}
// Compare date-only task deadlines as calendar dates, avoiding UTC date shifts.
export function taskDue(row: OfficeRecord,now=new Date()) {
  const due=row.meta.due||'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due+'T00:00:00Z'))||new Date(due+'T00:00:00Z').toISOString().slice(0,10)!==due)return 'undated';
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return due<today?'overdue':due===today?'today':'upcoming';
}
export function taskView(rows: OfficeRecord[],value: unknown,now=new Date()) {
  const p=taskViewPreferences(value),collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const ranks: Record<string,number>={High:3,Normal:2,Low:1};
  const compare=(a: OfficeRecord,b: OfficeRecord)=>{
    let order=0;
    if(p.sort.startsWith('due')){
      const au=taskDue(a,now)==='undated',bu=taskDue(b,now)==='undated';
      if(au!==bu)return au?1:-1;
      order=au?0:a.meta.due!.localeCompare(b.meta.due!);
    }else if(p.sort.startsWith('priority'))order=(ranks[taskPriority(a)]??0)-(ranks[taskPriority(b)]??0)||collator.compare(taskPriority(a),taskPriority(b));
    else order=collator.compare(p.sort.startsWith('title')?a.title:a.updated,p.sort.startsWith('title')?b.title:b.updated);
    return order*(p.sort.endsWith('-desc')?-1:1)||collator.compare(a.title,b.title)||a.id.localeCompare(b.id);
  };
  const groups=new Map<string,{key:string;label:string;rows:OfficeRecord[];collapsed:boolean}>();
  const dueLabels={overdue:'Overdue',today:'Due today',upcoming:'Upcoming',undated:'No due date'};
  for(const row of rows){
    if(p.status!=='all'&&!!row.meta.done!==(p.status==='completed'))continue;
    if(p.priority!=='all'&&taskPriority(row)!==p.priority)continue;
    const due=taskDue(row,now);
    if(p.due!=='all'&&p.due!==due)continue;
    const label=p.group==='due'?dueLabels[due]:p.group==='status'?(row.meta.done?'Completed':'Unfinished'):p.group==='priority'?taskPriority(row):'';
    const key=p.group+':'+label;
    let group=groups.get(key);
    if(!group){group={key,label,rows:[],collapsed:p.collapsed.includes(key)||(p.collapsed.includes(p.group+':*')&&!p.collapsed.includes(p.group+':!'+key))};groups.set(key,group);}
    group.rows.push(row);
  }
  const ordered=[...groups.values()].sort((a,b)=>{
    if(p.group==='due'){
      const labels=Object.values(dueLabels),ai=labels.indexOf(a.label),bi=labels.indexOf(b.label);
      if(ai===3||bi===3)return ai-bi;
      return (ai-bi)*(p.sort==='due-desc'?-1:1);
    }
    if(p.group==='status')return a.label==='Unfinished'?-1:1;
    if(p.group==='priority')return ((ranks[b.label]??0)-(ranks[a.label]??0)||collator.compare(a.label,b.label))*(p.sort==='priority-asc'?-1:1);
    return 0;
  });
  for(const group of ordered)group.rows.sort(compare);
  return {groups:ordered,rows:ordered.flatMap(g=>g.rows),visible:ordered.flatMap(g=>g.collapsed?[]:g.rows)};
}
