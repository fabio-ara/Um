import {z} from 'zod';
import {id,revision,type Identity,type LibraryEntity,type LibraryRelation,type CatalogEntry} from './contracts.ts';
import {transaction,operation,type Transaction,contentHash} from './db.ts';
import {ensure} from './errors.ts';
import {effectiveCatalog} from './editorial.ts';
import {filterLibrary,documentedLocations,graphPage,renameLabel,mergeEntities,splitEntity} from './library.ts';
const text=z.string().trim().min(1).max(4000),ids=z.array(id).max(1000),strings=z.array(text).max(1000);
export const entitySchema=z.strictObject({id,kind:z.enum(['author','work','edition','concept','place','period','tradition','discipline','art']),labels:z.record(z.string().min(2).max(40),text),aliases:strings,authorIds:ids,authorship:z.enum(['individual','multiple','collective','attributed','unknown']).optional(),regions:ids,traditions:ids,disciplines:ids,periods:ids,dates:z.strictObject({start:z.number().int().nullable(),end:z.number().int().nullable(),approximate:z.boolean(),original:text.optional(),evidence:text.optional()}),locations:z.array(z.strictObject({lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),role:z.enum(['birth','activity','composition','conservation']),evidence:text,dates:text.optional()})).max(100),metadata:z.record(z.string(),z.unknown())});
export const relationSchema=z.strictObject({id,from:id,to:id,type:z.enum(['influence','reception','criticism','opposition','continuity','affinity','broader','exactMatch','closeMatch']),evidence:strings.min(1)});
const entrySchema=z.strictObject({id,kind:z.enum(['method','resource']),name:text,purpose:text,conditions:strings,limits:strings,instructions:text.max(20000),references:strings.min(1),type:text.max(100),revision,disabled:z.boolean().optional()});
const filters=z.strictObject({query:z.string().max(200).optional(),language:z.string().max(40).optional(),kinds:z.array(entitySchema.shape.kind).optional(),regions:ids.optional(),traditions:ids.optional(),disciplines:ids.optional(),periods:ids.optional(),authorIds:ids.optional(),fromYear:z.number().int().optional(),toYear:z.number().int().optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)});
export const catalogSchemas={
 catalog_list:z.strictObject({kind:z.enum(['method','resource']).optional()}),
 catalog_save:z.strictObject({operationId:id,entry:entrySchema,expectedRevision:z.number().int().nonnegative()}),
 catalog_reset:z.strictObject({operationId:id,entryId:id}),
 library_search:filters,
 library_get:z.strictObject({entityId:id}),
 library_save:z.strictObject({operationId:id,entity:entitySchema,expectedRevision:z.number().int().nonnegative()}),
 library_relation_save:z.strictObject({operationId:id,relation:relationSchema,expectedRevision:z.number().int().nonnegative()}),
 library_remove:z.strictObject({operationId:id,entityId:id,expectedRevision:z.number().int().nonnegative()}),
 library_relation_remove:z.strictObject({operationId:id,relationId:id,expectedRevision:z.number().int().nonnegative()}),
 library_rename:z.strictObject({operationId:id,entityId:id,language:z.string().min(2).max(40),label:text,expectedRevision:z.number().int().nonnegative()}),
 library_merge:z.strictObject({operationId:id,fromIds:ids.min(1),targetId:id}),
 library_split:z.strictObject({operationId:id,sourceId:id,replacements:z.array(entitySchema).min(2).max(30),assignments:z.record(id,id)}),
 library_map:filters,
 library_graph:z.strictObject({entityIds:ids.min(1).max(100),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)}),
};
export const catalogReadTasks=new Set(['catalog_list','library_search','library_get','library_map','library_graph']);
async function rows(db:Transaction){const q=await db.query('select id,account_id,kind,revision,data from um.catalog order by account_id nulls first,id limit 20001');ensure(q.rows.length<=20000,'CATALOG_LIMIT','Acervo excede o limite desta versão; reduza o catálogo ativo.',409);return q.rows;}
function effective(all:any[]){const byId=new Map<string,any>();for(const row of all)byId.set(row.id,row);return [...byId.values()].filter(r=>!r.data.disabled&&!r.data.metadata?.hidden);}
async function save(db:Transaction,identity:Identity,entryId:string,kind:string,data:unknown,expected?:number){
 const prior=(await db.query('select kind,revision from um.catalog where id=$1 and account_id=$2 for update',[entryId,identity.id])).rows[0];
 ensure(!prior||prior.kind===kind,'KIND','Identidade pertence a outro tipo.');
 if(expected!==undefined)ensure((prior?.revision||0)===expected,'CONFLICT','Entrada foi alterada. Releia antes de editar.',409);
 const next=(prior?.revision||0)+1;
 await db.query('insert into um.catalog(id,account_id,kind,revision,data) values($1,$2,$3,$4,$5) on conflict(id,account_id) do update set revision=excluded.revision,data=excluded.data',[entryId,identity.id,kind,next,JSON.stringify(data)]);return next;
}
export async function catalogTask(identity:Identity,task:keyof typeof catalogSchemas,input:unknown):Promise<unknown>{
 const a=catalogSchemas[task].parse(input) as any;
 return transaction(identity,async db=>{
  if(!catalogReadTasks.has(task))await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`catalog:${identity.id}`]);
  const all=await rows(db),entries=effective(all),entities=entries.filter(r=>r.kind==='entity').map(r=>r.data as LibraryEntity),relations=entries.filter(r=>r.kind==='relation').map(r=>r.data as LibraryRelation);
  if(task==='catalog_list'){const list=effectiveCatalog(all.filter(r=>r.account_id===null&&['method','resource'].includes(r.kind)).map(r=>r.data),all.filter(r=>r.account_id!==null&&['method','resource'].includes(r.kind)).map(r=>r.data));return {items:list.filter(r=>!a.kind||r.kind===a.kind)};}
  if(task==='library_search')return filterLibrary(entities,a);
  if(task==='library_map'){const page=filterLibrary(entities,a);return {...page,locations:documentedLocations(page.items)};}
  if(task==='library_graph')return graphPage(entities,relations,a.entityIds,a.offset,a.limit);
  if(task==='library_get'){const r=entries.find(r=>r.id===a.entityId&&r.kind==='entity');ensure(r,'NOT_FOUND','Entidade indisponível.',404);return {entity:r.data,revision:r.account_id? r.revision:0,globalRevision:r.account_id?null:r.revision,relations:relations.filter(e=>e.from===r.id||e.to===r.id)};}
  return operation(db,identity,a.operationId,task,a,async()=>{
   // Serialize changes to each author's effective graph, including multi-object rewrites.
   await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`catalog:${identity.id}`]);
   if(task==='catalog_save'){const base=all.find(r=>r.id===a.entry.id&&r.account_id===null);ensure(!base||base.kind===a.entry.kind,'KIND','Não é permitido mudar o tipo da entrada comum.');const r=await save(db,identity,a.entry.id,a.entry.kind,a.entry,a.expectedRevision);return {entryId:a.entry.id,revision:r};}
   if(task==='catalog_reset'){await db.query("delete from um.catalog where id=$1 and account_id=$2 and kind in ('method','resource')",[a.entryId,identity.id]);return {entryId:a.entryId,reset:true};}
   if(task==='library_save'){ensure(Object.keys(a.entity.labels).length,'LABEL','Entidade exige rótulo.');if(a.entity.kind==='art')ensure(a.entity.metadata.rights&&a.entity.metadata.credit&&a.entity.metadata.source,'RIGHTS','Imagem exige direitos, crédito e fonte.');const r=await save(db,identity,a.entity.id,'entity',a.entity,a.expectedRevision);return {entityId:a.entity.id,revision:r};}
   if(task==='library_relation_save'){ensure(a.relation.from!==a.relation.to&&[a.relation.from,a.relation.to].every(x=>entities.some(e=>e.id===x)),'REFERENCE','Relação exige duas entidades existentes.');const r=await save(db,identity,a.relation.id,'relation',a.relation,a.expectedRevision);return {relationId:a.relation.id,revision:r};}
   if(task==='library_relation_remove'||task==='library_remove'){
    const target=a.entityId||a.relationId,row=entries.find(r=>r.id===target);ensure(row,'NOT_FOUND','Entrada indisponível.',404);
    if(task==='library_remove')ensure(!relations.some(r=>r.from===target||r.to===target)&&!entities.some(e=>[...e.authorIds,...e.regions,...e.traditions,...e.disciplines,...e.periods].includes(target)),'DEPENDENCIES','Remova ou redirecione os vínculos antes de excluir.',409);
    const r=await save(db,identity,target,row.kind,{...row.data,disabled:true,metadata:{...row.data.metadata,hidden:true}},a.expectedRevision);return {entryId:target,revision:r,removed:true};
   }
   if(task==='library_rename'){const e=entities.find(e=>e.id===a.entityId);ensure(e,'NOT_FOUND','Entidade indisponível.',404);const r=await save(db,identity,e.id,'entity',renameLabel(e,a.language,a.label),a.expectedRevision);return {entityId:e.id,revision:r};}
   const result=task==='library_merge'?mergeEntities(entities,relations,a.fromIds,a.targetId):splitEntity(entities,relations,a.sourceId,a.replacements,a.assignments);
   for(const e of result.entities)if(contentHash(entities.find(x=>x.id===e.id))!==contentHash(e))await save(db,identity,e.id,'entity',e);
   for(const r of result.relations)if(contentHash(relations.find(x=>x.id===r.id))!==contentHash(r))await save(db,identity,r.id,'relation',r);
   for(const e of entities)if(!result.entities.some(x=>x.id===e.id))await save(db,identity,e.id,'entity',{...e,metadata:{...e.metadata,hidden:true,...(task==='library_merge'?{redirect:a.targetId}:{splitInto:a.replacements.map((x:LibraryEntity)=>x.id)})}});
   for(const r of relations)if(!result.relations.some(x=>x.id===r.id))await save(db,identity,r.id,'relation',{...r,disabled:true});
   return {changed:true,entityIds:result.entities.map(e=>e.id),...(task==='library_merge'?{redirects:(result as any).redirects}:{})};
  });
 });
}
