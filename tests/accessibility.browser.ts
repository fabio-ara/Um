import {test,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));

test('primeira abertura sem configuração mostra erro acessível e permite tentar novamente',async({page})=>{
 await page.setViewportSize({width:320,height:844});
 await page.route('**/api/config',route=>route.fulfill({status:503,body:'Unavailable'}));await page.goto('/');
 await expect(page.getByRole('heading',{name:'Não foi possível abrir o Um'})).toBeVisible();await expect(page.locator('main')).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/proofs/first-open-error-320.png'});
 await page.unroute('**/api/config');await page.getByRole('button',{name:'Tentar novamente'}).click();await expect(page.getByRole('button',{name:'Conta',exact:true})).toBeVisible();
});

test('dica icon-only por teclado e toque longo preserva a ação de toque curto',async({page,context})=>{
 await page.setViewportSize({width:320,height:844});await page.goto('/');
 await expect(page.getByRole('button',{name:'Conexão e sincronização',exact:true})).toBeVisible();
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Ir ao conteúdo'})).toBeFocused();
 await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Conexão e sincronização',exact:true})).toBeFocused();
 await expect(page.getByRole('tooltip')).toHaveText('Conexão e sincronização');await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toBeHidden();
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const button=page.getByRole('button',{name:'Conta',exact:true}),r=(await button.boundingBox())!,touchPoints=[{x:r.x+r.width/2,y:r.y+r.height/2}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});await expect(page.getByRole('tooltip')).toHaveText('Conta');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.getByRole('heading',{name:'Conta',exact:true})).toHaveCount(0);await expect(page.getByRole('tooltip')).toBeVisible();
 await mkdir('.local/proofs',{recursive:true});await page.screenshot({path:'.local/proofs/icon-hint-touch-320.png'});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.getByRole('heading',{name:'Conta',exact:true})).toBeVisible();await expect(page.getByRole('tooltip')).toBeHidden();await cdp.detach();
});

test('leitor mantém composição e controles em 320/390/480 e desktop, claro e escuro',async({page})=>{
 test.setTimeout(60000);await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();await expect(page.locator('.reader-body')).toBeVisible();
 const metrics=[];
 for(const mode of ['light','dark'] as const)for(const width of [320,390,480,1280]){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:mode});
  await expect(page.locator('html')).toHaveAttribute('data-color-mode',mode);
  const measure=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,shell:document.querySelector('.shell')!.getBoundingClientRect().width,font:getComputedStyle(document.body).fontFamily,bg:getComputedStyle(document.documentElement).backgroundColor,small:[...document.querySelectorAll<HTMLElement>('button.icon-button')].filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&(r.width<44||r.height<44);}).map(x=>x.getAttribute('aria-label')),unnamed:[...document.querySelectorAll('button')].filter(x=>!x.textContent?.trim()&&!x.getAttribute('aria-label')).length}));
  expect(measure.scrollWidth).toBeLessThanOrEqual(width);expect(measure.shell).toBeLessThanOrEqual(430);expect(measure.small).toEqual([]);expect(measure.unnamed).toBe(0);metrics.push({mode,...measure});
  await page.screenshot({path:`.local/proofs/reader-final-${width}-${mode}.png`});
 }
 await writeFile('.local/proofs/reader-visual-metrics.json',JSON.stringify(metrics,null,2));
});

test('painel de conexão sobrevive à troca de aba e prepara o pacote explicitamente',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await page.locator(`[data-action=reader][data-project="${demo.projectId}"]`).click();await expect(page.locator('.tab-list')).toBeVisible();
 const toggle=page.getByRole('button',{name:'Conexão e sincronização',exact:true});await toggle.click();const prepare=page.getByRole('button',{name:'Preparar este estudo para uso offline',exact:true});await expect(prepare).toBeVisible();
 await page.locator('.tab-list>summary').click();await page.getByRole('tab',{name:'Persuadir e dizer a verdade',exact:true}).click();
 await expect(prepare).toBeVisible();await prepare.click();await expect(page.locator('#live')).toHaveText('Estudo preparado neste dispositivo.');
 await toggle.click();await expect(prepare).toHaveCount(0);await expect(toggle).toHaveAttribute('aria-expanded','false');
});
