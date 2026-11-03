import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mcpHandler} from '../src/mcp.ts';
import {configurationSchema} from '../src/parameters.ts';

test('o catálogo MCP não exporta padrões dependentes de flags Unicode ausentes no JSON Schema',async()=>{
 const response=await mcpHandler.fetch(new Request('http://127.0.0.1:4417/mcp',{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),
 }),{authInfo:{token:'',clientId:'catalog-test',scopes:['um.read'],identity:{id:'00000000-0000-4000-8000-000000000001',permission:'read'}} as any});
 assert.equal(response.status,200);
 const raw=await response.text();
 const message=JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')?raw.split('\n').find(l=>l.startsWith('data:'))!.slice(5):raw);
 const tools=message.result.tools;
 function visit(value:any,path:string){
  if(!value||typeof value!=='object')return;
  if(typeof value.pattern==='string')assert.doesNotMatch(value.pattern,/\\[pP]\{/u,path);
  for(const [key,child] of Object.entries(value))visit(child,`${path}/${key}`);
 }
 for(const tool of tools)visit(tool.inputSchema,tool.name);
 for(const name of ['project_create','project_update','bundle_publish','authoring_save','parameter_save'])assert.ok(tools.some((t:any)=>t.name===name),name);
 assert.ok(!tools.some((t:any)=>['form_draft','form_submit','account_grant_set'].includes(t.name)));
});

test('parâmetros conservam nomes Unicode, JSON arbitrário e rejeitam nomes reservados ou inválidos',()=>{
 const configuration=(key:string,value:unknown=true)=>({editorial:{[key]:value},instructional:{}});
 for(const key of ['tom','nível','日本語','𐐀'.repeat(80),'a_1-b'])assert.equal(configurationSchema.safeParse(configuration(key)).success,true,key);
 for(const key of ['', ' ', 'a.b','a/b','💡','a'.repeat(81),'𐐀'.repeat(81),'constructor','prototype'])assert.equal(configurationSchema.safeParse(configuration(key)).success,false,key);
 // Zod discards __proto__ before validating record keys; it must never persist.
 assert.equal(Object.hasOwn(configurationSchema.parse(configuration('__proto__')).editorial,'__proto__'),false);
 const nested=configuration('nível',{lista:[1,null,false,{texto:'útil'}]});
 assert.deepEqual(configurationSchema.parse(nested),nested);
 assert.equal(configurationSchema.safeParse({editorial:{válido:undefined},instructional:{}}).success,false);
 assert.equal(configurationSchema.safeParse(configuration('válido','x'.repeat(16001))).success,false);
});
