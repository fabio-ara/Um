// Registro/transportes reaproveitados de AraRead (MIT), sem widget obrigatório.
import {McpServer,createMcpHandler,type AuthInfo} from '@modelcontextprotocol/server';
import {z} from 'zod';
import type {Identity} from './contracts.ts';
import {config} from './config.ts';
import {schemas,descriptions,readTasks,execute,type TaskName} from './service.ts';
import {guidance} from './guidance.ts';
import {AppError} from './errors.ts';
export function makeMcp(identity:Identity){
 const server=new McpServer({name:'Um',version:config.version},{instructions:guidance});
 for(const name of Object.keys(schemas) as TaskName[])server.registerTool(name,{
  title:name.replaceAll('_',' '),description:descriptions[name],inputSchema:schemas[name],
  outputSchema:z.object({ok:z.boolean(),data:z.unknown().optional(),error:z.object({code:z.string(),message:z.string(),details:z.unknown().optional()}).optional()}),
  annotations:{readOnlyHint:readTasks.has(name),idempotentHint:true,destructiveHint:/delete|remove|revoke|control|merge|split/.test(name),openWorldHint:name==='source_import'},
  ...(name==='source_import'?{_meta:{'openai/fileParams':['file']}}:{}),
 },async (input:unknown)=>{try{const out={ok:true,data:await execute(name,input,identity)};return {content:[{type:'text' as const,text:JSON.stringify(out)}],structuredContent:out};}catch(e){const err=e instanceof AppError?e:new AppError('INTERNAL','Operação não confirmada. Consulte o recibo antes de repetir.',500);const out={ok:false,error:{code:err.code,message:err.message,...(err.details?{details:err.details}:{})}};return {isError:true,content:[{type:'text' as const,text:JSON.stringify(out)}],structuredContent:out};}});
 server.registerResource('orientacao','um://assistant/guidance',{description:'Contrato operacional de autoria e retomada do Um.',mimeType:'text/plain'},async uri=>({contents:[{uri:uri.href,mimeType:'text/plain',text:guidance}]}));
 return server;
}
export const mcpHandler=createMcpHandler(({authInfo})=>makeMcp((authInfo as AuthInfo&{identity:Identity}).identity),{legacy:'stateless',maxRequestBodySize:16*1024*1024});
