import {z} from 'zod';
import {id,revision,anchorSchema,type Identity,type Choice,type Attempt} from './contracts.ts';
import {transaction,operation} from './db.ts';
import {ensure} from './errors.ts';
import {published,content} from './publication.ts';
import {sourceView} from './sources.ts';
import {validateAnchor,reanchor} from './anchors.ts';
import {makeAttempt,repeatChoices} from './editorial.ts';

const scope={projectId:id,profileId:id};
const write={operationId:id,...scope};
const page={offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(30)};
const tab=z.strictObject({id,kind:z.enum(['unit','resource','sources','source']),title:z.string().min(1).max(500),objectId:id,revision,position:z.number().finite().nonnegative(),origin:anchorSchema.nullable(),anchor:anchorSchema.nullable(),anchorStatus:z.enum(['verified','needs_review']).optional()});
const readerState=z.strictObject({...scope,unitId:id,tabs:z.array(tab).max(40),activeTabId:id,revision});
export const readerSchemas={
 reader_records:z.strictObject({...scope,kind:z.enum(['state','draft','note','term','attempt','time']),...page}),
 reader_state_save:z.strictObject({...write,recordId:id,expectedRevision:z.number().int().nonnegative(),state:readerState}),
 note_save:z.strictObject({...write,recordId:id,expectedRevision:z.number().int().nonnegative(),anchor:anchorSchema,text:z.string().min(1).max(30000)}),
 note_share:z.strictObject({...write,recordId:id,expectedRevision:revision}),
 term_save:z.strictObject({...write,recordId:id,expectedRevision:z.number().int().nonnegative(),anchor:anchorSchema,term:z.string().min(1).max(500),definition:z.string().min(1).max(12000)}),
 record_delete:z.strictObject({...write,recordId:id,expectedRevision:revision}),
 time_record:z.strictObject({...write,unitId:id,seconds:z.number().int().min(0).max(3600),mode:z.enum(['reading','practice','exploration']).default('reading'),event:z.enum(['open','interval','pause','resume','unit_change','close']).default('interval')}),
 attempt_submit:z.strictObject({...write,bundleRevision:revision,questionId:id,questionRevision:revision,optionId:z.string().min(1).max(100),sequenceId:id,createdAt:z.iso.datetime()}),
 choice_sequence:z.strictObject({...scope,errorsOnly:z.boolean(),unitId:id.optional()}),
 reader_rebase:z.strictObject({...write,expectedBaseRevision:revision}),
 comment_list:z.strictObject({projectId:id,...page}),
 comment_add:z.strictObject({operationId:id,projectId:id,profileId:id.optional(),commentId:id,target:anchorSchema,text:z.string().min(1).max(20000),replyTo:id.nullable().default(null)}),
 comment_edit:z.strictObject({operationId:id,projectId:id,commentId:id,expectedRevision:revision,text:z.string().min(1).max(20000)}),
 comment_remove:z.strictObject({operationId:id,projectId:id,commentId:id,expectedRevision:revision}),
 observation_list:z.strictObject({projectId:id,...page}),
 observation_add:z.strictObject({operationId:id,projectId:id,profileId:id.optional(),observationId:id,target:anchorSchema,text:z.string().min(1).max(20000)}),
 observation_resolve:z.strictObject({operationId:id,projectId:id,observationId:id,status:z.enum(['addressed','unchanged']),result:z.string().min(1).max(20000)}),
};
export const readerReadTasks=new Set(['reader_records','choice_sequence','comment_list','observation_list']);
export async function readerTask(identity:Identity,task:keyof typeof readerSchemas,input:unknown):Promise<unknown>{
 const a=readerSchemas[task].parse(input) as any;
 const scopeAllowed=await transaction(identity,async db=>(await db.query('select um.project_access($1) as project,um.project_owner($1) as owner,case when $2::uuid is null then true else um.profile_holder($2) and exists(select 1 from um.participations where project_id=$1 and profile_id=$2) end as profile',[a.projectId,a.profileId??null])).rows[0]);
 ensure(scopeAllowed.project&&scopeAllowed.profile,'NOT_FOUND','Estudo ou perfil indisponível.',404);
 if(task==='comment_add'||task==='observation_add')ensure(a.profileId||scopeAllowed.owner,'VALIDATION','Informe o perfil associado ao estudo.');
 if(task==='choice_sequence'){
  const manifest=await published(identity,a.projectId,a.profileId);const questions:Choice[]=[];
  for(const i of manifest.index.filter(x=>x.kind==='choice'&&(!a.unitId||x.unitId===a.unitId)))questions.push(await content(identity,manifest,i.id));
  const attempts=await transaction(identity,async db=>(await db.query("select data from um.reader_records where project_id=$1 and profile_id=$2 and kind='attempt' order by data->>'createdAt',id",[a.projectId,a.profileId])).rows.map(r=>r.data as Attempt));
  return {revision:manifest.revision,questions:repeatChoices(questions,attempts,a.errorsOnly)};
 }
 let attempt:Attempt|undefined;
 if(task==='attempt_submit'){
  const manifest=await published(identity,a.projectId,a.profileId,a.bundleRevision),q=await content(identity,manifest,a.questionId) as Choice;
  ensure(q.revision===a.questionRevision,'CONFLICT','Revisão da questão não corresponde ao pacote.',409);
  ensure(Date.parse(a.createdAt)<=Date.now()+300000,'VALIDATION','Data da tentativa está no futuro.');
  attempt=makeAttempt(q,a.optionId,a.profileId,a.sequenceId,a.operationId,a.createdAt);
 }
 if(a.anchor||a.target){const anchor=a.anchor||a.target;const source=await sourceView(identity,anchor.sourceId,anchor.sourceRevision);validateAnchor(anchor,source);const related=await transaction(identity,async db=>(await db.query('select 1 from um.project_sources where project_id=$1 and source_id=$2',[a.projectId,anchor.sourceId])).rowCount);ensure(related,'SOURCE_REQUIRED','A passagem não pertence ao estudo.');}
 if(task==='reader_state_save'){ensure(a.state.profileId===a.profileId&&a.state.projectId===a.projectId,'VALIDATION','Estado pertence a outro estudo.');ensure(a.state.tabs.some((t:any)=>t.id===a.state.activeTabId),'VALIDATION','Aba ativa inexistente.');ensure(new Set(a.state.tabs.map((t:any)=>t.id)).size===a.state.tabs.length,'VALIDATION','Abas duplicadas.');}
 if(task==='reader_rebase'){
  const manifest=await published(identity,a.projectId,null,a.expectedBaseRevision),sourceMap=new Map<string,Awaited<ReturnType<typeof sourceView>>>();
  for(const [sourceId,v]of Object.entries(manifest.sourceRevisions))sourceMap.set(sourceId,await sourceView(identity,sourceId,v));
  return transaction(identity,db=>operation(db,identity,a.operationId,task,a,async()=>{
   const current=(await db.query('select active_revision from um.projects where id=$1 for update',[a.projectId])).rows[0];
   ensure(current?.active_revision===a.expectedBaseRevision,'STALE_BASE','A publicação mudou durante a atualização. Retome para conferir a nova revisão.',409);
   const records=(await db.query("select * from um.reader_records where project_id=$1 and profile_id=$2 and kind in ('note','term','state') for update",[a.projectId,a.profileId])).rows;let review=0;
   function updateAnchor(anchor:any){if(!anchor)return {anchor,status:'verified'};const source=sourceMap.get(anchor.sourceId);if(!source){review++;return {anchor,status:'needs_review'};}const result=reanchor(anchor,source);if(result.status==='needs_review'){review++;return {anchor:result.previous,status:result.status};}return result;}
   for(const r of records){const data=structuredClone(r.data);
    if(r.kind==='state')for(const t of data.tabs){const target=updateAnchor(t.anchor),origin=updateAnchor(t.origin);t.anchor=target.anchor;t.origin=origin.anchor;t.anchorStatus=target.status==='needs_review'||origin.status==='needs_review'?'needs_review':'verified';if(t.kind==='source'&&t.anchorStatus==='verified'&&sourceMap.has(t.objectId))t.revision=sourceMap.get(t.objectId)!.revision;else if(t.kind!=='source'&&manifest.index.some(i=>i.id===t.objectId))t.revision=manifest.revision;}
    else {const target=updateAnchor(data.anchor);data.anchor=target.anchor;data.anchorStatus=target.status;}
    await db.query('update um.reader_records set data=$2,revision=revision+1 where id=$1',[r.id,JSON.stringify(data)]);
   }
   return {updated:records.length,needsReview:review,baseRevision:manifest.revision};
  }));
 }
 return transaction(identity,async db=>{
  if(task==='reader_records')return {items:(await db.query('select id,revision,data from um.reader_records where project_id=$1 and profile_id=$2 and kind=$3 order by id limit $4 offset $5',[a.projectId,a.profileId,a.kind,a.limit,a.offset])).rows,offset:a.offset,limit:a.limit};
  if(task==='comment_list'||task==='observation_list')return {items:(await db.query(`select * from um.${task==='comment_list'?'comments':'observations'} where project_id=$1 order by id limit $2 offset $3`,[a.projectId,a.limit,a.offset])).rows,offset:a.offset,limit:a.limit};
  return operation(db,identity,a.operationId,task,a,async()=>{
   if(task==='note_share'){const note=(await db.query("select data from um.reader_records where id=$1 and project_id=$2 and profile_id=$3 and revision=$4 and kind='note'",[a.recordId,a.projectId,a.profileId,a.expectedRevision])).rows[0];ensure(note,'CONFLICT','Nota mudou. Confira antes de compartilhar.',409);await db.query('insert into um.comments(id,account_id,project_id,target,text,origin_profile_id) values($1,$2,$3,$4,$5,$6)',[a.operationId,identity.id,a.projectId,JSON.stringify(note.data.anchor),note.data.text,a.profileId]);return {commentId:a.operationId};}
   if(task==='comment_add'){if(a.replyTo){const parent=(await db.query('select id from um.comments where id=$1 and project_id=$2 and deleted_at is null',[a.replyTo,a.projectId])).rows[0];ensure(parent,'NOT_FOUND','Comentário de origem indisponível.',404);}await db.query('insert into um.comments(id,account_id,project_id,target,text,reply_to,origin_profile_id) values($1,$2,$3,$4,$5,$6,$7)',[a.commentId,identity.id,a.projectId,JSON.stringify(a.target),a.text,a.replyTo,a.profileId??null]);return {commentId:a.commentId};}
   if(task==='comment_edit'||task==='comment_remove'){const q=task==='comment_edit'?await db.query('update um.comments set text=$3,revision=revision+1 where id=$1 and project_id=$2 and deleted_at is null and revision=$4 returning id,revision',[a.commentId,a.projectId,a.text,a.expectedRevision]):await db.query('update um.comments set deleted_at=now(),revision=revision+1 where id=$1 and project_id=$2 and deleted_at is null and revision=$3 returning id,revision',[a.commentId,a.projectId,a.expectedRevision]);ensure(q.rowCount,'CONFLICT','Comentário indisponível ou alterado em outro dispositivo. Confira antes de editar.',409);return {commentId:a.commentId,revision:q.rows[0].revision};}
   if(task==='observation_add'){await db.query('insert into um.observations(id,account_id,project_id,target,text,origin_profile_id) values($1,$2,$3,$4,$5,$6)',[a.observationId,identity.id,a.projectId,JSON.stringify(a.target),a.text,a.profileId??null]);return {observationId:a.observationId};}
   if(task==='observation_resolve'){const q=await db.query('update um.observations set status=$3,result=$4 where id=$1 and project_id=$2 returning id',[a.observationId,a.projectId,a.status,a.result]);ensure(q.rowCount,'NOT_FOUND','Observação indisponível para revisão.',404);return {observationId:a.observationId};}
   if(task==='record_delete'){const q=await db.query("delete from um.reader_records where id=$1 and project_id=$2 and profile_id=$3 and revision=$4 and kind in ('note','term') returning id",[a.recordId,a.projectId,a.profileId,a.expectedRevision]);ensure(q.rowCount,'CONFLICT','Registro mudou ou não pode ser removido por esta ação.',409);return {recordId:a.recordId,deleted:true};}
   const recordId=a.recordId||a.operationId,kind=task==='reader_state_save'?'state':task==='note_save'?'note':task==='term_save'?'term':task==='attempt_submit'?'attempt':'time';
   const data=kind==='state'?a.state:kind==='note'?{anchor:a.anchor,text:a.text}:kind==='term'?{anchor:a.anchor,term:a.term,definition:a.definition}:kind==='attempt'?attempt:{unitId:a.unitId,seconds:a.seconds,mode:a.mode,event:a.event,createdAt:new Date().toISOString()};
   if((a.expectedRevision??0)===0){const inserted=await db.query('insert into um.reader_records(id,account_id,profile_id,project_id,kind,data) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing returning id',[recordId,identity.id,a.profileId,a.projectId,kind,JSON.stringify(data)]);ensure(inserted.rowCount,'CONFLICT','Registro já existe. Confira a revisão antes de editar.',409);}
   else {const r=await db.query('update um.reader_records set data=$2,revision=revision+1 where id=$1 and revision=$3 and kind=$4 and project_id=$5 and profile_id=$6 returning id',[recordId,JSON.stringify(data),a.expectedRevision,kind,a.projectId,a.profileId]);ensure(r.rowCount,'CONFLICT','Registro alterado em outro dispositivo.',409);}
   return {recordId,revision:(a.expectedRevision||0)+1,...(attempt?{correct:attempt.correct,feedback:attempt.snapshot.options.find(o=>o.id===attempt.optionId)!.feedback}:{})};
  });
 });
}
