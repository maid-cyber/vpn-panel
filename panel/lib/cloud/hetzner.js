'use strict';
// Hetzner Cloud (api.hetzner.cloud): plaćanje po satu, promjena IP bez novog servera.
const settings = require('../settings');
const { call, sleep, pollMs } = require('./http');

const API = () => (process.env.VPN_HZ_API || 'https://api.hetzner.cloud/v1').replace(/\/+$/, '');
const LOC = {
  fsn1: { city: 'Falkenstein', cc: 'DE', lat: 50.48, lon: 12.37 }, nbg1: { city: 'Nuremberg', cc: 'DE', lat: 49.45, lon: 11.08 },
  hel1: { city: 'Helsinki', cc: 'FI', lat: 60.17, lon: 24.94 }, ash: { city: 'Ashburn', cc: 'US', lat: 39.04, lon: -77.49 },
  hil: { city: 'Hillsboro', cc: 'US', lat: 45.52, lon: -122.99 }, sin: { city: 'Singapore', cc: 'SG', lat: 1.29, lon: 103.85 },
};
const hz = (method, path, body) => call('Hetzner', API() + path, { method, body, headers: { authorization: `Bearer ${settings.get('hz_token')}` } });

async function waitAction(action, maxMs = 180000) {
  if (!action?.id) return;
  const t0 = Date.now();
  for (;;) {
    const a = (await hz('GET', `/actions/${action.id}`)).action;
    if (a.status === 'success') return;
    if (a.status === 'error') throw new Error(a.error?.message || 'Hetzner akcija nije uspjela');
    if (Date.now() - t0 > maxMs) throw new Error('Hetzner predugo radi, provjeri u Hetzner konzoli');
    await sleep(Number(process.env.VPN_HZ_POLL_MS) || pollMs());
  }
}

module.exports = {
  id: 'hetzner', name: 'Hetzner', currency: '€', billing: 'po satu', swapIp: true, replace: true,
  note: 'U Evropi je uključeno 20 TB prometa mjesečno, u SAD-u i Singapuru znatno manje.',
  configured: () => !!settings.get('hz_token'),
  LOC,
  async options() {
    const [locs, types] = await Promise.all([hz('GET', '/locations'), hz('GET', '/server_types?per_page=50')]);
    return {
      locations: (locs.locations || []).map((l) => ({ id: l.name, city: LOC[l.name]?.city || l.city, cc: LOC[l.name]?.cc || l.country })),
      types: (types.server_types || [])
        .filter((t) => !t.deprecated && !t.deprecation && t.architecture !== 'arm' && t.cores <= 16)
        .map((t) => ({ id: t.name, label: t.name.toUpperCase(), cores: t.cores, mem: t.memory, disk: t.disk,
          prices: Object.fromEntries((t.prices || []).map((p) => [p.location, Math.round(Number(p.price_monthly?.gross || 0) * 100) / 100])) }))
        .filter((t) => Object.keys(t.prices).length),
    };
  },
  async create({ location, type, name, userData, sshKey }) {
    const r = await hz('POST', '/servers', {
      name, server_type: type, location, image: 'ubuntu-24.04', user_data: userData, labels: { panel: 'veltrix' },
      ...(sshKey ? { ssh_keys: [sshKey] } : {}), public_net: { enable_ipv4: true, enable_ipv6: true }, start_after_create: true,
    });
    const s = r.server || {};
    const price = Number((s.server_type?.prices || []).find((p) => p.location === location)?.price_monthly?.gross || 0);
    return { id: String(s.id), ip: s.public_net?.ipv4?.ip || '', price: Math.round(price * 100) / 100, geo: LOC[location] };
  },
  async getIp(id) { return (await hz('GET', `/servers/${id}`)).server?.public_net?.ipv4?.ip || ''; },
  async destroy(id) { await hz('DELETE', `/servers/${id}`); },
  // nova IP: ugasi, zamijeni primarnu IPv4, upali (isti server, isti agent)
  async swapIp(id, step, label) {
    const srv = (await hz('GET', `/servers/${id}`)).server;
    const old = srv.public_net?.ipv4;
    if (!old?.id) throw new Error('Server nema primarnu IPv4 adresu');
    let off = false;
    try {
      step('Gasim server');
      await waitAction((await hz('POST', `/servers/${id}/actions/poweroff`)).action); off = true;
      step('Skidam staru IP adresu');
      await waitAction((await hz('POST', `/primary_ips/${old.id}/actions/unassign`)).action);
      step('Dodjeljujem novu IP adresu');
      const np = await hz('POST', '/primary_ips', { name: `${label}-${Date.now().toString(36)}`, type: 'ipv4', assignee_type: 'server', assignee_id: Number(id), auto_delete: true });
      await waitAction(np.action);
      if (!np.primary_ip?.ip) throw new Error('Hetzner nije vratio novu IP adresu');
      await hz('DELETE', `/primary_ips/${old.id}`).catch(() => {});
      step('Palim server');
      await waitAction((await hz('POST', `/servers/${id}/actions/poweron`)).action); off = false;
      return { ip: np.primary_ip.ip, old: old.ip };
    } finally {
      if (off) await hz('POST', `/servers/${id}/actions/poweron`).catch(() => {});
    }
  },
};
