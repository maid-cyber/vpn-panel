// Zemlja sa vezama između gradova (sajt). Kopija iz app.js (prijava u panel).
(function () {
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
  function startGlobe(cv) {
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(document.documentElement);
    const acc = (css.getPropertyValue('--acc-hi') || '#ff5a6a').trim();
    const rgb = (h) => { const m = h.replace('#', '').match(/../g) || ['ff', '5a', '6a']; return m.map((x) => parseInt(x, 16)).join(','); };
    const A = rgb(acc.length === 7 ? acc : '#ff5a6a'), B = (css.getPropertyValue('--gl-b') || '120,160,255').trim();
    const G1 = (css.getPropertyValue('--gl-1') || '#13204a').trim(), G2 = (css.getPropertyValue('--gl-2') || '#050a1c').trim(), GD = (css.getPropertyValue('--gl-dot') || '#7fa2ff').trim();
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
      if (cv.dataset.fit === 'box') { R = Math.min(W, H) * 0.4; cx = W / 2; cy = H / 2; }   // sajt: kugla u sredini okvira
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
      g.addColorStop(0, G1); g.addColorStop(1, G2);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.29); ctx.fill();
      ctx.strokeStyle = `rgba(${B},.35)`; ctx.lineWidth = 1.2; ctx.stroke();
      // kopno (tačke), svjetlije prema sredini
      for (const d of dots) {
        const p = proj(vec(d));
        if (p[2] <= 0) continue;
        ctx.globalAlpha = 0.25 + 0.75 * p[2];
        ctx.fillStyle = GD;
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

  window.startGlobe = startGlobe;
})();
