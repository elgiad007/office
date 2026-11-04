import type {MailViewPreferences, OfficeRecord} from './types.js';
import {compareMail,messageTime} from './mail-sort.js';

const sorts=['date-desc','date-asc','sender-asc','sender-desc','subject-asc','subject-desc'];
export function mailViewPreferences(value: unknown): MailViewPreferences {
  const input=value as Partial<MailViewPreferences> | null;
  // Keep enough room in the shared preferences document for appearance and key bindings.
  let size=0;
  const collapsed=Array.isArray(input?.collapsed)?[...new Set(input.collapsed.filter((key): key is string=>typeof key==='string'&&/^(date|sender):/.test(key)&&key.length<=500))].reverse().filter(key=>(size+=JSON.stringify(key).replace(/[^\x00-\x7f]/g,'\\u0000').length+1)<=4000).reverse():[];
  return {group:input&&['date','sender','none'].includes(input.group||'')?input.group!:'date',sort:input&&sorts.includes(input.sort||'')?input.sort!:'date-desc',collapsed};
}
export function mailSender(record: OfficeRecord) {
  const raw=(record.meta.from||'').trim(),match=raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const address=(match?.[2]||raw.match(/^[^\s<>@]+@[^\s<>@]+$/)?.[0]||'').trim().toLocaleLowerCase();
  const name=(match?.[1]||(!address?raw:'')).trim().replace(/^"|"$/g,'').trim();
  return {key:address?'email:'+address:name?'name:'+name.toLocaleLowerCase():'unknown',label:address?(name?`${name} <${address}>`:address):name||'Unknown sender'};
}
export function localWeekStart(locale=globalThis.navigator?.language) {
  // Older browsers do not expose week info. Sunday is the fallback.
  try {const info=new Intl.Locale(locale||'en-US') as Intl.Locale & {getWeekInfo?: ()=>{firstDay: number};weekInfo?: {firstDay: number}};return (info.getWeekInfo?.()||info.weekInfo)?.firstDay!%7||0;}catch{return 0;}
}
const dateLabels=['Future','Today','Yesterday','This Week','Last Week','This Month','Last Month','Older','Undated'];
export function mailDateGroup(record: OfficeRecord,now=new Date(),weekStart=localWeekStart()) {
  const time=messageTime(record);
  if(!Number.isFinite(time))return 'Undated';
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const tomorrow=new Date(today);tomorrow.setDate(today.getDate()+1);
  const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
  const week=new Date(today);week.setDate(today.getDate()-(today.getDay()-weekStart+7)%7);
  const lastWeek=new Date(week);lastWeek.setDate(week.getDate()-7);
  const month=new Date(now.getFullYear(),now.getMonth(),1),lastMonth=new Date(now.getFullYear(),now.getMonth()-1,1);
  return time>=+tomorrow?'Future':time>=+today?'Today':time>=+yesterday?'Yesterday':time>=+week?'This Week':time>=+lastWeek?'Last Week':time>=+month?'This Month':time>=+lastMonth?'Last Month':'Older';
}
export interface MailViewGroup {key: string; label: string; rows: OfficeRecord[]; collapsed: boolean}
export function mailView(rows: OfficeRecord[],value: unknown,now=new Date(),weekStart=localWeekStart()) {
  const prefs=mailViewPreferences(value),direction=prefs.sort.endsWith('-asc')?1:-1,collator=new Intl.Collator(undefined,{sensitivity:'base',numeric:true});
  const compare=(a: OfficeRecord,b: OfficeRecord)=>{
    if(prefs.sort.startsWith('date')){
      const at=messageTime(a),bt=messageTime(b);
      // Undated mail stays at the end in both directions.
      if(!Number.isFinite(at)||!Number.isFinite(bt))return !Number.isFinite(at)&&!Number.isFinite(bt)?compareMail(a,b):!Number.isFinite(at)?1:-1;
      return at===bt?compareMail(a,b):(at<bt?-1:1)*direction;
    }
    const text=(r: OfficeRecord)=>prefs.sort.startsWith('sender')?mailSender(r).label:r.title;
    return collator.compare(text(a),text(b))*direction||compareMail(a,b);
  };
  const groups=new Map<string,MailViewGroup>();
  for(const row of rows){
    const label=prefs.group==='date'?mailDateGroup(row,now,weekStart):prefs.group==='sender'?mailSender(row).label:'';
    const key=prefs.group==='date'?'date:'+label:prefs.group==='sender'?'sender:'+mailSender(row).key:'none';
    let group=groups.get(key);
    if(!group){group={key,label,rows:[],collapsed:prefs.collapsed.includes(key)||(prefs.collapsed.includes(prefs.group+':*')&&!prefs.collapsed.includes(prefs.group+':!'+key))};groups.set(key,group);}
    // Display-name changes for one address must not create multiple groups or depend on input order.
    if(prefs.group==='sender'&&collator.compare(label,group.label)<0)group.label=label;
    group.rows.push(row);
  }
  const ordered=[...groups.values()].sort((a,b)=>{
    if(prefs.group==='date'){
      if(a.label==='Undated'||b.label==='Undated')return a.label==='Undated'?1:-1;
      return (dateLabels.indexOf(a.label)-dateLabels.indexOf(b.label))*(prefs.sort==='date-asc'?-1:1);
    }
    return collator.compare(a.label,b.label)*(prefs.sort==='sender-desc'?-1:1)||a.key.localeCompare(b.key);
  });
  for(const group of ordered)group.rows.sort(compare);
  return {groups:ordered,rows:ordered.flatMap(group=>group.rows),visible:ordered.flatMap(group=>group.collapsed?[]:group.rows)};
}
