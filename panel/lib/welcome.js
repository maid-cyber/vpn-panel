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

  // izgled kao aplikacija i panel: tamna pozadina, crveni akcenat, štit logo, ime sa zadnjim slovom u boji
  const logo = wl ? `${base}/mail/logo/${u.owner_id}.png` : `${base}/mail/logo.png`;
  const m = brand.trim().match(/^(.*?)\s+vpn$/i) || brand.trim().match(/^vpn\s+(.*)$/i);
  const main = ((m ? m[1] : brand) || brand).toUpperCase();
  const word = `${esc(main.slice(0, -1))}<span style="color:${color}">${esc(main.slice(-1))}</span>`;
  const F = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const BG = '#0b0b10', CARD = '#14141c', CARD2 = '#1b1b25', LINE = '#262632', TXT = '#ececf1', SOFT = '#b4b4c2', MUTED = '#8b8b99';
  const step = (n, t, d) => `<tr><td style="padding:0 0 16px 0;vertical-align:top;width:38px"><div style="width:30px;height:30px;border-radius:50%;background:${color};color:#fff;${F};font-weight:700;font-size:14px;line-height:30px;text-align:center">${n}</div></td><td style="padding:2px 0 16px 10px;${F};font-size:15px;line-height:1.5;color:${TXT}"><b>${t}</b><br><span style="color:${SOFT};font-size:14px">${d}</span></td></tr>`;
  const html = `<!doctype html><html><head><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td align="center" style="padding:6px 0 22px">
  <img src="${esc(logo)}" width="64" height="72" alt="${esc(brand)}" style="display:block;border:0;margin:0 auto 12px;max-height:72px;width:auto">
  <div style="${F};font-weight:900;font-size:26px;letter-spacing:4px;color:${TXT}">${word}</div>
  ${m ? `<div style="${F};font-weight:600;font-size:12px;letter-spacing:6px;color:${color};margin-top:4px">V P N</div>` : ''}
</td></tr>
<tr><td style="background:${CARD};border:1px solid ${LINE};border-radius:18px;overflow:hidden">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="height:4px;background:${color};border-radius:18px 18px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:30px 28px 6px">
    <h1 style="margin:0 0 10px;${F};font-weight:700;font-size:23px;line-height:1.3;color:${TXT}">${esc(head)}</h1>
    <p style="margin:0 0 22px;${F};font-size:15px;line-height:1.6;color:${SOFT}">${esc(intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD2};border:1px solid ${LINE};border-radius:12px;margin-bottom:24px"><tr><td style="padding:16px 18px;${F};font-size:14px;line-height:2;color:${MUTED}">
      Korisnik&nbsp;&nbsp;<b style="color:${TXT}">${esc(u.username)}</b><br>Plan&nbsp;&nbsp;<b style="color:${TXT}">${esc(plan?.name || '—')}</b><br>Vrijedi do&nbsp;&nbsp;<b style="color:${TXT}">${esc(until)}</b>
    </td></tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 12px"><tr><td align="center" style="border-radius:14px;background:${color};box-shadow:0 8px 24px ${color}55">
      <a href="${esc(link)}" style="display:inline-block;padding:16px 32px;${F};font-weight:700;font-size:16px;color:#ffffff;text-decoration:none">Otvori moj nalog i spoji se</a>
    </td></tr></table>
    <p style="margin:0 0 28px;text-align:center;${F};font-size:12px;line-height:1.5;color:${MUTED};word-break:break-all">${esc(link)}</p>
    <div style="${F};font-weight:600;font-size:15px;color:${SOFT};margin:0 0 14px">Kako se spojiti</div>
    <table role="presentation" cellpadding="0" cellspacing="0">
      ${step(1, 'Instaliraj aplikaciju', veltrix ? `<a href="${esc(dl)}" style="color:${color};text-decoration:none;font-weight:600">${esc(brand)} za Android i Windows</a>. Za iPhone: Hiddify ili Streisand iz App Storea.` : 'Hiddify (iPhone, Android, računar), besplatna u App Storeu i Google Playu.')}
      ${step(2, 'Otvori link iznad', 'Na telefonu ili računaru. Tamo su QR kod i dugme koje sve podesi samo.')}
      ${step(3, 'Klikni Spoji se', 'I to je to. Lokaciju mijenjaš kad hoćeš.')}
    </table>
  </td></tr>
  <tr><td style="padding:18px 28px 24px;border-top:1px solid ${LINE};${F};font-size:13px;line-height:1.7;color:${MUTED}">
    ${support ? `Treba ti pomoć? <b style="color:${TXT}">${esc(support)}</b><br>` : ''}🔒 Ne dijeli ovaj link: on je tvoj lični ključ.
  </td></tr>
  </table>
</td></tr>
<tr><td align="center" style="padding:18px 0 0;${F};font-size:12px;color:#5d5d6b">© ${new Date().getFullYear()} ${esc(brand)}</td></tr>
</table>
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
