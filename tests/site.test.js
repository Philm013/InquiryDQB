'use strict';
/** The static site: landing page, manifests, service worker precache, offline start-up, no external requests. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, ROOT } = require('./harness');

let env;
before(async () => { env = await boot(); });
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('landing page: join form validates inline, forwards a clean code, and nothing overflows', async () => {
  for (const device of ['desktop', 'phone']) {
    const p = await env.open(device, '/');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${device}: no horizontal scroll`);
    assert.equal(await p.textContent('#year'), String(new Date().getFullYear()));
    const broken = await p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
    assert.deepEqual(broken, [], `${device}: every image loads`);
    for (const id of ['how', 'features', 'privacy', 'faq', 'join']) assert.equal(await p.locator('#' + id).count(), 1, `#${id} exists`);
  }
  const p = await env.open('desktop', '/');
  await p.fill('#join-code', 'x');
  await p.click('#join button[type=submit]');
  await p.waitForSelector('#join-err', { state: 'visible' });                                // an inline message, never a native alert
  await p.fill('#join-code', 'k7q 2xr');
  await Promise.all([p.waitForURL(/\/Student\/\?join=K7Q2XR/), p.click('#join button[type=submit]')]);
  await p.waitForSelector('body[data-ready="1"]');
  assert.match(await p.textContent('#join-chip'), /K7Q-2XR/);
});

test('every page makes requests only to its own origin and the PeerJS service', async () => {
  for (const url of ['/', '/Teacher/', '/Student/']) {
    const p = await env.open('desktop');
    const foreign = [];
    p.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== env.origin && !/^(data|blob):/.test(r.url())) foreign.push(r.url()); });
    await p.goto(env.origin + url);
    await p.waitForTimeout(1200);
    assert.deepEqual(foreign, [], `${url} loads nothing from third-party hosts (no CDNs, no analytics, no web fonts)`);
  }
});

test('manifests are valid and every icon, script and style they or the service worker rely on exists', async () => {
  for (const app of ['Teacher', 'Student']) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, app, 'manifest.webmanifest'), 'utf8'));
    assert.ok(m.name && m.start_url && m.display, `${app}: has name, start_url and display`);
    assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') || m.icons.some((i) => /maskable/.test(i.purpose || '')), `${app}: has a maskable icon`);
    for (const icon of m.icons) assert.ok(fs.existsSync(path.join(ROOT, app, icon.src)), `${app}: ${icon.src} exists`);
  }
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const u of shell) {
    const file = path.join(ROOT, u === './' ? 'index.html' : u);
    const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    assert.ok(fs.existsSync(target) || /\/$/.test(u), `service worker precache entry exists: ${u}`);
  }
  for (const page of ['index.html', 'Teacher/index.html', 'Student/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(?!https?:|#|data:|mailto:)([^"?#]+)/g)) {
      const ref = path.join(ROOT, path.dirname(page), m[1]);
      assert.ok(fs.existsSync(ref) || /\/$/.test(m[1]), `${page} references an existing file: ${m[1]}`);
    }
  }
});

test('a strict Content-Security-Policy is in place: no inline scripts, and injected markup cannot run code', async () => {
  for (const page of ['index.html', 'Teacher/index.html', 'Student/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    assert.match(csp, /script-src 'self'(;|$)/, `${page}: scripts may only come from this site (no 'unsafe-inline', no 'unsafe-eval')`);
    assert.doesNotMatch(csp, /unsafe-eval/, `${page}: no eval`);
    assert.match(csp, /object-src 'none'/, `${page}: no plugins`);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/g)].length;
    assert.equal(inline, 0, `${page}: no inline <script> blocks`);
    assert.doesNotMatch(html, /\son(click|error|load|mouseover|focus|change|submit)\s*=/i, `${page}: no inline event-handler attributes`);
  }
  // even if escaping ever failed, the browser itself refuses to run injected handlers and scripts
  const c = await env.context('desktop');
  const p = await c.newPage();                                                          // (not recorded: the violations below are expected)
  await p.goto(env.origin + '/Student/');
  await p.waitForSelector('body[data-ready="1"]');
  const violations = await p.evaluate(() => new Promise((resolve) => {
    const seen = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
    document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__ran=1"><iframe srcdoc="<script>parent.__ran=2<\/script>"></iframe>');
    const s = document.createElement('script'); s.textContent = 'window.__ran = 3'; document.body.appendChild(s);
    setTimeout(() => resolve({ ran: window.__ran, seen }), 600);
  }));
  assert.equal(violations.ran, undefined, 'no injected code ran');
  assert.ok(violations.seen.length >= 2, `the browser reported the blocked attempts (${violations.seen.join(', ')})`);
});

test('after one visit the teacher console and student app start without a network', async () => {
  const ctx = await env.context('desktop');
  const p = await ctx.newPage();
  for (const url of ['/Teacher/', '/Student/']) {
    await p.goto(env.origin + url);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.waitForFunction(() => navigator.serviceWorker.controller || true);
    await p.reload();                                                                         // now controlled by the worker
    await p.waitForTimeout(500);
  }
  await ctx.setOffline(true);
  await p.goto(env.origin + '/Teacher/');
  await p.waitForSelector('#btn-new-board', { timeout: 8000 });
  assert.equal(await p.evaluate(() => typeof window.Shell), 'object', 'the console boots from cache');
  await p.goto(env.origin + '/Student/');
  await p.waitForSelector('body[data-ready="1"]', { timeout: 8000 });
  assert.equal(await p.isVisible('#v-setup'), true, 'the student app boots from cache');
  await ctx.setOffline(false);
});
