'use strict';
// Šifre, sesije, 2FA (TOTP), zaključavanje prijave i dozvole po ulozi.
const crypto = require('node:crypto');
const net = require('node:net');
const { one, all, run, now } = require('./db');
const settings = require('./settings');

// ---------- šifre ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [alg, s, k] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8;
}
// Lažni hash iste cijene: provjeravamo šifru i kad korisnik ne postoji, da se po vremenu
// odgovora ne može saznati koja korisnička imena postoje (user enumeration).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

// ---------- TOTP (Google Authenticator) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
function newTotpSecret() { return base32(crypto.randomBytes(20)); }
function checkTotp(secret, code) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !secret) return false;
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => totpAt(secret, step + d) === code);
}

// ---------- IP ----------
function ipAllowed(ip) {
  if (!settings.get('ip_whitelist_on')) return true;
  const list = String(settings.get('ip_whitelist') || '').split(/[,\s]+/).filter(Boolean);
  if (!list.length) return true;
  const addr = ip.replace(/^::ffff:/, '');
  if (addr === '127.0.0.1' || addr === '::1') return true;
  return list.some((entry) => {
    const [base, bitsStr] = entry.split('/');
    if (!bitsStr) return base === addr;
    if (!net.isIPv4(base) || !net.isIPv4(addr)) return false;
    const toInt = (a) => a.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
    const bits = Number(bitsStr);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toInt(base) & mask) === (toInt(addr) & mask);
  });
}

function lockoutRule() {
  const [n, mins] = String(settings.get('lockout') || '5/15').split('/').map(Number);
  return { max: n || 5, window: (mins || 15) * 60000 };
}
function isLocked(ip) {
  const { max, window } = lockoutRule();
  const r = one('SELECT COUNT(*) AS n FROM login_fail WHERE ip = ? AND ts > ?', ip, now() - window);
  return r.n >= max;
}
function addFail(ip) { run('INSERT INTO login_fail (ip, ts) VALUES (?, ?)', ip, now()); }
function clearFails(ip) { run('DELETE FROM login_fail WHERE ip = ?', ip); }

// ---------- sesije ----------
function createSession(adminId, ip, ua, totpOk) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token, admin_id, created, last_active, ip, ua, totp_ok) VALUES (?,?,?,?,?,?,?)',
    token, adminId, now(), now(), ip, String(ua || '').slice(0, 200), totpOk ? 1 : 0);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token = ?', token);
  if (!s) return null;
  const idle = Number(settings.get('session_minutes') || 720) * 60000;
  if (now() - s.last_active > idle) { run('DELETE FROM sessions WHERE token = ?', token); return null; }
  if (now() - s.last_active > 30000) run('UPDATE sessions SET last_active = ? WHERE token = ?', now(), token);
  const admin = one('SELECT * FROM admins WHERE id = ? AND disabled = 0', s.admin_id);
  if (!admin) return null;
  const actingAs = s.as_id ? one("SELECT * FROM admins WHERE id = ? AND role = 'reseller'", s.as_id) : null;
  return { session: s, admin, me: actingAs || admin, impersonating: !!actingAs };
}
function deleteSession(token) { run('DELETE FROM sessions WHERE token = ?', token); }

// ---------- dozvole ----------
// owner: sve. admin: sve osim admin naloga. support: korisnici i serveri (čitanje). finance: finansije.
const PERMS = {
  owner: ['*'],
  admin: ['dash', 'users', 'plans', 'servers', 'resellers', 'finance', 'logs', 'settings', 'backup'],
  support: ['dash', 'users', 'servers:read', 'plans:read'],
  finance: ['dash', 'finance', 'resellers:read', 'users:read'],
  reseller: ['res'],
};
function can(admin, perm) {
  const list = PERMS[admin.role] || [];
  if (list.includes('*')) return true;
  if (list.includes(perm)) return true;
  if (perm.endsWith(':read')) return list.includes(perm.split(':')[0]);
  return false;
}

module.exports = {
  hashPassword, checkPassword, validPassword, newTotpSecret, checkTotp, totpAt,
  ipAllowed, isLocked, addFail, clearFails, createSession, getSession, deleteSession, can, DUMMY_HASH,
};
