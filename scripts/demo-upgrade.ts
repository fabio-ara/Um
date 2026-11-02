/** Additive correction of the existing local demonstration, preserving IDs/history. */
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import {authenticate} from '../src/auth.ts';
import {execute} from '../src/service.ts';
import {sourceView} from '../src/sources.ts';
import {published,content} from '../src/publication.ts';
import {pool,transaction,contentHash} from '../src/db.ts';
import {ensure} from '../src/errors.ts';
import {sectionAnchors,apologyScope,apologyReference,apologyWork} from './demo-editorial.ts';
import type {ContentBundle} from '../src/contracts.ts';
const url=new URL(process.env.DATABASE_URL!);ensure(process.env.APP_MODE==='local'&&url.hostname==='127.0.0.1'&&url.port==='57432'&&url.pathname==='/um','LOCAL_ONLY','Somente a demonstração local Um.');
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
const response=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(demo.author.credentials)});ensure(response.ok,'AUTH','Conta demonstrativa indisponível.');
const identity=await authenticate('Bearer '+(await response.json() as any).access_token),call=(name:any,args:any)=>execute(name,args,identity) as Promise<any>;
const students=await Promise.all(demo.students.map(async(s:any)=>{const r=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(s.credentials)});ensure(r.ok,'AUTH','Titular demonstrativo indisponível.');return authenticate('Bearer '+(await r.json() as any).access_token);}));
async function preservedSnapshot(){return {domain:await transaction(identity,async db=>({forms:(await db.query('select * from um.forms where project_id=$1 order by id',[demo.projectId])).rows,submissions:(await db.query('select * from um.submissions where project_id=$1 order by id',[demo.projectId])).rows})),personal:await Promise.all(students.map(student=>transaction(student,async db=>(await db.query('select * from um.reader_records where project_id=$1 order by id',[demo.projectId])).rows)))};}
const checkpoint='.local/demo-upgrade-anchors.json';
try{
 let plan:any;try{plan=JSON.parse(await readFile(checkpoint,'utf8'));}catch(e){if((e as any).code!=='ENOENT')throw e;}
 if(!plan){
  const sources=await Promise.all(demo.sourceIds.map((id:string)=>sourceView(identity,id))),sections={'17':sectionAnchors(sources,'17'),'21':sectionAnchors(sources,'21')};
  const current=(await call('project_get',{projectId:demo.projectId})).project;
  const bundles=[];
  for(const profileId of [null,...demo.students.map((s:any)=>s.profileId)]){
   const manifest=await published(identity,demo.projectId,profileId),objects=await Promise.all(manifest.index.map(async i=>({kind:i.kind,value:await content(identity,manifest,i.id)})));
   const b:ContentBundle={projectId:demo.projectId,profileId,revision:manifest.revision+1,baseRevision:current.activeRevision+1,units:objects.filter(o=>o.kind==='unit').map(o=>o.value),resources:objects.filter(o=>o.kind==='resource').map(o=>o.value),choices:objects.filter(o=>o.kind==='choice').map(o=>o.value),coverage:objects.filter(o=>o.kind==='coverage').map(o=>o.value),inspection:{kind:'ai',completed:true,references:['Leitura integral dos parágrafos de 17 e 21 em Burnet/Fowler, fixtures autorizadas.', 'Âncoras completas conferidas, incluindo o argumento de 21d; escopo limitado aos recortes trabalhados.'],findings:[]}};
   for(const u of b.units){u.appliedConfiguration={editorial:{language:'pt',organization:'source-order',sourceTreatment:'separate-source-interpretation-example'},instructional:{goals:'explicit'}};for(const link of u.references){const section=link.from[0].locator?.endsWith('21')?'21':'17',all=sections[section];link.from=all.filter(a=>a.sourceId===demo.sourceIds[0]);link.to=all.filter(a=>a.sourceId===demo.sourceIds[1]);link.provenance.references=[apologyReference];}for(const p of u.provenance)p.references=[apologyReference];}
   for(const r of b.resources){if(!r.appliedConfiguration.editorial)r.appliedConfiguration={editorial:{language:'pt'},instructional:r.appliedConfiguration};const all=sections[r.sources.some(a=>a.locator?.endsWith('21'))?'21':'17'];r.targets=all.filter(a=>a.sourceId===demo.sourceIds[0]);r.sources=all;r.baseRevision=b.baseRevision;}
   for(const q of b.choices){q.appliedConfiguration={editorial:{language:'pt'},instructional:{order:'fixed',feedback:'explanatory',repetition:'all-or-errors'}};q.sources=sections[q.sources.some(a=>a.locator?.endsWith('21'))?'21':'17'];q.revision++;}
   for(const c of b.coverage)c.sourceAnchors=sections[c.sourceAnchors.some(a=>a.locator?.endsWith('21'))?'21':'17'];
   const reasons=profileId?(await call('reasons_get',{projectId:demo.projectId,profileId})).items.map((r:any)=>{const {bundleRevision,...reason}=r.metadata;return reason;}):[];
   bundles.push({operationId:uuid(),expectedRevision:manifest.revision,bundle:b,reasons});
  }
  const preserved=await preservedSnapshot();
  plan={projectId:demo.projectId,update:{operationId:uuid(),projectId:demo.projectId,expectedRevision:current.revision,metadata:{object:{...current.object,workIds:[apologyWork]},scope:apologyScope}},bundles,preservedHash:contentHash(preserved),completed:false};
  await writeFile(checkpoint,JSON.stringify(plan,null,2),{flag:'wx'});
 }
 if(!plan.completed){
  await call('project_update',plan.update);for(const args of plan.bundles)await call('bundle_publish',args);
  const preserved=await preservedSnapshot();
  ensure(contentHash(preserved)===plan.preservedHash,'PRESERVATION','Estado anterior mudou durante a prova; conferir antes de afirmar preservação.');
  for(const args of plan.bundles){await published(identity,demo.projectId,args.bundle.profileId,args.expectedRevision);const saved=await published(identity,demo.projectId,args.bundle.profileId,args.bundle.revision);ensure(saved.index.every(item=>args.bundle.units.concat(args.bundle.resources,args.bundle.choices,args.bundle.coverage).some((x:any)=>x.id===item.id)),'PRESERVATION','Identidades de conteúdo incompatíveis.');}
  plan.completed=true;await writeFile(checkpoint,JSON.stringify(plan,null,2));
 }
 console.log(JSON.stringify({projectId:demo.projectId,commonRevision:plan.bundles[0].bundle.revision,profiles:plan.bundles.length-1,oldBundlesReadable:true,formsSubmissionsRecordsPreserved:true,scope:apologyScope}));
}finally{await pool.end();}
