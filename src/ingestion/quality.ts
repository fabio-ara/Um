// Reutilizado de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
import {createHash} from 'node:crypto';
import type {Block} from './contracts.ts';
import {AppError} from '../errors.ts';

export interface ExtractionQuality {
 version:1; status:'ready'|'partial'|'rejected'; useful_characters:number; textual_elements:number;
 structure:Record<string,number>; gaps:{index:number;locator:string;reason:string}[]; warnings:string[];
 original_required:boolean; method:string; removed_elements:number;
}
export function assessExtraction(blocks:Block[],warnings:string[],method:string,removed=0):ExtractionQuality {
 const structure:Record<string,number>={},gaps:ExtractionQuality['gaps']=[];let useful=0,textual=0;
 blocks.forEach((b,index)=>{structure[b.kind]=(structure[b.kind]||0)+1;
  if(b.meta.extraction==='missing'||b.meta.extraction==='uncertain')gaps.push({index,locator:b.locator||`elemento ${index+1}`,reason:String(b.meta.reason||'Conteúdo não recuperado com segurança.')});
  else if(!['figure','unknown','navigation'].includes(b.kind)){useful+=Array.from(b.text).length;textual++;}
 });
 const originalRequired=gaps.length>0||blocks.some(b=>b.meta.essential_visual===true||b.kind==='unknown'||b.kind==='figure');
 const contaminated=blocks.length>2&&blocks.filter(b=>/^(home|menu|login|sign in|search|next|previous|privacy policy|skip to content)$/i.test(b.text.trim())).length>blocks.length*.4;
 return {version:1,status:!useful||contaminated?'rejected':originalRequired?'partial':'ready',useful_characters:useful,textual_elements:textual,structure,gaps,warnings:[...warnings,...(contaminated?['Extração contaminada por controles de navegação.']:[])],original_required:originalRequired,method,removed_elements:removed};
}
export function requireReadable(quality:ExtractionQuality){if(quality.status==='rejected')throw new AppError('EXTRACTION_REJECTED','A extração ainda não permite iniciar a leitura. Confira a pré-verificação; forneça uma transcrição ou prepare OCR local e reimporte uma versão identificável.',422,quality);}
const ordered=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
/** JSONB may reorder object keys; semantic hashes must survive a database round trip. */
export const contentHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
/** IDs and fallback locators are not part of the content identity. */
export const canonicalHash=(blocks:Block[])=>contentHash(blocks.map(b=>({kind:b.kind,text:b.text,locator:b.locator||'',meta:b.meta})));
