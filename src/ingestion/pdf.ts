// Reutilizado de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
import type {Block} from './contracts.ts';
import {AppError,ensure} from '../errors.ts';
import {prose} from './html.ts';

type Token={text:string;x:number;y:number;width:number;height:number;rotated:boolean};
type Line={text:string;x:number;y:number;right:number;height:number;tokens:Token[]};
type Page={page:number;width:number;height:number;tokens:Token[];visual:boolean};
const median=(a:number[])=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)]||12;
function lines(tokens:Token[]):Line[]{
 const result:Line[]=[];
 for(const t of [...tokens].sort((a,b)=>b.y-a.y||a.x-b.x)){
  const l=result.findLast(l=>Math.abs(l.y-t.y)<Math.min(l.height,t.height)*.35);
  if(l){l.tokens.push(t);l.right=Math.max(l.right,t.x+t.width);l.height=Math.max(l.height,t.height);}
  else result.push({text:'',x:t.x,y:t.y,right:t.x+t.width,height:t.height,tokens:[t]});
 }
 for(const l of result){l.tokens.sort((a,b)=>a.x-b.x);l.x=l.tokens[0].x;l.text=l.tokens.map((t,i)=>`${i&&t.x-(l.tokens[i-1].x+l.tokens[i-1].width)>t.height*.15?' ':''}${t.text}`).join('').trim();}
 return result.sort((a,b)=>b.y-a.y||a.x-b.x);
}
function fragments(line:Line):Line[]{
 const groups:Token[][]=[];for(const t of line.tokens){const g=groups.at(-1),last=g?.at(-1);if(!g||last&&t.x-last.x-last.width>Math.max(20,line.height*2.5))groups.push([t]);else g.push(t);}
 return groups.map(g=>lines(g)[0]);
}
/** Conservative positional reconstruction, shared with tests and local OCR words. */
export function reconstructPdf(pages:Page[]){
 const blocks:Block[]=[],warnings=['PDF: reconstrução posicional heurística; fórmulas, colunas e notas exigem conferência editorial.'];
 const signatures=new Map<string,Set<number>>();
 const marginal=(p:Page,l:Line)=>l.y>p.height*.92||l.y<p.height*.07;
 const signature=(l:Line)=>prose(l.text).replace(/\b\d+\b/g,'#');
 for(const p of pages)for(const l of lines(p.tokens))if(marginal(p,l)){const s=signature(l),seen=signatures.get(s)||new Set();seen.add(p.page);signatures.set(s,seen);}
 let removed=0;
 for(const p of pages){
  let ls=lines(p.tokens).filter(l=>{const remove=marginal(p,l)&&(/^\s*(?:\d+|[ivxlcdm]+)\s*$/i.test(l.text)||(signatures.get(signature(l))?.size||0)>=Math.max(2,Math.ceil(pages.length*.5)));if(remove)removed++;return !remove;});
  const meta={page:p.page,extraction:'positional',...(p.visual?{essential_visual:true}:{})};
  if(!ls.some(l=>l.text.trim())){blocks.push({kind:'unknown',text:'Página sem texto reconhecido. Prepare OCR local ou forneça transcrição autorizada.',locator:`página ${p.page}`,meta:{...meta,extraction:'missing',image_observed:false}});continue;}
  const fs=ls.flatMap(fragments),font=median(fs.map(l=>l.height));
  // Repeated wide fragments on either side of a gutter identify two prose columns.
  const cuts=Array.from({length:17},(_,i)=>p.width*(.3+i*.025));
  const candidate=cuts.map(cut=>{const left=fs.filter(l=>l.right<cut-8),right=fs.filter(l=>l.x>cut+8),cross=fs.filter(l=>l.x<cut&&l.right>cut);return {cut,left,right,cross,score:Math.min(left.filter(l=>l.text.length>30).length,right.filter(l=>l.text.length>30).length)};}).filter(v=>v.score>=3&&v.cross.length<=Math.max(4,fs.length*.2)).sort((a,b)=>b.score-a.score)[0];
  const groups:Line[][]=[];
  if(candidate){
   // Full-width titles/separators divide bands; read left then right in each band.
   const spans=fs.filter(l=>l.x<candidate.cut&&l.right>candidate.cut).sort((a,b)=>b.y-a.y);
   let ceiling=Infinity;
   for(const span of [...spans,{y:-Infinity} as Line]){
    const band=fs.filter(l=>l.y<ceiling&&l.y>span.y&&!spans.includes(l));
    groups.push(band.filter(l=>l.x<candidate.cut),band.filter(l=>l.x>=candidate.cut));
    if(span.y!==-Infinity)groups.push([span]);ceiling=span.y;
   }
  }else groups.push(ls);
  let blockNumber=0;
  for(const group of groups){
   let pending:Line[]=[];
   const flush=()=>{if(!pending.length)return;const text=pending.map(l=>l.text).join(' '),first=pending[0];
    const kind=first.height>font*1.2&&pending.length<=3?'heading':first.height<font*.87&&first.y<p.height*.3?'note':/[=∑∫√≤≥]/u.test(text)&&text.length<180?'equation':'paragraph';
    blocks.push({kind,text,locator:`página ${p.page} · bloco ${++blockNumber}`,meta:{...meta,...(kind==='heading'?{level:first.height>font*1.5?1:2}:{}),bbox:[Math.min(...pending.map(l=>l.x)),pending.at(-1)!.y,Math.max(...pending.map(l=>l.right)),first.y+first.height],column:candidate?(first.x<candidate.cut?1:2):1}});pending=[];};
   for(const l of group.sort((a,b)=>b.y-a.y||a.x-b.x)){
    const cells=fragments(l);
    if(!candidate&&cells.length>=3){flush();blocks.push({kind:'table',text:cells.map(c=>c.text).join(' | '),locator:`página ${p.page} · linha de tabela ${++blockNumber}`,meta:{...meta,rows:[cells.map(c=>c.text)],structure:'positional_row',essential_visual:true}});continue;}
    const last=pending.at(-1);
    if(last&&(last.y-l.y>Math.max(last.height,l.height)*1.65||Math.abs(l.height-last.height)>font*.15||l.x-last.x>font*1.5||last.text.endsWith('.')&&last.right<l.right-font*3))flush();
    pending.push(l);
   }flush();
  }
  if(p.tokens.some(t=>t.rotated))warnings.push(`Página ${p.page}: texto rotacionado, ordem requer conferência; original conservado.`);
  if(p.visual)warnings.push(`Página ${p.page}: imagens ou desenho vetorial não equivalem à transcrição; original conservado.`);
 }
 const missing=blocks.filter(b=>b.meta.extraction==='missing').length;
 if(missing)warnings.push(`${missing} página(s) sem camada textual. OCR não executado no servidor; preparação local disponível.`);
 return {blocks,warnings,removed};
}
export async function extractPdf(bytes:Buffer){
 ensure(bytes.subarray(0,5).toString()==='%PDF-','INVALID_PDF','Arquivo sem cabeçalho PDF.');
 const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,stopAtErrors:true,disableFontFace:true});
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([(async()=>{
  const pdf=await task.promise;ensure(pdf.numPages<=500,'TOO_MANY_PAGES','O limite é 500 páginas.');const pages:Page[]=[];
  for(let i=1;i<=pdf.numPages;i++){
   const p=await pdf.getPage(i),viewport=p.getViewport({scale:1}),content=await p.getTextContent(),ops=await p.getOperatorList();
   const tokens:Token[]=content.items.filter((v:any)=>'str'in v&&v.str.trim()).map((v:any)=>({text:v.str,x:v.transform[4],y:v.transform[5],width:v.width,height:Math.max(v.height,Math.abs(v.transform[3]),1),rotated:Math.abs(v.transform[1])>.1||Math.abs(v.transform[2])>.1}));
   const visual=ops.fnArray.some((n:number)=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.constructPath].includes(n))||tokens.some(t=>t.rotated);
   pages.push({page:i,width:viewport.width,height:viewport.height,tokens,visual});p.cleanup();
  }return reconstructPdf(pages);
 })(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{void task.destroy();reject(new AppError('PDF_TIMEOUT','Extração excedeu o limite. Preserve o arquivo e use preparação local.'));},15000);})]);
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_PDF','PDF protegido, danificado ou sem extração segura. Forneça transcrição autorizada.');}finally{clearTimeout(timeout);await task.destroy();}
}
