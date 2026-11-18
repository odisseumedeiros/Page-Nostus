// sw.js — Cache-First: o app inteiro é local (sem CDN), então abre e funciona 100% offline.
// As chamadas à API do GitHub (outro domínio) nunca passam por aqui.
// Ao alterar qualquer arquivo do app, incremente VERSION para forçar a atualização do cache.
const VERSION = 'fp-v10';
const LOCAL = ['./', 'index.html', 'styles.css', 'chart.umd.min.js', 'app.js', 'db.js', 'github-sync.js', 'manifest.json'];
const OPT = ['ic-financas-180.png', 'ic-financas-192.png', 'ic-financas-512.png', 'ic-nostos-180.png', 'ic-nostos-192.png', 'ic-nostos-512.png']; // ícones: não bloqueiam a instalação se faltar algum

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  await c.addAll(LOCAL);
  await Promise.allSettled(OPT.map(u => c.add(u)));
  self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(r, cp)); }
      return res;
    }).catch(() => r.mode === 'navigate' ? caches.match('index.html') : undefined))
  );
});
