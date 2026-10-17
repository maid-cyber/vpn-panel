'use strict';
// Contabo (api.contabo.com): jeftino, ali to je UGOVOR na mjesec dana, ne plaćanje po satu.
// Brisanje = otkaz ugovora (server radi do kraja plaćenog perioda).
const crypto = require('node:crypto');
const settings = require('../settings');
const { call } = require('./http');
const { fail } = require('../http');

const API = () => (process.env.VPN_CONTABO_API || 'https://api.contabo.com').replace(/\/+$/, '');
const AUTH = () => process.env.VPN_CONTABO_AUTH || 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token';
const REGIONS = [
  ['EU', 'Nuremberg', 'DE'], ['UK', 'Portsmouth', 'GB'], ['US-central', 'St. Louis', 'US'], ['US-east', 'New York', 'US'], ['US-west', 'Seattle', 'US'],
  ['SIN', 'Singapore', 'SG'], ['JPN', 'Tokyo', 'JP'], ['AUS', 'Sydney', 'AU'], ['IND', 'Mumbai', 'IN'],
];
// proizvodi iz Contabo API dokumentacije (cijene nisu dostupne preko API-ja)
const PRODUCTS = [
  ['V153', 'Cloud VPS 4 · 100 GB SSD'], ['V159', 'Cloud VPS Plus 4 · 150 GB NVMe'], ['V154', 'Cloud VPS 6 · 200 GB SSD'],
  ['V160', 'Cloud VPS Plus 6 · 300 GB NVMe'], ['V155', 'Cloud VPS 8 · 300 GB SSD'], ['V8', 'VDS S · 180 GB NVMe'],
];
let tok = { v: '', exp: 0 };

async function token() {
  if (tok.v && Date.now() < tok.exp - 30000) return tok.v;
  const id = settings.get('contabo_client_id'), secret = settings.get('contabo_client_secret'), user = settings.get('contabo_user'), pass = settings.get('contabo_pass');
  if (!id || !secret || !user || !pass) fail(400, 'Upiši sva četiri Contabo podatka u Postavke → Hosteri.');
  const j = await call('Contabo', AUTH(), { method: 'POST', raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, username: user, password: pass, grant_type: 'password' }).toString() });
  tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 };
  return tok.v;
}
const cb = async (method, path, body) => call('Contabo', API() + path, { method, body, headers: { authorization: `Bearer ${await token()}`, 'x-request-id': crypto.randomUUID() } });

module.exports = {
  id: 'contabo', name: 'Contabo', currency: '€', billing: 'mjesečni ugovor', swapIp: false, replace: false,
  note: 'Pažnja: Contabo naplaćuje mjesec unaprijed (ugovor na 1 mjesec), a u nekim regijama i jednokratnu naknadu. Brisanje otkazuje ugovor, server radi do kraja plaćenog mjeseca. Instalacija može trajati i do sat vremena.',
  configured: () => !!(settings.get('contabo_client_id') && settings.get('contabo_client_secret') && settings.get('contabo_user') && settings.get('contabo_pass')),
  async options() {
    await token();   // provjeri ključeve odmah
    return {
      locations: REGIONS.map(([id, city, cc]) => ({ id, city, cc })),
      types: PRODUCTS.map(([id, label]) => ({ id, label, prices: Object.fromEntries(REGIONS.map(([r]) => [r, null])) })),
    };
  },
  async create({ location, type, name, userData, sshKey }) {
    const imgs = (await cb('GET', '/v1/compute/images?standardImage=true&search=ubuntu&size=100')).data || [];
    const img = imgs.find((i) => String(i.version || i.name).includes('24.04')) || imgs.find((i) => String(i.version || i.name).includes('22.04'));
    if (!img) throw new Error('Contabo nema Ubuntu 24.04 ni 22.04');
    const r = await cb('POST', '/v1/compute/instances', {
      imageId: img.imageId, productId: type, region: location, period: 1, displayName: name, userData, defaultUser: 'root',
      ...(sshKey ? { sshKeys: [Number(sshKey)] } : {}),
    });
    const d = (r.data || [])[0] || {};
    const reg = REGIONS.find(([id]) => id === location);
    return { id: String(d.instanceId), ip: d.ipConfig?.v4?.ip || '', price: 0, geo: reg ? { city: reg[1], cc: reg[2] } : null };
  },
  async getIp(id) { return ((await cb('GET', `/v1/compute/instances/${encodeURIComponent(id)}`)).data || [])[0]?.ipConfig?.v4?.ip || ''; },
  async destroy(id) { await cb('POST', `/v1/compute/instances/${encodeURIComponent(id)}/cancel`, {}); },
};
