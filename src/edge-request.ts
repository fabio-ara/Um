/** Supabase forwards /functions/v1/<name>/... as /<name>/... to its runtime.
 * Keep the public URL used by routing, OAuth resources and redirects canonical.
 * Only the configured function prefix is translated; unrelated paths stay invalid.
 */
export function edgeRequest(request:Request,apiOrigin:string):Request {
 const base=new URL(apiOrigin),full=base.pathname.replace(/\/$/,''),incoming=new URL(request.url);
 if(!full.startsWith('/functions/v1/'))return request;
 const short=full.slice('/functions/v1'.length);
 let suffix:string;
 if(incoming.pathname===full||incoming.pathname.startsWith(full+'/'))suffix=incoming.pathname.slice(full.length);
 else if(incoming.pathname===short||incoming.pathname.startsWith(short+'/'))suffix=incoming.pathname.slice(short.length);
 else return request;
 base.pathname=full+suffix;base.search=incoming.search;
 return new Request(base,request);
}
