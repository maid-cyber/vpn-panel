'use strict';
// Rast: probni nalog iz aplikacije, produženje karticom (Stripe) i preporuke (referral).
const crypto = require('node:crypto');
const { one, all, run, now, log, tx } = require('./db');
const settings = require('./settings');
const core = require('./core');
const vpn = require('./vpn');
const { send, readBody, clientIp, fail } = require('./http');
const { notify } = require('./notify');

const SYSTEM = { username: 'aplikacija', role: 'owner', id: 0 };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Kod za preporuke (8 znakova, bez 0/O/1/I), napravi se jednom po kupcu. */
function refCode(u) {
  if (u.ref_code) return u.ref_code;
  for (let i = 0; ; i++) {
    const h = crypto.createHash('sha256').update(`ref:${u.uuid}:${i}`).digest();
    const code = Array.from(h.subarray(0, 8), (b) => ALPHA[b % ALPHA.length]).join('');
    if (!one('SELECT id FROM users WHERE ref_code = ?', code)) {
      run('UPDATE users SET ref_code = ? WHERE id = ?', code, u.id);
      return code;
    }
  }
}

function trialPlan() {
  return one('SELECT * FROM plans WHERE active = 1 AND trial = 1 ORDER BY sort, id LIMIT 1');
}

function renewPlans(u) {
  const s = settings.load();
  if (!s.renew_on || !s.stripe_on || !s.stripe_secret || u.owner_id) return [];
  return all('SELECT id, name, days, price, traffic_gb, devices FROM plans WHERE active = 1 AND trial = 0 AND price > 0 ORDER BY sort, id')
    .map((p) => ({ id: p.id, name: p.name, days: p.days, price: p.price, traffic_gb: p.traffic_gb, devices: p.devices }));
}

/** Dodatak za /s/:token/app: plaćanje, preporuke, probni. */
function appInfo(u) {
  const s = settings.load();
  const out = { currency: s.currency || 'EUR', renew: renewPlans(u), trial: !!u.trial_device };
  if (s.ref_on && !u.owner_id) {
    out.ref = {
      code: refCode(u), days: Number(s.ref_days || 7),
      invited: one('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?', u.id).n,
      rewarded: one('SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND paid_once = 1', u.id).n,
    };
  }
  return out;
}

// POST /trial  { device, ref?, app? }  →  { link }
async function trial(req, res, base) {
  const s = settings.load();
  if (!s.app_trial) return send(res, 403, { error: 'Probni nalozi trenutno nisu dostupni.' });
  const b = await readBody(req, 4096).catch(() => ({}));
  const device = String(b.device || '').replace(/[^\w-]/g, '').slice(0, 80);
  if (device.length < 12) return send(res, 400, { error: 'Neispravan uređaj.' });
  const ip = clientIp(req);
  const t = now();
  const plan = trialPlan();
  if (!plan) return send(res, 503, { error: 'Probni plan nije podešen.' });
  // jedan probni po uređaju (zauvijek), jedan po IP adresi sedmično, dnevni limit
  if (one('SELECT id FROM trials WHERE device = ?', device)) return send(res, 409, { error: 'Na ovom uređaju je probni nalog već iskorišten.' });
  if (one('SELECT id FROM trials WHERE ip = ? AND ts > ?', ip, t - 7 * vpn.DAY)) return send(res, 409, { error: 'Sa ove mreže je probni nalog već iskorišten. Pokušaj za par dana.' });
  const today = one('SELECT COUNT(*) AS n FROM trials WHERE ts > ?', t - vpn.DAY).n;
  if (today >= Number(s.app_trial_cap || 20)) {
    notify('n_payment', '⚠️ Dnevni limit probnih naloga iz aplikacije je dostignut.');
    return send(res, 429, { error: 'Danas više nema probnih naloga. Pokušaj sutra.' });
  }
  const ref = String(b.ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const referrer = ref && s.ref_on ? one('SELECT id, username FROM users WHERE ref_code = ? AND owner_id IS NULL', ref) : null;
  let id;
  try {
    id = core.createUser(SYSTEM, { plan_id: plan.id, note: `Probni iz aplikacije (${String(b.app || 'app').slice(0, 20)})` });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  tx(() => {
    run('UPDATE users SET trial_device = ?, referred_by = ? WHERE id = ?', device, referrer?.id || null, id);
    run('INSERT INTO trials (device, ip, ts, user_id) VALUES (?,?,?,?)', device, ip, t, id);
  });
  const u = one('SELECT * FROM users WHERE id = ?', id);
  log('aplikacija', 'Probni nalog iz aplikacije', `${u.username}${referrer ? ' · preporuka od ' + referrer.username : ''}`);
  return send(res, 200, { link: `${base}/s/${u.sub_token}`, username: u.username });
}

// POST /s/:token/renew  { plan_id }  →  { url }  (Stripe Checkout)
async function renew(req, res, u, link) {
  const s = settings.load();
  const b = await readBody(req, 4096).catch(() => ({}));
  const plan = renewPlans(u).find((p) => p.id === Number(b.plan_id));
  if (!plan) return send(res, 400, { error: 'Plan nije dostupan za plaćanje karticom.' });
  let k;
  try { k = require('./coupons').apply(b.coupon, plan); } catch (e) { return send(res, 400, { error: e.message }); }
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${link}?placeno=1`,
    cancel_url: link,
    client_reference_id: `user:${u.id}`,
    'metadata[purpose]': 'renew', 'metadata[user_id]': String(u.id), 'metadata[plan_id]': String(plan.id),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': String(s.currency || 'EUR').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(k.price * 100)),
    'line_items[0][price_data][product_data][name]': `${s.brand} · ${plan.name}${k.coupon ? ` (kod ${k.coupon.code})` : ''}`,
  });
  if (k.coupon) { form.set('metadata[coupon_id]', String(k.coupon.id)); form.set('metadata[discount]', String(k.discount)); }
  if (u.email) form.set('customer_email', u.email);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { authorization: `Bearer ${s.stripe_secret}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: `Stripe: ${j.error?.message || r.status}` });
  log(u.username, 'Kupac započeo plaćanje', `${plan.name} · €${plan.price}`);
  return send(res, 200, { url: j.url });
}

/** Stripe je potvrdio uplatu kupca: produži nalog (jednom po uplati) i nagradi preporuku. */
function paidRenew(ses) {
  const uid = Number(ses.metadata?.user_id), pid = Number(ses.metadata?.plan_id);
  if (!uid || !pid || one('SELECT id FROM transactions WHERE ext_id = ?', ses.id)) return;
  const u = one('SELECT * FROM users WHERE id = ?', uid);
  if (!u) return;
  const amount = (ses.amount_total || 0) / 100;
  core.extendUser({ username: ses.actor || 'Stripe', role: 'owner', id: 0 }, uid, { plan_id: pid, paid: amount, method: ses.method || 'Stripe (kartica)' });
  const trx = one('SELECT id FROM transactions WHERE user_id = ? AND ext_id IS NULL ORDER BY id DESC LIMIT 1', uid);
  if (trx) run('UPDATE transactions SET ext_id = ? WHERE id = ?', ses.id, trx.id);
  require('./coupons').used(ses, uid);
  // preporuka: prva uplata pozvanog kupca → gratis dani obojici
  const s = settings.load();
  if (!u.paid_once) {
    run('UPDATE users SET paid_once = 1 WHERE id = ?', uid);
    if (s.ref_on && u.referred_by) {
      const days = Math.max(1, Number(s.ref_days || 7));
      for (const [id, why] of [[uid, 'prva uplata preko preporuke'], [u.referred_by, `preporuka: ${u.username} je platio`]]) {
        const x = one('SELECT * FROM users WHERE id = ?', id);
        if (!x) continue;
        run('UPDATE users SET expires_at = ? WHERE id = ?', Math.max(x.expires_at, now()) + days * vpn.DAY, id);
        run('INSERT INTO user_history (user_id, ts, text) VALUES (?,?,?)', id, now(), `Gratis +${days} dana · ${why}`);
      }
      log('sistem', 'Preporuka nagrađena', `${u.username} → +${days} dana obojici`);
    }
  }
}

module.exports = { trial, renew, paidRenew, appInfo, refCode, renewPlans };
