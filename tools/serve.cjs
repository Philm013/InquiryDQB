#!/usr/bin/env node
'use strict';
/**
 * Tiny static file server for local development and the test suite.
 *   node tools/serve.cjs [port]      →  http://localhost:8080/
 * Serves the repository root the way GitHub Pages does (a folder URL opens its index.html).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
};

function createServer() {
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { res.writeHead(400).end(); return; }
    let file = path.join(ROOT, pathname);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch (e) { /* 404 below */ }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {                  // byte ranges, so a <video> can seek
        let start = m[1] ? +m[1] : Math.max(0, buf.length - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
        if (start >= buf.length || start > end) { res.writeHead(416, { 'content-range': `bytes */${buf.length}` }).end(); return; }
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'no-cache' }).end(buf.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' }).end(buf);
    });
  });
}

/** Starts listening; port 0 picks a free one. Resolves with { server, port }. */
function serveStatic(port = 0, host = '127.0.0.1') {
  const server = createServer();
  return new Promise((resolve, reject) => { server.on('error', reject); server.listen(port, host, () => resolve({ server, port: server.address().port })); });
}

module.exports = { serveStatic, ROOT };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8080;
  serveStatic(port, '0.0.0.0').then(({ port: p }) => console.log(`InquiryDQB is running at http://localhost:${p}/  (Teacher: /Teacher/, Student: /Student/)`));
}
