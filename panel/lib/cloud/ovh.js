'use strict';
// OVHcloud Public Cloud (eu.api.ovh.com): instanca po satu u Public Cloud projektu.
// Klasični OVH "VPS" se ne može naručiti preko API-ja (ide kroz korpu i plaćanje), zato koristimo Public Cloud.
const crypto = require('node:crypto');
const settings = require('../settings');
const { call } = require('./http');
const { fail } = require('../http');

const BASES = { eu: 'https://eu.api.ovh.com/1.0', ca: 'https://ca.api.ovh.com/1.0', us: 'https://api.us.ovhcloud.com/1.0' };
const base = () => (process.env.VPN_OVH_API || BASES[settings.get('ovh_endpoint')] || BASES.eu).replace(/\/+$/, '');
const REG = [
  [/^GRA/, 'Gravelines', 'FR'], [/^SBG/, 'Strasbourg', 'FR'], [/^RBX/, 'Roubaix', 'FR'], [/^EU-WEST-PAR|^PAR/, 'Paris', 'FR'], [/^BHS/, 'Beauharnois', 'CA'],
  [/^WAW/, 'Warsaw', 'PL'], [/^DE/, 'Frankfurt', 'DE'], [/^UK/, 'London', 'GB'], [/^SGP/, 'Singapore', 'SG'], [/^SYD/, 'Sydney', 'AU'],
  [/^US-EAST/, 'Vint Hill', 'US'], [/^US-WEST/, 'Hillsboro', 'US'], [/^EU-SOUTH-MIL/, 'Milan', 'IT'], [/^CA-EAST-TOR/, 'Toronto', 'CA'], [/^AP-SOUTH-MUM/, 'Mumbai', 'IN'],
];
const geo = (r) => { const m = REG.find(([re]) => re.test(r)); return m ? { city: m[1], cc: m[2] } : { city: r, cc: '' }; };
let skew = null;

async function ovh(method, path, body) {
  const ak = settings.get('ovh_app_key'), as = settings.get('ovh_app_secret'), ck = settings.get('ovh_consumer_key');
  if (!ak || !as || !ck) fail(400, 'Upiši sva tri OVH ključa u Postavke → Hosteri.');
  if (skew === null) { const t = await call('OVH', base() + '/auth/time'); skew = Number(t) - Math.floor(Date.now() / 1000); }
  const url = base() + path, ts = String(Math.floor(Date.now() / 1000) + skew), b = body === undefined ? '' : JSON.stringify(body);
  const sig = '$1$' + crypto.createHash('sha1').update([as, ck, method, url, b, ts].join('+')).digest('hex');
  return call('OVH', url, { method, body: body === undefined ? undefined : b, raw: true,
    headers: { 'X-Ovh-Application': ak, 'X-Ovh-Consumer': ck, 'X-Ovh-Timestamp': ts, 'X-Ovh-Signature': sig, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) } });
}
const proj = () => { const p = String(settings.get('ovh_project') || '').trim(); if (!p) fail(400, 'Upiši ID OVH Public Cloud projekta u Postavke → Hosteri.'); return encodeURIComponent(p); };

module.exports = {
  id: 'ovh', name: 'OVHcloud (Public Cloud)', currency: '€', billing: 'po satu', swapIp: false, replace: true,
  note: 'Koristi OVH Public Cloud (plaćanje po satu). Promet je neograničen. Cijenu vidiš u OVH cjeniku.',
  configured: () => !!(settings.get('ovh_app_key') && settings.get('ovh_app_secret') && settings.get('ovh_consumer_key') && settings.get('ovh_project')),
  async options() {
    const flavors = await ovh('GET', `/cloud/project/${proj()}/flavor`);
    const list = (Array.isArray(flavors) ? flavors : []).filter((f) => f.available !== false && f.osType === 'linux' && f.vcpus <= 8 && !/win|gpu|t1-|t2-|l4-|a10|a100|h100/i.test(f.name));
    const regions = [...new Set(list.map((f) => f.region))].sort();
    const types = new Map();
    for (const f of list) {
      const t = types.get(f.name) || { id: f.name, label: f.name, cores: f.vcpus, mem: Math.round(f.ram / 1024 * 10) / 10, disk: f.disk, prices: {} };
      t.prices[f.region] = null;   // OVH ne daje cijenu preko ovog API-ja
      types.set(f.name, t);
    }
    return { locations: regions.map((r) => ({ id: r, ...geo(r), label: r })), types: [...types.values()].sort((a, b) => a.cores - b.cores || a.mem - b.mem) };
  },
  async create({ location, type, name, userData, sshKey }) {
    const p = proj();
    const flavors = await ovh('GET', `/cloud/project/${p}/flavor?region=${encodeURIComponent(location)}`);
    const flavor = (flavors || []).find((f) => f.name === type && f.region === location);
    if (!flavor) throw new Error(`OVH nema veličinu ${type} u ${location}`);
    const images = await ovh('GET', `/cloud/project/${p}/image?osType=linux&region=${encodeURIComponent(location)}`);
    const img = (images || []).find((i) => /^Ubuntu 24\.04/i.test(i.name)) || (images || []).find((i) => /^Ubuntu 22\.04/i.test(i.name));
    if (!img) throw new Error('OVH nema Ubuntu 24.04 ni 22.04 u ovoj regiji');
    const r = await ovh('POST', `/cloud/project/${p}/instance`, { flavorId: flavor.id, imageId: img.id, name, region: location, userData, monthlyBilling: false, ...(sshKey ? { sshKeyId: sshKey } : {}) });
    return { id: String(r.id), ip: (r.ipAddresses || []).find((a) => a.type === 'public' && a.version === 4)?.ip || '', price: 0, geo: geo(location) };
  },
  async getIp(id) { return ((await ovh('GET', `/cloud/project/${proj()}/instance/${encodeURIComponent(id)}`)).ipAddresses || []).find((a) => a.type === 'public' && a.version === 4)?.ip || ''; },
  async destroy(id) { await ovh('DELETE', `/cloud/project/${proj()}/instance/${encodeURIComponent(id)}`); },
};
