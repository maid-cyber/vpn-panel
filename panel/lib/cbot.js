'use strict';
// Telegram bot za kupce: povezivanje sa nalogom, stanje naloga, podsjetnici i poruke svima.
const { one, all, run, now, log } = require('./db');
const settings = require('./settings');
const vpn = require('./vpn');

let botName = null, botNameToken = null, polling = false;

const token = () => { const s = settings.load(); return s.cbot_on && s.cbot_token ? s.cbot_token : null; };

async function call(method, body, timeoutMs = 15000) {
  const t = token();
  if (!t) return { ok: false, description: 'Bot za kupce nije uključen.' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
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

function statusText(u) {
  const st = vpn.userStatus(u);
  const label = { active: '✅ Aktivan', expiring: '⏳ Ističe uskoro', grace: '⚠️ Istekao (grace period)', expired: '❌ Istekao', limited: '⚠️ Potrošen promet', disabled: '⛔ Ugašen', devices: '⚠️ Previše uređaja (privremeno blokiran)' }[st];
  const used = (u.traffic_up + u.traffic_down) / 1024 ** 3;
  const days = Math.ceil((u.expires_at - now()) / vpn.DAY);
  return `${label}\nNalog: ${u.username}\nVrijedi do: ${new Date(u.expires_at).toLocaleDateString('bs-BA')}${days > 0 ? ` (još ${days} d)` : ''}\nPromet: ${used.toFixed(1)} GB${u.traffic_limit ? ` od ${(u.traffic_limit / 1024 ** 3).toFixed(0)} GB` : ''}`;
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
    return send(chat, `👋 Povezano sa ${s.brand}!\n\n${statusText(u)}\n\nJavit ću ti prije isteka. Komande: /status, /stop`);
  }
  const mine = all('SELECT * FROM users WHERE tg_chat = ?', chat);
  if (/^\/stop/.test(text)) {
    run('UPDATE users SET tg_chat = NULL WHERE tg_chat = ?', chat);
    return send(chat, 'Odjavljen si. Više ti neću slati poruke.');
  }
  if (!mine.length) return send(chat, `Zdravo! Ovo je bot za ${s.brand}. Otvori svoj pretplatni link u pretraživaču i klikni "Poveži Telegram".`);
  if (/^\/(status|start)/.test(text)) return send(chat, mine.map(statusText).join('\n\n'));
  return send(chat, `Za stanje naloga pošalji /status.${s.support_contact ? `\nPodrška: ${s.support_contact}` : ''}`);
}

// dugo čekanje na poruke (getUpdates), radi samo kad je bot uključen
async function loop() {
  if (polling) return;
  polling = true;
  for (;;) {
    if (!token()) { await new Promise((r) => setTimeout(r, 10000)); continue; }
    const offset = Number((one("SELECT value FROM settings WHERE key = '_job_cbot_offset'") || {}).value || 0);
    const r = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
    if (!r.ok) { await new Promise((res) => setTimeout(res, 15000)); continue; }
    for (const upd of r.result) {
      run("INSERT OR REPLACE INTO settings (key, value) VALUES ('_job_cbot_offset', ?)", String(upd.update_id + 1));
      if (upd.message) await onMessage(upd.message).catch((e) => console.error('cbot', e));
    }
  }
}

module.exports = { loop, send, username, statusText, call, onMessage };
