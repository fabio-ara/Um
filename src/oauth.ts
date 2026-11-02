// Validation/redirect/body-limit patterns adapted from AraLearn's MIT action
// OAuth handler. Um has independent grants, resource binding and PKCE; it never
// accepts an AraLearn token or changes the shared Supabase access-token hook.
import {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {config} from './config.ts';
import {pool,type Transaction,transaction} from './db.ts';
import {authenticate} from './auth.ts';
import {ensure,AppError} from './errors.ts';
import type {Identity} from './contracts.ts';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const opaque=()=>randomBytes(32).toString('base64url');
const resource=()=>config.apiOrigin+'/mcp';
const scopes=(p:string)=>p==='write'?'um.read um.write':'um.read';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Pragma':'no-cache'}});
const redirect=(url:string)=>new Response(null,{status:302,headers:{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const credential=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
function validRedirect(value:string){try{const u=new URL(value);return !u.username&&!u.password&&!u.hash&&(u.protocol==='https:'||config.local&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname));}catch{return false;}}
function permission(value:string){const list=value.split(/\s+/).filter(Boolean);ensure(list.length&&list.every(s=>s==='um.read'||s==='um.write'),'invalid_scope','Use as permissões do Um.');return list.includes('um.write')?'write':'read';}
function encryptionKey(){const encoded=process.env.UM_OAUTH_ENCRYPTION_KEY;ensure(encoded&&/^[A-Za-z0-9_-]{43}$/.test(encoded),'temporarily_unavailable','Autorização do Um não configurada.',503);return Buffer.from(encoded,'base64url');}
function seal(id:string,session:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAAD(Buffer.from('um-oauth-session:'+id));const body=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');}
function unseal(id:string,value:string){const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));decipher.setAAD(Buffer.from('um-oauth-session:'+id));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));}
async function serverTransaction<T>(fn:(db:Transaction)=>Promise<T>){const db=await pool.connect();try{await db.query('begin');await db.query('set local role um_oauth_server');await db.query("set local statement_timeout='12000'");const out=await fn(db);await db.query('commit');return out;}catch(e){await db.query('rollback');throw e;}finally{db.release();}}
async function body(request:Request,form=false){ensure(request.headers.get('content-type')?.startsWith(form?'application/x-www-form-urlencoded':'application/json'),'invalid_request','Formato da solicitação incompatível.');const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new AppError('invalid_request','Solicitação muito grande.',413);}chunks.push(value);}const text=Buffer.concat(chunks).toString('utf8');if(form){const p=new URLSearchParams(text);ensure([...p.keys()].every(k=>p.getAll(k).length===1),'invalid_request','Parâmetro repetido.');return Object.fromEntries(p);}try{return JSON.parse(text);}catch{throw new AppError('invalid_request','JSON inválido.');}}
function query(url:URL){const p=url.searchParams;ensure([...p.keys()].every(k=>p.getAll(k).length===1),'invalid_request','Parâmetro repetido.');return Object.fromEntries(p);}
function resultUrl(request:any,values:Record<string,string>){const url=new URL(request.redirect_uri);for(const [key,value]of Object.entries({...values,state:request.state}))url.searchParams.set(key,value);return url.href;}
async function currentGrant(db:Transaction,id:string){const row=(await db.query(`select g.*,c.permission current_permission from um.oauth_grants g
 join um.client_grants c on c.client_id=g.client_id and c.account_id=g.account_id

 where g.id=$1 and g.revoked_at is null and g.expires_at>now() and um.oauth_session_active(g.account_id,g.session_id) for update of g`,[id])).rows[0];ensure(row,'invalid_grant','Autorização inválida ou revogada.',401);return row;}
async function clientAuthentication(db:Transaction,input:any,header:string|null){
 let clientId=input.client_id,secret=input.client_secret,method=secret?'client_secret_post':'none';
 if(header){ensure(header.startsWith('Basic ')&&!secret,'invalid_client','Autenticação de cliente inválida.',401);const decoded=Buffer.from(header.slice(6),'base64').toString('utf8'),colon=decoded.indexOf(':');ensure(colon>0,'invalid_client','Cliente inválido.',401);let id:string;try{id=decodeURIComponent(decoded.slice(0,colon));secret=decodeURIComponent(decoded.slice(colon+1));}catch{throw new AppError('invalid_client','Autenticação de cliente inválida.',401);}ensure(!clientId||clientId===id,'invalid_client','Cliente incompatível.',401);clientId=id;method='client_secret_basic';}
 ensure(z.uuid().safeParse(clientId).success,'invalid_client','Cliente inválido.',401);
 const row=(await db.query('select * from um.oauth_clients where id=$1',[clientId])).rows[0];ensure(row&&row.auth_method===method,'invalid_client','Cliente inválido.',401);
 if(method!=='none'){ensure(typeof secret==='string'&&secret.length<=512,'invalid_client','Cliente inválido.',401);ensure(timingSafeEqual(Buffer.from(digest(secret)),Buffer.from(row.secret_hash)),'invalid_client','Cliente inválido.',401);}return row;
}
async function renewSession(refreshToken:string){
 ensure(typeof refreshToken==='string'&&refreshToken.length>10&&refreshToken.length<4096,'invalid_grant','Sessão inválida.',401);
 const response=await fetch(config.authUrl+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json',...(config.storageKey?{apikey:config.storageKey}:{})},body:JSON.stringify({refresh_token:refreshToken}),signal:AbortSignal.timeout(10000)});
 ensure(response.ok,response.status>=500?'temporarily_unavailable':'invalid_grant','Não foi possível renovar a sessão.',response.status>=500?503:401);
 const session=await response.json() as any,identity=await authenticate('Bearer '+session.access_token);ensure(!identity.clientId,'invalid_grant','Use uma sessão própria da conta, separada do cliente OAuth.',401);return {identity,session:{access_token:session.access_token,refresh_token:session.refresh_token,expires_at:Math.floor(Date.now()/1000)+session.expires_in}};
}
async function issueTokens(db:Transaction,grant:any,permission:'read'|'write'){const access=opaque(),refresh=opaque();await db.query("insert into um.oauth_tokens(hash,grant_id,kind,expires_at,binding) values($1,$3,'access',now()+interval '15 minutes',$5),($2,$3,'refresh',least($4::timestamptz,now()+interval '30 days'),$5)",[digest(access),digest(refresh),grant.id,grant.expires_at,JSON.stringify({permission})]);return {access_token:access,token_type:'Bearer',expires_in:900,refresh_token:refresh,scope:scopes(permission)};}
export async function accountClients(identity:Identity){
 ensure(!identity.clientId,'FORBIDDEN','Gerencie autorizações pela própria conta.',403);
 await transaction(identity,async()=>{});
 return {items:(await serverTransaction(db=>db.query(`select g.client_id,g.permission,c.name,
  exists(select 1 from um.oauth_grants a where a.account_id=g.account_id and a.client_id=g.client_id and a.revoked_at is null and a.expires_at>now() and um.oauth_session_active(a.account_id,a.session_id)) active
  from um.client_grants g join um.oauth_clients c on c.id=g.client_id where g.account_id=$1 order by c.name,g.client_id`,[identity.id]))).rows};
}

export async function authenticateMcp(header:string|undefined):Promise<Identity>{
 ensure(header?.startsWith('Bearer ')&&credential.safeParse(header.slice(7)).success,'UNAUTHENTICATED','Autorize um cliente para o Um.',401);
 return serverTransaction(async db=>{
  const row=(await db.query("select grant_id,binding from um.oauth_tokens where hash=$1 and kind='access' and expires_at>now()",[digest(header!.slice(7))])).rows[0];ensure(row,'UNAUTHENTICATED','Autorização inválida ou expirada.',401);
  const grant=await currentGrant(db,row.grant_id);let session=unseal(grant.id,grant.session_cipher);
  if(session.expires_at<Math.floor(Date.now()/1000)+60){const renewed=await renewSession(session.refresh_token);ensure(renewed.identity.id===grant.account_id&&renewed.identity.sessionId===grant.session_id,'UNAUTHENTICATED','Sessão incompatível.',401);session=renewed.session;await db.query('update um.oauth_grants set session_cipher=$2 where id=$1',[grant.id,seal(grant.id,session)]);}
  ensure(grant.resource===resource(),'UNAUTHENTICATED','Token não destinado a este recurso.',401);
  return {id:grant.account_id,sessionId:grant.session_id,clientId:grant.client_id,permission:row.binding.permission==='read'||grant.permission==='read'||grant.current_permission==='read'?'read':'write',accessToken:session.access_token};
 });
}

export async function oauthHandler(request:Request):Promise<Response|null>{
 const url=new URL(request.url),basePath=new URL(config.apiOrigin).pathname.replace(/\/$/,''),path=url.pathname.slice(basePath.length);
 if(!path.startsWith('/oauth/')&&!['/.well-known/oauth-authorization-server','/.well-known/openid-configuration'].includes(path))return null;
 try{
  if(request.method==='GET'&&path.startsWith('/.well-known/'))return reply({issuer:config.apiOrigin,authorization_endpoint:config.apiOrigin+'/oauth/authorize',token_endpoint:config.apiOrigin+'/oauth/token',registration_endpoint:config.apiOrigin+'/oauth/register',revocation_endpoint:config.apiOrigin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],scopes_supported:['um.read','um.write'],client_id_metadata_document_supported:false});
  encryptionKey();
  if(request.method==='POST'&&path==='/oauth/register'){
   const a=z.object({client_name:z.string().trim().min(1).max(120),redirect_uris:z.array(z.string().max(2048).refine(validRedirect)).min(1).max(5),token_endpoint_auth_method:z.enum(['none','client_secret_post','client_secret_basic']).default('none'),grant_types:z.array(z.enum(['authorization_code','refresh_token'])).default(['authorization_code','refresh_token']),response_types:z.array(z.literal('code')).default(['code'])}).parse(await body(request));
   const id=randomUUID(),secret=a.token_endpoint_auth_method==='none'?null:opaque();
   await serverTransaction(async db=>{await db.query("select pg_advisory_xact_lock(hashtextextended('um-oauth-registration',0))");const count=(await db.query("select count(*)::int count from um.oauth_clients where created_at>now()-interval '1 hour'")).rows[0].count;ensure(count<100,'temporarily_unavailable','Limite de registros atingido; tente mais tarde.',429);await db.query('insert into um.oauth_clients(id,name,redirect_uris,auth_method,secret_hash) values($1,$2,$3,$4,$5)',[id,a.client_name,JSON.stringify(a.redirect_uris),a.token_endpoint_auth_method,secret?digest(secret):null]);});
   return reply({...a,client_id:id,client_id_issued_at:Math.floor(Date.now()/1000),...(secret?{client_secret:secret,client_secret_expires_at:0}:{})},201);
  }
  if(request.method==='GET'&&path==='/oauth/authorize'){
   const a=z.object({client_id:z.uuid(),redirect_uri:z.string().max(2048),response_type:z.literal('code'),code_challenge:credential,code_challenge_method:z.literal('S256'),state:z.string().min(1).max(2048),resource:z.literal(resource()),scope:z.string().max(100).default('um.read')}).parse(query(url));const access=permission(a.scope),id=opaque();
   await serverTransaction(async db=>{const client=(await db.query('select * from um.oauth_clients where id=$1',[a.client_id])).rows[0];ensure(client?.redirect_uris.includes(a.redirect_uri),'invalid_request','Redirecionamento não registrado.');await db.query("delete from um.oauth_requests where expires_at<now()-interval '1 day'");const recent=(await db.query('select count(*)::int count from um.oauth_requests where client_id=$1 and expires_at>now()',[a.client_id])).rows[0].count;ensure(recent<30,'temporarily_unavailable','Aguarde para iniciar outra autorização.',429);await db.query("insert into um.oauth_requests values($1,$2,$3,now()+interval '10 minutes',null)",[digest(id),a.client_id,JSON.stringify({...a,permission:access})]);});
   const destination=new URL(config.origin);destination.hash=new URLSearchParams({authorize:id}).toString();return redirect(destination.href);
  }
  if(request.method==='POST'&&path==='/oauth/request'){
   const id=z.strictObject({request:credential}).parse(await body(request)).request;const row=(await serverTransaction(db=>db.query('select r.request,c.name from um.oauth_requests r join um.oauth_clients c on c.id=r.client_id where r.id_hash=$1 and r.used_at is null and r.expires_at>now()',[digest(id)]))).rows[0];ensure(row&&row.request.resource===resource(),'invalid_request','Solicitação expirada, utilizada ou destinada a outro recurso.');return reply({clientName:row.name,redirectUri:row.request.redirect_uri,permission:row.request.permission,resource:row.request.resource});
  }
  if(request.method==='POST'&&path==='/oauth/consent'){
   const a=z.strictObject({request:credential,decision:z.enum(['allow','deny']),refresh_token:z.string().max(4096).optional()}).parse(await body(request));
   const identity=a.decision==='allow'?await authenticate(request.headers.get('authorization')||undefined):null;if(identity){ensure(!identity.clientId,'FORBIDDEN','Consentimento exige a conta.',403);await transaction(identity,async()=>{});}
   // Denial never stores credentials. Approval verifies a dedicated, renewable
   // account session; the UI creates it without sharing its persisted app session.
   return await serverTransaction(async db=>{
    const row=(await db.query('select * from um.oauth_requests where id_hash=$1 and used_at is null and expires_at>now() for update',[digest(a.request)])).rows[0];ensure(row&&row.request.resource===resource(),'invalid_request','Solicitação expirada, utilizada ou destinada a outro recurso.');
    // Do not rotate an external session for an expired, reused or foreign request.
    const renewed=a.decision==='allow'?await renewSession(a.refresh_token||''):null;
    if(renewed)ensure(renewed.identity.id===identity!.id&&renewed.identity.sessionId===identity!.sessionId,'invalid_grant','Sessão de consentimento incompatível.',401);
    await db.query('update um.oauth_requests set used_at=now() where id_hash=$1',[digest(a.request)]);
    if(a.decision==='deny')return reply({redirectUri:resultUrl(row.request,{error:'access_denied'})});
    const id=randomUUID(),code=opaque();await db.query("insert into um.oauth_grants values($1,$2,$3,$4,$5,$6,$7,now()+interval '30 days',null)",[id,row.client_id,identity!.id,identity!.sessionId,row.request.permission,resource(),seal(id,renewed!.session)]);
    await db.query("insert into um.oauth_tokens values($1,$2,'code',now()+interval '2 minutes',null,$3)",[digest(code),id,JSON.stringify(row.request)]);
    await db.query('insert into um.client_grants values($1,$2,$3) on conflict(account_id,client_id) do update set permission=excluded.permission',[identity!.id,row.client_id,row.request.permission]);return reply({redirectUri:resultUrl(row.request,{code})});
   });
  }
  if(request.method==='POST'&&(path==='/oauth/token'||path==='/oauth/revoke')){
   const a=await body(request,true);
   return await serverTransaction(async db=>{
    const client=await clientAuthentication(db,a,request.headers.get('authorization'));
    if(path==='/oauth/revoke'){const token=credential.safeParse(a.token);if(token.success)await db.query("update um.oauth_grants set revoked_at=now(),session_cipher='' where client_id=$2 and id in(select grant_id from um.oauth_tokens where hash=$1)",[digest(token.data),client.id]);return reply({});}
    ensure(a.resource===resource(),'invalid_target','Informe o recurso Um exato.');
    ensure(a.grant_type==='authorization_code'||a.grant_type==='refresh_token','unsupported_grant_type','Fluxo não suportado.');
    const value=credential.parse(a.grant_type==='authorization_code'?a.code:a.refresh_token),kind=a.grant_type==='authorization_code'?'code':'refresh';
    const token=(await db.query('select t.* from um.oauth_tokens t join um.oauth_grants g on g.id=t.grant_id where t.hash=$1 and t.kind=$2 and g.client_id=$3 and t.expires_at>now() for update of t',[digest(value),kind,client.id])).rows[0];ensure(token,'invalid_grant','Credencial inválida ou expirada.',401);
    if(token.used_at){await db.query("update um.oauth_grants set revoked_at=now(),session_cipher='' where id=$1",[token.grant_id]);return reply({error:'invalid_grant',error_description:'Credencial já utilizada; autorize novamente.'},400);}
    const grant=await currentGrant(db,token.grant_id);ensure(grant.resource===resource(),'invalid_target','Recurso incompatível.');
    if(kind==='code'){ensure(typeof a.code_verifier==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(a.code_verifier)&&createHash('sha256').update(a.code_verifier).digest('base64url')===token.binding.code_challenge,'invalid_grant','Verificação PKCE inválida.',401);ensure(a.redirect_uri===token.binding.redirect_uri,'invalid_grant','Redirecionamento incompatível.',401);}
    const effective=grant.permission==='read'||grant.current_permission==='read'||token.binding.permission==='read'?'read':'write';
    if(a.scope)ensure(permission(a.scope)!=='write'||effective==='write','invalid_scope','Renovação não amplia permissões.');
    await db.query('update um.oauth_tokens set used_at=now() where hash=$1',[digest(value)]);return reply(await issueTokens(db,grant,a.scope?permission(a.scope):effective));
   });
  }
  return reply({error:'invalid_request',error_description:'Rota OAuth não encontrada.'},404);
 }catch(e){const error=e instanceof z.ZodError?new AppError('invalid_request','Parâmetros OAuth incompatíveis.'):e instanceof AppError?e:new AppError('temporarily_unavailable','Autorização temporariamente indisponível.',503);return reply({error:error.code,error_description:error.message},error.code==='invalid_grant'?400:error.status);}
}
