/*
 * Hospital PAMS offline helper (wave 39). Deliberately small: it keeps the My jobs page and the app's built files so
 * a technician can open My jobs without signal. Every other request goes to the network as usual. The jobs and the
 * queue of changes live in IndexedDB (see src/lib/offline/store.ts), not here.
 */
const CACHE = "hpams-offline-v1";
const PAGES = ["/assets/my-jobs"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("hpams-offline-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Built files have a content hash in their name: the cached copy is always right.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // My jobs: the network first (fresh jobs); without signal, the last copy.
  if (req.mode === "navigate" && PAGES.includes(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        // Only a real page: not the sign-in page a redirect leads to.
        if (res.ok && !res.redirected) await c.put(url.pathname, res.clone());
        return res;
      } catch {
        const hit = await c.match(url.pathname);
        return hit ?? new Response("You are offline and My jobs has not been opened on this phone yet. Open it once with signal.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});

self.addEventListener("message", (e) => {
  // Signing out clears the kept page, so the next person on a shared phone doesn't see it.
  if (e.data === "hpams-clear") e.waitUntil(caches.delete(CACHE));
  // The first visit happens before the worker is in charge: the page sends what it loaded so it can be kept.
  if (e.data && e.data.type === "hpams-keep") e.waitUntil(keep(e.data.page, e.data.files));
});

async function keep(page, files) {
  const c = await caches.open(CACHE);
  if (PAGES.includes(page)) {
    try {
      const res = await fetch(page, { credentials: "same-origin" });
      if (res.ok && !res.redirected) await c.put(page, res);
    } catch { /* offline */ }
  }
  for (const f of Array.isArray(files) ? files.slice(0, 300) : []) {
    try {
      const u = new URL(f, self.location.origin);
      if (u.origin !== self.location.origin || !u.pathname.startsWith("/_next/static/") || (await c.match(u.href))) continue;
      const res = await fetch(u.href);
      if (res.ok) await c.put(u.href, res);
    } catch { /* skip */ }
  }
}
