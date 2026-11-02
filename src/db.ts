import process from 'node:process';
// Transação com papel/claims por requisição, adaptada de AraRead (MIT).
// @deno-types="npm:@types/pg@8.15.5"
import pg from 'pg';
import {createHash} from 'node:crypto';
import type {Identity, Receipt} from './contracts.ts';
import {config} from './config.ts';
import {ensure} from './errors.ts';
const ca = process.env.DATABASE_CA_CERT;
const url = config.database ? new URL(config.database) : null;
if (url && ca) for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) url.searchParams.delete(key);
export const pool = new pg.Pool({connectionString: url?.href, ssl: ca ? {ca, rejectUnauthorized: true} : undefined, max: 4, application_name: 'um', connectionTimeoutMillis: 5000});
pool.on('error', () => console.error('{"event":"database_idle_error"}'));
export type Transaction = pg.PoolClient;
export async function transaction<T>(identity: Identity, fn: (db: Transaction) => Promise<T>): Promise<T> {
  ensure(config.database, 'CONFIGURATION', 'Banco do Um não configurado.', 503);
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('statement_timeout','12000',true)", [JSON.stringify({sub: identity.id, session_id: identity.sessionId, client_id: identity.clientId}),identity.id]);
    const valid = await db.query('select um.session_valid() as valid');
    ensure(valid.rows[0]?.valid, 'UNAUTHENTICATED', 'Sessão revogada.', 401);
    if (identity.clientId) {
      const grant = await db.query('select permission from um.client_grants where account_id=$1 and client_id=$2', [identity.id, identity.clientId]);
      ensure(grant.rowCount, 'FORBIDDEN', 'Cliente sem autorização vigente para o Um.', 403);
      // A later grant upgrade must not elevate an already issued read token.
      if(grant.rows[0].permission==='read')identity.permission='read';
    }
    const result = await fn(db);
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,ordered(v)]));
  return value;
}
export const contentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(ordered(value))??'null').digest('hex');
/** Replay before external preparation; callers must still authorize the referenced scope. */
export async function priorOperation<T>(db: Transaction, identity: Identity, operationId: string, task: string, args: unknown): Promise<Receipt<T>|null> {
  ensure(identity.permission === 'write', 'FORBIDDEN', 'Cliente autorizado somente para leitura.', 403);
  const prior = await db.query('select intent, result, committed_at from um.operations where account_id=$1 and id=$2', [identity.id, operationId]);
  if (!prior.rowCount) return null;
  ensure(prior.rows[0].intent === contentHash({task,args}), 'CONFLICT', 'Identificador já usado para outra intenção.', 409);
  return {operationId, status:'confirmed', result:prior.rows[0].result, committedAt:prior.rows[0].committed_at.toISOString()};
}
/** fn returns only object IDs/revisions. Sensitive content must be read through fresh authorization. */
export async function operation<T>(db: Transaction, identity: Identity, operationId: string, task: string, args: unknown, fn: () => Promise<T>): Promise<Receipt<T>> {
  ensure(identity.permission === 'write', 'FORBIDDEN', 'Cliente autorizado somente para leitura.', 403);
  const intent = contentHash({task,args});
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`${identity.id}:${operationId}`]);
  const prior = await priorOperation<T>(db,identity,operationId,task,args);
  if (prior) return prior;
  const result = await fn();
  const saved = await db.query('insert into um.operations(account_id,id,task,intent,result) values($1,$2,$3,$4,$5) returning committed_at', [identity.id,operationId,task,intent,JSON.stringify(result)]);
  return {operationId,status:'confirmed',result,committedAt:saved.rows[0].committed_at.toISOString()};
}
