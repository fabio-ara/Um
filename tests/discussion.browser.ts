import {test,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
test('discussão preserva rascunho em conflito e respostas após excluir comentário',async({page})=>{
 const ctx=await localContext(),ids:string[]=[];
 const tokens=await Promise.all(demo.students.map(async(s:any)=>{const r=await fetch('http://127.0.0.1:4418/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(s.credentials)});expect(r.status).toBe(200);return (await r.json() as any).access_token;}));
 const call=async(index:number,task:string,args:any)=>{const r=await fetch('http://127.0.0.1:4417/api/'+task,{method:'POST',headers:{Authorization:'Bearer '+tokens[index],'content-type':'application/json'},body:JSON.stringify(args)});const b=await r.json() as any;if(!r.ok)throw Error(`${task}: ${r.status} ${b.error?.code}`);return b.data;};
 try{
  const projectId=demo.projectId,source=await call(0,'source_get',{sourceId:demo.sourceIds[0],limit:1}),block=source.blocks[0];
  const target={sourceId:source.id,sourceRevision:source.revision,elementId:block.id,start:0,end:12,exact:Array.from(block.text).slice(0,12).join(''),prefix:'',suffix:''};
  const parent=uuid(),reply=uuid();ids.push(parent,reply);
  await call(0,'comment_add',{operationId:uuid(),projectId,profileId:demo.students[0].profileId,commentId:parent,target,text:'Comentário da prova visual'});
  await call(1,'comment_add',{operationId:uuid(),projectId,profileId:demo.students[1].profileId,commentId:reply,target,text:'Resposta alheia preservada',replyTo:parent});
  await page.setViewportSize({width:320,height:740});await page.emulateMedia({colorScheme:'dark'});
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('button',{name:'Abrir estudo',exact:true}).click();
  await page.locator('.tab-list>summary').click();await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();await page.locator('[data-action=toggle-section][data-section=comments]').click();
  const card=page.locator(`[data-comment-id="${parent}"]`),other=page.locator(`[data-comment-id="${reply}"]`);
  await expect(card.getByRole('heading',{name:'Você',exact:true})).toBeVisible();await expect(other.getByRole('button',{name:'Editar comentário',exact:true})).toHaveCount(0);
  await card.getByRole('button',{name:'Editar comentário',exact:true}).click();await card.getByRole('textbox',{name:'Editar comentário',exact:true}).fill('Meu rascunho preservado');
  await call(0,'comment_edit',{operationId:uuid(),projectId,commentId:parent,expectedRevision:1,text:'Alterado em outro dispositivo'});
  await card.getByRole('button',{name:'Salvar comentário',exact:true}).click();await expect(page.getByText(/Conflito ao editar o comentário:/).first()).toBeVisible();await expect(card.getByRole('textbox',{name:'Editar comentário',exact:true})).toHaveValue('Meu rascunho preservado');
  await page.getByRole('button',{name:'Recarregar comentários',exact:true}).click();await expect(card.getByRole('textbox',{name:'Editar comentário',exact:true})).toHaveValue('Meu rascunho preservado');await card.getByRole('button',{name:'Salvar comentário',exact:true}).click();await expect(card.locator('.record-text')).toHaveText('Meu rascunho preservado');
  await card.getByRole('button',{name:'Excluir comentário',exact:true}).click();await card.getByRole('button',{name:'Confirmar exclusão do comentário',exact:true}).click();await expect(card.getByRole('heading',{name:'Comentário removido',exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'Responder comentário',exact:true})).toHaveCount(0);await expect(other).toContainText('Resposta alheia preservada');
  const rows=(await call(1,'comment_list',{projectId})).items;expect(rows.find((r:any)=>r.id===parent).text).toBe('');expect(rows.find((r:any)=>r.id===reply).text).toBe('Resposta alheia preservada');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await mkdir('.local/proofs',{recursive:true});await card.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/proofs/discussion-320-dark.png'});
 }finally{await page.close();await ctx.admin.query('delete from um.comments where id=any($1::uuid[]) and project_id=$2',[ids,demo.projectId]);await ctx.close();}
});
