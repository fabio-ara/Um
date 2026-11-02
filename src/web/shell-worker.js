// Generated VERSION/FILES identify one complete public application build.
// No API responses, tokens or private study content enter CacheStorage.
const ROOT=new URL('.',self.location.href),PREFIX='um-shell:'+ROOT.pathname+':',CACHE=PREFIX+VERSION;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{await cache.addAll(FILES.map(path=>new Request(new URL(path,ROOT),{cache:'reload'})));}
 catch(error){await caches.delete(CACHE);throw error;}
 // Keep active tabs on their current shell; activate when the old tabs close.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname)||url.search||event.request.headers.has('authorization'))return;
 let path=url.pathname.slice(ROOT.pathname.length);if(!path)path='index.html';
 if(!FILES.includes(path))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(new URL(path,ROOT))||fetch(event.request);})());
});
