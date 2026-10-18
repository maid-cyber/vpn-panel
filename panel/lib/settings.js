'use strict';
// Sve postavke panela: jedan opis služi i za provjeru vrijednosti i za crtanje ekrana Postavke.
const crypto = require('node:crypto');
const { one, run, all } = require('./db');

// type: toggle | text | number | select | chips | multi | secret | textarea
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
    { key: 'setup_hide', type: 'toggle', label: 'Sakrij "Prvi koraci" na dashboardu', def: false },
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
    { key: 'default_devices', type: 'number', label: 'Zadani limit uređaja', sub: 'Za nove korisnike, ako plan ne kaže drugačije', def: 3 },
    { key: 'device_limit', type: 'select', label: 'Kad korisnik pređe limit uređaja (VLESS i Shadowsocks)', sub: 'Server broji različite IP adrese u zadnje 3 minute, samo u memoriji, ništa se ne sprema', options: ['iskljuceno', 'prikazi', 'blokiraj'], labels: ['Ne provjeravaj', 'Samo prikaži u panelu', 'Blokiraj na 15 minuta'], def: 'prikazi' },
    { key: 'auto_renew_on', type: 'toggle', label: 'Automatsko produženje sa kredita resellera', sub: 'Kod korisnika resellera može se uključiti "Produži sam": dan prije isteka plan se produži i skine kredit', def: true },
    { key: 'username_format', type: 'select', label: 'Prijedlog korisničkog imena', options: ['slobodno', 'auto'], labels: ['Slobodno upisivanje', 'Automatski (vpn_4821)'], def: 'slobodno' },
    { key: 'expiry_warn_days', type: 'select', label: '"Ističe uskoro" znači', options: ['3', '5', '7'], labels: ['3 dana ili manje', '5 dana ili manje', '7 dana ili manje'], def: '3' },
  ] },
  { id: 'serveri', title: 'Serveri i protokoli', desc: 'Kako rade VPN serveri i šta je dozvoljeno.', rows: [
    { key: 'proto_vless', type: 'toggle', label: 'VLESS + Reality', sub: 'Najteže ga je blokirati. Preporučeno.', def: true },
    { key: 'proto_wg', type: 'toggle', label: 'WireGuard', sub: 'Brz i jednostavan, ali ga je lakše blokirati', def: true },
    { key: 'proto_ss', type: 'toggle', label: 'Shadowsocks 2022', sub: 'Treći protokol, rezerva kad su ostali blokirani. Port se podešava kod servera (zadano 8388).', def: false },
    { key: 'sni_list', type: 'text', label: 'SNI lista za Reality', sub: 'Novi server dobije jednu nasumično', def: 'www.microsoft.com, www.apple.com, dl.google.com, www.amazon.com', mono: true },
    { key: 'block_torrent', type: 'toggle', label: 'Blokada torrenta', sub: 'Štiti servere od DMCA prijava. Serveri označeni kao P2P i dalje dozvoljavaju torrent.', def: true },
    { key: 'block_ads', type: 'toggle', label: 'Blokada reklama i praćenja', sub: 'AdGuard DNS na serveru, za sve protokole', def: false },
    { key: 'block_adult', type: 'toggle', label: 'Blokada sadržaja za odrasle', sub: 'AdGuard Family DNS (blokira i reklame)', def: false },
    { key: 'block_malware', type: 'toggle', label: 'Blokada malvera i phishinga', sub: 'Quad9 DNS (AdGuard već blokira i ovo)', def: true },
    { key: 'block_private', type: 'toggle', label: 'Zabrani pristup lokalnim mrežama servera', sub: 'Preporučeno uključeno', def: true },
    { key: 'dns', type: 'select', label: 'DNS kad nijedna blokada nije uključena', options: ['1.1.1.1', '8.8.8.8', '9.9.9.9'], labels: ['Cloudflare 1.1.1.1', 'Google 8.8.8.8', 'Quad9 9.9.9.9'], def: '1.1.1.1' },
    { key: 'heartbeat_sec', type: 'select', label: 'Server se javlja panelu svakih', options: ['10', '15', '30', '60'], labels: ['10 sekundi', '15 sekundi', '30 sekundi', '60 sekundi'], def: '15' },
    { key: 'offline_sec', type: 'select', label: 'Server je offline ako šuti', options: ['45', '90', '180'], labels: ['45 sekundi', '90 sekundi', '3 minute'], def: '45' },
    { key: 'capacity_warn', type: 'select', label: 'Upozori kad je server popunjen', options: ['70', '80', '90'], labels: ['70%', '80%', '90%'], def: '80' },
    { key: 'sub_smart', type: 'toggle', label: 'Automatski skloni kupce sa servera koji ne radi ili je pun', sub: 'Pretplata ne nudi offline i popunjene servere, aplikacija se sama prebaci', def: true },
    { key: 'xray_autoupdate', type: 'toggle', label: 'Automatsko ažuriranje Xraya na serverima', sub: 'Jednom sedmično, noću između 3 i 5 h', def: true },
  ] },
  { id: 'hosteri', title: 'Hosteri (server u jedan klik)', desc: 'Panel sam zakupi server kod hostera, instalira VPN i doda ga. Upiši ključeve samo za hostere koje koristiš. Ključevi se čuvaju samo u panelu i nikad se ne prikazuju cijeli. Ne šalji ih nikome.', rows: [
    { key: 'hz_capacity', type: 'number', label: 'Kapacitet novog servera (maksimalno spojenih)', def: 400 },
    { key: 'hz_token', type: 'secret', label: 'Hetzner: API token (Read & Write)', sub: 'Hetzner Cloud Console → projekat → Security → API Tokens → Generate', def: '' },
    { key: 'hz_ssh_key', type: 'text', label: 'Hetzner: ime SSH ključa (opcionalno)', sub: 'Bez ključa Hetzner root šifru pošalje na e-mail', def: '' },
    { key: 'do_token', type: 'secret', label: 'DigitalOcean: API token (Read & Write)', sub: 'cloud.digitalocean.com → API → Tokens → Generate New Token', def: '' },
    { key: 'do_ssh_key', type: 'text', label: 'DigitalOcean: otisak (fingerprint) SSH ključa (opcionalno)', def: '', mono: true },
    { key: 'vultr_token', type: 'secret', label: 'Vultr: API ključ', sub: 'my.vultr.com → Account → API → Enable API. Dozvoli IP adresu panela u "Access Control".', def: '' },
    { key: 'vultr_ssh_key', type: 'text', label: 'Vultr: ID SSH ključa (opcionalno)', def: '', mono: true },
    { key: 'ovh_endpoint', type: 'select', label: 'OVH: region API-ja', options: ['eu', 'ca', 'us'], labels: ['Evropa (ovh.com)', 'Kanada / svijet (ovh.ca)', 'SAD (ovhcloud.com)'], def: 'eu' },
    { key: 'ovh_app_key', type: 'text', label: 'OVH: Application key', sub: 'Napravi na eu.api.ovh.com/createToken sa pravima GET, POST i DELETE na /cloud/*', def: '', mono: true },
    { key: 'ovh_app_secret', type: 'secret', label: 'OVH: Application secret', def: '' },
    { key: 'ovh_consumer_key', type: 'secret', label: 'OVH: Consumer key', def: '' },
    { key: 'ovh_project', type: 'text', label: 'OVH: ID Public Cloud projekta', sub: 'U OVH Public Cloud, ispod imena projekta (32 znaka)', def: '', mono: true },
    { key: 'ovh_ssh_key', type: 'text', label: 'OVH: ID SSH ključa u projektu (opcionalno)', def: '', mono: true },
    { key: 'contabo_client_id', type: 'text', label: 'Contabo: Client ID', sub: 'my.contabo.com → API: Client ID, Client Secret, API User i API Password', def: '', mono: true },
    { key: 'contabo_client_secret', type: 'secret', label: 'Contabo: Client Secret', def: '' },
    { key: 'contabo_user', type: 'text', label: 'Contabo: API User (e-mail)', def: '' },
    { key: 'contabo_pass', type: 'secret', label: 'Contabo: API Password', def: '' },
    { key: 'contabo_ssh_key', type: 'text', label: 'Contabo: secretId SSH ključa (opcionalno)', def: '', mono: true },
  ] },
  { id: 'reselleri', title: 'Reselleri', desc: 'Pravila za preprodavače.', rows: [
    { key: 'res_portal', type: 'toggle', label: 'Poseban panel za resellere', sub: 'Reselleri se prijavljuju na svojoj adresi i nikad ne vide tvoju tajnu admin adresu. Na admin adresi se reseller ne može prijaviti.', def: true },
    { key: 'reseller_path', type: 'text', label: 'Adresa panela za resellere', sub: 'Ovu adresu šalješ resellerima, npr. /reseller ili /partner', def: '/reseller', mono: true },
    { key: 'res_signup', type: 'toggle', label: 'Reselleri se mogu sami registrovati', sub: 'Na njihovoj adresi se pojavi "Registruj se". Ti odobravaš svaki nalog.', def: false },
    { key: 'res_auto_level', type: 'toggle', label: 'Automatski podigni nivo resellera', sub: 'Svakog 1. u mjesecu prema kupljenom kreditu prošlog mjeseca (preporučena kupovina kod nivoa)', def: false },
    { key: 'res_whitelabel', type: 'toggle', label: 'Vlastiti brend za resellere (white-label)', sub: 'Reseller u meniju "Moj brend" upiše ime, logo, boju i kontakt. Njegovi kupci to vide umjesto tvog brenda', def: false },
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
    { key: 'stripe_on', type: 'toggle', label: 'Stripe: reselleri plaćaju kredit karticom', sub: 'Kredit se doda automatski čim plaćanje prođe', def: false },
    { key: 'stripe_secret', type: 'secret', label: 'Stripe tajni ključ (sk_live_… ili sk_test_…)', def: '' },
    { key: 'stripe_whsec', type: 'secret', label: 'Stripe webhook tajna (whsec_…)', sub: 'U Stripeu dodaj webhook na adresu ispod, događaj checkout.session.completed', def: '' },
    { key: 'inv_company', type: 'text', label: 'Ime firme na fakturi', def: '' },
    { key: 'inv_address', type: 'textarea', label: 'Adresa i porezni broj', def: '' },
    { key: 'inv_prefix', type: 'text', label: 'Prefiks broja fakture', def: 'F-', mono: true },
    { key: 'vat', type: 'select', label: 'PDV na fakturama', options: ['0', '17', '19', '20'], labels: ['Bez PDV-a', '17%', '19%', '20%'], def: '0' },
    { key: 'mail_invoices', type: 'toggle', label: 'Šalji fakturu resellerima na e-mail', sub: 'Treba podešen e-mail (Obavještenja) i e-mail resellera u njegovom profilu', def: true },
  ] },
  { id: 'obavijesti', title: 'Obavještenja i Telegram bot', desc: 'Šta ti javlja panel.', rows: [
    { key: 'tg_token', type: 'secret', label: 'Telegram bot token', sub: 'Napravi bota kod @BotFather', def: '' },
    { key: 'tg_chat', type: 'text', label: 'Tvoj Telegram chat ID', sub: 'Pošalji botu /start, pa klikni "Pošalji probnu poruku"', def: '', mono: true },
    { key: 'n_server', type: 'toggle', label: 'Server pao ili se vratio', def: true },
    { key: 'n_capacity', type: 'toggle', label: 'Server preko kapaciteta', def: true },
    { key: 'n_payment', type: 'toggle', label: 'Nova uplata ili kupovina kredita', def: true },
    { key: 'n_lowcredit', type: 'toggle', label: 'Reselleru ponestaje kredita (ispod €10)', def: true },
    { key: 'n_backup', type: 'toggle', label: 'Backup nije uspio', def: true },
    { key: 'n_diag', type: 'toggle', label: 'Kupac poslao dijagnostiku iz aplikacije', def: true },
    { key: 'n_daily', type: 'toggle', label: 'Dnevni izvještaj u 09:00', sub: 'Zarada, novi korisnici, problemi', def: true },
    { key: 'customer_reminders', type: 'toggle', label: 'Podsjetnik kupcima prije isteka', sub: 'Na Telegram (bot za kupce) i e-mail, kad je ostalo onoliko dana koliko piše kod "Ističe uskoro"', def: true },
    { key: 'cbot_on', type: 'toggle', label: 'Telegram bot za kupce', sub: 'Kupac na svojoj stranici klikne "Poveži Telegram" i dobija podsjetnike, stanje naloga i tvoje poruke', def: false },
    { key: 'cbot_token', type: 'secret', label: 'Token bota za kupce', sub: 'Napravi poseban bot kod @BotFather (ne onaj za tvoje obavijesti)', def: '' },
    { key: 'smtp_host', type: 'text', label: 'E-mail: SMTP server', sub: 'npr. smtp-relay.brevo.com, smtp.gmail.com, smtp.zoho.eu', def: '', mono: true },
    { key: 'smtp_port', type: 'select', label: 'E-mail: port', options: ['587', '465', '2525'], labels: ['587 (STARTTLS)', '465 (SSL)', '2525'], def: '587' },
    { key: 'smtp_user', type: 'text', label: 'E-mail: korisničko ime', def: '', mono: true },
    { key: 'smtp_pass', type: 'secret', label: 'E-mail: šifra ili API ključ', def: '' },
    { key: 'smtp_from', type: 'text', label: 'E-mail: pošiljalac', sub: 'npr. Veltrix VPN <info@tvojadomena.com>', def: '' },
    { key: 'mail_welcome', type: 'toggle', label: 'Kupcu automatski pošalji pristup na e-mail', sub: 'Kad napraviš kupca sa e-mailom (ti ili reseller): link, plan, datum isteka i 3 koraka za spajanje', def: true },
    { key: 'mail_newlink', type: 'toggle', label: 'Pošalji kupcu e-mail kad mu daš novi link', def: true },
  ] },
  { id: 'pretplata', title: 'Pretplata i aplikacije', desc: 'Šta kupac vidi u aplikaciji i na svojoj stranici.', rows: [
    { key: 'sub_name', type: 'text', label: 'Ime profila u aplikaciji', sub: 'Prazno = ime brenda', def: '' },
    { key: 'sub_interval', type: 'select', label: 'Aplikacija osvježava listu servera svakih', options: ['6', '12', '24'], labels: ['6 sati', '12 sati', '24 sata'], def: '12' },
    { key: 'sub_announce', type: 'text', label: 'Poruka u aplikaciji i na stranici za kupce', sub: 'Podržavaju je Hiddify i neke druge aplikacije', def: '' },
    { key: 'customer_page', type: 'toggle', label: 'Stranica za kupce', sub: 'Status, QR kod i uputstva kad kupac otvori link u browseru', def: true },
    { key: 'support_contact', type: 'text', label: 'Kontakt podrške za kupce', sub: 'npr. Telegram @tvojvpn', def: '' },
    { key: 'apps', type: 'multi', label: 'Preporučene aplikacije na stranici kupca', options: ['veltrix', 'hiddify', 'v2rayng', 'streisand', 'v2box', 'happ', 'shadowrocket'], labels: ['Veltrix VPN (naša)', 'Hiddify', 'v2rayNG', 'Streisand', 'V2Box', 'Happ', 'Shadowrocket'], def: 'veltrix,hiddify,v2rayng,streisand,v2box' },
    { key: 'msg_template', type: 'textarea', label: 'Poruka za kupca (dugme "Pošalji kupcu")', sub: 'Zamjene: {korisnik} {plan} {istice} {dana} {link} {brend} {podrska}', def: 'Zdravo! 👋\n\nTvoj {brend} je spreman ✅\nPlan: {plan}\nVrijedi do: {istice}\n\n1️⃣ Instaliraj aplikaciju Hiddify (iPhone, Android ili računar)\n2️⃣ Otvori ovaj link i klikni „Dodaj u Hiddify“, ili skeniraj QR kod:\n{link}\n3️⃣ Klikni dugme za spajanje i to je to.\n\nPomoć: {podrska}' },
  ] },
  { id: 'sajt', title: 'Web sajt', desc: 'Javni sajt na glavnoj adresi servera: cijene i lokacije uživo, kupovina karticom.', rows: [
    { key: 'site_on', type: 'toggle', label: 'Prikaži sajt na glavnoj adresi', sub: 'Isključeno: glavna adresa vraća "Not found" kao prije. Tajna adresa panela ostaje skrivena u oba slučaja.', def: true },
    { key: 'app_repo', type: 'text', label: 'GitHub repozitorij aplikacija', sub: 'Odavde sajt uzima zadnji Android APK i Windows instalaciju', def: 'maid-cyber/veltrix-app', mono: true },
  ] },
  { id: 'aplikacija', page: 'aplikacija', title: 'Veltrix aplikacija', desc: 'Šta kupci imaju u Android i Windows aplikaciji. Uređuje se na stranici Aplikacija.', rows: [
    // prijava i nalog
    { key: 'app_trial', grp: 'nalog', type: 'toggle', label: 'Probaj besplatno', sub: 'Dugme na prijavi. Koristi prvi aktivni plan označen kao probni (Planovi). Jedan po uređaju, jedan po IP adresi sedmično.', def: false },
    { key: 'app_trial_cap', grp: 'nalog', type: 'number', label: 'Najviše probnih naloga dnevno', sub: 'Zaštita od zloupotrebe', def: 20 },
    { key: 'renew_on', grp: 'nalog', type: 'toggle', label: 'Produži karticom', sub: 'Dugme "Produži pretplatu" u aplikaciji i na stranici kupca. Samo za tvoje kupce. Treba uključen Stripe.', def: true },
    { key: 'ref_on', grp: 'nalog', type: 'toggle', label: 'Pozovi prijatelja', sub: 'Kupac dijeli svoj kod; kad prijatelj prvi put plati, obojica dobiju gratis dane', def: false },
    { key: 'ref_days', grp: 'nalog', type: 'number', label: 'Gratis dana za preporuku', def: 7 },
    { key: 'app_devices', grp: 'nalog', type: 'toggle', label: 'Uređaji', sub: 'Kupac vidi koliko uređaja je spojeno od dozvoljenih', def: true },
    { key: 'app_history', grp: 'nalog', type: 'toggle', label: 'Povijest aktivnosti', sub: 'Produženja, promjene plana i blokade sa naloga', def: true },
    { key: 'app_support', grp: 'nalog', type: 'toggle', label: 'Dugme Podrška', sub: 'Otvara tvoj Telegram ili link iz "Kontakt podrške"', def: true },
    // spajanje
    { key: 'app_protocol', grp: 'veza', type: 'toggle', label: 'Kupac bira protokol', sub: 'Isključeno: aplikacija uvijek koristi Automatski (VLESS, pa Shadowsocks)', def: true },
    { key: 'app_ss_fallback', grp: 'veza', type: 'toggle', label: 'Automatski prebaci na Shadowsocks', sub: 'Kad VLESS ne prolazi na mreži kupca. Treba uključen Shadowsocks u Postavke → Serveri.', def: true },
    { key: 'app_chains', grp: 'veza', type: 'toggle', label: 'Double VPN i Multihop', sub: 'Lanci servera se prikazuju u Lokacijama', def: true },
    { key: 'app_boot', grp: 'veza', type: 'toggle', label: 'Spajanje pri paljenju uređaja', def: true },
    // sigurnost
    { key: 'app_killswitch', grp: 'sigurnost', type: 'toggle', label: 'Kill Switch', sub: 'Internet ne radi dok VPN nije spojen (Android: "Uvijek uključen VPN")', def: true },
    { key: 'app_dns', grp: 'sigurnost', type: 'toggle', label: 'DNS zaštita', sub: 'Filtrirani DNS servera ili šifrovani 1.1.1.1', def: true },
    { key: 'app_dns_def', grp: 'sigurnost', type: 'toggle', label: 'DNS zaštita uključena za nove', sub: 'Početno stanje, kupac ga može promijeniti', def: true, dep: 'app_dns' },
    { key: 'app_split', grp: 'sigurnost', type: 'toggle', label: 'Split tunneling', sub: 'Kupac bira aplikacije koje idu mimo VPN-a (npr. banka)', def: true },
    { key: 'app_ipleak', grp: 'sigurnost', type: 'toggle', label: 'IP leak zaštita', sub: 'Blokira IPv6 i promet koji bi zaobišao VPN', def: true },
    { key: 'app_ipleak_def', grp: 'sigurnost', type: 'toggle', label: 'IP leak zaštita uključena za nove', def: true, dep: 'app_ipleak' },
    { key: 'app_webrtc', grp: 'sigurnost', type: 'toggle', label: 'WebRTC zaštita', sub: 'Stranice ne mogu otkriti pravu IP adresu', def: true },
    { key: 'app_webrtc_def', grp: 'sigurnost', type: 'toggle', label: 'WebRTC zaštita uključena za nove', def: true, dep: 'app_webrtc' },
    // alati
    { key: 'app_speedtest', grp: 'alati', type: 'toggle', label: 'Test brzine', sub: '"Izmjeri brzinu" na početnom ekranu', def: true },
    { key: 'app_diag', grp: 'alati', type: 'toggle', label: 'Dijagnostika veze', sub: 'Kupac sam provjeri zašto internet ne radi, prije nego ti piše', def: true },
    { key: 'app_notify', grp: 'alati', type: 'toggle', label: 'Obavijesti na telefonu', sub: 'Kad se VPN prekine i 3 dana prije isteka', def: true },
    // izgled
    { key: 'app_look', grp: 'izgled', type: 'toggle', label: 'Kupac mijenja boju i AMOLED', def: true },
    { key: 'app_language', grp: 'izgled', type: 'toggle', label: 'Kupac bira jezik', def: true },
    { key: 'app_lang_default', grp: 'izgled', type: 'select', label: 'Jezik aplikacije', sub: 'Dok kupac sam ne izabere (ili uvijek, ako je izbor jezika isključen)', options: ['auto', 'bs', 'en'], labels: ['Kao telefon', 'Bosanski', 'English'], def: 'auto' },
    // verzije
    { key: 'app_updates', grp: 'verzije', type: 'toggle', label: 'Aplikacija nudi nove verzije', sub: 'Kad izađe nova verzija na GitHubu, kupac dobije "Ažuriraj"', def: true },
    { key: 'app_min_android', grp: 'verzije', type: 'number', label: 'Najstarija dozvoljena verzija (Android build)', sub: 'Starije verzije moraju se ažurirati prije spajanja. 0 = sve verzije rade.', def: 0 },
    { key: 'app_min_windows', grp: 'verzije', type: 'number', label: 'Najstarija dozvoljena verzija (Windows build)', sub: '0 = sve verzije rade', def: 0 },
    { key: 'app_update_msg', grp: 'verzije', type: 'text', label: 'Poruka za obavezno ažuriranje', def: 'Ova verzija aplikacije više ne radi. Ažuriraj na novu verziju.' },
  ] },
  { id: 'backup', title: 'Backup', desc: 'Da ništa ne izgubiš.', rows: [
    { key: 'backup_on', type: 'toggle', label: 'Automatski backup baze', def: true },
    { key: 'backup_every_h', type: 'select', label: 'Kada', options: ['24', '6', '168'], labels: ['Svaki dan u 04:00', 'Svakih 6 sati', 'Svake sedmice'], def: '24' },
    { key: 'backup_keep', type: 'select', label: 'Čuvaj zadnjih', options: ['7', '14', '30'], labels: ['7 kopija', '14 kopija', '30 kopija'], def: '14' },
    { key: 'backup_tg', type: 'toggle', label: 'Pošalji svaki backup i na Telegram', def: true },
    { key: 's3_on', type: 'toggle', label: 'Šalji backup i na S3 (Backblaze B2, Cloudflare R2, Wasabi, AWS)', def: false },
    { key: 's3_endpoint', type: 'text', label: 'S3 endpoint', sub: 'npr. https://s3.eu-central-003.backblazeb2.com', def: '', mono: true },
    { key: 's3_region', type: 'text', label: 'S3 regija', sub: 'npr. eu-central-003, auto (R2), us-east-1', def: 'us-east-1', mono: true },
    { key: 's3_bucket', type: 'text', label: 'S3 bucket', def: '', mono: true },
    { key: 's3_key', type: 'text', label: 'S3 access key', def: '', mono: true },
    { key: 's3_secret', type: 'secret', label: 'S3 secret key', def: '' },
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
    { key: 'update_repo', type: 'text', label: 'GitHub repozitorij za ažuriranje panela', sub: 'Odakle dugme "Ažuriraj panel" skida novu verziju', def: 'maid-cyber/vpn-panel', mono: true },
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
  if (r.type === 'multi') return [].concat(Array.isArray(value) ? value : String(value ?? '').split(',')).map((x) => String(x).trim()).filter((x) => r.options.includes(x)).join(',');
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
  // tajne vrijednosti (tokeni, ključevi, šifre) nikad ne idu u browser u cijelosti
  for (const r of Object.values(ROWS)) if (r.type === 'secret' && s[r.key]) s[r.key] = String(s[r.key]).slice(0, 6) + '••••••••';
  return s;
}

module.exports = { SCHEMA, get, load, set, publicSchema, forClient };
