'use strict';
// Stripe: reseller plaća kredit karticom (Checkout), webhook automatski doda kredit.
const crypto = require('node:crypto');
const { one, run, log } = require('./db');
const settings = require('./settings');
const core = require('./core');
const { fail, send, readBody } = require('./http');

function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, key, out);
    else if (v !== undefined && v !== null) out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function createCheckout(reseller, amount, base) {
  const s = settings.load();
  if (!s.stripe_on || !s.stripe_secret) fail(400, 'Plaćanje karticom nije uključeno.');
  amount = core.round2(Number(amount));
  const min = Number(s.res_min_topup || 0);
  if (!(amount >= Math.max(min, 1)) || amount > 10000) fail(400, `Iznos mora biti najmanje €${Math.max(min, 1)}.`);
  const body = form({
    mode: 'payment',
    success_url: `${base}#/kredit?placeno=1`,
    cancel_url: `${base}#/kredit`,
    client_reference_id: String(reseller.id),
    customer_email: reseller.email || undefined,
    metadata: { reseller_id: reseller.id, purpose: 'credit' },
    line_items: { 0: { quantity: 1, price_data: { currency: String(s.currency || 'EUR').toLowerCase(), unit_amount: Math.round(amount * 100), product_data: { name: `${s.brand} · kredit za resellera ${reseller.username}` } } } },
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { authorization: `Bearer ${s.stripe_secret}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, `Stripe: ${j.error?.message || r.status}`);
  log(reseller.username, 'Stripe plaćanje započeto', `€${amount}`);
  return { url: j.url };
}

// provjera potpisa (Stripe-Signature: t=...,v1=...)
function verify(raw, header, secret, tolerance = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

async function webhook(req, res) {
  const s = settings.load();
  const raw = (await readBody(req, 1 << 20, true)).toString('utf8');
  if (!s.stripe_whsec || !verify(raw, req.headers['stripe-signature'], s.stripe_whsec)) {
    log('sistem', 'Stripe webhook odbijen', 'neispravan potpis', 'warn');
    return send(res, 400, { error: 'bad signature' });
  }
  const ev = JSON.parse(raw);
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const ses = ev.data.object;
    const rid = Number(ses.metadata?.reseller_id || ses.client_reference_id);
    if (ses.payment_status === 'paid' && ses.metadata?.purpose === 'renew') require('./growth').paidRenew(ses);
    if (ses.payment_status === 'paid' && ses.metadata?.purpose === 'buy') {
      const s0 = settings.load();
      require('./site').paidBuy(ses, (s0.sub_url || s0.panel_url || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`));
    }
    if (ses.payment_status === 'paid' && rid && ses.metadata?.purpose === 'credit') {
      if (!one('SELECT id FROM transactions WHERE ext_id = ?', ses.id)) {      // svaka uplata samo jednom
        const id = core.addCredit({ username: 'Stripe' }, rid, { amount: (ses.amount_total || 0) / 100, method: 'Stripe (kartica)', note: `Stripe ${ses.id.slice(-10)}`, kind: 'topup' });
        run('UPDATE transactions SET ext_id = ? WHERE id = ?', ses.id, id);
      }
    }
  }
  return send(res, 200, { received: true });
}

module.exports = { createCheckout, webhook, verify };
