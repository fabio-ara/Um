import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {localContext} from './local-context.ts';
import {config} from '../src/config.ts';
import {transaction} from '../src/db.ts';
import {execute} from '../src/service.ts';
import {putFile,getFile,deleteQueuedFile,scanAbandonedFiles} from '../src/files.ts';
import {fileRow} from '../src/sources.ts';

// Explicit opt-in: this is real Storage HTTP + local Auth/Postgres, not a stub.
// The loopback gateway only supplies Supabase's /storage/v1 path prefix. A single
// injected 503 proves retry behavior; all successful requests reach Storage API.
test('Storage real separa leitura de remoção, preserva comum e limpa órfãos com confirmação física',{skip:process.env.UM_STORAGE_PROOF!=='1'},async()=>{
 const ctx=await localContext(),saved={local:config.local,storageUrl:config.storageUrl,storageKey:config.storageKey};let failRemoval=false;
 const gateway=createServer(async(req,res)=>{try{if(!req.url?.startsWith('/storage/v1/')){res.writeHead(404).end();return;}if(req.method==='DELETE'&&failRemoval){failRemoval=false;res.writeHead(503,{'content-type':'application/json'}).end('{"message":"synthetic interruption"}');return;}const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const headers=new Headers();for(const key of ['authorization','content-type','x-upsert','cache-control'])if(req.headers[key])headers.set(key,String(req.headers[key]));const response=await fetch('http://127.0.0.1:4422'+req.url.slice('/storage/v1'.length),{method:req.method,headers,body:['GET','HEAD'].includes(req.method!)?undefined:Buffer.concat(chunks)});res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/octet-stream'});res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(502).end();}});
 gateway.listen(4423,'127.0.0.1');await once(gateway,'listening');config.local=false;config.storageUrl='http://127.0.0.1:4423';config.storageKey='local-publishable-placeholder';
 const call=(actor:any,name:any,args:any)=>execute(name,args,actor) as Promise<any>;
 const client=(actor:any)=>createClient(config.storageUrl!,config.storageKey!,{global:{headers:{Authorization:'Bearer '+actor.accessToken}},auth:{persistSession:false,autoRefreshToken:false}}).storage.from(config.bucket);
 let completed=false;
 try{
  const author=await ctx.account(),holder=await ctx.account(),stranger=await ctx.account();
  const profileId=(await call(author,'profile_create',{operationId:uuid(),fields:{name:'Storage sintético'}})).result.profileId;
  const invitation=await call(author,'invite_create',{operationId:uuid(),profileId});await call(holder,'invite_accept',{operationId:uuid(),token:invitation.result.token});
  const projectId=(await call(author,'project_create',{operationId:uuid(),title:'Storage real',metadata:{object:{kind:'theme',workIds:[],subject:'Fixture'},scope:'Fixture própria',language:'pt',audience:'Sintético',configuration:{editorial:{},instructional:{}}}})).result.projectId;
  await call(author,'participation_add',{operationId:uuid(),projectId,profileId});
  assert.ok((await client(author).upload(`${stranger.id}/${uuid()}`,Buffer.from('negado'))).error);
  const personal=await putFile(author,Buffer.from('Pessoal via Storage real'),'text/plain'),common=await putFile(author,Buffer.from('Comum intacto'),'text/plain'),orphan=await putFile(author,Buffer.from('Upload sem registro'),'text/plain');
  const physical=()=>execFileSync('docker',['exec','um-storage','find','/var/lib/storage','-type','f'],{encoding:'utf8'});
  for(const file of [personal,common,orphan])assert.ok(physical().includes('/'+file.path+'/'));
  assert.ok((await client(author).download(personal.path)).error);
  await transaction(author,async db=>{await fileRow(db,author,personal,{projectId,profileId},true);await fileRow(db,author,common,{projectId},true);});
  assert.equal((await getFile(holder,personal.path)).toString(),'Pessoal via Storage real');
  assert.ok((await client(stranger).download(personal.path)).error);assert.ok((await client(holder).createSignedUrl(personal.path,60)).error);
  await client(stranger).remove([personal.path]);assert.equal((await getFile(holder,personal.path)).toString(),'Pessoal via Storage real');
  await call(holder,'profile_control',{operationId:uuid(),profileId,action:'revoke_creator'});
  assert.ok((await client(author).download(personal.path)).error);assert.equal((await getFile(holder,personal.path)).toString(),'Pessoal via Storage real');
  await ctx.admin.query("begin; set local session_replication_role=replica");try{await ctx.admin.query("update storage.objects set updated_at=now()-interval '2 days' where bucket_id='um-private' and name=any($1)",[[orphan.path,personal.path,common.path]]);await ctx.admin.query("commit");}catch(e){await ctx.admin.query("rollback");throw e;}
  const scan=await scanAbandonedFiles(author,'',100);assert.equal(scan.enqueued,1);await deleteQueuedFile(author,orphan.path);
  assert.equal((await ctx.admin.query("select 1 from storage.objects where bucket_id='um-private' and name=$1",[orphan.path])).rowCount,0);
  await call(holder,'profile_control',{operationId:uuid(),profileId,action:'delete'});
  assert.ok((await client(holder).download(personal.path)).error);assert.ok((await client(holder).createSignedUrl(personal.path,60)).error);
  await assert.rejects(transaction(holder,db=>db.query('update um.file_deletions set completed_at=now() where path=$1',[personal.path])),/FILE_REMOVAL_PENDING/);
  failRemoval=true;const interrupted=await call(holder,'data_cleanup',{operationId:uuid()});assert.equal(interrupted.result.removed,0);assert.equal(interrupted.result.pending,1);
  const cleaned=await call(holder,'data_cleanup',{operationId:uuid()});assert.equal(cleaned.result.removed,1);assert.equal(cleaned.result.pending,0);
  assert.equal((await ctx.admin.query("select 1 from storage.objects where bucket_id='um-private' and name=$1",[personal.path])).rowCount,0);
  assert.ok((await client(author).upload(personal.path,Buffer.from('não reciclar'))).error);
  assert.equal((await getFile(author,common.path)).toString(),'Comum intacto');
  await transaction(author,db=>db.query('delete from um.files where path=$1',[common.path]));await deleteQueuedFile(author,common.path);
  assert.equal((await ctx.admin.query("select count(*)::int n from storage.objects where bucket_id='um-private' and name=any($1)",[[personal.path,common.path,orphan.path]])).rows[0].n,0);
  for(const file of [personal,common,orphan])assert.ok(!physical().includes('/'+file.path+'/'));
  completed=true;
 }finally{
  Object.assign(config,saved);gateway.closeAllConnections();await new Promise<void>(resolve=>gateway.close(()=>resolve()));
  // On failure, preserve the synthetic fixture for diagnosis instead of deleting
  // its authorization metadata and stranding real Storage bytes.
  if(completed)await ctx.close();else{await ctx.admin.end();const {pool}=await import('../src/db.ts');await pool.end();}
 }
});
