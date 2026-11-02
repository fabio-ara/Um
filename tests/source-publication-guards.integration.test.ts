import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {sourceGuardFixture} from './source-guard-fixture.ts';
import {execute} from '../src/service.ts';
import {sourceView} from '../src/sources.ts';
import {getFile} from '../src/files.ts';
import {transaction} from '../src/db.ts';
const ctx=await localContext();after(ctx.close);
test('direitos atuais limitam arquivos e manifesto histórico; fonte de complemento oculto continua protegida',async()=>{
 const author=await ctx.account(),holder=await ctx.account(),f=await sourceGuardFixture(author),call=f.call;
 const profileId=(await call('profile_create',{operationId:uuid(),fields:{name:'Titular sintético'}})).result.profileId;
 const token=(await call('invite_create',{operationId:uuid(),profileId})).result.token;await execute('invite_accept',{operationId:uuid(),token},holder);await call('participation_add',{operationId:uuid(),projectId:f.projectId,profileId});
 const before=await call('bundle_get',{projectId:f.projectId,profileId:null}),original=before.sourceIndex[0].original;assert.ok(original);await getFile(holder,original);
 await call('source_revise',{operationId:uuid(),sourceId:f.sourceId,expectedRevision:1,metadata:{...f.metadata,rights:{...f.metadata.rights,offlineAllowed:false}},reason:'Permissão offline retirada na fixture'});
 const after=await call('bundle_get',{projectId:f.projectId,profileId:null,revision:1});assert.ok(after.files.every((x:any)=>!x.offlineAllowed));assert.equal(after.sourceIndex[0].original,null);
 await assert.rejects(getFile(holder,original),/indisponível/);assert.equal((await sourceView(holder,f.sourceId,1)).metadata.rights.offlineAllowed,true);assert.equal((await sourceView(holder,f.sourceId,1)).offlineAllowed,false);
 const counts=(await ctx.admin.query('select count(*)::integer as n from um.files where (source_id=$1 or project_id=$2) and offline_allowed',[f.sourceId,f.projectId])).rows[0];assert.equal(counts.n,0);
 await call('source_revise',{operationId:uuid(),sourceId:f.sourceId,expectedRevision:2,metadata:f.metadata,reason:'Permissão restaurada na fixture'});await getFile(holder,original);
 const extraId=(await call('source_import',{operationId:uuid(),format:'text',text:'A fonte pessoal adicional não fazia parte da publicação comum anterior.',metadata:{...f.metadata,title:'Fonte somente do complemento'}})).result.sourceId;
 await call('source_attach',{operationId:uuid(),projectId:f.projectId,sourceId:extraId});const extra=await sourceView(author,extraId),anchor={sourceId:extraId,sourceRevision:1,elementId:extra.blocks[0].id,start:0,end:7,exact:'A fonte',prefix:'',suffix:''};
 const formId=uuid();await call('form_save',{operationId:uuid(),expectedRevision:0,definition:{id:formId,revision:1,projectId:f.projectId,profileId,questions:[{id:'support',type:'single_choice',prompt:'Qual apoio?',required:true,options:[{id:'case',label:'Caso'},{id:'none',label:'Sem preferência'}]}],purposeByQuestion:{support:'Apoio declarado'},planningReference:'Fixture',maxQuestions:6}});await call('form_publish',{operationId:uuid(),formId,expectedRevision:1});
 const submitted=await execute('form_submit',{operationId:uuid(),formId,formRevision:1,answers:{support:'case'}},holder) as any;
 const choiceId=uuid(),personal={...f.bundle,profileId,units:[],choices:[{id:choiceId,revision:1,unitId:f.unitId,profileId,position:0,prompt:'Como conferir?',options:[{id:'yes',text:'Examinar a fonte',feedback:'A fonte permite conferir.'},{id:'no',text:'Repetir',feedback:'Repetição não acrescenta evidência.'}],correctOptionId:'yes',coverageTargets:[f.coverageId],sources:[anchor]}],coverage:[{...f.bundle.coverage[0],sourceAnchors:[anchor],practiceIds:[choiceId]}]};
 await call('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle:personal,reasons:[{resourceId:choiceId,submissionId:submitted.result.submissionId,submissionRevision:1,questionIds:['support'],rationale:'Apoio sintético baseado na resposta.'}]});
 await execute('profile_control',{operationId:uuid(),profileId,action:'revoke_creator'},holder);await assert.rejects(call('bundle_get',{projectId:f.projectId,profileId}),/indisponível/);
 await assert.rejects(call('source_detach',{operationId:uuid(),projectId:f.projectId,sourceId:extraId}),/publicação preservada/);
 await assert.rejects(transaction(author,db=>db.query('delete from um.project_sources where project_id=$1 and source_id=$2',[f.projectId,extraId])),/SOURCE_IN_USE/);
 await assert.rejects(call('source_delete',{operationId:uuid(),sourceId:extraId,expectedRevision:1}),/vinculada/);
 assert.equal((await sourceView(holder,extraId)).id,extraId);
 // Reuse of an authorized source by a different author also acquires the
 // source-before-project lock without incorrectly requiring source ownership.
 const project=(await execute('project_create',{operationId:uuid(),title:'Reuso autorizado',metadata:{object:{kind:'theme',workIds:[],subject:'Reuso'},scope:'Fixture',language:'pt',audience:'Teste',configuration:{editorial:{},instructional:{}}}},holder) as any).result.projectId;
 await execute('source_attach',{operationId:uuid(),projectId:project,sourceId:extraId},holder);
 const reused={...f.bundle,projectId:project,units:[{...f.bundle.units[0],references:[{...f.bundle.units[0].references[0],from:[anchor],to:[anchor]}]}],coverage:[{...f.bundle.coverage[0],sourceAnchors:[anchor]}]};
 await execute('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle:reused},holder);
});
test('detach concorrente com publicação não deixa manifesto fora do alcance',async()=>{
 const author=await ctx.account(),f=await sourceGuardFixture(author,false);
 await ctx.admin.query('begin');await ctx.admin.query('select id from um.projects where id=$1 for update',[f.projectId]);
 const settled=(p:Promise<any>)=>p.then(value=>({value,error:null}),error=>({value:null,error}));
 const publish=settled(f.call('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle:f.bundle}));
 const detach=settled(f.call('source_detach',{operationId:uuid(),projectId:f.projectId,sourceId:f.sourceId}));
 try{
  let waiting=0;for(let n=0;n<50;n++){await ctx.admin.query('select pg_stat_clear_snapshot()');waiting=Number((await ctx.admin.query("select count(*) from pg_stat_activity where application_name='um' and wait_event_type='Lock' and query like '%um.projects%'")).rows[0].count);if(waiting>=2)break;await new Promise(r=>setTimeout(r,20));}assert.ok(waiting>=2,'Ambas as transações devem alcançar o bloqueio real do projeto.');
 }finally{await ctx.admin.query('commit');}
 const [p,d]=await Promise.all([publish,detach]);assert.ok(p.error||d.error);assert.notEqual(p.error?.code,'40P01');assert.notEqual(d.error?.code,'40P01');
 if(!p.error){assert.equal(d.error.code,'SOURCE_IN_USE');assert.ok((await f.call('project_get',{projectId:f.projectId})).project.sourceIds.includes(f.sourceId));}
 else{assert.equal(p.error.code,'CONFLICT');await assert.rejects(f.call('bundle_get',{projectId:f.projectId,profileId:null}),/indisponível/);}
});
test('revisão de fonte e publicação usam a mesma ordem de bloqueios',async()=>{
 const author=await ctx.account(),f=await sourceGuardFixture(author,false);
 await ctx.admin.query('begin');await ctx.admin.query('select id from um.sources where id=$1 for update',[f.sourceId]);
 const settled=(p:Promise<any>)=>p.then(value=>({value,error:null}),error=>({value:null,error}));
 const publish=settled(f.call('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle:f.bundle}));
 const revise=settled(f.call('source_revise',{operationId:uuid(),sourceId:f.sourceId,expectedRevision:1,metadata:{...f.metadata,title:'Título revisado durante publicação'},reason:'Concorrência controlada da fixture'}));
 try{
  let waiting=0;for(let n=0;n<50;n++){await ctx.admin.query('select pg_stat_clear_snapshot()');waiting=Number((await ctx.admin.query("select count(*) from pg_stat_activity where application_name='um' and wait_event_type='Lock' and (query like '%um.sources%' or query like '%um.lock_source%')")).rows[0].count);if(waiting>=2)break;await new Promise(r=>setTimeout(r,20));}assert.ok(waiting>=2,'Ambas as transações devem disputar a fonte antes do projeto.');
 }finally{await ctx.admin.query('commit');}
 const [p,r]=await Promise.all([publish,revise]);assert.equal(r.error,null);assert.notEqual(p.error?.code,'40P01');assert.ok(!p.error||['STALE_SOURCE','CONFLICT'].includes(p.error.code));
 assert.equal((await f.call('source_get',{sourceId:f.sourceId})).revision,2);
 if(!p.error)assert.equal((await f.call('project_get',{projectId:f.projectId})).project.baseState,'correcting');
});
