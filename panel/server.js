'use strict';
// VPN admin panel — glavni server. Pokretanje: node server.js
// Promjenljive okruženja: PORT (zadano 8080), HOST (zadano 127.0.0.1), VPN_DATA_DIR, VPN_ADMIN_PATH,
// VPN_ADMIN_USER, VPN_ADMIN_PASS (samo prvo pokretanje), VPN_PANEL_URL (adresa panela, samo prvo pokretanje)
process.removeAllListeners('warning');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
// Izlazne veze preko IPv4 (hosteri poput Vultra dozvoljavaju IP adresu na listi; IPv6 servera obično nije tamo).
try { require('node:dns').setDefaultResultOrder('ipv4first'); } catch { /* starije verzije */ }

// vraćanje iz backupa: zamijeni bazu prije nego je otvorimo
const DATA_DIR = process.env.VPN_DATA_DIR || path.join(__dirname, 'data');
const restore = path.join(DATA_DIR, 'restore.db');
if (fs.existsSync(restore)) {
  const dbf = path.join(DATA_DIR, 'panel.db');
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbf + ext, { force: true });
  if (fs.existsSync(dbf)) fs.renameSync(dbf, path.join(DATA_DIR, `panel-prije-vracanja-${Date.now()}.db`));
  fs.renameSync(restore, dbf);
  console.log('Baza vraćena iz backupa.');
}

const { one, run, now, log } = require('./lib/db');
const settings = require('./lib/settings');
const auth = require('./lib/auth');
const api = require('./lib/api');
const apiv1 = require('./lib/apiv1');
const nodes = require('./lib/nodes');
const sub = require('./lib/sub');
const jobs = require('./lib/jobs');
const { HttpError, send, clientIp, cookies, isHttps } = require('./lib/http');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

// ---------- prvo pokretanje: vlasnički nalog ----------
function firstRun() {
  if (one('SELECT id FROM admins LIMIT 1')) return;
  const user = process.env.VPN_ADMIN_USER || 'admin';
  const pass = process.env.VPN_ADMIN_PASS || crypto.randomBytes(9).toString('base64url');
  run('INSERT INTO admins (username, pass_hash, role, created_at) VALUES (?,?,?,?)', user, auth.hashPassword(pass), 'owner', now());
  run("INSERT INTO levels (name, discount, min_monthly, max_users, sort) VALUES ('Bronze', 0.10, 0, 150, 1), ('Silver', 0.20, 200, 300, 2), ('Gold', 0.30, 500, 600, 3)");
  run(`INSERT INTO plans (name, days, traffic_gb, devices, price, trial, sort) VALUES
    ('Probni 1 dan', 1, 2, 1, 0, 1, 0), ('Standard 30 dana', 30, 100, 2, 4, 0, 1), ('Premium 30 dana', 30, 0, 3, 5, 0, 2), ('Pro 90 dana', 90, 0, 5, 12, 0, 3)`);
  if (process.env.VPN_PANEL_URL) settings.set({ panel_url: process.env.VPN_PANEL_URL });
  const info = `Panel: ${(process.env.VPN_PANEL_URL || 'http://IP_SERVERA').replace(/\/+$/, '')}${settings.get('admin_path')}/\nKorisnik: ${user}\nŠifra: ${pass}\n`;
  fs.writeFileSync(path.join(DATA_DIR, 'prva-prijava.txt'), info, { mode: 0o600 });
  log('sistem', 'Panel instaliran', `vlasnik: ${user}`);
  console.log('\n=== PRVA PRIJAVA ===\n' + info + '(sačuvano i u data/prva-prijava.txt)\n');
}

function serveStatic(res, file) {
  const f = path.normalize(path.join(PUBLIC, file));
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found');
  send(res, 200, fs.readFileSync(f), { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': /\.woff2?$/.test(f) ? 'public, max-age=2592000' : 'no-cache' });
}

function indexHtml(base, portal) {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  return html.replace('<base href="/">', `<base href="${base}/">`)
    .replace('<html lang="bs">', `<html lang="bs" data-portal="${portal}">`)
    .replace(/__BRAND__/g, settings.get('brand').replace(/[<>&"]/g, ''));
}

async function onRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);
  try {
    if (p.startsWith('/s/')) return await sub.handle(req, res, p);
    if (p.startsWith('/agent/') || p.startsWith('/install/')) return await nodes.handle(req, res, p);
    if (p.startsWith('/api/v1/')) return await apiv1.handle(req, res, p);
    if ((p === '/paypal/return' || p === '/paypal/cancel') && req.method === 'GET') return await require('./lib/paypal').handle(req, res, url);
    if (p === '/stripe/webhook' && req.method === 'POST') return await require('./lib/stripe').webhook(req, res);
    // provjera koda za popust (sajt i stranica kupca)
    if (p === '/coupon' && req.method === 'POST') return await require('./lib/coupons').check(req, res, (id) => one('SELECT id, name, price FROM plans WHERE id = ? AND active = 1 AND trial = 0 AND price > 0', id));
    if (p === '/trial' && req.method === 'POST') {
      const s0 = settings.load();
      return await require('./lib/growth').trial(req, res, (s0.sub_url || s0.panel_url || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/+$/, ''));
    }
    { const dm = p.match(/^\/download\/(android|windows)(?:\.apk|\.exe)?$/); if (dm && req.method === 'GET') return await require('./lib/downloads').handle(req, res, dm[1]); }
    if (p === '/app/config' && req.method === 'GET') return send(res, 200, sub.appConfig(), { 'cache-control': 'no-store' });
    if (p === '/favicon.ico') return serveStatic(res, 'favicon.svg');
    // logo za e-mailove (e-mail programi ne prikazuju SVG ni ugrađene slike, treba prava adresa)
    if (p === '/mail/logo.png') return serveStatic(res, 'mail-logo.png');
    { const ml = p.match(/^\/mail\/logo\/(\d+)\.png$/);
      if (ml) {
        const a = one("SELECT brand_logo FROM admins WHERE id = ? AND role = 'reseller'", Number(ml[1]));
        const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(a?.brand_logo || '');
        if (!m) return serveStatic(res, 'mail-logo.png');
        return send(res, 200, Buffer.from(m[2], 'base64'), { 'content-type': m[1], 'cache-control': 'public, max-age=86400' });
      } }
    // javni sajt na glavnoj adresi (tajna adresa panela ostaje skrivena)
    if (settings.get('site_on')) {
      const site = require('./lib/site');
      if (p === '/' && req.method === 'GET') return await site.page(req, res);
      if (/^\/(privatnost|privacy|uslovi|terms)$/.test(p) && req.method === 'GET') {
        if (settings.get('legal_on') === false) return send(res, 404, 'Not found');
        return require('./lib/legal').handle(req, res, p);
      }
      if (p === '/me.json' && req.method === 'GET') return await site.visitor(req, res);
      if (p === '/buy' && req.method === 'POST') return await site.buy(req, res);
      if (p === '/buy/status' && req.method === 'GET') return site.status(req, res, url);
      if (p === '/kupljeno' && req.method === 'GET') return site.bought(req, res);
      if (p === '/assets/globe.js' || /^\/assets\/fonts\/[\w.-]+\.woff$/.test(p) || /^\/assets\/flags\/[a-z]{2}\.png$/.test(p)) return serveStatic(res, p.slice(8));
    }

    // dva ulaza: tajna admin adresa i (ako je uključeno) posebna adresa za resellere
    const s = settings.load();
    const inPath = (b) => b && (p === b || p.startsWith(b + '/'));
    let base, portal;
    if (inPath(s.admin_path)) { base = s.admin_path; portal = 'admin'; }
    else if (s.res_portal && inPath(s.reseller_path)) { base = s.reseller_path; portal = 'reseller'; }
    else return send(res, 404, 'Not found');
    if (portal === 'admin' && !auth.ipAllowed(ip)) return send(res, 404, 'Not found');
    const rest = p.slice(base.length) || '/';
    if (rest === '/' || rest === '') {
      if (p === base) { res.writeHead(302, { location: base + '/' }); return res.end(); }
      return send(res, 200, indexHtml(base, portal), { 'content-type': 'text/html; charset=utf-8' });
    }
    if (rest.startsWith('/assets/')) return serveStatic(res, rest.slice(8));
    if (rest.startsWith('/api/')) {
      const sub = rest.slice(5);
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'panel') throw new HttpError(403, 'Zahtjev odbijen.');
      const ck = cookies(req);
      const sess = auth.getSession(ck.sid);
      const c = {
        req, res, ip, portal, query: Object.fromEntries(url.searchParams), auth: sess, proto: isHttps(req) ? 'https' : 'http',
        setCookie: (token) => res.setHeader('set-cookie', `sid=${token}; Path=${base}/; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}${token ? '' : '; Max-Age=0'}`),
        raw: (code, body, headers) => send(res, code, body, headers),
      };
      return await api.handle(c, sub);
    }
    return send(res, 404, 'Not found');
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Greška na serveru: ' + e.message });
  }
}

firstRun();
jobs.start();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
http.createServer(onRequest).listen(PORT, HOST, () => {
  console.log(`Panel radi na http://${HOST}:${PORT}${settings.get('admin_path')}/  (verzija ${api.VERSION})`);
});
// aplikacije za /download/* se pripreme unaprijed (skinu sa GitHuba), pa provjera svakih sat vremena
try { require('./lib/site').ensureYearly(); } catch (e) { console.error('godišnji planovi', e); }
if (!process.env.VPN_NO_WARM) { setTimeout(() => require('./lib/downloads').tick(), 5000); setInterval(() => require('./lib/downloads').tick(), 600000).unref(); }
