'use strict';
// Sve postavke panela: jedan opis služi i za provjeru vrijednosti i za crtanje ekrana Postavke.
const crypto = require('node:crypto');
const { one, run, all } = require('./db');

// type: toggle | text | number | select | chips | secret | textarea
// soon: true -> prikazuje se, ali još ne radi (označeno u panelu)
const SCHEMA = [
  { id: 'opste', title: 'Općenito i brend', desc: 'Ime, izgled i osnovne informacije panela.', rows: [
    { key: 'brand', type: 'text', label: 'Ime brenda', sub: 'Prikazuje se u panelu, aplikacijama, stranici za kupce i fakturama', def: 'Veltrix VPN' },
    { key: 'accent', type: 'chips', label: 'Boja akcenta', options: ['crvena', 'plava', 'zelena', 'ljubičasta'], def: 'crvena' },
    { key: 'panel_url', type: 'text', label: 'Adresa panela', sub: 'npr. https://panel.tvojvpn.com — koristi se u komandi za instalaciju servera', def: '', mono: true },
    { key: 'sub_url', type: 'text', label: 'Adresa za pretplatne linkove', sub: 'Odvojena domena, da kupci ne vide adresu panela. Prazno = ista kao panel.', def: '', mono: true },
    { key: 'timezone', type: 'select', label: 'Vremenska zona', options: ['Europe/Sarajevo', 'Europe/Berlin', 'Europe/Vienna', 'Europe/London', 'America/New_York', 'UTC'], def: 'Europe/Sarajevo' },
    { key: 'currency', type: 'select', label: 'Valuta', options: ['EUR', 'USD', 'BAM', 'CHF'], def: 'EUR' },
    { key: 'theme', type: 'chips', label: 'Tema panela', options: ['tamna', 'svijetla'], def: 'tamna' },
  ] },
  { id: 'sigurnost', title: 'Sigurnost i pristup', desc: 'Ko može ući u panel i kako.', rows: [
    { key: 'admin_path', type: 'text', label: 'Tajna putanja panela', sub: 'Panel se otvara samo na ovoj putanji, sve ostalo vraća 404. Poslije promjene otvori novu adresu.', def: '', mono: true },
    { key: 'require_2fa', type: 'toggle', label: 'Obavezna 2FA za sve admine', sub: 'Google Authenticator, Authy…', def: false },
    { key: 'ip_whitelist_on', type: 'toggle', label: 'Pristup panelu samo sa dozvoljenih IP adresa', sub: 'Pazi da upišeš svoju IP prije uključivanja', def: false },
    { key: 'ip_whitelist', type: 'text', label: 'Dozvoljene IP adrese', sub: 'Odvoji zarezom. Podržava raspon, npr. 77.77.0.0/16', def: '', mono: true },
    { key: 'session_minutes', type: 'select', label: 'Automatska odjava nakon neaktivnosti', options: ['30', '120', '720', '10080'], labels: ['30 minuta', '2 sata', '12 sati', '7 dana'], def: '720' },
    { key: 'lockout', type: 'select', label: 'Zaključaj prijavu nakon pogrešnih pokušaja', options: ['5/15', '3/60', '10/5'], labels: ['5 pokušaja / 15 min', '3 pokušaja / 1 sat', '10 pokušaja / 5 min'], def: '5/15' },
    { key: 'notify_new_ip', type: 'toggle', label: 'Javi na Telegram kad se admin prijavi sa nove IP', def: true },
  ] },
  { id: 'korisnici', title: 'Korisnici i planovi', desc: 'Šta se dešava sa korisnicima automatski.', rows: [
    { key: 'grace_days', type: 'select', label: 'Grace period nakon isteka', sub: 'Korisnik još radi ovoliko dana poslije isteka', options: ['0', '1', '3', '7'], labels: ['Bez grace perioda', '1 dan', '3 dana', '7 dana'], def: '0' },
    { key: 'delete_expired_days', type: 'select', label: 'Obriši istekle naloge nakon', options: ['30', '60', '90', '0'], labels: ['30 dana', '60 dana', '90 dana', 'Nikad'], def: '0' },
    { key: 'traffic_reset', type: 'chips', label: 'Reset prometa', options: ['na produženje', 'svaki mjesec', 'nikad'], def: 'na produženje' },
    { key: 'default_devices', type: 'number', label: 'Zadani limit uređaja', sub: 'Za nove korisnike, ako plan ne kaže drugačije (informativno)', def: 3 },
    { key: 'username_format', type: 'select', label: 'Prijedlog korisničkog imena', options: ['slobodno', 'auto'], labels: ['Slobodno upisivanje', 'Automatski (vpn_4821)'], def: 'slobodno' },
    { key: 'expiry_warn_days', type: 'select', label: '"Ističe uskoro" znači', options: ['3', '5', '7'], labels: ['3 dana ili manje', '5 dana ili manje', '7 dana ili manje'], def: '3' },
  ] },
  { id: 'serveri', title: 'Serveri i protokoli', desc: 'Kako rade VPN serveri i šta je dozvoljeno.', rows: [
    { key: 'proto_vless', type: 'toggle', label: 'VLESS + Reality', sub: 'Najteže ga je blokirati. Preporučeno.', def: true },
    { key: 'proto_wg', type: 'toggle', label: 'WireGuard', sub: 'Brz i jednostavan, ali ga je lakše blokirati', def: true },
    { key: 'sni_list', type: 'text', label: 'SNI lista za Reality', sub: 'Novi server dobije jednu nasumično', def: 'www.microsoft.com, www.apple.com, dl.google.com, www.amazon.com', mono: true },
    { key: 'block_torrent', type: 'toggle', label: 'Blokada torrenta', sub: 'Štiti servere od DMCA prijava (VLESS)', def: true },
    { key: 'block_ads', type: 'toggle', label: 'Blokada reklama', sub: 'VLESS preko liste domena, WireGuard preko AdGuard DNS-a', def: false },
    { key: 'block_adult', type: 'toggle', label: 'Blokada sadržaja za odrasle', sub: 'VLESS', def: false },
    { key: 'block_private', type: 'toggle', label: 'Zabrani pristup lokalnim mrežama servera', sub: 'Preporučeno uključeno', def: true },
    { key: 'dns', type: 'select', label: 'DNS za korisnike', options: ['1.1.1.1', '8.8.8.8', '9.9.9.9', '94.140.14.14'], labels: ['Cloudflare 1.1.1.1', 'Google 8.8.8.8', 'Quad9 (blokira malver)', 'AdGuard (blokira reklame)'], def: '1.1.1.1' },
    { key: 'heartbeat_sec', type: 'select', label: 'Server se javlja panelu svakih', options: ['10', '15', '30', '60'], labels: ['10 sekundi', '15 sekundi', '30 sekundi', '60 sekundi'], def: '15' },
    { key: 'offline_sec', type: 'select', label: 'Server je offline ako šuti', options: ['45', '90', '180'], labels: ['45 sekundi', '90 sekundi', '3 minute'], def: '45' },
    { key: 'capacity_warn', type: 'select', label: 'Upozori kad je server popunjen', options: ['70', '80', '90'], labels: ['70%', '80%', '90%'], def: '80' },
  ] },
  { id: 'reselleri', title: 'Reselleri', desc: 'Pravila za preprodavače.', rows: [
    { key: 'res_portal', type: 'toggle', label: 'Poseban panel za resellere', sub: 'Reselleri se prijavljuju na svojoj adresi i nikad ne vide tvoju tajnu admin adresu. Na admin adresi se reseller ne može prijaviti.', def: true },
    { key: 'reseller_path', type: 'text', label: 'Adresa panela za resellere', sub: 'Ovu adresu šalješ resellerima, npr. /reseller ili /partner', def: '/reseller', mono: true },
    { key: 'res_trials_day', type: 'number', label: 'Reseller smije napraviti probnih naloga dnevno', def: 10 },
    { key: 'res_can_delete', type: 'toggle', label: 'Reseller smije brisati korisnike', sub: 'Ako ne, može ih samo ugasiti', def: false },
    { key: 'res_negative', type: 'number', label: 'Reseller smije u minus do (€)', sub: '0 = ne može praviti korisnike bez kredita', def: 0 },
    { key: 'res_refund_delete', type: 'toggle', label: 'Vrati kredit kad reseller obriše neiskorištenog korisnika (u prva 24 h)', def: true },
    { key: 'res_min_topup', type: 'number', label: 'Minimalna kupovina kredita (€)', def: 50 },
  ] },
  { id: 'placanja', title: 'Plaćanja i fakture', desc: 'Podaci koji se prikazuju resellerima i na fakturama.', rows: [
    { key: 'pay_methods', type: 'text', label: 'Načini plaćanja', sub: 'Odvoji zarezom', def: 'Wise, Kripto (USDT), PayPal, Gotovina' },
    { key: 'pay_usdt', type: 'text', label: 'USDT adresa (TRC20)', def: '', mono: true },
    { key: 'pay_iban', type: 'text', label: 'IBAN', def: '', mono: true },
    { key: 'pay_paypal', type: 'text', label: 'PayPal e-mail', def: '' },
    { key: 'inv_company', type: 'text', label: 'Ime firme na fakturi', def: '' },
    { key: 'inv_address', type: 'textarea', label: 'Adresa i porezni broj', def: '' },
    { key: 'inv_prefix', type: 'text', label: 'Prefiks broja fakture', def: 'F-', mono: true },
    { key: 'vat', type: 'select', label: 'PDV na fakturama', options: ['0', '17', '19', '20'], labels: ['Bez PDV-a', '17%', '19%', '20%'], def: '0' },
  ] },
  { id: 'obavijesti', title: 'Obavještenja i Telegram bot', desc: 'Šta ti javlja panel.', rows: [
    { key: 'tg_token', type: 'secret', label: 'Telegram bot token', sub: 'Napravi bota kod @BotFather', def: '' },
    { key: 'tg_chat', type: 'text', label: 'Tvoj Telegram chat ID', sub: 'Pošalji botu /start, pa klikni "Pošalji probnu poruku"', def: '', mono: true },
    { key: 'n_server', type: 'toggle', label: 'Server pao ili se vratio', def: true },
    { key: 'n_capacity', type: 'toggle', label: 'Server preko kapaciteta', def: true },
    { key: 'n_payment', type: 'toggle', label: 'Nova uplata ili kupovina kredita', def: true },
    { key: 'n_lowcredit', type: 'toggle', label: 'Reselleru ponestaje kredita (ispod €10)', def: true },
    { key: 'n_backup', type: 'toggle', label: 'Backup nije uspio', def: true },
    { key: 'n_daily', type: 'toggle', label: 'Dnevni izvještaj u 09:00', sub: 'Zarada, novi korisnici, problemi', def: true },
    { key: 'customer_reminders', type: 'toggle', label: 'Podsjetnik kupcima prije isteka', sub: 'Treba e-mail ili Telegram kupaca', def: false, soon: true },
  ] },
  { id: 'pretplata', title: 'Pretplata i aplikacije', desc: 'Šta kupac vidi u aplikaciji i na svojoj stranici.', rows: [
    { key: 'sub_name', type: 'text', label: 'Ime profila u aplikaciji', sub: 'Prazno = ime brenda', def: '' },
    { key: 'sub_interval', type: 'select', label: 'Aplikacija osvježava listu servera svakih', options: ['6', '12', '24'], labels: ['6 sati', '12 sati', '24 sata'], def: '12' },
    { key: 'sub_announce', type: 'text', label: 'Poruka u aplikaciji i na stranici za kupce', sub: 'Podržavaju je Hiddify i neke druge aplikacije', def: '' },
    { key: 'customer_page', type: 'toggle', label: 'Stranica za kupce', sub: 'Status, QR kod i uputstva kad kupac otvori link u browseru', def: true },
    { key: 'support_contact', type: 'text', label: 'Kontakt podrške za kupce', sub: 'npr. Telegram @tvojvpn', def: '' },
    { key: 'msg_template', type: 'textarea', label: 'Poruka za kupca (dugme "Pošalji kupcu")', sub: 'Zamjene: {korisnik} {plan} {istice} {dana} {link} {brend} {podrska}', def: 'Zdravo! 👋\n\nTvoj {brend} je spreman ✅\nPlan: {plan}\nVrijedi do: {istice}\n\n1️⃣ Instaliraj aplikaciju Hiddify (iPhone, Android ili računar)\n2️⃣ Otvori ovaj link i klikni „Dodaj u Hiddify“, ili skeniraj QR kod:\n{link}\n3️⃣ Klikni dugme za spajanje i to je to.\n\nPomoć: {podrska}' },
  ] },
  { id: 'backup', title: 'Backup', desc: 'Da ništa ne izgubiš.', rows: [
    { key: 'backup_on', type: 'toggle', label: 'Automatski backup baze', def: true },
    { key: 'backup_every_h', type: 'select', label: 'Kada', options: ['24', '6', '168'], labels: ['Svaki dan u 04:00', 'Svakih 6 sati', 'Svake sedmice'], def: '24' },
    { key: 'backup_keep', type: 'select', label: 'Čuvaj zadnjih', options: ['7', '14', '30'], labels: ['7 kopija', '14 kopija', '30 kopija'], def: '14' },
    { key: 'backup_tg', type: 'toggle', label: 'Pošalji svaki backup i na Telegram', def: true },
  ] },
  { id: 'api', title: 'API i integracije', desc: 'Za povezivanje sa prodajnim botom, sajtom ili drugim programima.', rows: [
    { key: 'api_on', type: 'toggle', label: 'API uključen', sub: 'Ključeve praviš ispod', def: false },
    { key: 'webhook_url', type: 'text', label: 'Webhook za nove uplate i korisnike', sub: 'Panel šalje POST sa JSON podacima', def: '', mono: true },
  ] },
  { id: 'sistem', title: 'Sistem i održavanje', desc: 'Logovi, privatnost i održavanje.', rows: [
    { key: 'maintenance', type: 'toggle', label: 'Režim održavanja', sub: 'Reselleri i kupci vide poruku. VPN i dalje radi.', def: false },
    { key: 'maintenance_msg', type: 'text', label: 'Poruka održavanja', def: 'Panel je trenutno na održavanju. VPN radi normalno.' },
    { key: 'log_days', type: 'select', label: 'Čuvaj logove aktivnosti', options: ['30', '90', '365'], labels: ['30 dana', '90 dana', '1 godinu'], def: '90' },
    { key: 'no_logs', type: 'toggle', label: 'Ne čuvaj IP adrese korisnika (no-logs)', sub: 'Bilježi se samo država i vrijeme', def: true },
  ] },
];

const ROWS = Object.fromEntries(SCHEMA.flatMap((s) => s.rows.map((r) => [r.key, r])));
let cache = null;

function load() {
  if (cache) return cache;
  const out = {};
  for (const [k, r] of Object.entries(ROWS)) out[k] = r.def;
  for (const { key, value } of all('SELECT key, value FROM settings')) {
    try { out[key] = JSON.parse(value); } catch { /* preskoči */ }
  }
  if (!out.admin_path) {           // prvo pokretanje: nasumična tajna putanja
    out.admin_path = '/' + crypto.randomBytes(5).toString('hex');
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'admin_path', JSON.stringify(out.admin_path));
  }
  if (process.env.VPN_ADMIN_PATH) out.admin_path = process.env.VPN_ADMIN_PATH;
  cache = out;
  return out;
}

function get(key) { return load()[key]; }

function clean(key, value) {
  const r = ROWS[key];
  if (!r) return undefined;
  if (r.type === 'toggle') return !!value;
  if (r.type === 'number') { const n = Number(value); return Number.isFinite(n) ? n : r.def; }
  if (r.type === 'select' || r.type === 'chips') return r.options.includes(String(value)) ? String(value) : r.def;
  if (r.type === 'secret' && String(value ?? '').includes('••')) return undefined;   // nije mijenjano
  let v = String(value ?? '').slice(0, 2000);
  if (key === 'admin_path') {
    v = '/' + v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (v.length < 5) throw new Error('Tajna putanja mora imati bar 4 znaka (slova, brojevi, - i _).');
  }
  if (key === 'reseller_path') {
    v = '/' + v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (v.length < 3) throw new Error('Adresa za resellere mora imati bar 2 znaka (slova, brojevi, - i _).');
    if (['/s', '/agent', '/install', '/api'].includes(v.toLowerCase())) throw new Error('Ta adresa je rezervisana, izaberi drugu.');
    if (v === load().admin_path) throw new Error('Adresa za resellere ne smije biti ista kao tajna admin adresa.');
  }
  if (key === 'admin_path' && v === load().reseller_path) throw new Error('Tajna admin adresa ne smije biti ista kao adresa za resellere.');
  if (key === 'panel_url' || key === 'sub_url') v = v.trim().replace(/\/+$/, '');
  return v;
}

function set(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch || {})) {
    const c = clean(k, v);
    if (c === undefined) continue;
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, JSON.stringify(c));
    changed.push(k);
  }
  cache = null;
  return changed;
}

function publicSchema() {
  return SCHEMA.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, def: undefined })) }));
}

function forClient() {
  const s = { ...load() };
  if (s.tg_token) s.tg_token = s.tg_token.slice(0, 6) + '••••••••';
  return s;
}

module.exports = { SCHEMA, get, load, set, publicSchema, forClient };
