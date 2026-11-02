import {openOffline,type OfflineStore} from './offline.ts';
import {remote as sessionRemote,fetchFile as sessionFile,requireAccount} from './api.ts';
import {AppError} from '../errors.ts';
import {makeAttempt,repeatChoices} from '../editorial.ts';
import {effectiveAnswers,validateSubmission} from '../forms.ts';
import type {QueuedOperation,Receipt,Choice} from '../contracts.ts';
import type {PublishedManifest} from '../publication.ts';
import type {StudyApi} from './dom.ts';
const writable=new Set(['form_draft','form_submit','reader_state_save','note_save','term_save','record_delete','attempt_submit','time_record','comment_add','comment_edit','comment_remove','note_share','observation_add']);
const stable=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const isAuth=(e:unknown)=>e instanceof AppError&&(e.status===401||e.status===403);
const saveKind:Record<string,string>={reader_state_save:'state',note_save:'note',term_save:'term',attempt_submit:'attempt',time_record:'time'};
type ReaderRecord={id:string;revision:number;data:any};
function recordItems(value:any):ReaderRecord[]{if(Array.isArray(value))return value;return Array.isArray(value?.items)?value.items:[];}
function recordIdOf(op:QueuedOperation):string{const value=op.arguments.recordId??op.arguments.operationId;return typeof value==='string'?value:'';}
function affectsKind(op:QueuedOperation,kind:string):boolean{
 if(saveKind[op.task]===kind)return true;
 return op.task==='record_delete'&&(kind==='note'||kind==='term');
}
function revisionOf(op:QueuedOperation):number{return Number(op.arguments.expectedRevision||0)+1;}
function projectionFor(op:QueuedOperation,kind:string):ReaderRecord|null{
 const recordId=recordIdOf(op);if(!recordId)return null;
 if(kind==='state'&&op.task==='reader_state_save')return {id:recordId,revision:revisionOf(op),data:op.arguments.state};
 if(kind==='note'&&op.task==='note_save')return {id:recordId,revision:revisionOf(op),data:{anchor:op.arguments.anchor,text:op.arguments.text}};
 if(kind==='term'&&op.task==='term_save')return {id:recordId,revision:revisionOf(op),data:{anchor:op.arguments.anchor,term:op.arguments.term,definition:op.arguments.definition}};
 if(kind==='time'&&op.task==='time_record')return {id:recordId,revision:1,data:{unitId:op.arguments.unitId,seconds:op.arguments.seconds,mode:op.arguments.mode||'reading',event:op.arguments.event||'interval',createdAt:op.createdAt}};
 // Attempts are rebuilt from the cached question during localEffect; a missing
 // attempt is never invented from the operation arguments alone.
 return null;
}
function formTask(op:QueuedOperation):boolean{return op.task==='form_draft'||op.task==='form_submit';}
export async function studyClient(accountId:string,profileId:string,projectId?:string){
 const store=await openOffline(accountId,profileId);let syncing:Promise<void>|null=null,closed=false;
 const remote=(task:string,args:Record<string,unknown>)=>sessionRemote(task,args,accountId);
 const fetchFile=(path:string)=>sessionFile(path,accountId);
 async function active(){if(closed)throw new AppError('UNAUTHENTICATED','Este estudo foi fechado. Reabra na conta atual.',401);await requireAccount(accountId);if(closed)throw new AppError('UNAUTHENTICATED','Este estudo foi fechado.',401);}
 async function clearStore(){if(!closed)await store.clear();}
 const recordKey=(kind:string,scope=projectId)=>'project:'+scope+':records:'+kind;
 const cacheKey=(task:string,args:any)=>'read:'+task+':'+stable(args);
 async function projectedResult(task:string,a:any){
  const recordId=a.recordId||a.operationId,revision=(a.expectedRevision||0)+1,kind=saveKind[task];
  if(kind){const records=await store.record(recordKey(kind)) as any,item=recordItems(records).find(r=>r.id===recordId);if(item)return {recordId,revision:item.revision,...(task==='attempt_submit'?{correct:item.data?.correct,feedback:item.data?.feedback??item.data?.snapshot?.options?.find((o:any)=>o.id===item.data?.optionId)?.feedback}:{})};}
  if(task==='form_draft'||task==='form_submit'){
   const cached=await store.record(cacheKey('form_get',{formId:a.formId})) as any;
   return {formId:a.formId,draftRevision:cached?.draft?.revision??revision,revision,...(task==='form_submit'?{pendingSubmission:true}:{})};
  }
  return {recordId,revision};
 }
 async function localEffect(task:string,a:any,updates:Record<string,unknown>){
  const recordId=a.recordId||a.operationId,revision=(a.expectedRevision||0)+1;let result:any={recordId,revision},kind:string|undefined,data:any;
  if(task==='reader_state_save'){kind='state';data=a.state;}
  if(task==='note_save'){kind='note';data={anchor:a.anchor,text:a.text};}
  if(task==='term_save'){kind='term';data={anchor:a.anchor,term:a.term,definition:a.definition};}
  if(task==='time_record'){kind='time';data={unitId:a.unitId,seconds:a.seconds,mode:a.mode||'reading',event:a.event||'interval',createdAt:new Date().toISOString()};}
  if(task==='attempt_submit'){
   const q=await packaged('content_get',{projectId,profileId,revision:a.bundleRevision,contentId:a.questionId}) as Choice;
   data=makeAttempt(q,a.optionId,profileId,a.sequenceId,a.operationId,a.createdAt);kind='attempt';result={recordId,revision:1,correct:data.correct,feedback:q.options.find(o=>o.id===a.optionId)!.feedback};
  }
  if(kind){const records=(await store.record(recordKey(kind)) as any)||{items:[]};records.items=recordItems(records).filter((r:any)=>r.id!==recordId);records.items.push({id:recordId,revision,data});updates[recordKey(kind)]=records;}
  if(task==='form_draft'||task==='form_submit'){
   const key=cacheKey('form_get',{formId:a.formId}),cached=await store.record(key) as any;if(!cached)throw new AppError('OFFLINE_MISSING','Reabra o formulário com conexão antes de responder offline.',503);
   const answers=task==='form_submit'?validateSubmission(cached.definition,a.answers):effectiveAnswers(cached.definition,a.answers);
   cached.draft={revision,answers,data:{answers,formRevision:a.formRevision}};updates[key]=cached;result={formId:a.formId,draftRevision:revision,revision,...(task==='form_submit'?{pendingSubmission:true}:{})};
  }
  if(task==='record_delete')for(const kind of ['note','term']){const records=await store.record(recordKey(kind)) as any;if(records){records.items=recordItems(records).filter((r:any)=>r.id!==a.recordId);updates[recordKey(kind)]=records;}}
  return result;
 }
 async function mergeReaderRecords(a:any,result:any){
  const kind=String(a.kind),offset=Number(result?.offset??a.offset??0)||0,limit=Number(result?.limit??a.limit??30)||30;
  const cached=await store.record(recordKey(kind)) as any,map=new Map<string,ReaderRecord>();
  for(const item of recordItems(cached))if(item?.id)map.set(item.id,item);
  const ops=await store.operations(),latest=new Map<string,QueuedOperation>();
  // Replay projections in queue order so the newest intent wins and no local
  // record can be silently dropped by a remote page.
  for(const op of ops){
   if(!affectsKind(op,kind)||op.arguments.projectId!==(a.projectId||projectId))continue;
   const recordId=recordIdOf(op);if(!recordId)continue;
   latest.set(recordId,op);
   if(op.task==='record_delete')map.delete(recordId);
   else{const projection=projectionFor(op,kind);if(projection)map.set(projection.id,projection);}
  }
  const protectedIds=new Set([...latest].filter(([,op])=>op.state!=='confirmed').map(([recordId])=>recordId));
  for(const item of recordItems(result)){
   if(!item?.id||protectedIds.has(item.id))continue;
   map.set(item.id,item);
  }
  // A complete remote collection also proves deletion; a partial page does not.
  if(offset===0&&recordItems(result).length<limit){const visible=new Set(recordItems(result).map(item=>item.id));for(const key of map.keys())if(!visible.has(key)&&!protectedIds.has(key))map.delete(key);}
  const merged=[...map.values()].sort((x,y)=>x.id.localeCompare(y.id));
  await store.putRecord(recordKey(kind),{items:merged});
  return {...(result&&typeof result==='object'?result:{}),items:merged.slice(offset,offset+limit),offset,limit};
 }
 async function mergeFormGet(a:any,result:any){
  const key=cacheKey('form_get',{formId:a.formId}),cached=await store.record(key) as any;
  const ops=await store.operations(),formOps=ops.filter(op=>formTask(op)&&op.arguments.formId===a.formId),latest=formOps[formOps.length-1];
  let merged=result;
  if(latest&&latest.state!=='confirmed'){
   let draft=cached?.draft;
   if(!draft&&result?.definition){
    const revision=revisionOf(latest),answers=effectiveAnswers(result.definition,latest.arguments.answers as any);
    draft={revision,answers,data:{answers,formRevision:latest.arguments.formRevision}};
    if(latest.task==='form_submit')draft.pendingSubmission=true;
   }
   if(draft)merged={...result,draft};
  }
  // With no pending form operation the server is authoritative: a confirmed
  // submission therefore clears the cached draft only after the server already
  // reflects it (form_get returns draft:null).
  await store.putRecord(key,merged);
  return merged;
 }
 async function reconcileRead(task:string,a:any,result:any){
  if(task==='reader_records')return mergeReaderRecords(a,result);
  if(task==='form_get')return mergeFormGet(a,result);
  return result;
 }
 async function reconcileConfirmed(op:QueuedOperation,receipt:Receipt,ops:QueuedOperation[]){
  const result=receipt.result as any,index=ops.findIndex(item=>item.id===op.id),later=index<0?[]:ops.slice(index+1);
  if(op.task==='form_submit'){
   const formId=String(op.arguments.formId);
   if(later.some(item=>formTask(item)&&item.arguments.formId===formId))return;
   const key=cacheKey('form_get',{formId}),cached=await store.record(key) as any;
   if(cached&&cached.draft)await store.putRecord(key,{...cached,draft:null});
   return;
  }
  const kind=saveKind[op.task];
  if(kind){
   const recordId=recordIdOf(op);
   if(!recordId||later.some(item=>affectsKind(item,kind)&&recordIdOf(item)===recordId))return;
   const records=await store.record(recordKey(kind,op.arguments.projectId as string)) as any,items=recordItems(records),position=items.findIndex(item=>item.id===recordId),projection=projectionFor(op,kind);
   if(position<0&&!projection)return;
   const item=position<0?{...projection!}:{...items[position]};
   if(typeof result?.revision==='number')item.revision=result.revision;
   if(op.task==='attempt_submit'&&result&&('correct'in result||'feedback'in result))item.data={...item.data,correct:result.correct,feedback:result.feedback};
   if(position<0)items.push(item);else items[position]=item;
   await store.putRecord(recordKey(kind,op.arguments.projectId as string),{...records,items});
   return;
  }
  if(op.task==='record_delete'){
   const recordId=recordIdOf(op);
   for(const kind of ['note','term']){
    if(later.some(item=>affectsKind(item,kind)&&recordIdOf(item)===recordId))continue;
    const records=await store.record(recordKey(kind,op.arguments.projectId as string)) as any,items=recordItems(records),kept=items.filter(item=>item.id!==recordId);
    if(kept.length!==items.length)await store.putRecord(recordKey(kind,op.arguments.projectId as string),{...records,items:kept});
   }
  }
 }
 async function sync(){
  await active();if(!navigator.onLine)return;if(syncing)return syncing;
  syncing=(async()=>{
   let authFailure:AppError|null=null;
   if(profileId!=='account')try{await remote('profile_get',{profileId});}catch(e){if(isAuth(e)||(e instanceof AppError&&e.status===404)){await clearStore();throw e;}throw e;}
   const receipts:Receipt[]=[];
   const send=async(op:QueuedOperation)=>{try{const receipt=await remote(op.task,op.arguments) as Receipt;receipts.push(receipt);return receipt;}catch(e){if(isAuth(e)&&!authFailure)authFailure=e as AppError;throw e;}};
   const recover=async(id:string)=>{try{const receipt=await remote('operation_get',{operationId:id}) as Receipt|null;if(receipt)receipts.push(receipt);return receipt;}catch(e){if(isAuth(e)&&!authFailure)authFailure=e as AppError;throw e;}};
   try{await store.sync(send,recover);}catch(e){if(isAuth(e))authFailure=e as AppError;else throw e;}
   if(authFailure){await clearStore();throw authFailure;}
   await active();
   // The store lock is released here, so record writes and projection
   // reconciliation never run inside the sync callbacks.
   const ops=await store.operations(),byId=new Map<string,QueuedOperation>(ops.map(op=>[op.id,op]));
   for(const receipt of receipts){
    if(receipt?.status!=='confirmed')continue;
    await store.putRecord('receipt:'+receipt.operationId,receipt);
    const op=byId.get(receipt.operationId);
    if(op&&op.state==='confirmed')await reconcileConfirmed(op,receipt,ops);
   }
  })().finally(()=>{syncing=null;});return syncing;
 }
 async function packages(){if(!projectId)return [];const values=await Promise.all([store.package(projectId,false),store.package(projectId,true)]);return values.filter(x=>!!x).map(x=>({...x,manifest:x.manifest as PublishedManifest}));}
 async function packaged(task:string,a:any):Promise<any>{
  const all=await packages();
  if(task==='bundle_get'){const p=all.find(p=>p.manifest.profileId===a.profileId&&(!a.revision||p.manifest.revision===a.revision));if(p)return p.manifest;}
  if(task==='content_get'){const p=all.find(p=>p.manifest.profileId===a.profileId&&p.manifest.revision===a.revision),i=p?.manifest.index.find(x=>x.id===a.contentId),bytes=i&&p?.files[i.file];if(bytes)return JSON.parse(new TextDecoder().decode(bytes));}
  if(task==='source_get'||task==='source_locate')for(const p of all){const s=p.manifest.sourceIndex.find(x=>x.id===a.sourceId&&(!a.sourceRevision||x.revision===a.sourceRevision)),bytes=s&&p.files[s.path];if(s&&bytes){const body=JSON.parse(new TextDecoder().decode(bytes)),offset=task==='source_locate'?body.blocks.findIndex((b:any)=>b.id===a.elementId):a.offset||0,limit=task==='source_locate'?1:a.limit||30;if(offset<0)throw new AppError('NOT_FOUND','Trecho indisponível nesta revisão.',404);return {id:s.id,revision:s.revision,metadata:s.metadata||{title:s.title},blocks:body.blocks.slice(offset,offset+limit),total:body.blocks.length,offset,complete:offset===0&&body.blocks.length<=limit};}}
  if(task==='choice_sequence'){
   const p=all.find(p=>p.manifest.profileId===profileId);if(p){const common=all.find(p=>p.manifest.profileId===null);if(common?.manifest.revision!==p.manifest.baseRevision)throw new AppError('STALE_BASE','Os apoios aguardam revisão para esta base.',409);const qs=p.manifest.index.filter(i=>i.kind==='choice'&&(!a.unitId||i.unitId===a.unitId)).map(i=>p.files[i.file]).filter(Boolean).map(bytes=>JSON.parse(new TextDecoder().decode(bytes)) as Choice);const records=await store.record(recordKey('attempt')) as any;return {revision:p.manifest.revision,questions:repeatChoices(qs,recordItems(records).map((r:any)=>r.data),a.errorsOnly)};}
  }
  if(task==='reader_records'){const records=await store.record(recordKey(a.kind)) as any;if(records){const offset=Number(a.offset||0),limit=Number(a.limit||30);return {...records,items:recordItems(records).slice(offset,offset+limit),offset,limit};}}
  const cached=await store.record(cacheKey(task,a));if(cached!==null)return cached;
  throw new AppError('OFFLINE_MISSING','Este conteúdo ainda não está disponível neste dispositivo. Conecte-se e prepare o estudo offline.',503);
 }
 const api:StudyApi=async(task,args)=>{
  await active();
  if(writable.has(task)&&projectId){
   const op=args.operationId as string,existing=(await store.operations()).find(x=>x.id===op);
   const same=Boolean(existing&&existing.task===task&&stable(existing.arguments)===stable(args));
   if(existing&&!same){
    // Reusing an operation id with another intent must surface the canonical
    // conflict before any local projection is touched.
    await store.enqueue({id:op,accountId,profileId,task,arguments:args,state:'pending',createdAt:new Date().toISOString()});
    throw new AppError('OPERATION_CONFLICT','operation id reused with different intent',409);
   }
   let projected:any;
   if(!existing){
    const updates:Record<string,unknown>={};
    // Prepare local projection before enqueue: invalid local answers never enter the queue.
    try{projected=await localEffect(task,args,updates);}catch(e){if(navigator.onLine&&task==='attempt_submit'){const q=await remote('content_get',{projectId,profileId,revision:args.bundleRevision,contentId:args.questionId});await store.putRecord(cacheKey('content_get',{projectId,profileId,revision:args.bundleRevision,contentId:args.questionId}),q);projected=await localEffect(task,args,updates);}else throw e;}
    await store.enqueue({id:op,accountId,profileId,task,arguments:args,state:'pending',createdAt:new Date().toISOString()},updates);
   }else{
    // Idempotent retry: keep the already-projected revision/data. Do not push
    // a second local effect, bump a revision or duplicate a record.
    projected=await projectedResult(task,args);
   }
   if(navigator.onLine)try{await sync();}catch(e){if(isAuth(e))throw e;}
   await active();
   const state=(await store.operations()).find(x=>x.id===op)!;
   if(state.state==='confirmed'){const receipt=await store.record('receipt:'+op);if(receipt)return receipt;return remote('operation_get',{operationId:op});}
   if(state.state==='conflict'||state.state==='error')throw new AppError(state.state==='conflict'?'CONFLICT':'REJECTED',state.error||'Operação não confirmada.',state.state==='conflict'?409:400);
   return {operationId:op,status:state.state,result:projected};
  }
  if(navigator.onLine)try{
   const result=await remote(task,args),merged=await reconcileRead(task,args,result);
   if(task!=='reader_records'&&task!=='form_get')await store.putRecord(cacheKey(task,args),merged);
   await active();
   return merged;
  }catch(e){
   if(e instanceof AppError){
    if(isAuth(e)){await clearStore();throw e;}
    if(e.status<500)throw e;
   }
  }
  const result=await packaged(task,args);await active();return result;
 };
 async function download(){await active();if(!projectId)throw Error('Estudo não selecionado.');try{await sync();const common=await remote('bundle_get',{projectId,profileId:null}) as PublishedManifest;await store.install(common,file=>fetchFile(file.path));try{const personal=await remote('bundle_get',{projectId,profileId}) as PublishedManifest;await store.install(personal,file=>fetchFile(file.path));}catch(e){if(!(e instanceof AppError&&e.status===404))throw e;}await active();return {downloaded:true};}catch(e){if(isAuth(e))await clearStore();throw e;}}
 return {api,store,sync,download,close:()=>{closed=true;store.close();}};
}
