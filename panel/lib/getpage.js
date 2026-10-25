'use strict';
// Lijepa stranica za preuzimanje aplikacije (/preuzmi). Android i Windows idu
// direktno s naše adrese (panel skine zadnji build s GitHuba i čuva ga), iPhone
// privremeno preko Hiddify. QR kod je za otvaranje ove stranice na telefonu.
const settings = require('./settings');
const site = require('./site');
const QR = require('../public/qr.js');
const { send, esc } = require('./http');

const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" fill="#121216"/><path d="M100 52 100 104 82 164H54z" fill="#E3172B"/><path d="M100 52 146 164h-28l-18-60z" fill="#9E0C1A"/><path d="M90.5 128h19l4.5 14h-28z" fill="#FF4A5A"/><path d="M100 52 111 78H89z" fill="#FF4A5A"/>';

const ICON = {
  android: '<path d="M6 9h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M8 9a4 4 0 0 1 8 0M9 5 8 3m7 2 1-2M4 11v4m16-4v4"/>',
  windows: '<path d="M3 5.5 10.5 4.5v7H3zM12 4.3 21 3v8.5h-9zM3 12.5h7.5v7L3 18.5zM12 12.5h9V21l-9-1.3z"/>',
  apple: '<path d="M16 3c0 1.5-1.4 3-3 3 0-1.6 1.4-3 3-3zM19 16.5c-.5 1.2-1.7 3.5-3.2 3.5-1 0-1.3-.6-2.5-.6s-1.6.6-2.5.6C7.8 20 6 16.4 6 13.6 6 11 7.8 9.5 9.5 9.5c1 0 1.9.7 2.5.7s1.4-.7 2.6-.7c1 0 2 .4 2.7 1.3-2.3 1.4-2 4.6.2 5.7z"/>',
};

function wordmark(brand) {
  const b = String(brand || 'AdiLink VPN').replace(/\s+vpn$/i, '');
  return `${esc(b.slice(0, -1).toUpperCase())}<em>${esc(b.slice(-1).toUpperCase())}</em>`;
}

function card({ icon, name, meta, desc, href, btn, dl, note }) {
  return `<article class="app">
    <div class="app-h"><span class="app-i">${svg(icon)}</span><div><h3>${esc(name)}</h3><p class="meta">${esc(meta)}</p></div></div>
    <p class="app-d">${esc(desc)}</p>
    <a class="dl${dl ? '' : ' ghost'}" href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : dl ? ' download' : ''}>${svg('down')}${esc(btn)}</a>
    ${note ? `<p class="note">${note}</p>` : ''}
  </article>`;
}

const svg = (n) => n === 'down'
  ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>'
  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`;

async function page(req) {
  const s = settings.load();
  const brand = s.brand || 'AdiLink VPN';
  const d = await site.downloads();
  const base = (s.panel_url || s.sub_url || `https://${req.headers.host}`).replace(/\/+$/, '');
  const legal = s.legal_on !== false;

  const androidHref = d.apk ? '/download/android' : (d.page || '#');
  const windowsHref = d.exe ? '/download/windows' : (d.page || '#');

  const cards = [
    card({
      icon: 'android', name: 'Android', meta: d.apkBuild ? `Verzija ${d.apkBuild} · Android 8+` : 'Android 8+',
      desc: 'Spajanje jednim dodirom, izbor servera, Kill Switch i test brzine. Probni nalog dobiješ u samoj aplikaciji.',
      href: androidHref, btn: 'Preuzmi za Android', dl: !!d.apk,
      note: 'Nakon skidanja otvori <b>.apk</b> fajl i dozvoli instalaciju iz nepoznatih izvora.',
    }),
    card({
      icon: 'windows', name: 'Windows', meta: d.exeBuild ? `Verzija ${d.exeBuild} · Windows 10 / 11` : 'Windows 10 / 11',
      desc: 'Ista aplikacija za računar: izbor servera, split tunneling i test brzine.',
      href: windowsHref, btn: 'Preuzmi za Windows', dl: !!d.exe,
      note: 'Pokreni <b>.exe</b> instalaciju. Ako Windows upozori, klikni „More info → Run anyway".',
    }),
    card({
      icon: 'apple', name: 'iPhone i Mac', meta: 'Privremeno preko Hiddify',
      desc: 'Instaliraj besplatnu aplikaciju Hiddify iz App Storea i otvori svoj link. Naša iPhone aplikacija stiže uskoro.',
      href: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532', btn: 'Preuzmi Hiddify', dl: false,
    }),
  ].join('');

  const qr = QR.svg(base + '/preuzmi', { size: 160 }).replace('<svg ', '<svg class="qrimg" role="img" aria-label="QR kod za ovu stranicu" ');

  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preuzmi · ${esc(brand)}</title><meta name="theme-color" content="#0b0b10">
<meta name="description" content="Preuzmi ${esc(brand)} za Android, Windows i iPhone. Jedan nalog, svi uređaji. Bez logova.">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<style>
:root{--bg:#0b0b10;--card:#14141c;--line:#24242f;--line2:#33333f;--text:#f2f2f6;--soft:#c3c3cf;--muted:#8e8e9c;--red:#e3172b;--red2:#ff4a5a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 "Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(900px 480px at 85% -12%,rgba(227,23,43,.18),transparent 60%),radial-gradient(700px 500px at 0% 110%,rgba(227,23,43,.08),transparent 55%)}
a{color:var(--red2);text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);background:rgba(11,11,16,.8);position:sticky;top:0;backdrop-filter:blur(12px);z-index:5}
header .wrap{display:flex;align-items:center;gap:11px;height:66px}
header .mk{width:26px;height:29px}
header b{font:800 19px "Segoe UI",system-ui,sans-serif;letter-spacing:.08em}
header b em{font-style:normal;color:var(--red)}
header a.back{margin-left:auto;color:var(--soft);font-size:14px}
header a.back:hover{color:var(--text)}
.hero{text-align:center;padding:54px 0 10px}
.hero h1{font-size:clamp(30px,5vw,46px);line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}
.hero h1 em{font-style:normal;color:var(--red2)}
.hero p{color:var(--soft);font-size:clamp(16px,2.2vw,19px);margin:0 auto;max-width:560px}
.badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:22px 0 0}
.badge{display:inline-flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:13.5px;color:var(--soft)}
.badge svg{width:15px;height:15px;color:var(--red2)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:40px 0 0}
.app{background:linear-gradient(180deg,var(--card),#101017);border:1px solid var(--line);border-radius:18px;padding:22px;display:flex;flex-direction:column;transition:border-color .2s,transform .2s}
.app:hover{border-color:var(--line2);transform:translateY(-3px)}
.app-h{display:flex;align-items:center;gap:13px;margin:0 0 14px}
.app-i{width:46px;height:46px;flex:0 0 46px;border-radius:12px;background:rgba(227,23,43,.12);border:1px solid rgba(227,23,43,.25);display:grid;place-items:center}
.app-i svg{width:25px;height:25px;color:var(--red2)}
.app h3{margin:0;font-size:19px}
.meta{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
.app-d{color:var(--soft);font-size:14.5px;margin:0 0 18px;flex:1}
.dl{display:inline-flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(180deg,#ff2b40,var(--red));color:#fff;font-weight:700;font-size:15px;padding:13px 16px;border-radius:12px;box-shadow:0 8px 22px -10px rgba(227,23,43,.8)}
.dl:hover{filter:brightness(1.07)}
.dl.ghost{background:#1b1b24;color:var(--text);border:1px solid var(--line2);box-shadow:none}
.note{margin:12px 0 0;font-size:12.5px;color:var(--muted);line-height:1.55}
.note b{color:var(--soft);font-weight:600}
.qrbox{display:flex;align-items:center;gap:20px;justify-content:center;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px 24px;margin:34px auto 0;max-width:430px}
.qrbox .qrimg{width:120px;height:120px;background:#fff;border-radius:10px;padding:8px;flex:0 0 120px}
.qrbox .qt h4{margin:0 0 6px;font-size:16px}
.qrbox .qt p{margin:0;color:var(--muted);font-size:13.5px;line-height:1.55}
.trial{text-align:center;color:var(--soft);font-size:14.5px;margin:30px auto 0;max-width:620px}
.trial b{color:var(--text)}
footer{border-top:1px solid var(--line);margin-top:48px;padding:26px 0 44px;color:var(--muted);font-size:14px}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
footer a{color:var(--muted)}footer a:hover{color:var(--text)}
@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{padding-top:38px}.qrbox{display:none}}
</style></head><body>
<header><div class="wrap">
  <svg class="mk" viewBox="0 0 200 224" aria-hidden="true">${MARK}</svg>
  <b>${wordmark(brand)}</b>
  <a class="back" href="/">← Nazad na sajt</a>
</div></header>
<main class="wrap">
  <section class="hero">
    <h1>Preuzmi <em>${wordmark(brand)}</em></h1>
    <p>Jedan nalog — svi uređaji. Spajanje jednim dodirom, bez logova.</p>
    <div class="badges">
      <span class="badge">${svg('down')}Direktno s naše adrese</span>
      <span class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>Bez reklama i logova</span>
      <span class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z"/></svg>Kill Switch</span>
    </div>
  </section>
  <section class="grid">${cards}</section>
  <section class="qrbox">
    ${qr}
    <div class="qt"><h4>Skeniraj telefonom</h4><p>Otvori kameru i uslikaj kod da otvoriš ovu stranicu direktno na telefonu.</p></div>
  </section>
  <p class="trial">Želiš prvo probati? U Android i Windows aplikaciji klikni <b>„Probaj besplatno"</b> i dobiješ probni nalog — bez kartice.</p>
</main>
<footer><div class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(brand)}</span>
  <span>${legal ? '<a href="/privatnost">Privatnost</a> · <a href="/uslovi">Uslovi</a> · ' : ''}<a href="/">Početna</a></span>
</div></footer>
</body></html>`;
}

async function handle(req, res) {
  const html = await page(req);
  return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
}

module.exports = { handle, page };
