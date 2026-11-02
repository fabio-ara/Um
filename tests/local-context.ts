import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {authenticate} from '../src/auth.ts';
import {pool} from '../src/db.ts';
import type {Identity} from '../src/contracts.ts';
export async function localContext(){
 assert.equal(process.env.APP_MODE,'local','Integração exige a instância local Um.');
 const url=new URL(process.env.MIGRATION_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'57432');assert.equal(url.pathname,'/um');
 const admin=new pg.Client({connectionString:url.href});await admin.connect();const identities:Identity[]=[];
 async function account(){const response=await fetch('http://127.0.0.1:4418/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`um-synthetic-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')})});assert.equal(response.status,200);const auth=await response.json() as any;const identity=await authenticate(`Bearer ${auth.access_token}`);identities.push(identity);return identity;}
 async function close(){for(const i of identities){await admin.query('delete from um.projects where owner_id=$1',[i.id]);await admin.query('delete from um.profiles where creator_id=$1 or holder_id=$1',[i.id]);await admin.query('delete from um.sources where owner_id=$1',[i.id]);await admin.query('delete from um.files where owner_id=$1',[i.id]);await admin.query('delete from auth.users where id=$1',[i.id]);}await admin.end();await pool.end();}
 return {account,admin,close};
}
