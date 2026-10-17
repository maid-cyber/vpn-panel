'use strict';
// Hetzner Cloud: server u jedan klik (zakup + automatska instalacija), nova IP adresa i brisanje.
// Token je u Postavke → Hetzner i nikad ne ide u browser.
const { one, run, now, log } = require('./db');
const settings = require('./settings');
const { fail } = require('./http');
const { notify } = require('./notify');

const API = () => (process.env.VPN_HZ_API || 'https://api.hetzner.cloud/v1').replace(/\/+$/, '');
const configured = () => !!settings.get('hz_token');

// lokacije Hetznera: grad, država i koordinate za mapu
const LOC = {
  fsn1: { city: 'Falkenstein', cc: 'DE', lat: 50.48, lon: 12.37 },
  nbg1: { city: 'Nuremberg', cc: 'DE', lat: 49.45, lon: 11.08 },
  hel1: { city: 'Helsinki', cc: 'FI', lat: 60.17, lon: 24.94 },
  ash: { city: 'Ashburn', cc: 'US', lat: 39.04, lon: -77.49 },
  hil: { city: 'Hillsboro', cc: 'US', lat: 45.52, lon: -122.99 },
  sin: { city: 'Singapore', cc: 'SG', lat: 1.29, lon: 103.85 },
};

async function hz(method, path, body) {
  const tok = settings.get('hz_token');
  if (!tok) fail(400, 'Upiši Hetzner API token u Postavke → Hetzner.');
  let r;
  try {
    r = await fetch(API() + path, {
      method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
  } catch (e) { fail(502, `Ne mogu doći do Hetznera: ${e.message}`); }
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) fail(400, 'Hetzner token ne važi. Napravi novi (Read & Write) i upiši ga u Postavke → Hetzner.');
    if (r.status === 403) fail(400, 'Hetzner token nema dozvolu za pisanje. Napravi token sa Read & Write.');
    fail(502, `Hetzner: ${j.error?.message || 'greška ' + r.status}`);
  }
  return j;
}

// čekaj da Hetzner završi akciju (gašenje, paljenje, prebacivanje IP)
async function waitAction(action, maxMs = 180000) {
  if (!action?.id) return;
  const t0 = Date.now();
  for (;;) {
    const a = (await hz('GET', `/actions/${action.id}`)).action;
    if (a.status === 'success') return;
    if (a.status === 'error') throw new Error(a.error?.message || 'Hetzner akcija nije uspjela');
    if (Date.now() - t0 > maxMs) throw new Error('Hetzner predugo radi, provjeri u Hetzner konzoli');
    await new Promise((x) => setTimeout(x, Number(process.env.VPN_HZ_POLL_MS) || 2000));
  }
}

/** Lokacije i tipovi servera sa mjesečnom cijenom (bruto) po lokaciji. */
async function options() {
  if (!configured()) return { configured: false };
  const [locs, types] = await Promise.all([hz('GET', '/locations'), hz('GET', '/server_types?per_page=50')]);
  const locations = (locs.locations || []).map((l) => ({ name: l.name, city: LOC[l.name]?.city || l.city, cc: LOC[l.name]?.cc || l.country }));
  const list = (types.server_types || [])
    .filter((t) => !t.deprecated && !t.deprecation && t.architecture !== 'arm' && t.cores <= 16)
    .map((t) => ({
      name: t.name, cores: t.cores, memory: t.memory, disk: t.disk, cpu: t.cpu_type,
      prices: Object.fromEntries((t.prices || []).map((p) => [p.location, Math.round(Number(p.price_monthly?.gross || 0) * 100) / 100])),
    }))
    .filter((t) => Object.keys(t.prices).length)
    .sort((a, b) => Math.min(...Object.values(a.prices)) - Math.min(...Object.values(b.prices)));
  return { configured: true, locations, types: list };
}

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'vpn';

/**
 * Zakupi server i pokreni instalaciju preko cloud-init. `createPanelServer(b)` pravi red u panelu
 * (sa tokenom agenta), a `base` je javna adresa panela do koje novi server mora doći.
 */
async function create(b, base, createPanelServer, actor) {
  const location = String(b.location || ''), type = String(b.type || '');
  if (!/^[a-z0-9-]{2,20}$/.test(location) || !/^[a-z0-9-]{2,20}$/.test(type)) fail(400, 'Izaberi lokaciju i tip servera.');
  if (!/^https?:\/\//.test(base) || /\/\/(localhost|127\.|10\.|192\.168\.)/.test(base)) fail(400, 'Panel mora imati javnu adresu da bi se novi server mogao javiti. Upiši je u Postavke → Općenito → Adresa panela.');
  const L = LOC[location] || {};
  const name = String(b.name || '').trim() || `${L.cc || ''} ${L.city || location}`.trim();
  const id = createPanelServer({ name, city: L.city || '', country: L.cc || '', capacity: Number(b.capacity) || Number(settings.get('hz_capacity')) || 400, provider: 'Hetzner' });
  const sv = one('SELECT * FROM servers WHERE id = ?', id);
  const userData = `#cloud-config
runcmd:
  - [bash, -c, "for i in 1 2 3; do while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 5; done; curl -fsSL ${base}/install/${sv.token} | bash >> /var/log/vpn-install.log 2>&1 && break; sleep 30; done"]
`;
  const key = String(settings.get('hz_ssh_key') || '').trim();
  let r;
  try {
    r = await hz('POST', '/servers', {
      name: `${slug(name)}-${id}`, server_type: type, location, image: 'ubuntu-24.04', user_data: userData,
      labels: { panel: 'veltrix', panel_id: String(id) }, ...(key ? { ssh_keys: [key] } : {}),
      public_net: { enable_ipv4: true, enable_ipv6: true }, start_after_create: true,
    });
  } catch (e) {
    run('DELETE FROM servers WHERE id = ?', id);   // ne ostavljaj prazan server u panelu
    throw e;
  }
  const s = r.server || {};
  const price = Number((s.server_type?.prices || []).find((p) => p.location === location)?.price_monthly?.gross || 0);
  run('UPDATE servers SET hz_id = ?, host = ?, cost = ?, lat = ?, lon = ? WHERE id = ?',
    s.id, s.public_net?.ipv4?.ip || '', Math.round(price * 100) / 100, L.lat ?? null, L.lon ?? null, id);
  log(actor, 'Hetzner: novi server', `${name} · ${type} · ${location} · ${s.public_net?.ipv4?.ip || ''}`);
  return { id, hz_id: s.id, ip: s.public_net?.ipv4?.ip || '', price };
}

// ---------- nova IP adresa: ugasi, zamijeni primarnu IPv4, upali (server i agent ostaju isti)
const JOBS = new Map();   // server_id -> { step, error, t }
const jobOf = (id) => { const j = JOBS.get(id); return j && (!j.done || now() - j.t < 10 * 60000) ? j : null; };

async function newIp(sv, actor) {
  if (!sv.hz_id) fail(400, 'Ovaj server nije napravljen preko Hetzner integracije.');
  if (JOBS.get(sv.id) && !JOBS.get(sv.id).done) fail(400, 'Promjena IP adrese je već u toku.');
  const job = { step: 'Pripremam', t: now(), done: false };
  JOBS.set(sv.id, job);
  const step = (s) => { job.step = s; job.t = now(); };
  (async () => {
    let off = false;
    try {
      const srv = (await hz('GET', `/servers/${sv.hz_id}`)).server;
      const old = srv.public_net?.ipv4;
      if (!old?.id) throw new Error('Server nema primarnu IPv4 adresu');
      run('UPDATE servers SET maintenance = 1 WHERE id = ?', sv.id);
      step('Gasim server');
      await waitAction((await hz('POST', `/servers/${sv.hz_id}/actions/poweroff`)).action);
      off = true;
      step('Skidam staru IP adresu');
      await waitAction((await hz('POST', `/primary_ips/${old.id}/actions/unassign`)).action);
      step('Dodjeljujem novu IP adresu');
      const np = await hz('POST', '/primary_ips', { name: `${slug(sv.name)}-${sv.id}-${Date.now().toString(36)}`, type: 'ipv4', assignee_type: 'server', assignee_id: sv.hz_id, auto_delete: true });
      await waitAction(np.action);
      const ip = np.primary_ip?.ip;
      if (!ip) throw new Error('Hetzner nije vratio novu IP adresu');
      await hz('DELETE', `/primary_ips/${old.id}`).catch(() => {});   // stara IP se više ne plaća
      step('Palim server');
      await waitAction((await hz('POST', `/servers/${sv.hz_id}/actions/poweron`)).action);
      off = false;
      run('UPDATE servers SET host = ?, maintenance = 0 WHERE id = ?', ip, sv.id);
      log(actor, 'Hetzner: nova IP adresa', `${sv.name}: ${old.ip} → ${ip}`);
      notify('n_server', `🔁 ${sv.name}: nova IP adresa ${ip} (stara ${old.ip}). Aplikacije kupaca preuzmu novu adresu same.`);
      Object.assign(job, { step: `Gotovo: ${ip}`, done: true, ok: true, t: now() });
    } catch (e) {
      const msg = e.message || String(e);
      if (off) await hz('POST', `/servers/${sv.hz_id}/actions/poweron`).catch(() => {});
      run('UPDATE servers SET maintenance = 0 WHERE id = ?', sv.id);
      log(actor, 'Hetzner: nova IP nije uspjela', `${sv.name}: ${msg}`, 'error');
      Object.assign(job, { step: 'Nije uspjelo', error: msg, done: true, ok: false, t: now() });
    }
  })();
  return { ok: true };
}

async function destroy(sv, actor) {
  if (!sv.hz_id) return;
  await hz('DELETE', `/servers/${sv.hz_id}`);
  log(actor, 'Hetzner: server obrisan', `${sv.name} (prestaje naplata)`, 'warn');
}

module.exports = { configured, options, create, newIp, destroy, jobOf, LOC };
