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
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
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
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(buf);
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
