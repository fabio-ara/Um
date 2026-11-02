import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {personalStudyFixture} from './personal-study-fixture.ts';

test('resposta HTTP antiga não desfaz escrita confirmada e paginação conserva intenção offline',async({page,context})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();let release=()=>{};
 try{
  const f=await personalStudyFixture(account.identity),scope={projectId:f.projectId,profileId:f.profileId};
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
  await page.evaluate(async args=>{const url='/src/web/study-api.ts';const {studyClient}=await import(url);(window as any).__lateClient=await studyClient(args.accountId,args.profileId,args.projectId);},{accountId:account.identity.id,...scope});
  const invoke=(task:string,args:any)=>page.evaluate(async({task,args})=>(window as any).__lateClient.api(task,args),{task,args});
  const records={...scope,kind:'note',limit:100};
  async function delayRead(task:string,args:any){
   let arrived!:()=>void;const ready=new Promise<void>(r=>{arrived=r;}),gate=new Promise<void>(r=>{release=r;});let hold=true;
   await page.route(`**/api/${task}`,async route=>{if(hold){hold=false;const response=await route.fetch();arrived();await gate;await route.fulfill({response});}else await route.continue();});
   await page.evaluate(({task,args})=>{(window as any).__lateResult=(window as any).__lateClient.api(task,args);},{task,args});await ready;
   return async()=>{release();const result=await page.evaluate(()=>(window as any).__lateResult);await page.unroute(`**/api/${task}`);return result;};
  }
  const noteId=uuid();await invoke('note_save',{operationId:uuid(),...scope,recordId:noteId,expectedRevision:0,anchor:f.anchor,text:'Nota a excluir'});
  const finishDelete=await delayRead('reader_records',records);await invoke('record_delete',{operationId:uuid(),...scope,recordId:noteId,expectedRevision:1});expect((await finishDelete()).items.some((n:any)=>n.id===noteId)).toBe(false);
  const finishCreate=await delayRead('reader_records',records),newId=uuid();await invoke('note_save',{operationId:uuid(),...scope,recordId:newId,expectedRevision:0,anchor:f.anchor,text:'Nota confirmada depois da leitura'});expect((await finishCreate()).items.find((n:any)=>n.id===newId).data.text).toBe('Nota confirmada depois da leitura');
  await invoke('form_get',{formId:f.formId});await invoke('form_draft',{operationId:uuid(),formId:f.formId,formRevision:1,answers:{support:'Comparações'},expectedRevision:0});
  const finishForm=await delayRead('form_get',{formId:f.formId});await invoke('form_submit',{operationId:uuid(),formId:f.formId,formRevision:1,answers:{support:'Comparações'}});expect((await finishForm()).draft).toBe(null);
  await context.setOffline(true);expect((await invoke('form_get',{formId:f.formId})).draft).toBe(null);expect((await invoke('reader_records',records)).items.map((n:any)=>n.id)).toEqual([newId]);
  const pendingId='00000000-0000-4000-8000-000000000001';await invoke('note_save',{operationId:uuid(),...scope,recordId:pendingId,expectedRevision:0,anchor:f.anchor,text:'Intenção offline fora das páginas remotas'});
  const remoteIds=[newId];for(let i=0;i<3;i++){const id=uuid();remoteIds.push(id);await f.call('note_save',{operationId:uuid(),...scope,recordId:id,expectedRevision:0,anchor:f.anchor,text:`Outra nota ${i}`});}
  await context.setOffline(false);let offset=0;const ids:string[]=[];
  for(let pageNumber=0;pageNumber<4;pageNumber++){const result=await invoke('reader_records',{...scope,kind:'note',offset,limit:2});ids.push(...result.items.map((n:any)=>n.id));if(result.nextOffset===null)break;offset=result.nextOffset;}
  expect(ids.sort()).toEqual([...remoteIds,pendingId].sort());expect(new Set(ids).size).toBe(5);
  await context.setOffline(true);expect((await invoke('reader_records',records)).items.map((n:any)=>n.id).sort()).toEqual(ids.sort());
  await context.setOffline(false);await page.evaluate(async()=>{await (window as any).__lateClient.sync();(window as any).__lateClient.close();});
 }finally{release();await context.setOffline(false);await page.close();await ctx.close();}
});
