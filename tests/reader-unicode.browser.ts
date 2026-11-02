import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {localContext} from './local-context.ts';
import {execute} from '../src/service.ts';
import {sourceView} from '../src/sources.ts';
import {selectAndCapture} from './browser-selection.ts';

test('seleção multilíngue preserva pontos de código e exige escolha entre recursos preparados',async({page})=>{
 const ctx=await localContext(),account=await ctx.accountSession();
 const call=(name:any,args:any)=>execute(name,args,account.identity) as Promise<any>;
 try{
  const profileId=(await call('profile_create',{operationId:uuid(),fields:{name:'Fixture Unicode'},self:true})).result.profileId;
  const projectId=(await call('project_create',{operationId:uuid(),title:'Fixture Unicode e ambiguidade',metadata:{object:{kind:'theme',workIds:[],subject:'Seleção multilíngue'},scope:'Fixture sintética de UI',language:'pt',audience:'Teste',configuration:{editorial:{},instructional:{}}}})).result.projectId;
  await call('participation_add',{operationId:uuid(),projectId,profileId});
  const texts=['ἄνθρωπος e\u0301 — texto sintético para conferir a preservação dos diacríticos.','العربية بين الكلمات — fixture sintética para direção do texto.','漢字と仮名 — fixture sintética de seleção sem espaços.','A😀𐐀B — fixture sintética com pontos de código suplementares.'];
  const sourceId=(await call('source_import',{operationId:uuid(),format:'structured',blocks:texts.map(text=>({kind:'paragraph',text})),metadata:{title:'Fonte sintética multilíngue',language:'mul',nature:'original',extent:'fragment',authors:[],rights:{status:'permission',statement:'Fixture própria',evidence:'Prova local de UI',offlineAllowed:true},provenance:'Texto sintético; não é obra histórica nem tradução.'}})).result.sourceId;
  await call('source_attach',{operationId:uuid(),projectId,sourceId});const source=await sourceView(account.identity,sourceId);
  const anchors=source.blocks.map(b=>({sourceId,sourceRevision:1,elementId:b.id,start:0,end:Array.from(b.text).length,exact:b.text,prefix:'',suffix:''}));
  const unitId=uuid(),coverageId=uuid(),provenance={kind:'example',references:['Fixture própria'],limitations:['Sem alegação histórica ou pedagógica.']};
  const resources=['Primeira representação','Segunda representação'].map(title=>({id:uuid(),projectId,profileId:null,baseRevision:1,type:'contrast',title,purpose:'Escolha explícita entre dois apoios preparados.',targets:anchors,body:'Representação sintética previamente preparada: '+title,sources:anchors,appliedConfiguration:{},inspection:'ai_inspected'}));
  await call('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle:{projectId,profileId:null,revision:1,baseRevision:1,units:[{id:unitId,title:'Seleção sem inferência',body:'Abra a fonte e escolha o recurso preparado correspondente.',references:[{id:uuid(),from:anchors,to:anchors,relation:'illustrates',provenance}],knowledgeTargets:[coverageId],provenance:[provenance]}],resources,choices:[],coverage:[{id:coverageId,description:'Preservar identidade textual',unitIds:[unitId],sourceAnchors:anchors,practiceIds:[]}],inspection:{kind:'ai',references:['Inspeção sintética da fixture'],findings:[],completed:true}}});
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});
  await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator(`[data-action=reader][data-project="${projectId}"]`).click();await expect(page.getByRole('heading',{name:'Seleção sem inferência',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Abrir fontes',exact:true}).click();await page.getByRole('button',{name:'Abrir fonte',exact:true}).first().click();await expect(page.locator('.source-block')).toHaveCount(4);
  const cases=[{block:0,text:'ἄνθρωπος'},{block:0,text:'e\u0301'},{block:1,text:'العربية'},{block:2,text:'漢字'},{block:3,text:'😀𐐀'}];
  for(const c of cases){
   const text=source.blocks[c.block].text,start=Array.from(text.slice(0,text.indexOf(c.text))).length,end=start+Array.from(c.text).length;
   await selectAndCapture(page,source.blocks[c.block].id,start,end);
   await expect(page.locator('.selection-panel > .quote')).toHaveText(c.text);await expect(page.locator('.selection-panel > .meta-line')).toContainText(`posições ${start}–${end}`);
   await expect(page.locator('.selection-panel > .section-head > .badge')).toHaveText(`${Array.from(c.text).length} caractere(s)`);
   await expect(page.locator('.selection-panel .match-card')).toHaveCount(2);await expect(page.locator('.selection-panel .match-card .badge')).toHaveText(['contém','contém']);
   await expect(page.locator('.source-card')).toBeVisible();await expect(page.locator('.resource-card')).toHaveCount(0);
  }
  expect(await page.locator('.source-block').nth(1).evaluate(el=>getComputedStyle(el).direction)).toBe('rtl');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await mkdir('.local/proofs',{recursive:true});await page.screenshot({path:'.local/proofs/reader-unicode-390-dark.png',fullPage:true});
  await page.locator('.selection-panel .match-card').last().scrollIntoViewIfNeeded();await page.screenshot({path:'.local/proofs/reader-unicode-choices-390-dark.png'});
  await page.locator('.selection-panel .match-card').filter({hasText:'Segunda representação'}).getByRole('button',{name:'Abrir recurso',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Segunda representação',level:2,exact:true})).toBeVisible();
  await expect(page.locator('.reader-body')).toContainText('Representação sintética previamente preparada: Segunda representação');
  await page.getByRole('button',{name:'Voltar à origem',exact:true}).click();await expect(page.locator('.source-card')).toBeVisible();
 }finally{await page.close();await ctx.close();}
});
