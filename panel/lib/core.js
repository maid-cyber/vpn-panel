'use strict';
// Poslovna logika za korisnike, kredit resellera i transakcije. Koriste je admin API, reseller i javni API.
const { one, all, run, tx, log, now, bumpDaily } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const { fail, esc } = require('./http');
const mail = require('./mail');
const { notify, webhook } = require('./notify');

const GB = 1024 ** 3;
const round2 = (n) => Math.round(n * 100) / 100;

function userRow(u, t = now()) {
  const status = vpn.userStatus(u, t);
  return {
    id: u.id, username: u.username, plan_id: u.plan_id, plan: u.plan_name || null, owner_id: u.owner_id, owner: u.owner_name || null,
    status, disabled: !!u.disabled, expires_at: u.expires_at, days_left: Math.ceil((u.expires_at - t) / vpn.DAY),
    traffic_used: u.traffic_up + u.traffic_down, traffic_limit: u.traffic_limit, devices: u.devices,
    note: u.note, contact: u.contact, email: u.email || '', auto_renew: !!u.auto_renew, tg: !!u.tg_chat,
    devices_seen: u.devices_seen || 0, blocked_until: u.blocked_until || 0, last_seen: u.last_seen, last_server: u.last_server_name || null, created_at: u.created_at,
  };
}

const USER_SELECT = `SELECT u.*, p.name AS plan_name, a.username AS owner_name, s.name AS last_server_name
  FROM users u LEFT JOIN plans p ON p.id = u.plan_id LEFT JOIN admins a ON a.id = u.owner_id LEFT JOIN servers s ON s.id = u.last_server`;

function getUser(id, me) {
  const u = one(`${USER_SELECT} WHERE u.id = ?`, Number(id));
  if (!u) fail(404, 'Korisnik ne postoji.');
  if (me && me.role === 'reseller' && u.owner_id !== me.id) fail(404, 'Korisnik ne postoji.');
  return u;
}

function history(userId, text) { run('INSERT INTO user_history (user_id, ts, text) VALUES (?,?,?)', userId, now(), text); }

function resellerPrice(reseller, plan) {
  const lvl = reseller.level_id ? one('SELECT * FROM levels WHERE id = ?', reseller.level_id) : null;
  return round2((plan.price || 0) * (1 - (lvl?.discount || 0)));
}

function chargeReseller(reseller, plan, userId, what) {
  if (plan.trial) {
    const since = now() - 86400000;
    const n = one("SELECT COUNT(*) AS n FROM user_history h JOIN users u ON u.id = h.user_id WHERE u.owner_id = ? AND h.ts > ? AND h.text LIKE 'Probni nalog%'", reseller.id, since).n;
    if (n >= Number(settings.get('res_trials_day') || 0)) fail(400, 'Iskoristio si dnevni limit probnih naloga.');
    return 0;
  }
  const price = resellerPrice(reseller, plan);
  const fresh = one('SELECT credit FROM admins WHERE id = ?', reseller.id);
  if (fresh.credit - price < -Number(settings.get('res_negative') || 0)) fail(400, `Nemaš dovoljno kredita (treba €${price.toFixed(2)}, imaš €${fresh.credit.toFixed(2)}).`);
  run('UPDATE admins SET credit = credit - ? WHERE id = ?', price, reseller.id);
  run('INSERT INTO transactions (ts, type, amount, credit_delta, reseller_id, user_id, actor, note) VALUES (?,?,?,?,?,?,?,?)',
    now(), 'credit_use', 0, -price, reseller.id, userId, reseller.username, `${what} · ${plan.name}`);
  const after = fresh.credit - price;
  if (after < 10 && fresh.credit >= 10) notify('n_lowcredit', `Reselleru ${reseller.username} ostalo je €${after.toFixed(2)} kredita.`);
  return price;
}

function cleanEmail(v) {
  v = String(v || '').trim().slice(0, 120);
  if (v && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) fail(400, 'E-mail adresa nije ispravna.');
  return v;
}

function validUsername(name) {
  name = String(name || '').trim();
  if (!/^[a-zA-Z0-9._@-]{3,40}$/.test(name)) fail(400, 'Korisničko ime: 3–40 znakova, slova, brojevi i . _ - @');
  if (one('SELECT id FROM users WHERE username = ?', name)) fail(400, 'To korisničko ime je zauzeto.');
  return name;
}

function suggestUsername() {
  for (;;) {
    const n = `vpn_${Math.floor(1000 + Math.random() * 90000)}`;
    if (!one('SELECT id FROM users WHERE username = ?', n)) return n;
  }
}

// actor = admin ili reseller koji radi akciju
function createUser(actor, body) {
  const plan = one('SELECT * FROM plans WHERE id = ? AND active = 1', Number(body.plan_id));
  if (!plan) fail(400, 'Izaberi aktivan plan.');
  const username = validUsername(body.username || suggestUsername());
  let ownerId = null;
  if (actor.role === 'reseller') {
    ownerId = actor.id;
    const count = one('SELECT COUNT(*) AS n FROM users WHERE owner_id = ?', actor.id).n;
    if (count >= actor.user_limit) fail(400, `Dostigao si limit od ${actor.user_limit} korisnika.`);
  } else if (body.owner_id) {
    const r = one("SELECT id FROM admins WHERE id = ? AND role = 'reseller'", Number(body.owner_id));
    if (!r) fail(400, 'Reseller ne postoji.');
    ownerId = r.id;
  }
  const days = actor.role === 'reseller' ? plan.days : Number(body.days || plan.days);
  const trafficGb = actor.role === 'reseller' ? plan.traffic_gb : Number(body.traffic_gb ?? plan.traffic_gb);
  const wg = vpn.wgKeys();
  return tx(() => {
    const r = run(`INSERT INTO users (username, uuid, sub_token, plan_id, owner_id, expires_at, traffic_limit, devices, note, contact, wg_priv, wg_pub, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    username, vpn.uuid(), vpn.subToken(), plan.id, ownerId, now() + days * vpn.DAY, Math.round(trafficGb * GB),
    Number(body.devices || plan.devices || settings.get('default_devices') || 3), String(body.note || '').slice(0, 500), String(body.contact || '').slice(0, 120),
    wg.priv, wg.pub, now());
    const id = Number(r.lastInsertRowid);
    if (body.email || body.auto_renew) run('UPDATE users SET email = ?, auto_renew = ? WHERE id = ?', cleanEmail(body.email), body.auto_renew ? 1 : 0, id);
    let charged = 0;
    if (actor.role === 'reseller') charged = chargeReseller(actor, plan, id, 'Novi korisnik ' + username);
    const paid = Number(body.paid || 0);
    if (paid > 0 && actor.role !== 'reseller') {
      run('INSERT INTO transactions (ts, type, amount, user_id, actor, method, note) VALUES (?,?,?,?,?,?,?)', now(), 'sale', paid, id, actor.username, String(body.method || ''), `Novi korisnik ${username} · ${plan.name}`);
      notify('n_payment', `Uplata €${paid} · novi korisnik ${username} (${plan.name})`);
    }
    history(id, `${plan.trial ? 'Probni nalog' : 'Nalog napravljen'} · ${plan.name} · ${actor.username}${charged ? ` · €${charged}` : ''}`);
    bumpDaily('new_users', 1, settings.get('timezone'));
    log(actor.username, 'Novi korisnik', `${username} · ${plan.name}`);
    webhook('user.created', { id, username, plan: plan.name, owner: actor.role === 'reseller' ? actor.username : null });
    return id;
  });
}

function extendUser(actor, id, body) {
  const u = getUser(id, actor.role === 'reseller' ? actor : null);
  const plan = one('SELECT * FROM plans WHERE id = ?', Number(body.plan_id || u.plan_id));
  if (!plan) fail(400, 'Plan ne postoji.');
  if (plan.trial && actor.role === 'reseller') fail(400, 'Probni plan se ne može produžiti.');
  const days = actor.role === 'reseller' ? plan.days : Number(body.days || plan.days);
  if (!(days > 0 && days <= 3650)) fail(400, 'Broj dana nije ispravan.');
  return tx(() => {
    const base = Math.max(u.expires_at, now());
    const resetTraffic = settings.get('traffic_reset') === 'na produženje';
    run(`UPDATE users SET expires_at = ?, plan_id = ?, traffic_limit = ?, disabled = 0 ${resetTraffic ? ', traffic_up = 0, traffic_down = 0' : ''} WHERE id = ?`,
      base + days * vpn.DAY, plan.id, Math.round((actor.role === 'reseller' ? plan.traffic_gb : Number(body.traffic_gb ?? plan.traffic_gb)) * GB), u.id);
    let charged = 0;
    if (actor.role === 'reseller') charged = chargeReseller(actor, plan, u.id, 'Produženje ' + u.username);
    const paid = Number(body.paid || 0);
    if (paid > 0 && actor.role !== 'reseller') {
      run('INSERT INTO transactions (ts, type, amount, user_id, actor, method, note) VALUES (?,?,?,?,?,?,?)', now(), 'sale', paid, u.id, actor.username, String(body.method || ''), `Produženje ${u.username} · ${plan.name}`);
      notify('n_payment', `Uplata €${paid} · produženje ${u.username}`);
    }
    history(u.id, `Produženo +${days} dana · ${plan.name} · ${actor.username}${charged ? ` · €${charged}` : ''}`);
    bumpDaily('renewals', 1, settings.get('timezone'));
    log(actor.username, 'Produženo', `${u.username} +${days} dana`);
    webhook('user.extended', { id: u.id, username: u.username, days });
  });
}

function deleteUser(actor, id) {
  const u = getUser(id, actor.role === 'reseller' ? actor : null);
  if (actor.role === 'reseller') {
    if (!settings.get('res_can_delete')) fail(403, 'Nemaš dozvolu za brisanje. Možeš ugasiti korisnika.');
    if (settings.get('res_refund_delete') && now() - u.created_at < 86400000 && u.traffic_up + u.traffic_down < 50 * 1024 * 1024) {
      const spent = one("SELECT COALESCE(SUM(credit_delta),0) AS s FROM transactions WHERE user_id = ? AND type = 'credit_use'", u.id).s;
      if (spent < 0) {
        run('UPDATE admins SET credit = credit + ? WHERE id = ?', -spent, actor.id);
        run('INSERT INTO transactions (ts, type, amount, credit_delta, reseller_id, actor, note) VALUES (?,?,?,?,?,?,?)', now(), 'adjust', 0, -spent, actor.id, actor.username, `Povrat kredita · obrisan ${u.username}`);
      }
    }
  }
  run('DELETE FROM user_history WHERE user_id = ?', u.id);
  run('DELETE FROM users WHERE id = ?', u.id);
  log(actor.username, 'Korisnik obrisan', u.username, 'warn');
}

function setDisabled(actor, id, disabled) {
  const u = getUser(id, actor.role === 'reseller' ? actor : null);
  run('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, u.id);
  history(u.id, `${disabled ? 'Ugašen' : 'Upaljen'} · ${actor.username}`);
  log(actor.username, disabled ? 'Korisnik ugašen' : 'Korisnik upaljen', u.username);
}

function resetTraffic(actor, id) {
  const u = getUser(id, actor.role === 'reseller' ? actor : null);
  run('UPDATE users SET traffic_up = 0, traffic_down = 0 WHERE id = ?', u.id);
  history(u.id, `Promet resetovan · ${actor.username}`);
  log(actor.username, 'Promet resetovan', u.username);
}

function rekey(actor, id) {
  const u = getUser(id, actor.role === 'reseller' ? actor : null);
  const wg = vpn.wgKeys();
  run('UPDATE users SET uuid = ?, sub_token = ?, wg_priv = ?, wg_pub = ? WHERE id = ?', vpn.uuid(), vpn.subToken(), wg.priv, wg.pub, u.id);
  history(u.id, `Novi ključ i link · ${actor.username} (stari više ne rade)`);
  log(actor.username, 'Novi ključ', u.username);
}

const INVOICE_SELECT = 'SELECT t.*, a.username AS reseller, a.contact, a.email AS remail, a.brand AS rbrand FROM transactions t LEFT JOIN admins a ON a.id = t.reseller_id WHERE t.id = ?';
function invoiceHtml(t, forMail) {
  const s = settings.load();
  const vat = Number(s.vat || 0), net = vat ? t.amount / (1 + vat / 100) : t.amount;
  const cur = s.currency === 'EUR' ? '€' : s.currency + ' ';
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><title>Faktura ${esc(t.invoice_no || t.id)}</title>
<style>body{font-family:Arial,sans-serif;max-width:720px;margin:40px auto;color:#111;padding:0 20px}h1{font-size:26px;margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}.r{text-align:right}.top{display:flex;justify-content:space-between;gap:20px}small{color:#555}@media print{button{display:none}}</style></head><body>
<div class="top"><div><h1>${esc(s.inv_company || s.brand)}</h1><small style="white-space:pre-line">${esc(s.inv_address)}</small></div>
<div class="r"><strong>Faktura ${esc(t.invoice_no || '#' + t.id)}</strong><br><small>${new Date(t.ts).toLocaleDateString('bs-BA')}</small></div></div>
<p style="margin-top:28px"><strong>Kupac:</strong> ${esc(t.rbrand || t.reseller || t.note || '—')}${t.contact ? `<br><small>${esc(t.contact)}</small>` : ''}</p>
<table><tr><th>Opis</th><th class="r">Iznos</th></tr>
<tr><td>${t.type === 'topup' ? 'Kredit za VPN usluge' : esc(t.note || 'VPN usluga')}</td><td class="r">${cur}${net.toFixed(2)}</td></tr>
${vat ? `<tr><td>PDV ${vat}%</td><td class="r">${cur}${(t.amount - net).toFixed(2)}</td></tr>` : ''}
<tr><th>Ukupno</th><th class="r">${cur}${t.amount.toFixed(2)}</th></tr></table>
<p><small>Način plaćanja: ${esc(t.method || '—')}</small></p>${forMail ? '' : '<button onclick="print()">Štampaj / PDF</button>'}</body></html>`;
}
function mailInvoice(txId) {
  const t = one(INVOICE_SELECT, txId);
  if (!t || !t.remail || !settings.get('mail_invoices') || !mail.configured()) return;
  mail.sendMail({ to: t.remail, subject: `Faktura ${t.invoice_no} · ${settings.get('brand')}`, text: `Hvala na uplati. Kredit: +${t.credit_delta}. Faktura ${t.invoice_no} je u prilogu ove poruke (HTML).`, html: invoiceHtml(t, true) })
    .then(() => log('sistem', 'Faktura poslana mailom', `${t.invoice_no} → ${t.reseller}`))
    .catch((e) => log('sistem', 'Faktura nije poslana mailom', e.message, 'warn'));
}

function addCredit(actor, resellerId, body) {
  const r = one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", Number(resellerId));
  if (!r) fail(404, 'Reseller ne postoji.');
  const amount = round2(Number(body.amount));
  if (!Number.isFinite(amount) || amount === 0) fail(400, 'Upiši iznos.');
  const kind = body.kind === 'adjust' ? 'adjust' : 'topup';
  const money = kind === 'topup' ? amount : 0;      // topup je novac koji si primio
  const year = new Date().getFullYear();
  return tx(() => {
    run('UPDATE admins SET credit = credit + ? WHERE id = ?', amount, r.id);
    const t = run('INSERT INTO transactions (ts, type, amount, credit_delta, reseller_id, actor, method, note) VALUES (?,?,?,?,?,?,?,?)',
      now(), kind, money, amount, r.id, actor.username, String(body.method || ''), String(body.note || '').slice(0, 200));
    const id = Number(t.lastInsertRowid);
    if (kind === 'topup' && amount > 0) {
      const inv = `${settings.get('inv_prefix') || 'F-'}${year}-${String(id).padStart(4, '0')}`;
      run('UPDATE transactions SET invoice_no = ? WHERE id = ?', inv, id);
      notify('n_payment', `Kredit +€${amount} · ${r.username}${body.method ? ` (${body.method})` : ''}`);
      webhook('reseller.topup', { reseller: r.username, amount, method: body.method || '' });
      setImmediate(() => mailInvoice(id));
    }
    log(actor.username, kind === 'topup' ? 'Kredit dodan' : 'Kredit ispravljen', `${r.username} ${amount > 0 ? '+' : ''}€${amount}`);
    return id;
  });
}

module.exports = {
  GB, USER_SELECT, userRow, getUser, createUser, extendUser, deleteUser, setDisabled, resetTraffic, rekey,
  addCredit, resellerPrice, history, suggestUsername, round2, cleanEmail, invoiceHtml, INVOICE_SELECT,
};
