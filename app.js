// app.js — UI estilo FlowBoard, regras de negócio e orquestração (db.js + github-sync.js).
import { DB } from './db.js';
import * as Sync from './github-sync.js';

/* ================= Utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fdate = d => d.split('-').reverse().join('/');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const nowDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const addMonths = (d, n) => {
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(y, m + n, 0).getDate();
  const t = new Date(y, m - 1 + n, Math.min(day, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const prevMonth = m => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const download = (name, data, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const fld = (label, html) => `<label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400 text-xs font-medium">${label}</span>${html}</label>`;

/* ================= Estado e seeds ================= */
const S = { tx: [], acc: [], cat: [], view: 'dashboard', month: nowDate().slice(0, 7), charts: [], search: '' };
const NAV_MAIN = [
  ['dashboard', '📊', 'Dashboard'],
  ['transactions', '💸', 'Transações'],
  ['accounts', '🏦', 'Contas e Cartões'],
  ['categories', '🏷️', 'Categorias']
];
const NAV_SYS = [
  ['settings', '⚙️', 'Ajustes e Sync']
];
const ALL_NAV = [...NAV_MAIN, ...NAV_SYS];

const CATS = [
  ['moradia', 'Moradia', '🏠', '#f97316', 'expense'], ['alimentacao', 'Alimentação', '🍽️', '#fb923c', 'expense'],
  ['transporte', 'Transporte', '🚗', '#38bdf8', 'expense'], ['lazer', 'Lazer', '🎉', '#f43f5e', 'expense'],
  ['saude', 'Saúde', '💊', '#ef4444', 'expense'], ['educacao', 'Educação', '📚', '#a855f7', 'expense'],
  ['outros_d', 'Outros', '🧾', '#71717a', 'expense'], ['salario', 'Salário', '💰', '#10b981', 'income'],
  ['investimentos', 'Investimentos', '📈', '#14b8a6', 'income'], ['outros_r', 'Outras receitas', '➕', '#84cc16', 'income']
];

const getGoals = () => {
  try { return JSON.parse(localStorage.getItem('fp_goals')) || { income: 10000, expense: 6000, net: 4000 }; }
  catch { return { income: 10000, expense: 6000, net: 4000 }; }
};
const saveGoals = g => localStorage.setItem('fp_goals', JSON.stringify(g));

async function seed() {
  if (!(await DB.raw('categories')).length)
    for (const c of CATS) await DB.put('categories', { id: 'cat_' + c[0], name: c[1], icon: c[2], color: c[3], type: c[4], lastModified: 1 }, true);
  if (!(await DB.raw('accounts')).length)
    await DB.put('accounts', { id: 'acc_carteira', name: 'Carteira', type: 'Carteira', initial: 0, lastModified: 1 }, true);
}
async function load() {
  [S.tx, S.acc, S.cat] = await Promise.all(['transactions', 'accounts', 'categories'].map(s => DB.list(s)));
}

/* ================= Cálculos ================= */
const cat = id => S.cat.find(c => c.id === id) || { name: '—', icon: '❔', color: '#71717a' };
const accName = id => S.acc.find(a => a.id === id)?.name || '—';
const balance = a => S.tx.filter(t => t.status === 'paid').reduce((s, t) => {
  if (t.type === 'income' && t.accountId === a.id) return s + t.amount;
  if (t.type === 'expense' && t.accountId === a.id) return s - t.amount;
  if (t.type === 'transfer') { if (t.accountId === a.id) s -= t.amount; if (t.toAccountId === a.id) s += t.amount; }
  return s;
}, a.initial || 0);
const inMonth = m => S.tx.filter(t => t.date.startsWith(m));
const sum = (l, type) => l.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);

const pctDelta = (cur, prev) => {
  if (!prev) return cur > 0 ? '+100%' : '0.0%';
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
};

const dailySeries = (m, filterFn) => {
  const [y, mo] = m.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const arr = Array(days).fill(0);
  inMonth(m).filter(filterFn).forEach(t => {
    const day = parseInt(t.date.slice(8, 10), 10) - 1;
    if (day >= 0 && day < days) arr[day] += (t.type === 'expense' ? -t.amount : t.amount);
  });
  let acc = 0;
  return arr.map(v => (acc += Math.abs(v)));
};

const dailyNetCumulative = (m, baseStart) => {
  const [y, mo] = m.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const arr = Array(days).fill(0);
  inMonth(m).forEach(t => {
    const day = parseInt(t.date.slice(8, 10), 10) - 1;
    if (day >= 0 && day < days) {
      if (t.type === 'income') arr[day] += t.amount;
      if (t.type === 'expense') arr[day] -= t.amount;
    }
  });
  let running = baseStart;
  return arr.map(v => (running += v));
};

/* ================= Tema ================= */
const applyTheme = () => {
  const t = localStorage.theme || 'dark';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  if (window.Chart) {
    Chart.defaults.color = dark ? '#a1a1aa' : '#52525b';
    Chart.defaults.borderColor = dark ? '#27272a' : '#e4e4e7';
    Chart.defaults.font.family = '"Plus Jakarta Sans", system-ui, sans-serif';
  }
};

/* ================= Status da nuvem ================= */
const ST = {
  synced: ['Sincronizado', 'bg-emerald-500'], syncing: ['Sincronizando...', 'bg-orange-500 animate-pulse'],
  offline: ['Offline', 'bg-zinc-500'], auth: ['Erro Auth', 'bg-rose-500'],
  signedout: ['Local', 'bg-zinc-500'], error: ['Erro Sync', 'bg-rose-500']
};
function paintStatus(s) {
  const [l, c] = ST[s] || ST.offline, login = s === 'auth' || s === 'signedout';
  $('#sync').innerHTML = `<span class="w-2 h-2 rounded-full ${c}"></span><span class="font-medium">${l}</span>`;
  $('#syncBtn').textContent = login ? 'Conectar GitHub' : '↻ Sync';
  $('#syncBtn').dataset.a = login ? 'signin' : 'sync';
}

/* ================= Navegação / render ================= */
function buildNav() {
  const cfg = Sync.getCfg();
  const userLabel = cfg.owner || 'Odisseu Medeiros';
  const repoLabel = cfg.repo ? `${cfg.owner}/${cfg.repo}` : 'Modo Offline-First';

  $('#side').innerHTML = `
    <div class="flex items-center gap-3 px-2 py-2 mb-4">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-orange-500/20">F</div>
      <div>
        <div class="font-bold text-base tracking-tight leading-none">FlowFinanças</div>
        <div class="text-[11px] text-zinc-500 mt-0.5">Smart Finance</div>
      </div>
    </div>
    <div class="mb-4">
      <input id="sideSearch" type="search" placeholder="🔍 Buscar lançamento..." value="${esc(S.search)}" class="inp !mt-0 !py-2 !text-xs !bg-zinc-100 dark:!bg-[#121215]">
    </div>
    <div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 px-3 mb-1.5">Menu Principal</div>
    <div class="space-y-1">
      ${NAV_MAIN.map(([v, i, l]) => `<button data-a="nav" data-id="${v}" class="nav w-full text-left"><span>${i}</span><span>${l}</span></button>`).join('')}
    </div>
    <div class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 px-3 mt-6 mb-1.5">Sistema</div>
    <div class="space-y-1">
      ${NAV_SYS.map(([v, i, l]) => `<button data-a="nav" data-id="${v}" class="nav w-full text-left"><span>${i}</span><span>${l}</span></button>`).join('')}
    </div>
    <div class="mt-auto pt-4 border-t border-zinc-200 dark:border-[#27272a]">
      <div class="p-3 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 text-white mb-3 hidden dark:block">
        <div class="text-xs font-semibold flex items-center gap-1.5">✨ Backup GitHub</div>
        <p class="text-[11px] text-zinc-400 mt-1 leading-relaxed">Seus dados sincronizados com criptografia e histórico.</p>
        <button data-a="nav" data-id="settings" class="mt-2.5 w-full py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-colors">Gerenciar Sync</button>
      </div>
      <div class="flex items-center gap-2.5 px-2 py-1.5">
        <div class="w-8 h-8 rounded-full bg-orange-500/20 text-orange-500 font-bold text-xs flex items-center justify-center border border-orange-500/30">${esc(userLabel.slice(0, 2).toUpperCase())}</div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold truncate">${esc(userLabel)}</p>
          <p class="text-[10px] text-zinc-500 truncate">${esc(repoLabel)}</p>
        </div>
      </div>
    </div>`;

  $('#sideSearch').addEventListener('input', e => {
    S.search = e.target.value;
    if (S.view !== 'transactions') S.view = 'transactions';
    render();
  });

  $('#bottom').innerHTML = ALL_NAV.map(([v, i, l]) => `<button data-a="nav" data-id="${v}" class="nav !flex-col !gap-0.5 !px-1 !py-2 text-[10px] rounded-none justify-center"><span class="text-base">${i}</span><span class="truncate max-w-full">${l.split(' ')[0]}</span></button>`).join('');
}

function render() {
  S.charts.forEach(c => c.destroy()); S.charts = [];
  document.querySelectorAll('[data-a="nav"]').forEach(b => {
    const on = b.dataset.id === S.view;
    if (b.closest('#side')) {
      b.classList.toggle('bg-orange-500', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('shadow-lg', on);
      b.classList.toggle('shadow-orange-500/25', on);
      b.classList.toggle('text-zinc-400', !on);
    }
    if (b.closest('#bottom')) {
      b.classList.toggle('text-orange-500', on);
      b.classList.toggle('font-semibold', on);
    }
  });
  const navItem = ALL_NAV.find(n => n[0] === S.view);
  $('#title').textContent = S.view === 'dashboard' ? 'Bom dia, Odisseu 👋' : navItem[2];
  if ($('#subtitle')) {
    $('#subtitle').textContent = S.view === 'dashboard'
      ? 'Aqui está o resumo das suas finanças neste período.'
      : 'Gerencie seus registros, contas e configurações.';
  }
  $('#fab').classList.toggle('hidden', !['dashboard', 'transactions'].includes(S.view));
  ({ dashboard, transactions, accounts, categories, settings })[S.view]();
}

/* ================= Views ================= */
const kpiCard = (id, title, value, deltaText, positive, icon, iconBg, chartId) => `
  <div class="card flex flex-col justify-between relative overflow-hidden">
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-xs font-medium text-zinc-500 dark:text-zinc-400">${title}</p>
        <p class="text-2xl font-bold tracking-tight mt-1.5">${brl(value)}</p>
        <p class="text-[11px] font-medium mt-1.5 flex items-center gap-1 ${positive ? 'text-emerald-500' : 'text-rose-500'}">
          <span>${positive ? '↑' : '↓'} ${deltaText}</span>
          <span class="text-zinc-500 font-normal">vs mês anterior</span>
        </p>
      </div>
      <div class="w-10 h-10 rounded-full flex items-center justify-center text-base shrink-0 ${iconBg}">${icon}</div>
    </div>
    <div class="h-12 mt-3 -mx-2 -mb-2"><canvas id="${chartId}"></canvas></div>
  </div>`;

function makeSparkline(canvasId, data, color) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  const ctx = el.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 48);
  grad.addColorStop(0, color + '44');
  grad.addColorStop(1, color + '00');
  S.charts.push(new Chart(el, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i + 1),
      datasets: [{ data, borderColor: color, borderWidth: 2, backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  }));
}

function dashboard() {
  const l = inMonth(S.month);
  const lp = inMonth(prevMonth(S.month));
  const rec = sum(l, 'income'), des = sum(l, 'expense'), liq = rec - des;
  const recP = sum(lp, 'income'), desP = sum(lp, 'expense'), liqP = recP - desP;
  const saldo = S.acc.reduce((s, a) => s + balance(a), 0);
  const saldoPrev = saldo - liq;
  const year = S.month.slice(0, 4);

  const by = {};
  l.filter(t => t.type === 'expense').forEach(t => by[t.categoryId] = (by[t.categoryId] || 0) + t.amount);
  const catEntries = Object.entries(by).sort((a, b) => b[1] - a[1]);

  const recentTxs = [...l].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const goals = getGoals();
  const pInc = Math.min(100, Math.round((rec / (goals.income || 1)) * 100));
  const pExp = Math.min(100, Math.round((des / (goals.expense || 1)) * 100));
  const pNet = Math.min(100, Math.max(0, Math.round((liq / (goals.net || 1)) * 100)));

  const yearTotalRec = Array.from({ length: 12 }, (_, i) => sum(inMonth(`${year}-${String(i + 1).padStart(2, '0')}`), 'income')).reduce((a, b) => a + b, 0);

  $('#view').innerHTML = `
    <!-- Linha 1: 4 KPIs com Sparklines -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      ${kpiCard('k1', 'Saldo Total', saldo, pctDelta(saldo, saldoPrev), saldo >= saldoPrev, '💳', 'bg-orange-500/15 text-orange-500 border border-orange-500/30', 'sp1')}
      ${kpiCard('k2', 'Receitas do Mês', rec, pctDelta(rec, recP), rec >= recP, '📥', 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30', 'sp2')}
      ${kpiCard('k3', 'Despesas do Mês', des, pctDelta(des, desP), des <= desP, '📤', 'bg-amber-500/15 text-amber-500 border border-amber-500/30', 'sp3')}
      ${kpiCard('k4', 'Balanço Líquido', liq, pctDelta(liq, liqP), liq >= liqP, '📈', 'bg-orange-500/15 text-orange-500 border border-orange-500/30', 'sp4')}
    </div>

    <!-- Linha 2: Gráficos Principais -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
      <div class="card lg:col-span-7 flex flex-col justify-between">
        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="font-semibold text-sm text-zinc-400">Visão Geral Anual (${year})</h3>
            <p class="text-2xl font-bold mt-1">${brl(yearTotalRec)}</p>
            <p class="text-xs text-emerald-500 mt-0.5">Receitas acumuladas no exercício</p>
          </div>
          <span class="text-xs px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] text-zinc-400">Mensal</span>
        </div>
        <div class="h-60"><canvas id="c2"></canvas></div>
      </div>

      <div class="card lg:col-span-5 flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-base">Despesas por Categoria</h3>
          <span class="text-xs px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] text-zinc-400">${S.month}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center my-auto">
          <div class="h-48 relative flex items-center justify-center">
            <canvas id="c1"></canvas>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span class="text-sm font-bold">${brl(des)}</span>
              <span class="text-[10px] text-zinc-500">Total Despesas</span>
            </div>
          </div>
          <div class="space-y-2.5 max-h-48 overflow-y-auto pr-1">
            ${catEntries.length ? catEntries.map(([id, val]) => {
              const c = cat(id), pct = des ? ((val / des) * 100).toFixed(1) : '0.0';
              return `<div class="flex items-center justify-between text-xs gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${c.color}"></span>
                  <span class="truncate text-zinc-300">${esc(c.name)}</span>
                </div>
                <div class="text-right shrink-0">
                  <span class="font-semibold">${brl(val)}</span>
                  <span class="text-zinc-500 ml-1">${pct}%</span>
                </div>
              </div>`;
            }).join('') : '<p class="text-xs text-zinc-500">Sem despesas no mês.</p>'}
          </div>
        </div>
      </div>
    </div>

    <!-- Linha 3: Transações Recentes, Fluxo de Caixa e Metas -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
      <div class="card flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-base">Transações Recentes</h3>
          <button data-a="nav" data-id="transactions" class="text-xs text-orange-500 hover:underline font-medium">Ver todas</button>
        </div>
        <div class="space-y-3 flex-1">
          ${recentTxs.length ? recentTxs.map(t => {
            const tr = t.type === 'transfer', c = tr ? { icon: '🔁', color: '#71717a' } : cat(t.categoryId);
            const col = t.type === 'income' ? 'text-emerald-500' : t.type === 'expense' ? 'text-rose-500' : 'text-zinc-400';
            const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
            return `<div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl flex items-center justify-center text-sm shrink-0" style="background:${c.color}22">${c.icon}</div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium truncate">${esc(t.description)}</p>
                <p class="text-[11px] text-zinc-500">${fdate(t.date)} · ${esc(accName(t.accountId))}</p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-sm font-semibold ${col}">${sign}${brl(t.amount)}</p>
                <p class="text-[10px] ${t.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}">${t.status === 'paid' ? 'Pago' : 'Pendente'}</p>
              </div>
            </div>`;
          }).join('') : '<p class="text-xs text-zinc-500 py-8 text-center">Nenhum lançamento neste mês.</p>'}
        </div>
      </div>

      <div class="card flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between">
            <h3 class="font-semibold text-base">Fluxo de Caixa</h3>
            <span class="text-xs text-zinc-500">Evolução diária</span>
          </div>
          <p class="text-2xl font-bold mt-1">${brl(liq)}</p>
          <p class="text-xs ${liq >= 0 ? 'text-emerald-500' : 'text-rose-500'} mt-0.5">${liq >= 0 ? 'Superávit operacional' : 'Déficit no período'}</p>
        </div>
        <div class="h-44 mt-3"><canvas id="c3"></canvas></div>
      </div>

      <div class="card flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-base">Metas do Mês</h3>
          <button data-a="edit-goals" class="text-xs text-orange-500 hover:underline font-medium">Editar metas</button>
        </div>
        <div class="space-y-4 my-auto">
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="font-medium flex items-center gap-1.5">🎯 Meta de Receitas</span>
              <span class="text-zinc-400">${brl(rec)} / ${brl(goals.income)}</span>
            </div>
            <div class="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div class="h-full rounded-full bg-orange-500" style="width:${pInc}%"></div>
            </div>
            <p class="text-right text-[10px] text-orange-500 font-semibold mt-1">${pInc}%</p>
          </div>

          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="font-medium flex items-center gap-1.5">🛡️ Teto de Despesas</span>
              <span class="text-zinc-400">${brl(des)} / ${brl(goals.expense)}</span>
            </div>
            <div class="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div class="h-full rounded-full ${pExp > 90 ? 'bg-rose-500' : 'bg-amber-500'}" style="width:${pExp}%"></div>
            </div>
            <p class="text-right text-[10px] text-amber-500 font-semibold mt-1">${pExp}%</p>
          </div>

          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="font-medium flex items-center gap-1.5">💰 Meta de Economia</span>
              <span class="text-zinc-400">${brl(Math.max(0, liq))} / ${brl(goals.net)}</span>
            </div>
            <div class="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div class="h-full rounded-full bg-emerald-500" style="width:${pNet}%"></div>
            </div>
            <p class="text-right text-[10px] text-emerald-500 font-semibold mt-1">${pNet}%</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Linha 4: Banner de Insights -->
    <div class="card mt-4 bg-gradient-to-r from-[#121215] via-[#181412] to-[#1f1610] border-orange-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 text-orange-500 font-semibold text-sm">
          <span>✨ Insights Financeiros</span>
        </div>
        <p class="text-xs text-zinc-400 mt-1 max-w-2xl leading-relaxed">
          ${liq >= 0
            ? `Excelente desempenho! Você acumulou um saldo líquido positivo de <strong class="text-zinc-200">${brl(liq)}</strong> em ${S.month}, mantendo suas despesas em <strong class="text-zinc-200">${rec ? ((des / rec) * 100).toFixed(0) : 0}%</strong> das receitas.`
            : `Atenção ao fluxo do período: suas despesas superaram as receitas em <strong class="text-rose-400">${brl(Math.abs(liq))}</strong>. Revise as categorias de maior impacto acima.`}
        </p>
      </div>
      <button data-a="csv" class="btn btn-p shrink-0 text-xs">Exportar Relatório CSV</button>
    </div>`;

  // Sparklines
  const sSaldo = dailyNetCumulative(S.month, saldoPrev);
  const sRec = dailySeries(S.month, t => t.type === 'income');
  const sDes = dailySeries(S.month, t => t.type === 'expense');
  const sLiq = dailyNetCumulative(S.month, 0);
  makeSparkline('sp1', sSaldo, '#f97316');
  makeSparkline('sp2', sRec, '#10b981');
  makeSparkline('sp3', sDes, '#f59e0b');
  makeSparkline('sp4', sLiq, '#f97316');

  if (window.Chart) {
    // Rosca estilo FlowBoard
    const ids = catEntries.map(x => x[0]);
    const vals = catEntries.map(x => x[1]);
    S.charts.push(new Chart($('#c1'), {
      type: 'doughnut',
      data: {
        labels: ids.map(i => cat(i).name),
        datasets: [{ data: vals, backgroundColor: ids.map(i => cat(i).color), borderWidth: 2, borderColor: '#121215', hoverOffset: 4 }]
      },
      options: {
        maintainAspectRatio: false,
        cutout: '74%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.parsed)}` } }
        }
      }
    }));

    // Barras arredondadas em Laranja / Grafite
    const m = Array.from({ length: 12 }, (_, i) => inMonth(`${year}-${String(i + 1).padStart(2, '0')}`));
    const curMIdx = parseInt(S.month.slice(5, 7), 10) - 1;
    S.charts.push(new Chart($('#c2'), {
      type: 'bar',
      data: {
        labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
        datasets: [
          {
            label: 'Receitas',
            data: m.map(x => sum(x, 'income')),
            backgroundColor: m.map((_, idx) => idx === curMIdx ? '#f97316' : 'rgba(249, 115, 22, 0.35)'),
            hoverBackgroundColor: '#f97316',
            borderRadius: 6,
            barPercentage: 0.55
          },
          {
            label: 'Despesas',
            data: m.map(x => sum(x, 'expense')),
            backgroundColor: 'rgba(113, 113, 122, 0.35)',
            hoverBackgroundColor: '#71717a',
            borderRadius: 6,
            barPercentage: 0.55
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${brl(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => brl(v) } }
        }
      }
    }));

    // Cash Flow diário
    const cfEl = $('#c3');
    const cfCtx = cfEl.getContext('2d');
    const cfGrad = cfCtx.createLinearGradient(0, 0, 0, 175);
    cfGrad.addColorStop(0, 'rgba(249, 115, 22, 0.45)');
    cfGrad.addColorStop(1, 'rgba(249, 115, 22, 0.0)');
    S.charts.push(new Chart(cfEl, {
      type: 'line',
      data: {
        labels: sLiq.map((_, i) => `Dia ${i + 1}`),
        datasets: [{
          label: 'Saldo Acumulado',
          data: sLiq,
          borderColor: '#f97316',
          borderWidth: 2.5,
          backgroundColor: cfGrad,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4
        }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${brl(c.parsed.y)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => brl(v) } }
        }
      }
    }));
  }
}

function txRow(t) {
  const tr = t.type === 'transfer', c = tr ? { icon: '🔁', color: '#71717a', name: 'Transferência' } : cat(t.categoryId), paid = t.status === 'paid';
  const col = t.type === 'income' ? 'text-emerald-500' : t.type === 'expense' ? 'text-rose-500' : 'text-zinc-400';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  return `<div class="card !p-3.5 flex items-center gap-3 hover:border-zinc-700 transition-colors">
    <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style="background:${c.color}22">${c.icon}</div>
    <div class="min-w-0 flex-1"><p class="font-medium truncate">${esc(t.description)}</p>
      <p class="text-xs text-zinc-500 truncate">${fdate(t.date)} · ${esc(c.name)} · ${esc(accName(t.accountId))}${tr ? ' → ' + esc(accName(t.toAccountId)) : ''}</p></div>
    <div class="text-right"><p class="font-semibold ${col}">${sign}${brl(t.amount)}</p>
      <button data-a="toggle" data-id="${t.id}" class="text-[11px] px-2.5 py-0.5 rounded-full font-medium mt-0.5 ${paid ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}">${paid ? 'Pago' : 'Pendente'}</button></div>
    <div class="flex flex-col gap-1 ml-1"><button data-a="edit-tx" data-id="${t.id}" aria-label="Editar" class="opacity-70 hover:opacity-100">✏️</button><button data-a="del-tx" data-id="${t.id}" aria-label="Excluir" class="opacity-70 hover:opacity-100">🗑️</button></div></div>`;
}
function transactions() {
  const q = S.search.trim().toLowerCase();
  let l = inMonth(S.month);
  if (q) l = S.tx.filter(t => t.description.toLowerCase().includes(q) || cat(t.categoryId).name.toLowerCase().includes(q));
  l = l.sort((a, b) => b.date.localeCompare(a.date));
  $('#view').innerHTML = `
    ${q ? `<div class="mb-3 flex items-center justify-between text-xs text-zinc-400"><span>Filtrando por: <b>"${esc(S.search)}"</b> (${l.length} resultados)</span><button data-a="clear-search" class="text-orange-500 hover:underline">Limpar busca</button></div>` : ''}
    <div class="space-y-2.5">${l.map(txRow).join('') || '<div class="card text-center text-zinc-500 py-12">Nenhuma transação encontrada. Toque em <b>+</b> para adicionar.</div>'}</div>`;
}

function accounts() {
  $('#view').innerHTML = `<button data-a="new-acc" class="btn btn-p mb-4">+ Nova conta</button>
  <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${S.acc.map(a => { const b = balance(a); return `<div class="card flex items-center justify-between gap-3">
    <div><span class="text-[11px] uppercase tracking-wider text-orange-500 font-semibold">${esc(a.type)}</span>
    <p class="font-bold text-base mt-0.5">${esc(a.name)}</p>
    <p class="text-xl font-bold mt-2 ${b < 0 ? 'text-rose-500' : ''}">${brl(b)}</p></div>
    <div class="flex flex-col gap-2"><button data-a="edit-acc" data-id="${a.id}" aria-label="Editar">✏️</button><button data-a="del-acc" data-id="${a.id}" aria-label="Excluir">🗑️</button></div></div>`; }).join('')}</div>`;
}

function categories() {
  const grp = (type, t) => `<h3 class="font-semibold text-sm uppercase tracking-wider text-zinc-400 mt-5 mb-2.5">${t}</h3><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">${S.cat.filter(c => c.type === type).map(c =>
    `<div class="card !p-3.5 flex items-center gap-3"><span class="w-9 h-9 rounded-xl flex items-center justify-center text-base" style="background:${c.color}25">${c.icon}</span>
    <span class="flex-1 font-medium text-sm">${esc(c.name)}</span><button data-a="edit-cat" data-id="${c.id}" aria-label="Editar">✏️</button><button data-a="del-cat" data-id="${c.id}" aria-label="Excluir">🗑️</button></div>`).join('')}</div>`;
  $('#view').innerHTML = `<button data-a="new-cat" class="btn btn-p">+ Nova categoria</button>${grp('expense', 'Despesas')}${grp('income', 'Receitas')}`;
}

function settings() {
  const g = Sync.getCfg();
  $('#view').innerHTML = `<div class="space-y-4 max-w-2xl">
    <div class="card"><h3 class="font-semibold mb-2">Aparência</h3>
      <select id="themeSel" class="inp">${opts([['dark', 'Escuro (FlowBoard)'], ['light', 'Claro'], ['auto', 'Automático (sistema)']], localStorage.theme || 'dark')}</select></div>
    <div class="card"><h3 class="font-semibold mb-1">Sincronização com GitHub</h3>
      <p class="text-xs text-zinc-400 mb-3">Use um repositório <b>privado</b> só para os dados e um token fine-grained com <i>Contents: Read and write</i> apenas nele.</p>
      <form id="ghForm" class="space-y-2.5">
        ${fld('Usuário (username exato no GitHub)', `<input name="owner" required class="inp" placeholder="ex: odisseumedeiros" value="${esc(g.owner || '')}">`)}
        ${fld('Nome do Repositório (apenas o nome, sem URL)', `<input name="repo" required class="inp" placeholder="ex: Nostus-Dados" value="${esc(g.repo || '')}">`)}
        ${fld('Branch', `<input name="branch" class="inp" value="${esc(g.branch || 'main')}">`)}
        ${fld('Arquivo JSON', `<input name="path" class="inp" value="${esc(g.path || 'financas_pessoais_db.json')}">`)}
        ${fld('Token (PAT)', `<input name="token" type="password" autocomplete="off" ${g.token ? '' : 'required'} class="inp" placeholder="${g.token ? '•••••• salvo (em branco mantém)' : 'github_pat_...'}">`)}
        <div class="flex gap-2 flex-wrap pt-2"><button class="btn btn-p">Salvar e sincronizar</button><button type="button" class="btn" data-a="sync">Forçar sincronização</button><button type="button" class="btn" data-a="signout">Remover token</button></div>
      </form></div>
    <div class="card"><h3 class="font-semibold mb-1">Backup Local</h3>
      <p class="text-xs text-zinc-400 mb-3">A importação mescla com os dados atuais (o registro mais recente vence).</p>
      <div class="flex gap-2 flex-wrap"><button class="btn" data-a="export-json">Exportar JSON</button><button class="btn" data-a="import-json">Importar JSON</button><button class="btn" data-a="csv">CSV do mês</button></div></div></div>`;
  $('#themeSel').onchange = e => { localStorage.theme = e.target.value; applyTheme(); render(); };
  $('#ghForm').onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const cleanRepo = d.repo.trim().replace(/^https?:\/\/github\.com\/[^/]+\//i, '').replace(/\.git$/i, '');
    Sync.saveCfg({ owner: d.owner.trim(), repo: cleanRepo, branch: d.branch.trim() || 'main', path: d.path.trim() || 'financas_pessoais_db.json', token: d.token.trim() || g.token });
    buildNav();
    Sync.sync();
  };
}

/* ================= Modal e formulários ================= */
function openModal(title, body, onSubmit) {
  const m = $('#modal');
  m.innerHTML = `<form class="bg-white dark:bg-[#121215] border border-zinc-200 dark:border-[#27272a] w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-y-auto space-y-3 shadow-2xl">
    <h2 class="text-lg font-bold">${title}</h2>${body}
    <div class="flex gap-2 pt-3"><button type="button" data-a="close" class="btn flex-1">Cancelar</button><button class="btn btn-p flex-1">Salvar</button></div></form>`;
  m.classList.remove('hidden');
  const f = $('form', m);
  f.onsubmit = async e => { e.preventDefault(); if ((await onSubmit(Object.fromEntries(new FormData(f)))) !== false) closeModal(); };
  return f;
}
const closeModal = () => $('#modal').classList.add('hidden');

function goalsForm() {
  const g = getGoals();
  openModal('Metas Mensais', `
    ${fld('Meta de Receitas (R$)', `<input name="income" type="number" step="0.01" required class="inp" value="${g.income}">`)}
    ${fld('Teto Máximo de Despesas (R$)', `<input name="expense" type="number" step="0.01" required class="inp" value="${g.expense}">`)}
    ${fld('Meta de Economia Líquida (R$)', `<input name="net" type="number" step="0.01" required class="inp" value="${g.net}">`)}`,
    d => {
      saveGoals({ income: parseFloat(d.income) || 10000, expense: parseFloat(d.expense) || 6000, net: parseFloat(d.net) || 4000 });
      render();
      return true;
    });
}

function txForm(t = {}) {
  const isNew = !t.id, type = t.type || 'expense';
  const f = openModal(isNew ? 'Nova transação' : 'Editar transação', `
    <div class="grid grid-cols-3 gap-1.5">${[['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']].map(([v, l]) =>
      `<label class="text-center"><input type="radio" name="type" value="${v}" class="peer hidden" ${v === type ? 'checked' : ''}><span class="block py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 cursor-pointer text-xs font-semibold peer-checked:bg-orange-500 peer-checked:text-white peer-checked:border-orange-500 transition-colors">${l}</span></label>`).join('')}</div>
    ${fld('Valor (R$)', `<input name="amount" type="number" step="0.01" min="0.01" required class="inp" value="${t.amount ?? ''}">`)}
    ${fld('Descrição', `<input name="description" required class="inp" value="${esc(t.description || '')}">`)}
    ${fld('Data', `<input name="date" type="date" required class="inp" value="${t.date || nowDate()}">`)}
    <div class="cw">${fld('Categoria', `<select name="categoryId" class="inp"></select>`)}</div>
    ${fld('Conta / carteira', `<select name="accountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), t.accountId)}</select>`)}
    <div class="tw hidden">${fld('Conta de destino', `<select name="toAccountId" class="inp">${opts(S.acc.map(a => [a.id, a.name]), t.toAccountId)}</select>`)}</div>
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
  const upd = () => {
    const ty = f.elements.type.value, tr = ty === 'transfer';
    $('.cw', f).classList.toggle('hidden', tr); $('.tw', f).classList.toggle('hidden', !tr);
    f.elements.categoryId.innerHTML = opts(S.cat.filter(c => c.type === ty).map(c => [c.id, `${c.icon} ${c.name}`]), t.categoryId);
    if (isNew) $('.nw', f).classList.toggle('hidden', f.elements.recurrence.value === 'once');
  };
  f.addEventListener('change', upd); upd();
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
    ${fld('Cor', `<input name="color" type="color" class="inp !h-10 !p-1" value="${c.color || '#f97316'}">`)}
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
  download(`financas_${S.month}.csv`, '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('
'), 'text/csv');
}

/* ================= Eventos ================= */
const delGuard = (id, what) => S.tx.some(t => t.accountId === id || t.toAccountId === id || t.categoryId === id) ? (alert(`Não é possível excluir: ${what} possui transações.`), true) : false;

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const { a, id } = b.dataset;
  const tx = S.tx.find(x => x.id === id);
  switch (a) {
    case 'nav': S.view = id; render(); scrollTo(0, 0); break;
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
    case 'edit-goals': goalsForm(); break;
    case 'clear-search': S.search = ''; if ($('#sideSearch')) $('#sideSearch').value = ''; render(); break;
    case 'close': closeModal(); break;
    case 'theme': localStorage.theme = { dark: 'light', light: 'auto', auto: 'dark' }[localStorage.theme || 'dark']; applyTheme(); render(); break;
    case 'signin': S.view = 'settings'; render(); break;
    case 'signout': Sync.signOut(); buildNav(); break;
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
  if ($('#month').type !== 'month') $('#month').placeholder = 'AAAA-MM';
  Sync.onStatus(paintStatus); paintStatus(Sync.getStatus());
  render();
  Sync.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
})();
