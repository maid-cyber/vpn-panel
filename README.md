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

## 15. AdiLink aplikacija (Android i Windows)

Izvorni kod i instalacije su u repozitoriju `maid-cyber/veltrix-app` (Releases). Aplikacija čita nalog sa `/s/TOKEN/app`.

- **Aplikacija (meni):** uključi ili isključi šta kupci imaju u aplikaciji, uz pregled telefona: Probaj besplatno, Produži karticom, Pozovi prijatelja, uređaji, povijest, podrška, izbor protokola, automatski Shadowsocks, Double VPN, Kill Switch, DNS, split tunneling, IP leak, WebRTC, test brzine, dijagnostika, obavijesti, boja, jezik i nove verzije. Promjena stiže kad kupac otvori aplikaciju.
- **Obavezno ažuriranje:** u Aplikacija → Verzije upiši najstariji dozvoljeni build (Android ili Windows). Starije verzije prikažu samo dugme za ažuriranje i ne spajaju se. Stranica pokazuje koliko kupaca koristi koju verziju.
- Aplikacija prije prijave čita `GET /app/config` (probni nalog, kod prijatelja, jezik, obavezno ažuriranje).
- **Oznake servera** (Serveri → Uredi): P2P, Streaming, Gaming, Statička IP, Dedicated IP, Zaštita od blokada, Specijalni. U aplikaciji su to kategorije u Lokacijama (prikaže se samo kategorija koja ima bar jedan server). Na P2P serverima torrent radi i kad je blokada uključena.
- **Dedicated IP:** označi server kao Dedicated IP i upiši korisnička imena kupaca. Taj server (i njegovu IP adresu) vide i koriste samo oni; ostali kupci ga ne vide ni u aplikaciji ni u linkovima, a server ih ni ne pušta. Ne prikazuje se ni na javnom sajtu. Najjeftinije: mali poseban server (npr. Hetzner CX22) po kupcu, koji prodaješ kao dodatak.
- **Double VPN i Multihop** (Serveri → Novi lanac): 2 do 4 servera redom. Port lanca mora biti otvoren na svim serverima osim zadnjeg (agent ga otvori u ufw-u; Hetzner Cloud Firewall otvori ručno).

## 16. Probni nalog, plaćanje karticom i preporuke

- **Probni nalog iz aplikacije:** Postavke → AdiLink aplikacija → "Probni nalog iz aplikacije". Koristi prvi aktivni plan označen kao probni. Jedan po uređaju, jedan po IP adresi sedmično i dnevni limit.
- **Kupac sam produžava karticom:** treba uključen Stripe (Postavke → Plaćanja) i planovi sa cijenom. Dugme "Produži" se pojavi u aplikaciji i na stranici kupca. Uplata se vidi u Transakcijama, a nalog se produži sam. Samo za tvoje kupce, ne za kupce resellera.
- **Pozovi prijatelja:** svaki kupac ima kod. Prijatelj ga upiše kod "Probaj besplatno"; kad prvi put plati, obojica dobiju gratis dane (Postavke → AdiLink aplikacija).
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

## 23. Dijagnostika kupca

Meni **Aplikacija i podrška → Dijagnostika** (ili dugme "Dijagnostika: zašto ne radi?" kod kupca). Upiši kupca i panel provjeri:

- **Nalog:** aktivan, istekao, ugašen, potrošen promet, blokada zbog previše uređaja.
- **Servere kupca:** online, radi li Xray, je li kupac u konfiguraciji servera, je li server pun, i odgovara li port iz panela.
- **Aktivnost i aplikaciju:** kad je zadnji put imao promet, koju verziju aplikacije koristi.
- **Izvještaj iz aplikacije kupca:** kupac u aplikaciji klikne *Nalog → Dijagnostika veze → Pošalji podršci* (Windows: *Dijagnostika → Pošalji podršci*). Aplikacija provjeri internet, može li do svakog servera **sa svoje mreže**, prolazi li promet kroz VPN i pošalje greške iz loga. Panel ti javi na Telegram.

Na vrhu piše presuda: **Kod nas** (popravi server), **Nalog** (produži, upali) ili **Kod kupca** (njegov provajder, ruter, antivirus, stara aplikacija), i gotova poruka koju kopiraš kupcu.

## 24. Preuzimanje aplikacija i otvaranje jednim klikom

- **/download/android** i **/download/windows**: aplikacije se skidaju sa tvoje adrese, ne sa GitHuba. Panel sam skine zadnju verziju sa GitHub Releases (pri pokretanju i svakih sat vremena) i čuva je u `data/downloads`.
- E-mail i stranica kupca imaju dugme **Otvori u aplikaciji i spoji se**: na Androidu i Windowsu otvori AdiLink aplikaciju, uveze nalog i spoji se (ako aplikacija nije instalirana, Android ponudi preuzimanje). Na iPhoneu otvori Hiddify.
- U e-mailu je i **QR kod** (PNG, `/s/TOKEN/qr.png`) za skeniranje telefonom kad kupac čita e-mail na računaru.

## 25. Privatni GitHub repozitoriji

Ako su `vpn-panel` i `veltrix-app` **Private**, panel treba GitHub token da skine aplikacije i nove verzije panela:

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
2. Repository access: **Only select repositories** → `vpn-panel` i `veltrix-app`. Permissions → **Contents: Read-only**. Rok trajanja po želji (npr. 1 godina).
3. Token upiši samo u panel: **Postavke → Sistem → GitHub token**.

Aplikacije se same ažuriraju preko panela (`/app/config` i `/download/…`), pa kupcima GitHub ne treba. Ručna instalacija panela iz privatnog repozitorija: `git clone https://TOKEN@github.com/maid-cyber/vpn-panel.git` (ili zip).

## Šta još nije gotovo

- **Smanjena brzina u grace periodu:** Xray ne zna ograničavati brzinu po korisniku.
- **Panel na engleskom:** još ne postoji.
- **iPhone aplikacija:** treba Apple Developer nalog. Do tada iPhone kupci koriste Hiddify ili Streisand.

## 26. E-mailovi resellerima

Reselleri dobijaju e-mailove u istom tamnom AdiLink izgledu kao kupci:

- **Novi reseller**: link panela, korisničko ime, nivo, popust, kredit, cijene sa popustom i 3 koraka za početak. Šifra ide u e-mail samo ako u formi označiš "Upiši i šifru u e-mail".
- **Nalog odobren**: kad odobriš resellera koji se sam registrovao.
- **Faktura**: nakon svake dopune kredita (iznos, novo stanje, PDV ako je uključen).
- **Malo kredita**: kad kredit padne ispod €10.

Uključuješ i isključuješ u **Postavke → Obavještenja → E-mailovi resellerima**. Treba podešen SMTP (sekcija 22).

## 27. Prodaja preko Telegram bota (PayPal)

Kupac u botu klikne **Kupi VPN**, izabere plan, plati PayPalom (računom ili karticom preko PayPala) i odmah dobije nalog, link, QR kod i dugmad za aplikacije. Postojeći kupci u botu produžavaju nalog i vide stanje.

1. PayPal Business račun → developer.paypal.com → **Apps & Credentials** → **Live** → Create App → kopiraj **Client ID** i **Secret**.
2. Panel → Postavke → **Plaćanja**: uključi "PayPal: kupci plaćaju preko Telegram bota", način **Live**, zalijepi Client ID i Secret, Spremi, klikni **Provjeri PayPal**.
3. Postavke → **Obavještenja**: uključi "Telegram bot za kupce", upiši token bota (@BotFather) i "Bot za kupce prodaje VPN".
4. Postavke → Opšte → **Adresa panela** mora biti upisana (PayPal tamo vraća kupca).

Valuta mora biti EUR, USD ili CHF. Bot prodaje aktivne planove sa cijenom (bez probnih). Uplata se provjerava i svake minute, pa nalog stiže i ako kupac zatvori PayPal stranicu prije povratka. Kupci resellera ne mogu produžiti preko bota (javljaju se svom prodavcu).

## 28. Novo ime: AdiLink VPN, novi sajt i godišnje cijene (3.0.0)

- **Ime:** brend je sada **AdiLink VPN** (logo: štit sa slovom A). Panel pri prvom pokretanju sam promijeni ime brenda, ime profila i ime pošiljaoca e-maila ako je ostalo staro "Veltrix VPN". Interni nazivi (`veltrix://`, paket `com.veltrix.vpn`, repozitorij `veltrix-app`) ostaju isti, da postojeće aplikacije rade i nadograde se bez reinstalacije.
- **Sajt:** novi izgled u bojama aplikacije, koraci "Kako radi", prekidač **Mjesečno / Godišnje** sa cijenom po mjesecu i uštedom, plaćanje **PayPalom ili karticom preko PayPala** (i Stripe, ako je uključen), dugme za kupovinu preko Telegram bota.
- **Godišnji planovi:** pri prvom pokretanju 3.0.0 panel za svaki mjesečni plan napravi godišnji (365 dana, oko 40% jeftinije po mjesecu, npr. €5/mj → €35.99/god). Ako već imaš planove od 300+ dana, ne pravi ništa. Cijene mijenjaš u **Planovi**.
- **Produženje bez Stripea:** kad Stripe nije uključen, kupac na svojoj stranici i u aplikaciji produžava preko PayPala.

## 29. Novi sajt (3.1.0)

Sajt je prerađen i sad ima:

- **Traku statusa na vrhu**: posjetiocu pokaže njegovu pravu IP adresu, državu i provajdera dok nije spojen, a zeleno "Zaštićen si" kad jeste. Radi preko `/me.json`; IP se nigdje ne sprema.
- **Sekciju Zaštita**: ispisuje samo one protokole koje si stvarno uključio (Postavke → Protokoli), plus blokadu reklama i malvera ako su uključene.
- **Za šta ti treba**: javni WiFi, streaming, igrice, rad od kuće.
- **Sekciju za preprodavače**: vidi se kad u Postavke → Reselleri uključiš "Reselleri se mogu sami registrovati" (vodi na registraciju), inače vodi na tvoju podršku.
- **Podnožje** sa kolonama i linkovima na aplikacije, bota i reseller panel.
- Besplatan probni nalog se spominje kod cijena samo ako je u Postavke → Aplikacija uključen "Probaj besplatno" i postoji probni plan.

## 30. Serveri: lista i pretraga (3.1.1)

Kad imaš više servera, kartice postanu nepregledne. Zato stranica **Serveri** sada ima:

- **Prekidač prikaza** (gore desno, pored pretrage): kartice ili kompaktna lista. Izbor se pamti u pregledniku. Ako nemaš izabrano, panel sam uzme listu čim imaš više od 8 servera.
- **Pretragu** po imenu, gradu, državi, hosteru i IP adresi. Pojavi se kad imaš više od 5 servera.
- U listi jedan red pokazuje zastavu, ime, državu i hostera, IP adresu (klik kopira), status, spojeno/kapacitet, CPU i RAM, promet i dugmad.
