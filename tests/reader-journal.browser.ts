import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
const demo=JSON.parse(await readFile('.local/demo.json','utf8')),student=demo.students[0];
test('caderno pagina, busca, edita e exclui; edição vinculada confere seu próprio trecho',async({page})=>{
 test.setTimeout(180000);
 const auth=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(student.credentials)}).then(r=>r.json()) as any;
 const call=async(task:string,args:any,retries=2):Promise<any>=>{const r=await fetch('http://127.0.0.1:4417/api/'+task,{method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'content-type':'application/json'},body:JSON.stringify(args)});if(r.status===429&&retries>0){await new Promise(resolve=>setTimeout(resolve,60000));return call(task,args,retries-1);}const b=await r.json() as any;if(!r.ok)throw Error(`${task} ${r.status} ${b.error?.code}`);return b.data;};
 const scope={projectId:demo.projectId,profileId:student.profileId},source=await call('source_get',{sourceId:demo.sourceIds[0],limit:1}),block=source.blocks[0];
 const anchor={sourceId:source.id,sourceRevision:source.revision,elementId:block.id,start:0,end:12,exact:Array.from(block.text).slice(0,12).join(''),prefix:'',suffix:''};
 const records:{id:string;revision:number}[]=[];
 try{
  for(let i=0;i<103;i++){const id=uuid();await call('note_save',{...scope,operationId:uuid(),recordId:id,expectedRevision:0,anchor,text:'Caderno paginado '+i});records.push({id,revision:1});}
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(student.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(student.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();await expect(page.locator('.tab-list')).toBeVisible();
  await page.locator('.tab-list>summary').click();await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();await page.locator('[data-action=toggle-section][data-section=notes]').click();await expect(page.locator('[data-role=note-search]')).toBeVisible();
  await page.locator('[data-role=note-search]').fill('Caderno paginado 102');await expect(page.locator('.record-card').filter({hasText:'Caderno paginado 102'})).toHaveCount(1);
  let card=page.locator('.record-card').filter({hasText:'Caderno paginado 102'});await card.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('[data-field=edit-note-text]').fill('Nota revisada pelo titular');await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();records[102].revision=2;
  await page.locator('[data-role=note-search]').fill('Nota revisada pelo titular');card=page.locator('.record-card').filter({hasText:'Nota revisada pelo titular'});await expect(card).toHaveCount(1);await card.getByRole('button',{name:'Excluir',exact:true}).click();await card.getByRole('button',{name:'Excluir definitivamente',exact:true}).click();await expect(page.getByText('Nenhuma nota encontrada.',{exact:true})).toBeVisible();records.pop();
  await page.getByRole('button',{name:'Abrir fontes',exact:true}).click();await page.getByRole('button',{name:'Abrir fonte',exact:true}).first().click();await expect(page.locator('.source-block').first()).toContainText('ὅτι μὲν ὑμεῖς');await page.locator('.edition-panel>summary').click();await page.getByRole('button',{name:'Abrir edição vinculada',exact:true}).first().click();await expect(page.locator('.source-card h2')).toContainText('Fowler');await expect(page.locator('.source-hit').first()).toContainText('How you');
  await page.screenshot({path:'.local/proofs/reader-edition-linked.png'});
 }finally{for(const r of records)await call('record_delete',{...scope,operationId:uuid(),recordId:r.id,expectedRevision:r.revision});}
});
