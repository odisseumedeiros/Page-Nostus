// app.js — UI, regras de negócio e orquestração (db.js + github-sync.js).
import { DB } from './db.js';
import * as Sync from './github-sync.js';

/* ================= Utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fdate = d => d.split('-').reverse().join('/');                       // AAAA-MM-DD -> DD/MM/AAAA
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const nowDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const addMonths = (d, n) => {                                              // soma meses preservando o fim de mês
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(y, m + n, 0).getDate();
  const t = new Date(y, m - 1 + n, Math.min(day, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const download = (name, data, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const fld = (label, html) => `<label class="block text-sm"><span class="text-slate-500">${label}</span>${html}</label>`;

/* ================= Estado e seeds ================= */
const S = { tx: [], acc: [], cat: [], card: [], hold: [], goal: [], asset: [], debt: [], snap: [], ftype: '', fcat: '', sub: 'geral', view: 'dashboard', month: nowDate().slice(0, 7), charts: [] };
const NAV = [['dashboard', 'grid', 'Dashboard', 'MENU PRINCIPAL'], ['cards', 'card', 'Cartões', 'MENU PRINCIPAL'], ['transfers', 'swap', 'Transferências', 'MENU PRINCIPAL'], ['transactions', 'list', 'Transações', 'MENU PRINCIPAL'], ['payments', 'calendar', 'Pagamentos', 'MENU PRINCIPAL'], ['investments', 'trending', 'Investimentos', 'MENU PRINCIPAL'], ['settings', 'sliders', 'Configurações', 'SISTEMA']];
const bnav = () => { try { const v = JSON.parse(localStorage.bnav); if (Array.isArray(v)) { const f = v.filter(x => NAV.some(n => n[0] === x)); if (f.length >= 2) return f; } } catch {} return ['dashboard', 'investments', 'payments', 'settings']; };
// IDs fixos nas categorias padrão evitam duplicatas ao sincronizar vários dispositivos.
const CATS = [
  ['moradia', 'Moradia', 'home', '#6366f1', 'expense'], ['alimentacao', 'Alimentação', 'utensils', '#f59e0b', 'expense'],
  ['transporte', 'Transporte', 'car', '#0ea5e9', 'expense'], ['lazer', 'Lazer', 'gamepad', '#ec4899', 'expense'],
  ['saude', 'Saúde', 'heart', '#ef4444', 'expense'], ['educacao', 'Educação', 'book', '#8b5cf6', 'expense'],
  ['outros_d', 'Outros', 'package', '#64748b', 'expense'], ['salario', 'Salário', 'banknote', '#10b981', 'income'],
  ['investimentos', 'Investimentos', 'trending', '#14b8a6', 'income'], ['outros_r', 'Outras receitas', 'plus', '#84cc16', 'income']
];

async function seed() {
  if (!(await DB.raw('categories')).length)
    for (const c of CATS) await DB.put('categories', { id: 'cat_' + c[0], name: c[1], icon: c[2], color: c[3], type: c[4], lastModified: 1 }, true);
  if (!(await DB.raw('accounts')).length)
    await DB.put('accounts', { id: 'acc_carteira', name: 'Carteira', type: 'Carteira', initial: 0, lastModified: 1 }, true);
}
async function load() {
  [S.tx, S.acc, S.cat, S.card, S.hold, S.goal, S.asset, S.debt, S.snap] = await Promise.all(['transactions', 'accounts', 'categories', 'cards', 'holdings', 'goals', 'assets', 'debts', 'snaps'].map(s => DB.list(s)));
}

/* ================= Cálculos ================= */
/* ================= Ícones (SVG de traço, estilo Lucide) ================= */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  trending: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  bank: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  gamepad: '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  shopping: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>'
};
const ic = (n, c = 'w-5 h-5') => `<svg class="${c} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.tag}</svg>`;
const CATIC = [['home', 'Casa'], ['utensils', 'Alimentação'], ['car', 'Transporte'], ['gamepad', 'Lazer'], ['heart', 'Saúde'], ['book', 'Educação'], ['package', 'Outros'], ['banknote', 'Salário'], ['shopping', 'Compras'], ['zap', 'Contas de consumo'], ['gift', 'Presentes'], ['trending', 'Investimentos'], ['wallet', 'Carteira'], ['tag', 'Etiqueta']];
const DEFIC = { cat_moradia: 'home', cat_alimentacao: 'utensils', cat_transporte: 'car', cat_lazer: 'gamepad', cat_saude: 'heart', cat_educacao: 'book', cat_outros_d: 'package', cat_salario: 'banknote', cat_investimentos: 'trending', cat_outros_r: 'plus' };
const catIc = c => ICONS[c.icon] ? c.icon : DEFIC[c.id] || 'tag';
const cat = id => { const c = S.cat.find(x => x.id === id); return c ? { ...c, icon: `<span style="color:${c.color}">${ic(catIc(c), 'w-5 h-5')}</span>` } : { name: '—', icon: ic('tag'), color: '#94a3b8' }; };
const accName = id => S.acc.find(a => a.id === id)?.name || '—';
// Saldo = saldo inicial + movimentações PAGAS vinculadas à conta (transferência sai de uma e entra na outra).
const balance = (a, end) => S.tx.filter(t => t.status === 'paid' && (!end || t.date <= end)).reduce((s, t) => {
  if (t.type === 'income' && t.accountId === a.id) return s + t.amount;
  if (t.type === 'expense' && t.accountId === a.id) return s - t.amount;
  if (t.type === 'transfer') { if (t.accountId === a.id) s -= t.amount; if (t.toAccountId === a.id) s += t.amount; }
  return s;
}, a.initial || 0);
const inMonth = m => S.tx.filter(t => t.date.startsWith(m));
const sum = (l, type) => l.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);

/* ================= Tema ================= */
const applyTheme = () => {
  const t = localStorage.theme || 'dark';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  if (window.Chart) { Chart.defaults.color = dark ? '#a8a3c7' : '#475569'; Chart.defaults.borderColor = dark ? '#2a2744' : '#e2e8f0'; }
};

/* ================= Status da nuvem ================= */
const ST = {
  synced: ['Sincronizado', 'bg-emerald-500'], syncing: ['Sincronizando...', 'bg-amber-500 animate-pulse'],
  offline: ['Offline', 'bg-slate-400'], auth: ['Erro de Autenticação', 'bg-rose-500'],
  signedout: ['Não conectado', 'bg-slate-400'], error: ['Erro ao sincronizar', 'bg-rose-500']
};
function paintStatus(s) {
  const [l, c] = ST[s] || ST.offline, login = s === 'auth' || s === 'signedout';
  $('#sync').innerHTML = `<span class="w-2 h-2 rounded-full ${c}"></span><span class="hidden sm:inline">${l}</span>`;
  $('#syncBtn').innerHTML = login ? ic('sliders', 'w-4 h-4') : ic('refresh', 'w-4 h-4'); $('#syncBtn').title = login ? 'Configurar sincronização' : 'Forçar sincronização';
  $('#syncBtn').dataset.a = login ? 'signin' : 'sync';
}

/* ================= Navegação / render ================= */
function buildNav() {
  let sec = '';
  $('#burger').innerHTML = ic('menu'); $('#sbtn').innerHTML = ic('search');
  $('#side').innerHTML = `<div class="flex items-center gap-2 px-2 py-3 font-bold text-violet-400"><img src="ic-${appIcon()}-192.png" class="app-logo w-8 h-8 rounded-lg" alt=""><span class="lbl">Finanças</span></div>` +
    NAV.map(([v, i, l, g]) => { const h = g !== sec ? (sec = g, `<p class="lbl text-[10px] tracking-widest text-neutral-500 px-3 pt-3">${g}</p>`) : ''; return h + `<button data-a="nav" data-id="${v}" title="${l}" class="nav text-left">${ic(i, 'w-5 h-5')}<span class="lbl">${l}</span></button>`; }).join('');
  $('#bottom').innerHTML = bnav().map(v => { const n = NAV.find(x => x[0] === v); return `<button data-a="nav" data-id="${v}" class="nav !flex-col !gap-1 !px-1 !py-2 text-[10px] rounded-none flex-1">${ic(n[1], 'w-6 h-6')}${n[2]}</button>`; }).join('');
}
function render() {
  S.charts.forEach(c => c.destroy()); S.charts = [];
  document.querySelectorAll('[data-a="nav"]').forEach(b => {
    const on = b.dataset.id === S.view;
    b.classList.toggle('bg-violet-500', on && b.closest('#side')); b.classList.toggle('text-white', on && !!b.closest('#side'));
    b.classList.toggle('text-violet-500', on && !!b.closest('#bottom')); b.classList.toggle('font-semibold', on);
  });
  const hi = () => { const h = new Date().getHours(); return (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + (localStorage.nome ? ', ' + esc(localStorage.nome) : ''); };
  $('#title').innerHTML = S.view === 'dashboard' ? hi() : NAV.find(n => n[0] === S.view)[2];
  $('#subtitle').textContent = { dashboard: 'Veja o que está acontecendo nas suas finanças', cards: 'Gestão dos cartões de crédito', transfers: 'Entre as suas contas', transactions: 'Todos os lançamentos', payments: 'Contas a pagar e faturas', investments: 'Carteira e alocação', settings: 'Preferências e cadastros' }[S.view];
  $('#fab').classList.toggle('hidden', !['dashboard', 'transactions', 'cards', 'payments'].includes(S.view));
  ({ dashboard, transactions, transfers, cards, payments, investments, settings })[S.view]();
}

/* ================= Views ================= */
const card = (l, v, c) => `<div class="card"><p class="text-xs text-slate-500">${l}</p><p class="text-xl font-bold mt-1 ${c}">${brl(v)}</p></div>`;

const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MN = n => Array.from({ length: n }, (_, i) => addMonths(S.month + '-01', -(n - 1 - i)).slice(0, 7));
const ml = m => MES[+m.slice(5) - 1] + '/' + m.slice(2, 4);
const isPassive = t => t.type === 'income' && (S.cat.find(c => c.id === t.categoryId)?.passive || t.categoryId === 'cat_investimentos');
const cardUsedAt = (c, e) => cardTx(c).filter(t => t.date <= e).reduce((s, t) => s + (t.type === 'expense' ? t.amount : -t.amount), 0);
const debtSched = d => { const i = (d.rate || 0) / 100, n = d.n, P = d.principal, pmt = i ? P * i / (1 - Math.pow(1 + i, -n)) : P / n; let B = P;
  return Array.from({ length: n }, (_, k) => { const it = B * i, pr = pmt - it; B = Math.max(0, B - pr); return { m: addMonths(d.start + '-01', k).slice(0, 7), pr, it, bal: B }; }); };
const debtBal = (d, m) => m < d.start ? d.principal : (debtSched(d).filter(x => x.m <= m).pop()?.bal ?? d.principal);
const invAt = e => { const sn = S.snap.filter(x => x.date <= e).sort((a, b) => b.date.localeCompare(a.date))[0]; return sn ? sn.total : S.tx.filter(t => t.invest && t.date <= e).reduce((s, t) => s + t.amount, 0); };
const hd = (i, t, x = '') => `<div class="flex items-center justify-between mb-3 gap-2"><h3 class="font-semibold text-sm flex items-center gap-2"><span class="text-violet-400">${ic(i, 'w-4 h-4')}</span>${t}</h3>${x}</div>`;
const mk = (id, cfg) => { const el = $('#' + id); if (el && window.Chart) S.charts.push(new Chart(el, cfg)); };
const tip = f => ({ callbacks: { label: f } });
const yb = { ticks: { callback: v => brl(v) } };
const sankey = (A, B) => {
  const T = A.reduce((s, x) => s + x.v, 0); if (!T) return '<p class="text-sm text-neutral-500">Sem movimentação neste mês.</p>';
  const H = 230, k = H / T; let y = 0; A.forEach(x => { x.y = y; x.o = 0; y += x.v * k; }); y = 0; B.forEach(x => { x.y = y; x.o = 0; y += x.v * k; });
  let r = ''; A.forEach(a => B.forEach(b => { const f = a.v * b.v / T * k, y1 = a.y + a.o, y2 = b.y + b.o; a.o += f; b.o += f;
    r += `<path d="M200,${y1} C380,${y1} 380,${y2} 560,${y2} L560,${y2 + f} C380,${y2 + f} 380,${y1 + f} 200,${y1 + f}Z" fill="${a.c}" opacity=".35"/>`; }));
  const nd = (x, px, anc, dx) => `<rect x="${px}" y="${x.y}" width="10" height="${Math.max(2, x.v * k)}" rx="2" fill="${x.c}"/><text x="${dx}" y="${x.y + Math.max(2, x.v * k) / 2 + 4}" text-anchor="${anc}" font-size="11" fill="currentColor">${esc(x.n)} · ${brl(x.v)}</text>`;
  return `<svg viewBox="0 0 760 ${H}" style="min-width:640px" class="w-full">${r}${A.map(x => nd(x, 190, 'end', 184)).join('')}${B.map(x => nd(x, 560, 'start', 576)).join('')}</svg>`;
};

function dashboard() {
  const year = S.month.slice(0, 4), mon = S.month.slice(5), M12 = MN(12), M6 = MN(6), l = inMonth(S.month), pl = inMonth(MN(2)[0]);
  const rec = sum(l, 'income'), des = sum(l, 'expense'), liq = rec - des, saldo = S.acc.reduce((s, a) => s + balance(a), 0);
  const f1 = v => v.toFixed(1).replace('.', ','), pct = (a, b) => b > 0 ? Math.max(0, Math.min(100, Math.round(a / b * 100))) : 0;
  const dl = (c, p, inv) => { if (!p) return '<p class="text-[11px] mt-1 text-neutral-500">sem mês anterior</p>'; const x = (c - p) / Math.abs(p) * 100, g = (x >= 0) !== inv; return `<p class="text-[11px] mt-1 ${g ? 'text-emerald-400' : 'text-rose-400'}">${x >= 0 ? '▲' : '▼'} ${f1(Math.abs(x))}% vs. mês anterior</p>`; };
  const spark = (v, c) => { const mx = Math.max(...v, 1), mn = Math.min(...v, 0), r = mx - mn || 1, p = v.map((x, i) => `${i / (v.length - 1) * 100},${28 - (x - mn) / r * 26}`).join(' '); return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" class="w-full h-8 mt-2"><polygon points="0,30 ${p} 100,30" fill="${c}22"/><polyline points="${p}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`; };
  const ser = f => M6.map(m => f(inMonth(m))); let r0 = 0; const cum = ser(x => sum(x, 'income') - sum(x, 'expense')).map(v => r0 += v);
  const kpi = (lb, v, i, c, d, s, go, t) => `<div data-a="go" data-v="${go}" data-t="${t || ''}" class="card k cursor-pointer hover:border-violet-500"><div class="flex justify-between gap-2"><div><p class="text-xs text-neutral-400">${lb}</p><p class="text-lg md:text-xl font-bold mt-1">${brl(v)}</p>${d}</div><span class="w-9 h-9 shrink-0 rounded-full border flex items-center justify-center" style="border-color:${c}66;color:${c}">${ic(i, 'w-4 h-4')}</span></div>${spark(s, c)}</div>`;
  // 1. patrimônio líquido
  const nw = M12.map(m => { const e = m + '-31'; return [S.acc.reduce((s, a) => s + balance(a, e), 0), invAt(e), S.asset.reduce((s, a) => s + a.value, 0), -(S.card.reduce((s, c) => s + Math.max(0, cardUsedAt(c, e)), 0) + S.debt.reduce((s, d) => s + debtBal(d, m), 0))]; });
  const nwNow = nw[11].reduce((a, b) => a + b, 0);
  // 2. orçamento x realizado
  const bg = S.goal.map(g => ({ g, sp: l.filter(t => t.type === 'expense' && t.categoryId === g.categoryId).reduce((s, t) => s + t.amount, 0) }));
  // 4. runway
  const liquid = saldo + S.hold.filter(h => h.cls === 'Renda fixa').reduce((s, h) => s + hv(h), 0), m3 = MN(3).map(m => sum(inMonth(m), 'expense')).filter(v => v > 0);
  const avg = m3.length ? m3.reduce((a, b) => a + b, 0) / m3.length : 0, runway = avg ? Math.max(0, liquid) / avg : 0, rt = +(localStorage.metaRunway || 12), rcol = runway < 3 ? '#fb7185' : runway < 6 ? '#fbbf24' : '#8b5cf6';
  // 5. sankey
  const grp = type => { const o = {}; l.filter(t => t.type === type).forEach(t => o[t.categoryId] = (o[t.categoryId] || 0) + t.amount); let a = Object.entries(o).map(([id, v]) => ({ n: cat(id).name, v, c: cat(id).color })).sort((x, y) => y.v - x.v); if (a.length > 5) a = [...a.slice(0, 4), { n: 'Outras', v: a.slice(4).reduce((s, x) => s + x.v, 0), c: '#78716c' }]; return a; };
  const aportes = l.filter(t => t.invest).reduce((s, t) => s + t.amount, 0); let src = grp('income'), tgt = grp('expense'); if (aportes) tgt.push({ n: 'Aportes', v: aportes, c: '#6366f1' });
  const T1 = src.reduce((s, x) => s + x.v, 0), T2 = tgt.reduce((s, x) => s + x.v, 0);
  if (T1 > T2) tgt.push({ n: 'Saldo livre', v: T1 - T2, c: '#34d399' }); else if (T2 > T1) src.push({ n: 'Reserva / dívida', v: T2 - T1, c: '#fb7185' });
  // 6. taxa de poupança
  const rate = M12.map(m => { const x = inMonth(m), r = sum(x, 'income'); return r > 0 ? (r - sum(x, 'expense')) / r * 100 : 0; }), ma = rate.map((_, i) => { const w = rate.slice(Math.max(0, i - 5), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; }), meta = +(localStorage.metaPoup || 20);
  // 7. renda passiva x custo
  const pas = M12.map(m => inMonth(m).filter(isPassive).reduce((s, t) => s + t.amount, 0)), cost = M12.map(m => sum(inMonth(m), 'expense')), cob = cost[11] ? pas[11] / cost[11] * 100 : 0;
  // 8. dívidas
  const DW = Array.from({ length: 24 }, (_, i) => addMonths(S.month + '-01', i).slice(0, 7)), sch = S.debt.map(debtSched), dsum = (m, k) => sch.reduce((s, sc) => s + (sc.find(x => x.m === m)?.[k] || 0), 0);
  const debtNow = S.debt.reduce((s, d) => s + debtBal(d, S.month), 0), jurosRest = sch.reduce((s, sc) => s + sc.filter(x => x.m > S.month).reduce((a, x) => a + x.it, 0), 0);
  // 9. heatmap
  const dim = new Date(+year, +mon, 0).getDate(), first = new Date(+year, +mon - 1, 1).getDay(), dtot = Array.from({ length: dim }, (_, i) => l.filter(t => t.type === 'expense' && +t.date.slice(8) === i + 1).reduce((s, t) => s + t.amount, 0)), dmax = Math.max(...dtot, 1), dtop = dtot.indexOf(Math.max(...dtot));
  // 3. alocação / 10. drawdown
  const al = CLS.map((n, i) => [n, S.hold.filter(h => h.cls === n).reduce((s, h) => s + hv(h), 0), CCOL[i]]).filter(x => x[1] > 0), alT = al.reduce((s, x) => s + x[1], 0);
  const sn = [...S.snap].sort((a, b) => a.date.localeCompare(b.date)); let pk = 0; const dd = sn.map(x => { pk = Math.max(pk, x.total); return pk ? (x.total / pk - 1) * 100 : 0; });
  $('#view').innerHTML = `<div class="dash">
   ${kpi('Saldo atual', saldo, 'wallet', '#8b5cf6', `<p class="text-[11px] mt-1 text-neutral-500">${S.acc.length} conta(s)</p>`, cum, 'transfers')}
   ${kpi('Receitas do mês', rec, 'down', '#34d399', dl(rec, sum(pl, 'income')), ser(x => sum(x, 'income')), 'transactions', 'income')}
   ${kpi('Despesas do mês', des, 'up', '#fb7185', dl(des, sum(pl, 'expense'), true), ser(x => sum(x, 'expense')), 'transactions', 'expense')}
   ${kpi('Balanço líquido', liq, 'activity', '#fbbf24', dl(liq, sum(pl, 'income') - sum(pl, 'expense')), ser(x => sum(x, 'income') - sum(x, 'expense')), 'transactions')}
   <div class="card w w7">${hd('trending', 'Evolução do patrimônio líquido', `<b class="text-sm ${nwNow >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${brl(nwNow)}</b>`)}<div class="h-60"><canvas id="nw"></canvas></div><p class="text-[11px] text-neutral-500 mt-2">Contas + investimentos + bens − cartões e dívidas. Cadastre bens e dívidas em Configurações → Patrimônio.</p></div>
   <div class="card w w5">${hd('shield', 'Runway de liquidez')}<p class="text-3xl font-bold">${f1(runway)} <span class="text-sm font-normal text-neutral-400">meses</span></p>
    <div class="relative h-3 rounded-full bg-slate-200 dark:bg-[#1d1a33] mt-4"><div class="h-3 rounded-full" style="width:${Math.min(100, runway / rt * 100)}%;background:${rcol}"></div>${[3, 6].filter(x => x < rt).map(x => `<span class="absolute top-0 h-3 w-px bg-slate-400" style="left:${x / rt * 100}%"></span>`).join('')}</div>
    <div class="flex justify-between text-[11px] text-neutral-500 mt-1"><span>0</span><span>3</span><span>6</span><span>meta ${rt}</span></div>
    <p class="text-xs text-neutral-400 mt-3">Reserva líquida ${brl(liquid)} ÷ gasto médio de ${brl(avg)}/mês (3 meses). Conta saldo das contas + renda fixa.</p></div>
   <div class="card w w5">${hd('target', 'Orçamento vs. realizado', `<button data-a="sub" data-id="metas" class="text-xs text-violet-400">Metas</button>`)}${bg.map(({ g, sp }) => { const mx = Math.max(g.limit, sp) * 1.15, over = sp > g.limit;
    return `<div data-a="go" data-v="transactions" data-t="expense" data-c="${g.categoryId}" class="mb-3 cursor-pointer"><div class="flex justify-between text-xs mb-1"><span class="flex items-center gap-1.5">${cat(g.categoryId).icon}${esc(cat(g.categoryId).name)}</span><span class="${over ? 'text-rose-400' : 'text-neutral-400'}">${brl(sp)} / ${brl(g.limit)}</span></div><div class="relative h-2.5 rounded-full bg-slate-200 dark:bg-[#1d1a33]"><div class="h-2.5 rounded-full" style="width:${sp / mx * 100}%;background:${over ? '#fb7185' : '#8b5cf6'}"></div><span class="absolute -top-1 w-0.5 h-4 bg-slate-500 dark:bg-white" style="left:${g.limit / mx * 100}%"></span></div></div>`; }).join('') || '<p class="text-sm text-neutral-500">Crie metas de gasto por categoria em Configurações → Metas para comparar o planejado com o realizado.</p>'}</div>
   <div class="card w w7">${hd('swap', 'Fluxo de caixa do mês', `<span class="text-xs text-neutral-400">${ml(S.month)}</span>`)}<div class="overflow-x-auto">${sankey(src, tgt)}</div></div>
   <div class="card w w6">${hd('activity', 'Taxa de poupança (média móvel 6 meses)', `<b class="text-sm">${f1(rate[11])}%</b>`)}<div class="h-52"><canvas id="sv"></canvas></div></div>
   <div class="card w w6">${hd('banknote', 'Renda passiva vs. custo de vida', `<b class="text-sm ${cob >= 100 ? 'text-emerald-400' : 'text-neutral-300'}">${f1(cob)}% coberto</b>`)}<div class="h-52"><canvas id="ps"></canvas></div><p class="text-[11px] text-neutral-500 mt-2">${cob >= 100 ? 'Ponto de independência financeira atingido neste mês.' : 'Marque categorias de receita como "renda passiva" em Configurações → Categorias.'}</p></div>
   <div class="card w w7">${hd('bank', 'Amortização de dívidas', `<b class="text-sm text-rose-400">${brl(debtNow)}</b>`)}${S.debt.length ? `<div class="h-56"><canvas id="dp"></canvas></div><p class="text-[11px] text-neutral-500 mt-2">Saldo devedor em ${ml(S.month)} · juros ainda a pagar ${brl(jurosRest)} (tabela Price).</p>` : '<p class="text-sm text-neutral-500">Nenhuma dívida cadastrada.</p><button data-a="sub" data-id="patrimonio" class="btn mt-3 !py-1 text-xs">Cadastrar dívida</button>'}</div>
   <div class="card w w5">${hd('calendar', 'Mapa de calor de gastos', `<span class="text-xs text-neutral-400">${ml(S.month)}</span>`)}<div class="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-500 mb-1">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="grid grid-cols-7 gap-1">${'<span></span>'.repeat(first)}${dtot.map((v, i) => `<button data-a="day" data-id="${S.month}-${String(i + 1).padStart(2, '0')}" title="${brl(v)}" class="aspect-square rounded-md text-[10px] text-white/90" style="background:rgba(139,92,246,${v ? (.18 + .82 * v / dmax).toFixed(2) : .06})">${i + 1}</button>`).join('')}</div>
    <p class="text-[11px] text-neutral-500 mt-2">${des ? `Dia mais caro: ${dtop + 1} (${brl(dtot[dtop])}) · média diária ${brl(des / dim)}. Toque num dia para ver os lançamentos.` : 'Sem despesas neste mês.'}</p></div>
   <div class="card w w5">${hd('trending', 'Alocação de investimentos', `<button data-a="nav" data-id="investments" class="text-xs text-violet-400">Abrir</button>`)}${al.length ? `<div class="h-40"><canvas id="al"></canvas></div><div class="mt-2">${al.map(x => `<div class="flex items-center gap-2 text-xs py-0.5"><span class="w-2 h-2 rounded-full" style="background:${x[2]}"></span><span class="flex-1">${x[0]}</span><span>${brl(x[1])}</span><b class="w-10 text-right">${Math.round(x[1] / alT * 100)}%</b></div>`).join('')}</div>` : '<p class="text-sm text-neutral-500">Cadastre ativos na aba Investimentos.</p>'}</div>
   <div class="card w w7">${hd('activity', 'Drawdown da carteira', `<b class="text-sm text-rose-400">${dd.length ? f1(Math.min(...dd)) + '% máx.' : ''}</b>`)}${sn.length > 1 ? '<div class="h-48"><canvas id="dd"></canvas></div>' : '<p class="text-sm text-neutral-500">O histórico é montado cada vez que você atualiza a cotação de um ativo em Investimentos. Com 2 ou mais registros, a curva aparece aqui.</p>'}</div></div>`;
  mk('nw', { type: 'line', data: { labels: M12.map(ml), datasets: [['Contas', 0, '#8b5cf6'], ['Investimentos', 1, '#6366f1'], ['Bens', 2, '#22d3ee'], ['Passivos', 3, '#fb7185']].map(([label, k, c]) => ({ label, data: nw.map(x => x[k]), borderColor: c, backgroundColor: c + '55', fill: true, tension: .3, pointRadius: 0, borderWidth: 1.5 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: tip(c => ` ${c.dataset.label}: ${brl(c.parsed.y)}`) }, scales: { y: { stacked: true, ...yb } } } });
  mk('sv', { type: 'line', data: { labels: M12.map(ml), datasets: [{ label: 'Taxa mensal', data: rate, borderColor: '#6366f166', pointRadius: 2, borderWidth: 1 }, { label: 'Média móvel 6m', data: ma, borderColor: '#8b5cf6', borderWidth: 2.5, tension: .3, pointRadius: 0 }, { label: 'Meta', data: rate.map(() => meta), borderColor: '#fbbf24', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: tip(c => ` ${c.dataset.label}: ${f1(c.parsed.y)}%`) }, scales: { y: { ticks: { callback: v => v + '%' } } } } });
  mk('ps', { type: 'line', data: { labels: M12.map(ml), datasets: [{ label: 'Renda passiva', data: pas, borderColor: '#34d399', backgroundColor: '#34d39922', fill: true, tension: .3, pointRadius: 0 }, { label: 'Custo de vida', data: cost, borderColor: '#fb7185', tension: .3, pointRadius: 0 }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: tip(c => ` ${c.dataset.label}: ${brl(c.parsed.y)}`) }, scales: { y: yb } } });
  if (S.debt.length) mk('dp', { type: 'bar', data: { labels: DW.map(ml), datasets: [{ label: 'Principal', data: DW.map(m => dsum(m, 'pr')), backgroundColor: '#8b5cf6' }, { label: 'Juros', data: DW.map(m => dsum(m, 'it')), backgroundColor: '#fb7185' }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: tip(c => ` ${c.dataset.label}: ${brl(c.parsed.y)}`) }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, ...yb } } } });
  if (al.length) mk('al', { type: 'doughnut', data: { labels: al.map(x => x[0]), datasets: [{ data: al.map(x => x[1]), backgroundColor: al.map(x => x[2]), borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } } });
  if (sn.length > 1) mk('dd', { type: 'line', data: { labels: sn.map(x => fdate(x.date).slice(0, 5)), datasets: [{ label: 'Drawdown', data: dd, borderColor: '#fb7185', backgroundColor: 'rgba(251,113,133,.25)', fill: true, tension: .2, pointRadius: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tip(c => ` ${f1(c.parsed.y)}% do topo`) }, scales: { y: { max: 0, ticks: { callback: v => v + '%' } } } } });
}

function txRow(t) {
  const tr = t.type === 'transfer', c = tr ? { icon: ic('swap', 'w-5 h-5'), color: '#64748b', name: 'Transferência' } : cat(t.categoryId), paid = t.status === 'paid';
  const col = t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-600' : 'text-slate-500';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  return `<div class="card !p-3 flex items-center gap-3">
    <div class="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style="background:${c.color}22">${c.icon}</div>
    <div class="min-w-0 flex-1"><p class="font-medium truncate">${esc(t.description)}</p>
      <p class="text-xs text-slate-500 truncate">${fdate(t.date)} · ${esc(c.name)} · ${esc(t.cardId && !tr ? cardName(t.cardId) : accName(t.accountId))}${tr ? ' → ' + esc(t.cardId ? cardName(t.cardId) : t.invest ? 'Investimentos' : accName(t.toAccountId)) : ''}</p></div>
    <div class="text-right"><p class="font-semibold ${col}">${sign}${brl(t.amount)}</p>
      <button data-a="toggle" data-id="${t.id}" class="text-xs px-2 rounded-full ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${paid ? 'Pago' : 'Pendente'}</button></div>
    <div class="flex flex-col"><button data-a="edit-tx" data-id="${t.id}" aria-label="Editar">${ic('pencil', 'w-4 h-4')}</button><button data-a="del-tx" data-id="${t.id}" aria-label="Excluir">${ic('trash', 'w-4 h-4')}</button></div></div>`;
}
function transactions() {
  const l = inMonth(S.month).filter(t => (!S.ftype || t.type === S.ftype) && (!S.fcat || t.categoryId === S.fcat)).sort(byDesc);
  const chip = (v, lb) => `<button data-a="ftype" data-id="${v}" class="btn !py-1 text-xs ${S.ftype === v ? 'btn-p' : ''}">${lb}</button>`;
  $('#view').innerHTML = `<div class="flex gap-2 flex-wrap mb-3 items-center">${chip('', 'Todas')}${chip('income', 'Receitas')}${chip('expense', 'Despesas')}${chip('transfer', 'Transferências')}${S.fcat ? `<button data-a="fcat" data-id="" class="btn !py-1 text-xs btn-p inline-flex items-center gap-1">${esc(cat(S.fcat).name)} ${ic('x', 'w-3 h-3')}</button>` : ''}</div>
  <div class="space-y-2">${l.map(txRow).join('') || '<p class="text-center text-slate-500 py-10">Nenhuma transação com estes filtros. Toque em + para adicionar.</p>'}</div>`;
}

function accounts() {
  $('#sub').innerHTML = `<button data-a="new-acc" class="btn btn-p mb-3">+ Nova conta</button>
  <div class="grid sm:grid-cols-2 gap-3">${S.acc.map(a => { const b = balance(a); return `<div class="card flex items-center gap-3">
    <div class="flex-1"><p class="font-semibold">${esc(a.name)}</p><p class="text-xs text-slate-500">${esc(a.type)}</p>
    <p class="text-lg font-bold mt-1 ${b < 0 ? 'text-rose-600' : ''}">${brl(b)}</p></div>
    <button data-a="edit-acc" data-id="${a.id}" aria-label="Editar">${ic('pencil', 'w-4 h-4')}</button><button data-a="del-acc" data-id="${a.id}" aria-label="Excluir">${ic('trash', 'w-4 h-4')}</button></div>`; }).join('')}</div>`;
}

function categories() {
  const grp = (type, t) => `<h3 class="font-semibold mt-4 mb-2">${t}</h3><div class="grid sm:grid-cols-2 gap-2">${S.cat.filter(c => c.type === type).map(c =>
    `<div class="card !p-3 flex items-center gap-3"><span class="w-9 h-9 rounded-full flex items-center justify-center" style="background:${c.color}33;color:${c.color}">${ic(catIc(c), 'w-4 h-4')}</span>
    <span class="flex-1">${esc(c.name)}</span><button data-a="edit-cat" data-id="${c.id}" aria-label="Editar">${ic('pencil', 'w-4 h-4')}</button><button data-a="del-cat" data-id="${c.id}" aria-label="Excluir">${ic('trash', 'w-4 h-4')}</button></div>`).join('')}</div>`;
  $('#sub').innerHTML = `<button data-a="new-cat" class="btn btn-p">+ Nova categoria</button>${grp('expense', 'Despesas')}${grp('income', 'Receitas')}`;
}

/* ================= Novas abas ================= */
const cardName = id => S.card.find(c => c.id === id)?.name || '—';
const cardTx = c => S.tx.filter(t => t.cardId === c.id);
const fMonth = (t, c) => +t.date.slice(8) > (c.closing || 31) ? addMonths(t.date, 1).slice(0, 7) : t.date.slice(0, 7); // compra após o fechamento vai p/ a próxima fatura
const used = c => cardTx(c).reduce((s, t) => s + (t.type === 'expense' ? t.amount : -t.amount), 0);
const fatura = (c, m) => cardTx(c).filter(t => t.type === 'expense' && fMonth(t, c) === m).reduce((s, t) => s + t.amount, 0);
const faturaPaga = (c, m) => cardTx(c).filter(t => t.type === 'transfer' && t.ref === m).reduce((s, t) => s + t.amount, 0);
const bar = (p, red) => `<div class="h-2 rounded-full bg-neutral-200 dark:bg-[#1d1a33]"><div class="h-2 rounded-full ${red ? 'bg-rose-500' : 'bg-violet-500'}" style="width:${p}%"></div></div>`;
const byDesc = (a, b) => b.date.localeCompare(a.date);

function transfers() {
  const l = inMonth(S.month).filter(t => t.type === 'transfer').sort(byDesc);
  $('#view').innerHTML = `<button data-a="new-transfer" class="btn btn-p mb-3">+ Nova transferência</button>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">${S.acc.map(a => `<div data-a="new-transfer" data-id="${a.id}" class="card cursor-pointer hover:border-violet-500"><p class="text-xs text-neutral-400">${esc(a.name)}</p><p class="font-bold">${brl(balance(a))}</p><p class="text-[11px] text-violet-500">Transferir daqui →</p></div>`).join('')}</div>
  <div class="space-y-2">${l.map(txRow).join('') || '<p class="text-center text-neutral-500 py-8">Nenhuma transferência neste mês.</p>'}</div>`;
}

function cards() {
  $('#view').innerHTML = `<button data-a="new-card" class="btn btn-p mb-3">+ Novo cartão</button><div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">${S.card.map(c => {
    const u = used(c), p = Math.min(100, Math.round(u / c.limit * 100)) || 0;
    return `<div data-a="card" data-id="${c.id}" class="card cursor-pointer hover:border-violet-500"><div class="flex justify-between"><b class="flex items-center gap-2">${ic('card', 'w-4 h-4')}${esc(c.name)}</b><span class="text-xs text-neutral-400">fecha dia ${c.closing} · vence dia ${c.due}</span></div>
    <p class="text-xs text-neutral-400 mt-3">Fatura ${S.month.split('-').reverse().join('/')}</p><p class="text-xl font-bold mb-3">${brl(fatura(c, S.month))}</p>${bar(p, p > 85)}
    <p class="text-xs text-neutral-400 mt-1">Usado ${brl(u)} de ${brl(c.limit)} · disponível ${brl(c.limit - u)}</p></div>`; }).join('') || '<p class="text-neutral-500">Nenhum cartão cadastrado. Toque em "+ Novo cartão".</p>'}</div>`;
}
function cardDetail(id) {
  const c = S.card.find(x => x.id === id), m = S.month, f = fatura(c, m), pg = faturaPaga(c, m);
  const it = cardTx(c).filter(t => t.type === 'expense' && fMonth(t, c) === m).sort(byDesc);
  openModal(esc(c.name), `<p class="text-sm text-neutral-400">Fatura ${m.split('-').reverse().join('/')} · vence dia ${c.due} (muda com o filtro de mês)</p>
   <p class="text-2xl font-bold">${brl(f)} <span class="text-xs font-normal text-neutral-400">pago ${brl(pg)}</span></p>
   <div class="flex gap-2 flex-wrap"><button type="button" data-a="card-buy" data-id="${id}" class="btn btn-p">+ Compra</button><button type="button" data-a="card-pay" data-id="${id}" class="btn">Pagar fatura</button><button type="button" data-a="edit-card" data-id="${id}" class="btn">Editar</button><button type="button" data-a="del-card" data-id="${id}" class="btn">Excluir</button></div>
   <div>${it.map(t => `<button type="button" data-a="edit-tx" data-id="${t.id}" class="w-full flex justify-between py-2 text-sm text-left border-b border-neutral-200 dark:border-[#26233d]"><span>${fdate(t.date)} · ${esc(t.description)}</span><b>${brl(t.amount)}</b></button>`).join('') || '<p class="text-sm text-neutral-500 py-2">Sem compras nesta fatura.</p>'}</div>`, null, true);
}
function cardForm(c = {}) {
  openModal(c.id ? 'Editar cartão' : 'Novo cartão', `${fld('Nome', `<input name="name" required class="inp" value="${esc(c.name || '')}">`)}
   ${fld('Limite (R$)', `<input name="limit" type="number" step="0.01" min="0" required class="inp" value="${c.limit ?? ''}">`)}
   ${fld('Dia de fechamento', `<input name="closing" type="number" min="1" max="31" required class="inp" value="${c.closing ?? 25}">`)}
   ${fld('Dia de vencimento', `<input name="due" type="number" min="1" max="31" required class="inp" value="${c.due ?? 5}">`)}
   ${fld('Conta padrão para pagar a fatura', `<select name="payAccountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), c.payAccountId)}</select>`)}`,
    d => DB.put('cards', { ...c, id: c.id || uid(), name: d.name.trim(), limit: parseFloat(d.limit), closing: +d.closing, due: +d.due, payAccountId: d.payAccountId }).then(() => true));
}
function payForm(id) {
  const c = S.card.find(x => x.id === id), open = Math.max(0, fatura(c, S.month) - faturaPaga(c, S.month));
  openModal('Pagar fatura · ' + esc(c.name), `${fld('Valor (R$)', `<input name="amount" type="number" step="0.01" min="0.01" required class="inp" value="${open.toFixed(2)}">`)}
   ${fld('Conta de pagamento', `<select name="accountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), c.payAccountId)}</select>`)}
   ${fld('Data', `<input name="date" type="date" required class="inp" value="${nowDate()}">`)}`,
    d => DB.put('transactions', { id: uid(), type: 'transfer', description: 'Pagamento fatura ' + c.name, amount: parseFloat(d.amount), date: d.date, accountId: d.cardId && d.type === 'expense' ? null : d.accountId, cardId: d.type === 'expense' && d.cardId ? d.cardId : null, toAccountId: null, categoryId: null, cardId: id, ref: S.month, status: 'paid' }).then(() => true));
}

function payments() {
  const hoje = nowDate(), pend = S.tx.filter(t => t.type === 'expense' && t.status === 'pending' && !t.cardId).sort((a, b) => a.date.localeCompare(b.date));
  const fats = S.card.map(c => [c, fatura(c, S.month) - faturaPaga(c, S.month)]).filter(x => x[1] > 0.005);
  const atras = pend.filter(t => t.date < hoje).reduce((s, t) => s + t.amount, 0), mes = pend.filter(t => t.date.startsWith(S.month)).reduce((s, t) => s + t.amount, 0);
  $('#view').innerHTML = `<div class="grid grid-cols-3 gap-3 mb-4">${[['Em atraso', atras, 'text-rose-500'], ['A pagar no mês', mes, 'text-amber-500'], ['Faturas abertas', fats.reduce((s, x) => s + x[1], 0), 'text-violet-500']].map(([l, v, c]) => `<div class="card"><p class="text-xs text-neutral-400">${l}</p><p class="font-bold ${c}">${brl(v)}</p></div>`).join('')}</div>
  <div class="space-y-2">${fats.map(([c, v]) => `<div data-a="card" data-id="${c.id}" class="card !p-3 flex items-center gap-3 cursor-pointer hover:border-violet-500"><span class="text-violet-400">${ic('card', 'w-6 h-6')}</span><div class="flex-1"><p class="font-medium">Fatura ${esc(c.name)}</p><p class="text-xs text-neutral-500">vence dia ${c.due}</p></div><b>${brl(v)}</b></div>`).join('')}
  ${pend.map(t => `<div class="card !p-3 flex items-center gap-3"><div data-a="edit-tx" data-id="${t.id}" class="flex-1 cursor-pointer"><p class="font-medium">${esc(t.description)}</p><p class="text-xs ${t.date < hoje ? 'text-rose-500' : 'text-neutral-500'}">${t.date < hoje ? 'Atrasada · ' : ''}${fdate(t.date)} · ${esc(cat(t.categoryId).name)}</p></div><b>${brl(t.amount)}</b><button data-a="toggle" data-id="${t.id}" class="btn btn-p !py-1 text-xs">Pagar</button></div>`).join('')}
  ${!fats.length && !pend.length ? '<p class="text-center text-neutral-500 py-8">Nada pendente.</p>' : ''}</div>`;
}

const CLS = ['Ações', 'FIIs', 'Cripto', 'Fundos', 'Renda fixa', 'Outros'], CCOL = ['#8b5cf6', '#eab308', '#a855f7', '#0ea5e9', '#22c55e', '#78716c'];
const hv = h => h.qty * h.price, hc = h => h.qty * h.avg;
function investments() {
  const tot = S.hold.reduce((s, h) => s + hv(h), 0), cost = S.hold.reduce((s, h) => s + hc(h), 0), pl = tot - cost;
  const g = CLS.map((n, i) => [n, S.hold.filter(h => h.cls === n).reduce((s, h) => s + hv(h), 0), CCOL[i]]).filter(x => x[1] > 0);
  const k = (l, v, c) => `<div class="card"><p class="text-xs text-neutral-400">${l}</p><p class="text-lg font-bold ${c || ''}">${v}</p></div>`;
  $('#view').innerHTML = `<button data-a="new-hold" class="btn btn-p mb-3">+ Novo ativo</button>
  <div class="grid grid-cols-3 gap-3 mb-4">${k('Patrimônio', brl(tot))}${k('Custo', brl(cost))}${k('Resultado', `${brl(pl)} (${cost ? (pl / cost * 100).toFixed(1).replace('.', ',') : '0'}%)`, pl >= 0 ? 'text-emerald-500' : 'text-rose-500')}</div>
  <div class="dash"><div class="card w w4"><h3 class="font-semibold mb-2">Alocação</h3><div class="h-44"><canvas id="i1"></canvas></div>${g.map(x => `<div class="flex items-center gap-2 text-xs mt-1"><span class="w-2 h-2 rounded-full" style="background:${x[2]}"></span><span class="flex-1">${x[0]}</span><b>${tot ? Math.round(x[1] / tot * 100) : 0}%</b></div>`).join('')}</div>
  <div class="card w w7 !p-3 space-y-1"><h3 class="font-semibold px-1">Ativos <span class="text-xs font-normal text-neutral-400">(toque para atualizar a cotação)</span></h3>${[...S.hold].sort((a, b) => hv(b) - hv(a)).map(h => { const p = hv(h) - hc(h); return `<div data-a="edit-hold" data-id="${h.id}" class="flex items-center gap-3 py-2 px-1 border-b border-neutral-200 dark:border-[#26233d] cursor-pointer"><div class="flex-1"><b>${esc(h.ticker)}</b> <span class="text-xs text-neutral-400">${h.cls} · ${h.qty} un.</span></div><div class="text-right"><p class="font-semibold">${brl(hv(h))}</p><p class="text-xs ${p >= 0 ? 'text-emerald-500' : 'text-rose-500'}">${brl(p)}</p></div></div>`; }).join('') || '<p class="text-sm text-neutral-500 p-2">Nenhum ativo cadastrado.</p>'}</div></div>`;
  if (window.Chart && g.length) S.charts.push(new Chart($('#i1'), { type: 'doughnut', data: { labels: g.map(x => x[0]), datasets: [{ data: g.map(x => x[1]), backgroundColor: g.map(x => x[2]), borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } } }));
}
function holdForm(h = {}) {
  const nw = !h.id;
  openModal(nw ? 'Novo ativo' : 'Editar ativo', `${fld('Ticker / nome', `<input name="ticker" required class="inp" value="${esc(h.ticker || '')}">`)}
   ${fld('Classe', `<select name="cls" class="inp">${opts(CLS.map(x => [x, x]), h.cls)}</select>`)}
   ${fld('Quantidade', `<input name="qty" type="number" step="any" min="0" required class="inp" value="${h.qty ?? ''}">`)}
   ${fld('Preço médio (R$)', `<input name="avg" type="number" step="any" min="0" required class="inp" value="${h.avg ?? ''}">`)}
   ${fld('Cotação atual (R$)', `<input name="price" type="number" step="any" min="0" required class="inp" value="${h.price ?? ''}">`)}
   ${nw ? fld('Debitar de uma conta? (gera transferência)', `<select name="from" class="inp"><option value="">Não</option>${opts(S.acc.map(a => [a.id, a.name]))}</select>`) : `<button type="button" data-a="del-hold" data-id="${h.id}" class="btn w-full">Excluir ativo</button>`}`,
    async d => {
      const o = { ...h, id: h.id || uid(), ticker: d.ticker.trim().toUpperCase(), cls: d.cls, qty: +d.qty, avg: +d.avg, price: +d.price };
      await DB.put('holdings', o);
      await DB.put('snaps', { id: 's' + nowDate(), date: nowDate(), total: [...S.hold.filter(x => x.id !== o.id), o].reduce((t, x) => t + hv(x), 0) }); // histórico p/ drawdown
      if (nw && d.from) await DB.put('transactions', { id: uid(), type: 'transfer', invest: true, description: 'Aporte ' + o.ticker, amount: Math.round(o.qty * o.avg * 100) / 100, date: nowDate(), accountId: d.from, toAccountId: null, categoryId: null, status: 'paid' });
    });
}

/* ---- Configurações com sub-abas ---- */
function settings() {
  const T = [['geral', 'Geral'], ['integracoes', 'Integrações'], ['metas', 'Metas'], ['patrimonio', 'Patrimônio'], ['categorias', 'Categorias'], ['contas', 'Contas'], ['menu', 'Menu'], ['backup', 'Backup']];
  $('#view').innerHTML = `<div class="flex gap-2 overflow-x-auto mb-4">${T.map(([k, l]) => `<button data-a="sub" data-id="${k}" class="btn shrink-0 ${S.sub === k ? 'btn-p' : ''}">${l}</button>`).join('')}</div><div id="sub"></div>`;
  ({ geral: subGeral, integracoes: subInteg, metas: subMetas, patrimonio: subPatr, menu: subMenu, categorias: categories, contas: accounts, backup: subBackup })[S.sub]();
}
function subGeral() {
  $('#sub').innerHTML = `<div class="card max-w-xl space-y-3"><h3 class="font-semibold">Aparência e perfil</h3>
   ${fld('Tema', `<select id="themeSel" class="inp">${opts([['auto', 'Automático (sistema)'], ['light', 'Claro'], ['dark', 'Escuro']], localStorage.theme || 'dark')}</select>`)}
   ${fld('Seu nome (saudação do painel)', `<input id="nome" class="inp" value="${esc(localStorage.nome || '')}">`)}
   <div><p class="text-sm text-slate-500 mb-2">Ícone do app</p><div class="grid grid-cols-2 gap-3">${[['financas', 'Finanças'], ['nostos', 'Nostos']].map(([k, n]) => `<button type="button" data-a="icon" data-id="${k}" class="card !p-3 flex flex-col items-center gap-2 ${appIcon() === k ? '!border-violet-500' : ''}"><img src="ic-${k}-192.png" class="w-20 h-20 rounded-2xl" alt=""><span class="text-sm">${n}</span></button>`).join('')}</div>
   <p class="text-[11px] text-neutral-500 mt-2">Troca o logo do app e o ícone usado na instalação. Se o app já estiver na tela inicial, remova-o e adicione de novo para atualizar o ícone de lá.</p></div></div>`;
  $('#themeSel').onchange = e => { localStorage.theme = e.target.value; applyTheme(); render(); };
  $('#nome').onchange = e => { localStorage.nome = e.target.value.trim(); };
}
function subInteg() {
  const g = Sync.getCfg();
  $('#sub').innerHTML = `<div class="card max-w-xl"><h3 class="font-semibold mb-1">GitHub (sincronização)</h3>
   <p class="text-sm text-slate-500 mb-3">Repositório <b>privado</b> só para os dados e token fine-grained com <i>Contents: Read and write</i> apenas nele. Funciona offline: sincroniza quando houver internet.</p>
   <form id="ghForm" class="space-y-2">${fld('Usuário (dono)', `<input name="owner" required class="inp" value="${esc(g.owner || '')}">`)}${fld('Repositório', `<input name="repo" required class="inp" value="${esc(g.repo || '')}">`)}
   ${fld('Branch', `<input name="branch" class="inp" value="${esc(g.branch || 'main')}">`)}${fld('Arquivo', `<input name="path" class="inp" value="${esc(g.path || 'financas_pessoais_db.json')}">`)}
   ${fld('Token (PAT)', `<input name="token" type="password" autocomplete="off" ${g.token ? '' : 'required'} class="inp" placeholder="${g.token ? '•••••• salvo (em branco mantém)' : 'github_pat_...'}">`)}
   <div class="flex gap-2 flex-wrap pt-1"><button class="btn btn-p">Salvar e sincronizar</button><button type="button" class="btn" data-a="sync">Forçar sincronização</button><button type="button" class="btn" data-a="signout">Remover token</button></div></form></div>`;
  $('#ghForm').onsubmit = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    Sync.saveCfg({ owner: d.owner.trim(), repo: d.repo.trim(), branch: d.branch.trim() || 'main', path: d.path.trim() || 'financas_pessoais_db.json', token: d.token.trim() || g.token }); Sync.sync(); };
}
function subMetas() {
  const l = inMonth(S.month);
  $('#sub').innerHTML = `<div class="card max-w-xl mb-4 grid grid-cols-2 gap-3">${fld('Meta de poupança (% da renda)', `<input id="mp" type="number" min="0" max="100" class="inp" value="${localStorage.metaPoup || 20}">`)}${fld('Meta de reserva (meses)', `<input id="mr" type="number" min="1" max="60" class="inp" value="${localStorage.metaRunway || 12}">`)}</div><button data-a="new-goal" class="btn btn-p mb-3">+ Nova meta</button><p class="text-sm text-neutral-500 mb-3">Limite mensal de gastos por categoria. O progresso aparece no Dashboard.</p><div class="grid sm:grid-cols-2 gap-3">${S.goal.map(g => {
    const sp = l.filter(t => t.type === 'expense' && t.categoryId === g.categoryId).reduce((s, t) => s + t.amount, 0), p = Math.min(100, Math.round(sp / g.limit * 100)) || 0;
    return `<div class="card"><div class="flex justify-between mb-2"><b>${cat(g.categoryId).icon} ${esc(cat(g.categoryId).name)}</b><span><button data-a="edit-goal" data-id="${g.id}">${ic('pencil', 'w-4 h-4')}</button> <button data-a="del-goal" data-id="${g.id}">${ic('trash', 'w-4 h-4')}</button></span></div>${bar(p, p >= 100)}<p class="text-xs text-neutral-400 mt-1">${brl(sp)} de ${brl(g.limit)} neste mês</p></div>`; }).join('') || '<p class="text-neutral-500">Nenhuma meta criada.</p>'}</div>`;
}
function goalForm(g = {}) {
  openModal(g.id ? 'Editar meta' : 'Nova meta', `${fld('Categoria', `<select name="categoryId" class="inp">${opts(S.cat.filter(c => c.type === 'expense').map(c => [c.id, c.name]), g.categoryId)}</select>`)}
   ${fld('Limite mensal (R$)', `<input name="limit" type="number" step="0.01" min="1" required class="inp" value="${g.limit ?? ''}">`)}`,
    d => DB.put('goals', { ...g, id: g.id || uid(), categoryId: d.categoryId, limit: parseFloat(d.limit) }).then(() => true));
}
function subBackup() {
  $('#sub').innerHTML = `<div class="card max-w-xl"><h3 class="font-semibold mb-1">Backup e exportação</h3><p class="text-sm text-slate-500 mb-3">A importação mescla com os dados atuais (o registro mais recente vence).</p>
   <div class="flex gap-2 flex-wrap"><button class="btn" data-a="export-json">Exportar JSON</button><button class="btn" data-a="import-json">Importar JSON</button><button class="btn" data-a="csv">CSV do mês</button></div></div>`;
}

/* ================= Busca, patrimônio e menu ================= */
const appIcon = () => localStorage.appIcon === 'nostos' ? 'nostos' : 'financas';
async function applyIcon() {
  const k = appIcon(), set = (sel, href) => { const e = document.querySelector(sel); if (e) e.href = href; };
  set('link[rel="icon"]', `ic-${k}-192.png`); set('link[rel="apple-touch-icon"]', `ic-${k}-180.png`);
  document.querySelectorAll('.app-logo').forEach(i => { i.src = `ic-${k}-192.png`; });
  if (k === 'financas') return set('link[rel="manifest"]', 'manifest.json');
  try { // manifesto dinâmico: nome e ícone usados na INSTALAÇÃO acompanham a escolha
    const m = await (await fetch('manifest.json')).json(), abs = u => new URL(u, location.href).href;
    m.name = m.short_name = 'Nostos'; m.start_url = abs(m.start_url); m.scope = abs(m.scope);
    m.icons = [192, 512].map(z => ({ src: abs(`ic-${k}-${z}.png`), sizes: `${z}x${z}`, type: 'image/png', purpose: 'any' }));
    set('link[rel="manifest"]', URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' })));
  } catch {}
}
const closeDrawer = () => { $('#side').classList.remove('open'); $('#scrim').classList.add('hidden'); };
function openSearch() {
  openModal('Buscar transação', `<input id="q" placeholder="Digite parte da descrição..." class="inp" autocomplete="off"><div id="qres" class="max-h-[55vh] overflow-y-auto"></div>`, null, true);
  const run = () => { const q = $('#q').value.trim().toLowerCase(), r = q ? S.tx.filter(t => t.description.toLowerCase().includes(q)).sort(byDesc).slice(0, 60) : [];
    $('#qres').innerHTML = r.map(t => `<button type="button" data-a="edit-tx" data-id="${t.id}" class="w-full flex items-center gap-3 py-2 text-left border-b border-slate-200 dark:border-[#26233d]"><span class="flex-1 min-w-0"><span class="block text-sm truncate">${esc(t.description)}</span><span class="block text-[11px] text-neutral-500">${fdate(t.date)} · ${esc(t.type === 'transfer' ? 'Transferência' : cat(t.categoryId).name)}</span></span><b class="text-sm ${t.type === 'income' ? 'text-emerald-400' : t.type === 'expense' ? 'text-rose-400' : ''}">${brl(t.amount)}</b></button>`).join('') || `<p class="text-sm text-neutral-500 py-3">${q ? 'Nada encontrado.' : 'A busca vale para todas as datas.'}</p>`; };
  $('#q').oninput = run; run(); $('#q').focus();
}
function subPatr() {
  const row = (n, sub, v, k, id) => `<div class="card !p-3 flex items-center gap-3 mb-2"><div class="flex-1 min-w-0"><p class="font-medium truncate">${esc(n)}</p><p class="text-xs text-neutral-400">${sub}</p></div><b>${brl(v)}</b><button data-a="edit-${k}" data-id="${id}" aria-label="Editar">${ic('pencil', 'w-4 h-4')}</button><button data-a="del-${k}" data-id="${id}" aria-label="Excluir">${ic('trash', 'w-4 h-4')}</button></div>`;
  $('#sub').innerHTML = `<div class="grid md:grid-cols-2 gap-6"><div><div class="flex justify-between items-center mb-3"><h3 class="font-semibold">Bens</h3><button data-a="new-asset" class="btn btn-p !py-1 text-xs">+ Bem</button></div>${S.asset.map(a => row(a.name, a.type, a.value, 'asset', a.id)).join('') || '<p class="text-sm text-neutral-500">Imóveis, veículos e outros bens entram no patrimônio líquido.</p>'}</div>
  <div><div class="flex justify-between items-center mb-3"><h3 class="font-semibold">Dívidas e financiamentos</h3><button data-a="new-debt" class="btn btn-p !py-1 text-xs">+ Dívida</button></div>${S.debt.map(d => row(d.name, `${d.n}x · ${d.rate}% a.m. · saldo atual`, debtBal(d, nowDate().slice(0, 7)), 'debt', d.id)).join('') || '<p class="text-sm text-neutral-500">Alimentam o gráfico de amortização e reduzem o patrimônio.</p>'}</div></div>`;
}
function assetForm(a = {}) {
  openModal(a.id ? 'Editar bem' : 'Novo bem', `${fld('Nome', `<input name="name" required class="inp" value="${esc(a.name || '')}">`)}${fld('Tipo', `<select name="type" class="inp">${opts(['Imóvel', 'Veículo', 'Outro'].map(x => [x, x]), a.type)}</select>`)}${fld('Valor atual (R$)', `<input name="value" type="number" step="0.01" min="0" required class="inp" value="${a.value ?? ''}">`)}`,
    d => DB.put('assets', { ...a, id: a.id || uid(), name: d.name.trim(), type: d.type, value: parseFloat(d.value) }).then(() => true));
}
function debtForm(x = {}) {
  openModal(x.id ? 'Editar dívida' : 'Nova dívida', `${fld('Nome', `<input name="name" required class="inp" value="${esc(x.name || '')}">`)}${fld('Valor financiado (R$)', `<input name="principal" type="number" step="0.01" min="1" required class="inp" value="${x.principal ?? ''}">`)}
   ${fld('Juros ao mês (%)', `<input name="rate" type="number" step="0.01" min="0" required class="inp" value="${x.rate ?? 1}">`)}${fld('Nº de parcelas', `<input name="n" type="number" min="1" max="600" required class="inp" value="${x.n ?? 12}">`)}${fld('Mês da 1ª parcela', `<input name="start" type="month" required class="inp" value="${x.start || nowDate().slice(0, 7)}">`)}`,
    d => DB.put('debts', { ...x, id: x.id || uid(), name: d.name.trim(), principal: parseFloat(d.principal), rate: parseFloat(d.rate), n: +d.n, start: d.start }).then(() => true));
}
function subMenu() {
  const cur = bnav();
  $('#sub').innerHTML = `<div class="card max-w-xl"><h3 class="font-semibold mb-1">Barra inferior</h3><p class="text-sm text-neutral-500 mb-3">Celular na vertical: escolha de 2 a 5 atalhos. O menu completo fica no botão no canto superior esquerdo.</p>${NAV.map(([v, i, l]) => `<label class="flex items-center gap-3 py-2"><input type="checkbox" data-bn="${v}" ${cur.includes(v) ? 'checked' : ''}>${ic(i, 'w-4 h-4')}<span>${l}</span></label>`).join('')}</div>`;
  $('#sub').onchange = e => { const v = e.target.dataset.bn; if (!v) return; let c = bnav(); c = e.target.checked ? [...c, v] : c.filter(x => x !== v);
    if (c.length < 2 || c.length > 5) { alert('Escolha de 2 a 5 itens.'); return subMenu(); }
    localStorage.bnav = JSON.stringify(NAV.map(n => n[0]).filter(x => c.includes(x))); buildNav(); render(); };
}

/* ================= Modal e formulários ================= */
function openModal(title, body, onSubmit, ro) {
  const m = $('#modal');
  m.innerHTML = `<form class="bg-white dark:bg-[#12101f] w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-y-auto space-y-3">
    <h2 class="text-lg font-semibold">${title}</h2>${body}
    <div class="flex gap-2 pt-2"><button type="button" data-a="close" class="btn flex-1">${ro ? 'Fechar' : 'Cancelar'}</button>${ro ? '' : '<button class="btn btn-p flex-1">Salvar</button>'}</div></form>`;
  m.classList.remove('hidden');
  const f = $('form', m);
  f.onsubmit = async e => { e.preventDefault(); if (onSubmit && (await onSubmit(Object.fromEntries(new FormData(f)))) !== false) closeModal(); };
  return f;
}
const closeModal = () => $('#modal').classList.add('hidden');

function txForm(t = {}) {
  const isNew = !t.id, type = t.type || 'expense';
  const f = openModal(isNew ? 'Nova transação' : 'Editar transação', `
    <div class="grid grid-cols-3 gap-1">${[['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']].map(([v, l]) =>
      `<label class="text-center"><input type="radio" name="type" value="${v}" class="peer hidden" ${v === type ? 'checked' : ''}><span class="block py-2 rounded-lg border border-slate-300 dark:border-[#312e4a] cursor-pointer text-sm peer-checked:bg-violet-500 peer-checked:text-white">${l}</span></label>`).join('')}</div>
    ${fld('Valor (R$)', `<input name="amount" type="number" step="0.01" min="0.01" required class="inp" value="${t.amount ?? ''}">`)}
    ${fld('Descrição', `<input name="description" required class="inp" value="${esc(t.description || '')}">`)}
    ${fld('Data', `<input name="date" type="date" required class="inp" value="${t.date || nowDate()}">`)}
    <div class="cw">${fld('Categoria', `<select name="categoryId" class="inp"></select>`)}</div>
    ${fld('Conta / carteira', `<select name="accountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), t.accountId)}</select>`)}
    <div class="tw hidden">${fld('Conta de destino', `<select name="toAccountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), t.toAccountId)}</select>`)}</div>
    <div class="xw hidden">${fld('Pagar com cartão de crédito', `<select name="cardId" class="inp"><option value="">Não, usar a conta</option>${opts(S.card.map(c => [c.id, c.name]), t.cardId)}</select>`)}</div>
    ${fld('Status', `<select name="status" class="inp">${opts([['paid', 'Pago'], ['pending', 'Pendente']], t.status || 'paid')}</select>`)}
    ${isNew ? `${fld('Recorrência', `<select name="recurrence" class="inp">${opts([['once', 'Única'], ['monthly', 'Fixa mensal'], ['installment', 'Parcelada (valor total dividido)']], 'once')}</select>`)}
      <div class="nw hidden">${fld('Nº de meses / parcelas', `<input name="count" type="number" min="2" max="360" value="12" class="inp">`)}</div>` : ''}`,
    async d => {
      const amount = parseFloat(d.amount), tr = d.type === 'transfer';
      if (tr && d.accountId === d.toAccountId) { alert('Escolha contas diferentes para a transferência.'); return false; }
      const base = { type: d.type, description: d.description.trim(), accountId: d.accountId, toAccountId: tr ? d.toAccountId : null, categoryId: tr ? null : d.categoryId, status: d.status };
      if (!isNew) return void await DB.put('transactions', { ...t, ...base, amount, date: d.date });
      const n = d.recurrence === 'once' ? 1 : Math.max(2, parseInt(d.count) || 2), gid = uid(), inst = d.recurrence === 'installment';
      for (let i = 0; i < n; i++) {
        let a = amount;
        if (inst) { a = Math.round(amount / n * 100) / 100; if (i === n - 1) a = Math.round((amount - Math.round(amount / n * 100) / 100 * (n - 1)) * 100) / 100; }
        await DB.put('transactions', { ...base, id: uid(), groupId: n > 1 ? gid : null, amount: a, date: addMonths(d.date, i),
          description: inst ? `${base.description} (${i + 1}/${n})` : base.description, status: i === 0 ? d.status : 'pending' });
      }
    });
  const upd = rb => {
    const ty = f.elements.type.value, tr = ty === 'transfer';
    $('.cw', f).classList.toggle('hidden', tr); $('.tw', f).classList.toggle('hidden', !tr); $('.xw', f).classList.toggle('hidden', ty !== 'expense');
    if (rb) f.elements.categoryId.innerHTML = opts(S.cat.filter(c => c.type === ty).map(c => [c.id, c.name]), t.categoryId);
    if (isNew) $('.nw', f).classList.toggle('hidden', f.elements.recurrence.value === 'once');
  };
  f.addEventListener('change', e => upd(e.target.name === 'type')); upd(true); // só recria as categorias ao trocar o TIPO (antes resetava a escolha)
}

function accForm(a = {}) {
  openModal(a.id ? 'Editar conta' : 'Nova conta', `
    ${fld('Nome', `<input name="name" required class="inp" value="${esc(a.name || '')}">`)}
    ${fld('Tipo', `<select name="type" class="inp">${opts(['Conta Corrente', 'Carteira', 'Poupança', 'Investimentos', 'Cartão de crédito'].map(x => [x, x]), a.type)}</select>`)}
    ${fld('Saldo inicial (R$)', `<input name="initial" type="number" step="0.01" class="inp" value="${a.initial ?? 0}">`)}`,
    d => DB.put('accounts', { ...a, id: a.id || uid(), name: d.name.trim(), type: d.type, initial: parseFloat(d.initial) || 0 }).then(() => true));
}
function catForm(c = {}) {
  openModal(c.id ? 'Editar categoria' : 'Nova categoria', `
    ${fld('Nome', `<input name="name" required class="inp" value="${esc(c.name || '')}">`)}
    ${fld('Ícone', `<select name="icon" class="inp">${opts(CATIC, catIc(c))}</select>`)}
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="passive" ${c.passive ? 'checked' : ''}> Renda passiva (dividendos, juros, aluguéis)</label>
    ${fld('Cor', `<input name="color" type="color" class="inp !h-10 !p-1" value="${c.color || '#10b981'}">`)}
    ${fld('Tipo', `<select name="type" class="inp">${opts([['expense', 'Despesa'], ['income', 'Receita']], c.type)}</select>`)}`,
    d => DB.put('categories', { ...c, id: c.id || uid(), name: d.name.trim(), icon: d.icon, color: d.color, type: d.type, passive: !!d.passive }).then(() => true));
}

/* ================= Backup ================= */
function csv() {
  const T = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
  const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Valor', 'Status']];
  inMonth(S.month).sort((a, b) => a.date.localeCompare(b.date)).forEach(t => rows.push([
    fdate(t.date), T[t.type], t.description, t.type === 'transfer' ? '' : cat(t.categoryId).name, accName(t.accountId),
    t.toAccountId ? accName(t.toAccountId) : '', t.amount.toFixed(2).replace('.', ','), t.status === 'paid' ? 'Pago' : 'Pendente']));
  // BOM + ";" para abrir corretamente no Excel em pt-BR
  download(`financas_${S.month}.csv`, '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv');
}

/* ================= Eventos ================= */
const delGuard = (id, what) => S.tx.some(t => t.accountId === id || t.toAccountId === id || t.categoryId === id) ? (alert(`Não é possível excluir: ${what} possui transações.`), true) : false;

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const { a, id } = b.dataset;
  const tx = S.tx.find(x => x.id === id);
  switch (a) {
    case 'nav': closeDrawer(); S.view = id; S.ftype = S.fcat = ''; render(); scrollTo(0, 0); break;
    case 'new-tx': txForm(); break;
    case 'edit-tx': txForm(tx); break;
    case 'del-tx': if (confirm('Excluir esta transação?')) await DB.remove('transactions', id); break;
    case 'toggle': await DB.put('transactions', { ...tx, status: tx.status === 'paid' ? 'pending' : 'paid' }); break;
    case 'new-acc': accForm(); break;
    case 'edit-acc': accForm(S.acc.find(x => x.id === id)); break;
    case 'del-acc': if (!delGuard(id, 'esta conta') && confirm('Excluir esta conta?')) await DB.remove('accounts', id); break;
    case 'new-cat': catForm(); break;
    case 'edit-cat': catForm(S.cat.find(x => x.id === id)); break;
    case 'del-cat': if (!delGuard(id, 'esta categoria') && confirm('Excluir esta categoria?')) await DB.remove('categories', id); break;
    case 'go': S.view = b.dataset.v; S.ftype = b.dataset.t || ''; S.fcat = b.dataset.c || ''; render(); scrollTo(0, 0); break;
    case 'ftype': S.ftype = id; render(); break;
    case 'fcat': S.fcat = id; render(); break;
    case 'sub': S.view = 'settings'; S.sub = id; render(); break;
    case 'card': cardDetail(id); break;
    case 'new-card': cardForm(); break;
    case 'edit-card': cardForm(S.card.find(x => x.id === id)); break;
    case 'del-card': if (S.tx.some(t => t.cardId === id)) alert('Este cartão possui lançamentos.'); else if (confirm('Excluir cartão?')) { await DB.remove('cards', id); closeModal(); } break;
    case 'card-buy': txForm({ type: 'expense', cardId: id }); break;
    case 'card-pay': payForm(id); break;
    case 'new-transfer': txForm({ type: 'transfer', accountId: id }); break;
    case 'new-hold': holdForm(); break;
    case 'edit-hold': holdForm(S.hold.find(x => x.id === id)); break;
    case 'del-hold': if (confirm('Excluir ativo?')) { await DB.remove('holdings', id); closeModal(); } break;
    case 'new-goal': goalForm(); break;
    case 'edit-goal': goalForm(S.goal.find(x => x.id === id)); break;
    case 'del-goal': if (confirm('Excluir meta?')) await DB.remove('goals', id); break;
    case 'drawer': $('#side').classList.toggle('open'); $('#scrim').classList.toggle('hidden'); break;
    case 'search': openSearch(); break;
    case 'day': { const it = S.tx.filter(t => t.date === id).sort((a, c) => c.amount - a.amount); openModal(fdate(id), `<div>${it.map(t => `<button type="button" data-a="edit-tx" data-id="${t.id}" class="w-full flex justify-between py-2 text-sm text-left border-b border-slate-200 dark:border-[#26233d]"><span>${esc(t.description)}</span><b>${brl(t.amount)}</b></button>`).join('') || '<p class="text-sm text-neutral-500">Sem lançamentos neste dia.</p>'}</div>`, null, true); break; }
    case 'new-asset': assetForm(); break;
    case 'edit-asset': assetForm(S.asset.find(x => x.id === id)); break;
    case 'del-asset': if (confirm('Excluir bem?')) await DB.remove('assets', id); break;
    case 'new-debt': debtForm(); break;
    case 'edit-debt': debtForm(S.debt.find(x => x.id === id)); break;
    case 'del-debt': if (confirm('Excluir dívida?')) await DB.remove('debts', id); break;
    case 'icon': localStorage.appIcon = id; applyIcon(); render(); break;
    case 'close': closeModal(); break;
    case 'theme': localStorage.theme = { auto: 'light', light: 'dark', dark: 'auto' }[localStorage.theme || 'dark']; applyTheme(); render(); break;
    case 'signin': S.view = 'settings'; S.sub = 'integracoes'; render(); break;
    case 'signout': Sync.signOut(); break;
    case 'sync': Sync.sync(); break;
    case 'export-json': download(`financas_backup_${nowDate()}.json`, JSON.stringify(await DB.snapshot(), null, 2), 'application/json'); break;
    case 'import-json': $('#imp').click(); break;
    case 'csv': csv(); break;
  }
});

$('#imp').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.transactions)) throw new Error('formato');
    await DB.merge(data); await DB.markDirty(); await load(); render(); Sync.sync();
    alert('Backup importado.');
  } catch { alert('Arquivo inválido. Use um JSON exportado por este app.'); }
  e.target.value = '';
});
$('#month').addEventListener('change', e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) { S.month = e.target.value; render(); } });
document.addEventListener('change', e => { if (e.target.id === 'mp') localStorage.metaPoup = e.target.value; if (e.target.id === 'mr') localStorage.metaRunway = e.target.value; });
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('db:change', async () => { await load(); render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(); });

/* ================= Inicialização ================= */
(async () => {
  await DB.open(); await seed(); await load();
  applyTheme(); buildNav(); applyIcon();
  $('#month').value = S.month;
  if ($('#month').type !== 'month') $('#month').placeholder = 'AAAA-MM'; // Firefox desktop não tem input month
  Sync.onStatus(paintStatus); paintStatus(Sync.getStatus());
  render();
  Sync.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
})();
