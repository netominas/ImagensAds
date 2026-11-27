import {requireAccess} from '/access.js';
import {$, h, signed, tone, number, message, api, post, prefs, setupSession, whenLabel, reportControls} from '/apps/grupos/common.js';

// Lista de agrupamentos (nichos): cada um reúne grupos de WhatsApp e tem um ID próprio.
const SORTS = {name: c => c.name, groups: c => c.groups, members: c => c.members, joinedToday: c => c.joinedToday, leftToday: c => c.leftToday,
  netWeek: c => c.netWeek, netPeriod: c => c.netPeriod};
let sortKey = prefs.get('csort', 'name'), sortDir = prefs.get('cdir', 'asc');
if (!(sortKey in SORTS)) sortKey = 'name';
if (!['asc', 'desc'].includes(sortDir)) sortDir = 'asc';
let current = null, loadToken = 0, query = () => '';

async function load() {
  const token = ++loadToken;
  const data = await api(`clusters?${query()}`);
  if (token !== loadToken) return;
  current = data;
  const when = whenLabel(data);
  for (const el of document.querySelectorAll('th .when')) el.textContent = when;
  const free = data.unassigned;
  const notice = $('unassigned');
  notice.hidden = !free.groups;
  notice.replaceChildren(`${number(free.groups)} ${free.groups === 1 ? 'grupo ainda está' : 'grupos ainda estão'} sem agrupamento (${number(free.members)} membros). `,
    h('a', {class: 'group-link', href: '/apps/grupos/?cluster=none'}, 'Ver quais'));
  render();
}

function render() {
  const data = current;
  if (!data) return;
  const body = $('clusters');
  body.replaceChildren();
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const on = th.dataset.sort === sortKey;
    th.setAttribute('aria-sort', on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('.arrow').textContent = on ? (sortDir === 'asc' ? '▲' : '▼') : '';
  }
  if (!data.clusters.length) {
    body.append(h('tr', {}, h('td', {colspan: '8', class: 'empty'}, 'Nenhum agrupamento ainda. Crie o primeiro acima (ex.: Off-grid solar).')));
    return;
  }
  const pick = SORTS[sortKey], dir = sortDir === 'asc' ? 1 : -1;
  const rows = [...data.clusters].sort((x, y) => {
    const a = pick(x), b = pick(y);
    const c = typeof a === 'string' ? a.localeCompare(b, 'pt-BR', {sensitivity: 'base', numeric: true}) : a - b;
    return c * dir || x.name.localeCompare(y.name, 'pt-BR', {sensitivity: 'base'}) || x.id - y.id;
  });
  for (const c of rows) {
    const href = `/apps/grupos/agrupamento?id=${c.id}`;
    const tr = h('tr', {},
      h('td', {class: 'id'}, h('span', {class: 'tag'}, '#' + c.id)),
      h('td', {}, h('a', {class: 'group-link', href}, c.name)),
      h('td', {}, number(c.groups)), h('td', {}, number(c.members)),
      h('td', {class: 'pos'}, number(c.joinedToday)), h('td', {class: 'neg'}, number(c.leftToday)),
      h('td', {class: tone(c.netWeek)}, signed(c.netWeek)), h('td', {class: tone(c.netPeriod)}, signed(c.netPeriod)));
    tr.style.cursor = 'pointer';
    tr.onclick = e => { if (!e.target.closest('a')) location.href = href; };
    body.append(tr);
  }
}

const account = await requireAccess();
if (account) {
  setupSession();
  const reload = () => load().catch(e => message(e.message, true));
  query = reportControls(reload);
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.querySelector('button').onclick = () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = key === 'name' ? 'asc' : 'desc'; }
      prefs.set('csort', sortKey); prefs.set('cdir', sortDir);
      render();
    };
  }
  $('new-cluster').onsubmit = async e => {
    e.preventDefault();
    const name = $('cluster-name').value.trim();
    if (!name) return;
    const button = e.submitter || $('new-cluster').querySelector('button');
    button.disabled = true;
    try {
      const created = await post('clusters', {name});
      location.href = `/apps/grupos/agrupamento?id=${created.id}`; // já abre para escolher os grupos
    } catch (error) { message(error.message, true); button.disabled = false; }
  };
  reload();
  setInterval(() => load().catch(() => {}), 60000);
}
