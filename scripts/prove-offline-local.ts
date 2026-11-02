// Local integration proof. File acquisition uses authenticated HTTP in Node,
// never browser download UI. Credentials remain in the ignored demo receipt.
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4420',api='http://127.0.0.1:4417';
const demo=JSON.parse(await readFile('.local/demo.json','utf8')),student=demo.students[0];
assert.equal(demo.kind,'local-synthetic-demonstration');
await mkdir('.local/proofs',{recursive:true});
const profile=await mkdtemp(resolve('.local/offline-proof-'));
const vite=resolve('node_modules/vite/bin/vite.js');let server:ReturnType<typeof spawn>|undefined,context:any;
async function start(preview=false){
 try{await fetch(origin,{signal:AbortSignal.timeout(500)});throw Error('Port 4420 already in use');}catch(e){if((e as Error).message==='Port 4420 already in use')throw e;}
 server=spawn(process.execPath,[vite,...(preview?['preview']:[]),'--host','127.0.0.1','--port','4420','--strictPort'],{stdio:'ignore',windowsHide:true});
 for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Proof server failed');try{if((await fetch(origin+(preview?'/Um/':'/'))).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server readiness timeout');
}
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=undefined;}
async function browser(){context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:390,height:844},colorScheme:'dark'});return context.pages()[0];}
const auth=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(student.credentials)}).then(r=>r.json()) as any;
assert.ok(auth.access_token);const headers={Authorization:'Bearer '+auth.access_token,'content-type':'application/json'};
async function remote(task:string,args:any){const r=await fetch(api+'/api/'+task,{method:'POST',headers,body:JSON.stringify(args)});assert.ok(r.ok,task+' HTTP '+r.status);return (await r.json() as any).data;}
try{
 console.log("Stage: seed real cache through dev modules");await start();let page=await browser();await page.goto(origin);
 await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(student.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(student.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.locator(`[data-action=reader][data-project="${demo.projectId}"]`)).toBeVisible();await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();await expect(page.getByRole('region',{name:'Leitor de estudo'})).toBeVisible();
 const packages=[];
 for(const profileId of [null,student.profileId]){
  const manifest=await remote('bundle_get',{projectId:demo.projectId,profileId}),files:Record<string,number[]>={};
  for(const entry of manifest.files){const response=await fetch(api+'/api/file/'+entry.path,{headers});assert.ok(response.ok);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);files[entry.path]=Array.from(bytes);}
  packages.push({manifest,files});
 }
 await page.evaluate(async({packages,student}:any)=>{const url='/src/web/offline.ts';const {openOffline}=await import(url);const store=await openOffline(student.accountId,student.profileId);for(const p of packages)await store.install(p.manifest,async(f:any)=>new Uint8Array(p.files[f.path]));store.close();},{packages,student:{accountId:student.accountId,profileId:student.profileId}});
 await context.close();context=null;await stop();
 console.log("Stage: built shell online");execFileSync(process.execPath,[vite,'build'],{stdio:'pipe',windowsHide:true});await start(true);
 page=await browser();await page.goto(origin+'/Um/');await expect(page.locator(`[data-action=reader][data-project="${demo.projectId}"]`)).toBeVisible();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise<void>(r=>navigator.serviceWorker.addEventListener('controllerchange',()=>r(),{once:true}));});
 await context.close();context=null;
 console.log('Stage: new offline browser process');page=await browser();await context.setOffline(true);await page.goto(origin+'/Um/');
 await expect(page.locator(`[data-action=reader][data-project="${demo.projectId}"]`)).toBeVisible();await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();await expect(page.getByRole('region',{name:'Leitor de estudo'})).toBeVisible();
 await page.locator('.tab-list>summary').click();await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();await page.getByRole('button',{name:'Abrir fontes',exact:true}).click();await page.getByRole('button',{name:'Abrir fonte',exact:true}).first().click();
 await expect(page.locator('.source-block').first()).toContainText('ὅτι μὲν ὑμεῖς');
 await page.locator('.source-block').first().evaluate((el:HTMLElement)=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);});
 await page.getByRole('button',{name:'Usar seleção',exact:true}).click();await page.getByRole('button',{name:'Nota privada',exact:true}).click();await page.getByLabel('Texto da nota',{exact:true}).fill('Nota criada sem rede, preservada após reinício.');await page.getByRole('button',{name:'Salvar nota',exact:true}).click();
 await page.locator('.tab-list>summary').click();await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();await page.getByRole('button',{name:/Práticas|Praticar|Prática/}).first().click();await page.getByRole('button',{name:'Praticar todas',exact:true}).click();await page.getByRole('button',{name:'Contar quantas pessoas foram convencidas.',exact:true}).click();await expect(page.locator('[data-role=practice-feedback]')).toContainText('adesão');
 await page.screenshot({path:'.local/proofs/offline-production-practice.png'});
 await page.getByRole('button',{name:'Meus estudos',exact:true}).click();await context.close();context=null;
 page=await browser();await context.setOffline(true);await page.goto(origin+'/Um/');await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();await expect(page.getByRole('region',{name:'Leitor de estudo'})).toBeVisible();
 await page.locator('.tab-list>summary').click();await expect(page.getByRole('tab',{name:/texto grego/})).toBeVisible();await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();await page.getByRole('button',{name:/Notas/}).first().click();await expect(page.getByText('Nota criada sem rede, preservada após reinício.',{exact:true})).toBeVisible();
 await page.screenshot({path:'.local/proofs/offline-production-restart.png'});
 await writeFile('.local/proofs/offline-production-restart.json',JSON.stringify({at:new Date().toISOString(),environment:'Chrome real, persistent profile, separate browser processes, built Vite shell and SW, IndexedDB real, offline context',profile,projectId:demo.projectId,packageRevisions:packages.map(p=>({profileId:p.manifest.profileId,revision:p.manifest.revision})),result:'pass',limits:['Local backend only','Packages acquired by Node HTTP and installed through real OfflineStore, no browser download UI','No remote-host or Android claim']},null,2));
 console.log('PASS: production shell, sources, practice, notes and tabs survived offline browser restarts.');
}finally{if(context)await context.close();await stop();}
