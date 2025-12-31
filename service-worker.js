/* GitHub Pages(서브경로)에서도 깨지지 않는 Service Worker */

const CACHE_NAME = "pt-bt-cache-v3";

function assetUrl(relPath) {
  // registration.scope 예: https://yedo...github.io/pt-battle-tower-helper/
  const scope = new URL(self.registration.scope);
  // scope.pathname 예: /pt-battle-tower-helper/
  return new URL(relPath, scope).toString();
}

const ASSETS = [
  assetUrl("./"),
  assetUrl("./index.html"),
  assetUrl("./styles.css"),
  assetUrl("./app.js"),
  assetUrl("./manifest.webmanifest"),
  // DB 위치에 따라 둘 중 하나만 남겨도 됨
  assetUrl("./bt_group2_ko.json"),
  assetUrl("./data/bt_group2_ko.json")
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // navigation(페이지) 요청은 index.html로 fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(assetUrl("./index.html")))
    );
    return;
  }

  // 그 외는 캐시 우선
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
