const CACHE_NAME = "pt-bt-helper-v3";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./bt_group2_ko.json",
  "./sample_group2_ko.json",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // ✅ addAll은 하나라도 실패하면 전체 실패 → 개별 add로 변경
    for (const url of CORE_ASSETS) {
      try {
        await cache.add(url);
      } catch (e) {
        // 404가 있어도 설치 자체는 진행되게 둠
        // (manifest 같은 건 환경에 따라 404가 날 수 있음)
      }
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      // 같은 origin의 GET만 캐시
      if (req.method === "GET" && new URL(req.url).origin === location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      // 오프라인 fallback
      return cached || new Response("offline", { status: 200 });
    }
  })());
});
