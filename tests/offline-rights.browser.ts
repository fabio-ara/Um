import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {sourceGuardFixture} from './source-guard-fixture.ts';
test('reconexão retira pacote sem permissão offline e conserva a nota criada sem rede',async({page,context})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession(),f=await sourceGuardFixture(account.identity);
 try{
  const profileId=(await f.call('profile_create',{operationId:uuid(),fields:{name:'Titular da fixture de direitos'},self:true})).result.profileId;
  await f.call('participation_add',{operationId:uuid(),projectId:f.projectId,profileId});
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator(`[data-action=reader][data-project="${f.projectId}"]`).click();
  await expect(page.getByRole('region',{name:'Leitor de estudo',exact:true})).toBeVisible();await expect(page.locator('.reader-body')).toBeVisible();
  await page.getByRole('button',{name:'Conexão e sincronização',exact:true}).click();await page.getByRole('button',{name:'Preparar este estudo para uso offline',exact:true}).click();
  await page.evaluate(async({accountId,profileId,projectId})=>{const url='/src/web/study-api.ts';const {studyClient}=await import(url);(window as any).__rightsClient=await studyClient(accountId,profileId,projectId);},{accountId:account.identity.id,profileId,projectId:f.projectId});
  await expect.poll(()=>page.evaluate(async projectId=>Boolean(await (window as any).__rightsClient.store.package(projectId,false)),f.projectId)).toBe(true);
  const cached=await page.evaluate(async sourceId=>{const c=(window as any).__rightsClient;await c.api('source_get',{sourceId});return c.store.record('read:source_get:'+JSON.stringify({sourceId}));},f.sourceId);expect(cached).toBe(null);
  await context.setOffline(true);
  const noteId=uuid(),operationId=uuid();
  await page.evaluate(async args=>{const c=(window as any).__rightsClient;await c.api('note_save',args);},{operationId,recordId:noteId,expectedRevision:0,projectId:f.projectId,profileId,anchor:f.anchor,text:'Nota privada preservada durante mudança de direitos.'});
  await f.call('source_revise',{operationId:uuid(),sourceId:f.sourceId,expectedRevision:1,metadata:{...f.metadata,rights:{...f.metadata.rights,offlineAllowed:false}},reason:'Mudança sintética de permissão durante desconexão'});
  expect(await page.evaluate(async sourceId=>(await (window as any).__rightsClient.api('source_get',{sourceId})).blocks.length,f.sourceId)).toBe(1);
  await context.setOffline(false);await page.evaluate(async()=>{await (window as any).__rightsClient.sync();});
  expect(await page.evaluate(async projectId=>(window as any).__rightsClient.store.package(projectId,false),f.projectId)).toBe(null);
  const notes=(await f.call('reader_records',{projectId:f.projectId,profileId,kind:'note'})).items;expect(notes.filter((n:any)=>n.id===noteId)).toHaveLength(1);
  await context.setOffline(true);
  const result=await page.evaluate(async({sourceId,projectId,profileId,unitId})=>{
   const c=(window as any).__rightsClient;
   return {manifest:await c.api('bundle_get',{projectId,profileId:null}).then(()=>({leak:true}),(e:any)=>({code:e.code})),source:await c.api('source_get',{sourceId}).then(()=>({leak:true}),(e:any)=>({code:e.code})),unit:await c.api('content_get',{projectId,profileId:null,revision:1,contentId:unitId}).then(()=>({leak:true}),(e:any)=>({code:e.code})),notes:(await c.api('reader_records',{projectId,profileId,kind:'note'})).items.map((n:any)=>n.data.text)};
  },{sourceId:f.sourceId,projectId:f.projectId,profileId,unitId:f.unitId});
  expect(result).toEqual({manifest:{code:'OFFLINE_MISSING'},source:{code:'OFFLINE_MISSING'},unit:{code:'OFFLINE_MISSING'},notes:['Nota privada preservada durante mudança de direitos.']});
  await page.evaluate(()=>(window as any).__rightsClient.close());
 }finally{await context.setOffline(false);await page.close();await ctx.close();}
});
