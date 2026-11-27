import {requireAccess} from '/access.js';
import {$, h, signed, tone, number, money, ratio, statusLabel, label, message, api, post, setupSession, whenLabel, card, reportControls} from '/apps/grupos/common.js';

// Relatório de uma campanha: gasto e leads (Meta) ao lado das entradas e saídas reais nos grupos do agrupamento ligado.
const id = new URLSearchParams(location.search).get('id') || '';
let current = null, loadToken = 0, query = () => '', wantFresh = false;

async function load() {
  const token = ++loadToken, fresh = wantFresh;
  wantFresh = false;
  const data = await api(`campaigns/${id}?${query()}${fresh ? '&fresh=1' : ''}`);
  if (token !== loadToken) return;
  current = data;
  const c = data.campaign, t = data.totals, k = data.cluster, multi = data.siblings.length > 1;
  document.title = `${c.name} — AK Workspace`;
  $('title').textContent = c.name;
  $('eyebrow').textContent = `CAMPANHA · ID ${c.id}`;
  $('meta').replaceChildren(`${statusLabel(c.status)} · `, ...(k ? ['agrupamento ', h('a', {class: 'group-link', href: `/apps/grupos/agrupamento?id=${k.id}`}, k.name), ` (${number(data.groups)} ${data.groups === 1 ? 'grupo' : 'grupos'})`] : ['sem agrupamento']));
  const select = $('cluster-select');
  select.replaceChildren(h('option', {value: ''}, '— Sem agrupamento —'), ...data.clusters.map(x => h('option', {value: String(x.id)}, x.name)));
  select.value = k ? String(k.id) : '';
  $('no-cluster').hidden = !!k;
  const cards = [card('Gasto no período', money(t.spend), 'money'), card('Leads na Meta', number(t.leads)), card('Custo por lead', t.cpl == null ? '—' : money(t.cpl), 'money')];
  if (k) cards.push(card('Entraram nos grupos', number(t.joined), 'pos'), card('Saíram dos grupos', number(t.left), 'neg'), card('Saldo de membros', signed(t.net), tone(t.net)),
    card('Custo por entrada', t.costPerJoin == null ? '—' : money(t.costPerJoin), 'money'), card('Custo por membro que ficou', t.costPerNet == null ? '—' : money(t.costPerNet), 'money'),
    card('Entradas ÷ leads', t.joinsPerLead == null ? '—' : ratio(t.joinsPerLead)));
  $('cards').replaceChildren(...cards);
  const note = $('cluster-note');
  note.hidden = !k;
  if (k) note.textContent = (multi ? `O agrupamento “${k.name}” recebe leads de ${data.siblings.length} campanhas: os custos e a razão usam o gasto (${money(t.clusterSpend)}) e os leads (${number(t.clusterLeads)}) somados delas. ` : '')
    + `Entradas e saídas são de todos os grupos do agrupamento, dos últimos ${data.days} dias até ${data.date.split('-').reverse().join('/')}.`;
  $('days-count').textContent = `${data.days} dias · ${whenLabel(data)} é o último`;
  renderTable(data, multi);
  const panel = $('siblings-panel');
  panel.hidden = !multi;
  $('siblings').replaceChildren(...data.siblings.sort((a, b) => b.spend - a.spend).map(s => h('tr', {class: s.id === id ? 'self' : ''},
    h('td', {class: 'col-name'}, s.id === id ? s.name + ' (esta)' : h('a', {class: 'group-link', href: `/apps/grupos/campanha?id=${s.id}`}, s.name)),
    h('td', {}, money(s.spend)), h('td', {}, number(s.leads)), h('td', {}, s.leads ? money(s.spend / s.leads) : '—'))));
}

function renderTable(data, multi) {
  const k = data.cluster;
  const cols = ['Dia', 'Gasto', 'Leads', 'Custo por lead'];
  if (multi) cols.push('Leads do agrupamento');
  if (k) cols.push('Entraram', 'Saíram', 'Saldo', 'Entradas ÷ leads');
  $('head').replaceChildren(h('tr', {}, ...cols.map(x => h('th', {}, x))));
  const body = $('rows');
  body.replaceChildren();
  for (const d of [...data.series].reverse()) {
    const net = d.joined - d.left, leads = multi ? d.clusterLeads : d.leads;
    body.append(h('tr', {}, h('td', {class: 'col-name'}, label(d.day)), h('td', {}, money(d.spend)), h('td', {}, number(d.leads)),
      h('td', {}, d.leads ? money(d.spend / d.leads) : '—'),
      multi ? h('td', {}, number(d.clusterLeads)) : null,
      ...(k ? [h('td', {class: 'pos'}, number(d.joined)), h('td', {class: 'neg'}, number(d.left)), h('td', {class: tone(net)}, signed(net)), h('td', {}, leads ? ratio(d.joined / leads) : '—')] : [])));
  }
}

const account = await requireAccess();
if (account && !/^\d{1,25}$/.test(id)) {
  setupSession();
  $('title').textContent = 'Campanha inválida';
  message('Campanha inválida. Volte para a lista e escolha uma.', true);
} else if (account) {
  setupSession();
  const reload = () => load().catch(e => {
    message(e.message, true);
    if (!current) $('title').textContent = 'Campanha indisponível';
  });
  query = reportControls(reload);
  $('cluster-select').onchange = async () => {
    const select = $('cluster-select'), before = current?.cluster?.id;
    select.disabled = true;
    try {
      await post(`campaigns/${id}/cluster`, {cluster: select.value === '' ? null : Number(select.value)});
      message(select.value === '' ? 'Campanha solta do agrupamento.' : 'Campanha ligada ao agrupamento.');
      await load();
    } catch (e) { message(e.message, true); select.value = before == null ? '' : String(before); }
    select.disabled = false;
  };
  $('refresh').onclick = async () => {
    const button = $('refresh');
    button.disabled = true; wantFresh = true; message('Buscando na Meta…');
    try { await load(); message(''); } catch (e) { message(e.message, true); }
    button.disabled = false;
  };
  reload();
}
