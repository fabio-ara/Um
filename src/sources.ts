import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {id,revision,type Identity,type SourceBlock} from './contracts.ts';
import {transaction,operation,type Transaction} from './db.ts';
import {ensure} from './errors.ts';
import {extract,type ImportInput} from './importers.ts';
import {blockSchema} from './ingestion/contracts.ts';
import {requireReadable} from './ingestion/quality.ts';
import {getFile,putFile,hostFileSchema,hostFile,hashBytes} from './files.ts';
const page={offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)};
const metadata=z.strictObject({title:z.string().min(1).max(500),language:z.string().min(2).max(40),nature:z.enum(['original','translation','commentary','bibliography']),extent:z.enum(['full','fragment','reference']),workId:id.nullable().default(null),editionId:id.nullable().default(null),authors:z.array(z.strictObject({name:z.string().min(1).max(300),role:z.enum(['author','translator','editor','commentator'])})).max(40).default([]),rights:z.strictObject({status:z.enum(['public-domain','licensed','permission','private-use']),statement:z.string().min(1).max(2000),evidence:z.string().min(1).max(2000),offlineAllowed:z.boolean()}),provenance:z.string().min(1).max(2000)});
export const sourceSchemas={
 source_list:z.strictObject({query:z.string().max(200).default(''),...page}),
 source_get:z.strictObject({sourceId:id,sourceRevision:revision.optional(),...page}),
 source_import:z.strictObject({operationId:id,metadata,format:z.enum(['text','markdown','html','pdf','docx','pptx','epub','url','structured']),text:z.string().max(4000000).optional(),file:hostFileSchema.optional(),url:z.url().max(2000).optional(),blocks:z.array(blockSchema).max(20000).optional(),webInclusionConfirmed:z.boolean().default(false)}),
 source_attach:z.strictObject({operationId:id,projectId:id,sourceId:id}),
 source_revise:z.strictObject({operationId:id,sourceId:id,expectedRevision:revision,blocks:z.array(z.strictObject({id:z.string().min(1).max(500),...blockSchema.shape})).min(1).max(20000),reason:z.string().min(1).max(2000)}),
};
export const sourceReadTasks=new Set(['source_list','source_get']);
export async function fileRow(db:Transaction,identity:Identity,file:Awaited<ReturnType<typeof putFile>>,scope:{sourceId?:string;projectId?:string;profileId?:string},offlineAllowed:boolean,state:'prepared'|'published'='published'){
 await db.query('insert into um.files(path,owner_id,source_id,project_id,profile_id,sha256,bytes,media_type,offline_allowed,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[file.path,identity.id,scope.sourceId||null,scope.projectId||null,scope.profileId||null,file.sha256,file.bytes,file.mediaType,offlineAllowed,state]);
}
export async function sourceView(identity:Identity,sourceId:string,sourceRevision?:number){
 const row=await transaction(identity,async db=>{
  const current=(await db.query('select * from um.sources where id=$1',[sourceId])).rows[0];ensure(current,'NOT_FOUND','Fonte indisponível.',404);
  if(sourceRevision!==undefined&&sourceRevision!==current.revision){const old=(await db.query('select * from um.source_revisions where source_id=$1 and revision=$2',[sourceId,sourceRevision])).rows[0];ensure(old,'NOT_FOUND','Revisão indisponível.',404);return {...current,...old};}return current;
 });
 const body=JSON.parse((await getFile(identity,row.body_file)).toString('utf8'));
 return {id:sourceId,revision:row.revision,blocks:body.blocks as SourceBlock[],metadata:row.metadata,sha256:row.sha256};
}
export async function sourceTask(identity:Identity,task:keyof typeof sourceSchemas,input:unknown):Promise<unknown>{
 const args=sourceSchemas[task].parse(input) as any;
 if(task==='source_list')return transaction(identity,async db=>({items:(await db.query("select id,revision,metadata,sha256 from um.sources where metadata->>'title' ilike $1 order by id limit $2 offset $3",[`%${args.query}%`,args.limit,args.offset])).rows,offset:args.offset,limit:args.limit}));
 if(task==='source_get'){const source=await sourceView(identity,args.sourceId,args.sourceRevision);return {...source,blocks:source.blocks.slice(args.offset,args.offset+args.limit),total:source.blocks.length,offset:args.offset,complete:args.offset===0&&source.blocks.length<=args.limit};}
 if(task==='source_attach')return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{await db.query('insert into um.project_sources(project_id,source_id) values($1,$2) on conflict do nothing',[args.projectId,args.sourceId]);return {projectId:args.projectId,sourceId:args.sourceId};}));
 if(task==='source_revise'){
  const current=await sourceView(identity,args.sourceId);
  ensure(new Set(args.blocks.map((b:SourceBlock)=>b.id)).size===args.blocks.length,'VALIDATION','Identidades de bloco repetidas.');
  return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>{
   const own=(await db.query('select id from um.sources where id=$1 and owner_id=$2 for update',[args.sourceId,identity.id])).rows[0];ensure(own,'FORBIDDEN','Só o proprietário corrige esta fonte.',403);
   const body=await putFile(identity,Buffer.from(JSON.stringify({blocks:args.blocks})),'application/json');
   const q=await db.query('update um.sources set revision=revision+1,body_file=$2 where id=$1 and revision=$3 returning revision',[args.sourceId,body.path,args.expectedRevision]);ensure(q.rowCount,'CONFLICT','Fonte mudou.',409);
   await fileRow(db,identity,body,{sourceId:args.sourceId},current.metadata.rights.offlineAllowed);
   await db.query('insert into um.source_revisions(source_id,revision,body_file,sha256) values($1,$2,$3,$4)',[args.sourceId,q.rows[0].revision,body.path,body.sha256]);
   await db.query("update um.projects set base_state='correcting',revision=revision+1 where id in (select project_id from um.project_sources where source_id=$1)",[args.sourceId]);
   return {sourceId:args.sourceId,revision:q.rows[0].revision,anchorsRequireReview:true};
  }));
 }
 // Authenticate and check capability before contacting an external source.
 await transaction(identity,async()=>ensure(identity.permission==='write','FORBIDDEN','Cliente sem escrita.',403));
 ensure(args.format!=='url'||args.webInclusionConfirmed,'INCLUSION_REQUIRED','Confirme a inclusão da fonte encontrada antes de incorporá-la.',409);
 ensure([args.file!==undefined,args.text!==undefined,args.url!==undefined,args.blocks!==undefined].filter(Boolean).length===1,'VALIDATION','Forneça exatamente um material.');
 const acquired=args.file?await hostFile(args.file):null;
 const extraction=await extract({format:args.format,text:args.text,url:args.url,blocks:args.blocks,filename:acquired?.name,...(acquired?{file_base64:acquired.bytes.toString('base64')}:{})} satisfies ImportInput);
 requireReadable(extraction.quality);
 const sha256=hashBytes(extraction.original),intent={metadata:args.metadata,format:args.format,sha256};
 return transaction(identity,db=>operation(db,identity,args.operationId,task,intent,async()=>{
  const prior=await db.query('select id,revision from um.sources where owner_id=$1 and sha256=$2',[identity.id,sha256]);
  if(prior.rowCount)return {sourceId:prior.rows[0].id,revision:prior.rows[0].revision,reused:true};
  const sourceId=randomUUID(),blocks=extraction.blocks.map(b=>({...b,id:randomUUID()}));
  const body=await putFile(identity,Buffer.from(JSON.stringify({blocks})),'application/json'),original=await putFile(identity,extraction.original,extraction.mime);
  const meta={...args.metadata,extraction:extraction.quality,canonicalHash:extraction.canonical_hash,origin:acquired?{kind:'chatgpt_file',fileId:acquired.fileId}:args.url?{kind:'web',url:args.url,decision:'included'}:{kind:'provided'}};
  await db.query('insert into um.sources(id,owner_id,sha256,metadata,body_file,original_file) values($1,$2,$3,$4,$5,$6)',[sourceId,identity.id,sha256,JSON.stringify(meta),body.path,original.path]);
  await db.query('insert into um.source_revisions values($1,1,$2,$3)',[sourceId,body.path,body.sha256]);
  await fileRow(db,identity,body,{sourceId},args.metadata.rights.offlineAllowed);await fileRow(db,identity,original,{sourceId},args.metadata.rights.offlineAllowed);
  return {sourceId,revision:1,reused:false,extraction:extraction.quality};
 }));
}
