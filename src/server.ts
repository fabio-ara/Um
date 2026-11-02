import express from 'express';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {config} from './config.ts';
import {authenticate} from './auth.ts';
import {transaction,pool} from './db.ts';
import {AppError,ensure} from './errors.ts';
import {execute,schemas,type TaskName} from './service.ts';
import {getFile} from './files.ts';
import {mcpHandler} from './mcp.ts';
export function createApp(){
 const app=express();app.disable('x-powered-by');
 const allowed=new Set([new URL(config.origin).origin,...(config.local?['http://localhost:4419']:[])]);
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Vary':'Origin'});
  if(config.local&&req.headers.host!==new URL(config.apiOrigin).host)return next(new AppError('INVALID_HOST','Host inválido.',403));
  const origin=req.headers.origin;if(origin&&!allowed.has(origin))return next(new AppError('INVALID_ORIGIN','Origem não autorizada.',403));
  if(origin)res.set({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info, x-supabase-api-version, mcp-protocol-version, mcp-session-id','Access-Control-Expose-Headers':'WWW-Authenticate, mcp-session-id, mcp-protocol-version'});
  if(req.method==='OPTIONS'){res.sendStatus(204);return;}next();
 });
 app.get('/health',async(_req,res)=>{await pool.query('select 1');res.json({status:'ok',name:'Um',version:config.version});});
 app.get('/api/config',(_req,res)=>res.json({name:'Um',version:config.version,local:config.local,supabaseUrl:config.local?config.apiOrigin:config.storageUrl,publishableKey:config.local?'local-publishable-placeholder':config.storageKey,mcpUrl:config.apiOrigin+'/mcp'}));
 app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'],(_req,res)=>res.json({resource:config.apiOrigin+'/mcp',authorization_servers:[config.apiOrigin],scopes_supported:['um.read','um.write'],bearer_methods_supported:['header']}));
 if(config.local)app.use('/auth/v1',express.raw({type:()=>true,limit:'32kb'}),async(req,res)=>{
  const path=req.originalUrl.slice('/auth/v1'.length);ensure(!path.startsWith('/admin'),'FORBIDDEN','Rota de administração não exposta.',403);
  const headers:Record<string,string>={};for(const k of ['authorization','content-type','apikey','x-client-info','x-supabase-api-version'])if(typeof req.headers[k]==='string')headers[k]=req.headers[k] as string;
  const r=await fetch(config.authUrl+path,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:req.body,redirect:'manual',signal:AbortSignal.timeout(10000)});
  for(const k of ['content-type','location','retry-after']){const v=r.headers.get(k);if(v)res.set(k,v);}res.status(r.status).send(Buffer.from(await r.arrayBuffer()));
 });
 app.use(express.json({limit:'16mb'}));
 const windows=new Map<string,{count:number;until:number}>();
 app.use(['/api','/mcp'],async(req,res,next)=>{try{const identity=await authenticate(req.headers.authorization,req.baseUrl==='/mcp');await transaction(identity,async()=>{});const now=Date.now(),win=windows.get(identity.id);if(win&&win.until>now)ensure(++win.count<=240,'RATE_LIMIT','Aguarde antes de enviar mais operações.',429);else windows.set(identity.id,{count:1,until:now+60000});if(windows.size>10000)for(const[k,v]of windows)if(v.until<now)windows.delete(k);res.locals.identity=identity;next();}catch(e){next(e);}});
 app.post('/api/:task',async(req,res)=>{const name=req.params.task as TaskName;ensure(Object.hasOwn(schemas,name),'NOT_FOUND','Tarefa inexistente.',404);res.json({ok:true,data:await execute(name,req.body,res.locals.identity)});});
 app.get('/api/file/:account/:file',async(req,res)=>{const bytes=await getFile(res.locals.identity,`${req.params.account}/${req.params.file}`);res.type('application/octet-stream').send(bytes);});
 const nodeMcp=toNodeHandler(mcpHandler,{maxRequestBodySize:16*1024*1024});
 app.all('/mcp',async(req,res)=>{const identity=res.locals.identity;(req as any).auth={token:'',clientId:identity.clientId,scopes:[identity.permission==='read'?'um.read':'um.write'],identity};await nodeMcp(req,res,req.body);});
 app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const e=error instanceof AppError?error:new AppError('INTERNAL','Não foi possível confirmar a operação. Consulte o recibo antes de repetir.',500);
  if(e.status===401||e.status===403)res.set('WWW-Authenticate',`Bearer resource_metadata="${config.apiOrigin}/.well-known/oauth-protected-resource/mcp"`);
  if(e.status>=500)console.error(JSON.stringify({event:'request_failed',code:error?.code||'INTERNAL'}));
  res.status(e.status).json({ok:false,error:{code:e.code,message:e.message,...(e.details?{details:e.details}:{})}});
 });return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)createApp().listen(config.port,config.local?'127.0.0.1':'0.0.0.0',()=>console.log(`Um API ${config.apiOrigin}`));
