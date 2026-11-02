import {test,expect,type Page} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {execute} from '../src/service.ts';
async function login(page:Page,credentials:{email:string;password:string}){
 await page.getByLabel('E-mail',{exact:true}).fill(credentials.email);await page.getByLabel('Senha',{exact:true}).fill(credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
}
test('troca de conta rejeita resposta real atrasada e impede acesso ao cache anterior offline',async({page,context})=>{
 const ctx=await localContext(),a=await ctx.accountSession(),b=await ctx.accountSession();
 let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const received=new Promise<void>(resolve=>{entered=resolve;});let hold=true;
 try{
  await execute('profile_create',{operationId:uuid(),fields:{name:'Privado da conta A'},self:true},a.identity);await execute('profile_create',{operationId:uuid(),fields:{name:'Privado da conta B'},self:true},b.identity);
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await login(page,a.credentials);
  await page.route('**/api/profile_list',async route=>{
   const body=route.request().postDataJSON();if(hold&&body.limit===1){hold=false;const response=await route.fetch();entered();await delayed;await route.fulfill({response});}else await route.continue();
  });
  await page.evaluate(async accountId=>{
   const url='/src/web/study-api.ts';const {studyClient}=await import(url);const old=await studyClient(accountId,'account');
   (window as any).__oldAccountClient=old;(window as any).__lateAccountResponse=old.api('profile_list',{limit:1}).then(()=>({leak:true}), (e:any)=>({code:e.code}));
  },a.identity.id);
  await received;
  await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByRole('button',{name:'Sair e limpar dados locais da conta',exact:true}).click();await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();
  await login(page,b.credentials);release();
  expect(await page.evaluate(()=>(window as any).__lateAccountResponse)).toEqual({code:'UNAUTHENTICATED'});
  const online=await page.evaluate(async accountId=>{const url='/src/web/study-api.ts';const {studyClient}=await import(url);const current=await studyClient(accountId,'account');(window as any).__currentAccountClient=current;return (await current.api('profile_list',{})).items.map((p:any)=>p.fields.name);},b.identity.id);
  expect(online).toEqual(['Privado da conta B']);
  await context.setOffline(true);
  const offline=await page.evaluate(async()=>{
   const current=(window as any).__currentAccountClient,old=(window as any).__oldAccountClient;
   return {current:(await current.api('profile_list',{})).items.map((p:any)=>p.fields.name),old:await old.api('profile_list',{}).then(()=>({leak:true}),(e:any)=>({code:e.code}))};
  });expect(offline).toEqual({current:['Privado da conta B'],old:{code:'UNAUTHENTICATED'}});
  const oldKeys=await page.evaluate(async accountId=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('um-offline-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   try{const keys=await Promise.all([...db.objectStoreNames].map(store=>new Promise<IDBValidKey[]>((resolve,reject)=>{const request=db.transaction(store).objectStore(store).getAllKeys();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);})));return keys.flat().filter(key=>String(key).includes(accountId));}finally{db.close();}
  },a.identity.id);expect(oldKeys).toEqual([]);
  await context.setOffline(false);await page.evaluate(()=>{(window as any).__oldAccountClient.close();(window as any).__currentAccountClient.close();});
 }finally{release();await context.setOffline(false);await page.close();await ctx.close();}
});
