'use strict';
// Uvoz kupaca iz drugih panela: 3x-ui (x-ui.db), Marzban (db.sqlite3), Hiddify Manager (backup .json) i CSV.
// Kupac zadrži UUID, datum isteka, limit i potrošen promet. Novi link dobije od ovog panela
// (adresa servera i Reality ključevi su drugačiji), pa ga treba poslati kupcu.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { one, run, now, log, tx, bumpDaily } = require('./db');
const { fail } = require('./http');
const vpn = require('./vpn');
const settings = require('./settings');

const GB = 1024 ** 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING = new Map();   // token -> { t, source, users }

const cleanName = (s) => String(s || '').replace(/[^a-zA-Z0-9._@-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const toMs = (v) => { v = Number(v) || 0; if (v <= 0) return 0; return v < 1e11 ? v * 1000 : v; };   // sekunde ili milisekunde

function fromSqlite(buf) {
  const f = path.join(os.tmpdir(), `uvoz-${crypto.randomBytes(6).toString('hex')}.db`);
  fs.writeFileSync(f, buf);
  let db;
  try {
    db = new DatabaseSync(f, { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    if (tables.has('inbounds')) return { source: '3x-ui', users: from3xui(db, tables) };
    if (tables.has('users') && tables.has('proxies')) return { source: 'Marzban', users: fromMarzban(db) };
    fail(400, 'Ne prepoznajem ovu bazu. Podržani su 3x-ui (x-ui.db) i Marzban (db.sqlite3).');
  } catch (e) {
    if (e.status) throw e;
    fail(400, 'Fajl nije ispravna baza: ' + e.message);
  } finally {
    try { db?.close(); } catch { /* */ }
    fs.rmSync(f, { force: true });
  }
}

// 3x-ui / x-ui: klijenti su u inbounds.settings (JSON), promet u client_traffics
function from3xui(db, tables) {
  const traffic = new Map();
  if (tables.has('client_traffics')) for (const t of db.prepare('SELECT email, up, down, total, expiry_time, enable FROM client_traffics').all()) traffic.set(t.email, t);
  const out = new Map();
  for (const ib of db.prepare('SELECT protocol, settings, remark FROM inbounds').all()) {
    let s; try { s = JSON.parse(ib.settings || '{}'); } catch { continue; }
    for (const c of s.clients || []) {
      const name = c.email || c.id || c.password;
      if (!name || out.has(name)) continue;
      const t = traffic.get(c.email) || {};
      out.set(name, {
        username: name, uuid: UUID.test(c.id || '') ? c.id : '', expires: toMs(c.expiryTime || t.expiry_time),
        limit: Number(c.totalGB || t.total || 0), used: Number(t.up || 0) + Number(t.down || 0), devices: Number(c.limitIp) || 0,
        disabled: c.enable === false || t.enable === 0, note: ib.remark ? `iz 3x-ui (${ib.remark})` : 'iz 3x-ui', contact: c.tgId ? `tg:${c.tgId}` : '',
      });
    }
  }
  return [...out.values()];
}

// Marzban: users + proxies (vless/vmess id)
function fromMarzban(db) {
  const ids = new Map();
  for (const p of db.prepare('SELECT user_id, type, settings FROM proxies').all()) {
    let s; try { s = JSON.parse(p.settings || '{}'); } catch { continue; }
    if (s.id && UUID.test(s.id) && (!ids.has(p.user_id) || String(p.type).toLowerCase() === 'vless')) ids.set(p.user_id, s.id);
  }
  const cols = new Set(db.prepare("SELECT name FROM pragma_table_info('users')").all().map((r) => r.name));
  return db.prepare('SELECT * FROM users').all().map((u) => ({
    username: u.username, uuid: ids.get(u.id) || '', expires: toMs(u.expire), limit: Number(u.data_limit || 0),
    used: Number(u.used_traffic || 0), devices: 0, disabled: String(u.status) === 'disabled',
    note: cols.has('note') && u.note ? `iz Marzbana · ${u.note}` : 'iz Marzbana', contact: '',
  }));
}

// Hiddify Manager backup (JSON sa "users")
function fromHiddify(j) {
  const list = Array.isArray(j) ? j : j.users || j.hiddify_users || [];
  if (!Array.isArray(list) || !list.length) fail(400, 'U JSON fajlu nema korisnika (očekujem Hiddify backup sa "users").');
  return list.map((u) => {
    const start = u.start_date ? Date.parse(u.start_date) : 0;
    const days = Number(u.package_days || 0);
    return {
      username: u.name || u.username || u.uuid, uuid: UUID.test(u.uuid || '') ? u.uuid : '',
      expires: start && days ? start + days * vpn.DAY : (u.expiry_time ? toMs(u.expiry_time) : 0),
      limit: Math.round(Number(u.usage_limit_GB || 0) * GB), used: Math.round(Number(u.current_usage_GB || 0) * GB),
      devices: 0, disabled: u.enable === false || u.mode === 'disable', note: 'iz Hiddify panela', contact: u.telegram_id ? `tg:${u.telegram_id}` : '',
    };
  });
}

// CSV: korisnik,uuid,istice(YYYY-MM-DD),promet_gb,biljeska  (zaglavlje opcionalno, odvajanje zarezom ili ;)
function fromCsv(text) {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;,\t]/).map((x) => x.trim().replace(/^"|"$/g, '')));
  if (rows.length && !UUID.test(rows[0][1] || '') && !/^\d{4}-\d{2}-\d{2}/.test(rows[0][2] || '') && isNaN(Number(rows[0][3]))) rows.shift();
  if (!rows.length || rows.every((r) => r.length < 2)) fail(400, 'Ne prepoznajem fajl. Podržani su 3x-ui (x-ui.db), Marzban (db.sqlite3), Hiddify backup (.json) i CSV (korisnik;uuid;ističe;GB).');
  return rows.map(([username, id, exp, gb, note]) => ({
    username, uuid: UUID.test(id || '') ? id : '', expires: exp ? Date.parse(exp.length === 10 ? exp + 'T23:59:59' : exp) || 0 : 0,
    limit: Math.round((Number(gb) || 0) * GB), used: 0, devices: 0, disabled: false, note: note || 'iz CSV-a', contact: '',
  }));
}

/** Pročitaj fajl i vrati pregled (ništa se još ne upisuje). */
function preview(buf) {
  if (!buf?.length) fail(400, 'Izaberi fajl.');
  let r;
  if (buf.subarray(0, 16).toString('latin1').startsWith('SQLite format 3')) r = fromSqlite(buf);
  else {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    if (/^\s*[[{]/.test(text)) { let j; try { j = JSON.parse(text); } catch { fail(400, 'JSON nije ispravan.'); } r = { source: 'Hiddify', users: fromHiddify(j) }; }
    else r = { source: 'CSV', users: fromCsv(text) };
  }
  const users = r.users.filter((u) => u.username);
  if (!users.length) fail(400, 'U fajlu nisam našao nijednog korisnika.');
  const t = now();
  const token = crypto.randomBytes(9).toString('base64url');
  for (const [k, v] of PENDING) if (t - v.t > 3600000) PENDING.delete(k);
  PENDING.set(token, { t, source: r.source, users });
  const taken = users.filter((u) => one('SELECT id FROM users WHERE username = ?', cleanName(u.username)) || (u.uuid && one('SELECT id FROM users WHERE uuid = ?', u.uuid))).length;
  return {
    token, source: r.source, total: users.length, taken,
    active: users.filter((u) => !u.disabled && (!u.expires || u.expires > t)).length,
    expired: users.filter((u) => u.expires && u.expires <= t).length,
    sample: users.slice(0, 8).map((u) => ({ username: u.username, expires: u.expires, limit: u.limit, used: u.used, disabled: u.disabled })),
  };
}

/** Upiši kupce iz pregleda. Postojeće (isto ime ili UUID) preskoči. */
function commit(token, b, actor) {
  const p = PENDING.get(String(token || ''));
  if (!p) fail(400, 'Pregled je istekao. Učitaj fajl ponovo.');
  const plan = b.plan_id ? one('SELECT * FROM plans WHERE id = ?', Number(b.plan_id)) : null;
  if (b.plan_id && !plan) fail(400, 'Plan ne postoji.');
  const owner = b.owner_id ? one("SELECT id FROM admins WHERE id = ? AND role = 'reseller'", Number(b.owner_id)) : null;
  const t = now(), onlyActive = !!b.only_active, noExpiryDays = Math.max(1, Number(b.no_expiry_days) || 30);
  let added = 0, skipped = 0;
  tx(() => {
    for (const u of p.users) {
      if (onlyActive && (u.disabled || (u.expires && u.expires <= t))) { skipped++; continue; }
      const name = cleanName(u.username);
      if (name.length < 3 || one('SELECT id FROM users WHERE username = ?', name) || (u.uuid && one('SELECT id FROM users WHERE uuid = ?', u.uuid))) { skipped++; continue; }
      const wg = vpn.wgKeys();
      const exp = u.expires || t + noExpiryDays * vpn.DAY;
      const r = run(`INSERT INTO users (username, uuid, sub_token, plan_id, owner_id, expires_at, traffic_limit, traffic_down, devices, note, contact, disabled, wg_priv, wg_pub, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, name, u.uuid || vpn.uuid(), vpn.subToken(), plan?.id || null, owner?.id || null, exp, Math.max(0, Math.round(u.limit || 0)),
      Math.max(0, Math.round(u.used || 0)), u.devices || plan?.devices || Number(settings.get('default_devices') || 3), String(u.note || '').slice(0, 500), String(u.contact || '').slice(0, 120), u.disabled ? 1 : 0, wg.priv, wg.pub, t);
      run('INSERT INTO user_history (user_id, ts, text) VALUES (?,?,?)', Number(r.lastInsertRowid), t, `Uvezen iz ${p.source} · ${actor}`);
      added++;
    }
  });
  if (added) bumpDaily('new_users', added, settings.get('timezone'));
  PENDING.delete(token);
  log(actor, `Uvoz kupaca iz ${p.source}`, `${added} dodano, ${skipped} preskočeno`);
  return { added, skipped, source: p.source };
}

module.exports = { preview, commit };
