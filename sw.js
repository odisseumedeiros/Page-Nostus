// sw.js — Cache-First para assets estáticos (locais + CDN). Chamadas à API do GitHub nunca são interceptadas.
// Ao alterar qualquer arquivo do app, incremente VERSION para forçar a atualização do cache.
const VERSION = 'fp-v6';
const LOCAL = ['./', 'index.html', 'app.js', 'db.js', 'github-sync.js', 'manifest.json'];
const OPT = ['ic-financas-180.png', 'ic-financas-192.png', 'ic-financas-512.png', 'ic-nostos-180.png', 'ic-nostos-192.png', 'ic-nostos-512.png']; // ícones: não bloqueiam a instalação se faltar algum
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  await c.addAll(LOCAL);
  await Promise.allSettled(OPT.map(u => c.add(u)));
  await Promise.allSettled(CDN.map(u => c.add(new Request(u, { mode: 'no-cors' }))));
  self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.origin !== location.origin && !CDN.includes(r.url)) return; // api.github.com passa direto
  e.respondWith(
    caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(r, cp)); }
      return res;
    }).catch(() => r.mode === 'navigate' ? caches.match('index.html') : undefined))
  );
});
