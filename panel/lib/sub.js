'use strict';
// Pretplatni link za aplikacije (Hiddify, v2rayNG, Streisand…) i stranica za kupca u browseru.
const { one, all, run, now, dayKey } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const QR = require('../public/qr.js');
const { send, esc, clientIp } = require('./http');
const { geoIp } = require('./notify');
const cbot = require('./cbot');
const growth = require('./growth');

// znak brenda (štit sa V) i neutralni štit za white-label
const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" fill="#121216"/><path d="M100 22 174 50v52c0 46-29 80-74 97z" fill="#000" fill-opacity=".18"/><path d="M48 70h32l20 68v46z" fill="#E3172B"/><path d="M152 70h-32l-20 68v46z" fill="#9E0C1A"/><path d="M48 70h32l2 7H51z" fill="#FF4A5A"/><path d="M86 58h28l-14 38z" fill="#FF4A5A"/><path d="M100 58h14l-14 38z" fill="#E3172B"/>';
const PLAIN = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="m62 112 28 28 52-58" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>';

// aplikacije: ime, platforme, dubinski link za uvoz pretplate
const APPS = {
  veltrix: { name: 'Veltrix VPN', os: 'Android, Windows', href: (l) => `veltrix://import?url=${encodeURIComponent(l)}` },
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

function page(u, link, s, owner, botName, reqUrl) {
  const st = vpn.userStatus(u);
  const label = { active: 'Aktivan', expiring: 'Ističe uskoro', grace: 'Istekao (grace period)', expired: 'Istekao', limited: 'Potrošen promet', disabled: 'Ugašen', devices: 'Previše uređaja (privremeno)' }[st];
  const color = { active: '#3ddc84', expiring: '#f5a524', grace: '#f5a524', expired: '#ff4d5e', limited: '#ff8a4d', disabled: '#9a9aa8', devices: '#ff8a4d' }[st];
  const wl = s.res_whitelabel && owner?.brand;
  const support = (wl ? owner.contact : s.support_contact) || '';
  const apps = String(s.apps || 'hiddify').split(',').filter((k) => APPS[k] && !(wl && owner.brand_hide_app && k === 'veltrix'));
  if (!apps.length) apps.push('hiddify');
  // boja i logo resellera (white-label); boja je provjerena pri spremanju, ovdje još jednom
  const acc = wl && /^#[0-9a-f]{6}$/i.test(owner.brand_color || '') ? owner.brand_color : '#d81f35';
  const logo = wl && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(owner.brand_logo || '') ? owner.brand_logo : '';
  const pname = wl ? owner.brand : (s.sub_name || s.brand);
  const used = u.traffic_up + u.traffic_down, pct = u.traffic_limit ? Math.min(100, used / u.traffic_limit * 100) : 0;
  const days = Math.ceil((u.expires_at - now()) / vpn.DAY);
  const servers = vpn.serversForUser(u);
  const wg = s.proto_wg ? servers.filter((sv) => sv.wg_pub) : [];
  const enc = encodeURIComponent(link);
  const gi = growth.appInfo(u), renew = gi.renew, ref = gi.ref;
  const cur = ({ EUR: '€', USD: '$', BAM: 'KM ', CHF: 'CHF ' })[s.currency] || '€';
  const paid = /[?&]placeno=1/.test(reqUrl || '');
  const brand = esc(wl ? owner.brand : s.brand);
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brand} · moj nalog</title><meta name="robots" content="noindex">
<style>
:root{--bg:#0a0a0d;--card:#121218;--line:#22222b;--text:#f2f2f5;--muted:#a5a5b2;--red:${acc}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:520px;margin:0 auto;padding:22px 16px 40px;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
h1{margin:0;font-size:22px}h2{margin:0 0 10px;font-size:16px}.muted{color:var(--muted);font-size:13px}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:var(--red)}
.qr{background:#fff;border-radius:12px;padding:10px;width:220px;margin:6px auto 12px;display:block}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;border:1px solid #2c2c37;color:var(--text);text-decoration:none;font-weight:600;background:none;font:inherit;cursor:pointer;width:100%}
.btn.red{background:var(--red);border:0;color:#fff}.logo{width:40px;height:40px;border-radius:10px;object-fit:contain}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.link{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted);word-break:break-all;text-align:center}
details{border-top:1px solid var(--line);padding:10px 0}details:first-of-type{border-top:0}summary{cursor:pointer;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:14px}.dot{width:9px;height:9px;border-radius:50%}
.note{background:#1d1810;border:1px solid #3d3216;color:#f5c46a;border-radius:12px;padding:12px;font-size:14px}
</style></head><body><main>
<div style="display:flex;align-items:center;gap:10px">${logo ? `<img class="logo" src="${logo}" alt="">` : `<svg width="34" height="38" viewBox="0 0 200 224" aria-hidden="true">${wl ? PLAIN.replace('#E3172B', acc) : MARK}</svg>`}<h1>${brand}</h1></div>
${wl && owner.brand_welcome ? `<div class="note" style="background:#15151c;border-color:var(--line);color:var(--text)">${esc(owner.brand_welcome)}</div>` : ''}
${s.sub_announce ? `<div class="note">${esc(s.sub_announce)}</div>` : ''}
${s.maintenance ? `<div class="note">${esc(s.maintenance_msg)}</div>` : ''}
<section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="muted">Nalog</div><div style="font-weight:700;font-size:18px">${esc(u.username)}</div></div>
<span class="badge" style="color:${color}"><span class="dot" style="background:${color}"></span>${label}</span></div>
<div style="margin-top:12px"><div class="row"><span class="muted">Ističe</span><span>${new Date(u.expires_at).toLocaleDateString('bs-BA')}${days > 0 ? ` · još ${days} ${days === 1 ? 'dan' : 'dana'}` : ''}</span></div>
<div class="row"><span class="muted">Promet</span><span>${fmtBytes(used)}${u.traffic_limit ? ` od ${fmtBytes(u.traffic_limit)}` : ' · neograničeno'}</span></div>
${u.traffic_limit ? `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}</div></section>
${paid ? '<div class="note" style="background:#0f2419;border-color:#1b4a33;color:#5fe0a0">Hvala! Uplata je primljena, nalog se produžava za par sekundi. Osvježi stranicu.</div>' : ''}
${renew.length ? `<section class="card"><h2>Produži pretplatu</h2><p class="muted" style="margin-top:0">Plaćanje karticom (Stripe). Dani se dodaju na trenutni datum isteka.</p>
${one('SELECT id FROM coupons WHERE active = 1 AND (expires_at = 0 OR expires_at > ?) AND (max_uses = 0 OR used < max_uses) LIMIT 1', now()) ? '<input id="cpn" placeholder="Kod za popust (ako ga imaš)" autocomplete="off" style="width:100%;min-height:46px;border-radius:12px;border:1px solid #2c2c37;background:#0d0d12;color:var(--text);padding:0 12px;font:inherit;text-transform:uppercase;margin-bottom:8px;box-sizing:border-box">' : ''}
<div style="display:flex;flex-direction:column;gap:8px">${renew.map((pl) => `<button class="btn${pl === renew[0] ? ' red' : ''}" type="button" onclick="pay(${pl.id},this)">${esc(pl.name)} · ${pl.days} dana · ${esc(cur)}${pl.price}</button>`).join('')}</div>
<script>function pay(id,b){const o=b.textContent;b.disabled=true;b.textContent='Otvaram plaćanje…';fetch(location.pathname.replace(/[/]$/,'')+'/renew',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan_id:id,coupon:(document.getElementById('cpn')||{}).value||''})}).then(r=>r.json()).then(j=>{if(j.url)location.href=j.url;else{b.textContent=j.error||'Greška';setTimeout(()=>{b.textContent=o;b.disabled=false},3500)}}).catch(()=>{b.textContent='Greška, pokušaj ponovo';b.disabled=false})}</script></section>` : ''}
${ref ? `<section class="card"><h2>Pozovi prijatelja</h2><p class="muted" style="margin-top:0">Kad prijatelj instalira aplikaciju, upiše tvoj kod i prvi put plati, obojica dobijete ${ref.days} dana gratis.</p>
<div style="text-align:center;font:700 26px ui-monospace,Consolas,monospace;letter-spacing:3px;margin:8px 0">${esc(ref.code)}</div>
<div class="muted" style="text-align:center">Pozvano: ${ref.invited} · nagrađeno: ${ref.rewarded}</div></section>` : ''}
<section class="card"><h2>Spoji se u 3 koraka</h2>
<div id="smart"></div>
<div class="qrwrap"><p class="muted" style="margin:14px 0 4px;text-align:center" id="qrhint">Na računaru? U aplikaciji na telefonu klikni <b>Skeniraj QR kod</b> i usmjeri kameru ovdje:</p>
${QR.svg(link).replace('<svg ', '<svg class="qr" role="img" aria-label="QR kod za uvoz u aplikaciju" ')}</div>
<div class="link">${esc(link)}</div>
<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
<button class="btn" type="button" onclick="navigator.clipboard.writeText('${esc(link)}').then(()=>{this.textContent='Kopirano ✓'})">Kopiraj link</button>
</div>
<script>(function(){
var L=${JSON.stringify(link)},N=${JSON.stringify(pname)},V=${apps.includes('veltrix') ? 'true' : 'false'},ua=navigator.userAgent,
an=/Android/i.test(ua),ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/.test(ua)&&'ontouchend' in document),win=/Windows/i.test(ua),
base=L.slice(0,L.lastIndexOf('/s/')),e=encodeURIComponent,box=document.getElementById('smart'),open=/[?&]open=1/.test(location.search);
var vel='veltrix://import?url='+e(L),intent='intent://import?url='+e(L)+'#Intent;scheme=veltrix;package=com.veltrix.vpn;S.browser_fallback_url='+e(base+'/download/android')+';end',
hid='hiddify://import/'+L+'#'+e(N);
function b(h,t,red,sub){return '<a class="btn'+(red?' red':'')+'" href="'+h+'" style="flex-direction:column;gap:0">'+t+(sub?'<small style="font-weight:400;opacity:.8;font-size:12px">'+sub+'</small>':'')+'</a>'}
var h='',go='';
if(V&&an){go=intent;h=b(intent,'Otvori u aplikaciji i spoji se',1)+b(base+'/download/android','Nemam aplikaciju: preuzmi za Android',0,'Poslije instalacije vrati se ovdje i klikni dugme iznad')+'<p class="muted" style="margin:2px 0 0">Kod instalacije telefon može pitati da dozvoliš instaliranje iz ovog izvora: klikni Postavke → Dozvoli.</p>';}
else if(V&&win){go=vel;h=b(vel,'Otvori u Veltrix aplikaciji',1)+b(base+'/download/windows','Nemam aplikaciju: preuzmi za Windows',0,'Instaliraj, pa se vrati ovdje i klikni dugme iznad');}
else if(ios||!V&&an){go=hid;h=b(hid,'Otvori u Hiddify i spoji se',1)+b('https://hiddify.com/','Nemam aplikaciju: preuzmi Hiddify',0,ios?'Besplatna u App Storeu':'Besplatna u Google Playu');}
else{h='<p style="margin:0 0 4px;font-weight:600">Skeniraj QR kod telefonom</p><p class="muted" style="margin:0">Instaliraj aplikaciju na telefon, otvori je i klikni Skeniraj QR kod.</p>'+(V?'<div class="grid" style="margin-top:10px">'+b(base+'/download/android','Android',0)+b(base+'/download/windows','Windows',0)+'</div>':'');}
box.innerHTML='<div style="display:flex;flex-direction:column;gap:8px">'+h+'</div>';
if(an||ios){document.getElementById('qrhint').textContent='Ili na drugom uređaju skeniraj ovaj QR kod u aplikaciji:';}
if(open&&go){setTimeout(function(){location.href=go},350)}
})();</script></section>
<section class="card"><h2>Aplikacije</h2>
${apps.map((k, n) => k === 'veltrix'
    ? `<details${n === 0 ? ' open' : ''}><summary>Veltrix VPN · <span class="muted">Android, Windows</span></summary><p class="muted">Naša aplikacija. Preuzmi je, otvori i zalijepi link ili skeniraj QR kod.</p><div class="grid"><a class="btn" href="/download/android">Android</a><a class="btn" href="/download/windows">Windows</a></div></details>`
    : `<details${n === 0 ? ' open' : ''}><summary>${APPS[k].name} · <span class="muted">${APPS[k].os}</span></summary><p class="muted">Instaliraj ${APPS[k].name} iz App Storea, Google Playa ili sa njihove stranice. Zatim klikni "Otvori u ${APPS[k].name}" gore, ili u aplikaciji klikni + i skeniraj QR kod / zalijepi link.</p></details>`).join('')}
</section>
${botName ? `<section class="card"><h2>Podsjetnici na Telegram</h2><p class="muted" style="margin-top:0">${u.tg_chat ? 'Telegram je povezan ✓ Javit ćemo ti prije isteka.' : 'Poveži Telegram i javit ćemo ti prije nego nalog istekne. Možeš i pitati za stanje naloga.'}</p>
<a class="btn" href="https://t.me/${esc(botName)}?start=${esc(u.sub_token)}">${u.tg_chat ? 'Otvori bota' : 'Poveži Telegram'}</a></section>` : ''}
${wg.length ? `<section class="card"><h2>WireGuard (rezervna opcija)</h2><p class="muted" style="margin-top:0">Za službenu WireGuard aplikaciju. Preuzmi fajl ili skeniraj QR u aplikaciji.</p>
${wg.map((sv) => `<div class="row"><span>${vpn.FLAGS(sv.country)} ${esc(sv.city || sv.name)}</span><span><a href="${esc(link)}/wg/${sv.id}" style="color:var(--red)">Preuzmi</a> · <a href="${esc(link)}/wg/${sv.id}?qr=1" style="color:var(--red)">QR</a></span></div>`).join('')}</section>` : ''}
${support ? `<p class="muted" style="text-align:center">Podrška: ${esc(support)}</p>` : ''}
</main></body></html>`;
}

// prekidači iz stranice Aplikacija koji vrijede i prije prijave (GET /app/config)
function appFlags(s) {
  return {
    protocol: s.app_protocol !== false, ss_fallback: s.app_ss_fallback !== false, speedtest: s.app_speedtest !== false, diag: s.app_diag !== false,
    notify: s.app_notify !== false, look: s.app_look !== false, language: s.app_language !== false, lang_default: s.app_lang_default || 'auto',
    devices: s.app_devices !== false, support: s.app_support !== false, updates: s.app_updates !== false,
    min_android: Number(s.app_min_android) || 0, min_windows: Number(s.app_min_windows) || 0, update_msg: s.app_update_msg || '',
  };
}

/** Javna podešavanja za ekran prijave (nema naloga). */
function appConfig() {
  const s = settings.load();
  // zadnje verzije aplikacija: aplikacije se ažuriraju sa panela (/download/…), ne sa GitHuba
  let d = {};
  try { d = require('./site').downloadsCached() || {}; } catch { /* */ }
  return { brand: s.brand || 'Veltrix VPN', support: s.support_contact || '', trial: !!s.app_trial, ref: !!s.ref_on, features: appFlags(s),
    latest: { android: d.apkBuild || 0, windows: d.exeBuild || 0, android_url: '/download/android', windows_url: '/download/windows' } };
}

// zapamti koja aplikacija i verzija se javlja (za stranicu Aplikacija); UA: VeltrixVPN/Android/57
function noteApp(u, ua) {
  const m = /VeltrixVPN\/(Android|Windows)(?:\/(\d+))?/i.exec(String(ua || ''));
  if (!m) return;
  const os = m[1].toLowerCase(), build = Number(m[2]) || 0, t = Date.now();
  if (u.app_os === os && u.app_build === build && t - (u.app_seen || 0) < 3600000) return;
  run('UPDATE users SET app_os = ?, app_build = ?, app_seen = ? WHERE id = ?', os, build, t, u.id);
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
    return { id: sv.id, kind: 'server', name: sv.name, city: sv.city || sv.name, country: (sv.country || '').toUpperCase(), host: sv.host, port: sv.vless_port, tags: vpn.serverTags(sv), outbounds: out };
  }).filter((x) => x.outbounds.length) : [];
  // Double VPN / Multihop: kupac se spaja na ulazni server (port lanca), izlazi na zadnjem
  if (ok && s.proto_vless && s.app_chains !== false) {
    for (const { c, hops } of vpn.chainsForUser(u)) {
      const entry = hops[0], exit = hops[hops.length - 1];
      servers.push({
        id: 100000 + c.id, kind: vpn.chainKind(c), name: c.name, city: exit.city || exit.name, country: (exit.country || '').toUpperCase(),
        host: entry.host, port: c.port, tags: [vpn.chainKind(c)],
        hops: hops.map((sv) => ({ name: sv.name, city: sv.city || sv.name, country: (sv.country || '').toUpperCase() })),
        outbounds: [{ type: 'vless', server: entry.host, server_port: c.port, uuid: u.uuid, flow: 'xtls-rprx-vision',
          tls: { enabled: true, server_name: entry.sni, utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: entry.reality_pub, short_id: entry.short_id } } }],
      });
    }
  }
  const features = {
    killswitch: !!s.app_killswitch, dns: !!s.app_dns, dns_default: !!s.app_dns_def, split: !!s.app_split,
    ipleak: !!s.app_ipleak, ipleak_default: !!s.app_ipleak_def, webrtc: !!s.app_webrtc, webrtc_default: !!s.app_webrtc_def,
    boot: !!s.app_boot, history: !!s.app_history,
    dns_filters: [s.block_ads && 'ads', s.block_adult && 'adult', s.block_malware && 'malware'].filter(Boolean),
    ...appFlags(s),
  };
  const history = s.app_history ? all('SELECT ts, text FROM user_history WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id) : [];
  return {
    brand: wl ? owner.brand : s.brand, support: (wl ? owner.contact : s.support_contact) || '', announce: s.sub_announce || '',
    username: u.username, plan: plan?.name || '', status: st, can_connect: ok, expires_at: u.expires_at, created_at: u.created_at,
    traffic_used: u.traffic_up + u.traffic_down, traffic_limit: u.traffic_limit, devices: u.devices, devices_active: u.devices_seen || 0,
    last_seen: u.last_seen || 0, link, servers, features, history,
  };
}

async function handle(req, res, p) {
  const m = p.match(/^\/s\/([\w-]{8,40})(?:\/wg\/(\d+)|\/(app)|\/(renew)|\/(diag)|\/(qr\.png))?$/);
  if (!m) return send(res, 404, 'Not found');
  const u = one('SELECT * FROM users WHERE sub_token = ?', m[1]);
  if (!u) return send(res, 404, 'Link nije ispravan ili je zamijenjen novim.');
  const s = settings.load();
  const url = new URL(req.url, 'http://x');
  const base = (s.sub_url || s.panel_url || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/+$/, '');
  const link = `${base}/s/${u.sub_token}`;

  if (m[3]) { noteApp(u, req.headers['user-agent']); return send(res, 200, { ...appJson(u, s, link), ...growth.appInfo(u) }, { 'cache-control': 'no-store' }); }
  if (m[4] && req.method === 'POST') return growth.renew(req, res, u, link);
  if (m[6]) return send(res, 200, require('./qrpng').png(link), { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' });
  if (m[5]) { if (req.method !== 'POST') return send(res, 405, 'POST'); return require('./diag').receive(req, res, u); }
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
  const owner = u.owner_id ? one('SELECT brand, contact, brand_color, brand_logo, brand_welcome, brand_hide_app FROM admins WHERE id = ?', u.owner_id) : null;
  const wl = s.res_whitelabel && owner?.brand;
  if (wantsHtml && s.customer_page) return send(res, 200, page(u, link, s, owner, await cbot.username().catch(() => null), req.url), { 'content-type': 'text/html; charset=utf-8' });

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

module.exports = { handle, appConfig };
