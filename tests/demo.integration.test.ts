import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authenticate} from '../src/auth.ts';
import {execute} from '../src/service.ts';
import {published,content} from '../src/publication.ts';
import {pool} from '../src/db.ts';
import {sourceView} from '../src/sources.ts';
import {validateAnchor} from '../src/anchors.ts';
import {validateBundle} from '../src/editorial.ts';
import {analectsPassage} from '../scripts/demo-editorial.ts';
test('demonstração publicada conserva fontes/âncoras, dois perfis distintos e tema com duas obras',{skip:process.env.UM_DEMO_PROOF!=='1'},async()=>{
 assert.equal(process.env.APP_MODE,'local');const demo=JSON.parse(await readFile('.local/demo.json','utf8')),theme=JSON.parse(await readFile('.local/demo-theme.json','utf8'));
 const response=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(demo.author.credentials)});assert.equal(response.status,200);const actor=await authenticate('Bearer '+(await response.json() as any).access_token);
 try{
  const base=await published(actor,demo.projectId,null);assert.equal(base.revision,2);await published(actor,demo.projectId,null,1);
  const units=await Promise.all(base.index.filter(x=>x.kind==='unit').map(x=>content(actor,base,x.id))),sources=await Promise.all(demo.sourceIds.map((id:string)=>sourceView(actor,id)));
  const second=units[1],anchors=second.references.flatMap((r:any)=>[...r.from,...r.to]);
  assert.ok(anchors.some((a:any)=>a.exact.includes('what I do not know I do not think I know either')));assert.ok(anchors.some((a:any)=>a.exact.includes('ἃ μὴ οἶδα οὐδὲ οἴομαι εἰδέναι')));
  for(const u of units)for(const r of u.references)for(const a of [...r.from,...r.to])validateAnchor(a,sources.find(s=>s.id===a.sourceId)!);
  const personal=await Promise.all(demo.students.map(async(s:any)=>{const m=await published(actor,demo.projectId,s.profileId);assert.equal(m.baseRevision,2);await published(actor,demo.projectId,s.profileId,1);return Promise.all(m.index.filter(x=>x.kind==='resource').map(x=>content(actor,m,x.id)));}));
  assert.notDeepEqual(personal[0].map((r:any)=>r.body),personal[1].map((r:any)=>r.body));
  assert.ok(personal[0].some((r:any)=>r.type==='analogy'));assert.ok(personal[1].some((r:any)=>r.type==='contrast'));
  const result=await execute('project_get',{projectId:theme.projectId},actor) as any;assert.equal(result.project.object.kind,'theme');assert.equal(result.project.object.workIds.length,2);assert.equal(result.project.sourceIds.length,3);for(const id of demo.sourceIds)assert.ok(result.project.sourceIds.includes(id));
  const source=await sourceView(actor,theme.sourceId);assert.equal(source.metadata.nature,'translation');assert.equal(source.metadata.extent,'fragment');assert.equal(source.blocks[0].text,analectsPassage(await readFile('fixtures/sources/analects-legge.txt','utf8')));assert.ok(!source.blocks[0].text.includes('Tsze-chang'));
  for(const profileId of [null,...demo.students.map((s:any)=>s.profileId)]){const m=await published(actor,theme.projectId,profileId),objects=await Promise.all(m.index.map(async x=>({kind:x.kind,value:await content(actor,m,x.id)})));const bundle:any={projectId:theme.projectId,profileId,revision:m.revision,baseRevision:m.baseRevision,inspection:m.inspection};for(const [field,kind]of [['units','unit'],['resources','resource'],['choices','choice'],['coverage','coverage']])bundle[field]=objects.filter(o=>o.kind===kind).map(o=>o.value);validateBundle(bundle);}
 }finally{await pool.end();}
});
