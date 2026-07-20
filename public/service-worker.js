const CACHE_VERSION = 'gymlog-web-v3-20260720';
const APP_SHELL = [
  '/',
  '/gymlog-classic.html',
  '/gymlog-reliability.js',
  '/gymlog-note-templates.js',
  '/manifest.webmanifest',
  '/icons/gym-icon.svg',
  '/icons/gym-logo.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);

  // Authentication, Supabase and Google requests must always go to the network.
  if(url.origin !== self.location.origin || /supabase|googleapis|accounts\.google/i.test(url.hostname)) return;

  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request)
        .then(response => {
          if(response.ok) caches.open(CACHE_VERSION).then(cache => cache.put('/gymlog-classic.html', response.clone()));
          return response;
        })
        .catch(async () => (await caches.match('/gymlog-classic.html')) || caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if(response.ok) caches.open(CACHE_VERSION).then(cache => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    })
  );
});
