import {isPublishableKey} from './public-key.ts';
const local=process.env.APP_MODE==='local';
const supabase=process.env.SUPABASE_URL;
const publishable=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
if(!local&&publishable&&!isPublishableKey(publishable))throw Error('Configuração exige uma chave pública do Supabase.');
export const config = {
  name: 'Um', version: '0.1.0', local,
  port: Number(process.env.PORT || 4417),
  origin: process.env.APP_ORIGIN || (local?'http://127.0.0.1:4419':'https://fabio-ara.github.io/Um/'),
  apiOrigin: process.env.API_ORIGIN || (supabase?supabase+'/functions/v1/um-api':'http://127.0.0.1:4417'),
  authUrl: process.env.AUTH_URL || (supabase?supabase+'/auth/v1':'http://127.0.0.1:4418'),
  issuer: process.env.AUTH_ISSUER || (supabase?supabase+'/auth/v1':'http://127.0.0.1:4417/auth/v1'),
  database: process.env.DATABASE_URL||process.env.SUPABASE_DB_URL,
  storageUrl: supabase,
  storageKey: publishable,
  bucket: 'um-private',
};
