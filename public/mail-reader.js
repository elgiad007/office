import {escapeHtml as e} from './formats.js';

const modes=new Map(), imageConsent=new Set();
export function mailBody(record,prefs) {
  const hasHtml=record.meta.hasHtml===true;
  const mode=hasHtml ? modes.get(record.id)||(prefs.mailDisplay==='text'?'text':'html') : 'text';
  return `<div class="mail-view-controls" role="group" aria-label="Email display"><button data-mail-mode="html" aria-pressed="${mode==='html'}" ${hasHtml?'':'disabled'}>HTML</button><button data-mail-mode="text" aria-pressed="${mode==='text'}">Text only</button>${hasHtml&&mode==='html'?`<button data-mail-images ${imageConsent.has(record.id)?'disabled':''}>${imageConsent.has(record.id)?'External images enabled':'Load images'}</button><small>External images may report that you opened this email.</small>`:hasHtml?'':'<small>This email contains only text.</small>'}</div>${mode==='html'?`<iframe class="mail-html" title="HTML email" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="mail-view.php?id=${encodeURIComponent(record.id)}${imageConsent.has(record.id)?'&images=1':''}"></iframe>`:`<div class="mail-body">${e(record.body)}</div>`}`;
}
export function bindMailReader(panel,record,render) {
  panel.querySelectorAll('[data-mail-mode]').forEach(button=>button.onclick=()=>{modes.set(record.id,button.dataset.mailMode);render();});
  const images=panel.querySelector('[data-mail-images]');
  if(images) images.onclick=()=>{imageConsent.add(record.id);render();};
}
