'use strict';
// Telegram bot za kupce: kupovina i produženje (PayPal), stanje naloga, povezivanje sa nalogom, podsjetnici i poruke svima.
const { one, all, run, now, log } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');

let botName = null, botNameToken = null, polling = false, cmdsFor = null;

const token = () => { const s = settings.load(); return s.cbot_on && s.cbot_token ? s.cbot_token : null; };
const TG = () => (process.env.TG_API || 'https://api.telegram.org').replace(/\/+$/, '');
const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function call(method, body, timeoutMs = 15000) {
  const t = token();
  if (!t) return { ok: false, description: 'Bot za kupce nije uključen.' };
  try {
    const r = await fetch(`${TG()}/bot${t}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeoutMs),
    });
    return await r.json();
  } catch (e) { return { ok: false, description: e.message }; }
}

async function username() {
  const t = token();
  if (!t) return null;
  if (botName && botNameToken === t) return botName;
  const r = await call('getMe');
  if (r.ok) { botName = r.result.username; botNameToken = t; }
  return r.ok ? botName : null;
}

const send = (chat, text) => call('sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
const html = (chat, text, kb) => call('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
const edit = (chat, mid, text, kb) => call('editMessageText', { chat_id: chat, message_id: mid, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: kb || [] } });

async function photo(chat, png, caption, kb) {
  const t = token();
  if (!t) return { ok: false };
  const fd = new FormData();
  fd.set('chat_id', String(chat));
  fd.set('caption', caption);
  fd.set('parse_mode', 'HTML');
  if (kb) fd.set('reply_markup', JSON.stringify({ inline_keyboard: kb }));
  fd.set('photo', new Blob([png], { type: 'image/png' }), 'qr.png');
  try { return await (await fetch(`${TG()}/bot${t}/sendPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) })).json(); } catch (e) { return { ok: false, description: e.message }; }
}

const fmtDate = (ts) => new Date(ts).toLocaleDateString('bs-BA', { timeZone: settings.get('timezone') || 'Europe/Sarajevo' }).replace(/\.$/, '');
const subBase = () => { const s = settings.load(); return (s.sub_url || s.panel_url || '').replace(/\/+$/, ''); };
const panelBase = () => { const s = settings.load(); return (s.panel_url || s.sub_url || '').replace(/\/+$/, ''); };
const isUrl = (u) => /^https?:\/\/[^\s]+$/.test(u);

function statusText(u) {
  const st = vpn.userStatus(u);
  const label = { active: '✅ Aktivan', expiring: '⏳ Ističe uskoro', grace: '⚠️ Istekao (grace period)', expired: '❌ Istekao', limited: '⚠️ Potrošen promet', disabled: '⛔ Ugašen', devices: '⚠️ Previše uređaja (privremeno blokiran)' }[st];
  const used = (u.traffic_up + u.traffic_down) / 1024 ** 3;
  const days = Math.ceil((u.expires_at - now()) / vpn.DAY);
  return `${label}\nNalog: ${u.username}\nVrijedi do: ${fmtDate(u.expires_at)}${days > 0 ? ` (još ${days} d)` : ''}\nPromet: ${used.toFixed(1)} GB${u.traffic_limit ? ` od ${(u.traffic_limit / 1024 ** 3).toFixed(0)} GB` : ''}`;
}

// ---------- prodaja ----------
const plans = () => all('SELECT * FROM plans WHERE active = 1 AND trial = 0 AND price > 0 ORDER BY sort, id LIMIT 12');
const canSell = () => settings.get('cbot_sell') !== false && require('./paypal').ready() && plans().length > 0 && !!panelBase();
const money = (n) => require('./paypal').money(n);
const planLine = (p) => `${p.days} dana · ${p.devices || settings.get('default_devices') || 3} uređaja · ${p.traffic_gb ? `${p.traffic_gb} GB` : 'neograničen promet'}`;

function supportBtn() {
  const c = String(settings.get('support_contact') || '').trim();
  const m = c.match(/@([A-Za-z0-9_]{4,32})/);
  if (m) return { text: '💬 Podrška', url: `https://t.me/${m[1]}` };
  if (isUrl(c)) return { text: '💬 Podrška', url: c };
  return c ? { text: '💬 Podrška', callback_data: 'help' } : null;
}

function menu(chat) {
  const s = settings.load();
  const mine = all('SELECT * FROM users WHERE tg_chat = ?', String(chat));
  const sell = canSell();
  const kb = [];
  if (sell) kb.push([{ text: '🛒 Kupi VPN', callback_data: 'buy' }]);
  if (mine.length) kb.push([...(sell ? [{ text: '🔄 Produži', callback_data: 'renew' }] : []), { text: '📊 Moj nalog', callback_data: 'me' }]);
  kb.push([{ text: '📲 Aplikacije', callback_data: 'apps' }, ...(supportBtn() ? [supportBtn()] : [])]);
  const text = mine.length
    ? `👋 Zdravo! Ovo je <b>${esc(s.brand)}</b>.\n\n${esc(mine.map(statusText).join('\n\n'))}\n\nŠta želiš?`
    : `👋 Dobrodošao u <b>${esc(s.brand)}</b>!\n\nBrz i privatan VPN bez logova, za telefon i računar.${sell ? '\n\nIzaberi plan, plati PayPalom ili karticom i nalog dobiješ ovdje za par sekundi.' : '\n\nAko već imaš nalog, otvori svoj link u pretraživaču i klikni „Poveži Telegram”.'}`;
  return { text, kb };
}

function plansView(back, prefix) {
  const ps = plans();
  const text = `🛒 <b>Izaberi plan</b>\n\n${ps.map((p) => `• <b>${esc(p.name)}</b> · ${money(p.price)}\n   ${esc(planLine(p))}`).join('\n')}\n\nPlaćanje: PayPal ili kartica preko PayPala.`;
  return { text, kb: [...ps.map((p) => [{ text: `${p.name} · ${money(p.price)}`, callback_data: `${prefix}${p.id}` }]), [{ text: '⬅️ Nazad', callback_data: back }]] };
}

function appsView() {
  const b = panelBase();
  const kb = b ? [[{ text: '🤖 Android', url: `${b}/download/android` }, { text: '💻 Windows', url: `${b}/download/windows` }]] : [];
  kb.push([{ text: '⬅️ Nazad', callback_data: 'menu' }]);
  return { text: '📲 <b>Aplikacije</b>\n\nAndroid i Windows: preuzmi dugmetom ispod.\niPhone: instaliraj <b>Hiddify</b> iz App Storea, pa otvori svoj link.\n\nNakon kupovine dobiješ link koji otvara aplikaciju i sam se prijavi.', kb };
}

async function startPay(chat, mid, from, kind, plan, user) {
  const open = one("SELECT COUNT(*) AS n FROM bot_orders WHERE chat = ? AND created_at > ?", String(chat), now() - 3600000).n;
  if (open >= 8) return edit(chat, mid, 'Previše pokušaja plaćanja u zadnjih sat vremena. Pokušaj malo kasnije ili se javi podršci.', [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
  let o;
  try {
    o = await require('./paypal').createOrder({ chat, kind, plan, userId: user?.id, tgName: from?.username });
  } catch (e) {
    log('sistem', 'Bot: PayPal narudžba nije napravljena', e.message, 'warn');
    return edit(chat, mid, `Plaćanje trenutno ne radi. Pokušaj za par minuta ili se javi podršci.`, [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
  }
  if (!o.url) return edit(chat, mid, 'PayPal nije vratio link za plaćanje. Pokušaj ponovo.', [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
  const what = kind === 'buy' ? 'Novi nalog' : `Produženje naloga <b>${esc(user.username)}</b>`;
  return edit(chat, mid,
    `🧾 <b>${esc(plan.name)}</b> · ${money(plan.price)}\n${what}\n${esc(planLine(plan))}\n\n1. Klikni <b>Plati PayPalom</b>\n2. Plati PayPal računom ili karticom\n3. ${kind === 'buy' ? 'Nalog, link i QR kod stižu ovdje odmah nakon uplate' : 'Nalog se produži odmah nakon uplate'}\n\nLink za plaćanje važi 3 sata.`,
    [[{ text: `💳 Plati PayPalom · ${money(plan.price)}`, url: o.url }], [{ text: '⬅️ Nazad', callback_data: kind === 'buy' ? 'buy' : 'renew' }]]);
}

function renewable(chat) {
  return all('SELECT * FROM users WHERE tg_chat = ? ORDER BY id', String(chat));
}

async function onCallback(q) {
  const chat = String(q.message?.chat?.id || '');
  const mid = q.message?.message_id;
  const d = String(q.data || '');
  call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  if (!chat || !mid) return;
  if (d === 'menu') { const m = menu(chat); return edit(chat, mid, m.text, m.kb); }
  if (d === 'apps') { const v = appsView(); return edit(chat, mid, v.text, v.kb); }
  if (d === 'help') return edit(chat, mid, `💬 Podrška: ${esc(settings.get('support_contact'))}`, [[{ text: '⬅️ Nazad', callback_data: 'menu' }]]);
  if (d === 'me') {
    const mine = renewable(chat);
    const b = subBase();
    const kb = mine.filter(() => b).map((u) => [{ text: `🚀 Otvori ${u.username}`, url: `${b}/s/${u.sub_token}?open=1` }]);
    kb.push([{ text: '⬅️ Nazad', callback_data: 'menu' }]);
    return edit(chat, mid, mine.length ? `📊 <b>Moj nalog</b>\n\n${esc(mine.map(statusText).join('\n\n'))}` : 'Nemaš povezan nalog.', kb);
  }
  if (!canSell() && /^(buy|bp:|renew|ra:|rp:)/.test(d)) return edit(chat, mid, 'Kupovina preko bota trenutno nije dostupna.', [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
  if (d === 'buy') { const v = plansView('menu', 'bp:'); return edit(chat, mid, v.text, v.kb); }
  let m = d.match(/^bp:(\d+)$/);
  if (m) {
    const p = plans().find((x) => x.id === Number(m[1]));
    if (!p) return edit(chat, mid, 'Taj plan više nije dostupan.', [[{ text: '⬅️ Nazad', callback_data: 'buy' }]]);
    await edit(chat, mid, '⏳ Pripremam plaćanje…', []);
    return startPay(chat, mid, q.from, 'buy', p, null);
  }
  if (d === 'renew') {
    const mine = renewable(chat);
    if (!mine.length) return edit(chat, mid, 'Nemaš nalog za produženje. Kupi novi ili poveži postojeći preko svog linka.', [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
    if (mine.length === 1) return renewPlans(chat, mid, mine[0]);
    return edit(chat, mid, '🔄 <b>Koji nalog produžavaš?</b>', [...mine.map((u) => [{ text: `${u.username} · do ${fmtDate(u.expires_at)}`, callback_data: `ra:${u.id}` }]), [{ text: '⬅️ Nazad', callback_data: 'menu' }]]);
  }
  m = d.match(/^ra:(\d+)$/);
  if (m) { const u = renewable(chat).find((x) => x.id === Number(m[1])); return u ? renewPlans(chat, mid, u) : edit(chat, mid, 'Nalog nije pronađen.', [[{ text: '⬅️ Meni', callback_data: 'menu' }]]); }
  m = d.match(/^rp:(\d+):(\d+)$/);
  if (m) {
    const u = renewable(chat).find((x) => x.id === Number(m[1]));
    const p = plans().find((x) => x.id === Number(m[2]));
    if (!u || !p || u.owner_id) return edit(chat, mid, 'Nalog ili plan nije pronađen.', [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
    await edit(chat, mid, '⏳ Pripremam plaćanje…', []);
    return startPay(chat, mid, q.from, 'renew', p, u);
  }
}

function renewPlans(chat, mid, u) {
  if (u.owner_id) {
    return edit(chat, mid, `Nalog <b>${esc(u.username)}</b> si dobio od svog prodavca. Za produženje se javi njemu.`, [[{ text: '⬅️ Meni', callback_data: 'menu' }]]);
  }
  const v = plansView('menu', `rp:${u.id}:`);
  return edit(chat, mid, `🔄 Produžavaš <b>${esc(u.username)}</b> (vrijedi do ${fmtDate(u.expires_at)}). Dani se dodaju na postojeće.\n\n${v.text}`, v.kb);
}

/** Poziva paypal.js kad uplata prođe. */
async function delivered(o) {
  const u = one('SELECT * FROM users WHERE id = ?', o.user_id);
  if (!u) return;
  const b = subBase(), pb = panelBase();
  const link = b ? `${b}/s/${u.sub_token}` : '';
  if (o.kind === 'renew') {
    return html(o.chat, `✅ <b>Plaćeno, hvala!</b>\n\nNalog <b>${esc(u.username)}</b> je produžen do <b>${fmtDate(u.expires_at)}</b>.\nNe moraš ništa mijenjati u aplikaciji.`, [[{ text: '📊 Moj nalog', callback_data: 'me' }]]);
  }
  const plan = one('SELECT * FROM plans WHERE id = ?', u.plan_id);
  const kb = [];
  if (link) kb.push([{ text: '🚀 Otvori u aplikaciji', url: `${link}?open=1` }]);
  if (pb) kb.push([{ text: '🤖 Android', url: `${pb}/download/android` }, { text: '💻 Windows', url: `${pb}/download/windows` }]);
  const cap = `✅ <b>Plaćeno, hvala!</b> Tvoj VPN je spreman.\n\nNalog: <b>${esc(u.username)}</b>\nPlan: ${esc(plan?.name || '')} · vrijedi do <b>${fmtDate(u.expires_at)}</b>\n\n<b>Kako se spojiti:</b>\n1. Instaliraj aplikaciju (dugmad ispod; iPhone: Hiddify)\n2. Klikni <b>Otvori u aplikaciji</b> ili skeniraj QR kod\n3. Klikni <b>Spoji</b>`;
  let r = { ok: false };
  if (link) r = await photo(o.chat, require('./qrpng').png(link, 8, 4), cap, kb);
  if (!r.ok) await html(o.chat, cap, kb);
  if (link) await html(o.chat, `🔗 Tvoj link (sačuvaj ga, ne dijeli ga):\n<code>${esc(link)}</code>`);
  return html(o.chat, 'Podsjetit ću te ovdje prije isteka. Za stanje naloga pošalji /status.', [[{ text: '📋 Meni', callback_data: 'menu' }]]);
}

async function onMessage(msg) {
  const chat = String(msg.chat?.id || '');
  const text = String(msg.text || '').trim();
  if (!chat || !text) return;
  const s = settings.load();
  const m = text.match(/^\/start(?:\s+([\w-]{8,40}))?$/);
  if (m && m[1]) {
    const u = one('SELECT * FROM users WHERE sub_token = ?', m[1]);
    if (!u) return send(chat, 'Link nije ispravan ili je zamijenjen novim. Otvori svoj link ponovo i klikni "Poveži Telegram".');
    run('UPDATE users SET tg_chat = ? WHERE id = ?', chat, u.id);
    log('sistem', 'Kupac povezao Telegram', u.username);
    return html(chat, `👋 Povezano sa <b>${esc(s.brand)}</b>!\n\n${esc(statusText(u))}\n\nJavit ću ti prije isteka.`, [[{ text: '📋 Meni', callback_data: 'menu' }]]);
  }
  if (/^\/stop/.test(text)) {
    run('UPDATE users SET tg_chat = NULL WHERE tg_chat = ?', chat);
    return send(chat, 'Odjavljen si. Više ti neću slati poruke. Za ponovno povezivanje pošalji /start.');
  }
  const mine = all('SELECT * FROM users WHERE tg_chat = ?', chat);
  if (/^\/status/.test(text)) return mine.length ? send(chat, mine.map(statusText).join('\n\n')) : html(chat, 'Nemaš povezan nalog.', [[{ text: '📋 Meni', callback_data: 'menu' }]]);
  if (/^\/(kupi|buy)/.test(text) && canSell()) { const v = plansView('menu', 'bp:'); return html(chat, v.text, v.kb); }
  const mm = menu(chat);
  return html(chat, mm.text, mm.kb);
}

async function setCommands() {
  const t = token();
  if (!t || cmdsFor === t) return;
  const r = await call('setMyCommands', { commands: [
    { command: 'start', description: 'Meni' },
    { command: 'kupi', description: 'Kupi VPN' },
    { command: 'status', description: 'Stanje mog naloga' },
    { command: 'stop', description: 'Ne šalji mi više poruke' },
  ] });
  if (r.ok) cmdsFor = t;
}

// dugo čekanje na poruke (getUpdates), radi samo kad je bot uključen
async function loop() {
  if (polling) return;
  polling = true;
  for (;;) {
    if (!token()) { await new Promise((r) => setTimeout(r, 10000)); continue; }
    setCommands().catch(() => {});
    const offset = Number((one("SELECT value FROM settings WHERE key = '_job_cbot_offset'") || {}).value || 0);
    const r = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000);
    if (!r.ok) { await new Promise((res) => setTimeout(res, 15000)); continue; }
    for (const upd of r.result) {
      run("INSERT OR REPLACE INTO settings (key, value) VALUES ('_job_cbot_offset', ?)", String(upd.update_id + 1));
      if (upd.message) await onMessage(upd.message).catch((e) => console.error('cbot', e));
      if (upd.callback_query) await onCallback(upd.callback_query).catch((e) => console.error('cbot', e));
    }
  }
}

module.exports = { loop, send, username, statusText, call, onMessage, onCallback, delivered };
