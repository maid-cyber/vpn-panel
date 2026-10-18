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
  const brand = wl ? owner.brand : s.brand || 'AdiLink VPN';
  const support = (wl ? owner.contact : s.support_contact) || '';
  const color = (wl && owner.brand_color) || ACCENT[s.accent] || '#E3172B';
  const link = `${base}/s/${u.sub_token}`;
  const plan = u.plan_id ? one('SELECT name FROM plans WHERE id = ?', u.plan_id) : null;
  const tz = s.timezone || 'Europe/Sarajevo';
  const until = new Date(u.expires_at).toLocaleDateString('bs-BA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const apps = String(s.apps || '').split(',');
  const veltrix = apps.includes('veltrix') && !wl;
  // aplikacije se skidaju sa tvoje adrese (/download/…), ne sa GitHuba
  const dl = veltrix ? `${base}/download/android` : '';
  const dlWin = veltrix ? `${base}/download/windows` : '';

  const head = { new: 'Tvoj VPN je spreman ✅', newlink: 'Tvoj novi pristupni link', buy: 'Hvala na kupovini! Tvoj VPN je spreman ✅' }[kind] || 'Tvoj VPN pristup';
  const intro = kind === 'newlink'
    ? 'Napravili smo ti novi pristupni link. Stari više ne radi, pa ovaj novi uvezi u aplikaciju.'
    : 'Ispod je tvoj lični pristupni link. Ne dijeli ga ni sa kim: s njim se bilo ko može spojiti na tvoj nalog.';
  const subject = { new: `${brand} · tvoj pristup`, newlink: `${brand} · novi pristupni link`, buy: `${brand} · tvoj pristup` }[kind] || `${brand} · pristup`;
  const appLine = veltrix ? `${brand} za Android: ${dl}\n${brand} za Windows: ${dlWin}\nZa iPhone: Hiddify ili Streisand iz App Storea.` : 'Aplikacija: Hiddify (iPhone, Android, računar), besplatna u App Storeu i Google Playu.';

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

  // izgled kao aplikacija i panel: tamna pozadina, akcenat brenda, štit logo, ime sa zadnjim slovom u boji.
  // Gmail na telefonu u tamnom načinu sam "obrne" boje (crveno postane plavo, tamno svijetlo).
  // Zato su pozadine slike (linear-gradient: Gmail ih ne dira), a tekst ide kroz gm-* blokove koji vrate pravu boju.
  const logo = wl ? `${base}/mail/logo/${u.owner_id}.png` : `${base}/mail/logo.png`;
  const m = brand.trim().match(/^(.*?)\s+vpn$/i) || brand.trim().match(/^vpn\s+(.*)$/i);
  const main = ((m ? m[1] : brand) || brand).toUpperCase();
  const F = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const BG = '#0b0b10', CARD = '#14141c', CARD2 = '#1c1c27', LINE = '#2a2a37', TXT = '#f2f2f6', SOFT = '#b9b9c6', MUTED = '#8e8e9c';
  const bg = (c) => `background-color:${c};background-image:linear-gradient(${c},${c})`;
  const t = (html) => `<div class="gm-s"><div class="gm-d">${html}</div></div>`;   // tekst koji Gmail ne smije obrnuti
  const word = `${esc(main.slice(0, -1))}<span style="color:${color}">${esc(main.slice(-1))}</span>`;
  let servers = [];
  try { servers = require('./vpn').serversForUser(u); } catch { /* */ }
  const countries = new Set(servers.map((x) => String(x.country || '').toUpperCase()).filter(Boolean)).size;
  const devices = u.devices || one('SELECT devices FROM plans WHERE id = ?', u.plan_id)?.devices || 0;
  const tg = (support.match(/@([A-Za-z0-9_]{4,})/) || [])[1];
  const supportUrl = /^https?:\/\//.test(support) ? support : tg ? `https://t.me/${tg}` : '';
  const btn = (href, label, fill) => `<a href="${esc(href)}" style="display:inline-block;padding:${fill ? '17px 34px' : '12px 18px'};border-radius:14px;${fill ? bg(color) : bg(CARD2) + `;border:1px solid ${LINE}`};${F};font-weight:700;font-size:${fill ? 16 : 14}px;color:#ffffff;text-decoration:none">${t(label)}</a>`;
  const stat = (k, v) => `<td width="33%" style="padding:14px 10px;text-align:center;${F}">${t(`<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">${k}</div><div style="font-size:16px;font-weight:700;color:${TXT};margin-top:4px">${v}</div>`)}</td>`;
  const step = (n, title, d) => `<tr><td style="padding:0 0 18px 0;vertical-align:top;width:40px"><div style="width:32px;height:32px;border-radius:50%;${bg(color)};${F};font-weight:800;font-size:14px;line-height:32px;text-align:center;color:#fff">${t(n)}</div></td><td style="padding:3px 0 18px 12px;${F};font-size:15px;line-height:1.5">${t(`<b style="color:${TXT}">${title}</b><br><span style="color:${SOFT};font-size:14px">${d}</span>`)}</td></tr>`;
  const badge = (x) => `<td style="padding:0 4px 8px"><div style="${bg(CARD2)};border:1px solid ${LINE};border-radius:20px;padding:7px 12px;${F};font-size:12px;white-space:nowrap">${t(`<span style="color:${SOFT}">${x}</span>`)}</div></td>`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
u + .body .gm-s { background:#000; mix-blend-mode:screen; }
u + .body .gm-d { background:#000; mix-blend-mode:difference; }
a { color:inherit; }
@media (max-width:480px) { .px { padding-left:20px !important; padding-right:20px !important; } .h1 { font-size:21px !important; } }
</style></head>
<body class="body" style="margin:0;padding:0;${bg(BG)}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg(BG)}"><tr><td align="center" style="padding:30px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td align="center" style="padding:4px 0 24px">
  <img src="${esc(logo)}" width="58" height="65" alt="" style="display:block;border:0;margin:0 auto 12px;height:65px;width:auto">
  ${t(`<div style="${F};font-weight:900;font-size:26px;letter-spacing:5px;color:${TXT}">${word}</div>${m ? `<div style="${F};font-weight:700;font-size:11px;letter-spacing:7px;color:${color};margin-top:6px">V P N</div>` : ''}`)}
</td></tr>
<tr><td style="${bg(CARD)};border:1px solid ${LINE};border-top:4px solid ${color};border-radius:20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td class="px" style="padding:32px 30px 8px">
    ${t(`<div class="h1" style="${F};font-weight:800;font-size:24px;line-height:1.3;color:${TXT};margin:0 0 10px">${esc(head)}</div><div style="${F};font-size:15px;line-height:1.6;color:${SOFT};margin:0 0 24px">${esc(intro)}</div>`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg(CARD2)};border:1px solid ${LINE};border-radius:14px;margin-bottom:26px"><tr>
      ${stat('Plan', esc(plan?.name || '—'))}${stat('Vrijedi do', esc(until.replace(/\s\d{4}\.?$/, '')))}${stat('Uređaja', devices || '—')}
    </tr><tr><td colspan="3" style="border-top:1px solid ${LINE};padding:11px 14px;text-align:center;${F};font-size:13px">${t(`<span style="color:${MUTED}">Korisnik</span>&nbsp; <b style="color:${TXT}">${esc(u.username)}</b>`)}</td></tr></table>
    <div style="text-align:center;margin:0 0 12px">${btn(link + '?open=1', 'Otvori u aplikaciji i spoji se', true)}</div>
    ${t(`<div style="text-align:center;${F};font-size:12px;line-height:1.5;color:${MUTED};margin:0 0 22px">Na telefonu: dugme otvori aplikaciju i sve podesi samo.</div>`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg(CARD2)};border:1px solid ${LINE};border-radius:14px;margin:0 0 26px"><tr>
      <td width="132" style="padding:14px"><img src="${esc(link)}/qr.png" width="116" height="116" alt="QR kod" style="display:block;border:0;border-radius:8px;width:116px;height:116px"></td>
      <td style="padding:14px 16px 14px 4px;${F};font-size:14px;line-height:1.5;vertical-align:middle">${t(`<b style="color:${TXT}">Čitaš ovo na računaru?</b><br><span style="color:${SOFT}">Otvori aplikaciju na telefonu, klikni <b style="color:${TXT}">Skeniraj QR kod</b> i usmjeri kameru na ovaj kod.</span>`)}</td>
    </tr></table>
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 26px"><tr>
      ${badge('🔒 Bez logova')}${s.proto_vless ? badge('⚡ VLESS Reality') : ''}${countries ? badge(`🌍 ${countries} ${countries === 1 ? 'zemlja' : countries < 5 ? 'zemlje' : 'zemalja'}`) : ''}
    </tr></table>
    ${t(`<div style="${F};font-weight:700;font-size:15px;color:${TXT};margin:0 0 16px">Kako se spojiti</div>`)}
    <table role="presentation" cellpadding="0" cellspacing="0">
      ${step(1, 'Instaliraj aplikaciju', veltrix ? `${esc(brand)} za Android ili Windows (dugmad ispod). Za iPhone: Hiddify iz App Storea.` : 'Hiddify (iPhone, Android, računar), besplatna u App Storeu i Google Playu.')}
      ${step(2, 'Klikni crveno dugme iznad', 'Otvori se aplikacija i sama uveze tvoj nalog. Na računaru možeš skenirati QR kod telefonom.')}
      ${step(3, 'Dozvoli VPN i spoji se', 'Telefon jednom pita za dozvolu za VPN: klikni OK. Lokaciju mijenjaš kad hoćeš.')}
    </table>
    ${veltrix ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr>
      <td width="50%" style="padding-right:6px">${btn(dl, '🤖 Android', false).replace('display:inline-block', 'display:block;text-align:center')}</td>
      <td width="50%" style="padding-left:6px">${btn(dlWin, '🪟 Windows', false).replace('display:inline-block', 'display:block;text-align:center')}</td>
    </tr></table>` : ''}
  </td></tr>
  <tr><td class="px" style="padding:20px 30px 24px;border-top:1px solid ${LINE}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="${F};font-size:13px;line-height:1.6;vertical-align:middle">${t(`<span style="color:${TXT};font-weight:700">Treba ti pomoć?</span><br><span style="color:${MUTED}">${support ? esc(support) : 'Odgovori na ovaj e-mail.'}</span>`)}</td>
      ${supportUrl ? `<td align="right" style="vertical-align:middle">${btn(supportUrl, tg ? 'Piši na Telegram' : 'Kontakt', false)}</td>` : ''}
    </tr></table>
  </td></tr>
  </table>
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;${F};font-size:12px;line-height:1.6">${t(`<span style="color:#6c6c7a">🔒 Ne dijeli ovaj link: on je tvoj lični ključ.<br>© ${new Date().getFullYear()} ${esc(brand)}</span>`)}</td></tr>
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
