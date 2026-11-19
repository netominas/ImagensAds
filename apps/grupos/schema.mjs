// Tabelas próprias do monitor de grupos de WhatsApp (prefixo wpp_). Criação aditiva e idempotente:
// usada tanto pelo servidor web quanto pelo coletor, que compartilham o mesmo SQLite.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS wpp_groups (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
 is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wpp_members (
 group_id TEXT NOT NULL, member_id TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(group_id, member_id));
CREATE TABLE IF NOT EXISTS wpp_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, member_id TEXT, phone TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL CHECK(kind IN ('join','leave')),
 detail TEXT NOT NULL, source TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS wpp_events_group_day ON wpp_events(group_id, day);
CREATE TABLE IF NOT EXISTS wpp_daily_size (
 group_id TEXT NOT NULL, day TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(group_id, day));
CREATE TABLE IF NOT EXISTS wpp_collector (
 id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL DEFAULT 'stopped', qr_svg TEXT, account TEXT,
 groups_count INTEGER NOT NULL DEFAULT 0, last_sync INTEGER, heartbeat INTEGER, error TEXT,
 command TEXT, command_at INTEGER);
INSERT OR IGNORE INTO wpp_collector (id) VALUES (1);`;

export function ensureSchema(db) { db.exec(SCHEMA); }
