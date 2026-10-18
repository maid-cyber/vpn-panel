'use strict';
// E-mailovi resellerima: novi nalog (pristup), nalog odobren, dopuna kredita (faktura), malo kredita.
const { one, log } = require('./db');
const settings = require('./settings');
const mail = require('./mail');
const { layout, esc, base } = require('./mailtpl');

const CUR = { EUR: '€', USD: '$', BAM: 'KM ', CHF: 'CHF ' };
const money = (n) => `${CUR[settings.get('currency')] || '€'}${Number(n || 0).toFixed(2)}`;

function portalUrl(fallback = '') {
  const s = settings.load();
  const b = base(fallback);
  return b ? `${b}${s.res_portal !== false ? s.reseller_path || '/reseller' : s.admin_path}/` : '';
}

function levelOf(r) {
  return r.level_id ? one('SELECT name, discount FROM levels WHERE id = ?', r.level_id) : null;
}

function plansTable(r) {
  const lvl = levelOf(r);
  const plans = require('./db').all('SELECT name, days, price FROM plans WHERE active = 1 AND trial = 0 AND price > 0 ORDER BY sort, id LIMIT 6');
  if (!plans.length) return '';
  const disc = lvl?.discount || 0;
  return `<div style="margin:0 0 22px">${plans.map((p) => `<div style="padding:10px 0;border-top:1px solid #2a2a37;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px"><div class="gm-s"><div class="gm-d"><span style="color:#b9b9c6">${esc(p.name)}</span><span style="float:right;color:#f2f2f6;font-weight:700">${money(p.price * (1 - disc))}${disc ? ` <span style="color:#8e8e9c;font-weight:400;text-decoration:line-through">${money(p.price)}</span>` : ''}</span></div></div></div>`).join('')}</div>`;
}

function send(to, subject, html, text) {
  if (!to || !mail.configured() || settings.get('mail_resellers') === false) return Promise.resolve(false);
  return mail.sendMail({ to, subject, text, html }).then(() => true)
    .catch((e) => { log('sistem', 'E-mail reselleru nije poslan', `${to}: ${e.message || e}`, 'warn'); return false; });
}

/** Novi reseller: link panela, korisničko ime, (šifra ako je admin upisao), nivo, kredit, prvi koraci. */
function welcome(r, password, fallback) {
  const s = settings.load(), url = portalUrl(fallback), lvl = levelOf(r);
  const html = layout({
    badge: 'RESELLER PANEL',
    head: `Dobrodošao, ${r.username}! 👋`,
    intro: `Tvoj reseller nalog za <b>${esc(s.brand)}</b> je spreman. Od sada sam praviš VPN naloge za svoje kupce i zarađuješ na svakom.`,
    stats: [['Nivo', esc(lvl?.name || 'Osnovni')], ['Popust', `${Math.round((lvl?.discount || 0) * 100)}%`], ['Kredit', money(r.credit)]],
    rows: [['Korisničko ime', esc(r.username)], ...(password ? [['Šifra', `<span style="font-family:Consolas,monospace">${esc(password)}</span>`]] : []), ['Najviše kupaca', esc(r.user_limit || '—')]],
    cta: url ? { href: url, label: 'Otvori svoj panel' } : null,
    note: password ? '🔒 Odmah nakon prve prijave promijeni šifru (Moj profil) i ne šalji je nikome.' : '',
    stepsTitle: 'Kako početi',
    steps: [
      ['Dopuni kredit', `U panelu otvori <b style="color:#f2f2f6">Kredit i uplate</b>.${s.res_min_topup ? ` Najmanja dopuna je ${money(s.res_min_topup)}.` : ''} Svaki novi kupac skida cijenu plana sa kredita.`],
      ['Napravi kupca', 'Klikni <b style="color:#f2f2f6">Novi korisnik</b>, izaberi plan i dobiješ link i QR kod za kupca.'],
      ['Pošalji mu pristup', 'Dugme <b style="color:#f2f2f6">Pošalji kupcu</b> šalje sve preko WhatsAppa, Vibera, Telegrama ili e-maila. Cijenu kupcu određuješ ti.'],
    ],
    extra: plansTable(r) ? `<div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;margin:6px 0 6px"><div class="gm-s"><div class="gm-d"><span style="color:#f2f2f6">Tvoje cijene (sa popustom)</span></div></div></div>${plansTable(r)}` : '',
  });
  const text = `Dobrodošao, ${r.username}!\n\nTvoj reseller nalog za ${s.brand} je spreman.\nPanel: ${url}\nKorisničko ime: ${r.username}${password ? `\nŠifra: ${password}\n(promijeni je nakon prve prijave)` : ''}\nKredit: ${money(r.credit)}\n\n1. Dopuni kredit\n2. Napravi kupca (Novi korisnik)\n3. Pošalji mu pristup (Pošalji kupcu)`;
  return send(r.email, `${s.brand} · tvoj reseller nalog`, html, text);
}

/** Reseller se sam registrovao i admin ga je odobrio. */
function approved(r, fallback) {
  const s = settings.load(), url = portalUrl(fallback);
  const html = layout({
    badge: 'RESELLER PANEL',
    head: 'Nalog je odobren ✅',
    intro: `Zdravo ${esc(r.username)}, tvoj reseller nalog za <b>${esc(s.brand)}</b> je odobren. Prijavi se sa korisničkim imenom i šifrom koje si izabrao pri registraciji.`,
    stats: [['Kredit', money(r.credit)], ['Najviše kupaca', esc(r.user_limit || '—')]],
    cta: url ? { href: url, label: 'Prijavi se u panel' } : null,
    steps: [
      ['Dopuni kredit', 'Kredit i uplate → izaberi iznos i način plaćanja.'],
      ['Napravi prvog kupca', 'Novi korisnik → plan → link i QR kod su odmah spremni.'],
    ],
  });
  return send(r.email, `${s.brand} · reseller nalog odobren`, html, `Tvoj reseller nalog je odobren.\nPrijava: ${url}`);
}

/** Dopuna kredita: iznos, novo stanje, faktura. */
function credit(t, fallback) {
  const s = settings.load(), url = portalUrl(fallback);
  const r = one('SELECT * FROM admins WHERE id = ?', t.reseller_id);
  if (!r) return Promise.resolve(false);
  const vat = Number(s.vat || 0), net = vat ? t.amount / (1 + vat / 100) : t.amount;
  const html = layout({
    badge: 'FAKTURA',
    head: 'Hvala na uplati! 💳',
    intro: `Kredit je dodan na tvoj nalog i odmah ga možeš koristiti.`,
    stats: [['Uplaćeno', money(t.amount)], ['Dodano kredita', money(t.credit_delta)], ['Novo stanje', money(r.credit)]],
    rows: [
      ['Faktura', esc(t.invoice_no || '#' + t.id)],
      ['Datum', new Date(t.ts).toLocaleDateString('bs-BA', { timeZone: s.timezone || 'Europe/Sarajevo' })],
      ['Opis', 'Kredit za VPN usluge'],
      ...(vat ? [['Osnovica', money(net)], [`PDV ${vat}%`, money(t.amount - net)]] : []),
      ['Ukupno', money(t.amount)],
      ['Način plaćanja', esc(t.method || '—')],
      ...(s.inv_company ? [['Izdavalac', esc(s.inv_company)]] : []),
    ],
    cta: url ? { href: url + '#/kredit', label: 'Otvori panel' } : null,
  });
  return send(r.email, `Faktura ${t.invoice_no || t.id} · ${s.brand}`, html, `Hvala na uplati. Uplaćeno ${money(t.amount)}, dodano kredita ${money(t.credit_delta)}, novo stanje ${money(r.credit)}. Faktura ${t.invoice_no || t.id}.`);
}

/** Kredit pao ispod €10 (jednom, kad pređe granicu). */
function lowCredit(r, fallback) {
  const s = settings.load(), url = portalUrl(fallback);
  const html = layout({
    badge: 'RESELLER PANEL',
    head: 'Ponestaje ti kredita',
    intro: `Na nalogu ti je ostalo <b>${money(r.credit)}</b>. Dopuni kredit na vrijeme, da možeš praviti i produžavati kupce bez prekida.`,
    cta: url ? { href: url + '#/kredit', label: 'Dopuni kredit' } : null,
  });
  return send(r.email, `${s.brand} · ostalo ${money(r.credit)} kredita`, html, `Ostalo ti je ${money(r.credit)} kredita. Dopuni: ${url}`);
}

module.exports = { welcome, approved, credit, lowCredit, portalUrl };
