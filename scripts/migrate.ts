import pg from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(process.env.APP_MODE!=='local')throw Error('Este executor só migra a instância local. Promoção remota tem gate próprio.');
const url = new URL(process.env.MIGRATION_DATABASE_URL || '');
if(url.hostname!=='127.0.0.1'||url.port!=='57432'||url.pathname!=='/um')throw Error('Alvo não é a instância local Um.');
const db=new pg.Client({connectionString:url.href});await db.connect();
try {
  await db.query('create schema if not exists um; create table if not exists um.schema_migrations(name text primary key,sha256 text not null)');
  for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){
    const sql=await readFile(`supabase/migrations/${name}`,'utf8'),hash=createHash('sha256').update(sql).digest('hex');
    const prior=await db.query('select sha256 from um.schema_migrations where name=$1',[name]);
    if(prior.rowCount){if(prior.rows[0].sha256!==hash)throw Error(`Migração aplicada mudou: ${name}`);continue;}
    await db.query('begin');
    try {await db.query(sql);await db.query('insert into um.schema_migrations values($1,$2)',[name,hash]);await db.query('commit');console.log(`Aplicada: ${name}`);}
    catch(e){await db.query('rollback');throw e;}
  }
}finally{await db.end();}
