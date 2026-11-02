import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {localContext} from './local-context.ts';
import {sourceTask,sourceView} from '../src/sources.ts';
import {transaction} from '../src/db.ts';
const ctx=await localContext();after(ctx.close);
test('índices preservam revisão e ACL, localizam bloco e leem página sem arquivo integral',async()=>{
 const author=await ctx.account(),other=await ctx.account();
 const metadata={title:'Índice sintético',language:'pt',nature:'original',extent:'full',rights:{status:'permission',statement:'Fixture própria',evidence:'Teste local',offlineAllowed:true},provenance:'Fixture própria'};
 const blocks=Array.from({length:251},(_,i)=>({kind:'paragraph',text:`Passagem ${i}: ἄνθρωπος e\u0301 العربية 漢字. Texto sintético suficiente para testar leitura parcial sem carregar o documento completo.`,locator:'Seção '+i}));
 const receipt=await sourceTask(author,'source_import',{operationId:uuid(),metadata,format:'structured',blocks}) as any,sourceId=receipt.result.sourceId;
 const original=await sourceView(author,sourceId);
 assert.equal((await ctx.admin.query('select count(*)::int n from um.source_pages where source_id=$1',[sourceId])).rows[0].n,3);
 assert.equal((await transaction(other,db=>db.query('select * from um.source_block_index where source_id=$1',[sourceId]))).rowCount,0);
 await assert.rejects(sourceTask(other,'source_locate',{sourceId,sourceRevision:1,elementId:original.blocks[205].id}),/indisponível/);
 const rows=(await ctx.admin.query('select body_file from um.sources where id=$1',[sourceId])).rows;
 const body=resolve('.local/blobs',rows[0].body_file),hidden=body+'.proof-unavailable';
 await rename(body,hidden);
 try{
  const page=await sourceTask(author,'source_get',{sourceId,offset:98,limit:5}) as any;assert.equal(page.total,251);assert.deepEqual(page.blocks,original.blocks.slice(98,103));
  const located=await sourceTask(author,'source_locate',{sourceId,sourceRevision:1,elementId:original.blocks[205].id}) as any;assert.equal(located.offset,205);assert.deepEqual(located.blocks,[original.blocks[205]]);
  await assert.rejects(sourceTask(author,'source_locate',{sourceId,sourceRevision:1,elementId:'absent'}),/indisponível/);
  const end=await sourceTask(author,'source_get',{sourceId,offset:300,limit:5}) as any;assert.deepEqual(end.blocks,[]);assert.equal(end.total,251);
 }finally{await rename(hidden,body);}
 const args={operationId:uuid(),sourceId,sourceRevision:1};await sourceTask(author,'source_index_build',args);await sourceTask(author,'source_index_build',args);
 assert.equal((await ctx.admin.query('select count(*)::int n from um.source_pages where source_id=$1',[sourceId])).rows[0].n,3);
 await sourceTask(author,'source_revise',{operationId:uuid(),sourceId,expectedRevision:1,blocks:original.blocks.map((b,i)=>i===205?{...b,text:'Correção explícita. '+b.text}:b),reason:'Teste de revisão'});
 const old=await sourceTask(author,'source_locate',{sourceId,sourceRevision:1,elementId:original.blocks[205].id}) as any,newer=await sourceTask(author,'source_locate',{sourceId,sourceRevision:2,elementId:original.blocks[205].id}) as any;
 assert.equal(old.blocks[0].text,original.blocks[205].text);assert.match(newer.blocks[0].text,/^Correção explícita/);
});
