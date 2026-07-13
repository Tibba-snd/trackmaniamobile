const CACHE_NAME = 'driftdream-v5';
const ASSETS = [
  './',
  './index.html',
  './icon.png',
  './manifest.json',
  './js/core.js',
  './js/theme.js',
  './js/trackgen.js',
  './js/physics.js',
  './js/audio.js',
  './js/input.js',
  './js/carspec.js',
  './js/scene-core.js',
  './js/scene-decor.js',
  './js/scene-car.js',
  './js/scene-fx.js',
  './js/game.js',
  './js/physdev.js',
  './js/perfhud.js',
  './js/lib/three.min.js',
  './js/lib/CopyShader.js',
  './js/lib/LuminosityHighPassShader.js',
  './js/lib/EffectComposer.js',
  './js/lib/ShaderPass.js',
  './js/lib/MaskPass.js',
  './js/lib/RenderPass.js',
  './js/lib/UnrealBloomPass.js',
  './js/lib/FXAAShader.js'
];

// Cache each asset individually so one 404 doesn't poison the whole cache.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        cache.add(url).catch((err) => console.warn('[sw] cache miss:', url, err && err.message))
      ))
    ).then(() => self.skipWaiting())
  );
});

// Drop caches from older SW versions.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// NETWORK-FIRST, cache fallback. The previous cache-first strategy froze installed PWAs on
// whatever build they first cached — updates only arrived on a manual CACHE_NAME bump, which
// is exactly the kind of per-release discipline that gets forgotten (and was). Online users
// now always get the freshest build; the cache exists purely for offline launches.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) {
    return;
  }
  const reqUrl = new URL(e.request.url);
  // Store same-origin responses under a search-less key (game.js, not game.js?v=76) so each
  // path has exactly ONE cache entry — always the freshest — and the ignoreSearch fallback
  // below can never race an old ?v= duplicate.
  const bareKey = reqUrl.origin === location.origin ? reqUrl.origin + reqUrl.pathname : null;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok && bareKey) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(bareKey, clone));
      }
      return res;
    }).catch(() =>
      // Offline: ignoreSearch so ?v= requests match the bare-key entries.
      caches.match(e.request, { ignoreSearch: true })
    )
  );
});
