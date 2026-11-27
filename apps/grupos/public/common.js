import {secureFetch} from '/access.js';

// Utilidades compartilhadas pela lista (app.js) e pela página do grupo (grupo.js).
export const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
export const signed = n => (n > 0 ? '+' + n : String(n));
export const tone = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
export const number = n => Number(n ?? 0).toLocaleString('pt-BR');
export const HOW = {added: 'adicionado', joined: 'entrou sozinho', left: 'saiu sozinho', removed: 'removido', detected: 'detectado'};
export const label = day => day.slice(8) + '/' + day.slice(5, 7);

// Nomes de grupos e de números vêm de fora (não confiáveis): tudo é inserido como texto, nunca como HTML.
export function h(tag, attrs = {}, ...children) {
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
export function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }

export async function api(path, options = {}) {
  const response = await secureFetch('/apps/grupos/api/' + path, {cache: 'no-store', headers: {'Content-Type': 'application/json'}, ...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}
export const post = (path, body) => api(path, {method: 'POST', body: JSON.stringify(body)});

// Datas do relatório (calendário de São Paulo, igual ao do servidor) e pesquisa sem acento/maiúsculas.
export const shiftDay = (day, delta) => new Date(Date.parse(day + 'T12:00:00Z') + delta * 86400000).toISOString().slice(0, 10);
export const todaySP = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
export const dayText = day => day.split('-').reverse().join('/');
export const whenLabel = data => data.isToday ? 'hoje' : data.date === shiftDay(todaySP(), -1) ? 'ontem' : 'em ' + dayText(data.date).slice(0, 5);
export const plain = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Preferências só deste navegador (filtros). Pode falhar em janela privada: nunca é essencial.
export const prefs = {
  get(key, fallback) { try { return localStorage.getItem('grupos-' + key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('grupos-' + key, value); } catch { /* ignora */ } },
};

// Valores em reais e razões (a conta de anúncios é em BRL) e rótulos de status das campanhas da Meta.
export const money = n => Number(n ?? 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
export const ratio = n => Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '×';
const STATUS = {ACTIVE: 'Ativa', PAUSED: 'Pausada', CAMPAIGN_PAUSED: 'Pausada', ADSET_PAUSED: 'Pausada', ARCHIVED: 'Arquivada', DELETED: 'Excluída', WITH_ISSUES: 'Com problemas',
  IN_PROCESS: 'Em análise', PENDING_REVIEW: 'Em análise', DISAPPROVED: 'Reprovada', PENDING_BILLING_INFO: 'Pagamento pendente'};
export const statusLabel = status => STATUS[status] || (status ? status.toLowerCase() : '—');

export const card = (label, value, cls = '') => h('article', {class: 'card'}, h('span', {}, label), h('strong', {class: cls}, value));

// Seletores "Dia" (hoje/ontem) e "Período" das páginas de agrupamentos; lembram a escolha neste navegador
// (as mesmas chaves da lista de grupos). Devolve a função que monta a consulta da API.
export function reportControls(reload) {
  const days = $('days'), mode = $('day-mode');
  const savedDays = prefs.get('days', '30'), savedMode = prefs.get('daymode', 'today');
  days.value = ['7', '30', '90'].includes(savedDays) ? savedDays : '30';
  mode.value = ['today', 'yesterday'].includes(savedMode) ? savedMode : 'today';
  days.onchange = () => { prefs.set('days', days.value); reload(); };
  mode.onchange = () => { prefs.set('daymode', mode.value); reload(); };
  return () => `days=${days.value}${mode.value === 'yesterday' ? '&date=yesterday' : ''}`;
}

export function setupSession() {
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
}

// ---------- Gráficos (SVG feito à mão, sem bibliotecas) ----------
function frame(box, height) {
  const root = svg('svg', {viewBox: `0 0 720 ${height}`, role: 'img'});
  box.replaceChildren(root);
  return root;
}
export function drawMoves(box, series) {
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
export function drawSize(box, series) {
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
