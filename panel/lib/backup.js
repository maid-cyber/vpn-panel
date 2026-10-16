'use strict';
// Backup baze: kopija SQLite fajla (VACUUM INTO), čuvanje zadnjih N i slanje na Telegram.
const fs = require('node:fs');
const path = require('node:path');
const { db, log, DATA_DIR } = require('./db');
const settings = require('./settings');
const { telegramFile, notify } = require('./notify');
const s3 = require('./s3');

const DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(DIR, { recursive: true });

function list() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.db')).sort().reverse()
    .map((f) => { const st = fs.statSync(path.join(DIR, f)); return { name: f, size: st.size, ts: st.mtimeMs }; });
}
function file(name) {
  if (!/^backup-[\w-]+\.db$/.test(name)) return null;
  const f = path.join(DIR, name);
  return fs.existsSync(f) ? f : null;
}
async function make(actor = 'sistem', manual = false) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const f = path.join(DIR, `backup-${stamp}.db`);
  try {
    db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  } catch (e) {
    log(actor, 'Backup nije uspio', e.message, 'error');
    notify('n_backup', `Backup nije uspio: ${e.message}`);
    throw e;
  }
  const keep = Number(settings.get('backup_keep') || 14);
  for (const old of list().slice(keep)) fs.rmSync(path.join(DIR, old.name), { force: true });
  log(actor, manual ? 'Backup napravljen ručno' : 'Backup napravljen', `${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
  if (settings.get('backup_tg') && settings.get('tg_token')) {
    const r = await telegramFile(f, `Backup baze · ${stamp}`);
    if (!r.ok) log('sistem', 'Backup nije poslan na Telegram', r.error, 'warn');
  }
  if (settings.get('s3_on')) {
    try { await s3.put(`vpn-panel/${path.basename(f)}`, fs.readFileSync(f)); log('sistem', 'Backup poslan na S3', path.basename(f)); }
    catch (e) { log('sistem', 'Backup nije poslan na S3', e.message, 'warn'); notify('n_backup', `Backup nije poslan na S3: ${e.message}`); }
  }
  return f;
}

module.exports = { list, file, make, DIR };
