import {renderUiIcon} from './icons.js';
export const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function iconButton(name:string,label:string,action:string,extra=''){return `<button type="button" class="icon-button" aria-label="${escapeHtml(label)}" data-action="${escapeHtml(action)}" ${extra}>${renderUiIcon(name)}</button>`;}
export function renderBody(text:string){return text.split(/\n\s*\n/).map(p=>`<p dir="auto">${escapeHtml(p).replaceAll('\n','<br>')}</p>`).join('');}
export function announce(text:string){const live=document.getElementById('live');if(live)live.textContent=text;}
export type StudyApi=(task:string,args:Record<string,unknown>)=>Promise<any>;
