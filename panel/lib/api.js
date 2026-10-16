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
    synced: !!sv.applied_hash,
  };
}
function serversList(forReseller) {
  const rows = all('SELECT * FROM servers ORDER BY country, name');
  return rows.map((sv) => serverView(sv, forReseller));
}

function revenueSeries(days) {
  const tz = settings.get('timezone');
  const from = now() - days * 86400000;
  const map = new Map();
  for (let i = days - 1; i >= 0; i--) map.set(dayKey(now() - i * 86400000, tz), { rev: 0, traffic: 0 });
  for (const t of all("SELECT ts, amount FROM transactions WHERE ts >= ? AND type IN ('topup','sale')", from)) {
    const d = map.get(dayKey(t.ts, tz)); if (d) d.rev += t.amount;
  }
  for (const r of all('SELECT day, traffic FROM daily WHERE day >= ?', dayKey(from, tz))) { const d = map.get(r.day); if (d) d.traffic = r.traffic; }
  return [...map.entries()].map(([day, v]) => ({ day, rev: core.round2(v.rev), traffic: v.traffic }));
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
    servers, series, days,
    countries: countries.slice(0, 5).map((r) => ({ cc: r.cc, pct: ctotal ? Math.round(r.n / ctotal * 100) : 0 })),
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
  const counts = { all: rows.length, active: 0, expiring: 0, grace: 0, expired: 0, limited: 0, disabled: 0, devices: 0 };
  for (const u of rows) counts[u.status]++;
  if (q.status && q.status !== 'all') rows = rows.filter((u) => (q.status === 'active' ? ['active', 'expiring', 'grace'].includes(u.status) : u.status === q.status));
  const per = 50, page = Math.max(1, Number(q.page) || 1);
  return { counts, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / per)), users: rows.slice((page - 1) * per, page * per) };
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
    history: all('SELECT ts, text FROM user_history WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id),
  };
}
route('GET', 'users/suggest', 'users', () => ({ username: core.suggestUsername() }));
route('GET', 'res/users/suggest', 'res', () => ({ username: core.suggestUsername() }));
route('GET', 'users/:id', 'users', (c) => userDetail(c, c.auth.me));
route('GET', 'res/users/:id', 'res', (c) => userDetail(c, c.auth.me));

const createH = (c) => ({ id: core.createUser(c.auth.me, c.body) });
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
  route('POST', `${pre}users/:id/rekey`, perm, (c) => { core.rekey(c.auth.me, c.params.id); return { ok: true }; });
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
route('POST', 'servers', 'servers', (c) => {
  const b = c.body;
  const name = String(b.name || '').trim();
  if (!name) fail(400, 'Upiši ime servera.');
  const rk = vpn.realityKeys(), wk = vpn.wgKeys();
  const r = run(`INSERT INTO servers (name, city, country, host, token, capacity, provider, cost, vless_port, wg_port, sni, reality_priv, reality_pub, short_id, wg_priv, wg_pub, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  name, String(b.city || ''), String(b.country || '').toUpperCase().slice(0, 2), String(b.host || '').trim(), crypto.randomBytes(18).toString('base64url'),
  Number(b.capacity) || 400, String(b.provider || ''), Number(b.cost) || 0, Number(b.vless_port) || 443, Number(b.wg_port) || 51820,
  String(b.sni || '').trim() || vpn.pickSni(), rk.priv, rk.pub, vpn.shortId(), wk.priv, wk.pub, now());
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(r.lastInsertRowid));
  log(c.auth.me.username, 'Novi server', name);
  return { id: sv.id, install: installCommand(c, sv) };
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
route('POST', 'servers/:id/locate', 'servers', async (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  const g = await geoIp(sv.host);
  if (!g) fail(400, 'Ne mogu odrediti lokaciju za ovu IP adresu. Upiši grad i državu ručno.');
  run('UPDATE servers SET city = ?, country = ?, lat = ?, lon = ? WHERE id = ?', g.city || sv.city, g.cc, g.lat, g.lon, sv.id);
  return { ok: true, ...g };
});
route('DELETE', 'servers/:id', 'servers', (c) => {
  const sv = one('SELECT * FROM servers WHERE id = ?', Number(c.params.id));
  if (!sv) fail(404, 'Server ne postoji.');
  run('UPDATE users SET last_server = NULL WHERE last_server = ?', sv.id);
  run('DELETE FROM servers WHERE id = ?', sv.id);
  log(c.auth.me.username, 'Server obrisan', sv.name, 'warn');
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
  return all(`SELECT a.id, a.username, a.credit, a.level_id, l.name AS level, l.discount, a.user_limit, a.contact, a.email, a.brand, a.note, a.disabled, a.pending, a.created_at, a.last_login,
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
  return { id: Number(r.lastInsertRowid) };
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
  log(c.auth.me.username, 'Reseller izmijenjen', r.username);
  return { ok: true };
});
route('POST', 'resellers/:id/approve', 'resellers', (c) => {
  const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", Number(c.params.id));
  if (!r) fail(404, 'Reseller ne postoji.');
  run('UPDATE admins SET pending = 0, disabled = 0 WHERE id = ?', r.id);
  log(c.auth.me.username, 'Reseller odobren', r.username);
  if (r.email && mail.configured()) {
    const s = settings.load();
    const url = `${(s.panel_url || `${c.proto}://${c.req.headers.host}`).replace(/\/+$/, '')}${s.reseller_path}/`;
    mail.sendMail({ to: r.email, subject: `${s.brand}: nalog odobren`, text: `Zdravo ${r.username}, tvoj reseller nalog je odobren.\nPrijava: ${url}` }).catch(() => {});
  }
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
  await mail.sendMail({ to, subject: `${s.brand}: probni e-mail`, text: 'Ako vidiš ovu poruku, e-mail iz panela radi. ✅' });
  return { ok: true, to };
});
route('POST', 'settings/test-cbot', 'settings', async () => {
  const r = await cbot.call('getMe');
  if (!r.ok) fail(400, `Bot ne radi: ${r.description || 'provjeri token'}`);
  return { ok: true, username: r.result.username };
});
route('POST', 'settings/test-s3', 'settings', async () => {
  await s3.put(`vpn-panel/test-${Date.now()}.txt`, Buffer.from('Veltrix panel test'), 'text/plain');
  return { ok: true };
});
route('GET', 'system/update', 'owner', async () => {
  const repo = String(settings.get('update_repo') || '').trim();
  let latest = null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/panel/package.json`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) latest = (await r.json()).version;
  } catch { /* nema veze */ }
  const fsx = require('node:fs');
  const ready = fsx.existsSync('/etc/systemd/system/vpn-panel-update.path');
  return { current: VERSION, latest, repo, ready, pending: fsx.existsSync(require('node:path').join(require('./db').DATA_DIR, 'update.request')) };
});
route('POST', 'system/update', 'owner', (c) => {
  const fsx = require('node:fs');
  if (!fsx.existsSync('/etc/systemd/system/vpn-panel-update.path')) fail(400, 'Ažuriranje iz panela još nije podešeno. Jednom ažuriraj ručno komandom iz README-a.');
  fsx.writeFileSync(require('node:path').join(require('./db').DATA_DIR, 'update.request'), String(settings.get('update_repo') || 'maid-cyber/vpn-panel'));
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
    res.write(`data: ${JSON.stringify({ t: now(), servers })}\n\n`);
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
for (const r of routes) if (r.fn.length === 1 && r.re.source.includes('restore')) r.rawBody = true;

module.exports = { handle, serverView, VERSION };
