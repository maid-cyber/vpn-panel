'use strict';
// Pomoćne funkcije za HTTP odgovore i čitanje zahtjeva.

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new HttpError(code, message); };

function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body), isStr = typeof body === 'string';
  const data = isBuf || isStr ? body : JSON.stringify(body);
  res.writeHead(code, {
    'content-type': isBuf || isStr ? (headers['content-type'] || 'text/plain; charset=utf-8') : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',                               // protiv clickjackinga (panel i stranica kupca)
    'content-security-policy': "frame-ancestors 'none'",     // isto, za moderne preglednike
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 1 << 20, raw = false) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Zahtjev je prevelik.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (raw) return resolve(buf);
      if (!buf.length) return resolve({});
      try { resolve(JSON.parse(buf.toString('utf8'))); } catch { reject(new HttpError(400, 'Neispravan JSON.')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const fwd = req.headers['x-forwarded-for'];
  // Iza reverznog proxyja (Caddy na localhostu) pravu IP dodaje proxy na KRAJ liste.
  // Uzimamo zadnji unos — prvi je lako lažirati (klijent ga pošalje), pa bi se inače
  // mogao zaobići lockout prijave i IP whitelist, i lažirati upozorenja o novoj IP.
  if (fwd && (remote === '127.0.0.1' || remote === '::1')) {
    const parts = String(fwd).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1].replace(/^::ffff:/, '');
  }
  return remote;
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { HttpError, fail, send, readBody, clientIp, cookies, isHttps, esc };
