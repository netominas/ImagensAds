// Tabelas próprias do monitor de grupos de WhatsApp (prefixo wpp_). Criação aditiva e idempotente:
// usada tanto pelo servidor web quanto pelo coletor, que compartilham o mesmo SQLite.
//
// v2: vários números de WhatsApp. Grupos, membros, eventos e tamanhos pertencem a uma conta (account_id).
// A versão 1 (um único número) é migrada automaticamente para a conta "Número 1", sem perder dados.
const ACCOUNTS = `
CREATE TABLE IF NOT EXISTS wpp_collector (
 id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL DEFAULT 'stopped', qr_svg TEXT, account TEXT,
 groups_count INTEGER NOT NULL DEFAULT 0, last_sync INTEGER, heartbeat INTEGER, error TEXT,
 command TEXT, command_at INTEGER);
INSERT OR IGNORE INTO wpp_collector (id) VALUES (1);
CREATE TABLE IF NOT EXISTS wpp_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'connecting',
 qr_svg TEXT, phone TEXT, groups_count INTEGER NOT NULL DEFAULT 0, last_sync INTEGER, error TEXT,
 command TEXT, command_at INTEGER, removed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);`;

const DATA = `
CREATE TABLE IF NOT EXISTS wpp_groups (
 account_id INTEGER NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
 is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL,
 PRIMARY KEY(account_id, id));
CREATE TABLE IF NOT EXISTS wpp_members (
 account_id INTEGER NOT NULL, group_id TEXT NOT NULL, member_id TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(account_id, group_id, member_id));
CREATE TABLE IF NOT EXISTS wpp_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, group_id TEXT NOT NULL, member_id TEXT,
 phone TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('join','leave')),
 detail TEXT NOT NULL, source TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS wpp_events_account_group_day ON wpp_events(account_id, group_id, day);
CREATE TABLE IF NOT EXISTS wpp_daily_size (
 account_id INTEGER NOT NULL, group_id TEXT NOT NULL, day TEXT NOT NULL, size INTEGER NOT NULL,
 PRIMARY KEY(account_id, group_id, day));`;

// Agrupamentos: conjuntos de grupos por nicho (ex.: "Off-grid"). Um grupo do WhatsApp pertence a no máximo um
// agrupamento, qualquer que seja o número em que aparece. Depois serão vinculados a campanhas do Meta.
const CLUSTERS = `
CREATE TABLE IF NOT EXISTS wpp_clusters (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wpp_cluster_groups (
 group_id TEXT PRIMARY KEY, cluster_id INTEGER NOT NULL, added INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS wpp_cluster_groups_cluster ON wpp_cluster_groups(cluster_id);`;

const hasColumn = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
const tableExists = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
const needsMigration = db => tableExists(db, 'wpp_groups') && !hasColumn(db, 'wpp_groups', 'account_id');

function migrateV1(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!needsMigration(db)) { db.exec('COMMIT'); return; } // outro processo já migrou
    const old = db.prepare('SELECT * FROM wpp_collector WHERE id=1').get() || {};
    db.prepare(`INSERT INTO wpp_accounts (id,name,state,phone,groups_count,last_sync,created) VALUES (1,'Número 1',?,?,?,?,?)`)
      .run(old.state === 'stopped' ? 'connecting' : (old.state || 'connecting'), old.account || null, old.groups_count || 0, old.last_sync || null, Math.floor(Date.now() / 1000));
    for (const t of ['wpp_groups', 'wpp_members', 'wpp_events', 'wpp_daily_size']) db.exec(`ALTER TABLE ${t} RENAME TO ${t}_v1`);
    db.exec('DROP INDEX IF EXISTS wpp_events_group_day');
    db.exec(DATA);
    db.exec(`INSERT INTO wpp_groups SELECT 1,id,name,size,is_admin,active,updated FROM wpp_groups_v1;
      INSERT INTO wpp_members SELECT 1,group_id,member_id,phone FROM wpp_members_v1;
      INSERT INTO wpp_events (id,account_id,group_id,member_id,phone,kind,detail,source,ts,day)
        SELECT id,1,group_id,member_id,phone,kind,detail,source,ts,day FROM wpp_events_v1;
      INSERT INTO wpp_daily_size SELECT 1,group_id,day,size FROM wpp_daily_size_v1;
      DROP TABLE wpp_groups_v1; DROP TABLE wpp_members_v1; DROP TABLE wpp_events_v1; DROP TABLE wpp_daily_size_v1;`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function ensureSchema(db) {
  db.exec(ACCOUNTS);
  if (needsMigration(db)) migrateV1(db);
  db.exec(DATA);
  db.exec(CLUSTERS);
}
