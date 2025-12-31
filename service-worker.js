const CACHE = "bt-helper-v1";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest"
];

// 설치 시 핵심 파일만 캐시
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// fetch: 기본은 네트워크 우선, 실패하면 캐시
self.addEventListener("fetch", (event) => {
  const req = event.request;

  event.respondWith(
    fetch(req).then(res => {
      // DB 파일 등도 런타임 캐시에 저장
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
