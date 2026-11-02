import {ensure} from './errors.ts';
/** Restrict the normalized destination, never the unparsed incoming spelling. */
export function authProxyUrl(originalUrl:string,authUrl:string):URL {
 const incoming=new URL(originalUrl,'http://local');
 const base=new URL(authUrl);
 ensure(incoming.pathname.startsWith('/auth/v1/'),'FORBIDDEN','Rota de autenticação inválida.',403);
 const path=incoming.pathname.slice('/auth/v1'.length);
 ensure(!/%(?:2f|5c|25)/i.test(path),'FORBIDDEN','Rota de autenticação inválida.',403);
 const allowed=new Set(['token','signup','logout','user','recover','verify','resend','settings','health','authorize','callback','reauthenticate','factors']);
 ensure(allowed.has(decodeURIComponent(path.split('/')[1]||'')),'FORBIDDEN','Rota de administração não exposta.',403);
 const destination=new URL(base.href.replace(/\/$/,'')+path+incoming.search);
 ensure(destination.origin===base.origin,'FORBIDDEN','Destino de autenticação inválido.',403);return destination;
}
