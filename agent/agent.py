#!/usr/bin/env python3
"""
Agent za VPN server. Javlja se panelu, preuzima konfiguraciju i šalje statistiku.
Samo standardna Python biblioteka. Konfiguracija: /etc/vpn-agent/agent.json {"panel": "...", "token": "..."}

Probni način bez Xraya i WireGuarda (za testiranje panela):
    python3 agent.py --dry-run --panel http://127.0.0.1:8080 --token TOKEN
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

VERSION = "1.0.0"
CONF = "/etc/vpn-agent/agent.json"
XRAY_CONF = "/usr/local/etc/xray/config.json"
XRAY_BIN = "/usr/local/bin/xray"
WG_CONF = "/etc/wireguard/wg0.conf"
STATE = "/var/lib/vpn-agent"

DRY = "--dry-run" in sys.argv


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def sh(cmd, check=False, input_text=None):
    if DRY:
        return ""
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, input=input_text, timeout=60)
    if check and r.returncode != 0:
        raise RuntimeError(f"{cmd}: {r.stderr.strip()[:300]}")
    return r.stdout


# ---------------------------------------------------------------- sistem
class Meter:
    def __init__(self):
        self.cpu_prev = None
        self.net_prev = None

    def cpu(self):
        try:
            with open("/proc/stat") as f:
                vals = list(map(int, f.readline().split()[1:]))
            idle, total = vals[3] + vals[4], sum(vals)
            prev, self.cpu_prev = self.cpu_prev, (idle, total)
            if not prev or total == prev[1]:
                return 0
            return round(100 * (1 - (idle - prev[0]) / (total - prev[1])), 1)
        except OSError:
            return 0

    @staticmethod
    def ram():
        try:
            info = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    k, v = line.split(":", 1)
                    info[k] = int(v.split()[0])
            return round(100 * (1 - info["MemAvailable"] / info["MemTotal"]), 1)
        except (OSError, KeyError, ZeroDivisionError):
            return 0

    def net_mbps(self, iface):
        try:
            with open("/proc/net/dev") as f:
                for line in f:
                    if line.strip().startswith(iface + ":"):
                        p = line.split(":", 1)[1].split()
                        total, t = int(p[0]) + int(p[8]), time.time()
                        prev, self.net_prev = self.net_prev, (total, t)
                        if not prev or t <= prev[1]:
                            return 0
                        return round((total - prev[0]) * 8 / (t - prev[1]) / 1e6, 1)
        except OSError:
            pass
        return 0

    @staticmethod
    def uptime():
        try:
            with open("/proc/uptime") as f:
                return int(float(f.read().split()[0]))
        except OSError:
            return 0


def default_iface():
    out = sh("ip route show default")
    m = re.search(r"\bdev (\S+)", out or "")
    return m.group(1) if m else "eth0"


# ---------------------------------------------------------------- statistika
def xray_stats():
    """Promet po korisniku od zadnjeg poziva: {id: [gore, dolje]}."""
    if DRY or not os.path.exists(XRAY_BIN):
        return {}
    out = sh([XRAY_BIN, "api", "statsquery", "--server=127.0.0.1:10085", "-reset"])
    res = {}
    try:
        for s in json.loads(out or "{}").get("stat", []):
            m = re.match(r"user>>>u(\d+)>>>traffic>>>(uplink|downlink)", s.get("name", ""))
            if m:
                pair = res.setdefault(m.group(1), [0, 0])
                pair[0 if m.group(2) == "uplink" else 1] += int(s.get("value", 0))
    except (ValueError, TypeError):
        pass
    return res


class WgStats:
    def __init__(self):
        self.prev = {}

    def collect(self, peer_ids):
        """Vraća (promet po korisniku, broj aktivnih, IP adrese klijenata)."""
        if DRY:
            return {}, 0, []
        out = sh("wg show wg0 dump")
        res, online, ips = {}, 0, []
        now = time.time()
        for line in (out or "").splitlines()[1:]:
            p = line.split("\t")
            if len(p) < 8:
                continue
            pub, endpoint, handshake, rx, tx = p[0], p[2], int(p[4] or 0), int(p[5] or 0), int(p[6] or 0)
            uid = peer_ids.get(pub)
            if uid is None:
                continue
            prx, ptx = self.prev.get(pub, (rx, tx))
            if rx < prx or tx < ptx:
                prx, ptx = 0, 0
            self.prev[pub] = (rx, tx)
            if rx - prx or tx - ptx:
                pair = res.setdefault(str(uid), [0, 0])
                pair[0] += rx - prx
                pair[1] += tx - ptx
            if handshake and now - handshake < 180:
                online += 1
                if endpoint and endpoint != "(none)":
                    ips.append(endpoint.rsplit(":", 1)[0].strip("[]"))
        return res, online, ips


# ---------------------------------------------------------------- primjena konfiguracije
def write_if_changed(path, text):
    if DRY:
        path = os.path.join(tempfile.gettempdir(), "vpn-agent-dry", os.path.basename(path))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path) as f:
            if f.read() == text:
                return False
    except OSError:
        pass
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.chmod(tmp, 0o600 if path.endswith(".conf") else 0o644)
    os.replace(tmp, path)
    return True


def apply_xray(cfg):
    if not cfg:
        sh("systemctl disable --now xray")
        return False
    changed = write_if_changed(XRAY_CONF, json.dumps(cfg, indent=1))
    if changed:
        if not DRY:
            test = subprocess.run([XRAY_BIN, "run", "-test", "-c", XRAY_CONF], capture_output=True, text=True, timeout=30)
            if test.returncode != 0:
                log("Xray konfiguracija nije ispravna:", test.stdout[-400:], test.stderr[-400:])
                return False
        sh("systemctl enable xray")
        sh("systemctl restart xray")
        log("Xray konfiguracija primijenjena,", len(cfg["inbounds"][1]["settings"]["clients"]), "korisnika")
    return True


def apply_wg(wg, iface):
    if not wg:
        sh("systemctl disable --now wg-quick@wg0")
        return False
    lines = [
        "[Interface]",
        f"PrivateKey = {wg['private_key']}",
        f"Address = {wg['address']}",
        f"ListenPort = {wg['port']}",
        f"PostUp = iptables -t nat -A POSTROUTING -s 10.66.0.0/16 -o {iface} -j MASQUERADE; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT",
        f"PostDown = iptables -t nat -D POSTROUTING -s 10.66.0.0/16 -o {iface} -j MASQUERADE; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT",
        "",
    ]
    for p in wg["peers"]:
        lines += ["[Peer]", f"# u{p['id']}", f"PublicKey = {p['pub']}", f"AllowedIPs = {p['ip']}/32", ""]
    changed = write_if_changed(WG_CONF, "\n".join(lines))
    if DRY:
        return True
    up = subprocess.run(["ip", "link", "show", "wg0"], capture_output=True).returncode == 0
    if not up:
        sh("systemctl enable --now wg-quick@wg0")
    elif changed:
        stripped = sh("wg-quick strip wg0")
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write(stripped)
        sh(f"wg syncconf wg0 {f.name}")
        os.unlink(f.name)
    if changed:
        log("WireGuard primijenjen,", len(wg["peers"]), "korisnika")
    return subprocess.run(["ip", "link", "show", "wg0"], capture_output=True).returncode == 0


def service_ok(name):
    if DRY:
        return True
    return sh(f"systemctl is-active {name}").strip() == "active"


# ---------------------------------------------------------------- veza sa panelom
def request(panel, token, path, data=None):
    req = urllib.request.Request(panel.rstrip("/") + path, method="POST" if data is not None else "GET",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"x-node-token": token, "content-type": "application/json", "user-agent": f"vpn-agent/{VERSION}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def self_update(panel):
    try:
        with urllib.request.urlopen(panel.rstrip("/") + "/agent/agent.py", timeout=30) as r:
            code = r.read()
        if b"VERSION" not in code:
            return
        me = os.path.abspath(__file__)
        with open(me + ".new", "wb") as f:
            f.write(code)
        os.replace(me + ".new", me)
        log("Agent ažuriran, restartujem")
        os.execv(sys.executable, [sys.executable, me] + sys.argv[1:])
    except Exception as e:  # noqa: BLE001
        log("Ažuriranje agenta nije uspjelo:", e)


def main():
    if DRY:
        panel, token = arg("--panel"), arg("--token")
    else:
        with open(CONF) as f:
            c = json.load(f)
        panel, token = c["panel"], c["token"]
    if not panel or not token:
        sys.exit("Fale panel adresa i token.")
    os.makedirs(STATE if not DRY else tempfile.gettempdir(), exist_ok=True)
    meter, wgs = Meter(), WgStats()
    iface = default_iface()
    applied, peer_ids, interval = "", {}, 15
    pending = {}            # promet koji nije poslan (panel nedostupan)
    fails = 0
    log(f"Agent {VERSION} pokrenut, panel {panel}{' (probni način)' if DRY else ''}")
    meter.cpu()
    meter.net_mbps(iface)
    while True:
        try:
            users = xray_stats()
            wtraffic, wonline, ips = wgs.collect(peer_ids)
            for src in (users, wtraffic):
                for uid, (up, down) in src.items():
                    pair = pending.setdefault(uid, [0, 0])
                    pair[0] += up
                    pair[1] += down
            xonline = sum(1 for v in users.values() if v[0] + v[1] > 4096)
            if DRY and arg("--fake-traffic"):
                for uid in (arg("--fake-traffic") or "").split(","):
                    if uid:
                        pending.setdefault(uid, [0, 0])[1] += 5 * 1024 * 1024
            beat = {
                "version": VERSION, "cpu": meter.cpu(), "ram": meter.ram(), "net_mbps": meter.net_mbps(iface),
                "uptime": meter.uptime(), "online": xonline + wonline, "users": pending, "ips": ips[:200],
                "applied_hash": applied, "xray_ok": service_ok("xray"), "wg_ok": service_ok("wg-quick@wg0"),
            }
            r = request(panel, token, "/agent/heartbeat", beat)
            pending = {}
            fails = 0
            interval = max(5, int(r.get("interval", 15)))
            if r.get("agent_version") and r["agent_version"] != VERSION and not DRY:
                self_update(panel)
            if r.get("hash") != applied:
                cfg = request(panel, token, "/agent/config")
                peer_ids = {p["pub"]: p["id"] for p in (cfg.get("wg") or {}).get("peers", [])}
                ok_x = apply_xray(cfg.get("xray"))
                apply_wg(cfg.get("wg"), iface)
                if ok_x or not cfg.get("xray"):
                    applied = cfg["hash"]
                log("Konfiguracija", applied, "·", len(cfg.get("user_ids", [])), "aktivnih korisnika")
        except Exception as e:  # noqa: BLE001
            fails += 1
            log("Greška:", e)
            interval = min(60, 5 * fails)
        time.sleep(interval)
        if DRY and arg("--once"):
            break


if __name__ == "__main__":
    main()
