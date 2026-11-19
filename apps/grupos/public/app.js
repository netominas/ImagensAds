import {requireAccess} from '/access.js';
import {$, h, signed, tone, number, message, api, post, prefs, setupSession} from '/apps/grupos/common.js';

let accountFilter = prefs.get('account', 'all'), adminFilter = prefs.get('admin', 'all'), pollTimer = null, loadToken = 0, known = [];

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
const ADMIN_EMPTY = {yes: 'Nenhum grupo em que você seja administrador.', no: 'Nenhum grupo em que você não seja administrador.'};
async function loadSummary() {
  const token = ++loadToken;
  const data = await api(`summary?days=${$('days').value}&account=${accountFilter}&admin=${adminFilter}`);
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
    const text = ADMIN_EMPTY[adminFilter] || (data.accounts.length ? 'Nenhum grupo ainda. Vincule o WhatsApp e aguarde a primeira sincronização.' : 'Adicione um número para começar.');
    body.append(h('tr', {}, h('td', {colspan: '7', class: 'empty'}, text)));
    return;
  }
  for (const g of data.groups) {
    const week = g.joinedWeek - g.leftWeek, period = g.joinedPeriod - g.leftPeriod;
    // Cada grupo abre numa página própria (link de verdade: funciona com clique do meio e "abrir em nova aba").
    const href = `/apps/grupos/grupo?account=${g.accountId}&id=${encodeURIComponent(g.id)}&days=${$('days').value}`;
    const tr = h('tr', {},
      h('td', {}, h('a', {class: 'group-link', href}, g.name), g.isAdmin ? h('span', {class: 'tag admin'}, ' admin') : h('span', {class: 'tag'}, ' (não sou admin)'), g.shared ? h('span', {class: 'tag'}, ' (em mais de um número)') : null),
      h('td', {class: 'col-account'}, g.accountName),
      h('td', {}, number(g.size)), h('td', {class: 'pos'}, number(g.joinedToday)), h('td', {class: 'neg'}, number(g.leftToday)),
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
  $('days').onchange = () => { prefs.set('days', $('days').value); reload(); };
  $('admin-filter').onchange = () => { adminFilter = $('admin-filter').value; prefs.set('admin', adminFilter); reload(); };
  $('account-filter').onchange = () => { accountFilter = $('account-filter').value; prefs.set('account', accountFilter); reload(); };
  $('add-account').onclick = async () => {
    const name = prompt('Nome do novo número (ex.: Promoções 1):');
    if (name && name.trim()) await act(() => post('accounts', {name}), 'Número adicionado. Aguarde o QR Code aparecer.', 4000);
  };
  await refreshAccounts();
  reload();
  setInterval(() => loadSummary().catch(() => {}), 60000);
}
