'use strict';
// Pretplatni link za aplikacije (Hiddify, v2rayNG, Streisand…) i stranica za kupca u browseru.
const { one, run, now, dayKey } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const QR = require('../public/qr.js');
const { send, esc, clientIp } = require('./http');
const { geoIp } = require('./notify');
const cbot = require('./cbot');

// znak brenda (štit sa V) i neutralni štit za white-label
const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" fill="#121216"/><path d="M100 22 174 50v52c0 46-29 80-74 97z" fill="#000" fill-opacity=".18"/><path d="M48 70h32l20 68v46z" fill="#E3172B"/><path d="M152 70h-32l-20 68v46z" fill="#9E0C1A"/><path d="M48 70h32l2 7H51z" fill="#FF4A5A"/><path d="M86 58h28l-14 38z" fill="#FF4A5A"/><path d="M100 58h14l-14 38z" fill="#E3172B"/>';
const PLAIN = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="m62 112 28 28 52-58" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>';

// aplikacije: ime, platforme, dubinski link za uvoz pretplate
const APPS = {
  hiddify: { name: 'Hiddify', os: 'Android, iPhone, Windows, Mac', href: (l, n) => `hiddify://import/${l}#${encodeURIComponent(n)}` },
  v2rayng: { name: 'v2rayNG', os: 'Android', href: (l, n) => `v2rayng://install-sub?url=${encodeURIComponent(l)}&name=${encodeURIComponent(n)}` },
  streisand: { name: 'Streisand', os: 'iPhone, Mac', href: (l, n) => `streisand://import/${l}#${encodeURIComponent(n)}` },
  v2box: { name: 'V2Box', os: 'iPhone, Android', href: (l, n) => `v2box://install-sub?url=${encodeURIComponent(l)}&name=${encodeURIComponent(n)}` },
  happ: { name: 'Happ', os: 'iPhone, Android, Windows', href: (l) => `happ://add/${l}` },
  shadowrocket: { name: 'Shadowrocket', os: 'iPhone (plaćena)', href: (l) => `shadowrocket://add/sub://${Buffer.from(l).toString('base64')}` },
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const APP_UA = /v2ray|hiddify|streisand|sing-box|singbox|clash|nekobox|nekoray|shadowrocket|quantumult|foxray|v2box|karing|happ|stash|surge|loon|mihomo|okhttp|dart/i;

function fmtBytes(n) {
  if (!n) return '0 GB';
  const gb = n / 1024 ** 3;
  return gb >= 100 ? `${gb.toFixed(0)} GB` : gb >= 1 ? `${gb.toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`;
}

async function countCountry(req) {
  const ip = clientIp(req);
  if (one('SELECT 1 AS x FROM servers WHERE host = ?', ip)) return;   // aplikacija osvježava kroz VPN
  const g = await geoIp(ip);
  if (g?.cc) run('INSERT INTO countries (day, cc, n) VALUES (?, ?, 1) ON CONFLICT(day, cc) DO UPDATE SET n = n + 1', dayKey(now(), settings.get('timezone')), g.cc);
}

function page(u, link, s, owner, botName) {
  const st = vpn.userStatus(u);
  const label = { active: 'Aktivan', expiring: 'Ističe uskoro', grace: 'Istekao (grace period)', expired: 'Istekao', limited: 'Potrošen promet', disabled: 'Ugašen', devices: 'Previše uređaja (privremeno)' }[st];
  const color = { active: '#3ddc84', expiring: '#f5a524', grace: '#f5a524', expired: '#ff4d5e', limited: '#ff8a4d', disabled: '#9a9aa8', devices: '#ff8a4d' }[st];
  const wl = s.res_whitelabel && owner?.brand;
  const support = (wl ? owner.contact : s.support_contact) || '';
  const apps = String(s.apps || 'hiddify').split(',').filter((k) => APPS[k]);
  const pname = wl ? owner.brand : (s.sub_name || s.brand);
  const used = u.traffic_up + u.traffic_down, pct = u.traffic_limit ? Math.min(100, used / u.traffic_limit * 100) : 0;
  const days = Math.ceil((u.expires_at - now()) / vpn.DAY);
  const servers = vpn.serversForUser(u);
  const wg = s.proto_wg ? servers.filter((sv) => sv.wg_pub) : [];
  const enc = encodeURIComponent(link);
  const brand = esc(wl ? owner.brand : s.brand);
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brand} · moj nalog</title><meta name="robots" content="noindex">
<style>
:root{--bg:#0a0a0d;--card:#121218;--line:#22222b;--text:#f2f2f5;--muted:#a5a5b2;--red:#e5233a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:520px;margin:0 auto;padding:22px 16px 40px;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
h1{margin:0;font-size:22px}h2{margin:0 0 10px;font-size:16px}.muted{color:var(--muted);font-size:13px}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:var(--red)}
.qr{background:#fff;border-radius:12px;padding:10px;width:220px;margin:6px auto 12px;display:block}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;border:1px solid #2c2c37;color:var(--text);text-decoration:none;font-weight:600;background:none;font:inherit;cursor:pointer;width:100%}
.btn.red{background:#d81f35;border:0;color:#fff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.link{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted);word-break:break-all;text-align:center}
details{border-top:1px solid var(--line);padding:10px 0}details:first-of-type{border-top:0}summary{cursor:pointer;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:14px}.dot{width:9px;height:9px;border-radius:50%}
.note{background:#1d1810;border:1px solid #3d3216;color:#f5c46a;border-radius:12px;padding:12px;font-size:14px}
</style></head><body><main>
<div style="display:flex;align-items:center;gap:10px"><svg width="34" height="38" viewBox="0 0 200 224" aria-hidden="true">${wl ? PLAIN : MARK}</svg><h1>${brand}</h1></div>
${s.sub_announce ? `<div class="note">${esc(s.sub_announce)}</div>` : ''}
${s.maintenance ? `<div class="note">${esc(s.maintenance_msg)}</div>` : ''}
<section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="muted">Nalog</div><div style="font-weight:700;font-size:18px">${esc(u.username)}</div></div>
<span class="badge" style="color:${color}"><span class="dot" style="background:${color}"></span>${label}</span></div>
<div style="margin-top:12px"><div class="row"><span class="muted">Ističe</span><span>${new Date(u.expires_at).toLocaleDateString('bs-BA')}${days > 0 ? ` · još ${days} ${days === 1 ? 'dan' : 'dana'}` : ''}</span></div>
<div class="row"><span class="muted">Promet</span><span>${fmtBytes(used)}${u.traffic_limit ? ` od ${fmtBytes(u.traffic_limit)}` : ' · neograničeno'}</span></div>
${u.traffic_limit ? `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}</div></section>
<section class="card"><h2>Spoji se u 3 koraka</h2>
<p class="muted" style="margin:0 0 6px">1. Instaliraj aplikaciju &nbsp; 2. Uvezi profil &nbsp; 3. Klikni Spoji</p>
${QR.svg(link).replace('<svg ', '<svg class="qr" role="img" aria-label="QR kod za uvoz u aplikaciju" ')}
<div class="link">${esc(link)}</div>
<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
${apps.map((k, n) => `<a class="btn${n === 0 ? ' red' : ''}" href="${esc(APPS[k].href(link, pname))}">Otvori u ${APPS[k].name}</a>`).join('')}
<button class="btn" type="button" onclick="navigator.clipboard.writeText('${esc(link)}').then(()=>{this.textContent='Kopirano ✓'})">Kopiraj link</button>
</div></section>
<section class="card"><h2>Aplikacije</h2>
${apps.map((k, n) => `<details${n === 0 ? ' open' : ''}><summary>${APPS[k].name} · <span class="muted">${APPS[k].os}</span></summary><p class="muted">Instaliraj ${APPS[k].name} iz App Storea, Google Playa ili sa njihove stranice. Zatim klikni "Otvori u ${APPS[k].name}" gore, ili u aplikaciji klikni + i skeniraj QR kod / zalijepi link.</p></details>`).join('')}
</section>
${botName ? `<section class="card"><h2>Podsjetnici na Telegram</h2><p class="muted" style="margin-top:0">${u.tg_chat ? 'Telegram je povezan ✓ Javit ćemo ti prije isteka.' : 'Poveži Telegram i javit ćemo ti prije nego nalog istekne. Možeš i pitati za stanje naloga.'}</p>
<a class="btn" href="https://t.me/${esc(botName)}?start=${esc(u.sub_token)}">${u.tg_chat ? 'Otvori bota' : 'Poveži Telegram'}</a></section>` : ''}
${wg.length ? `<section class="card"><h2>WireGuard (rezervna opcija)</h2><p class="muted" style="margin-top:0">Za službenu WireGuard aplikaciju. Preuzmi fajl ili skeniraj QR u aplikaciji.</p>
${wg.map((sv) => `<div class="row"><span>${vpn.FLAGS(sv.country)} ${esc(sv.city || sv.name)}</span><span><a href="${esc(link)}/wg/${sv.id}" style="color:#ff5a6a">Preuzmi</a> · <a href="${esc(link)}/wg/${sv.id}?qr=1" style="color:#ff5a6a">QR</a></span></div>`).join('')}</section>` : ''}
${support ? `<p class="muted" style="text-align:center">Podrška: ${esc(support)}</p>` : ''}
</main></body></html>`;
}

// podaci za Veltrix aplikaciju: nalog i gotovi sing-box outboundi za svaki server
function appJson(u, s, link) {
  const st = vpn.userStatus(u);
  const owner = u.owner_id ? one('SELECT brand, contact FROM admins WHERE id = ?', u.owner_id) : null;
  const wl = s.res_whitelabel && owner?.brand;
  const plan = u.plan_id ? one('SELECT name FROM plans WHERE id = ?', u.plan_id) : null;
  const ok = vpn.CAN_CONNECT.has(st);
  const servers = ok ? vpn.serversForUser(u).filter((sv) => sv.reality_pub).map((sv) => {
    const out = [];
    if (s.proto_vless) out.push({ type: 'vless', server: sv.host, server_port: sv.vless_port, uuid: u.uuid, flow: 'xtls-rprx-vision',
      tls: { enabled: true, server_name: sv.sni, utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: sv.reality_pub, short_id: sv.short_id } } });
    if (s.proto_ss) {
      const l = new URL(vpn.ssLink(u, sv));
      const [method, ...pw] = decodeURIComponent(l.username).split(':');
      out.push({ type: 'shadowsocks', server: sv.host, server_port: sv.ss_port || 8388, method, password: pw.join(':') });
    }
    return { id: sv.id, name: sv.name, city: sv.city || sv.name, country: (sv.country || '').toUpperCase(), host: sv.host, port: sv.vless_port, outbounds: out };
  }).filter((x) => x.outbounds.length) : [];
  return {
    brand: wl ? owner.brand : s.brand, support: (wl ? owner.contact : s.support_contact) || '', announce: s.sub_announce || '',
    username: u.username, plan: plan?.name || '', status: st, can_connect: ok, expires_at: u.expires_at, created_at: u.created_at,
    traffic_used: u.traffic_up + u.traffic_down, traffic_limit: u.traffic_limit, devices: u.devices, link, servers,
  };
}

async function handle(req, res, p) {
  const m = p.match(/^\/s\/([\w-]{8,40})(?:\/wg\/(\d+)|\/(app))?$/);
  if (!m) return send(res, 404, 'Not found');
  const u = one('SELECT * FROM users WHERE sub_token = ?', m[1]);
  if (!u) return send(res, 404, 'Link nije ispravan ili je zamijenjen novim.');
  const s = settings.load();
  const url = new URL(req.url, 'http://x');
  const base = (s.sub_url || s.panel_url || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/+$/, '');
  const link = `${base}/s/${u.sub_token}`;

  if (m[3]) return send(res, 200, appJson(u, s, link), { 'cache-control': 'no-store' });
  if (m[2]) {
    const sv = one('SELECT * FROM servers WHERE id = ? AND enabled = 1', Number(m[2]));
    if (!sv || !s.proto_wg || !vpn.serversForUser(u).some((x) => x.id === sv.id)) return send(res, 404, 'Server nije dostupan.');
    const conf = vpn.wgConfig(u, sv);
    if (url.searchParams.get('qr')) return send(res, 200, QR.svg(conf, { size: 360 }), { 'content-type': 'image/svg+xml' });
    const fname = `${(s.brand + '-' + (sv.city || sv.name)).replace(/[^\w-]+/g, '_').slice(0, 30)}.conf`;
    return send(res, 200, conf, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${fname}"` });
  }

  const ua = String(req.headers['user-agent'] || '');
  const wantsHtml = /text\/html/.test(String(req.headers.accept || '')) && /Mozilla/.test(ua) && !APP_UA.test(ua);
  countCountry(req).catch(() => {});
  const owner = u.owner_id ? one('SELECT brand, contact FROM admins WHERE id = ?', u.owner_id) : null;
  const wl = s.res_whitelabel && owner?.brand;
  if (wantsHtml && s.customer_page) return send(res, 200, page(u, link, s, owner, await cbot.username().catch(() => null)), { 'content-type': 'text/html; charset=utf-8' });

  const links = vpn.CAN_CONNECT.has(vpn.userStatus(u)) ? vpn.subLinks(u) : [];
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'profile-title': 'base64:' + b64(wl ? owner.brand : (s.sub_name || s.brand)),
    'profile-update-interval': String(s.sub_interval || 12),
    'subscription-userinfo': `upload=${u.traffic_up}; download=${u.traffic_down}; total=${u.traffic_limit}; expire=${Math.floor(u.expires_at / 1000)}`,
    'profile-web-page-url': link,
  };
  const sup = (wl ? owner.contact : s.support_contact) || '';
  if (sup) headers['support-url'] = sup.startsWith('http') ? sup : link;
  if (s.sub_announce) headers.announce = 'base64:' + b64(s.sub_announce);
  return send(res, 200, b64(links.join('\n')), headers);
}

module.exports = { handle };
