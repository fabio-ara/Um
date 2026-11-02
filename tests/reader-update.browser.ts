import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {localContext} from './local-context.ts';
import {personalStudyFixture} from './personal-study-fixture.ts';

test('atualização pela UI é atômica e conserva respostas, tentativas, notas e abas com reancoragem segura',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();
 try{
  const f=await personalStudyFixture(account.identity),scope={projectId:f.projectId,profileId:f.profileId};
  const missingText='evidência',start=Array.from(f.source.blocks[0].text.split(missingText)[0]).length,missing={...f.anchor,start,end:start+Array.from(missingText).length,exact:missingText};
  const notes=[{id:uuid(),anchor:f.anchor,text:'Nota que acompanha a fonte.'},{id:uuid(),anchor:missing,text:'Nota cuja citação deve ser preservada.'}];
  for(const n of notes)await f.call('note_save',{operationId:uuid(),...scope,recordId:n.id,expectedRevision:0,anchor:n.anchor,text:n.text});
  await f.call('attempt_submit',{operationId:uuid(),...scope,bundleRevision:1,questionId:f.questionId,questionRevision:1,optionId:'b',sequenceId:uuid(),createdAt:new Date().toISOString()});
  const attempts=(await f.call('reader_records',{...scope,kind:'attempt'})).items,submission=await f.call('submission_get',{submissionId:f.submission.submissionId});
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator(`[data-action=reader][data-project="${f.projectId}"]`).click();await expect(page.locator('.reader-body')).toBeVisible();
  await page.getByRole('button',{name:'Abrir fontes',exact:true}).click();await page.getByRole('button',{name:'Abrir fonte',exact:true}).first().click();await expect(page.locator('.source-hit')).toHaveText('Conferir');
  await page.getByRole('button',{name:'Conferir e atualizar este estudo',exact:true}).click();
  await expect.poll(async()=>{const state=(await f.call('reader_records',{...scope,kind:'state'})).items[0];return state?.revision||0;}).toBeGreaterThan(1);
  await expect(page.locator('.source-hit')).toHaveText('Conferir');
  const before=(await f.call('reader_records',{...scope,kind:'state'})).items[0];
  await page.evaluate(async({accountId,profileId,projectId})=>{const url='/src/web/study-api.ts';const {studyClient}=await import(url);(window as any).__updateClient=await studyClient(accountId,profileId,projectId);},{accountId:account.identity.id,...scope});
  const versions=()=>page.evaluate(async projectId=>{const s=(window as any).__updateClient.store;return [(await s.package(projectId,false))?.manifest.revision,(await s.package(projectId,true))?.manifest.revision];},f.projectId);
  expect(await versions()).toEqual([1,1]);
  const prefix='Introdução: ',newAnchor={...f.anchor,sourceRevision:2,start:prefix.length,end:prefix.length+8};
  await f.call('source_revise',{operationId:uuid(),sourceId:f.sourceId,expectedRevision:1,blocks:f.source.blocks.map(b=>({...b,text:prefix+b.text.replace('evidência','fundamentação')})),reason:'Revisão sintética para reancoragem'});
  const next=structuredClone(f.bundle);next.revision=2;next.baseRevision=2;next.units[0].body='Unidade corrigida sem apagar registros.';next.units[0].references[0].from=[newAnchor];next.units[0].references[0].to=[newAnchor];next.coverage[0].sourceAnchors=[newAnchor];
  await f.call('bundle_publish',{operationId:uuid(),expectedRevision:1,bundle:next});
  const personal=structuredClone(f.personal);personal.revision=2;personal.baseRevision=2;personal.choices[0].revision=2;personal.choices[0].sources=[newAnchor];personal.coverage[0].sourceAnchors=[newAnchor];
  await f.call('bundle_publish',{operationId:uuid(),expectedRevision:1,bundle:personal,reasons:f.reasons});
  const manifest=await f.call('bundle_get',{...scope}),path=manifest.index.find((i:any)=>i.kind==='choice').file;
  let failed=false;await page.route('**/api/file/**',async route=>{if(decodeURIComponent(route.request().url()).includes(path)){failed=true;await route.abort('failed');}else await route.continue();});
  await page.getByRole('button',{name:'Conferir e atualizar este estudo',exact:true}).click();await expect.poll(()=>failed).toBe(true);expect(await versions()).toEqual([1,1]);await expect(page.locator('.source-hit')).toHaveText('Conferir');
  await page.unroute('**/api/file/**');await page.getByRole('button',{name:'Conferir e atualizar este estudo',exact:true}).click();await expect.poll(versions).toEqual([2,2]);
  await expect(page.locator('.source-card > .meta-line')).toContainText('Revisão 2');await expect(page.locator('.source-hit')).toHaveText('Conferir');
  const after=(await f.call('reader_records',{...scope,kind:'state'})).items[0];expect(after.data.tabs.map((t:any)=>t.id)).toEqual(before.data.tabs.map((t:any)=>t.id));expect(after.data.activeTabId).toBe(before.data.activeTabId);expect(after.data.tabs.find((t:any)=>t.kind==='source').anchor).toMatchObject(newAnchor);
  const changed=(await f.call('reader_records',{...scope,kind:'note'})).items;expect(changed.find((n:any)=>n.id===notes[0].id).data.anchor).toMatchObject(newAnchor);expect(changed.find((n:any)=>n.id===notes[1].id).data).toMatchObject({anchor:missing,anchorStatus:'needs_review',text:notes[1].text});
  expect((await f.call('reader_records',{...scope,kind:'attempt'})).items).toEqual(attempts);expect(await f.call('submission_get',{submissionId:f.submission.submissionId})).toEqual(submission);
  await page.locator('.tab-list > summary').click();await page.getByRole('tab',{name:'Distinguir afirmação e evidência',exact:true}).click();await expect(page.locator('.reader-body')).toContainText('Unidade corrigida sem apagar registros.');await page.locator('[data-action=toggle-section][data-section=notes]').click();await expect(page.getByText('Revisão pendente. Trecho anterior preservado: “evidência”.',{exact:true})).toBeVisible();await mkdir('.local/proofs',{recursive:true});await page.screenshot({path:'.local/proofs/reader-update-390.png',fullPage:true});
  await page.evaluate(()=>(window as any).__updateClient.close());
 }finally{await page.close();await ctx.close();}
});
