# VPN Nexus panel

Admin panel za VPN biznis: korisnici, reselleri sa kreditom, serveri sa mapom uživo, finansije, fakture, Telegram obavijesti, backup i API.

- **Panel:** Node.js 22 i SQLite. Nema npm paketa, nema baze koju treba posebno instalirati.
- **VPN serveri:** VLESS + Reality (Xray) i WireGuard.
- **Agent:** na svakom serveru radi mali agent koji se sam javlja panelu, pa na serveru ne treba otvarati poseban port za panel.

```
install-panel.sh   instalacija panela na Ubuntu
panel/             panel (server.js, lib/, public/)
agent/agent.py     agent koji panel sam instalira na VPN servere
```

---

## 1. Šta ti treba

| Šta | Preporuka |
|---|---|
| Server za panel | Mali VPS sa 1 vCPU, 1–2 GB RAM-a i Ubuntu 22.04 ili 24.04 (Hetzner CX22 ili sličan). Panel može biti i na jednom od VPN servera, ali je odvojeno sigurnije. |
| Domena | npr. `panel.tvojadomena.com` sa A zapisom na IP servera panela. Bez domene radi i preko IP-a, ali bez HTTPS-a. |
| VPN serveri | VPS sa Ubuntu 22.04 ili 24.04, bar 1 GB RAM-a i dobrim protokom (Hetzner, OVH, Contabo, Vultr…). |

## 2. Instalacija panela

Na server panela prebaci zip, pa kao root:

```bash
apt install -y unzip
unzip vpn-panel.zip && cd vpn-panel
sudo bash install-panel.sh panel.tvojadomena.com
```

Skripta instalira Node 22, panel kao servis `vpn-panel` i Caddy, koji sam dobije HTTPS certifikat. Na kraju ispiše podatke za prvu prijavu:

```
Panel: https://panel.tvojadomena.com/a1b2c3d4e5/
Korisnik: admin
Šifra: ...
```

**Tajna putanja** (`/a1b2c3d4e5/`) je dio zaštite: na bilo kojoj drugoj adresi panel vraća grešku "nema stranice". Sačuvaj je. Možeš je promijeniti u Postavke → Sigurnost.

Odmah nakon prve prijave:

1. Moj profil: promijeni šifru i uključi 2FA (Google Authenticator).
2. Obriši `/var/lib/vpn-panel/prva-prijava.txt`.
3. Postavke → Općenito: provjeri adresu panela, ime brenda i valutu.

**Ažuriranje:** raspakuj novu verziju i ponovo pokreni `install-panel.sh` sa istom domenom. Baza i backupi ostaju.

## 3. Dodavanje VPN servera

1. Zakupi VPS sa Ubuntu.
2. U panelu otvori Serveri → **Dodaj server**, upiši ime (npr. `DE Frankfurt 1`) i koliko ljudi najviše može biti spojeno.
3. Panel prikaže jednu komandu. Uđi na VPS preko SSH-a kao root i zalijepi je:
   ```bash
   curl -fsSL https://panel.tvojadomena.com/install/TOKEN | sudo bash
   ```
4. Za 1–2 minute server postane **Online** (zelena tačka na mapi). Lokaciju za mapu panel sam odredi iz IP adrese.

Komanda instalira Xray i WireGuard, uključi BBR i prosljeđivanje paketa, otvori portove (443/tcp i 51820/udp) ako je ufw uključen i pokrene agenta (`vpn-agent`).

Kad promijeniš korisnike, planove ili postavke, svi serveri za 15 sekundi sami preuzmu novu konfiguraciju. Na servere ne moraš ulaziti.

**Dugmad na kartici servera:**
- **Održavanje:** kupci privremeno ne dobijaju taj server u pretplati.
- **Ugasi:** server je isključen iz panela.
- **Odredi lokaciju:** ponovo traži lokaciju iz IP adrese.

**Ako server ostane "Čeka instalaciju"**, pogledaj log agenta na tom serveru:

```bash
journalctl -u vpn-agent -n 50
```

Najčešći razlog je pogrešna adresa panela u Postavke → Općenito.

## 4. Korisnici i kupci

Svaki korisnik dobije **pretplatni link** (`https://…/s/xxxx`). Kupcu pošalješ link ili QR kod.

- U aplikaciji (Hiddify, v2rayNG, Streisand, V2Box, Happ…) link uveze sve servere. Aplikacija ga sama osvježava, pa kupac vidi nove servere bez ikakve akcije.
- U pretraživaču link otvara stranicu kupca: QR kod, dugmad za aplikacije, preostali dani i promet, te WireGuard konfiguracije.

| Status | Značenje |
|---|---|
| Aktivan | Radi. |
| Ističe uskoro | Ostalo je manje dana nego što piše u postavkama. |
| Grace period | Istekao je, ali još radi nekoliko dana. |
| Istekao | Ne radi. Produženje ga vraća. |
| Potrošen promet | Ne radi dok ga ne produžiš ili ne resetuješ promet. |
| Ugašen | Ručno isključen. |

**Novi ključ** pravi nove ključeve i novi link, pa stari link prestaje raditi. Koristi ga kad neko podijeli svoj link.

## 5. Reselleri

Reselleri imaju **svoj poseban panel**, na adresi `https://panel.tvojadomena.com/reseller/`. Tvoju tajnu admin adresu nikad ne vide. Na admin adresi se reseller ne može prijaviti, a ni admin na adresi za resellere.

1. Otvori Reselleri → **Novi reseller** i upiši korisničko ime, šifru, nivo (popust) i limit korisnika.
2. Panel prikaže gotovu poruku s adresom, imenom i šifrom. Klikni **Kopiraj poruku** i pošalji je reselleru, npr. na Telegram.
3. Kad ti reseller pošalje novac, otvori ga i klikni **Dodaj kredit**. Uplata dobije broj fakture.
4. U svom panelu reseller vidi samo svoje stvari: korisnike, kredit, cijene i podatke za uplatu. Svaki novi korisnik ili produženje skida mu s kredita cijenu plana, umanjenu za popust njegovog nivoa.
5. **Uđi kao reseller** (u tvom panelu) ti pokaže tačno ono što on vidi.

U Postavke → Reselleri podešavaš:
- adresu panela za resellere (npr. `/partner`) ili da se poseban panel isključi;
- koliko probnih naloga reseller smije napraviti dnevno;
- smije li brisati korisnike;
- vraća li mu se kredit za brisanje u prva 24 h;
- minimalnu uplatu.

## 6. Telegram obavijesti

1. U Telegramu otvori @BotFather, pošalji `/newbot` i kopiraj token.
2. Pošalji botu bilo koju poruku. Zatim otvori `https://api.telegram.org/botTOKEN/getUpdates` i nađi `"chat":{"id":...}`.
3. Upiši token i chat ID u Postavke → Obavještenja i klikni **Pošalji probnu poruku**.

Uključi koje obavijesti želiš: server pao ili se vratio, server skoro pun, nove uplate, reseller ima malo kredita, dnevni izvještaj u 9:00 i backup.

## 7. Backup

Postavke → Backup: automatski backup (svaki dan, svakih 6 sati ili sedmično).

- Backupi se čuvaju u `/var/lib/vpn-panel/backups`.
- Ako je uključeno, svaki backup stiže i na Telegram.
- **Vrati iz backupa** zamijeni bazu i restartuje panel. Stara baza se čuva sa strane.

Za selidbu na novi server:

1. Instaliraj panel na novi server.
2. Vrati backup.
3. Promijeni DNS domene na novi server.

Serveri se sami prebace, jer se javljaju na domenu.

## 8. API (za prodajnog bota ili sajt)

Uključi API u Postavke → API i napravi ključ. Ključ ide u zaglavlje:

```
Authorization: Bearer vnx_...
```

| Metoda | Putanja | Opis |
|---|---|---|
| GET | `/api/v1/plans` | Aktivni planovi |
| POST | `/api/v1/users` | Novi korisnik. Tijelo: `{"username":"marko","plan_id":3,"paid":5,"method":"Stripe","contact":"@marko"}` |
| GET | `/api/v1/users/:username` | Stanje korisnika i `sub_link` |
| POST | `/api/v1/users/:username/extend` | Produži. Tijelo: `{"plan_id":3,"paid":5}` |
| POST | `/api/v1/users/:username/disable` | Ugasi |
| POST | `/api/v1/users/:username/enable` | Upali |

Primjer:

```bash
curl -H "Authorization: Bearer vnx_..." -H "content-type: application/json" \
  -d '{"username":"marko","plan_id":3,"paid":5}' https://panel.tvojadomena.com/api/v1/users
```

Odgovor sadrži `sub_link`, koji bot pošalje kupcu.

**Webhook:** ako u Postavke → API upišeš adresu, panel na nju šalje POST kad se napravi korisnik ili dodaje kredit.

## 9. Sigurnost

- Tajna putanja panela, 2FA (može biti obavezna za sve admine) i zaključavanje nakon pogrešnih pokušaja prijave.
- Pristup panelu možeš ograničiti samo na svoje IP adrese.
- Uloge admina:
  - **Admin:** sve osim vlasničkih postavki.
  - **Podrška:** korisnici, bez novca.
  - **Finansije:** samo novac.
- Šifre su hashirane (scrypt). API ključevi se čuvaju samo kao hash.
- **Bez logova:** Xray access log je isključen. Panel bilježi samo državu iz koje se korisnici spajaju, ne IP adrese.

## 10. Korisne komande

```bash
systemctl status vpn-panel          # stanje panela
journalctl -u vpn-panel -f          # log panela uživo
systemctl restart vpn-panel
cat /var/lib/vpn-panel/prva-prijava.txt

# na VPN serveru
systemctl status vpn-agent xray wg-quick@wg0
journalctl -u vpn-agent -n 50
```

**Zaboravio si šifru ili izgubio 2FA?** Na serveru panela:

```bash
sudo -u vpnpanel VPN_DATA_DIR=/var/lib/vpn-panel node /opt/vpn-panel/panel/reset-password.js NovaSifra123
```

Ispiše adresu panela, a 2FA i IP ograničenje isključi.

## 11. Kupci: Telegram bot, e-mail i podsjetnici

**Telegram bot za kupce:**
1. Kod @BotFather napravi poseban bot, ne onaj za tvoje obavijesti.
2. Token upiši u Postavke → Obavještenja → Token bota za kupce i uključi bota.
3. Na stranici kupca pojavi se dugme **Poveži Telegram**.

Povezani kupci dobijaju podsjetnike pred istek i tvoje poruke, a sami mogu pitati `/status`.

**E-mail:** upiši SMTP podatke u Postavke → Obavještenja (npr. Brevo, Gmail ili Zoho) i klikni **Probni e-mail**. Kad je e-mail podešen:
- "Pošalji kupcu" može poslati pristup direktno na mail;
- reselleri dobijaju fakture na mail;
- podsjetnici idu i na e-mail.

**Podsjetnici** se šalju kad je ostalo onoliko dana koliko piše kod "Ističe uskoro", i još jednom dan prije isteka.

**Poruka svima** (dugme u Korisnicima) ide na Telegram i e-mail. Možeš je prikazati i u aplikaciji kupca.

## 12. Protokoli, blokade i uređaji

- **VLESS + Reality** je glavni protokol. **Shadowsocks 2022** i **WireGuard** su rezerve, a pališ ih u Postavke → Serveri. Shadowsocks koristi port 8388, koji možeš promijeniti kod servera.
- **Blokade** rade preko DNS-a na samom serveru:
  - reklame: AdGuard DNS;
  - stranice za odrasle: AdGuard Family DNS;
  - malver i phishing: Quad9 DNS;
  - torrent se blokira posebno.
- **Limit uređaja:**
  - Server broji različite IP adrese po korisniku u zadnje 3 minute. Broji samo u memoriji i ništa ne sprema na disk.
  - Možeš birati: samo prikaz, ili blokada na 15 minuta kad je uređaja previše.
  - Više uređaja iza istog WiFi-ja ima jednu IP adresu i broji se kao jedan uređaj.
- **Pametna pretplata:** kupci ne dobijaju servere koji ne rade ili su puni, pa se aplikacija sama prebaci na drugi.
- **Xray** na serverima se sam ažurira jednom sedmično, noću.

## 13. Reselleri: registracija, nivoi, white-label, kartica

- **Registracija:** uključi je u Postavke → Reselleri. Na adresi za resellere tada se pojavi "Postani reseller", a ti svaki novi nalog odobravaš u listi resellera.
- **Automatski nivo:** svakog 1. u mjesecu reseller pređe na viši nivo ako je prošli mjesec kupio dovoljno kredita (preporučena kupovina kod nivoa).
- **White-label:** kupci resellera vide njegov brend i kontakt, i u aplikaciji i na svojoj stranici.
- **Produži sam:** kod korisnika resellera se može uključiti automatsko produženje sa kredita, dan prije isteka.
- **Stripe:** upiši ključeve u Postavke → Plaćanja. U Stripeu dodaj webhook na adresu koju ti panel pokaže, s događajem `checkout.session.completed`. Reseller tada u Kredit i uplate plaća karticom, a kredit se doda sam.

## 14. Backup na S3 i ažuriranje panela

- **S3:** upiši endpoint, regiju, bucket i ključeve u Postavke → Backup (Backblaze B2, Cloudflare R2, Wasabi ili AWS) i klikni **Probaj S3**. Svaki backup ode i tamo.
- **Ažuriranje:** u Postavke → Sistem vidiš svoju i najnoviju verziju. Ažuriraš klikom na **Ažuriraj**, a dugme proradi nakon prvog ručnog ažuriranja na verziju 1.2.0. Log ažuriranja je u `/var/log/vpn-panel-update.log`.

## 15. Veltrix aplikacija (Android i Windows)

Izvorni kod i instalacije su u repozitoriju `maid-cyber/veltrix-app` (Releases). Aplikacija čita nalog sa `/s/TOKEN/app`.

- **Aplikacija (meni):** uključi ili isključi šta kupci imaju u aplikaciji, uz pregled telefona: Probaj besplatno, Produži karticom, Pozovi prijatelja, uređaji, povijest, podrška, izbor protokola, automatski Shadowsocks, Double VPN, Kill Switch, DNS, split tunneling, IP leak, WebRTC, test brzine, dijagnostika, obavijesti, boja, jezik i nove verzije. Promjena stiže kad kupac otvori aplikaciju.
- **Obavezno ažuriranje:** u Aplikacija → Verzije upiši najstariji dozvoljeni build (Android ili Windows). Starije verzije prikažu samo dugme za ažuriranje i ne spajaju se. Stranica pokazuje koliko kupaca koristi koju verziju.
- Aplikacija prije prijave čita `GET /app/config` (probni nalog, kod prijatelja, jezik, obavezno ažuriranje).
- **Oznake servera** (Serveri → Uredi): P2P, Streaming, Gaming, Statička IP, Dedicated IP, Zaštita od blokada, Specijalni. U aplikaciji su to kategorije u Lokacijama (prikaže se samo kategorija koja ima bar jedan server). Na P2P serverima torrent radi i kad je blokada uključena.
- **Dedicated IP:** označi server kao Dedicated IP i upiši korisnička imena kupaca. Taj server (i njegovu IP adresu) vide i koriste samo oni; ostali kupci ga ne vide ni u aplikaciji ni u linkovima, a server ih ni ne pušta. Ne prikazuje se ni na javnom sajtu. Najjeftinije: mali poseban server (npr. Hetzner CX22) po kupcu, koji prodaješ kao dodatak.
- **Double VPN i Multihop** (Serveri → Novi lanac): 2 do 4 servera redom. Port lanca mora biti otvoren na svim serverima osim zadnjeg (agent ga otvori u ufw-u; Hetzner Cloud Firewall otvori ručno).

## 16. Probni nalog, plaćanje karticom i preporuke

- **Probni nalog iz aplikacije:** Postavke → Veltrix aplikacija → "Probni nalog iz aplikacije". Koristi prvi aktivni plan označen kao probni. Jedan po uređaju, jedan po IP adresi sedmično i dnevni limit.
- **Kupac sam produžava karticom:** treba uključen Stripe (Postavke → Plaćanja) i planovi sa cijenom. Dugme "Produži" se pojavi u aplikaciji i na stranici kupca. Uplata se vidi u Transakcijama, a nalog se produži sam. Samo za tvoje kupce, ne za kupce resellera.
- **Pozovi prijatelja:** svaki kupac ima kod. Prijatelj ga upiše kod "Probaj besplatno"; kad prvi put plati, obojica dobiju gratis dane (Postavke → Veltrix aplikacija).
- **Telegram:** ako Xray na serveru ne radi duže od 3 javljanja, stiže upozorenje, i ponovo kad proradi.

## 17. Web sajt

Na glavnoj adresi servera (npr. `http://IP/`) je javni sajt: funkcije, lokacije uživo, cijene iz Planova, preuzimanje aplikacija i pitanja, na bosanskom i engleskom. Tajna adresa panela se nigdje ne vidi.

- **Kupovina:** kad je Stripe uključen, kupac izabere plan, upiše e-mail i plati karticom. Nalog se napravi sam, kupac odmah vidi link i QR kod, a link dobije i na e-mail (ako je SMTP podešen).
- Bez Stripea dugme "Kupi" vodi na tvoj kontakt podrške.
- Isključuje se u Postavke → Web sajt.

## 18. Mapa spajanja uživo i vlastiti brend za resellere

**Mapa uživo (Dashboard → Mapa servera):** crvene linije idu od približne lokacije spojenih kupaca do servera na koji su spojeni. Lokacija je zaokružena na oko 100 km, drži se samo u memoriji i ništa se ne sprema. Radi odmah, osim ako je provjera uređaja postavljena na "Ne provjeravaj", jer tada serveri ne javljaju adrese spojenih kupaca.

**Vlastiti brend (white-label):** uključi u Postavke → Reselleri → "Vlastiti brend za resellere". Reseller tada u meniju **Moj brend** upiše ime, kontakt, boju, poruku dobrodošlice i učita logo, uz pregled uživo. Njegovi kupci na svojoj stranici, u aplikacijama (ime profila) i u podsjetnicima vide njegov brend. Može sakriti i Veltrix aplikaciju, pa kupci vide samo Hiddify i druge. Admin može ukloniti neprikladan logo u Reselleri → Uredi.

## 19. Detalji servera, komande i kupci online

**Serveri → Detalji** (ili klik na ime servera): dostupnost za 30 dana, grafikoni CPU, RAM, spojeni kupci i promet (24 sata ili 7 dana), lista kupaca spojenih sada i historija padova. Podaci se čuvaju 8 dana (po 5 minuta), historija padova 90 dana.

Dugmad **Restartuj VPN**, **Test brzine**, **Ažuriraj agent** i **Restartuj server** šalju komandu agentu; agent je preuzme pri sljedećem javljanju (par sekundi) i rezultat se pojavi na istoj stranici. Treba agent 1.4.0 (ažurira se sam kad ažuriraš panel).

**Korisnici → Online sada**: kupci koji su imali promet u zadnje 2 minute, sa zelenom tačkom i serverom na koji su spojeni. **Novi link** u detaljima kupca pravi novi link i nove ključeve (stari odmah prestaju raditi) i odmah pokaže QR i dugme "Pošalji kupcu".

## 20. Server u jedan klik: Hetzner, DigitalOcean, Vultr, OVH, Contabo

Upiši ključ hostera u **Postavke → Hosteri** (samo za hostere koje koristiš). Ključevi se čuvaju samo u panelu i nikad se ne prikazuju cijeli. Ako je ključ negdje procurio, obriši ga kod hostera i napravi novi.

| Hoster | Gdje se pravi ključ | Naplata | Nova IP adresa |
|---|---|---|---|
| Hetzner | Cloud Console → projekat → Security → API Tokens (Read & Write) | po satu | ista mašina, nova IPv4 (1–2 min) |
| DigitalOcean | API → Tokens → Generate New Token (Read & Write) | po satu | novi server, stari se briše (3–5 min) |
| Vultr | Account → API → Enable API, dozvoli IP panela u Access Control | po satu | novi server, stari se briše (3–5 min) |
| OVHcloud | eu.api.ovh.com/createToken (GET, POST, DELETE na /cloud/*) + ID Public Cloud projekta | po satu (Public Cloud) | novi server, stari se briše |
| Contabo | my.contabo.com → API (Client ID, Secret, API User, API Password) | **mjesečni ugovor** | ne (napravi novi, obriši stari) |

**Serveri → Dodaj server** → izaberi hostera → lokacija i veličina → **Zakupi i instaliraj**. Panel zakupi server (Ubuntu 24.04), instalira VPN preko cloud-init i doda ga; za par minuta je online. Kod brisanja biraš **Samo iz panela** ili **Obriši i kod hostera** (naplata prestaje; kod Contaba se otkazuje ugovor).

OVH klasični "VPS" se ne može naručiti preko API-ja (ide kroz korpu i plaćanje), zato panel koristi OVH Public Cloud. Panel mora imati javnu adresu (Postavke → Općenito → Adresa panela).

## 21. Uživo, Analitika, Kuponi i Korpa

- **Pregled → Uživo**: velika mapa sa spajanjima, stanje svih servera i tok događaja (prodaje, padovi, prijave) koji se sam osvježava. Gore su kupci online, aktivne veze, prodaja, novi kupci i promet danas.
- **Pregled → Analitika** (30 dana, 90 dana, godina): aktivni kupci, procjena mjesečnog prihoda, prosjek po kupcu, odliv kupaca, vrijednost kupca, čista zarada, grafikoni rasta, planovi, ko prodaje (ti ili reselleri), kada kupci kupuju (dan × sat) i odakle su.
- **Prodaja → Kuponi i akcije**: kodovi za popust u % ili iznosu, sa gratis danima, rokom, brojem korištenja i ograničenjem na planove. Kupac ih upisuje na sajtu i kod produženja na svojoj stranici. Polje za kod se pojavi samo dok postoji aktivan kupon.
- **Korisnici → Korpa**: obrisani kupci (i oni koje panel sam obriše jer su dugo istekli) čuvaju se 30 dana i vraćaju jednim klikom sa istim linkom, ključem, danima i historijom.

## 22. Prvi koraci i uvoz kupaca iz drugih panela

- **Dashboard → Prvi koraci prije prodaje**: lista sa kvačicama (HTTPS, server online, planovi, način plaćanja, kontakt podrške, Telegram, probni nalog, 2FA, prvi kupac). Klik vodi na mjesto gdje se to podešava. Nestane kad je sve gotovo ili klikom na "Sakrij" (vraća se u Postavke → Općenito).
- **Korisnici → Uvoz**: kupci iz **3x-ui / x-ui** (x-ui.db), **Marzbana** (db.sqlite3), **Hiddify Managera** (backup .json) ili bilo kojeg panela preko **CSV-a** (`korisnik;uuid;ističe;GB;bilješka`). Prvo vidiš pregled, pa biraš plan, vlasnika (ti ili reseller) i da li uvoziš samo aktivne. Kupci zadržavaju UUID, datum isteka, limit i potrošen promet; postojeći (isto ime ili UUID) se preskaču. Novi link im pošalji preko "Poruka svima".

## Šta još nije gotovo

- **Smanjena brzina u grace periodu:** Xray ne zna ograničavati brzinu po korisniku.
- **Panel na engleskom:** još ne postoji.
- **iPhone aplikacija:** treba Apple Developer nalog. Do tada iPhone kupci koriste Hiddify ili Streisand.
