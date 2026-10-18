'use strict';
// PayPal (Orders v2): kupac plati preko Telegram bota, panel sam napravi ili produži nalog.
// Tok: bot napravi narudžbu → kupac plati na PayPalu → povratak na /paypal/return (ili provjera svake minute) → capture → nalog.
const { one, all, run, now, log, tx } = require('./db');
const settings = require('./settings');
const { send } = require('./http');

const SYSTEM = { username: 'Telegram bot', role: 'owner', id: 0 };
const CUR = { EUR: '€', USD: '$', CHF: 'CHF ' };
const OK_CUR = ['EUR', 'USD', 'CHF'];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function apiBase() {
  if (process.env.PAYPAL_API) return process.env.PAYPAL_API.replace(/\/+$/, '');
  return settings.get('paypal_mode') === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

function ready() {
  const s = settings.load();
  return !!(s.paypal_on && String(s.paypal_client || '').trim() && String(s.paypal_secret || '').trim() && OK_CUR.includes(s.currency || 'EUR'));
}

let cached = { key: '', token: '', until: 0 };
async function token() {
  const s = settings.load();
  const id = String(s.paypal_client || '').trim(), sec = String(s.paypal_secret || '').trim();
  if (!id || !sec) throw new Error('Upiši PayPal Client ID i Secret (Postavke → Plaćanja).');
  const key = `${apiBase()}|${id}|${sec}`;
  if (cached.key === key && cached.until > now() + 60000) return cached.token;
  const r = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST', body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20000),
    headers: { authorization: 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(r.status === 401 ? 'PayPal odbio ključeve (provjeri Client ID, Secret i Live/Sandbox).' : `PayPal ${r.status}: ${j.error_description || j.message || ''}`);
  cached = { key, token: j.access_token, until: now() + (Number(j.expires_in) || 3000) * 1000 };
  return j.access_token;
}

async function pp(method, p, body, extra = {}) {
  const r = await fetch(`${apiBase()}${p}`, {
    method, signal: AbortSignal.timeout(25000),
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

function baseUrl() {
  const s = settings.load();
  return (s.panel_url || s.sub_url || '').replace(/\/+$/, '');
}

const money = (n) => `${CUR[settings.get('currency')] || '€'}${Number(n || 0).toFixed(2)}`;

/** Napravi narudžbu. kind: 'buy' | 'renew' (Telegram bot) | 'site' (web sajt). Vraća { id, url }. */
async function createOrder({ chat, kind, plan, userId, tgName, email, price, couponId, discount }) {
  const s = settings.load();
  if (!ready()) throw new Error('PayPal nije podešen.');
  const b = baseUrl();
  if (!b) throw new Error('Upiši adresu panela (Postavke → Opšte → Adresa panela).');
  const cur = s.currency || 'EUR';
  const amount = Number(price ?? plan.price).toFixed(2);
  const r = run('INSERT INTO bot_orders (chat, kind, plan_id, user_id, amount, currency, status, tg_name, created_at, email, coupon_id, discount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    String(chat || ''), kind, plan.id, userId || null, Number(amount), cur, 'new', String(tgName || '').slice(0, 64), now(), String(email || '').slice(0, 120), couponId || null, Number(discount) || 0);
  const oid = Number(r.lastInsertRowid);
  const res = await pp('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: `bot-${oid}`, custom_id: `bot-${oid}`, invoice_id: `${String(s.brand || 'VPN').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}-${kind === 'site' ? 'WEB' : 'TG'}-${oid}`,
      description: `${s.brand} · ${plan.name}${kind === 'renew' ? ' (produženje)' : ''}`.slice(0, 127),
      amount: { currency_code: cur, value: amount },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: String(s.brand || 'VPN').slice(0, 127), user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', landing_page: 'NO_PREFERENCE',
      return_url: `${b}/paypal/return`, cancel_url: `${b}/paypal/cancel`,
    } } },
  }, { 'PayPal-Request-Id': `veltrix-bot-${oid}` });
  if (!res.ok) {
    run("UPDATE bot_orders SET status = 'failed' WHERE id = ?", oid);
    throw new Error(`PayPal ${res.status}: ${res.j.details?.[0]?.description || res.j.message || 'greška'}`);
  }
  const link = (res.j.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  run("UPDATE bot_orders SET pp_id = ?, status = 'created' WHERE id = ?", res.j.id, oid);
  log('sistem', kind === 'site' ? 'PayPal narudžba (sajt)' : 'PayPal narudžba (bot)', `#${oid} · ${plan.name} · ${money(amount)}`);
  return { id: oid, url: link?.href };
}

/** Naplati odobrenu narudžbu i isporuči. Sigurno je zvati više puta. */
async function capture(ppId) {
  const o = one('SELECT * FROM bot_orders WHERE pp_id = ?', String(ppId || ''));
  if (!o) return { order: null };
  if (o.status === 'paid') return { order: o, done: true };
  let res = await pp('POST', `/v2/checkout/orders/${encodeURIComponent(o.pp_id)}/capture`, {}, { 'PayPal-Request-Id': `veltrix-cap-${o.id}` });
  if (!res.ok && res.status === 422) res = await pp('GET', `/v2/checkout/orders/${encodeURIComponent(o.pp_id)}`); // već naplaćeno ili još nije odobreno
  if (!res.ok) return { order: o, error: res.j.details?.[0]?.issue || res.j.name || String(res.status) };
  const cap = res.j.purchase_units?.[0]?.payments?.captures?.[0];
  if (res.j.status !== 'COMPLETED' || !cap || cap.status !== 'COMPLETED') return { order: o, pending: res.j.status || cap?.status };
  if (cap.amount?.currency_code !== o.currency || Number(cap.amount?.value) + 0.001 < o.amount) {
    run("UPDATE bot_orders SET status = 'mismatch' WHERE id = ?", o.id);
    log('sistem', 'PayPal iznos se ne slaže', `#${o.id}: ${cap.amount?.value} ${cap.amount?.currency_code}`, 'warn');
    return { order: o, error: 'iznos' };
  }
  return { order: fulfil(o, cap), done: true };
}

function fulfil(o, cap) {
  const core = require('./core');
  let userId = o.user_id;
  const claimed = tx(() => {
    const cur = one('SELECT status FROM bot_orders WHERE id = ?', o.id);
    if (cur.status === 'paid' || cur.status === 'paying') return false;
    run("UPDATE bot_orders SET status = 'paying' WHERE id = ?", o.id);
    return true;
  });
  if (!claimed) return one('SELECT * FROM bot_orders WHERE id = ?', o.id);
  try {
    if (o.kind === 'site') {
      userId = core.createUser({ username: 'sajt', role: 'owner', id: 0 }, { plan_id: o.plan_id, email: o.email, paid: o.amount, method: 'PayPal', note: 'Kupljeno na sajtu', contact: o.email });
      run('INSERT OR IGNORE INTO purchases (session, user_id, email, ts) VALUES (?,?,?,?)', o.pp_id, userId, o.email, now());
      require('./coupons').used({ id: o.pp_id, metadata: { coupon_id: o.coupon_id, discount: o.discount }, amount_total: Math.round(o.amount * 100) }, userId);
    } else if (o.kind === 'buy') {
      userId = core.createUser(SYSTEM, { plan_id: o.plan_id, paid: o.amount, method: 'PayPal', note: `Kupljeno preko Telegram bota${o.tg_name ? ' · @' + o.tg_name : ''}`, contact: o.tg_name ? '@' + o.tg_name : `tg:${o.chat}` });
      run('UPDATE users SET tg_chat = ? WHERE id = ?', o.chat, userId);
    } else {
      if (o.coupon_id) require('./coupons').used({ id: cap.id, metadata: { coupon_id: o.coupon_id, discount: o.discount }, amount_total: Math.round(o.amount * 100) }, o.user_id);
      require('./growth').paidRenew({ id: cap.id, metadata: { user_id: o.user_id, plan_id: o.plan_id }, amount_total: Math.round(o.amount * 100), method: 'PayPal', actor: o.kind === 'renew_web' ? 'kupac (PayPal)' : 'Telegram bot' });
    }
    const trx = one('SELECT id FROM transactions WHERE user_id = ? AND ext_id IS NULL ORDER BY id DESC LIMIT 1', userId);
    if (trx) run('UPDATE transactions SET ext_id = ? WHERE id = ?', cap.id, trx.id);
    run("UPDATE bot_orders SET status = 'paid', user_id = ?, paid_at = ?, capture_id = ? WHERE id = ?", userId, now(), cap.id, o.id);
  } catch (e) {
    run("UPDATE bot_orders SET status = 'error' WHERE id = ?", o.id);
    log('sistem', 'PayPal plaćeno, ali nalog nije napravljen', `#${o.id}: ${e.message}`, 'warn');
    require('./notify').notify('n_payment', `⚠️ PayPal uplata #${o.id} (${money(o.amount)}) je prošla, ali nalog nije napravljen: ${e.message}. Napravi ga ručno.`);
    throw e;
  }
  const done = one('SELECT * FROM bot_orders WHERE id = ?', o.id);
  log(o.kind === 'site' ? 'sajt' : 'sistem', { site: 'Kupljeno na sajtu (PayPal)', buy: 'Kupljeno preko bota (PayPal)', renew: 'Produženo preko bota (PayPal)', renew_web: 'Kupac produžio nalog (PayPal)' }[o.kind], `#${o.id} · ${money(o.amount)}`);
  if (o.kind === 'site') {
    if (o.email && require('./mail').configured()) require('./welcome').send(userId, 'buy', o.email, baseUrl()).catch((e) => log('sistem', 'E-mail kupcu nije poslan', String(e.message || e), 'warn'));
  } else if (o.chat) require('./cbot').delivered(done).catch((e) => console.error('cbot delivered', e));
  return done;
}

function page(title, text, ok) {
  const s = settings.load();
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.brand)}</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#0b0b10;color:#f2f2f6;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
main{max-width:420px;width:100%;background:#14141c;border:1px solid #2a2a37;border-top:4px solid #E3172B;border-radius:20px;padding:32px 26px;text-align:center}
.i{font-size:46px;line-height:1}h1{margin:14px 0 8px;font-size:23px}p{color:#b9b9c6;margin:0 0 22px}
a.b{display:inline-block;background:#E3172B;color:#fff;text-decoration:none;font-weight:700;padding:15px 28px;border-radius:14px}</style></head>
<body><main><div class="i">${ok ? '✅' : '↩️'}</div><h1>${esc(title)}</h1><p>${text}</p>__BTN__</main></body></html>`;
}

async function btn() {
  const name = await require('./cbot').username().catch(() => null);
  return name ? `<a class="b" href="https://t.me/${esc(name)}">Vrati se u Telegram</a>` : '';
}

/** GET /paypal/return?token=ORDER_ID  i  /paypal/cancel?token=ORDER_ID */
async function handle(req, res, url) {
  const ppId = String(url.searchParams.get('token') || '');
  const h = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (!/^[A-Z0-9]{8,40}$/.test(ppId)) return send(res, 400, page('Neispravan link', 'Vrati se u Telegram i pokušaj ponovo.', false).replace('__BTN__', await btn()), h);
  const ord = one('SELECT kind, user_id FROM bot_orders WHERE pp_id = ?', ppId);
  if (ord?.kind === 'renew_web') {   // produženje sa stranice kupca ili iz aplikacije: nazad na stranicu naloga
    const u = one('SELECT sub_token FROM users WHERE id = ?', ord.user_id);
    const back = u ? `/s/${u.sub_token}` : '/';
    if (url.pathname.endsWith('/cancel')) { run("UPDATE bot_orders SET status = 'cancelled' WHERE pp_id = ? AND status = 'created'", ppId); res.writeHead(302, { location: back }); return res.end(); }
    try { await capture(ppId); } catch (e) { console.error('paypal renew', e); }
    res.writeHead(302, { location: `${back}?placeno=1` }); return res.end();
  }
  if (ord?.kind === 'site') {   // kupovina sa sajta: nazad na sajt
    if (url.pathname.endsWith('/cancel')) { run("UPDATE bot_orders SET status = 'cancelled' WHERE pp_id = ? AND status = 'created'", ppId); res.writeHead(302, { location: '/#cijene' }); return res.end(); }
    try { await capture(ppId); } catch (e) { console.error('paypal site', e); }
    res.writeHead(302, { location: `/kupljeno?pp=${ppId}` }); return res.end();
  }
  if (url.pathname.endsWith('/cancel')) {
    const o = one('SELECT * FROM bot_orders WHERE pp_id = ?', ppId);
    if (o && o.status === 'created') {
      run("UPDATE bot_orders SET status = 'cancelled' WHERE id = ?", o.id);
      require('./cbot').send(o.chat, 'Plaćanje je otkazano. Kad budeš spreman, pošalji /start i izaberi plan ponovo.').catch(() => {});
    }
    return send(res, 200, page('Plaćanje otkazano', 'Ništa nije naplaćeno. Možeš izabrati plan ponovo u botu.', false).replace('__BTN__', await btn()), h);
  }
  let r;
  try { r = await capture(ppId); } catch (e) { r = { error: e.message }; }
  if (r.done) {
    const t = r.order.kind === 'buy' ? 'Tvoj VPN nalog je spreman. Link i QR kod su ti stigli u Telegram.' : 'Nalog je produžen. Potvrda ti je stigla u Telegram.';
    return send(res, 200, page('Plaćeno, hvala!', t, true).replace('__BTN__', await btn()), h);
  }
  const t = r.pending ? 'PayPal još obrađuje uplatu. Čim prođe, javit ćemo ti u Telegramu (obično za minut).' : 'Uplata još nije potvrđena. Ako je novac skinut, nalog stiže u Telegram za par minuta. Ako ne, javi se podršci.';
  return send(res, 200, page('Provjeravam uplatu…', t, false).replace('__BTN__', await btn()), h);
}

/** Svake minute: narudžbe koje je kupac platio ali nije se vratio na stranicu. */
let busy = false;
async function sweep() {
  if (busy || !ready()) return;
  busy = true;
  try {
    const list = all("SELECT * FROM bot_orders WHERE status = 'created' AND pp_id IS NOT NULL ORDER BY id DESC LIMIT 20");
    for (const o of list) {
      if (now() - o.created_at > 6 * 3600000) { run("UPDATE bot_orders SET status = 'expired' WHERE id = ?", o.id); continue; }
      const g = await pp('GET', `/v2/checkout/orders/${encodeURIComponent(o.pp_id)}`).catch(() => null);
      if (g?.ok && (g.j.status === 'APPROVED' || g.j.status === 'COMPLETED')) await capture(o.pp_id).catch((e) => console.error('paypal sweep', e));
    }
  } finally { busy = false; }
}

/** Za dugme "Provjeri PayPal". */
async function test() {
  const s = settings.load();
  if (!OK_CUR.includes(s.currency || 'EUR')) throw new Error(`PayPal ne podržava valutu ${s.currency}. Prebaci na EUR, USD ili CHF.`);
  await token();
  return { mode: s.paypal_mode || 'live' };
}

module.exports = { ready, createOrder, capture, handle, sweep, test, money, OK_CUR };
