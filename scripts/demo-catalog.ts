/** Local-only catalog rehearsal. Explicit source references accompany every historical claim. */
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {entitySchema,relationSchema} from '../src/catalog.ts';
import {ensure} from '../src/errors.ts';
import {pool} from '../src/db.ts';
const url=new URL(process.env.MIGRATION_DATABASE_URL!);ensure(process.env.APP_MODE==='local'&&url.hostname==='127.0.0.1'&&url.port==='57432'&&url.pathname==='/um','LOCAL_ONLY','Catálogo demonstrativo somente local.');
const catalog=JSON.parse(await readFile('fixtures/catalog.json','utf8'));const db=new pg.Client({connectionString:url.href});await db.connect();
try{await db.query('begin');for(const [kind,items,schema]of [['entity',catalog.entities,entitySchema],['relation',catalog.relations,relationSchema]] as const)for(const item of items){const data=schema.parse(item);await db.query('insert into um.catalog(id,account_id,kind,revision,data) values($1,null,$2,1,$3) on conflict(id,account_id) do update set data=excluded.data,revision=um.catalog.revision+1 where um.catalog.data is distinct from excluded.data',[data.id,kind,JSON.stringify(data)]);}await db.query('commit');console.log('Catálogo demonstrativo local reconciliado.');}catch(e){await db.query('rollback');throw e;}finally{await db.end();await pool.end();}
