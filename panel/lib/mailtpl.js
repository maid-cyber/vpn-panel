'use strict';
// Zajednički izgled e-mailova (tamna tema kao panel i aplikacija, štit logo, boja akcenta).
// Pozadine su slike (linear-gradient), a tekst ide kroz gm-* blokove, da Gmail tamni način ne obrne boje.
const settings = require('./settings');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACCENT = { crvena: '#E3172B', plava: '#2F6BFF', zelena: '#16A34A', 'ljubičasta': '#7C3AED' };
const F = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = { BG: '#0b0b10', CARD: '#14141c', CARD2: '#1c1c27', LINE: '#2a2a37', TXT: '#f2f2f6', SOFT: '#b9b9c6', MUTED: '#8e8e9c' };
const bg = (c) => `background-color:${c};background-image:linear-gradient(${c},${c})`;
const t = (h) => `<div class="gm-s"><div class="gm-d">${h}</div></div>`;

function base(fallback = '') {
  const s = settings.load();
  return (s.panel_url || s.sub_url || fallback || '').replace(/\/+$/, '');
}

/**
 * Napravi HTML e-mail.
 * o = { brand?, color?, logo?, head, intro, stats?: [[k,v]...], rows?: [[k,v]...], cta?: {href,label}, note?, steps?: [[naslov, opis]...], extra?: html, footer? }
 */
function layout(o) {
  const s = settings.load();
  const brand = o.brand || s.brand || 'AdiLink VPN';
  const color = o.color || ACCENT[s.accent] || '#E3172B';
  const logo = o.logo || (base() ? `${base()}/mail/logo.png` : '');
  const m = brand.trim().match(/^(.*?)\s+vpn$/i) || brand.trim().match(/^vpn\s+(.*)$/i);
  const main = ((m ? m[1] : brand) || brand).toUpperCase();
  const word = `${esc(main.slice(0, -1))}<span style="color:${color}">${esc(main.slice(-1))}</span>`;
  const stat = (k, v, w) => `<td width="${w}%" style="padding:14px 10px;text-align:center;${F}">${t(`<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.MUTED}">${esc(k)}</div><div style="font-size:16px;font-weight:700;color:${C.TXT};margin-top:4px">${v}</div>`)}</td>`;
  const row = (k, v) => `<tr><td style="padding:9px 16px;border-top:1px solid ${C.LINE};${F};font-size:14px">${t(`<span style="color:${C.MUTED}">${esc(k)}</span>`)}</td><td align="right" style="padding:9px 16px;border-top:1px solid ${C.LINE};${F};font-size:14px">${t(`<b style="color:${C.TXT}">${v}</b>`)}</td></tr>`;
  const step = (n, title, d) => `<tr><td style="padding:0 0 16px 0;vertical-align:top;width:40px"><div style="width:32px;height:32px;border-radius:50%;${bg(color)};${F};font-weight:800;font-size:14px;line-height:32px;text-align:center;color:#fff">${t(n)}</div></td><td style="padding:3px 0 16px 12px;${F};font-size:15px;line-height:1.5">${t(`<b style="color:${C.TXT}">${title}</b><br><span style="color:${C.SOFT};font-size:14px">${d}</span>`)}</td></tr>`;
  const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;padding:17px 34px;border-radius:14px;${bg(color)};${F};font-weight:700;font-size:16px;color:#ffffff;text-decoration:none">${t(esc(label))}</a>`;
  const n = o.stats?.length || 0;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
u + .body .gm-s { background:#000; mix-blend-mode:screen; }
u + .body .gm-d { background:#000; mix-blend-mode:difference; }
a { color:inherit; }
@media (max-width:480px) { .px { padding-left:20px !important; padding-right:20px !important; } .h1 { font-size:21px !important; } }
</style></head>
<body class="body" style="margin:0;padding:0;${bg(C.BG)}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg(C.BG)}"><tr><td align="center" style="padding:30px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td align="center" style="padding:4px 0 24px">
  ${logo ? `<img src="${esc(logo)}" width="58" height="65" alt="" style="display:block;border:0;margin:0 auto 12px;height:65px;width:auto">` : ''}
  ${t(`<div style="${F};font-weight:900;font-size:26px;letter-spacing:5px;color:${C.TXT}">${word}</div>${m ? `<div style="${F};font-weight:700;font-size:11px;letter-spacing:7px;color:${color};margin-top:6px">V P N</div>` : ''}`)}
  ${o.badge ? t(`<div style="${F};font-size:12px;font-weight:700;letter-spacing:2px;color:${C.MUTED};margin-top:10px">${esc(o.badge)}</div>`) : ''}
</td></tr>
<tr><td style="${bg(C.CARD)};border:1px solid ${C.LINE};border-top:4px solid ${color};border-radius:20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td class="px" style="padding:32px 30px 10px">
    ${t(`<div class="h1" style="${F};font-weight:800;font-size:24px;line-height:1.3;color:${C.TXT};margin:0 0 10px">${esc(o.head)}</div><div style="${F};font-size:15px;line-height:1.6;color:${C.SOFT};margin:0 0 24px">${o.intro}</div>`)}
    ${n ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg(C.CARD2)};border:1px solid ${C.LINE};border-radius:14px;margin-bottom:22px"><tr>${o.stats.map(([k, v]) => stat(k, v, Math.floor(100 / n))).join('')}</tr></table>` : ''}
    ${o.rows?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg(C.CARD2)};border:1px solid ${C.LINE};border-radius:14px;margin-bottom:24px;border-collapse:separate"><tr><td colspan="2" style="height:0;font-size:0;line-height:0"></td></tr>${o.rows.map(([k, v]) => row(k, v)).join('')}</table>` : ''}
    ${o.cta ? `<div style="text-align:center;margin:0 0 12px">${btn(o.cta.href, o.cta.label)}</div>${t(`<div style="text-align:center;${F};font-size:12px;line-height:1.5;color:${C.MUTED};word-break:break-all;margin:0 0 24px">${esc(o.cta.href)}</div>`)}` : ''}
    ${o.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${bg('#221a0c')};border:1px solid #4a3a16;border-radius:12px;margin:0 0 24px"><tr><td style="padding:12px 16px;${F};font-size:14px;line-height:1.5">${t(`<span style="color:#f5c46a">${o.note}</span>`)}</td></tr></table>` : ''}
    ${o.steps?.length ? `${t(`<div style="${F};font-weight:700;font-size:15px;color:${C.TXT};margin:0 0 16px">${esc(o.stepsTitle || 'Kako početi')}</div>`)}<table role="presentation" cellpadding="0" cellspacing="0">${o.steps.map(([a, b], i) => step(i + 1, a, b)).join('')}</table>` : ''}
    ${o.extra || ''}
  </td></tr>
  <tr><td class="px" style="padding:18px 30px 22px;border-top:1px solid ${C.LINE};${F};font-size:13px;line-height:1.6">${t(`<span style="color:${C.MUTED}">${o.footer || (s.support_contact ? `Pitanja? Javi se: <b style="color:${C.TXT}">${esc(s.support_contact)}</b>` : 'Pitanja? Odgovori na ovaj e-mail.')}</span>`)}</td></tr>
  </table>
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;${F};font-size:12px;line-height:1.6">${t(`<span style="color:#6c6c7a">© ${new Date().getFullYear()} ${esc(brand)}</span>`)}</td></tr>
</table>
</td></tr></table></body></html>`;
  return html;
}

module.exports = { layout, esc, base, ACCENT };
