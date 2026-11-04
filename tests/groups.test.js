'use strict';
/**
 * Group work: several colour zones open at the same time, each student writing into the zone meant for them,
 * students without a group handled gracefully, and live updates as the teacher changes groups and zones.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env, teacher, maya, leo, ana, code;
const T = (fn, arg) => teacher.evaluate(fn, arg);
const pid = (name) => T((n) => Object.entries(State.students).find(([, s]) => s.name === n)[0], name);
const board = (p) => p.evaluate(() => document.getElementById('board-content').textContent.replace(/\s+/g, ' '));
const parentOf = (text) => T((t) => { const n = State.items.find((i) => i.text === t); return n ? n.parentZone || null : undefined; }, text);
async function write(p, type, text) {
  await p.click('#tab-board');
  await p.click(`.type-tile.t-${type}`);
  await p.waitForSelector('#p-write:not([hidden])');
  await p.fill('#w-txt', text);
  await p.click('#w-send');
  await teacher.waitForFunction((t) => State.items.some((i) => i.text === t), text);
}

before(async () => {
  env = await boot();
  teacher = await env.teacher();
  code = await T(() => Network.getCode());
  maya = await env.student(code, 'Maya', 'phone', 3);
  leo = await env.student(code, 'Leo', 'phone', 7);
  ana = await env.student(code, 'Ana', 'phone', 5);
  await T(() => {
    StateManager.addItem({ id: 'zr', type: 'zone', title: 'Red team', color: '#ef4444', x: 0, y: 0, w: 320, h: 320, children: [], groupId: null });
    StateManager.addItem({ id: 'zb', type: 'zone', title: 'Blue team', color: '#3b82f6', x: 400, y: 0, w: 320, h: 320, children: [], groupId: null });
    StateManager.addItem({ id: 'zq', type: 'zone', title: 'Questions', x: 800, y: 0, w: 320, h: 320, children: [], groupId: null });
  });
  const [m, l] = [await pid('Maya'), await pid('Leo')];
  await T(([a, b]) => { Network.setStudentColor(a, '#ef4444'); Network.setStudentColor(b, '#3b82f6'); }, [m, l]);
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('two colour zones open together from the selection toolbar, and each group writes into its own', async () => {
  await T(() => StateManager.setSelection(['zr', 'zb']));
  await teacher.click('[data-sb="ozs"]');
  await teacher.waitForFunction(() => Network.openZoneIds().join() === 'zr,zb');
  assert.deepEqual(await T(() => State.items.filter((i) => i.isOpen).map((i) => i.id).sort()), ['zb', 'zr'], 'both zones show as live');

  await maya.waitForSelector('.type-tile');
  await leo.waitForSelector('.type-tile');
  const mb = await board(maya), lb = await board(leo);
  assert.match(mb, /Red team/); assert.doesNotMatch(mb, /Blue team/, 'Maya only sees her group’s zone');
  assert.match(lb, /Blue team/); assert.doesNotMatch(lb, /Red team/, 'Leo only sees his group’s zone');

  await write(maya, 'wonder', 'Maya wonders in red');
  await write(leo, 'notice', 'Leo notices in blue');
  assert.equal(await parentOf('Maya wonders in red'), 'zr');
  assert.equal(await parentOf('Leo notices in blue'), 'zb');
});

test('a student without a group picks any open zone, and the teacher is told who still needs one', async () => {
  await ana.waitForSelector('.zone-choice');
  assert.equal(await ana.locator('.zone-choice').count(), 2, 'Ana can choose between the two open zones');
  assert.match(await board(ana), /not in a group yet/);
  await ana.click('.zone-choice[data-id="zb"]');
  assert.equal(await ana.getAttribute('.zone-choice[data-id="zb"]', 'aria-checked'), 'true');
  await ana.click('.type-tile.t-idea');
  await ana.waitForSelector('#w-zone:not([hidden])');
  assert.equal(await ana.getAttribute('#w-zone [data-zone="zb"]', 'aria-checked'), 'true', 'the write page shows where the note goes');
  await ana.fill('#w-txt', 'Ana chose blue');
  await ana.click('#w-send');
  await teacher.waitForFunction(() => State.items.some((i) => i.text === 'Ana chose blue'));
  assert.equal(await parentOf('Ana chose blue'), 'zb');

  await T(() => Shell.Panel.open('activity'));
  await teacher.waitForSelector('#act-results .oz-row');
  assert.equal(await teacher.textContent('#act-name'), '2 zones open');
  assert.equal(await teacher.locator('#act-results .oz-row').count(), 2);
  assert.match(await teacher.textContent('#act-results .oz-alert'), /1 student has no zone of their own \(Ana\)/);
});

test('the host only accepts zones that are open to the student who sent the note', async () => {
  const [l, a] = [await pid('Leo'), await pid('Ana')];
  // Leo (blue) asks for the red zone: the note still lands in his own zone
  await T((p) => Network.handle(p, { type: 'NOTE', id: 'leo_x', sub: 'idea', text: 'Leo tries red', zoneId: 'zr' }, State.students[p].conn), l);
  await teacher.waitForFunction(() => State.items.some((i) => i.id === 'leo_x'));
  assert.equal(await parentOf('Leo tries red'), 'zb');
  // a zone that isn't open (or doesn't exist) falls back to one that is
  await T((p) => Network.handle(p, { type: 'NOTE', id: 'ana_x', sub: 'idea', text: 'Ana asks for questions', zoneId: 'zq' }, State.students[p].conn), a);
  await teacher.waitForFunction(() => State.items.some((i) => i.id === 'ana_x'));
  assert.ok(['zr', 'zb'].includes(await parentOf('Ana asks for questions')), 'never into a closed zone');
});

test('with the “wait” rule a student without a group waits, and “Put them in groups” lets them write', async () => {
  await teacher.click('#ptab-students');
  await teacher.click('#rule-anyzone');
  assert.equal(await T(() => State.settings.anyZone), false);
  await ana.waitForFunction(() => /Waiting for a group/.test(document.getElementById('board-content').textContent));
  assert.equal(await ana.getAttribute('#tab-add', 'aria-disabled'), 'true', 'Ana cannot add notes yet');
  const a = await pid('Ana');
  const n0 = await T(() => State.items.length);
  await T((p) => Network.handle(p, { type: 'NOTE', id: 'ana_wait', sub: 'idea', text: 'too early', zoneId: 'zb' }, State.students[p].conn), a);
  await teacher.waitForTimeout(300);
  assert.equal(await T(() => State.items.length), n0, 'a note from a student who is waiting is refused');

  await T(() => Shell.Panel.showTab('activity'));
  await teacher.click('[data-oz="assign"]');
  const color = await T((p) => State.students[p].color, a);
  assert.ok(['#ef4444', '#3b82f6'].includes(color), `Ana joined one of the open groups (${color})`);
  await ana.waitForSelector('.type-tile');
  assert.match(await board(ana), color === '#ef4444' ? /Red team/ : /Blue team/);
  await write(ana, 'test', 'Ana in her group');
  assert.equal(await parentOf('Ana in her group'), color === '#ef4444' ? 'zr' : 'zb');
  assert.equal(await teacher.locator('#act-results .oz-alert').count(), 0, 'nobody is left without a zone');
});

test('renaming, recolouring and adding zones while they are open updates every student at once', async () => {
  await T(() => StateManager.updateItem('zr', { title: 'Red scientists' }));
  await maya.waitForFunction(() => /Red scientists/.test(document.getElementById('board-content').textContent));
  // an uncoloured zone is open to everyone, so students now have two places to write
  await T(() => Network.toggleZone('zq'));
  await maya.waitForSelector('.zone-choice[data-id="zq"]');
  assert.equal(await maya.locator('.zone-choice').count(), 2);
  await maya.click('.zone-choice[data-id="zq"]');
  await write(maya, 'wonder', 'Maya asks the class');
  assert.equal(await parentOf('Maya asks the class'), 'zq');
  // the blue zone becomes red: Leo (blue) loses it, Maya gains it
  await T(() => StateManager.updateItem('zb', { color: '#ef4444' }));
  await leo.waitForFunction(() => !/Blue team/.test(document.getElementById('board-content').textContent));
  await maya.waitForSelector('.zone-choice[data-id="zb"]');
  await T(() => StateManager.updateItem('zb', { color: '#3b82f6' }));
  await leo.waitForFunction(() => /Blue team/.test(document.getElementById('board-content').textContent));
});

test('closing one zone leaves the others open; closing the last one locks the board', async () => {
  assert.equal(await T(() => document.querySelector('[id="zr"] [data-act="zone-toggle"]').textContent), 'Close');
  await T(() => Network.toggleZone('zq'));
  await T(() => Network.toggleZone('zr'));
  assert.deepEqual(await T(() => Network.openZoneIds()), ['zb']);
  assert.equal(await T(() => State.items.find((i) => i.id === 'zr').isOpen), undefined, 'the closed zone is no longer live');
  await maya.waitForFunction(() => /zone isn’t open/.test(document.getElementById('board-content').textContent), null, { timeout: 8000 });
  assert.match(await board(leo), /Blue team/, 'the blue group carries on');

  // undo never reopens or closes zones: that belongs to the activity, not the board
  await T(() => { StateManager.addItem({ id: 'tmp1', type: 'note', sub: 'idea', text: 'temp', x: 2000, y: 0, w: 200, h: 150, groupId: null }); ActionHistory.undo(); });
  assert.deepEqual(await T(() => Network.openZoneIds()), ['zb']);
  assert.equal(await T(() => !!State.items.find((i) => i.id === 'zb').isOpen), true);

  await T(() => Network.toggleZone('zb'));
  assert.equal(await T(() => State.activity.type), 'LOCKED');
  for (const p of [maya, leo, ana]) await p.waitForFunction(() => /Eyes on the board/.test(document.getElementById('board-content').textContent));
});

test('a student keeps their group when their connection drops and comes back', async () => {
  const m = await pid('Maya');
  await T((p) => State.students[p].conn.close(), m);
  await maya.waitForFunction(() => /Reconnecting|Connecting/.test(document.getElementById('conn-text').textContent), null, { timeout: 15000 });
  await maya.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 30000 });
  await teacher.waitForFunction(() => Object.values(State.students).some((s) => s.name === 'Maya'));
  assert.equal(await T(() => Object.values(State.students).find((s) => s.name === 'Maya').color), '#ef4444');
  await T(() => Network.openZones(['zr', 'zb']));
  await maya.waitForFunction(() => /Red scientists/.test(document.getElementById('board-content').textContent));
  await T(() => Network.transitionTo('LOCKED'));
});

test('the Groups sheet splits the class evenly and adds a zone per group, ready to open together', async () => {
  const t2 = await env.teacher('desktop');
  const c2 = await t2.evaluate(() => Network.getCode());
  // six students on the real protocol from one page (cheaper than six browser windows)
  const hub = await env.open('desktop', '/Student/');
  await hub.waitForSelector('body[data-ready="1"]');
  await hub.evaluate((c) => Promise.all(Array.from({ length: 6 }, (_, i) => new Promise((resolve) => {
    const peer = Net.newPeer();
    peer.on('open', () => { const conn = peer.connect(Net.codeToPeerId(c), { reliable: true }); conn.on('open', () => { conn.send(JSON.stringify({ type: 'JOIN', name: 'Kid ' + (i + 1), avatar: Net.AVATARS[i], sid: 'GRP' + i, v: 2 })); resolve(); }); });
  }))), c2);
  await t2.waitForFunction(() => Network.studentCount() === 6, null, { timeout: 20000 });

  await t2.evaluate(() => Shell.Groups.open());
  await t2.waitForSelector('.groups-sheet');
  await t2.click('[data-gn="3"]');
  await t2.click('.sheet-f .btn-primary');
  const sizes = await t2.evaluate(() => { const c = {}; Object.values(State.students).forEach((s) => { c[s.color] = (c[s.color] || 0) + 1; }); return c; });
  assert.deepEqual(Object.values(sizes).sort(), [2, 2, 2], `three groups of two (${JSON.stringify(sizes)})`);
  assert.equal(await t2.locator('.groups-sheet .gr-card').count(), 3, 'the sheet shows the new groups');
  const zones = await t2.evaluate(() => State.items.filter((i) => i.type === 'zone').map((i) => ({ title: i.title, color: i.color })));
  assert.deepEqual(zones.map((z) => z.title), ['Red group', 'Orange group', 'Green group']);
  assert.equal(await t2.evaluate(() => State.selection.length), 3, 'the group zones are selected');

  await t2.keyboard.press('Escape');
  await t2.waitForSelector('[data-sb="ozs"]');
  assert.match(await t2.textContent('[data-sb="ozs"]'), /Open 3 zones/);
  await t2.click('[data-sb="ozs"]');
  assert.equal(await t2.evaluate(() => Network.openZoneIds().length), 3);
  assert.equal(await t2.evaluate(() => Network.unplaced().length), 0, 'every student has a zone');

  await t2.evaluate(() => Network.clearGroups());
  assert.equal(await t2.evaluate(() => Object.values(State.students).filter((s) => s.color).length), 0);
  assert.equal(await t2.evaluate(() => Network.unplaced().length), 6, 'clearing groups leaves everyone without a zone');
});

test('a board saved while zones were open reopens with nothing live', async () => {
  await T(() => Network.openZones(['zr', 'zb']));
  await T(() => Board.flush());
  const id = await T(() => State.id);
  await teacher.reload();
  await teacher.waitForSelector('#saved-list .board-card [data-open]');
  await teacher.evaluate((bid) => Board.load(bid), id);
  await teacher.waitForFunction(() => State.items.some((i) => i.id === 'zr'));
  assert.equal(await T(() => State.items.filter((i) => i.isOpen).length), 0);
  assert.equal(await T(() => document.querySelectorAll('.live-badge').length), 0);
});
