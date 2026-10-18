'use strict';
// Dijagnostika kupca: panel provjeri nalog, servere i zadnji izvještaj iz aplikacije kupca
// i kaže gdje je problem: kod nas (server/panel), u nalogu (istekao, ugašen…) ili kod kupca (mreža, uređaj).
const net = require('node:net');
const { db, one, all, run, now, log } = require('./db');
const { send, readBody, fail } = require('./http');
const settings = require('./settings');
const vpn = require('./vpn');
const { notify } = require('./notify');

db.exec(`CREATE TABLE IF NOT EXISTS diag_reports (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, os TEXT DEFAULT '', build INTEGER DEFAULT 0, vpn_on INTEGER DEFAULT 0, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS diag_user ON diag_reports(user_id, ts);`);

const MIN = 60000, HOUR = 3600000;
const fmtDate = (t) => new Date(t).toLocaleDateString('bs-BA', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: settings.get('timezone') || 'Europe/Sarajevo' }).replace(/\.$/, '');
function ago(t) {
  const d = now() - t;
  if (d < 2 * MIN) return 'upravo';
  if (d < HOUR) return `prije ${Math.round(d / MIN)} min`;
  if (d < 48 * HOUR) return `prije ${Math.round(d / HOUR)} h`;
  return `prije ${Math.round(d / (24 * HOUR))} dana`;
}

// ---------------------------------------------------------------- izvještaj iz aplikacije (POST /s/TOKEN/diag)
const lastPost = new Map();
async function receive(req, res, u) {
  const t = now();
  if (t - (lastPost.get(u.id) || 0) < 20000) return send(res, 429, { error: 'Izvještaj je upravo poslan. Sačekaj malo.' });
  lastPost.set(u.id, t);
  const b = await readBody(req, 96 * 1024).catch(() => null);
  if (!b || typeof b !== 'object') return send(res, 400, { error: 'Neispravan izvještaj.' });
  const clean = {
    os: String(b.os || '').slice(0, 20), build: Number(b.build) || 0, vpn_on: !!b.vpn_on, protocol: String(b.protocol || '').slice(0, 20),
    server_id: Number(b.server_id) || 0, network: String(b.network || '').slice(0, 40),
    internet: b.internet && typeof b.internet === 'object' ? { ok: !!b.internet.ok, detail: String(b.internet.detail || '').slice(0, 120) } : null,
    servers: (Array.isArray(b.servers) ? b.servers : []).slice(0, 30).map((s) => ({ id: Number(s.id) || 0, host: String(s.host || '').slice(0, 80), port: Number(s.port) || 0, ok: !!s.ok, detail: String(s.detail || '').slice(0, 160) })),
    traffic: b.traffic && typeof b.traffic === 'object' ? { ok: !!b.traffic.ok, detail: String(b.traffic.detail || '').slice(0, 160) } : null,
    ip: String(b.ip || '').slice(0, 60),
    errors: (Array.isArray(b.errors) ? b.errors : []).slice(-40).map((x) => String(x).slice(0, 300)),
  };
  run('INSERT INTO diag_reports (user_id, ts, os, build, vpn_on, data) VALUES (?,?,?,?,?,?)', u.id, t, clean.os, clean.build, clean.vpn_on ? 1 : 0, JSON.stringify(clean));
  run('DELETE FROM diag_reports WHERE user_id = ? AND id NOT IN (SELECT id FROM diag_reports WHERE user_id = ? ORDER BY id DESC LIMIT 5)', u.id, u.id);
  log('sistem', 'Kupac poslao dijagnostiku', `${u.username} · ${clean.os} build ${clean.build}`);
  notify('n_diag', `🩺 ${u.username} je poslao dijagnostiku iz aplikacije (${clean.os}). Otvori Dijagnostika u panelu.`);
  return send(res, 200, { ok: true });
}

// ---------------------------------------------------------------- provjere iz panela
function tcp(host, port, ms = 3500) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve({ ok: false, detail: 'nema adrese' });
    const t = Date.now();
    const s = net.connect({ host, port, timeout: ms });
    const done = (ok, detail) => { s.destroy(); resolve({ ok, detail }); };
    s.once('connect', () => done(true, `${Date.now() - t} ms`));
    s.once('timeout', () => done(false, 'ne odgovara (timeout)'));
    s.once('error', (e) => done(false, e.code || e.message));
  });
}

function latestBuilds() {
  try {
    // site.downloads drži keš zadnjih buildova sa GitHuba (ne čekamo mrežu ovdje)
    return require('./site').downloadsCached?.() || {};
  } catch { return {}; }
}

/** Glavna provjera za jednog kupca. side: nas | nalog | kupac */
async function check(userId) {
  const u = one('SELECT u.*, p.name AS plan_name FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.id = ?', Number(userId));
  if (!u) fail(404, 'Korisnik ne postoji.');
  const s = settings.load();
  const t = now();
  const plan = u.plan_id ? one('SELECT * FROM plans WHERE id = ?', u.plan_id) : null;
  const st = vpn.userStatus(u, t);
  const checks = [];
  const add = (group, status, label, detail = '', side = null, fix = '') => checks.push({ group, status, label, detail, side, fix });

  // ---- nalog
  const used = u.traffic_up + u.traffic_down;
  const gb = (b) => (b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 2 : 1) + ' GB';
  if (st === 'disabled') add('Nalog', 'bad', 'Nalog je ugašen', 'Ugasio ga je admin ili reseller.', 'nalog', 'Upali nalog ako je greška.');
  else if (st === 'expired') add('Nalog', 'bad', 'Pretplata je istekla', `Istekla ${fmtDate(u.expires_at)}.`, 'nalog', 'Produži pretplatu.');
  else if (st === 'limited') add('Nalog', 'bad', 'Potrošen sav promet', `${gb(used)} od ${gb(u.traffic_limit)}.`, 'nalog', 'Resetuj promet ili prodaj veći plan.');
  else if (st === 'devices') add('Nalog', 'bad', 'Blokiran zbog previše uređaja', `Dozvoljeno ${u.devices}, blokada do ${new Date(u.blocked_until).toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit', timeZone: s.timezone || 'Europe/Sarajevo' })}.`, 'kupac', 'Neka ugasi VPN na uređajima koje ne koristi.');
  else if (st === 'grace') add('Nalog', 'warn', 'Istekao, radi još u grace periodu', `Istekao ${fmtDate(u.expires_at)}.`, 'nalog', 'Podsjeti ga da produži.');
  else if (st === 'expiring') add('Nalog', 'warn', 'Ističe uskoro', `Vrijedi do ${fmtDate(u.expires_at)}.`);
  else add('Nalog', 'ok', 'Nalog je aktivan', `Plan ${u.plan_name || '—'}, vrijedi do ${fmtDate(u.expires_at)}.`);
  if (st !== 'limited' && u.traffic_limit > 0) {
    const pct = used / u.traffic_limit;
    if (pct >= 0.9) add('Nalog', 'warn', 'Promet skoro potrošen', `${gb(used)} od ${gb(u.traffic_limit)} (${Math.round(pct * 100)}%).`, 'nalog');
  }

  // ---- serveri koje kupac smije koristiti
  const off = Number(s.offline_sec || 45) * 1000;
  const allowed = all('SELECT * FROM servers WHERE enabled = 1 ORDER BY country, name').filter((sv) => vpn.userCanUse(u, plan, sv));
  const srv = [];
  if (!allowed.length) add('Serveri', 'bad', 'Kupac nema nijedan server', 'Plan ne uključuje nijedan upaljen server.', 'nas', 'Planovi → uredi plan i dodaj lokacije, ili upali server.');
  const reach = await Promise.all(allowed.map((sv) => (s.proto_vless ? tcp(sv.host, sv.vless_port) : s.proto_ss ? tcp(sv.host, sv.ss_port || 8388) : Promise.resolve({ ok: null, detail: '' }))));
  allowed.forEach((sv, i) => {
    const online = sv.last_seen && t - sv.last_seen < off;
    const full = sv.capacity && sv.online >= sv.capacity;
    let inCfg = null;
    if (online && vpn.CAN_CONNECT.has(st) && s.proto_vless) {
      try { const c = vpn.nodeConfig(sv); inCfg = JSON.stringify(c.xray || {}).includes(u.uuid); } catch { inCfg = null; }
    }
    const problems = [];
    if (sv.maintenance) problems.push('na održavanju');
    if (!online) problems.push(sv.last_seen ? `offline (javio se ${ago(sv.last_seen)})` : 'nikad se nije javio panelu');
    if (online && (s.proto_vless || s.proto_ss) && !sv.xray_ok) problems.push('Xray (VLESS) ne radi');
    if (sv.last_error) problems.push('greška: ' + sv.last_error.slice(0, 120));
    if (full) problems.push(`pun (${sv.online}/${sv.capacity})`);
    if (inCfg === false) problems.push('kupac nije u konfiguraciji servera');
    if (reach[i].ok === false) problems.push(`port ${s.proto_vless ? sv.vless_port : sv.ss_port} ne odgovara iz panela (${reach[i].detail})`);
    srv.push({ id: sv.id, name: sv.name, country: sv.country, host: sv.host, port: s.proto_vless ? sv.vless_port : sv.ss_port || 8388, online: !!online, ok: !problems.length, problems, panel_reach: reach[i], users_online: sv.online || 0 });
  });
  const good = srv.filter((x) => x.ok);
  if (allowed.length) {
    if (!good.length) add('Serveri', 'bad', 'Nijedan server kupca ne radi', srv.map((x) => `${x.name}: ${x.problems.join(', ')}`).join(' · '), 'nas', 'Otvori Serveri i pogledaj greške. Restartuj VPN na serveru.');
    else if (good.length < srv.length) add('Serveri', 'warn', `Radi ${good.length} od ${srv.length} servera`, srv.filter((x) => !x.ok).map((x) => `${x.name}: ${x.problems.join(', ')}`).join(' · '), 'nas', 'Popravi servere koji ne rade; kupac do tada neka izabere drugu lokaciju.');
    else add('Serveri', 'ok', `Svi serveri kupca rade (${srv.length})`, 'Online, VPN radi i port odgovara iz panela.');
  }

  // ---- aktivnost
  const lastSrv = u.last_server ? one('SELECT name FROM servers WHERE id = ?', u.last_server) : null;
  if (u.last_seen && t - u.last_seen < 2 * MIN) add('Aktivnost', 'ok', 'Spojen je sada', `Na serveru ${lastSrv?.name || '—'}, promet teče.`);
  else if (u.last_seen) add('Aktivnost', t - u.last_seen < 7 * 24 * HOUR ? 'info' : 'warn', `Zadnji promet ${ago(u.last_seen)}`, `Server ${lastSrv?.name || '—'}.`);
  else add('Aktivnost', 'warn', 'Nikad nije imao promet kroz VPN', 'Ili nije podesio aplikaciju, ili se spoji ali promet ne prolazi.', 'kupac', 'Provjeri da li je uvezao link u aplikaciju.');

  // ---- aplikacija
  const latest = latestBuilds();
  if (u.app_seen) {
    const os = u.app_os === 'windows' ? 'Windows' : 'Android';
    const min = u.app_os === 'windows' ? Number(s.app_min_windows) || 0 : Number(s.app_min_android) || 0;
    const newest = u.app_os === 'windows' ? latest.exeBuild : latest.apkBuild;
    if (min && u.app_build && u.app_build < min) add('Aplikacija', 'bad', `Stara verzija aplikacije (${os} build ${u.app_build})`, `Najstarija dozvoljena je ${min}, pa se ne može spojiti.`, 'kupac', 'Neka ažurira aplikaciju.');
    else if (newest && u.app_build && u.app_build < newest) add('Aplikacija', 'warn', `${os} aplikacija nije najnovija (build ${u.app_build})`, `Najnovija je ${newest}. Otvorio je ${ago(u.app_seen)}.`, 'kupac', 'Neka ažurira aplikaciju.');
    else add('Aplikacija', 'ok', `Koristi Veltrix za ${os}${u.app_build ? ' (build ' + u.app_build + ')' : ''}`, `Zadnji put otvorio ${ago(u.app_seen)}.`);
  } else add('Aplikacija', 'info', 'Ne koristi Veltrix aplikaciju (ili ima staru verziju)', 'Vjerovatno Hiddify, v2rayNG ili slično. Izvještaj iz aplikacije tad nije moguć.');

  // ---- zadnji izvještaj iz aplikacije kupca
  const rep = one('SELECT * FROM diag_reports WHERE user_id = ? ORDER BY id DESC LIMIT 1', u.id);
  let report = null;
  if (rep) {
    const d = JSON.parse(rep.data);
    report = { ts: rep.ts, ago: ago(rep.ts), ...d };
    const fresh = t - rep.ts < 48 * HOUR;
    const G = `Izvještaj kupca (${ago(rep.ts)})`;
    if (!fresh) add(G, 'info', 'Izvještaj je star', 'Zatraži novi: Nalog → Dijagnostika veze → Pošalji podršci.');
    if (d.internet && !d.internet.ok) add(G, 'bad', 'Kupac nema interneta na uređaju', d.internet.detail, 'kupac', 'Neka provjeri WiFi ili mobilne podatke, bez VPN-a.');
    // direktna provjera servera sa mreže kupca (Windows dok je VPN spojen ide kroz tunel: ne vrijedi)
    const direct = d.os !== 'windows' || !d.vpn_on;
    if (direct && d.servers?.length && (!d.internet || d.internet.ok)) {
      const blocked = d.servers.filter((x) => !x.ok).map((x) => {
        const p = srv.find((y) => y.id === x.id) || srv.find((y) => y.host === x.host);
        return { ...x, name: p?.name || x.host, panelOk: p ? p.panel_reach.ok : null };
      });
      const theirs = blocked.filter((x) => x.panelOk !== false);
      if (theirs.length && theirs.length === d.servers.length) add(G, 'bad', 'Mreža kupca ne može ni do jednog servera', theirs.map((x) => `${x.name} (${x.host}:${x.port}): ${x.detail}`).join(' · '), 'kupac', 'Iz panela serveri rade. Kupčev provajder, ruter ili antivirus blokira. Neka proba mobilne podatke, ugasi antivirus ili firewall.');
      else if (theirs.length) add(G, 'warn', `Mreža kupca ne može do ${theirs.length} od ${d.servers.length} servera`, theirs.map((x) => `${x.name} (${x.host}:${x.port}): ${x.detail}`).join(' · '), 'kupac', `Neka izabere drugu lokaciju (npr. ${d.servers.filter((x) => x.ok).map((x) => srv.find((y) => y.id === x.id)?.name || x.host).slice(0, 2).join(', ')}). Ti možeš dati serveru novu IP adresu.`);
      else add(G, 'ok', `Mreža kupca dolazi do svih servera (${d.servers.length})`, '');
    }
    if (d.vpn_on && d.traffic) {
      if (d.traffic.ok) add(G, 'ok', 'Promet kroz VPN prolazi', [d.ip && `IP preko VPN-a: ${d.ip}`, d.traffic.detail].filter(Boolean).join(' · '));
      else {
        const dialFail = (d.errors || []).some((e) => /dial tcp .*(timeout|refused)/i.test(e));
        const reality = (d.errors || []).some((e) => /reality|tls|handshake|EOF/i.test(e));
        if (dialFail) add(G, 'bad', 'VPN spojen, ali aplikacija ne dolazi do servera', 'U logu: "dial tcp … timeout". Mreža kupca blokira server.', 'kupac', 'Neka izabere drugu lokaciju ili drugu mrežu; ugasi antivirus.');
        else if (reality) add(G, 'bad', 'VPN spojen, ali veza se prekida (TLS/Reality)', 'Moguća blokada VLESS-a na mreži kupca (DPI).', 'kupac', 'Neka u aplikaciji izabere protokol Shadowsocks (uključi Shadowsocks na serverima ako nije).');
        else add(G, 'bad', 'VPN spojen, ali promet ne prolazi', d.traffic.detail, good.length === srv.length ? 'kupac' : 'nas', 'Pogledaj greške u logu ispod.');
      }
    }
    if (d.os && d.os !== 'android' && d.vpn_on && d.servers?.length) add(G, 'info', 'Izvještaj poslan dok je VPN bio spojen (Windows)', 'Provjera servera tad ide kroz tunel. Za tačnu provjeru neka prekine vezu pa pošalje ponovo.');
  } else {
    add('Izvještaj kupca', 'info', 'Kupac još nije poslao izvještaj', 'U aplikaciji: Nalog → Dijagnostika veze → Pošalji podršci (Windows: Dijagnostika → Pošalji podršci). Najbolje dok VPN NIJE spojen.');
  }

  // ---- presuda
  const order = ['nas', 'nalog', 'kupac'];
  const bad = checks.filter((c) => c.status === 'bad');
  const warn = checks.filter((c) => c.status === 'warn' && c.side);
  const main = order.map((sd) => bad.find((c) => c.side === sd)).find(Boolean) || order.map((sd) => warn.find((c) => c.side === sd)).find(Boolean);
  const brand = s.brand || 'Veltrix VPN';
  let verdict;
  if (!main) verdict = { side: 'ok', title: 'Sve izgleda u redu', text: report ? 'Nalog, serveri i izvještaj kupca su u redu. Ako i dalje ne radi, neka restartuje aplikaciju i proba drugu lokaciju.' : 'Nalog i serveri su u redu. Zatraži od kupca izvještaj iz aplikacije da vidiš njegovu stranu.' };
  else verdict = {
    side: main.side, severe: main.status === 'bad',
    title: { nas: 'Problem je kod nas (server ili panel)', nalog: 'Problem je u nalogu kupca', kupac: 'Problem je kod kupca (mreža ili uređaj)' }[main.side],
    text: `${main.label}. ${main.fix || ''}`.trim(),
  };
  const days = Math.ceil((u.expires_at - t) / vpn.DAY);
  const msg = {
    ok: `Zdravo! Provjerili smo tvoj nalog i servere i sve radi ✅\nProbaj ovo:\n1. Potpuno zatvori aplikaciju i otvori je ponovo\n2. U Lokacijama izaberi drugu zemlju\n3. Ako i dalje ne radi, u aplikaciji otvori Nalog → Dijagnostika veze → Pošalji podršci, pa nam javi.`,
    nas: `Zdravo! Imamo tehnički problem na jednom od servera i već ga popravljamo 🔧\nDo tada u aplikaciji izaberi drugu lokaciju. Izvini na smetnji!`,
    nalog: st === 'expired' || st === 'grace' ? `Zdravo! Tvoja ${brand} pretplata je istekla ${fmtDate(u.expires_at)}. Produži je i VPN radi odmah ✅` : st === 'limited' ? `Zdravo! Potrošio si sav promet u svom planu (${gb(used)}). Javi se da ti produžimo ili prebacimo na veći plan.` : st === 'disabled' ? `Zdravo! Tvoj nalog je trenutno ugašen. Javi nam se da riješimo.` : `Zdravo! Tvoj nalog ističe za ${days} dana (${fmtDate(u.expires_at)}). Produži ga na vrijeme da ne ostaneš bez VPN-a.`,
    kupac: main?.label?.includes('uređaja') ? `Zdravo! Tvoj nalog je spojen na previše uređaja (dozvoljeno ${u.devices}), pa je privremeno blokiran 15 minuta. Ugasi VPN na uređajima koje ne koristiš i probaj ponovo.`
      : main?.label?.includes('verzija') || main?.label?.includes('najnovija') ? `Zdravo! Imaš staru verziju aplikacije. Ažuriraj je (u aplikaciji: Nalog → Verzija → Ažuriraj) i sve će raditi.`
      : main?.label?.includes('interneta') ? `Zdravo! Tvoj uređaj trenutno nema internet ni bez VPN-a. Provjeri WiFi ili mobilne podatke, pa se spoji ponovo.`
      : main?.label?.includes('Nikad') ? `Zdravo! Vidimo da se još nisi spojio. Instaliraj aplikaciju, otvori link koji si dobio (ili skeniraj QR kod) i klikni Spoji se. Ako zapne, javi se!`
      : `Zdravo! Provjerili smo i naši serveri rade ✅ Tvoja mreža (internet provajder, ruter ili antivirus) blokira vezu do servera.\nProbaj ovo:\n1. U aplikaciji izaberi drugu lokaciju\n2. Probaj preko mobilnih podataka umjesto WiFi-ja\n3. Privremeno ugasi antivirus ili firewall\n4. U aplikaciji izaberi protokol Shadowsocks`,
  }[verdict.side];

  return {
    user: { id: u.id, username: u.username, plan: u.plan_name, status: st, expires_at: u.expires_at, devices: u.devices, devices_seen: u.devices_seen || 0, contact: u.contact, tg: !!u.tg_chat, app_os: u.app_os || '', app_build: u.app_build || 0, app_seen: u.app_seen || 0 },
    verdict, message: msg, checks, servers: srv, report, ts: t,
  };
}

module.exports = { receive, check };
