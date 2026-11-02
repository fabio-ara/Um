import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localContext} from './local-context.ts';
import {httpHandler} from '../src/http.ts';
const ctx=await localContext();after(()=>ctx.close());
test('HTTP parses a valid authenticated JSON body and preserves source bytes',async()=>{
 const {session}=await ctx.accountSession();
 async function call(task:string,args:unknown){
  const response=await httpHandler(new Request('http://127.0.0.1:4417/api/'+task,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify(args)}));
  const value=await response.json() as any;assert.equal(response.status,200,JSON.stringify(value));return value.data;
 }
 const metadata={title:'Fonte sintética HTTP',language:'grc',nature:'original',extent:'fragment',authors:[],rights:{status:'permission',statement:'Fixture própria',evidence:'Texto sintético',offlineAllowed:true},provenance:'Fixture sintética da fronteira HTTP'};
 const imported=await call('source_import',{operationId:randomUUID(),metadata,format:'text',text:'λόγος — evidência UTF-8'});
 const source=await call('source_get',{sourceId:imported.result.sourceId});assert.equal(source.blocks[0].text,'λόγος — evidência UTF-8');
 const invalid=await httpHandler(new Request('http://127.0.0.1:4417/api/source_get',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:'{'}));
 assert.equal(invalid.status,400);assert.equal((await invalid.json() as any).error.message,'JSON inválido.');
});
