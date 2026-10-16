'use strict';
// Poslovi u pozadini: serveri offline, backup, dnevni izvještaj, čišćenje, mjesečni reset prometa.
const { one, all, run, now, log, dayKey } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const backup = require('./backup');
const { notify } = require('./notify');

function localParts(tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, hour: Number(p.hour) % 24 };
}
const mark = (key) => (one('SELECT value FROM settings WHERE key = ?', '_job_' + key) || {}).value;
const setMark = (key, v) => run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', '_job_' + key, String(v));

const capWarned = new Set();

function checkServers() {
  const off = Number(settings.get('offline_sec') || 45) * 1000;
  const warnPct = Number(settings.get('capacity_warn') || 80);
  for (const sv of all("SELECT * FROM servers WHERE enabled = 1")) {
    if (sv.status === 'online' && sv.last_seen && now() - sv.last_seen > off) {
      run("UPDATE servers SET status = 'offline' WHERE id = ?", sv.id);
      log('sistem', 'Server pao', `${sv.name} ne odgovara ${Math.round((now() - sv.last_seen) / 1000)} s`, 'error');
      if (!sv.maintenance) notify('n_server', `🔴 ${sv.name} (${sv.host}) ne odgovara! Provjeri server.`);
    }
    const pct = sv.capacity ? (sv.online || 0) / sv.capacity * 100 : 0;
    if (pct >= warnPct && !capWarned.has(sv.id)) { capWarned.add(sv.id); notify('n_capacity', `🟠 ${sv.name} je na ${Math.round(pct)}% kapaciteta (${sv.online}/${sv.capacity}).`); }
    if (pct < warnPct - 10) capWarned.delete(sv.id);
  }
}

async function dailyReport() {
  const t = now();
  const tz = settings.get('timezone');
  const yday = dayKey(t - 86400000, tz);
  const d = one('SELECT * FROM daily WHERE day = ?', yday) || {};
  const since = t - 86400000;
  const rev = one("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE ts >= ? AND type IN ('topup','sale')", since).s;
  const users = all('SELECT disabled, expires_at, traffic_limit, traffic_up, traffic_down FROM users');
  let active = 0, expiring = 0;
  for (const u of users) { const s = vpn.userStatus(u, t); if (vpn.CAN_CONNECT.has(s)) active++; if (s === 'expiring') expiring++; }
  const servers = all('SELECT status, enabled FROM servers WHERE enabled = 1');
  const offline = servers.filter((s) => s.status === 'offline').length;
  notify('n_daily', `📊 Dnevni izvještaj\nZarada (24 h): €${rev.toFixed(2)}\nNovi korisnici: ${d.new_users || 0} · produženja: ${d.renewals || 0}\nAktivni: ${active} · ističe uskoro: ${expiring}\nServeri: ${servers.length - offline}/${servers.length} online\nPromet juče: ${((d.traffic || 0) / 1024 ** 4).toFixed(2)} TB`);
}

async function minute() {
  const s = settings.load();
  const lp = localParts(s.timezone);
  // dnevni izvještaj u 09:00
  if (lp.hour >= 9 && mark('daily') !== lp.date) { setMark('daily', lp.date); dailyReport().catch(() => {}); }
  // backup
  if (s.backup_on) {
    const last = backup.list()[0]?.ts || 0;
    const every = Number(s.backup_every_h || 24);
    const due = every === 6 ? now() - last >= 6 * 3600000 : (lp.hour >= 4 && now() - last >= (every === 168 ? 7 * 86400000 : 20 * 3600000));
    if (due) backup.make('sistem').catch(() => {});
  }
  // jednom dnevno: čišćenje
  if (mark('cleanup') !== lp.date) {
    setMark('cleanup', lp.date);
    const delDays = Number(s.delete_expired_days || 0);
    if (delDays > 0) {
      const grace = Number(s.grace_days || 0);
      const cut = now() - (delDays + grace) * vpn.DAY;
      const old = all('SELECT id, username FROM users WHERE expires_at < ?', cut);
      for (const u of old) { run('DELETE FROM user_history WHERE user_id = ?', u.id); run('DELETE FROM users WHERE id = ?', u.id); }
      if (old.length) log('sistem', 'Obrisani stari istekli nalozi', `${old.length} korisnika`);
    }
    run('DELETE FROM logs WHERE ts < ?', now() - Number(s.log_days || 90) * vpn.DAY);
    run('DELETE FROM login_fail WHERE ts < ?', now() - vpn.DAY);
    run('DELETE FROM sessions WHERE last_active < ?', now() - 30 * vpn.DAY);
    run('DELETE FROM countries WHERE day < ?', dayKey(now() - 120 * vpn.DAY));
  }
  // mjesečno
  if (mark('monthly') !== lp.month) {
    const first = mark('monthly') === undefined;
    setMark('monthly', lp.month);
    if (!first) {
      run('UPDATE servers SET traffic_month = 0');
      if (s.traffic_reset === 'svaki mjesec') { run('UPDATE users SET traffic_up = 0, traffic_down = 0'); log('sistem', 'Mjesečni reset prometa', 'svi korisnici'); }
    }
  }
}

function start() {
  setInterval(() => { try { checkServers(); } catch (e) { console.error(e); } }, 10000);
  setInterval(() => { minute().catch((e) => console.error(e)); }, 60000);
  setTimeout(() => minute().catch(() => {}), 5000);
}

module.exports = { start, dailyReport, checkServers };
