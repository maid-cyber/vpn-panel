'use strict';
// API za panel (admin i reseller). Svi odgovori su JSON.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, one, all, run, tx, log, now, DATA_DIR, dayKey } = require('./db');
const settings = require('./settings');
const auth = require('./auth');
const vpn = require('./vpn');
const core = require('./core');
const QR = require('../public/qr.js');
const backup = require('./backup');
const { fail, readBody, send, esc } = require('./http');
const { telegram, notify, geoIp } = require('./notify');

const VERSION = require('../package.json').version;
const mail = require('./mail');
const cbot = require('./cbot');
const stripe = require('./stripe');
const s3 = require('./s3');
const routes = [];
const route = (method, pattern, perm, fn) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, perm, fn });
};

// kupac je 'online' ako je imao promet u zadnje 2 minute
const ONLINE_MS = 120000;
// perm: null = svako prijavljen; 'res' = reseller; 'any' = admin ili reseller; ostalo po auth.can
function allowed(me, perm, method) {
  if (perm === null || perm === 'any') return true;
  if (me.role === 'reseller') return perm === 'res' || perm === 'any';
  if (perm === 'res') return false;
  if (perm === 'owner') return me.role === 'owner';
  return auth.can(me, method === 'GET' ? perm + ':read' : perm);
}

const isRes = (me) => me.role === 'reseller';
const mask = (h) => h ? h.replace(/\.(\d+)\.(\d+)$/, '.xx.$2') : '';

// ============================== prijava ==============================
route('POST', 'login', 'public', async (c) => {
  const { username, password, code } = c.body;
  if (auth.isLocked(c.ip)) fail(429, 'Previše pogrešnih pokušaja. Pokušaj kasnije.');
  const any = one('SELECT * FROM admins WHERE username = ?', String(username || ''));
  if (any && any.pending && c.portal === 'reseller' && auth.checkPassword(password, any.pass_hash)) fail(403, 'Tvoj nalog čeka odobrenje administratora. Javit ćemo ti se.');
  const a = any && !any.disabled ? any : null;
  // na ulazu za resellere prijavljuju se samo reselleri, a na admin ulazu samo admini (ako je poseban panel uključen)
  const wrongDoor = a && ((c.portal === 'reseller' && a.role !== 'reseller') || (c.portal === 'admin' && a.role === 'reseller' && settings.get('res_portal')));
  if (!a || wrongDoor || !auth.checkPassword(password, a.pass_hash)) { auth.addFail(c.ip); log(String(username || '?'), 'Neuspješna prijava', '', 'warn'); fail(401, 'Pogrešno korisničko ime ili šifra.'); }
  if (a.totp_on) {
    if (!code) return { need2fa: true };
    if (!auth.checkTotp(a.totp_secret, code)) { auth.addFail(c.ip); fail(401, 'Pogrešan 2FA kod.'); }
  }
  if (settings.get('maintenance') && a.role === 'reseller') fail(503, settings.get('maintenance_msg'));
  auth.clearFails(c.ip);
  const seenIp = one('SELECT 1 AS x FROM sessions WHERE admin_id = ? AND ip = ?', a.id, c.ip);
  const token = auth.createSession(a.id, c.ip, c.req.headers['user-agent'], a.totp_on);
  run('UPDATE admins SET last_login = ? WHERE id = ?', now(), a.id);
  log(a.username, 'Prijava', a.role === 'reseller' ? 'reseller' : '');
  if (!seenIp && a.role !== 'reseller') {
    const g = await geoIp(c.ip);
    notify('notify_new_ip', `Prijava admina ${a.username} sa nove adrese${g ? ` (${g.city || ''} ${g.cc})` : ''}`);
  }
  c.setCookie(token);
  return { ok: true };
});

route('GET', 'portal', 'public', (c) => ({ portal: c.portal, signup: c.portal === 'reseller' && !!settings.get('res_signup') }));
route('POST', 'signup', 'public', (c) => {
  if (c.portal !== 'reseller' || !settings.get('res_signup')) fail(404, 'Registracija nije otvorena.');
  if (auth.isLocked(c.ip)) fail(429, 'Previše pokušaja. Pokušaj kasnije.');
  const b = c.body;
  const username = String(b.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) fail(400, 'Korisničko ime: 3–30 znakova (slova, brojevi, . _ -).');
  if (!auth.validPassword(b.password)) fail(400, 'Šifra mora imati bar 8 znakova.');
  const contact = String(b.contact || '').trim().slice(0, 120);
  if (contact.length < 3) fail(400, 'Upiši kontakt (Telegram, WhatsApp ili e-mail) da ti se možemo javiti.');
  auth.addFail(c.ip);                                 // ograničava broj registracija sa iste adrese
  if (one('SELECT id FROM admins WHERE username = ?', username)) fail(400, 'To ime je zauzeto.');
  const lvl = one('SELECT * FROM levels ORDER BY discount LIMIT 1');
  run(`INSERT INTO admins (username, pass_hash, role, level_id, user_limit, contact, email, note, disabled, pending, created_at) VALUES (?,?,?,?,?,?,?,?,1,1,?)`,
    username, auth.hashPassword(b.password), 'reseller', lvl?.id || null, lvl?.max_users || 150, contact, core.cleanEmail(b.email), 'Registrovao se sam', now());
  log(username, 'Reseller se registrovao', `čeka odobrenje · ${contact}`, 'warn');
  notify('n_payment', `🆕 Novi reseller ${username} se registrovao i čeka odobrenje (${contact}).`);
  return { ok: true };
});
route('POST', 'logout', null, (c) => { auth.deleteSession(c.auth.session.token); c.setCookie(''); return { ok: true }; });

route('GET', 'me', null, (c) => {
  const { admin, me, impersonating } = c.auth;
  const s = settings.load();
  const perms = ['dash', 'users', 'plans', 'servers', 'resellers', 'finance', 'logs', 'settings', 'backup'].filter((p) => auth.can(admin, p) || auth.can(admin, p + ':read'));
  return {
    id: me.id, username: me.username, role: me.role, impersonating, real: impersonating ? admin.username : null,
    totp_on: !!admin.totp_on, must2fa: !!s.require_2fa && !admin.totp_on && admin.role !== 'reseller',
    credit: isRes(me) ? me.credit : null, perms, version: VERSION,
    res_path: !isRes(me) && s.res_portal ? s.reseller_path : null, portal: c.portal,
    msg_template: s.msg_template, support: s.support_contact,
    mail_on: mail.configured(), stripe: !!(s.stripe_on && s.stripe_secret), cbot: !!(s.cbot_on && s.cbot_token), proto_ss: !!s.proto_ss,
    wl: isRes(me) ? !!s.res_whitelabel : undefined,
    cust_brand: isRes(me) && s.res_whitelabel && me.brand ? me.brand : s.brand,
    cust_support: (isRes(me) && s.res_whitelabel && me.brand ? me.contact : s.support_contact) || '',
    brand: s.brand, currency: s.currency, timezone: s.timezone, accent: s.accent, theme: s.theme, maintenance: !!s.maintenance,
    pay: isRes(me) ? { methods: s.pay_methods, usdt: s.pay_usdt, iban: s.pay_iban, paypal: s.pay_paypal, min: s.res_min_topup } : null,
  };
});

route('POST', '2fa/setup', null, (c) => {
  const secret = auth.newTotpSecret();
  const label = encodeURIComponent(`${settings.get('brand')}:${c.auth.admin.username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(settings.get('brand'))}`;
  return { secret, svg: QR.svg(uri, { size: 200 }) };
});
route('POST', '2fa/enable', null, (c) => {
  if (!auth.checkTotp(c.body.secret, c.body.code)) fail(400, 'Kod nije tačan. Provjeri vrijeme na telefonu.');
  run('UPDATE admins SET totp_secret = ?, totp_on = 1 WHERE id = ?', c.body.secret, c.auth.admin.id);
  log(c.auth.admin.username, '2FA uključen');
  return { ok: true };
});
route('POST', '2fa/disable', null, (c) => {
  if (!auth.checkPassword(c.body.password, c.auth.admin.pass_hash)) fail(400, 'Pogrešna šifra.');
  if (settings.get('require_2fa') && c.auth.admin.role !== 'reseller') fail(400, '2FA je obavezna u postavkama sigurnosti.');
  run('UPDATE admins SET totp_on = 0, totp_secret = NULL WHERE id = ?', c.auth.admin.id);
  log(c.auth.admin.username, '2FA isključen', '', 'warn');
  return { ok: true };
});
route('POST', 'password', null, (c) => {
  const a = c.auth.admin;
  if (!auth.checkPassword(c.body.old, a.pass_hash)) fail(400, 'Stara šifra nije tačna.');
  if (!auth.validPassword(c.body.new)) fail(400, 'Nova šifra mora imati bar 8 znakova.');
  run('UPDATE admins SET pass_hash = ?, pass_changed = ? WHERE id = ?', auth.hashPassword(c.body.new), now(), a.id);
  run('DELETE FROM sessions WHERE admin_id = ? AND token != ?', a.id, c.auth.session.token);
  log(a.username, 'Šifra promijenjena');
  return { ok: true };
});

// ============================== dashboard ==============================
function serverView(sv, forReseller) {
  const off = Number(settings.get('offline_sec') || 45) * 1000;
  const online = sv.last_seen && now() - sv.last_seen < off;
  const st = !sv.enabled ? 'disabled' : sv.maintenance ? 'maintenance' : sv.status === 'pending' && !sv.last_seen ? 'pending' : online ? 'online' : 'offline';
  const full = sv.capacity ? sv.online / sv.capacity : 0;
  return {
    id: sv.id, name: sv.name, city: sv.city, country: sv.country, lat: sv.lat, lon: sv.lon,
    host: forReseller ? '' : sv.host, status: st, warn: st === 'online' && full * 100 >= Number(settings.get('capacity_warn') || 80),
    cpu: sv.cpu, ram: sv.ram, net: sv.net_mbps, online: sv.online || 0, capacity: sv.capacity,
    users: sv.users_count ?? null, traffic_month: sv.traffic_month, provider: forReseller ? '' : sv.provider, cost: forReseller ? 0 : sv.cost,
    enabled: !!sv.enabled, maintenance: !!sv.maintenance, last_seen: sv.last_seen, uptime: sv.uptime, version: sv.agent_version,
    vless_port: sv.vless_port, wg_port: sv.wg_port, ss_port: sv.ss_port, sni: sv.sni, xray_ok: sv.xray_ok, wg_ok: sv.wg_ok,
    xray_version: forReseller ? '' : sv.xray_version, last_error: forReseller ? '' : sv.last_error,
    synced: !!sv.applied_hash, tags: vpn.serverTags(sv),
    dedicated: forReseller ? [] : vpn.dedicatedIds(sv).map((id) => one('SELECT id, username FROM users WHERE id = ?', id)).filter(Boolean),
    cloud: forReseller ? null : sv.cloud || null, cloud_job: forReseller || !sv.cloud ? null : require('./cloud').jobOf(sv.id),
  };
}
function serversList(forReseller) {
  const rows = all('SELECT * FROM servers ORDER BY country, name');
  return rows.map((sv) => serverView(sv, forReseller));
}

// "Prvi koraci": šta još treba podesiti prije prodaje (nestane kad je sve gotovo ili kad ga sakriješ)
function setupSteps(c) {
  const s = settings.load();
  if (s.setup_hide) return null;
  const me = c.auth.admin || c.auth.me;
  const steps = [
    { k: 'https', label: 'HTTPS adresa panela', hint: 'Postavke → Općenito → Adresa panela', href: 'postavke', done: /^https:\/\//.test(s.panel_url || '') },
    { k: 'server', label: 'Bar jedan server online', hint: 'Serveri → Dodaj server', href: 'serveri', done: !!one("SELECT id FROM servers WHERE enabled = 1 AND last_seen > ?", now() - 300000) },
    { k: 'plans', label: 'Planovi sa cijenama', hint: 'Planovi → bar jedan plaćeni plan', href: 'planovi', done: !!one('SELECT id FROM plans WHERE active = 1 AND trial = 0 AND price > 0') },
    { k: 'pay', label: 'Način plaćanja', hint: 'Postavke → Plaćanja (USDT, IBAN, PayPal ili Stripe)', href: 'postavke', done: !!((s.stripe_on && s.stripe_secret) || (s.paypal_on && s.paypal_secret) || s.pay_usdt || s.pay_iban || s.pay_paypal) },
    { k: 'support', label: 'Kontakt podrške za kupce', hint: 'Postavke → Pretplata i aplikacije', href: 'postavke', done: !!s.support_contact },
    { k: 'tg', label: 'Telegram obavještenja', hint: 'Postavke → Obavještenja', href: 'postavke', done: !!s.tg_token },
    { k: 'trial', label: 'Probni nalog u aplikaciji', hint: 'Aplikacija → Probaj besplatno', href: 'aplikacija', done: !!s.app_trial },
    { k: '2fa', label: 'Dvostruka zaštita prijave (2FA)', hint: 'Moj profil → 2FA', href: 'profil', done: !!me?.totp_on },
    { k: 'user', label: 'Prvi kupac', hint: 'Korisnici → Novi korisnik', href: 'korisnici', done: !!one('SELECT id FROM users LIMIT 1') },
  ];
  return steps.every((x) => x.done) ? null : steps;
}

// početak dana (lokalno vrijeme servera) prije `back` dana
function dayStart(t, back) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back); return d.getTime(); }

function revenueSeries(days) {
  const tz = settings.get('timezone');
  const from = now() - days * 86400000;
  const map = new Map();
  for (let i = days - 1; i >= 0; i--) map.set(dayKey(now() - i * 86400000, tz), { rev: 0, traffic: 0, users: 0 });
  for (const t of all("SELECT ts, amount FROM transactions WHERE ts >= ? AND type IN ('topup','sale')", from)) {
    const d = map.get(dayKey(t.ts, tz)); if (d) d.rev += t.amount;
  }
  for (const r of all('SELECT day, traffic, new_users FROM daily WHERE day >= ?', dayKey(from, tz))) { const d = map.get(r.day); if (d) { d.traffic = r.traffic; d.users = r.new_users || 0; } }
  return [...map.entries()].map(([day, v]) => ({ day, rev: core.round2(v.rev), traffic: v.traffic, users: v.users }));
}

route('GET', 'dash', 'dash', (c) => {
  const t = now();
  const users = all('SELECT disabled, blocked_until, expires_at, traffic_limit, traffic_up, traffic_down, created_at, last_seen FROM users');
  const counts = { all: users.length, active: 0, expiring: 0, grace: 0, expired: 0, limited: 0, disabled: 0, devices: 0 };
  for (const u of users) counts[vpn.userStatus(u, t)]++;
  const tz = settings.get('timezone');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const prevStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime();
  const sum = (a, b) => one("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE ts >= ? AND ts < ? AND type IN ('topup','sale')", a, b).s;
  const revMonth = sum(monthStart, t + 1), revPrev = sum(prevStart, monthStart);
  const weekNew = users.filter((u) => u.created_at > t - 7 * 86400000).length;
  const servers = serversList(false);
  const days = [7, 30, 90].includes(Number(c.query.days)) ? Number(c.query.days) : 7;
  const series = revenueSeries(days);
  const countries = all('SELECT cc, SUM(n) AS n FROM countries WHERE day >= ? GROUP BY cc ORDER BY n DESC', dayKey(t - 30 * 86400000, tz));
  const ctotal = countries.reduce((s, r) => s + r.n, 0);
  const top = all(`SELECT a.id, a.username, l.name AS level, (SELECT COUNT(*) FROM users u WHERE u.owner_id = a.id) AS users,
      (SELECT COALESCE(SUM(amount),0) FROM transactions x WHERE x.reseller_id = a.id AND x.type = 'topup' AND x.ts >= ?) AS rev
    FROM admins a LEFT JOIN levels l ON l.id = a.level_id WHERE a.role = 'reseller' ORDER BY rev DESC, users DESC LIMIT 5`, monthStart);
  const warnings = [];
  for (const s of servers) {
    if (s.status === 'offline') warnings.push({ kind: 'red', text: `${s.name} ne odgovara` });
    if (s.warn) warnings.push({ kind: 'amber', text: `${s.name} je na ${Math.round(s.online / s.capacity * 100)}% kapaciteta` });
  }
  if (counts.expiring) warnings.push({ kind: 'amber', text: `${counts.expiring} korisnika ističe u naredna ${settings.get('expiry_warn_days')} dana` });
  if (!settings.get('tg_token')) warnings.push({ kind: 'blue', text: 'Telegram obavijesti nisu podešene (Postavke → Obavještenja)' });
  if (!settings.get('panel_url')) warnings.push({ kind: 'blue', text: 'Upiši adresu panela u Postavke → Općenito' });
  return {
    counts, weekNew, revMonth: core.round2(revMonth), revPrev: core.round2(revPrev),
    online: servers.filter((s) => s.status === 'online').length, serversTotal: servers.filter((s) => s.enabled).length,
    connected: servers.reduce((s, x) => s + (x.status === 'online' ? x.online : 0), 0),
    servers, series, days, flows: require('./nodes').liveFlows(), setup: setupSteps(c),
    countries: countries.slice(0, 8).map((r) => ({ cc: r.cc, n: r.n, pct: ctotal ? Math.round(r.n / ctotal * 100) : 0 })),
    revToday: core.round2(sum(dayStart(t, 0), t + 1)), revYesterday: core.round2(sum(dayStart(t, 1), dayStart(t, 0))),
    protocols: { vless: !!settings.get('proto_vless'), ss: !!settings.get('proto_ss'), wg: !!settings.get('proto_wg') },
    activePlans: one('SELECT COUNT(*) AS n FROM plans WHERE active = 1').n,
    top, warnings, activity: all('SELECT * FROM logs ORDER BY id DESC LIMIT 8'),
    totals: {
      rev: core.round2(series.reduce((s, d) => s + d.rev, 0)), traffic: series.reduce((s, d) => s + d.traffic, 0),
      newUsers: one('SELECT COALESCE(SUM(new_users),0) AS n FROM daily WHERE day >= ?', series[0].day).n,
      renewals: one('SELECT COALESCE(SUM(renewals),0) AS n FROM daily WHERE day >= ?', series[0].day).n,
    },
  };
});

route('GET', 'res/dash', 'res', (c) => {
  const me = c.auth.me, t = now();
  const users = all('SELECT disabled, blocked_until, expires_at, traffic_limit, traffic_up, traffic_down FROM users WHERE owner_id = ?', me.id);
  const counts = { all: users.length, active: 0, expiring: 0, grace: 0, expired: 0, limited: 0, disabled: 0, devices: 0 };
  for (const u of users) counts[vpn.userStatus(u, t)]++;
  const lvl = me.level_id ? one('SELECT * FROM levels WHERE id = ?', me.level_id) : null;
  const plans = all('SELECT * FROM plans WHERE active = 1 ORDER BY sort, id').map((p) => ({ id: p.id, name: p.name, days: p.days, traffic_gb: p.traffic_gb, trial: !!p.trial, price: p.trial ? 0 : core.resellerPrice(me, p) }));
  return {
    counts, credit: me.credit, limit: me.user_limit, level: lvl ? { name: lvl.name, discount: lvl.discount } : null, plans,
    servers: serversList(true).filter((s) => s.enabled).map((s) => ({ name: s.name, city: s.city, country: s.country, status: s.status, lat: s.lat, lon: s.lon })),
    activity: all("SELECT ts, text, (SELECT username FROM users WHERE id = h.user_id) AS username FROM user_history h WHERE user_id IN (SELECT id FROM users WHERE owner_id = ?) ORDER BY id DESC LIMIT 8", me.id),
  };
});

// ============================== uživo i analitika ==============================
route('GET', 'live/feed', 'dash', (c) => {
  const t = now(), tz = settings.get('timezone'), after = Number(c.query.after) || 0;
  const day0 = dayStart(t, 0);
  const events = all(`SELECT id, ts, actor, action, detail, kind FROM logs WHERE id > ? ${after ? '' : 'AND ts > ' + (t - 86400000)} ORDER BY id DESC LIMIT 40`, after);
  const sales = one("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM transactions WHERE ts >= ? AND type IN ('topup','sale')", day0);
  return {
    t, events,
    stats: {
      online: one('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', t - ONLINE_MS).n,
      sessions: serversList().reduce((a, s) => a + (s.status === 'online' ? s.online : 0), 0),
      revToday: core.round2(sales.s), salesToday: sales.n,
      newToday: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', day0).n,
      trafficToday: one('SELECT traffic FROM daily WHERE day = ?', dayKey(t, tz))?.traffic || 0,
    },
  };
});
route('GET', 'analytics', 'dash', (c) => {
  const t = now(), days = [30, 90, 365].includes(Number(c.query.days)) ? Number(c.query.days) : 30;
  const from = dayStart(t, days - 1);
  const users = all('SELECT u.id, u.created_at, u.expires_at, u.owner_id, u.plan_id, u.disabled, u.last_seen, p.price, p.days AS pdays, p.trial FROM users u LEFT JOIN plans p ON p.id = u.plan_id');
  const tx = all("SELECT ts, type, amount, user_id FROM transactions WHERE ts >= ? AND type IN ('topup','sale','expense')", from);
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const a = dayStart(t, i), b = i ? dayStart(t, i - 1) : t + 1;
    let rev = 0, exp = 0;
    for (const x of tx) if (x.ts >= a && x.ts < b) { if (x.type === 'expense') exp += Math.abs(x.amount); else rev += x.amount; }
    series.push({ ts: a, rev: core.round2(rev), exp: core.round2(exp), new: users.filter((u) => u.created_at >= a && u.created_at < b).length,
      active: users.filter((u) => u.created_at < b && u.expires_at >= Math.min(b, t) && !u.disabled).length });
  }
  const active = users.filter((u) => u.expires_at > t && !u.disabled);
  const paying = active.filter((u) => u.price > 0 && !u.trial);
  const mrr = paying.reduce((a, u) => a + u.price * 30 / Math.max(1, u.pdays || 30), 0);
  const grace = Number(settings.get('grace_days') || 0) * 86400000;
  const atStart = users.filter((u) => u.created_at < from && u.expires_at >= from).length;
  const churned = users.filter((u) => u.expires_at >= from && u.expires_at + grace < t && u.price > 0 && !u.trial).length;
  const renewals = one('SELECT COALESCE(SUM(renewals),0) AS n FROM daily WHERE day >= ?', dayKey(from, settings.get('timezone'))).n;
  const plans = all('SELECT id, name, price, days FROM plans').map((p) => {
    const n = active.filter((u) => u.plan_id === p.id).length;
    return { name: p.name, n, mrr: core.round2(n * (p.price || 0) * 30 / Math.max(1, p.days || 30)) };
  }).filter((p) => p.n).sort((a, b) => b.n - a.n);
  const ltvRow = one("SELECT COALESCE(SUM(amount),0) AS s, COUNT(DISTINCT user_id) AS n FROM transactions WHERE user_id IS NOT NULL AND type IN ('sale','topup')");
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const x of tx) if (x.type !== 'expense') { const d = new Date(x.ts); heat[(d.getDay() + 6) % 7][d.getHours()]++; }
  const ctotal = one('SELECT COALESCE(SUM(n),0) AS n FROM countries WHERE day >= ?', dayKey(from, settings.get('timezone'))).n;
  const countries = all('SELECT cc, SUM(n) AS n FROM countries WHERE day >= ? GROUP BY cc ORDER BY n DESC LIMIT 10', dayKey(from, settings.get('timezone'))).map((r) => ({ ...r, pct: ctotal ? Math.round(r.n / ctotal * 100) : 0 }));
  const owners = { direct: active.filter((u) => !u.owner_id).length, resellers: active.filter((u) => u.owner_id).length };
  const rev = series.reduce((a, d) => a + d.rev, 0), exp = series.reduce((a, d) => a + d.exp, 0);
  return {
    days, series, plans, heat, countries, owners,
    kpi: {
      active: active.length, paying: paying.length, mrr: core.round2(mrr), arpu: paying.length ? core.round2(mrr / paying.length) : 0,
      newUsers: series.reduce((a, d) => a + d.new, 0), renewals, churned, churnPct: atStart ? Math.round(churned / atStart * 1000) / 10 : 0,
      rev: core.round2(rev), exp: core.round2(exp), profit: core.round2(rev - exp), ltv: ltvRow.n ? core.round2(ltvRow.s / ltvRow.n) : 0,
      online: users.filter((u) => u.last_seen && t - u.last_seen < ONLINE_MS).length,
    },
  };
});

// ============================== kuponi ==============================
const coupons = require('./coupons');
route('GET', 'coupons', 'plans', () => coupons.listAll());
route('POST', 'coupons', 'plans', (c) => coupons.create(c.body, c.auth.me.username));
route('PUT', 'coupons/:id', 'plans', (c) => coupons.update(c.params.id, c.body, c.auth.me.username));
route('DELETE', 'coupons/:id', 'plans', (c) => coupons.remove(c.params.id, c.auth.me.username));

// ============================== uvoz kupaca iz drugih panela ==============================
const importer = require('./importer');
route('POST', 'import/preview', 'users', async (c) => importer.preview(await readBody(c.req, 64 << 20, true)));
route('POST', 'import/commit', 'users', (c) => importer.commit(c.body.token, c.body, c.auth.me.username));

// ============================== korpa ==============================
route('GET', 'trash', 'users', (c) => {
  const res = isRes(c.auth.me);
  return all(`SELECT id, user_id, username, owner_id, deleted_at, by, reason, data FROM trash ${res ? 'WHERE owner_id = ?' : ''} ORDER BY id DESC LIMIT 500`, ...(res ? [c.auth.me.id] : []))
    .map((t) => { const u = JSON.parse(t.data).user || {}; const p = u.plan_id ? one('SELECT name FROM plans WHERE id = ?', u.plan_id) : null; const o = u.owner_id ? one('SELECT username FROM admins WHERE id = ?', u.owner_id) : null;
      return { id: t.id, username: t.username, deleted_at: t.deleted_at, by: t.by, reason: t.reason, plan: p?.name || null, owner: o?.username || null, expires_at: u.expires_at, traffic: (u.traffic_up || 0) + (u.traffic_down || 0), contact: u.contact || u.email || '', purge_at: t.deleted_at + 30 * 86400000 }; });
});
route('POST', 'trash/:id/restore', 'users', (c) => core.restoreUser(c.auth.me, c.params.id));
route('DELETE', 'trash/:id', 'users', (c) => {
  const t = one('SELECT * FROM trash WHERE id = ?', Number(c.params.id));
  if (!t || (isRes(c.auth.me) && t.owner_id !== c.auth.me.id)) fail(404, 'Toga više nema u korpi.');
  run('DELETE FROM trash WHERE id = ?', t.id);
  log(c.auth.me.username, 'Trajno obrisan iz korpe', t.username, 'warn');
  return { ok: true };
});

// ============================== korisnici ==============================
function listUsers(c, me) {
  const q = c.query, t = now();
  const where = [], args = [];
  if (isRes(me)) { where.push('u.owner_id = ?'); args.push(me.id); }
  if (q.q) { where.push('(u.username LIKE ? OR u.note LIKE ? OR u.contact LIKE ?)'); const s = `%${q.q}%`; args.push(s, s, s); }
  if (q.plan) { where.push('u.plan_id = ?'); args.push(Number(q.plan)); }
  if (q.owner === 'me') where.push('u.owner_id IS NULL');
  else if (q.owner) { where.push('u.owner_id = ?'); args.push(Number(q.owner)); }
  let rows = all(`${core.USER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.id DESC`, ...args).map((u) => core.userRow(u, t));
  if (q.server) rows = rows.filter((u) => String(u.last_server) === q.server);
  const onlineN = rows.filter((u) => u.online).length;
  const counts = { all: rows.length, active: 0, expiring: 0, grace: 0, expired: 0, limited: 0, disabled: 0, devices: 0 };
  for (const u of rows) counts[u.status]++;
  if (q.status === 'online') rows = rows.filter((u) => u.online);
  else if (q.status && q.status !== 'all') rows = rows.filter((u) => (q.status === 'active' ? ['active', 'expiring', 'grace'].includes(u.status) : u.status === q.status));
  const per = 50, page = Math.max(1, Number(q.page) || 1);
  return { counts, online: onlineN, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / per)), users: rows.slice((page - 1) * per, page * per) };
}
route('GET', 'users', 'users', (c) => listUsers(c, c.auth.me));
route('GET', 'res/users', 'res', (c) => listUsers(c, c.auth.me));

function subBase(c) {
  const s = settings.load();
  return (s.sub_url || s.panel_url || `${c.proto}://${c.req.headers.host}`).replace(/\/+$/, '');
}
function userDetail(c, me) {
  const u = core.getUser(c.params.id, isRes(me) ? me : null);
  const link = `${subBase(c)}/s/${u.sub_token}`;
  const servers = vpn.serversForUser(u);
  return {
    ...core.userRow(u), sub_link: link, uuid: u.uuid, qr: QR.svg(link),
    vless: settings.get('proto_vless') ? servers.filter((s) => s.reality_pub).map((s) => ({ server: s.name, link: vpn.vlessLink(u, s) })) : [],
    ss: settings.get('proto_ss') ? servers.filter((s) => s.reality_pub).map((s) => ({ server: s.name, link: vpn.ssLink(u, s) })) : [],
    wg: settings.get('proto_wg') ? servers.filter((s) => s.wg_pub).map((s) => ({ id: s.id, server: s.name, url: `${link}/wg/${s.id}` })) : [],
    pf_on: !!settings.get('pf_on'), pf_port: u.pf_port || 0,
    pf_hosts: u.pf_port ? servers.filter((s) => s.wg_pub && s.host).map((s) => ({ server: s.name, host: s.host })) : [],
    history: all('SELECT ts, text FROM user_history WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id),
  };
}
route('GET', 'users/suggest', 'users', () => ({ username: core.suggestUsername() }));
route('GET', 'res/users/suggest', 'res', () => ({ username: core.suggestUsername() }));
route('GET', 'users/:id', 'users', (c) => userDetail(c, c.auth.me));
route('GET', 'res/users/:id', 'res', (c) => userDetail(c, c.auth.me));

const createH = (c) => {
  const id = core.createUser(c.auth.me, c.body);
  const mailed = settings.get('mail_welcome') !== false && require('./welcome').sendLater(id, 'new');
  return { id, mailed };
};
route('POST', 'users', 'users', createH);
route('POST', 'res/users', 'res', createH);

route('PUT', 'users/:id', 'users', (c) => {
  const u = core.getUser(c.params.id);
  const b = c.body;
  const fields = [], args = [];
  if (b.username !== undefined && b.username !== u.username) {
    if (!/^[a-zA-Z0-9._@-]{3,40}$/.test(b.username)) fail(400, 'Neispravno korisničko ime.');
    if (one('SELECT id FROM users WHERE username = ? AND id != ?', b.username, u.id)) fail(400, 'Ime je zauzeto.');
    fields.push('username = ?'); args.push(b.username);
  }
  if (b.note !== undefined) { fields.push('note = ?'); args.push(String(b.note).slice(0, 500)); }
  if (b.contact !== undefined) { fields.push('contact = ?'); args.push(String(b.contact).slice(0, 120)); }
  if (b.email !== undefined) { fields.push('email = ?'); args.push(core.cleanEmail(b.email)); }
  if (b.auto_renew !== undefined) { fields.push('auto_renew = ?'); args.push(b.auto_renew ? 1 : 0); }
  if (b.unblock) { fields.push('blocked_until = 0'); }
  if (b.devices !== undefined) { fields.push('devices = ?'); args.push(Math.max(1, Number(b.devices) || 1)); }
  if (b.traffic_gb !== undefined) { fields.push('traffic_limit = ?'); args.push(Math.round(Number(b.traffic_gb || 0) * core.GB)); }
  if (b.expires_at !== undefined) { fields.push('expires_at = ?'); args.push(Number(b.expires_at)); }
  if (b.plan_id !== undefined) { fields.push('plan_id = ?'); args.push(Number(b.plan_id)); }
  if (b.owner_id !== undefined) { fields.push('owner_id = ?'); args.push(b.owner_id ? Number(b.owner_id) : null); }
  if (fields.length) run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...args, u.id);
  core.history(u.id, `Izmijenjeno · ${c.auth.me.username}`);
  log(c.auth.me.username, 'Korisnik izmijenjen', u.username);
  return { ok: true };
});
// ---------- Port forwarding (otvoreni port po korisniku) ----------
function freePfPort() {
  const used = new Set();
  for (const s of all('SELECT vless_port, wg_port, ss_port FROM servers')) { used.add(s.vless_port); used.add(s.wg_port); used.add(s.ss_port); }
  for (const c of all('SELECT port FROM chains')) used.add(c.port);
  for (const u of all('SELECT pf_port FROM users WHERE pf_port > 0')) used.add(u.pf_port);
  for (let i = 0; i < 3000; i++) { const p = 30000 + Math.floor(Math.random() * 10000); if (!used.has(p)) return p; }
  return 0;
}
route('POST', 'users/:id/portforward', 'users', (c) => {
  if (!settings.get('pf_on')) fail(400, 'Port forwarding nije uključen (Postavke → Pretplata i aplikacije).');
  const u = core.getUser(c.params.id);
  if (u.pf_port) return { port: u.pf_port };
  const p = freePfPort();
  if (!p) fail(400, 'Nema slobodnog porta. Pokušaj ponovo.');
  run('UPDATE users SET pf_port = ? WHERE id = ?', p, u.id);
  core.history(u.id, `Port forwarding uključen · port ${p}`);
  log(c.auth.me.username, 'Port forwarding', `${u.username} · port ${p}`);
  return { port: p };
});
route('DELETE', 'users/:id/portforward', 'users', (c) => {
  const u = core.getUser(c.params.id);
  run('UPDATE users SET pf_port = 0 WHERE id = ?', u.id);
  core.history(u.id, 'Port forwarding isključen');
  log(c.auth.me.username, 'Port forwarding isključen', u.username);
  return { ok: true };
});
route('PUT', 'res/users/:id', 'res', (c) => {
  const u = core.getUser(c.params.id, c.auth.me);
  if (c.body.note !== undefined) run('UPDATE users SET note = ? WHERE id = ?', String(c.body.note).slice(0, 500), u.id);
  if (c.body.contact !== undefined) run('UPDATE users SET contact = ? WHERE id = ?', String(c.body.contact).slice(0, 120), u.id);
  if (c.body.email !== undefined) run('UPDATE users SET email = ? WHERE id = ?', core.cleanEmail(c.body.email), u.id);
  if (c.body.auto_renew !== undefined) run('UPDATE users SET auto_renew = ? WHERE id = ?', c.body.auto_renew ? 1 : 0, u.id);
  return { ok: true };
});

for (const pre of ['', 'res/']) {
  const perm = pre ? 'res' : 'users';
  route('POST', `${pre}users/:id/extend`, perm, (c) => { core.extendUser(c.auth.me, c.params.id, c.body); return { ok: true }; });
  route('POST', `${pre}users/:id/reset`, perm, (c) => { core.resetTraffic(c.auth.me, c.params.id); return { ok: true }; });
  route('POST', `${pre}users/:id/toggle`, perm, (c) => { const u = core.getUser(c.params.id, isRes(c.auth.me) ? c.auth.me : null); core.setDisabled(c.auth.me, u.id, !u.disabled); return { ok: true }; });
  route('POST', `${pre}users/:id/rekey`, perm, (c) => { core.rekey(c.auth.me, c.params.id); const mailed = settings.get('mail_newlink') !== false && require('./welcome').sendLater(c.params.id, 'newlink'); return { ok: true, mailed }; });
  route('DELETE', `${pre}users/:id`, perm, (c) => { core.deleteUser(c.auth.me, c.params.id); return { ok: true }; });
}

route('POST', 'users/broadcast', 'users', async (c) => {
  const b = c.body, s = settings.load();
  const text = String(b.text || '').trim().slice(0, 3500);
  if (text.length < 3) fail(400, 'Napiši poruku.');
  if (b.announce) settings.set({ sub_announce: text.slice(0, 300) });
  const t = now();
  const rows = all('SELECT * FROM users').filter((u) => b.target === 'all' || vpn.CAN_CONNECT.has(vpn.userStatus(u, t)));
  let tg = 0, em = 0;
  const isMail = (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v || '').trim());
  for (const u of rows) {
    if (b.tg !== false && u.tg_chat) { const r = await cbot.send(u.tg_chat, `📢 ${s.brand}\n\n${text}`); if (r.ok) tg++; await new Promise((x) => setTimeout(x, 40)); }
    const to = u.email || (isMail(u.contact) ? u.contact.trim() : '');
    if (b.email && to && mail.configured()) { try { await mail.sendMail({ to, subject: `${s.brand}: obavještenje`, text }); em++; } catch { /* nastavi */ } }
  }
  log(c.auth.me.username, 'Poruka svim kupcima', `Telegram ${tg} · e-mail ${em}${b.announce ? ' · u aplikaciji' : ''}`);
  return { ok: true, tg, email: em, announce: !!b.announce };
});
for (const pre of ['', 'res/']) {
  route('POST', `${pre}users/:id/send-mail`, pre ? 'res' : 'users', async (c) => {
    const u = core.getUser(c.params.id, isRes(c.auth.me) ? c.auth.me : null);
    const to = String(c.body.to || u.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) fail(400, 'Upiši e-mail kupca.');
    if (!u.email) run('UPDATE users SET email = ? WHERE id = ?', to, u.id);
    await mail.sendMail({ to, subject: String(c.body.subject || `${settings.get('brand')} · pristup`).slice(0, 150), text: String(c.body.text || '').slice(0, 8000) });
    core.history(u.id, `Pristup poslan na e-mail ${to} · ${c.auth.me.username}`);
    return { ok: true };
  });
}
route('POST', 'users/bulk', 'users', (c) => {
  const ids = (c.body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) fail(400, 'Nisi izabrao korisnike.');
  let n = 0;
  for (const id of ids) {
    if (c.body.action === 'extend') core.extendUser(c.auth.me, id, { days: Number(c.body.days) || 30 });
    else if (c.body.action === 'disable') core.setDisabled(c.auth.me, id, true);
    else if (c.body.action === 'enable') core.setDisabled(c.auth.me, id, false);
    else if (c.body.action === 'reset') core.resetTraffic(c.auth.me, id);
    else if (c.body.action === 'delete') core.deleteUser(c.auth.me, id);
    else fail(400, 'Nepoznata akcija.');
    n++;
  }
  return { ok: true, n };
});
route('POST', 'users/delete-expired', 'users', (c) => {
  const t = now(); let n = 0;
  for (const u of all('SELECT * FROM users')) if (vpn.userStatus(u, t) === 'expired') { core.deleteUser(c.auth.me, u.id); n++; }
  return { ok: true, n };
});
route('GET', 'users.csv', 'users', (c) => {
  const rows = listUsers({ query: {} }, c.auth.me).total ? all(`${core.USER_SELECT} ORDER BY u.id`) : [];
  const csv = ['id,korisnik,plan,reseller,status,istice,promet_gb,limit_gb,biljeska,kontakt']
    .concat(rows.map((u) => { const r = core.userRow(u); return [r.id, r.username, r.plan || '', r.owner || '', r.status, new Date(r.expires_at).toISOString().slice(0, 10), (r.traffic_used / core.GB).toFixed(2), (r.traffic_limit / core.GB).toFixed(0), r.note, r.contact].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','); }));
  c.raw(200, csv.join('\n'), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="korisnici.csv"' });
});

// ============================== planovi ==============================
const planOut = (p) => ({ ...p, locations: vpn.planServers(p), trial: !!p.trial, active: !!p.active,
  users: one('SELECT COUNT(*) AS n FROM users WHERE plan_id = ?', p.id).n });
route('GET', 'plans', 'plans', () => all('SELECT * FROM plans ORDER BY sort, id').map(planOut));
function planFields(b) {
  const name = String(b.name || '').trim();
  if (!name) fail(400, 'Upiši ime plana.');
  const days = Number(b.days);
  if (!(days > 0 && days <= 3650)) fail(400, 'Trajanje mora biti između 1 i 3650 dana.');
  return [name, days, Math.max(0, Number(b.traffic_gb) || 0), Math.max(1, Number(b.devices) || 1), Math.max(0, Number(b.price) || 0),
    JSON.stringify((b.locations || []).map(Number).filter(Boolean)), b.trial ? 1 : 0, b.active === false ? 0 : 1, Number(b.sort) || 0];
}
route('POST', 'plans', 'plans', (c) => {
  const r = run('INSERT INTO plans (name, days, traffic_gb, devices, price, locations, trial, active, sort) VALUES (?,?,?,?,?,?,?,?,?)', ...planFields(c.body));
  log(c.auth.me.username, 'Novi plan', c.body.name);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', 'plans/:id', 'plans', (c) => {
  run('UPDATE plans SET name=?, days=?, traffic_gb=?, devices=?, price=?, locations=?, trial=?, active=?, sort=? WHERE id = ?', ...planFields(c.body), Number(c.params.id));
  log(c.auth.me.username, 'Plan izmijenjen', c.body.name);
  return { ok: true };
});
route('DELETE', 'plans/:id', 'plans', (c) => {
  const n = one('SELECT COUNT(*) AS n FROM users WHERE plan_id = ?', Number(c.params.id)).n;
  if (n) fail(400, `Plan koristi ${n} korisnika. Isključi ga umjesto brisanja.`);
  run('DELETE FROM plans WHERE id = ?', Number(c.params.id));
  return { ok: true };
});

// ============================== serveri ==============================
route('GET', 'servers', 'servers', () => {
  const counts = Object.fromEntries(all('SELECT last_server AS id, COUNT(*) AS n FROM users WHERE last_server IS NOT NULL GROUP BY last_server').map((r) => [r.id, r.n]));
  return all('SELECT * FROM servers ORDER BY country, name').map((sv) => ({ ...serverView({ ...sv, users_count: counts[sv.id] || 0 }, false) }));
});
function installCommand(c, sv) {
  const base = (settings.get('panel_url') || `${c.proto}://${c.req.headers.host}`).replace(/\/+$/, '');
  return `curl -fsSL ${base}/install/${sv.token} | sudo bash`;
}
function createPanelServer(b) {
  const name = String(b.name || '').trim();
  if (!name) fail(400, 'Upiši ime servera.');
  const rk = vpn.realityKeys(), wk = vpn.wgKeys();
  const r = run(`INSERT INTO servers (name, city, country, host, token, capacity, provider, cost, vless_port, wg_port, sni, reality_priv, reality_pub, short_id, wg_priv, wg_pub, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  name, String(b.city || ''), String(b.country || '').toUpperCase().slice(0, 2), String(b.host || '').trim(), crypto.randomBytes(18).toString('base64url'),
  Number(b.capacity) || 400, String(b.provider || ''), Number(b.cost) || 0, Number(b.vless_port) || 443, Number(b.wg_port) || 51820,
  String(b.sni || '').trim() || vpn.pickSni(), rk.priv, rk.pub, vpn.shortId(), wk.priv, wk.pub, now());
  return Number(r.lastInsertRowid);
}
route('POST', 'servers', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', createPanelServer(c.body));
  log(c.auth.me.username, 'Novi server', sv.name);
  return { id: sv.id, install: installCommand(c, sv) };
});
// ---------- server u jedan klik kod hostera (Hetzner, DigitalOcean, Vultr, OVH, Contabo)
const cloud = require('./cloud');
const panelPublic = (c) => (settings.get('panel_url') || `${c.proto}://${c.req.headers.host}`).replace(/\/+$/, '');
route('GET', 'cloud', 'servers', () => cloud.list());
route('GET', 'cloud/:p/options', 'servers', async (c) => cloud.options(c.params.p));
route('POST', 'cloud/:p/test', 'servers', async (c) => cloud.test(c.params.p));
route('POST', 'cloud/:p/servers', 'servers', async (c) => cloud.create(c.params.p, c.body, panelPublic(c), createPanelServer, c.auth.me.username));
route('POST', 'servers/:id/new-ip', 'servers', async (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  return cloud.newIp(sv, panelPublic(c), c.auth.me.username);
});
route('GET', 'servers/:id/install', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  return { install: installCommand(c, sv) };
});
route('PUT', 'servers/:id', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  const b = c.body;
  run(`UPDATE servers SET ss_port = ? WHERE id = ?`, Number(b.ss_port ?? sv.ss_port) || 8388, sv.id);
  if (b.tags !== undefined) run('UPDATE servers SET tags = ? WHERE id = ?', (Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).filter((x) => vpn.TAGS.includes(x)).join(','), sv.id);
  if (b.dedicated_users !== undefined) {
    // korisnička imena (zarezom) -> ID-jevi kupaca koji imaju ovaj server kao Dedicated IP
    const names = String(b.dedicated_users).split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const ids = names.map((n) => { const u = one('SELECT id FROM users WHERE username = ?', n); if (!u) fail(400, `Kupac "${n}" ne postoji.`); return u.id; });
    run('UPDATE servers SET dedicated_to = ? WHERE id = ?', [...new Set(ids)].join(','), sv.id);
  }
  run(`UPDATE servers SET name=?, city=?, country=?, host=?, capacity=?, provider=?, cost=?, vless_port=?, wg_port=?, sni=?, lat=?, lon=? WHERE id = ?`,
    String(b.name ?? sv.name), String(b.city ?? sv.city), String(b.country ?? sv.country).toUpperCase().slice(0, 2), String(b.host ?? sv.host).trim(),
    Number(b.capacity ?? sv.capacity), String(b.provider ?? sv.provider), Number(b.cost ?? sv.cost), Number(b.vless_port ?? sv.vless_port),
    Number(b.wg_port ?? sv.wg_port), String(b.sni ?? sv.sni), b.lat ?? sv.lat, b.lon ?? sv.lon, sv.id);
  log(c.auth.me.username, 'Server izmijenjen', sv.name);
  return { ok: true };
});
route('POST', 'servers/:id/toggle', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  run('UPDATE servers SET enabled = ? WHERE id = ?', sv.enabled ? 0 : 1, sv.id);
  log(c.auth.me.username, sv.enabled ? 'Server ugašen' : 'Server upaljen', sv.name, 'warn');
  return { ok: true };
});
route('POST', 'servers/:id/maintenance', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  run('UPDATE servers SET maintenance = ? WHERE id = ?', sv.maintenance ? 0 : 1, sv.id);
  log(c.auth.me.username, sv.maintenance ? 'Održavanje završeno' : 'Server na održavanju', sv.name);
  return { ok: true };
});
// ---------- detalji servera: grafikoni, historija rada, kupci spojeni sada, komande
const SRV_CMDS = ['restart_vpn', 'reboot', 'update_agent', 'speedtest'];
route('GET', 'servers/:id/detail', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  const t = now(), week = c.query.range === '7d';
  const from = t - (week ? 7 : 1) * 86400000, step = week ? 3600000 : 300000;
  const series = all(`SELECT (ts / ${step}) * ${step} AS ts, AVG(cpu) AS cpu, AVG(ram) AS ram, MAX(online) AS online, SUM(traffic) AS traffic
    FROM server_stats WHERE server_id = ? AND ts >= ? GROUP BY ts / ${step} ORDER BY ts`, sv.id, from);
  // historija rada za 30 dana: padovi i ukupno vrijeme bez rada
  const since = t - 30 * 86400000;
  const view = serverView(sv);
  const events = all('SELECT ts, kind, dur FROM server_events WHERE server_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 40', sv.id, since);
  let downMs = all("SELECT dur FROM server_events WHERE server_id = ? AND kind = 'down' AND ts >= ?", sv.id, since).reduce((a, e) => a + (e.dur || 0), 0);
  const open = one("SELECT ts FROM server_events WHERE server_id = ? AND kind = 'down' AND dur = 0 ORDER BY id DESC LIMIT 1", sv.id);
  if (open && view.status === 'offline') downMs += t - open.ts;
  const tracked = Math.max(1, t - Math.max(since, sv.created_at || since));
  const users = all(`SELECT u.id, u.username, u.last_seen, p.name AS plan, (u.traffic_up + u.traffic_down) AS traffic FROM users u LEFT JOIN plans p ON p.id = u.plan_id
    WHERE u.last_server = ? AND u.last_seen > ? ORDER BY u.last_seen DESC LIMIT 200`, sv.id, t - ONLINE_MS);
  const cmds = all('SELECT id, cmd, by, created_at, sent_at, done_at, ok, result FROM server_cmds WHERE server_id = ? ORDER BY id DESC LIMIT 12', sv.id);
  const month = one('SELECT COUNT(*) AS n FROM users WHERE last_server = ? AND last_seen > ?', sv.id, t - 30 * 86400000).n;
  return { server: view, range: week ? '7d' : '24h', step, series, events, uptime: Math.max(0, Math.min(100, 100 - downMs / tracked * 100)), downMs, users, cmds, labels: require('./nodes').CMD_LABEL, users_month: month };
});
route('POST', 'servers/:id/cmd', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  const cmd = String(c.body.cmd || '');
  if (!SRV_CMDS.includes(cmd)) fail(400, 'Nepoznata komanda.');
  if (!sv.last_seen) fail(400, 'Server se još nije javio panelu.');
  if (one('SELECT id FROM server_cmds WHERE server_id = ? AND cmd = ? AND done_at IS NULL AND created_at > ?', sv.id, cmd, now() - 600000)) fail(400, 'Ova komanda već čeka da je server izvrši.');
  const r = run('INSERT INTO server_cmds (server_id, cmd, by, created_at) VALUES (?,?,?,?)', sv.id, cmd, c.auth.me.username, now());
  log(c.auth.me.username, `Komanda serveru: ${require('./nodes').CMD_LABEL[cmd]}`, sv.name, cmd === 'reboot' ? 'warn' : 'info');
  return { id: Number(r.lastInsertRowid) };
});
route('POST', 'servers/:id/locate', 'servers', async (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  const g = await geoIp(sv.host);
  if (!g) fail(400, 'Ne mogu odrediti lokaciju za ovu IP adresu. Upiši grad i državu ručno.');
  run('UPDATE servers SET city = ?, country = ?, lat = ?, lon = ? WHERE id = ?', g.city || sv.city, g.cc, g.lat, g.lon, sv.id);
  return { ok: true, ...g };
});
route('DELETE', 'servers/:id', 'servers', async (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  if (all('SELECT * FROM chains').some((ch) => vpn.chainHops(ch).includes(sv.id))) fail(400, 'Server je dio lanca. Prvo obriši ili izmijeni lanac.');
  if ((c.query.cloud === '1' || c.query.hetzner === '1') && sv.cloud_id) await cloud.destroy(sv, c.auth.me.username);
  run('UPDATE users SET last_server = NULL WHERE last_server = ?', sv.id);
  const used = all('SELECT * FROM chains').filter((c) => vpn.chainHops(c).includes(sv.id));
  if (used.length) fail(400, `Server je dio lanca: ${used.map((c) => c.name).join(', ')}. Prvo obriši ili izmijeni lanac.`);
  run('DELETE FROM servers WHERE id = ?', sv.id);
  for (const tb of ['server_stats', 'server_events', 'server_cmds']) run(`DELETE FROM ${tb} WHERE server_id = ?`, sv.id);
  log(c.auth.me.username, 'Server obrisan', sv.name, 'warn');
  return { ok: true };
});

// ============================== lanci (Double VPN / Multihop) ==============================
function chainView(c) {
  const hops = vpn.chainServers(c);
  return { id: c.id, name: c.name, port: c.port, enabled: !!c.enabled, kind: vpn.chainKind(c), hops: vpn.chainHops(c),
    servers: hops.map((sv) => ({ id: sv.id, name: sv.name, country: sv.country, city: sv.city })), usable: vpn.chainUsable(c, hops) };
}
function chainInput(b, id) {
  const name = String(b.name || '').trim();
  if (!name) fail(400, 'Upiši ime lanca.');
  const hops = (Array.isArray(b.hops) ? b.hops : []).map(Number).filter(Boolean);
  if (hops.length < 2 || hops.length > 4) fail(400, 'Lanac ima 2 do 4 servera (2 = Double VPN, 3 ili 4 = Multihop).');
  if (new Set(hops).size !== hops.length) fail(400, 'Isti server ne može biti dva puta u lancu.');
  const servers = Object.fromEntries(all('SELECT * FROM servers').map((sv) => [sv.id, sv]));
  if (hops.some((h) => !servers[h])) fail(400, 'Izabrani server ne postoji.');
  const port = Number(b.port) || 0;
  if (port < 1024 || port > 65535) fail(400, 'Port lanca mora biti između 1024 i 65535.');
  for (const h of hops.slice(0, -1)) {
    const sv = servers[h];
    if ([sv.vless_port, sv.ss_port || 8388, 10085].includes(port)) fail(400, `Port ${port} već koristi server ${sv.name}. Izaberi drugi.`);
  }
  for (const c of all('SELECT * FROM chains WHERE id != ?', id || 0)) {
    if (c.port === port && vpn.chainHops(c).slice(0, -1).some((h) => hops.slice(0, -1).includes(h))) fail(400, `Port ${port} već koristi lanac ${c.name}.`);
  }
  return { name, hops: JSON.stringify(hops), port };
}
route('GET', 'chains', 'servers', () => all('SELECT * FROM chains ORDER BY id').map(chainView));
route('POST', 'chains', 'servers', (c) => {
  const v = chainInput(c.body);
  const r = run('INSERT INTO chains (name, hops, port, secret, enabled, created_at) VALUES (?,?,?,?,1,?)', v.name, v.hops, v.port, crypto.randomBytes(24).toString('base64url'), now());
  log(c.auth.me.username, 'Novi lanac servera', v.name);
  return chainView(one('SELECT * FROM chains WHERE id = ?', Number(r.lastInsertRowid)));
});
route('PUT', 'chains/:id', 'servers', (c) => {
  const ch = one('SELECT * FROM chains WHERE id = ?', Number(c.params.id));
  if (!ch) fail(404, 'Lanac ne postoji.');
  if (c.body.enabled !== undefined && Object.keys(c.body).length === 1) {
    run('UPDATE chains SET enabled = ? WHERE id = ?', c.body.enabled ? 1 : 0, ch.id);
  } else {
    const v = chainInput(c.body, ch.id);
    run('UPDATE chains SET name = ?, hops = ?, port = ? WHERE id = ?', v.name, v.hops, v.port, ch.id);
  }
  log(c.auth.me.username, 'Lanac izmijenjen', ch.name);
  return chainView(one('SELECT * FROM chains WHERE id = ?', ch.id));
});
route('DELETE', 'chains/:id', 'servers', (c) => {
  const ch = one('SELECT * FROM chains WHERE id = ?', Number(c.params.id));
  if (!ch) fail(404, 'Lanac ne postoji.');
  run('DELETE FROM chains WHERE id = ?', ch.id);
  log(c.auth.me.username, 'Lanac obrisan', ch.name, 'warn');
  return { ok: true };
});

// ============================== reselleri i nivoi ==============================
route('GET', 'levels', 'resellers', () => all('SELECT l.*, (SELECT COUNT(*) FROM admins a WHERE a.level_id = l.id) AS count FROM levels l ORDER BY sort, discount'));
route('POST', 'levels', 'resellers', (c) => {
  const b = c.body;
  const r = run('INSERT INTO levels (name, discount, min_monthly, max_users, sort) VALUES (?,?,?,?,?)', String(b.name || 'Nivo'), Math.min(0.9, Math.max(0, Number(b.discount) || 0)), Number(b.min_monthly) || 0, Number(b.max_users) || 150, Number(b.sort) || 0);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', 'levels/:id', 'resellers', (c) => {
  const b = c.body;
  run('UPDATE levels SET name=?, discount=?, min_monthly=?, max_users=?, sort=? WHERE id = ?', String(b.name), Math.min(0.9, Math.max(0, Number(b.discount) || 0)), Number(b.min_monthly) || 0, Number(b.max_users) || 150, Number(b.sort) || 0, Number(c.params.id));
  return { ok: true };
});
route('DELETE', 'levels/:id', 'resellers', (c) => {
  if (one('SELECT COUNT(*) AS n FROM admins WHERE level_id = ?', Number(c.params.id)).n) fail(400, 'Neki reselleri su na ovom nivou.');
  run('DELETE FROM levels WHERE id = ?', Number(c.params.id));
  return { ok: true };
});

route('GET', 'resellers', 'resellers', () => {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  return all(`SELECT a.id, a.username, a.credit, a.level_id, l.name AS level, l.discount, a.user_limit, a.contact, a.email, a.brand, a.brand_color, (a.brand_logo != '') AS has_logo, a.note, a.disabled, a.pending, a.created_at, a.last_login,
      (SELECT COUNT(*) FROM users u WHERE u.owner_id = a.id) AS users,
      (SELECT COALESCE(SUM(amount),0) FROM transactions x WHERE x.reseller_id = a.id AND x.type = 'topup' AND x.ts >= ?) AS month
    FROM admins a LEFT JOIN levels l ON l.id = a.level_id WHERE a.role = 'reseller' ORDER BY a.pending DESC, month DESC, a.username`, monthStart);
});
route('POST', 'resellers', 'resellers', (c) => {
  const b = c.body;
  const username = String(b.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) fail(400, 'Korisničko ime: 3–30 znakova.');
  if (one('SELECT id FROM admins WHERE username = ?', username)) fail(400, 'Ime je zauzeto.');
  if (!auth.validPassword(b.password)) fail(400, 'Šifra mora imati bar 8 znakova.');
  const lvl = b.level_id ? one('SELECT * FROM levels WHERE id = ?', Number(b.level_id)) : null;
  const r = run(`INSERT INTO admins (username, pass_hash, role, level_id, user_limit, contact, email, brand, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    username, auth.hashPassword(b.password), 'reseller', lvl?.id || null, Number(b.user_limit) || lvl?.max_users || 150, String(b.contact || ''), core.cleanEmail(b.email), String(b.brand || ''), String(b.note || ''), now());
  log(c.auth.me.username, 'Novi reseller', username);
  const id = Number(r.lastInsertRowid);
  const nr = one('SELECT * FROM admins WHERE id = ?', id);
  const mailed = !!(nr.email && b.send_mail !== false && mail.configured() && settings.get('mail_resellers') !== false);
  if (mailed) require('./resmail').welcome(nr, b.mail_password ? b.password : '', `${c.proto}://${c.req.headers.host}`);
  return { id, mailed };
});
route('PUT', 'resellers/:id', 'resellers', (c) => {
  const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", Number(c.params.id));
  if (!r) fail(404, 'Reseller ne postoji.');
  const b = c.body;
  run('UPDATE admins SET level_id = ?, user_limit = ?, contact = ?, email = ?, brand = ?, note = ? WHERE id = ?',
    b.level_id ? Number(b.level_id) : null, Number(b.user_limit ?? r.user_limit), String(b.contact ?? r.contact), b.email !== undefined ? core.cleanEmail(b.email) : (r.email || ''), String(b.brand ?? r.brand), String(b.note ?? r.note), r.id);
  if (b.password) {
    if (!auth.validPassword(b.password)) fail(400, 'Šifra mora imati bar 8 znakova.');
    run('UPDATE admins SET pass_hash = ? WHERE id = ?', auth.hashPassword(b.password), r.id);
    run('DELETE FROM sessions WHERE admin_id = ?', r.id);
  }
  if (b.brand_logo === '') run("UPDATE admins SET brand_logo = '' WHERE id = ?", r.id);
  log(c.auth.me.username, 'Reseller izmijenjen', r.username);
  return { ok: true };
});
route('POST', 'resellers/:id/approve', 'resellers', (c) => {
  const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", Number(c.params.id));
  if (!r) fail(404, 'Reseller ne postoji.');
  run('UPDATE admins SET pending = 0, disabled = 0 WHERE id = ?', r.id);
  log(c.auth.me.username, 'Reseller odobren', r.username);
  if (r.email) require('./resmail').approved(one('SELECT * FROM admins WHERE id = ?', r.id), `${c.proto}://${c.req.headers.host}`);
  return { ok: true };
});
route('POST', 'res/stripe', 'res', async (c) => {
  const s = settings.load();
  const base = `${(s.panel_url || `${c.proto}://${c.req.headers.host}`).replace(/\/+$/, '')}${c.portal === 'reseller' ? s.reseller_path : s.admin_path}/`;
  return stripe.createCheckout(c.auth.me, c.body.amount, base);
});
route('POST', 'resellers/:id/credit', 'finance', (c) => ({ id: core.addCredit(c.auth.me, c.params.id, c.body) }));
route('POST', 'resellers/:id/toggle', 'resellers', (c) => {
  const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", Number(c.params.id));
  if (!r) fail(404, 'Reseller ne postoji.');
  run('UPDATE admins SET disabled = ? WHERE id = ?', r.disabled ? 0 : 1, r.id);
  if (!r.disabled) {
    run('DELETE FROM sessions WHERE admin_id = ?', r.id);
    if (c.body.users) run('UPDATE users SET disabled = 1 WHERE owner_id = ?', r.id);
  }
  log(c.auth.me.username, r.disabled ? 'Reseller odblokiran' : 'Reseller blokiran', r.username, 'warn');
  return { ok: true };
});
route('DELETE', 'resellers/:id', 'resellers', (c) => {
  const n = one('SELECT COUNT(*) AS n FROM users WHERE owner_id = ?', Number(c.params.id)).n;
  if (n) fail(400, `Reseller ima ${n} korisnika. Prvo ih prebaci ili obriši, ili ga samo blokiraj.`);
  run("DELETE FROM admins WHERE id = ? AND role = 'reseller'", Number(c.params.id));
  return { ok: true };
});
route('POST', 'resellers/:id/impersonate', 'resellers', (c) => {
  const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", Number(c.params.id));
  if (!r) fail(404, 'Reseller ne postoji.');
  run('UPDATE sessions SET as_id = ? WHERE token = ?', r.id, c.auth.session.token);
  log(c.auth.admin.username, 'Ušao kao reseller', r.username);
  return { ok: true };
});
route('POST', 'impersonate/stop', null, (c) => {
  run('UPDATE sessions SET as_id = NULL WHERE token = ?', c.auth.session.token);
  return { ok: true };
});

// ============================== finansije ==============================
route('GET', 'transactions', 'finance', (c) => {
  const q = c.query, where = [], args = [];
  if (q.type) { where.push('t.type = ?'); args.push(q.type); }
  if (q.reseller) { where.push('t.reseller_id = ?'); args.push(Number(q.reseller)); }
  if (q.from) { where.push('t.ts >= ?'); args.push(Number(q.from)); }
  return all(`SELECT t.*, a.username AS reseller, u.username AS user FROM transactions t LEFT JOIN admins a ON a.id = t.reseller_id LEFT JOIN users u ON u.id = t.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 500`, ...args);
});
// ---------- vlastiti brend resellera
const brandOut = (a) => ({ on: !!settings.get('res_whitelabel'), brand: a.brand || '', contact: a.contact || '', color: a.brand_color || '', logo: a.brand_logo || '', welcome: a.brand_welcome || '', hide_app: !!a.brand_hide_app, default_brand: settings.get('brand') });
function cleanLogo(v) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  if (!m) fail(400, 'Logo mora biti PNG, JPG ili WEBP slika.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 120 * 1024) fail(400, 'Logo je prevelik (najviše 120 KB).');
  const sig = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
  if (!sig.every((b, i) => buf[i] === b)) fail(400, 'Fajl nije ispravna slika.');
  return `data:image/${m[1]};base64,${buf.toString('base64')}`;
}
route('GET', 'res/brand', 'res', (c) => brandOut(one('SELECT * FROM admins WHERE id = ?', c.auth.me.id)));
route('PUT', 'res/brand', 'res', (c) => {
  const b = c.body, me = one('SELECT * FROM admins WHERE id = ?', c.auth.me.id);
  const name = String(b.brand ?? me.brand).trim().slice(0, 40);
  const color = String(b.color ?? me.brand_color ?? '').trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) fail(400, 'Boja mora biti u obliku #RRGGBB.');
  const logo = b.logo === undefined ? me.brand_logo : b.logo ? cleanLogo(b.logo) : '';
  run('UPDATE admins SET brand = ?, contact = ?, brand_color = ?, brand_logo = ?, brand_welcome = ?, brand_hide_app = ? WHERE id = ?',
    name, String(b.contact ?? me.contact).trim().slice(0, 80), color.toLowerCase(), logo, String(b.welcome ?? me.brand_welcome ?? '').trim().slice(0, 300), b.hide_app === undefined ? me.brand_hide_app : (b.hide_app ? 1 : 0), me.id);
  log(me.username, 'Brend izmijenjen', name || '(bez imena)');
  return brandOut(one('SELECT * FROM admins WHERE id = ?', me.id));
});
route('GET', 'res/transactions', 'res', (c) => all('SELECT t.*, u.username AS user FROM transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.reseller_id = ? ORDER BY t.id DESC LIMIT 300', c.auth.me.id));
route('POST', 'transactions', 'finance', (c) => {
  const b = c.body;
  const type = ['sale', 'expense'].includes(b.type) ? b.type : fail(400, 'Vrsta mora biti prodaja ili trošak.');
  const amount = Math.abs(Number(b.amount) || 0);
  if (!amount) fail(400, 'Upiši iznos.');
  run('INSERT INTO transactions (ts, type, amount, actor, method, note) VALUES (?,?,?,?,?,?)', b.ts ? Number(b.ts) : now(), type, type === 'expense' ? -amount : amount, c.auth.me.username, String(b.method || ''), String(b.note || ''));
  log(c.auth.me.username, type === 'expense' ? 'Trošak upisan' : 'Prodaja upisana', `€${amount} ${b.note || ''}`);
  return { ok: true };
});
route('DELETE', 'transactions/:id', 'owner', (c) => {
  const t = one('SELECT * FROM transactions WHERE id = ?', Number(c.params.id));
  if (!t) fail(404, 'Ne postoji.');
  if (t.credit_delta && t.reseller_id) run('UPDATE admins SET credit = credit - ? WHERE id = ?', t.credit_delta, t.reseller_id);
  run('DELETE FROM transactions WHERE id = ?', t.id);
  log(c.auth.me.username, 'Transakcija obrisana', `#${t.id} €${t.amount}`, 'warn');
  return { ok: true };
});
route('GET', 'reports', 'finance', (c) => {
  const year = Number(c.query.year) || new Date().getFullYear();
  const months = [];
  for (let m = 0; m < 12; m++) {
    const a = new Date(year, m, 1).getTime(), b = new Date(year, m + 1, 1).getTime();
    const inc = one("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE ts >= ? AND ts < ? AND type IN ('topup','sale')", a, b).s;
    const exp = one("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE ts >= ? AND ts < ? AND type = 'expense'", a, b).s;
    months.push({ month: m + 1, income: core.round2(inc), expense: core.round2(-exp) });
  }
  const yA = new Date(year, 0, 1).getTime(), yB = new Date(year + 1, 0, 1).getTime();
  const byReseller = all("SELECT a.username, COALESCE(SUM(t.amount),0) AS total FROM transactions t JOIN admins a ON a.id = t.reseller_id WHERE t.type = 'topup' AND t.ts >= ? AND t.ts < ? GROUP BY a.id ORDER BY total DESC", yA, yB);
  const direct = one("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type = 'sale' AND ts >= ? AND ts < ?", yA, yB).s;
  const credit = one("SELECT COALESCE(SUM(credit),0) AS s, COUNT(*) AS n FROM admins WHERE role = 'reseller' AND credit > 0");
  const serverCost = one('SELECT COALESCE(SUM(cost),0) AS s FROM servers WHERE enabled = 1').s;
  return { year, months, byReseller, direct: core.round2(direct), unusedCredit: core.round2(credit.s), unusedCreditCount: credit.n, serverCost };
});
route('GET', 'invoice/:id', 'any', (c) => {
  const t = one(core.INVOICE_SELECT, Number(c.params.id));
  if (!t || (isRes(c.auth.me) && t.reseller_id !== c.auth.me.id) || !(t.amount > 0)) fail(404, 'Faktura ne postoji.');
  const html = core.invoiceHtml(t);
  c.raw(200, html, { 'content-type': 'text/html; charset=utf-8' });
});

// ============================== logovi ==============================
route('GET', 'logs', 'logs', (c) => {
  const q = c.query, where = [], args = [];
  if (q.q) { where.push('(action LIKE ? OR detail LIKE ? OR actor LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.kind) { where.push('kind = ?'); args.push(q.kind); }
  return all(`SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, ...args);
});

// ============================== postavke ==============================
route('GET', 'settings', 'settings', () => ({ schema: settings.publicSchema(), values: settings.forClient() }));
route('PUT', 'settings', 'settings', (c) => {
  const patch = { ...c.body };
  const secKeys = ['admin_path', 'require_2fa', 'ip_whitelist_on', 'ip_whitelist'];
  if (c.auth.admin.role !== 'owner') for (const k of secKeys) delete patch[k];
  if (patch.ip_whitelist_on && !auth.ipAllowed.call(null, c.ip)) {
    // provjeri sa novom listom prije uključivanja
    const old = settings.load();
    settings.set({ ip_whitelist: patch.ip_whitelist ?? old.ip_whitelist, ip_whitelist_on: true });
    const ok = auth.ipAllowed(c.ip);
    settings.set({ ip_whitelist_on: old.ip_whitelist_on });
    if (!ok) fail(400, `Tvoja trenutna IP (${c.ip}) nije na listi. Dodaj je prije uključivanja.`);
  }
  const changed = settings.set(patch);
  log(c.auth.admin.username, 'Postavke spremljene', changed.join(', '));
  return { ok: true, changed, admin_path: settings.get('admin_path') };
});
// ============================== dijagnostika kupca ==============================
route('GET', 'diag/:id', 'users', async (c) => require('./diag').check(c.params.id));

// ============================== aplikacija (prekidači za AdiLink aplikacije) ==============================
route('GET', 'appctl', 'settings', async () => {
  const sec = settings.publicSchema().find((x) => x.id === 'aplikacija');
  const extra = settings.publicSchema().flatMap((x) => x.rows).filter((r) => ['sub_announce', 'support_contact', 'proto_ss', 'stripe_on'].includes(r.key));
  const v = settings.forClient();
  const t = now(), week = t - 7 * 86400000;
  const rows = all('SELECT app_os, app_build, COUNT(*) AS n FROM users WHERE app_seen > ? GROUP BY app_os, app_build ORDER BY app_build DESC', week);
  const dl = await require('./site').downloads().catch(() => ({}));
  const keys = [...sec.rows.map((r) => r.key), ...extra.map((r) => r.key)];
  return {
    rows: sec.rows, extra, values: Object.fromEntries(keys.map((k) => [k, v[k]])),
    usage: {
      android: rows.filter((r) => r.app_os === 'android').reduce((a, r) => a + r.n, 0),
      windows: rows.filter((r) => r.app_os === 'windows').reduce((a, r) => a + r.n, 0),
      builds: rows.map((r) => ({ os: r.app_os, build: r.app_build, n: r.n })),
      other: one('SELECT COUNT(*) AS n FROM users WHERE last_seen > ? AND (app_seen IS NULL OR app_seen < ?)', week, week).n,
    },
    latest: { android: dl.apkBuild || 0, windows: dl.exeBuild || 0, android_ts: dl.apkTs || 0, windows_ts: dl.exeTs || 0, page: dl.page || '' },
    stripe: !!(settings.get('stripe_on') && settings.get('stripe_secret')),
    trial_plan: !!one('SELECT id FROM plans WHERE active = 1 AND trial = 1'),
  };
});

route('POST', 'settings/test-paypal', 'settings', async () => {
  try { return await require('./paypal').test(); } catch (e) { fail(400, e.message); }
});
route('POST', 'settings/test-telegram', 'settings', async () => {
  const r = await telegram('Probna poruka iz panela. Obavještenja rade. ✅');
  if (!r.ok) fail(400, `Telegram: ${r.error}`);
  return { ok: true };
});

// ============================== admini i sesije ==============================
route('GET', 'admins', 'owner', () => all("SELECT id, username, role, totp_on, disabled, last_login, created_at FROM admins WHERE role != 'reseller' ORDER BY id"));
route('POST', 'admins', 'owner', (c) => {
  const b = c.body;
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(b.username || '')) fail(400, 'Korisničko ime: 3–30 znakova.');
  if (one('SELECT id FROM admins WHERE username = ?', b.username)) fail(400, 'Ime je zauzeto.');
  if (!['admin', 'support', 'finance'].includes(b.role)) fail(400, 'Uloga mora biti admin, podrška ili finansije.');
  if (!auth.validPassword(b.password)) fail(400, 'Šifra mora imati bar 8 znakova.');
  run('INSERT INTO admins (username, pass_hash, role, created_at) VALUES (?,?,?,?)', b.username, auth.hashPassword(b.password), b.role, now());
  log(c.auth.admin.username, 'Novi admin', `${b.username} (${b.role})`);
  return { ok: true };
});
route('PUT', 'admins/:id', 'owner', (c) => {
  const a = one("SELECT * FROM admins WHERE id = ? AND role != 'reseller'", Number(c.params.id));
  if (!a || a.role === 'owner') fail(400, 'Vlasnički nalog se ne mijenja ovdje.');
  if (c.body.role && ['admin', 'support', 'finance'].includes(c.body.role)) run('UPDATE admins SET role = ? WHERE id = ?', c.body.role, a.id);
  if (c.body.disabled !== undefined) { run('UPDATE admins SET disabled = ? WHERE id = ?', c.body.disabled ? 1 : 0, a.id); run('DELETE FROM sessions WHERE admin_id = ?', a.id); }
  if (c.body.password) { if (!auth.validPassword(c.body.password)) fail(400, 'Šifra: bar 8 znakova.'); run('UPDATE admins SET pass_hash = ? WHERE id = ?', auth.hashPassword(c.body.password), a.id); }
  if (c.body.reset2fa) run('UPDATE admins SET totp_on = 0, totp_secret = NULL WHERE id = ?', a.id);
  log(c.auth.admin.username, 'Admin izmijenjen', a.username);
  return { ok: true };
});
route('DELETE', 'admins/:id', 'owner', (c) => {
  const a = one("SELECT * FROM admins WHERE id = ? AND role NOT IN ('owner','reseller')", Number(c.params.id));
  if (!a) fail(400, 'Ne može se obrisati.');
  run('DELETE FROM sessions WHERE admin_id = ?', a.id);
  run('DELETE FROM admins WHERE id = ?', a.id);
  log(c.auth.admin.username, 'Admin obrisan', a.username, 'warn');
  return { ok: true };
});
route('GET', 'sessions', null, (c) => all('SELECT token, ip, ua, created, last_active FROM sessions WHERE admin_id = ? ORDER BY last_active DESC', c.auth.admin.id)
  .map((s) => ({ id: crypto.createHash('sha256').update(s.token).digest('hex').slice(0, 12), current: s.token === c.auth.session.token, ip: s.ip, ua: s.ua, created: s.created, last_active: s.last_active })));
route('DELETE', 'sessions/:id', null, (c) => {
  for (const s of all('SELECT token FROM sessions WHERE admin_id = ?', c.auth.admin.id)) {
    if (crypto.createHash('sha256').update(s.token).digest('hex').slice(0, 12) === c.params.id) run('DELETE FROM sessions WHERE token = ?', s.token);
  }
  return { ok: true };
});

// ============================== API ključevi ==============================
route('GET', 'apikeys', 'settings', () => all('SELECT id, name, prefix, created, last_used FROM api_keys ORDER BY id'));
route('POST', 'apikeys', 'settings', (c) => {
  const key = 'vnx_' + crypto.randomBytes(24).toString('base64url');
  run('INSERT INTO api_keys (name, key_hash, prefix, created) VALUES (?,?,?,?)', String(c.body.name || 'Ključ').slice(0, 60), crypto.createHash('sha256').update(key).digest('hex'), key.slice(0, 10), now());
  log(c.auth.admin.username, 'Novi API ključ', c.body.name || '');
  return { key };
});
route('DELETE', 'apikeys/:id', 'settings', (c) => { run('DELETE FROM api_keys WHERE id = ?', Number(c.params.id)); return { ok: true }; });

// ============================== backup i sistem ==============================
route('GET', 'backups', 'backup', () => backup.list());
route('POST', 'backups', 'backup', async (c) => { const f = await backup.make(c.auth.admin.username, true); return { ok: true, name: path.basename(f) }; });
route('GET', 'backups/:name', 'backup', (c) => {
  const f = backup.file(c.params.name);
  if (!f) fail(404, 'Backup ne postoji.');
  c.raw(200, fs.readFileSync(f), { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${path.basename(f)}"` });
});
route('POST', 'backups/restore', 'owner', async (c) => {
  const buf = await readBody(c.req, 512 << 20, true);
  if (buf.subarray(0, 16).toString() !== 'SQLite format 3\0') fail(400, 'Fajl nije backup baze panela.');
  fs.writeFileSync(path.join(DATA_DIR, 'restore.db'), buf);
  log(c.auth.admin.username, 'Vraćanje iz backupa', `${(buf.length / 1048576).toFixed(1)} MB · panel se restartuje`, 'warn');
  setTimeout(() => process.exit(0), 500);
  return { ok: true };
}, true);
route('POST', 'settings/test-mail', 'settings', async (c) => {
  const s = settings.load();
  const to = String(c.body.to || '').trim() || (s.smtp_from.match(/<([^>]+)>/)?.[1] || s.smtp_from);
  // probni e-mail izgleda isto kao pristup koji dobije kupac (primjer kupca)
  const plan = one('SELECT id FROM plans WHERE active = 1 AND trial = 0 ORDER BY sort, id LIMIT 1');
  const m = require('./welcome').build({ username: 'primjer_kupca', plan_id: plan?.id || null, owner_id: null, expires_at: now() + 30 * 86400000, sub_token: 'PRIMJER' }, 'new', `${c.proto}://${c.req.headers.host}`);
  await mail.sendMail({ to, subject: `${s.brand}: probni e-mail (ovako kupac dobije pristup)`, text: 'E-mail iz panela radi. ✅\n\n' + (m?.text || ''), html: m?.html });
  return { ok: true, to };
});
route('POST', 'settings/test-cbot', 'settings', async () => {
  const r = await cbot.call('getMe');
  if (!r.ok) fail(400, `Bot ne radi: ${r.description || 'provjeri token'}`);
  return { ok: true, username: r.result.username };
});
route('POST', 'settings/test-s3', 'settings', async () => {
  await s3.put(`vpn-panel/test-${Date.now()}.txt`, Buffer.from('AdiLink panel test'), 'text/plain');
  return { ok: true };
});
route('GET', 'system/update', 'owner', async () => {
  const repo = String(settings.get('update_repo') || '').trim();
  let latest = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/panel/package.json?ref=main`, { headers: require('./site').ghHeaders('application/vnd.github.raw+json'), signal: AbortSignal.timeout(10000) });
    if (r.ok) latest = JSON.parse(await r.text()).version;
  } catch { /* nema veze */ }
  const fsx = require('node:fs');
  const ready = fsx.existsSync('/etc/systemd/system/vpn-panel-update.path');
  return { current: VERSION, latest, repo, ready, pending: fsx.existsSync(require('node:path').join(require('./db').DATA_DIR, 'update.request')) };
});
route('POST', 'system/update', 'owner', (c) => {
  const fsx = require('node:fs');
  if (!fsx.existsSync('/etc/systemd/system/vpn-panel-update.path')) fail(400, 'Ažuriranje iz panela još nije podešeno. Jednom ažuriraj ručno komandom iz README-a.');
  // repozitorij u 1. redu, token (za privatni repozitorij) u 2.; fajl čita samo root servis za ažuriranje
  fsx.writeFileSync(require('node:path').join(require('./db').DATA_DIR, 'update.request'), `${String(settings.get('update_repo') || 'maid-cyber/vpn-panel')}\n${String(settings.get('gh_token') || '').trim()}\n`, { mode: 0o600 });
  log(c.auth.admin.username, 'Pokrenuto ažuriranje panela', settings.get('update_repo'), 'warn');
  return { ok: true };
});
route('GET', 'system', 'settings', () => {
  const st = fs.statSync(require('./db').DB_FILE);
  return {
    version: VERSION, node: process.version, uptime: Math.round(process.uptime()), db_size: st.size,
    users: one('SELECT COUNT(*) AS n FROM users').n, servers: one('SELECT COUNT(*) AS n FROM servers').n,
    servers_online: serversList(false).filter((s) => s.status === 'online').length, memory: process.memoryUsage().rss,
    admin_path: settings.get('admin_path'),
  };
});
route('POST', 'system/restart', 'owner', (c) => {
  log(c.auth.admin.username, 'Panel restartovan', '', 'warn');
  setTimeout(() => process.exit(0), 400);
  return { ok: true };
});
route('GET', 'export.json', 'owner', (c) => {
  const data = {
    exported: new Date().toISOString(), version: VERSION,
    plans: all('SELECT * FROM plans'), levels: all('SELECT * FROM levels'),
    resellers: all("SELECT id, username, credit, level_id, user_limit, contact, brand, note, created_at FROM admins WHERE role = 'reseller'"),
    users: all('SELECT id, username, plan_id, owner_id, disabled, expires_at, traffic_limit, traffic_up, traffic_down, devices, note, contact, created_at FROM users'),
    transactions: all('SELECT * FROM transactions'),
  };
  c.raw(200, JSON.stringify(data, null, 1), { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="izvoz.json"' });
});

// ============================== uživo (SSE) ==============================
route('GET', 'live', 'any', (c) => {
  const res = c.res;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const push = () => {
    const forRes = isRes(c.auth.me);
    const servers = serversList(forRes).map((s) => ({ id: s.id, name: s.name, city: s.city, country: s.country, lat: s.lat, lon: s.lon, status: s.status, warn: s.warn, online: forRes ? undefined : s.online, cpu: forRes ? undefined : s.cpu, ram: forRes ? undefined : s.ram, net: forRes ? undefined : s.net }));
    res.write(`data: ${JSON.stringify({ t: now(), servers, flows: forRes ? undefined : require('./nodes').liveFlows() })}\n\n`);
  };
  push();
  const iv = setInterval(push, 5000);
  c.req.on('close', () => clearInterval(iv));
  c.keepOpen = true;
});

// ============================== usmjeravanje ==============================
async function handle(c, sub) {
  for (const r of routes) {
    if (r.method !== c.req.method) continue;
    const m = sub.match(r.re);
    if (!m) continue;
    c.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (r.perm !== 'public') {
      if (!c.auth) fail(401, 'Prijavi se.');
      const { admin, me } = c.auth;
      const s = settings.load();
      if ((c.portal === 'reseller' && admin.role !== 'reseller') || (c.portal === 'admin' && admin.role === 'reseller' && s.res_portal)) fail(401, 'Prijavi se.');
      const must2fa = s.require_2fa && !admin.totp_on && admin.role !== 'reseller';
      if (must2fa && !['me', 'logout', '2fa/setup', '2fa/enable'].includes(sub)) fail(403, 'Prvo uključi 2FA (obavezno u postavkama).');
      if (s.maintenance && me.role === 'reseller' && !c.auth.impersonating) fail(503, s.maintenance_msg);
      if (!allowed(me, r.perm, r.method)) fail(403, 'Nemaš dozvolu za ovo.');
    }
    if (!r.rawBody && ['POST', 'PUT', 'DELETE'].includes(c.req.method)) c.body = await readBody(c.req);
    else c.body = c.body || {};
    const out = await r.fn(c);
    if (c.keepOpen || c.res.headersSent) return;
    send(c.res, 200, out ?? { ok: true });
    return;
  }
  fail(404, 'Nepoznata akcija.');
}
// rawBody za restore (zadnji argument route)
for (const r of routes) if (r.fn.length === 1 && (r.re.source.includes('backups\\/restore') || r.re.source.includes('import\\/preview'))) r.rawBody = true;

module.exports = { handle, serverView, VERSION };
