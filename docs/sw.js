const CACHE="undertone-web-v1";
const SHELL=["./","./index.html","./player.css","./library.css","./mini.css","./web.css","./lyric-fonts.css","./player.js","./library.js","./timing.js","./web.js","./config.js","./spotify.js","./lyrics.js","./InterVariable.woff2","./demo-cover.svg","./icon.svg","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("undertone-web-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  // Only public app assets are cached. Spotify requests, OAuth codes and tokens never enter Cache Storage.
  if(event.request.method!=="GET" || url.origin!==self.location.origin)return;
  if(event.request.mode==="navigate") {
    event.respondWith(fetch(event.request).catch(()=>caches.match(new URL("./index.html",self.registration.scope))));return;
  }
  if(url.search)return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    try {const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}
    catch {return await cache.match(event.request) || new Response("Offline",{status:503});}
  }));
});
