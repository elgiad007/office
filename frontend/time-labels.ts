import {escapeHtml as e} from './formats.js';

let enabled=true;
// Date-only values represent local calendar days, not midnight UTC.
export function timestampTime(value: string): number {
  return +new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00':value);
}
export function elapsedTime(value: string,now=Date.now()): string {
  const time=timestampTime(value);
  if(!Number.isFinite(time)||!Number.isFinite(now))return '';
  const seconds=Math.floor(Math.abs(now-time)/1000);
  if(seconds<60)return 'now';
  const [size,unit]=seconds<3600?[60,'minute']:seconds<86400?[3600,'hour']:[86400,'day'];
  const count=Math.floor(seconds/Number(size)),text=`${count} ${unit}${count===1?'':'s'}`;
  return time>now&&seconds>0?`in ${text}`:`${text} ago`;
}
export function timestampText(value: string,label: string,now=Date.now()): string {
  const elapsed=enabled?elapsedTime(value,now):'';
  return label+(elapsed?` (${elapsed})`:'');
}
export function timestampLabel(value: string,label: string): string {
  if(!Number.isFinite(timestampTime(value)))return e(label);
  const elapsed=elapsedTime(value);
  return `${e(label)}<span data-elapsed-time="${e(value)}"${enabled?'':' hidden'}>${elapsed?` (${e(elapsed)})`:''}</span>`;
}
export function refreshTimeLabels(root: ParentNode=document,now=Date.now()): void {
  root.querySelectorAll<HTMLElement>('[data-elapsed-time]').forEach(node=>{
    node.hidden=!enabled;
    const elapsed=elapsedTime(node.dataset.elapsedTime||'',now),text=elapsed?` (${elapsed})`:'';
    if(node.textContent!==text)node.textContent=text;
  });
}
export function configureTimeLabels(value: boolean): void {enabled=value;refreshTimeLabels();}
