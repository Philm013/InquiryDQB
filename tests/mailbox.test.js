'use strict';
/**
 * Boards open without the teacher (DQB_HOST.mailbox in the student app, DQB_HOST.inbox in the console).
 *
 * A host site can leave a board open for its students while the console is closed: the student app talks to the site instead
 * of a live connection, and the console takes in what students added the next time it opens the board (and every few seconds
 * while it is open). The site is faked here in Node, and behaves like TechieTeaching's (models/InquiryOpen.php): it keeps every
 * message in an inbox until the console says the board holding it is saved.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

const SID_MAYA = 'tt-mayaAccount000001', SID_BEN = 'tt-benAccount0000001';
let env, PNG;

/* ---- the fake site ---------------------------------------------------------------------------------------------------- */
const site = {
  board: null, settings: null, until: '2031-06-01T15:00:00Z', closed: false,
  inbox: [], nextId: 1, failSends: 0, acks: [], views: 0, saves: 0
};
const copy = (x) => JSON.parse(JSON.stringify(x));
const byId = () => Object.fromEntries(site.board.items.map((i) => [i.id, i]));

function view(sid) {
  site.views++;
  if (site.closed) return { gone: true, msg: 'Your teacher closed this board.' };
  const items = site.board.items, all = byId(), set = site.settings;
  const shared = set.shared.map((id) => all[id]).filter(Boolean).map((i) => ({ id: i.id, type: 'media', kind: i.kind, title: i.title }));
  const open = site.inbox.filter((r) => !r.merged);
  const mine = {};
  items.forEach((i) => { if (i.type === 'note' && i.sid === sid) mine[i.id] = 'on'; });
  open.filter((r) => r.sid === sid && (r.msg.type === 'NOTE' || r.msg.type === 'IMG_NOTE')).forEach((r) => { if (!mine[r.msg.id]) mine[r.msg.id] = set.approve ? 'pending' : 'queued'; });
  site.inbox.filter((r) => r.merged && r.sid === sid && r.msg.type === 'NOTE').forEach((r) => { if (!mine[r.msg.id] && !all[r.msg.id]) mine[r.msg.id] = 'removed'; });
  let wall = null;
  if (set.see) {
    const note = (i) => ({ id: i.id, sub: i.sub, text: i.text || '', author: i.sid === sid ? 'You' : (i.author || 'Teacher'), mine: i.sid === sid, sketch: !!i.src });
    const zones = items.filter((i) => i.type === 'zone').map((z) => ({ id: z.id, title: z.title, notes: (z.children || []).map((c) => all[c]).filter((i) => i && i.type === 'note').map(note) }));
    const placed = new Set(zones.flatMap((z) => z.notes.map((n) => n.id)));
    const loose = items.filter((i) => i.type === 'note' && !placed.has(i.id)).map(note);
    open.filter((r) => r.msg.type === 'NOTE' && !all[r.msg.id] && (r.sid === sid || !set.approve)).forEach((r) => loose.push({ id: r.msg.id, sub: r.msg.sub, text: r.msg.text, author: r.sid === sid ? 'You' : r.name, mine: r.sid === sid, sketch: false, waiting: true }));
    wall = { zones: zones.filter((z) => z.notes.length), loose };
  }
  return { session: 7, board: { id: site.board.id, title: site.board.name }, until: site.until, teacher: 'Ms Rivera', lesson: 'Pond life', notes: { open: set.notes, zone: null }, rules: { names: set.names, approve: set.approve, peers: set.see }, shared, wall, mine };
}
function item(sid, itemId) {
  if (site.closed) return { closed: true };
  const it = byId()[itemId];
  if (!it || !site.settings.shared.includes(itemId)) return { id: itemId, gone: true };
  const annos = (it.annos || []).slice();
  site.inbox.filter((r) => !r.merged && r.msg.type === 'ANNO_ADD' && r.msg.item === itemId).forEach((r) => { if (!annos.some((a) => a.id === r.msg.a.id)) annos.push({ ...r.msg.a, by: { n: r.name, r: 's', sid: r.sid }, ts: r.ts }); });
  return { id: itemId, src: it.src, annos: annos.filter((a) => a.by.r === 't' || a.by.sid === sid || site.settings.see).map((a) => { const c = { ...a, by: { n: a.by.n, r: a.by.r } }; if (a.by.sid === sid) c.mine = true; return c; }) };
}
function send(sid, name, msg) {
  if (site.closed) return { status: 'closed', msg: 'Your teacher closed this board.' };
  if (site.failSends > 0) { site.failSends--; throw new Error('The site could not be reached'); }
  if (!['NOTE', 'IMG_NOTE', 'DELETE_NOTE', 'ANNO_ADD', 'ANNO_DEL', 'EXPLORE'].includes(msg && msg.type)) return { status: 'bad' };
  if (msg.type === 'DELETE_NOTE') {
    site.inbox = site.inbox.filter((r) => !(r.sid === sid && !r.merged && r.msg.type === 'NOTE' && r.msg.id === msg.id));
    if (!byId()[msg.id]) return { status: 'queued' };
  }
  if (msg.type === 'ANNO_ADD' && site.inbox.some((r) => r.msg.type === 'ANNO_ADD' && r.msg.id === msg.id)) return { status: site.settings.approve ? 'pending' : 'queued' };
  site.inbox.push({ id: site.nextId++, sid, name, msg: copy(msg), ts: Date.now(), merged: false });
  return { status: site.settings.approve && ['NOTE', 'IMG_NOTE', 'ANNO_ADD'].includes(msg.type) ? 'pending' : 'queued' };
}
function pull() {
  return {
    open: site.closed ? null : { session: 7, until: site.until, settings: site.settings },
    sessions: { 7: site.settings },
    entries: site.inbox.filter((r) => !r.merged).map((r) => ({ id: r.id, session: 7, sid: r.sid, name: r.name, msg: r.msg, ts: r.ts }))
  };
}
function siteCall(action, a) {
  a = a || {};
  switch (action) {
    case 'list': return site.closed ? [] : [{ id: 7, title: site.board.name, teacher: 'Ms Rivera', lesson: 'Pond life', until: site.until }];
    case 'view': return view(a.sid);
    case 'item': return item(a.sid, a.itemId);
    case 'send': return send(a.sid, a.name, a.msg);
    case 'pull': return pull();
    case 'ack': { const ids = new Set(a.ids); site.inbox.forEach((r) => { if (ids.has(r.id)) r.merged = true; }); site.acks.push(a.ids.slice()); return { merged: a.ids.length }; }
    case 'boards': return [{ id: site.board.id, name: site.board.name, ts: site.board.ts, notes: site.board.items.filter((i) => i.type === 'note').length, preview: [] }];
    case 'load': return a.id === site.board.id ? copy(site.board) : null;
    case 'save': site.board = copy(a.board); site.saves++; return { ts: a.board.ts };
  }
  throw new Error('unknown call ' + action);
}

/* ---- pages -------------------------------------------------------------------------------------------------------------- */
function studentHost(arg) {
  window.DQB_HOST = {
    identity: { sid: arg.sid, name: arg.name }, identityHint: 'This is the name on your TestSite account.', live: async () => [],
    mailbox: {
      list: () => window.siteCall('list'),
      view: (id) => window.siteCall('view', { id, sid: arg.sid }),
      item: (id, itemId) => window.siteCall('item', { id, itemId, sid: arg.sid }),
      send: (id, msg) => window.siteCall('send', { id, msg, sid: arg.sid, name: arg.name })
    }
  };
}
function teacherHost() {
  window.DQB_HOST = {
    ns: 'acct7', openBoard: 'bOpen1',
    storage: {
      label: 'your TestSite account',
      list: () => window.siteCall('boards'), load: (id) => window.siteCall('load', { id }), save: (b) => window.siteCall('save', { board: b }),
      remove: async () => {}, rename: async () => {}
    },
    inbox: { pull: (id) => window.siteCall('pull', { id }), ack: (id, ids) => window.siteCall('ack', { id, ids }), manageUrl: (id) => '/manage?open=' + id }
  };
}
async function page(device, urlPath, init, arg) {
  const c = await env.context(device);
  await c.exposeFunction('siteCall', siteCall);
  if (init) await c.addInitScript(init, arg);
  const p = await c.newPage();
  p.on('pageerror', (e) => env.pageErrors.push(`${urlPath}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) env.pageErrors.push(`${urlPath} console: ${m.text()}`); });
  await p.goto(env.origin + urlPath);
  if (urlPath.startsWith('/Student/')) await p.waitForSelector('body[data-ready="1"]');
  return p;
}
async function student(sid, name, urlPath) {
  const p = await page('phone', urlPath || '/Student/?open=7', studentHost, { sid, name });
  if (await p.isVisible('#v-setup')) await p.click('#btn-setup');                 // the avatar, the first time
  return p;
}
/** Asks the student app to check the site now (as when the page is shown again). */
const refresh = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
async function stageBox(p) {
  const loc = p.locator('#p-media .mv-stage');
  let last = null;
  for (let k = 0; k < 40; k++) {
    const b = await loc.boundingBox();
    if (b && last && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5 && Math.abs(b.width - last.width) < 0.5) return b;
    last = b; await p.waitForTimeout(80);
  }
  return last;
}

before(async () => {
  env = await boot();
  const scratch = await env.open('desktop', '/Student/');
  PNG = await scratch.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const x = c.getContext('2d'); x.fillStyle = '#4d7c0f'; x.fillRect(0, 0, 320, 240); x.fillStyle = '#7dd3fc'; x.fillRect(40, 120, 240, 90); return c.toDataURL('image/png'); });
  await scratch.context().close();
  site.board = {
    id: 'bOpen1', name: 'Pond study', ts: 1, ink: [], view: { x: 0, y: 0, z: 1 },
    items: [
      { id: 'zIdeas', type: 'zone', title: 'Ideas', x: 0, y: 0, w: 420, h: 320, children: [] },
      { id: 'pic1', type: 'media', kind: 'image', title: 'Pond photo', src: PNG, aspect: 4 / 3, x: 600, y: 0, w: 320, h: 240, annos: [] },
      { id: 'tnote', type: 'note', sub: 'wonder', text: 'Why is the water green?', author: 'Ms Rivera', x: 0, y: 420, w: 220, h: 170, votes: 0 }
    ]
  };
  site.settings = { notes: true, zone: '', see: true, names: true, approve: false, shared: ['pic1'] };
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('a student works on a board open without the teacher: a note, a comment on a picture, the board’s notes', async () => {
  const maya = await student(SID_MAYA, 'Maya');
  await maya.waitForSelector('.open-card');
  assert.equal(await maya.textContent('.open-card h2'), 'Pond study');
  assert.match(await maya.textContent('.open-card .open-meta'), /^Ms Rivera · Pond life · Open until /);
  assert.equal(await maya.textContent('#conn-text'), 'Connected');
  assert.equal(await maya.locator('[data-act="open-media"][data-id="pic1"]').count(), 1, 'the shared picture is listed');

  // a note: kept by the site for the teacher
  await maya.click('[data-act="add"][data-type="wonder"]');
  await maya.fill('#w-txt', 'Do frogs live in this pond?');
  await maya.click('#w-send');
  for (let k = 0; k < 50 && !site.inbox.some((r) => r.msg.type === 'NOTE'); k++) await maya.waitForTimeout(100);
  const sent = site.inbox.find((r) => r.msg.type === 'NOTE');
  assert.deepEqual([sent.sid, sent.msg.sub, sent.msg.text], [SID_MAYA, 'wonder', 'Do frogs live in this pond?']);
  await maya.click('#tab-notes');
  await maya.waitForSelector('.note-card .status-sent');
  assert.equal(await maya.textContent('.note-card .status-sent'), 'Sent to your teacher');
  await maya.click('#tab-board');

  // the board's notes, with hers (not on the board yet) among them
  await maya.click('[data-act="open-wall"]');
  await maya.waitForFunction(() => document.querySelectorAll('#p-wall .wall-note').length === 2, null, { timeout: 10000 });   // the page follows the site
  const wall = await maya.$$eval('#p-wall .wall-note', (els) => els.map((e) => e.querySelector('.txt').textContent));
  assert.deepEqual(wall, ['Why is the water green?', 'Do frogs live in this pond?']);
  assert.equal(await maya.textContent('#p-wall .wall-note.mine .wall-new'), 'Sent', 'hers is marked as not on the board yet');
  await maya.click('#p-wall [data-close]');

  // a comment pinned on the shared picture
  await maya.click('[data-act="open-media"][data-id="pic1"]');
  await maya.waitForSelector('#p-media .mv-stage img.mv-img', { timeout: 15000 });
  const st = await stageBox(maya);
  await maya.click('#p-media .mv-tool[data-tool="pin"]');
  await maya.mouse.click(st.x + st.width * 0.3, st.y + st.height * 0.7);
  await maya.fill('#p-media .mv-in', 'Green algae near the edge');
  await maya.click('#p-media [data-mv="post"]');
  for (let k = 0; k < 50 && !site.inbox.some((r) => r.msg.type === 'ANNO_ADD'); k++) await maya.waitForTimeout(100);
  const anno = site.inbox.find((r) => r.msg.type === 'ANNO_ADD');
  assert.equal(anno.msg.item, 'pic1');
  assert.equal(anno.msg.a.k, 'comment');
  assert.equal(anno.msg.a.text, 'Green algae near the edge');
  assert.equal(anno.msg.a.by, undefined, 'the student app never says who it is in the message: the site knows');
  await maya.click('#p-media [data-close]');
  await maya.context().close();
});

test('the console takes the inbox in when it opens the board: notes into a “From students” zone, comments onto the picture', async () => {
  const teacher = await page('desktop', '/Teacher/', teacherHost);
  await teacher.waitForFunction(() => State.id === 'bOpen1' && State.items.some((i) => i.title === 'From students'), null, { timeout: 20000 });
  const r = await teacher.evaluate(() => {
    const z = State.items.find((i) => i.type === 'zone' && i.title === 'From students');
    const note = State.items.find((i) => i.text === 'Do frogs live in this pond?');
    const pic = State.items.find((i) => i.id === 'pic1');
    return { inZone: z.children.includes(note.id), parent: note.parentZone === z.id, author: note.author, sid: note.sid, sub: note.sub, annos: pic.annos.map((a) => [a.k, a.text, a.by.n, a.by.sid, !!a.pend]) };
  });
  assert.deepEqual(r, { inZone: true, parent: true, author: 'Maya', sid: SID_MAYA, sub: 'wonder', annos: [['comment', 'Green algae near the edge', 'Maya', SID_MAYA, false]] });
  // the site is told once the board holding them is saved in the account
  for (let k = 0; k < 80 && site.inbox.some((r) => !r.merged); k++) await teacher.waitForTimeout(100);
  assert.ok(site.inbox.every((r) => r.merged), 'everything was acknowledged');
  assert.ok(site.board.items.some((i) => i.text === 'Do frogs live in this pond?'), 'the saved board has the note');
  assert.ok(site.board.items.find((i) => i.id === 'pic1').annos.some((a) => a.text === 'Green algae near the edge'), 'and the comment');
  // the board is open for students: the top bar says so
  assert.equal(await teacher.isVisible('#open-chip'), true);
  assert.match(await teacher.getAttribute('#open-chip', 'aria-label'), /^Open until .+: students can add to this board without you$/);

  // while the console is open, what students add arrives within seconds; nothing is added twice
  const ben = await student(SID_BEN, 'Ben');
  await ben.waitForSelector('.open-card');
  await ben.click('[data-act="add"][data-type="idea"]');
  await ben.fill('#w-txt', 'Count the tadpoles each week');
  await ben.click('#w-send');
  await teacher.evaluate(() => Inbox.pull());
  await teacher.waitForFunction(() => State.items.some((i) => i.text === 'Count the tadpoles each week'), null, { timeout: 20000 });
  await teacher.evaluate(() => Inbox.pull());
  assert.equal(await teacher.evaluate(() => State.items.filter((i) => i.text === 'Count the tadpoles each week').length), 1);
  assert.equal(await teacher.evaluate(() => State.items.filter((i) => i.type === 'zone' && i.title === 'From students').length), 1, 'one zone for them');

  // once the board holding it is saved, the student sees it on the board
  for (let k = 0; k < 80 && site.inbox.some((r) => !r.merged); k++) await teacher.waitForTimeout(100);
  await refresh(ben);
  await ben.click('#tab-notes');
  await ben.waitForFunction(() => document.querySelector('.note-card .chip.status-approved') && document.querySelector('.note-card .chip.status-approved').textContent === 'On the board', null, { timeout: 15000 });
  await ben.context().close();
  await teacher.context().close();
});

test('with approval first, a note waits in the console’s queue and stays in the inbox until the teacher decides', async () => {
  site.settings = { ...site.settings, approve: true };
  const ana = await student('tt-anaAccount0000001', 'Ana');
  await ana.waitForSelector('.open-card');
  await ana.click('[data-act="add"][data-type="notice"]');
  await ana.fill('#w-txt', 'The water is cloudy after rain');
  await ana.click('#w-send');
  await ana.click('#tab-notes');
  await ana.waitForFunction(() => { const c = document.querySelector('.note-card .chip.status-pending'); return c && c.textContent === 'Waiting for your teacher'; });
  await ana.click('#tab-board');

  const teacher = await page('desktop', '/Teacher/', teacherHost);
  await teacher.waitForFunction(() => State.id === 'bOpen1' && State.pending.some((p) => p.text === 'The water is cloudy after rain'), null, { timeout: 20000 });
  const row = site.inbox.find((r) => r.msg.text === 'The water is cloudy after rain');
  await teacher.waitForTimeout(3500);                       // a save and an acknowledgement could have happened by now
  assert.equal(row.merged, false, 'a note waiting for approval stays in the inbox');
  assert.equal(await teacher.evaluate(() => State.items.some((i) => i.text === 'The water is cloudy after rain')), false);
  await teacher.evaluate(() => Inbox.pull());
  assert.equal(await teacher.evaluate(() => State.pending.filter((p) => p.text === 'The water is cloudy after rain').length), 1, 'not queued twice');

  await teacher.evaluate(() => Network.approve(State.pending.find((p) => p.text === 'The water is cloudy after rain').id, true));
  await teacher.waitForFunction(() => State.items.some((i) => i.text === 'The water is cloudy after rain' && i.parentZone), null, { timeout: 10000 });
  for (let k = 0; k < 80 && !row.merged; k++) await teacher.waitForTimeout(100);
  assert.equal(row.merged, true, 'acknowledged once it is on the saved board');

  // a declined note: the student is told it was not kept
  await ana.click('[data-act="add"][data-type="notice"]');
  await ana.fill('#w-txt', 'lol');
  await ana.click('#w-send');
  for (let k = 0; k < 50 && !site.inbox.some((r) => r.msg.text === 'lol'); k++) await ana.waitForTimeout(100);
  await teacher.evaluate(() => Inbox.pull());
  await teacher.waitForFunction(() => State.pending.some((p) => p.text === 'lol'));
  await teacher.evaluate(() => Network.approve(State.pending.find((p) => p.text === 'lol').id, false));
  const lol = site.inbox.find((r) => r.msg.text === 'lol');
  for (let k = 0; k < 80 && !lol.merged; k++) await teacher.waitForTimeout(100);
  assert.equal(lol.merged, true);
  await refresh(ana);
  await ana.click('#tab-notes');
  await ana.waitForFunction(() => [...document.querySelectorAll('.note-card')].some((c) => c.querySelector('.txt').textContent === 'lol' && c.querySelector('.status-rejected')), null, { timeout: 15000 });
  site.settings = { ...site.settings, approve: false };
  await ana.context().close();
  await teacher.context().close();
});

test('offline, notes wait on the device and go when the site answers again; a closed board says so', async () => {
  const leo = await student('tt-leoAccount00000001', 'Leo');
  await leo.waitForSelector('.open-card');
  site.failSends = 1;
  await leo.click('[data-act="add"][data-type="idea"]');
  await leo.fill('#w-txt', 'Test the pH');
  await leo.click('#w-send');
  await leo.click('#tab-notes');
  await leo.waitForSelector('.note-card .status-sending');
  await refresh(leo);                                            // back: the outbox is sent
  await leo.waitForSelector('.note-card .status-sent', { timeout: 15000 });
  assert.equal(site.inbox.filter((r) => r.msg.text === 'Test the pH').length, 1, 'sent once');

  // the teacher closes the board: the student is told, and their notes stay on the device
  site.closed = true;
  await refresh(leo);
  await leo.waitForSelector('#v-ended:not([hidden])', { timeout: 15000 });
  assert.equal(await leo.textContent('#ended-title'), 'This board is closed now');
  site.closed = false;
  await leo.context().close();
});

test('the join screen lists boards open for the student; picking one opens it', async () => {
  const kim = await student('tt-kimAccount00000001', 'Kim', '/Student/');
  await kim.waitForSelector('#live-list .open-item');
  assert.match(await kim.textContent('#live-list'), /Open for you/);
  assert.match(await kim.textContent('#live-list .open-item'), /Pond study.*Ms Rivera · Pond life · until /);
  await kim.click('#live-list .open-item');
  await kim.waitForSelector('.open-card');
  assert.equal(await kim.textContent('.open-card h2'), 'Pond study');
  // reloading comes back to the same board
  await kim.reload();
  await kim.waitForSelector('body[data-ready="1"]');
  await kim.waitForSelector('.open-card', { timeout: 15000 });
  await kim.context().close();
});

test('a teacher who keeps notes private: students see only what they add, and no wall', async () => {
  site.settings = { ...site.settings, see: false };
  const zoe = await student('tt-zoeAccount00000001', 'Zoe');
  await zoe.waitForSelector('.open-card');
  assert.equal(await zoe.locator('[data-act="open-wall"]').count(), 0);
  assert.match(await zoe.textContent('#board-content'), /Only your teacher sees what you add/);
  site.settings = { ...site.settings, see: true };
  await zoe.context().close();
});
