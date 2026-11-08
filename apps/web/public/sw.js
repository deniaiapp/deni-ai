const STATIC_CACHE = "deni-ai-static-v4";
const PAGE_CACHE = "deni-ai-pages-v1";
const PRECACHE_URLS = [
  "/home",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/pwa/apple-touch-icon.png",
  "/pwa/favicon-32x32.png",
  "/pwa/android-chrome-192x192.png",
  "/pwa/android-chrome-512x512.png",
  "/icon-192x192",
  "/icon-512x512",
  "/og.png",
];
const PUBLIC_PAGE_PREFIXES = [
  "/home",
  "/about",
  "/models",
  "/flixa",
  "/legal",
  "/migration",
  "/shared",
];
const STATIC_DESTINATIONS = new Set(["font", "image", "manifest", "script", "style", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const requests = PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" }));

      await cache.addAll(requests);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Build chunks go to the network (the browser's HTTP cache already keeps them
  // as immutable) and fall back to this cache only offline. Serving them cache
  // first could mix chunks from different deployments in one page, which breaks
  // module imports (e.g. "useRefWithInit is not a function").
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(handleBuildAssetRequest(request));
    return;
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(handleStaticRequest(request));
  }
});

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);

    if (response.ok && isPublicPage(new URL(request.url).pathname)) {
      const cache = await caches.open(PAGE_CACHE);

      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const pageCache = await caches.open(PAGE_CACHE);
    const cachedResponse = await pageCache.match(request, { ignoreSearch: true });

    if (cachedResponse) {
      return cachedResponse;
    }

    return (await caches.match("/home")) ?? Response.error();
  }
}

async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (!response.ok) {
    return response;
  }

  const cache = await caches.open(STATIC_CACHE);

  await cache.put(request, response.clone());

  return response;
}

async function handleBuildAssetRequest(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      // Kept only for offline use, so the page does not wait for the write.
      const copy = response.clone();

      void caches
        .open(STATIC_CACHE)
        .then((cache) => cache.put(request, copy))
        .catch(() => undefined);
    }

    return response;
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}

function isPublicPage(pathname) {
  return PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
