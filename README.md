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

## Šta još nije gotovo

- **Limit uređaja** se prikazuje i prodaje, ali ga serveri još ne provjeravaju.
- **Automatske poruke kupcima** pred istek su označene "uskoro". Za njih treba kupčev Telegram bot.
- **Blokiranje torrenta i sadržaja za odrasle** radi samo na VLESS-u. Na WireGuardu reklame blokira AdGuard DNS.
- **Mobilne i desktop aplikacije** dolaze kasnije. Do tada kupci koriste Hiddify, v2rayNG ili Streisand s pretplatnim linkom.
