import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {sourceGuardFixture} from './source-guard-fixture.ts';

test('publicação concorrente e recibo perdido não separam pacote e revisão reancorada',async({page,context})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();let release=()=>{};
 try{
  const f=await sourceGuardFixture(account.identity),profileId=(await f.call('profile_create',{operationId:uuid(),fields:{name:'Fixture de revisão alvo'},self:true})).result.profileId,scope={projectId:f.projectId,profileId};
  await f.call('participation_add',{operationId:uuid(),...scope});const noteId=uuid();await f.call('note_save',{operationId:uuid(),...scope,recordId:noteId,expectedRevision:0,anchor:f.anchor,text:'Citação preservada entre revisões'});
  async function publish(version:number){const prefix=`Revisão publicada ${version}: `,anchor={...f.anchor,sourceRevision:version,start:Array.from(prefix).length,end:Array.from(prefix).length+8};await f.call('source_revise',{operationId:uuid(),sourceId:f.sourceId,expectedRevision:version-1,blocks:f.source.blocks.map(b=>({...b,text:prefix+b.text})),reason:'Revisão sintética concorrente'});const bundle=structuredClone(f.bundle);bundle.revision=version;bundle.baseRevision=version;bundle.units[0].references[0].from=[anchor];bundle.units[0].references[0].to=[anchor];bundle.coverage[0].sourceAnchors=[anchor];await f.call('bundle_publish',{operationId:uuid(),expectedRevision:version-1,bundle});}
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
  const connect=()=>page.evaluate(async args=>{const url='/src/web/study-api.ts';const {studyClient}=await import(url);(window as any).__revisionClient=await studyClient(args.accountId,args.profileId,args.projectId);},{accountId:account.identity.id,...scope});await connect();
  await page.evaluate(async scope=>{const c=(window as any).__revisionClient;await c.download();await c.api('reader_records',{...scope,kind:'note'});},scope);
  const installed=()=>page.evaluate(async projectId=>(await (window as any).__revisionClient.store.package(projectId,false)).manifest.revision,f.projectId);
  await publish(2);let arrived!:()=>void;const ready=new Promise<void>(r=>{arrived=r;}),gate=new Promise<void>(r=>{release=r;});
  await page.route('**/api/reader_rebase',async route=>{arrived();await gate;await route.continue();});
  await page.evaluate(()=>{const c=(window as any).__revisionClient;(window as any).__revisionResult=c.update().then((r:any)=>({ok:r}),(e:any)=>({code:e.code}));});await ready;await publish(3);release();
  expect(await page.evaluate(()=>(window as any).__revisionResult)).toEqual({code:'STALE_BASE'});expect(await installed()).toBe(1);await page.unroute('**/api/reader_rebase');
  let lost=false;await page.route('**/api/reader_rebase',async route=>{if(route.request().postDataJSON().expectedBaseRevision===3){const response=await route.fetch();expect(response.status()).toBe(200);lost=true;await route.abort('failed');}else await route.continue();});
  const uncertain=await page.evaluate(async()=>{try{await (window as any).__revisionClient.update();return false;}catch{return true;}});expect(uncertain).toBe(true);expect(lost).toBe(true);expect(await installed()).toBe(1);
  expect((await f.call('reader_records',{...scope,kind:'note'})).items[0].data.anchor.sourceRevision).toBe(3);
  const pending=await page.evaluate(async projectId=>(window as any).__revisionClient.store.record('update:'+projectId),f.projectId);expect(pending.expectedBaseRevision).toBe(3);expect((await f.call('operation_get',{operationId:pending.operationId})).result.baseRevision).toBe(3);
  await page.unroute('**/api/reader_rebase');await page.evaluate(()=>(window as any).__revisionClient.close());await page.reload();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();await connect();
  await context.setOffline(true);expect(await installed()).toBe(1);expect(await page.evaluate(async scope=>(await (window as any).__revisionClient.api('reader_records',{...scope,kind:'note'})).items[0].data.anchor.sourceRevision,scope)).toBe(1);
  await publish(4);await context.setOffline(false);expect((await page.evaluate(()=>(window as any).__revisionClient.update())).baseRevision).toBe(4);expect(await installed()).toBe(4);
  const records=await f.call('reader_records',{...scope,kind:'note'});expect(records.items).toHaveLength(1);expect(records.items[0].data).toMatchObject({anchor:{sourceRevision:4,exact:'Conferir'},text:'Citação preservada entre revisões'});
  expect(await page.evaluate(async projectId=>(window as any).__revisionClient.store.record('update:'+projectId),f.projectId)).toBe(null);
  const committed=(await ctx.admin.query("select result->>'baseRevision' as revision from um.operations where account_id=$1 and task='reader_rebase' order by committed_at",[account.identity.id])).rows;expect(committed.map(r=>r.revision)).toEqual(['3','4']);
  await page.evaluate(()=>(window as any).__revisionClient.close());
 }finally{release();await context.setOffline(false);await page.close();await ctx.close();}
});
