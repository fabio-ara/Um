import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
test('fila real conserva nota em conflito, isola estudos e sincroniza sem duplicação',async({page,context})=>{
 await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
 await page.evaluate(async demo=>{
  const studyUrl='/src/web/study-api.ts',apiUrl='/src/web/api.ts';const {studyClient}=await import(studyUrl),{remote}=await import(apiUrl);
  const student=demo.students[0],otherId=crypto.randomUUID(),c=await studyClient(student.accountId,student.profileId,demo.projectId),other=await studyClient(student.accountId,student.profileId,otherId);
  const s=await remote('source_get',{sourceId:demo.sourceIds[0],limit:1}),b=s.blocks[0],text=Array.from(b.text).slice(0,12).join('');
  const anchor={sourceId:s.id,sourceRevision:s.revision,elementId:b.id,start:0,end:12,exact:text,prefix:'',suffix:''};
  const args={operationId:crypto.randomUUID(),projectId:demo.projectId,profileId:student.profileId,recordId:crypto.randomUUID(),expectedRevision:0,anchor,text:'Intenção local em conflito'};
  (window as any).__sync={c,other,otherId,args,remote};
 },demo);
 await context.setOffline(true);
 const local=await page.evaluate(async()=>{const {c,other,otherId,args}=(window as any).__sync;await c.api('note_save',args);await c.api('note_save',args);return {count:(await c.store.operations()).filter((x:any)=>x.id===args.operationId).length,own:(await c.api('reader_records',{projectId:args.projectId,profileId:args.profileId,kind:'note'})).items.filter((x:any)=>x.id===args.recordId).length,other:await other.api('reader_records',{projectId:otherId,profileId:args.profileId,kind:'note'}).then((x:any)=>x.items).catch((e:any)=>{if(e.code==='OFFLINE_MISSING')return [];throw e;})};});
 expect(local.count).toBe(1);expect(local.own).toBe(1);expect(local.other).toEqual([]);
 await context.setOffline(false);
 const conflict=await page.evaluate(async()=>{const {c,args,remote}=(window as any).__sync;await remote('note_save',{...args,operationId:crypto.randomUUID(),text:'Versão remota'});const before=await c.api('reader_records',{projectId:args.projectId,profileId:args.profileId,kind:'note'});await c.sync();await c.sync();const ops=await c.store.operations(),after=await c.api('reader_records',{projectId:args.projectId,profileId:args.profileId,kind:'note'}),server=await remote('reader_records',{projectId:args.projectId,profileId:args.profileId,kind:'note'});return {before:before.items.find((x:any)=>x.id===args.recordId)?.data.text,state:ops.find((x:any)=>x.id===args.operationId)?.state,after:after.items.find((x:any)=>x.id===args.recordId)?.data.text,server:server.items.filter((x:any)=>x.id===args.recordId).map((x:any)=>x.data.text)};});
 expect(conflict).toEqual({before:'Intenção local em conflito',state:'conflict',after:'Intenção local em conflito',server:['Versão remota']});
 await page.evaluate(async()=>{const {c,other,args,remote}=(window as any).__sync;await remote('record_delete',{operationId:crypto.randomUUID(),projectId:args.projectId,profileId:args.profileId,recordId:args.recordId,expectedRevision:1});await c.store.clear();c.close();other.close();});
});
