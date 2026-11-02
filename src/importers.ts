// Adaptado de AraRead, MIT, Copyright (c) 2026 Fabio Ara.
import { lookup } from 'node:dns/promises';
import {createHash} from 'node:crypto';
import { connect } from 'node:tls';
import { Client } from 'undici';
import {extractHtml,prose} from './ingestion/html.ts';
import {extractPdf} from './ingestion/pdf.ts';
import {extractPackage} from './ingestion/office.ts';
import {assessExtraction,canonicalHash} from './ingestion/quality.ts';
import {applyOcr,ocrSchema,type OcrPreparation} from './ingestion/ocr.ts';
import ipaddr from 'ipaddr.js';
import { blockSchema,type Block,type Extraction } from './ingestion/contracts.ts';
import { AppError,ensure } from './errors.ts';
const MAX=8*1024*1024;
export interface ImportInput {format:string;text?:string;file_base64?:string;filename?:string;url?:string;blocks?:Block[];ocr?:OcrPreparation}
export function publicAddress(address:string){try{const ip=ipaddr.process(address);return ip.range()==='unicast';}catch{return false;}}
export async function validatePublicUrl(value:string){
 const u=new URL(value);ensure(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443'),'UNSAFE_URL','Importação de página exige HTTPS público, sem credenciais e na porta padrão.');
 const host=u.hostname.replace(/^\[|\]$/g,'');ensure(!/(^|\.)(localhost|local|internal|test|onion)$/i.test(host),'UNSAFE_URL','Endereço interno não permitido.');
 const addresses=await lookup(host,{all:true,verbatim:true});ensure(addresses.length&&addresses.every(x=>publicAddress(x.address)),'UNSAFE_URL','A resolução do endereço aponta para rede interna ou reservada.');
 return {url:u,address:addresses[0]};
}
export async function getPublic(value:string,maxBytes:number,signal:AbortSignal):Promise<{body:Buffer;mime:string;status:number;location?:string}>{
 const {url,address}=await validatePublicUrl(value);
 // O socket usa somente o IP já validado. SNI e certificado continuam vinculados
 // ao nome original; não há segunda resolução DNS nem fallback por hostname.
 const client=new Client(url.origin,{headersTimeout:10000,bodyTimeout:10000,maxResponseSize:maxBytes,connect(_options,callback){
  const socket=connect({host:address.address,port:443,servername:url.hostname.replace(/^\[|\]$/g,''),rejectUnauthorized:true,ALPNProtocols:['http/1.1']});
  const failed=(error:Error)=>callback(error,null);socket.once('error',failed);
  socket.once('secureConnect',()=>{socket.removeListener('error',failed);callback(null,socket);});
 }});
 try{
  const response=await client.request({method:'GET',path:url.pathname+url.search,signal,headers:{'User-Agent':'Um/0.1 (single-page user-directed importer)','Accept':'text/html, text/plain;q=0.8','Accept-Encoding':'identity'}});
  const status=response.statusCode,mime=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
  if(status>=300&&status<400)return {body:Buffer.alloc(0),mime,status,location:typeof response.headers.location==='string'?response.headers.location:undefined};
  ensure(Number(response.headers['content-length']||0)<=maxBytes,'TOO_LARGE','Página excede o limite de bytes.',413);
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;ensure(bytes<=maxBytes,'TOO_LARGE','Página excede o limite de bytes.',413);chunks.push(Buffer.from(chunk));}
  return {body:Buffer.concat(chunks),mime,status};
 }catch(error){if((error as any)?.code==='UND_ERR_RES_EXCEEDED_MAX_SIZE')throw new AppError('TOO_LARGE','Página excede o limite de bytes.',413);throw error;}
 finally{await client.destroy();}
}
export async function fetchPublicHtml(value:string){
 const signal=AbortSignal.timeout(10000);let current=new URL(value);
 for(let redirects=0;redirects<=3;redirects++){
  // Não contorna regras explícitas de obtenção automática do site.
  const robots=await getPublic(new URL('/robots.txt',current).href,65536,signal);
  if(robots.status===200){let applies=false;for(const line of robots.body.toString('utf8').split(/\r?\n/)){const [key,...parts]=line.split(':');const val=parts.join(':').split('#')[0].trim();if(key.trim().toLowerCase()==='user-agent')applies=val==='*'||/um/i.test(val);if(applies&&key.trim().toLowerCase()==='disallow'&&val&&current.pathname.startsWith(val))throw new AppError('ROBOTS_DENIED','O site não permite obter esta página automaticamente. Forneça texto autorizado.');}}
  const result=await getPublic(current.href,MAX,signal);
  if(result.status>=300&&result.status<400){ensure(result.location&&redirects<3,'REDIRECT_LIMIT','Redirecionamentos excessivos ou inválidos.');current=new URL(result.location,current);continue;}
  ensure(result.status===200,'SOURCE_UNAVAILABLE','Página indisponível, protegida ou não autorizada. Não é possível contornar autenticação.');
  ensure(['text/html','application/xhtml+xml'].includes(result.mime),'UNSUPPORTED_TYPE','O endereço deve devolver uma página HTML pública.');
  return result.body;
 }
 throw new AppError('REDIRECT_LIMIT','Redirecionamentos excessivos.');
}
function utf8(bytes:Buffer){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new AppError('ENCODING','Forneça texto UTF-8 válido.');}}
function textBlocks(text:string,markdown=false):Block[]{
 if(!markdown)return text.split(/\r?\n\s*\r?\n/).filter(x=>x.trim()).map(text=>({kind:'paragraph',text:prose(text),meta:{}}));
 const lines=text.split(/\r?\n/),blocks:Block[]=[];let pending:string[]=[];
 const flush=()=>{if(pending.length){blocks.push({kind:'paragraph',text:prose(pending.join(' ')),meta:{}});pending=[];}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim()){flush();continue;}
  const fence=line.match(/^\s*(```+|~~~+)(.*)$/);if(fence){flush();const body=[];while(++i<lines.length&&!lines[i].trim().startsWith(fence[1]))body.push(lines[i]);blocks.push({kind:'code',text:body.join('\n')||' ',meta:{language:fence[2].trim()}});continue;}
  if(line.trim()==='$$'){flush();const body=[];while(++i<lines.length&&lines[i].trim()!=='$$')body.push(lines[i]);blocks.push({kind:'equation',text:body.join('\n')||' ',meta:{notation:'original'}});continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)/);if(heading){flush();blocks.push({kind:'heading',text:heading[2],meta:{level:heading[1].length}});continue;}
  if(/^\s*\|/.test(line)&&i+1<lines.length&&/\|?\s*:?-{3}/.test(lines[i+1])){flush();const rows=[line.split('|').slice(1,-1).map(x=>x.trim())];i++;while(i+1<lines.length&&/^\s*\|/.test(lines[i+1]))rows.push(lines[++i].split('|').slice(1,-1).map(x=>x.trim()));blocks.push({kind:'table',text:rows.map(x=>x.join(' | ')).join('\n'),meta:{rows}});continue;}
  const figure=line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);if(figure){flush();blocks.push({kind:'figure',text:figure[1]||'Figura sem descrição na fonte.',meta:{alt:figure[1],source:figure[2],observed:false}});continue;}
  const note=line.match(/^\[\^([^\]]+)\]:\s*(.*)/);if(note){flush();blocks.push({kind:'note',text:note[2]||' ',locator:`nota ${note[1]}`,meta:{label:note[1]}});continue;}
  if(/^\s*>/.test(line)){flush();blocks.push({kind:'quote',text:line.replace(/^\s*> ?/,'' )||' ',meta:{}});continue;}
  if(/^\s*([-*+] |\d+\. )/.test(line)){flush();blocks.push({kind:'list',text:line,meta:{}});continue;}
  pending.push(line);
 }
 flush();return blocks;
}
export async function extract(input:ImportInput):Promise<Extraction>{
 let bytes:Buffer;
 if(input.format==='url'){ensure(input.url,'VALIDATION','Informe o URL público.');bytes=await fetchPublicHtml(input.url);}
 else if(input.file_base64!==undefined){ensure(input.file_base64.length<=Math.ceil(MAX/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.file_base64),'INVALID_FILE','Base64 inválido ou arquivo acima de 8 MiB.');bytes=Buffer.from(input.file_base64,'base64');}
 else if(input.format==='structured'){ensure(input.blocks?.length,'VALIDATION','Forneça blocos estruturados.');bytes=Buffer.from(JSON.stringify(input.blocks),'utf8');}
 else {ensure(input.text!==undefined,'VALIDATION','Forneça texto ou arquivo.');bytes=Buffer.from(input.text,'utf8');}
 ensure(bytes.length>0&&bytes.length<=MAX,'TOO_LARGE','Forneça um original de até 8 MiB.',413);
 let blocks:Block[],warnings:string[]=[],mime='text/plain',removed=0,metadata={title:'',author:'',edition:''};
 if(input.format==='pdf'){const result=await extractPdf(bytes);blocks=result.blocks;warnings=result.warnings;removed=result.removed;mime='application/pdf';}
 else if(['docx','pptx','epub'].includes(input.format)){const result=extractPackage(bytes,input.format as 'docx'|'pptx'|'epub');blocks=result.blocks;warnings=result.warnings;removed=result.removed;metadata=result.metadata;mime=result.mime;}
 else if(input.format==='structured'){blocks=input.blocks!.map(x=>blockSchema.parse(x));mime='application/json';const conversion=blocks[0]?.meta.conversion as any;if(conversion){ensure(conversion.original_sha256===createHash('sha256').update(bytes).digest('hex'),'INVALID_CONVERSION','O hash do original não corresponde ao preparo local.');warnings.push('Conversão local declarada; texto e ordem exigem confronto com o original preservado.');mime=conversion.format==='doc'?'application/msword':conversion.format==='mobi'?'application/x-mobipocket-ebook':mime;blocks[0].meta.essential_visual=true;}}
 else if(['url','html'].includes(input.format)){const result=extractHtml(utf8(bytes));blocks=result.blocks;warnings=result.warnings;removed=result.removed;metadata=result.metadata;mime='text/html';}
 else {blocks=textBlocks(utf8(bytes),input.format==='markdown');if(input.format==='markdown')mime='text/markdown';}
 ensure(blocks.length>0&&blocks.length<=20000,'EMPTY_SOURCE','A fonte não contém texto extraível dentro do limite de 20 mil elementos.');
 for(const b of blocks)ensure(blockSchema.safeParse(b).success,'ELEMENT_LIMIT','Um elemento excede 100 mil caracteres ou possui metadados inválidos. Forneça uma transcrição dividida por sentido; não divida fórmulas ou provas automaticamente.');
 if(input.ocr){ensure(input.format==='pdf','INVALID_OCR','Preparo OCR exige o PDF original.');blocks=applyOcr(blocks,bytes,ocrSchema.parse(input.ocr));warnings.push('OCR preparado localmente com Tesseract; proveniência declarada, sem certificação humana. Confira negações, fórmulas, tabelas e ordem no original.');}
 const labels:Record<string,string>={paragraph:'parágrafo',heading:'título',list:'item',quote:'citação',note:'nota',verse:'estrofe',equation:'fórmula',table:'tabela',code:'código',figure:'figura'},counts:Record<string,number>={};
 blocks=blocks.map(b=>({...b,locator:b.locator||`${labels[b.kind]||'elemento'} ${counts[b.kind]=(counts[b.kind]||0)+1}`}));
 const quality=assessExtraction(blocks,warnings,input.format==='pdf'?'pdfjs-positional-v1':input.format==='html'||input.format==='url'?'semantic-html-v1':['docx','pptx','epub'].includes(input.format)?`${input.format}-package-v1`:'text-v1',removed);
 return {blocks,warnings,quality,metadata,canonical_hash:canonicalHash(blocks),original:bytes,mime,filename:input.filename||({pdf:'original.pdf',epub:'original.epub',docx:'original.docx',pptx:'original.pptx',markdown:'original.md',html:'original.html',url:'original.html',structured:'original.json'} as Record<string,string>)[input.format]||'original.txt'};
}
