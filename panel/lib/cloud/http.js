'use strict';
// Zajednički HTTP poziv prema hosterima: jasne poruke na bosanskom umjesto sirovih grešaka.
const { fail } = require('../http');

async function call(label, url, { method = 'GET', headers = {}, body, raw } = {}) {
  let r;
  try {
    r = await fetch(url, {
      method, headers: { accept: 'application/json', ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
  } catch (e) { fail(502, `Ne mogu doći do ${label}: ${e.message}`); }
  const text = r.status === 204 ? '' : await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { message: text.slice(0, 200) }; }
  if (!r.ok) {
    const msg = j.error?.message || j.message || j.error_description || (typeof j.error === 'string' ? j.error : '') || `greška ${r.status}`;
    if (r.status === 401) fail(400, `${label}: ključ ne važi ili je istekao. Napravi novi i upiši ga u Postavke → Hosteri.`);
    if (r.status === 403) fail(400, `${label}: ključ nema dozvolu za ovo (treba pravo pisanja). ${msg}`);
    fail(502, `${label}: ${msg}`);
  }
  return j;
}

const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
const pollMs = () => Number(process.env.VPN_CLOUD_POLL_MS) || 3000;

module.exports = { call, sleep, pollMs };
