'use strict';
// Kuponi i akcije: popust u % ili fiksni iznos, opcioni gratis dani, rok, broj korištenja, samo određeni planovi.
// Važe na sajtu (kupovina) i na stranici kupca (produženje karticom). Korištenje se broji tek kad uplata prođe.
const { one, all, run, now, log, db } = require('./db');
const { fail, send, readBody, clientIp } = require('./http');
const vpn = require('./vpn');

db.exec(`CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, kind TEXT NOT NULL DEFAULT 'pct', value REAL NOT NULL DEFAULT 0,
  bonus_days INTEGER DEFAULT 0, max_uses INTEGER DEFAULT 0, used INTEGER DEFAULT 0, expires_at INTEGER DEFAULT 0, plan_ids TEXT DEFAULT '', active INTEGER DEFAULT 1, note TEXT DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS coupon_uses (id INTEGER PRIMARY KEY, coupon_id INTEGER NOT NULL, ts INTEGER NOT NULL, session TEXT UNIQUE, user_id INTEGER, amount REAL DEFAULT 0, discount REAL DEFAULT 0);`);

const MIN = 0.5;   // Stripe ne prima manje od 0,50
const round2 = (n) => Math.round(n * 100) / 100;
const plansOf = (c) => String(c.plan_ids || '').split(',').map(Number).filter(Boolean);

/** Cijena plana sa kuponom. Vraća { coupon, price, discount, bonus } ili baca grešku sa porukom za kupca. */
function apply(code, plan) {
  code = String(code || '').trim();
  if (!code) return { coupon: null, price: plan.price, discount: 0, bonus: 0 };
  const c = one('SELECT * FROM coupons WHERE code = ?', code);
  if (!c || !c.active) fail(400, 'Taj kod za popust ne postoji.');
  if (c.expires_at && now() > c.expires_at) fail(400, 'Ovaj kod za popust je istekao.');
  if (c.max_uses && c.used >= c.max_uses) fail(400, 'Ovaj kod za popust je već iskorišten.');
  const pl = plansOf(c);
  if (pl.length && !pl.includes(plan.id)) fail(400, 'Ovaj kod ne važi za izabrani plan.');
  let price = c.kind === 'fixed' ? plan.price - c.value : plan.price * (1 - c.value / 100);
  price = round2(Math.max(MIN, price));
  return { coupon: c, price, discount: round2(plan.price - price), bonus: Number(c.bonus_days) || 0 };
}

/** Uplata prošla: zabilježi korištenje (jednom po sesiji) i dodaj gratis dane. */
function used(ses, userId) {
  const cid = Number(ses.metadata?.coupon_id);
  if (!cid || one('SELECT id FROM coupon_uses WHERE session = ?', ses.id)) return;
  const c = one('SELECT * FROM coupons WHERE id = ?', cid);
  if (!c) return;
  run('INSERT INTO coupon_uses (coupon_id, ts, session, user_id, amount, discount) VALUES (?,?,?,?,?,?)', cid, now(), ses.id, userId || null, (ses.amount_total || 0) / 100, Number(ses.metadata?.discount) || 0);
  run('UPDATE coupons SET used = used + 1 WHERE id = ?', cid);
  if (c.bonus_days > 0 && userId) {
    const u = one('SELECT expires_at FROM users WHERE id = ?', userId);
    if (u) {
      run('UPDATE users SET expires_at = ? WHERE id = ?', Math.max(u.expires_at, now()) + c.bonus_days * vpn.DAY, userId);
      run('INSERT INTO user_history (user_id, ts, text) VALUES (?,?,?)', userId, now(), `Gratis +${c.bonus_days} dana · kupon ${c.code}`);
    }
  }
  log('sistem', 'Kupon iskorišten', `${c.code}${userId ? ' · kupac #' + userId : ''}`);
}

// provjera koda sa sajta i stranice kupca (ograničeno da se kodovi ne mogu pogađati)
const tries = new Map();
async function check(req, res, planOf) {
  const ip = clientIp(req), t = now();
  const a = (tries.get(ip) || []).filter((x) => t - x < 600000);
  if (a.length >= 20) return send(res, 429, { error: 'Previše pokušaja. Pokušaj ponovo za 10 minuta.' });
  a.push(t); tries.set(ip, a);
  if (tries.size > 5000) tries.clear();
  const b = await readBody(req, 2048).catch(() => ({}));
  const plan = planOf(Number(b.plan_id));
  if (!plan) return send(res, 400, { error: 'Izaberi plan.' });
  try {
    const r = apply(b.code, plan);
    return send(res, 200, { ok: true, price: r.price, old: plan.price, discount: r.discount, bonus_days: r.bonus, code: r.coupon?.code || '' });
  } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
}

// ---------- za panel
function listAll() {
  return all(`SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM coupon_uses u WHERE u.coupon_id = c.id) AS revenue,
    (SELECT COALESCE(SUM(discount),0) FROM coupon_uses u WHERE u.coupon_id = c.id) AS given, (SELECT MAX(ts) FROM coupon_uses u WHERE u.coupon_id = c.id) AS last_used
    FROM coupons c ORDER BY c.active DESC, c.id DESC`).map((c) => ({ ...c, active: !!c.active, plan_ids: plansOf(c) }));
}
function clean(b, old = {}) {
  const code = String(b.code ?? old.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) fail(400, 'Kod: 3–30 znakova (slova, brojevi, - i _).');
  const kind = (b.kind ?? old.kind) === 'fixed' ? 'fixed' : 'pct';
  const value = Number(String(b.value ?? old.value ?? 0).replace(',', '.'));
  if (!(value > 0) || (kind === 'pct' && value > 90)) fail(400, kind === 'pct' ? 'Popust mora biti od 1 do 90%.' : 'Upiši iznos popusta.');
  const bonus = Math.max(0, Math.min(365, Math.round(Number(b.bonus_days ?? old.bonus_days ?? 0)) || 0));
  const maxUses = Math.max(0, Math.round(Number(b.max_uses ?? old.max_uses ?? 0)) || 0);
  const exp = b.expires !== undefined ? (b.expires ? new Date(`${b.expires}T23:59:59`).getTime() : 0) : (old.expires_at || 0);
  if (Number.isNaN(exp)) fail(400, 'Neispravan datum.');
  const plans = [].concat(b.plan_ids ?? plansOf(old)).map(Number).filter(Boolean).join(',');
  return { code, kind, value, bonus, maxUses, exp, plans, note: String(b.note ?? old.note ?? '').slice(0, 200), active: b.active === undefined ? (old.active ?? 1) : (b.active ? 1 : 0) };
}
function create(b, actor) {
  const c = clean(b);
  if (one('SELECT id FROM coupons WHERE code = ?', c.code)) fail(400, 'Taj kod već postoji.');
  const r = run('INSERT INTO coupons (code, kind, value, bonus_days, max_uses, expires_at, plan_ids, note, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', c.code, c.kind, c.value, c.bonus, c.maxUses, c.exp, c.plans, c.note, c.active, now());
  log(actor, 'Novi kupon', c.code);
  return { id: Number(r.lastInsertRowid) };
}
function update(id, b, actor) {
  const old = one('SELECT * FROM coupons WHERE id = ?', Number(id));
  if (!old) fail(404, 'Kupon ne postoji.');
  const c = clean(b, old);
  if (one('SELECT id FROM coupons WHERE code = ? AND id != ?', c.code, old.id)) fail(400, 'Taj kod već postoji.');
  run('UPDATE coupons SET code = ?, kind = ?, value = ?, bonus_days = ?, max_uses = ?, expires_at = ?, plan_ids = ?, note = ?, active = ? WHERE id = ?', c.code, c.kind, c.value, c.bonus, c.maxUses, c.exp, c.plans, c.note, c.active, old.id);
  log(actor, 'Kupon izmijenjen', c.code);
  return { ok: true };
}
function remove(id, actor) {
  const c = one('SELECT * FROM coupons WHERE id = ?', Number(id));
  if (!c) fail(404, 'Kupon ne postoji.');
  run('DELETE FROM coupons WHERE id = ?', c.id);
  log(actor, 'Kupon obrisan', c.code, 'warn');
  return { ok: true };
}

module.exports = { apply, used, check, listAll, create, update, remove };
