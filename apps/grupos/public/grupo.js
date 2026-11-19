import {requireAccess} from '/access.js';
import {$, h, signed, tone, number, label, HOW, message, api, prefs, setupSession, drawMoves, drawSize} from '/apps/grupos/common.js';

const params = new URLSearchParams(location.search);
const accountId = params.get('account') || '', groupId = params.get('id') || '';
const card = (title, value, cls = '', note = '') => h('article', {class: 'card'}, h('span', {}, title), h('strong', {class: cls}, value), note ? h('small', {}, note) : null);
let recent = [], token = 0;

function drawRecent() {
  const kind = $('kind').value;
  const rows = $('recent');
  rows.replaceChildren();
  const list = recent.filter(e => kind === 'all' || e.kind === kind);
  if (!list.length) rows.append(h('tr', {}, h('td', {colspan: '4', class: 'empty'}, recent.length ? 'Nada neste filtro.' : 'Ainda sem movimentações registradas.')));
  for (const e of list) {
    rows.append(h('tr', {}, h('td', {}, new Date(e.ts * 1000).toLocaleString('pt-BR')),
      h('td', {class: e.kind === 'join' ? 'pos' : 'neg'}, e.kind === 'join' ? 'entrou' : 'saiu'),
      h('td', {}, HOW[e.detail] || e.detail), h('td', {}, e.phone || '—')));
  }
}

async function load() {
  const mine = ++token;
  const days = $('days').value;
  const data = await api(`group?account=${encodeURIComponent(accountId)}&id=${encodeURIComponent(groupId)}&days=${days}`);
  if (mine !== token) return;
  const g = data.group, s = data.series;
  document.title = `${g.name} — AK Workspace`;
  $('title').textContent = g.name;
  const meta = [`Número: ${g.accountName}`, g.isAdmin ? 'Você é administrador' : 'Você não é administrador'];
  if (g.alsoIn.length) meta.push(`Também está em: ${g.alsoIn.join(', ')}`);
  $('meta').textContent = meta.join(' · ');

  const joined = s.reduce((n, d) => n + d.joined, 0), left = s.reduce((n, d) => n + d.left, 0), net = joined - left;
  const today = s[s.length - 1], week = s.slice(-7);
  const weekNet = week.reduce((n, d) => n + d.joined - d.left, 0);
  const start = g.size - net;
  const growth = start > 0 ? `${net > 0 ? '+' : ''}${((net / start) * 100).toFixed(1).replace('.', ',')}%` : '—';
  const best = s.reduce((a, d) => (d.joined > a.joined ? d : a), s[0]);
  const worst = s.reduce((a, d) => (d.left > a.left ? d : a), s[0]);
  $('cards').replaceChildren(...[
    card('Membros agora', number(g.size)),
    card('Entraram hoje', number(today.joined), 'pos'), card('Saíram hoje', number(today.left), 'neg'),
    days === '7' ? null : card('Saldo 7 dias', signed(weekNet), tone(weekNet)),
    card(`Saldo em ${days} dias`, signed(net), tone(net), `${number(joined)} entraram · ${number(left)} saíram`),
    card('Variação no período', growth, tone(net)),
    card('Entradas por dia', `+${(joined / s.length).toFixed(1).replace('.', ',')}`, 'pos', `saídas: −${(left / s.length).toFixed(1).replace('.', ',')} por dia`),
    card('Dia com mais entradas', best.joined ? `+${best.joined}` : '—', best.joined ? 'pos' : '', best.joined ? label(best.day) : 'sem entradas'),
    card('Dia com mais saídas', worst.left ? `−${worst.left}` : '—', worst.left ? 'neg' : '', worst.left ? label(worst.day) : 'sem saídas')].filter(Boolean));
  drawMoves($('chart-moves'), s);
  drawSize($('chart-size'), s);
  recent = data.recent;
  drawRecent();
}

const account = await requireAccess();
if (account) {
  setupSession();
  if (!/^\d{1,9}$/.test(accountId) || !groupId) {
    $('title').textContent = 'Grupo não informado';
    message('Volte à lista e escolha um grupo.', true);
  } else {
    const wanted = params.get('days');
    $('days').value = ['7', '30', '90'].includes(wanted) ? wanted : (['7', '30', '90'].includes(prefs.get('days', '30')) ? prefs.get('days', '30') : '30');
    $('days').onchange = () => {
      prefs.set('days', $('days').value);
      const url = new URL(location.href); url.searchParams.set('days', $('days').value);
      history.replaceState(null, '', url);
      load().catch(e => message(e.message, true));
    };
    $('kind').onchange = drawRecent;
    load().then(() => message('')).catch(e => { $('title').textContent = 'Grupo não encontrado'; message(e.message, true); });
    setInterval(() => load().catch(() => {}), 60000);
  }
}
