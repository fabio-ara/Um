// Reutilizado de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Block} from './contracts.ts';
import {ensure} from '../errors.ts';
export const ocrSchema=z.object({source_sha256:z.string().regex(/^[a-f0-9]{64}$/),engine:z.literal('tesseract'),engine_version:z.string().min(1).max(120),language:z.string().min(1).max(100),prepared_at:z.iso.datetime(),pages:z.array(z.object({page:z.number().int().min(1).max(500),confidence:z.number().min(0).max(100),blocks:z.array(z.object({text:z.string().min(1).max(100000),bbox:z.array(z.number().finite()).length(4)}).strict()).max(1000)}).strict()).max(30)}).strict();
export type OcrPreparation=z.infer<typeof ocrSchema>;
export function applyOcr(blocks:Block[],bytes:Buffer,preparation:OcrPreparation){
 ensure(createHash('sha256').update(bytes).digest('hex')===preparation.source_sha256,'OCR_SOURCE_MISMATCH','A preparação OCR pertence a outro arquivo.');
 ensure(new Set(preparation.pages.map(p=>p.page)).size===preparation.pages.length,'INVALID_OCR','Uma página foi repetida no preparo.');
 const missing=new Set(blocks.filter(b=>b.meta.extraction==='missing').map(b=>Number(b.meta.page)));
 ensure(preparation.pages.every(p=>missing.has(p.page)),'INVALID_OCR','OCR complementar só preenche páginas sem camada textual desta fonte.');
 return blocks.flatMap(b=>{
  const p=preparation.pages.find(p=>p.page===b.meta.page);if(!p)return [b];
  if(p.confidence<65||!p.blocks.length)return [{...b,meta:{...b.meta,reason:'OCR local insuficiente; a lacuna permanece identificada.',ocr_confidence:p.confidence}}];
  return p.blocks.map((v,i)=>({kind:'paragraph',text:v.text,locator:`página ${p.page} · parágrafo OCR ${i+1}`,meta:{page:p.page,extraction:'ocr_unreviewed',bbox:v.bbox,essential_visual:true,ocr:{engine:preparation.engine,version:preparation.engine_version,language:preparation.language,prepared_at:preparation.prepared_at,confidence:p.confidence,source_sha256:preparation.source_sha256,execution:'local',verification:'declared_not_certified'}}}));
 });
}
