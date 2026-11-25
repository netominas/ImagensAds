import {requireAccess} from '/access.js';
import {$, h, signed, tone, number, message, api, prefs, setupSession} from '/apps/grupos/common.js';

// Um link vindo de "Números conectados" (?account=2) abre a lista já filtrada por aquele número.
const fromLink = new URLSearchParams(location.search).get('account');
let accountFilter = /^\d{1,9}$/.test(fromLink || '') ? fromLink : prefs.get('account', 'all'), adminFilter = prefs.get('admin', 'all'), loadToken = 0, current = null;
// Ordenação da tabela (só neste navegador): coluna + sentido.
const SORTS = {name: g => g.name, account: g => g.accountName, size: g => g.size ?? -1, joinedToday: g => g.joinedToday, leftToday: g => g.leftToday,
  week: g => g.joinedWeek - g.leftWeek, period: g => g.joinedPeriod - g.leftPeriod};
let sortKey = prefs.get('sort', 'size'), sortDir = prefs.get('dir', 'desc');
if (!(sortKey in SORTS)) sortKey = 'size';
if (!['asc', 'desc'].includes(sortDir)) sortDir = 'desc';
// Dia do relatório: hoje, ontem ou uma data escolhida (calendário de São Paulo, igual ao do servidor).
let dayMode = prefs.get('daymode', 'today');
if (!['today', 'yesterday'].includes(dayMode)) dayMode = 'today'; // a data avulsa não é lembrada
const shiftDay = (day, delta) => new Date(Date.parse(day + 'T12:00:00Z') + delta * 86400000).toISOString().slice(0, 10);
const todaySP = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
const dayText = day => day.split('-').reverse().join('/');
const dateQuery = () => {
  if (dayMode === 'yesterday') return '&date=yesterday';
  const picked = $('day-date').value;
  return dayMode === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(picked) ? `&date=${picked}` : '';
};
const whenLabel = data => data.isToday ? 'hoje' : data.date === shiftDay(todaySP(), -1) ? 'ontem' : 'em ' + dayText(data.date).slice(0, 5);
// Pesquisa sem diferenciar maiúsculas nem acentos.
const plain = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Opções do filtro "Número" e aviso de coletor desligado (o cadastro de números fica em /apps/grupos/numeros).
let shownAccounts = '';
function fillAccounts(data) {
  $('collector-off').hidden = data.collectorOnline || !data.accounts.length;
  const key = JSON.stringify(data.accounts.map(a => [a.id, a.name]));
  if (accountFilter !== 'all' && !data.accounts.some(a => String(a.id) === accountFilter)) accountFilter = 'all';
  if (key !== shownAccounts) {
    shownAccounts = key;
    $('account-filter').replaceChildren(h('option', {value: 'all'}, 'Todos os números'), ...data.accounts.map(a => h('option', {value: String(a.id)}, a.name)));
  }
  $('account-filter').value = accountFilter;
}

// ---------- Resumo ----------
const ADMIN_EMPTY = {yes: 'Nenhum grupo em que você seja administrador.', no: 'Nenhum grupo em que você não seja administrador.'};
async function loadSummary() {
  const token = ++loadToken;
  const data = await api(`summary?days=${$('days').value}&account=${accountFilter}&admin=${adminFilter}${dateQuery()}`);
  if (token !== loadToken) return;
  fillAccounts(data);
  const t = data.totals, when = whenLabel(data);
  for (const el of document.querySelectorAll('th .when')) el.textContent = when;
  const note = $('date-note');
  note.hidden = data.isToday;
  note.textContent = data.isToday ? '' : `Relatório de ${dayText(data.date)}. Entradas, saídas e saldos terminam nesse dia; “Membros” é o tamanho do grupo ao fim dele (— quando ainda não havia registro).`;
  $('cards').replaceChildren(
    card('Grupos', number(t.groups)), card(data.isToday ? 'Membros (total)' : 'Membros (fim do dia)', number(t.members)),
    card(`Entraram ${when}`, number(t.joinedToday), 'pos'), card(`Saíram ${when}`, number(t.leftToday), 'neg'),
    card('Saldo 7 dias', signed(t.netWeek), tone(t.netWeek)));
  const multi = data.accounts.length > 1;
  $('dedupe-note').hidden = !(multi && data.groups.some(g => g.shared));
  current = data;
  renderGroups();
}

function renderGroups() {
  const data = current;
  if (!data) return;
  const body = $('groups');
  body.replaceChildren();
  const query = plain($('search').value);
  const rows = query ? data.groups.filter(g => plain(g.name).includes(query)) : [...data.groups];
  const pick = SORTS[sortKey], dir = sortDir === 'asc' ? 1 : -1;
  rows.sort((x, y) => {
    const a = pick(x), b = pick(y);
    const c = typeof a === 'string' ? a.localeCompare(b, 'pt-BR', {sensitivity: 'base', numeric: true}) : a - b;
    return c * dir || x.name.localeCompare(y.name, 'pt-BR', {sensitivity: 'base'}) || x.accountId - y.accountId;
  });
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const on = th.dataset.sort === sortKey;
    th.setAttribute('aria-sort', on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('.arrow').textContent = on ? (sortDir === 'asc' ? '▲' : '▼') : '';
  }
  $('count').textContent = query ? `${number(rows.length)} de ${number(data.groups.length)} grupos` : data.groups.length ? `${number(data.groups.length)} grupos` : '';
  $('search-clear').hidden = !query;
  if (!rows.length) {
    const none = !data.accounts.length && !query;
    const text = query ? `Nenhum grupo encontrado para “${$('search').value.trim()}”.` : ADMIN_EMPTY[adminFilter] || 'Nenhum grupo ainda. Vincule o WhatsApp e aguarde a primeira sincronização.';
    body.append(h('tr', {}, h('td', {colspan: '7', class: 'empty'}, none ? ['Nenhum número conectado. ', h('a', {class: 'group-link', href: '/apps/grupos/numeros'}, 'Adicionar um número')] : text)));
    return;
  }
  for (const g of rows) {
    const week = g.joinedWeek - g.leftWeek, period = g.joinedPeriod - g.leftPeriod;
    // Cada grupo abre numa página própria (link de verdade: funciona com clique do meio e "abrir em nova aba").
    const href = `/apps/grupos/grupo?account=${g.accountId}&id=${encodeURIComponent(g.id)}&days=${$('days').value}`;
    const tr = h('tr', {},
      h('td', {}, h('a', {class: 'group-link', href}, g.name), g.isAdmin ? h('span', {class: 'tag admin'}, ' admin') : h('span', {class: 'tag'}, ' (não sou admin)'), g.shared ? h('span', {class: 'tag'}, ' (em mais de um número)') : null),
      h('td', {class: 'col-account'}, g.accountName),
      h('td', {}, g.size == null ? '—' : number(g.size)), h('td', {class: 'pos'}, number(g.joinedToday)), h('td', {class: 'neg'}, number(g.leftToday)),
      h('td', {class: tone(week)}, signed(week)), h('td', {class: tone(period)}, signed(period)));
    tr.style.cursor = 'pointer';
    tr.onclick = e => { if (!e.target.closest('a')) location.href = href; };
    body.append(tr);
  }
}
const card = (label, value, cls = '') => h('article', {class: 'card'}, h('span', {}, label), h('strong', {class: cls}, value));

// ---------- Início ----------
const account = await requireAccess();
if (account) {
  setupSession();
  $('days').value = ['7', '30', '90'].includes(prefs.get('days', '30')) ? prefs.get('days', '30') : '30';
  if (!['all', 'yes', 'no'].includes(adminFilter)) adminFilter = 'all';
  $('admin-filter').value = adminFilter;
  const reload = () => loadSummary().catch(e => message(e.message, true));
  const pickable = $('day-date');
  pickable.max = todaySP(); pickable.min = shiftDay(todaySP(), -365);
  const showDay = () => { $('day-mode').value = dayMode; $('day-custom').hidden = dayMode !== 'custom'; };
  showDay();
  $('day-mode').onchange = () => {
    dayMode = $('day-mode').value;
    if (dayMode !== 'custom') prefs.set('daymode', dayMode);
    else if (!pickable.value) pickable.value = shiftDay(todaySP(), -1); // começa em ontem; o usuário ajusta
    showDay(); reload();
  };
  pickable.onchange = () => { if (pickable.value) reload(); };
  $('days').onchange = () => { prefs.set('days', $('days').value); reload(); };
  $('admin-filter').onchange = () => { adminFilter = $('admin-filter').value; prefs.set('admin', adminFilter); reload(); };
  $('account-filter').onchange = () => { accountFilter = $('account-filter').value; prefs.set('account', accountFilter); reload(); };
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.querySelector('button').onclick = () => {
      const key = th.dataset.sort;
      // primeira vez numa coluna: nomes de A a Z, números do maior para o menor; clicar de novo inverte
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = key === 'name' || key === 'account' ? 'asc' : 'desc'; }
      prefs.set('sort', sortKey); prefs.set('dir', sortDir);
      renderGroups();
    };
  }
  $('search').oninput = renderGroups;
  $('search').onkeydown = e => { if (e.key === 'Escape') { $('search').value = ''; renderGroups(); } };
  $('search-clear').onclick = () => { $('search').value = ''; renderGroups(); $('search').focus(); };
  reload();
  setInterval(() => loadSummary().catch(() => {}), 60000);
}
