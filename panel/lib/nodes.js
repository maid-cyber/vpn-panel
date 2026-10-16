'use strict';
// Veza sa VPN serverima: instalacijska skripta, javljanje agenta (heartbeat) i konfiguracija.
const fs = require('node:fs');
const path = require('node:path');
const { one, all, run, now, log, dayKey } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');
const { fail, send, readBody, clientIp } = require('./http');
const { notify, geoIp } = require('./notify');

const AGENT_FILE = path.join(__dirname, '..', '..', 'agent', 'agent.py');
const agentVersion = () => {
  try { return (fs.readFileSync(AGENT_FILE, 'utf8').match(/^VERSION\s*=\s*['"]([^'"]+)/m) || [])[1] || '0'; } catch { return '0'; }
};

function panelBase(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return (settings.get('panel_url') || `${proto}://${req.headers.host}`).replace(/\/+$/, '');
}

function installScript(req, sv) {
  const base = panelBase(req);
  return `#!/usr/bin/env bash
# ${settings.get('brand')} — instalacija VPN servera "${sv.name.replace(/[^\w .-]/g, '')}"
set -euo pipefail
PANEL="${base}"
TOKEN="${sv.token}"
[ "$(id -u)" = 0 ] || { echo "Pokreni kao root: curl ... | sudo bash"; exit 1; }
echo "==> 1/5 Instaliram potrebne pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y curl ca-certificates python3 wireguard-tools iptables iproute2 >/dev/null
echo "==> 2/5 Instaliram Xray"
bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null
echo "==> 3/5 Podešavam mrežu (prosljeđivanje paketa, BBR)"
cat >/etc/sysctl.d/99-vpn-agent.conf <<'EOF'
net.ipv4.ip_forward=1
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl --system >/dev/null 2>&1 || true
echo "==> 4/5 Instaliram agenta"
mkdir -p /opt/vpn-agent /etc/vpn-agent
curl -fsSL "$PANEL/agent/agent.py" -o /opt/vpn-agent/agent.py
cat >/etc/vpn-agent/agent.json <<EOF
{"panel": "$PANEL", "token": "$TOKEN"}
EOF
chmod 600 /etc/vpn-agent/agent.json
cat >/etc/systemd/system/vpn-agent.service <<'EOF'
[Unit]
Description=VPN panel agent
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/bin/python3 /opt/vpn-agent/agent.py
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vpn-agent >/dev/null 2>&1
echo "==> 5/5 Firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow ${sv.vless_port}/tcp >/dev/null; ufw allow ${sv.wg_port}/udp >/dev/null; ufw allow ${sv.ss_port || 8388} >/dev/null; echo "   otvoreni portovi ${sv.vless_port}/tcp, ${sv.wg_port}/udp i ${sv.ss_port || 8388}"
fi
echo
echo "Gotovo. Server bi se za par sekundi trebao pojaviti kao ONLINE u panelu."
echo "Ako ne: journalctl -u vpn-agent -n 50"
`;
}

const lastIps = new Map();   // privremeno, samo za brojanje država; ne sprema se nigdje

const LAST_ERR = new Map();
// broj uređaja po korisniku (različite IP adrese u zadnje 3 minute) — samo u memoriji
const DEV = new Map();        // server id -> { t, counts: { userId: n } }
const OVER = new Map();       // user id -> koliko javljanja zaredom je preko limita
function checkDevices(t) {
  const mode = settings.get('device_limit');
  if (mode === 'iskljuceno') return;
  const total = {};
  for (const [, v] of DEV) if (t - v.t < 60000) for (const [id, n] of Object.entries(v.counts)) total[id] = (total[id] || 0) + n;
  const ids = Object.keys(total);
  for (const u of ids.length ? all(`SELECT id, username, devices, devices_seen, blocked_until FROM users WHERE id IN (${ids.map(Number).join(',')})`) : []) {
    const n = total[u.id];
    if (n !== u.devices_seen) run('UPDATE users SET devices_seen = ? WHERE id = ?', n, u.id);
    const over = n > (u.devices || 1);
    OVER.set(u.id, over ? (OVER.get(u.id) || 0) + 1 : 0);
    if (over && OVER.get(u.id) >= 3 && mode === 'blokiraj' && !(u.blocked_until > t)) {
      run('UPDATE users SET blocked_until = ? WHERE id = ?', t + 15 * 60000, u.id);
      run('INSERT INTO user_history (user_id, ts, text) VALUES (?,?,?)', u.id, t, `Blokiran 15 min: ${n} uređaja (limit ${u.devices})`);
      log('sistem', 'Previše uređaja', `${u.username}: ${n} uređaja, limit ${u.devices} · blokiran 15 min`, 'warn');
      OVER.set(u.id, 0);
    }
  }
  // korisnici koji više nisu spojeni: vrati brojač na 0
  run(`UPDATE users SET devices_seen = 0 WHERE devices_seen > 0 ${ids.length ? `AND id NOT IN (${ids.map(Number).join(',')})` : ''}`);
}
async function handle(req, res, p) {
  if (p === '/agent/agent.py' && req.method === 'GET') {
    return send(res, 200, fs.readFileSync(AGENT_FILE), { 'content-type': 'text/x-python; charset=utf-8' });
  }
  if (p.startsWith('/install/') && req.method === 'GET') {
    const sv = one('SELECT * FROM servers WHERE token = ?', p.slice(9));
    if (!sv) return send(res, 404, 'echo "Nepoznat server token. Kopiraj komandu ponovo iz panela."; exit 1\n');
    return send(res, 200, installScript(req, sv), { 'content-type': 'text/x-shellscript; charset=utf-8' });
  }
  const token = req.headers['x-node-token'];
  const sv = token ? one('SELECT * FROM servers WHERE token = ?', String(token)) : null;
  if (!sv) fail(401, 'Nepoznat server.');

  if (p === '/agent/config' && req.method === 'GET') {
    const cfg = vpn.nodeConfig(sv);
    return send(res, 200, { ...cfg, agent_version: agentVersion() });
  }
  if (p === '/agent/heartbeat' && req.method === 'POST') {
    const b = await readBody(req, 4 << 20);
    const t = now();
    const wasOffline = sv.status === 'offline';
    let total = 0;
    const tz = settings.get('timezone');
    for (const [id, pair] of Object.entries(b.users || {})) {
      const up = Math.max(0, Number(pair[0]) || 0), down = Math.max(0, Number(pair[1]) || 0);
      if (!up && !down) continue;
      total += up + down;
      run('UPDATE users SET traffic_up = traffic_up + ?, traffic_down = traffic_down + ?, last_seen = ?, last_server = ? WHERE id = ?', up, down, t, sv.id, Number(id));
    }
    if (total) run(`INSERT INTO daily (day, traffic) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET traffic = traffic + excluded.traffic`, dayKey(t, tz), total);
    const host = sv.host || clientIp(req);
    run(`UPDATE servers SET last_seen = ?, status = 'online', cpu = ?, ram = ?, net_mbps = ?, online = ?, uptime = ?, agent_version = ?,
      applied_hash = ?, xray_ok = ?, wg_ok = ?, host = ?, traffic_month = traffic_month + ? WHERE id = ?`,
    t, Number(b.cpu) || 0, Number(b.ram) || 0, Number(b.net_mbps) || 0, Number(b.online) || 0, Number(b.uptime) || 0, String(b.version || ''),
    String(b.applied_hash || ''), b.xray_ok ? 1 : 0, b.wg_ok ? 1 : 0, host, total, sv.id);
    if (b.devices && typeof b.devices === 'object') { DEV.set(sv.id, { t, counts: b.devices }); checkDevices(t); }
    run('UPDATE servers SET xray_version = ?, last_error = ? WHERE id = ?', String(b.xray_version || sv.xray_version || '').slice(0, 40), String(b.error || '').slice(0, 500), sv.id);
    // greška pri primjeni konfiguracije na serveru: zapiši jednom u logove
    const err = String(b.error || '').slice(0, 500);
    if (err && LAST_ERR.get(sv.id) !== err) { log('sistem', 'Server odbio konfiguraciju', `${sv.name}: ${err}`, 'error'); notify('n_server', `⚠️ ${sv.name}: ${err}`); }
    LAST_ERR.set(sv.id, err);
    if (!sv.last_seen) {
      log('sistem', 'Server se prvi put javio', `${sv.name} (${host})`);
      notify('n_server', `🟢 Novi server ${sv.name} je online (${host})`);
    } else if (wasOffline) {
      log('sistem', 'Server se vratio', sv.name);
      notify('n_server', `🟢 ${sv.name} se vratio i radi.`);
    }
    if (sv.lat == null && host) {
      geoIp(host).then((g) => { if (g) run('UPDATE servers SET lat = ?, lon = ?, city = COALESCE(NULLIF(city, \'\'), ?), country = COALESCE(NULLIF(country, \'\'), ?) WHERE id = ?', g.lat, g.lon, g.city || '', g.cc || '', sv.id); });
    }
    // države korisnika (IP se ne sprema, samo se broji država)
    const ips = Array.isArray(b.ips) ? b.ips.slice(0, 200) : [];
    for (const ip of ips) {
      const key = `${sv.id}:${ip}`;
      if (lastIps.has(key) && t - lastIps.get(key) < 6 * 3600000) continue;
      lastIps.set(key, t);
      geoIp(ip).then((g) => { if (g?.cc) run('INSERT INTO countries (day, cc, n) VALUES (?, ?, 1) ON CONFLICT(day, cc) DO UPDATE SET n = n + 1', dayKey(t, tz), g.cc); });
    }
    if (lastIps.size > 20000) lastIps.clear();
    const cfg = vpn.nodeConfig(one('SELECT * FROM servers WHERE id = ?', sv.id));
    return send(res, 200, { hash: cfg.hash, interval: Number(settings.get('heartbeat_sec') || 15), agent_version: agentVersion(), xray_update: !!settings.get('xray_autoupdate'), devices: settings.get('device_limit') !== 'iskljuceno' });
  }
  fail(404, 'Nepoznato.');
}

module.exports = { handle, installScript };
