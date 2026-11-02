import {test,expect,chromium,type BrowserContext,type Page} from '@playwright/test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {execute} from '../src/service.ts';

test('rascunhos de dois perfis sobrevivem ao encerramento do Chrome e envio remove respostas ocultas',async()=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();let browser:BrowserContext|undefined;
 const call=(name:any,args:any)=>execute(name,args,account.identity) as Promise<any>;
 await mkdir('.local/proofs',{recursive:true});const userData=await mkdtemp(resolve('.local/form-restart-'));
 const profiles:{id:string;projectId:string;formId:string}[]=[];
 const launch=async()=>{browser=await chromium.launchPersistentContext(userData,{channel:'chrome',headless:true,viewport:{width:390,height:844}});const page=browser.pages()[0];await page.goto(process.env.UM_PROOF_APP_ORIGIN||'http://127.0.0.1:4419');return page;};
 const openForm=async(page:Page,n:number)=>{await page.getByRole('button',{name:'Meus estudos',exact:true}).click();await page.locator('#profile').selectOption(profiles[n].id);await page.locator(`[data-action=form][data-project="${profiles[n].projectId}"]`).click();await expect(page.getByRole('heading',{name:'Preparação do estudo',exact:true})).toBeVisible();};
 try{
  for(let n=0;n<2;n++){
   const id=(await call('profile_create',{operationId:uuid(),fields:{name:`Perfil sintético ${n+1}`},self:true})).result.profileId;
   const projectId=(await call('project_create',{operationId:uuid(),title:`Preparação sintética ${n+1}`,metadata:{object:{kind:'theme',workIds:[],subject:'Persistência'},scope:'Fixture',language:'pt',audience:'Teste',configuration:{editorial:{},instructional:{}}}})).result.projectId;
   await call('participation_add',{operationId:uuid(),projectId,profileId:id});const formId=uuid();
   await call('form_save',{operationId:uuid(),expectedRevision:0,definition:{id:formId,revision:1,projectId,profileId:id,questions:[{id:'example',type:'single_choice',prompt:'Quer indicar um exemplo?',required:true,options:[{id:'yes',label:'Sim, indicar'},{id:'no',label:'Não, continuar'}]},{id:'detail',type:'text',prompt:'Qual exemplo?',required:false,showWhen:{questionId:'example',operator:'equals',values:['yes']}},{id:'support',type:'single_choice',prompt:'Qual apoio prefere?',required:true,options:[{id:'case',label:'Um caso concreto'},{id:'contrast',label:'Uma comparação'}]}],purposeByQuestion:{example:'Abrir espaço opcional',detail:'Conhecer exemplo declarado',support:'Escolher apoio'},planningReference:'Fixture sem inferência de perfil',maxQuestions:6}});
   await call('form_publish',{operationId:uuid(),formId,expectedRevision:1});profiles.push({id,projectId,formId});
  }
  let page=await launch();await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
  for(let n=0;n<2;n++){
   await openForm(page,n);await page.getByLabel('Sim, indicar',{exact:true}).check();await page.getByRole('textbox',{name:/Qual exemplo/}).fill(`Rascunho privado do perfil ${n+1}`);await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await expect(page.locator('.statusline')).toHaveText('Rascunho salvo.');
  }
  await browser!.close();browser=undefined;page=await launch();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
  await openForm(page,0);await expect(page.getByLabel('Sim, indicar',{exact:true})).toBeChecked();await expect(page.getByRole('textbox',{name:/Qual exemplo/})).toHaveValue('Rascunho privado do perfil 1');await expect(page.getByLabel('Um caso concreto',{exact:true})).not.toBeChecked();
  await page.getByLabel('Não, continuar',{exact:true}).check();await expect(page.getByRole('textbox',{name:/Qual exemplo/})).toHaveCount(0);await page.getByLabel('Um caso concreto',{exact:true}).check();await page.getByRole('button',{name:'Enviar respostas',exact:true}).click();await expect(page.locator('.statusline')).toContainText('Respostas enviadas.');await expect(page.getByRole('button',{name:'Enviar respostas',exact:true})).toBeDisabled();
  await page.screenshot({path:'.local/proofs/form-after-restart-390.png'});
  const submissions=(await call('submission_list',{projectId:profiles[0].projectId,profileId:profiles[0].id})).items;expect(submissions).toHaveLength(1);expect(submissions[0].answers).toEqual({example:'no',support:'case'});
  await openForm(page,1);await expect(page.getByRole('textbox',{name:/Qual exemplo/})).toHaveValue('Rascunho privado do perfil 2');expect((await call('submission_list',{projectId:profiles[1].projectId,profileId:profiles[1].id})).items).toHaveLength(0);
  expect((await call('profile_get',{profileId:profiles[0].id})).fields).toEqual({name:'Perfil sintético 1'});
 }finally{await browser?.close();await ctx.close();}
});
