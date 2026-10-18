'use strict';
// QR kod kao PNG (e-mail programi ne prikazuju SVG): crno-bijela slika bez dodatnih biblioteka.
const zlib = require('node:zlib');
const QR = require('../public/qr.js');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG sa QR kodom; scale = pikseli po modulu, border = bijeli rub u modulima. */
function png(text, scale = 8, border = 4) {
  const m = QR.encode(text, 'M');
  const n = (m.length + border * 2) * scale;
  const raw = Buffer.alloc((n + 1) * n, 255);
  for (let y = 0; y < n; y++) {
    raw[y * (n + 1)] = 0; // filter: none
    const my = Math.floor(y / scale) - border;
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / scale) - border;
      if (my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx]) raw[y * (n + 1) + 1 + x] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { png };
