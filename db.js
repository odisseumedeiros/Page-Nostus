// db.js — Camada local-first sobre IndexedDB.
// Toda leitura/escrita da UI passa por aqui. Cada registro tem `lastModified`;
// exclusões são "soft delete" (deleted:true) para que a exclusão também sincronize.
const NAME = 'financas_pessoais';
const DATA = ['transactions', 'accounts', 'categories', 'cards', 'holdings', 'goals', 'assets', 'debts', 'snaps']; // stores de dados (vão para o Drive)
let db;

const p = r => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const os = (s, m = 'readonly') => db.transaction(s, m).objectStore(s);
const emit = () => document.dispatchEvent(new Event('db:change'));

export const DB = {
  open() {
    return new Promise((ok, err) => {
      const r = indexedDB.open(NAME, 3);
      r.onupgradeneeded = () => {
        [...DATA, 'syncQueue'].forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
      };
      r.onsuccess = () => { db = r.result; ok(); };
      r.onerror = () => err(r.error);
    });
  },

  raw: s => p(os(s).getAll()),                                   // inclui registros excluídos
  async list(s) { return (await p(os(s).getAll())).filter(x => !x.deleted); },

  // Grava um registro. Se não for "silent": carimba lastModified, enfileira na syncQueue e avisa a UI.
  async put(s, o, silent = false) {
    if (!silent) {
      o.lastModified = Date.now();
      await p(os('syncQueue', 'readwrite').put({ id: s + ':' + o.id, store: s, rid: o.id, ts: o.lastModified }));
    }
    await p(os(s, 'readwrite').put(o));
    if (!silent) emit();
    return o;
  },

  async remove(s, id) {
    const o = await p(os(s).get(id));
    if (o) { o.deleted = true; await this.put(s, o); }
  },

  // ---- fila de sincronização ----
  queue: () => p(os('syncQueue').getAll()),
  async clearQueue(upTo) {
    for (const q of await this.queue()) if (q.ts <= upTo) await p(os('syncQueue', 'readwrite').delete(q.id));
  },
  markDirty: () => p(os('syncQueue', 'readwrite').put({ id: 'manual', store: '*', ts: Date.now() })),

  // ---- snapshot / merge (usado pelo Drive e pelo import/export) ----
  async snapshot() {
    const d = { version: 1, exportedAt: new Date().toISOString() };
    for (const s of DATA) d[s] = await this.raw(s);
    return d;
  },

  // Mescla um snapshot remoto: vence o registro com lastModified mais recente.
  // Retorna { pulled, localNewer } (localNewer = há algo local que o remoto não tem/está desatualizado).
  async merge(remote) {
    let pulled = 0, localNewer = false;
    for (const s of DATA) {
      const loc = new Map((await this.raw(s)).map(x => [x.id, x]));
      const seen = new Set();
      for (const r of remote?.[s] || []) {
        seen.add(r.id);
        const l = loc.get(r.id);
        if (!l || r.lastModified > l.lastModified) { await this.put(s, r, true); pulled++; }
        else if (l.lastModified > r.lastModified) localNewer = true;
      }
      for (const id of loc.keys()) if (!seen.has(id)) localNewer = true;
    }
    if (pulled) emit();
    return { pulled, localNewer };
  }
};
