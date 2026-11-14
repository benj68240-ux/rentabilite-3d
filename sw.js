var CACHE_NAME = "ab-rentabilite-v18";
var CORE_ASSETS = [
  "./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./brand-banner.jpg",
  "./fonts/Inter-Regular.woff2", "./fonts/Inter-Medium.woff2",
  "./fonts/Inter-SemiBold.woff2", "./fonts/Inter-Bold.woff2"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Réseau d'abord (pour toujours servir la dernière version déployée),
// repli sur le cache si hors ligne.
// cache "no-cache" : le téléphone redemande au serveur si la page a changé au lieu de garder
// jusqu'à 10 min la copie mise en mémoire par GitHub Pages (max-age=600) (Benjamin, 11/11/2026).
// Une navigation ne peut pas être recopiée avec des options : on la refait à partir de son adresse.
function freshFetch(request) {
  if (request.mode === "navigate") return fetch(request.url, { cache: "no-cache", credentials: "same-origin" });
  return fetch(request, { cache: "no-cache" });
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    freshFetch(event.request)
      .then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return response;
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match("./index.html");
        });
      })
  );
});

