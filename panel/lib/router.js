'use strict';
// Detaljno uputstvo: kako ubaciti VPN na ruter (WireGuard). Javna stranica /ruter.
const settings = require('./settings');
const { send, esc } = require('./http');

const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" fill="#121216"/><path d="M100 52 100 104 82 164H54z" fill="#E3172B"/><path d="M100 52 146 164h-28l-18-60z" fill="#9E0C1A"/><path d="M90.5 128h19l4.5 14h-28z" fill="#FF4A5A"/><path d="M100 52 111 78H89z" fill="#FF4A5A"/>';

function wordmark(brand) {
  const b = String(brand || 'AdiLink VPN').replace(/\s+vpn$/i, '');
  return `${esc(b.slice(0, -1).toUpperCase())}<em>${esc(b.slice(-1).toUpperCase())}</em>`;
}

// jedan "vodič" za tip rutera: naslov, podnaslov i koraci
function guide(title, sub, steps, open) {
  return `<details class="g"${open ? ' open' : ''}><summary><span>${esc(title)}</span><small>${esc(sub)}</small></summary>
    <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></details>`;
}

function page(req) {
  const s = settings.load();
  const brand = s.brand || 'AdiLink VPN';
  const support = s.support_contact || '';

  const guides = [
    guide('GL.iNet (najlakše)', 'Putni ruteri — preporučeno', [
      'Spoji se na ruter (WiFi ili kabl) i u browseru otvori <b>192.168.8.1</b>, pa se prijavi.',
      'U lijevom meniju otvori <b>VPN → WireGuard Client</b>.',
      'Klikni <b>Add a New Profile</b> i izaberi karticu <b>Manual</b>.',
      'Zalijepi config koji si kopirao sa svog naloga (ili uploaduj <b>.conf</b> fajl), daj mu ime i klikni <b>Save</b>.',
      'Uključi prekidač (<b>Enable</b>). Kad piše "Connected", svi uređaji spojeni na ruter su na VPN-u.',
    ], true),
    guide('Asus', 'Novији firmware ili Asuswrt-Merlin', [
      'Prijavi se na ruter: u browseru otvori <b>router.asus.com</b> (ili <b>192.168.1.1</b>).',
      'Otvori <b>VPN → VPN Fusion</b> (na nekim modelima samo <b>WireGuard</b>) i klikni <b>Add profile</b>.',
      'Za protokol izaberi <b>WireGuard</b>, pa <b>Import .conf</b> i izaberi fajl koji si preuzeo (ili ručno prepiši polja iz configa).',
      'Klikni <b>Apply</b>, pa <b>Activate</b> da upališ tunel.',
      'Ako tvoj Asus nema WireGuard, instaliraj <b>Asuswrt-Merlin</b> firmware (besplatan) — tada dobiješ WireGuard.',
    ]),
    guide('OpenWrt', 'Napredno — pune mogućnosti', [
      'Instaliraj pakete: <code>opkg update</code> pa <code>opkg install wireguard-tools luci-proto-wireguard luci-app-wireguard</code> i restartuj ruter.',
      'U LuCI: <b>Network → Interfaces → Add new interface</b>. Ime npr. <b>vpn</b>, Protocol: <b>WireGuard VPN</b>.',
      'U kartici <b>General</b>: <b>Private Key</b> = vrijednost iz <code>[Interface] PrivateKey</code>; <b>IP Address</b> = <code>Address</code> iz configa (npr. 10.66.x.x/32).',
      'U kartici <b>Peers → Add peer</b>: <b>Public Key</b> iz <code>[Peer] PublicKey</code>, <b>Endpoint Host</b> i <b>Port</b> iz <code>Endpoint</code>, <b>Allowed IPs</b> = <code>0.0.0.0/0</code>, <b>Persistent Keep Alive</b> = 25, uključi <b>Route Allowed IPs</b>.',
      'DNS: u kartici <b>Advanced Settings</b> interfejsa upiši DNS iz configa (npr. 9.9.9.9).',
      '<b>Save & Apply</b>. Zatim <b>Network → Firewall</b>: dodaj interfejs <b>vpn</b> u zonu <b>wan</b> (da ima masquerade/NAT).',
    ]),
    guide('pfSense / OPNsense', 'Firewall distribucije', [
      'Instaliraj/omogući <b>WireGuard</b> paket (System → Package Manager na pfSense; ugrađen u OPNsense).',
      'Napravi <b>Tunnel</b>: upiši <b>Private Key</b> i <b>Address</b> iz <code>[Interface]</code>.',
      'Dodaj <b>Peer</b>: <b>Public Key</b>, <b>Endpoint</b> i <b>Port</b> iz <code>[Peer]</code>, <b>Allowed IPs</b> = <code>0.0.0.0/0</code>, keepalive 25.',
      'Dodijeli interfejs tunela (Interfaces → Assignments), omogući ga.',
      'Pod <b>Firewall → NAT → Outbound</b> dodaj pravilo (Hybrid) da LAN izlazi kroz WG interfejs, i dodaj <b>firewall rule</b> koje usmjerava LAN saobraćaj na gateway tunela.',
    ]),
    guide('Bilo koji WireGuard ruter', 'Ako tvoj ruter nije gore', [
      'Config ima dva dijela. <b>[Interface]</b> su <i>tvoji</i> podaci: <b>PrivateKey</b> (privatni ključ), <b>Address</b> (tvoja adresa u tunelu), <b>DNS</b>.',
      '<b>[Peer]</b> je server: <b>PublicKey</b> (javni ključ servera), <b>Endpoint</b> (adresa:port), <b>AllowedIPs</b> = 0.0.0.0/0 (sav saobraćaj kroz VPN), <b>PersistentKeepalive</b> = 25.',
      'U ruteru nađi WireGuard i prepiši svako polje na odgovarajuće mjesto — nazivi su isti ili skoro isti na svim ruterima.',
      'Snimi i uključi tunel.',
    ]),
  ].join('');

  const troubles = [
    ['Nema interneta nakon spajanja', 'Provjeri da je DNS upisan (npr. 9.9.9.9 ili 1.1.1.1). Ako stranice ne učitavaju, smanji <b>MTU</b> na WG interfejsu na <b>1412</b> (ili 1380).'],
    ['Ruter nema WireGuard', 'Ruteri od provajdera (Telekom, HT…) najčešće ne podržavaju WireGuard. Najlakše rješenje je mali <b>GL.iNet</b> putni ruter — zalijepiš config i gotovo. Alternativa: flashuj OpenWrt ili Asus-Merlin.'],
    ['VPN radi na ruteru ali ne na uređajima', 'Uključi <b>Route Allowed IPs</b> / "Redirect all traffic" i provjeri da je WG interfejs u <b>WAN</b> zoni (NAT/masquerade).'],
    ['Veza puca ili je spora', 'Provjeri da je <b>PersistentKeepalive</b> = 25. Probaj drugu lokaciju servera (drugi config).'],
  ].map(([q, a]) => `<details class="t"><summary>${esc(q)}</summary><p>${a}</p></details>`).join('');

  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPN na ruteru · ${esc(brand)}</title><meta name="theme-color" content="#0b0b10">
<meta name="description" content="Detaljno uputstvo: kako ubaciti ${esc(brand)} na ruter (WireGuard) i zaštititi cijelu kuću — GL.iNet, Asus, OpenWrt, pfSense.">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<style>
:root{--bg:#0b0b10;--card:#14141c;--line:#24242f;--line2:#33333f;--text:#f2f2f6;--soft:#c3c3cf;--muted:#8e8e9c;--red:#e3172b;--red2:#ff4a5a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 "Segoe UI",system-ui,-apple-system,sans-serif}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(900px 480px at 85% -12%,rgba(227,23,43,.18),transparent 60%),radial-gradient(700px 500px at 0% 110%,rgba(227,23,43,.08),transparent 55%)}
a{color:var(--red2);text-decoration:none}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);background:rgba(11,11,16,.8);position:sticky;top:0;backdrop-filter:blur(12px);z-index:5}
header .wrap{display:flex;align-items:center;gap:11px;height:66px}
header .mk{width:26px;height:29px}header b{font:800 19px "Segoe UI",system-ui,sans-serif;letter-spacing:.08em}header b em{font-style:normal;color:var(--red)}
header a.back{margin-left:auto;color:var(--soft);font-size:14px}header a.back:hover{color:var(--text)}
.hero{text-align:center;padding:50px 0 8px}
.hero h1{font-size:clamp(28px,5vw,42px);line-height:1.12;margin:0 0 12px;letter-spacing:-.02em}
.hero h1 em{font-style:normal;color:var(--red2)}
.hero p{color:var(--soft);font-size:clamp(15px,2.2vw,18px);margin:0 auto;max-width:620px}
h2{font-size:22px;margin:38px 0 14px}
.card{background:linear-gradient(180deg,var(--card),#101017);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin:0 0 14px}
.card p{margin:0 0 6px;color:var(--soft)}
.step{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}
.step:first-child{border-top:0}.step .n{flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:rgba(227,23,43,.14);border:1px solid rgba(227,23,43,.3);color:var(--red2);display:grid;place-items:center;font-weight:700;font-size:14px}
.step .s b{color:var(--text)}.step .s{color:var(--soft);font-size:15px}
details.g,details.t{background:linear-gradient(180deg,var(--card),#101017);border:1px solid var(--line);border-radius:14px;margin:0 0 10px;padding:0}
details.g>summary,details.t>summary{cursor:pointer;list-style:none;padding:16px 20px;display:flex;flex-direction:column;gap:2px}
details.g>summary::-webkit-details-marker,details.t>summary::-webkit-details-marker{display:none}
details.g>summary>span{font-weight:700;font-size:17px}details.g>summary>small{color:var(--muted);font-size:13px}
details.g[open]>summary,details.t[open]>summary{border-bottom:1px solid var(--line)}
details.g ol{margin:0;padding:14px 20px 18px 42px;color:var(--soft);font-size:15px;line-height:1.75}
details.g ol li{margin:0 0 9px}details.g ol li b{color:var(--text)}
details.g code,.card code{background:#0d0d12;border:1px solid var(--line2);border-radius:6px;padding:1px 6px;font:13px ui-monospace,Consolas,monospace;color:#e6c07b;word-break:break-word}
details.t>summary{font-weight:600}details.t>p{margin:0;padding:12px 20px 16px;color:var(--soft);font-size:14.5px}
.cta{display:inline-flex;align-items:center;gap:9px;background:linear-gradient(180deg,#ff2b40,var(--red));color:#fff;font-weight:700;padding:13px 22px;border-radius:12px;box-shadow:0 8px 22px -10px rgba(227,23,43,.8);margin-top:6px}
.note{background:#1d1810;border:1px solid #3d3216;color:#f5c46a;border-radius:12px;padding:14px 16px;font-size:14.5px;margin:0 0 14px}
.note b{color:#ffdf9e}
footer{border-top:1px solid var(--line);margin-top:46px;padding:24px 0 44px;color:var(--muted);font-size:14px}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}footer a{color:var(--muted)}
</style></head><body>
<header><div class="wrap">
  <svg class="mk" viewBox="0 0 200 224" aria-hidden="true">${MARK}</svg><b>${wordmark(brand)}</b>
  <a class="back" href="/">← Nazad na sajt</a>
</div></header>
<main class="wrap">
  <section class="hero">
    <h1>VPN na <em>ruteru</em></h1>
    <p>Ubaci ${esc(brand)} u ruter i <b>cijela kuća</b> ide kroz VPN — TV, konzola, svi telefoni i računari — bez aplikacije na svakom uređaju. Radi preko WireGuarda.</p>
  </section>

  <h2>1. Provjeri ruter</h2>
  <div class="note">Ruter mora podržavati <b>WireGuard</b>. Podržavaju ga: <b>GL.iNet</b> (najlakše), noviji <b>Asus</b> (ili uz Asuswrt-Merlin), <b>OpenWrt</b>, <b>pfSense/OPNsense</b>. Ruteri od provajdera (Telekom, HT…) najčešće <b>ne</b> podržavaju — tada je najjednostavniji mali GL.iNet putni ruter.</div>

  <h2>2. Uzmi svoj config</h2>
  <div class="card">
    <div class="step"><span class="n">1</span><span class="s">Otvori <b>svoju stranicu naloga</b> (link koji si dobio na e-mail ili od podrške) u browseru.</span></div>
    <div class="step"><span class="n">2</span><span class="s">Nađi sekciju <b>"Na ruteru ili u WireGuard aplikaciji"</b>, izaberi lokaciju i klikni <b>Preuzmi</b> (.conf fajl) ili <b>Kopiraj</b> (config tekst).</span></div>
    <div class="step"><span class="n">3</span><span class="s">Taj fajl/tekst ubacuješ u ruter u sljedećem koraku. Jedan ruter = jedna lokacija.</span></div>
  </div>

  <h2>3. Ubaci u ruter</h2>
  <p style="color:var(--muted);margin:0 0 14px">Otvori uputstvo za svoj ruter:</p>
  ${guides}

  <h2>4. Problemi i rješenja</h2>
  ${troubles}

  ${support ? `<div class="card" style="margin-top:18px;text-align:center"><p style="margin:0">Zapeo si? Javi se podršci: <b>${esc(support)}</b></p></div>` : ''}
  <div style="text-align:center;margin-top:20px"><a class="cta" href="/preuzmi">Nemaš ruter? Preuzmi aplikaciju →</a></div>
</main>
<footer><div class="wrap">
  <span>© ${new Date().getFullYear()} ${esc(brand)}</span>
  <span>${s.legal_on !== false ? '<a href="/privatnost">Privatnost</a> · <a href="/uslovi">Uslovi</a> · ' : ''}<a href="/preuzmi">Preuzmi</a> · <a href="/">Početna</a></span>
</div></footer>
</body></html>`;
}

async function handle(req, res) {
  return send(res, 200, page(req), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
}

module.exports = { handle, page };
