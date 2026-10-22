'use strict';
// Telegram obavijesti, webhook i određivanje države po IP adresi.
const fs = require('node:fs');
const path = require('node:path');
const settings = require('./settings');
const { log } = require('./db');

async function telegram(text, opts = {}) {
  const token = settings.get('tg_token'), chat = settings.get('tg_chat');
  if (!token || !chat) return { ok: false, error: 'Telegram nije podešen (token i chat ID).' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `${settings.get('brand')} · ${text}`, disable_web_page_preview: true, ...opts }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, error: j.description || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function telegramFile(file, caption) {
  const token = settings.get('tg_token'), chat = settings.get('tg_chat');
  if (!token || !chat) return { ok: false, error: 'Telegram nije podešen.' };
  try {
    const fd = new FormData();
    fd.append('chat_id', chat);
    fd.append('caption', caption || '');
    fd.append('document', new Blob([fs.readFileSync(file)]), path.basename(file));
    const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, error: j.description || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

// šalje samo ako je ta vrsta obavijesti uključena u postavkama
function notify(kind, text) {
  if (kind && !settings.get(kind)) return;
  telegram(text).then((r) => { if (!r.ok && settings.get('tg_token')) log('sistem', 'Telegram greška', r.error, 'warn'); });
}

function webhook(event, data) {
  const url = settings.get('webhook_url');
  if (!url || !/^https?:\/\//.test(url)) return;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, data, ts: Date.now() }), signal: AbortSignal.timeout(8000) })
    .catch((e) => log('sistem', 'Webhook greška', e.message, 'warn'));
}

// ---------- država po IP adresi (ip-api.com, besplatno). IP se nigdje ne sprema. ----------
const geoCache = new Map();
async function geoIp(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (!ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/.test(ip)) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,country,city,lat,lon,isp`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    const out = j.status === 'success' ? { cc: j.countryCode, country: j.country, city: j.city, lat: j.lat, lon: j.lon, isp: j.isp || '' } : null;
    if (geoCache.size > 5000) geoCache.clear();
    geoCache.set(ip, out);
    return out;
  } catch { return null; }
}

// samo iz keša (bez upita prema vani): za mapu uživo, da ne trošimo limit ip-api
function geoCached(ip) { return geoCache.get(String(ip || '').replace(/^::ffff:/, '')) || null; }

module.exports = { telegram, telegramFile, notify, webhook, geoIp, geoCached };
