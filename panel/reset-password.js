'use strict';
// Hitni pristup: nova šifra za vlasnika, isključuje 2FA i IP ograničenje, ispisuje adresu panela.
// sudo -u vpnpanel VPN_DATA_DIR=/var/lib/vpn-panel node /opt/vpn-panel/panel/reset-password.js [nova-sifra]
process.removeAllListeners('warning');
const crypto = require('node:crypto');
const auth = require('./lib/auth');
const { one, run } = require('./lib/db');
const settings = require('./lib/settings');

const pass = process.argv[2] || crypto.randomBytes(9).toString('base64url');
if (pass.length < 8) { console.error('Šifra mora imati bar 8 znakova.'); process.exit(1); }
const owner = one("SELECT id, username FROM admins WHERE role = 'owner' ORDER BY id LIMIT 1");
if (!owner) { console.error('Nema vlasničkog naloga.'); process.exit(1); }
run('UPDATE admins SET pass_hash = ?, totp_on = 0, totp_secret = NULL, disabled = 0 WHERE id = ?', auth.hashPassword(pass), owner.id);
run('DELETE FROM sessions WHERE admin_id = ?', owner.id);
run('DELETE FROM login_fail');
settings.set({ ip_whitelist_on: false });
const url = (settings.get('panel_url') || 'http://IP_SERVERA').replace(/\/+$/, '');
console.log(`Panel: ${url}${settings.get('admin_path')}/\nKorisnik: ${owner.username}\nNova šifra: ${pass}\n2FA i IP ograničenje su isključeni. Uključi 2FA ponovo nakon prijave.`);
