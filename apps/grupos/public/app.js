import {requireAccess, secureFetch} from '/access.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const signed = n => (n > 0 ? '+' + n : String(n));
const tone = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const number = n => Number(n ?? 0).toLocaleString('pt-BR');
const HOW = {added: 'adicionado', joined: 'entrou sozinho', left: 'saiu sozinho', removed: 'removido', detected: 'detectado'};

// Nomes de grupos e de números vêm de fora (não confiáveis): tudo é inserido como texto, nunca como HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}
function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }

async function api(path, options = {}) {
  const response = await secureFetch('/apps/grupos/api/' + path, {cache: 'no-store', headers: {'Content-Type': 'application/json'}, ...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

let selected = null; // {account, id} do grupo aberto
let accountFilter = 'all', pollTimer = null, loadToken = 0, known = [];
const post = (path, body) => api(path, {method: 'POST', body: JSON.stringify(body)});

// ---------- Números conectados ----------
function accountCard(a) {
  const when = a.lastSync ? new Date(a.lastSync * 1000).toLocaleString('pt-BR') : '—';
  const buttons = [];
  const rename = h('button', {type: 'button', class: 'ghost'}, 'Renomear');
  rename.onclick = async () => {
    const name = prompt('Novo nome do número:', a.name);
    if (name && name.trim() && name.trim() !== a.name) await act(() => post(`accounts/${a.id}/rename`, {name}), 'Nome atualizado.');
  };
  const remove = h('button', {type: 'button', class: 'danger'}, 'Remover');
  remove.onclick = async () => {
    if (confirm(`Remover o número “${a.name}”? Ele será desconectado do WhatsApp e a sessão apagada. O histórico fica guardado.`))
      await act(() => api(`accounts/${a.id}`, {method: 'DELETE'}), 'Número removido.');
  };
  let body;
  if (!a.online) {
    body = h('p', {class: 'st off'}, 'Coletor desligado');
  } else if (a.state === 'qr') {
    const img = h('img', {class: 'qr', width: '240', height: '240', alt: `QR Code para vincular ${a.name}`});
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a.qrSvg || '');
    body = h('div', {class: 'qr-wrap'}, img, h('div', {},
      h('strong', {}, 'Vincule este número'),
      h('ol', {}, h('li', {}, 'No celular, abra o WhatsApp deste número.'), h('li', {}, 'Configurações → Aparelhos conectados → Conectar um aparelho.'), h('li', {}, 'Aponte a câmera para o QR Code.')),
      h('p', {class: 'subtle small'}, 'O código expira e é renovado automaticamente. Use de preferência um número dedicado.')));
  } else if (a.state === 'open') {
    const sync = h('button', {type: 'button'}, 'Sincronizar agora');
    sync.onclick = () => act(() => post(`accounts/${a.id}/command`, {command: 'sync'}), 'Sincronização solicitada.', 6000);
    const relink = h('button', {type: 'button', class: 'ghost'}, 'Desvincular');
    relink.onclick = () => { if (confirm(`Desvincular “${a.name}”? Será preciso escanear um novo QR Code.`)) act(() => post(`accounts/${a.id}/command`, {command: 'relink'}), 'Desvinculando…', 6000); };
    buttons.push(sync, relink);
    body = h('p', {class: 'st on'}, `Conectado · ${a.phone || '—'} · ${number(a.groupsCount)} grupos · sincronizado ${when}`);
  } else {
    body = h('p', {class: 'st wait'}, 'Conectando ao WhatsApp…');
  }
  return h('article', {class: 'account-card'},
    h('div', {class: 'account-head'}, h('strong', {}, a.name), h('span', {class: 'actions'}, ...buttons, rename, remove)),
    body, a.online && a.error ? h('p', {class: 'warn'}, a.error) : null);
}
const fingerprint = list => JSON.stringify(list.map(a => [a.id, a.state, a.name, a.qrSvg?.length, a.groupsCount, a.lastSync, a.online, a.error]));
function renderAccounts(data) {
  known = data.accounts;
  $('collector-off').hidden = data.collectorOnline;
  $('add-account').disabled = data.accounts.length >= data.max;
  const box = $('accounts');
  box.replaceChildren();
  if (!data.accounts.length) box.append(h('p', {class: 'empty'}, 'Nenhum número ainda. Clique em “Adicionar número” e escaneie o QR Code com o WhatsApp.'));
  for (const a of data.accounts) box.append(accountCard(a));
  const select = $('account-filter');
  select.replaceChildren(h('option', {value: 'all'}, 'Todos os números'), ...data.accounts.map(a => h('option', {value: String(a.id)}, a.name)));
  if (accountFilter !== 'all' && !data.accounts.some(a => String(a.id) === accountFilter)) accountFilter = 'all';
  select.value = accountFilter;
  clearTimeout(pollTimer);
  const busy = !data.collectorOnline || data.accounts.some(a => a.state !== 'open');
  pollTimer = setTimeout(refreshAccounts, busy ? 3000 : 30000);
}
async function refreshAccounts() {
  try { renderAccounts(await api('accounts')); } catch (e) { message(e.message, true); }
}
async function act(call, text, reloadAfter = 0) {
  try {
    await call(); message(text);
    await refreshAccounts();
    await loadSummary();
    if (reloadAfter) setTimeout(() => { refreshAccounts(); loadSummary().catch(() => {}); }, reloadAfter);
  } catch (e) { message(e.message, true); }
}

// ---------- Resumo ----------
async function loadSummary() {
  const token = ++loadToken;
  const data = await api(`summary?days=${$('days').value}&account=${accountFilter}`);
  if (token !== loadToken) return;
  if (fingerprint(known) !== fingerprint(data.accounts)) renderAccounts(data);
  const t = data.totals;
  $('cards').replaceChildren(
    card('Grupos', number(t.groups)), card('Membros (total)', number(t.members)),
    card('Entraram hoje', number(t.joinedToday), 'pos'), card('Saíram hoje', number(t.leftToday), 'neg'),
    card('Saldo 7 dias', signed(t.netWeek), tone(t.netWeek)));
  const multi = data.accounts.length > 1;
  $('groups-table').classList.toggle('hide-account', !(multi && accountFilter === 'all'));
  $('dedupe-note').hidden = !(multi && data.groups.some(g => g.shared));
  const body = $('groups');
  body.replaceChildren();
  if (!data.groups.length) {
    body.append(h('tr', {}, h('td', {colspan: '7', class: 'empty'}, data.accounts.length ? 'Nenhum grupo ainda. Vincule o WhatsApp e aguarde a primeira sincronização.' : 'Adicione um número para começar.')));
    return;
  }
  for (const g of data.groups) {
    const week = g.joinedWeek - g.leftWeek, period = g.joinedPeriod - g.leftPeriod;
    const isSel = selected && selected.account === g.accountId && selected.id === g.id;
    const tr = h('tr', {tabindex: '0', 'aria-selected': isSel ? 'true' : 'false'},
      h('td', {}, g.name, g.isAdmin ? null : h('span', {class: 'tag'}, ' (não sou admin)'), g.shared ? h('span', {class: 'tag'}, ' (em mais de um número)') : null),
      h('td', {class: 'col-account'}, g.accountName),
      h('td', {}, number(g.size)), h('td', {class: 'pos'}, number(g.joinedToday)), h('td', {class: 'neg'}, number(g.leftToday)),
      h('td', {class: tone(week)}, signed(week)), h('td', {class: tone(period)}, signed(period)));
    const open = () => openGroup(g.accountId, g.id);
    tr.onclick = open;
    tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    body.append(tr);
  }
  if (selected) openGroup(selected.account, selected.id, false).catch(() => {});
}
const card = (label, value, cls = '') => h('article', {class: 'card'}, h('span', {}, label), h('strong', {class: cls}, value));

// ---------- Detalhe e gráficos ----------
async function openGroup(account, id, scroll = true) {
  selected = {account, id};
  const data = await api(`group?account=${account}&id=${encodeURIComponent(id)}&days=${$('days').value}`);
  if (!selected || selected.account !== account || selected.id !== id) return;
  for (const tr of $('groups').children) tr.setAttribute('aria-selected', 'false');
  $('detail').hidden = false;
  $('detail-title').textContent = data.group.name;
  $('detail-account').textContent = 'Número: ' + (known.find(a => a.id === account)?.name || account);
  drawMoves($('chart-moves'), data.series);
  drawSize($('chart-size'), data.series);
  const rows = $('recent');
  rows.replaceChildren();
  if (!data.recent.length) rows.append(h('tr', {}, h('td', {colspan: '4', class: 'empty'}, 'Ainda sem movimentações registradas.')));
  for (const e of data.recent) {
    rows.append(h('tr', {}, h('td', {}, new Date(e.ts * 1000).toLocaleString('pt-BR')),
      h('td', {class: e.kind === 'join' ? 'pos' : 'neg'}, e.kind === 'join' ? 'entrou' : 'saiu'),
      h('td', {}, HOW[e.detail] || e.detail), h('td', {}, e.phone || '—')));
  }
  if (scroll) $('detail').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
const label = day => day.slice(8) + '/' + day.slice(5, 7);

function frame(box, height) {
  const root = svg('svg', {viewBox: `0 0 720 ${height}`, role: 'img'});
  box.replaceChildren(root);
  return root;
}
function drawMoves(box, series) {
  const H = 200, mid = 110, W = 720, n = series.length, slot = W / n, bar = Math.max(2, slot * 0.7);
  const max = Math.max(1, ...series.map(s => Math.max(s.joined, s.left)));
  const root = frame(box, H);
  root.append(svg('line', {x1: 0, x2: W, y1: mid, y2: mid, class: 'axis'}));
  series.forEach((s, i) => {
    const x = i * slot + (slot - bar) / 2;
    const up = (s.joined / max) * (mid - 22), down = (s.left / max) * (H - mid - 22);
    const a = svg('rect', {x, y: mid - up, width: bar, height: up, class: 'bar-pos'});
    const b = svg('rect', {x, y: mid, width: bar, height: down, class: 'bar-neg'});
    const t = svg('title'); t.textContent = `${label(s.day)}: +${s.joined} / −${s.left}`;
    a.append(t.cloneNode(true)); b.append(t);
    root.append(a, b);
    if (i % Math.ceil(n / 8) === 0) {
      const tx = svg('text', {x: x + bar / 2, y: H - 4, class: 'tick', 'text-anchor': 'middle'}); tx.textContent = label(s.day); root.append(tx);
    }
  });
}
function drawSize(box, series) {
  const H = 170, W = 720, pad = 18;
  const values = series.map(s => s.size).filter(v => v != null);
  const root = frame(box, H);
  if (!values.length) { const t = svg('text', {x: W / 2, y: H / 2, class: 'tick', 'text-anchor': 'middle'}); t.textContent = 'Sem dados ainda'; root.append(t); return; }
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(1, hi - lo);
  const x = i => (series.length === 1 ? W / 2 : (i / (series.length - 1)) * (W - 2 * pad) + pad);
  const y = v => H - 26 - ((v - lo) / span) * (H - 50);
  const points = series.map((s, i) => (s.size == null ? null : `${x(i).toFixed(1)},${y(s.size).toFixed(1)}`)).filter(Boolean);
  root.append(svg('polyline', {points: points.join(' '), class: 'line'}));
  series.forEach((s, i) => {
    if (s.size == null) return;
    const dot = svg('circle', {cx: x(i), cy: y(s.size), r: 3, class: 'dot'});
    const t = svg('title'); t.textContent = `${label(s.day)}: ${number(s.size)} membros`; dot.append(t); root.append(dot);
  });
  const top = svg('text', {x: 4, y: 12, class: 'tick'}); top.textContent = number(hi);
  const bottom = svg('text', {x: 4, y: H - 8, class: 'tick'}); bottom.textContent = number(lo);
  root.append(top, bottom);
}

// ---------- Início ----------
const account = await requireAccess();
if (account) {
  $('logout').onclick = async () => {
    const button = $('logout'); button.disabled = true;
    try {
      const response = await fetch('/api/logout', {method: 'POST'});
      if (!response.ok) throw new Error('Não foi possível sair. Tente novamente.');
      localStorage.setItem('adstudio-logout', String(Date.now())); location.replace('/login');
    } catch (error) { message(error.message, true); button.disabled = false; }
  };
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  window.addEventListener('storage', e => { if (e.key === 'adstudio-logout') location.replace('/login'); });
  $('days').onchange = () => loadSummary().catch(e => message(e.message, true));
  $('account-filter').onchange = () => { accountFilter = $('account-filter').value; selected = null; $('detail').hidden = true; loadSummary().catch(e => message(e.message, true)); };
  $('add-account').onclick = async () => {
    const name = prompt('Nome do novo número (ex.: Promoções 1):');
    if (name && name.trim()) await act(() => post('accounts', {name}), 'Número adicionado. Aguarde o QR Code aparecer.', 4000);
  };
  await refreshAccounts();
  loadSummary().catch(e => message(e.message, true));
  setInterval(() => loadSummary().catch(() => {}), 60000);
}
