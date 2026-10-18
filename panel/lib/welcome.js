'use strict';
// E-mail kupcu sa pristupom: link naloga, plan, datum isteka, aplikacije i 3 koraka.
// Šalje se sam kad napraviš kupca sa e-mailom, kad mu daš novi link i kad kupi na sajtu.
const { one, log } = require('./db');
const settings = require('./settings');
const mail = require('./mail');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACCENT = { crvena: '#E3172B', plava: '#2F6BFF', zelena: '#16A34A', 'ljubičasta': '#7C3AED' };

function build(u, kind, baseOverride = '') {
  const s = settings.load();
  const base = (s.sub_url || s.panel_url || baseOverride || '').replace(/\/+$/, '');
  if (!base) return null;
  const owner = u.owner_id ? one('SELECT brand, contact, brand_color FROM admins WHERE id = ?', u.owner_id) : null;
  const wl = s.res_whitelabel && owner?.brand;
  const brand = wl ? owner.brand : s.brand || 'Veltrix VPN';
  const support = (wl ? owner.contact : s.support_contact) || '';
  const color = (wl && owner.brand_color) || ACCENT[s.accent] || '#E3172B';
  const link = `${base}/s/${u.sub_token}`;
  const plan = u.plan_id ? one('SELECT name FROM plans WHERE id = ?', u.plan_id) : null;
  const tz = s.timezone || 'Europe/Sarajevo';
  const until = new Date(u.expires_at).toLocaleDateString('bs-BA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const apps = String(s.apps || '').split(',');
  const veltrix = apps.includes('veltrix') && !wl;
  const dl = veltrix ? `https://github.com/${s.app_repo || 'maid-cyber/veltrix-app'}/releases` : '';

  const head = { new: 'Tvoj VPN je spreman ✅', newlink: 'Tvoj novi pristupni link', buy: 'Hvala na kupovini! Tvoj VPN je spreman ✅' }[kind] || 'Tvoj VPN pristup';
  const intro = kind === 'newlink'
    ? 'Napravili smo ti novi pristupni link. Stari više ne radi, pa ovaj novi uvezi u aplikaciju.'
    : 'Ispod je tvoj lični pristupni link. Ne dijeli ga ni sa kim: s njim se bilo ko može spojiti na tvoj nalog.';
  const subject = { new: `${brand} · tvoj pristup`, newlink: `${brand} · novi pristupni link`, buy: `${brand} · tvoj pristup` }[kind] || `${brand} · pristup`;
  const appLine = veltrix ? `${brand} aplikacija (Android i Windows): ${dl}\nZa iPhone: Hiddify ili Streisand iz App Storea.` : 'Aplikacija: Hiddify (iPhone, Android, računar), besplatna u App Storeu i Google Playu.';

  const text = `${head}

${intro}

Korisnik: ${u.username}
Plan: ${plan?.name || '—'}
Vrijedi do: ${until}

Tvoj pristupni link:
${link}

Kako se spojiti:
1. Instaliraj aplikaciju. ${appLine}
2. Otvori link iznad na telefonu ili računaru: tamo su QR kod i dugme koje sve podesi samo.
3. U aplikaciji klikni Spoji se.
${support ? `\nPomoć: ${support}` : ''}
${brand}`;

  const step = (n, t, d) => `<tr><td style="padding:0 0 14px 0;vertical-align:top;width:34px"><div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font:700 13px/26px Arial,sans-serif;text-align:center">${n}</div></td><td style="padding:0 0 14px 8px;font:15px/1.5 Arial,sans-serif;color:#1f2430"><b>${t}</b><br><span style="color:#5b6170">${d}</span></td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f3f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0d0f16;padding:22px 28px;font:800 20px/1 Arial,sans-serif;color:#fff;letter-spacing:.5px">${esc(brand)}</td></tr>
<tr><td style="height:4px;background:${color}"></td></tr>
<tr><td style="padding:28px 28px 8px">
  <h1 style="margin:0 0 10px;font:700 22px/1.3 Arial,sans-serif;color:#11131a">${esc(head)}</h1>
  <p style="margin:0 0 20px;font:15px/1.55 Arial,sans-serif;color:#454b59">${esc(intro)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;border-radius:10px;margin-bottom:22px"><tr><td style="padding:14px 18px;font:14px/1.9 Arial,sans-serif;color:#454b59">
    Korisnik: <b style="color:#11131a">${esc(u.username)}</b><br>Plan: <b style="color:#11131a">${esc(plan?.name || '—')}</b><br>Vrijedi do: <b style="color:#11131a">${esc(until)}</b>
  </td></tr></table>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 10px"><tr><td style="border-radius:10px;background:${color}">
    <a href="${esc(link)}" style="display:inline-block;padding:14px 28px;font:700 16px Arial,sans-serif;color:#fff;text-decoration:none">Otvori moj nalog i spoji se</a>
  </td></tr></table>
  <p style="margin:0 0 24px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#8a8f9c;word-break:break-all">${esc(link)}</p>
  <h2 style="margin:0 0 14px;font:700 16px Arial,sans-serif;color:#11131a">Kako se spojiti</h2>
  <table role="presentation" cellpadding="0" cellspacing="0">
    ${step(1, 'Instaliraj aplikaciju', veltrix ? `<a href="${esc(dl)}" style="color:${color}">${esc(brand)} za Android i Windows</a>. Za iPhone: Hiddify ili Streisand iz App Storea.` : 'Hiddify (iPhone, Android, računar), besplatna u App Storeu i Google Playu.')}
    ${step(2, 'Otvori link iznad', 'Na telefonu ili računaru. Tamo su QR kod i dugme koje sve podesi samo.')}
    ${step(3, 'Klikni Spoji se', 'I to je to. Lokaciju mijenjaš kad hoćeš.')}
  </table>
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #eceef3;font:13px/1.6 Arial,sans-serif;color:#8a8f9c">
  ${support ? `Treba ti pomoć? Javi se: <b style="color:#454b59">${esc(support)}</b><br>` : ''}Ne dijeli ovaj link: on je tvoj lični ključ.
</td></tr></table>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Pošalji kupcu pristup na e-mail. Vraća true ako je poslano (ili krenulo). */
async function send(userId, kind = 'new', to = null, base = '') {
  const u = one('SELECT * FROM users WHERE id = ?', Number(userId));
  const addr = String(to || u?.email || '').trim();
  if (!u || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(addr) || !mail.configured()) return false;
  const m = build(u, kind, base);
  if (!m) { log('sistem', 'E-mail kupcu nije poslan', 'Upiši Adresu panela u Postavke → Općenito', 'warn'); return false; }
  await mail.sendMail({ to: addr, subject: m.subject, text: m.text, html: m.html });
  return true;
}

/** Bez čekanja (za kreiranje kupca): greška ide u logove. */
function sendLater(userId, kind) {
  const u = one('SELECT username, email FROM users WHERE id = ?', Number(userId));
  if (!u?.email || !mail.configured()) return false;
  send(userId, kind).then((ok) => { if (ok) { require('./core').history(Number(userId), `Pristup poslan na e-mail ${u.email}`); } })
    .catch((e) => log('sistem', 'E-mail kupcu nije poslan', `${u.username}: ${e.message || e}`, 'warn'));
  return true;
}

module.exports = { build, send, sendLater };
