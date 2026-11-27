import {requireAccess} from '/access.js';
import {$, h, number, money, statusLabel, message, api, post, prefs, setupSession, whenLabel, plain, reportControls} from '/apps/grupos/common.js';

// Campanhas do Meta (somente leitura): cada uma pode ser ligada a um agrupamento; o nome abre o relatório.
const SORTS = {name: c => c.name, status: c => statusLabel(c.status), spendDay: c => c.spendDay, leadsDay: c => c.leadsDay, spend: c => c.spend, leads: c => c.leads,
  cpl: c => c.cpl ?? Infinity, cluster: c => c.clusterName ?? ''};
let sortKey = prefs.get('qsort', 'spend'), sortDir = prefs.get('qdir', 'desc');
if (!(sortKey in SORTS)) sortKey = 'spend';
if (!['asc', 'desc'].includes(sortDir)) sortDir = 'desc';
let statusMode = prefs.get('qstatus', 'running'), linkMode = prefs.get('qlink', 'all');
if (!['running', 'all'].includes(statusMode)) statusMode = 'running';
if (!['all', 'none', 'linked'].includes(linkMode)) linkMode = 'all';
let current = null, loadToken = 0, query = () => '', wantFresh = false;

async function load() {
  const token = ++loadToken, fresh = wantFresh;
  wantFresh = false;
  const data = await api(`campaigns?${query()}${fresh ? '&fresh=1' : ''}`);
  if (token !== loadToken) return;
  current = data;
  $('meta-off').hidden = data.configured;
  $('refresh').disabled = !data.configured;
  const when = whenLabel(data);
  for (const el of document.querySelectorAll('th .when')) el.textContent = when;
  const running = data.campaigns.filter(c => c.status === 'ACTIVE' && c.clusterId == null);
  $('unlinked').hidden = !running.length;
  const show = h('button', {type: 'button', class: 'linklike'}, 'Ver quais');
  show.onclick = () => { $('link-filter').value = linkMode = 'none'; $('status-filter').value = statusMode = 'running'; render(); };
  $('unlinked').replaceChildren(`${number(running.length)} ${running.length === 1 ? 'campanha ativa ainda está' : 'campanhas ativas ainda estão'} sem agrupamento. `, show);
  render();
}

const isRunning = c => c.status === 'ACTIVE' || c.spend > 0 || c.clusterId != null;

function render() {
  const data = current;
  if (!data) return;
  const body = $('campaigns');
  body.replaceChildren();
  for (const th of document.querySelectorAll('th[data-sort]')) {
    const on = th.dataset.sort === sortKey;
    th.setAttribute('aria-sort', on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('.arrow').textContent = on ? (sortDir === 'asc' ? '▲' : '▼') : '';
  }
  const text = plain($('search').value);
  const rows = data.campaigns.filter(c => (statusMode === 'all' || isRunning(c)) && (!text || plain(c.name).includes(text))
    && (linkMode === 'all' || (linkMode === 'none' ? c.clusterId == null : c.clusterId != null)));
  $('count').textContent = data.configured ? `${number(rows.length)} de ${number(data.campaigns.length)} campanhas` : '';
  $('search-clear').hidden = !text;
  if (!rows.length) {
    body.append(h('tr', {}, h('td', {colspan: '8', class: 'empty'}, !data.configured ? 'Sem conexão com a Meta.' : text ? `Nenhuma campanha encontrada para “${$('search').value.trim()}”.` : 'Nenhuma campanha com esses filtros.')));
    return;
  }
  const pick = SORTS[sortKey], dir = sortDir === 'asc' ? 1 : -1;
  rows.sort((x, y) => {
    const a = pick(x), b = pick(y);
    const c = typeof a === 'string' ? a.localeCompare(b, 'pt-BR', {sensitivity: 'base', numeric: true}) : (a === b ? 0 : a - b);
    return c * dir || x.name.localeCompare(y.name, 'pt-BR', {sensitivity: 'base'});
  });
  for (const c of rows) {
    const href = `/apps/grupos/campanha?id=${c.id}`;
    const tr = h('tr', {},
      h('td', {class: 'col-name'}, h('a', {class: 'group-link', href}, c.name)),
      h('td', {}, h('span', {class: 'tag' + (c.status === 'ACTIVE' ? ' admin' : '')}, statusLabel(c.status))),
      h('td', {}, money(c.spendDay)), h('td', {}, number(c.leadsDay)),
      h('td', {}, money(c.spend)), h('td', {}, number(c.leads)), h('td', {}, c.cpl == null ? '—' : money(c.cpl)),
      h('td', {class: 'col-pick'}, clusterSelect(c)));
    tr.style.cursor = 'pointer';
    tr.onclick = e => { if (!e.target.closest('a,select,button')) location.href = href; };
    body.append(tr);
  }
}

function clusterSelect(c) {
  const select = h('select', {'aria-label': `Agrupamento da campanha ${c.name}`},
    h('option', {value: ''}, '— Sem agrupamento —'), ...current.clusters.map(k => h('option', {value: String(k.id)}, k.name)));
  select.value = c.clusterId == null ? '' : String(c.clusterId);
  select.onchange = async () => {
    const before = c.clusterId;
    select.disabled = true;
    try {
      await post(`campaigns/${c.id}/cluster`, {cluster: select.value === '' ? null : Number(select.value)});
      c.clusterId = select.value === '' ? null : Number(select.value);
      c.clusterName = c.clusterId == null ? null : current.clusters.find(k => k.id === c.clusterId)?.name ?? null;
      message(c.clusterId == null ? `“${c.name}” ficou sem agrupamento.` : `“${c.name}” ligada ao agrupamento “${c.clusterName}”.`);
      const running = current.campaigns.filter(x => x.status === 'ACTIVE' && x.clusterId == null);
      $('unlinked').hidden = !running.length;
      if (running.length) $('unlinked').firstChild.textContent = `${number(running.length)} ${running.length === 1 ? 'campanha ativa ainda está' : 'campanhas ativas ainda estão'} sem agrupamento. `;
      if (linkMode !== 'all') render();
    } catch (error) {
      message(error.message, true);
      select.value = before == null ? '' : String(before);
    }
    select.disabled = false;
  };
  return select;
}

const account = await requireAccess();
if (account) {
  setupSession();
  const reload = () => load().catch(e => message(e.message, true));
  query = reportControls(reload);
  $('status-filter').value = statusMode;
  $('link-filter').value = linkMode;
  $('status-filter').onchange = () => { statusMode = $('status-filter').value; prefs.set('qstatus', statusMode); render(); };
  $('link-filter').onchange = () => { linkMode = $('link-filter').value; prefs.set('qlink', linkMode); render(); };
  $('search').oninput = render;
  $('search').onkeydown = e => { if (e.key === 'Escape') { $('search').value = ''; render(); } };
  $('search-clear').onclick = () => { $('search').value = ''; render(); $('search').focus(); };
  $('refresh').onclick = async () => {
    const button = $('refresh');
    button.disabled = true; wantFresh = true; message('Buscando na Meta…');
    try { await load(); message(''); } catch (e) { message(e.message, true); }
    button.disabled = !current?.configured;
  };
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.querySelector('button').onclick = () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = key === 'name' || key === 'cluster' || key === 'status' || key === 'cpl' ? 'asc' : 'desc'; }
      prefs.set('qsort', sortKey); prefs.set('qdir', sortDir);
      render();
    };
  }
  reload();
  setInterval(() => load().catch(() => {}), 120000);
}
