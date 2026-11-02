import {z} from 'zod';
import {id,revision,type Identity} from './contracts.ts';
import {unitSchema,resourceSchema,choiceSchema,coverageSchema,reasonSchema,bundleSchema} from './content-schemas.ts';
import {transaction,operation,priorOperation,type Transaction} from './db.ts';
import {ensure} from './errors.ts';
import {getFile,putFile} from './files.ts';
import {fileRow} from './sources.ts';

const kinds=['unit','resource','choice','coverage','reason'] as const;
const item=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('unit'),position:z.number().int().nonnegative(),body:unitSchema}),
 z.strictObject({kind:z.literal('resource'),position:z.number().int().nonnegative(),body:resourceSchema}),
 z.strictObject({kind:z.literal('choice'),position:z.number().int().nonnegative(),body:choiceSchema}),
 z.strictObject({kind:z.literal('coverage'),position:z.number().int().nonnegative(),body:coverageSchema}),
 z.strictObject({kind:z.literal('reason'),position:z.number().int().nonnegative(),body:reasonSchema}),
]);
const page={offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(20).default(10)};
const nextStep=z.string().trim().min(1).max(2000);
export const authoringSchemas={
 authoring_list:z.strictObject({projectId:id,...page}),
 authoring_get:z.strictObject({draftId:id}),
 authoring_items:z.strictObject({draftId:id,expectedRevision:revision,kind:z.enum(kinds).optional(),...page}),
 authoring_create:z.strictObject({operationId:id,projectId:id,profileId:id.nullable(),expectedRevision:z.number().int().nonnegative(),baseRevision:revision,nextStep}),
 authoring_save:z.strictObject({operationId:id,draftId:id,expectedRevision:revision,nextStep,items:z.array(item).max(20).default([]),remove:z.array(z.strictObject({kind:z.enum(kinds),id})).max(20).default([]),inspection:bundleSchema.shape.inspection.optional()}),
 authoring_delete:z.strictObject({operationId:id,draftId:id,expectedRevision:revision}),
};
export const authoringReadTasks=new Set(['authoring_list','authoring_get','authoring_items']);
export async function draftRow(db:Transaction,draftId:string,lock=false){
 const row=(await db.query(`select * from um.authoring_drafts where id=$1${lock?' for update':''}`,[draftId])).rows[0];
 ensure(row,'NOT_FOUND','Preparação indisponível.',404);return row;
}
async function owner(db:Transaction,projectId:string,identity:Identity){
 const p=(await db.query('select * from um.projects where id=$1 for update',[projectId])).rows[0];
 ensure(p?.owner_id===identity.id,'FORBIDDEN','Esta preparação pertence ao autor do projeto.',403);return p;
}
export async function authoringSummary(db:Transaction,projectId:string,offset=0,limit=10){
 const rows=(await db.query('select id,profile_id,revision,expected_revision,base_revision,status,next_step,updated_at from um.authoring_drafts where project_id=$1 order by updated_at desc,id limit $2 offset $3',[projectId,limit,offset])).rows;
 return {items:rows,offset,limit};
}
export async function draftContents(db:Transaction,draft:any,identity:Identity){
 const rows=(await db.query('select kind,id,file_path from um.authoring_items where draft_id=$1 order by position,id',[draft.id])).rows;
 for(const row of rows)row.body=JSON.parse((await getFile(identity,row.file_path)).toString('utf8'));
 const of=(kind:string)=>rows.filter(x=>x.kind===kind).map(x=>x.body);
 return {bundle:bundleSchema.parse({projectId:draft.project_id,profileId:draft.profile_id,revision:draft.expected_revision+1,baseRevision:draft.base_revision,units:of('unit'),resources:of('resource'),choices:of('choice'),coverage:of('coverage'),inspection:draft.inspection}),reasons:of('reason'),files:rows.map(({kind,id,file_path})=>({kind,id,path:file_path}))};
}
export async function authoringTask(identity:Identity,task:keyof typeof authoringSchemas,input:unknown):Promise<unknown>{
 const a=authoringSchemas[task].parse(input) as any;
 return transaction(identity,async db=>{
  if(task==='authoring_delete'){
   const prior=await priorOperation<any>(db,identity,a.operationId,task,a);
   if(prior){if(prior.result.profileId)ensure((await db.query('select um.profile_access($1) as allowed',[prior.result.profileId])).rows[0].allowed,'FORBIDDEN','Perfil sem autorização vigente.',403);return prior;}
  }
  if(task==='authoring_list')return authoringSummary(db,a.projectId,a.offset,a.limit);
  if(task==='authoring_get'){
   const draft=await draftRow(db,a.draftId);
   return {draft,counts:(await db.query('select kind,count(*)::integer as total from um.authoring_items where draft_id=$1 group by kind order by kind',[draft.id])).rows,nextAction:draft.status==='published'?'published':draft.inspection.completed&&!draft.inspection.findings.length?'authoring_publish':'authoring_save'};
  }
  if(task==='authoring_items'){
   const draft=await draftRow(db,a.draftId);ensure(draft.revision===a.expectedRevision,'CONFLICT','A preparação mudou. Releia seu índice.',409);
   const items=(await db.query('select kind,id,position,file_path from um.authoring_items where draft_id=$1 and ($2::text is null or kind=$2) order by kind,position,id limit $3 offset $4',[draft.id,a.kind??null,a.limit,a.offset])).rows;
   for(const item of items)item.body=JSON.parse((await getFile(identity,item.file_path)).toString('utf8'));
   return {revision:draft.revision,items,offset:a.offset,limit:a.limit};
  }
  // Current scope is checked even for a replay; a revoked author cannot recover private drafts.
  const existing=a.draftId?await draftRow(db,a.draftId):null;
  const p=await owner(db,existing?.project_id??a.projectId,identity);
  return operation(db,identity,a.operationId,task,a,async()=>{
   if(task==='authoring_create'){
    const current=(await db.query('select coalesce(max(revision),0)::integer as revision from um.bundles where project_id=$1 and profile_id is not distinct from $2::uuid',[p.id,a.profileId])).rows[0].revision;
    ensure(current===a.expectedRevision,'CONFLICT','A publicação mudou. Releia a revisão.',409);
    ensure(a.profileId?a.baseRevision===p.active_revision:a.baseRevision===current+1,'STALE_BASE','A preparação deve identificar a base corrente.',409);
    if(a.profileId){const part=(await db.query('select p.submission_id,s.form_revision,f.revision from um.participations p join um.submissions s on s.id=p.submission_id join um.forms f on f.id=p.form_id where p.project_id=$1 and p.profile_id=$2',[p.id,a.profileId])).rows[0];ensure(part&&part.form_revision===part.revision,'SUBMISSION_REQUIRED','Aguarde o envio atual do titular.',409);}
    ensure(!(await db.query("select id from um.authoring_drafts where project_id=$1 and profile_id is not distinct from $2::uuid and status='draft'",[p.id,a.profileId])).rowCount,'CONFLICT','Já existe preparação aberta. Retome-a pelo índice.',409);
    const row=(await db.query('insert into um.authoring_drafts(project_id,profile_id,expected_revision,base_revision,next_step,inspection) values($1,$2,$3,$4,$5,$6) returning id',[p.id,a.profileId,a.expectedRevision,a.baseRevision,a.nextStep,JSON.stringify({kind:'ai',references:[],findings:[],completed:false})])).rows[0];
    if(a.profileId)await db.query("update um.participations set state='producing' where project_id=$1 and profile_id=$2",[p.id,a.profileId]);
    else await db.query("update um.projects set base_state=case when active_revision is null then 'producing' else 'correcting' end where id=$1",[p.id]);
    return {draftId:row.id,projectId:p.id,profileId:a.profileId,revision:1};
   }
   const draft=await draftRow(db,a.draftId,true);
   ensure(draft.revision===a.expectedRevision,'CONFLICT','A preparação mudou. Releia antes de editar.',409);
   ensure(draft.status==='draft','IMMUTABLE_PUBLICATION','Esta preparação já foi publicada. Abra outra revisão.',409);
   if(task==='authoring_delete'){
    await db.query('delete from um.authoring_drafts where id=$1',[draft.id]);
    if(draft.profile_id)await db.query("update um.participations set state=case when active_revision is null then 'submitted' when exists(select 1 from um.bundles b where b.project_id=$1 and b.profile_id=$2 and b.revision=active_revision and b.base_revision=$3) then 'available' else 'stale' end where project_id=$1 and profile_id=$2",[p.id,draft.profile_id,p.active_revision]);
    else await db.query("update um.projects set base_state=case when active_revision is null then 'preparing' else 'available' end where id=$1",[p.id]);
    return {draftId:draft.id,projectId:p.id,profileId:draft.profile_id,deleted:true};
   }
   for(const item of a.remove)await db.query('delete from um.authoring_items where draft_id=$1 and kind=$2 and id=$3',[draft.id,item.kind,item.id]);
   for(const item of a.items){
    const body=item.body;
    if(item.kind==='resource')ensure(body.projectId===p.id&&body.profileId===draft.profile_id&&body.baseRevision===draft.base_revision,'SCOPE','Recurso fora do alcance desta preparação.');
    if(item.kind==='choice')ensure(body.profileId===draft.profile_id,'SCOPE','Prática fora do alcance desta preparação.');
    ensure(item.kind!=='reason'||draft.profile_id,'PRIVATE_REASON','Justificativa pessoal não pertence ao padrão.');
    const file=await putFile(identity,Buffer.from(JSON.stringify(body)),'application/json');
    const rights=(await db.query("select coalesce(bool_and((s.metadata->'rights'->>'offlineAllowed')::boolean),false) as allowed from um.project_sources ps join um.sources s on s.id=ps.source_id where ps.project_id=$1",[p.id])).rows[0].allowed;
    await fileRow(db,identity,file,{projectId:p.id,...(draft.profile_id?{profileId:draft.profile_id}:{})},rights,'prepared');
    await db.query('insert into um.authoring_items(draft_id,kind,id,position,file_path) values($1,$2,$3,$4,$5) on conflict(draft_id,kind,id) do update set position=excluded.position,file_path=excluded.file_path',[draft.id,item.kind,body.id??body.resourceId,item.position,file.path]);
   }
   const limits:Record<string,number>={unit:1000,resource:2000,choice:2000,coverage:2000,reason:4000};
   for(const row of (await db.query('select kind,count(*)::integer as total from um.authoring_items where draft_id=$1 group by kind',[draft.id])).rows)ensure(row.total<=limits[row.kind],'LIMIT','Preparação excede o limite desta espécie.');
   // Any content change invalidates the previous inspection unless an explicit new inspection accompanies it.
   const inspection=a.inspection??(a.items.length||a.remove.length?{kind:'ai',references:[],findings:[],completed:false}:draft.inspection);
   await db.query('update um.authoring_drafts set revision=revision+1,next_step=$2,inspection=$3,updated_at=now() where id=$1',[draft.id,a.nextStep,JSON.stringify(inspection)]);
   return {draftId:draft.id,projectId:p.id,profileId:draft.profile_id,revision:draft.revision+1};
  });
 });
}
