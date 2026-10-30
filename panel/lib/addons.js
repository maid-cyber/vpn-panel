'use strict';
// Dodaci koji se prodaju na sajtu (Dedicated IP, Double VPN, Port forwarding).
// Naplata: mjesečna cijena × broj mjeseci plana, u istoj uplati kao plan.
// Provizioniranje nakon uplate: PF dobije port, Double VPN flag, Dedicated IP dobije
// slobodan server označen tagom "dedicated" ili ostaje "na čekanju" dok ga admin ne dodijeli.
const { one, all, run, now, log } = require('./db');
const settings = require('./settings');

// id → zadana cijena /mj i settings ključevi
const DEFS = {
  dip: { def: 2.99, on: 'ao_dip_on', price: 'ao_dip_price' },
  mh: { def: 1.49, on: 'ao_mh_on', price: 'ao_mh_price' },
  pf: { def: 0.99, on: 'ao_pf_on', price: 'ao_pf_price' },
};
const IDS = Object.keys(DEFS);

function enabled() { return !!settings.get('ao_on'); }
function priceOf(id) {
  const d = DEFS[id]; if (!d) return 0;
  const p = Number(settings.get(d.price)); return p > 0 ? p : d.def;
}
function isOn(id) {
  const d = DEFS[id];
  return !!(d && enabled() && settings.get(d.on));
}
/** Dodaci koje sajt prikazuje kao kupive (prazno = ne prodaje se). */
function forSite() { return IDS.filter(isOn).map((id) => ({ id, price: priceOf(id) })); }

/** Broj mjeseci u planu (za naplatu × broj mjeseci). */
function months(plan) { return Math.max(1, Math.round((plan && plan.days || 30) / 30)); }

/** Validiraj izbor i izračunaj cijenu na serverskoj strani. Nikad ne vjeruj cijeni s klijenta. */
function quote(ids, plan) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => DEFS[x] && isOn(x)))];
  const m = months(plan);
  const total = Math.round(want.reduce((s, id) => s + priceOf(id) * m, 0) * 100) / 100;
  return { ids: want, months: m, total };
}

function freePfPort() {
  const used = new Set();
  for (const s of all('SELECT vless_port, wg_port, ss_port FROM servers')) { used.add(s.vless_port); used.add(s.wg_port); used.add(s.ss_port); }
  for (const c of all('SELECT port FROM chains')) used.add(c.port);
  for (const u of all('SELECT pf_port FROM users WHERE pf_port > 0')) used.add(u.pf_port);
  for (let i = 0; i < 3000; i++) { const p = 30000 + Math.floor(Math.random() * 10000); if (!used.has(p)) return p; }
  return 0;
}

/** Slobodan dedicated server (tag "dedicated", bez dodijeljenog korisnika). */
function freeDedicated() {
  return all("SELECT * FROM servers WHERE enabled = 1 AND host != ''")
    .find((sv) => String(sv.tags || '').split(',').map((x) => x.trim()).includes('dedicated')
      && !String(sv.dedicated_to || '').split(',').map(Number).filter(Boolean).length) || null;
}

/**
 * Provizioniraj kupljene dodatke na nalogu. Sigurno je zvati više puta (idempotentno).
 * Vraća { set:[id...], pending:[id...] } za log/mail.
 */
function provision(userId, ids) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  const out = { set: [], pending: [] };
  if (!u || !Array.isArray(ids) || !ids.length) return out;
  const core = require('./core');
  const have = new Set(String(u.addons || '').split(',').map((x) => x.trim()).filter(Boolean));
  for (const id of [...new Set(ids)]) {
    if (!DEFS[id]) continue;
    if (id === 'pf') {
      if (!one('SELECT pf_port FROM users WHERE id = ?', u.id).pf_port) {
        const p = freePfPort();
        if (p) { run('UPDATE users SET pf_port = ? WHERE id = ?', p, u.id); core.history(u.id, `Port forwarding (dodatak) · port ${p}`); }
      }
      have.add('pf'); out.set.push('pf');
    } else if (id === 'mh') {
      run('UPDATE users SET mh_on = 1 WHERE id = ?', u.id);
      core.history(u.id, 'Double VPN (dodatak) uključen');
      have.add('mh'); out.set.push('mh');
    } else if (id === 'dip') {
      const sv = freeDedicated();
      if (sv) {
        run('UPDATE servers SET dedicated_to = ? WHERE id = ?', String(u.id), sv.id);
        run('UPDATE users SET ded_pending = 0 WHERE id = ?', u.id);
        core.history(u.id, `Dedicated IP (dodatak) · server ${sv.name}`);
        out.set.push('dip');
      } else {
        run('UPDATE users SET ded_pending = 1 WHERE id = ?', u.id);
        core.history(u.id, 'Dedicated IP (dodatak) kupljen · čeka dodjelu servera');
        out.pending.push('dip');
        try {
          require('./notify').notify('n_payment', `🏷️ Dedicated IP je kupljen (nalog ${u.username}, #${u.id}), ali nema slobodnog "dedicated" servera. Dodaj server s tagom "dedicated" i dodijeli ga korisniku.`);
        } catch {}
      }
      have.add('dip');
    }
  }
  run('UPDATE users SET addons = ? WHERE id = ?', [...have].join(','), u.id);
  if (out.set.length || out.pending.length) log('sistem', 'Dodaci provizionirani', `${u.username}: ${[...out.set, ...out.pending.map((x) => x + ' (čeka)')].join(', ')}`);
  return out;
}

/** Spisak dodataka na nalogu, za prikaz kupcu. */
function ofUser(u) {
  const ids = String(u.addons || '').split(',').map((x) => x.trim()).filter((x) => DEFS[x]);
  return { ids, pending: !!u.ded_pending && ids.includes('dip') };
}

const NAMES = { dip: 'Dedicated IP', mh: 'Double VPN', pf: 'Port forwarding' };
const nameOf = (id) => NAMES[id] || id;

/** Isključi dodatke korisniku (admin, besplatno). */
function remove(userId, ids) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return;
  const core = require('./core');
  const have = new Set(String(u.addons || '').split(',').map((x) => x.trim()).filter(Boolean));
  for (const id of [...new Set(ids)]) {
    if (!DEFS[id]) continue;
    if (id === 'pf') { run('UPDATE users SET pf_port = 0 WHERE id = ?', userId); } else if (id === 'mh') { run('UPDATE users SET mh_on = 0 WHERE id = ?', userId); } else if (id === 'dip') {
      for (const sv of all('SELECT id, dedicated_to FROM servers')) {
        const list = String(sv.dedicated_to || '').split(',').map(Number).filter(Boolean);
        if (list.includes(Number(userId))) run('UPDATE servers SET dedicated_to = ? WHERE id = ?', list.filter((x) => x !== Number(userId)).join(','), sv.id);
      }
      run('UPDATE users SET ded_pending = 0 WHERE id = ?', userId);
    }
    have.delete(id);
    core.history(userId, `Dodatak isključen: ${nameOf(id)}`);
  }
  run('UPDATE users SET addons = ? WHERE id = ?', [...have].join(','), userId);
}

/** Stanje dodataka na korisniku (za admin prikaz). */
function stateFor(u) {
  const dedSv = all("SELECT name, dedicated_to FROM servers")
    .find((sv) => String(sv.dedicated_to || '').split(',').map(Number).includes(Number(u.id)));
  return {
    pf: !!u.pf_port, pf_port: u.pf_port || 0,
    mh: !!u.mh_on,
    dip: !!dedSv || !!u.ded_pending, dip_server: dedSv ? dedSv.name : null, dip_pending: !!u.ded_pending && !dedSv,
  };
}

/** Koliko mjeseci je ostalo na planu (za naplatu dokupa, min 1). Zaokruženo kao i na checkoutu. */
function monthsLeft(u) {
  const ms = (u.expires_at || 0) - now();
  return Math.max(1, Math.round(ms / (30 * 86400000)));
}

/** Dodaci koje kupac JOŠ nema — za dokup na stranici naloga. Cijena = mjesečno × preostali mjeseci plana. */
function availableFor(u) {
  const have = new Set(ofUser(u).ids);
  const m = monthsLeft(u);
  return forSite().filter((a) => {
    if (have.has(a.id)) return false;
    if (a.id === 'pf' && u.pf_port) return false;
    if (a.id === 'mh' && u.mh_on) return false;
    if (a.id === 'dip' && u.ded_pending) return false;
    return true;
  }).map((a) => ({ id: a.id, name: nameOf(a.id), price: a.price, months: m, total: Math.round(a.price * m * 100) / 100 }));
}

/**
 * Isporuči dokupljeni dodatak postojećem kupcu: provizioniraj + zabilježi uplatu (jednom po ext_id).
 * Zove se iz PayPal capture-a i Stripe webhooka.
 */
function purchaseFulfil(userId, ids, amount, method, extId) {
  if (extId && one('SELECT id FROM transactions WHERE ext_id = ?', extId)) return;   // već obrađeno
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  ids = (Array.isArray(ids) ? ids : []).filter((x) => DEFS[x]);
  if (!u || !ids.length) return;
  const r = provision(userId, ids);
  const names = ids.map(nameOf).join(', ');
  const t = run('INSERT INTO transactions (ts, type, amount, user_id, actor, method, note) VALUES (?,?,?,?,?,?,?)',
    now(), 'sale', Number(amount) || 0, userId, 'kupac', String(method || ''), `Dodatak: ${names}`);
  if (extId) run('UPDATE transactions SET ext_id = ? WHERE id = ?', extId, Number(t.lastInsertRowid));
  try { require('./notify').notify('n_payment', `Uplata €${amount} · dodatak (${names}) · ${u.username}`); } catch {}
  log('sajt', 'Kupac dokupio dodatak', `${u.username}: ${names} · €${amount}`);
  return r;
}

module.exports = { DEFS, IDS, NAMES, nameOf, enabled, isOn, priceOf, forSite, months, monthsLeft, quote, provision, remove, stateFor, ofUser, availableFor, purchaseFulfil, freePfPort, freeDedicated };
