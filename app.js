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
const S = { tx: [], acc: [], cat: [], view: 'dashboard', month: nowDate().slice(0, 7), charts: [] };
const NAV = [['dashboard', '📊', 'Dashboard'], ['transactions', '💸', 'Transações'], ['accounts', '🏦', 'Contas'], ['categories', '🏷️', 'Categorias'], ['settings', '⚙️', 'Ajustes']];
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
  [S.tx, S.acc, S.cat] = await Promise.all(['transactions', 'accounts', 'categories'].map(s => DB.list(s)));
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
  const t = localStorage.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  if (window.Chart) { Chart.defaults.color = dark ? '#cbd5e1' : '#475569'; Chart.defaults.borderColor = dark ? '#334155' : '#e2e8f0'; }
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
  $('#side').innerHTML = `<div class="flex items-center gap-2 px-2 py-3 font-bold text-emerald-600"><img src="icon.svg" class="w-7 h-7 rounded" alt="">Finanças</div>` +
    NAV.map(([v, i, l]) => `<button data-a="nav" data-id="${v}" class="nav text-left">${i}<span>${l}</span></button>`).join('');
  $('#bottom').innerHTML = NAV.map(([v, i, l]) => `<button data-a="nav" data-id="${v}" class="nav !flex-col !gap-0 !px-1 !py-2 text-[11px] rounded-none"><span class="text-lg">${i}</span>${l}</button>`).join('');
}
function render() {
  S.charts.forEach(c => c.destroy()); S.charts = [];
  document.querySelectorAll('[data-a="nav"]').forEach(b => {
    const on = b.dataset.id === S.view;
    b.classList.toggle('bg-emerald-600', on && b.closest('#side')); b.classList.toggle('text-white', on && !!b.closest('#side'));
    b.classList.toggle('text-emerald-600', on && !!b.closest('#bottom')); b.classList.toggle('font-semibold', on);
  });
  $('#title').textContent = NAV.find(n => n[0] === S.view)[2];
  $('#fab').classList.toggle('hidden', !['dashboard', 'transactions'].includes(S.view));
  ({ dashboard, transactions, accounts, categories, settings })[S.view]();
}

/* ================= Views ================= */
const card = (l, v, c) => `<div class="card"><p class="text-xs text-slate-500">${l}</p><p class="text-xl font-bold mt-1 ${c}">${brl(v)}</p></div>`;

function dashboard() {
  const l = inMonth(S.month), rec = sum(l, 'income'), des = sum(l, 'expense'), saldo = S.acc.reduce((s, a) => s + balance(a), 0);
  const year = S.month.slice(0, 4);
  $('#view').innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${card('Saldo atual', saldo, 'text-sky-600')}${card('Receitas do mês', rec, 'text-emerald-600')}
      ${card('Despesas do mês', des, 'text-rose-600')}${card('Balanço líquido', rec - des, rec - des >= 0 ? 'text-emerald-600' : 'text-rose-600')}
    </div>
    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <div class="card"><h3 class="font-semibold mb-2">Despesas por categoria</h3><div class="h-64"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3 class="font-semibold mb-2">Receitas vs. despesas em ${year}</h3><div class="h-64"><canvas id="c2"></canvas></div></div>
    </div>`;
  const by = {};
  l.filter(t => t.type === 'expense').forEach(t => by[t.categoryId] = (by[t.categoryId] || 0) + t.amount);
  const ids = Object.keys(by);
  if (window.Chart) {
    S.charts.push(new Chart($('#c1'), {
      type: 'doughnut',
      data: { labels: ids.map(i => cat(i).name), datasets: [{ data: ids.map(i => by[i]), backgroundColor: ids.map(i => cat(i).color), borderWidth: 0 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.parsed)}` } } } }
    }));
    const m = Array.from({ length: 12 }, (_, i) => inMonth(`${year}-${String(i + 1).padStart(2, '0')}`));
    S.charts.push(new Chart($('#c2'), {
      type: 'bar',
      data: {
        labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
        datasets: [{ label: 'Receitas', data: m.map(x => sum(x, 'income')), backgroundColor: '#10b981' }, { label: 'Despesas', data: m.map(x => sum(x, 'expense')), backgroundColor: '#f43f5e' }]
      },
      options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${brl(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: v => brl(v) } } } }
    }));
  }
}

function txRow(t) {
  const tr = t.type === 'transfer', c = tr ? { icon: '🔁', color: '#64748b', name: 'Transferência' } : cat(t.categoryId), paid = t.status === 'paid';
  const col = t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-600' : 'text-slate-500';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  return `<div class="card !p-3 flex items-center gap-3">
    <div class="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style="background:${c.color}22">${c.icon}</div>
    <div class="min-w-0 flex-1"><p class="font-medium truncate">${esc(t.description)}</p>
      <p class="text-xs text-slate-500 truncate">${fdate(t.date)} · ${esc(c.name)} · ${esc(accName(t.accountId))}${tr ? ' → ' + esc(accName(t.toAccountId)) : ''}</p></div>
    <div class="text-right"><p class="font-semibold ${col}">${sign}${brl(t.amount)}</p>
      <button data-a="toggle" data-id="${t.id}" class="text-xs px-2 rounded-full ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${paid ? 'Pago' : 'Pendente'}</button></div>
    <div class="flex flex-col"><button data-a="edit-tx" data-id="${t.id}" aria-label="Editar">✏️</button><button data-a="del-tx" data-id="${t.id}" aria-label="Excluir">🗑️</button></div></div>`;
}
function transactions() {
  const l = inMonth(S.month).sort((a, b) => b.date.localeCompare(a.date));
  $('#view').innerHTML = `<div class="space-y-2">${l.map(txRow).join('') || '<p class="text-center text-slate-500 py-10">Nenhuma transação neste mês. Toque em + para adicionar.</p>'}</div>`;
}

function accounts() {
  $('#view').innerHTML = `<button data-a="new-acc" class="btn btn-p mb-3">+ Nova conta</button>
  <div class="grid sm:grid-cols-2 gap-3">${S.acc.map(a => { const b = balance(a); return `<div class="card flex items-center gap-3">
    <div class="flex-1"><p class="font-semibold">${esc(a.name)}</p><p class="text-xs text-slate-500">${esc(a.type)}</p>
    <p class="text-lg font-bold mt-1 ${b < 0 ? 'text-rose-600' : ''}">${brl(b)}</p></div>
    <button data-a="edit-acc" data-id="${a.id}" aria-label="Editar">✏️</button><button data-a="del-acc" data-id="${a.id}" aria-label="Excluir">🗑️</button></div>`; }).join('')}</div>`;
}

function categories() {
  const grp = (type, t) => `<h3 class="font-semibold mt-4 mb-2">${t}</h3><div class="grid sm:grid-cols-2 gap-2">${S.cat.filter(c => c.type === type).map(c =>
    `<div class="card !p-3 flex items-center gap-3"><span class="w-9 h-9 rounded-full flex items-center justify-center" style="background:${c.color}33">${c.icon}</span>
    <span class="flex-1">${esc(c.name)}</span><button data-a="edit-cat" data-id="${c.id}" aria-label="Editar">✏️</button><button data-a="del-cat" data-id="${c.id}" aria-label="Excluir">🗑️</button></div>`).join('')}</div>`;
  $('#view').innerHTML = `<button data-a="new-cat" class="btn btn-p">+ Nova categoria</button>${grp('expense', 'Despesas')}${grp('income', 'Receitas')}`;
}

function settings() {
  const g = Sync.getCfg();
  $('#view').innerHTML = `<div class="space-y-4 max-w-xl">
    <div class="card"><h3 class="font-semibold mb-2">Aparência</h3>
      <select id="themeSel" class="inp">${opts([['auto', 'Automático (sistema)'], ['light', 'Claro'], ['dark', 'Escuro']], localStorage.theme || 'auto')}</select></div>
    <div class="card"><h3 class="font-semibold mb-1">Sincronização com GitHub</h3>
      <p class="text-sm text-slate-500 mb-3">Use um repositório <b>privado</b> só para os dados e um token fine-grained com <i>Contents: Read and write</i> apenas nele.</p>
      <form id="ghForm" class="space-y-2">
        ${fld('Usuário (dono)', `<input name="owner" required class="inp" value="${esc(g.owner || '')}">`)}
        ${fld('Repositório', `<input name="repo" required class="inp" value="${esc(g.repo || '')}">`)}
        ${fld('Branch', `<input name="branch" class="inp" value="${esc(g.branch || 'main')}">`)}
        ${fld('Arquivo', `<input name="path" class="inp" value="${esc(g.path || 'financas_pessoais_db.json')}">`)}
        ${fld('Token (PAT)', `<input name="token" type="password" autocomplete="off" ${g.token ? '' : 'required'} class="inp" placeholder="${g.token ? '•••••• salvo (em branco mantém)' : 'github_pat_...'}">`)}
        <div class="flex gap-2 flex-wrap pt-1"><button class="btn btn-p">Salvar e sincronizar</button><button type="button" class="btn" data-a="sync">Forçar sincronização</button><button type="button" class="btn" data-a="signout">Remover token</button></div>
      </form></div>
    <div class="card"><h3 class="font-semibold mb-1">Backup</h3>
      <p class="text-sm text-slate-500 mb-3">A importação mescla com os dados atuais (o registro mais recente vence).</p>
      <div class="flex gap-2 flex-wrap"><button class="btn" data-a="export-json">Exportar JSON</button><button class="btn" data-a="import-json">Importar JSON</button><button class="btn" data-a="csv">CSV do mês</button></div></div></div>`;
  $('#themeSel').onchange = e => { localStorage.theme = e.target.value; applyTheme(); render(); };
  $('#ghForm').onsubmit = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    Sync.saveCfg({ owner: d.owner.trim(), repo: d.repo.trim(), branch: d.branch.trim() || 'main', path: d.path.trim() || 'financas_pessoais_db.json', token: d.token.trim() || g.token });
    Sync.sync();
  };
}

/* ================= Modal e formulários ================= */
function openModal(title, body, onSubmit) {
  const m = $('#modal');
  m.innerHTML = `<form class="bg-white dark:bg-slate-800 w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-y-auto space-y-3">
    <h2 class="text-lg font-semibold">${title}</h2>${body}
    <div class="flex gap-2 pt-2"><button type="button" data-a="close" class="btn flex-1">Cancelar</button><button class="btn btn-p flex-1">Salvar</button></div></form>`;
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
      `<label class="text-center"><input type="radio" name="type" value="${v}" class="peer hidden" ${v === type ? 'checked' : ''}><span class="block py-2 rounded-lg border border-slate-300 dark:border-slate-600 cursor-pointer text-sm peer-checked:bg-emerald-600 peer-checked:text-white">${l}</span></label>`).join('')}</div>
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
    case 'close': closeModal(); break;
    case 'theme': localStorage.theme = { auto: 'light', light: 'dark', dark: 'auto' }[localStorage.theme || 'auto']; applyTheme(); render(); break;
    case 'signin': S.view = 'settings'; render(); break;
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
