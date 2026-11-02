import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {execute} from '../src/service.ts';

test('troca direta de conta neutraliza o DOM antes da limpeza do IndexedDB terminar',async({page})=>{
 const ctx=await localContext({closePool:false}),a=await ctx.accountSession(),b=await ctx.accountSession();
 try{
  await execute('profile_create',{operationId:uuid(),fields:{name:'Titular A'},self:true},a.identity);await execute('profile_create',{operationId:uuid(),fields:{name:'Titular B'},self:true},b.identity);
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(a.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(a.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();await page.getByRole('button',{name:'Conta',exact:true}).click();await expect(page.getByText(a.credentials.email,{exact:true})).toBeVisible();
  // Hold a genuine IDB transaction so cleanup has an observable async window.
  await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('um-offline-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const tx=db.transaction([...db.objectStoreNames],'readwrite');(window as any).__idbHold=true;const loop=()=>{const r=tx.objectStore('records').get('__fixture_lock__');r.onsuccess=()=>{if((window as any).__idbHold)loop();};};loop();tx.oncomplete=()=>db.close();});
  await page.evaluate(async credentials=>{const url='/src/web/api.ts';const {auth}=await import(url);const result=await auth.signInWithPassword(credentials);if(result.error)throw result.error;},b.credentials);
  await expect(page.locator('#app [role=status]')).toHaveText('Conferindo a conta e os dados deste dispositivo…');await expect(page.getByText(a.credentials.email,{exact:true})).toHaveCount(0);await expect(page.locator('[data-action]')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).__idbHold=false;});await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();await page.getByRole('button',{name:'Conta',exact:true}).click();await expect(page.getByText(b.credentials.email,{exact:true})).toBeVisible();await expect(page.getByText(a.credentials.email,{exact:true})).toHaveCount(0);
 }finally{await page.evaluate(()=>{(window as any).__idbHold=false;}).catch(()=>{});await page.close();await ctx.close();}
});
