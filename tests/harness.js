'use strict';
/**
 * Test harness: a static file server for the repo, a local PeerServer (so tests never touch the
 * public PeerJS cloud), and a headless Chromium with helpers to open Teacher / Student pages.
 *
 *   const { boot } = require('./harness');
 *   const env = await boot();
 *   const teacher = await env.open('desktop', '/Teacher/');
 *   ...
 *   await env.close();
 */
const path = require('path');
const { serveStatic, ROOT } = require('../tools/serve.cjs');

/** Finds a free TCP port (PeerServer's callback does not always report the port it picked). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = require('net').createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
};

async function boot() {
  const { chromium } = require('playwright');
  const web = await serveStatic();
  const peerPort = await freePort();
  const { PeerServer } = require('peer');
  const peerHttp = await new Promise((resolve) => { PeerServer({ port: peerPort, host: '127.0.0.1', path: '/', allow_discovery: false }, resolve); });
  const origin = `http://127.0.0.1:${web.port}`;
  const peerOpts = { host: '127.0.0.1', port: peerPort, path: '/', secure: false };
  // DQB_CHROMIUM lets sandboxes and CI use a browser that is already installed instead of Playwright's own download
  const browser = await chromium.launch({ executablePath: process.env.DQB_CHROMIUM || undefined, args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream'] });
  const contexts = [];
  const pageErrors = [];

  const env = {
    origin, peerOpts, browser, pageErrors,
    /** New isolated browser profile (own storage) pointing at the local PeerServer. */
    async context(device = 'desktop', extra = {}) {
      const c = await browser.newContext({ ...(DEVICES[device] || DEVICES.desktop), ...extra });
      await c.addInitScript((o) => { window.DQB_PEER_OPTS = o; }, peerOpts);
      contexts.push(c);
      return c;
    },
    /** Opens a page in a fresh context and records uncaught page errors. */
    async open(device, urlPath, extra) {
      const c = await env.context(device, extra);
      const page = await c.newPage();
      page.on('pageerror', (e) => pageErrors.push(`${urlPath}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) pageErrors.push(`${urlPath} console: ${m.text()}`); });
      if (urlPath) await page.goto(origin + urlPath);
      return page;
    },
    async teacher(device = 'desktop') {
      const p = await env.open(device, '/Teacher/');
      await p.click('#btn-new-board');
      await p.waitForFunction(() => window.Network && Network.status === 'ready', null, { timeout: 20000 });
      return p;
    },
    /** Opens the Student app via the join link, picks a name and waits until connected. */
    async student(code, name = 'Maya', device = 'phone', avatarIndex = 3) {
      const p = await env.open(device, '/Student/?join=' + code);
      await p.waitForSelector('body[data-ready="1"]');
      await p.fill('#inp-name', name);
      await p.click(`#av-grid .av:nth-child(${avatarIndex})`);
      await p.click('#btn-setup');
      await p.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 25000 });
      return p;
    },
    async close() {
      for (const c of contexts) await c.close().catch(() => {});
      await browser.close().catch(() => {});
      for (const srv of [web.server, peerHttp]) { try { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); } catch (e) { /* ignore */ } }
    }
  };
  return env;
}

/** Waits for a condition evaluated in the page (shorter alias with a clearer message). */
async function until(page, fn, arg, timeout = 15000) {
  await page.waitForFunction(fn, arg, { timeout });
}

module.exports = { boot, until, ROOT, DEVICES };
