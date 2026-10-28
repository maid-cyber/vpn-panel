'use strict';
// Preuzimanje aplikacija sa tvoje adrese (/download/android, /download/windows) umjesto GitHuba.
// Panel sam skine zadnju verziju sa GitHub Releases, sačuva je kod sebe i daje je kupcu kao običan fajl.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { DATA_DIR, log, now } = require('./db');
const { send } = require('./http');

const DIR = path.join(DATA_DIR, 'downloads');
const KIND = {
  android: { key: 'apk', build: 'apkBuild', file: (b) => `android-${b}.apk`, name: 'AdiLink-VPN.apk', type: 'application/vnd.android.package-archive' },
  windows: { key: 'exe', build: 'exeBuild', file: (b) => `windows-${b}.exe`, name: 'AdiLink-VPN-Setup.exe', type: 'application/vnd.microsoft.portable-executable' },
  linux: { key: 'deb', build: 'debBuild', file: (b) => `linux-${b}.deb`, name: 'AdiLink-VPN.deb', type: 'application/vnd.debian.binary-package' },
};
const busy = new Map();

async function ensure(kind) {
  const k = KIND[kind];
  const d = await require('./site').downloads();
  const tok = String(require('./settings').get('gh_token') || '').trim();
  const url = tok && d[k.key + 'Api'] ? d[k.key + 'Api'] : d[k.key], build = d[k.build];
  if (!url || !build) return { file: latestLocal(kind), page: d.page };
  const f = path.join(DIR, k.file(build));
  if (fs.existsSync(f) && fs.statSync(f).size > 100000) return { file: f, build };
  if (!busy.has(kind)) {
    busy.set(kind, (async () => {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = f + '.part';
      const r = await fetch(url, { headers: require('./site').ghHeaders('application/octet-stream'), redirect: 'follow', signal: AbortSignal.timeout(300000) });
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, f);
      // stare verzije: čuvaj samo zadnje dvije
      const old = fs.readdirSync(DIR).filter((x) => x.startsWith(kind + '-') && !x.endsWith('.part')).sort((a, b) => Number(b.replace(/\D/g, '')) - Number(a.replace(/\D/g, '')));
      for (const x of old.slice(2)) fs.rmSync(path.join(DIR, x), { force: true });
      log('sistem', 'Aplikacija spremna za preuzimanje', `${kind} build ${build}`);
    })().finally(() => busy.delete(kind)));
  }
  try { await busy.get(kind); } catch (e) { log('sistem', 'Skidanje aplikacije sa GitHuba nije uspjelo', `${kind}: ${e.message}`, 'warn'); }
  return { file: fs.existsSync(f) ? f : latestLocal(kind), build, page: d.page };
}

function latestLocal(kind) {
  if (!fs.existsSync(DIR)) return null;
  const l = fs.readdirSync(DIR).filter((x) => x.startsWith(kind + '-') && !x.endsWith('.part')).sort((a, b) => Number(b.replace(/\D/g, '')) - Number(a.replace(/\D/g, '')));
  return l.length ? path.join(DIR, l[0]) : null;
}

/** GET /download/android | /download/windows */
async function handle(req, res, kind) {
  const k = KIND[kind];
  if (!k) return send(res, 404, 'Not found');
  const r = await ensure(kind);
  if (!r.file) {
    // ništa nije sačuvano i GitHub ne odgovara: pošalji na stranicu izdanja
    return send(res, 503, 'Aplikacija se upravo priprema. Pokušaj ponovo za minut.');
  }
  const st = fs.statSync(r.file);
  res.writeHead(200, {
    'content-type': k.type, 'content-length': st.size,
    'content-disposition': `attachment; filename="${k.name}"`, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(r.file).pipe(res);
}

/** Pripremi obje aplikacije unaprijed (pri pokretanju i svakih sat vremena), da kupac ne čeka. */
function warm() {
  for (const kind of Object.keys(KIND)) ensure(kind).catch(() => {});
}
let last = 0;
function tick() { if (now() - last > 3600000) { last = now(); warm(); } }

module.exports = { handle, warm, tick };
