// Service worker: offline shell + cache for the heavy runtimes.
// - Pyodide (CDN), Ruff wasm (/vendor), app assets (/_next/static), icons: cache-first.
// - Runner workers and page navigations: network-first, falling back to the last copy, then /offline.html.
const VERSION = "bj-3"; // bump when shell files (icons) change
const SHELL = `${VERSION}-shell`;
const PAGES = "bj-pages"; // cleared on sign-out
const RUNTIME = "bj-runtime"; // kept across versions: Pyodide and Ruff are large

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/offline.html", "/icon.svg", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.endsWith("-shell") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, name = PAGES) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (await caches.match("/offline.html"));
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/pyodide/")) {
    event.respondWith(cacheFirst(request, RUNTIME));
  } else if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/vendor/")) event.respondWith(cacheFirst(request, RUNTIME));
    else if (url.pathname.startsWith("/workers/")) event.respondWith(networkFirst(request, RUNTIME));
    else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) event.respondWith(cacheFirst(request, SHELL));
    else if (request.mode === "navigate") event.respondWith(networkFirst(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "signed-out") caches.delete(PAGES);
});
