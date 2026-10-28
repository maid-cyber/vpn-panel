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
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

VERSION = "1.5.0"
CONF = "/etc/vpn-agent/agent.json"
XRAY_CONF = "/usr/local/etc/xray/config.json"
XRAY_BIN = "/usr/local/bin/xray"
WG_CONF = "/etc/wireguard/wg0.conf"
STATE = "/var/lib/vpn-agent"
ACCESS_LOG = "/dev/shm/vpn-access.log"   # samo u RAM-u, briše se nakon čitanja
TAGS = ("vless", "ss")


def _hot(tag):
    """Inbound čije korisnike mijenjamo bez restarta (glavni i lanci Double VPN / Multihop)."""
    return bool(tag) and (tag in TAGS or tag.startswith("chain"))

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


LAST_ERROR = ""


def _clients(cfg, tag=None):
    out = {}
    for ib in (cfg or {}).get("inbounds", []):
        if _hot(ib.get("tag")) and (tag is None or ib.get("tag") == tag):
            for c in ib["settings"].get("clients", []):
                out[(ib["tag"], c["email"])] = c
    return out


def _without_clients(cfg):
    c = json.loads(json.dumps(cfg))
    for ib in c.get("inbounds", []):
        if _hot(ib.get("tag")):
            ib["settings"]["clients"] = []
    return c


def _hot_update(old, new):
    """Dodaje i uklanja korisnike preko Xray API-ja, bez restarta (spojeni ostaju spojeni)."""
    if not os.path.exists(XRAY_BIN) or not service_ok("xray"):
        return False
    if "HandlerService" not in (old.get("api") or {}).get("services", []):
        return False
    try:
        total_add = total_rm = 0
        for tag in [i.get("tag") for i in new.get("inbounds", []) if _hot(i.get("tag"))]:
            a, b = _clients(old, tag), _clients(new, tag)
            removed = [k[1] for k in a if k not in b or a[k] != b[k]]
            added = [b[k] for k in b if k not in a or a[k] != b[k]]
            if removed:
                r = subprocess.run([XRAY_BIN, "api", "rmu", "--server=127.0.0.1:10085", "-tag=" + tag] + removed,
                                   capture_output=True, text=True, timeout=30)
                if r.returncode != 0:
                    log("rmu nije uspio:", (r.stderr or r.stdout)[-300:])
                    return False
            if added:
                ib = next(i for i in new["inbounds"] if i.get("tag") == tag)
                part = {"inbounds": [{**ib, "settings": {**ib["settings"], "clients": added}}]}
                with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
                    json.dump(part, f)
                try:
                    r = subprocess.run([XRAY_BIN, "api", "adu", "--server=127.0.0.1:10085", f.name],
                                       capture_output=True, text=True, timeout=30)
                finally:
                    os.unlink(f.name)
                if r.returncode != 0:
                    log("adu nije uspio:", (r.stderr or r.stdout)[-300:])
                    return False
            total_add += len(added)
            total_rm += len(removed)
        log(f"Korisnici ažurirani bez restarta: +{total_add} −{total_rm}")
        return True
    except Exception as e:  # noqa: BLE001
        log("Ažuriranje bez restarta nije uspjelo:", e)
        return False


# ---------------------------------------------------------------- uređaji (IP adrese iz pristupnog loga, samo u memoriji)
ACCESS_RE = re.compile(r"from (?:tcp:|udp:)?\[?([0-9a-fA-F:.]+?)\]?:\d+ accepted .*?email: u(\d+)")


class Devices:
    def __init__(self):
        self.seen = {}   # (uid, ip) -> zadnji put viđen

    def collect(self):
        path = ACCESS_LOG if not DRY else os.path.join(tempfile.gettempdir(), "vpn-access.log")
        now = time.time()
        try:
            with open(path, "r+", errors="ignore") as f:
                data = f.read()
                f.seek(0)
                f.truncate()
        except OSError:
            data = ""
        for m in ACCESS_RE.finditer(data):
            self.seen[(m.group(2), m.group(1))] = now
        self.seen = {k: v for k, v in self.seen.items() if now - v < 180}
        counts, ips = {}, set()
        for (uid, ip) in self.seen:
            counts[uid] = counts.get(uid, 0) + 1
            ips.add(ip)
        return counts, list(ips)


_xv = {"t": 0, "v": ""}


def xray_version():
    if DRY or not os.path.exists(XRAY_BIN):
        return ""
    if time.time() - _xv["t"] > 3600:
        out = sh([XRAY_BIN, "version"]) or ""
        _xv.update(t=time.time(), v=(out.splitlines() or [""])[0].replace("Xray ", "").split(" ")[0])
    return _xv["v"]


def maybe_update_xray():
    """Jednom sedmično, noću (3–5 h), skine najnoviji Xray i restartuje ga."""
    if DRY:
        return
    stamp = os.path.join(STATE, "xray-updated")
    try:
        last = os.path.getmtime(stamp)
    except OSError:
        last = 0
    if time.time() - last < 7 * 86400 or not (3 <= time.localtime().tm_hour < 5):
        return
    open(stamp, "w").close()
    log("Ažuriram Xray…")
    r = subprocess.run('bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install',
                       shell=True, capture_output=True, text=True, timeout=600)
    if r.returncode == 0:
        sh("systemctl restart xray")
        _xv["t"] = 0
        log("Xray ažuriran:", xray_version())
    else:
        log("Ažuriranje Xraya nije uspjelo:", (r.stderr or r.stdout)[-300:])


def xray_user():
    """Korisnik pod kojim radi Xray servis (obično nobody)."""
    out = (sh(["systemctl", "show", "-p", "User", "--value", "xray"]) or "").strip()
    return out or "root"


def fix_access_log():
    """Pristupni log u /dev/shm mora pripadati korisniku Xraya.
    Ako ga je napravio neko drugi (npr. root), Linux zaštita u /dev/shm ne da Xrayu da ga otvori i Xray se ne upali."""
    if DRY or not os.path.exists(ACCESS_LOG):
        return
    try:
        import pwd
        want = pwd.getpwnam(xray_user()).pw_uid
        if os.stat(ACCESS_LOG).st_uid != want:
            os.remove(ACCESS_LOG)
            log("Obrisan stari pristupni log (pogrešan vlasnik), Xray ga pravi ponovo")
    except (KeyError, OSError) as e:  # noqa: PERF203
        log("Provjera pristupnog loga:", e)


_last_heal = {"t": 0}


def heal_xray():
    """Ako Xray ne radi a konfiguracija postoji: popravi poznate uzroke i pokušaj ponovo (najviše jednom u minuti)."""
    if DRY or not os.path.exists(XRAY_CONF) or service_ok("xray"):
        return
    if time.time() - _last_heal["t"] < 60:
        return
    _last_heal["t"] = time.time()
    fix_access_log()
    sh("systemctl restart xray")
    time.sleep(2)
    log("Xray nije radio, ponovo pokrenut:", "radi" if service_ok("xray") else "i dalje ne radi")


def open_ports(cfg):
    """Ako je ufw upaljen, otvori portove inbounda (npr. port lanca Double VPN)."""
    if DRY or not shutil.which("ufw"):
        return
    st = subprocess.run(["ufw", "status"], capture_output=True, text=True)
    if "Status: active" not in st.stdout:
        return
    for ib in cfg.get("inbounds", []):
        if ib.get("listen") == "0.0.0.0" and ib.get("port"):
            subprocess.run(["ufw", "allow", f"{int(ib['port'])}/tcp"], capture_output=True)


def apply_xray(cfg):
    global LAST_ERROR
    if not cfg:
        sh("systemctl disable --now xray")
        return False
    text = json.dumps(cfg, indent=1)
    try:
        with open(XRAY_CONF) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = None
    if old == cfg and (DRY or service_ok("xray")):
        return True
    # samo promjena korisnika: bez restarta
    if old and not DRY and _without_clients(old) == _without_clients(cfg) and _hot_update(old, cfg):
        write_if_changed(XRAY_CONF, text)
        LAST_ERROR = ""
        return True
    if not DRY:
        tmp = XRAY_CONF[:-5] + ".test.json"   # Xray prepoznaje format po nastavku .json
        # provjera bez log fajlova: test radi kao root, a pristupni log u /dev/shm pripada korisniku Xraya,
        # pa ga Linux zaštita ne da otvoriti (permission denied) iako je konfiguracija ispravna
        test_cfg = json.loads(text)
        if isinstance(test_cfg.get("log"), dict):
            test_cfg["log"] = {**test_cfg["log"], "access": "none"}
            test_cfg["log"].pop("error", None)
        with open(tmp, "w") as f:
            json.dump(test_cfg, f)
        test = subprocess.run([XRAY_BIN, "run", "-test", "-c", tmp], capture_output=True, text=True, timeout=30)
        os.unlink(tmp)
        if test.returncode != 0:
            LAST_ERROR = ("Xray odbio konfiguraciju: " + (test.stdout + test.stderr).strip()[-400:])
            log(LAST_ERROR)
            return False
    write_if_changed(XRAY_CONF, text)
    open_ports(cfg)
    fix_access_log()
    sh("systemctl enable xray")
    sh("systemctl restart xray")
    time.sleep(2)
    if not DRY and not service_ok("xray"):
        # Xray je prihvatio konfiguraciju ali se nije upalio: razlog iz journala ide u panel
        why = (sh(["journalctl", "-u", "xray", "-n", "5", "--no-pager", "-o", "cat"]) or "").strip()
        LAST_ERROR = "Xray se ne pali: " + why[-400:]
        log(LAST_ERROR)
        fix_access_log()
        sh("systemctl restart xray")
        time.sleep(2)
        if not service_ok("xray"):
            return False
    LAST_ERROR = ""
    log("Xray konfiguracija primijenjena (restart),", len(_clients(cfg)), "korisnika")
    return True


def apply_forwards(forwards, iface):
    # Port forwarding: otvoreni port na serveru -> uredjaj kupca preko WireGuarda.
    # Drzimo pravila u zasebnim lancima (VPNFWD/VPNFWDF) pa ih svaki put ispraznimo i iznova dodamo (idempotentno).
    if DRY:
        return
    for tbl, chain, jump in (("nat", "VPNFWD", ["PREROUTING", "-i", iface]), ("filter", "VPNFWDF", ["FORWARD"])):
        subprocess.run(["iptables", "-t", tbl, "-N", chain], capture_output=True)
        subprocess.run(["iptables", "-t", tbl, "-F", chain], capture_output=True)
        if subprocess.run(["iptables", "-t", tbl, "-C"] + jump + ["-j", chain], capture_output=True).returncode != 0:
            subprocess.run(["iptables", "-t", tbl, "-I", jump[0], "1"] + jump[1:] + ["-j", chain], capture_output=True)
    n = 0
    for f in (forwards or []):
        ip = f.get("ip")
        try:
            port = int(f.get("port", 0) or 0)
        except (TypeError, ValueError):
            continue
        if not ip or not (0 < port < 65536):
            continue
        for proto in ("tcp", "udp"):
            subprocess.run(["iptables", "-t", "nat", "-A", "VPNFWD", "-p", proto, "--dport", str(port), "-j", "DNAT", "--to-destination", f"{ip}:{port}"], capture_output=True)
            subprocess.run(["iptables", "-t", "filter", "-A", "VPNFWDF", "-p", proto, "-d", ip, "--dport", str(port), "-j", "ACCEPT"], capture_output=True)
        subprocess.run(["ufw", "allow", str(port)], capture_output=True)
        n += 1
    if n:
        log("Port forwarding:", n, "portova")


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
    apply_forwards(wg.get("forwards"), iface)
    return subprocess.run(["ip", "link", "show", "wg0"], capture_output=True).returncode == 0


def apply_shield():
    """Zaštita od zloupotrebe (abuse shield). Sprječava banove hostera i krađu ključeva:
      - odlazni SMTP (port 25): blokada mejl-spama kroz server,
      - cloud metadata (169.254.169.254): klijent ne može ukrasti ključeve hostera,
      - privatne/lokalne mreže: klijent ne može napadati server ni druge klijente hostera.
    Pravila stoje u zasebnim lancima (VPNSH*) pa se svaki put isprazne i iznova dodaju (idempotentno).
    Xray promet dodatno pokrivaju pravila iz panela (block_private, block_smtp)."""
    if DRY:
        return
    PRIV = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"]

    def rule(bin_, args):
        subprocess.run([bin_] + args, capture_output=True)

    def setup(bin_):
        for chain, jump in (("VPNSHF", "FORWARD"), ("VPNSHO", "OUTPUT")):
            rule(bin_, ["-N", chain])
            rule(bin_, ["-F", chain])
            if subprocess.run([bin_, "-C", jump, "-j", chain], capture_output=True).returncode != 0:
                rule(bin_, ["-I", jump, "1", "-j", chain])

    # ---- IPv4 ----
    setup("iptables")
    rule("iptables", ["-A", "VPNSHF", "-d", "10.66.0.0/16", "-j", "RETURN"])   # VPN interno (port forwarding, lanci) se ne dira
    for ch in ("VPNSHF", "VPNSHO"):
        rule("iptables", ["-A", ch, "-p", "tcp", "--dport", "25", "-j", "REJECT"])   # odlazni spam
    rule("iptables", ["-A", "VPNSHO", "-d", "169.254.169.254", "-j", "DROP"])        # metadata (host/Xray izlaz)
    for net in PRIV:
        rule("iptables", ["-A", "VPNSHF", "-d", net, "-j", "DROP"])                  # klijent ne smije u privatne mreže
    # ---- IPv6 (ako postoji) ----
    if shutil.which("ip6tables"):
        setup("ip6tables")
        for ch in ("VPNSHF", "VPNSHO"):
            rule("ip6tables", ["-A", ch, "-p", "tcp", "--dport", "25", "-j", "REJECT"])
            rule("ip6tables", ["-A", ch, "-d", "fd00:ec2::254", "-j", "DROP"])
        rule("ip6tables", ["-A", "VPNSHF", "-d", "fc00::/7", "-j", "DROP"])
    log("Abuse shield aktivan (spam/metadata/privatne mreže)")


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


# ---------------------------------------------------------------- komande iz panela
SPEED_URL = "https://speed.cloudflare.com"
RUNNING = set()


def speedtest():
    """Brzina servera prema internetu (Cloudflare): ping, preuzimanje i slanje u Mbit/s."""
    hdr = {"user-agent": "Mozilla/5.0 (vpn-agent)"}
    pings = []
    for _ in range(3):
        t0 = time.time()
        with urllib.request.urlopen(urllib.request.Request(SPEED_URL + "/__down?bytes=0", headers=hdr), timeout=10) as r:
            r.read()
        pings.append((time.time() - t0) * 1000)
    n, t0 = 0, time.time()
    with urllib.request.urlopen(urllib.request.Request(SPEED_URL + "/__down?bytes=100000000", headers=hdr), timeout=30) as r:
        while time.time() - t0 < 8:
            b = r.read(1 << 16)
            if not b:
                break
            n += len(b)
    down = n * 8 / max(0.001, time.time() - t0) / 1e6
    payload = b"\0" * 15_000_000
    t0 = time.time()
    req = urllib.request.Request(SPEED_URL + "/__up", data=payload, method="POST", headers={**hdr, "content-type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=40) as r:
        r.read()
    up = len(payload) * 8 / max(0.001, time.time() - t0) / 1e6
    return {"down": round(down, 1), "up": round(up, 1), "ping": round(min(pings))}


def run_cmd(panel, token, c):
    """Izvrši komandu iz panela i javi rezultat. Restart i ažuriranje prvo jave rezultat, pa se izvrše."""
    cid, cmd = c.get("id"), c.get("cmd")
    if cid in RUNNING:
        return
    RUNNING.add(cid)

    def report(ok, result):
        try:
            request(panel, token, "/agent/cmd-result", {"id": cid, "ok": ok, "result": result})
        except Exception as e:  # noqa: BLE001
            log("Rezultat komande nije poslan:", e)

    def work():
        try:
            log("Komanda iz panela:", cmd)
            if cmd == "restart_vpn":
                if DRY:
                    return report(True, "Xray: radi · WireGuard: radi (probni način)")
                sh("systemctl restart xray")
                if os.path.exists(WG_CONF):
                    sh("systemctl restart wg-quick@wg0")
                time.sleep(2)
                x, w = service_ok("xray"), service_ok("wg-quick@wg0") if os.path.exists(WG_CONF) else None
                return report(x, f"Xray: {'radi' if x else 'ne radi'}" + ("" if w is None else f" · WireGuard: {'radi' if w else 'ne radi'}"))
            if cmd == "reboot":
                report(True, "Server se restartuje, vraća se za 1–2 minute")
                if not DRY:
                    subprocess.Popen(["sh", "-c", "sleep 2; systemctl reboot"])
                return None
            if cmd == "update_agent":
                report(True, f"Agent {VERSION} preuzima najnoviju verziju")
                if not DRY:
                    self_update(panel)
                return None
            if cmd == "speedtest":
                if DRY:
                    return report(True, json.dumps({"down": 912.4, "up": 845.1, "ping": 4}))
                return report(True, json.dumps(speedtest()))
            return report(False, "Agent ne zna ovu komandu. Ažuriraj agenta.")
        except Exception as e:  # noqa: BLE001
            report(False, str(e)[-500:])
        finally:
            RUNNING.discard(cid)

    threading.Thread(target=work, daemon=True).start()


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
    meter, wgs, devs = Meter(), WgStats(), Devices()
    want_devices = True
    iface = default_iface()
    applied, peer_ids, interval = "", {}, 15
    pending = {}            # promet koji nije poslan (panel nedostupan)
    fails = 0
    log(f"Agent {VERSION} pokrenut, panel {panel}{' (probni način)' if DRY else ''}")
    apply_shield()   # odmah na startu (i poslije reboota kad se iptables isprazne)
    meter.cpu()
    meter.net_mbps(iface)
    while True:
        try:
            users = xray_stats()
            wtraffic, wonline, ips = wgs.collect(peer_ids)
            dcounts, vips = devs.collect() if want_devices else ({}, [])
            ips = list(dict.fromkeys(ips + vips))
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
                "error": LAST_ERROR, "devices": dcounts, "xray_version": xray_version(),
            }
            r = request(panel, token, "/agent/heartbeat", beat)
            pending = {}
            fails = 0
            interval = max(5, int(r.get("interval", 15)))
            want_devices = bool(r.get("devices", True))
            for c in r.get("cmds") or []:
                run_cmd(panel, token, c)
            if r.get("xray_update"):
                maybe_update_xray()
            if r.get("agent_version") and r["agent_version"] != VERSION and not DRY:
                self_update(panel)
            if r.get("hash") != applied:
                cfg = request(panel, token, "/agent/config")
                peer_ids = {p["pub"]: p["id"] for p in (cfg.get("wg") or {}).get("peers", [])}
                ok_x = apply_xray(cfg.get("xray"))
                apply_wg(cfg.get("wg"), iface)
                apply_shield()
                if ok_x or not cfg.get("xray"):
                    applied = cfg["hash"]
                log("Konfiguracija", applied, "·", len(cfg.get("user_ids", [])), "aktivnih korisnika")
            heal_xray()
        except Exception as e:  # noqa: BLE001
            fails += 1
            log("Greška:", e)
            interval = min(60, 5 * fails)
        time.sleep(interval)
        if DRY and arg("--once"):
            break


if __name__ == "__main__":
    main()
