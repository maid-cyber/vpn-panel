'use strict';
// Slanje e-maila preko SMTP-a (Brevo, Gmail, Zoho, Mailgun…) bez dodatnih biblioteka.
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const os = require('node:os');
const settings = require('./settings');

function configured() {
  const s = settings.load();
  return !!(s.smtp_host && s.smtp_from);
}

// čita SMTP odgovore (i višelinijske "250-...") i vraća ih jedan po jedan
function reader(sock) {
  let buf = '', waiting = null, lines = [];
  const queue = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const resp = { code: Number(line.slice(0, 3)), text: lines.join('\n') };
        lines = [];
        if (waiting) { const w = waiting; waiting = null; w.resolve(resp); } else queue.push(resp);
      }
    }
  };
  sock.on('data', onData);
  return {
    next: (ms = 20000) => new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const t = setTimeout(() => { waiting = null; reject(new Error('SMTP server ne odgovara.')); }, ms);
      waiting = { resolve: (r) => { clearTimeout(t); resolve(r); } };
    }),
    detach: () => sock.off('data', onData),
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function fmtAddr(a) {
  const m = String(a).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { header: `${encWord(m[1].replace(/"/g, ''))} <${m[2]}>`, addr: m[2] } : { header: String(a).trim(), addr: String(a).trim() };
}
function wrap64(s) { return s.replace(/.{1,76}/g, '$&\r\n'); }

function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'b' + crypto.randomBytes(12).toString('hex');
  const head = [
    `From: ${from.header}`, `To: ${to.header}`, `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(10).toString('hex')}@${from.addr.split('@')[1] || 'localhost'}>`,
    'MIME-Version: 1.0',
  ];
  let body;
  if (html) {
    head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap64(b64(text || '')),
      `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap64(b64(html)), `--${boundary}--`, ''].join('\r\n');
  } else {
    head.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    body = wrap64(b64(text || ''));
  }
  // tačka na početku linije se udvostručuje (SMTP pravilo)
  return (head.join('\r\n') + '\r\n\r\n' + body).replace(/\r\n\./g, '\r\n..');
}

async function sendMail({ to, subject, text, html }) {
  const s = settings.load();
  if (!configured()) throw new Error('E-mail nije podešen (Postavke → Obavještenja).');
  const port = Number(s.smtp_port || 587);
  const host = s.smtp_host.trim();
  const from = fmtAddr(s.smtp_from), rcpt = fmtAddr(to);
  if (!/@/.test(rcpt.addr)) throw new Error('Neispravna e-mail adresa primaoca.');

  let sock = port === 465
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  sock.setTimeout(30000, () => sock.destroy(new Error('SMTP veza je istekla.')));
  await new Promise((res, rej) => { sock.once(port === 465 ? 'secureConnect' : 'connect', res); sock.once('error', rej); });
  let rd = reader(sock);
  const cmd = async (line, ok, secret) => {
    if (line != null) sock.write(line + '\r\n');
    const r = await rd.next();
    if (!ok.includes(r.code)) throw new Error(`SMTP: ${secret ? 'prijava odbijena' : r.text.slice(0, 200)}`);
    return r;
  };
  try {
    await cmd(null, [220]);
    const me = os.hostname() || 'localhost';
    let ehlo = await cmd(`EHLO ${me}`, [250]);
    if (port !== 465 && /STARTTLS/i.test(ehlo.text)) {
      await cmd('STARTTLS', [220]);
      rd.detach();
      sock = tls.connect({ socket: sock, servername: host });
      await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
      rd = reader(sock);
      ehlo = await cmd(`EHLO ${me}`, [250]);
    }
    if (s.smtp_user) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(s.smtp_user), [334]);
      await cmd(b64(s.smtp_pass || ''), [235], true);
    }
    await cmd(`MAIL FROM:<${from.addr}>`, [250]);
    await cmd(`RCPT TO:<${rcpt.addr}>`, [250, 251]);
    await cmd('DATA', [354]);
    await cmd(buildMessage({ from, to: rcpt, subject, text, html }) + '\r\n.', [250]);
    sock.write('QUIT\r\n');
    return { ok: true };
  } finally {
    setTimeout(() => sock.destroy(), 500);
  }
}

module.exports = { sendMail, configured, buildMessage };
