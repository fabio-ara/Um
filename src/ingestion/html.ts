// Reutilizado de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
import {parseHTML} from 'linkedom';
import type {Block} from './contracts.ts';

export const prose=(s:string)=>s.replace(/[\s\u00a0]+/gu,' ').trim();
const label=(e:any)=>`${e.id||''} ${e.getAttribute?.('class')||''} ${e.getAttribute?.('role')||''}`;
const chrome=/(?:^|[\s_-])(nav(?:igation)?|menu|sidebar|breadcrumb|advert(?:isement)?|social|share|cookie|toolbar|tools|related|toc)(?:$|[\s_-])/i;
const density=(e:any)=>{const n=prose(e.textContent||'').length;return n?Array.from(e.querySelectorAll('a')).reduce((v:number,a:any)=>v+prose(a.textContent||'').length,0)/n:1;};

/** Semantic candidates are scored after removal of controls. No page-specific selectors. */
export function extractHtml(html:string){
 const {document}=parseHTML(html),blocks:Block[]=[],warnings:string[]=[];let removed=0;
 document.querySelectorAll('br').forEach(e=>e.replaceWith('\n'));
 const drop=(e:any)=>{e.remove();removed++;};
 document.querySelectorAll('script,style,noscript,template,iframe,object,embed,nav,form,button,input,select,textarea,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"]').forEach(drop);
 document.querySelectorAll('header,footer,aside,div,section,ul').forEach(e=>{if(!e.parentNode)return;const l=label(e);if(chrome.test(l)&&!(e.querySelector('p')&&density(e)<.2))drop(e);});
 const body=document.body?.textContent?.trim()?document.body:document.documentElement;
 const candidates=[body,...document.querySelectorAll('article,main,[role="main"],section,div')].filter(Boolean);
 const score=(e:any)=>{
  const paragraphs=Array.from(e.querySelectorAll('p,blockquote,pre,table')).filter((p:any)=>prose(p.textContent||'').length>30);
  const text=prose(e.textContent||''),semantic=e.tagName==='ARTICLE'?1.25:e.tagName==='MAIN'||e.getAttribute('role')==='main'?1.15:1;
  // Broad wrappers lose to a similarly complete candidate with fewer links/controls.
  return (paragraphs.reduce((n:number,p:any)=>n+Math.min(2000,prose(p.textContent||'').length),0)+Math.min(500,text.length)*.15)*Math.max(.05,1-density(e))*semantic;
 };
 const ranked=candidates.map(e=>({e,score:score(e)})).sort((a,b)=>b.score-a.score);
 let root=ranked[0]?.e||body;
 // Prefer the most specific container retaining substantially all substantive content.
 for(const item of ranked)if(root?.contains(item.e)&&item.e!==root&&item.score>=ranked[0].score*.995)root=item.e;
 // A long body section can outscore the complete article because bibliographies
 // contain links. Restore its nearest title-bearing editorial parent so preambles,
 // footnotes and references are not silently dropped by a density heuristic.
 if(root&&!root.querySelector('h1'))for(let parent=root.parentElement;parent&&parent!==body;parent=parent.parentElement){
  if(parent.querySelector('h1')&&prose(parent.textContent).length<=Math.max(2000,prose(root.textContent).length*2)&&parent.querySelectorAll('article').length<=1){root=parent;break;}
 }
 const metadata={title:prose(document.querySelector('meta[property="og:title"]')?.getAttribute('content')||root?.querySelector('h1')?.textContent||document.querySelector('title')?.textContent||''),author:prose(document.querySelector('meta[name="citation_author"],meta[name="author"]')?.getAttribute('content')||''),edition:prose(document.querySelector('meta[name="citation_publication_date"]')?.getAttribute('content')||''),publication:prose(document.querySelector('#pubinfo,.publication-info,.revision-info')?.textContent||'')};
 const add=(kind:string,text:string,meta:Record<string,unknown>={})=>{if(text.trim())blocks.push({kind,text,meta});};
 const walk=(node:any)=>{
  if(node.nodeType===3){add('paragraph',prose(node.textContent));return;}
  if(node.nodeType!==1)return;
  const tag=node.tagName.toLowerCase(),text=prose(node.textContent||'');
  if(/(?:^|\s)(pubinfo|publication-info|revision-info)(?:$|\s)/i.test(label(node)))return;
  if(['header','footer'].includes(tag)&&density(node)>.35)return;
  if(chrome.test(label(node))&&density(node)>.45)return;
  if(tag==='img'||tag==='figure'){
   const img=tag==='img'?node:node.querySelector('img'),alt=prose(img?.getAttribute('alt')||''),caption=prose(node.querySelector?.('figcaption')?.textContent||'');
   if(!caption&&(img?.getAttribute('role')==='presentation'||img?.hasAttribute('alt')&&!alt))return;
   add('figure',[alt,caption].filter(Boolean).join('\n')||'Imagem sem descrição textual na fonte.',{alt,caption,observed:false,essential_visual:true});return;
  }
  if(tag==='table'){
   const rows=Array.from(node.querySelectorAll('tr')).map((r:any)=>Array.from(r.querySelectorAll('th,td')).map((c:any)=>prose(c.textContent)));
   add('table',rows.map(r=>r.join(' | ')).join('\n')||text,{rows,caption:prose(node.querySelector('caption')?.textContent||'')});return;
  }
  if(tag==='math'||tag==='svg'){add(tag==='math'?'equation':'unknown',node.outerHTML,{representation:'original_markup_as_text',interpretation:'not_verified',essential_visual:tag==='svg'});return;}
  const kind=/^h[1-6]$/.test(tag)?'heading':({p:'paragraph',pre:'code',blockquote:'quote',li:'list',aside:'note'} as Record<string,string>)[tag];
  // Do not flatten formulas or meaningful child blocks into their parent paragraph.
  if(kind&&node.querySelector('math,table,pre,figure,img,svg,p')){const first=blocks.length;for(const child of node.childNodes)walk(child);if(kind==='note'||kind==='quote'||node.getAttribute('role')==='doc-footnote')for(const b of blocks.slice(first))if(b.kind==='paragraph')b.kind=kind==='quote'?'quote':'note';return;}
  if(kind){
   const verse=node.getAttribute('data-kind')==='verse'||/(?:^|\s)(poem|poetry|verse)(?:\s|$)/.test(label(node));
   if(verse||kind==='code'){node.querySelectorAll('br').forEach((b:any)=>b.replaceWith('\n'));add(verse?'verse':kind,node.textContent.trim(),{preserve_lines:true});}
   else add(node.getAttribute('role')==='doc-footnote'?'note':kind,text,kind==='heading'?{level:Number(tag[1])}:{});
   return;
  }
  for(const child of node.childNodes)walk(child);
 };
 if(root)walk(root);
 if(!blocks.length)warnings.push('Não foi identificado conteúdo editorial utilizável.');
 if(blocks.some(b=>b.meta.essential_visual))warnings.push('Há material visual sem interpretação verificada; os bytes do HTML devem ser conservados. Imagens externas vinculadas não foram obtidas nem preservadas: forneça o material visual autorizado para conferência.');
 warnings.push('HTML: scripts e controles não foram executados; imagens não foram interpretadas.');
 return {blocks,warnings,metadata,removed};
}
