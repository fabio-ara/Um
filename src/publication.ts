import {z} from 'zod';
import {id,revision,type Identity,type Manifest,type Anchor,type ContentBundle,type SourceBlock} from './contracts.ts';
import {bundleSchema,reasonSchema} from './content-schemas.ts';
import {transaction,operation,priorOperation} from './db.ts';
import {ensure} from './errors.ts';
import {validateBundle} from './editorial.ts';
import {validateAnchor,validateLinks} from './anchors.ts';
import {sourceView,fileRow} from './sources.ts';
import {getFile,putFile} from './files.ts';
import {projectRow} from './projects.ts';
import {draftRow,draftContents} from './authoring.ts';

export type ContentIndex={id:string;kind:'unit'|'resource'|'choice'|'coverage';title:string;file:string;unitId?:string;position?:number};
export type PublishedManifest=Manifest & {baseRevision:number;index:ContentIndex[];sourceIndex:{id:string;revision:number;title:string;metadata?:Record<string,any>;path:string;original:string|null}[];inspection:ContentBundle['inspection']};
export const publicationSchemas={
 bundle_publish:z.strictObject({operationId:id,expectedRevision:z.number().int().nonnegative(),bundle:bundleSchema,reasons:z.array(reasonSchema).max(4000).default([])}),
 authoring_publish:z.strictObject({operationId:id,draftId:id,expectedRevision:revision}),
 bundle_get:z.strictObject({projectId:id,profileId:id.nullable(),revision:revision.optional()}),
 content_get:z.strictObject({projectId:id,profileId:id.nullable(),revision,contentId:id}),
 reasons_get:z.strictObject({projectId:id,profileId:id}),
 standard_find:z.strictObject({projectId:id,offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(50).default(20)}),
};
export const publicationReadTasks=new Set(['bundle_get','content_get','reasons_get','standard_find']);
export async function published(identity:Identity,projectId:string,profileId:string|null,version?:number):Promise<PublishedManifest>{
 return transaction(identity,async db=>{
  const row=(await db.query("select manifest from um.bundles where project_id=$1 and profile_id is not distinct from $2::uuid and status='published' and ($3::integer is null or revision=$3) order by revision desc limit 1",[projectId,profileId,version??null])).rows[0];
  ensure(row,'NOT_FOUND','Conteúdo publicado indisponível.',404);return row.manifest;
 });
}
export async function content(identity:Identity,manifest:PublishedManifest,contentId:string){const item=manifest.index.find(x=>x.id===contentId);ensure(item,'NOT_FOUND','Item indisponível nesta revisão.',404);return JSON.parse((await getFile(identity,item.file)).toString('utf8'));}
export async function publicationTask(identity:Identity,task:keyof typeof publicationSchemas,input:unknown):Promise<unknown>{
 let a=publicationSchemas[task].parse(input) as any;
 const intent=a;
 let prepared:any=null;
 let preparedFiles:{kind:string;id:string;path:string}[]=[];
 if(task==='authoring_publish'){
  const loaded=await transaction(identity,async db=>{
   const draft=await draftRow(db,a.draftId);
   const project=await projectRow(db,draft.project_id);ensure(project.ownerId===identity.id,'FORBIDDEN','Somente o autor publica esta preparação.',403);
   const replay=await priorOperation(db,identity,a.operationId,task,intent);if(replay)return {replay};
   ensure(draft.revision===a.expectedRevision&&draft.status==='draft','CONFLICT','A preparação mudou. Releia antes de publicar.',409);
   return {draft,...await draftContents(db,draft,identity)};
  });
  if(loaded.replay)return loaded.replay;
  prepared=loaded.draft;a={operationId:intent.operationId,expectedRevision:prepared.expected_revision,bundle:loaded.bundle,reasons:loaded.reasons};
  preparedFiles=loaded.files!;
 }
 if(task==='bundle_get')return published(identity,a.projectId,a.profileId,a.revision);
 if(task==='content_get')return content(identity,await published(identity,a.projectId,a.profileId,a.revision),a.contentId);
 if(task==='reasons_get')return transaction(identity,async db=>({items:(await db.query('select resource_id,submission_id,metadata from um.personalization_reasons where project_id=$1 and profile_id=$2 order by resource_id',[a.projectId,a.profileId])).rows}));
 if(task==='standard_find')return transaction(identity,async db=>{
  const p=await projectRow(db,a.projectId);
  const q=await db.query("select p.id,p.title,p.active_revision from um.projects p where active_revision is not null and metadata->'object'=$1::jsonb and metadata->>'scope'=$2 and metadata->>'language'=$3 and metadata->>'audience'=$4 and (select array_agg(source_id order by source_id) from um.project_sources where project_id=p.id) is not distinct from $5::uuid[] order by id limit $6 offset $7",[JSON.stringify(p.object),p.scope,p.language,p.audience,p.sourceIds.length?p.sourceIds:null,a.limit,a.offset]);return {items:q.rows,compatibility:['object','scope','sources','language','audience']};
 });
 const b=a.bundle as ContentBundle;validateBundle(b);
 const p=await transaction(identity,db=>projectRow(db,b.projectId));ensure(p.ownerId===identity.id,'FORBIDDEN','Somente o autor publica este projeto.',403);
 const replay=await transaction(identity,async db=>{
  if(b.profileId)ensure((await db.query('select um.profile_access($1) as allowed',[b.profileId])).rows[0].allowed,'FORBIDDEN','Perfil sem autorização vigente.',403);
  return priorOperation(db,identity,a.operationId,task,intent);
 });if(replay)return replay;
 const sources=new Map<string,Awaited<ReturnType<typeof sourceView>>>();
 for(const sourceId of p.sourceIds)sources.set(sourceId,await sourceView(identity,sourceId));
 ensure(sources.size,'SOURCE_REQUIRED','Inclua as fontes do projeto antes de publicar.');
 const checkAnchor=(anchor:Anchor)=>{const source=sources.get(anchor.sourceId);ensure(source,'SOURCE_REQUIRED','Âncora referencia fonte fora do projeto.');validateAnchor(anchor,source);};
 for(const u of b.units){validateLinks(u.references,[...sources.values()]);ensure(u.references.length,'SOURCE_REQUIRED','Unidade exige referências documentais.');}
 for(const r of b.resources){ensure(r.projectId===b.projectId,'PROJECT_MISMATCH','Recurso pertence a outro projeto.');ensure(r.inspection==='ai_inspected','INSPECTION','Inspecione cada recurso antes de publicar.');r.targets.forEach(checkAnchor);r.sources.forEach(checkAnchor);}
 for(const q of b.choices)q.sources.forEach(checkAnchor);
 for(const c of b.coverage)c.sourceAnchors.forEach(checkAnchor);
 if(b.profileId){
  const base=await published(identity,b.projectId,null,b.baseRevision);const unitIds=new Set(base.index.filter(x=>x.kind==='unit').map(x=>x.id));
  ensure(b.baseRevision===p.activeRevision,'STALE_BASE','A base mudou. Revise o complemento antes de publicar.',409);
  ensure(b.coverage.every(c=>c.unitIds.every(u=>unitIds.has(u))),'COVERAGE','Cobertura pessoal aponta unidade inexistente na base.');
  for(const u of unitIds)ensure(b.choices.some(q=>q.unitId===u),'PRACTICE_REQUIRED','Cada unidade exige prática pessoal.');
  const reasonIds=new Set(a.reasons.map((r:any)=>r.resourceId));ensure([...b.resources,...b.choices].every(x=>reasonIds.has(x.id)),'REASONS_REQUIRED','Documente a relação entre respostas e cada complemento pessoal.');
 }else{ensure(!a.reasons.length,'PRIVATE_REASON','Justificativas pessoais não pertencem ao padrão.');ensure(b.baseRevision===b.revision,'REVISION','A base comum identifica a própria revisão.');}
 return transaction(identity,db=>operation(db,identity,a.operationId,task,intent,async()=>{
  await db.query('select id from um.projects where id=$1 for update',[b.projectId]);
  if(prepared){const currentDraft=await draftRow(db,prepared.id,true);ensure(currentDraft.revision===prepared.revision&&currentDraft.status==='draft','CONFLICT','A preparação mudou durante a publicação.',409);}
  const project=await projectRow(db,b.projectId);
  const current=(await db.query("select coalesce(max(revision),0) as revision from um.bundles where project_id=$1 and profile_id is not distinct from $2::uuid and status='published'",[b.projectId,b.profileId])).rows[0].revision;
  ensure(current===a.expectedRevision&&b.revision===current+1,'CONFLICT','A publicação mudou. Releia a revisão.',409);
  for(const [sourceId,s]of sources){const live=(await db.query('select revision from um.sources where id=$1 for share',[sourceId])).rows[0];ensure(live?.revision===s.revision,'STALE_SOURCE','Uma fonte mudou durante a preparação.',409);}
  if(b.profileId){
   ensure(project.activeRevision===b.baseRevision,'STALE_BASE','Base alterada durante a preparação.',409);
   const part=(await db.query('select * from um.participations where project_id=$1 and profile_id=$2 for update',[b.projectId,b.profileId])).rows[0];ensure(part?.submission_id,'SUBMISSION_REQUIRED','A segunda tomada exige respostas enviadas pelo titular.',409);
   const submission=(await db.query('select * from um.submissions where id=$1',[part.submission_id])).rows[0];ensure(submission,'FORBIDDEN','Respostas sem autorização vigente.',403);
   const holder=(await db.query('select holder_id from um.profiles where id=$1',[b.profileId])).rows[0]?.holder_id;
   ensure(submission.project_id===b.projectId&&submission.profile_id===b.profileId&&submission.form_id===part.form_id&&submission.respondent_id===holder,'SUBMISSION_REQUIRED','A tomada deve usar respostas deste titular, perfil, projeto e formulário.',409);
   const f=(await db.query('select revision from um.forms where id=$1',[part.form_id])).rows[0];ensure(f?.revision===submission.form_revision,'STALE_SUBMISSION','O formulário mudou. Aguarde o novo envio.',409);
   const objects=new Set([...b.resources,...b.choices].map(x=>x.id));ensure(a.reasons.length===objects.size,'REASONS_REQUIRED','Forneça uma justificativa para cada complemento.');
   for(const reason of a.reasons){ensure(objects.has(reason.resourceId)&&reason.submissionId===submission.id&&reason.submissionRevision===submission.revision,'PRIVATE_REASON','Justificativa não corresponde a esta tomada.');ensure(reason.questionIds.every((q:string)=>Object.hasOwn(submission.answers,q)),'PRIVATE_REASON','Justificativa cita resposta ausente.');}
  }
  const offlineAllowed=[...sources.values()].every(s=>s.metadata.rights.offlineAllowed);
  const manifest:PublishedManifest={format:'um-package/1',projectId:b.projectId,revision:b.revision,profileId:b.profileId,baseRevision:b.baseRevision,files:[],sourceRevisions:Object.fromEntries([...sources].map(([k,v])=>[k,v.revision])),publishedAt:new Date().toISOString(),index:[],sourceIndex:[],inspection:b.inspection};
  async function store(kind:ContentIndex['kind'],obj:any){
   const staged=preparedFiles.find(f=>f.kind===kind&&f.id===obj.id);
   let file;
   if(staged){const row=(await db.query('select path,sha256,bytes,media_type from um.files where path=$1',[staged.path])).rows[0];ensure(row,'NOT_FOUND','Arquivo preparado indisponível.',404);file={path:row.path,sha256:row.sha256,bytes:Number(row.bytes),mediaType:row.media_type};await db.query('update um.files set offline_allowed=$2 where path=$1',[row.path,offlineAllowed]);}
   else {file=await putFile(identity,Buffer.from(JSON.stringify(obj)),'application/json');await fileRow(db,identity,file,{projectId:b.projectId,...(b.profileId?{profileId:b.profileId}:{})},offlineAllowed,'prepared');}
   manifest.files.push({...file,offlineAllowed});manifest.index.push({id:obj.id,kind,title:obj.title||obj.prompt||obj.description,file:file.path,...(kind==='choice'?{unitId:obj.unitId,position:obj.position}:{})});
  }
  for(const u of b.units)await store('unit',u);for(const r of b.resources)await store('resource',r);for(const q of b.choices)await store('choice',q);for(const c of b.coverage)await store('coverage',c);
  // Referenced source files join the package only when their rights allow offline use.
  for(const sourceId of sources.keys()){
   const s=(await db.query('select s.original_file,r.body_file from um.sources s join um.source_revisions r on r.source_id=s.id where s.id=$1 and r.revision=$2',[sourceId,sources.get(sourceId)!.revision])).rows[0];
   manifest.sourceIndex.push({id:sourceId,revision:sources.get(sourceId)!.revision,title:sources.get(sourceId)!.metadata.title,metadata:sources.get(sourceId)!.metadata,path:s.body_file,original:sources.get(sourceId)!.metadata.rights.offlineAllowed?s.original_file:null});
   const rows=(await db.query('select * from um.files where path=any($1::text[]) and offline_allowed',[[s.body_file,s.original_file].filter(Boolean)])).rows;
   for(const f of rows)manifest.files.push({path:f.path,sha256:f.sha256,bytes:Number(f.bytes),mediaType:f.media_type,offlineAllowed:f.offline_allowed});
  }
  await db.query("insert into um.bundles(project_id,profile_id,revision,base_revision,manifest,status) values($1,$2,$3,$4,$5,'published')",[b.projectId,b.profileId,b.revision,b.baseRevision,JSON.stringify(manifest)]);
  await db.query("update um.files set state='published' where path=any($1::text[])",[manifest.index.map(x=>x.file)]);
  if(b.profileId){
   for(const r of a.reasons)await db.query('insert into um.personalization_reasons(resource_id,project_id,profile_id,submission_id,metadata) values($1,$2,$3,$4,$5) on conflict(resource_id) do update set submission_id=excluded.submission_id,metadata=excluded.metadata',[r.resourceId,b.projectId,b.profileId,r.submissionId,JSON.stringify({...r,bundleRevision:b.revision})]);
   await db.query("update um.participations set active_revision=$3,state='available' where project_id=$1 and profile_id=$2",[b.projectId,b.profileId,b.revision]);
  }else{await db.query("update um.projects set active_revision=$2,base_state='available',revision=revision+1 where id=$1",[b.projectId,b.revision]);await db.query("update um.participations set state='stale' where project_id=$1 and active_revision is not null",[b.projectId]);}
  if(prepared)await db.query("update um.authoring_drafts set status='published',next_step='published',updated_at=now() where id=$1",[prepared.id]);
  return {projectId:b.projectId,profileId:b.profileId,revision:b.revision,published:true,...(prepared?{draftId:prepared.id}:{})};
 }));
}
