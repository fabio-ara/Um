import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {authenticate} from '../src/auth.ts';
import {profileTask} from '../src/profiles.ts';
import {pool,transaction,operation} from '../src/db.ts';
import type {Identity} from '../src/contracts.ts';

assert.equal(process.env.APP_MODE,'local','Integração exige a instância local Um.');
const admin=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
await admin.connect();
const identities:Identity[]=[];
async function account():Promise<Identity>{
 const credentials={email:`um-synthetic-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')};
 const response=await fetch('http://127.0.0.1:4418/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});
 assert.equal(response.status,200,'GoTrue real deve criar identidade sintética.');
 const auth=await response.json() as any;
 const identity=await authenticate(`Bearer ${auth.access_token}`);identities.push(identity);return identity;
}
after(async()=>{
 // Fixtures are owned by this run. Keep cleanup limited to IDs we created.
 for(const identity of identities){await admin.query('delete from um.profiles where creator_id=$1 or holder_id=$1',[identity.id]);await admin.query('delete from auth.users where id=$1',[identity.id]);}
 await admin.end();await pool.end();
});
const op=()=>randomUUID();
test('convite real, campos parciais e revogação imediata com RLS',async()=>{
 const author=await account(),holder=await account(),stranger=await account();
 const created=await profileTask(author,'profile_create',{operationId:op(),fields:{name:'Perfil sintético',purpose:'Estudo'}}) as any;
 const profileId=created.result.profileId;
 await assert.rejects(profileTask(stranger,'profile_get',{profileId}),/indisponível/);
 const invited=await profileTask(author,'invite_create',{operationId:op(),profileId}) as any;
 await profileTask(holder,'invite_accept',{operationId:op(),token:invited.result.token});
 await assert.rejects(profileTask(stranger,'invite_accept',{operationId:op(),token:invited.result.token}),/INVALID_INVITE/);
 await profileTask(author,'profile_update',{operationId:op(),profileId,fields:{purpose:'Leitura'}});
 await profileTask(holder,'profile_update',{operationId:op(),profileId,fields:{name:'Mesmo nome não é autenticação'}});
 const p=await profileTask(holder,'profile_get',{profileId}) as any;
 assert.equal(p.fields.purpose,'Leitura');assert.equal(p.fields.name,'Mesmo nome não é autenticação');
 // Raw SQL cannot change ACL via ordinary UPDATE privileges.
 await assert.rejects(transaction(author,db=>db.query('update um.profiles set holder_id=$1 where id=$2',[author.id,profileId])),/permission denied/);
 await profileTask(holder,'profile_control',{operationId:op(),profileId,action:'revoke_creator'});
 await assert.rejects(profileTask(author,'profile_update',{operationId:op(),profileId,fields:{name:'Recuperar acesso'}}),/indisponível/);
 await assert.rejects(profileTask(author,'profile_get',{profileId}),/indisponível/);
 const raw=await transaction(author,db=>db.query('select id from um.profiles where id=$1',[profileId]));assert.equal(raw.rowCount,0);
 const exported=await profileTask(holder,'profile_export',{profileId}) as any;assert.equal(exported.profile.id,profileId);
 await profileTask(holder,'profile_control',{operationId:op(),profileId,action:'delete'});
 await assert.rejects(profileTask(holder,'profile_get',{profileId}),/indisponível/);
});
test('resposta perdida após commit recupera recibo e rejeita intenção diferente',async()=>{
 const actor=await account(),operationId=op();let count=0;
 const write=()=>transaction(actor,db=>operation(db,actor,operationId,'synthetic',{v:1},async()=>({count:++count})));
 await write(); // response deliberately ignored after the real commit
 assert.equal((await write()).result.count,1);assert.equal(count,1);
 await assert.rejects(transaction(actor,db=>operation(db,actor,operationId,'synthetic',{v:2},async()=>({count:++count}))),/outra intenção/);
 const other=await account();assert.equal((await transaction(other,db=>db.query('select * from um.operations where id=$1',[operationId]))).rowCount,0);
});
test('sessão revogada é negada apesar de JWT previamente válido',async()=>{
 const actor=await account();await admin.query('delete from auth.sessions where id=$1 and user_id=$2',[actor.sessionId,actor.id]);
 await assert.rejects(profileTask(actor,'profile_list',{}),/revogada/);
});
