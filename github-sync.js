// github-sync.js — Sincronização push/pull com um arquivo JSON em um repositório PRIVADO do GitHub.
// Usa a Contents API (api.github.com aceita CORS) com um token fine-grained (Contents: Read and write).
// Mesma interface: init, sync, signOut, onStatus, getStatus (+ getCfg/saveCfg).
import { DB } from './db.js';

const KEY = 'gh_cfg';
export const getCfg = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export const saveCfg = c => localStorage.setItem(KEY, JSON.stringify(c));
const ready = c => c.owner && c.repo && c.token;

let lastErr = '', busy = false, timer = null, status = 'signedout';
const subs = [];
const set = s => { status = s; subs.forEach(f => f(s)); };
// status: synced | syncing | offline | auth | signedout | error
export const onStatus = f => subs.push(f);
export const getStatus = () => status;
export const getErr = () => lastErr;

// Base64 com suporte a UTF-8 (acentos)
const b64e = s => {
  const u = new TextEncoder().encode(s); let r = '';
  for (let i = 0; i < u.length; i += 8192) r += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(r);
};
const b64d = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));

const headers = c => ({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
const authErr = () => Object.assign(new Error('auth'), { auth: true });
const url = c => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path || 'financas_pessoais_db.json'}`;

async function gh(c, method, body) {
  const u = method === 'GET' ? `${url(c)}?ref=${encodeURIComponent(c.branch || 'main')}` : url(c);
  const r = await fetch(u, { method, headers: headers(c), cache: 'no-store', body: body && JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) throw authErr();
  return r;
}

export function init() {
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => set('offline'));
  // Cada escrita local agenda um sync (debounce de 20s para não gerar um commit por clique)
  document.addEventListener('db:change', () => { clearTimeout(timer); timer = setTimeout(sync, 20000); });
  set(!ready(getCfg()) ? 'signedout' : navigator.onLine ? 'synced' : 'offline');
  if (ready(getCfg())) sync();
}

export function signOut() { saveCfg({ ...getCfg(), token: '' }); set('signedout'); }

// Fluxo: pull -> merge (mais recente vence) -> push se houver algo local novo ou pendente.
// Se o GitHub recusar o push por conflito (sha desatualizado), refaz o ciclo até 3 vezes.
export async function sync() {
  const c = getCfg();
  if (busy) return;
  if (!navigator.onLine) return set('offline');
  if (!ready(c)) return set('signedout');
  busy = true; set('syncing');
  try {
    const t0 = Date.now();
    let done = false;
    for (let i = 0; i < 3 && !done; i++) {
      let remote = null, sha = null;
      const r = await gh(c, 'GET');
      if (r.status === 200) {
        const j = await r.json();
        if (j.encoding === 'none') throw new Error('Arquivo maior que 1 MB (limite da Contents API)');
        sha = j.sha; remote = JSON.parse(b64d(j.content));
      } else if (r.status === 404) {
        // 404 = arquivo ainda não existe, OU repositório/token incorretos (o GitHub responde 404 nos dois casos)
        const rp = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}`, { headers: headers(c) });
        if (!rp.ok) throw authErr();
      } else throw new Error('HTTP ' + r.status);

      const { localNewer } = await DB.merge(remote);
      const pending = (await DB.queue()).length;
      if (sha && !localNewer && !pending) { done = true; break; }

      const p = await gh(c, 'PUT', {
        message: 'sync ' + new Date().toISOString(),
        content: b64e(JSON.stringify(await DB.snapshot())),
        branch: c.branch || 'main',
        ...(sha ? { sha } : {})
      });
      if (p.status === 409 || p.status === 422) continue; // alguém gravou antes: baixa de novo e mescla
      if (!p.ok) throw new Error('HTTP ' + p.status);
      await DB.clearQueue(t0);
      done = true;
    }
    if (!done) throw new Error('Conflito persistente');
    lastErr = ''; set('synced');
  } catch (e) {
    console.error('sync', e);
    lastErr = e.message === 'Failed to fetch' ? 'sem conexão com o GitHub' : (e.message || String(e));
    set(e.auth ? 'auth' : navigator.onLine ? 'error' : 'offline');
  } finally { busy = false; }
}
