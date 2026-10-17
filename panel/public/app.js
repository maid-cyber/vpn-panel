/* VPN panel — interfejs (bez okvira i biblioteka). */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ ikone
  const ICON = {
    dash: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
    users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75',
    plans: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5 12 22.5 22 17.5',
    res: 'M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6',
    levels: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    money: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    report: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
    logs: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1',
    user: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    plus: 'M12 5v14M5 12h14', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
    menu: 'M4 7h16M4 12h16M4 17h16', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
    copy: 'M8 8h12v12H8zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2', down: 'M12 3v12M7 10l5 5 5-5M4 20h16',
    refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', more: 'M5 12h.01M12 12h.01M19 12h.01', back: 'M15 18l-6-6 6-6',
    key: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z', credit: 'M3 6h18v12H3zM3 10h18M7 15h3',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    pin: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    chart: 'M4 20V10M10 20V4M16 20v-7M4 20h18', act: 'M22 12h-4l-3 9L9 3l-3 9H2', check: 'M20 6 9 17l-5-5',
    plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', x: 'M18 6 6 18M6 6l12 12',
    send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', shield: 'M12 3 20 6v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6z',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n] || ''}"/></svg>`;
  // znak brenda (štit sa V)
  const MARK = '<path d="M100 4 190 38v64c0 56-36 98-90 118-54-20-90-62-90-118V38z" style="fill:var(--lg1,#E3172B)"/><path d="M100 22 174 50v52c0 46-29 80-74 97-45-17-74-51-74-97V50z" style="fill:var(--lg0,#121216)"/><path d="M100 22 174 50v52c0 46-29 80-74 97z" fill="#000" fill-opacity=".18"/><path d="M48 70h32l20 68v46z" style="fill:var(--lg1,#E3172B)"/><path d="M152 70h-32l-20 68v46z" style="fill:var(--lg2,#9E0C1A)"/><path d="M48 70h32l2 7H51z" style="fill:var(--lg3,#FF4A5A)"/><path d="M86 58h28l-14 38z" style="fill:var(--lg3,#FF4A5A)"/><path d="M100 58h14l-14 38z" style="fill:var(--lg1,#E3172B)"/>';
  const logo = (w = 34) => `<svg width="${w}" height="${Math.round(w * 1.12)}" viewBox="0 0 200 224" aria-hidden="true">${MARK}</svg>`;
  const LOGO = logo(32);
  // ime brenda: zadnje slovo glavne riječi u boji, "VPN" ide ispod kao na logu
  function wordParts(brand) {
    const b = String(brand || '').trim();
    const m = b.match(/^(.*?)\s+vpn$/i) || b.match(/^vpn\s+(.*)$/i);
    const main = (m ? m[1] : b) || b;
    return { main, sub: m ? 'VPN' : '' };
  }
  const wordHtml = (main) => `${esc(main.slice(0, -1))}<em>${esc(main.slice(-1))}</em>`;

  // ------------------------------------------------------------------ pomoćne
  const S = { me: null, live: null, servers: [], selUser: null, selRes: null, userQ: { status: 'all', q: '', plan: '', owner: '', page: 1 }, sel: new Set(), dashDays: 7 };
  const isRes = () => S.me?.role === 'reseller';
  const can = (p) => !isRes() && (S.me?.role === 'owner' || (S.me?.perms || []).includes(p));

  async function api(method, path, body) {
    const opt = { method, headers: { 'x-requested-with': 'panel' }, credentials: 'same-origin' };
    if (body !== undefined && !(body instanceof Blob)) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    else if (body instanceof Blob) opt.body = body;
    const r = await fetch('api/' + path, opt);
    let j = null;
    try { j = await r.json(); } catch { /* prazno */ }
    if (r.status === 401 && path !== 'login' && path !== 'me') { S.me = null; renderLogin(); throw new Error('Sesija je istekla. Prijavi se ponovo.'); }
    if (!r.ok) throw new Error(j?.error || `Greška ${r.status}`);
    return j;
  }
  const GET = (p) => api('GET', p), POST = (p, b) => api('POST', p, b ?? {}), PUT = (p, b) => api('PUT', p, b), DEL = (p) => api('DELETE', p, {});
  const R = (p) => (isRes() ? 'res/' : '') + p;   // reseller ima svoje putanje

  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), err ? 6000 : 3500);
  }
  const fail = (e) => toast(e.message || String(e), true);
  const cur = () => ({ EUR: '€', USD: '$', BAM: 'KM ', CHF: 'CHF ' }[S.me?.currency] || '€');
  const money = (n) => { n = Number(n || 0); const neg = n < 0; n = Math.abs(n); const [i, f] = (n % 1 ? n.toFixed(2) : String(Math.round(n))).split('.'); return `${neg ? '−' : ''}${cur()}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${f ? ',' + f : ''}`; };
  function bytes(n) {
    n = Number(n || 0);
    if (n >= 1024 ** 4) return (n / 1024 ** 4).toFixed(2) + ' TB';
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(n >= 100 * 1024 ** 3 ? 0 : 1) + ' GB';
    if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + ' MB';
    return n ? (n / 1024).toFixed(0) + ' KB' : '0';
  }
  const p2 = (n) => String(n).padStart(2, '0');
  const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'juni', 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar'];
  const DAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
  const fmtDate = (ts) => { if (!ts) return '—'; const d = new Date(ts); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}.`; };
  const fmtTime = (ts) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const fmtDT = (ts) => { if (!ts) return '—'; const d = new Date(ts); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}. ${fmtTime(ts)}`; };
  const longDate = (d = new Date()) => `${DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1)}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}.`;
  function ago(ts) {
    if (!ts) return 'nikad';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'sada';
    if (s < 3600) return `prije ${Math.floor(s / 60)} min`;
    if (s < 86400) return `prije ${Math.floor(s / 3600)} h`;
    return `prije ${Math.floor(s / 86400)} d`;
  }
  const ST = {
    active: ['Aktivan', 't-ok'], expiring: ['Ističe uskoro', 't-warn'], grace: ['Grace period', 't-warn'],
    expired: ['Istekao', 't-bad'], limited: ['Potrošen promet', 't-orange'], disabled: ['Ugašen', 't-grey'],
    devices: ['Previše uređaja', 't-orange'],
  };
  const stTag = (s) => `<span class="tag ${ST[s]?.[1] || 't-grey'}">${ST[s]?.[0] || s}</span>`;
  const SRV = { online: 'Online', offline: 'Offline', pending: 'Čeka instalaciju', disabled: 'Ugašen', maintenance: 'Održavanje' };
  const srvStatus = (s) => `<span class="status s-${s.warn ? 'warn' : s.status}">${s.warn ? 'Skoro pun' : SRV[s.status] || s.status}</span>`;
  // okrugla zastava (assets/flags/xx.png); za nepoznatu državu ostaju slova
  const FLAGS = new Set('ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cp cr cu cv cw cx cy cz de dg dj dk dm do dz ec ee eg eh er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu ic id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pc pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um un us uy uz va vc ve vg vi vn vu wf ws xk xx ye yt za zm zw'.split(' '));
  const flag = (cc) => { const k = String(cc || '').toLowerCase(); return FLAGS.has(k) ? `<img class="flg" src="assets/flags/${k}.png" alt="${k.toUpperCase()}" loading="lazy">` : esc((cc || '—').toUpperCase()); };
  const daysTxt = (d) => d > 1 ? `za ${d} dana` : d === 1 ? 'sutra' : d === 0 ? 'danas' : `prije ${-d} d`;
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast('Kopirano.'), () => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Kopirano.');
  });

  // ------------------------------------------------------------------ dijalog
  function modal(html, { wide } = {}) {
    const dlg = $('#modal'), form = $('#modalForm');
    form.innerHTML = html;
    dlg.style.width = wide ? 'min(760px, calc(100vw - 24px))' : '';
    if (!dlg.open) dlg.showModal();
    const first = form.querySelector('input:not([type=hidden]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return new Promise((resolve) => {
      const done = (val) => { dlg.removeEventListener('close', onClose); form.onsubmit = null; resolve(val); };
      // close() prethodnog prozora stiže sa zakašnjenjem: ignoriši ga ako je novi prozor već otvoren
      const onClose = () => { if (!dlg.open) done(null); };
      dlg.addEventListener('close', onClose);
      form.onsubmit = (e) => {
        const btn = e.submitter;
        if (!btn || btn.value === 'cancel') return;
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        $$('input[type=checkbox]', form).forEach((c) => { if (c.name && !c.name.endsWith('[]')) data[c.name] = c.checked; });
        data._many = {};
        $$('input[type=checkbox]', form).filter((c) => c.name.endsWith('[]') && c.checked).forEach((c) => (data._many[c.name.slice(0, -2)] ||= []).push(c.value));
        data._btn = btn.value;
        dlg.removeEventListener('close', onClose);
        form.onsubmit = null;
        resolve({ data, close: () => dlg.close(), keep: () => {} });
      };
    });
  }
  async function ask(title, text, okText = 'Potvrdi', danger) {
    const r = await modal(`<h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn ${danger ? 'danger' : 'red'}" value="ok">${esc(okText)}</button></div>`);
    if (r) r.close();
    return !!r;
  }
  // forma koja se ne zatvara dok API ne uspije
  async function formLoop(html, handler, opts) {
    for (;;) {
      const r = await modal(html, opts);
      if (!r) return null;
      try { const out = await handler(r.data); r.close(); return out ?? true; } catch (e) { fail(e); html = $('#modalForm').innerHTML; restoreValues(r.data); }
    }
  }
  function restoreValues(data) {
    setTimeout(() => { for (const [k, v] of Object.entries(data)) { const el = $(`#modalForm [name="${k}"]`); if (el && el.type !== 'checkbox' && typeof v === 'string') el.value = v; } }, 0);
  }


  // ------------------------------------------------------------------ globus iza prijave (canvas, bez vanjskih fajlova)
  function startGlobe(cv) {
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(document.documentElement);
    const acc = (css.getPropertyValue('--acc-hi') || '#ff5a6a').trim();
    const rgb = (h) => { const m = h.replace('#', '').match(/../g) || ['ff', '5a', '6a']; return m.map((x) => parseInt(x, 16)).join(','); };
    const A = rgb(acc.length === 7 ? acc : '#ff5a6a'), B = '120,160,255';
    const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const dots = [];
    for (let lat = -56; lat <= 76; lat += 1.5) {
      const step = 1.5 / Math.max(0.25, Math.cos(lat * Math.PI / 180));
      for (let lon = -180; lon < 180; lon += step) if (LAND.some((p) => inPoly(lon, lat, p))) dots.push([lon * Math.PI / 180, lat * Math.PI / 180]);
    }
    const CITIES = [[18.4, 43.9], [8.7, 50.1], [4.9, 52.4], [-0.1, 51.5], [-74, 40.7], [-79.4, 43.7], [-46.6, -23.5], [55.3, 25.2], [103.8, 1.35], [139.7, 35.7], [151.2, -33.9], [28, -26.2], [29, 41], [8.5, 47.4], [-118.2, 34], [77.2, 28.6], [37.6, 55.8], [-58.4, -34.6]]
      .map(([lo, la]) => [lo * Math.PI / 180, la * Math.PI / 180]);
    const stars = Array.from({ length: 140 }, () => [Math.random(), Math.random(), Math.random() * 1.2 + .3, Math.random() * 6.28]);
    const arcs = [];
    const newArc = () => { const a = CITIES[Math.floor(Math.random() * CITIES.length)]; let b; do { b = CITIES[Math.floor(Math.random() * CITIES.length)]; } while (b === a); return { a, b, t: 0, sp: 0.004 + Math.random() * 0.004 }; };
    for (let i = 0; i < 9; i++) { const x = newArc(); x.t = Math.random(); arcs.push(x); }
    const vec = ([lo, la]) => [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    const slerp = (p, q, t) => { const d = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) || 1e-6, s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d); return [p[0] * s1 + q[0] * s2, p[1] * s1 + q[1] * s2, p[2] * s1 + q[2] * s2]; };
    let W = 0, H = 0, R = 0, cx = 0, cy = 0, rot = -0.3, last = 0;
    const tilt = -0.32, ct = Math.cos(tilt), st = Math.sin(tilt);
    const proj = (v, r = 1) => { // rotacija oko y, pa nagib oko x
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const x = v[0] * cr + v[2] * sr, z0 = -v[0] * sr + v[2] * cr;
      const y = v[1] * ct - z0 * st, z = v[1] * st + z0 * ct;
      return [cx + x * R * r, cy - y * R * r, z];
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = Math.min(W * 0.48, H * 0.6, 720); cx = W / 2; cy = H * 0.6;
      if (W < 700) { R = W * 0.85; cy = H - R * 0.55; }   // telefon: velika Zemlja na dnu ekrana
    };
    size();
    window.addEventListener('resize', size);
    function frame(ts) {
      if (!cv.isConnected) { window.removeEventListener('resize', size); return; }
      const dt = last ? Math.min(50, ts - last) : 16; last = ts;
      if (!document.hidden && !reduce) rot += dt * 0.00007;
      ctx.clearRect(0, 0, W, H);
      // zvijezde
      for (const s of stars) { ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(ts / 1400 + s[3])); ctx.fillStyle = '#cfd8ff'; ctx.fillRect(s[0] * W, s[1] * H, s[2], s[2]); }
      ctx.globalAlpha = 1;
      // atmosfera i kugla
      let g = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.35);
      g.addColorStop(0, `rgba(${B},.28)`); g.addColorStop(0.4, `rgba(${B},.06)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 6.29); ctx.fill();
      g = ctx.createRadialGradient(cx - R * .35, cy - R * .45, R * .1, cx, cy, R);
      g.addColorStop(0, '#13204a'); g.addColorStop(1, '#050a1c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.29); ctx.fill();
      ctx.strokeStyle = `rgba(${B},.35)`; ctx.lineWidth = 1.2; ctx.stroke();
      // kopno (tačke), svjetlije prema sredini
      for (const d of dots) {
        const p = proj(vec(d));
        if (p[2] <= 0) continue;
        ctx.globalAlpha = 0.25 + 0.75 * p[2];
        ctx.fillStyle = '#7fa2ff';
        const r = 1 + 1.6 * p[2];
        ctx.fillRect(p[0] - r / 2, p[1] - r / 2, r, r);
      }
      ctx.globalAlpha = 1;
      // gradovi
      for (const c of CITIES) {
        const p = proj(vec(c)); if (p[2] <= 0.05) continue;
        const pulse = (((ts / 1600 + c[0]) % 1) + 1) % 1;
        ctx.strokeStyle = `rgba(${A},${(1 - pulse) * 0.7 * p[2]})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p[0], p[1], 3 + pulse * 12, 0, 6.29); ctx.stroke();
        ctx.fillStyle = `rgba(${A},${0.9 * p[2] + 0.1})`; ctx.beginPath(); ctx.arc(p[0], p[1], 2.4, 0, 6.29); ctx.fill();
      }
      // lukovi veza sa svjetlom koje putuje
      for (let i = 0; i < arcs.length; i++) {
        const a = arcs[i];
        if (!reduce && !document.hidden) a.t += a.sp * dt / 16;
        if (a.t > 1.6) { arcs[i] = newArc(); continue; }
        const pa = vec(a.a), pb = vec(a.b), N = 48, head = Math.min(1, a.t), tail = Math.max(0, a.t - 0.6);
        let prev = null;
        for (let k = 0; k <= N; k++) {
          const t = tail + (head - tail) * k / N;
          const lift = 1 + 0.1 * Math.sin(Math.PI * t);
          const p = proj(slerp(pa, pb, t), lift);
          if (prev && p[2] > -0.15 && prev[2] > -0.15) {
            ctx.strokeStyle = `rgba(${A},${(k / N) * 0.9})`; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
          }
          prev = p;
        }
        if (a.t <= 1 && prev && prev[2] > -0.15) {
          ctx.shadowColor = `rgb(${A})`; ctx.shadowBlur = 14; ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(prev[0], prev[1], 2.6, 0, 6.29); ctx.fill(); ctx.shadowBlur = 0;
        }
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  const GLOBE = '<canvas class="globe-bg" id="globeBg" aria-hidden="true"></canvas>';

  // ------------------------------------------------------------------ prijava
  let portalInfo = null;
  async function loadPortal() {
    if (!portalInfo) portalInfo = await GET('portal').catch(() => ({}));
    const box = $('#signupBox');
    if (box && portalInfo.signup) box.innerHTML = '<span class="muted">Nemaš nalog?</span> <a href="#" data-a="showSignup">Postani reseller</a>';
  }
  function renderSignup() {
    $('#app').innerHTML = `<div class="login">${GLOBE}<form class="card" id="signupForm">
      <div class="login-logo">${logo(64)}<div class="wordmark" style="font-size:24px">${wordHtml(wordParts(document.title.split(' · ')[0]).main)}</div><div class="login-hint">Registracija za resellere</div></div>
      <label class="field">Korisničko ime<input class="input" name="username" required minlength="3" maxlength="30" autocomplete="username"></label>
      <label class="field">Šifra (bar 8 znakova)<input class="input" name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <label class="field">Kontakt (Telegram, WhatsApp)<input class="input" name="contact" required placeholder="@korisnik ili +387…"></label>
      <label class="field">E-mail (za fakture, opcionalno)<input class="input" name="email" type="email"></label>
      <button class="btn red block" type="submit">Pošalji zahtjev</button>
      <p class="muted" id="signupMsg" role="alert" style="margin:0;min-height:20px"></p>
      <div style="text-align:center"><a href="#" data-a="showLogin">Nazad na prijavu</a></div></form></div>`;
    startGlobe($('#globeBg'));
    $('#signupForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await POST('signup', Object.fromEntries(new FormData(e.target).entries()));
        $('#signupForm').innerHTML = `<div class="login-logo">${logo(64)}<h2>Zahtjev poslan ✓</h2><p class="muted" style="margin:0">Administrator će pregledati tvoj nalog i javiti ti se. Kad bude odobren, prijavi se istim imenom i šifrom.</p></div><a class="btn block" href="#" data-a="showLogin">Nazad na prijavu</a>`;
      } catch (err) { $('#signupMsg').textContent = err.message; $('#signupMsg').style.color = 'var(--bad)'; }
    };
  }
  function renderLogin(need2fa, saved) {
    stopLive();
    $('#app').innerHTML = `<div class="login">${GLOBE}<form class="card" id="loginForm" autocomplete="on">
      ${(() => { const w = wordParts(document.title.split(' · ')[0]); return `<div class="login-logo">${logo(92)}<div><div class="wordmark">${wordHtml(w.main)}</div>${w.sub ? `<div class="wordsub" style="justify-content:center;margin-top:10px"><span>${w.sub}</span></div>` : ''}</div><div class="login-hint">${need2fa ? 'Unesi kod iz aplikacije' : document.documentElement.dataset.portal === 'reseller' ? 'Reseller panel · prijava' : 'Prijava u panel'}</div></div>`; })()}
      ${need2fa ? `<label class="field">Kod iz aplikacije (2FA)<input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <input type="hidden" name="username" value="${esc(saved.username)}"><input type="hidden" name="password" value="${esc(saved.password)}">`
      : `<label class="field">Korisničko ime<input class="input" name="username" autocomplete="username" required></label>
        <label class="field">Šifra<input class="input" name="password" type="password" autocomplete="current-password" required></label>`}
      <button class="btn red block" type="submit">Prijavi se</button>
      <p class="muted" id="loginErr" role="alert" style="margin:0;min-height:20px;color:var(--bad)"></p>
      <div id="signupBox" style="text-align:center;font-size:13.5px"></div></form></div>`;
    startGlobe($('#globeBg'));
    if (document.documentElement.dataset.portal === 'reseller' && !need2fa) loadPortal();
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await POST('login', d);
        if (r.need2fa) return renderLogin(true, d);
        await boot();
      } catch (err) { $('#loginErr').textContent = err.message; }
    };
  }

  // ------------------------------------------------------------------ okvir
  function navItems() {
    if (isRes()) return [{ label: 'Moj panel', items: [['dash', 'Pregled', ''], ['users', 'Moji korisnici', 'korisnici'], ['credit', 'Kredit i uplate', 'kredit']] }];
    const g = [{ label: 'Pregled', items: [['dash', 'Dashboard', '']] }];
    const u = [];
    if (can('users')) u.push(['users', 'Korisnici', 'korisnici', S.badges?.users]);
    if (can('plans')) u.push(['plans', 'Planovi', 'planovi']);
    if (u.length) g.push({ label: 'Korisnici', items: u });
    if (can('resellers')) g.push({ label: 'Reselleri', items: [['res', 'Reselleri', 'reselleri', S.badges?.res], ['levels', 'Nivoi i popusti', 'reselleri/nivoi']] });
    if (can('servers')) g.push({ label: 'Serveri', items: [['server', 'Serveri', 'serveri', S.badges?.servers]] });
    if (can('finance')) g.push({ label: 'Finansije', items: [['money', 'Transakcije', 'finansije'], ['report', 'Izvještaji', 'finansije/izvjestaji']] });
    const s = [];
    if (can('logs')) s.push(['logs', 'Logovi', 'logovi']);
    if (can('settings')) s.push(['gear', 'Postavke', 'postavke']);
    s.push(['user', 'Moj profil', 'profil']);
    g.push({ label: 'Sistem', items: s });
    return g;
  }
  function bottomItems() {
    if (isRes()) return [['dash', 'Pregled', ''], ['users', 'Korisnici', 'korisnici'], ['plus', 'Novi', '#new'], ['credit', 'Kredit', 'kredit'], ['user', 'Profil', 'profil']];
    return [['dash', 'Početna', ''], ['users', 'Korisnici', 'korisnici'], ['server', 'Serveri', 'serveri'], ['res', 'Reselleri', 'reselleri'], ['more', 'Više', 'vise']];
  }
  function renderShell() {
    const me = S.me;
    document.documentElement.dataset.accent = me.accent || 'crvena';
    let lt = null; try { lt = localStorage.getItem('vp-theme'); } catch { /* nema */ }
    document.documentElement.dataset.theme = lt || me.theme || 'tamna';
    $('#app').innerHTML = `<div class="shell" id="shell">
      <aside class="side" id="side" aria-label="Meni">
        <div class="brand">${LOGO}<div><b>${wordHtml(wordParts(me.brand).main)}</b><small>${wordParts(me.brand).sub ? 'VPN · ' : ''}${isRes() ? 'Reseller panel' : 'Admin panel'}</small></div></div>
        <nav class="nav" id="nav"></nav>
        <div class="me"><span class="avatar">${esc(me.username[0])}</span><div><b>${esc(me.username)}</b><small>${isRes() ? `Kredit ${money(me.credit)}` : ({ owner: 'Vlasnik', admin: 'Admin', support: 'Podrška', finance: 'Finansije' }[me.role] || me.role) + (me.totp_on ? ' · 2FA' : '')}</small></div>
          <button class="iconbtn" data-a="logout" aria-label="Odjava" title="Odjava">${ic('logout')}</button></div>
      </aside>
      <div class="scrim" data-a="menu"></div>
      <main class="main" id="main">
        ${me.impersonating ? `<div class="banner">${ic('user')}<span style="flex:1">Gledaš panel kao reseller <b>${esc(me.username)}</b>.</span><button class="btn sm" data-a="stopImp">Vrati se na svoj nalog</button></div>` : ''}
        ${me.maintenance && !isRes() ? `<div class="banner">${ic('gear')}<span style="flex:1">Uključen je režim održavanja. Reselleri i kupci vide poruku, VPN radi.</span><a class="btn sm" href="#/postavke">Postavke</a></div>` : ''}
        <div id="view"></div>
      </main>
      <nav class="bottomnav" id="bottomnav" aria-label="Donji meni"></nav>
    </div>`;
    paintNav();
  }
  function paintNav() {
    const page = location.hash.replace(/^#\/?/, '').split('?')[0];
    const on = (href) => href === page || (href && page.startsWith(href + '/') && !navItems().some((g) => g.items.some((i) => i[2] === page)));
    $('#nav').innerHTML = navItems().map((g) => `<div class="grp"><span>${esc(g.label)}</span>${g.items.map(([i, l, h, b]) =>
      `<a href="#/${h}" class="${on(h) || (!h && !page) ? 'on' : ''}">${ic(i)}<span>${esc(l)}</span>${b ? `<em>${esc(b)}</em>` : ''}</a>`).join('')}</div>`).join('');
    $('#bottomnav').innerHTML = bottomItems().map(([i, l, h]) => h === '#new'
      ? `<a href="#/korisnici" data-a="newUser">${ic(i)}<span>${l}</span></a>`
      : `<a href="#/${h}" class="${on(h) || (!h && !page) ? 'on' : ''}">${ic(i)}<span>${l}</span></a>`).join('');
  }
  const top = (title, sub, actions = '') => `<header class="top">
    <button class="iconbtn burger" data-a="menu" aria-label="Otvori meni">${ic('menu')}</button>
    <div class="grow"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${actions}</header>`;

  // ------------------------------------------------------------------ uživo (SSE)
  function startLive() {
    if (S.live) return;
    try {
      S.live = new EventSource('api/live');
      S.live.onmessage = (e) => {
        const d = JSON.parse(e.data);
        // uživo stižu samo osnovna polja: spoji ih sa punim podacima da se ne izgube verzija, uptime, Xray/WG
        S.servers = d.servers.map((x) => ({ ...(S.servers.find((o) => o.id === x.id) || {}), ...x }));
        const off = d.servers.filter((s) => s.status === 'offline').length;
        const badge = `${d.servers.filter((s) => s.status === 'online').length}/${d.servers.filter((s) => s.status !== 'disabled').length}`;
        if (S.badges && S.badges.servers !== badge) { S.badges.servers = badge; paintNav(); }
        updateMap(d.servers);
        $$('[data-live-srv]').forEach((el) => { const s = d.servers.find((x) => x.id === Number(el.dataset.liveSrv)); if (s) el.outerHTML = `<span data-live-srv="${s.id}">${srvStatus(s)}</span>`; });
        const lt = $('#liveTime'); if (lt) lt.textContent = 'osvježeno ' + fmtTime(d.t);
        void off;
      };
    } catch { /* bez uživo prikaza */ }
  }
  function stopLive() { if (S.live) { S.live.close(); S.live = null; } }

  // ------------------------------------------------------------------ mapa
  const P = (lon, lat) => [(lon + 180) / 360 * 720, (75 - lat) / 130 * 360];
  const LAND = [
    [[-168, 65], [-140, 70], [-95, 72], [-75, 62], [-60, 52], [-66, 44], [-75, 35], [-81, 25], [-97, 26], [-97, 18], [-88, 15], [-83, 9], [-79, 8], [-92, 15], [-105, 20], [-112, 30], [-118, 34], [-124, 40], [-125, 49], [-133, 56], [-150, 60], [-165, 60]],
    [[-55, 60], [-42, 60], [-20, 70], [-25, 75], [-60, 75], [-55, 68]],
    [[-80, 8], [-62, 10], [-50, 0], [-35, -6], [-40, -20], [-48, -26], [-58, -38], [-65, -45], [-70, -54], [-74, -45], [-71, -30], [-70, -18], [-76, -12], [-81, -5]],
    [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [10, 58], [5, 62], [15, 69], [28, 71], [40, 67], [45, 60], [40, 45], [28, 41], [22, 37], [15, 38], [12, 44], [5, 43], [-2, 37]],
    [[-5, 50], [1, 51], [0, 54], [-2, 58], [-6, 58], [-5, 54]],
    [[-17, 21], [-10, 30], [-6, 35], [10, 37], [20, 32], [32, 31], [35, 28], [43, 12], [51, 12], [40, -2], [40, -15], [35, -25], [28, -33], [19, -35], [13, -20], [12, -5], [9, 4], [-8, 5], [-17, 14]],
    [[28, 41], [40, 45], [45, 60], [40, 67], [60, 70], [80, 73], [105, 75], [140, 72], [170, 68], [178, 65], [160, 58], [150, 58], [140, 52], [135, 43], [128, 35], [122, 30], [120, 22], [108, 20], [105, 10], [100, 13], [98, 8], [92, 22], [80, 13], [77, 8], [72, 20], [66, 25], [57, 25], [52, 28], [48, 30], [44, 13], [35, 30], [36, 36]],
    [[95, 5], [105, -6], [115, -8], [125, -9], [140, -6], [150, -6], [140, 0], [120, 2], [110, 2], [100, 3]],
    [[130, 31], [135, 34], [141, 38], [142, 45], [140, 43], [136, 36]],
    [[114, -22], [122, -17], [131, -12], [137, -12], [142, -11], [146, -18], [153, -25], [151, -34], [145, -39], [138, -35], [130, -32], [115, -34]],
  ];
  const LAND_D = LAND.map((poly) => poly.map(([lo, la], i) => (i ? 'L' : 'M') + P(lo, la).map((v) => v.toFixed(1)).join(' ')).join('') + 'Z').join('');
  const mapColor = (s) => s.status === 'online' ? (s.warn ? '#f5a524' : '#3ddc84') : s.status === 'offline' ? '#ff4d5e' : '#8b8b98';
  function markers(servers) {
    // više servera u istom gradu = jedna tačka i jedna oznaka ("Falkenstein ×2")
    const groups = new Map();
    for (const s of servers.filter((s) => s.lat != null && s.lon != null && s.status !== 'disabled')) {
      const k = `${Math.round(s.lat * 2)}:${Math.round(s.lon * 2)}:${s.city || s.name}`;
      groups.set(k, [...(groups.get(k) || []), s]);
    }
    const rank = (s) => s.status === 'offline' ? 3 : s.warn ? 2 : s.status === 'online' ? 1 : 0;
    return [...groups.values()].map((g) => {
      const s = g.reduce((a, b) => (rank(b) > rank(a) ? b : a)), c = mapColor(s), [x, y] = P(s.lon, s.lat);
      return `<div class="mk" style="left:${(x / 7.2).toFixed(2)}%;top:${(y / 3.6).toFixed(2)}%" title="${esc(g.map((v) => v.name).join(', '))}"><b style="background:${c}"></b><i style="background:${c};box-shadow:0 0 10px ${c}"></i><span>${esc(s.city || s.name)}${g.length > 1 ? ` ×${g.length}` : ''}</span></div>`;
    }).join('');
  }
  const mapHtml = (servers) => `<div class="map" id="map"><svg viewBox="0 0 720 360" preserveAspectRatio="none" aria-hidden="true">
    <defs><pattern id="dg" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.25" fill="var(--map-dot)"/></pattern></defs>
    <path d="${LAND_D}" fill="url(#dg)"/></svg><div id="mapMk">${markers(servers)}</div></div>`;
  function updateMap(servers) { const m = $('#mapMk'); if (m) { m.innerHTML = markers(servers); placeLabels(); } }
  // oznake gradova koji su blizu (npr. Falkenstein i Helsinki) ne smiju se preklapati:
  // svaka oznaka uzme prvo slobodno mjesto oko svoje tačke
  const SPOTS = ['', 'sb', 'sl', 'sb sl', 'sr', 'sl2', 'sb2', 'sb2 sl'];
  function placeLabels() {
    const map = $('#map'); if (!map) return;
    const box = map.getBoundingClientRect(); if (!box.width) return;
    const mks = [...map.querySelectorAll('.mk')].sort((a, b) => a.offsetTop - b.offsetTop || a.offsetLeft - b.offsetLeft);
    const dots = mks.map((m) => { const r = m.getBoundingClientRect(); return { left: r.left - 16, right: r.left + 16, top: r.top - 14, bottom: r.top + 14, m }; });
    const hit = (a, b) => a.left < b.right + 3 && a.right + 3 > b.left && a.top < b.bottom + 3 && a.bottom + 3 > b.top;
    const placed = [];
    for (const m of mks) {
      const sp = m.querySelector('span'); if (!sp) continue;
      let best = null, bestScore = Infinity;
      for (const s of SPOTS) {
        m.className = 'mk' + (s ? ' ' + s.split(' ').map((c) => 'mk-' + c).join(' ') : '');
        const r = sp.getBoundingClientRect();
        const out = Math.max(0, box.left - r.left) + Math.max(0, r.right - box.right) + Math.max(0, box.top - r.top) + Math.max(0, r.bottom - box.bottom);
        const score = placed.filter((p) => hit(r, p)).length * 1000 + dots.filter((d) => d.m !== m && hit(r, d)).length * 100 + out;
        if (score < bestScore) { bestScore = score; best = { s, r }; }
        if (score === 0) break;
      }
      m.className = 'mk' + (best.s ? ' ' + best.s.split(' ').map((c) => 'mk-' + c).join(' ') : '');
      placed.push(best.r);
    }
  }

  // ------------------------------------------------------------------ grafikon
  function barsChart(series, valueKey, lineKey) {
    const W = 700, H = 180, peak = Math.max(0, ...series.map((d) => d[valueKey])), mag = peak > 0 ? 10 ** Math.floor(Math.log10(peak)) : 1, nice = Math.max(4, Math.ceil(peak / mag) * mag), max = nice * 1.08, maxL = Math.max(1, ...series.map((d) => d[lineKey] || 0)) * 1.15;
    const n = series.length, slot = (W - 40) / n, bw = Math.max(3, Math.min(44, slot * 0.6));
    let bars = '', last = '', line = '';
    series.forEach((d, i) => {
      const h = d[valueKey] / max * (H - 20), x = 40 + i * slot + (slot - bw) / 2;
      const r = `M${x.toFixed(1)} ${(H - h).toFixed(1)}h${bw.toFixed(1)}v${h.toFixed(1)}h${(-bw).toFixed(1)}z`;
      if (i === n - 1) last = r; else bars += r;
      if (lineKey) line += `${i ? 'L' : 'M'}${(40 + i * slot + slot / 2).toFixed(1)} ${(H - (d[lineKey] || 0) / maxL * (H - 20)).toFixed(1)}`;
    });
    const gy = (f) => H - f * nice / max * (H - 20);
    const grid = [0.25, 0.5, 0.75, 1].map((f) => `<path d="M40 ${gy(f).toFixed(0)}H${W}" stroke="var(--line)"/><text x="0" y="${(gy(f) + 4).toFixed(0)}" fill="var(--dim)" font-size="11">${esc(money(Math.round(nice * f * 100) / 100))}</text>`).join('');
    const step = Math.ceil(n / 10);
    const labels = series.map((d, i) => (i % step === 0 || i === n - 1) ? `<span>${esc(d.day.slice(8))}.${esc(d.day.slice(5, 7))}.</span>` : '<span></span>').join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:200px;display:block" role="img" aria-label="Grafikon zarade i prometa">${grid}
      <path d="${bars}" fill="var(--acc)" opacity=".55"/><path d="${last}" fill="var(--acc)"/>${lineKey ? `<path d="${line}" fill="none" stroke="#8fb4ff" stroke-width="2.5" stroke-linejoin="round"/>` : ''}</svg>
      <div class="chart-days" style="grid-template-columns:repeat(${n},minmax(0,1fr));margin-left:5.7%">${labels}</div>`;
  }

  // ================================================================== DASHBOARD (admin)
  // mala linija u kartici
  function spark(vals, color) {
    const v = vals.length > 1 ? vals : [0, ...vals, 0];
    const max = Math.max(1e-9, ...v), W = 100, H = 40, step = W / (v.length - 1);
    const pts = v.map((x, i) => [i * step, H - 4 - (x / max) * (H - 10)]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const id = 'sg' + Math.random().toString(36).slice(2, 7);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d}L${W} ${H}L0 ${H}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  // grafikon zarade (linija sa sjenom) i prometa
  function areaChart(series, W = 520) {
    const H = 250, L = 46, B = 24, T = 10, n = series.length;
    const peak = Math.max(0, ...series.map((d) => d.rev)), mag = peak > 0 ? 10 ** Math.floor(Math.log10(peak)) : 1, nice = Math.max(4, Math.ceil(peak / mag) * mag);
    const maxT = Math.max(1, ...series.map((d) => d.traffic || 0)) * 1.1;
    const x = (i) => L + 6 + (n === 1 ? 0 : i * (W - L - 30) / (n - 1)), y = (v, m) => T + (H - B - T) * (1 - v / m);
    const path = (key, m) => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key] || 0, m).toFixed(1)}`).join('');
    const rev = path('rev', nice), tr = path('traffic', maxT);
    const grid = [0, .25, .5, .75, 1].map((f) => `<path d="M${L} ${y(nice * f, nice).toFixed(0)}H${W - 10}" stroke="var(--line)" stroke-dasharray="${f ? '3 4' : ''}"/><text x="${L - 8}" y="${(y(nice * f, nice) + 4).toFixed(0)}" text-anchor="end" fill="var(--dim)" font-size="12">${esc(money(Math.round(nice * f * 100) / 100))}</text>`).join('');
    const step = Math.ceil(n / 7);
    const lbl = series.map((d, i) => (i % step === 0 || i === n - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--dim)" font-size="12">${esc(d.day.slice(8))}.${esc(d.day.slice(5, 7))}.</text>` : '').join('');
    const dots = n <= 31 ? series.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.rev, nice).toFixed(1)}" r="3" fill="var(--bg)" stroke="var(--acc-hi)" stroke-width="2"><title>${esc(d.day)}: ${esc(money(d.rev))} · ${esc(bytes(d.traffic || 0))}</title></circle>`).join('') : '';
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Grafikon zarade i prometa">
      <defs><linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acc-hi)" stop-opacity=".35"/><stop offset="1" stop-color="var(--acc-hi)" stop-opacity="0"/></linearGradient>
      <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".28"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${tr}L${x(n - 1)} ${H - B}L${L} ${H - B}Z" fill="url(#ag2)"/><path d="${tr}" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="${rev}L${x(n - 1)} ${H - B}L${L} ${H - B}Z" fill="url(#ag1)"/><path d="${rev}" fill="none" stroke="var(--acc-hi)" stroke-width="2.6" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px var(--acc))"/>${dots}${lbl}</svg>`;
  }
  const CONT = {
    eu: 'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA',
    na: 'US CA MX GT HN SV NI CR PA CU DO HT JM BS PR', sa: 'BR AR CL CO PE VE EC BO PY UY GY SR',
    as: 'CN JP KR IN ID TH VN MY SG PH PK BD TR IR IQ SA AE IL JO KW QA BH OM KZ UZ AZ GE AM HK TW LK NP MN AF SY LB YE KG TJ TM MM KH LA',
    af: 'ZA EG NG KE MA DZ TN ET GH TZ UG SN CI CM AO ZW ZM MZ LY SD RW', oc: 'AU NZ FJ PG',
  };
  const contOf = (cc) => Object.keys(CONT).find((k) => CONT[k].split(' ').includes(String(cc || '').toUpperCase())) || 'eu';
  const CONT_NAME = { eu: 'Evropa', na: 'Sjeverna Amerika', sa: 'Južna Amerika', as: 'Azija', af: 'Afrika', oc: 'Okeanija' };
  let regionNames = null;
  const ccName = (cc) => { try { regionNames = regionNames || new Intl.DisplayNames(['bs', 'hr', 'en'], { type: 'region' }); return regionNames.of(String(cc).toUpperCase()); } catch { return String(cc).toUpperCase(); } };
  const uptimeStr = (sec) => sec ? `${Math.floor(sec / 86400)} d ${Math.floor(sec % 86400 / 3600)} h` : '—';
  const actKind = (a) => /greš|error|ne odgovara|blok|obris/i.test(a.action + ' ' + a.kind) ? 'bad' : a.kind === 'warn' ? 'warn' : /uplat|kredit|transak|plat/i.test(a.action) ? 'info' : '';
  const actIcon = (a) => /korisnik/i.test(a.action) ? 'user' : /server/i.test(a.action) ? 'server' : /uplat|kredit|plat|transak/i.test(a.action) ? 'money' : /prijav/i.test(a.action) ? 'key' : 'act';

  async function pageDash() {
    const d = await GET(`dash?days=${S.dashDays}`);
    S.servers = d.servers;
    const mon = MONTHS[new Date().getMonth()];
    const offline = d.servers.filter((s) => s.status === 'offline');
    const enabled = d.servers.filter((s) => s.enabled);
    const active = d.counts.active + d.counts.expiring + d.counts.grace;
    const todayNew = d.series.length ? d.series[d.series.length - 1].users : 0;
    const revPct = d.revYesterday ? Math.round((d.revToday - d.revYesterday) / d.revYesterday * 100) : 0;
    const avail = enabled.length ? Math.round(d.online / enabled.length * 100) : 0;
    const kpi = (color, icon, label, value, sub, subCls, sparkVals, corner = '') => `<div class="kpi" style="--k:${color}">
      <div class="ki">${ic(icon)}</div><div class="kl">${label}</div><div class="kv">${value}</div><div class="ks ${subCls}">${sub}</div>
      ${sparkVals ? spark(sparkVals, color) : ''}${corner ? `<span class="kc">${ic(corner)}</span>` : ''}</div>`;
    const cont = {}; for (const k of Object.keys(CONT_NAME)) cont[k] = 0;
    for (const s of enabled) cont[contOf(s.country)]++;
    const mainCont = Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0];
    const det = d.servers.find((s) => s.status === 'online') || d.servers[0];
    const warnCount = d.warnings.length;
    $('#view').innerHTML = `<div class="dashv">
      <header class="top">
        <button class="iconbtn burger" data-a="menu" aria-label="Otvori meni">${ic('menu')}</button>
        <div class="grow hello"><span class="hi-ic hide-m">${ic('user')}</span><div><h1>Dobrodošao, <em>${esc(S.me.username)}</em> 👋</h1>
          <div class="sub">${longDate()} · ${offline.length ? `<span class="bad">${offline.length} server ne odgovara</span>` : 'sve radi normalno'}</div></div></div>
        <label class="search hide-m" style="flex:0 1 340px">${ic('search')}<span class="sr">Pretraga korisnika</span><input id="dashSearch" placeholder="Pretraži korisnike…"><span class="kbd">Ctrl K</span></label>
        <div style="position:relative"><button class="iconbtn" data-a="dashBell" aria-label="Obavijesti">${ic('bell')}${warnCount ? `<span class="cnt">${warnCount}</span>` : ''}</button>
          <div class="pop" id="bellPop" hidden>${warnCount ? d.warnings.map((w) => `<div class="tag t-${w.kind === 'red' ? 'bad' : w.kind === 'amber' ? 'warn' : 'info'}" style="white-space:normal;padding:9px 11px;font-weight:500">${esc(w.text)}</div>`).join('') : '<span class="muted">Nema novih obavijesti.</span>'}</div></div>
        <button class="iconbtn hide-m" data-a="toggleTheme" aria-label="Svijetla ili tamna tema" title="Tema">${ic(document.documentElement.dataset.theme === 'svijetla' ? 'moon' : 'sun')}</button>
        ${can('settings') ? `<a class="iconbtn hide-m" href="#/postavke" aria-label="Postavke" title="Postavke">${ic('gear')}</a>` : ''}
        ${can('users') ? `<button class="btn red" data-a="newUser">${ic('plus')}<span>Novi korisnik</span></button>` : ''}
      </header>

      <section class="kpis">
        ${kpi('#3ddc84', 'users', 'Aktivni korisnici', active, `+${todayNew} danas`, 'ok', d.series.map((x) => x.users))}
        ${kpi('#a855f7', 'clock', 'Ističu uskoro', d.counts.expiring, d.counts.expiring ? '<a href="#/korisnici?status=expiring">Pogledaj listu →</a>' : 'nema', 'warn', null, 'users')}
        ${kpi('#3b82f6', 'server', 'Serveri online', `${d.online} / ${d.serversTotal}`, offline.length ? `<span class="bad">${offline.map((s) => esc(s.name)).join(', ')} ne radi</span>` : `${avail}% dostupnost`, 'ok', null, 'server')}
        ${kpi('#f5a524', 'money', 'Zarada danas', money(d.revToday), `${revPct >= 0 ? '+' : ''}${revPct}% od jučer`, revPct >= 0 ? 'ok' : 'bad', d.series.map((x) => x.rev))}
        ${kpi('#8b5cf6', 'shield', 'Aktivne sesije', d.connected, 'trenutno <b class="ok">online</b>', 'muted', d.series.map((x) => x.traffic))}
      </section>

      <div class="dgrid">
        <section class="card p" style="min-width:0">
          <div class="ch"><h2>${ic('chart')}Zarada i promet</h2>
            <div class="legend"><span><i style="background:var(--acc-hi)"></i>Zarada</span><span><i style="background:#8b5cf6"></i>Promet</span></div>
            <div class="seg" role="group" aria-label="Period">${[7, 30, 90].map((n) => `<button type="button" class="${S.dashDays === n ? 'on' : ''}" data-a="dashDays" data-n="${n}">${n === 7 ? 'Zadnjih 7 dana' : n + ' dana'}</button>`).join('')}</div></div>
          <div class="chartwrap"><div style="min-width:0" id="chartBox"></div>
            <div class="sumcol"><div><small>Ukupna zarada</small><b>${money(d.totals.rev)}</b></div><div><small>Ukupni promet</small><b>${bytes(d.totals.traffic)}</b></div>
              <div><small>Novi korisnici</small><b>${d.totals.newUsers}</b></div><div><small>Produženja</small><b>${d.totals.renewals}</b></div><div><small>Aktivni planovi</small><b>${d.activePlans}</b></div></div></div>
        </section>
        <section class="card p" style="min-width:0">
          <div class="ch"><h2>${ic('server')}Status servera</h2>${offline.length ? `<span class="pill bad">${offline.length} offline</span>` : d.online ? '<span class="pill">Online</span>' : '<span class="pill grey">Nema servera</span>'}</div>
          ${d.servers.slice(0, 3).map((s) => `<div class="srvcard"><div style="display:flex;align-items:center;gap:12px"><span class="ccb">${s.country ? flag(s.country) : ic('server')}</span>
              <div style="flex:1;min-width:0"><b>${esc(s.name)}</b><div class="dim mono" style="font-size:12px">${esc(s.host || '')}</div></div><span data-live-srv="${s.id}">${srvStatus(s)}</span></div>
              <div style="display:flex;gap:16px;font-size:13px;color:var(--soft)"><span>${ic('users')} ${s.online} / ${s.capacity}</span><span>${ic('down')} ${bytes(s.traffic_month)} / mj.</span></div>
              <div class="bar"><i class="${s.warn ? 'w' : ''}" style="width:${Math.min(100, s.online / (s.capacity || 1) * 100)}%"></i></div></div>`).join('') || '<div class="muted">Još nema servera.</div>'}
          ${d.servers.length > 3 ? `<div class="dim" style="font-size:12.5px;margin-top:8px">+ još ${d.servers.length - 3}</div>` : ''}
          <a class="btn red block" style="margin-top:14px" href="#/serveri">Upravljaj serverima</a>
        </section>
        <section class="card p">
          <div class="ch"><h2>${ic('bolt')}Brze akcije</h2></div>
          <div class="qa">
            ${can('users') ? `<button class="btn red full" data-a="newUser">${ic('plus')}Dodaj korisnika</button>` : ''}
            ${can('resellers') ? `<a class="btn" href="#/reselleri">${ic('credit')}Reselleri i kredit</a>` : ''}
            ${can('servers') ? `<button class="btn" data-a="newServer">${ic('server')}Dodaj server</button>` : ''}
            ${can('finance') ? `<button class="btn" data-a="newTx" data-type="expense">${ic('money')}Upiši trošak</button>` : ''}
            ${can('users') ? `<a class="btn" href="#/korisnici?status=expiring">${ic('clock')}Ističu uskoro</a>` : ''}
            ${can('plans') ? `<a class="btn" href="#/planovi">${ic('plans')}Planovi</a>` : ''}
            ${can('finance') ? `<a class="btn" href="#/finansije/izvjestaji">${ic('report')}Izvještaji</a>` : ''}
          </div>
          ${d.warnings.length ? `<div class="warns">${d.warnings.map((w) => `<div class="tag t-${w.kind === 'red' ? 'bad' : w.kind === 'amber' ? 'warn' : 'info'}" style="white-space:normal;padding:8px 10px;font-weight:500">${esc(w.text)}</div>`).join('')}</div>` : ''}
        </section>
      </div>

      <div class="dgrid2">
        <section class="card p" style="min-width:0">
          <div class="ch"><h2>${ic('globe')}Mapa servera · uživo</h2>
            <div class="legend"><span><i style="background:#3ddc84"></i>Online</span><span><i style="background:#f5a524"></i>Skoro pun</span><span><i style="background:#ff4d5e"></i>Offline</span><span class="dim" id="liveTime"></span></div></div>
          <div class="mapwrap">
            <div class="regions">${Object.keys(CONT_NAME).map((k) => `<div class="${k === mainCont && cont[k] ? 'on' : ''}"><span>${CONT_NAME[k]}</span><b>${cont[k]}</b></div>`).join('')}
              <span class="pill" style="margin-top:8px;align-self:flex-start">${d.online} ${d.online === 1 ? 'server' : 'servera'} online</span></div>
            <div style="min-width:0">${mapHtml(d.servers)}</div>
          </div>
          <div class="protos"><span class="${d.protocols.vless ? 'on' : 'off'}">VLESS Reality</span><span class="${d.protocols.ss ? 'on' : 'off'}">Shadowsocks 2022</span><span class="${d.protocols.wg ? 'on' : 'off'}">WireGuard</span>
            <span style="margin-left:auto" class="dim">${d.servers.some((s) => s.lat == null) ? 'Server se pojavi na mapi kad se prvi put javi panelu.' : 'Spojeno sada: ' + d.connected}</span></div>
        </section>
        <section class="card p" style="min-width:0">
          <div class="ch"><h2>${ic('pin')}Korisnici po lokacijama</h2><span class="pill">Live</span></div>
          ${d.countries.length ? d.countries.map((c) => `<div class="loc"><span class="ccb sm">${flag(c.cc)}</span><b style="font-weight:500">${esc(ccName(c.cc))}</b><span class="muted" style="font-size:12.5px">${c.pct}%</span><div class="bar"><i style="width:${c.pct}%"></i></div></div>`).join('')
            : '<div class="muted" style="font-size:13px">Još nema podataka. Pojavi se čim se kupci spoje.</div>'}
          <small class="dim" style="display:block;border-top:1px solid var(--line);padding-top:10px;margin-top:6px">Zadnjih 30 dana. Bilježi se samo država, IP adresa se ne čuva.</small>
        </section>
        <div class="col">
          ${det ? `<section class="card p"><div class="ch" style="margin-bottom:10px"><h2>${ic('server')}Detalji servera</h2><a href="#/serveri" style="font-size:13px">Svi →</a></div>
            <div class="kv2"><span>Naziv</span><b>${esc(det.name)}</b><span>Lokacija</span><b>${esc([det.city, det.country].filter(Boolean).join(', ') || '—')}</b>
              <span>IP adresa</span><b class="mono">${esc(det.host || '—')}</b><span>Status</span><b><span data-live-srv="${det.id}">${srvStatus(det)}</span></b>
              <span>Uptime</span><b>${uptimeStr(det.uptime)}</b><span>Verzija</span><b>${esc(det.version || '—')}</b>
              <span>CPU</span><b style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span class="bar" style="width:90px"><i style="width:${Math.round(det.cpu || 0)}%"></i></span>${Math.round(det.cpu || 0)}%</b>
              <span>RAM</span><b style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><span class="bar" style="width:90px"><i style="width:${Math.round(det.ram || 0)}%"></i></span>${Math.round(det.ram || 0)}%</b></div></section>` : ''}
          <section class="card p"><div class="ch" style="margin-bottom:6px"><h2>${ic('act')}Zadnje aktivnosti</h2>${can('logs') ? '<a href="#/logovi" style="font-size:13px">Sve →</a>' : ''}</div>
            ${d.activity.slice(0, 6).map((a) => `<div class="act"><span class="ai ${actKind(a)}">${ic(actIcon(a))}</span><p>${esc(a.action)}<small>${esc(a.actor)}${a.detail ? ' · ' + esc(a.detail) : ''}</small></p><time title="${esc(fmtDT(a.ts))}">${ago(a.ts)}</time></div>`).join('') || '<div class="muted">Nema aktivnosti.</div>'}</section>
        </div>
      </div>

      ${d.top.length ? `<section class="card p">
        <div class="ch"><h2>${ic('res')}Top reselleri · ${mon}</h2><a href="#/reselleri" style="font-size:13px">Svi →</a></div>
        <div class="grid-auto">${d.top.map((r, i) => `<div class="srvcard" style="margin:0;flex-direction:row;align-items:center"><span class="ccb sm">${i + 1}</span><div style="flex:1;min-width:0"><b>${esc(r.username)}</b><div class="muted" style="font-size:12px">${r.users} korisnika${r.level ? ' · ' + esc(r.level) : ''}</div></div><b class="num">${money(r.rev)}</b></div>`).join('')}</div>
      </section>` : ''}</div>`;
    const sInp = $('#dashSearch');
    if (sInp) sInp.onkeydown = (e) => { if (e.key === 'Enter') { S.userQ = { ...S.userQ, q: sInp.value, status: 'all', page: 1 }; location.hash = '#/korisnici'; } };
    // grafikon se crta u stvarnoj širini (tekst ostaje iste veličine na svakom ekranu)
    const drawChart = () => { const box = $('#chartBox'); if (box) box.innerHTML = areaChart(d.series, Math.max(300, Math.round(box.clientWidth))); };
    drawChart();
    S.chartRO?.disconnect();
    if (window.ResizeObserver && $('#chartBox')) { let w = 0; S.chartRO = new ResizeObserver((e) => { const nw = Math.round(e[0].contentRect.width); if (Math.abs(nw - w) > 8) { w = nw; drawChart(); } }); S.chartRO.observe($('#chartBox')); }
    placeLabels();
    S.mapRO?.disconnect();
    if (window.ResizeObserver && $('#map')) { let w = 0; S.mapRO = new ResizeObserver((e) => { const nw = Math.round(e[0].contentRect.width); if (Math.abs(nw - w) > 4) { w = nw; placeLabels(); } }); S.mapRO.observe($('#map')); }
    startLive();
  }
  const SRVCOLS = '1.5fr 1fr .7fr 1.4fr 1fr 1fr';
  function trow(cells, head, cols, labels = []) {
    return `<div class="tr${head ? ' th' : ''}" style="grid-template-columns:${cols}">${cells.map((c, i) => `<div class="cell${i === 0 ? ' first' : ''}"${!head && labels[i] ? ` data-l="${esc(labels[i])}"` : ''}>${c}</div>`).join('')}</div>`;
  }

  // ================================================================== DASHBOARD (reseller)
  async function pageResDash() {
    const d = await GET('res/dash');
    S.me.credit = d.credit;
    const c = d.counts;
    $('#view').innerHTML = `
      ${top(`Zdravo, ${S.me.username}`, d.level ? `Nivo ${esc(d.level.name)} · popust ${Math.round(d.level.discount * 100)}%` : 'Reseller panel', `<button class="btn red" data-a="newUser">${ic('plus')}<span>Novi korisnik</span></button>`)}
      <section class="stats">
        <div class="stat"><div class="l"><span>Moj kredit</span>${ic('credit')}</div><div class="v">${money(d.credit)}</div><div class="s"><a href="#/kredit">Dopuni kredit →</a></div></div>
        <div class="stat"><div class="l"><span>Aktivni korisnici</span>${ic('users')}</div><div class="v">${c.active + c.expiring + c.grace}</div><div class="s muted">od ${c.all} ukupno · limit ${d.limit}</div></div>
        <div class="stat"><div class="l"><span>Ističu uskoro</span>${ic('bell')}</div><div class="v">${c.expiring}</div><div class="s warn">${c.expiring ? '<a href="#/korisnici?status=expiring">Produži ih →</a>' : 'nema'}</div></div>
        <div class="stat"><div class="l"><span>Istekli</span>${ic('users')}</div><div class="v">${c.expired}</div><div class="s muted">mogu se produžiti</div></div>
      </section>
      <div class="grid2">
        <section class="card">
          <div class="card-head"><h2>Moje cijene</h2></div>
          <div class="tbl">${trow(['Plan', 'Trajanje', 'Promet', 'Tvoja cijena'], true, '2fr 1fr 1fr 1fr')}${d.plans.map((p) => trow([`<b>${esc(p.name)}</b>`, `${p.days} dana`, p.traffic_gb ? p.traffic_gb + ' GB' : 'neograničeno', p.trial ? '<span class="tag t-info">besplatno</span>' : `<b class="num">${money(p.price)}</b>`], false, '2fr 1fr 1fr 1fr', ['', 'Trajanje', 'Promet', 'Cijena'])).join('')}</div>
        </section>
        <section class="card p">
          <h2 style="margin-bottom:10px">Serveri</h2>
          ${d.servers.map((s) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--row)"><span><b class="dim">${flag(s.country)}</b> ${esc(s.city || s.name)}</span>${srvStatus(s)}</div>`).join('') || '<span class="muted">Nema servera.</span>'}
        </section>
      </div>
      <section class="card p"><h2 style="margin-bottom:8px">Zadnje aktivnosti</h2>
        <div class="hist">${d.activity.map((a) => `<div><span>${fmtDT(a.ts)}</span><span><b>${esc(a.username || '')}</b> · ${esc(a.text)}</span></div>`).join('') || '<span class="muted">Još ništa.</span>'}</div></section>`;
  }

  // ================================================================== KORISNICI
  async function pageUsers(params) {
    if (params.get('status')) S.userQ.status = params.get('status');
    const q = S.userQ;
    const qs = new URLSearchParams({ status: q.status, q: q.q, plan: q.plan, owner: q.owner, page: q.page });
    const [d, plans, resellers] = await Promise.all([
      GET(R('users') + '?' + qs), isRes() ? Promise.resolve(null) : GET('plans').catch(() => []),
      !isRes() && can('resellers') ? GET('resellers').catch(() => []) : Promise.resolve([]),
    ]);
    S.plans = plans; S.resellers = resellers;
    const chips = [['all', 'Svi', d.counts.all], ['active', 'Aktivni', d.counts.active + d.counts.expiring + d.counts.grace], ['expiring', 'Ističu', d.counts.expiring], ['expired', 'Istekli', d.counts.expired], ['limited', 'Potrošen promet', d.counts.limited], ['disabled', 'Ugašeni', d.counts.disabled], ...(d.counts.devices ? [['devices', 'Previše uređaja', d.counts.devices]] : [])];
    const cols = isRes() ? '1.6fr 1.2fr 1.4fr 1fr .9fr' : '28px 1.6fr 1.1fr 1fr 1.3fr 1fr .9fr';
    const wide = innerWidth >= 960;
    $('#view').innerHTML = `
      ${top(isRes() ? 'Moji korisnici' : 'Korisnici', `${d.counts.all} korisnika`, `
        ${!isRes() ? `<button class="btn hide-m" data-a="bulk" ${S.sel.size ? '' : 'disabled'}>Masovne akcije${S.sel.size ? ` (${S.sel.size})` : ''}</button>
        <a class="btn hide-m" href="api/users.csv">${ic('down')}Izvoz CSV</a>
        <button class="btn hide-m" data-a="broadcast">${ic('send')}Poruka svima</button>` : ''}
        <button class="btn red" data-a="newUser">${ic('plus')}<span>Novi korisnik</span></button>`)}
      <div class="chips">${chips.map(([k, l, n]) => `<button type="button" class="chip ${q.status === k ? 'on' : ''}" data-a="uStatus" data-k="${k}">${l}<span>${n}</span></button>`).join('')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <label class="search">${ic('search')}<span class="sr">Pretraga</span><input id="uSearch" value="${esc(q.q)}" placeholder="Ime, bilješka, kontakt…"></label>
        ${plans ? `<label style="flex:1 1 150px;max-width:220px"><span class="sr">Plan</span><select class="input" id="uPlan"><option value="">Svi planovi</option>${plans.map((p) => `<option value="${p.id}" ${String(p.id) === q.plan ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        ${resellers.length ? `<label style="flex:1 1 150px;max-width:220px"><span class="sr">Vlasnik</span><select class="input" id="uOwner"><option value="">Svi vlasnici</option><option value="me" ${q.owner === 'me' ? 'selected' : ''}>Samo moji</option>${resellers.map((r) => `<option value="${r.id}" ${String(r.id) === q.owner ? 'selected' : ''}>${esc(r.username)}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="split">
        <section class="card wide" style="overflow:hidden">
          <div class="tbl">
            ${trow(isRes() ? ['Korisnik', 'Plan', 'Promet', 'Ističe', 'Status'] : [`<input type="checkbox" class="cb" data-a="selAll" aria-label="Izaberi sve" ${d.users.length && d.users.every((u) => S.sel.has(u.id)) ? 'checked' : ''}>`, 'Korisnik', 'Plan', 'Server', 'Promet', 'Ističe', 'Status'], true, cols)}
            ${d.users.map((u) => userRow(u, cols)).join('') || `<div class="empty">Nema korisnika${q.q || q.status !== 'all' ? ' za ovaj filter' : ''}. <button class="btn sm red" data-a="newUser">Dodaj korisnika</button></div>`}
          </div>
          <div class="pager"><span>Stranica ${d.page} od ${d.pages} · ${d.total} rezultata</span>
            <button class="btn sm" data-a="uPage" data-p="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>← Prethodna</button>
            <button class="btn sm" data-a="uPage" data-p="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Sljedeća →</button></div>
        </section>
        ${wide ? `<section class="card p narrow" id="uDetail">${S.selUser ? '<div class="muted">Učitavam…</div>' : '<div class="empty">Klikni korisnika da vidiš detalje, QR kod i akcije.</div>'}</section>` : ''}
      </div>`;
    let t;
    $('#uSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.userQ = { ...S.userQ, q: e.target.value, page: 1 }; pageUsers(new URLSearchParams()).then(() => { const i = $('#uSearch'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
    if ($('#uPlan')) $('#uPlan').onchange = (e) => { S.userQ.plan = e.target.value; S.userQ.page = 1; pageUsers(new URLSearchParams()); };
    if ($('#uOwner')) $('#uOwner').onchange = (e) => { S.userQ.owner = e.target.value; S.userQ.page = 1; pageUsers(new URLSearchParams()); };
    if (wide && S.selUser) loadUserDetail(S.selUser, $('#uDetail')).catch(() => { S.selUser = null; });
  }
  function userRow(u, cols) {
    const pct = u.traffic_limit ? Math.min(100, u.traffic_used / u.traffic_limit * 100) : 0;
    const traffic = `<div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:12.5px">${bytes(u.traffic_used)} / ${u.traffic_limit ? bytes(u.traffic_limit) : '∞'}</span>${u.traffic_limit ? `<div class="bar"><i class="${pct >= 100 ? 'w' : ''}" style="width:${pct}%"></i></div>` : ''}</div>`;
    const exp = `<span class="${u.status === 'expired' ? 'bad' : u.status === 'expiring' || u.status === 'grace' ? 'warn' : ''}">${daysTxt(u.days_left)}</span><small>${fmtDate(u.expires_at)}</small>`;
    const name = `<b>${esc(u.username)}</b><small>${esc(isRes() ? u.contact || u.note || '' : u.owner ? 'reseller · ' + u.owner : u.note || u.contact || 'tvoj korisnik')}</small>`;
    const cells = isRes() ? [name, esc(u.plan || '—'), traffic, exp, stTag(u.status)]
      : [`<input type="checkbox" class="cb" data-a="selOne" data-id="${u.id}" aria-label="Izaberi ${esc(u.username)}" ${S.sel.has(u.id) ? 'checked' : ''}>`, name, esc(u.plan || '—'), `<span class="muted">${esc(u.last_server || '—')}</span><small>${u.last_seen ? ago(u.last_seen) : 'nije se spajao'}</small>`, traffic, exp, stTag(u.status)];
    const labels = isRes() ? ['', 'Plan', 'Promet', 'Ističe', 'Status'] : ['', '', 'Plan', 'Server', 'Promet', 'Ističe', 'Status'];
    return `<div class="tr click ${S.selUser === u.id ? 'sel' : ''}" data-a="openUser" data-id="${u.id}" style="grid-template-columns:${cols}">${cells.map((c, i) => `<div class="cell${(isRes() ? i === 0 : i === 1) ? ' first' : ''}${!isRes() && i === 0 ? ' cbx' : ''}"${labels[i] ? ` data-l="${labels[i]}"` : ''}>${c}</div>`).join('')}</div>`;
  }

  async function loadUserDetail(id, box, full) {
    const u = await GET(R('users/' + id));
    const pct = u.traffic_limit ? Math.min(100, u.traffic_used / u.traffic_limit * 100) : 0;
    box.innerHTML = `
      ${full ? `<a href="#/korisnici" class="btn sm ghost" style="align-self:flex-start;margin-bottom:6px">${ic('back')}Nazad</a>` : ''}
      <div style="display:flex;align-items:center;gap:12px">
        <span class="avatar" style="width:44px;height:44px;border-radius:12px;font-size:18px">${esc(u.username[0])}</span>
        <div style="flex:1;min-width:0"><div class="h2" style="font-size:20px;overflow:hidden;text-overflow:ellipsis">${esc(u.username)}</div><div class="muted" style="font-size:12.5px">${u.owner ? 'reseller · ' + esc(u.owner) : isRes() ? esc(u.contact || '') : 'tvoj korisnik'}</div></div>
        ${stTag(u.status)}
      </div>
      <div class="mini-grid" style="margin-top:14px">
        <div class="mini"><small>Plan</small><b>${esc(u.plan || '—')}</b></div>
        <div class="mini"><small>Ističe</small><b>${fmtDate(u.expires_at)}</b> <span class="muted" style="font-size:12px">(${daysTxt(u.days_left)})</span></div>
        <div class="mini"><small>Uređaji sada / limit</small><b class="${u.devices_seen > u.devices ? 'warn' : ''}">${u.devices_seen || 0} / ${u.devices}</b>${u.status === 'devices' ? ` <button class="btn sm" data-a="unblock" data-id="${u.id}" style="margin-left:6px">Odblokiraj</button>` : ''}</div>
        <div class="mini"><small>Zadnje spajanje</small><b>${u.last_seen ? ago(u.last_seen) : 'nikad'}</b>${u.last_server ? ` <span class="muted" style="font-size:12px">· ${esc(u.last_server)}</span>` : ''}</div>
      </div>
      <div style="margin-top:14px"><div style="display:flex;justify-content:space-between;font-size:13px;color:var(--soft);margin-bottom:6px"><span>Promet</span><span>${bytes(u.traffic_used)} / ${u.traffic_limit ? bytes(u.traffic_limit) : 'neograničeno'}</span></div>
        <div class="bar" style="height:8px"><i class="${pct >= 100 ? 'w' : ''}" style="width:${u.traffic_limit ? pct : 4}%"></i></div></div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--card2);flex-wrap:wrap">
        <div class="qrbox">${u.qr}</div>
        <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:8px">
          <small class="muted">Pretplatni link (za aplikacije i stranicu kupca)</small>
          <div class="mono" style="color:var(--soft)">${esc(u.sub_link)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            <button class="btn sm" data-a="copy" data-v="${esc(u.sub_link)}">${ic('copy')}Kopiraj</button>
            <a class="btn sm" href="${esc(u.sub_link)}" target="_blank" rel="noopener">Stranica kupca</a>
            <button class="btn sm red" data-a="sendCustomer" data-id="${u.id}">${ic('send')}Pošalji kupcu</button>
            ${u.vless.length || u.ss?.length || u.wg.length ? `<button class="btn sm" data-a="links" data-id="${u.id}">Konfiguracije</button>` : ''}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px">
        <button class="btn red" data-a="extend" data-id="${u.id}">Produži</button>
        ${isRes() ? `<button class="btn" data-a="editNote" data-id="${u.id}">Bilješka</button>` : `<button class="btn" data-a="editUser" data-id="${u.id}">Uredi</button>`}
        <button class="btn" data-a="uAct" data-act="reset" data-id="${u.id}">Resetuj promet</button>
        <button class="btn" data-a="uAct" data-act="rekey" data-id="${u.id}">Novi ključ</button>
        <button class="btn warnb" data-a="uAct" data-act="toggle" data-id="${u.id}">${u.disabled ? 'Upali' : 'Ugasi'}</button>
        <button class="btn danger" data-a="uAct" data-act="delete" data-id="${u.id}">Obriši</button>
      </div>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px" class="muted">
        ${u.contact ? `<div>Kontakt: <span style="color:var(--text)">${esc(u.contact)}</span></div>` : ''}
        ${u.email ? `<div>E-mail: <span style="color:var(--text)">${esc(u.email)}</span></div>` : ''}
        <div>Telegram bot: <span style="color:var(--text)">${u.tg ? 'povezan ✓ (dobija podsjetnike)' : 'nije povezan'}</span></div>
        ${u.note ? `<div>Bilješka: <span style="color:var(--text)">${esc(u.note)}</span></div>` : ''}
        ${u.owner_id || isRes() ? `<label style="display:flex;gap:8px;align-items:center;color:var(--text);margin-top:4px"><input type="checkbox" class="cb" data-a="autoRenew" data-id="${u.id}" ${u.auto_renew ? 'checked' : ''}>Produži sam sa kredita resellera dan prije isteka</label>` : ''}
      </div>
      <div style="margin-top:14px"><small class="muted">Historija</small><div class="hist">${u.history.map((h) => `<div><span>${fmtDT(h.ts)}</span><span>${esc(h.text)}</span></div>`).join('')}</div></div>`;
    S.lastUser = u;
    return u;
  }

  async function pageUser(id) {
    S.selUser = id;
    $('#view').innerHTML = `<section class="card p" id="uDetail" style="display:flex;flex-direction:column"><div class="muted">Učitavam…</div></section>`;
    await loadUserDetail(id, $('#uDetail'), true);
  }
  const refreshUser = async () => {
    if (location.hash.startsWith('#/korisnik/')) return pageUser(S.selUser);
    if (location.hash.startsWith('#/korisnici')) return pageUsers(new URLSearchParams());
    return route();
  };

  async function newUser() {
    const isR = isRes();
    let plans, resellers = [];
    if (isR) plans = (await GET('res/dash')).plans;
    else { plans = (await GET('plans')).filter((p) => p.active); if (can('resellers')) resellers = await GET('resellers').catch(() => []); }
    if (!plans.length) return toast('Prvo napravi bar jedan aktivan plan.', true);
    const sug = (await GET(R('users/suggest'))).username;
    const id = await formLoop(`<h2>Novi korisnik</h2>
      <label class="field">Korisničko ime<input class="input" name="username" value="${esc(sug)}" required maxlength="40" pattern="[a-zA-Z0-9._@\\-]{3,40}"></label>
      <label class="field">Plan<select class="input" name="plan_id" required>${plans.map((p) => `<option value="${p.id}">${esc(p.name)} · ${p.days} dana · ${p.traffic_gb ? p.traffic_gb + ' GB' : 'neograničeno'}${isR ? ` · ${p.trial ? 'besplatno' : money(p.price)}` : p.price ? ` · ${money(p.price)}` : ''}</option>`).join('')}</select></label>
      ${!isR ? `<div class="row2"><label class="field">Trajanje (dana, prazno = po planu)<input class="input" name="days" inputmode="numeric"></label>
        <label class="field">Promet GB (prazno = po planu, 0 = neograničeno)<input class="input" name="traffic_gb" inputmode="decimal"></label></div>
        ${resellers.length ? `<label class="field">Vlasnik<select class="input" name="owner_id"><option value="">Moj korisnik</option>${resellers.map((r) => `<option value="${r.id}">reseller · ${esc(r.username)}</option>`).join('')}</select></label>` : ''}
        <div class="row2"><label class="field">Plaćeno (€, opcionalno)<input class="input" name="paid" inputmode="decimal" placeholder="0"></label>
        <label class="field">Način plaćanja<input class="input" name="method" placeholder="npr. Wise"></label></div>` : `<p class="muted" style="margin:0">Cijena se skida sa tvog kredita (${money(S.me.credit)}).</p>`}
      <div class="row2"><label class="field">Kontakt (opcionalno)<input class="input" name="contact" placeholder="+387…, @telegram"></label>
      <label class="field">E-mail kupca (opcionalno)<input class="input" name="email" type="email" placeholder="za podsjetnike"></label></div>
      <label class="field">Bilješka (opcionalno)<input class="input" name="note"></label>
      ${isR ? '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="auto_renew">Produži sam sa mog kredita dan prije isteka</label>' : ''}
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Napravi korisnika</button></div>`,
    async (d) => {
      const body = { username: d.username, plan_id: Number(d.plan_id), note: d.note, contact: d.contact, email: d.email, auto_renew: !!d.auto_renew };
      if (!isR) Object.assign(body, { days: d.days ? Number(d.days) : undefined, traffic_gb: d.traffic_gb !== '' ? Number(d.traffic_gb) : undefined, owner_id: d.owner_id || undefined, paid: Number(String(d.paid || '0').replace(',', '.')), method: d.method });
      return (await POST(R('users'), body)).id;
    });
    if (!id) return;
    toast('Korisnik napravljen.');
    if (isR) { S.me = await GET('me'); }
    S.selUser = id;
    if (innerWidth < 960) location.hash = '#/korisnik/' + id;
    else if (location.hash.startsWith('#/korisnici')) pageUsers(new URLSearchParams());
    else location.hash = '#/korisnici';
  }

  async function extend(id) {
    const u = S.lastUser?.id === Number(id) ? S.lastUser : await GET(R('users/' + id));
    const plans = isRes() ? (await GET('res/dash')).plans.filter((p) => !p.trial) : (await GET('plans')).filter((p) => p.active);
    const ok = await formLoop(`<h2>Produži · ${esc(u.username)}</h2>
      <p class="muted" style="margin:0">Ističe ${fmtDate(u.expires_at)}. Dani se dodaju na datum isteka ili od danas ako je istekao.</p>
      <label class="field">Plan<select class="input" name="plan_id">${plans.map((p) => `<option value="${p.id}" ${p.id === u.plan_id ? 'selected' : ''}>${esc(p.name)} · ${p.days} dana${isRes() ? ` · ${money(p.price)}` : ''}</option>`).join('')}</select></label>
      ${!isRes() ? `<div class="row2"><label class="field">Dana (prazno = po planu)<input class="input" name="days" inputmode="numeric"></label>
        <label class="field">Plaćeno (€)<input class="input" name="paid" inputmode="decimal" placeholder="0"></label></div>
        <label class="field">Način plaćanja<input class="input" name="method" placeholder="npr. Wise, gotovina"></label>` : `<p class="muted" style="margin:0">Skida se sa tvog kredita (${money(S.me.credit)}).</p>`}
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Produži</button></div>`,
    (d) => POST(R(`users/${id}/extend`), { plan_id: Number(d.plan_id), days: d.days ? Number(d.days) : undefined, paid: Number(String(d.paid || '0').replace(',', '.')), method: d.method }));
    if (ok) { toast('Produženo.'); if (isRes()) S.me = await GET('me'); refreshUser(); }
  }

  async function editUser(id) {
    const u = await GET('users/' + id);
    const plans = await GET('plans'); const resellers = can('resellers') ? await GET('resellers').catch(() => []) : [];
    const exp = new Date(u.expires_at); const iso = new Date(exp.getTime() - exp.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const ok = await formLoop(`<h2>Uredi · ${esc(u.username)}</h2>
      <label class="field">Korisničko ime<input class="input" name="username" value="${esc(u.username)}" required></label>
      <div class="row2"><label class="field">Plan<select class="input" name="plan_id">${plans.map((p) => `<option value="${p.id}" ${p.id === u.plan_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">Ističe<input class="input" type="date" name="expires" value="${iso}"></label></div>
      <div class="row2"><label class="field">Promet GB (0 = neograničeno)<input class="input" name="traffic_gb" value="${u.traffic_limit ? (u.traffic_limit / 1024 ** 3).toFixed(0) : 0}" inputmode="decimal"></label>
      <label class="field">Limit uređaja<input class="input" name="devices" value="${u.devices}" inputmode="numeric"></label></div>
      ${resellers.length ? `<label class="field">Vlasnik<select class="input" name="owner_id"><option value="">Moj korisnik</option>${resellers.map((r) => `<option value="${r.id}" ${r.id === u.owner_id ? 'selected' : ''}>reseller · ${esc(r.username)}</option>`).join('')}</select></label>` : ''}
      <div class="row2"><label class="field">Kontakt<input class="input" name="contact" value="${esc(u.contact)}"></label><label class="field">E-mail<input class="input" name="email" type="email" value="${esc(u.email)}"></label></div>
      <label class="field">Bilješka<input class="input" name="note" value="${esc(u.note)}"></label>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => PUT('users/' + id, { username: d.username, plan_id: Number(d.plan_id), expires_at: new Date(d.expires + 'T23:59:00').getTime(), traffic_gb: Number(d.traffic_gb || 0), devices: Number(d.devices || 1), owner_id: d.owner_id ?? undefined, contact: d.contact, email: d.email, note: d.note }));
    if (ok) { toast('Spremljeno.'); refreshUser(); }
  }
  async function editNote(id) {
    const u = S.lastUser;
    const ok = await formLoop(`<h2>Bilješka · ${esc(u.username)}</h2>
      <label class="field">Kontakt<input class="input" name="contact" value="${esc(u.contact)}"></label>
      <label class="field">E-mail kupca<input class="input" name="email" type="email" value="${esc(u.email)}"></label>
      <label class="field">Bilješka<textarea class="input" name="note">${esc(u.note)}</textarea></label>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => PUT(R('users/' + id), { note: d.note, contact: d.contact, email: d.email }));
    if (ok) refreshUser();
  }
  async function userAction(id, act) {
    const u = S.lastUser;
    const text = { reset: ['Resetuj promet', 'Brojač prometa se vraća na nulu.', 'Resetuj'], rekey: ['Novi ključ i link', 'Stari link i konfiguracije prestaju raditi. Korisnik mora ponovo uvesti novi link.', 'Napravi novi'],
      toggle: [u?.disabled ? 'Upali korisnika' : 'Ugasi korisnika', u?.disabled ? 'Korisnik se ponovo može spojiti.' : 'Korisnik se ne može spojiti dok ga ne upališ.', u?.disabled ? 'Upali' : 'Ugasi'],
      delete: ['Obriši korisnika', `Korisnik ${u?.username || ''} se briše zauvijek.`, 'Obriši'] }[act];
    if (!(await ask(text[0], text[1], text[2], act === 'delete' || act === 'rekey'))) return;
    try {
      if (act === 'delete') { await DEL(R('users/' + id)); S.selUser = null; toast('Obrisano.'); if (location.hash.startsWith('#/korisnik/')) location.hash = '#/korisnici'; else pageUsers(new URLSearchParams()); return; }
      await POST(R(`users/${id}/${act}`)); toast('Urađeno.'); refreshUser();
    } catch (e) { fail(e); }
  }
  async function showLinks() {
    const u = S.lastUser;
    const r = await modal(`<h2>Konfiguracije · ${esc(u.username)}</h2>
      ${u.vless.length ? `<b>VLESS + Reality</b>${u.vless.map((v) => `<div class="list-item"><span>${esc(v.server)}</span><button class="btn sm" type="button" data-a="copy" data-v="${esc(v.link)}">${ic('copy')}Kopiraj</button></div>`).join('')}` : ''}
      ${u.ss?.length ? `<b>Shadowsocks 2022</b>${u.ss.map((v) => `<div class="list-item"><span>${esc(v.server)}</span><button class="btn sm" type="button" data-a="copy" data-v="${esc(v.link)}">${ic('copy')}Kopiraj</button></div>`).join('')}` : ''}
      ${u.wg.length ? `<b>WireGuard</b>${u.wg.map((w) => `<div class="list-item"><span>${esc(w.server)}</span><a class="btn sm" href="${esc(w.url)}" target="_blank" rel="noopener">${ic('down')}.conf</a><a class="btn sm" href="${esc(w.url)}?qr=1" target="_blank" rel="noopener">QR</a></div>`).join('')}` : ''}
      <div class="dlg-actions"><button class="btn" value="cancel">Zatvori</button></div>`);
    if (r) r.close();
  }
  // ---- slanje pristupa kupcu (WhatsApp, Telegram, Viber, e-mail, QR slika)
  function customerMessage(u) {
    const t = S.me.msg_template || 'Tvoj {brend}: {link}';
    const map = { korisnik: u.username, plan: u.plan || '', istice: fmtDate(u.expires_at), dana: String(Math.max(0, u.days_left)), link: u.sub_link, brend: S.me.brand, podrska: S.me.support || '' };
    return t.replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m).replace(/\n*Pomoć: *$/, '').trim();
  }
  async function qrPng(u) {
    const svg = u.qr.includes('xmlns') ? u.qr : u.qr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const W = 900, H = 1080, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#E3172B'; g.fillRect(0, 0, W, 14);
    g.drawImage(img, 90, 110, 720, 720);
    g.fillStyle = '#111114'; g.textAlign = 'center';
    g.font = '800 46px "Inter Display", Inter, sans-serif'; g.fillText(S.me.brand.toUpperCase(), W / 2, 80);
    g.font = '600 30px Inter, sans-serif'; g.fillText('Skeniraj u aplikaciji Hiddify', W / 2, 900);
    g.fillStyle = '#5d5d6b'; g.font = '400 26px Inter, sans-serif';
    g.fillText(`${u.plan || ''} · vrijedi do ${fmtDate(u.expires_at)}`, W / 2, 950);
    if (S.me.support) g.fillText('Pomoć: ' + S.me.support, W / 2, 995);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${S.me.brand.replace(/\W+/g, '-')}-${u.username}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function sendCustomer() {
    const u = S.lastUser;
    const msg = customerMessage(u);
    const contact = String(u.contact || '').trim();
    const phone = /^\+?[\d\s()/-]{7,}$/.test(contact) ? contact.replace(/[^\d]/g, '') : '';
    const tg = /^@[\w]{4,}$/.test(contact) ? contact.slice(1) : '';
    const mail = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(contact) ? contact : '';
    const enc = encodeURIComponent;
    const textNoLink = msg.replace(u.sub_link, '').replace(/\n{3,}/g, '\n\n');
    const links = [
      ['WhatsApp', `https://wa.me/${phone}?text=${enc(msg)}`, phone ? `na ${contact}` : 'izaberi kontakt'],
      ['Telegram', tg ? `https://t.me/${tg}` : `https://t.me/share/url?url=${enc(u.sub_link)}&text=${enc(textNoLink)}`, tg ? `otvori chat sa @${tg} pa zalijepi poruku` : 'izaberi kontakt'],
      ['Viber', `viber://forward?text=${enc(msg)}`, 'izaberi kontakt'],
      ['E-mail', `mailto:${mail}?subject=${enc(S.me.brand + ' pristup')}&body=${enc(msg)}`, mail || 'upiši adresu'],
    ];
    const r = await modal(`<h2>Pošalji kupcu · ${esc(u.username)}</h2>
      <p class="muted" style="margin:0">Poruka ima link na stranicu kupca, gdje su QR kod i dugmad za aplikacije. Tekst poruke mijenjaš u Postavke → Pretplata.</p>
      <textarea class="input" id="custMsg" style="min-height:190px;font-size:13.5px">${esc(msg)}</textarea>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
        ${links.map(([n, href, sub]) => `<a class="btn" style="flex-direction:column;align-items:flex-start;gap:0;height:auto;padding:10px 12px" href="${esc(href)}" target="_blank" rel="noopener" data-a="sendVia" data-tg="${n === 'Telegram' && tg ? '1' : ''}"><b>${n}</b><small class="muted" style="font-weight:400">${esc(sub)}</small></a>`).join('')}
      </div>
      ${S.me.mail_on ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="field" style="flex:1;min-width:200px">Pošalji e-mail odmah iz panela<input class="input" id="custMail" type="email" value="${esc(u.email || (mail ? contact : ''))}" placeholder="kupac@email.com"></label><button class="btn" type="button" data-a="mailCustomer" data-id="${u.id}">${ic('send')}Pošalji e-mail</button></div>` : ''}
      <div class="dlg-actions"><button class="btn" type="button" data-a="qrPng">${ic('down')}QR kod kao slika</button><button class="btn" type="button" data-a="copyMsg">${ic('copy')}Kopiraj poruku</button><button class="btn red" value="cancel">Gotovo</button></div>`);
    if (r) r.close();
  }

  async function broadcast() {
    const r = await formLoop(`<h2>Poruka svim kupcima</h2>
      <p class="muted" style="margin:0">Ide kupcima koji su povezali Telegram bota${S.me.mail_on ? ' i/ili imaju e-mail' : ''}. Može se prikazati i u aplikaciji (Hiddify) i na stranici kupca.</p>
      <label class="field">Poruka<textarea class="input" name="text" required style="min-height:140px" placeholder="npr. Večeras od 23 h kratko održavanje servera u Njemačkoj."></textarea></label>
      <label class="field">Kome<select class="input" name="target"><option value="active">Samo aktivnim kupcima</option><option value="all">Svima</option></select></label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="tg" checked ${S.me.cbot ? '' : 'disabled'}>Telegram (bot za kupce)${S.me.cbot ? '' : ' · nije uključen u Postavkama'}</label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="email" ${S.me.mail_on ? '' : 'disabled'}>E-mail${S.me.mail_on ? '' : ' · nije podešen u Postavkama'}</label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="announce">Prikaži i u aplikaciji i na stranici kupca (zamijeni trenutnu poruku)</label>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Pošalji</button></div>`,
    (d) => POST('users/broadcast', { text: d.text, target: d.target, tg: d.tg, email: d.email, announce: d.announce }));
    if (r) toast(`Poslano: Telegram ${r.tg}, e-mail ${r.email}${r.announce ? ', i u aplikaciji' : ''}.`);
  }
  async function bulk() {
    const ids = [...S.sel];
    const r = await formLoop(`<h2>Masovne akcije · ${ids.length} korisnika</h2>
      <label class="field">Akcija<select class="input" name="action"><option value="extend">Produži</option><option value="disable">Ugasi</option><option value="enable">Upali</option><option value="reset">Resetuj promet</option><option value="delete">Obriši</option></select></label>
      <label class="field">Dana (samo za produženje)<input class="input" name="days" value="30" inputmode="numeric"></label>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Primijeni</button></div>`,
    (d) => POST('users/bulk', { ids, action: d.action, days: Number(d.days) }));
    if (r) { toast(`Urađeno za ${r.n} korisnika.`); S.sel.clear(); pageUsers(new URLSearchParams()); }
  }

  // ================================================================== PLANOVI
  async function pagePlans() {
    const [plans, servers] = await Promise.all([GET('plans'), GET('servers').catch(() => [])]);
    S.servers = servers;
    const cols = '1.8fr .8fr 1fr .8fr .8fr 1.4fr .7fr .9fr';
    $('#view').innerHTML = `${top('Planovi', 'Šta kupci i reselleri mogu kupiti', can('plans') ? `<button class="btn red" data-a="editPlan">${ic('plus')}<span>Novi plan</span></button>` : '')}
      <section class="card" style="overflow:hidden"><div class="tbl">${trow(['Plan', 'Trajanje', 'Promet', 'Uređaji', 'Cijena', 'Serveri', 'Korisnici', 'Status'], true, cols)}
      ${plans.map((p) => `<div class="tr click" data-a="editPlan" data-id="${p.id}" style="grid-template-columns:${cols}">${[
        `<b>${esc(p.name)}</b>${p.trial ? '<small>probni plan</small>' : ''}`, `${p.days} d`, p.traffic_gb ? p.traffic_gb + ' GB' : 'neograničeno', p.devices, p.trial ? 'besplatno' : money(p.price),
        p.locations.length ? esc(p.locations.map((id) => servers.find((s) => s.id === id)?.name || '#' + id).join(', ')) : '<span class="muted">svi serveri</span>', p.users,
        p.active ? '<span class="tag t-ok">Aktivan</span>' : '<span class="tag t-grey">Isključen</span>',
      ].map((c, i) => `<div class="cell${i === 0 ? ' first' : ''}" data-l="${['', 'Trajanje', 'Promet', 'Uređaji', 'Cijena', 'Serveri', 'Korisnici', 'Status'][i]}">${c}</div>`).join('')}</div>`).join('') || '<div class="empty">Nema planova.</div>'}</div></section>
      <p class="dim" style="margin:0;font-size:13px">Reselleri plaćaju cijenu plana umanjenu za popust svog nivoa. Promjena plana ne mijenja postojeće korisnike dok ih ne produžiš.</p>`;
  }
  async function editPlan(id) {
    const p = id ? (await GET('plans')).find((x) => x.id === Number(id)) : { name: '', days: 30, traffic_gb: 0, devices: 3, price: 5, locations: [], trial: false, active: true, sort: 0 };
    const servers = S.servers?.length ? S.servers : await GET('servers').catch(() => []);
    const r = await formLoop(`<h2>${id ? 'Uredi plan' : 'Novi plan'}</h2>
      <label class="field">Ime plana<input class="input" name="name" value="${esc(p.name)}" required placeholder="npr. Premium 30 dana"></label>
      <div class="row2"><label class="field">Trajanje (dana)<input class="input" name="days" value="${p.days}" inputmode="numeric" required></label>
      <label class="field">Cijena (€)<input class="input" name="price" value="${p.price}" inputmode="decimal"></label></div>
      <div class="row2"><label class="field">Promet GB (0 = neograničeno)<input class="input" name="traffic_gb" value="${p.traffic_gb}" inputmode="decimal"></label>
      <label class="field">Limit uređaja<input class="input" name="devices" value="${p.devices}" inputmode="numeric"></label></div>
      <div class="field">Serveri (ništa označeno = svi)
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;color:var(--text)">${servers.map((s) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="cb" name="loc[]" value="${s.id}" ${p.locations.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('') || '<span class="muted">Još nema servera.</span>'}</div></div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="trial" ${p.trial ? 'checked' : ''}>Probni plan (besplatan za resellere, ograničen broj dnevno)</label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="active" ${p.active ? 'checked' : ''}>Aktivan (može se prodavati)</label>
      <div class="dlg-actions">${id ? '<button class="btn danger" value="delete" formnovalidate>Obriši</button>' : ''}<span style="flex:1"></span><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    async (d) => {
      if (d._btn === 'delete') { if (!(await confirmInline('Obrisati plan?'))) throw new Error('Odustao si od brisanja.'); return DEL('plans/' + id); }
      const body = { name: d.name, days: Number(d.days), price: Number(String(d.price).replace(',', '.')), traffic_gb: Number(d.traffic_gb), devices: Number(d.devices), locations: (d._many.loc || []).map(Number), trial: d.trial, active: d.active };
      return id ? PUT('plans/' + id, body) : POST('plans', body);
    });
    if (r) { toast('Spremljeno.'); pagePlans(); }
  }
  const confirmInline = (q) => Promise.resolve(window.confirm(q));

  // ================================================================== SERVERI
  async function pageServers() {
    const [servers, chains] = await Promise.all([GET('servers'), GET('chains').catch(() => [])]);
    S.servers = servers; S.chains = chains;
    const on = servers.filter((s) => s.status === 'online'), off = servers.filter((s) => s.status === 'offline');
    const cap = servers.filter((s) => s.enabled).reduce((a, s) => a + s.capacity, 0), conn = on.reduce((a, s) => a + s.online, 0);
    const tm = servers.reduce((a, s) => a + (s.traffic_month || 0), 0), cost = servers.filter((s) => s.enabled).reduce((a, s) => a + (s.cost || 0), 0);
    $('#view').innerHTML = `${top('Serveri', `${servers.length} servera · ${on.length} online`, `<button class="btn hide-m" data-a="reload">${ic('refresh')}Osvježi</button>${can('servers') ? `<button class="btn red" data-a="newServer">${ic('plus')}<span>Dodaj server</span></button>` : ''}`)}
      <section class="stats">
        <div class="stat"><div class="l"><span>Online</span>${ic('server')}</div><div class="v">${on.length} / ${servers.filter((s) => s.enabled).length}</div><div class="s ${off.length ? 'bad' : 'ok'}">${off.length ? off.map((s) => esc(s.name)).join(', ') + ' ne odgovara' : 'svi rade'}</div></div>
        <div class="stat"><div class="l"><span>Spojeno / kapacitet</span>${ic('users')}</div><div class="v">${conn} / ${cap}</div><div class="s muted">${cap ? Math.round(conn / cap * 100) : 0}% popunjeno</div></div>
        <div class="stat"><div class="l"><span>Promet ovaj mjesec</span>${ic('down')}</div><div class="v">${bytes(tm)}</div><div class="s muted">svi serveri</div></div>
        <div class="stat"><div class="l"><span>Trošak servera</span>${ic('money')}</div><div class="v">${money(cost)}</div><div class="s muted">mjesečno</div></div>
      </section>
      ${chainsHtml(chains, servers)}
      ${servers.length ? `<section class="srvgrid">${servers.map(srvCard).join('')}</section>`
      : `<section class="card p" style="text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center"><h2>Dodaj svoj prvi VPN server</h2>
          <p class="muted" style="max-width:520px;margin:0">Zakupi VPS (Ubuntu 22.04 ili 24.04), klikni "Dodaj server", pa zalijepi jednu komandu u server. Panel sve ostalo uradi sam.</p>
          <button class="btn red" data-a="newServer">${ic('plus')}Dodaj server</button></section>`}`;
    startLive();
  }
  // kartica servera: zastava, ime, država i hoster, IP sa kopiranjem, protokoli, opterećenje, akcije
  function srvCard(s) {
    const live = s.status === 'online';
    const fill = s.capacity ? s.online / s.capacity * 100 : 0;
    const lvl = (v) => v == null ? '' : v >= 85 ? 'bad' : v >= 65 ? 'w' : '';
    const m = (label, v, txt) => `<div class="sm-m"><div class="sm-l"><span>${label}</span><b class="${lvl(v)}">${txt ?? (v == null ? '—' : Math.round(v) + '%')}</b></div><div class="sm-bar"><i class="${lvl(v)}" style="width:${Math.min(100, Math.max(v ? 2 : 0, v || 0)).toFixed(1)}%"></i></div></div>`;
    const country = s.country ? ccName(s.country) : '';
    const sub = [country, s.provider].filter(Boolean).join(' · ') || 'čeka prvo javljanje';
    const proto = (ok, name) => ok == null ? '' : `<span class="pchip ${ok ? 'ok' : 'bad'}" title="${ok ? 'radi' : 'ne radi'}"><i></i>${name}</span>`;
    return `<article class="card srv2 ${s.status === 'offline' ? 'off' : ''} ${s.status === 'disabled' ? 'dis' : ''} ${s.maintenance ? 'mnt' : ''}">
      <header>
        <span class="srvflag">${s.country ? flag(s.country) : ic('server')}<i class="dot s-${s.warn ? 'warn' : s.status}"></i></span>
        <div class="srv-t"><b title="${esc(s.name)}">${esc(s.city && s.city !== s.name ? s.name : s.city || s.name)}</b><span>${esc(sub)}</span></div>
        <span data-live-srv="${s.id}">${srvStatus(s)}</span>
      </header>
      ${s.host ? `<button class="iprow" data-a="copy" data-v="${esc(s.host)}" title="Kopiraj IP adresu"><span class="mono">${esc(s.host)}</span>${ic('copy')}</button>` : ''}
      <div class="chips">${(s.tags || []).map((t) => `<span class="tag t-info">${esc(TAG_LABEL[t] || t)}</span>`).join('')}${s.xray_ok ? proto(true, 'VLESS Reality') : ''}${s.wg_ok ? proto(true, 'WireGuard') : ''}${s.status === 'pending' ? '<span class="tag t-warn">nije instaliran</span>' : ''}${s.maintenance ? '<span class="tag t-warn">održavanje</span>' : ''}</div>
      <div class="srv-m">${m('CPU', live ? s.cpu : null)}${m('RAM', live ? s.ram : null)}${m('Spojeno', fill, `${s.online}<small>/${s.capacity}</small>`)}</div>
      <div class="srv-f"><span>${ic('down')}${bytes(s.traffic_month)} <small>ovaj mjesec</small></span><span class="dim">${s.last_seen ? 'javio se ' + ago(s.last_seen) : 'nije se javio'}</span></div>
      <div class="srv-a">
        ${s.status === 'pending' ? `<button class="btn sm red" data-a="install" data-id="${s.id}">Komanda za instalaciju</button>` : ''}
        <button class="btn sm" data-a="editServer" data-id="${s.id}">${ic('edit')}Uredi</button>
        <button class="btn sm warnb" data-a="srvAct" data-act="maintenance" data-id="${s.id}">${s.maintenance ? 'Završi održavanje' : 'Održavanje'}</button>
        <button class="btn sm icon" data-a="srvMore" data-id="${s.id}" aria-label="Više">${ic('more')}</button>
      </div></article>`;
  }
  const TAG_LABEL = { p2p: 'P2P / Torrent', streaming: 'Streaming', gaming: 'Gaming', special: 'Specijalni' };
  // ---------- Double VPN / Multihop
  function chainsHtml(chains, servers) {
    const flagName = (h) => { const sv = servers.find((x) => x.id === h); return sv ? `<span class="tag t-grey hop">${sv.country ? flag(sv.country) : ""} ${esc(sv.name)}</span>` : '<span class="tag t-bad">obrisan</span>'; };
    return `<section class="card p">
      <div class="ch" style="margin-bottom:8px"><h2>${ic('link')}Double VPN i Multihop</h2>${can('servers') ? `<button class="btn sm red" data-a="editChain">${ic('plus')}Novi lanac</button>` : ''}</div>
      <p class="muted" style="margin:0 0 12px;font-size:13px">Promet kupca ide kroz 2 servera (Double VPN) ili 3–4 servera (Multihop). Kupac vidi lanac kao posebnu lokaciju u aplikaciji. Sajtovi vide IP zadnjeg servera.</p>
      ${chains.length ? chains.map((c) => `<div class="list-item" style="margin-bottom:8px;flex-wrap:wrap">
          <span style="display:flex;flex-direction:column;gap:6px"><b>${esc(c.name)} <span class="tag ${c.kind === 'multihop' ? 't-info' : 't-ok'}">${c.kind === 'multihop' ? 'Multihop' : 'Double VPN'}</span>${c.enabled ? '' : ' <span class="tag t-grey">ugašen</span>'}${c.enabled && !c.usable ? ' <span class="tag t-warn">neki server ne radi ili nema adresu</span>' : ''}</b>
            <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${c.hops.map(flagName).join('<span class="dim">→</span>')}<span class="dim mono" style="font-size:12px">port ${c.port}</span></span></span>
          ${can('servers') ? `<button class="btn sm" data-a="editChain" data-id="${c.id}">Uredi</button><button class="btn sm warnb" data-a="toggleChain" data-id="${c.id}">${c.enabled ? 'Ugasi' : 'Upali'}</button><button class="btn sm danger" data-a="delChain" data-id="${c.id}">Obriši</button>` : ''}</div>`).join('')
        : `<div class="muted" style="font-size:13px">${servers.length < 2 ? 'Za lanac trebaju bar 2 servera. Dodaj još jedan server, pa napravi lanac.' : 'Još nema lanaca.'}</div>`}
    </section>`;
  }
  async function editChain(id) {
    const c = id ? S.chains.find((x) => x.id === Number(id)) : null;
    const servers = S.servers;
    if (servers.length < 2) return toast('Za lanac trebaju bar 2 servera.', true);
    const opts = (sel) => `<option value="">— nema —</option>${servers.map((s) => `<option value="${s.id}" ${sel === s.id ? 'selected' : ''}>${esc(s.country || '')} ${esc(s.name)}</option>`).join('')}`;
    const h = c ? c.hops : [];
    const usedPorts = new Set((S.chains || []).map((x) => x.port));
    let port = 20001; while (usedPorts.has(port)) port++;
    const r = await formLoop(`<h2>${c ? 'Uredi lanac' : 'Novi lanac servera'}</h2>
      <p class="muted" style="margin:0">Kupac se spaja na prvi server, a internet vidi zadnji. 2 servera = Double VPN, 3 ili 4 = Multihop.</p>
      <label class="field">Ime (kupac ga vidi)<input class="input" name="name" required value="${esc(c?.name || '')}" placeholder="npr. Njemačka → Švicarska"></label>
      <div class="row2"><label class="field">1. ulazni server<select class="input" name="h0" required>${opts(h[0])}</select></label><label class="field">2. server<select class="input" name="h1" required>${opts(h[1])}</select></label></div>
      <div class="row2"><label class="field">3. server (Multihop)<select class="input" name="h2">${opts(h[2])}</select></label><label class="field">4. server<select class="input" name="h3">${opts(h[3])}</select></label></div>
      <label class="field">Port lanca (TCP)<input class="input" name="port" value="${c?.port || port}" inputmode="numeric"></label>
      <p class="dim" style="margin:0;font-size:12.5px">Port mora biti otvoren na svim serverima osim zadnjeg. Agent ga sam otvori u ufw-u; ako koristiš Hetzner Cloud Firewall, dodaj ga i tamo.</p>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => { const body = { name: d.name, port: Number(d.port), hops: [d.h0, d.h1, d.h2, d.h3].filter(Boolean).map(Number) }; return c ? PUT('chains/' + c.id, body) : POST('chains', body); });
    if (r) { toast('Lanac spremljen. Serveri ga preuzmu za par sekundi.'); pageServers(); }
  }

  async function newServer() {
    const r = await formLoop(`<h2>Dodaj server</h2>
      <ol class="muted" style="margin:0;padding-left:20px;line-height:1.7"><li>Zakupi VPS sa Ubuntu 22.04 ili 24.04</li><li>Upiši ime i kapacitet ispod</li><li>Dobićeš komandu koju zalijepiš u server kao root</li></ol>
      <div class="row2"><label class="field">Ime servera<input class="input" name="name" required placeholder="npr. DE Frankfurt 1"></label>
      <label class="field">Maksimalno spojenih<input class="input" name="capacity" value="400" inputmode="numeric"></label></div>
      <div class="row2"><label class="field">Hoster (opcionalno)<input class="input" name="provider" placeholder="Hetzner, OVH…"></label>
      <label class="field">Mjesečni trošak € (opcionalno)<input class="input" name="cost" inputmode="decimal"></label></div>
      <details><summary class="muted" style="cursor:pointer">Napredno: IP, lokacija, portovi</summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <div class="row2"><label class="field">IP ili domena (prazno = sam se javi)<input class="input" name="host"></label><label class="field">Grad / država (npr. Frankfurt / DE)<input class="input" name="loc"></label></div>
        <div class="row2"><label class="field">VLESS port<input class="input" name="vless_port" value="443"></label><label class="field">WireGuard port<input class="input" name="wg_port" value="51820"></label></div>
        <label class="field">Shadowsocks port<input class="input" name="ss_port" value="8388"></label></div></details>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Dodaj i prikaži komandu</button></div>`,
    (d) => { const [city, cc] = String(d.loc || '').split('/').map((x) => x.trim()); return POST('servers', { name: d.name, capacity: Number(d.capacity), provider: d.provider, cost: Number(String(d.cost || 0).replace(',', '.')), host: d.host, city, country: cc, vless_port: Number(d.vless_port), wg_port: Number(d.wg_port), ss_port: Number(d.ss_port) }); });
    if (r) { showInstall(r.install, true); if (location.hash.startsWith('#/serveri')) pageServers(); }
  }
  async function showInstall(cmd, fresh) {
    const r = await modal(`<h2>${fresh ? 'Server dodan · ' : ''}Instalacija</h2>
      <p class="muted" style="margin:0">Prijavi se na server preko SSH-a (kao root) i zalijepi ovu komandu. Instalacija traje 1–2 minute.</p>
      <div class="code">${esc(cmd)}</div>
      <p class="muted" style="margin:0;font-size:13px">Komanda sadrži tajni ključ servera. Ne dijeli je.${!S.me.panel_url_set ? ' Ako server ne vidi ovu adresu panela, upiši pravu adresu u Postavke → Općenito → Adresa panela.' : ''}</p>
      <div class="dlg-actions"><button class="btn" type="button" data-a="copy" data-v="${esc(cmd)}">${ic('copy')}Kopiraj komandu</button><button class="btn red" value="cancel">Gotovo</button></div>`);
    if (r) r.close();
  }
  async function editServer(id) {
    const s = S.servers.find((x) => x.id === Number(id)) || (await GET('servers')).find((x) => x.id === Number(id));
    const r = await formLoop(`<h2>Uredi · ${esc(s.name)}</h2>
      <div class="row2"><label class="field">Ime<input class="input" name="name" value="${esc(s.name)}" required></label><label class="field">IP ili domena<input class="input" name="host" value="${esc(s.host)}"></label></div>
      <div class="row2"><label class="field">Grad<input class="input" name="city" value="${esc(s.city)}"></label><label class="field">Država (2 slova, npr. DE)<input class="input" name="country" value="${esc(s.country)}" maxlength="2"></label></div>
      <div class="row2"><label class="field">Maksimalno spojenih<input class="input" name="capacity" value="${s.capacity}"></label><label class="field">Mjesečni trošak €<input class="input" name="cost" value="${s.cost || 0}"></label></div>
      <div class="row2"><label class="field">Hoster<input class="input" name="provider" value="${esc(s.provider)}"></label><label class="field">Reality SNI<input class="input" name="sni" value="${esc(s.sni)}"></label></div>
      <div class="row2"><label class="field">VLESS port<input class="input" name="vless_port" value="${s.vless_port}"></label><label class="field">WireGuard port<input class="input" name="wg_port" value="${s.wg_port}"></label></div>
      <label class="field">Shadowsocks port<input class="input" name="ss_port" value="${s.ss_port || 8388}"></label>
      <div class="field">Oznake (kupac ih vidi kao kategorije u aplikaciji)<div class="chips">${Object.entries(TAG_LABEL).map(([k, l]) => `<label class="chip"><input type="checkbox" name="tag_${k}" ${(s.tags || []).includes(k) ? 'checked' : ''} style="accent-color:var(--acc)">${l}</label>`).join('')}</div>
        <small class="dim">P2P: na ovom serveru torrent je dozvoljen čak i kad je "Blokada torrenta" uključena.</small></div>
      <p class="dim" style="margin:0;font-size:12.5px">Promjena porta ili SNI-ja mijenja linkove kupaca: aplikacije ih same osvježe preko pretplate.</p>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => PUT('servers/' + id, { ...d, tags: Object.keys(TAG_LABEL).filter((k) => d['tag_' + k]), capacity: Number(d.capacity), cost: Number(String(d.cost).replace(',', '.')), vless_port: Number(d.vless_port), wg_port: Number(d.wg_port), ss_port: Number(d.ss_port) }));
    if (r) { toast('Spremljeno.'); pageServers(); }
  }
  async function srvMore(id) {
    S.servers = await GET('servers');
    const s = S.servers.find((x) => x.id === Number(id));
    const r = await modal(`<h2>${esc(s.name)}</h2>
      ${s.last_error ? `<div class="tag t-bad" style="white-space:normal;padding:8px 10px;font-weight:500">${esc(s.last_error)}</div>` : ''}
      <div class="mini-grid"><div class="mini"><small>Agent / Xray</small><b>${esc(s.version || '—')}</b>${s.xray_version ? ` <span class="muted" style="font-size:12px">· Xray ${esc(s.xray_version)}</span>` : ''}</div><div class="mini"><small>Uptime</small><b>${s.uptime ? Math.floor(s.uptime / 86400) + ' d ' + Math.floor(s.uptime % 86400 / 3600) + ' h' : '—'}</b></div>
        <div class="mini"><small>Xray (VLESS / SS)</small><b class="${s.xray_ok ? 'ok' : 'bad'}">${s.xray_ok ? 'radi' : !s.enabled ? 'ugašen' : 'ne radi'}</b></div><div class="mini"><small>WireGuard</small><b class="${s.wg_ok ? 'ok' : 'bad'}">${s.wg_ok ? 'radi' : !s.enabled ? 'ugašen' : 'ne radi'}</b></div></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn" value="install">Prikaži komandu za instalaciju</button>
        <button class="btn" value="locate">Odredi lokaciju iz IP adrese</button>
        <button class="btn warnb" value="toggle">${s.enabled ? 'Ugasi server (kupci ga ne vide)' : 'Upali server'}</button>
        <button class="btn danger" value="delete">Obriši server iz panela</button></div>
      <div class="dlg-actions"><button class="btn" value="cancel">Zatvori</button></div>`);
    if (!r) return;
    r.close();
    try {
      if (r.data._btn === 'install') return showInstall((await GET(`servers/${id}/install`)).install);
      if (r.data._btn === 'delete') { if (!(await ask('Obriši server', `${s.name} se briše iz panela. Na samom serveru ugasi agenta ili obriši VPS.`, 'Obriši', true))) return; await DEL('servers/' + id); }
      else await POST(`servers/${id}/${r.data._btn}`);
      toast('Urađeno.'); pageServers();
    } catch (e) { fail(e); }
  }

  // ================================================================== RESELLERI
  const resUrl = () => S.me?.res_path ? `${location.origin}${S.me.res_path}/` : '';
  async function pageResellers() {
    const [list, levels] = await Promise.all([GET('resellers'), GET('levels')]);
    S.resellers = list; S.levels = levels;
    const cols = '1.6fr .8fr .9fr 1.3fr .9fr .8fr';
    const wide = innerWidth >= 960;
    const totalCredit = list.reduce((a, r) => a + Math.max(0, r.credit), 0), month = list.reduce((a, r) => a + r.month, 0);
    $('#view').innerHTML = `${top('Reselleri', `${list.length} resellera · ${money(month)} kredita prodano ovaj mjesec`, `<a class="btn hide-m" href="#/reselleri/nivoi">${ic('levels')}Nivoi</a><button class="btn red" data-a="newReseller">${ic('plus')}<span>Novi reseller</span></button>`)}
      ${resUrl() ? `<div class="banner" style="background:var(--card);border-color:var(--line)">${ic('res')}<span style="flex:1;min-width:0">Panel za resellere: <b class="mono" style="font-size:13px">${esc(resUrl())}</b><br><small class="muted">Ovu adresu šalješ resellerima. Tvoju admin adresu nikad ne vide.</small></span><button class="btn sm" data-a="copy" data-v="${esc(resUrl())}">${ic('copy')}Kopiraj</button></div>`
        : `<div class="banner">${ic('res')}<span style="flex:1">Reselleri se sada prijavljuju na tvoju admin adresu. Uključi poseban panel za resellere u Postavke → Reselleri.</span><a class="btn sm" href="#/postavke">Postavke</a></div>`}
      <section class="stats">
        <div class="stat"><div class="l"><span>Reselleri</span>${ic('res')}</div><div class="v">${list.filter((r) => !r.disabled).length}</div><div class="s muted">${list.filter((r) => r.disabled).length} blokiranih</div></div>
        <div class="stat"><div class="l"><span>Njihovi korisnici</span>${ic('users')}</div><div class="v">${list.reduce((a, r) => a + r.users, 0)}</div><div class="s muted">ukupno</div></div>
        <div class="stat"><div class="l"><span>Prodano ovaj mjesec</span>${ic('money')}</div><div class="v">${money(month)}</div><div class="s muted">kupovine kredita</div></div>
        <div class="stat"><div class="l"><span>Neiskorišten kredit</span>${ic('credit')}</div><div class="v">${money(totalCredit)}</div><div class="s muted">kod resellera</div></div>
      </section>
      <div class="split">
        <section class="card wide" style="overflow:hidden"><div class="tbl">${trow(['Reseller', 'Nivo', 'Kredit', 'Korisnici', 'Ovaj mjesec', 'Status'], true, cols)}
          ${list.map((r) => `<div class="tr click ${S.selRes === r.id ? 'sel' : ''}" data-a="openRes" data-id="${r.id}" style="grid-template-columns:${cols}">${[
            `<b>${esc(r.username)}</b><small>${esc(r.contact || r.brand || '')}</small>`, r.level ? `<span class="tag lvl-${esc(r.level)}">${esc(r.level)}</span>` : '<span class="muted">—</span>',
            `<b class="${r.credit < 10 ? 'warn' : ''}">${money(r.credit)}</b>`,
            `<div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:12.5px">${r.users} / ${r.user_limit}</span><div class="bar"><i style="width:${Math.min(100, r.users / r.user_limit * 100)}%"></i></div></div>`,
            money(r.month), r.pending ? '<span class="tag t-warn">Čeka odobrenje</span>' : r.disabled ? '<span class="tag t-bad">Blokiran</span>' : r.credit < 10 ? '<span class="tag t-warn">Malo kredita</span>' : '<span class="tag t-ok">Aktivan</span>',
          ].map((c, i) => `<div class="cell${i === 0 ? ' first' : ''}" data-l="${['', 'Nivo', 'Kredit', 'Korisnici', 'Mjesec', 'Status'][i]}">${c}</div>`).join('')}</div>`).join('') || '<div class="empty">Još nema resellera.</div>'}</div></section>
        ${wide ? `<section class="card p narrow" id="rDetail">${S.selRes ? '' : '<div class="empty">Klikni resellera za detalje i dodavanje kredita.</div>'}</section>` : ''}
      </div>`;
    if (wide && S.selRes) resDetail(S.selRes, $('#rDetail'));
  }
  function resDetail(id, box) {
    const r = S.resellers.find((x) => x.id === Number(id));
    if (!r) return;
    const methods = String(S.payMethods || 'Wise, Kripto (USDT), PayPal, Gotovina').split(',').map((m) => m.trim()).filter(Boolean);
    box.innerHTML = `${box.id === 'rFull' ? `<a href="#/reselleri" class="btn sm ghost" style="align-self:flex-start">${ic('back')}Nazad</a>` : ''}
      <div style="display:flex;align-items:center;gap:12px"><div style="flex:1;min-width:0"><div class="h2" style="font-size:20px">${esc(r.username)}</div><div class="muted" style="font-size:12.5px">${esc(r.contact || '')} · od ${fmtDate(r.created_at)}</div></div>${r.level ? `<span class="tag lvl-${esc(r.level)}">${esc(r.level)}</span>` : ''}</div>
      <div class="mini" style="display:flex;align-items:flex-end;gap:12px;margin-top:14px"><div style="flex:1"><small>Stanje kredita</small><b class="num" style="font-size:30px">${money(r.credit)}</b></div>
        <div class="muted" style="text-align:right;font-size:12.5px">Popust ${Math.round((r.discount || 0) * 100)}%<br>Zadnja prijava: ${ago(r.last_login)}</div></div>
      ${can('finance') ? `<form id="creditForm" style="display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--line);border-radius:10px;margin-top:14px">
        <b>Dodaj kredit</b>
        <div class="row2"><label class="field">Iznos (€)<input class="input" name="amount" inputmode="decimal" required placeholder="100"></label>
        <label class="field">Način plaćanja<select class="input" name="method">${methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label></div>
        <label class="field">Bilješka (opcionalno)<input class="input" name="note"></label>
        <div style="display:flex;gap:8px"><button class="btn red" style="flex:1" type="submit" name="kind" value="topup">Dodaj na račun</button><button class="btn" type="submit" name="kind" value="adjust" title="Ispravka bez novca (npr. poklon ili greška)">Ispravka</button></div></form>` : ''}
      ${r.pending ? `<div class="banner" style="margin-top:14px">${ic('res')}<span style="flex:1">Registrovao se sam i čeka odobrenje.${r.email ? ` E-mail: ${esc(r.email)}` : ''}</span><button class="btn sm red" data-a="approveRes" data-id="${r.id}">Odobri</button></div>` : ''}
      ${r.email && !r.pending ? `<p class="muted" style="margin:10px 0 0;font-size:13px">E-mail za fakture: ${esc(r.email)}</p>` : ''}
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px">
        <button class="btn" data-a="impersonate" data-id="${r.id}">Uđi kao reseller</button>
        <button class="btn" data-a="editReseller" data-id="${r.id}">Uredi</button>
        <button class="btn" data-a="resUsers" data-id="${r.id}">Njegovi korisnici</button>
        <button class="btn danger" data-a="blockRes" data-id="${r.id}">${r.disabled ? 'Odblokiraj' : 'Blokiraj'}</button>
      </div>
      ${r.note ? `<p class="muted" style="margin:12px 0 0">Bilješka: ${esc(r.note)}</p>` : ''}`;
    const f = $('#creditForm', box);
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      try { await POST(`resellers/${r.id}/credit`, { amount: Number(String(d.amount).replace(',', '.')), method: d.method, note: d.note, kind: e.submitter.value }); toast('Kredit dodan.'); pageResellers(); } catch (err) { fail(err); }
    };
  }
  async function editReseller(id) {
    const r = id ? S.resellers.find((x) => x.id === Number(id)) : { username: '', level_id: S.levels?.[0]?.id, user_limit: 150, contact: '', brand: '', note: '' };
    const levels = S.levels || await GET('levels');
    const ok = await formLoop(`<h2>${id ? 'Uredi · ' + esc(r.username) : 'Novi reseller'}</h2>
      ${id ? '' : `<label class="field">Korisničko ime (za prijavu)<input class="input" name="username" required></label>`}
      <label class="field">${id ? 'Nova šifra (prazno = ne mijenja se)' : 'Šifra (bar 8 znakova)'}<input class="input" name="password" type="text" ${id ? '' : 'required minlength="8"'} autocomplete="new-password"></label>
      <div class="row2"><label class="field">Nivo<select class="input" name="level_id"><option value="">Bez nivoa (bez popusta)</option>${levels.map((l) => `<option value="${l.id}" ${l.id === r.level_id ? 'selected' : ''}>${esc(l.name)} · ${Math.round(l.discount * 100)}%</option>`).join('')}</select></label>
      <label class="field">Limit korisnika<input class="input" name="user_limit" value="${r.user_limit}" inputmode="numeric"></label></div>
      <div class="row2"><label class="field">Kontakt<input class="input" name="contact" value="${esc(r.contact)}" placeholder="Telegram, WhatsApp"></label><label class="field">E-mail (za fakture)<input class="input" name="email" type="email" value="${esc(r.email || '')}"></label></div>
      <label class="field">Njegov brend (opcionalno, za white-label)<input class="input" name="brand" value="${esc(r.brand)}"></label>
      <label class="field">Bilješka<input class="input" name="note" value="${esc(r.note)}"></label>
      <div class="dlg-actions">${id ? '<button class="btn danger" value="delete" formnovalidate>Obriši</button>' : ''}<span style="flex:1"></span><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    async (d) => {
      if (d._btn === 'delete') { if (!confirm('Obrisati resellera?')) throw new Error('Odustao si.'); return DEL('resellers/' + id); }
      const body = { level_id: d.level_id ? Number(d.level_id) : null, user_limit: Number(d.user_limit), contact: d.contact, email: d.email, brand: d.brand, note: d.note, password: d.password || undefined };
      if (id) return PUT('resellers/' + id, body);
      const out = await POST('resellers', { ...body, username: d.username });
      return { ...out, _login: { username: d.username, password: d.password } };
    });
    if (!ok) return;
    if (ok.id) S.selRes = ok.id;
    if (ok._login) {
      const url = resUrl() || `${location.origin}${location.pathname}`;
      const msg = `Tvoj ${S.me.brand} reseller panel:\n${url}\nKorisničko ime: ${ok._login.username}\nŠifra: ${ok._login.password}\n\nNakon prve prijave promijeni šifru (Profil).`;
      const m = await modal(`<h2>Reseller napravljen</h2><p class="muted" style="margin:0">Pošalji mu ove podatke (npr. na Telegram). Šifru panel više neće prikazati.</p>
        <div class="code" style="white-space:pre-wrap;color:var(--text)">${esc(msg)}</div>
        <div class="dlg-actions"><button class="btn" type="button" data-a="copy" data-v="${esc(msg)}">${ic('copy')}Kopiraj poruku</button><button class="btn red" value="cancel">Gotovo</button></div>`);
      if (m) m.close();
    } else toast('Spremljeno.');
    pageResellers();
  }
  async function pageLevels() {
    const levels = await GET('levels');
    S.levels = levels;
    $('#view').innerHTML = `${top('Nivoi i popusti', 'Reselleri kupuju planove jeftinije, po popustu svog nivoa', `<a class="btn" href="#/reselleri">${ic('back')}Reselleri</a><button class="btn red" data-a="editLevel">${ic('plus')}<span>Novi nivo</span></button>`)}
      <section class="grid-auto">${levels.map((l) => `<div class="card p" style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="tag lvl-${esc(l.name)}" style="font-size:13px">${esc(l.name)}</span><span class="muted" style="font-size:13px">${l.count} resellera</span></div>
        <div class="num" style="font-size:28px">${Math.round(l.discount * 100)}% popusta</div>
        <div class="muted" style="font-size:13px">Do ${l.max_users} korisnika${l.min_monthly ? ` · preporučena kupovina od ${money(l.min_monthly)} mjesečno` : ''}</div>
        <button class="btn sm" data-a="editLevel" data-id="${l.id}">Uredi</button></div>`).join('')}</section>`;
  }
  async function editLevel(id) {
    const l = id ? S.levels.find((x) => x.id === Number(id)) : { name: '', discount: 0.1, max_users: 150, min_monthly: 0 };
    const ok = await formLoop(`<h2>${id ? 'Uredi nivo' : 'Novi nivo'}</h2>
      <label class="field">Ime<input class="input" name="name" value="${esc(l.name)}" required></label>
      <div class="row2"><label class="field">Popust %<input class="input" name="discount" value="${Math.round(l.discount * 100)}" inputmode="numeric"></label><label class="field">Maksimalno korisnika<input class="input" name="max_users" value="${l.max_users}"></label></div>
      <label class="field">Preporučena mjesečna kupovina (€)<input class="input" name="min_monthly" value="${l.min_monthly}"></label>
      <div class="dlg-actions">${id ? '<button class="btn danger" value="delete" formnovalidate>Obriši</button>' : ''}<span style="flex:1"></span><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => {
      if (d._btn === 'delete') return DEL('levels/' + id);
      const body = { name: d.name, discount: Number(d.discount) / 100, max_users: Number(d.max_users), min_monthly: Number(d.min_monthly) };
      return id ? PUT('levels/' + id, body) : POST('levels', body);
    });
    if (ok) pageLevels();
  }

  // ================================================================== FINANSIJE
  const TXT = { topup: ['Kupovina kredita', 't-ok'], sale: ['Direktna prodaja', 't-ok'], credit_use: ['Potrošen kredit', 't-grey'], expense: ['Trošak', 't-bad'], adjust: ['Ispravka kredita', 't-info'] };
  async function pageFinance(params) {
    const type = params.get('type') || '';
    const tx = await GET('transactions' + (type ? '?type=' + type : ''));
    const cols = '120px 1.3fr 1.4fr 1fr .9fr .9fr';
    $('#view').innerHTML = `${top('Transakcije', 'Uplate, prodaje, troškovi i kredit resellera', `<button class="btn" data-a="newTx" data-type="expense">Upiši trošak</button><button class="btn red" data-a="newTx" data-type="sale">${ic('plus')}<span>Upiši prodaju</span></button>`)}
      <div class="chips">${[['', 'Sve'], ['topup', 'Kupovine kredita'], ['sale', 'Direktne prodaje'], ['credit_use', 'Potrošnja kredita'], ['expense', 'Troškovi']].map(([k, l]) => `<a class="chip ${type === k ? 'on' : ''}" href="#/finansije${k ? '?type=' + k : ''}">${l}</a>`).join('')}</div>
      <section class="card" style="overflow:hidden"><div class="tbl">${trow(['Datum', 'Ko', 'Vrsta', 'Način', 'Iznos', 'Faktura'], true, cols)}
      ${tx.map((t) => trow([fmtDT(t.ts), `<b>${esc(t.reseller || t.user || t.actor || '—')}</b><small>${esc(t.note || '')}</small>`, `<span class="tag ${TXT[t.type]?.[1]}">${TXT[t.type]?.[0] || t.type}</span>`, esc(t.method || '—'),
        t.amount ? `<b class="${t.amount < 0 ? 'bad' : 'ok'}">${t.amount < 0 ? '−' : '+'} ${money(Math.abs(t.amount))}</b>` : `<span class="muted">${t.credit_delta > 0 ? '+' : ''}${money(t.credit_delta)} kredita</span>`,
        t.amount > 0 ? `<a href="api/invoice/${t.id}" target="_blank" rel="noopener">${esc(t.invoice_no || 'Faktura')}</a>` : '<span class="dim">—</span>'], false, cols, ['', '', 'Vrsta', 'Način', 'Iznos', 'Faktura'])).join('') || '<div class="empty">Nema transakcija.</div>'}</div></section>`;
  }
  async function newTx(type) {
    const ok = await formLoop(`<h2>${type === 'expense' ? 'Upiši trošak' : 'Upiši prodaju'}</h2>
      <div class="row2"><label class="field">Iznos (€)<input class="input" name="amount" inputmode="decimal" required></label><label class="field">Način<input class="input" name="method" placeholder="${type === 'expense' ? 'Kartica' : 'Wise, gotovina…'}"></label></div>
      <label class="field">Opis<input class="input" name="note" placeholder="${type === 'expense' ? 'npr. Hetzner račun oktobar' : 'npr. prodaja preko Telegrama'}"></label>
      <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => POST('transactions', { type, amount: Number(String(d.amount).replace(',', '.')), method: d.method, note: d.note }));
    if (ok) { toast('Upisano.'); route(); }
  }
  async function pageReports(params) {
    const year = Number(params.get('year')) || new Date().getFullYear();
    const r = await GET('reports?year=' + year);
    const max = Math.max(1, ...r.months.map((m) => Math.max(m.income, m.expense)));
    const inc = r.months.reduce((a, m) => a + m.income, 0), exp = r.months.reduce((a, m) => a + m.expense, 0);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];
    let bars = '';
    r.months.forEach((m, i) => {
      const x = 20 + i * 57, hi = m.income / max * 160, he = m.expense / max * 160;
      bars += `<rect x="${x}" y="${170 - hi}" width="22" height="${hi}" fill="var(--acc)"/><rect x="${x + 24}" y="${170 - he}" width="12" height="${he}" fill="#8b8b98"/>`;
    });
    $('#view').innerHTML = `${top('Izvještaji', `Godina ${year}`, `<a class="btn" href="#/finansije/izvjestaji?year=${year - 1}">← ${year - 1}</a><a class="btn" href="#/finansije/izvjestaji?year=${year + 1}">${year + 1} →</a>`)}
      <section class="stats">
        <div class="stat"><div class="l"><span>Prihod</span>${ic('money')}</div><div class="v">${money(inc)}</div><div class="s muted">kredit + direktna prodaja</div></div>
        <div class="stat"><div class="l"><span>Troškovi</span>${ic('money')}</div><div class="v">${money(exp)}</div><div class="s muted">upisani troškovi</div></div>
        <div class="stat"><div class="l"><span>Dobit</span>${ic('report')}</div><div class="v ${inc - exp >= 0 ? '' : 'bad'}">${money(inc - exp)}</div><div class="s muted">serveri trenutno ${money(r.serverCost)}/mj.</div></div>
        <div class="stat"><div class="l"><span>Neiskorišten kredit</span>${ic('credit')}</div><div class="v">${money(r.unusedCredit)}</div><div class="s muted">kod ${r.unusedCreditCount} resellera</div></div>
      </section>
      <section class="card p"><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px"><h2 style="flex:1">Po mjesecima</h2><div class="legend"><span><i style="background:var(--acc);border-radius:2px"></i>Prihod</span><span><i style="background:#8b8b98;border-radius:2px"></i>Troškovi</span></div></div>
        <svg viewBox="0 0 700 175" style="width:100%;height:220px;display:block" role="img" aria-label="Prihod i troškovi po mjesecima">${bars}</svg>
        <div class="chart-days" style="grid-template-columns:repeat(12,minmax(0,1fr))">${MON.map((m) => `<span>${m}</span>`).join('')}</div></section>
      <div class="grid2"><section class="card"><div class="card-head"><h2>Mjeseci</h2></div><div class="tbl">${trow(['Mjesec', 'Prihod', 'Troškovi', 'Dobit'], true, '1fr 1fr 1fr 1fr')}
        ${r.months.filter((m) => m.income || m.expense).map((m) => trow([MON[m.month - 1], money(m.income), money(m.expense), `<b>${money(m.income - m.expense)}</b>`], false, '1fr 1fr 1fr 1fr', ['', 'Prihod', 'Troškovi', 'Dobit'])).join('') || '<div class="empty">Nema podataka.</div>'}</div></section>
        <section class="card p"><h2 style="margin-bottom:8px">Po izvoru</h2>
          <div style="display:flex;justify-content:space-between;padding:8px 0"><span>Direktna prodaja</span><b>${money(r.direct)}</b></div>
          ${r.byReseller.map((x) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--row)"><span>${esc(x.username)}</span><b>${money(x.total)}</b></div>`).join('')}</section></div>`;
  }

  // ================================================================== RESELLER: KREDIT
  async function pageCredit(params) {
    if (params?.get('placeno')) { toast('Hvala! Kredit se doda čim Stripe potvrdi plaćanje (obično par sekundi).'); history.replaceState(null, '', '#/kredit'); setTimeout(() => route(), 4000); }
    const [tx, me] = await Promise.all([GET('res/transactions'), GET('me')]);
    S.me = me;
    const p = me.pay || {};
    const cols = '120px 1.6fr 1fr 1fr';
    $('#view').innerHTML = `${top('Kredit i uplate', 'Kredit se troši kad praviš ili produžavaš korisnike')}
      <div class="grid2">
        <section class="card p"><div class="muted">Stanje kredita</div><div class="num" style="font-size:40px">${money(me.credit)}</div>
          <p class="muted" style="margin:6px 0 0">Za dopunu pošalji uplatu i javi se administratoru. Kredit se doda čim uplata stigne.</p></section>
        <section class="card p" style="display:flex;flex-direction:column;gap:8px"><h2>Kako uplatiti</h2>
          ${p.methods ? `<div class="muted">Načini: ${esc(p.methods)}</div>` : ''}
          ${p.iban ? `<div class="list-item"><span>IBAN <span class="mono">${esc(p.iban)}</span></span><button class="btn sm" data-a="copy" data-v="${esc(p.iban)}">${ic('copy')}</button></div>` : ''}
          ${p.usdt ? `<div class="list-item"><span>USDT (TRC20) <span class="mono">${esc(p.usdt)}</span></span><button class="btn sm" data-a="copy" data-v="${esc(p.usdt)}">${ic('copy')}</button></div>` : ''}
          ${p.paypal ? `<div class="list-item"><span>PayPal ${esc(p.paypal)}</span><button class="btn sm" data-a="copy" data-v="${esc(p.paypal)}">${ic('copy')}</button></div>` : ''}
          ${p.min ? `<small class="dim">Minimalna uplata: ${money(p.min)}</small>` : ''}</section>
      </div>
      ${me.stripe ? `<section class="card p"><h2 style="margin-bottom:6px">Dopuni karticom</h2><p class="muted" style="margin:0 0 12px">Plaćanje ide preko Stripea. Kredit se doda automatski čim plaćanje prođe.</p>
        <form id="stripeForm" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end"><label class="field" style="flex:1;min-width:160px">Iznos (€)<input class="input" name="amount" inputmode="decimal" required value="${Math.max(Number(p.min) || 0, 10)}"></label><button class="btn red" type="submit">${ic('credit')}Plati karticom</button></form></section>` : ''}
      <section class="card" style="overflow:hidden"><div class="card-head"><h2>Historija</h2></div><div class="tbl">${trow(['Datum', 'Opis', 'Promjena', 'Faktura'], true, cols)}
        ${tx.map((t) => trow([fmtDT(t.ts), esc(t.note || (TXT[t.type]?.[0] || t.type)), `<b class="${t.credit_delta < 0 ? '' : 'ok'}">${t.credit_delta > 0 ? '+' : ''}${money(t.credit_delta)}</b>`, t.amount > 0 ? `<a href="api/invoice/${t.id}" target="_blank" rel="noopener">${esc(t.invoice_no || 'Faktura')}</a>` : '<span class="dim">—</span>'], false, cols, ['', 'Opis', 'Promjena', 'Faktura'])).join('') || '<div class="empty">Još nema uplata.</div>'}</div></section>`;
  }

  // ================================================================== LOGOVI
  async function pageLogs(params) {
    const q = params.get('q') || '', kind = params.get('kind') || '';
    const logs = await GET(`logs?q=${encodeURIComponent(q)}&kind=${kind}`);
    const cols = '120px 1fr 1.2fr 2.6fr';
    $('#view').innerHTML = `${top('Logovi', 'Ko je šta uradio u panelu i šta se dešavalo sa serverima')}
      <div style="display:flex;flex-wrap:wrap;gap:10px"><label class="search">${ic('search')}<span class="sr">Pretraga</span><input id="logQ" value="${esc(q)}" placeholder="Traži…"></label>
        <div class="chips">${[['', 'Sve'], ['warn', 'Upozorenja'], ['error', 'Greške']].map(([k, l]) => `<a class="chip ${kind === k ? 'on' : ''}" href="#/logovi?kind=${k}&q=${encodeURIComponent(q)}">${l}</a>`).join('')}</div></div>
      <section class="card" style="overflow:hidden"><div class="tbl">${trow(['Vrijeme', 'Ko', 'Akcija', 'Detalji'], true, cols)}
        ${logs.map((a) => trow([fmtDT(a.ts), esc(a.actor), `<span class="tag ${a.kind === 'error' ? 't-bad' : a.kind === 'warn' ? 't-warn' : 't-grey'}">${esc(a.action)}</span>`, `<span class="muted">${esc(a.detail)}</span>`], false, cols, ['', 'Ko', 'Akcija', 'Detalji'])).join('') || '<div class="empty">Nema zapisa.</div>'}</div></section>`;
    $('#logQ').onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#/logovi?kind=${kind}&q=${encodeURIComponent(e.target.value)}`; };
  }

  // ================================================================== POSTAVKE
  async function pageSettings() {
    const { schema, values } = await GET('settings');
    const owner = S.me.role === 'owner';
    const [admins, keys, backups, sys] = await Promise.all([owner ? GET('admins') : [], GET('apikeys').catch(() => []), GET('backups').catch(() => []), GET('system').catch(() => null)]);
    S.settingsDirty = {};
    const ctl = (r) => {
      const v = values[r.key];
      if (r.type === 'toggle') return `<button type="button" class="switch" role="switch" aria-checked="${!!v}" aria-label="${esc(r.label)}" data-a="setToggle" data-k="${r.key}"></button>`;
      if (r.type === 'select') return `<select class="input" data-set="${r.key}" aria-label="${esc(r.label)}">${r.options.map((o, i) => `<option value="${esc(o)}" ${String(v) === o ? 'selected' : ''}>${esc(r.labels?.[i] || o)}</option>`).join('')}</select>`;
      if (r.type === 'multi') { const on = String(v || '').split(','); return r.options.map((o, i) => `<button type="button" class="chip ${on.includes(o) ? 'on' : ''}" data-a="setMulti" data-k="${r.key}" data-v="${esc(o)}">${esc(r.labels?.[i] || o)}</button>`).join(''); }
      if (r.type === 'chips') return r.options.map((o) => `<button type="button" class="chip ${v === o ? 'on' : ''}" data-a="setChip" data-k="${r.key}" data-v="${esc(o)}">${esc(o[0].toUpperCase() + o.slice(1))}</button>`).join('');
      if (r.type === 'textarea') return `<textarea class="input" data-set="${r.key}" aria-label="${esc(r.label)}">${esc(v)}</textarea>`;
      return `<input class="input${r.mono ? ' mono' : ''}" data-set="${r.key}" value="${esc(v)}" ${r.type === 'number' ? 'inputmode="decimal"' : ''} ${r.type === 'secret' ? 'autocomplete="off"' : ''} aria-label="${esc(r.label)}" ${r.key === 'admin_path' && !owner ? 'disabled' : ''}>`;
    };
    const extra = {
      sigurnost: owner ? `<div class="set-row"><div class="lbl"><b>Admin nalozi i uloge</b><small>Podrška vidi korisnike bez finansija, finansije vide samo novac</small></div><div class="ctl" style="flex-basis:100%;justify-content:stretch;flex-direction:column">
          ${admins.map((a) => `<div class="list-item"><span><b>${esc(a.username)}</b> · ${({ owner: 'Vlasnik', admin: 'Admin', support: 'Podrška', finance: 'Finansije' })[a.role]}${a.totp_on ? ' · 2FA' : ''}${a.disabled ? ' · <span class="bad">blokiran</span>' : ''}</span><span class="dim">${ago(a.last_login)}</span>${a.role !== 'owner' ? `<button class="btn sm" data-a="editAdmin" data-id="${a.id}">Uredi</button>` : '<span class="tag t-ok">Ti</span>'}</div>`).join('')}
          <button class="btn sm" style="align-self:flex-start" data-a="editAdmin">${ic('plus')}Dodaj admina</button></div></div>` : '',
      obavijesti: `<div class="set-row"><div class="lbl"><b>Probe</b><small>Prvo spremi postavke, pa probaj</small></div><div class="ctl" style="flex-wrap:wrap;gap:8px">
          <button class="btn sm" data-a="testTg">${ic('send')}Probna poruka meni</button>
          <button class="btn sm" data-a="testCbot">${ic('send')}Provjeri bota za kupce</button>
          <button class="btn sm" data-a="testMail">${ic('send')}Probni e-mail</button></div></div>`,
      placanja: `<div class="set-row"><div class="lbl"><b>Stripe webhook adresa</b><small>U Stripeu: Developers → Webhooks → Add endpoint, događaj checkout.session.completed. Tajnu (whsec_…) zalijepi gore.</small></div><div class="ctl" style="flex-basis:100%;justify-content:stretch"><div class="list-item" style="flex:1"><span class="mono">${esc((values.panel_url || location.origin).replace(/\/+$/, ''))}/stripe/webhook</span><button class="btn sm" data-a="copy" data-v="${esc((values.panel_url || location.origin).replace(/\/+$/, ''))}/stripe/webhook">${ic('copy')}</button></div></div></div>`,
      backup: `<div class="set-row"><div class="lbl"><b>Backupi</b><small>Čuvaju se u folderu data/backups na serveru panela</small></div><div class="ctl" style="flex-basis:100%;justify-content:stretch;flex-direction:column">
          ${backups.slice(0, 6).map((b) => `<div class="list-item"><span>${fmtDT(b.ts)}</span><span class="dim">${bytes(b.size)}</span><a class="btn sm" href="api/backups/${encodeURIComponent(b.name)}">${ic('down')}Preuzmi</a></div>`).join('') || '<span class="muted">Još nema backupa.</span>'}
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-a="backupNow">Napravi backup sada</button><button class="btn sm" data-a="testS3">Probaj S3</button>${owner ? '<button class="btn sm danger" data-a="restore">Vrati iz backupa…</button>' : ''}</div></div></div>`,
      api: `<div class="set-row"><div class="lbl"><b>API ključevi</b><small>Za prodajnog bota ili sajt. Dokumentacija u README fajlu.</small></div><div class="ctl" style="flex-basis:100%;justify-content:stretch;flex-direction:column">
          ${keys.map((k) => `<div class="list-item"><span><b>${esc(k.name)}</b> <span class="mono dim">${esc(k.prefix)}…</span></span><span class="dim">${k.last_used ? 'korišten ' + ago(k.last_used) : 'nije korišten'}</span><button class="btn sm danger" data-a="delKey" data-id="${k.id}">Opozovi</button></div>`).join('')}
          <button class="btn sm" style="align-self:flex-start" data-a="newKey">${ic('key')}Novi API ključ</button></div></div>`,
      sistem: sys ? `<div class="set-row"><div class="lbl"><b>Stanje</b></div><div class="ctl" style="flex-basis:100%;justify-content:stretch;flex-direction:column">
          <div class="list-item"><span>Verzija panela</span><b>${esc(sys.version)}</b></div><div class="list-item"><span>Node.js</span><span>${esc(sys.node)}</span></div>
          <div class="list-item"><span>Baza</span><span>${bytes(sys.db_size)} · ${sys.users} korisnika · ${sys.servers} servera</span></div>
          <div class="list-item"><span>Radi bez prekida</span><span>${Math.floor(sys.uptime / 3600)} h ${Math.floor(sys.uptime % 3600 / 60)} min</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${owner ? `<a class="btn sm" href="api/export.json">${ic('down')}Izvezi sve podatke</a><button class="btn sm danger" data-a="restart">Restartuj panel</button>` : ''}</div></div></div>
        ${owner ? `<div class="set-row"><div class="lbl"><b>Ažuriranje panela</b><small>Skida najnoviju verziju sa GitHuba i instalira je. Podaci ostaju.</small></div><div class="ctl" id="updBox" style="flex-basis:100%;justify-content:stretch;flex-direction:column"><span class="muted">Provjeravam…</span></div></div>` : ''}` : '',
    };
    $('#view').innerHTML = `${top('Postavke', 'Sve postavke sistema · vidi ih samo admin', `<span class="warn" id="dirty" style="font-size:13px"></span><button class="btn" data-a="reload">Poništi</button><button class="btn red" data-a="saveSettings">Spremi sve</button>`)}
      <div class="split" style="align-items:flex-start">
        <nav class="card set-nav narrow" style="flex:1 1 210px;max-width:260px" aria-label="Kategorije">${schema.map((s, i) => `<a href="javascript:void 0" data-a="jump" data-id="${s.id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</a>`).join('')}</nav>
        <div class="wide" style="display:flex;flex-direction:column;gap:16px">${schema.map((s, i) => `<section class="card set-sec" id="sec-${s.id}"><header><h2><span style="color:var(--acc-hi);margin-right:8px">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</h2><p>${esc(s.desc)}</p></header>
          ${s.rows.map((r) => `<div class="set-row"><div class="lbl"><b>${esc(r.label)}</b>${r.soon ? '<span class="soon">uskoro</span>' : ''}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div><div class="ctl">${ctl(r)}</div></div>`).join('')}
          ${extra[s.id] || ''}</section>`).join('')}</div>
      </div>`;
    $$('[data-set]').forEach((el) => { el.oninput = el.onchange = () => markDirty(el.dataset.set, el.value); });
    if ($('#updBox')) GET('system/update').then((u) => {
      const newer = u.latest && u.latest !== u.current;
      $('#updBox').innerHTML = `<div class="list-item"><span>Instalirana verzija</span><b>${esc(u.current)}</b></div>
        <div class="list-item"><span>Najnovija na GitHubu</span><b class="${newer ? 'warn' : 'ok'}">${esc(u.latest || 'nepoznato')}</b></div>
        ${u.pending ? '<span class="warn">Ažuriranje je u toku… osvježi stranicu za minut-dva.</span>' : u.ready
          ? `<button class="btn sm ${newer ? 'red' : ''}" style="align-self:flex-start" data-a="updatePanel">${newer ? 'Ažuriraj na ' + esc(u.latest) : 'Ponovo instaliraj zadnju verziju'}</button>`
          : '<span class="muted">Dugme radi nakon što jednom ažuriraš panel komandom iz README-a.</span>'}`;
    }).catch(() => { $('#updBox').innerHTML = '<span class="muted">Ne mogu provjeriti verziju.</span>'; });
    const h = location.hash.split('#sec-')[1];
    if (h) $('#sec-' + h)?.scrollIntoView();
  }
  function markDirty(k, v) { S.settingsDirty[k] = v; const n = Object.keys(S.settingsDirty).length; const d = $('#dirty'); if (d) d.textContent = n ? `${n} nespremljenih izmjena` : ''; }
  async function saveSettings() {
    try {
      const old = location.pathname;
      const r = await PUT('settings', S.settingsDirty);
      S.settingsDirty = {};
      toast('Postavke spremljene.');
      if (r.admin_path && !old.startsWith(r.admin_path + '/')) { await ask('Nova adresa panela', `Panel je sada na ${location.origin}${r.admin_path}/ — sačuvaj ovu adresu.`, 'Otvori'); location.href = r.admin_path + '/'; return; }
      S.me = await GET('me'); renderShell(); route();
    } catch (e) { fail(e); }
  }
  async function editAdmin(id) {
    const a = id ? (await GET('admins')).find((x) => x.id === Number(id)) : { username: '', role: 'support' };
    const ok = await formLoop(`<h2>${id ? 'Uredi · ' + esc(a.username) : 'Novi admin'}</h2>
      ${id ? '' : '<label class="field">Korisničko ime<input class="input" name="username" required></label>'}
      <label class="field">Uloga<select class="input" name="role">${[['admin', 'Admin (sve osim vlasničkih postavki)'], ['support', 'Podrška (korisnici, bez finansija)'], ['finance', 'Finansije (samo novac)']].map(([v, l]) => `<option value="${v}" ${a.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">${id ? 'Nova šifra (prazno = ne mijenja se)' : 'Šifra (bar 8 znakova)'}<input class="input" name="password" ${id ? '' : 'required minlength="8"'} autocomplete="new-password"></label>
      ${id ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="disabled" ${a.disabled ? 'checked' : ''}>Blokiran</label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="reset2fa">Resetuj 2FA</label>` : ''}
      <div class="dlg-actions">${id ? '<button class="btn danger" value="delete" formnovalidate>Obriši</button>' : ''}<span style="flex:1"></span><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Spremi</button></div>`,
    (d) => d._btn === 'delete' ? DEL('admins/' + id) : id ? PUT('admins/' + id, { role: d.role, password: d.password || undefined, disabled: d.disabled, reset2fa: d.reset2fa }) : POST('admins', d));
    if (ok) pageSettings();
  }

  // ================================================================== PROFIL
  async function pageProfile() {
    const sessions = await GET('sessions');
    $('#view').innerHTML = `${top('Moj profil', esc(S.me.real || S.me.username))}
      <div class="grid2">
        <section class="card p" style="display:flex;flex-direction:column;gap:12px"><h2>Promjena šifre</h2>
          <form id="pwForm" style="display:flex;flex-direction:column;gap:10px">
            <label class="field">Stara šifra<input class="input" type="password" name="old" required autocomplete="current-password"></label>
            <label class="field">Nova šifra (bar 8 znakova)<input class="input" type="password" name="new" required minlength="8" autocomplete="new-password"></label>
            <button class="btn red" type="submit" style="align-self:flex-start">Promijeni šifru</button></form></section>
        <section class="card p" style="display:flex;flex-direction:column;gap:12px"><h2>Dvostepena prijava (2FA)</h2>
          <p class="muted" style="margin:0">${S.me.totp_on ? 'Uključena. Pri prijavi trebaš kod iz aplikacije.' : 'Isključena. Preporučujemo da je uključiš: Google Authenticator, Authy ili Microsoft Authenticator.'}</p>
          <button class="btn ${S.me.totp_on ? 'danger' : 'red'}" style="align-self:flex-start" data-a="${S.me.totp_on ? 'off2fa' : 'on2fa'}">${S.me.totp_on ? 'Isključi 2FA' : 'Uključi 2FA'}</button></section>
      </div>
      <section class="card p"><h2 style="margin-bottom:10px">Aktivne prijave</h2>
        ${sessions.map((s) => `<div class="list-item" style="margin-bottom:6px"><span>${esc(s.ua.replace(/\(.*?\)/g, '').slice(0, 60) || 'Nepoznat uređaj')} · ${esc(s.ip)}</span><span class="dim">${ago(s.last_active)}</span>${s.current ? '<span class="tag t-ok">Ova</span>' : `<button class="btn sm" data-a="killSess" data-id="${s.id}">Odjavi</button>`}</div>`).join('')}</section>`;
    $('#pwForm').onsubmit = async (e) => { e.preventDefault(); try { await POST('password', Object.fromEntries(new FormData(e.target).entries())); toast('Šifra promijenjena. Ostali uređaji su odjavljeni.'); e.target.reset(); } catch (err) { fail(err); } };
  }
  async function setup2fa(forced) {
    const s = await POST('2fa/setup');
    const ok = await formLoop(`<h2>Uključi 2FA</h2>
      <p class="muted" style="margin:0">1. Otvori Google Authenticator (ili Authy) i skeniraj QR kod. 2. Upiši kod od 6 cifara.</p>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div class="qrbox" style="width:180px">${s.svg}</div><div class="mono dim" style="flex:1;min-width:160px">Ručni unos:<br>${esc(s.secret)}</div></div>
      <input type="hidden" name="secret" value="${esc(s.secret)}">
      <label class="field">Kod iz aplikacije<input class="input" name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>
      <div class="dlg-actions">${forced ? '' : '<button class="btn" value="cancel">Odustani</button>'}<button class="btn red" value="ok">Uključi</button></div>`,
    (d) => POST('2fa/enable', { secret: d.secret, code: d.code }));
    if (ok) { toast('2FA uključena.'); S.me = await GET('me'); renderShell(); route(); }
    else if (forced) setup2fa(true);
  }

  // ================================================================== "VIŠE" (telefon)
  function pageMore() {
    const items = navItems().flatMap((g) => g.items).filter(([, , h]) => !['', 'korisnici', 'serveri', 'reselleri'].includes(h));
    $('#view').innerHTML = `${top('Više', '')}
      <section class="card" style="overflow:hidden">${items.map(([i, l, h]) => `<a href="#/${h}" style="display:flex;align-items:center;gap:12px;min-height:56px;padding:0 16px;border-top:1px solid var(--row);color:var(--text);text-decoration:none"><span class="avatar" style="border-radius:9px;background:var(--row);color:var(--acc-hi)">${ic(i)}</span><span style="flex:1">${esc(l)}</span><span class="dim">›</span></a>`).join('')}</section>
      <button class="btn danger" data-a="logout">${ic('logout')}Odjava</button>`;
  }

  // ================================================================== RUTER
  async function route() {
    if (!S.me) return;
    $('#shell')?.classList.remove('open');
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const params = new URLSearchParams(qs || '');
    paintNav();
    if (path !== 'korisnici' && !path.startsWith('korisnik/')) S.sel.clear();
    if (!['', 'serveri'].includes(path)) stopLive();
    try {
      if (S.me.must2fa) { $('#view').innerHTML = top('Uključi 2FA', 'Obavezno za sve admine (postavka sigurnosti)'); return setup2fa(true); }
      if (isRes()) {
        if (path === '' ) return await pageResDash();
        if (path === 'korisnici') return await pageUsers(params);
        if (path.startsWith('korisnik/')) return await pageUser(Number(path.split('/')[1]));
        if (path === 'kredit') { await pageCredit(params); const f = $('#stripeForm'); if (f) f.onsubmit = async (e) => { e.preventDefault(); try { const r = await POST('res/stripe', { amount: Number(String(new FormData(f).get('amount')).replace(',', '.')) }); location.href = r.url; } catch (err) { fail(err); } }; return; }
        if (path === 'profil') return await pageProfile();
        location.hash = '#/'; return;
      }
      if (path === '') return await pageDash();
      if (path === 'korisnici') return await pageUsers(params);
      if (path.startsWith('korisnik/')) return await pageUser(Number(path.split('/')[1]));
      if (path === 'planovi') return await pagePlans();
      if (path === 'serveri') return await pageServers();
      if (path === 'reselleri') return await pageResellers();
      if (path === 'reselleri/nivoi') return await pageLevels();
      if (path.startsWith('reseller/')) { await pageResellers(); S.selRes = Number(path.split('/')[1]); $('#view').innerHTML = `<section class="card p" id="rFull" style="display:flex;flex-direction:column;gap:10px"></section>`; return resDetail(S.selRes, $('#rFull')); }
      if (path === 'finansije') return await pageFinance(params);
      if (path === 'finansije/izvjestaji') return await pageReports(params);
      if (path === 'logovi') return await pageLogs(params);
      if (path === 'postavke') return await pageSettings();
      if (path === 'profil') return await pageProfile();
      if (path === 'vise') return pageMore();
      $('#view').innerHTML = `${top('Stranica ne postoji', '')}<a class="btn" href="#/">Na početnu</a>`;
    } catch (e) {
      $('#view').innerHTML = `${top('Greška', '')}<div class="card p">${esc(e.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------------ klikovi
  const ACT = {
    menu: () => $('#shell').classList.toggle('open'),
    logout: async () => { await POST('logout').catch(() => {}); S.me = null; renderLogin(); },
    stopImp: async () => { await POST('impersonate/stop'); S.me = null; location.hash = '#/reselleri'; await boot(); },
    reload: () => route(),
    copy: (d) => copy(d.v),
    newUser: (d, el, e) => { e.preventDefault(); newUser().catch(fail); },
    dashDays: (d) => { S.dashDays = Number(d.n); pageDash().catch(fail); },
    dashBell: () => { const p = $('#bellPop'); if (p) p.hidden = !p.hidden; },
    toggleTheme: () => {
      const t = document.documentElement.dataset.theme === 'svijetla' ? 'tamna' : 'svijetla';
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem('vp-theme', t); } catch { /* bez pamćenja */ }
      pageDash().catch(fail);
    },
    uStatus: (d) => { S.userQ = { ...S.userQ, status: d.k, page: 1 }; history.replaceState(null, '', '#/korisnici'); pageUsers(new URLSearchParams()).catch(fail); },
    uPage: (d) => { S.userQ.page = Number(d.p); pageUsers(new URLSearchParams()).catch(fail); },
    selOne: (d, el, e) => { e.stopPropagation(); el.checked ? S.sel.add(Number(d.id)) : S.sel.delete(Number(d.id)); const b = $('[data-a="bulk"]'); if (b) { b.disabled = !S.sel.size; b.textContent = `Masovne akcije${S.sel.size ? ` (${S.sel.size})` : ''}`; } },
    selAll: (d, el) => { $$('[data-a="selOne"]').forEach((c) => { c.checked = el.checked; el.checked ? S.sel.add(Number(c.dataset.id)) : S.sel.delete(Number(c.dataset.id)); }); const b = $('[data-a="bulk"]'); if (b) { b.disabled = !S.sel.size; b.textContent = `Masovne akcije${S.sel.size ? ` (${S.sel.size})` : ''}`; } },
    openUser: (d, el, e) => {
      if (e.target.closest('input')) return;
      S.selUser = Number(d.id);
      if (innerWidth < 960 || !$('#uDetail')) { location.hash = '#/korisnik/' + d.id; return; }
      $$('.tr.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel');
      loadUserDetail(S.selUser, $('#uDetail')).catch(fail);
    },
    extend: (d) => extend(d.id).catch(fail),
    editUser: (d) => editUser(d.id).catch(fail),
    editNote: (d) => editNote(d.id).catch(fail),
    uAct: (d) => userAction(d.id, d.act),
    links: () => showLinks(),
    sendCustomer: () => sendCustomer().catch(fail),
    unblock: async (d) => { try { await PUT('users/' + d.id, { unblock: true }); toast('Odblokiran.'); refreshUser(); } catch (e) { fail(e); } },
    autoRenew: async (d, el) => { try { await PUT(R('users/' + d.id), { auto_renew: el.checked }); toast(el.checked ? 'Automatsko produženje uključeno.' : 'Automatsko produženje isključeno.'); } catch (e) { el.checked = !el.checked; fail(e); } },
    mailCustomer: async (d, el) => {
      const to = $('#custMail').value.trim();
      el.disabled = true;
      try { await POST(R(`users/${d.id}/send-mail`), { to, text: $('#custMsg').value, subject: `${S.me.brand} · tvoj VPN pristup` }); toast('E-mail poslan na ' + to); }
      catch (e) { fail(e); } finally { el.disabled = false; }
    },
    broadcast: () => broadcast().catch(fail),
    approveRes: async (d) => { try { await POST(`resellers/${d.id}/approve`); toast('Reseller odobren. Sad se može prijaviti.'); pageResellers(); } catch (e) { fail(e); } },
    showSignup: (d, el, e) => { e.preventDefault(); renderSignup(); },
    showLogin: (d, el, e) => { e.preventDefault(); renderLogin(); },
    copyMsg: () => copy($('#custMsg').value),
    qrPng: () => qrPng(S.lastUser).catch(fail),
    sendVia: (d, el, e) => {
      // ako je poruka ručno mijenjana, ubaci izmijenjen tekst u link
      const msg = $('#custMsg')?.value;
      if (!msg) return;
      if (d.tg) { copy(msg); return; }
      const href = el.getAttribute('href');
      const enc = encodeURIComponent(msg);
      if (href.startsWith('https://wa.me/') || href.startsWith('viber://')) el.href = href.replace(/text=[^&]*/, 'text=' + enc);
      else if (href.startsWith('mailto:')) el.href = href.replace(/body=[^&]*/, 'body=' + enc);
    },
    bulk: () => bulk().catch(fail),
    editPlan: (d) => editPlan(d.id).catch(fail),
    newServer: () => newServer().catch(fail),
    install: async (d) => showInstall((await GET(`servers/${d.id}/install`)).install),
    editServer: (d) => editServer(d.id).catch(fail),
    editChain: (d) => editChain(d.id).catch(fail),
    toggleChain: async (d) => { const c = S.chains.find((x) => x.id === Number(d.id)); try { await PUT('chains/' + d.id, { enabled: !c.enabled }); pageServers(); } catch (e) { fail(e); } },
    delChain: async (d) => { if (!(await ask('Obrisati lanac?', 'Kupci koji ga koriste prebacit će se na drugi server.', 'Obriši', true))) return; try { await DEL('chains/' + d.id); toast('Lanac obrisan.'); pageServers(); } catch (e) { fail(e); } },
    srvAct: async (d) => { try { await POST(`servers/${d.id}/${d.act}`); pageServers(); } catch (e) { fail(e); } },
    srvMore: (d) => srvMore(d.id).catch(fail),
    openRes: (d, el) => {
      S.selRes = Number(d.id);
      if (innerWidth < 960 || !$('#rDetail')) { location.hash = '#/reseller/' + d.id; return; }
      $$('.tr.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel');
      resDetail(S.selRes, $('#rDetail'));
    },
    newReseller: () => editReseller().catch(fail),
    editReseller: (d) => editReseller(d.id).catch(fail),
    impersonate: async (d) => { try { await POST(`resellers/${d.id}/impersonate`); S.me = null; location.hash = '#/'; await boot(); } catch (e) { fail(e); } },
    resUsers: (d) => { S.userQ = { status: 'all', q: '', plan: '', owner: String(d.id), page: 1 }; location.hash = '#/korisnici'; },
    blockRes: async (d) => {
      const r = S.resellers.find((x) => x.id === Number(d.id));
      if (r.disabled) { await POST(`resellers/${d.id}/toggle`).catch(fail); return pageResellers(); }
      const m = await modal(`<h2>Blokiraj ${esc(r.username)}</h2><p class="muted" style="margin:0">Reseller se više ne može prijaviti.</p>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="cb" name="users">Ugasi i sve njegove korisnike (${r.users})</label>
        <div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn danger" value="ok">Blokiraj</button></div>`);
      if (!m) return; m.close();
      await POST(`resellers/${d.id}/toggle`, { users: m.data.users }).catch(fail); pageResellers();
    },
    editLevel: (d) => editLevel(d.id).catch(fail),
    newTx: (d) => newTx(d.type).catch(fail),
    jump: (d) => $('#sec-' + d.id)?.scrollIntoView({ behavior: 'smooth' }),
    setToggle: (d, el) => { const v = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', String(v)); markDirty(d.k, v); },
    setChip: (d, el) => { $$(`[data-a="setChip"][data-k="${d.k}"]`).forEach((c) => c.classList.toggle('on', c === el)); markDirty(d.k, d.v); },
    saveSettings: () => saveSettings(),
    setMulti: (d, el) => { el.classList.toggle('on'); const v = $$(`[data-a="setMulti"][data-k="${d.k}"].on`).map((c) => c.dataset.v).join(','); markDirty(d.k, v); },
    testCbot: async () => { try { const r = await POST('settings/test-cbot'); toast(`Bot radi: @${r.username}`); } catch (e) { fail(e); } },
    testMail: async () => {
      const r = await formLoop('<h2>Probni e-mail</h2><label class="field">Pošalji na<input class="input" name="to" type="email" required></label><div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Pošalji</button></div>', (d) => POST('settings/test-mail', { to: d.to }));
      if (r) toast('E-mail poslan na ' + r.to + '. Provjeri i spam.');
    },
    testS3: async () => { try { await POST('settings/test-s3'); toast('S3 radi: probni fajl je u bucketu (vpn-panel/).'); } catch (e) { fail(e); } },
    updatePanel: async () => {
      if (!(await ask('Ažuriraj panel', 'Panel skida novu verziju i restartuje se. Traje 1–3 minute. VPN serveri rade normalno.', 'Ažuriraj'))) return;
      try { await POST('system/update'); toast('Ažuriranje pokrenuto. Stranica će se osvježiti za 90 sekundi.'); setTimeout(() => location.reload(), 90000); } catch (e) { fail(e); }
    },
    testTg: async () => { try { await POST('settings/test-telegram'); toast('Poruka poslana. Provjeri Telegram.'); } catch (e) { fail(e); } },
    editAdmin: (d) => editAdmin(d.id).catch(fail),
    newKey: async () => {
      const r = await formLoop('<h2>Novi API ključ</h2><label class="field">Za šta je ključ<input class="input" name="name" required placeholder="npr. Telegram prodajni bot"></label><div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn red" value="ok">Napravi</button></div>', (d) => POST('apikeys', { name: d.name }));
      if (!r) return;
      const m = await modal(`<h2>Ključ napravljen</h2><p class="muted" style="margin:0">Sačuvaj ga sada. Panel ga više neće prikazati.</p><div class="code">${esc(r.key)}</div>
        <div class="dlg-actions"><button class="btn" type="button" data-a="copy" data-v="${esc(r.key)}">${ic('copy')}Kopiraj</button><button class="btn red" value="cancel">Gotovo</button></div>`);
      if (m) m.close();
      pageSettings();
    },
    delKey: async (d) => { if (await ask('Opozovi ključ', 'Programi koji koriste ovaj ključ prestaju raditi.', 'Opozovi', true)) { await DEL('apikeys/' + d.id); pageSettings(); } },
    backupNow: async () => { try { await POST('backups'); toast('Backup napravljen.'); pageSettings(); } catch (e) { fail(e); } },
    restore: () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.db';
      inp.onchange = async () => {
        if (!inp.files[0] || !(await ask('Vrati iz backupa', 'Trenutna baza se zamjenjuje backupom (stara se čuva sa strane). Panel se restartuje.', 'Vrati', true))) return;
        try { await api('POST', 'backups/restore', inp.files[0]); toast('Backup vraćen. Panel se restartuje…'); setTimeout(() => location.reload(), 4000); } catch (e) { fail(e); }
      };
      inp.click();
    },
    restart: async () => { if (await ask('Restartuj panel', 'Panel će biti nedostupan par sekundi. VPN serveri rade normalno.', 'Restartuj')) { await POST('system/restart').catch(() => {}); toast('Restartujem…'); setTimeout(() => location.reload(), 4000); } },
    on2fa: () => setup2fa(false).catch(fail),
    off2fa: async () => {
      const ok = await formLoop('<h2>Isključi 2FA</h2><label class="field">Tvoja šifra<input class="input" type="password" name="password" required></label><div class="dlg-actions"><button class="btn" value="cancel">Odustani</button><button class="btn danger" value="ok">Isključi</button></div>', (d) => POST('2fa/disable', d));
      if (ok) { S.me = await GET('me'); renderShell(); route(); }
    },
    killSess: async (d) => { await DEL('sessions/' + d.id).catch(fail); pageProfile(); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = ACT[el.dataset.a];
    if (!fn) return;
    if (el.tagName === 'BUTTON' && el.closest('#modalForm') && el.dataset.a === 'copy') e.preventDefault();
    if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('javascript')) e.preventDefault();
    fn(el.dataset, el, e);
  });
  // Ctrl+K: pretraga; klik van zvona zatvara obavijesti
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      const i = $('#dashSearch') || $('.search input');
      if (i) { e.preventDefault(); i.focus(); i.select(); }
    }
  });
  document.addEventListener('click', (e) => { const p = $('#bellPop'); if (p && !p.hidden && !e.target.closest('#bellPop, [data-a="dashBell"]')) p.hidden = true; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest?.('.tr.click') && !e.target.matches('input')) e.target.closest('.tr.click').click(); });

  // ------------------------------------------------------------------ start
  async function boot() {
    try { S.me = await api('GET', 'me'); } catch { S.me = null; return renderLogin(); }
    document.title = `${S.me.brand} · Panel`;
    S.badges = {};
    if (!isRes()) {
      try {
        const st = await GET('settings').catch(() => null);
        if (st) { S.payMethods = st.values.pay_methods; S.me.panel_url_set = !!st.values.panel_url; }
      } catch { /* bez dozvole */ }
    }
    renderShell();
    route();
  }
  boot();
})();
