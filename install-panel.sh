#!/usr/bin/env bash
# Instalacija VPN panela na Ubuntu 22.04 / 24.04.
#
#   sudo bash install-panel.sh panel.tvojadomena.com      (preporučeno, sa HTTPS)
#   sudo bash install-panel.sh                            (bez domene, samo http://IP)
#
# Ponovno pokretanje iste skripte = ažuriranje panela. Podaci (baza, backupi) ostaju.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/vpn-panel
DATA=/var/lib/vpn-panel
PORT=8080
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mGreška: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "pokreni kao root: sudo bash install-panel.sh"
[ -f "$SRC/panel/server.js" ] || die "pokreni skriptu iz raspakovanog foldera (tu gdje su panel/ i agent/)"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "testirano na Ubuntu 22.04 i 24.04, ti imaš ${PRETTY_NAME:-nepoznat sistem}"
export DEBIAN_FRONTEND=noninteractive

say "Osnovni paketi"
apt-get update -qq
apt-get install -y -qq curl unzip ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# ------------------------------------------------------------ Node.js 22
need_node=1
if command -v node >/dev/null; then
  v="$(node -p 'process.versions.node')"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0 || warn "Node $v je prestar, instaliram Node 22"
fi
if [ $need_node = 1 ]; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -e 'require("node:sqlite")' 2>/dev/null || die "Node $(node -v) nema ugrađeni SQLite, treba Node 22.13 ili noviji"
echo "Node $(node -v)"

# ------------------------------------------------------------ fajlovi
say "Kopiram panel u $APP"
id vpnpanel >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin vpnpanel
mkdir -p "$APP" "$DATA"
rm -rf "$APP/panel.new" "$APP/agent.new"
cp -r "$SRC/panel" "$APP/panel.new"
cp -r "$SRC/agent" "$APP/agent.new"
rm -rf "$APP/panel.new/data"
rm -rf "$APP/panel" "$APP/agent"
mv "$APP/panel.new" "$APP/panel"
mv "$APP/agent.new" "$APP/agent"
chown -R root:root "$APP"
chown -R vpnpanel:vpnpanel "$DATA"
chmod 750 "$DATA"

FIRST=0
[ -f "$DATA/panel.db" ] || FIRST=1

if [ -n "$DOMAIN" ]; then URL="https://$DOMAIN"; else
  IP="$(curl -fsS4 --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')"
  URL="http://$IP"
fi

# ------------------------------------------------------------ systemd
say "Servis vpn-panel"
cat > /etc/systemd/system/vpn-panel.service <<EOF
[Unit]
Description=VPN admin panel
After=network-online.target
Wants=network-online.target

[Service]
User=vpnpanel
Group=vpnpanel
WorkingDirectory=$APP/panel
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=VPN_DATA_DIR=$DATA
Environment=VPN_PANEL_URL=$URL
ExecStart=/usr/bin/env node $APP/panel/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable vpn-panel >/dev/null 2>&1
systemctl restart vpn-panel

# ------------------------------------------------------------ ažuriranje iz panela (dugme "Ažuriraj panel")
# panel (bez root prava) samo napravi fajl update.request, a ovaj root servis skine novu verziju i pokrene instalaciju
printf 'DOMAIN=%q\n' "$DOMAIN" > "$APP/install.env"
cat > "$APP/update.sh" <<'UPD'
#!/usr/bin/env bash
set -euo pipefail
REQ=/var/lib/vpn-panel/update.request
REPO="$(tr -cd 'A-Za-z0-9._/-' < "$REQ" 2>/dev/null || true)"; REPO="${REPO:-maid-cyber/vpn-panel}"
rm -f "$REQ"
. /opt/vpn-panel/install.env
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cd "$T"
echo "=== $(date) · ažuriranje iz github.com/$REPO"
curl -fsSL -o p.zip "https://github.com/$REPO/archive/refs/heads/main.zip"
unzip -q p.zip
cd "$(find . -maxdepth 1 -mindepth 1 -type d | head -1)"
bash install-panel.sh ${DOMAIN:-}
UPD
chmod 700 "$APP/update.sh"
cat > /etc/systemd/system/vpn-panel-update.service <<UNIT
[Unit]
Description=Ažuriranje VPN panela
[Service]
Type=oneshot
ExecStart=/bin/bash -c '$APP/update.sh >> /var/log/vpn-panel-update.log 2>&1'
UNIT
cat > /etc/systemd/system/vpn-panel-update.path <<UNIT
[Unit]
Description=Čeka zahtjev za ažuriranje VPN panela
[Path]
PathExists=$DATA/update.request
Unit=vpn-panel-update.service
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now vpn-panel-update.path >/dev/null 2>&1

# ------------------------------------------------------------ Caddy (HTTPS)
if ! command -v caddy >/dev/null; then
  say "Caddy (automatski HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
SITE="${DOMAIN:-:80}"
cat > /etc/caddy/Caddyfile <<EOF
# Napravio install-panel.sh
$SITE {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT {
		flush_interval -1
	}
	header {
		-Server
	}
	log {
		output discard
	}
}
EOF
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if [ -n "$DOMAIN" ]; then
  MYIP="$(curl -fsS4 --max-time 8 https://api.ipify.org || true)"
  DNSIP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
  if [ -n "$MYIP" ] && [ "$DNSIP" != "$MYIP" ]; then
    warn "Domena $DOMAIN pokazuje na '${DNSIP:-ništa}', a ovaj server je $MYIP."
    warn "Napravi A zapis $DOMAIN -> $MYIP. Caddy sam dobije HTTPS certifikat čim DNS proradi."
  fi
fi

# ------------------------------------------------------------ firewall
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "Firewall: otvaram 80 i 443"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# ------------------------------------------------------------ gotovo
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)" != 000 ] && break
  sleep 0.5
done
systemctl is-active --quiet vpn-panel || { journalctl -u vpn-panel -n 30 --no-pager; die "panel se nije pokrenuo (log iznad)"; }

say "Gotovo"
if [ $FIRST = 1 ] && [ -f "$DATA/prva-prijava.txt" ]; then
  echo
  echo "================ PRVA PRIJAVA ================"
  cat "$DATA/prva-prijava.txt"
  echo "=============================================="
  echo "Ovo je sačuvano u $DATA/prva-prijava.txt"
  echo "Nakon prve prijave: promijeni šifru i uključi 2FA (Moj profil), pa obriši taj fajl."
else
  echo "Panel ažuriran. Podaci su ostali isti."
fi
echo
echo "Korisne komande:"
echo "  systemctl status vpn-panel        stanje panela"
echo "  journalctl -u vpn-panel -f        log uživo"
echo "  ls $DATA/backups                  backupi"
