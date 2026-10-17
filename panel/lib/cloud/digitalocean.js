'use strict';
// DigitalOcean (api.digitalocean.com/v2): Droplet po satu, cijena u dolarima.
const settings = require('../settings');
const { call } = require('./http');

const API = () => (process.env.VPN_DO_API || 'https://api.digitalocean.com/v2').replace(/\/+$/, '');
const REG = {
  nyc: ['New York', 'US'], sfo: ['San Francisco', 'US'], ams: ['Amsterdam', 'NL'], sgp: ['Singapore', 'SG'], lon: ['London', 'GB'],
  fra: ['Frankfurt', 'DE'], tor: ['Toronto', 'CA'], blr: ['Bangalore', 'IN'], syd: ['Sydney', 'AU'], atl: ['Atlanta', 'US'], ric: ['Richmond', 'US'],
};
const geo = (slug) => { const r = REG[String(slug).replace(/\d+$/, '')]; return r ? { city: r[0], cc: r[1] } : { city: slug, cc: '' }; };
const doApi = (method, path, body) => call('DigitalOcean', API() + path, { method, body, headers: { authorization: `Bearer ${settings.get('do_token')}` } });

module.exports = {
  id: 'digitalocean', name: 'DigitalOcean', currency: '$', billing: 'po satu', swapIp: false, replace: true,
  note: 'Cijene su u dolarima. Promet je uključen prema veličini (od 500 GB mjesečno).',
  configured: () => !!settings.get('do_token'),
  async options() {
    const [regs, sizes] = await Promise.all([doApi('GET', '/regions?per_page=200'), doApi('GET', '/sizes?per_page=200')]);
    const avail = new Set((regs.regions || []).filter((r) => r.available).map((r) => r.slug));
    return {
      locations: (regs.regions || []).filter((r) => r.available).map((r) => ({ id: r.slug, ...geo(r.slug), label: r.name })),
      types: (sizes.sizes || []).filter((s) => s.available && s.vcpus <= 8 && !/gpu|so-|m-|m3-|c-|c2-/.test(s.slug))
        .map((s) => ({ id: s.slug, label: s.description || s.slug, cores: s.vcpus, mem: Math.round(s.memory / 1024 * 10) / 10, disk: s.disk,
          prices: Object.fromEntries((s.regions || []).filter((r) => avail.has(r)).map((r) => [r, Number(s.price_monthly) || 0])) }))
        .filter((t) => Object.keys(t.prices).length),
    };
  },
  async create({ location, type, name, userData, sshKey }) {
    const r = await doApi('POST', '/droplets', {
      name, region: location, size: type, image: 'ubuntu-24-04-x64', user_data: userData, ipv6: true, tags: ['veltrix-vpn'],
      ...(sshKey ? { ssh_keys: [sshKey] } : {}),
    });
    const d = r.droplet || {};
    return { id: String(d.id), ip: (d.networks?.v4 || []).find((n) => n.type === 'public')?.ip_address || '', price: Number(d.size?.price_monthly) || 0, geo: geo(location) };
  },
  async getIp(id) { return ((await doApi('GET', `/droplets/${id}`)).droplet?.networks?.v4 || []).find((n) => n.type === 'public')?.ip_address || ''; },
  async destroy(id) { await doApi('DELETE', `/droplets/${id}`); },
};
