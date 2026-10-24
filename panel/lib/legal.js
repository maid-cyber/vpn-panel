'use strict';
// Politika privatnosti i uslovi korištenja. Tekst se sam popunjava iz Postavke → Pravno,
// a opisuje tačno ono što panel i aplikacije stvarno rade (vidi README, sekcija 31).
const settings = require('./settings');
const { send, esc } = require('./http');

const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" fill="#E3172B"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" fill="#121216"/><path d="M100 52 100 104 82 164H54z" fill="#E3172B"/><path d="M100 52 146 164h-28l-18-60z" fill="#9E0C1A"/><path d="M90.5 128h19l4.5 14h-28z" fill="#FF4A5A"/><path d="M100 52 111 78H89z" fill="#FF4A5A"/>';

function who() {
  const s = settings.load();
  const brand = s.brand || 'VPN';
  const name = String(s.legal_entity || s.inv_company || '').trim();
  const email = String(s.legal_email || '').trim() || (String(s.smtp_from || '').match(/[^\s<>]+@[^\s<>]+/) || [''])[0];
  return {
    brand,
    name: name || brand,
    named: !!name,
    email,
    address: String(s.legal_address || s.inv_address || '').trim(),
    country: String(s.legal_country || 'Bosna i Hercegovina').trim(),
    refund: Number(s.legal_refund_days || 14),
    support: String(s.support_contact || '').trim(),
    base: (s.panel_url || s.sub_url || '').replace(/\/+$/, ''),
  };
}

function page(title, intro, blocks, w) {
  const upd = new Date(Number(settings.get('legal_updated') || Date.now())).toLocaleDateString('bs-BA', { timeZone: settings.get('timezone') || 'Europe/Sarajevo' }).replace(/\.$/, '');
  const body = blocks.map(([h, ...ps], i) => `<section><h2><span>${i + 1}.</span>${esc(h)}</h2>${ps.map((p) => (typeof p === 'string' ? `<p>${p}</p>` : `<ul>${p.map((x) => `<li>${x}</li>`).join('')}</ul>`)).join('')}</section>`).join('');
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(w.brand)}</title><meta name="theme-color" content="#0b0b10">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<style>
:root{--bg:#0b0b10;--card:#14141c;--line:#24242f;--line2:#33333f;--text:#f2f2f6;--soft:#c3c3cf;--muted:#8e8e9c;--red:#e3172b;--red2:#ff4a5a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 "Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(800px 420px at 85% -10%,rgba(227,23,43,.16),transparent 62%)}
a{color:var(--red2)}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);background:rgba(11,11,16,.8);position:sticky;top:0;backdrop-filter:blur(12px)}
header .wrap{display:flex;align-items:center;gap:11px;height:66px}
header b{font:800 19px "Segoe UI",system-ui,sans-serif;letter-spacing:.08em}
header b em{font-style:normal;color:var(--red)}
header a.back{margin-left:auto;color:var(--soft);text-decoration:none;font-size:14px}
header a.back:hover{color:var(--text)}
h1{font-size:clamp(28px,4vw,40px);line-height:1.15;margin:46px 0 10px;letter-spacing:-.02em}
.upd{color:var(--muted);font-size:14px;margin:0 0 30px}
.intro{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--red);border-radius:14px;padding:18px 22px;color:var(--soft);margin:0 0 36px}
.intro p{margin:0 0 10px}.intro p:last-child{margin:0}
section{margin:0 0 34px}
h2{font-size:20px;margin:0 0 12px;display:flex;gap:10px;align-items:baseline;letter-spacing:-.01em}
h2 span{color:var(--red2);font-size:15px;font-weight:700}
p{margin:0 0 12px;color:var(--soft)}
ul{margin:0 0 12px;padding-left:22px;color:var(--soft)}
li{margin:0 0 8px}
b{color:var(--text)}
footer{border-top:1px solid var(--line);margin-top:30px;padding:26px 0 44px;color:var(--muted);font-size:14px}
footer .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--text)}
@media(max-width:600px){h1{margin-top:30px}}
</style></head><body>
<header><div class="wrap">
  <svg width="26" height="29" viewBox="0 0 200 224" aria-hidden="true">${MARK}</svg>
  <b>${esc(w.brand.replace(/\s+vpn$/i, '').slice(0, -1).toUpperCase())}<em>${esc(w.brand.replace(/\s+vpn$/i, '').slice(-1).toUpperCase())}</em></b>
  <a class="back" href="/">← Nazad na sajt</a>
</div></header>
<main class="wrap">
  <h1>${esc(title)}</h1>
  <p class="upd">Važi od ${esc(upd)}</p>
  <div class="intro">${intro}</div>
  ${body}
</main>
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(w.brand)}</span>
  <span><a href="/privatnost">Privatnost</a> · <a href="/uslovi">Uslovi korištenja</a> · <a href="/">Početna</a></span>
</div></footer></body></html>`;
}

function operator(w) {
  const bits = [`Uslugu <b>${esc(w.brand)}</b> pruža ${w.named ? `<b>${esc(w.name)}</b>` : 'privatno lice koje je vlasnik ove usluge'}${w.address ? `, ${esc(w.address)}` : ''}, iz države: ${esc(w.country)}.`];
  if (w.email) bits.push(`Kontakt za sva pitanja o podacima: <b>${esc(w.email)}</b>${w.support ? `, a za tehničku podršku: ${esc(w.support)}` : ''}.`);
  else bits.push('Kontakt za pitanja o podacima upiši u panelu (Postavke → Pravno).');
  return bits.join(' ');
}

function privacy(w) {
  return page('Politika privatnosti', `
    <p><b>Ukratko:</b> ne bilježimo koje stranice otvaraš, šta pretražuješ niti s kim komuniciraš. Takvih zapisa kod nas nema, pa ih ne možemo ni dati nikome.</p>
    <p>Čuvamo samo ono bez čega nalog ne može raditi: tvoje korisničko ime, koliko si prometa potrošio i kad si se zadnji put spojio.</p>`, [
    ['Ko obrađuje tvoje podatke', operator(w)],

    ['Šta čuvamo',
      'Kad kupiš ili dobiješ nalog, čuvamo:',
      ['<b>Nalog:</b> korisničko ime, plan, datum isteka, dozvoljen broj uređaja i ključeve potrebne za šifrovanje veze.',
        '<b>E-mail adresu</b>, ako si je dao pri kupovini, da bismo ti poslali pristupni link i podsjetnik pred istek.',
        '<b>Kontakt</b> (npr. Telegram ili broj), samo ako si ga ti ili tvoj prodavac upisao.',
        '<b>Potrošeni promet</b> u gigabajtima, ukupno, bez ikakvog podatka o tome na šta je potrošen.',
        '<b>Vrijeme zadnjeg spajanja</b> i server na koji si se spojio.',
        '<b>Koju aplikaciju koristiš</b> (Android, Windows ili iPhone) i njenu verziju, da znamo kome treba nadogradnja.',
        '<b>Uplate:</b> iznos, način plaćanja i broj transakcije. Broj kartice nikad ne dolazi do nas, njega vidi samo PayPal ili Stripe.'],
      'Ovo su podaci bez kojih usluga ne može postojati: bez njih ne znamo da li ti je pretplata istekla ni da li smiješ koristiti server.'],

    ['Šta ne čuvamo',
      'Ovo kod nas ne postoji ni u jednom zapisu:',
      ['historiju stranica koje posjećuješ,',
        'DNS upite, adrese i imena servera na koje se spajaš,',
        'sadržaj tvoje komunikacije, poruka ili fajlova,',
        'tvoju kućnu IP adresu uz tvoj nalog.'],
      'Zapisivanje pristupa je u VPN programu na serveru isključeno. Na stranici "Uživo" u panelu vidimo samo približnu tačku na mapi, zaokruženu na stotinjak kilometara i izračunatu u memoriji, koja se nigdje ne upisuje i nestane čim se server javi sljedeći put.'],

    ['Besplatni probni nalozi',
      'Ako uzmeš besplatan probni nalog iz aplikacije, čuvamo <b>oznaku uređaja i IP adresu</b> s koje je zatražen. To je jedini slučaj kad čuvamo IP adresu i služi samo da jedna osoba ne uzme stotinu besplatnih naloga. Ti podaci se ne koriste ni za šta drugo i brišu se zajedno s nalogom.'],

    ['Dijagnostika',
      'U aplikaciji postoji dugme "Pošalji podršci". Izvještaj se šalje <b>samo kad ga ti sam pošalješ</b>. U njemu su podaci o vezi: koji server, koji protokol, ime mreže na koju si spojen, verzija aplikacije i poruka o grešci. Taj izvještaj ne sadrži tvoje stranice ni sadržaj prometa.'],

    ['Telegram',
      'Ako u botu klikneš da povežeš nalog, čuvamo tvoj <b>Telegram broj razgovora</b>, da bismo ti mogli javiti kad ti pretplata ističe. U svakom trenutku pošalješ <b>/stop</b> i taj podatak brišemo.'],

    ['Posjeta ovom sajtu',
      'Na vrhu sajta pokazujemo da li si trenutno zaštićen. Za to se tvoja IP adresa jednokratno pošalje servisu <b>ip-api.com</b>, da se iz nje dobije država i ime provajdera. <b>Mi tu adresu nigdje ne upisujemo</b>, samo ti je prikažemo na ekranu. Ako to ne želiš, otvori sajt u privatnom prozoru ili sa uključenim VPN-om.',
      'Sajt ne koristi kolačiće za praćenje niti alate za analitiku. U pregledniku pamtimo jedino izabrani jezik.'],

    ['Kome se podaci prosljeđuju',
      'Ne prodajemo podatke nikome. Dijelimo ih samo sa firmama bez kojih usluga ne radi, i to samo koliko im je nužno:',
      ['<b>PayPal</b> i <b>Stripe</b> — naplata. Oni obrađuju tvoje podatke o plaćanju po svojim pravilima.',
        '<b>Brevo</b> — slanje e-maila, dobije tvoju e-mail adresu i sadržaj poruke.',
        '<b>Telegram</b> — ako koristiš našeg bota.',
        '<b>Hosteri servera</b> (npr. Hetzner i Vultr) — oni drže mašine na kojima usluga radi.',
        '<b>ip-api.com</b> — samo za prikaz statusa na sajtu, kako je gore objašnjeno.'],
      'Ako nam stigne zahtjev od nadležnog organa, možemo dati samo ono što stvarno imamo, a to su podaci o nalogu i uplatama. Historiju tvog prometa ne možemo dati jer ne postoji.'],

    ['Koliko dugo čuvamo',
      ['Podatke o nalogu čuvamo dok nalog postoji i do 12 mjeseci poslije isteka, da bi se mogao vratiti ako se predomisliš.',
        'Podatke o uplatama i fakture čuvamo onoliko koliko traže propisi o računovodstvu, obično do 10 godina.',
        'Zapise o probnim nalozima čuvamo najviše 12 mjeseci.',
        'Sigurnosne kopije baze se same brišu u krug, obično u roku od mjesec dana.']],

    ['Tvoja prava',
      'Imaš pravo da tražiš: <b>uvid</b> u svoje podatke, <b>ispravku</b> netačnih, <b>brisanje</b> naloga i podataka, te <b>izvoz</b> svojih podataka u čitljivom obliku.',
      w.email ? `Pošalji zahtjev na <b>${esc(w.email)}</b> sa naloga ili e-maila koji je vezan za pretplatu. Odgovaramo najkasnije u roku od 30 dana. Brisanje naloga znači i prestanak usluge, bez povrata za neiskorišteni period, osim ako zakon kaže drugačije.` : 'Zahtjev pošalji na kontakt naveden na sajtu.'],

    ['Sigurnost',
      'Šifre se čuvaju samo kao kriptografski otisak (scrypt), ne kao tekst. Pristup panelu ide preko tajne adrese, uz dvofaktorsku prijavu i ograničenje pogrešnih pokušaja. Sav saobraćaj prema sajtu i panelu ide preko HTTPS-a.',
      'Nijedan sistem nije potpuno siguran. Ako ikad dođe do propusta koji ugrožava tvoje podatke, obavijestićemo te bez odlaganja.'],

    ['Djeca',
      'Usluga nije namijenjena osobama mlađim od 16 godina i svjesno ne pravimo naloge za njih.'],

    ['Izmjene',
      'Ako ovu politiku promijenimo, nova verzija ide na ovu stranicu sa novim datumom. Ako promjena bude značajna, javićemo ti e-mailom ili porukom u aplikaciji.'],
  ], w);
}

function terms(w) {
  const s = settings.load();
  return page('Uslovi korištenja', `
    <p>Ovo su pravila korištenja usluge <b>${esc(w.brand)}</b>. Kupovinom ili korištenjem naloga potvrđuješ da ih prihvataš.</p>
    <p>Pisani su jednostavno namjerno. Ako ti nešto nije jasno, pitaj prije nego platiš.</p>`, [
    ['Ko pruža uslugu', operator(w)],

    ['Šta dobijaš',
      'Dobijaš pristup VPN serverima: tvoj internet promet ide šifrovano preko našeg servera, pa stranice koje otvaraš vide IP adresu tog servera umjesto tvoje.',
      'Broj uređaja koji mogu biti spojeni istovremeno i količina prometa pišu uz plan koji si kupio. Sve lokacije i sve funkcije su dostupne u svakom plaćenom planu.'],

    ['Nalog je tvoj',
      'Pristupni link i QR kod su kao ključ od stana. Ko ih ima, može koristiti tvoj nalog.',
      'Nemoj ih dijeliti ni objavljivati. Ako primijetimo da jedan nalog koristi mnogo više uređaja nego što plan dozvoljava, možemo ga privremeno ograničiti. Ako ti link procuri, javi se i odmah dobiješ novi.'],

    ['Šta nije dozvoljeno',
      'VPN služi za privatnost, ne za zaklon. Preko naše usluge nije dozvoljeno:',
      ['slanje spama ili bilo kakvih masovnih neželjenih poruka,',
        'napadi na tuđe sisteme, skeniranje tuđih mreža, probijanje lozinki i širenje virusa,',
        'bilo kakav sadržaj koji uključuje zlostavljanje djece,',
        'prijetnje, uznemiravanje i prevare,',
        'sve što je zabranjeno zakonom države u kojoj se nalaziš ili u kojoj je server.'],
      'Ovakav nalog gasimo odmah i bez povrata novca. Ako dobijemo prijavu zloupotrebe od hostera ili nadležnog organa, dužni smo postupiti po njoj.'],

    ['Plaćanje i trajanje',
      `Plaćaš unaprijed, PayPalom ili karticom. Nalog počinje da važi odmah po uplati i traje onoliko dana koliko piše uz plan. Cijene su u valuti prikazanoj na sajtu${s.vat && Number(s.vat) ? `, sa uračunatim PDV-om od ${esc(String(s.vat))}%` : ''}.`,
      '<b>Nema automatskog obnavljanja.</b> Kad plan istekne, ništa se samo ne naplaćuje. Produžavaš kad i ako hoćeš, u aplikaciji, na stranici svog naloga ili u Telegram botu.'],

    ['Povrat novca',
      `Ako usluga ne radi kod tebe, prvo nam se javi, jer se većina problema riješi za par minuta. Ako je ne uspijemo osposobiti, vraćamo ti novac u roku od <b>${w.refund} dana</b> od uplate.`,
      'Povrat ne vraćamo ako si potrošio veći dio prometa iz plana, ako je nalog ugašen zbog kršenja ovih uslova, ili ako jednostavno nisi koristio uslugu a prošao je rok iz prethodnog stava.',
      'Besplatan probni nalog postoji baš zato da provjeriš radi li ti usluga prije nego platiš.'],

    ['Dostupnost',
      'Trudimo se da serveri rade bez prekida, ali ne obećavamo da će raditi stalno i bez greške. Serveri se ponekad gase radi održavanja, a dešava se i da neka mreža ili država blokira pristup, na šta ne možemo uticati.',
      'Ako jedna lokacija ne radi, u aplikaciji izabereš drugu. Zato i držimo servere u više država.'],

    ['Brzina',
      'Brzina zavisi od tvog interneta, udaljenosti do servera i opterećenja mreže, pa je ne možemo garantovati. VPN uvijek dodaje jedan korak na putu, što se vidi kao mala razlika u brzini.'],

    ['Prekid',
      'Nalog možeš prestati koristiti kad god hoćeš. Mi nalog možemo ugasiti ako prekršiš ova pravila ili ako ne platiš.',
      'Ako bismo ikad gasili cijelu uslugu, javili bismo unaprijed i vratili novac za plaćeni period koji nisi iskoristio.'],

    ['Odgovornost',
      'Uslugu koristiš na svoju odgovornost. Ne odgovaramo za izgubljenu zaradu, izgubljene podatke ni za posljedice toga što usluga nije bila dostupna.',
      'U svakom slučaju, naša ukupna odgovornost ne može biti veća od iznosa koji si nam platio u zadnjih 12 mjeseci. Ovo ne ograničava prava koja ti po zakonu pripadaju kao potrošaču.'],

    ['Preprodavači',
      'Ako si otvorio reseller nalog, važe i dodatna pravila: kredit se kupuje unaprijed i ne vraća se u novcu, cijenu svojim kupcima određuješ sam, a za njihovu podršku i njihovo ponašanje odgovaraš ti.',
      'Ako tvoji kupci masovno krše ova pravila, možemo ugasiti tvoj reseller nalog.'],

    ['Izmjene uslova',
      'Uslove možemo mijenjati. Nova verzija ide na ovu stranicu sa novim datumom i važi od objave. Za već plaćen period važe uslovi koji su bili na snazi kad si platio.'],

    ['Mjerodavno pravo',
      `Na ove uslove primjenjuje se pravo države: ${esc(w.country)}. Prvo pokušavamo sve riješiti dogovorom, jer je tako brže i jeftinije za oboje.`],
  ], w);
}

/** GET /privatnost i /uslovi (i engleski nazivi /privacy, /terms). */
function handle(req, res, p) {
  const w = who();
  const html = /privac|privatnost/.test(p) ? privacy(w) : terms(w);
  return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
}

module.exports = { handle };
