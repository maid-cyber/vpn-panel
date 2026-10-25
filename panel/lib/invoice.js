'use strict';
// Profesionalna faktura za kupca: lijep e-mail (u stilu brenda) + javna stranica
// za štampu/PDF (/faktura/<id>.<potpis>). Šalje se kad kupac plati (sajt, bot, produženje).
// Gejtano postavkom mail_invoices (ista koja važi i za resellere).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { one, run, now, log, DATA_DIR } = require('./db');
const settings = require('./settings');
const mail = require('./mail');
const { layout, esc } = require('./mailtpl');
const { send } = require('./http');

// obojeni A-štit (za bijelu fakturu)
const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" fill="#121216"/><path d="M100 52 100 104 82 164H54z" fill="#E3172B"/><path d="M100 52 146 164h-28l-18-60z" fill="#9E0C1A"/><path d="M90.5 128h19l4.5 14h-28z" fill="#FF4A5A"/><path d="M100 52 111 78H89z" fill="#FF4A5A"/>';

function curSym() { const c = settings.get('currency') || 'EUR'; return c === 'EUR' ? '€' : c === 'USD' ? '$' : c + ' '; }
const fmt = (n) => `${curSym()}${Number(n || 0).toFixed(2)}`;

// stabilan tajni ključ (keyfile), neovisan o admin putanji — da linkovi faktura ne pucaju
let KEY;
function key() {
  if (KEY) return KEY;
  const f = path.join(DATA_DIR, 'invoice.key');
  try { KEY = fs.readFileSync(f, 'utf8').trim(); } catch { /* nema još */ }
  if (!KEY) { KEY = crypto.randomBytes(24).toString('hex'); try { fs.writeFileSync(f, KEY, { mode: 0o600 }); } catch { /* best effort */ } }
  return KEY;
}
// potpis u linku da se fakture ne mogu nabrajati (bez prijave)
function sig(id) {
  return crypto.createHmac('sha256', key()).update(String(id)).digest('hex').slice(0, 10);
}
const token = (id) => `${id}.${sig(id)}`;
function parseToken(tok) {
  const m = String(tok || '').match(/^(\d+)\.([a-f0-9]{10})$/);
  if (!m) return null;
  const id = Number(m[1]);
  return sig(id) === m[2] ? id : null;
}

function assignNo(t) {
  if (t.invoice_no) return t.invoice_no;
  const year = new Date(t.ts || now()).getFullYear();
  const no = `${settings.get('inv_prefix') || 'F-'}${year}-${String(t.id).padStart(4, '0')}`;
  run('UPDATE transactions SET invoice_no = ? WHERE id = ?', no, t.id);
  t.invoice_no = no;
  return no;
}

function details(t) {
  // kupac + stavka: iz naloga ako postoji, inače iz bilješke ("... · Plan")
  let buyer = t.note || '—', username = '', planName = '', period = '';
  if (t.user_id) {
    const u = one('SELECT username, email, contact, plan_id FROM users WHERE id = ?', t.user_id);
    if (u) {
      username = u.username;
      buyer = u.email || u.contact || u.username;
      const p = u.plan_id && one('SELECT name, days FROM plans WHERE id = ?', u.plan_id);
      if (p) { planName = p.name; period = p.days ? `${p.days} days` : ''; }
    }
  }
  if (!planName) planName = String(t.note || '').split('·').pop().trim() || 'VPN service';
  const kind = t.type === 'topup' ? 'Account credit' : (/produ|renew/i.test(t.note || '') ? 'Subscription renewal' : 'VPN subscription');
  return { buyer, username, planName, period, kind };
}

// ---------- javna stranica fakture (bijela, za štampu / PDF) ----------
function pageHtml(t) {
  const s = settings.load();
  const no = t.invoice_no || ('#' + t.id);
  const vat = Number(s.vat || 0);
  const net = vat ? t.amount / (1 + vat / 100) : t.amount;
  const d = details(t);
  const date = new Date(t.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const company = esc(s.inv_company || s.brand || 'VPN');
  const addr = esc(s.inv_address || '');
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faktura ${esc(no)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#eceef2;color:#1a1a22;font:15px/1.6 Arial,Helvetica,sans-serif}
.sheet{max-width:820px;margin:28px auto;background:#fff;border-radius:14px;box-shadow:0 10px 40px -16px rgba(0,0,0,.3);overflow:hidden}
.bar{height:6px;background:linear-gradient(90deg,#E3172B,#9E0C1A)}
.pad{padding:40px 46px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:13px}
.brand svg{width:46px;height:51px}
.brand .nm{font-weight:800;font-size:22px;letter-spacing:.04em}
.brand .nm em{font-style:normal;color:#E3172B}
.brand small{display:block;color:#666;font-size:12.5px;white-space:pre-line;margin-top:3px;font-weight:400;letter-spacing:0}
.inv{text-align:right}
.inv h1{margin:0;font-size:24px;letter-spacing:.02em}
.inv .no{color:#666;font-size:14px;margin-top:4px}
.paid{display:inline-block;margin-top:10px;background:#e7f6ec;color:#1a7f3c;border:1px solid #bfe6cc;font-weight:700;font-size:12.5px;letter-spacing:.08em;padding:5px 12px;border-radius:999px}
.meta{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin:34px 0 10px}
.meta .blk{min-width:200px}
.meta h4{margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#999}
.meta .big{font-size:15px;font-weight:700;color:#1a1a22}
.meta .sub{color:#666;font-size:13.5px}
table{width:100%;border-collapse:collapse;margin:26px 0 0}
th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;padding:0 0 10px;border-bottom:2px solid #ececf0}
td{padding:14px 0;border-bottom:1px solid #f0f0f4;vertical-align:top}
.r{text-align:right;white-space:nowrap}
.tot{margin:18px 0 0;margin-left:auto;width:290px}
.tot .ln{display:flex;justify-content:space-between;padding:7px 0;font-size:14.5px;color:#555}
.tot .grand{border-top:2px solid #1a1a22;margin-top:6px;padding-top:12px;font-size:19px;font-weight:800;color:#1a1a22}
.pay{margin:30px 0 0;background:#f7f7fa;border:1px solid #ededf2;border-radius:12px;padding:14px 18px;font-size:14px;color:#444}
.foot{margin:34px 0 0;padding-top:20px;border-top:1px solid #ececf0;color:#888;font-size:12.5px;line-height:1.7}
.btnbar{text-align:center;margin:0 0 26px}
.btn{display:inline-block;background:#E3172B;color:#fff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:11px;font-size:15px;border:0;cursor:pointer}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none}.btnbar{display:none}}
@media(max-width:560px){.pad{padding:26px 20px}.inv{text-align:left}}
</style></head><body>
<div class="btnbar" style="max-width:820px;margin:22px auto 0"><button class="btn" onclick="print()">Print / Save as PDF</button></div>
<div class="sheet"><div class="bar"></div><div class="pad">
  <div class="top">
    <div class="brand"><svg viewBox="0 0 200 224" aria-hidden="true">${MARK}</svg>
      <div><div class="nm">${company.slice(0, -1)}<em>${company.slice(-1)}</em></div>${addr ? `<small>${addr}</small>` : ''}</div>
    </div>
    <div class="inv"><h1>INVOICE</h1><div class="no">${esc(no)}</div><div class="paid">● PAID</div></div>
  </div>
  <div class="meta">
    <div class="blk"><h4>Bill to</h4><div class="big">${esc(d.buyer)}</div>${d.username ? `<div class="sub">Account: ${esc(d.username)}</div>` : ''}</div>
    <div class="blk" style="text-align:right"><h4>Date</h4><div class="big">${esc(date)}</div><div class="sub">Payment: ${esc(t.method || '—')}</div></div>
  </div>
  <table>
    <tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
    <tr><td><b>${esc(d.planName)}</b>${d.period ? `<br><span style="color:#888;font-size:13px">${esc(d.period)}</span>` : ''}<br><span style="color:#aaa;font-size:12.5px">${esc(d.kind)}</span></td><td class="r">1</td><td class="r">${fmt(net)}</td><td class="r">${fmt(net)}</td></tr>
  </table>
  <div class="tot">
    <div class="ln"><span>Subtotal</span><span>${fmt(net)}</span></div>
    ${vat ? `<div class="ln"><span>VAT ${vat}%</span><span>${fmt(t.amount - net)}</span></div>` : ''}
    <div class="ln grand"><span>Total</span><span>${fmt(t.amount)}</span></div>
  </div>
  <div class="pay">Paid via <b>${esc(t.method || '—')}</b> on ${esc(date)}. Amount paid in full — thank you!</div>
  <div class="foot">
    ${s.inv_company ? `${company} · ` : ''}${addr ? esc(addr.replace(/\n/g, ', ')) + ' · ' : ''}${s.support_contact ? `Contact: ${esc(s.support_contact)}` : ''}
    ${vat ? '' : '<br>VAT exempt.'}
    <br>Thank you for your business. This invoice was issued electronically and is valid without signature or stamp.
  </div>
</div></div>
</body></html>`;
}

// ---------- e-mail kupcu ----------
function email(t) {
  const s = settings.load();
  const no = assignNo(t);
  const vat = Number(s.vat || 0);
  const net = vat ? t.amount / (1 + vat / 100) : t.amount;
  const d = details(t);
  const base = (s.panel_url || s.sub_url || '').replace(/\/+$/, '');
  const link = base ? `${base}/faktura/${token(t.id)}` : '';
  const date = new Date(t.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const html = layout({
    badge: 'INVOICE',
    head: `Thank you for your purchase! 🎉`,
    intro: `Here's your receipt and invoice for your ${esc(s.brand)} subscription. Your payment was successful.`,
    stats: [['Invoice', esc(no)], ['Total', fmt(t.amount)], ['Date', date]],
    rows: [
      ['Service', esc(d.planName)],
      ...(d.period ? [['Duration', esc(d.period)]] : []),
      ...(vat ? [['Subtotal', fmt(net)], [`VAT ${vat}%`, fmt(t.amount - net)]] : []),
      ['Total', `${fmt(t.amount)}`],
      ['Payment method', esc(t.method || '—')],
    ],
    cta: link ? { href: link, label: 'Download invoice (PDF)' } : null,
    footer: `${s.inv_company ? `Issued by: <b style="color:#f2f2f6">${esc(s.inv_company)}</b><br>` : ''}${s.support_contact ? `Questions? Contact us: <b style="color:#f2f2f6">${esc(s.support_contact)}</b>` : 'Questions? Just reply to this email.'}`,
  });
  const text = `Invoice ${no} · ${s.brand}\n\n${d.planName}${d.period ? ' · ' + d.period : ''}\nTotal: ${fmt(t.amount)}\nPayment method: ${t.method || '—'}\nDate: ${date}\n${link ? '\nInvoice (PDF): ' + link : ''}\n\nThank you for your business!`;
  return { subject: `Invoice ${no} · ${s.brand}`, html, text };
}

/** Pošalji fakturu kupcu za njegovu zadnju uplatu (kupovina ili produženje). */
async function sendForUser(userId, to) {
  const addr = String(to || '').trim();
  if (!addr || !settings.get('mail_invoices') || !mail.configured()) return false;
  const t = one("SELECT * FROM transactions WHERE user_id = ? AND type = 'sale' ORDER BY id DESC LIMIT 1", Number(userId));
  if (!t || !(t.amount > 0)) return false;
  assignNo(t);
  const m = email(t);
  try {
    await mail.sendMail({ to: addr, subject: m.subject, text: m.text, html: m.html });
    log('sistem', 'Faktura poslana kupcu', `${t.invoice_no} → ${addr}`);
    return true;
  } catch (e) {
    log('sistem', 'Faktura kupcu nije poslana', String(e.message || e), 'warn');
    return false;
  }
}

/** GET /faktura/<id>.<potpis> → bijela faktura za štampu/PDF (javno, uz potpis). */
function handle(req, res, p) {
  const id = parseToken(p.replace(/^\/faktura\//, ''));
  if (!id) return send(res, 404, 'Invoice not found.');
  const t = one('SELECT * FROM transactions WHERE id = ?', id);
  if (!t) return send(res, 404, 'Invoice not found.');
  return send(res, 200, pageHtml(t), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
}

module.exports = { sendForUser, handle, token, pageHtml, email, assignNo };
