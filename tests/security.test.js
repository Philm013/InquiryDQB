'use strict';
/**
 * Hostile-client tests. A "rogue" page speaks the wire protocol directly, the way a malicious student could,
 * and we check that nothing executes, nothing outside the student permission set is honoured, and the host stays healthy.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env, teacher, rogue, code;
const T = (fn, arg) => teacher.evaluate(fn, arg);
const send = (msg) => rogue.evaluate((m) => window.__rogue.conn.send(typeof m === 'string' ? m : JSON.stringify(m)), msg);
const received = () => rogue.evaluate(() => window.__rogue.log.slice());
const PWN = 'window.__pwned=1';

before(async () => {
  env = await boot();
  teacher = await env.teacher();
  code = await T(() => Network.getCode());
  // the rogue client reuses the student page only to get PeerJS and the Net helpers
  rogue = await env.open('phone', '/Student/');
  await rogue.waitForSelector('body[data-ready="1"]');
  await rogue.evaluate((c) => new Promise((resolve, reject) => {
    const peer = Net.newPeer();
    window.__rogue = { peer, conn: null, log: [] };
    peer.on('error', reject);
    peer.on('open', () => {
      const conn = peer.connect(Net.codeToPeerId(c), { reliable: true });
      window.__rogue.conn = conn;
      conn.on('data', (d) => { try { window.__rogue.log.push(typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { /* ignore */ } });
      conn.on('open', () => resolve(true));
    });
  }), code);
});
after(async () => { await env.close(); });

test('hostile names and avatars are neutralised before they reach the roster', async () => {
  await send({ type: 'JOIN', name: `<img src=x onerror="${PWN}">Eve`, avatar: `<svg onload=${PWN}>`, sid: 'EVIL1', v: 2 });
  await teacher.waitForFunction(() => Object.values(State.students).some((s) => s.sid === 'EVIL1'));
  const eve = await T(() => Object.values(State.students).find((s) => s.sid === 'EVIL1'));
  assert.ok(!/[<>]/.test(eve.name), 'angle brackets are stripped from names');
  assert.equal(eve.avatar, '😀', 'unknown avatars fall back to the default');
  await T(() => Shell.Panel.open('students'));
  assert.equal(await T(() => document.querySelectorAll('#roster img, #roster svg[onload]').length), 0);
  assert.equal(await T(() => window.__pwned), undefined);
});

test('hostile note text is stored and rendered as plain text', async () => {
  await T(() => Network.transitionTo('OPEN'));
  await send({ type: 'NOTE', id: 'xss1', sub: '<b>bad</b>', text: `<img src=x onerror=${PWN}>`, zoneId: null });
  await teacher.waitForFunction(() => State.items.some((i) => i.id === 'xss1'));
  const note = await T(() => State.items.find((i) => i.id === 'xss1'));
  assert.equal(note.sub, 'notice', 'unknown note types are coerced');
  assert.equal(note.text, `<img src=x onerror=${PWN}>`);
  await teacher.waitForTimeout(300);
  assert.equal(await T(() => document.querySelectorAll('[id="xss1"] img').length), 0, 'no element was created from the text');
  assert.equal(await T(() => document.querySelector('[id="xss1"] textarea').value), `<img src=x onerror=${PWN}>`);
  assert.equal(await T(() => window.__pwned), undefined);
});

test('other students see that text inertly when it becomes part of a vote', async () => {
  const maya = await env.student(code, 'Maya', 'phone', 3);
  await T(() => {
    StateManager.addItem({ id: 'zx', type: 'zone', title: 'Z', x: 0, y: 600, w: 500, h: 300, children: [], groupId: null });
    StateManager.addItem({ id: 'plain', type: 'note', sub: 'idea', text: 'A normal idea', x: 0, y: 0, w: 140, h: 120, author: 'T', votes: 0, groupId: null });
    HierarchyManager.link('plain', 'zx'); HierarchyManager.link('xss1', 'zx');
    StateManager.setSelection(['zx']); Network.startActivity('vote');
  });
  await maya.waitForSelector('.choice');
  assert.equal(await maya.locator('.choice img').count(), 0);
  assert.match(await maya.textContent('#board-content'), /<img src=x onerror=/);
  assert.equal(await maya.evaluate(() => window.__pwned), undefined);
});

test('students cannot send host-only or co-host-only messages', async () => {
  const before = await T(() => ({ n: State.items.length, ink: State.ink.length }));
  await send({ type: 'ADD_ITEM', item: { id: 'forged', type: 'note', sub: 'idea', text: 'forged', x: 0, y: 0, w: 100, h: 100 } });
  await send({ type: 'FULL_SYNC', items: [], ink: [], activity: { type: 'LOCKED' } });
  await send({ type: 'NOTE_UPDATE', note: { id: 'plain', type: 'note', text: 'hijacked', x: 0, y: 0, w: 100, h: 100 } });
  await send({ type: 'BATCH_UPDATE', items: [{ id: 'plain', text: 'hijacked' }] });
  await send({ type: 'INK_ADD', ink: { id: 'i', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4 } });
  await send({ type: 'GROUP_ITEMS', ids: ['plain', 'xss1'], groupId: 'g' });
  await send({ type: 'DELETE_NOTE', id: 'plain' });                                  // someone else's note
  await send({ type: 'STOP_ACT' });
  await teacher.waitForTimeout(800);
  const after = await T(() => ({ n: State.items.length, ink: State.ink.length, text: State.items.find((i) => i.id === 'plain').text, forged: State.items.some((i) => i.id === 'forged'), activity: State.activity.type }));
  assert.equal(after.n, before.n);
  assert.equal(after.ink, before.ink);
  assert.equal(after.forged, false);
  assert.equal(after.text, 'A normal idea');
  assert.equal(after.activity, 'ZONE_ACT', 'the running activity was not stopped by a student');
});

test('students cannot overwrite another student’s note or smuggle in remote or SVG images', async () => {
  await send({ type: 'NOTE', id: 'plain', sub: 'idea', text: 'overwritten', zoneId: null });
  await send({ type: 'IMG_NOTE', id: 'img1', src: 'javascript:alert(1)', text: 'x' });
  await send({ type: 'IMG_NOTE', id: 'img2', src: 'https://evil.example/pixel.png', text: 'x' });
  await send({ type: 'IMG_NOTE', id: 'img3', src: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', text: 'x' });
  await T(() => Network.transitionTo('OPEN'));
  await send({ type: 'IMG_NOTE', id: 'img4', src: 'data:image/png;base64,iVBORw0KGgo=', text: 'tiny but valid' });
  await teacher.waitForFunction(() => State.items.some((i) => i.id === 'img4'));
  const s = await T(() => ({ plain: State.items.find((i) => i.id === 'plain').text, bad: ['img1', 'img2', 'img3'].filter((id) => State.items.some((i) => i.id === id)) }));
  assert.equal(s.plain, 'A normal idea');
  assert.deepEqual(s.bad, []);
  assert.ok((await received()).some((m) => m.type === 'NOTE_STATUS' && m.id === 'img2' && m.status === 'rejected'), 'the sender is told the image was refused');
});

test('a wrong co-host key gets nothing; an oversized message and a flood are absorbed', async () => {
  await send({ type: 'AUTH_COHOST', key: 'WRONGKEY' });
  await teacher.waitForTimeout(600);
  const log = await received();
  assert.ok(!log.some((m) => m.type === 'FULL_SYNC' || m.type === 'AUTH_OK'), 'no board state was leaked');

  await send('x'.repeat(4_500_000));                                                  // far larger than any real message
  const notes = () => T(() => State.items.filter((i) => i.sid === 'EVIL1').length);
  const start = await notes();
  await rogue.evaluate(() => { for (let i = 0; i < 400; i++) window.__rogue.conn.send(JSON.stringify({ type: 'NOTE', id: 'flood' + i, sub: 'idea', text: 'spam ' + i })); });
  await teacher.waitForTimeout(2500);
  const total = await notes();
  assert.ok(total - start < 100, `flood limited (${total - start} accepted of 400)`);
  assert.ok(total <= 80, `a single student can hold at most 80 notes (has ${total})`);
  // and the host is still healthy and responsive
  assert.equal(await T(() => Network.status), 'ready');
  const p = await env.student(code, 'Ana', 'phone', 5);
  assert.equal(await p.textContent('#conn-text'), 'Connected');
});
