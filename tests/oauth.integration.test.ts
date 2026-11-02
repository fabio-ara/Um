import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {localContext} from './local-context.ts';
import {oauthHandler,authenticateMcp} from '../src/oauth.ts';
import {transaction} from '../src/db.ts';
import {execute} from '../src/service.ts';
const ctx=await localContext(),clients:string[]=[];after(async()=>{await ctx.admin.query('delete from um.oauth_clients where id=any($1::uuid[])',[clients]);await ctx.close();});
const origin='http://127.0.0.1:4417',resource=origin+'/mcp',redirectUri='https://client.example.test/callback';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function request(path:string,data?:any,token?:string,form=false){const r=await oauthHandler(new Request(origin+path,{method:data?'POST':'GET',headers:{...(data?{'content-type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:data?(form?new URLSearchParams(data).toString():JSON.stringify(data)):undefined}));assert.ok(r);return r;}
async function register(method='none'){const response=await request('/oauth/register',{client_name:'Cliente sintético Um',redirect_uris:[redirectUri],token_endpoint_auth_method:method});assert.equal(response.status,201);const client=await response.json() as any;clients.push(client.client_id);return client;}
async function authorize(client:any,scope='um.read'){
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
 const params={client_id:client.client_id,redirect_uri:redirectUri,response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state,resource,scope};
 const response=await request('/oauth/authorize?'+new URLSearchParams(params));assert.equal(response.status,302);const id=new URLSearchParams(new URL(response.headers.get('location')!).hash.slice(1)).get('authorize')!;return {id,verifier,state,params};
}
async function consent(client:any,scope='um.read'){
 const flow=await authorize(client,scope),account=await ctx.accountSession();const response=await request('/oauth/consent',{request:flow.id,decision:'allow',refresh_token:account.session.refresh_token},account.session.access_token);assert.equal(response.status,200);const callback=new URL((await response.json() as any).redirectUri);assert.equal(callback.searchParams.get('state'),flow.state);return {...flow,account,code:callback.searchParams.get('code')!};
}
function exchange(client:any,flow:any,changes:any={}){return request('/oauth/token',{grant_type:'authorization_code',client_id:client.client_id,...(client.client_secret?{client_secret:client.client_secret}:{}),code:flow.code,code_verifier:flow.verifier,redirect_uri:redirectUri,resource,...changes},undefined,true);}
test('OAuth isolado liga consentimento, PKCE, recurso, limites de leitura e revogação sem reativar tokens antigos',async()=>{
 const metadata=await (await request('/.well-known/openid-configuration')).json() as any;assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);assert.equal(metadata.issuer,origin);
 const client=await register(),flow=await consent(client);
 assert.equal((await exchange(client,flow,{resource:'https://another.example.test/mcp'})).status,400);
 assert.equal((await exchange(client,flow,{code_verifier:randomBytes(32).toString('base64url')})).status,400);
 const response=await exchange(client,flow);assert.equal(response.status,200);const tokens=await response.json() as any;assert.equal(tokens.scope,'um.read');
 const identity=await authenticateMcp('Bearer '+tokens.access_token);assert.equal(identity.id,flow.account.identity.id);assert.equal(identity.permission,'read');assert.notEqual(tokens.access_token,identity.accessToken);
 assert.equal((await ctx.admin.query('select hash from um.oauth_tokens where hash=$1',[tokens.access_token])).rowCount,0);
 const grant=(await ctx.admin.query('select session_cipher from um.oauth_grants where account_id=$1',[identity.id])).rows[0];assert.ok(!grant.session_cipher.includes(flow.account.session.refresh_token));
 await assert.rejects(authenticateMcp('Bearer '+flow.account.session.access_token),/Autorize/);
 await assert.rejects(execute('profile_create',{operationId:randomUUID(),fields:{name:'Não autorizado'}},identity),/somente para leitura/);
 await assert.rejects(transaction(flow.account.identity,db=>db.query('select * from um.oauth_grants')),/permission denied/);
 await execute('account_grant_set',{operationId:randomUUID(),clientId:client.client_id,permission:'write'},flow.account.identity);
 const stillRead=await authenticateMcp('Bearer '+tokens.access_token);await transaction(stillRead,async()=>{});assert.equal(stillRead.permission,'read');
 await execute('account_grant_set',{operationId:randomUUID(),clientId:client.client_id,permission:'revoke'},flow.account.identity);
 await assert.rejects(authenticateMcp('Bearer '+tokens.access_token),/revogada/);
 await execute('account_grant_set',{operationId:randomUUID(),clientId:client.client_id,permission:'write'},flow.account.identity);
 await assert.rejects(authenticateMcp('Bearer '+tokens.access_token),/revogada/);
});
test('renovação rota credenciais, reduz escopo e detecta reutilização; negação não emite código',async()=>{
 const client=await register('client_secret_post'),flow=await consent(client,'um.write');const response=await exchange(client,flow);assert.equal(response.status,200);const tokens=await response.json() as any;
 const args={grant_type:'refresh_token',client_id:client.client_id,client_secret:client.client_secret,refresh_token:tokens.refresh_token,resource,scope:'um.read'};
 assert.equal((await request('/oauth/token',{...args,client_secret:'wrong'},undefined,true)).status,401);
 const rotated=await request('/oauth/token',args,undefined,true);assert.equal(rotated.status,200);const next=await rotated.json() as any;assert.equal(next.scope,'um.read');assert.notEqual(next.refresh_token,tokens.refresh_token);assert.equal((await authenticateMcp('Bearer '+next.access_token)).permission,'read');
 assert.equal((await request('/oauth/token',{...args,refresh_token:next.refresh_token,scope:'um.write'},undefined,true)).status,400);
 const grant=(await ctx.admin.query('select grant_id from um.oauth_tokens where hash=$1',[sha(next.access_token)])).rows[0];
 assert.equal((await request('/oauth/token',args,undefined,true)).status,400);assert.ok((await ctx.admin.query('select revoked_at from um.oauth_grants where id=$1',[grant.grant_id])).rows[0].revoked_at);await assert.rejects(authenticateMcp('Bearer '+next.access_token),/revogada/);
 const denied=await authorize(client),account=await ctx.accountSession();const denial=await request('/oauth/consent',{request:denied.id,decision:'deny'},account.session.access_token);assert.equal(denial.status,200);const callback=new URL((await denial.json() as any).redirectUri);assert.equal(callback.searchParams.get('error'),'access_denied');assert.equal(callback.searchParams.has('code'),false);
 const invalid={...denied.params,redirect_uri:'https://attacker.example.test/callback'};assert.equal((await request('/oauth/authorize?'+new URLSearchParams(invalid))).status,400);
 const foreign=await authorize(client);await ctx.admin.query("update um.oauth_requests set request=jsonb_set(request,'{resource}',to_jsonb($2::text)) where id_hash=$1",[sha(foreign.id),'https://another.example.test/mcp']);
 assert.equal((await request('/oauth/request?request='+foreign.id)).status,400);
 assert.equal((await request('/oauth/consent',{request:foreign.id,decision:'deny'})).status,400);
 assert.equal((await ctx.admin.query('select used_at from um.oauth_requests where id_hash=$1',[sha(foreign.id)])).rows[0].used_at,null);
});
