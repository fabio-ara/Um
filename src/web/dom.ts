import {renderUiIcon} from './icons.js';
export const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function iconButton(name:string,label:string,action:string,extra=''){return `<button type="button" class="icon-button" aria-label="${escapeHtml(label)}" data-action="${escapeHtml(action)}" ${extra}>${renderUiIcon(name)}</button>`;}
// Formatação inline conservadora; HTML do material nunca é executado.
function renderInline(text:string):string {
 const token=/(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
 let html='', at=0;
 for(const match of text.matchAll(token)){
  const start=match.index!,value=match[0];
  html+=escapeHtml(text.slice(at,start));
  const code=value.startsWith('\x60'),strong=value.startsWith('**')||value.startsWith('__');
  const marker=strong?2:1,tag=code?'code':strong?'strong':'em';
  html+='<'+tag+'>'+escapeHtml(value.slice(marker,-marker))+'</'+tag+'>';
  at=start+value.length;
 }
 return html+escapeHtml(text.slice(at));
}
export function renderBody(text:string){
 return text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(p=>'<p dir="auto">'+renderInline(p).replaceAll('\n','<br>')+'</p>').join('');
}
export function announce(text:string){const live=document.getElementById('live');if(live)live.textContent=text;}
export type StudyApi=(task:string,args:Record<string,unknown>)=>Promise<any>;
