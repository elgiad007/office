import {escapeHtml as e} from './formats.js';
import {mobileActionLabel} from './mobile-layout.js';
import type {ChecklistItem,Confirmation,OfficeRecord} from './types.js';

export function checklistProgress(items: ChecklistItem[]) {
  return `${items.filter(item=>item.done).length} of ${items.length} checked`;
}

function checklistRow(item: ChecklistItem,first: boolean) {
  const text=e(item.text);
  return `<li data-checklist-row="${e(item.id)}">
    <label class="checklist-label"><input type="checkbox" ${item.done?'checked':''} tabindex="${first?0:-1}"><span>${text}</span></label>
    <button type="button" class="quiet mobile-icon-button" data-checklist-edit aria-label="Edit ${text}">${mobileActionLabel('edit','Edit')}</button>
    <button type="button" class="quiet danger mobile-icon-button" data-checklist-delete aria-label="Remove ${text}">${mobileActionLabel('close','Remove')}</button>
  </li>`;
}

export function checklistContent(record: OfficeRecord) {
  const items=record.meta.checklist??[];
  return `<form id="record-form" class="detail-form checklist-title">
    <label><span class="file-input">List name</span><input class="title-input" name="title" value="${e(record.title)}" required aria-label="List name"></label>
    <button type="button" class="quiet mobile-icon-button" data-checklist-rename aria-label="Rename list">${mobileActionLabel('edit','Rename')}</button>
  </form>
  <section class="checklist" aria-label="Checklist">
    <form class="checklist-add"><input type="text" aria-label="New checklist item" placeholder="Add an item…" autocomplete="off"><button type="submit" class="mobile-icon-button" aria-label="Add item">${mobileActionLabel('add','Add item')}</button></form>
    <p class="muted" data-checklist-progress role="status">${checklistProgress(items)}</p>
    <ul class="checklist-rows" aria-label="Checklist items">${items.map((item,index)=>checklistRow(item,index===0)).join('')}</ul>
  </section>`;
}

export function checklistEntry(panel: HTMLElement) {
  return panel.querySelector<HTMLInputElement>('[data-checklist-row] input[tabindex="0"]');
}

export function moveChecklistFocus(row: HTMLElement, direction: 'up'|'down'|'first'|'last') {
  const parent=row.parentElement!;
  const next=direction==='first'?parent.firstElementChild:direction==='last'?parent.lastElementChild:
    direction==='up'?row.previousElementSibling:row.nextElementSibling;
  next?.querySelector<HTMLInputElement>('input')?.focus();
}

export function bindChecklist(panel: HTMLElement,record: OfficeRecord,env: {
  changed: () => void; normal: () => void; rename: () => void;
  modal: (title: string,body: string) => void; dialog: HTMLDialogElement; confirmation: Confirmation;
}) {
  const form=panel.querySelector<HTMLFormElement>('.checklist-add')!;
  const entry=form.querySelector('input')!;
  const rows=panel.querySelector<HTMLElement>('.checklist-rows')!;
  const progress=panel.querySelector<HTMLElement>('[data-checklist-progress]')!;
  const items=record.meta.checklist??[];
  const changed=()=>{
    record.meta={...record.meta,checklist:items};
    progress.textContent=checklistProgress(items);
    env.changed();
  };

  panel.querySelector<HTMLButtonElement>('[data-checklist-rename]')!.onclick=env.rename;
  function append(text: string) {
    const lines=text.split(/\r\n?|\n/).map(line=>line.trim()).filter(Boolean);
    if(!lines.length)return;
    const added=lines.map(text=>({id:crypto.randomUUID(),text,done:false}));
    rows.insertAdjacentHTML('beforeend',added.map((item,index)=>checklistRow(item,!items.length&&index===0)).join(''));
    items.push(...added);
    changed();
  }
  form.onsubmit=event=>{
    event.preventDefault();append(entry.value);entry.value='';entry.focus();
  };
  entry.onpaste=event=>{
    const text=event.clipboardData?.getData('text/plain');
    if(!text||!/[\r\n]/.test(text))return;
    event.preventDefault();
    append(entry.value.slice(0,entry.selectionStart??0)+text+entry.value.slice(entry.selectionEnd??0));
    entry.value='';
  };
  rows.addEventListener('focusin',event=>{
    const checkbox=(event.target as HTMLElement).closest('li')?.querySelector('input');
    if(!checkbox)return;
    const previous=checklistEntry(panel);
    if(previous)previous.tabIndex=-1;
    checkbox.tabIndex=0;
    env.normal();
  });
  rows.onchange=event=>{
    const checkbox=event.target as HTMLInputElement;
    const item=items.find(item=>item.id===checkbox.closest('li')?.dataset.checklistRow);
    if(item){item.done=checkbox.checked;changed();}
  };
  rows.onclick=event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-checklist-edit],[data-checklist-delete]');
    if(!button)return;
    const row=button.closest('li')!;
    const item=items.find(item=>item.id===row.dataset.checklistRow)!;
    const checkbox=row.querySelector('input')!;
    if(button.hasAttribute('data-checklist-edit')){
      env.modal('Edit checklist item',`<form class="checklist-edit"><label>Item text<input name="text" required value="${e(item.text)}"></label><div class="dialog-actions"><button class="primary" type="submit">Apply</button></div></form>`);
      const editor=env.dialog.querySelector<HTMLFormElement>('form')!;
      const text=editor.querySelector('input')!;
      editor.onsubmit=event=>{
        event.preventDefault();
        const value=text.value.trim();
        if(!value){text.setCustomValidity('Enter item text.');text.reportValidity();return;}
        if(value!==item.text){
          item.text=value;
          row.querySelector('label span')!.textContent=value;
          button.setAttribute('aria-label','Edit '+value);
          row.querySelector('[data-checklist-delete]')!.setAttribute('aria-label','Remove '+value);
          changed();
        }
        env.dialog.close();checkbox.focus();
      };
      text.oninput=()=>text.setCustomValidity('');
      text.focus();text.select();
    }else{
      env.confirmation('Remove checklist item',`Remove “${item.text}” from this list?`,()=>{
        const next=(row.nextElementSibling||row.previousElementSibling)?.querySelector<HTMLInputElement>('input');
        items.splice(items.indexOf(item),1);
        row.remove();changed();
        (next??entry).focus();
      },'Remove item');
    }
  };
}
