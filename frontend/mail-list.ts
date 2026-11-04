import type {MailListField, MailListLayout, MailListSlot, OfficeRecord} from './types.js';
import {escapeHtml as e} from './formats.js';
import {messageTime} from './mail-sort.js';
import {timestampLabel} from './time-labels.js';

const fields: Record<MailListField,string>={none:'Hidden',sender:'Sender',date:'Sent date',subject:'Subject',attachment:'Attachment',preview:'Body preview'};
export function senderDomain(from: string): string | undefined {
  const address=from.match(/<([^<>]+)>/)?.[1]||from.trim();
  const domain=address.match(/^[^\s@<>]+@([a-z0-9.-]+)$/i)?.[1].toLowerCase();
  return domain && domain.length<=253 && domain.includes('.') && domain.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ? domain : undefined;
}
export function renderMailListIcon(record: OfficeRecord,selected: boolean,fallback: string): string {
  const domain=senderDomain(record.meta.from||'');
  const count=record.connectionCount||0;
  return `<span class="item-icon mail-list-icons"><span class="mail-sender-icon" aria-hidden="true">${selected?'✓':`${fallback}${domain?`<img class="mail-sender-favicon" src="sender-favicon.php?domain=${encodeURIComponent(domain)}" alt="" width="20" height="20" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}`}</span><span class="mail-list-connections" ${count?'':'hidden'} title="${count} ${count===1?'connection':'connections'}" aria-label="${count} ${count===1?'connection':'connections'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></svg><span>${count}</span></span></span>`;
}
export function bindMailFavicons(container: HTMLElement) {
  container.querySelectorAll<HTMLImageElement>('.mail-sender-favicon').forEach(img=>{
    const update=()=>{if(img.naturalWidth)img.classList.add('loaded');else img.remove();};
    img.onload=update;img.onerror=()=>img.remove();if(img.complete)update();
  });
}
export const defaultMailList=(): MailListLayout=>({sender:'both',rows:[
  {left:{field:'sender',size:'normal'},right:{field:'date',size:'small'}},
  {left:{field:'subject',size:'small'},right:{field:'attachment',size:'small'}},
  {left:{field:'preview',size:'small'},right:{field:'none',size:'small'}},
]});
export function mailListLayout(value: unknown): MailListLayout {
  const fallback=defaultMailList(), input=value as Partial<MailListLayout> | null;
  if(!input||!Array.isArray(input.rows)||input.rows.length!==3)return fallback;
  const slot=(value: MailListSlot,base: MailListSlot): MailListSlot=>({field:value&&Object.hasOwn(fields,value.field)?value.field:base.field,size:value&&['small','normal','large'].includes(value.size)?value.size:base.size});
  return {sender:['both','name','email'].includes(input.sender||'')?input.sender!:fallback.sender,rows:fallback.rows.map((row,i)=>({left:slot(input.rows![i]?.left,row.left),right:slot(input.rows![i]?.right,row.right)}))};
}
export function renderMailListCopy(record: OfficeRecord,value: unknown,failure=''): string {
  const layout=mailListLayout(value), raw=record.meta.from||record.meta.to||'Unknown sender';
  const match=raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/), name=match?.[1].replace(/^"|"$/g,'')||match?.[2]||raw, email=match?.[2]||raw;
  const sender=layout.sender==='name'?name:layout.sender==='email'?email:match?`${name} <${email}>`:raw;
  const time=messageTime(record),parsed=new Date(time);
  const preview=record.meta.headerOnly?'Preview unavailable — message body not downloaded':record.body.split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'No preview available';
  const cell=(slot: MailListSlot,side: string)=>{
    if(slot.field==='none')return '';
    const text=slot.field==='sender'?sender:slot.field==='subject'?record.title:slot.field==='preview'?preview:slot.field==='date'?(Number.isFinite(time)?parsed.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Date unavailable'):record.meta.hasAttachments===true?'Has attachments':record.meta.hasAttachments===false?'':'Attachment status unknown';
    const attachment=slot.field==='attachment';
    return `<span class="mail-list-cell mail-list-${side} mail-list-${slot.size} mail-field-${slot.field}" title="${e(text)}"${attachment&&text?` role="img" aria-label="${e(text)}"`:''}>${attachment?(text?(record.meta.hasAttachments===true?'&#128206;':'?'):''):slot.field==='date'&&Number.isFinite(time)?timestampLabel(parsed.toISOString(),text):e(text)}</span>`;
  };
  return `<span class="item-copy mail-list-copy">${layout.rows.map(row=>row.left.field==='none'&&row.right.field==='none'?'':`<span class="mail-list-line">${cell(row.left,'left')}${cell(row.right,'right')}</span>`).join('')}${failure?`<small class="mail-action-failure" title="${e(failure)}">Mail action failed — restored</small>`:''}</span>`;
}
export function bindMailListSettings(container: HTMLElement,value: unknown,onSave: (layout: MailListLayout)=>Promise<void>) {
  let layout=mailListLayout(value);
  const sample={title:'Your next project update',body:'Here is the first line of your email. More text fits as the list grows wider.',meta:{from:'Alex Morgan <alex@example.com>',date:'2026-11-01T14:00:00Z',hasAttachments:true}} as OfficeRecord;
  const draw=()=>{
    const options=(values: Record<string,string>,selected: string)=>Object.entries(values).map(([key,label])=>`<option value="${key}" ${key===selected?'selected':''}>${label}</option>`).join('');
    container.innerHTML=`<h2>List appearance</h2><p>Choose the fields and text size for each side of three lines. Hidden fields take no space. Text that does not fit ends with an ellipsis.</p><form id="mail-list-preferences"><label>Sender format<select data-sender aria-label="Sender format">${options({both:'Name and email',name:'Name only',email:'Email only'},layout.sender)}</select></label>${layout.rows.map((row,i)=>`<fieldset><legend>Line ${i+1}</legend><div class="mail-layout-controls">${(['left','right'] as const).map(side=>`<label>${side==='left'?'Left':'Right'} field<select data-row="${i}" data-side="${side}" data-property="field" aria-label="Line ${i+1} ${side} field">${options(fields,row[side].field)}</select></label><label>${side==='left'?'Left':'Right'} text size<select data-row="${i}" data-side="${side}" data-property="size" aria-label="Line ${i+1} ${side} text size">${options({small:'Small',normal:'Normal',large:'Large'},row[side].size)}</select></label>`).join('')}</div></fieldset>`).join('')}<div><p>Live preview</p><div class="item mail-unread mail-layout-preview" aria-label="Mail list preview"></div></div><div class="actions"><button class="primary">Save list appearance</button><button type="button" data-reset>Reset to default</button></div></form>`;
    const preview=()=>{container.querySelector('.mail-layout-preview')!.innerHTML=renderMailListCopy(sample,layout);};preview();
    container.querySelectorAll<HTMLSelectElement>('select').forEach(select=>select.onchange=()=>{
      if(select.hasAttribute('data-sender'))layout.sender=select.value as MailListLayout['sender'];
      else {const row=layout.rows[Number(select.dataset.row)], side=select.dataset.side as 'left'|'right';row[side]={...row[side],[select.dataset.property!]:select.value};}
      preview();
    });
    container.querySelector<HTMLButtonElement>('[data-reset]')!.onclick=()=>{layout=defaultMailList();draw();};
    container.querySelector('form')!.onsubmit=async event=>{event.preventDefault();const button=container.querySelector<HTMLButtonElement>('button.primary')!;button.disabled=true;try{await onSave(mailListLayout(layout));}finally{button.disabled=false;}};
  };draw();
}
