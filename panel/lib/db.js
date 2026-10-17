'use strict';
// Baza podataka (SQLite ugrađen u Node 22+, bez dodatnih biblioteka).
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.VPN_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'panel.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',          -- owner | admin | support | finance | reseller
  totp_secret TEXT, totp_on INTEGER DEFAULT 0,
  disabled INTEGER DEFAULT 0,
  credit REAL DEFAULT 0, level_id INTEGER, user_limit INTEGER DEFAULT 150,
  contact TEXT DEFAULT '', brand TEXT DEFAULT '', note TEXT DEFAULT '',
  pass_changed INTEGER, last_login INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, discount REAL NOT NULL DEFAULT 0,
  min_monthly REAL DEFAULT 0, max_users INTEGER DEFAULT 150, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, days INTEGER NOT NULL, traffic_gb REAL DEFAULT 0,
  devices INTEGER DEFAULT 3, price REAL DEFAULT 0, locations TEXT DEFAULT '[]',
  trial INTEGER DEFAULT 0, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  uuid TEXT NOT NULL, sub_token TEXT UNIQUE NOT NULL,
  plan_id INTEGER, owner_id INTEGER,
  disabled INTEGER DEFAULT 0,
  expires_at INTEGER NOT NULL,
  traffic_limit INTEGER DEFAULT 0, traffic_up INTEGER DEFAULT 0, traffic_down INTEGER DEFAULT 0,
  devices INTEGER DEFAULT 3, note TEXT DEFAULT '', contact TEXT DEFAULT '',
  wg_priv TEXT, wg_pub TEXT,
  last_seen INTEGER, last_server INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_owner ON users(owner_id);
CREATE INDEX IF NOT EXISTS users_exp ON users(expires_at);
CREATE TABLE IF NOT EXISTS user_history (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS uh_user ON user_history(user_id);
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT DEFAULT '', country TEXT DEFAULT '',
  lat REAL, lon REAL, host TEXT DEFAULT '', token TEXT UNIQUE NOT NULL,
  capacity INTEGER DEFAULT 400, enabled INTEGER DEFAULT 1, maintenance INTEGER DEFAULT 0,
  provider TEXT DEFAULT '', cost REAL DEFAULT 0,
  vless_port INTEGER DEFAULT 443, wg_port INTEGER DEFAULT 51820, sni TEXT DEFAULT '',
  reality_priv TEXT, reality_pub TEXT, short_id TEXT, wg_priv TEXT, wg_pub TEXT,
  last_seen INTEGER, status TEXT DEFAULT 'pending', cpu REAL, ram REAL, net_mbps REAL,
  online INTEGER DEFAULT 0, traffic_month INTEGER DEFAULT 0, agent_version TEXT, uptime INTEGER,
  applied_hash TEXT, xray_ok INTEGER, wg_ok INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL,
  type TEXT NOT NULL,                 -- topup | sale | credit_use | expense | adjust
  amount REAL DEFAULT 0,              -- novac koji je tebi ušao (+) ili izašao (-)
  credit_delta REAL DEFAULT 0,        -- promjena kredita resellera
  reseller_id INTEGER, user_id INTEGER, actor TEXT, method TEXT DEFAULT '', note TEXT DEFAULT '',
  invoice_no TEXT
);
CREATE INDEX IF NOT EXISTS tx_ts ON transactions(ts);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL,
  detail TEXT DEFAULT '', kind TEXT DEFAULT 'info'
);
CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, as_id INTEGER, created INTEGER NOT NULL,
  last_active INTEGER NOT NULL, ip TEXT, ua TEXT, totp_ok INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_fail (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY, traffic INTEGER DEFAULT 0, new_users INTEGER DEFAULT 0, renewals INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS countries (day TEXT NOT NULL, cc TEXT NOT NULL, n INTEGER DEFAULT 0, PRIMARY KEY (day, cc));
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL,
  created INTEGER NOT NULL, last_used INTEGER
);
`);

// nove kolone za postojeće baze (ažuriranje bez gubitka podataka)
function addCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('users', 'auto_renew', 'INTEGER DEFAULT 0');
addCol('users', 'email', "TEXT DEFAULT ''");
addCol('users', 'tg_chat', 'TEXT');
addCol('users', 'blocked_until', 'INTEGER DEFAULT 0');
addCol('users', 'devices_seen', 'INTEGER DEFAULT 0');
addCol('users', 'reminded_at', 'INTEGER DEFAULT 0');
addCol('admins', 'pending', 'INTEGER DEFAULT 0');
addCol('admins', 'email', "TEXT DEFAULT ''");
addCol('servers', 'ss_port', 'INTEGER DEFAULT 8388');
addCol('servers', 'xray_version', "TEXT DEFAULT ''");
addCol('servers', 'last_error', "TEXT DEFAULT ''");
addCol('transactions', 'ext_id', 'TEXT');
addCol('servers', 'tags', "TEXT DEFAULT ''");
// probni nalozi iz aplikacije i preporuke (referral)
addCol('users', 'ref_code', 'TEXT');
addCol('users', 'referred_by', 'INTEGER');
addCol('users', 'paid_once', 'INTEGER DEFAULT 0');
addCol('users', 'trial_device', 'TEXT');
// statistika servera kroz vrijeme (po 5 minuta, čuva se 8 dana), historija rada i komande serveru
db.exec(`CREATE TABLE IF NOT EXISTS server_stats (server_id INTEGER NOT NULL, ts INTEGER NOT NULL, cpu REAL DEFAULT 0, ram REAL DEFAULT 0, online INTEGER DEFAULT 0, traffic INTEGER DEFAULT 0, n INTEGER DEFAULT 0, PRIMARY KEY (server_id, ts));
CREATE TABLE IF NOT EXISTS server_events (id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, dur INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS server_events_s ON server_events(server_id, ts);
CREATE TABLE IF NOT EXISTS server_cmds (id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL, cmd TEXT NOT NULL, by TEXT, created_at INTEGER NOT NULL, sent_at INTEGER, done_at INTEGER, ok INTEGER, result TEXT);
CREATE INDEX IF NOT EXISTS server_cmds_s ON server_cmds(server_id, id);`);
// vlastiti brend resellera (white-label)
addCol('admins', 'brand_color', "TEXT DEFAULT ''");
addCol('admins', 'brand_logo', "TEXT DEFAULT ''");
addCol('admins', 'brand_welcome', "TEXT DEFAULT ''");
addCol('admins', 'brand_hide_app', 'INTEGER DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS trials (id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT, ip TEXT, ts INTEGER, user_id INTEGER);
CREATE INDEX IF NOT EXISTS trials_device ON trials(device); CREATE INDEX IF NOT EXISTS trials_ip ON trials(ip);
CREATE UNIQUE INDEX IF NOT EXISTS users_ref ON users(ref_code);`);
// Double VPN / Multihop: promet ide kroz više servera redom (hops = JSON lista ID-jeva, prvi je ulaz, zadnji izlaz)
db.exec(`CREATE TABLE IF NOT EXISTS chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hops TEXT NOT NULL, port INTEGER NOT NULL,
  secret TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at INTEGER
)`);

const now = () => Date.now();
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function log(actor, action, detail = '', kind = 'info') {
  run('INSERT INTO logs (ts, actor, action, detail, kind) VALUES (?,?,?,?,?)', now(), actor || 'sistem', action, String(detail).slice(0, 500), kind);
}

function dayKey(ts = now(), tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
  } catch { return new Date(ts).toISOString().slice(0, 10); }
}

function bumpDaily(field, by = 1, tz) {
  const d = dayKey(now(), tz);
  run(`INSERT INTO daily (day, ${field}) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ${field} = ${field} + excluded.${field}`, d, by);
}

module.exports = { db, one, all, run, tx, log, now, DATA_DIR, DB_FILE, dayKey, bumpDaily };
