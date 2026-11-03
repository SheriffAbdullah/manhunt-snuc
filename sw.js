// Bump VERSION whenever a shell file changes so old caches are dropped.
const VERSION = "v6";
const CACHE = `manhunt-${VERSION}`;
const SHELL = ["./", "index.html", "styles.css", "app.js", "ui.js", "core.js", "device.js", "game.js", "config.js", "mapview.js", "editor.js", "sync.js", "maps.json", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest", "vendor/qrcode.min.js"];
// Leaflet is needed to draw the map offline. Cached best-effort: a failed CDN fetch must not block install.
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await Promise.allSettled(CDN.map((u) => fetch(u, { mode: "cors" }).then((r) => (r.ok ? c.put(u, r) : null))));
  })());
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  // Leaflet from the CDN: cache first, it never changes for a pinned version.
  if (CDN.includes(url)) {
    e.respondWith(caches.match(url).then((m) => m || fetch(e.request).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(url, r.clone())); return r; })));
    return;
  }
  const u = new URL(url);
  if (u.origin !== location.origin) return; // never cache map tiles or the sync API
  if (u.pathname.includes("/v1/")) return; // sync API on the same origin: live data, never cached
  // Same-origin shell: network first so edits go live, cache as offline fallback.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())));
});
