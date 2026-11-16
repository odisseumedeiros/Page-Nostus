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
const S = { tx: [], acc: [], cat: [], card: [], hold: [], goal: [], ftype: '', fcat: '', sub: 'geral', view: 'dashboard', month: nowDate().slice(0, 7), charts: [] };
const NAV = [['dashboard', '📊', 'Dashboard', 'MENU PRINCIPAL'], ['cards', '💳', 'Cartões', 'MENU PRINCIPAL'], ['transfers', '🔁', 'Transferências', 'MENU PRINCIPAL'], ['transactions', '💸', 'Transações', 'MENU PRINCIPAL'], ['payments', '🧾', 'Pagamentos', 'MENU PRINCIPAL'], ['investments', '📈', 'Investimentos', 'MENU PRINCIPAL'], ['analytics', '📉', 'Analytics', 'SISTEMA'], ['settings', '⚙️', 'Configurações', 'SISTEMA']];
// IDs fixos nas categorias padrão evitam duplicatas ao sincronizar vários dispositivos.
const CATS = [
  ['moradia', 'Moradia', '🏠', '#6366f1', 'expense'], ['alimentacao', 'Alimentação', '🍽️', '#f59e0b', 'expense'],
  ['transporte', 'Transporte', '🚗', '#0ea5e9', 'expense'], ['lazer', 'Lazer', '🎉', '#ec4899', 'expense'],
  ['saude', 'Saúde', '💊', '#ef4444', 'expense'], ['educacao', 'Educação', '📚', '#8b5cf6', 'expense'],
  ['outros_d', 'Outros', '🧾', '#64748b', 'expense'], ['salario', 'Salário', '💰', '#10b981', 'income'],
  ['investimentos', 'Investimentos', '📈', '#14b8a6', 'income'], ['outros_r', 'Outras receitas', '➕', '#84cc16', 'income']
];

async function seed() {
  if (!(await DB.raw('categories')).length)
    for (const c of CATS) await DB.put('categories', { id: 'cat_' + c[0], name: c[1], icon: c[2], color: c[3], type: c[4], lastModified: 1 }, true);
  if (!(await DB.raw('accounts')).length)
    await DB.put('accounts', { id: 'acc_carteira', name: 'Carteira', type: 'Carteira', initial: 0, lastModified: 1 }, true);
}
async function load() {
  [S.tx, S.acc, S.cat, S.card, S.hold, S.goal] = await Promise.all(['transactions', 'accounts', 'categories', 'cards', 'holdings', 'goals'].map(s => DB.list(s)));
}

/* ================= Cálculos ================= */
const cat = id => S.cat.find(c => c.id === id) || { name: '—', icon: '❔', color: '#94a3b8' };
const accName = id => S.acc.find(a => a.id === id)?.name || '—';
// Saldo = saldo inicial + movimentações PAGAS vinculadas à conta (transferência sai de uma e entra na outra).
const balance = a => S.tx.filter(t => t.status === 'paid').reduce((s, t) => {
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
  if (window.Chart) { Chart.defaults.color = dark ? '#a3a3a3' : '#475569'; Chart.defaults.borderColor = dark ? '#262626' : '#e2e8f0'; }
};

/* ================= Status da nuvem ================= */
const ST = {
  synced: ['Sincronizado', 'bg-emerald-500'], syncing: ['Sincronizando...', 'bg-amber-500 animate-pulse'],
  offline: ['Offline', 'bg-slate-400'], auth: ['Erro de Autenticação', 'bg-rose-500'],
  signedout: ['Não conectado', 'bg-slate-400'], error: ['Erro ao sincronizar', 'bg-rose-500']
};
function paintStatus(s) {
  const [l, c] = ST[s] || ST.offline, login = s === 'auth' || s === 'signedout';
  $('#sync').innerHTML = `<span class="w-2 h-2 rounded-full ${c}"></span><span>${l}</span>`;
  $('#syncBtn').textContent = login ? 'Configurar' : '↻ Forçar';
  $('#syncBtn').dataset.a = login ? 'signin' : 'sync';
}

/* ================= Navegação / render ================= */
function buildNav() {
  let sec = '';
  $('#side').innerHTML = `<div class="flex items-center gap-2 px-2 py-3 font-bold text-orange-500"><img src="icon.svg" class="w-7 h-7 rounded" alt=""><span class="lbl">Finanças</span></div>` +
    NAV.map(([v, i, l, g]) => { const h = g !== sec ? (sec = g, `<p class="lbl text-[10px] tracking-widest text-neutral-500 px-3 pt-3">${g}</p>`) : ''; return h + `<button data-a="nav" data-id="${v}" title="${l}" class="nav text-left">${i}<span class="lbl">${l}</span></button>`; }).join('');
  $('#bottom').innerHTML = NAV.map(([v, i, l]) => `<button data-a="nav" data-id="${v}" class="nav !flex-col !gap-0 !px-2 !py-2 text-[11px] rounded-none shrink-0 min-w-[72px]"><span class="text-lg">${i}</span>${l}</button>`).join('');
}
function render() {
  S.charts.forEach(c => c.destroy()); S.charts = [];
  document.querySelectorAll('[data-a="nav"]').forEach(b => {
    const on = b.dataset.id === S.view;
    b.classList.toggle('bg-orange-500', on && b.closest('#side')); b.classList.toggle('text-white', on && !!b.closest('#side'));
    b.classList.toggle('text-orange-500', on && !!b.closest('#bottom')); b.classList.toggle('font-semibold', on);
  });
  const hi = () => { const h = new Date().getHours(); return (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + (localStorage.nome ? ', ' + esc(localStorage.nome) : '') + ' 👋'; };
  $('#title').innerHTML = S.view === 'dashboard' ? `${hi()}<span class="block text-xs font-normal text-neutral-400">Veja o que está acontecendo nas suas finanças</span>` : NAV.find(n => n[0] === S.view)[2];
  $('#fab').classList.toggle('hidden', !['dashboard', 'transactions', 'cards', 'payments'].includes(S.view));
  ({ dashboard, transactions, transfers, cards, payments, investments, analytics, settings })[S.view]();
}

/* ================= Views ================= */
const card = (l, v, c) => `<div class="card"><p class="text-xs text-slate-500">${l}</p><p class="text-xl font-bold mt-1 ${c}">${brl(v)}</p></div>`;

const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function dashboard() {
  const mb = i => addMonths(S.month + '-01', -i).slice(0, 7), M6 = [5, 4, 3, 2, 1, 0].map(mb), year = S.month.slice(0, 4);
  const l = inMonth(S.month), rec = sum(l, 'income'), des = sum(l, 'expense'), liq = rec - des, pl = inMonth(mb(1));
  const saldo = S.acc.reduce((s, a) => s + balance(a), 0), pct = (a, b) => b > 0 ? Math.max(0, Math.min(100, Math.round(a / b * 100))) : 0;
  const dl = (c, p, inv) => { if (!p) return '<p class="text-[11px] mt-1 text-neutral-500">sem mês anterior</p>'; const x = (c - p) / Math.abs(p) * 100, g = (x >= 0) !== inv; return `<p class="text-[11px] mt-1 ${g ? 'text-emerald-500' : 'text-rose-500'}">${x >= 0 ? '▲' : '▼'} ${Math.abs(x).toFixed(1).replace('.', ',')}% vs. mês anterior</p>`; };
  const spark = (v, c) => { const mx = Math.max(...v, 1), mn = Math.min(...v, 0), r = mx - mn || 1, p = v.map((x, i) => `${i / (v.length - 1) * 100},${28 - (x - mn) / r * 26}`).join(' '); return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" class="w-full h-8 mt-2"><polygon points="0,30 ${p} 100,30" fill="${c}22"/><polyline points="${p}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`; };
  const ser = f => M6.map(m => f(inMonth(m))); let run = 0; const cum = ser(x => sum(x, 'income') - sum(x, 'expense')).map(v => run += v);
  const kpi = (lb, v, ic, c, d, s, go, t) => `<div data-a="go" data-v="${go}" data-t="${t || ''}" class="card k cursor-pointer hover:border-orange-500"><div class="flex justify-between gap-2"><div><p class="text-xs text-neutral-400">${lb}</p><p class="text-lg md:text-xl font-bold mt-1">${brl(v)}</p>${d}</div><span class="w-9 h-9 shrink-0 rounded-full border flex items-center justify-center" style="border-color:${c}77;color:${c}">${ic}</span></div>${spark(s, c)}</div>`;
  const by = {}; l.filter(t => t.type === 'expense').forEach(t => by[t.categoryId] = (by[t.categoryId] || 0) + t.amount);
  let top = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, n: cat(id).name, v, c: cat(id).color }));
  if (top.length > 5) top = [...top.slice(0, 4), { id: '', n: 'Outras', v: top.slice(4).reduce((s, x) => s + x.v, 0), c: '#78716c' }];
  const rt = [...S.tx].sort(byDesc).slice(0, 5).map(t => { const c = t.type === 'transfer' ? { icon: '🔁', color: '#64748b' } : cat(t.categoryId), col = t.type === 'income' ? 'text-emerald-500' : t.type === 'expense' ? 'text-rose-500' : 'text-neutral-400', sg = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
    return `<div data-a="edit-tx" data-id="${t.id}" class="flex items-center gap-3 py-2 cursor-pointer"><span class="w-9 h-9 rounded-full flex items-center justify-center" style="background:${c.color}33">${c.icon}</span><div class="flex-1 min-w-0"><p class="text-sm truncate">${esc(t.description)}</p><p class="text-[11px] text-neutral-500">${fdate(t.date)}</p></div><div class="text-right"><p class="text-sm font-semibold ${col}">${sg}${brl(t.amount)}</p><p class="text-[11px] ${t.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}">${t.status === 'paid' ? 'Pago' : 'Pendente'}</p></div></div>`; }).join('');
  const gl = S.goal.map(g => { const sp = l.filter(t => t.type === 'expense' && t.categoryId === g.categoryId).reduce((s, t) => s + t.amount, 0); return [`${cat(g.categoryId).icon} ${cat(g.categoryId).name}`, pct(sp, g.limit), g.categoryId]; });
  const paidDes = l.filter(t => t.type === 'expense' && t.status === 'paid').reduce((s, t) => s + t.amount, 0);
  const rows = gl.length ? gl : [['🧾 Despesas sobre receitas', pct(des, rec)], ['💰 Taxa de poupança', liq > 0 ? pct(liq, rec) : 0], ['✅ Despesas já pagas', pct(paidDes, des)]];
  const ins = !l.length ? 'Nenhuma transação neste mês ainda. Toque em + para começar.' : `${liq > 0 ? `Você guardou ${pct(liq, rec)}% da receita deste mês. ` : liq < 0 ? 'As despesas superaram as receitas neste mês. ' : ''}${top[0] ? `Maior gasto: ${top[0].n} (${pct(top[0].v, des)}% das despesas).` : ''}`;
  const dim = new Date(+year, +S.month.slice(5), 0).getDate(); let r2 = 0;
  const cf = Array.from({ length: dim }, (_, i) => { const d = String(i + 1).padStart(2, '0'); return r2 += l.filter(t => t.date.slice(8) === d).reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0); });
  const ym = Array.from({ length: 12 }, (_, i) => inMonth(`${year}-${String(i + 1).padStart(2, '0')}`));
  $('#view').innerHTML = `<div class="dash">
   ${kpi('Saldo atual', saldo, '👛', '#f97316', `<p class="text-[11px] mt-1 text-neutral-500">${S.acc.length} conta(s)</p>`, cum, 'transfers')}
   ${kpi('Receitas do mês', rec, '⬇️', '#22c55e', dl(rec, sum(pl, 'income')), ser(x => sum(x, 'income')), 'transactions', 'income')}
   ${kpi('Despesas do mês', des, '⬆️', '#ef4444', dl(des, sum(pl, 'expense'), true), ser(x => sum(x, 'expense')), 'transactions', 'expense')}
   ${kpi('Balanço líquido', liq, '📈', '#f59e0b', dl(liq, sum(pl, 'income') - sum(pl, 'expense')), ser(x => sum(x, 'income') - sum(x, 'expense')), 'analytics')}
   <div class="card w w7"><div class="flex justify-between items-baseline mb-2"><h3 class="font-semibold">Visão anual · ${year}</h3><span class="text-xs text-neutral-400">toque numa barra para abrir o mês</span></div><div class="h-56"><canvas id="c2"></canvas></div></div>
   <div class="card w w5"><h3 class="font-semibold mb-2">Despesas por categoria</h3><div class="relative h-44"><canvas id="c1"></canvas><div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span class="text-[10px] text-neutral-400">Total</span><b class="text-sm">${brl(des)}</b></div></div>
    <div class="mt-3 space-y-1">${top.map(x => `<div data-a="go" data-v="transactions" data-t="expense" data-c="${x.id}" class="flex items-center gap-2 text-xs cursor-pointer"><span class="w-2 h-2 rounded-full" style="background:${x.c}"></span><span class="flex-1 truncate">${esc(x.n)}</span><span>${brl(x.v)}</span><span class="w-10 text-right text-neutral-400">${pct(x.v, des)}%</span></div>`).join('')}</div></div>
   <div class="card w w4"><h3 class="font-semibold mb-1">Transações recentes</h3>${rt || '<p class="text-sm text-neutral-500">Sem transações.</p>'}<button data-a="nav" data-id="transactions" class="text-xs text-orange-500 mt-1">Ver todas →</button></div>
   <div class="card w w4"><div class="flex justify-between"><h3 class="font-semibold">Fluxo de caixa</h3><b class="text-sm ${cf[dim - 1] >= 0 ? 'text-emerald-500' : 'text-rose-500'}">${brl(cf[dim - 1])}</b></div><div class="h-44"><canvas id="c3"></canvas></div></div>
   <div class="card w w4"><div class="flex justify-between mb-3"><h3 class="font-semibold">${gl.length ? 'Metas do mês' : 'Indicadores do mês'}</h3><button data-a="sub" data-id="metas" class="text-xs text-orange-500">${gl.length ? 'Gerenciar' : 'Criar metas'} →</button></div>
    ${rows.map(([n, p, c]) => `<div ${c ? `data-a="go" data-v="transactions" data-t="expense" data-c="${c}"` : ''} class="mb-3 ${c ? 'cursor-pointer' : ''}"><div class="flex justify-between text-xs mb-1"><span>${esc(n)}</span><b>${p}%</b></div>${bar(p, c && p >= 100)}</div>`).join('')}</div>
   <div class="card w flex flex-wrap items-center gap-3 justify-between"><p class="text-sm flex-1 min-w-[200px]">✨ ${ins}</p><button data-a="nav" data-id="analytics" class="btn">Ver Analytics</button><button data-a="csv" class="btn btn-p">Exportar CSV</button></div></div>`;
  if (!window.Chart) return;
  S.charts.push(new Chart($('#c1'), { type: 'doughnut', data: { labels: top.map(x => x.n), datasets: [{ data: top.map(x => x.v), backgroundColor: top.map(x => x.c), borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.parsed)}` } } }, onClick: (e, el) => { if (el.length && top[el[0].index].id) { S.view = 'transactions'; S.ftype = 'expense'; S.fcat = top[el[0].index].id; render(); } } } }));
  S.charts.push(new Chart($('#c2'), { type: 'bar', data: { labels: MES, datasets: [{ label: 'Receitas', data: ym.map(x => sum(x, 'income')), backgroundColor: '#f97316' }, { label: 'Despesas', data: ym.map(x => sum(x, 'expense')), backgroundColor: '#57534e' }] },
    options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${brl(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: v => brl(v) } } }, onClick: (e, el) => { if (el.length) { S.month = `${year}-${String(el[0].index + 1).padStart(2, '0')}`; $('#month').value = S.month; render(); } } } }));
  S.charts.push(new Chart($('#c3'), { type: 'line', data: { labels: cf.map((_, i) => i + 1), datasets: [{ data: cf, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.2)', fill: true, tension: .35, pointRadius: 0 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + brl(c.parsed.y) } } }, scales: { x: { ticks: { maxTicksLimit: 6 } }, y: { ticks: { callback: v => brl(v) } } } } }));
}

function txRow(t) {
  const tr = t.type === 'transfer', c = tr ? { icon: '🔁', color: '#64748b', name: 'Transferência' } : cat(t.categoryId), paid = t.status === 'paid';
  const col = t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-600' : 'text-slate-500';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  return `<div class="card !p-3 flex items-center gap-3">
    <div class="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style="background:${c.color}22">${c.icon}</div>
    <div class="min-w-0 flex-1"><p class="font-medium truncate">${esc(t.description)}</p>
      <p class="text-xs text-slate-500 truncate">${fdate(t.date)} · ${esc(c.name)} · ${esc(t.cardId && !tr ? '💳 ' + cardName(t.cardId) : accName(t.accountId))}${tr ? ' → ' + esc(t.cardId ? '💳 ' + cardName(t.cardId) : t.invest ? '📈 Investimentos' : accName(t.toAccountId)) : ''}</p></div>
    <div class="text-right"><p class="font-semibold ${col}">${sign}${brl(t.amount)}</p>
      <button data-a="toggle" data-id="${t.id}" class="text-xs px-2 rounded-full ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${paid ? 'Pago' : 'Pendente'}</button></div>
    <div class="flex flex-col"><button data-a="edit-tx" data-id="${t.id}" aria-label="Editar">✏️</button><button data-a="del-tx" data-id="${t.id}" aria-label="Excluir">🗑️</button></div></div>`;
}
function transactions() {
  const l = inMonth(S.month).filter(t => (!S.ftype || t.type === S.ftype) && (!S.fcat || t.categoryId === S.fcat)).sort(byDesc);
  const chip = (v, lb) => `<button data-a="ftype" data-id="${v}" class="btn !py-1 text-xs ${S.ftype === v ? 'btn-p' : ''}">${lb}</button>`;
  $('#view').innerHTML = `<div class="flex gap-2 flex-wrap mb-3 items-center">${chip('', 'Todas')}${chip('income', 'Receitas')}${chip('expense', 'Despesas')}${chip('transfer', 'Transferências')}${S.fcat ? `<button data-a="fcat" data-id="" class="btn !py-1 text-xs btn-p">${esc(cat(S.fcat).name)} ✕</button>` : ''}</div>
  <div class="space-y-2">${l.map(txRow).join('') || '<p class="text-center text-slate-500 py-10">Nenhuma transação com estes filtros. Toque em + para adicionar.</p>'}</div>`;
}

function accounts() {
  $('#sub').innerHTML = `<button data-a="new-acc" class="btn btn-p mb-3">+ Nova conta</button>
  <div class="grid sm:grid-cols-2 gap-3">${S.acc.map(a => { const b = balance(a); return `<div class="card flex items-center gap-3">
    <div class="flex-1"><p class="font-semibold">${esc(a.name)}</p><p class="text-xs text-slate-500">${esc(a.type)}</p>
    <p class="text-lg font-bold mt-1 ${b < 0 ? 'text-rose-600' : ''}">${brl(b)}</p></div>
    <button data-a="edit-acc" data-id="${a.id}" aria-label="Editar">✏️</button><button data-a="del-acc" data-id="${a.id}" aria-label="Excluir">🗑️</button></div>`; }).join('')}</div>`;
}

function categories() {
  const grp = (type, t) => `<h3 class="font-semibold mt-4 mb-2">${t}</h3><div class="grid sm:grid-cols-2 gap-2">${S.cat.filter(c => c.type === type).map(c =>
    `<div class="card !p-3 flex items-center gap-3"><span class="w-9 h-9 rounded-full flex items-center justify-center" style="background:${c.color}33">${c.icon}</span>
    <span class="flex-1">${esc(c.name)}</span><button data-a="edit-cat" data-id="${c.id}" aria-label="Editar">✏️</button><button data-a="del-cat" data-id="${c.id}" aria-label="Excluir">🗑️</button></div>`).join('')}</div>`;
  $('#sub').innerHTML = `<button data-a="new-cat" class="btn btn-p">+ Nova categoria</button>${grp('expense', 'Despesas')}${grp('income', 'Receitas')}`;
}

/* ================= Novas abas ================= */
const cardName = id => S.card.find(c => c.id === id)?.name || '—';
const cardTx = c => S.tx.filter(t => t.cardId === c.id);
const fMonth = (t, c) => +t.date.slice(8) > (c.closing || 31) ? addMonths(t.date, 1).slice(0, 7) : t.date.slice(0, 7); // compra após o fechamento vai p/ a próxima fatura
const used = c => cardTx(c).reduce((s, t) => s + (t.type === 'expense' ? t.amount : -t.amount), 0);
const fatura = (c, m) => cardTx(c).filter(t => t.type === 'expense' && fMonth(t, c) === m).reduce((s, t) => s + t.amount, 0);
const faturaPaga = (c, m) => cardTx(c).filter(t => t.type === 'transfer' && t.ref === m).reduce((s, t) => s + t.amount, 0);
const bar = (p, red) => `<div class="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800"><div class="h-2 rounded-full ${red ? 'bg-rose-500' : 'bg-orange-500'}" style="width:${p}%"></div></div>`;
const byDesc = (a, b) => b.date.localeCompare(a.date);

function transfers() {
  const l = inMonth(S.month).filter(t => t.type === 'transfer').sort(byDesc);
  $('#view').innerHTML = `<button data-a="new-transfer" class="btn btn-p mb-3">+ Nova transferência</button>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">${S.acc.map(a => `<div data-a="new-transfer" data-id="${a.id}" class="card cursor-pointer hover:border-orange-500"><p class="text-xs text-neutral-400">${esc(a.name)}</p><p class="font-bold">${brl(balance(a))}</p><p class="text-[11px] text-orange-500">Transferir daqui →</p></div>`).join('')}</div>
  <div class="space-y-2">${l.map(txRow).join('') || '<p class="text-center text-neutral-500 py-8">Nenhuma transferência neste mês.</p>'}</div>`;
}

function cards() {
  $('#view').innerHTML = `<button data-a="new-card" class="btn btn-p mb-3">+ Novo cartão</button><div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">${S.card.map(c => {
    const u = used(c), p = Math.min(100, Math.round(u / c.limit * 100)) || 0;
    return `<div data-a="card" data-id="${c.id}" class="card cursor-pointer hover:border-orange-500"><div class="flex justify-between"><b>💳 ${esc(c.name)}</b><span class="text-xs text-neutral-400">fecha dia ${c.closing} · vence dia ${c.due}</span></div>
    <p class="text-xs text-neutral-400 mt-3">Fatura ${S.month.split('-').reverse().join('/')}</p><p class="text-xl font-bold mb-3">${brl(fatura(c, S.month))}</p>${bar(p, p > 85)}
    <p class="text-xs text-neutral-400 mt-1">Usado ${brl(u)} de ${brl(c.limit)} · disponível ${brl(c.limit - u)}</p></div>`; }).join('') || '<p class="text-neutral-500">Nenhum cartão cadastrado. Toque em "+ Novo cartão".</p>'}</div>`;
}
function cardDetail(id) {
  const c = S.card.find(x => x.id === id), m = S.month, f = fatura(c, m), pg = faturaPaga(c, m);
  const it = cardTx(c).filter(t => t.type === 'expense' && fMonth(t, c) === m).sort(byDesc);
  openModal('💳 ' + esc(c.name), `<p class="text-sm text-neutral-400">Fatura ${m.split('-').reverse().join('/')} · vence dia ${c.due} (muda com o filtro de mês)</p>
   <p class="text-2xl font-bold">${brl(f)} <span class="text-xs font-normal text-neutral-400">pago ${brl(pg)}</span></p>
   <div class="flex gap-2 flex-wrap"><button type="button" data-a="card-buy" data-id="${id}" class="btn btn-p">+ Compra</button><button type="button" data-a="card-pay" data-id="${id}" class="btn">Pagar fatura</button><button type="button" data-a="edit-card" data-id="${id}" class="btn">Editar</button><button type="button" data-a="del-card" data-id="${id}" class="btn">Excluir</button></div>
   <div>${it.map(t => `<button type="button" data-a="edit-tx" data-id="${t.id}" class="w-full flex justify-between py-2 text-sm text-left border-b border-neutral-200 dark:border-neutral-800"><span>${fdate(t.date)} · ${esc(t.description)}</span><b>${brl(t.amount)}</b></button>`).join('') || '<p class="text-sm text-neutral-500 py-2">Sem compras nesta fatura.</p>'}</div>`, null, true);
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
  $('#view').innerHTML = `<div class="grid grid-cols-3 gap-3 mb-4">${[['Em atraso', atras, 'text-rose-500'], ['A pagar no mês', mes, 'text-amber-500'], ['Faturas abertas', fats.reduce((s, x) => s + x[1], 0), 'text-orange-500']].map(([l, v, c]) => `<div class="card"><p class="text-xs text-neutral-400">${l}</p><p class="font-bold ${c}">${brl(v)}</p></div>`).join('')}</div>
  <div class="space-y-2">${fats.map(([c, v]) => `<div data-a="card" data-id="${c.id}" class="card !p-3 flex items-center gap-3 cursor-pointer hover:border-orange-500"><span class="text-xl">💳</span><div class="flex-1"><p class="font-medium">Fatura ${esc(c.name)}</p><p class="text-xs text-neutral-500">vence dia ${c.due}</p></div><b>${brl(v)}</b></div>`).join('')}
  ${pend.map(t => `<div class="card !p-3 flex items-center gap-3"><div data-a="edit-tx" data-id="${t.id}" class="flex-1 cursor-pointer"><p class="font-medium">${esc(t.description)}</p><p class="text-xs ${t.date < hoje ? 'text-rose-500' : 'text-neutral-500'}">${t.date < hoje ? 'Atrasada · ' : ''}${fdate(t.date)} · ${esc(cat(t.categoryId).name)}</p></div><b>${brl(t.amount)}</b><button data-a="toggle" data-id="${t.id}" class="btn btn-p !py-1 text-xs">Pagar</button></div>`).join('')}
  ${!fats.length && !pend.length ? '<p class="text-center text-neutral-500 py-8">Nada pendente. 🎉</p>' : ''}</div>`;
}

const CLS = ['Ações', 'FIIs', 'Cripto', 'Fundos', 'Renda fixa', 'Outros'], CCOL = ['#f97316', '#eab308', '#a855f7', '#0ea5e9', '#22c55e', '#78716c'];
const hv = h => h.qty * h.price, hc = h => h.qty * h.avg;
function investments() {
  const tot = S.hold.reduce((s, h) => s + hv(h), 0), cost = S.hold.reduce((s, h) => s + hc(h), 0), pl = tot - cost;
  const g = CLS.map((n, i) => [n, S.hold.filter(h => h.cls === n).reduce((s, h) => s + hv(h), 0), CCOL[i]]).filter(x => x[1] > 0);
  const k = (l, v, c) => `<div class="card"><p class="text-xs text-neutral-400">${l}</p><p class="text-lg font-bold ${c || ''}">${v}</p></div>`;
  $('#view').innerHTML = `<button data-a="new-hold" class="btn btn-p mb-3">+ Novo ativo</button>
  <div class="grid grid-cols-3 gap-3 mb-4">${k('Patrimônio', brl(tot))}${k('Custo', brl(cost))}${k('Resultado', `${brl(pl)} (${cost ? (pl / cost * 100).toFixed(1).replace('.', ',') : '0'}%)`, pl >= 0 ? 'text-emerald-500' : 'text-rose-500')}</div>
  <div class="dash"><div class="card w w4"><h3 class="font-semibold mb-2">Alocação</h3><div class="h-44"><canvas id="i1"></canvas></div>${g.map(x => `<div class="flex items-center gap-2 text-xs mt-1"><span class="w-2 h-2 rounded-full" style="background:${x[2]}"></span><span class="flex-1">${x[0]}</span><b>${tot ? Math.round(x[1] / tot * 100) : 0}%</b></div>`).join('')}</div>
  <div class="card w w7 !p-3 space-y-1"><h3 class="font-semibold px-1">Ativos <span class="text-xs font-normal text-neutral-400">(toque para atualizar a cotação)</span></h3>${[...S.hold].sort((a, b) => hv(b) - hv(a)).map(h => { const p = hv(h) - hc(h); return `<div data-a="edit-hold" data-id="${h.id}" class="flex items-center gap-3 py-2 px-1 border-b border-neutral-200 dark:border-neutral-800 cursor-pointer"><div class="flex-1"><b>${esc(h.ticker)}</b> <span class="text-xs text-neutral-400">${h.cls} · ${h.qty} un.</span></div><div class="text-right"><p class="font-semibold">${brl(hv(h))}</p><p class="text-xs ${p >= 0 ? 'text-emerald-500' : 'text-rose-500'}">${brl(p)}</p></div></div>`; }).join('') || '<p class="text-sm text-neutral-500 p-2">Nenhum ativo cadastrado.</p>'}</div></div>`;
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
      if (nw && d.from) await DB.put('transactions', { id: uid(), type: 'transfer', invest: true, description: 'Aporte ' + o.ticker, amount: Math.round(o.qty * o.avg * 100) / 100, date: nowDate(), accountId: d.from, toAccountId: null, categoryId: null, status: 'paid' });
    });
}

function analytics() {
  const year = S.month.slice(0, 4), pm = addMonths(S.month + '-01', -1).slice(0, 7);
  const agg = m => { const o = {}; inMonth(m).filter(t => t.type === 'expense').forEach(t => o[t.categoryId] = (o[t.categoryId] || 0) + t.amount); return o; };
  const cur = agg(S.month), prv = agg(pm), ids = [...new Set([...Object.keys(cur), ...Object.keys(prv)])].sort((a, b) => (cur[b] || 0) - (cur[a] || 0));
  const mons = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`), net = mons.map(m => { const x = inMonth(m); return sum(x, 'income') - sum(x, 'expense'); }), top = ids.filter(i => cur[i]).slice(0, 8);
  $('#view').innerHTML = `<div class="dash"><div class="card w w7"><h3 class="font-semibold mb-2">Resultado mensal ${year} <span class="text-xs font-normal text-neutral-400">(toque numa barra para abrir o mês)</span></h3><div class="h-60"><canvas id="a1"></canvas></div></div>
  <div class="card w w5"><h3 class="font-semibold mb-2">Maiores categorias do mês</h3><div class="h-60"><canvas id="a2"></canvas></div></div>
  <div class="card w"><h3 class="font-semibold mb-2">Comparativo com o mês anterior</h3>${ids.map(id => { const c = cur[id] || 0, p = prv[id] || 0, x = p ? (c - p) / p * 100 : null; return `<div data-a="go" data-v="transactions" data-t="expense" data-c="${id}" class="flex items-center gap-3 py-2 border-b border-neutral-200 dark:border-neutral-800 cursor-pointer text-sm"><span>${cat(id).icon}</span><span class="flex-1">${esc(cat(id).name)}</span><span class="text-neutral-400 hidden sm:inline">${brl(p)}</span><b>${brl(c)}</b><span class="w-14 text-right ${x > 0 ? 'text-rose-500' : 'text-emerald-500'}">${x === null ? '—' : (x > 0 ? '+' : '') + x.toFixed(0) + '%'}</span></div>`; }).join('') || '<p class="text-sm text-neutral-500">Sem despesas no período.</p>'}</div></div>`;
  if (!window.Chart) return;
  S.charts.push(new Chart($('#a1'), { type: 'bar', data: { labels: MES, datasets: [{ data: net, backgroundColor: net.map(v => v >= 0 ? '#f97316' : '#ef4444') }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + brl(c.parsed.y) } } }, onClick: (e, el) => { if (el.length) { S.month = mons[el[0].index]; $('#month').value = S.month; S.view = 'dashboard'; render(); } } } }));
  S.charts.push(new Chart($('#a2'), { type: 'bar', data: { labels: top.map(i => cat(i).name), datasets: [{ data: top.map(i => cur[i]), backgroundColor: top.map(i => cat(i).color) }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + brl(c.parsed.x) } } }, onClick: (e, el) => { if (el.length) { S.view = 'transactions'; S.ftype = 'expense'; S.fcat = top[el[0].index]; render(); } } } }));
}

/* ---- Configurações com sub-abas ---- */
function settings() {
  const T = [['geral', 'Geral'], ['integracoes', 'Integrações'], ['metas', 'Metas'], ['categorias', 'Categorias'], ['contas', 'Contas'], ['backup', 'Backup']];
  $('#view').innerHTML = `<div class="flex gap-2 overflow-x-auto mb-4">${T.map(([k, l]) => `<button data-a="sub" data-id="${k}" class="btn shrink-0 ${S.sub === k ? 'btn-p' : ''}">${l}</button>`).join('')}</div><div id="sub"></div>`;
  ({ geral: subGeral, integracoes: subInteg, metas: subMetas, categorias: categories, contas: accounts, backup: subBackup })[S.sub]();
}
function subGeral() {
  $('#sub').innerHTML = `<div class="card max-w-xl space-y-3"><h3 class="font-semibold">Aparência e perfil</h3>
   ${fld('Tema', `<select id="themeSel" class="inp">${opts([['auto', 'Automático (sistema)'], ['light', 'Claro'], ['dark', 'Escuro']], localStorage.theme || 'dark')}</select>`)}
   ${fld('Seu nome (saudação do painel)', `<input id="nome" class="inp" value="${esc(localStorage.nome || '')}">`)}</div>`;
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
  $('#sub').innerHTML = `<button data-a="new-goal" class="btn btn-p mb-3">+ Nova meta</button><p class="text-sm text-neutral-500 mb-3">Limite mensal de gastos por categoria. O progresso aparece no Dashboard.</p><div class="grid sm:grid-cols-2 gap-3">${S.goal.map(g => {
    const sp = l.filter(t => t.type === 'expense' && t.categoryId === g.categoryId).reduce((s, t) => s + t.amount, 0), p = Math.min(100, Math.round(sp / g.limit * 100)) || 0;
    return `<div class="card"><div class="flex justify-between mb-2"><b>${cat(g.categoryId).icon} ${esc(cat(g.categoryId).name)}</b><span><button data-a="edit-goal" data-id="${g.id}">✏️</button> <button data-a="del-goal" data-id="${g.id}">🗑️</button></span></div>${bar(p, p >= 100)}<p class="text-xs text-neutral-400 mt-1">${brl(sp)} de ${brl(g.limit)} neste mês</p></div>`; }).join('') || '<p class="text-neutral-500">Nenhuma meta criada.</p>'}</div>`;
}
function goalForm(g = {}) {
  openModal(g.id ? 'Editar meta' : 'Nova meta', `${fld('Categoria', `<select name="categoryId" class="inp">${opts(S.cat.filter(c => c.type === 'expense').map(c => [c.id, `${c.icon} ${c.name}`]), g.categoryId)}</select>`)}
   ${fld('Limite mensal (R$)', `<input name="limit" type="number" step="0.01" min="1" required class="inp" value="${g.limit ?? ''}">`)}`,
    d => DB.put('goals', { ...g, id: g.id || uid(), categoryId: d.categoryId, limit: parseFloat(d.limit) }).then(() => true));
}
function subBackup() {
  $('#sub').innerHTML = `<div class="card max-w-xl"><h3 class="font-semibold mb-1">Backup e exportação</h3><p class="text-sm text-slate-500 mb-3">A importação mescla com os dados atuais (o registro mais recente vence).</p>
   <div class="flex gap-2 flex-wrap"><button class="btn" data-a="export-json">Exportar JSON</button><button class="btn" data-a="import-json">Importar JSON</button><button class="btn" data-a="csv">CSV do mês</button></div></div>`;
}

/* ================= Modal e formulários ================= */
function openModal(title, body, onSubmit, ro) {
  const m = $('#modal');
  m.innerHTML = `<form class="bg-white dark:bg-[#141414] w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-y-auto space-y-3">
    <h2 class="text-lg font-semibold">${title}</h2>${body}
    <div class="flex gap-2 pt-2"><button type="button" data-a="close" class="btn flex-1">${ro ? 'Fechar' : 'Cancelar'}</button>${ro ? '' : '<button class="btn btn-p flex-1">Salvar</button>'}</div></form>`;
  m.classList.remove('hidden');
  const f = $('form', m);
  f.onsubmit = async e => { e.preventDefault(); if ((await onSubmit(Object.fromEntries(new FormData(f)))) !== false) closeModal(); };
  return f;
}
const closeModal = () => $('#modal').classList.add('hidden');

function txForm(t = {}) {
  const isNew = !t.id, type = t.type || 'expense';
  const f = openModal(isNew ? 'Nova transação' : 'Editar transação', `
    <div class="grid grid-cols-3 gap-1">${[['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']].map(([v, l]) =>
      `<label class="text-center"><input type="radio" name="type" value="${v}" class="peer hidden" ${v === type ? 'checked' : ''}><span class="block py-2 rounded-lg border border-slate-300 dark:border-neutral-700 cursor-pointer text-sm peer-checked:bg-orange-500 peer-checked:text-white">${l}</span></label>`).join('')}</div>
    ${fld('Valor (R$)', `<input name="amount" type="number" step="0.01" min="0.01" required class="inp" value="${t.amount ?? ''}">`)}
    ${fld('Descrição', `<input name="description" required class="inp" value="${esc(t.description || '')}">`)}
    ${fld('Data', `<input name="date" type="date" required class="inp" value="${t.date || nowDate()}">`)}
    <div class="cw">${fld('Categoria', `<select name="categoryId" class="inp"></select>`)}</div>
    ${fld('Conta / carteira', `<select name="accountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), t.accountId)}</select>`)}
    <div class="tw hidden">${fld('Conta de destino', `<select name="toAccountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), t.toAccountId)}</select>`)}</div>
    <div class="xw hidden">${fld('Pagar com cartão de crédito', `<select name="cardId" class="inp"><option value="">Não, usar a conta</option>${opts(S.card.map(c => [c.id, '💳 ' + c.name]), t.cardId)}</select>`)}</div>
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
    if (rb) f.elements.categoryId.innerHTML = opts(S.cat.filter(c => c.type === ty).map(c => [c.id, `${c.icon} ${c.name}`]), t.categoryId);
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
    ${fld('Ícone (emoji)', `<input name="icon" required maxlength="4" class="inp" value="${esc(c.icon || '🏷️')}">`)}
    ${fld('Cor', `<input name="color" type="color" class="inp !h-10 !p-1" value="${c.color || '#10b981'}">`)}
    ${fld('Tipo', `<select name="type" class="inp">${opts([['expense', 'Despesa'], ['income', 'Receita']], c.type)}</select>`)}`,
    d => DB.put('categories', { ...c, id: c.id || uid(), name: d.name.trim(), icon: d.icon, color: d.color, type: d.type }).then(() => true));
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
    case 'nav': S.view = id; S.ftype = S.fcat = ''; render(); scrollTo(0, 0); break;
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
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('db:change', async () => { await load(); render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(); });

/* ================= Inicialização ================= */
(async () => {
  await DB.open(); await seed(); await load();
  applyTheme(); buildNav();
  $('#month').value = S.month;
  if ($('#month').type !== 'month') $('#month').placeholder = 'AAAA-MM'; // Firefox desktop não tem input month
  Sync.onStatus(paintStatus); paintStatus(Sync.getStatus());
  render();
  Sync.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
})();
