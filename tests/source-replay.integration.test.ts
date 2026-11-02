import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {localContext} from './local-context.ts';
import {execute} from '../src/service.ts';
import {transaction,operation} from '../src/db.ts';
const ctx=await localContext();after(ctx.close);
const metadata={title:'Reenvio de fixture',language:'pt',nature:'original',extent:'fragment',authors:[],workId:null,editionId:null,rights:{status:'permission',statement:'Fixture própria',evidence:'Teste local',offlineAllowed:true},provenance:'Fixture'};
test('recibo de importação precede transferência, aceita URL temporária renovada e rejeita intenção diferente',async()=>{
 const author=await ctx.account(),operationId=uuid(),sourceId=uuid();
 // Fault injection: committed receipt with an unavailable acquisition. This is not host proof.
 const intent={metadata,format:'text',webInclusionConfirmed:false,fileId:'synthetic-host-file'};
 const saved=await transaction(author,db=>operation(db,author,operationId,'source_import',intent,async()=>({sourceId,revision:1,reused:false})));
 const args={operationId,metadata,format:'text',file:{file_id:'synthetic-host-file',download_url:'https://invalid.example/unavailable'}};
 assert.deepEqual(await execute('source_import',args,author),saved);
 assert.deepEqual(await execute('source_import',{...args,file:{...args.file,download_url:'https://invalid.example/new-url'}},author),saved);
 await assert.rejects(execute('source_import',{...args,metadata:{...metadata,title:'Outra intenção'}},author),/outra intenção/);
});
