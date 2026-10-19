// A.M Chan phone app: keeps the app's own files so it opens instantly and even with no connection.
// Nothing about her answers or your chats is ever stored here (those requests always go to the network).
const CACHE = 'am-app-v2';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/app.js', '/app/manifest.webmanifest', '/app/icon-192.png', '/app/icon-512.png', '/app/apple-touch-icon.png', '/img/face.png', '/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) return; // the hub's API is never cached
  // show the saved copy at once and refresh it in the background, so updates arrive on the next open
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(req).then((res) => {
          if (res.ok) c.put(req, res.clone());
          return res;
        });
        return hit || fresh;
      })
    ).catch(() => fetch(req))
  );
});
