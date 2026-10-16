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
// Shadowsocks 2022: ključ servera i ključ korisnika (16 bajtova), izvedeni iz postojećih tajni
function ssServerKey(server) { return crypto.createHash('sha256').update('ss-server:' + server.reality_priv).digest().subarray(0, 16).toString('base64'); }
function ssUserKey(u) { return crypto.createHash('sha256').update('ss-user:' + u.uuid).digest().subarray(0, 16).toString('base64'); }
const SS_METHOD = '2022-blake3-aes-128-gcm';
function wgIp(userId) { const n = userId + 1; return `10.66.${(n >> 8) & 255}.${n & 255}`; }
function pickSni() {
  const list = String(settings.get('sni_list') || '').split(/[,\s]+/).filter(Boolean);
  return list.length ? list[Math.floor(Math.random() * list.length)] : 'www.microsoft.com';
}

// ---------- status korisnika ----------
// active | expiring | grace | expired | limited | disabled
function userStatus(u, t = now()) {
  if (u.disabled) return 'disabled';
  if (u.blocked_until && u.blocked_until > t) return 'devices';
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

// ---------- oznake servera i lanci (Double VPN / Multihop) ----------
const TAGS = ['p2p', 'streaming', 'gaming', 'special'];
const serverTags = (sv) => String(sv?.tags || '').split(',').map((x) => x.trim()).filter((x) => TAGS.includes(x));
// UUID "prenosnika" između servera u lancu: izveden iz tajne lanca, isti na svim serverima
function relayUuid(chain) {
  const h = crypto.createHash('sha256').update('relay:' + chain.secret).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const chainHops = (c) => { try { return JSON.parse(c.hops).map(Number); } catch { return []; } };
function chainServers(c) {
  const byId = Object.fromEntries(all('SELECT * FROM servers').map((sv) => [sv.id, sv]));
  return chainHops(c).map((id) => byId[id]).filter(Boolean);
}
// lanac radi samo ako su svi serveri upaljeni, imaju Reality ključ i adresu
function chainUsable(c, hops = chainServers(c)) {
  return c.enabled && hops.length >= 2 && hops.length === chainHops(c).length && hops.every((sv) => sv.enabled && !sv.maintenance && sv.reality_pub && sv.host);
}
const chainKind = (c) => (chainHops(c).length > 2 ? 'multihop' : 'double');
const realityClient = (sv) => ({ show: false, fingerprint: 'chrome', serverName: sv.sni, publicKey: sv.reality_pub, shortId: sv.short_id, spiderX: '/' });

// ---------- konfiguracija za jedan server ----------
// AdGuard DNS: 94.140.14.14 blokira reklame i praćenje, 94.140.14.15 (Family) još i stranice za odrasle
function filterDns(s) {
  if (s.block_adult) return '94.140.14.15';
  if (s.block_ads) return '94.140.14.14';
  if (s.block_malware) return '9.9.9.9';
  return s.dns || '1.1.1.1';
}

function nodeConfig(server) {
  const plans = Object.fromEntries(all('SELECT * FROM plans').map((p) => [p.id, p]));
  const t = now();
  const users = all('SELECT id, uuid, wg_pub, disabled, blocked_until, expires_at, traffic_limit, traffic_up, traffic_down, plan_id FROM users')
    .filter((u) => CAN_CONNECT.has(userStatus(u, t)) && serverAllowed(plans[u.plan_id], server.id));
  const s = settings.load();

  let xray = null;
  if ((s.proto_vless || s.proto_ss) && server.reality_priv) {
    const tags = [s.proto_vless && 'vless', s.proto_ss && 'ss'].filter(Boolean);
    // DNS kupca (port 53) ide u Xray DNS: tako blokiranje radi i kad stranica sakrije ime (ECH, šifrovani SNI)
    const rules = [{ type: 'field', inboundTag: ['api'], outboundTag: 'api' }, { type: 'field', inboundTag: tags, port: '53', outboundTag: 'dns-out' }];
    if (s.block_private) rules.push({ type: 'field', ip: ['geoip:private'], outboundTag: 'block' });
    // P2P serveri dozvoljavaju torrent, ostali ga blokiraju (ako je blokada uključena)
    if (s.block_torrent && !serverTags(server).includes('p2p')) rules.push({ type: 'field', protocol: ['bittorrent'], outboundTag: 'block' });
    if (s.block_ads) rules.push({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
    if (s.block_adult) rules.push({ type: 'field', domain: ['geosite:category-porn'], outboundTag: 'block' });
    xray = {
      // pristupni log samo u RAM-u (/dev/shm) za brojanje uređaja; agent ga čita i briše svakih par sekundi
      log: { loglevel: 'warning', access: s.device_limit !== 'iskljuceno' ? '/dev/shm/vpn-access.log' : 'none' },
      api: { tag: 'api', services: ['StatsService', 'HandlerService'] },
      stats: {},
      policy: { levels: { 0: { statsUserUplink: true, statsUserDownlink: true } } },
      dns: { servers: [filterDns(s)], queryStrategy: 'UseIPv4' },
      inbounds: [
        { tag: 'api', listen: '127.0.0.1', port: 10085, protocol: 'dokodemo-door', settings: { address: '127.0.0.1' } },
        ...(s.proto_vless ? [{
          tag: 'vless', listen: '0.0.0.0', port: server.vless_port, protocol: 'vless',
          settings: { clients: users.map((u) => ({ id: u.uuid, email: `u${u.id}`, flow: 'xtls-rprx-vision' })), decryption: 'none' },
          streamSettings: {
            network: 'tcp', security: 'reality',
            realitySettings: { show: false, dest: `${server.sni}:443`, xver: 0, serverNames: [server.sni], privateKey: server.reality_priv, shortIds: [server.short_id] },
          },
          sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
        }] : []),
        ...(s.proto_ss ? [{
          tag: 'ss', listen: '0.0.0.0', port: server.ss_port || 8388, protocol: 'shadowsocks',
          settings: { method: SS_METHOD, password: ssServerKey(server), network: 'tcp,udp', clients: users.map((u) => ({ password: ssUserKey(u), email: `u${u.id}` })) },
          sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
        }] : []),
      ],
      outbounds: [{ protocol: 'freedom', tag: 'direct', settings: { domainStrategy: 'UseIPv4' } }, { protocol: 'blackhole', tag: 'block' }, { protocol: 'dns', tag: 'dns-out' }],
      routing: { domainStrategy: 'IPIfNonMatch', rules },
    };
    if (s.proto_vless) addChains(xray, server, users, plans, t);
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

// Lanci: na ulaznom i srednjem serveru poseban inbound (port lanca) koji sav promet šalje dalje na sljedeći server.
// Izlazni server prima promet kao običan VLESS korisnik ("relay"), pa tamo važe DNS filteri i blokade.
function addChains(xray, server, users, plans) {
  for (const c of all('SELECT * FROM chains WHERE enabled = 1')) {
    const hops = chainServers(c);
    const i = hops.findIndex((sv) => sv.id === server.id);
    if (i < 0 || !chainUsable(c, hops)) continue;
    const relay = { id: relayUuid(c), email: `relay${c.id}`, flow: 'xtls-rprx-vision' };
    if (i === hops.length - 1) {
      xray.inbounds.find((ib) => ib.tag === 'vless')?.settings.clients.push(relay);
      continue;
    }
    const exit = hops[hops.length - 1], next = hops[i + 1];
    const clients = i === 0
      ? users.filter((u) => serverAllowed(plans[u.plan_id], exit.id)).map((u) => ({ id: u.uuid, email: `u${u.id}`, flow: 'xtls-rprx-vision' }))
      : [relay];
    const tag = `chain${c.id}`;
    xray.inbounds.push({
      tag, listen: '0.0.0.0', port: c.port, protocol: 'vless',
      settings: { clients, decryption: 'none' },
      streamSettings: { network: 'tcp', security: 'reality', realitySettings: { show: false, dest: `${server.sni}:443`, xver: 0, serverNames: [server.sni], privateKey: server.reality_priv, shortIds: [server.short_id] } },
    });
    xray.outbounds.push({
      tag, protocol: 'vless',
      settings: { vnext: [{ address: next.host, port: i + 1 === hops.length - 1 ? next.vless_port : c.port, users: [{ id: relay.id, encryption: 'none', flow: 'xtls-rprx-vision' }] }] },
      streamSettings: { network: 'tcp', security: 'reality', realitySettings: realityClient(next) },
    });
    xray.routing.rules.splice(1, 0, { type: 'field', inboundTag: [tag], outboundTag: tag });
  }
}

/** Lanci koje kupac smije koristiti (izlazni server mora biti u njegovom planu). */
function chainsForUser(u) {
  const plan = u.plan_id ? one('SELECT * FROM plans WHERE id = ?', u.plan_id) : null;
  return all('SELECT * FROM chains WHERE enabled = 1 ORDER BY id').map((c) => ({ c, hops: chainServers(c) }))
    .filter(({ c, hops }) => chainUsable(c, hops) && serverAllowed(plan, hops[hops.length - 1].id));
}

// ---------- linkovi za kupca ----------
function serversForUser(u) {
  const plan = u.plan_id ? one('SELECT * FROM plans WHERE id = ?', u.plan_id) : null;
  const list = all('SELECT * FROM servers WHERE enabled = 1 AND maintenance = 0 ORDER BY country, name')
    .filter((sv) => serverAllowed(plan, sv.id) && sv.host);
  const s = settings.load();
  if (!s.sub_smart) return list;
  // skloni servere koji ne rade ili su puni; ako ne ostane nijedan, daj sve
  const off = Number(s.offline_sec || 45) * 1000, t = now();
  const good = list.filter((sv) => sv.last_seen && t - sv.last_seen < off * 4 && !(sv.capacity && sv.online >= sv.capacity));
  return good.length ? good : list;
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
function ssLink(u, sv) {
  const name = `${FLAGS(sv.country)} ${sv.city || sv.name} · SS`.trim();
  return `ss://${encodeURIComponent(`${SS_METHOD}:${ssServerKey(sv)}:${ssUserKey(u)}`)}@${sv.host}:${sv.ss_port || 8388}#${encodeURIComponent(name)}`;
}
function subLinks(u) {
  const s = settings.load();
  const servers = serversForUser(u).filter((sv) => sv.reality_pub);
  return [
    ...(s.proto_vless ? servers.map((sv) => vlessLink(u, sv)) : []),
    ...(s.proto_ss ? servers.map((sv) => ssLink(u, sv)) : []),
  ];
}

module.exports = {
  realityKeys, wgKeys, shortId, uuid, subToken, wgIp, pickSni, userStatus, CAN_CONNECT,
  nodeConfig, serversForUser, chainsForUser, chainKind, chainHops, chainServers, chainUsable, serverTags, TAGS, relayUuid, vlessLink, ssLink, wgConfig, subLinks, filterDns, planServers, FLAGS, DAY,
};
