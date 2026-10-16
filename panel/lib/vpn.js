'use strict';
// Ključevi, status korisnika, konfiguracija za VPN servere (Xray + WireGuard) i linkovi za aplikacije.
const crypto = require('node:crypto');
const { one, all, now } = require('./db');
const settings = require('./settings');

const DAY = 86400000;

// ---------- ključevi ----------
function x25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const priv = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  return { pub, priv };
}
function realityKeys() { const k = x25519(); return { priv: k.priv.toString('base64url'), pub: k.pub.toString('base64url') }; }
function wgKeys() { const k = x25519(); return { priv: k.priv.toString('base64'), pub: k.pub.toString('base64') }; }
function shortId() { return crypto.randomBytes(8).toString('hex'); }
function uuid() { return crypto.randomUUID(); }
function subToken() { return crypto.randomBytes(12).toString('base64url'); }
function wgIp(userId) { const n = userId + 1; return `10.66.${(n >> 8) & 255}.${n & 255}`; }
function pickSni() {
  const list = String(settings.get('sni_list') || '').split(/[,\s]+/).filter(Boolean);
  return list.length ? list[Math.floor(Math.random() * list.length)] : 'www.microsoft.com';
}

// ---------- status korisnika ----------
// active | expiring | grace | expired | limited | disabled
function userStatus(u, t = now()) {
  if (u.disabled) return 'disabled';
  const grace = Number(settings.get('grace_days') || 0) * DAY;
  if (t > u.expires_at + grace) return 'expired';
  if (u.traffic_limit > 0 && u.traffic_up + u.traffic_down >= u.traffic_limit) return 'limited';
  if (t > u.expires_at) return 'grace';
  if (u.expires_at - t <= Number(settings.get('expiry_warn_days') || 3) * DAY) return 'expiring';
  return 'active';
}
const CAN_CONNECT = new Set(['active', 'expiring', 'grace']);

function planServers(plan) {
  try { const l = JSON.parse(plan?.locations || '[]'); return Array.isArray(l) ? l.map(Number) : []; } catch { return []; }
}
function serverAllowed(plan, serverId) {
  const l = planServers(plan);
  return !l.length || l.includes(serverId);
}

// ---------- konfiguracija za jedan server ----------
// AdGuard DNS: 94.140.14.14 blokira reklame i praćenje, 94.140.14.15 (Family) još i stranice za odrasle
function filterDns(s) {
  if (s.block_adult) return '94.140.14.15';
  if (s.block_ads) return '94.140.14.14';
  return s.dns || '1.1.1.1';
}

function nodeConfig(server) {
  const plans = Object.fromEntries(all('SELECT * FROM plans').map((p) => [p.id, p]));
  const t = now();
  const users = all('SELECT id, uuid, wg_pub, disabled, expires_at, traffic_limit, traffic_up, traffic_down, plan_id FROM users')
    .filter((u) => CAN_CONNECT.has(userStatus(u, t)) && serverAllowed(plans[u.plan_id], server.id));
  const s = settings.load();

  let xray = null;
  if (s.proto_vless && server.reality_priv) {
    // DNS kupca (port 53) ide u Xray DNS: tako blokiranje radi i kad stranica sakrije ime (ECH, šifrovani SNI)
    const rules = [{ type: 'field', inboundTag: ['api'], outboundTag: 'api' }, { type: 'field', inboundTag: ['vless'], port: '53', outboundTag: 'dns-out' }];
    if (s.block_private) rules.push({ type: 'field', ip: ['geoip:private'], outboundTag: 'block' });
    if (s.block_torrent) rules.push({ type: 'field', protocol: ['bittorrent'], outboundTag: 'block' });
    if (s.block_ads) rules.push({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
    if (s.block_adult) rules.push({ type: 'field', domain: ['geosite:category-porn'], outboundTag: 'block' });
    xray = {
      log: { loglevel: 'warning', access: 'none' },
      api: { tag: 'api', services: ['StatsService', 'HandlerService'] },
      stats: {},
      policy: { levels: { 0: { statsUserUplink: true, statsUserDownlink: true } } },
      dns: { servers: [filterDns(s)], queryStrategy: 'UseIPv4' },
      inbounds: [
        { tag: 'api', listen: '127.0.0.1', port: 10085, protocol: 'dokodemo-door', settings: { address: '127.0.0.1' } },
        {
          tag: 'vless', listen: '0.0.0.0', port: server.vless_port, protocol: 'vless',
          settings: { clients: users.map((u) => ({ id: u.uuid, email: `u${u.id}`, flow: 'xtls-rprx-vision' })), decryption: 'none' },
          streamSettings: {
            network: 'tcp', security: 'reality',
            realitySettings: { show: false, dest: `${server.sni}:443`, xver: 0, serverNames: [server.sni], privateKey: server.reality_priv, shortIds: [server.short_id] },
          },
          sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
        },
      ],
      outbounds: [{ protocol: 'freedom', tag: 'direct', settings: { domainStrategy: 'UseIPv4' } }, { protocol: 'blackhole', tag: 'block' }, { protocol: 'dns', tag: 'dns-out' }],
      routing: { domainStrategy: 'IPIfNonMatch', rules },
    };
  }

  let wg = null;
  if (s.proto_wg && server.wg_priv) {
    wg = {
      private_key: server.wg_priv, port: server.wg_port, address: '10.66.0.1/16',
      peers: users.filter((u) => u.wg_pub).map((u) => ({ id: u.id, pub: u.wg_pub, ip: wgIp(u.id) })),
    };
  }
  const body = { xray, wg, user_ids: users.map((u) => u.id) };
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { hash, ...body };
}

// ---------- linkovi za kupca ----------
function serversForUser(u) {
  const plan = u.plan_id ? one('SELECT * FROM plans WHERE id = ?', u.plan_id) : null;
  return all('SELECT * FROM servers WHERE enabled = 1 AND maintenance = 0 ORDER BY country, name')
    .filter((sv) => serverAllowed(plan, sv.id) && sv.host);
}
const FLAGS = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

function vlessLink(u, sv) {
  const q = new URLSearchParams({ encryption: 'none', flow: 'xtls-rprx-vision', security: 'reality', sni: sv.sni, fp: 'chrome', pbk: sv.reality_pub, sid: sv.short_id, type: 'tcp' });
  const name = `${FLAGS(sv.country)} ${sv.city || sv.name}`.trim();
  return `vless://${u.uuid}@${sv.host}:${sv.vless_port}?${q.toString()}#${encodeURIComponent(name)}`;
}
function wgConfig(u, sv) {
  const dns = filterDns(settings.load());
  return `[Interface]\nPrivateKey = ${u.wg_priv}\nAddress = ${wgIp(u.id)}/32\nDNS = ${dns}\n\n[Peer]\nPublicKey = ${sv.wg_pub}\nEndpoint = ${sv.host}:${sv.wg_port}\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n`;
}
function subLinks(u) {
  if (!settings.get('proto_vless')) return [];
  return serversForUser(u).filter((sv) => sv.reality_pub).map((sv) => vlessLink(u, sv));
}

module.exports = {
  realityKeys, wgKeys, shortId, uuid, subToken, wgIp, pickSni, userStatus, CAN_CONNECT,
  nodeConfig, serversForUser, vlessLink, wgConfig, subLinks, planServers, FLAGS, DAY,
};
