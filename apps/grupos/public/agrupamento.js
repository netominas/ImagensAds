import {requireAccess} from '/access.js';
import {$, h, signed, tone, number, message, api, post, setupSession, whenLabel, plain, card, reportControls} from '/apps/grupos/common.js';

// Página de um agrupamento: resumo, grupos que já estão nele e lista para adicionar outros.
const id = new URLSearchParams(location.search).get('id') || '';
let current = null, loadToken = 0, query = () => '';
const selected = new Set(); // IDs de grupos marcados na lista "Adicionar grupos"

async function load() {
  const token = ++loadToken;
  const data = await api(`clusters/${id}?${query()}`);
  if (token !== loadToken) return;
  current = data;
  const c = data.cluster, t = data.totals, when = whenLabel(data);
  document.title = `${c.name} — AK Workspace`;
  $('title').textContent = c.name;
  $('eyebrow').textContent = `AGRUPAMENTO · ID ${c.id}`;
  $('meta').textContent = 'Os grupos abaixo contam como este nicho. As campanhas do Meta que enviam leads para eles são ligadas em Campanhas.';
  $('campaigns-panel').hidden = !data.campaigns.length;
  $('campaigns').replaceChildren(...data.campaigns.map(x => h('li', {}, h('a', {class: 'group-link', href: `/apps/grupos/campanha?id=${x.id}`}, x.name))));
  for (const el of document.querySelectorAll('th .when')) el.textContent = when;
  $('cards').replaceChildren(card('Grupos', number(t.groups)), card('Membros', number(t.members)),
    card(`Entraram ${when}`, number(t.joinedToday), 'pos'), card(`Saíram ${when}`, number(t.leftToday), 'neg'),
    card('Saldo 7 dias', signed(t.netWeek), tone(t.netWeek)), card('Saldo no período', signed(t.netPeriod), tone(t.netPeriod)));
  $('dedupe-note').hidden = !(data.groups.length > t.groups);
  for (const key of [...selected]) if (!data.candidates.some(g => g.id === key)) selected.delete(key);
  renderMembers();
  renderCandidates();
}

function renderMembers() {
  const body = $('members');
  body.replaceChildren();
  const groups = [...current.groups].sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name, 'pt-BR', {sensitivity: 'base'}));
  $('members-count').textContent = groups.length ? `${number(groups.length)} grupos` : '';
  if (!groups.length) {
    body.append(h('tr', {}, h('td', {colspan: '8', class: 'empty'}, 'Nenhum grupo neste agrupamento ainda. Escolha abaixo os grupos do nicho e clique em “Adicionar selecionados”.')));
    return;
  }
  for (const g of groups) {
    const week = g.joinedWeek - g.leftWeek, period = g.joinedPeriod - g.leftPeriod;
    const href = `/apps/grupos/grupo?account=${g.accountId}&id=${encodeURIComponent(g.id)}&days=${$('days').value}`;
    const out = h('button', {type: 'button', class: 'ghost small-btn', 'aria-label': `Tirar ${g.name} deste agrupamento`}, 'Remover');
    out.onclick = async () => {
      out.disabled = true;
      try { await post(`clusters/${id}/groups`, {remove: [g.id]}); message(`“${g.name}” saiu do agrupamento.`); await load(); } catch (e) { message(e.message, true); out.disabled = false; }
    };
    body.append(h('tr', {},
      h('td', {}, h('a', {class: 'group-link', href}, g.name), g.isAdmin ? h('span', {class: 'tag admin'}, ' admin') : null),
      h('td', {class: 'soft'}, g.accountName), h('td', {}, g.size == null ? '—' : number(g.size)),
      h('td', {class: 'pos'}, number(g.joinedToday)), h('td', {class: 'neg'}, number(g.leftToday)),
      h('td', {class: tone(week)}, signed(week)), h('td', {class: tone(period)}, signed(period)), h('td', {}, out)));
  }
}

const visibleCandidates = () => {
  const text = plain($('search').value), freeOnly = $('cand-filter').value === 'free';
  return current.candidates.filter(g => (!freeOnly || g.clusterId == null) && (!text || plain(g.name).includes(text)))
    .sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name, 'pt-BR', {sensitivity: 'base'}));
};

function renderCandidates() {
  if (!current) return;
  const body = $('candidates'), rows = visibleCandidates(), text = $('search').value.trim();
  body.replaceChildren();
  $('count').textContent = text ? `${number(rows.length)} de ${number(current.candidates.length)} grupos` : `${number(rows.length)} grupos`;
  $('search-clear').hidden = !text;
  if (!rows.length) {
    body.append(h('tr', {}, h('td', {colspan: '5', class: 'empty'}, text ? `Nenhum grupo encontrado para “${text}”.` : $('cand-filter').value === 'free' ? 'Todos os grupos já estão em algum agrupamento.' : 'Nenhum outro grupo.')));
  }
  for (const g of rows) {
    const box = h('input', {type: 'checkbox', 'aria-label': `Selecionar ${g.name}`});
    box.checked = selected.has(g.id);
    box.onchange = () => { if (box.checked) selected.add(g.id); else selected.delete(g.id); syncBulk(); };
    const tr = h('tr', {}, h('td', {class: 'check'}, box), h('td', {}, g.name), h('td', {class: 'soft'}, g.accounts.join(', ')),
      h('td', {}, g.size == null || g.size < 0 ? '—' : number(g.size)),
      h('td', {class: 'soft'}, g.clusterName ? g.clusterName : '—'));
    tr.onclick = e => { if (e.target !== box) { box.checked = !box.checked; box.onchange(); } };
    tr.style.cursor = 'pointer';
    body.append(tr);
  }
  syncBulk();
}

function syncBulk() {
  const rows = visibleCandidates(), marked = rows.filter(g => selected.has(g.id)).length;
  const all = $('pick-all');
  all.checked = rows.length > 0 && marked === rows.length;
  all.indeterminate = marked > 0 && marked < rows.length;
  all.disabled = !rows.length;
  const button = $('add-selected');
  button.disabled = !selected.size;
  button.textContent = selected.size ? `Adicionar selecionados (${number(selected.size)})` : 'Adicionar selecionados';
  for (const [i, box] of [...$('candidates').querySelectorAll('input[type=checkbox]')].entries()) box.checked = selected.has(rows[i]?.id);
}

const account = await requireAccess();
if (account && !/^\d{1,9}$/.test(id)) {
  setupSession();
  $('title').textContent = 'Agrupamento inválido';
  message('Agrupamento inválido. Volte para a lista e escolha um.', true);
} else if (account) {
  setupSession();
  const reload = () => load().catch(e => {
    message(e.message, true);
    if (!current) $('title').textContent = 'Agrupamento não encontrado';
  });
  query = reportControls(reload);
  $('search').oninput = renderCandidates;
  $('search').onkeydown = e => { if (e.key === 'Escape') { $('search').value = ''; renderCandidates(); } };
  $('search-clear').onclick = () => { $('search').value = ''; renderCandidates(); $('search').focus(); };
  $('cand-filter').onchange = renderCandidates;
  $('pick-all').onchange = () => {
    for (const g of visibleCandidates()) { if ($('pick-all').checked) selected.add(g.id); else selected.delete(g.id); }
    syncBulk();
  };
  $('add-selected').onclick = async () => {
    const ids = [...selected];
    const moving = current.candidates.filter(g => selected.has(g.id) && g.clusterId != null).length;
    if (moving && !confirm(`${moving} ${moving === 1 ? 'grupo já está em outro agrupamento e será movido' : 'grupos já estão em outros agrupamentos e serão movidos'} para “${current.cluster.name}”. Continuar?`)) return;
    $('add-selected').disabled = true;
    try {
      const r = await post(`clusters/${id}/groups`, {add: ids});
      selected.clear();
      message(`${number(r.added + r.moved)} ${r.added + r.moved === 1 ? 'grupo adicionado' : 'grupos adicionados'}${r.moved ? ` (${number(r.moved)} movido${r.moved === 1 ? '' : 's'} de outro agrupamento)` : ''}.`);
      await load();
    } catch (e) { message(e.message, true); syncBulk(); }
  };
  $('rename').onclick = async () => {
    const name = prompt('Novo nome do agrupamento:', current?.cluster.name || '');
    if (!name || !name.trim() || name.trim() === current?.cluster.name) return;
    try { await post(`clusters/${id}/rename`, {name}); message('Nome atualizado.'); await load(); } catch (e) { message(e.message, true); }
  };
  $('remove').onclick = async () => {
    if (!current || !confirm(`Excluir o agrupamento “${current.cluster.name}”? Os ${number(current.groups.length)} grupos dele continuam existindo, só ficam sem agrupamento.`)) return;
    try { await api(`clusters/${id}`, {method: 'DELETE'}); location.href = '/apps/grupos/agrupamentos'; } catch (e) { message(e.message, true); }
  };
  reload();
}
