'use strict';
// Poslovi u pozadini: serveri offline, backup, dnevni izvještaj, čišćenje, mjesečni reset prometa.
const { one, all, run, now, log, dayKey } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const backup = require('./backup');
const { notify } = require('./notify');
const core = require('./core');
const cbot = require('./cbot');
const mail = require('./mail');

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
      run("INSERT INTO server_events (server_id, ts, kind) VALUES (?, ?, 'down')", sv.id, sv.last_seen);
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

// ---------- automatsko produženje sa kredita resellera ----------
const renewTried = new Map();
function autoRenew(s) {
  if (!s.auto_renew_on) return;
  const t = now();
  for (const u of all('SELECT u.*, p.trial FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.auto_renew = 1 AND u.owner_id IS NOT NULL AND u.disabled = 0 AND u.expires_at < ?', t + vpn.DAY)) {
    if (u.trial || t - (renewTried.get(u.id) || 0) < 3600000) continue;
    renewTried.set(u.id, t);
    const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller' AND disabled = 0", u.owner_id);
    if (!r) continue;
    try {
      core.extendUser(r, u.id, { plan_id: u.plan_id });
      core.history(u.id, 'Automatski produženo sa kredita resellera');
    } catch (e) {
      core.history(u.id, `Automatsko produženje nije uspjelo: ${e.message}`);
      log('sistem', 'Auto-produženje nije uspjelo', `${u.username} (${r.username}): ${e.message}`, 'warn');
    }
  }
}

// ---------- podsjetnici kupcima (Telegram bot i e-mail) ----------
const isMail = (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v || '').trim());
async function remindCustomers(s) {
  if (!s.customer_reminders) return;
  const t = now(), warn = Number(s.expiry_warn_days || 3) * vpn.DAY;
  const rows = all(`SELECT u.*, a.brand AS rbrand, a.contact AS rcontact FROM users u LEFT JOIN admins a ON a.id = u.owner_id
    WHERE u.disabled = 0 AND u.auto_renew = 0 AND u.expires_at > ? AND u.expires_at - ? <= ? AND (u.tg_chat IS NOT NULL OR u.email != '' OR u.contact LIKE '%@%.%')`, t - vpn.DAY, t, warn);
  for (const u of rows) {
    const stage1 = u.reminded_at < u.expires_at - warn;
    const stage2 = t >= u.expires_at - vpn.DAY && u.reminded_at < u.expires_at - vpn.DAY;
    if (!stage1 && !stage2) continue;
    run('UPDATE users SET reminded_at = ? WHERE id = ?', t, u.id);
    const wl = s.res_whitelabel && u.rbrand;
    const brand = wl ? u.rbrand : s.brand, support = (wl ? u.rcontact : s.support_contact) || '';
    const when = u.expires_at < t ? 'je istekao' : `ističe ${new Date(u.expires_at).toLocaleDateString('bs-BA')}`;
    const text = `⏳ Tvoj ${brand} nalog (${u.username}) ${when}.\nDa ti VPN ne prestane raditi, produži na vrijeme.${support ? `\nZa produženje: ${support}` : ''}`;
    if (u.tg_chat) cbot.send(u.tg_chat, text).catch(() => {});
    const to = u.email || (isMail(u.contact) ? u.contact.trim() : '');
    if (to && mail.configured()) mail.sendMail({ to, subject: `${brand}: nalog ${when}`, text }).catch((e) => log('sistem', 'Podsjetnik mailom nije poslan', e.message, 'warn'));
    core.history(u.id, `Podsjetnik poslan (${[u.tg_chat && 'Telegram', to && 'e-mail'].filter(Boolean).join(', ')})`);
  }
}

// ---------- automatsko podizanje nivoa resellera (1. u mjesecu) ----------
function autoLevels() {
  const d = new Date(), from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const levels = all('SELECT * FROM levels ORDER BY min_monthly DESC');
  for (const r of all("SELECT * FROM admins WHERE role = 'reseller' AND disabled = 0")) {
    const sum = one("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE reseller_id = ? AND type = 'topup' AND ts >= ? AND ts < ?", r.id, from, to).s;
    const target = levels.find((l) => sum >= (l.min_monthly || 0));
    const cur = levels.find((l) => l.id === r.level_id);
    if (target && (!cur || target.discount > cur.discount)) {
      run('UPDATE admins SET level_id = ? WHERE id = ?', target.id, r.id);
      log('sistem', 'Reseller podignut na viši nivo', `${r.username}: ${cur?.name || 'bez nivoa'} → ${target.name} (prošli mjesec €${sum})`);
      notify('n_payment', `⬆️ ${r.username} je prešao na nivo ${target.name} (kupio €${sum} prošli mjesec).`);
    }
  }
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
  autoRenew(s);
  require('./paypal').sweep().catch((e) => console.error('paypal', e));
  if (lp.hour >= 10 && lp.hour < 21) remindCustomers(s).catch((e) => console.error(e));
  // jednom dnevno: čišćenje
  if (mark('cleanup') !== lp.date) {
    setMark('cleanup', lp.date);
    const delDays = Number(s.delete_expired_days || 0);
    if (delDays > 0) {
      const grace = Number(s.grace_days || 0);
      const cut = now() - (delDays + grace) * vpn.DAY;
      const old = all('SELECT id, username FROM users WHERE expires_at < ?', cut);
      for (const u of old) require('./core').trashUser(u.id, 'sistem', `istekao prije više od ${delDays} dana`);
      if (old.length) log('sistem', 'Obrisani stari istekli nalozi', `${old.length} korisnika`);
    }
    run('DELETE FROM trash WHERE deleted_at < ?', now() - 30 * vpn.DAY);   // korpa čuva 30 dana
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
      if (s.res_auto_level) autoLevels();
      if (s.traffic_reset === 'svaki mjesec') { run('UPDATE users SET traffic_up = 0, traffic_down = 0'); log('sistem', 'Mjesečni reset prometa', 'svi korisnici'); }
    }
  }
}

function start() {
  setInterval(() => { try { checkServers(); } catch (e) { console.error(e); } }, 10000);
  setInterval(() => { minute().catch((e) => console.error(e)); }, 60000);
  setTimeout(() => minute().catch(() => {}), 5000);
  cbot.loop().catch((e) => console.error('cbot', e));
}

module.exports = { start, dailyReport, checkServers, autoRenew, remindCustomers, autoLevels };
