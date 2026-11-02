import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {catalogTask} from '../src/catalog.ts';
import {projectTask} from '../src/projects.ts';
const ctx=await localContext();after(ctx.close);
test('catálogo efetivo isolado e fusão transacional redirecionam obras sem mudar texto-fonte',async()=>{
 const author=await ctx.account(),other=await ctx.account();
 const create=(kind:string,name:string)=>({id:uuid(),kind,labels:{pt:name},aliases:[],authorIds:[],regions:[],traditions:[],disciplines:[],periods:[],dates:{start:null,end:null,approximate:false},locations:[],metadata:{}});
 const a=create('author','Autora A'),b=create('author','Autora B'),work={...create('work','Obra'),authorIds:[a.id,b.id],authorship:'multiple'};
 for(const entity of [a,b,work])await catalogTask(author,'library_save',{operationId:uuid(),entity,expectedRevision:0});
 for(const id of [a.id,b.id])assert.deepEqual((await catalogTask(author,'library_search',{authorIds:[id],query:'Obra'}) as any).items.map((x:any)=>x.id),[work.id]);
 const unknown={...create('work','Obra de autoria desconhecida'),authorship:'unknown'};
 await catalogTask(author,'library_save',{operationId:uuid(),entity:unknown,expectedRevision:0});
 assert.equal((await catalogTask(author,'library_get',{entityId:unknown.id}) as any).entity.authorship,'unknown');
 const projectId=(await projectTask(author,'project_create',{operationId:uuid(),title:'Estudo por obra e coautoria',metadata:{object:{kind:'work',workIds:[work.id],subject:'Obra'},scope:'Fixture',language:'pt',audience:'Teste',configuration:{editorial:{},instructional:{}}}}) as any).result.projectId;
 assert.deepEqual((await projectTask(author,'project_get',{projectId}) as any).project.object.workIds,[work.id]);
 const visible=(await catalogTask(other,'library_search',{}) as any).items;
 for(const entity of [a,b,work]){assert.ok(!visible.some((item:any)=>item.id===entity.id));await assert.rejects(catalogTask(other,'library_get',{entityId:entity.id}),/indisponível/);}
 await catalogTask(author,'library_rename',{operationId:uuid(),entityId:a.id,expectedRevision:1,language:'pt',label:'Autora A corrigida'});
 await catalogTask(author,'library_merge',{operationId:uuid(),fromIds:[b.id],targetId:a.id});
 const stored=await catalogTask(author,'library_get',{entityId:work.id}) as any;assert.deepEqual(stored.entity.authorIds,[a.id]);assert.equal(stored.entity.authorship,'multiple');
 assert.equal((await catalogTask(author,'library_search',{authorIds:[a.id]}) as any).items.length,1);assert.equal((await catalogTask(author,'library_search',{query:'Autora B'}) as any).items[0].id,a.id);
 const first=create('author','Parte 1'),second=create('author','Parte 2');
 await assert.rejects(catalogTask(author,'library_split',{operationId:uuid(),sourceId:a.id,replacements:[first,second],assignments:{}}),/destino/);
 await catalogTask(author,'library_split',{operationId:uuid(),sourceId:a.id,replacements:[first,second],assignments:{[work.id]:second.id}});
 assert.deepEqual((await catalogTask(author,'library_get',{entityId:work.id}) as any).entity.authorIds,[second.id]);
});
