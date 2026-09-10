"use client";

import { useEffect } from "react";

// Registers the installability-only service worker (public/sw.js) --
// no offline caching, see that file. Silently no-ops in browsers
// without SW support instead of throwing.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
