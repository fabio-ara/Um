import {openOffline,type OfflineStore} from './offline.ts';
import {remote,fetchFile} from './api.ts';
import {AppError} from '../errors.ts';
import {makeAttempt,repeatChoices} from '../editorial.ts';
import {effectiveAnswers,validateSubmission} from '../forms.ts';
import type {QueuedOperation,Receipt,Choice,Attempt} from '../contracts.ts';
import type {PublishedManifest} from '../publication.ts';
import type {StudyApi} from './dom.ts';
const writable=new Set(['form_draft','form_submit','reader_state_save','note_save','term_save','record_delete','attempt_submit','time_record','comment_add','comment_edit','comment_remove','note_share','observation_add']);
const stable=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export async function studyClient(accountId:string,profileId:string,projectId?:string){
 const store=await openOffline(accountId,profileId);let syncing:Promise<void>|null=null;
 const cacheKey=(task:string,args:any)=>'read:'+task+':'+stable(args);
 async function sync(){
  if(!navigator.onLine)return;if(syncing)return syncing;
  syncing=(async()=>{
   if(profileId!=='account')try{await remote('profile_get',{profileId});}catch(e){if(e instanceof AppError&&[401,403,404].includes(e.status)){await store.clear();throw e;}throw e;}
   await store.sync(async op=>{const receipt=await remote(op.task,op.arguments) as Receipt;await store.putRecord('receipt:'+op.id,receipt);return receipt;},async id=>{const receipt=await remote('operation_get',{operationId:id}) as Receipt|null;if(receipt)await store.putRecord('receipt:'+id,receipt);return receipt;});
  })().finally(()=>{syncing=null;});return syncing;
 }
 async function packages(){if(!projectId)return [];const values=await Promise.all([store.package(projectId,false),store.package(projectId,true)]);return values.filter(x=>!!x).map(x=>({...x,manifest:x.manifest as PublishedManifest}));}
 async function packaged(task:string,a:any):Promise<any>{
  const all=await packages();
  if(task==='bundle_get'){const p=all.find(p=>p.manifest.profileId===a.profileId&&(!a.revision||p.manifest.revision===a.revision));if(p)return p.manifest;}
  if(task==='content_get'){const p=all.find(p=>p.manifest.profileId===a.profileId&&p.manifest.revision===a.revision),i=p?.manifest.index.find(x=>x.id===a.contentId),bytes=i&&p?.files[i.file];if(bytes)return JSON.parse(new TextDecoder().decode(bytes));}
  if(task==='source_get')for(const p of all){const s=p.manifest.sourceIndex.find(x=>x.id===a.sourceId&&(!a.sourceRevision||x.revision===a.sourceRevision)),bytes=s&&p.files[s.path];if(s&&bytes){const body=JSON.parse(new TextDecoder().decode(bytes)),offset=a.offset||0,limit=a.limit||30;return {id:s.id,revision:s.revision,metadata:{title:s.title},blocks:body.blocks.slice(offset,offset+limit),total:body.blocks.length,offset,complete:offset===0&&body.blocks.length<=limit};}}
  if(task==='choice_sequence'){
   const p=all.find(p=>p.manifest.profileId===profileId);if(p){const common=all.find(p=>p.manifest.profileId===null);if(common?.manifest.revision!==p.manifest.baseRevision)throw new AppError('STALE_BASE','Os apoios aguardam revisão para esta base.',409);const qs=p.manifest.index.filter(i=>i.kind==='choice'&&(!a.unitId||i.unitId===a.unitId)).map(i=>p.files[i.file]).filter(Boolean).map(bytes=>JSON.parse(new TextDecoder().decode(bytes)) as Choice);const records=await store.record('records:attempt') as any;return {revision:p.manifest.revision,questions:repeatChoices(qs,(records?.items||[]).map((r:any)=>r.data),a.errorsOnly)};}
  }
  if(task==='reader_records'){const records=await store.record('records:'+a.kind) as any;if(records)return {...records,items:records.items.slice(a.offset||0,(a.offset||0)+(a.limit||30))};}
  const cached=await store.record(cacheKey(task,a));if(cached!==null)return cached;
  throw new AppError('OFFLINE_MISSING','Este conteúdo ainda não está disponível neste dispositivo. Conecte-se e prepare o estudo offline.',503);
 }
 async function localEffect(task:string,a:any){
  const recordId=a.recordId||a.operationId,revision=(a.expectedRevision||0)+1;let result:any={recordId,revision},kind:string|undefined,data:any;
  if(task==='reader_state_save'){kind='state';data=a.state;}
  if(task==='note_save'){kind='note';data={anchor:a.anchor,text:a.text};}
  if(task==='term_save'){kind='term';data={anchor:a.anchor,term:a.term,definition:a.definition};}
  if(task==='attempt_submit'){
   const q=await packaged('content_get',{projectId,profileId,revision:a.bundleRevision,contentId:a.questionId}) as Choice;
   data=makeAttempt(q,a.optionId,profileId,a.sequenceId,a.operationId,a.createdAt);kind='attempt';result={recordId,revision:1,correct:data.correct,feedback:q.options.find(o=>o.id===a.optionId)!.feedback};
  }
  if(kind){const records=(await store.record('records:'+kind) as any)||{items:[]};records.items=records.items.filter((r:any)=>r.id!==recordId);records.items.push({id:recordId,revision,data});await store.putRecord('records:'+kind,records);}
  if(task==='form_draft'||task==='form_submit'){
   const key=cacheKey('form_get',{formId:a.formId}),cached=await store.record(key) as any;if(!cached)throw new AppError('OFFLINE_MISSING','Reabra o formulário com conexão antes de responder offline.',503);
   const answers=task==='form_submit'?validateSubmission(cached.definition,a.answers):effectiveAnswers(cached.definition,a.answers);
   cached.draft={revision,answers,data:{answers,formRevision:a.formRevision}};await store.putRecord(key,cached);result={formId:a.formId,draftRevision:revision,revision,...(task==='form_submit'?{pendingSubmission:true}:{})};
  }
  if(task==='record_delete')for(const kind of ['note','term']){const records=await store.record('records:'+kind) as any;if(records){records.items=records.items.filter((r:any)=>r.id!==a.recordId);await store.putRecord('records:'+kind,records);}}
  return result;
 }
 const api:StudyApi=async(task,args)=>{
  if(writable.has(task)&&projectId){
   const op=args.operationId as string;
   // Prepare local projection before enqueue: invalid local answers never enter the queue.
   let projected:any;try{projected=await localEffect(task,args);}catch(e){if(navigator.onLine&&task==='attempt_submit'){const manifest=await remote('bundle_get',{projectId,profileId});const q=await remote('content_get',{projectId,profileId,revision:args.bundleRevision,contentId:args.questionId});await store.putRecord(cacheKey('content_get',{projectId,profileId,revision:args.bundleRevision,contentId:args.questionId}),q);projected=await localEffect(task,args);}else throw e;}
   await store.enqueue({id:op,accountId,profileId,task,arguments:args,state:'pending',createdAt:new Date().toISOString()});
   if(navigator.onLine)try{await sync();}catch(e){if(e instanceof AppError&&[401,403,404].includes(e.status))throw e;}
   const state=(await store.operations()).find(x=>x.id===op)!;
   if(state.state==='confirmed'){const receipt=await store.record('receipt:'+op);if(receipt)return receipt;return remote('operation_get',{operationId:op});}
   if(state.state==='conflict'||state.state==='error')throw new AppError(state.state==='conflict'?'CONFLICT':'REJECTED',state.error||'Operação não confirmada.',state.state==='conflict'?409:400);
   return {operationId:op,status:state.state,result:projected};
  }
  if(navigator.onLine)try{
   const result=await remote(task,args);await store.putRecord(cacheKey(task,args),result);
   if(task==='reader_records'&&(args.offset||0)===0)await store.putRecord('records:'+args.kind,result);
   return result;
  }catch(e){if(e instanceof AppError&&e.status<500){if([401,403].includes(e.status))await store.clear();throw e;}}
  return packaged(task,args);
 };
 async function download(){if(!projectId)throw Error('Estudo não selecionado.');await sync();const common=await remote('bundle_get',{projectId,profileId:null}) as PublishedManifest;await store.install(common,file=>fetchFile(file.path));try{const personal=await remote('bundle_get',{projectId,profileId}) as PublishedManifest;await store.install(personal,file=>fetchFile(file.path));}catch(e){if(!(e instanceof AppError&&e.status===404))throw e;}return {downloaded:true};}
 return {api,store,sync,download,close:()=>store.close()};
}
