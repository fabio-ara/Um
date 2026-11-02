// Reutilizado de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
import {unzipSync,Unzip,UnzipInflate} from 'fflate';
import {DOMParser} from 'linkedom';
import {posix} from 'node:path';
import {ensure,AppError} from '../errors.ts';
import type {Block} from './contracts.ts';
import {extractHtml} from './html.ts';

const MAX_EXPANDED=24*1024*1024,MAX_XML=4*1024*1024;
/** No filesystem extraction, active content, external relationships or XML entities. */
export function packageFiles(bytes:Uint8Array){
 ensure(bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4,'INVALID_FILE','O conteúdo não é um pacote ZIP reconhecido.');
 let count=0,total=0;const names=new Set<string>(),sizes=new Map<string,number>(),wanted=new Set<string>();
 try{unzipSync(bytes,{filter(file){
  ensure(++count<=2000,'ARCHIVE_LIMIT','O pacote excede dois mil arquivos.');
  ensure(file.name.length<=500&&!file.name.startsWith('/')&&!file.name.includes('\\')&&!file.name.split('/').some(p=>p==='..'||p==='.')&&!/^[a-z]:/i.test(file.name)&&!file.name.includes('\0')&&!names.has(file.name),'UNSAFE_ARCHIVE','O pacote contém caminhos inválidos ou repetidos.');names.add(file.name);
  ensure(!/vbaProject|encryption\.xml|encryptedPackage|(?:^|\/)(?:activeX|embeddings)\//i.test(file.name),'UNSUPPORTED_PACKAGE','Pacote protegido, com macros ou conteúdo binário ativo não é aceito.');
  ensure([0,8].includes(file.compression)&&Number.isSafeInteger(file.originalSize)&&file.originalSize>=0,'UNSUPPORTED_PACKAGE','Compressão não suportada.');
  total+=file.originalSize;ensure(total<=MAX_EXPANDED&&file.originalSize<=8*1024*1024,'ARCHIVE_LIMIT','O pacote expandido excede 24 MiB ou possui arquivo acima de 8 MiB.');
  const textual=/\.(?:xml|rels|xhtml|html|opf|ncx|txt)$/i.test(file.name)||file.name==='mimetype';
  if(textual)ensure(file.originalSize<=MAX_XML,'ARCHIVE_LIMIT','Um documento XML excede 4 MiB.');
  sizes.set(file.name,file.originalSize);if(textual)wanted.add(file.name);
  return false; // Directory validation occurs before any decompression.
 }});
 const result:Record<string,Uint8Array>={},seen=new Set<string>();let expanded=0;
 const stream=new Unzip(file=>{
  ensure(names.has(file.name)&&!seen.has(file.name),'INVALID_PACKAGE','Cabeçalho local divergente ou repetido.');seen.add(file.name);
  if(!wanted.has(file.name))return;
  const chunks:Uint8Array[]=[];let length=0;file.ondata=(error,chunk,final)=>{if(error)throw error;length+=chunk.length;expanded+=chunk.length;ensure(length<=MAX_XML&&expanded<=MAX_EXPANDED,'ARCHIVE_LIMIT','A expansão real excede o orçamento do documento.');chunks.push(chunk);if(final){ensure(length===sizes.get(file.name),'INVALID_PACKAGE','O tamanho extraído difere do manifesto ZIP.');const out=new Uint8Array(length);let at=0;for(const part of chunks){out.set(part,at);at+=part.length;}result[file.name]=out;}};file.start();
 });stream.register(UnzipInflate);
 // Small input chunks bound the maximum expansion before ondata checks it.
 for(let at=0;at<bytes.length;at+=256)stream.push(bytes.subarray(at,at+256),at+256>=bytes.length);
 ensure([...wanted].every(name=>result[name]),'INVALID_PACKAGE','O pacote não forneceu todas as partes declaradas.');return result;
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('INVALID_FILE','Não foi possível ler o pacote de documento.');}
}
type Xml=ReturnType<DOMParser['parseFromString']>;
function xml(bytes:Uint8Array|undefined,name:string):Xml{
 ensure(bytes,'INVALID_PACKAGE',`Parte obrigatória ausente: ${name}.`);let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new AppError('ENCODING','O pacote precisa usar XML UTF-8 válido.');}
 ensure(!/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\w*:include\b/i.test(text),'UNSAFE_XML','Entidades externas, DTD e inclusões XML não são aceitas.');
 const parsed=new DOMParser().parseFromString(text,'text/xml');ensure(parsed.documentElement&&!parsed.querySelector('parsererror'),'INVALID_XML','Uma parte do documento contém XML inválido.');return parsed;
}
const local=(node:any)=>String(node.localName||node.nodeName).split(':').at(-1)!;
const descendants=(node:any,name:string):any[]=>Array.from(node.querySelectorAll('*')).filter((n:any)=>local(n)===name);
const direct=(node:any,name:string):any[]=>Array.from(node.children||[]).filter((n:any)=>local(n)===name);
function textRun(node:any):string{
 const kind=local(node);if(['t','instrText'].includes(kind))return node.textContent||'';
 if(kind==='tab')return '\t';if(['br','cr'].includes(kind))return '\n';
 if(kind==='footnoteReference'||kind==='endnoteReference')return `[nota ${node.getAttribute('w:id')||node.getAttribute('id')||'?'}]`;
 if(['del','script','style'].includes(kind))return '';
 if(kind==='oMath')return '[fórmula OMML]';
 return Array.from(node.childNodes||[]).map((n:any)=>n.nodeType===1?textRun(n):'').join('');
}
function paragraph(node:any,locator:string,meta:any={}):Block|null{
 const text=textRun(node);if(!text.trim())return null;
 const style=descendants(node,'pStyle')[0]?.getAttribute('w:val')||'',heading=style.match(/(?:heading|título)(\d+)/i),list=descendants(node,'numPr').length>0,level=descendants(node,'ilvl')[0]?.getAttribute('w:val');
 return {kind:heading?'heading':list?'list':/quote|cita/i.test(style)?'quote':'paragraph',text,locator,meta:{...meta,...(heading?{level:Number(heading[1])}:{}),...(list?{list_level:Number(level||0)}:{})}};
}
function table(node:any,locator:string):Block{
 const rows=direct(node,'tr').map(row=>direct(row,'tc').map(cell=>descendants(cell,'p').map(textRun).join('\n')));
 return {kind:'table',text:rows.map(row=>row.join('\t')).join('\n')||'[Tabela sem texto extraível]',locator,meta:{rows,extraction:rows.length?'available':'uncertain',reason:'Células e linhas preservadas; mesclas e layout precisam de conferência.',essential_visual:true}};
}
function figures(node:any,locator:string):Block[]{
 return descendants(node,'docPr').concat(descendants(node,'cNvPr')).filter(n=>n.getAttribute('descr')||n.getAttribute('title')||descendants(n.parentNode,'blip').length).map(n=>({kind:'figure',text:n.getAttribute('descr')||n.getAttribute('title')||'[Figura sem descrição textual fornecida]',locator,meta:{essential_visual:true,description_origin:'document_alt_text',extraction:n.getAttribute('descr')?'available':'uncertain',reason:'Imagem não interpretada automaticamente.'}}));
}
export function extractPackage(bytes:Buffer,format:'docx'|'pptx'|'epub'){
 const files=packageFiles(bytes),blocks:Block[]=[],warnings:string[]=[];let metadata={title:'',author:'',edition:''};
 if(format==='epub'){
  ensure(files.mimetype&&new TextDecoder().decode(files.mimetype).trim()==='application/epub+zip','INVALID_PACKAGE','O pacote não se identifica como EPUB.');
  const container=xml(files['META-INF/container.xml'],'container.xml'),root=descendants(container,'rootfile')[0]?.getAttribute('full-path');ensure(root&&files[root],'INVALID_PACKAGE','Manifesto EPUB ausente.');
  const opf=xml(files[root],root),base=posix.dirname(root),manifest=new Map(descendants(opf,'item').map(n=>[n.getAttribute('id'),n]));
  metadata={title:descendants(opf,'title')[0]?.textContent||'',author:descendants(opf,'creator').map(n=>n.textContent).join('; '),edition:descendants(opf,'publisher')[0]?.textContent||''};
  for(const [index,ref]of descendants(opf,'itemref').entries()){
   const item=manifest.get(ref.getAttribute('idref')),href=item?.getAttribute('href');ensure(href&&!/^[a-z]+:|^\/|\\/i.test(href),'INVALID_PACKAGE','Referência externa ou inválida na ordem EPUB.');
   const path=posix.normalize(posix.join(base,decodeURIComponent(href.split('#')[0])));ensure(!path.startsWith('../')&&files[path],'INVALID_PACKAGE','Parte EPUB indisponível.');
   const parsed=xml(files[path],path),result=extractHtml(parsed.toString());
   blocks.push(...result.blocks.map((b,i)=>({...b,locator:`seção ${index+1}, ${b.locator||`elemento ${i+1}`}`,meta:{...b.meta,epub_path:path,spine_index:index,language:parsed.documentElement.getAttribute('lang')||parsed.documentElement.getAttribute('xml:lang')||descendants(opf,'language')[0]?.textContent||'und'}})));warnings.push(...result.warnings);
  }
  warnings.push('A ordem segue o spine EPUB. Estilos, scripts e conteúdo remoto não são executados.');
 }else{
  const types=xml(files['[Content_Types].xml'],'[Content_Types].xml');ensure(descendants(types,'Override').some(n=>(n.getAttribute('ContentType')||'').includes(format==='docx'?'wordprocessingml.document.main':'presentationml.presentation.main')),'INVALID_PACKAGE','O tipo interno não corresponde ao formato solicitado.');
  if(files['docProps/core.xml']){const core=xml(files['docProps/core.xml'],'core.xml');metadata={title:descendants(core,'title')[0]?.textContent||'',author:descendants(core,'creator')[0]?.textContent||'',edition:descendants(core,'version')[0]?.textContent||''};}
  if(format==='docx'){
   const document=xml(files['word/document.xml'],'word/document.xml'),body=descendants(document,'body')[0];ensure(body,'INVALID_PACKAGE','Corpo DOCX ausente.');
   for(const [index,child]of Array.from(body.children).entries()){
    const at=`elemento ${index+1}`;if(local(child)==='tbl')blocks.push(table(child,at));else if(local(child)==='p'){const p=paragraph(child,at);if(p)blocks.push(p);}
    for(const formula of descendants(child,'oMath'))blocks.push({kind:'equation',text:descendants(formula,'t').map(n=>n.textContent).join('')||'[Fórmula sem representação linear]',locator:at,meta:{notation:'office_math_linear',office_math_xml:formula.toString(),essential_visual:true,extraction:'uncertain',reason:'Estrutura matemática preservada em OMML; a notação visual exige conferência.'}});
    blocks.push(...figures(child,at));
   }
   for(const kind of ['footnotes','endnotes','comments'])if(files[`word/${kind}.xml`]){const part=xml(files[`word/${kind}.xml`],kind);for(const note of descendants(part,kind==='comments'?'comment':kind==='footnotes'?'footnote':'endnote')){const id=note.getAttribute('w:id');if(Number(id)<0)continue;const text=descendants(note,'p').map(textRun).join('\n');if(text.trim())blocks.push({kind:'note',text,locator:`${kind} ${id}`,meta:{note_id:id,note_kind:kind}});}}
   warnings.push('Ordem XML e notas preservadas. Alterações excluídas não integram o texto corrente; imagens e fórmulas exigem confronto com o arquivo.');
  }else{
   const presentation=xml(files['ppt/presentation.xml'],'ppt/presentation.xml'),rels=xml(files['ppt/_rels/presentation.xml.rels'],'presentation.xml.rels'),relations=new Map(descendants(rels,'Relationship').map(n=>[n.getAttribute('Id'),n]));
   for(const [index,sld]of descendants(presentation,'sldId').entries()){
    const relation=relations.get(sld.getAttribute('r:id'));ensure(relation&&relation.getAttribute('TargetMode')!=='External','INVALID_PACKAGE','Slide externo não permitido.');
    const target=relation.getAttribute('Target')||'',path=posix.normalize(posix.join('ppt',target));ensure(!target.startsWith('/')&&!path.startsWith('../'),'UNSAFE_ARCHIVE','Caminho do slide inválido.');
    const slide=xml(files[path],path),tree=descendants(slide,'spTree')[0];ensure(tree,'INVALID_PACKAGE','Estrutura do slide ausente.');
    for(const shape of Array.from(tree.children)){
     for(const [j,p]of descendants(shape,'p').filter(n=>{let parent=n.parentNode;while(parent&&parent!==shape){if(local(parent)==='tbl')return false;parent=parent.parentNode;}return true;}).entries()){const b=paragraph(p,`slide ${index+1}, bloco ${j+1}`,{slide:index+1,essential_visual:true,reading_order:'shape_tree'});if(b)blocks.push(b);}
     for(const t of descendants(shape,'tbl'))blocks.push(table(t,`slide ${index+1}, tabela`));blocks.push(...figures(shape,`slide ${index+1}, figura`));
    }
    const relPath=posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels');
    if(files[relPath])for(const relation of descendants(xml(files[relPath],relPath),'Relationship').filter(r=>(r.getAttribute('Type')||'').endsWith('/notesSlide'))){ensure(relation.getAttribute('TargetMode')!=='External','INVALID_PACKAGE','Notas externas não são carregadas.');const notesPath=posix.normalize(posix.join(posix.dirname(path),relation.getAttribute('Target')||''));ensure(!notesPath.startsWith('../'),'INVALID_PACKAGE','Caminho de notas inválido.');for(const p of descendants(xml(files[notesPath],notesPath),'p')){const b=paragraph(p,`notas do slide ${index+1}`,{slide:index+1,note_kind:'speaker'});if(b)blocks.push({...b,kind:'note'});}}
   }
   warnings.push('Slides seguem a ordem da apresentação; blocos seguem a árvore de formas, que pode diferir da ordem visual. O arquivo é retido para conferência.');
  }
 }
 ensure(blocks.length,'EMPTY_SOURCE','Não foi encontrado texto extraível no pacote.');return {blocks,warnings,metadata,removed:0,mime:format==='epub'?'application/epub+zip':`application/vnd.openxmlformats-officedocument.${format==='docx'?'wordprocessingml.document':'presentationml.presentation'}`};
}
