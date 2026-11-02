import {test,expect} from '@playwright/test';
import {selectAndCapture} from './browser-selection.ts';
import {readFile} from 'node:fs/promises';

const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
const student=demo.students[0];


test('seleção grega e comparação preparada preservam âncora e origem',async({page})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});
 await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();
 await page.getByLabel('E-mail',{exact:true}).fill(student.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(student.credentials.password);
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
 await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();
 await expect(page.getByRole('region',{name:'Leitor de estudo'})).toBeVisible();
 await page.locator('.tab-list>summary').click();
 await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Persuadir e dizer a verdade',exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Abrir fontes',exact:true}).click();
 await page.locator('.tab-list>summary').click();
 await expect(page.getByRole('tab',{name:/Fontes/})).toBeVisible();
 await page.getByRole('button',{name:'Abrir fonte',exact:true}).first().click();
 await expect(page.locator('.source-block').first()).toContainText('ὅτι μὲν ὑμεῖς');
 await expect(page.locator('.source-card mark.source-hit').first()).toBeVisible();

 const block=page.locator('.source-block:has(mark.source-hit)').first();
 const blockId=await block.getAttribute('data-block-id');
 const greekQuote=(await block.textContent())??'';
 expect(blockId).toBeTruthy();
 const words=[...greekQuote.matchAll(/\p{L}[\p{L}\p{M}]*/gu)];
 const greekWord=words.find(word=>/\p{Script=Greek}/u.test(word[0])&&/[\u1F00-\u1FFF\u0300-\u036F]/.test(word[0]));
 expect(greekWord).toBeTruthy();
 const token=greekWord![0];
 const tokenStart=Array.from(greekQuote.slice(0,greekWord!.index)).length;
 const tokenEnd=tokenStart+Array.from(token).length;

 await selectAndCapture(page,blockId!,tokenStart,tokenEnd);
 await expect(page.locator('.selection-panel > .quote')).toHaveText(token);
 await expect(page.locator('.selection-panel > .meta-line')).toContainText(`posições ${tokenStart}–${tokenEnd}`);
 // The demo has one resource per passage; ambiguity is covered by the dedicated Unicode fixture.
 await expect(page.locator('.selection-panel .match-card')).toHaveCount(1);
 await expect(page.locator('.selection-panel .match-card .badge')).toHaveText(['contém']);
 await expect(page.locator('.source-card')).toBeVisible();
 await expect(page.locator('.resource-card')).toHaveCount(0);

 await page.locator('details.edition-panel > summary').click();
 await expect(page.locator('.edition-target').first()).toBeVisible();
 const targetQuote=(await page.locator('.edition-target .quote').first().textContent())??'';
 await expect(page.locator('.edition-target .badge').first()).toHaveText('Interpreta');
 await page.getByRole('button',{name:'Abrir edição vinculada',exact:true}).first().click();
 await expect(page.getByRole('heading',{name:/tradução/i}).first()).toBeVisible();
 await expect.poll(async()=>(await page.locator('.source-card mark.source-hit').first().textContent())??'').toBe(targetQuote);
 await expect(page.getByRole('button',{name:'Voltar à origem',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Voltar à origem',exact:true}).click();
 await expect(page.getByRole('heading',{name:/texto grego/i}).first()).toBeVisible();
 await expect.poll(async()=>(await page.locator('.source-card mark.source-hit').first().textContent())??'').toBe(greekQuote);
});
