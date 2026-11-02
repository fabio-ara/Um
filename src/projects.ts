import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {id,revision,type Identity,type FormDefinition,type Project} from './contracts.ts';
import {transaction,operation,type Transaction} from './db.ts';
import {ensure} from './errors.ts';
import {validateForm,validateSubmission,effectiveAnswers,visibleQuestions} from './forms.ts';

const short=z.string().trim().min(1).max(2000);
const page={offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)};
const configuration=z.strictObject({editorial:z.record(z.string(),z.unknown()),instructional:z.record(z.string(),z.unknown())});
const metadata=z.strictObject({object:z.strictObject({kind:z.enum(['work','theme']),workIds:z.array(id).max(100),subject:short}),scope:short,language:z.string().min(2).max(40),audience:short,configuration});
const question=z.strictObject({id:short,type:z.enum(['single_choice','multiple_choice','text']),prompt:short,required:z.boolean(),options:z.array(z.strictObject({id:short,label:short})).max(100).optional(),showWhen:z.strictObject({questionId:short,operator:z.enum(['equals','in','present']),values:z.array(z.string()).optional()}).optional(),familiarityReferences:z.array(short).max(50).optional()});
const definition=z.strictObject({id,revision,projectId:id,profileId:id,questions:z.array(question).max(64),purposeByQuestion:z.record(z.string(),short),planningReference:short,maxQuestions:z.number().int().min(1).max(32)});
const answers=z.record(z.string(),z.union([z.string().max(20000),z.array(z.string().max(2000)).max(100)]));
export const projectSchemas={
 project_list:z.strictObject({...page,query:z.string().max(200).default('')}),
 project_get:z.strictObject({projectId:id}),
 project_create:z.strictObject({operationId:id,title:short,metadata}),
 project_update:z.strictObject({operationId:id,projectId:id,expectedRevision:revision,title:short.optional(),metadata:metadata.partial().optional()}),
 project_delete:z.strictObject({operationId:id,projectId:id,expectedRevision:revision}),
 participation_add:z.strictObject({operationId:id,projectId:id,profileId:id}),
 participation_remove:z.strictObject({operationId:id,projectId:id,profileId:id}),
 form_save:z.strictObject({operationId:id,expectedRevision:z.number().int().nonnegative(),definition}),
 form_publish:z.strictObject({operationId:id,formId:id,expectedRevision:revision}),
 form_get:z.strictObject({formId:id}),
 form_draft:z.strictObject({operationId:id,formId:id,formRevision:revision,answers,expectedRevision:z.number().int().nonnegative()}),
 form_submit:z.strictObject({operationId:id,formId:id,formRevision:revision,answers}),
 submission_get:z.strictObject({submissionId:id}),
 submission_list:z.strictObject({projectId:id,profileId:id,...page}),
};
export const projectReadTasks=new Set(['project_list','project_get','form_get','submission_get','submission_list']);
export async function projectRow(db:Transaction,projectId:string):Promise<Project>{
 const row=(await db.query('select * from um.projects where id=$1',[projectId])).rows[0];ensure(row,'NOT_FOUND','Projeto indisponível.',404);
 const sources=await db.query('select source_id from um.project_sources where project_id=$1 order by source_id',[projectId]);
 return {...row.metadata,id:row.id,ownerId:row.owner_id,title:row.title,revision:row.revision,activeRevision:row.active_revision,baseState:row.base_state,sourceIds:sources.rows.map(s=>s.source_id)};
}
async function requireOwner(db:Transaction,projectId:string,identity:Identity){const p=await projectRow(db,projectId);ensure(p.ownerId===identity.id,'FORBIDDEN','Esta ação pertence ao autor do projeto.',403);return p;}
async function formRow(db:Transaction,formId:string){const row=(await db.query('select * from um.forms where id=$1',[formId])).rows[0];ensure(row,'NOT_FOUND','Formulário indisponível.',404);return row;}
function nextAction(p:Project,part:any){
 if(!part.form_id)return 'prepare_form';
 if(!part.form_published)return 'publish_form';
 if(!part.submission_id||part.form_revision!==part.submitted_form_revision)return 'await_submission';
 if(part.state==='available'&&p.activeRevision&&part.active_revision)return 'study';
 return p.activeRevision?'prepare_personal_content':'prepare_standard';
}
export async function projectTask(identity:Identity,task:keyof typeof projectSchemas,input:unknown):Promise<unknown>{
 const a=projectSchemas[task].parse(input) as any;
 return transaction(identity,async db=>{
  if(task==='project_list')return {items:(await db.query("select id,title,metadata,revision,active_revision,base_state from um.projects where title ilike $1 order by title,id limit $2 offset $3",[`%${a.query}%`,a.limit,a.offset])).rows,...pageValues(a)};
  if(task==='project_get'){
   const project=await projectRow(db,a.projectId);
   const participation=(await db.query('select p.*,f.published as form_published,f.revision as form_revision,s.form_revision as submitted_form_revision from um.participations p left join um.forms f on f.id=p.form_id left join um.submissions s on s.id=p.submission_id where p.project_id=$1 order by p.id',[a.projectId])).rows;
   return {project,participations:participation.map(p=>({...p,nextAction:nextAction(project,p)})),nextAction:!project.sourceIds.length?'include_sources':!participation.length?'add_participant':project.activeRevision?'resume_participant':'prepare_standard'};
  }
  if(task==='form_get'){
   const f=await formRow(db,a.formId);
   const draft=(await db.query("select revision,data from um.reader_records where id=$1 and kind='draft' and account_id=$2",[f.id,identity.id])).rows[0];
   return {definition:f.definition,published:f.published,draft:draft?{...draft,answers:effectiveAnswers(f.definition,draft.data.answers)}:null};
  }
  if(task==='submission_get'){const row=(await db.query('select * from um.submissions where id=$1',[a.submissionId])).rows[0];ensure(row,'NOT_FOUND','Envio indisponível.',404);return row;}
  if(task==='submission_list')return {items:(await db.query('select * from um.submissions where project_id=$1 and profile_id=$2 order by submitted_at desc,id limit $3 offset $4',[a.projectId,a.profileId,a.limit,a.offset])).rows,...pageValues(a)};
  if(a.projectId)await projectRow(db,a.projectId);
  if(a.formId)await formRow(db,a.formId);
  return operation(db,identity,a.operationId,task,a,async()=>{
   if(task==='project_create'){
    const r=await db.query('insert into um.projects(owner_id,title,metadata) values($1,$2,$3) returning id',[identity.id,a.title,JSON.stringify(a.metadata)]);return {projectId:r.rows[0].id,revision:1};
   }
   if(task==='project_update'||task==='project_delete'){
    const p=await requireOwner(db,a.projectId,identity);ensure(p.revision===a.expectedRevision,'CONFLICT','Projeto mudou. Releia antes de editar.',409);
    if(task==='project_delete'){await db.query('delete from um.projects where id=$1',[p.id]);return {projectId:p.id,deleted:true};}
    const r=await db.query('update um.projects set title=coalesce($2,title),metadata=metadata||$3::jsonb,revision=revision+1,base_state=case when active_revision is null then base_state else \'correcting\' end where id=$1 and revision=$4 returning revision',[p.id,a.title??null,JSON.stringify(a.metadata||{}),a.expectedRevision]);ensure(r.rowCount,'CONFLICT','Projeto mudou.',409);return {projectId:p.id,revision:r.rows[0].revision};
   }
   if(task==='participation_add'||task==='participation_remove'){
    await requireOwner(db,a.projectId,identity);
    if(task==='participation_remove'){await db.query('delete from um.participations where project_id=$1 and profile_id=$2',[a.projectId,a.profileId]);return {projectId:a.projectId,profileId:a.profileId,removed:true};}
    const r=await db.query('insert into um.participations(project_id,profile_id) values($1,$2) on conflict(project_id,profile_id) do update set profile_id=excluded.profile_id returning id,state',[a.projectId,a.profileId]);return {participationId:r.rows[0].id,state:r.rows[0].state};
   }
   if(task==='form_save'){
    const f=a.definition as FormDefinition;validateForm(f);await requireOwner(db,f.projectId,identity);
    ensure(f.revision===a.expectedRevision+1,'REVISION','A revisão do formulário deve avançar uma vez.');
    if(a.expectedRevision===0)await db.query('insert into um.forms(id,project_id,profile_id,revision,definition) values($1,$2,$3,$4,$5)',[f.id,f.projectId,f.profileId,f.revision,JSON.stringify(f)]);
    else {const r=await db.query('update um.forms set revision=$2,definition=$3,published=false where id=$1 and revision=$4 and project_id=$5 and profile_id=$6 returning id',[f.id,f.revision,JSON.stringify(f),a.expectedRevision,f.projectId,f.profileId]);ensure(r.rowCount,'CONFLICT','Formulário mudou.',409);}
    await db.query("update um.participations set form_id=$3,submission_id=case when form_id=$3 then submission_id else null end,state=case when form_id=$3 and submission_id is not null then 'stale' else 'invited' end where project_id=$1 and profile_id=$2",[f.projectId,f.profileId,f.id]);return {formId:f.id,revision:f.revision};
   }
   if(task==='form_publish'){
    const f=await formRow(db,a.formId);await requireOwner(db,f.project_id,identity);validateForm(f.definition);
    const r=await db.query('update um.forms set published=true where id=$1 and revision=$2 returning id',[f.id,a.expectedRevision]);ensure(r.rowCount,'CONFLICT','Formulário mudou.',409);
    await db.query("update um.participations set state='form_available' where project_id=$1 and profile_id=$2",[f.project_id,f.profile_id]);return {formId:f.id,revision:f.revision,published:true};
   }
   if(task==='form_draft'||task==='form_submit'){
    const f=await formRow(db,a.formId);ensure(f.published&&f.revision===a.formRevision,'CONFLICT','Formulário atualizado. Reabra para conferir o percurso.',409);
    ensure((await db.query('select um.profile_holder($1) as allowed',[f.profile_id])).rows[0].allowed,'FORBIDDEN','Só o titular responde ao formulário.',403);
    if(task==='form_draft'){
     const data={formId:f.id,formRevision:f.revision,answers:effectiveAnswers(f.definition,a.answers)};
     const r=await db.query("insert into um.reader_records(id,account_id,profile_id,project_id,kind,data) select $1,$2,$3,$4,'draft',$5 where $6=0 on conflict(id) do update set data=excluded.data,revision=um.reader_records.revision+1 where um.reader_records.revision=$6 returning revision",[f.id,identity.id,f.profile_id,f.project_id,JSON.stringify(data),a.expectedRevision]);
     // UPDATE cannot be reached from INSERT..SELECT when no row is selected.
     if(!r.rowCount&&a.expectedRevision>0){const u=await db.query("update um.reader_records set data=$2,revision=revision+1 where id=$1 and kind='draft' and revision=$3 returning revision",[f.id,JSON.stringify(data),a.expectedRevision]);ensure(u.rowCount,'CONFLICT','Rascunho foi alterado em outro dispositivo.',409);return {formId:f.id,draftRevision:u.rows[0].revision};}
     ensure(r.rowCount,'CONFLICT','Rascunho foi alterado em outro dispositivo.',409);return {formId:f.id,draftRevision:r.rows[0].revision};
    }
    const normalized=validateSubmission(f.definition,a.answers);
    await db.query('select id from um.forms where id=$1 for update',[f.id]);
    const r=await db.query('insert into um.submissions(form_id,profile_id,respondent_id,project_id,form_revision,revision,answers) select $1,$2,$3,$4,$5,coalesce(max(revision),0)+1,$6 from um.submissions where form_id=$1 returning id,revision',[f.id,f.profile_id,identity.id,f.project_id,f.revision,JSON.stringify(normalized)]);
    await db.query("delete from um.reader_records where id=$1 and kind='draft'",[f.id]);return {submissionId:r.rows[0].id,revision:r.rows[0].revision,visibleQuestions:visibleQuestions(f.definition,normalized).map(q=>q.id)};
   }
   throw Error('Tarefa de projeto não implementada.');
  });
 });
}
function pageValues(a:{offset:number;limit:number}){return {offset:a.offset,limit:a.limit};}
