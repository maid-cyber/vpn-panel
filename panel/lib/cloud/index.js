'use strict';
// Server u jedan klik kod više hostera. Svaki hoster je dodatak sa istim funkcijama:
// options() lokacije i veličine, create() zakup + cloud-init, getIp(), destroy(), opciono swapIp().
const { one, run, now, log } = require('../db');
const settings = require('../settings');
const { fail } = require('../http');
const { notify } = require('../notify');
const { sleep, pollMs } = require('./http');

const PROVIDERS = [require('./hetzner'), require('./digitalocean'), require('./vultr'), require('./ovh'), require('./contabo')];
const byId = (id) => PROVIDERS.find((p) => p.id === id) || fail(404, 'Nepoznat hoster.');
const SSH_KEY = { hetzner: 'hz_ssh_key', digitalocean: 'do_ssh_key', vultr: 'vultr_ssh_key', ovh: 'ovh_ssh_key', contabo: 'contabo_ssh_key' };

function list() {
  return PROVIDERS.map((p) => ({ id: p.id, name: p.name, configured: p.configured(), currency: p.currency, billing: p.billing, note: p.note, swapIp: !!p.swapIp, replace: !!p.replace }));
}

// opcije se keširaju 10 minuta (cijene i lokacije se rijetko mijenjaju)
// (keš se poništi čim se promijeni ključ tog hostera)
const optCache = new Map();
const PREFIX = { hetzner: 'hz_', digitalocean: 'do_', vultr: 'vultr_', ovh: 'ovh_', contabo: 'contabo_' };
const keyOf = (id) => { const s = settings.load(); return id + ':' + Object.keys(s).filter((k) => k.startsWith(PREFIX[id])).sort().map((k) => s[k]).join('|'); };
async function options(id) {
  const p = byId(id);
  if (!p.configured()) return { configured: false };
  const c = optCache.get(id), k = keyOf(id);
  if (c && c.k === k && now() - c.t < 600000) return c.v;
  const v = { configured: true, ...(await p.options()), currency: p.currency, billing: p.billing, note: p.note };
  optCache.set(id, { t: now(), k, v });
  return v;
}

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vpn';

// cloud-init: sačekaj da apt bude slobodan, pa pokreni instalaciju iz panela (do 3 pokušaja)
function userData(base, token) {
  return `#cloud-config
runcmd:
  - [bash, -c, "for i in 1 2 3; do while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 5; done; curl -fsSL ${base}/install/${token} | bash >> /var/log/vpn-install.log 2>&1 && break; sleep 30; done"]
`;
}
function checkBase(base) {
  if (!/^https?:\/\//.test(base) || /\/\/(localhost|127\.|10\.|192\.168\.)/.test(base)) fail(400, 'Panel mora imati javnu adresu da bi se novi server mogao javiti. Upiši je u Postavke → Općenito → Adresa panela.');
}

// neki hosteri daju IP tek kad se server podigne: čekaj ga u pozadini i upiši u panel
function waitIp(p, svId, extId) {
  (async () => {
    const t0 = now();
    while (now() - t0 < 20 * 60000) {
      await sleep(pollMs());
      const sv = one('SELECT host, cloud_id FROM servers WHERE id = ?', svId);
      if (!sv || sv.cloud_id !== extId) return;   // obrisan ili zamijenjen
      if (sv.host) return;
      const ip = await p.getIp(extId).catch(() => '');
      if (ip) { run('UPDATE servers SET host = ? WHERE id = ?', ip, svId); return; }
    }
  })().catch(() => {});
}

async function launch(p, { location, type, name, panelId, token, base }) {
  const sshKey = String(settings.get(SSH_KEY[p.id]) || '').trim();
  const r = await p.create({ location, type, name: `${slug(name)}-${panelId}`, userData: userData(base, token), sshKey });
  let price = r.price;
  if (!price) { const o = optCache.get(p.id)?.v; price = Number(o?.types?.find((t) => t.id === type)?.prices?.[location]) || 0; }
  return { ...r, price };
}

/** Zakupi server kod hostera i dodaj ga u panel. createPanelServer(b) pravi red u panelu i vraća id. */
async function create(id, b, base, createPanelServer, actor) {
  const p = byId(id);
  if (!p.configured()) fail(400, `Upiši ključ za ${p.name} u Postavke → Hosteri.`);
  checkBase(base);
  const location = String(b.location || ''), type = String(b.type || '');
  if (!/^[\w.-]{1,40}$/.test(location) || !/^[\w.-]{1,60}$/.test(type)) fail(400, 'Izaberi lokaciju i veličinu servera.');
  const o = await options(id);
  const loc = o.locations.find((l) => l.id === location);
  if (!loc) fail(400, 'Ta lokacija nije dostupna.');
  const name = String(b.name || '').trim() || `${loc.cc || ''} ${loc.city || location}`.trim();
  const svId = createPanelServer({ name, city: loc.city || '', country: loc.cc || '', capacity: Number(b.capacity) || Number(settings.get('hz_capacity')) || 400, provider: p.name.replace(/ \(.*\)$/, '') });
  const sv = one('SELECT * FROM servers WHERE id = ?', svId);
  let r;
  try { r = await launch(p, { location, type, name, panelId: svId, token: sv.token, base }); } catch (e) { run('DELETE FROM servers WHERE id = ?', svId); throw e; }
  const geo = r.geo || p.LOC?.[location] || {};
  run('UPDATE servers SET cloud = ?, cloud_id = ?, cloud_loc = ?, cloud_type = ?, host = ?, cost = ?, lat = ?, lon = ? WHERE id = ?',
    p.id, r.id, location, type, r.ip || '', r.price || 0, geo.lat ?? null, geo.lon ?? null, svId);
  if (!r.ip) waitIp(p, svId, r.id);
  log(actor, `${p.name}: novi server`, `${name} · ${type} · ${location}${r.ip ? ' · ' + r.ip : ''}`);
  return { id: svId, ip: r.ip, price: r.price, currency: p.currency };
}

// ---------- nova IP adresa: Hetzner mijenja IP na istom serveru, ostali prave novi server i brišu stari
const JOBS = new Map();
const jobOf = (id) => { const j = JOBS.get(id); return j && (!j.done || now() - j.t < 10 * 60000) ? j : null; };

async function newIp(sv, base, actor) {
  if (!sv.cloud || !sv.cloud_id) fail(400, 'Ovaj server nije napravljen preko panela kod hostera.');
  const p = byId(sv.cloud);
  if (!p.swapIp && !p.replace) fail(400, `${p.name} ne podržava novu IP adresu iz panela (mjesečni ugovor). Napravi novi server pa obriši stari.`);
  if (JOBS.get(sv.id) && !JOBS.get(sv.id).done) fail(400, 'Promjena IP adrese je već u toku.');
  if (!p.swapIp) { checkBase(base); if (!sv.cloud_loc || !sv.cloud_type) fail(400, 'Ne znam lokaciju i veličinu ovog servera.'); }
  const job = { step: 'Pripremam', t: now(), done: false };
  JOBS.set(sv.id, job);
  const step = (s) => { job.step = s; job.t = now(); };
  (async () => {
    const oldIp = sv.host;
    try {
      run('UPDATE servers SET maintenance = 1 WHERE id = ?', sv.id);
      let ip;
      if (p.swapIp) {
        ip = (await p.swapIp(sv.cloud_id, step, `${slug(sv.name)}-${sv.id}`)).ip;
        run('UPDATE servers SET host = ? WHERE id = ?', ip, sv.id);
      } else {
        // novi server sa istim tokenom agenta (isti red u panelu), pa brisanje starog
        step('Pravim novi server');
        const r = await launch(p, { location: sv.cloud_loc, type: sv.cloud_type, name: sv.name, panelId: sv.id, token: sv.token, base });
        run("UPDATE servers SET cloud_id = ?, host = ?, last_seen = NULL, status = 'pending', applied_hash = '' WHERE id = ?", r.id, r.ip || '', sv.id);
        step('Brišem stari server');
        await p.destroy(sv.cloud_id).catch((e) => log(actor, `${p.name}: stari server nije obrisan`, `${sv.name}: ${e.message}. Obriši ga ručno kod hostera.`, 'warn'));
        step('Čekam IP adresu novog servera');
        ip = r.ip;
        for (let i = 0; !ip && i < 200; i++) { await sleep(pollMs()); ip = await p.getIp(r.id).catch(() => ''); }
        if (!ip) throw new Error('Novi server nije dobio IP adresu');
        run('UPDATE servers SET host = ? WHERE id = ?', ip, sv.id);
      }
      run('UPDATE servers SET maintenance = 0 WHERE id = ?', sv.id);
      log(actor, `${p.name}: nova IP adresa`, `${sv.name}: ${oldIp || '?'} → ${ip}`);
      notify('n_server', `🔁 ${sv.name}: nova IP adresa ${ip} (stara ${oldIp || '?'}).${p.swapIp ? '' : ' Novi server se instalira 3–5 minuta.'} Aplikacije kupaca preuzmu novu adresu same.`);
      Object.assign(job, { step: `Gotovo: ${ip}`, done: true, ok: true, t: now() });
    } catch (e) {
      run('UPDATE servers SET maintenance = 0 WHERE id = ?', sv.id);
      log(actor, `${p.name}: nova IP nije uspjela`, `${sv.name}: ${e.message}`, 'error');
      Object.assign(job, { step: 'Nije uspjelo', error: e.message, done: true, ok: false, t: now() });
    }
  })();
  return { ok: true, replace: !p.swapIp };
}

async function destroy(sv, actor) {
  if (!sv.cloud || !sv.cloud_id) return;
  const p = byId(sv.cloud);
  await p.destroy(sv.cloud_id);
  log(actor, `${p.name}: server obrisan`, `${sv.name}${p.id === 'contabo' ? ' (ugovor otkazan, radi do kraja plaćenog perioda)' : ' (naplata prestaje)'}`, 'warn');
}

module.exports = { list, options, create, newIp, destroy, jobOf, PROVIDERS };
