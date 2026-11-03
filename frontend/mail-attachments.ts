import type {Attachment, OfficeRecord, RequestApi} from './types.js';
import {escapeHtml as e} from './formats.js';

interface AttachmentEnvironment {
  api: RequestApi; commit: () => Promise<void>;
  update: (record: OfficeRecord) => void;
  notice: (message: string,error?: boolean) => void;
  modal: (title: string,body: string) => void;
}
let pending: Promise<void> | null=null;
let lastError='';
export async function waitForAttachments(){const active=pending;await active;if(active && lastError)throw Error(lastError);}
export function attachmentSection(record: OfficeRecord) {
  const draft=record.meta.folder==='Drafts';
  if(!draft&&record.meta.hasAttachments===false&&!record.meta.attachments?.length)return '';
  const contents=`<div class="head-actions">${draft?'<strong>Attachments</strong><button type="button" data-attach>Add files</button><input class="file-input" type="file" multiple data-attach-input aria-label="Attach files">':'<button type="button" data-file-list>Check attachments</button>'}<button type="button" data-save-files hidden>Save all</button></div><div data-file-rows></div><p class="muted" data-file-status role="status">${draft?'Choose files or drop them into this message. Up to 10 MB per file, 20 MB total.':'Files download when you choose Preview, Download, or Save all.'}</p>`;
  return draft?`<section class="mail-attachments" aria-label="Attachments" data-mail-files>${contents}</section>`:`<details class="mail-files-disclosure" data-mail-disclosure="files" data-mail-files><summary>Attachments${record.meta.attachments?.length?' ('+record.meta.attachments.length+')':''}</summary><section class="mail-reader-popover mail-files-popover" aria-label="Attachments">${contents}</section></details>`;
}
const fileUrl=(id: string,part?: string)=>`mail-file.php?id=${encodeURIComponent(id)}${part===undefined?'&all=1':'&part='+encodeURIComponent(part)}`;
function saveUrl(url: string) {const link=document.createElement('a');link.href=url;link.download='';document.body.append(link);link.click();link.remove();}
const size=(bytes: number)=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':bytes>=1024?Math.ceil(bytes/1024)+' KB':bytes+' B';
function base64(file: File): Promise<string> {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Could not read '+file.name));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
export function bindAttachments(panel: HTMLElement,record: OfficeRecord,env: AttachmentEnvironment) {
  const section=panel.querySelector<HTMLElement>('[data-mail-files]');if(!section)return;
  const rows=section.querySelector<HTMLElement>('[data-file-rows]')!,status=section.querySelector<HTMLElement>('[data-file-status]')!;
  const saveAll=section.querySelector<HTMLButtonElement>('[data-save-files]')!;
  let files=record.meta.attachments||[],busy=false;
  const draft=record.meta.folder==='Drafts';
  const render=()=>{
    rows.innerHTML=files.map((a,i)=>`<div class="mail-attachment"><span class="mail-attachment-name" title="${e(a.name)}">${e(a.name)}</span><small>${e(a.type)} · ${size(a.size)}${a.encodedSize?' encoded':''} · ${a.available?'Available offline':'Download on demand'}</small><div>${!draft&&['application/pdf','image/png','image/jpeg','image/gif','image/webp'].includes(a.type)?`<button type="button" data-preview-file="${i}">Preview</button>`:''}<button type="button" data-download-file="${i}">Download</button>${draft?`<button type="button" data-remove-file="${i}" aria-label="Remove ${e(a.name)}">Remove</button>`:''}</div></div>`).join('');
    saveAll.hidden=!files.length;
  };
  const run=(message: string,operation:()=>Promise<void>)=>{
    if(busy||pending)return;
    busy=true;lastError='';status.textContent=message;section.setAttribute('aria-busy','true');
    section.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
    pending=(async()=>{try{await operation();}catch(error){const message=error instanceof Error?error.message:String(error);lastError=message;status.textContent=message+' You can retry.';env.notice(message,true);}finally{busy=false;pending=null;section.removeAttribute('aria-busy');section.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}})();
  };
  const request=async(action: string,extra: object={})=>{
    await env.commit();
    const response=await env.api('mail-files',{id:record.id,revision:record.revision,action,...extra});
    record.revision=response.record.revision;files=response.attachments;record.meta.attachments=files;record.meta.hasAttachments=response.record.meta.hasAttachments;
    const summary=section.querySelector('summary');if(summary)summary.textContent=files.length?'Attachments ('+files.length+')':'Attachments (none)';
    env.update(response.record);render();return response;
  };
  const prepare=async(part?: string)=>{await request('prepare',part===undefined?{}:{part});status.textContent='Available offline.';};
  const load=section.querySelector<HTMLButtonElement>('[data-file-list]');
  if(load)load.onclick=()=>run('Loading attachment list…',async()=>{await request('list');status.textContent=files.length?'Choose a file to preview or download.':'No file attachments.';});
  // Fetch only the manifest when opened. File bytes remain on demand.
  if(!draft)section.addEventListener('toggle',()=>{
    if((section as HTMLDetailsElement).open&&!files.length&&record.meta.hasAttachments!==false)load?.click();
  });
  saveAll.onclick=()=>run('Preparing all attachments…',async()=>{await prepare();saveUrl(fileUrl(record.id));});
  rows.onclick=event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;
    const index=Number(button.dataset.previewFile??button.dataset.downloadFile??button.dataset.removeFile);const file=files[index];if(!file)return;
    if(button.dataset.removeFile!==undefined)run('Removing attachment…',async()=>{await request('remove',{part:file.part});status.textContent='Attachment removed.';});
    else run('Downloading '+file.name+'…',async()=>{
      await prepare(file.part);
      if(button.dataset.previewFile!==undefined){
        const url=fileUrl(record.id,file.part)+'&preview=1';
        env.modal(file.name,`<iframe class="attachment-preview" ${file.type==='application/pdf'?'':'sandbox="allow-same-origin"'} referrerpolicy="no-referrer" title="${e(file.name)}" src="${e(url)}"></iframe><p><a href="${e(fileUrl(record.id,file.part))}" download>Download ${e(file.name)}</a></p>`);
      }else saveUrl(fileUrl(record.id,file.part));
    });
  };
  const input=section.querySelector<HTMLInputElement>('[data-attach-input]');
  const add=(selected: File[])=>{
    if(!selected.length)return;
    if(selected.some(f=>f.size>10*1048576)||files.reduce((n,a)=>n+a.size,0)+selected.reduce((n,f)=>n+f.size,0)>20*1048576){env.notice('Attachments support 10 MB per file and 20 MB per draft.',true);return;}
    run('Adding attachments…',async()=>{for(const file of selected){status.textContent='Adding '+file.name+'…';await request('upload',{name:file.name,type:file.type,data:await base64(file)});}status.textContent='Attachments saved.';if(input)input.value='';});
  };
  if(input){section.querySelector<HTMLButtonElement>('[data-attach]')!.onclick=()=>input.click();input.onchange=()=>add(Array.from(input.files||[]));
    const form=panel.querySelector<HTMLFormElement>('#record-form')!;
    form.ondragover=event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();form.classList.add('attachment-drop');}};
    form.ondragleave=()=>form.classList.remove('attachment-drop');
    form.ondrop=event=>{event.preventDefault();form.classList.remove('attachment-drop');add(Array.from(event.dataTransfer?.files||[]));};
  }
  render();
}
