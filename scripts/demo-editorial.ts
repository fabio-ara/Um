import type {Anchor,SourceBlock} from '../src/contracts.ts';
import {ensure} from '../src/errors.ts';
export const apologyWork='f5fd1e74-5c2d-4fe2-83b2-25aeff692909';
export const analectsWork='c42075b4-92d6-4231-879f-3834fccc5e24';
export const apologyScope='Recortes 17a–17d e 21a–21e; edições integrais disponíveis para consulta.';
export const apologyReference='Platão, Apologia 17a–17d e 21a–21e, edição Burnet e tradução Fowler, Perseus Digital Library.';
/** Each complete paragraph is anchored separately; no arbitrary excerpt cutoff. */
export function sectionAnchors(sources:{id:string;revision:number;blocks:SourceBlock[]}[],section:string):Anchor[]{
 return sources.flatMap(source=>{
  const blocks=source.blocks.filter(b=>b.kind==='paragraph'&&b.locator==='Stephanus '+section);ensure(blocks.length,'EXTRACTION','Seção ausente da edição.');
  return blocks.map(b=>({sourceId:source.id,sourceRevision:source.revision,elementId:b.id,start:0,end:Array.from(b.text).length,exact:b.text,prefix:'',suffix:'',locator:b.locator}));
 });
}
export function analectsPassage(text:string){
 const start=text.indexOf('CHAP. XVII.',text.indexOf('BOOK II.')),end=text.indexOf('CHAP.',start+'CHAP. XVII.'.length);
 ensure(start>=0&&end>start,'EXTRACTION','Analectos II.17 ausente.');
 const passage=text.slice(start,end).replace(/\s+/g,' ').trim();
 ensure(passage.includes('when you do not know a thing')&&passage.includes('this is knowledge'),'EXTRACTION','Recorte de Analectos incompatível.');return passage;
}
