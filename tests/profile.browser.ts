import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
test('titular edita campos, exporta, revoga criador e exclui perfil pela Conta',async({page})=>{
 const login=async(credentials:any)=>(await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)}).then(r=>r.json()) as any).access_token;
 const owner=await login(demo.author.credentials),student=await login(demo.students[0].credentials);
 const call=async(token:string,task:string,args:any)=>{const response=await fetch('http://127.0.0.1:4417/api/'+task,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(args)});return {status:response.status,body:await response.json() as any};};
 const name='Controle sintético '+uuid(),created=await call(owner,'profile_create',{operationId:uuid(),fields:{name,description:'Campo preservado'}}),profileId=created.body.data.result.profileId;
 const invite=await call(owner,'invite_create',{operationId:uuid(),profileId});await call(student,'invite_accept',{operationId:uuid(),token:invite.body.data.result.token});
 try{
  await page.setViewportSize({width:320,height:844});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();await page.getByRole('button',{name:'Conta',exact:true}).click();
  let card=page.locator('.profile-card').filter({hasText:name});await card.getByRole('button',{name:'Editar este perfil',exact:true}).click();await card.getByLabel('Nome',{exact:true}).fill(name+' editado');await card.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await expect(card.getByRole('heading',{name:name+' editado',exact:true})).toBeVisible();const saved=await call(student,'profile_get',{profileId});expect(saved.body.data.fields).toEqual({name:name+' editado',description:'Campo preservado'});
  await card.getByRole('button',{name:'Exportar dados deste perfil',exact:true}).click();const exported=JSON.parse(await card.getByRole('textbox',{name:'Conteúdo JSON da exportação deste perfil',exact:true}).inputValue());expect(exported.profile.id).toBe(profileId);expect(exported.profile.fields.description).toBe('Campo preservado');
  await card.locator('[data-export-section]').selectOption('records');await card.getByRole('button',{name:'Exibir parte da exportação',exact:true}).click();await expect.poll(async()=>JSON.parse(await card.getByRole('textbox',{name:'Conteúdo JSON da exportação deste perfil',exact:true}).inputValue()).part?.section).toBe('records');
  await card.getByRole('button',{name:'Fechar',exact:true}).click();await card.getByRole('button',{name:'Retirar acesso do criador',exact:true}).click();await expect(card.getByRole('button',{name:'Retirar acesso do criador',exact:true})).toHaveCount(0);expect((await call(owner,'profile_get',{profileId})).status).toBe(404);
  await page.screenshot({path:'.local/proofs/profile-320-dark.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  let lost=false;await page.route('**/api/profile_control',async route=>{const args=route.request().postDataJSON();if(args.action==='delete'&&!lost){lost=true;const committed=await route.fetch();expect(committed.ok()).toBe(true);await route.abort('connectionreset');}else await route.continue();});
  await card.getByRole('button',{name:'Excluir este perfil',exact:true}).click();await card.getByRole('button',{name:'Excluir definitivamente',exact:true}).click();await expect(card).toHaveCount(0);expect(lost).toBe(true);expect((await call(student,'profile_get',{profileId})).status).toBe(404);
 }finally{if((await call(student,'profile_get',{profileId})).status===200)await call(student,'profile_control',{operationId:uuid(),profileId,action:'delete'});}
});
