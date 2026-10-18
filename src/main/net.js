'use strict';

const https = require('https');
const tls = require('tls');

// HTTPS requests. They trust only the public certificate authorities that ship with Node - not
// certificates added to Windows, nor ones slipped in through NODE_EXTRA_CA_CERTS - so a proxy that opens HTTPS
// with a certificate of its own (Fiddler, Charles, HTTP Toolkit, mitmproxy) gets no connection at all.
const agent = new https.Agent({ ca: tls.rootCertificates, keepAlive: true });

function request(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(new Error('only https'));
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const req = https.request(target, {
      method, agent, timeout,
      headers: { ...headers, ...(payload ? { 'Content-Length': payload.length } : {}) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: async () => text });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { request };
