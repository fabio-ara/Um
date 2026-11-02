import {test,expect} from '@playwright/test';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {localContext} from './local-context.ts';
const origin=process.env.UM_PROOF_API_ORIGIN||'http://127.0.0.1:4417',resource=origin+'/mcp';
test('consentimento real mantém sessão do aplicativo, conecta MCP e revoga pelo Um',async({page})=>{
 const ctx=await localContext({closePool:false}),account=await ctx.accountSession();let clientId='';
 try{
  const demo=JSON.parse(await readFile('.local/demo.json','utf8'));
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Conta',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill(demo.students[0].credentials.email);await page.getByLabel('Senha',{exact:true}).fill(demo.students[0].credentials.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('heading',{name:'Meus estudos',exact:true})).toBeVisible();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('um-auth-v1')!).user.id);
  const registration=await fetch(origin+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Prova de conexão Um',redirect_uris:['https://client.example.test/callback'],token_endpoint_auth_method:'none'})});expect(registration.status).toBe(201);clientId=(await registration.json() as any).client_id;
  const verifier=randomBytes(32).toString('base64url'),params={client_id:clientId,redirect_uri:'https://client.example.test/callback',response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:'synthetic-browser-state',resource,scope:'um.read um.write'};
  const flow=await fetch(origin+'/oauth/authorize?'+new URLSearchParams(params),{redirect:'manual'});expect(flow.status).toBe(302);
  await page.route('https://client.example.test/callback*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Callback sintético</title><p>Callback recebido</p>'}));
  await page.goto(flow.headers.get('location')!);await expect(page.getByRole('heading',{name:'Prova de conexão Um'})).toBeVisible();await page.getByLabel('E-mail',{exact:true}).fill(account.credentials.email);await page.getByLabel('Senha',{exact:true}).fill(account.credentials.password);await page.getByRole('button',{name:'Entrar para autorizar'}).click();await expect(page.getByRole('button',{name:'Autorizar conexão'})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('um-auth-v1')!).user.id)).toBe(before);expect(await page.evaluate(()=>localStorage.getItem('um-consent-transient'))).toBe(null);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await mkdir('.local/proofs',{recursive:true});await page.screenshot({path:'.local/proofs/oauth-consent-390.png'});
  await page.getByRole('button',{name:'Autorizar conexão'}).click();await page.waitForURL('https://client.example.test/callback*');const callback=new URL(page.url());expect(callback.searchParams.get('state')).toBe(params.state);
  const tokenResponse=await fetch(origin+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code:callback.searchParams.get('code')!,code_verifier:verifier,redirect_uri:params.redirect_uri,resource})});expect(tokenResponse.status).toBe(200);const token=(await tokenResponse.json() as any).access_token;
  const rpc=async(method:string,params:any)=>{const r=await fetch(resource,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json',Accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});expect(r.status).toBe(200);const text=await r.text();return JSON.parse(r.headers.get('content-type')?.includes('text/event-stream')?text.split('\n').find(l=>l.startsWith('data:'))!.slice(5):text);};
  const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Um focal HTTP',version:'1'}});expect(initialized.result.serverInfo.name).toBe('Um');
  const listed=await rpc('tools/list',{});expect(listed.result.tools.find((t:any)=>t.name==='source_import')._meta['openai/fileParams']).toEqual(['file']);
  expect(listed.result.tools.find((t:any)=>t.name==='parameter_save').inputSchema.properties.configuration).toBeTruthy();
  expect(listed.result.tools.some((t:any)=>['form_draft','form_submit','account_grant_set'].includes(t.name))).toBe(false);
  expect(listed.result.tools.some((t:any)=>t.name==='profile_create')).toBe(true);
  const saved=await rpc('tools/call',{name:'parameter_save',arguments:{operationId:crypto.randomUUID(),scope:'account',expectedRevision:0,configuration:{editorial:{language:'pt'},instructional:{}},requirements:['Conferir a fonte'],intention:'Fixture do contrato MCP de parâmetros'}});expect(saved.result.structuredContent.data.result.revision).toBe(1);
  const parameters=await rpc('tools/call',{name:'parameter_get',arguments:{scope:'account'}});expect(parameters.result.structuredContent.data.effective.editorial.language).toBe('pt');
  const called=await rpc('tools/call',{name:'capabilities',arguments:{}});expect(called.result.structuredContent.data.program).toBe('UM-20261101-v1');
  expect(called.result.structuredContent.data.tasks.map((t:any)=>t.name).sort()).toEqual(listed.result.tools.map((t:any)=>t.name).sort());
  const revoke=await fetch(origin+'/api/account_grant_set',{method:'POST',headers:{Authorization:'Bearer '+account.session.access_token,'content-type':'application/json'},body:JSON.stringify({operationId:crypto.randomUUID(),clientId,permission:'revoke'})});expect(revoke.status).toBe(200);
  const denied=await fetch(resource,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})});expect(denied.status).toBe(401);
 }finally{await page.close();if(clientId)await ctx.admin.query('delete from um.oauth_clients where id=$1',[clientId]);await ctx.close();}
});
