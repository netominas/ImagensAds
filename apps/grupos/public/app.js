import {requireAccess, secureFetch} from '/access.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const signed = n => (n > 0 ? '+' + n : String(n));
const tone = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const number = n => Number(n ?? 0).toLocaleString('pt-BR');
const HOW = {added: 'adicionado', joined: 'entrou sozinho', left: 'saiu sozinho', removed: 'removido', detected: 'detectado'};

// Os nomes de grupos vêm do WhatsApp (não confiáveis): tudo é inserido como texto, nunca como HTML.
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

let selected = null, pollTimer = null, loadToken = 0;

// ---------- Conexão com o WhatsApp ----------
function renderCollector(c) {
  const box = $('collector');
  box.replaceChildren();
  const when = c.lastSync ? new Date(c.lastSync * 1000).toLocaleString('pt-BR') : '—';
  if (!c.online) {
    box.append(h('div', {class: 'status off'}, h('strong', {}, 'Coletor desligado'),
      h('p', {}, 'O serviço que acompanha os grupos não está em execução. Assim que ele iniciar, esta tela mostra o QR Code para vincular o WhatsApp.')));
  } else if (c.state === 'qr') {
    const img = h('img', {class: 'qr', width: '280', height: '280', alt: 'QR Code para vincular o WhatsApp'});
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(c.qrSvg || '');
    box.append(h('div', {class: 'status qr-wrap'}, img, h('div', {},
      h('strong', {}, 'Vincule o WhatsApp'),
      h('ol', {}, h('li', {}, 'No celular, abra o WhatsApp.'), h('li', {}, 'Configurações → Aparelhos conectados → Conectar um aparelho.'), h('li', {}, 'Aponte a câmera para este QR Code.')),
      h('p', {class: 'subtle small'}, 'O código expira e é renovado automaticamente. Use de preferência um número dedicado.'))));
  } else if (c.state === 'open') {
    const sync = h('button', {type: 'button'}, 'Sincronizar agora');
    const relink = h('button', {type: 'button', class: 'danger'}, 'Desvincular WhatsApp');
    sync.onclick = () => run('sync', 'Sincronização solicitada.');
    relink.onclick = () => { if (confirm('Desvincular o WhatsApp? Será necessário escanear um novo QR Code.')) run('relink', 'Desvinculando…'); };
    box.append(h('div', {class: 'status on'}, h('div', {}, h('strong', {}, 'Conectado'),
      h('p', {}, `Conta ${c.account || '—'} · ${number(c.groupsCount)} grupos · última sincronização ${when}`)),
      h('div', {class: 'actions'}, sync, relink)));
  } else {
    box.append(h('div', {class: 'status wait'}, h('strong', {}, 'Conectando ao WhatsApp…'), h('p', {}, 'Aguarde alguns segundos.')));
  }
  if (c.online && c.error) box.append(h('p', {class: 'warn'}, c.error));
  clearTimeout(pollTimer);
  pollTimer = setTimeout(refreshCollector, c.online && c.state === 'open' ? 30000 : 3000);
}
async function refreshCollector() {
  try { renderCollector(await api('collector')); } catch (e) { message(e.message, true); }
}
async function run(command, text) {
  try { await api('collector/command', {method: 'POST', body: JSON.stringify({command})}); message(text); setTimeout(() => { refreshCollector(); loadSummary(); }, 6000); }
  catch (e) { message(e.message, true); }
}

// ---------- Resumo ----------
async function loadSummary() {
  const token = ++loadToken;
  const data = await api('summary?days=' + $('days').value);
  if (token !== loadToken) return;
  renderCollector(data.collector);
  const t = data.totals;
  $('cards').replaceChildren(
    card('Grupos', number(t.groups)), card('Membros (total)', number(t.members)),
    card('Entraram hoje', number(t.joinedToday), 'pos'), card('Saíram hoje', number(t.leftToday), 'neg'),
    card('Saldo 7 dias', signed(t.netWeek), tone(t.netWeek)));
  const body = $('groups');
  body.replaceChildren();
  if (!data.groups.length) {
    body.append(h('tr', {}, h('td', {colspan: '6', class: 'empty'}, 'Nenhum grupo ainda. Vincule o WhatsApp acima e aguarde a primeira sincronização.')));
    return;
  }
  for (const g of data.groups) {
    const week = g.joinedWeek - g.leftWeek, period = g.joinedPeriod - g.leftPeriod;
    const tr = h('tr', {tabindex: '0', 'aria-selected': g.id === selected ? 'true' : 'false'},
      h('td', {}, g.name, g.isAdmin ? null : h('span', {class: 'tag'}, ' (não sou admin)')),
      h('td', {}, number(g.size)), h('td', {class: 'pos'}, number(g.joinedToday)), h('td', {class: 'neg'}, number(g.leftToday)),
      h('td', {class: tone(week)}, signed(week)), h('td', {class: tone(period)}, signed(period)));
    const open = () => openGroup(g.id);
    tr.onclick = open;
    tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    body.append(tr);
  }
  if (selected) openGroup(selected, false);
}
const card = (label, value, cls = '') => h('article', {class: 'card'}, h('span', {}, label), h('strong', {class: cls}, value));

// ---------- Detalhe e gráficos ----------
async function openGroup(id, scroll = true) {
  selected = id;
  const data = await api(`group?id=${encodeURIComponent(id)}&days=${$('days').value}`);
  if (selected !== id) return;
  for (const tr of $('groups').children) tr.setAttribute('aria-selected', 'false');
  $('detail').hidden = false;
  $('detail-title').textContent = data.group.name;
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
  loadSummary().catch(e => message(e.message, true));
  setInterval(() => loadSummary().catch(() => {}), 60000);
}
