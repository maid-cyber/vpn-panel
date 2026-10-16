'use strict';
// Upload na S3-kompatibilno skladište (Backblaze B2, Cloudflare R2, Wasabi, AWS) sa AWS Signature V4.
const crypto = require('node:crypto');
const settings = require('./settings');

const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const encPath = (p) => p.split('/').map((x) => encodeURIComponent(x)).join('/');

// vraća zaglavlje Authorization za zahtjev (testirano na službenom AWS primjeru)
function sign({ method, host, path, query = '', headers, payloadHash, region, key, secret, amzDate }) {
  const date = amzDate.slice(0, 8);
  const h = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(h).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + secret, date), region), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  return { auth: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`, headers: h };
}

async function put(name, body, contentType = 'application/octet-stream') {
  const s = settings.load();
  if (!s.s3_endpoint || !s.s3_bucket || !s.s3_key || !s.s3_secret) throw new Error('S3 nije podešen (endpoint, bucket, ključevi).');
  const ep = new URL(s.s3_endpoint.includes('://') ? s.s3_endpoint : 'https://' + s.s3_endpoint);
  const path = encPath(`/${s.s3_bucket}/${name}`);       // path-style radi kod svih provajdera
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const payloadHash = sha256(body);
  const { auth, headers } = sign({
    method: 'PUT', host: ep.host, path, headers: { 'content-type': contentType },
    payloadHash, region: s.s3_region || 'us-east-1', key: s.s3_key, secret: s.s3_secret, amzDate,
  });
  delete headers.host;
  const r = await fetch(`${ep.origin}${path}`, { method: 'PUT', headers: { ...headers, authorization: auth }, body, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`S3 ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
  return true;
}

module.exports = { put, sign };
