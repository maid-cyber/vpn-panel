'use strict';
// Javni API za prodajnog bota ili sajt. Ključ ide u zaglavlje: Authorization: Bearer vnx_...
const crypto = require('node:crypto');
const { one, all, run, now } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const core = require('./core');
const { fail, send, readBody } = require('./http');

async function handle(req, res, p) {
  if (!settings.get('api_on')) fail(403, 'API je isključen u postavkama.');
  const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const row = key ? one('SELECT * FROM api_keys WHERE key_hash = ?', crypto.createHash('sha256').update(key).digest('hex')) : null;
  if (!row) fail(401, 'Neispravan API ključ.');
  run('UPDATE api_keys SET last_used = ? WHERE id = ?', now(), row.id);
  const actor = { id: 0, username: `api:${row.name}`, role: 'admin' };
  const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
  const base = (settings.get('sub_url') || settings.get('panel_url') || `http://${req.headers.host}`).replace(/\/+$/, '');
  const out = (u) => ({ ...core.userRow(u), sub_link: `${base}/s/${u.sub_token}` });
  const byName = (name) => {
    const u = one(`${core.USER_SELECT} WHERE u.username = ?`, decodeURIComponent(name));
    if (!u) fail(404, 'Korisnik ne postoji.');
    return u;
  };
  let m;
  if (p === '/api/v1/plans' && req.method === 'GET') return send(res, 200, all('SELECT id, name, days, traffic_gb, devices, price, trial FROM plans WHERE active = 1 ORDER BY sort, id'));
  if (p === '/api/v1/users' && req.method === 'POST') {
    const id = core.createUser(actor, body);
    return send(res, 200, out(one(`${core.USER_SELECT} WHERE u.id = ?`, id)));
  }
  if ((m = p.match(/^\/api\/v1\/users\/([^/]+)$/)) && req.method === 'GET') return send(res, 200, out(byName(m[1])));
  if ((m = p.match(/^\/api\/v1\/users\/([^/]+)\/(extend|disable|enable)$/)) && req.method === 'POST') {
    const u = byName(m[1]);
    if (m[2] === 'extend') core.extendUser(actor, u.id, body);
    else core.setDisabled(actor, u.id, m[2] === 'disable');
    return send(res, 200, out(byName(m[1])));
  }
  fail(404, 'Nepoznata API putanja.');
}

module.exports = { handle };
