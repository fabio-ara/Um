import {test,expect,type Page} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {SignJWT,importJWK} from 'jose';
import {mkdir} from 'node:fs/promises';
import {localContext} from './local-context.ts';
import {execute} from '../src/service.ts';
import {personalStudyFixture} from './personal-study-fixture.ts';

async function login(page:Page,credentials:{email:string;password:string}){
 await page.getByLabel('E-mail',{exact:true}).fill(credentials.email);await page.getByLabel('Senha',{exact:true}).fill(credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
}
test('primeiro acesso cria perfil próprio uma vez mesmo após resposta perdida',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();
 try{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Entrar para estudar',exact:true}).click();await login(page,account.credentials);
  await expect(page.getByText('Vai estudar por conta própria?',{exact:false})).toBeVisible();
  let lost=false;await page.route('**/api/profile_create',async route=>{if(lost){await route.continue();return;}lost=true;const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort('failed');});
  await page.getByRole('button',{name:'Criar meu perfil',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Criar meu perfil',exact:true}).click();await expect(page.getByText('Seu perfil está pronto.',{exact:false})).toBeVisible();
  const profiles=await execute('profile_list',{},account.identity) as any;expect(profiles.items).toHaveLength(1);expect(profiles.items[0].holderId).toBe(account.identity.id);
  await page.reload();await expect(page.getByText('Seu perfil está pronto.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Criar meu perfil',exact:true})).toHaveCount(0);
  await mkdir('.local/proofs',{recursive:true});await page.screenshot({path:'.local/proofs/first-access-profile-390.png',fullPage:true});
  for(const width of [320,480,1280]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.local/proofs/first-access-profile-${width}.png`,fullPage:true});}
  await page.setViewportSize({width:320,height:844});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:'.local/proofs/first-access-profile-320-dark.png',fullPage:true});
 }finally{await ctx.close();}
});

test('link de preparação preserva destino no login e permite corrigir envio próprio',async({page,browser})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession(),other=await ctx.accountSession();
 try{
  const f=await personalStudyFixture(account.identity),details=await f.call('project_get',{projectId:f.projectId});
  const url=details.participations[0].formUrl;expect(new URL(url).hash).toBe('#form='+f.formId);
  await page.goto(url);await expect(page.getByText('O formulário será aberto após o login.',{exact:false})).toBeVisible();await login(page,account.credentials);
  await expect(page.getByRole('heading',{name:'Preparação do estudo',exact:true})).toBeVisible();await expect(page.getByLabel('Exemplos concretos',{exact:true})).toBeChecked();
  await page.getByLabel('Comparações',{exact:true}).check();await page.getByRole('button',{name:'Enviar respostas',exact:true}).click();await expect(page.locator('.statusline')).toContainText('Volte à conversa');
  const submissions=(await f.call('submission_list',{projectId:f.projectId,profileId:f.profileId})).items;expect(submissions).toHaveLength(2);expect(submissions[0].answers.support).toBe('Comparações');expect(submissions[1].answers.support).toBe('Exemplos concretos');
  await page.getByRole('button',{name:'Corrigir respostas enviadas',exact:true}).click();await page.getByLabel('Exemplos concretos',{exact:true}).check();
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);await page.route('**/api/form_submit',async route=>{await gate;await route.continue();});
  await page.getByRole('button',{name:'Enviar respostas',exact:true}).click();await expect(page.locator('.statusline')).toContainText('Enviando');await expect(page.getByRole('button',{name:'Corrigir respostas enviadas',exact:true})).toBeHidden();await expect(page.getByLabel('Exemplos concretos',{exact:true})).toBeDisabled();release();
  await expect(page.locator('.statusline')).toContainText('Respostas enviadas');const corrected=(await f.call('submission_list',{projectId:f.projectId,profileId:f.profileId})).items;expect(corrected).toHaveLength(3);expect(corrected[0].answers.support).toBe('Exemplos concretos');
  const outsider=await browser.newContext();try{const denied=await outsider.newPage();await denied.goto(url);await login(denied,other.credentials);await expect(denied.getByRole('alert')).toContainText('indisponível');await expect(denied.getByLabel('Comparações',{exact:true})).toHaveCount(0);}finally{await outsider.close();}
 }finally{await ctx.close();}
});

test('home pagina perfis e estudos e mantém leitura durante nova preparação',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();
 const call=(name:any,args:any)=>execute(name,args,account.identity) as Promise<any>;
 try{
  const f=await personalStudyFixture(account.identity),project=(await call('project_get',{projectId:f.projectId})).project;await call('project_update',{operationId:uuid(),projectId:f.projectId,expectedRevision:project.revision,title:'ZZZ Estudo com preparação pendente'});
  const form=(await call('form_get',{formId:f.formId})).definition;await call('form_save',{operationId:uuid(),expectedRevision:1,definition:{...form,revision:2}});await call('form_publish',{operationId:uuid(),formId:f.formId,expectedRevision:2});
  const metadata={object:{kind:'theme',workIds:[],subject:'Paginação'},scope:'Fixture',language:'pt',audience:'Teste',configuration:{editorial:{},instructional:{}}};
  for(let n=0;n<50;n++){await call('profile_create',{operationId:uuid(),self:true,fields:{name:'Perfil de paginação '+n}});await call('project_create',{operationId:uuid(),title:'AAA Paginação '+String(n).padStart(2,'0'),metadata});}
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await login(page,account.credentials);await expect(page.locator('#profile option')).toHaveCount(51);await page.locator('#profile').selectOption(f.profileId);
  await expect(page.locator(`[data-action=form][data-project="${f.projectId}"]`)).toBeVisible();await expect(page.locator(`[data-action=reader][data-project="${f.projectId}"]`)).toBeVisible();
  await page.locator(`[data-action=reader][data-project="${f.projectId}"]`).click();await expect(page.getByText('Um exemplo sintético para conferir direitos e persistência.',{exact:false})).toBeVisible();
 }finally{await ctx.close();}
});

test('recuperação consome link real do Auth e nova senha funciona',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();
 try{
  // Local GoTrue key generated by local:setup; no production credentials or email sent.
  const jwk=JSON.parse(process.env.LOCAL_JWT_KEYS!)[0],key=await importJWK({...jwk,key_ops:['sign']},jwk.alg);
  const admin=await new SignJWT({role:'service_role'}).setProtectedHeader({alg:jwk.alg,kid:jwk.kid}).setIssuer('http://127.0.0.1:4417/auth/v1').setAudience('authenticated').setIssuedAt().setExpirationTime('5m').sign(key);
  const response=await fetch('http://127.0.0.1:4418/admin/generate_link?'+new URLSearchParams({redirect_to:'http://127.0.0.1:4419/?recovery=1'}),{method:'POST',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify({type:'recovery',email:account.credentials.email})});expect(response.status).toBe(200);const link=await response.json() as any;
  expect(new URL(link.action_link).pathname).toBe('/auth/v1/verify');
  await page.goto(link.action_link);await expect(page.getByRole('heading',{name:'Escolher nova senha',exact:true})).toBeVisible();const password=uuid()+'-Aa1';
  await page.getByLabel('Nova senha',{exact:true}).fill(password);await page.getByLabel('Confirmar nova senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Salvar nova senha',exact:true}).click();await expect(page.getByRole('heading',{name:'Escolher nova senha',exact:true})).toHaveCount(0);
  await page.evaluate(async accountId=>{const path='/src/web/offline.ts',offline=await import(path),store=await offline.openOffline(accountId,'account');await store.putRecord('recovery-preservation',{note:'Nota local ainda não sincronizada'});store.close();},account.identity.id);
  const second=await fetch('http://127.0.0.1:4418/admin/generate_link',{method:'POST',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify({type:'recovery',email:account.credentials.email})});expect(second.status).toBe(200);const recovery=await second.json() as any;
  const verified=await page.evaluate(async token=>{const path='/src/web/api.ts',{auth}=await import(path);return (await auth.verifyOtp({token_hash:token,type:'recovery'})).error?.message||null;},recovery.hashed_token);expect(verified).toBeNull();await expect(page.getByRole('heading',{name:'Escolher nova senha',exact:true})).toBeVisible();
  const kept=await page.evaluate(async accountId=>{const path='/src/web/offline.ts',offline=await import(path),store=await offline.openOffline(accountId,'account');const note=await store.record('recovery-preservation');store.close();return note;},account.identity.id);expect(kept).toEqual({note:'Nota local ainda não sincronizada'});
  const loginResponse=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.credentials.email,password})});expect(loginResponse.status).toBe(200);
 }finally{await ctx.close();}
});

test('Conta mantém controles e logout quando a consulta de perfis falha',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();
 try{
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await login(page,account.credentials);await expect(page.getByRole('button',{name:'Criar meu perfil',exact:true})).toBeVisible();
  await page.route('**/api/profile_list',route=>route.abort('failed'));await page.getByRole('button',{name:'Conta',exact:true}).click();
  await expect(page.getByRole('button',{name:'Aceitar convite nesta conta',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Autorizações',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sair e limpar dados locais da conta',exact:true}).click();await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();
 }finally{await ctx.close();}
});

test('envio pendente conserva intenção e recibo após reabrir o formulário',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();
 try{
  const f=await personalStudyFixture(account.identity);await page.goto('/#form='+f.formId);await login(page,account.credentials);await expect(page.getByLabel('Exemplos concretos',{exact:true})).toBeChecked();await page.getByLabel('Comparações',{exact:true}).check();
  await page.route('**/api/form_submit',route=>route.abort('failed'));await page.getByRole('button',{name:'Enviar respostas',exact:true}).click();await expect(page.locator('.statusline')).toContainText('Envio pendente');await expect(page.getByLabel('Comparações',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Conferir envio pendente',exact:true}).click();await expect(page.locator('.statusline')).toContainText('Envio pendente');await page.reload();await expect(page.getByRole('button',{name:'Conferir envio pendente',exact:true})).toBeVisible();await expect(page.getByLabel('Comparações',{exact:true})).toBeDisabled();
  const queued=await page.evaluate(async ({accountId,profileId})=>{const path='/src/web/offline.ts',{openOffline}=await import(path),store=await openOffline(accountId,profileId);const operations=await store.operations();store.close();return operations.filter((op:any)=>op.task==='form_submit').length;},{accountId:account.identity.id,profileId:f.profileId});expect(queued).toBe(1);expect((await f.call('submission_list',{projectId:f.projectId,profileId:f.profileId})).items).toHaveLength(1);
  await page.unroute('**/api/form_submit');await page.getByRole('button',{name:'Conferir envio pendente',exact:true}).click();await expect(page.locator('.statusline')).toContainText('Respostas enviadas');const sent=(await f.call('submission_list',{projectId:f.projectId,profileId:f.profileId})).items;expect(sent).toHaveLength(2);expect(sent[0].answers.support).toBe('Comparações');
 }finally{await ctx.close();}
});
