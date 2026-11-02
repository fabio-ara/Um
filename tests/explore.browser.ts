import {test,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
test('acervo real local: mapa documentado, incerteza, rede e arte acessíveis em três larguras',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
 await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();await page.getByRole('button',{name:'Explorar acervo',exact:true}).click();
 await page.getByRole('button',{name:'Mapa',exact:true}).click();await expect(page.locator('.explore-land').first()).toBeVisible();await expect(page.locator('.explore-marker')).toHaveCount(2);
 await page.getByLabel('Buscar no acervo',{exact:true}).fill('Nāgārjuna');await expect(page.locator('.explore-marker')).toHaveCount(0);await expect(page.locator('[data-status]')).toContainText('1 resultado');
 await page.getByRole('button',{name:'Lista',exact:true}).click();await page.getByRole('button',{name:/Abrir ficha.*Nāgārjuna/}).click();await expect(page.locator('.explore-record')).toContainText('aproximada');
 await page.getByRole('button',{name:'Fechar ficha',exact:true}).click();await page.getByLabel('Buscar no acervo',{exact:true}).fill('');await page.getByRole('button',{name:'Rede',exact:true}).click();await expect(page.locator('.explore-edge').first()).toBeVisible();await expect(page.locator('.explore-legend')).toContainText('Recepção');await expect(page.locator('.explore-legend')).toContainText('Afinidade');
 await mkdir('.local/proofs',{recursive:true});await page.screenshot({path:'.local/proofs/network-390-dark.png'});
 await page.getByRole('button',{name:'Lista',exact:true}).click();await page.getByLabel('Buscar no acervo',{exact:true}).fill('morte de Sócrates');await page.getByRole('button',{name:/Abrir ficha.*morte de Sócrates/}).click();await expect(page.locator('.explore-art>img')).toBeVisible();await expect(page.locator('.explore-record')).toContainText('Domínio público');
 await page.getByRole('button',{name:'Ampliar imagem',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('Ampliação',{exact:true}).fill('200');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
 for(const width of [320,390,480]){await page.setViewportSize({width,height:844});await page.screenshot({path:`.local/proofs/art-${width}-dark.png`});const overflow=await page.evaluate(()=>[...document.body.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right})));expect(overflow).toEqual([]);}
});
