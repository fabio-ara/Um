import {config} from './config.ts';
import {authenticate} from './auth.ts';
import {transaction,pool} from './db.ts';
import {AppError,ensure} from './errors.ts';
import {execute,schemas,type TaskName} from './service.ts';
import {getFile} from './files.ts';
import {mcpHandler} from './mcp.ts';
import {authProxyUrl} from './auth-proxy.ts';
import {oauthHandler,authenticateMcp} from './oauth.ts';
import type {AuthInfo} from '@modelcontextprotocol/server';
import type {Identity} from './contracts.ts';

const allowed=new Set([new URL(config.origin).origin,'https://appassets.androidplatform.net',...(config.local?['http://localhost:4419','http://127.0.0.1:4420']:[])]);
const windows=new Map<string,{count:number;until:number}>();
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function boundedBody(request:Request,limit:number){const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new AppError('TOO_LARGE','Solicitação muito grande.',413);}chunks.push(value);}return Buffer.concat(chunks);}

/** One request implementation for Node and Supabase's Web Standard runtime. */
export async function httpHandler(request:Request):Promise<Response>{
 const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Vary':'Origin'});
 const finish=(response:Response)=>{const combined=new Headers(response.headers);for(const [k,v]of headers)combined.set(k,v);return new Response(response.body,{status:response.status,statusText:response.statusText,headers:combined});};
 try{
  const url=new URL(request.url),base=new URL(config.apiOrigin),prefix=base.pathname.replace(/\/$/,'');
  ensure(!config.local||url.host===base.host,'INVALID_HOST','Host inválido.',403);
  ensure(!prefix||url.pathname===prefix||url.pathname.startsWith(prefix+'/'),'NOT_FOUND','Rota inexistente.',404);
  const path=url.pathname.slice(prefix.length)||'/',origin=request.headers.get('origin');ensure(!origin||allowed.has(origin),'INVALID_ORIGIN','Origem não autorizada.',403);
  if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');headers.set('Access-Control-Allow-Headers','authorization, content-type, apikey, x-client-info, x-supabase-api-version, mcp-protocol-version, mcp-session-id');headers.set('Access-Control-Expose-Headers','WWW-Authenticate, mcp-session-id, mcp-protocol-version');}
  if(request.method==='OPTIONS')return finish(new Response(null,{status:204}));
  if(request.method==='GET'&&path==='/health'){await pool.query('select 1');return finish(json({status:'ok',name:'Um',version:config.version}));}
  if(request.method==='GET'&&path==='/api/config')return finish(json({name:'Um',version:config.version,local:config.local,supabaseUrl:config.local?config.apiOrigin:config.storageUrl,publishableKey:config.local?'local-publishable-placeholder':config.storageKey,mcpUrl:config.apiOrigin+'/mcp'}));
  if(request.method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path))return finish(json({resource:config.apiOrigin+'/mcp',authorization_servers:[config.apiOrigin],scopes_supported:['um.read','um.write'],bearer_methods_supported:['header']}));
  const oauth=await oauthHandler(request);if(oauth)return finish(oauth);
  if(config.local&&path.startsWith('/auth/v1/')){
   const proxyHeaders=new Headers();for(const key of ['authorization','content-type','apikey','x-client-info','x-supabase-api-version']){const value=request.headers.get(key);if(value)proxyHeaders.set(key,value);}
   const data=['GET','HEAD'].includes(request.method)?undefined:await boundedBody(request,32768);
   const response=await fetch(authProxyUrl(path+url.search,config.authUrl),{method:request.method,headers:proxyHeaders,body:data,redirect:'manual',signal:AbortSignal.timeout(10000)});
   const safe=new Headers();for(const key of ['content-type','location','retry-after']){const value=response.headers.get(key);if(value)safe.set(key,value);}return finish(new Response(response.body,{status:response.status,headers:safe}));
  }
  ensure(path.startsWith('/api/')||path==='/mcp','NOT_FOUND','Rota inexistente.',404);
  const bearer=request.headers.get('authorization')||undefined,identity=path==='/mcp'?await authenticateMcp(bearer):await authenticate(bearer);await transaction(identity,async()=>{});
  const now=Date.now(),win=windows.get(identity.id);if(win&&win.until>now)ensure(++win.count<=240,'RATE_LIMIT','Aguarde antes de enviar mais operações.',429);else windows.set(identity.id,{count:1,until:now+60000});if(windows.size>10000)for(const[k,v]of windows)if(v.until<now)windows.delete(k);
  if(path==='/mcp')return finish(await mcpHandler.fetch(request,{authInfo:{token:'',clientId:identity.clientId!,scopes:[identity.permission==='read'?'um.read':'um.write'],identity} as AuthInfo&{identity:Identity}}));
  if(request.method==='GET'&&/^\/api\/file\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(path)){const bytes=await getFile(identity,path.slice('/api/file/'.length));return finish(new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/octet-stream'}}));}
  ensure(request.method==='POST','NOT_FOUND','Rota inexistente.',404);const task=path.slice('/api/'.length) as TaskName;ensure(Object.hasOwn(schemas,task),'NOT_FOUND','Tarefa inexistente.',404);
  ensure(request.headers.get('content-type')?.startsWith('application/json'),'VALIDATION','Envie JSON.');let input:unknown;try{input=JSON.parse((await boundedBody(request,16*1024*1024)).toString('utf8'));}catch(e){if(e instanceof AppError)throw e;throw new AppError('VALIDATION','JSON inválido.');}
  return finish(json({ok:true,data:await execute(task,input,identity)}));
 }catch(error){const e=error instanceof AppError?error:new AppError('INTERNAL','Não foi possível confirmar a operação. Consulte o recibo antes de repetir.',500);if(e.status===401||e.status===403)headers.set('WWW-Authenticate',`Bearer resource_metadata="${config.apiOrigin}/.well-known/oauth-protected-resource/mcp"`);if(e.status>=500)console.error(JSON.stringify({event:'request_failed',code:(error as any)?.code||'INTERNAL'}));return finish(json({ok:false,error:{code:e.code,message:e.message,...(e.details?{details:e.details}:{})}},e.status));}
}
