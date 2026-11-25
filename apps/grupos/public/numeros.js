import {requireAccess} from '/access.js';
import {$, h, number, message, api, post, setupSession} from '/apps/grupos/common.js';

let pollTimer = null, known = [];

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
    body, a.online && a.error ? h('p', {class: 'warn'}, a.error) : null,
    a.state === 'open' && a.online ? h('p', {class: 'st'}, h('a', {class: 'group-link', href: `/apps/grupos/?account=${a.id}`}, 'Ver os grupos deste número →')) : null);
}
const fingerprint = list => JSON.stringify(list.map(a => [a.id, a.state, a.name, a.qrSvg?.length, a.groupsCount, a.lastSync, a.online, a.error]));
function renderAccounts(data) {
  known = data.accounts;
  $('summary').textContent = data.accounts.length ? `${data.accounts.length} de ${data.max} números · ${data.accounts.filter(a => a.online && a.state === 'open').length} conectados` : '';
  $('collector-off').hidden = data.collectorOnline;
  $('add-account').disabled = data.accounts.length >= data.max;
  const box = $('accounts');
  box.replaceChildren();
  if (!data.accounts.length) box.append(h('p', {class: 'empty'}, 'Nenhum número ainda. Clique em “Adicionar número” e escaneie o QR Code com o WhatsApp.'));
  for (const a of data.accounts) box.append(accountCard(a));
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
    if (reloadAfter) setTimeout(refreshAccounts, reloadAfter);
  } catch (e) { message(e.message, true); }
}

// ---------- Início ----------
const account = await requireAccess();
if (account) {
  setupSession();
  $('add-account').onclick = async () => {
    const name = prompt('Nome do novo número (ex.: Promoções 1):');
    if (name && name.trim()) await act(() => post('accounts', {name}), 'Número adicionado. Aguarde o QR Code aparecer.', 4000);
  };
  await refreshAccounts();
}
