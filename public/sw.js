// Minimal service worker -- installability only, NOT an offline cache.
// This app shows live financial/order data; a cache-first strategy on
// any real data route would risk someone viewing stale figures while
// believing them current. So: no Cache API use, no offline fallback --
// every fetch is simply handed straight to the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through handler. A controlling SW with a fetch handler is still
// how some installability checks (and older Chromium heuristics) detect
// a genuine PWA -- this satisfies that without caching anything.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
