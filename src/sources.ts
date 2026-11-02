import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {id,revision,type Identity,type SourceBlock} from './contracts.ts';
import {transaction,operation,priorOperation,type Transaction} from './db.ts';
import {ensure,AppError} from './errors.ts';
import {extract,type ImportInput} from './importers.ts';
import {blockSchema} from './ingestion/contracts.ts';
import {requireReadable} from './ingestion/quality.ts';
import {getFile,putFile,hostFileSchema,hostFile,hashBytes} from './files.ts';
const page={offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)};
const metadata=z.strictObject({title:z.string().min(1).max(500),language:z.string().min(2).max(40),nature:z.enum(['original','translation','commentary','bibliography']),extent:z.enum(['full','fragment','reference']),workId:id.nullable().default(null),editionId:id.nullable().default(null),authors:z.array(z.strictObject({name:z.string().min(1).max(300),role:z.enum(['author','translator','editor','commentator'])})).max(40).default([]),rights:z.strictObject({status:z.enum(['public-domain','licensed','permission','private-use']),statement:z.string().min(1).max(2000),evidence:z.string().min(1).max(2000),offlineAllowed:z.boolean()}),provenance:z.string().min(1).max(2000)});
export const sourceSchemas={
 source_list:z.strictObject({query:z.string().max(200).default(''),...page}),
 source_get:z.strictObject({sourceId:id,sourceRevision:revision.optional(),...page}),
 source_history:z.strictObject({sourceId:id,...page}),
 source_locate:z.strictObject({sourceId:id,sourceRevision:revision,elementId:z.string().min(1).max(500)}),
 source_index_build:z.strictObject({operationId:id,sourceId:id,sourceRevision:revision}),
 source_import:z.strictObject({operationId:id,metadata,format:z.enum(['text','markdown','html','pdf','docx','pptx','epub','url','structured']),text:z.string().max(4000000).optional(),file:hostFileSchema.optional(),url:z.url().max(2000).optional(),blocks:z.array(blockSchema).max(20000).optional(),webInclusionConfirmed:z.boolean().default(false)}),
 source_attach:z.strictObject({operationId:id,projectId:id,sourceId:id}),
 source_detach:z.strictObject({operationId:id,projectId:id,sourceId:id}),
 source_delete:z.strictObject({operationId:id,sourceId:id,expectedRevision:revision}),
 source_revise:z.strictObject({operationId:id,sourceId:id,expectedRevision:revision,blocks:z.array(z.strictObject({id:z.string().min(1).max(500),...blockSchema.shape})).min(1).max(20000).optional(),metadata:metadata.optional(),reason:z.string().min(1).max(2000)}).refine(a=>a.blocks!==undefined||a.metadata!==undefined,'Informe texto ou metadados revisados.'),
};
export const sourceReadTasks=new Set(['source_list','source_get','source_locate','source_history']);
export async function fileRow(db:Transaction,identity:Identity,file:Awaited<ReturnType<typeof putFile>>,scope:{sourceId?:string;projectId?:string;profileId?:string},offlineAllowed:boolean,state:'prepared'|'published'='published'){
 await db.query('insert into um.files(path,owner_id,source_id,project_id,profile_id,sha256,bytes,media_type,offline_allowed,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[file.path,identity.id,scope.sourceId||null,scope.projectId||null,scope.profileId||null,file.sha256,file.bytes,file.mediaType,offlineAllowed,state]);
}
async function sourceRow(identity:Identity,sourceId:string,sourceRevision?:number){
 return transaction(identity,async db=>{
  const current=(await db.query('select * from um.sources where id=$1',[sourceId])).rows[0];ensure(current,'NOT_FOUND','Fonte indisponível.',404);
  const version=(await db.query('select * from um.source_revisions where source_id=$1 and revision=$2',[sourceId,sourceRevision??current.revision])).rows[0];ensure(version,'NOT_FOUND','Revisão indisponível.',404);
  return {...current,...version,originalSha256:current.sha256};
 });
}
export async function sourceView(identity:Identity,sourceId:string,sourceRevision?:number){
 const row=await sourceRow(identity,sourceId,sourceRevision);
 const body=JSON.parse((await getFile(identity,row.body_file)).toString('utf8'));
 return {id:sourceId,revision:row.revision,blocks:body.blocks as SourceBlock[],metadata:row.metadata,changeReason:row.change_reason,sha256:row.sha256,originalSha256:row.originalSha256};
}
async function indexSource(db:Transaction,identity:Identity,sourceId:string,sourceRevision:number,blocks:SourceBlock[],offlineAllowed:boolean){
 // Same source/revision cannot be indexed twice, even across operation IDs.
 await db.query('select id from um.sources where id=$1 for update',[sourceId]);
 if((await db.query('select 1 from um.source_pages where source_id=$1 and revision=$2 limit 1',[sourceId,sourceRevision])).rowCount)return;
 for(let offset=0;offset<blocks.length;offset+=100){
  const pageBlocks=blocks.slice(offset,offset+100),pageNumber=offset/100;
  const file=await putFile(identity,Buffer.from(JSON.stringify({blocks:pageBlocks})),'application/json');
  await fileRow(db,identity,file,{sourceId},offlineAllowed);
  await db.query('insert into um.source_pages values($1,$2,$3,$4,$5,$6)',[sourceId,sourceRevision,pageNumber,offset,pageBlocks.length,file.path]);
  await db.query(`insert into um.source_block_index(source_id,revision,block_id,position,page_number,locator)
   select $1,$2,x.data->>'id',$3+x.ordinality-1,$4,x.data->>'locator' from jsonb_array_elements($5::jsonb) with ordinality as x(data,ordinality)`,[sourceId,sourceRevision,offset,pageNumber,JSON.stringify(pageBlocks.map(b=>({id:b.id,locator:b.locator??null})))]);
 }
}
async function sourcePage(identity:Identity,sourceId:string,version:number|undefined,offset:number,limit:number){
 const row=await sourceRow(identity,sourceId,version);
 const data=await transaction(identity,async db=>({
  total:Number((await db.query('select coalesce(sum(block_count),0) as total from um.source_pages where source_id=$1 and revision=$2',[sourceId,row.revision])).rows[0].total),
  pages:(await db.query('select file_path,first_position from um.source_pages where source_id=$1 and revision=$2 and first_position<$3 and first_position+block_count>$4 order by first_position',[sourceId,row.revision,offset+limit,offset])).rows,
 }));
 // Historical revisions remain readable until their owner builds the derived index.
 if(!data.total){const source=await sourceView(identity,sourceId,row.revision);return {...source,blocks:source.blocks.slice(offset,offset+limit),total:source.blocks.length,offset,complete:offset===0&&source.blocks.length<=limit};}
 const blocks:SourceBlock[]=[];
 for(const p of data.pages){const body=JSON.parse((await getFile(identity,p.file_path)).toString('utf8'));blocks.push(...body.blocks.slice(Math.max(0,offset-p.first_position),Math.min(body.blocks.length,offset+limit-p.first_position)));}
 return {id:sourceId,revision:row.revision,metadata:row.metadata,changeReason:row.change_reason,sha256:row.sha256,originalSha256:row.originalSha256,blocks,total:data.total,offset,complete:offset===0&&data.total<=limit};
}
export async function sourceTask(identity:Identity,task:keyof typeof sourceSchemas,input:unknown):Promise<unknown>{
 const args=sourceSchemas[task].parse(input) as any;
 if(task==='source_list')return transaction(identity,async db=>({items:(await db.query("select s.id,s.revision,s.metadata,r.sha256,s.sha256 as \"originalSha256\" from um.sources s join um.source_revisions r on r.source_id=s.id and r.revision=s.revision where s.metadata->>'title' ilike $1 order by s.id limit $2 offset $3",[`%${args.query}%`,args.limit,args.offset])).rows,offset:args.offset,limit:args.limit}));
 if(task==='source_get')return sourcePage(identity,args.sourceId,args.sourceRevision,args.offset,args.limit);
 if(task==='source_history')return transaction(identity,async db=>({items:(await db.query('select revision,metadata,sha256,change_reason from um.source_revisions where source_id=$1 order by revision desc limit $2 offset $3',[args.sourceId,args.limit,args.offset])).rows,offset:args.offset,limit:args.limit}));
 if(task==='source_locate'){
  const row=await sourceRow(identity,args.sourceId,args.sourceRevision);
  const index=await transaction(identity,async db=>({found:(await db.query('select position from um.source_block_index where source_id=$1 and revision=$2 and block_id=$3',[args.sourceId,args.sourceRevision,args.elementId])).rows[0],indexed:Boolean((await db.query('select 1 from um.source_pages where source_id=$1 and revision=$2 limit 1',[args.sourceId,args.sourceRevision])).rowCount)}));
  const offset=index.found?.position??(index.indexed?-1:(await sourceView(identity,args.sourceId,args.sourceRevision)).blocks.findIndex(b=>b.id===args.elementId));
  ensure(offset>=0,'NOT_FOUND','Trecho indisponível nesta revisão.',404);
  return sourcePage(identity,args.sourceId,row.revision,offset,1);
 }
 if(task==='source_index_build'){
  const row=await sourceRow(identity,args.sourceId,args.sourceRevision);ensure(row.owner_id===identity.id,'FORBIDDEN','Só o proprietário indexa esta fonte.',403);
  const prior=await transaction(identity,db=>priorOperation(db,identity,args.operationId,task,args));if(prior)return prior;
  const source=await sourceView(identity,args.sourceId,args.sourceRevision);
  return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{await indexSource(db,identity,source.id,source.revision,source.blocks,source.metadata.rights.offlineAllowed);return {sourceId:source.id,revision:source.revision,indexed:true};}));
 }
 if(task==='source_attach')return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{await db.query('insert into um.project_sources(project_id,source_id) values($1,$2) on conflict do nothing',[args.projectId,args.sourceId]);return {projectId:args.projectId,sourceId:args.sourceId};}));
 if(task==='source_detach')return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{
  ensure((await db.query('select um.project_owner($1) as allowed',[args.projectId])).rows[0].allowed,'FORBIDDEN','Só o autor altera as fontes do projeto.',403);
  ensure(!(await db.query("select 1 from um.bundles where project_id=$1 and profile_id is null and manifest->'sourceRevisions' ? $2 limit 1",[args.projectId,args.sourceId])).rowCount,'SOURCE_IN_USE','Fonte usada em publicação preservada. Prepare outro projeto para mudar esse alcance.',409);
  await db.query('delete from um.project_sources where project_id=$1 and source_id=$2',[args.projectId,args.sourceId]);return {projectId:args.projectId,sourceId:args.sourceId,detached:true};
 }));
 if(task==='source_delete'){
  try{return await transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{
   const row=(await db.query('delete from um.sources where id=$1 and owner_id=$2 and revision=$3 returning id',[args.sourceId,identity.id,args.expectedRevision])).rows[0];ensure(row,'CONFLICT','Fonte indisponível ou alterada. Releia antes de excluir.',409);return {sourceId:row.id,deleted:true};
  }));}catch(error){if((error as any)?.code==='23503')throw new AppError('SOURCE_IN_USE','Fonte ainda vinculada a projeto; nenhuma publicação foi removida.',409);throw error;}
 }
 if(task==='source_revise'){
  const current=await sourceRow(identity,args.sourceId);
  const blocks=args.blocks??(await sourceView(identity,args.sourceId,current.revision)).blocks;
  ensure(new Set(blocks.map((b:SourceBlock)=>b.id)).size===blocks.length,'VALIDATION','Identidades de bloco repetidas.');
  return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{
   const own=(await db.query('select id from um.sources where id=$1 and owner_id=$2 for update',[args.sourceId,identity.id])).rows[0];ensure(own,'FORBIDDEN','Só o proprietário corrige esta fonte.',403);
   const meta={...current.metadata,...args.metadata};
   const body=args.blocks?await putFile(identity,Buffer.from(JSON.stringify({blocks})),'application/json'):{path:current.body_file,sha256:current.sha256};
   const q=await db.query('update um.sources set revision=revision+1,body_file=$2,metadata=$4 where id=$1 and revision=$3 returning revision',[args.sourceId,body.path,args.expectedRevision,JSON.stringify(meta)]);ensure(q.rowCount,'CONFLICT','Fonte mudou.',409);
   if('bytes' in body)await fileRow(db,identity,body,{sourceId:args.sourceId},meta.rights.offlineAllowed);
   await db.query('insert into um.source_revisions(source_id,revision,body_file,sha256,metadata,change_reason) values($1,$2,$3,$4,$5,$6)',[args.sourceId,q.rows[0].revision,body.path,body.sha256,JSON.stringify(meta),args.reason]);
   await indexSource(db,identity,args.sourceId,q.rows[0].revision,blocks,meta.rights.offlineAllowed);
   return {sourceId:args.sourceId,revision:q.rows[0].revision,anchorsRequireReview:true};
  }));
 }
 // Authenticate and check capability before contacting an external source.
 const intent={metadata:args.metadata,format:args.format,text:args.text,url:args.url,blocks:args.blocks,webInclusionConfirmed:args.webInclusionConfirmed,...(args.file?{fileId:args.file.file_id}: {})};
 const replay=await transaction(identity,db=>priorOperation(db,identity,args.operationId,task,intent));if(replay)return replay;
 ensure(args.format!=='url'||args.webInclusionConfirmed,'INCLUSION_REQUIRED','Confirme a inclusão da fonte encontrada antes de incorporá-la.',409);
 ensure([args.file!==undefined,args.text!==undefined,args.url!==undefined,args.blocks!==undefined].filter(Boolean).length===1,'VALIDATION','Forneça exatamente um material.');
 const acquired=args.file?await hostFile(args.file):null;
 const extraction=await extract({format:args.format,text:args.text,url:args.url,blocks:args.blocks,filename:acquired?.name,...(acquired?{file_base64:acquired.bytes.toString('base64')}:{})} satisfies ImportInput);
 requireReadable(extraction.quality);
 const sha256=hashBytes(extraction.original);
 return transaction(identity,db=>operation(db,identity,args.operationId,task,intent,async()=>{
  const prior=await db.query('select id,revision from um.sources where owner_id=$1 and sha256=$2',[identity.id,sha256]);
  if(prior.rowCount)return {sourceId:prior.rows[0].id,revision:prior.rows[0].revision,reused:true};
  const sourceId=randomUUID(),blocks=extraction.blocks.map(b=>({...b,id:randomUUID()}));
  const body=await putFile(identity,Buffer.from(JSON.stringify({blocks})),'application/json'),original=await putFile(identity,extraction.original,extraction.mime);
  const meta={...args.metadata,extraction:extraction.quality,canonicalHash:extraction.canonical_hash,origin:acquired?{kind:'chatgpt_file',fileId:acquired.fileId}:args.url?{kind:'web',url:args.url,decision:'included'}:{kind:'provided'}};
  await db.query('insert into um.sources(id,owner_id,sha256,metadata,body_file,original_file) values($1,$2,$3,$4,$5,$6)',[sourceId,identity.id,sha256,JSON.stringify(meta),body.path,original.path]);
  await db.query('insert into um.source_revisions(source_id,revision,body_file,sha256,metadata) values($1,1,$2,$3,$4)',[sourceId,body.path,body.sha256,JSON.stringify(meta)]);
  await fileRow(db,identity,body,{sourceId},args.metadata.rights.offlineAllowed);await fileRow(db,identity,original,{sourceId},args.metadata.rights.offlineAllowed);
  await indexSource(db,identity,sourceId,1,blocks as SourceBlock[],args.metadata.rights.offlineAllowed);
  return {sourceId,revision:1,reused:false,extraction:extraction.quality};
 }));
}
