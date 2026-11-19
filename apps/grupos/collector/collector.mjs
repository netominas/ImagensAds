// COLETOR de grupos de WhatsApp: processo separado do servidor web (Supervisor: adstudio-grupos).
// SOMENTE LEITURA: nunca envia mensagens. Mantém uma conexão por número cadastrado no painel e grava
// entradas/saídas no mesmo SQLite do AK Workspace. O QR Code de cada número é guardado no banco e
// exibido no painel (/apps/grupos/), sem precisar de terminal.
import makeWASocket, {useMultiFileAuthState, DisconnectReason} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ensureSchema} from '../schema.mjs';
import {createTracker, bare} from '../tracker.mjs';

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) { console.error('DATA_DIR não definido.'); process.exit(1); }

const SYNC_MINUTES = Number(process.env.GRUPOS_SYNC_MINUTES) || 30;
const AUTH_ROOT = resolve(DATA_DIR, 'grupos-auth');
mkdirSync(AUTH_ROOT, {recursive: true, mode: 0o700});
const db = new DatabaseSync(join(DATA_DIR, 'adstudio.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
ensureSchema(db);

const nowSeconds = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);
const authDir = id => join(AUTH_ROOT, String(id));

function setAccount(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE wpp_accounts SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => fields[k]), id);
}

// Versão 1 guardava a sessão diretamente em grupos-auth/. Passa para grupos-auth/1/ (conta "Número 1").
function migrateLegacyAuth() {
  if (!existsSync(join(AUTH_ROOT, 'creds.json'))) return;
  const first = db.prepare('SELECT id FROM wpp_accounts WHERE id=1 AND removed=0').get();
  if (!first || existsSync(authDir(1))) return;
  mkdirSync(authDir(1), {recursive: true, mode: 0o700});
  for (const name of readdirSync(AUTH_ROOT)) {
    const from = join(AUTH_ROOT, name);
    if (statSync(from).isFile()) renameSync(from, join(authDir(1), name));
  }
  log('sessão antiga movida para a conta 1');
}

const sessions = new Map(); // id da conta -> {id, generation, sock, timer, stopped, tracker}

async function syncAll(session) {
  const all = await session.sock.groupFetchAllParticipating();
  const myIds = [session.sock.user?.id, session.sock.user?.lid].map(bare).filter(Boolean);
  const groups = Object.values(all);
  session.tracker.syncAll(groups, myIds);
  setAccount(session.id, {groups_count: groups.length, last_sync: nowSeconds(), error: null});
  log(`[conta ${session.id}] sincronizado: ${groups.length} grupos`);
}

async function connect(session) {
  if (session.stopped) return;
  const mine = ++session.generation;
  const {state, saveCreds} = await useMultiFileAuthState(authDir(session.id));
  const sock = makeWASocket({
    auth: state,
    logger: pino({level: 'silent'}),
    markOnlineOnConnect: false, // não aparecer "online" para os contatos
    syncFullHistory: false,
  });
  session.sock = sock;
  const alive = () => mine === session.generation && !session.stopped;
  const fail = (text, e) => { try { setAccount(session.id, {error: `${text}: ${e.message}`}); } catch {} };

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('group-participants.update', ev => {
    if (!alive()) return;
    try { const n = session.tracker.handleParticipants(ev); if (n) log(`[conta ${session.id}] ao vivo: ${ev.action} em ${ev.id} (${n})`); }
    catch (e) { log('erro ao registrar evento:', e.message); }
  });
  sock.ev.on('groups.update', list => {
    if (!alive()) return;
    for (const u of list) if (u.id && u.subject) session.tracker.rename(u.id, u.subject);
  });
  sock.ev.on('groups.upsert', () => setTimeout(() => alive() && syncAll(session).catch(e => fail('Falha ao sincronizar', e)), 5000));

  sock.ev.on('connection.update', async ({connection, lastDisconnect, qr}) => {
    if (!alive()) return;
    if (qr) {
      const svg = await QRCode.toString(qr, {type: 'svg', margin: 1, width: 280});
      setAccount(session.id, {state: 'qr', qr_svg: svg, error: null});
      log(`[conta ${session.id}] QR Code disponível no painel`);
    }
    if (connection === 'connecting') setAccount(session.id, {state: 'connecting'});
    if (connection === 'open') {
      setAccount(session.id, {state: 'open', qr_svg: null, phone: bare(sock.user?.id), error: null});
      session.retries = 0;
      log(`[conta ${session.id}] conectado`);
      try { await syncAll(session); } catch (e) { fail('Falha ao sincronizar', e); }
      clearInterval(session.timer);
      session.timer = setInterval(() => syncAll(session).catch(e => fail('Falha ao sincronizar', e)), SYNC_MINUTES * 60000);
    }
    if (connection === 'close') {
      clearInterval(session.timer);
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // WhatsApp encerrou a sessão (ou o painel pediu para desvincular): limpa e pede um novo QR.
        rmSync(authDir(session.id), {recursive: true, force: true});
        setAccount(session.id, {state: 'connecting', qr_svg: null, phone: null, error: 'Sessão encerrada. Escaneie o novo QR Code.'});
        log(`[conta ${session.id}] sessão encerrada; gerando novo QR`);
        session.retries = 0;
      } else {
        setAccount(session.id, {state: 'connecting', error: `Conexão interrompida (código ${code ?? '?'}); reconectando.`});
        log(`[conta ${session.id}] conexão caiu`, code);
      }
      // espera crescente (4 s, 8 s, … até 60 s) para nunca insistir em excesso com o WhatsApp
      const wait = session.retries ? Math.min(60000, 4000 * 2 ** (session.retries - 1)) : 4000;
      if (code !== DisconnectReason.loggedOut) session.retries++;
      setTimeout(() => connect(session).catch(e => log('falha ao reiniciar:', e.message)), wait);
    }
  });
}

async function startSession(id) {
  const session = {id, generation: 0, retries: 0, sock: null, timer: null, stopped: false, tracker: createTracker(db, id)};
  sessions.set(id, session);
  try { await connect(session); } catch (e) { log(`[conta ${id}] falha ao iniciar:`, e.message); setAccount(id, {error: 'Falha ao iniciar: ' + e.message}); }
}

async function stopSession(session, {unlink}) {
  session.stopped = true;
  clearInterval(session.timer);
  sessions.delete(session.id);
  if (unlink) { try { await session.sock?.logout(); } catch { /* já desconectado */ } }
  try { session.sock?.end?.(undefined); } catch { /* ignora */ }
  if (unlink) rmSync(authDir(session.id), {recursive: true, force: true});
  log(`[conta ${session.id}] parada${unlink ? ' e desvinculada' : ''}`);
}

// Verifica o banco a cada 5 s: contas novas, contas removidas e comandos pedidos pelo painel.
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const rows = db.prepare('SELECT id,removed,command FROM wpp_accounts').all();
    const active = new Set(rows.filter(r => !r.removed).map(r => r.id));
    for (const s of [...sessions.values()]) if (!active.has(s.id)) await stopSession(s, {unlink: true});
    for (const r of rows) {
      if (r.removed) { if (existsSync(authDir(r.id)) && !sessions.has(r.id)) rmSync(authDir(r.id), {recursive: true, force: true}); continue; }
      if (!sessions.has(r.id)) { await startSession(r.id); await sleep(2000); continue; } // escalona as conexões
      if (!r.command) continue;
      const session = sessions.get(r.id);
      db.prepare('UPDATE wpp_accounts SET command=NULL WHERE id=?').run(r.id);
      try {
        if (r.command === 'sync' && session.sock?.user) await syncAll(session);
        if (r.command === 'relink') { log(`[conta ${r.id}] desvinculando a pedido do painel`); await session.sock?.logout(); }
      } catch (e) { setAccount(r.id, {error: 'Comando falhou: ' + e.message}); }
    }
  } finally { polling = false; }
}

const beat = () => db.prepare('UPDATE wpp_collector SET heartbeat=? WHERE id=1').run(nowSeconds());
function shutdown() {
  try { db.prepare("UPDATE wpp_collector SET heartbeat=NULL,state='stopped' WHERE id=1").run(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => log('unhandledRejection:', e?.message || e));
process.on('uncaughtException', e => { log('uncaughtException:', e?.message || e); shutdown(); }); // o Supervisor reinicia

migrateLegacyAuth();
db.prepare("UPDATE wpp_accounts SET state='connecting',qr_svg=NULL WHERE removed=0").run(); // estados antigos não valem após reiniciar
beat();
setInterval(() => { try { beat(); } catch (e) { log('heartbeat:', e.message); } }, 15000);
setInterval(() => poll().catch(e => log('poll:', e.message)), 5000);
poll().catch(e => log('poll:', e.message));
