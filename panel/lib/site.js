'use strict';
// Javni sajt (glavna adresa servera): cijene i lokacije uživo iz panela, kupovina karticom (Stripe).
const fs = require('node:fs');
const path = require('node:path');
const { one, all, run, now, log, db } = require('./db');
const settings = require('./settings');
const core = require('./core');
const vpn = require('./vpn');
const QR = require('../public/qr.js');
const coupons = require('./coupons');
const { send, esc, readBody } = require('./http');

db.exec('CREATE TABLE IF NOT EXISTS purchases (session TEXT PRIMARY KEY, user_id INTEGER, email TEXT, ts INTEGER)');

const PUBLIC = path.join(__dirname, '..', 'public');
const SYSTEM = { username: 'sajt', role: 'owner', id: 0 };
const CUR = { EUR: '€', USD: '$', BAM: 'KM ', CHF: 'CHF ' };

// zadnji Android APK i Windows instalacija sa GitHuba (keš 1 sat)
let dl = { t: 0, apk: '', exe: '', page: '' };
async function downloads() {
  const repo = String(settings.get('app_repo') || 'maid-cyber/veltrix-app').trim();
  const page = `https://github.com/${repo}/releases`;
  if (now() - dl.t < 3600000 && dl.page === page) return dl;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=40`, { headers: { 'user-agent': 'veltrix-panel', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
    const list = r.ok ? await r.json() : [];
    const best = (prefix, ext) => list.filter((x) => !x.draft && String(x.tag_name).startsWith(prefix))
      .map((x) => ({ n: Number(String(x.tag_name).replace(/\D+/g, '')) || 0, a: (x.assets || []).find((a) => a.name.endsWith(ext)), ts: Date.parse(x.published_at) || 0 }))
      .filter((x) => x.a).sort((a, b) => b.n - a.n)[0];
    const a = best('build-', '.apk'), w = best('win-', '.exe');
    dl = { t: now(), apk: a?.a?.browser_download_url || '', exe: w?.a?.browser_download_url || '', page,
      apkBuild: a?.n || 0, exeBuild: w?.n || 0, apkTs: a?.ts || 0, exeTs: w?.ts || 0 };
  } catch { dl = { ...dl, t: now() - 3000000, page }; }
  return dl;
}

function base(req) {
  const s = settings.load();
  return (s.sub_url || s.panel_url || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/+$/, '');
}

function siteData(d) {
  const s = settings.load();
  const plans = all('SELECT id, name, days, price, traffic_gb, devices FROM plans WHERE active = 1 AND trial = 0 AND price > 0 ORDER BY sort, id');
  const off = Number(s.offline_sec || 45) * 1000, t = now();
  const servers = all("SELECT country, city, name, last_seen, maintenance, tags FROM servers WHERE enabled = 1 AND host != '' AND country != ''")
    .filter((sv) => !String(sv.tags || '').split(',').includes('dedicated'));
  const byCountry = new Map();
  for (const sv of servers) {
    const cc = String(sv.country || '').toUpperCase() || '—';
    const on = sv.last_seen && t - sv.last_seen < off * 4 && !sv.maintenance;
    const c = byCountry.get(cc) || { cc, cities: new Set(), online: false };
    c.cities.add(sv.city || sv.name); c.online = c.online || !!on;
    byCountry.set(cc, c);
  }
  return {
    brand: s.brand || 'Veltrix VPN', currency: CUR[s.currency] || '€', support: s.support_contact || '',
    buy: !!(s.stripe_on && s.stripe_secret), plans,
    countries: [...byCountry.values()].map((c) => ({ cc: c.cc, cities: [...c.cities], online: c.online })),
    servers: servers.length, protocols: { vless: !!s.proto_vless, ss: !!s.proto_ss, wg: !!s.proto_wg },
    blocks: { ads: !!s.block_ads, malware: !!s.block_malware },
    // preuzimanje ide sa tvoje adrese (panel skine sa GitHuba i čuva kod sebe)
    apk: d.apk ? '/download/android' : '', exe: d.exe ? '/download/windows' : '', releases: d.page,
    coupons: !!one('SELECT id FROM coupons WHERE active = 1 AND (expires_at = 0 OR expires_at > ?) AND (max_uses = 0 OR used < max_uses) LIMIT 1', now()),
  };
}

async function page(req, res) {
  const data = siteData(await downloads());
  const html = fs.readFileSync(path.join(PUBLIC, 'site.html'), 'utf8')
    .replace(/__BRAND__/g, esc(data.brand))
    .replace('/*__DATA__*/', `window.SITE=${JSON.stringify(data).replace(/</g, '\\u003c')};`);
  return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
}

// POST /buy {plan_id, email} → Stripe Checkout
async function buy(req, res) {
  const s = settings.load();
  if (!s.stripe_on || !s.stripe_secret) return send(res, 400, { error: 'Kupovina karticom trenutno nije dostupna.' });
  const b = await readBody(req, 4096).catch(() => ({}));
  const plan = one('SELECT * FROM plans WHERE id = ? AND active = 1 AND trial = 0 AND price > 0', Number(b.plan_id));
  if (!plan) return send(res, 400, { error: 'Plan nije dostupan.' });
  const email = String(b.email || '').trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return send(res, 400, { error: 'Upiši ispravnu e-mail adresu.' });
  const site = base(req);
  let k;
  try { k = coupons.apply(b.coupon, plan); } catch (e) { return send(res, 400, { error: e.message }); }
  const form = new URLSearchParams({
    mode: 'payment', customer_email: email,
    success_url: `${site}/kupljeno?s={CHECKOUT_SESSION_ID}`, cancel_url: `${site}/#cijene`,
    'metadata[purpose]': 'buy', 'metadata[plan_id]': String(plan.id), 'metadata[email]': email,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': String(s.currency || 'EUR').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(k.price * 100)),
    'line_items[0][price_data][product_data][name]': `${s.brand} · ${plan.name}${k.coupon ? ` (kod ${k.coupon.code})` : ''}`,
  });
  if (k.coupon) { form.set('metadata[coupon_id]', String(k.coupon.id)); form.set('metadata[discount]', String(k.discount)); }
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { authorization: `Bearer ${s.stripe_secret}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: `Stripe: ${j.error?.message || r.status}` });
  log('sajt', 'Kupovina započeta na sajtu', `${plan.name} · ${email}`);
  return send(res, 200, { url: j.url });
}

/** Stripe potvrdio kupovinu sa sajta: napravi nalog (jednom po uplati) i pošalji pristup na e-mail. */
function paidBuy(ses, siteBase) {
  if (one('SELECT session FROM purchases WHERE session = ?', ses.id)) return;
  const plan = one('SELECT * FROM plans WHERE id = ?', Number(ses.metadata?.plan_id));
  if (!plan) return;
  const email = String(ses.metadata?.email || ses.customer_details?.email || ses.customer_email || '').slice(0, 120);
  const amount = (ses.amount_total || 0) / 100;
  const id = core.createUser(SYSTEM, { plan_id: plan.id, email, paid: amount, method: 'Stripe (kartica)', note: 'Kupljeno na sajtu', contact: email });
  run('INSERT INTO purchases (session, user_id, email, ts) VALUES (?,?,?,?)', ses.id, id, email, now());
  coupons.used(ses, id);
  const trx = one('SELECT id FROM transactions WHERE user_id = ? AND ext_id IS NULL ORDER BY id DESC LIMIT 1', id);
  if (trx) run('UPDATE transactions SET ext_id = ? WHERE id = ?', ses.id, trx.id);
  const u = one('SELECT * FROM users WHERE id = ?', id);
  const s = settings.load();
  const b = (s.sub_url || s.panel_url || siteBase || '').replace(/\/+$/, '');
  if (email && b) {
    const mail = require('./mail');
    if (mail.configured()) {
      require('./welcome').send(u.id, 'buy', email, b).catch((e) => log('sistem', 'E-mail kupcu nije poslan', String(e.message || e), 'warn'));
    }
  }
  log('sajt', 'Kupljeno na sajtu', `${u.username} · ${plan.name} · €${amount}`);
}

// GET /buy/status?s=cs_... → {ready, link, qr}
function status(req, res, url) {
  const sid = String(url.searchParams.get('s') || '');
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sid)) return send(res, 400, { error: 'bad' });
  const p = one('SELECT * FROM purchases WHERE session = ?', sid);
  if (!p) return send(res, 200, { ready: false });
  const u = one('SELECT sub_token, username FROM users WHERE id = ?', p.user_id);
  if (!u) return send(res, 200, { ready: false });
  const link = `${base(req)}/s/${u.sub_token}`;
  return send(res, 200, { ready: true, link, username: u.username, qr: QR.svg(link) });
}

function bought(req, res) {
  const s = settings.load();
  const html = `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.brand)} · hvala</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#050916;color:#f1f4fb;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
main{max-width:460px;width:100%;background:#0b1226;border:1px solid #1c2747;border-radius:20px;padding:30px;text-align:center}h1{margin:0 0 6px;font-size:26px}.m{color:#9aa6c2}
.qr{background:#fff;border-radius:14px;padding:10px;width:220px;margin:18px auto}.qr svg{display:block;width:100%;height:auto}
.l{font:13px ui-monospace,Consolas,monospace;word-break:break-all;color:#c5cde0;background:#070c1d;border:1px solid #1c2747;border-radius:10px;padding:10px}
a.b,button{display:block;width:100%;margin-top:12px;padding:14px;border-radius:12px;border:0;background:linear-gradient(180deg,#ff4a5a,#e3172b);color:#fff;font:600 16px system-ui;text-decoration:none;cursor:pointer}
.sp{width:34px;height:34px;border:3px solid #223056;border-top-color:#ff4a5a;border-radius:50%;margin:20px auto;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body><main id="m"><h1>Hvala na kupovini! 🎉</h1><p class="m">Pravimo tvoj nalog, traje par sekundi…</p><div class="sp"></div></main>
<script>const s=new URLSearchParams(location.search).get('s');let n=0;
function t(){fetch('/buy/status?s='+encodeURIComponent(s)).then(r=>r.json()).then(j=>{if(j.ready){document.getElementById('m').innerHTML='<h1>Spreman si ✅</h1><p class="m">Nalog <b>'+j.username+'</b>. Skeniraj QR kod u aplikaciji ili otvori link. Link smo poslali i na tvoj e-mail.</p><div class="qr">'+j.qr+'</div><div class="l">'+j.link+'</div><a class="b" href="'+j.link+'">Otvori moj nalog i aplikacije</a><button onclick="navigator.clipboard.writeText(\\''+j.link+'\\').then(()=>this.textContent=\\'Kopirano ✓\\')">Kopiraj link</button>';}else if(++n<40)setTimeout(t,3000);else document.getElementById('m').innerHTML='<h1>Uplata primljena</h1><p class="m">Nalog se još pravi. Provjeri e-mail za par minuta ili se javi podršci${s.support_contact ? ': ' + esc(s.support_contact) : ''}.</p>';}).catch(()=>setTimeout(t,4000))}t();</script></body></html>`;
  return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8' });
}

/** Zadnji poznati buildovi bez čekanja mreže (osvježi u pozadini). */
function downloadsCached() { downloads().catch(() => {}); return dl; }

module.exports = { page, buy, paidBuy, status, bought, siteData, downloads, downloadsCached };
