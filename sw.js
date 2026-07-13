const CACHE_NAME = 'driftdream-v2';
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

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) {
    return;
  }
  // ignoreSearch: index.html loads scripts as game.js?v=74 for browser cache-busting,
  // but the SW caches them bare. Without this the ?v= requests never match and offline
  // launches fail to load any JS.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});
