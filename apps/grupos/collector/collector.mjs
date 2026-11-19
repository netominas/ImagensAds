// COLETOR de grupos de WhatsApp: processo separado do servidor web (Supervisor: adstudio-grupos).
// SOMENTE LEITURA: nunca envia mensagens. Grava entradas/saídas no mesmo SQLite do AK Workspace.
// O QR Code de vinculação é guardado no banco e exibido no painel (/apps/grupos/), sem precisar de terminal.
import makeWASocket, {useMultiFileAuthState, DisconnectReason} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ensureSchema} from '../schema.mjs';
import {createTracker, bare} from '../tracker.mjs';

if (process.env.ENV_FILE) { try { process.loadEnvFile(process.env.ENV_FILE); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) { console.error('DATA_DIR não definido.'); process.exit(1); }

const SYNC_MINUTES = Number(process.env.GRUPOS_SYNC_MINUTES) || 30;
const AUTH_DIR = resolve(DATA_DIR, 'grupos-auth');
mkdirSync(DATA_DIR, {recursive: true, mode: 0o700});
const db = new DatabaseSync(join(DATA_DIR, 'adstudio.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
ensureSchema(db);
const tracker = createTracker(db);
const nowSeconds = () => Math.floor(Date.now() / 1000);

function setState(fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE wpp_collector SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=1`).run(...keys.map(k => fields[k]));
}
const log = (...args) => console.log(new Date().toISOString(), ...args);

let current = null;      // socket ativo
let generation = 0;      // ignora eventos de sockets antigos
let syncTimer = null;

async function syncAll(sock) {
  const all = await sock.groupFetchAllParticipating();
  const myIds = [sock.user?.id, sock.user?.lid].map(bare).filter(Boolean);
  const groups = Object.values(all);
  tracker.syncAll(groups, myIds);
  setState({groups_count: groups.length, last_sync: nowSeconds(), error: null});
  log(`sincronizado: ${groups.length} grupos`);
}

async function start() {
  const mine = ++generation;
  const {state, saveCreds} = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: state,
    logger: pino({level: 'silent'}),
    markOnlineOnConnect: false, // não aparecer "online" para os contatos
    syncFullHistory: false,
  });
  current = sock;
  const alive = () => mine === generation;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('group-participants.update', ev => {
    if (!alive()) return;
    try { const n = tracker.handleParticipants(ev); if (n) log(`ao vivo: ${ev.action} em ${ev.id} (${n})`); }
    catch (e) { log('erro ao registrar evento:', e.message); }
  });
  sock.ev.on('groups.update', list => {
    if (!alive()) return;
    for (const u of list) if (u.id && u.subject) tracker.rename(u.id, u.subject);
  });
  sock.ev.on('groups.upsert', () => setTimeout(() => alive() && syncAll(sock).catch(e => log('sync:', e.message)), 5000));

  sock.ev.on('connection.update', async ({connection, lastDisconnect, qr}) => {
    if (!alive()) return;
    if (qr) {
      const svg = await QRCode.toString(qr, {type: 'svg', margin: 1, width: 280});
      setState({state: 'qr', qr_svg: svg, error: null});
      log('QR Code disponível no painel');
    }
    if (connection === 'connecting') setState({state: 'connecting'});
    if (connection === 'open') {
      setState({state: 'open', qr_svg: null, account: bare(sock.user?.id), error: null});
      log('conectado');
      try { await syncAll(sock); } catch (e) { setState({error: 'Falha ao sincronizar: ' + e.message}); }
      clearInterval(syncTimer);
      syncTimer = setInterval(() => syncAll(sock).catch(e => setState({error: 'Falha ao sincronizar: ' + e.message})), SYNC_MINUTES * 60000);
    }
    if (connection === 'close') {
      clearInterval(syncTimer);
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // WhatsApp encerrou a sessão (ou o painel pediu para desvincular): limpa e pede um novo QR.
        rmSync(AUTH_DIR, {recursive: true, force: true});
        setState({state: 'connecting', qr_svg: null, account: null, error: 'Sessão encerrada. Escaneie o novo QR Code.'});
        log('sessão encerrada; gerando novo QR');
      } else {
        setState({state: 'connecting', error: `Conexão interrompida (código ${code ?? '?'}); reconectando.`});
        log('conexão caiu', code);
      }
      setTimeout(() => alive() && start().catch(e => log('falha ao reiniciar:', e.message)), 4000);
    }
  });
}

// Comandos pedidos pelo painel (sincronizar agora / desvincular).
async function pollCommands() {
  const row = db.prepare('SELECT command FROM wpp_collector WHERE id=1').get();
  if (!row?.command) return;
  db.prepare('UPDATE wpp_collector SET command=NULL WHERE id=1').run();
  try {
    if (row.command === 'sync' && current?.user) await syncAll(current);
    if (row.command === 'relink') { log('desvinculando a pedido do painel'); await current?.logout(); }
  } catch (e) { setState({error: 'Comando falhou: ' + e.message}); }
}

setInterval(() => { try { setState({heartbeat: nowSeconds()}); } catch (e) { log('heartbeat:', e.message); } }, 15000);
setInterval(() => pollCommands().catch(e => log('comando:', e.message)), 5000);
setState({state: 'connecting', heartbeat: nowSeconds(), command: null});

function shutdown() {
  try { setState({state: 'stopped', heartbeat: null, qr_svg: null}); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => log('unhandledRejection:', e?.message || e));
process.on('uncaughtException', e => { log('uncaughtException:', e?.message || e); shutdown(); }); // o Supervisor reinicia

start().catch(e => { log('falha ao iniciar:', e.message); shutdown(); });
