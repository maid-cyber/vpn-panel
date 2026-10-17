'use strict';
// Vultr (api.vultr.com/v2): instanca po satu, cijena u dolarima.
const settings = require('../settings');
const { call } = require('./http');

const API = () => (process.env.VPN_VULTR_API || 'https://api.vultr.com/v2').replace(/\/+$/, '');
const vu = (method, path, body) => call('Vultr', API() + path, { method, body, headers: { authorization: `Bearer ${settings.get('vultr_token')}` } });
let osId = null;

module.exports = {
  id: 'vultr', name: 'Vultr', currency: '$', billing: 'po satu', swapIp: false, replace: true,
  note: 'Cijene su u dolarima. Vultr ima najviše lokacija (preko 30 gradova).',
  configured: () => !!settings.get('vultr_token'),
  async options() {
    const [regs, plans] = await Promise.all([vu('GET', '/regions?per_page=500'), vu('GET', '/plans?type=vc2&per_page=500')]);
    const known = new Set((regs.regions || []).map((r) => r.id));
    return {
      locations: (regs.regions || []).map((r) => ({ id: r.id, city: r.city, cc: String(r.country || '').toUpperCase() })),
      types: (plans.plans || []).filter((p) => p.vcpu_count <= 8)
        .map((p) => ({ id: p.id, label: p.id, cores: p.vcpu_count, mem: Math.round(p.ram / 1024 * 10) / 10, disk: p.disk,
          prices: Object.fromEntries((p.locations || []).filter((l) => known.has(l)).map((l) => [l, Number(p.monthly_cost) || 0])) }))
        .filter((t) => Object.keys(t.prices).length),
    };
  },
  async create({ location, type, name, userData, sshKey }) {
    if (!osId) {
      const os = (await vu('GET', '/os?per_page=500')).os || [];
      osId = (os.find((o) => /^Ubuntu 24\.04/i.test(o.name) && /x64/i.test(o.name)) || os.find((o) => /^Ubuntu 22\.04/i.test(o.name) && /x64/i.test(o.name)))?.id;
      if (!osId) throw new Error('Vultr nema Ubuntu 24.04 ni 22.04');
    }
    const r = await vu('POST', '/instances', {
      region: location, plan: type, os_id: osId, label: name, hostname: name, enable_ipv6: true, tags: ['veltrix-vpn'],
      user_data: Buffer.from(userData).toString('base64'), ...(sshKey ? { sshkey_id: [sshKey] } : {}),
    });
    const i = r.instance || {};
    return { id: String(i.id), ip: i.main_ip && i.main_ip !== '0.0.0.0' ? i.main_ip : '', price: 0 };
  },
  async getIp(id) { const ip = (await vu('GET', `/instances/${id}`)).instance?.main_ip; return ip && ip !== '0.0.0.0' ? ip : ''; },
  async destroy(id) { await vu('DELETE', `/instances/${id}`); },
};
