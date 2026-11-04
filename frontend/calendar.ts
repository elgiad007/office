import {escapeHtml as e} from './formats.js';
import type {Account,OfficeRecord} from './types.js';

export type CalendarView='month'|'week'|'day'|'agenda';
export const dateOnly=(value='')=>/^\d{4}-\d{2}-\d{2}$/.test(value);
export function calendarDate(value: string) {return dateOnly(value)?new Date(value+'T00:00:00'):new Date(value);}
export function dayKey(date: Date) {return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function addDays(date: Date,count: number) {const next=new Date(date);next.setDate(next.getDate()+count);return next;}
export function eventBounds(record: OfficeRecord) {
  const start=calendarDate(record.meta.start||'');let end=calendarDate(record.meta.end||'');
  if(!Number.isFinite(+start))return null;
  if(!Number.isFinite(+end)||end<=start)end=dateOnly(record.meta.start)?addDays(start,1):new Date(+start+3600000);
  return {start,end,allDay:dateOnly(record.meta.start)};
}
export function eventsOn(rows: OfficeRecord[],day: Date) {const end=addDays(day,1);return rows.filter(r=>{const b=eventBounds(r);return b&&b.start<end&&b.end>day;}).sort((a,b)=>+(eventBounds(b)!.allDay)-+(eventBounds(a)!.allDay)||+eventBounds(a)!.start-+eventBounds(b)!.start);}
/** Assign overlapping intervals stable columns; touching endpoints can share a column. */
export function timedLayout(rows: OfficeRecord[],day: Date) {
  const entries=eventsOn(rows,day).filter(r=>!eventBounds(r)!.allDay).map(record=>{const b=eventBounds(record)!;const start=b.start<day?0:b.start.getHours()*60+b.start.getMinutes();const end=b.end>=addDays(day,1)?1440:b.end.getHours()*60+b.end.getMinutes();return {record,start,end:Math.max(start+15,end),column:0,columns:1};});
  let group:typeof entries=[],ends:number[]=[];
  const finish=()=>{for(const entry of group)entry.columns=ends.length;group=[];ends=[];};
  for(const entry of entries){if(group.length&&entry.start>=Math.max(...ends))finish();let column=ends.findIndex(end=>end<=entry.start);if(column<0)column=ends.length;entry.column=column;ends[column]=entry.end;group.push(entry);}finish();return entries;
}
const colors=['#3a8c72','#5579c6','#b56c96','#bb8436','#7d70b4','#43959e'];
export function calendarSources(rows: OfficeRecord[],accounts: Account[]) {const ids=Array.from(new Set(['local',...accounts.filter(a=>a.type==='google'||a.type==='caldav').map(a=>a.id),...rows.map(r=>r.meta.account||'local')]));return ids.map((id,index)=>({id,label:id==='local'?'Local calendar':accounts.find(a=>a.id===id)?.label||id,color:colors[index%colors.length]}));}
interface Environment {query:()=>string;allRows:()=>OfficeRecord[];rows:()=>OfficeRecord[];accounts:()=>Account[];current:()=>string|undefined;open:(id:string)=>Promise<void>;create:(start:string,end:string)=>Promise<void>;before:()=>Promise<void>;error:(action:()=>Promise<void>)=>void}
export function createCalendar(env:Environment) {
  let anchor=calendarDate(dayKey(new Date())),view:CalendarView='month';const hidden=new Set<string>();
  function render() {
    const host=document.querySelector<HTMLElement>('#calendar-surface');if(!host)return;
    const focused=document.activeElement as HTMLElement;const focusAttribute=focused&&host.contains(focused)?Array.from(focused.attributes).find(a=>['data-period','data-view','data-source','data-jump'].includes(a.name)):undefined;
    let selectedRendered=false;
    if(env.query())view='agenda';
    const sources=calendarSources(env.allRows(),env.accounts()),rows=env.rows().filter(r=>!hidden.has(r.meta.account||'local'));
    const first=new Date(anchor.getFullYear(),anchor.getMonth(),1),monthStart=addDays(first,-first.getDay());
    const start=view==='month'?monthStart:view==='week'?addDays(anchor,-anchor.getDay()):anchor;
    const days=Array.from({length:view==='month'?42:view==='week'?7:1},(_,i)=>addDays(start,i));
    const color=(r:OfficeRecord)=>sources.find(s=>s.id===(r.meta.account||'local'))?.color||colors[0];
    const event=(r:OfficeRecord,style='')=>{const selected=env.current()===r.id,id=selected&&!selectedRendered?'id="selected-item"':'';if(selected)selectedRendered=true;return `<button class="calendar-event item ${selected?'selected':''}" data-id="${e(r.id)}" ${id} data-calendar-style="--event-color:${color(r)};${style}" title="${e(r.title)}" aria-pressed="${selected}">${dateOnly(r.meta.start)||!eventBounds(r)?'':`<time>${e(calendarDate(r.meta.start||'').toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</time> `}${e(r.title)}</button>`;};
    const dayButton=(d:Date)=>`<button class="calendar-date ${dayKey(d)===dayKey(new Date())?'today':''}" data-day="${dayKey(d)}" aria-label="New event on ${e(d.toLocaleDateString())}">${d.getDate()}</button>`;
    const title=env.query()?'Search results':view==='day'?anchor.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}):view==='week'?`${start.toLocaleDateString()} – ${days[6].toLocaleDateString()}`:anchor.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    const mini=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d[0]}</span>`).join('')+Array.from({length:42},(_,i)=>{const d=addDays(monthStart,i);return `<button data-jump="${dayKey(d)}" class="${d.getMonth()!==anchor.getMonth()?'muted':''} ${dayKey(d)===dayKey(anchor)?'primary':''}" aria-label="${e(d.toLocaleDateString())}">${d.getDate()}</button>`;}).join('');
    let content='';
    if(view==='month')content=`<div class="calendar-month">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${days.map(d=>{const list=eventsOn(rows,d);return `<section class="calendar-day ${d.getMonth()!==anchor.getMonth()?'outside':''}">${dayButton(d)}${list.slice(0,3).map(r=>event(r)).join('')}${list.length>3?`<button class="calendar-more" data-jump="${dayKey(d)}">+${list.length-3} more</button>`:''}</section>`;}).join('')}</div>`;
    else if(view==='agenda')content=`<div class="calendar-agenda">${rows.filter(r=>{const b=eventBounds(r);return !!env.query()||!b||(b.start<new Date(anchor.getFullYear(),anchor.getMonth()+1,1)&&b.end>first);}).map(r=>`<div><span>${r.meta.start?e(calendarDate(r.meta.start).toLocaleDateString()):'No date'}</span>${event(r)}</div>`).join('')||'<p>No matching cached events.</p>'}</div>`;
    else content=`<div class="calendar-time-scroll"><div class="calendar-time-grid" data-calendar-style="--day-count:${days.length}"><div class="calendar-time-label">All day</div>${days.map(d=>`<section class="calendar-all-day"><strong>${e(d.toLocaleDateString(undefined,{weekday:'short'}))}</strong>${dayButton(d)}${eventsOn(rows,d).filter(r=>dateOnly(r.meta.start)).map(r=>event(r)).join('')}</section>`).join('')}<div class="calendar-hours">${Array.from({length:24},(_,h)=>`<span>${String(h).padStart(2,'0')}:00</span>`).join('')}</div>${days.map(d=>`<div class="calendar-time-day">${Array.from({length:24},(_,h)=>`<button class="calendar-slot" data-slot="${dayKey(d)}T${String(h).padStart(2,'0')}:00" aria-label="New event ${dayKey(d)} ${h}:00"></button>`).join('')}${timedLayout(rows,d).map(x=>event(x.record,`position:absolute;top:${x.start/60*48}px;height:${Math.max(20,(x.end-x.start)/60*48)}px;left:${x.column/x.columns*100}%;width:${100/x.columns}%`)).join('')}</div>`).join('')}</div></div>`;
    const undated=rows.filter(r=>!eventBounds(r));
    host.innerHTML=`<div class="calendar-toolbar"><div><button data-period="today">Today</button><button data-period="prev" ${env.query()?'disabled':''} aria-label="Previous period">‹</button><button data-period="next" ${env.query()?'disabled':''} aria-label="Next period">›</button></div><h2 aria-live="polite">${e(title)}</h2><div role="group" aria-label="Calendar view">${(['month','week','day','agenda'] as CalendarView[]).map(v=>`<button data-view="${v}" aria-pressed="${view===v}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')}</div></div><div class="calendar-layout"><aside class="calendar-sidebar"><strong>${e(first.toLocaleDateString(undefined,{month:'long',year:'numeric'}))}</strong><div class="calendar-mini">${mini}</div><h3>Calendars</h3>${sources.map(s=>`<label><input type="checkbox" data-source="${e(s.id)}" ${hidden.has(s.id)?'':'checked'} data-calendar-style="accent-color:${s.color}"><span data-calendar-style="color:${s.color}">●</span> ${e(s.label)}</label>`).join('')}<p class="muted">Cached events only. Connected calendars are read only.</p></aside><div id="items" class="calendar-board list-pane" role="region" aria-label="Calendar events">${content}${view!=='agenda'&&undated.length?`<section class="calendar-undated"><h3>Unscheduled</h3>${undated.map(r=>event(r)).join('')}</section>`:''}</div></div>`;
    host.querySelectorAll<HTMLElement>('[data-calendar-style]').forEach(node=>{node.style.cssText=node.dataset.calendarStyle!;node.removeAttribute('data-calendar-style');});
    host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>env.error(async()=>{await env.before();view=b.dataset.view as CalendarView;render();}));
    host.querySelectorAll<HTMLButtonElement>('[data-period]').forEach(b=>b.onclick=()=>env.error(async()=>{await env.before();if(b.dataset.period==='today')anchor=calendarDate(dayKey(new Date()));else {const n=b.dataset.period==='prev'?-1:1;if(view==='month'||view==='agenda')anchor=new Date(anchor.getFullYear(),anchor.getMonth()+n,1);else anchor=addDays(anchor,n*(view==='week'?7:1));}render();}));
    host.querySelectorAll<HTMLInputElement>('[data-source]').forEach(b=>b.onchange=()=>{if(b.checked)hidden.delete(b.dataset.source!);else hidden.add(b.dataset.source!);render();});
    host.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach(b=>b.onclick=()=>env.error(async()=>{await env.before();anchor=calendarDate(b.dataset.jump!);view='day';render();}));
    host.querySelectorAll<HTMLButtonElement>('[data-day],[data-slot]').forEach(b=>b.onclick=()=>{const start=b.dataset.slot||b.dataset.day!;env.error(()=>env.create(start,dateOnly(start)?dayKey(addDays(calendarDate(start),1)):new Date(+calendarDate(start)+3600000).toISOString()));});
    if(focusAttribute)host.querySelector<HTMLElement>(`[${focusAttribute.name}="${CSS.escape(focusAttribute.value)}"]`)?.focus({preventScroll:true});
  }
  function ensureVisible(id:string,reveal=false) {if(reveal){const item=env.allRows().find(r=>r.id===id);if(item)hidden.delete(item.meta.account||'local');}const row=env.rows().find(r=>r.id===id);if(!row)return;if(!isVisible(row))return;if(!document.querySelector(`#items [data-id="${CSS.escape(id)}"]`)){const bounds=eventBounds(row);if(bounds){anchor=calendarDate(dayKey(bounds.start));view='day';}else view='agenda';render();}}
  function isVisible(record:OfficeRecord){return !hidden.has(record.meta.account||'local');}
  return {render,ensureVisible,isVisible};
}
