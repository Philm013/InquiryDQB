'use strict';
/**
 * Ink tools on every canvas (board, consensus model, breakout room): pick strokes one at a time or as a group,
 * move, recolour, delete and duplicate them, and turn several strokes into ONE sketch note. Real pointer input.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env;
before(async () => { env = await boot(); });
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

const STROKES = [
  { id: 's1', points: [{ x: 100, y: 100 }, { x: 200, y: 110 }, { x: 300, y: 100 }], color: '#ef4444', width: 4 },
  { id: 's2', points: [{ x: 110, y: 160 }, { x: 310, y: 170 }], color: '#3b82f6', width: 4 },
  { id: 's3', points: [{ x: 700, y: 420 }, { x: 800, y: 470 }], color: '#111827', width: 6 }
];
/** Board world point → page coordinates. */
const screen = (p, x, y) => p.evaluate(([wx, wy]) => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.left + (wx + State.view.x) * State.view.z, y: r.top + (wy + State.view.y) * State.view.z }; }, [x, y]);
async function boardWithInk(device) {
  const p = await env.teacher(device);
  await p.evaluate((ink) => { StateManager.setInk(JSON.parse(JSON.stringify(ink))); StateManager.updateView({ x: 40, y: 60, z: 1 }); ActionHistory.reset(); }, STROKES);
  if (device !== 'phone') await p.keyboard.press('v');
  return p;
}
const sel = (p) => p.evaluate(() => InkSel.board.ids().sort());
async function drag(p, a, b, steps = 10) { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(b.x, b.y, { steps }); await p.mouse.up(); }

test('board: click picks one stroke, Shift-click adds another, and dragging moves them together', async () => {
  const p = await boardWithInk('desktop');
  const a = await screen(p, 200, 110), b = await screen(p, 210, 165);
  await p.mouse.click(a.x, a.y);
  assert.deepEqual(await sel(p), ['s1']);
  assert.match(await p.textContent('#selbar'), /1 stroke/);
  await p.keyboard.down('Shift'); await p.mouse.click(b.x, b.y); await p.keyboard.up('Shift');
  assert.deepEqual(await sel(p), ['s1', 's2']);
  assert.match(await p.textContent('#selbar'), /2 strokes/);
  assert.equal(await p.locator('#ink-layer .ink-halo').count(), 2, 'each selected stroke has a halo');
  assert.equal(await p.locator('#ink-layer .ink-selbox').count(), 1, 'a group of strokes shows one box');

  await drag(p, a, { x: a.x + 80, y: a.y + 50 });
  const firsts = await p.evaluate(() => State.ink.map((s) => [s.id, Math.round(s.points[0].x), Math.round(s.points[0].y)]));
  assert.deepEqual(firsts, [['s1', 180, 150], ['s2', 190, 210], ['s3', 700, 420]], 'both selected strokes moved by the drag; the other did not');
  await p.keyboard.press('Control+z');
  assert.equal(await p.evaluate(() => State.ink.find((s) => s.id === 's1').points[0].x), 100, 'one undo puts the group back');

  await p.keyboard.press('Escape');
  assert.deepEqual(await sel(p), []);
  assert.equal(await p.isVisible('#selbar'), false);
});

test('board: several strokes become ONE sketch note where the drawing was, in one undo step', async () => {
  const p = await boardWithInk('desktop');
  await drag(p, await screen(p, 60, 60), await screen(p, 360, 220));            // box around s1 and s2 only
  assert.deepEqual(await sel(p), ['s1', 's2']);
  await p.click('[data-sb="ink-note"]');
  const r = await p.evaluate(() => ({ ink: State.ink.map((s) => s.id), notes: State.items.map((i) => ({ sub: i.sub, src: /^data:image\/png/.test(i.src || ''), x: i.x, y: i.y, w: i.w, h: i.h })), sel: State.selection.length }));
  assert.deepEqual(r.ink, ['s3'], 'the combined strokes leave the ink layer');
  assert.equal(r.notes.length, 1, 'exactly one note');
  const n = r.notes[0];
  assert.equal(n.sub, 'sketch'); assert.ok(n.src, 'the note carries the drawing as a picture');
  assert.ok(n.x <= 100 && n.x + n.w >= 310 && n.y <= 100 && n.y + n.h >= 170, `the note covers where the strokes were (${JSON.stringify(n)})`);
  assert.equal(r.sel, 1, 'the new note is selected, ready to move to a zone');

  await p.keyboard.press('Control+z');
  assert.deepEqual(await p.evaluate(() => [State.ink.length, State.items.length]), [3, 0], 'a single undo brings back the strokes and removes the note');

  // keyboard: J joins the selected strokes into one note
  await p.evaluate(() => InkSel.board.set(['s1', 's2', 's3']));
  await p.keyboard.press('j');
  assert.deepEqual(await p.evaluate(() => [State.ink.length, State.items.length]), [0, 1]);
});

test('board: a box picks up notes and ink together; delete and duplicate treat them as one selection', async () => {
  const p = await boardWithInk('desktop');
  await p.evaluate(() => { StateManager.addItem({ id: 'n1', type: 'note', sub: 'idea', text: 'beside the ink', x: 400, y: 80, w: 200, h: 150, groupId: null }); StateManager.setSelection([]); ActionHistory.reset(); });
  await drag(p, await screen(p, 60, 60), await screen(p, 650, 260));
  assert.deepEqual(await p.evaluate(() => [State.selection, InkSel.board.ids().sort()]), [['n1'], ['s1', 's2']]);
  assert.match(await p.textContent('#selbar'), /1 item · 2 strokes/);

  await p.keyboard.press('Control+d');
  assert.deepEqual(await p.evaluate(() => [State.items.length, State.ink.length, State.selection.length, InkSel.board.count()]), [2, 5, 1, 2], 'the copy is selected: one note and two strokes');
  await p.keyboard.press('Control+z');

  await p.evaluate(() => { InkSel.board.sel = new Set(['s1', 's2']); StateManager.setSelection(['n1'], { keepInk: true }); });
  await p.keyboard.press('Delete');
  assert.deepEqual(await p.evaluate(() => [State.items.length, State.ink.map((s) => s.id)]), [0, ['s3']]);
  await p.waitForSelector('.toast .toast-action');
  await p.keyboard.press('Control+z');
  assert.deepEqual(await p.evaluate(() => [State.items.length, State.ink.length]), [1, 3], 'one undo restores the note and both strokes');

  await p.keyboard.press('Control+a');
  assert.deepEqual(await p.evaluate(() => [State.selection.length, InkSel.board.count()]), [1, 3], 'select all includes ink');
  await p.keyboard.press('ArrowRight');
  assert.deepEqual(await p.evaluate(() => [State.items[0].x, State.ink[0].points[0].x]), [410, 110], 'arrow keys nudge notes and ink alike');
});

test('board: recolour and thickness from the toolbar, and “Pin ink as notes” makes one note per drawing', async () => {
  const p = await boardWithInk('desktop');
  await p.evaluate(() => InkSel.board.set(['s1', 's2']));
  await p.click('[data-sb="ink-#10b981"]');
  assert.deepEqual(await p.evaluate(() => State.ink.map((s) => s.color)), ['#10b981', '#10b981', '#111827']);
  await p.click('[data-sb="ink-more"]');
  await p.click('.menu .menu-item:has-text("Thick")');
  assert.deepEqual(await p.evaluate(() => State.ink.map((s) => s.width)), [8, 8, 6]);

  await p.evaluate(() => { InkSel.board.clear(); InkManager.pinToItems(); });
  assert.deepEqual(await p.evaluate(() => [State.ink.length, State.items.length, State.items.every((i) => i.sub === 'sketch')]), [0, 2, true], 'the two touching strokes make one note, the stroke far away another');
});

test('board on a phone: a finger tap picks a stroke, dragging an unselected stroke pans, dragging a selected one moves it', async () => {
  const p = await boardWithInk('phone');
  const cdp = await p.context().newCDPSession(p);
  const touch = async (pts) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
    for (let i = 1; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i].x, y: pts[i].y, id: 1 }] }); await new Promise((r) => setTimeout(r, 8)); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await p.evaluate(() => StateManager.updateView({ x: 0, y: 200, z: 1 }));
  const on = await screen(p, 200, 106);
  const line = (a, dx, dy) => Array.from({ length: 11 }, (_, i) => ({ x: a.x + (dx * i) / 10, y: a.y + (dy * i) / 10 }));

  const v0 = await p.evaluate(() => State.view.x);
  await touch(line(on, 60, 40));
  assert.notEqual(await p.evaluate(() => State.view.x), v0, 'the board panned');
  assert.equal(await p.evaluate(() => State.ink[0].points[0].x), 100, 'an unselected stroke is not dragged by accident');

  const tap = await screen(p, 200, 106);
  await touch([tap]);
  assert.deepEqual(await sel(p), ['s1'], 'a tap selects the stroke');
  assert.equal(await p.isVisible('#selbar'), true);
  await touch(line(await screen(p, 200, 106), 50, 30));
  assert.equal(Math.round(await p.evaluate(() => State.ink[0].points[0].x)), 150, 'a selected stroke follows the finger');
});

test('consensus model: box-select ink, recolour it for everyone, and turn it into a note on the model', async () => {
  const t = await env.teacher('desktop');
  const code = await t.evaluate(() => Network.getCode());
  const maya = await env.student(code, 'Maya', 'phone', 3);
  await t.evaluate(() => {
    StateManager.addItem({ id: 'cz', type: 'zone', zoneType: 'consensus', title: 'Model', x: 100, y: 100, w: 600, h: 520, children: [], groupId: null, ink: [
      { id: 'k1', points: [{ x: 50, y: 50 }, { x: 150, y: 60 }, { x: 200, y: 90 }], color: '#ef4444', width: 4 },
      { id: 'k2', points: [{ x: 60, y: 120 }, { x: 180, y: 140 }], color: '#3b82f6', width: 4 },
      { id: 'k3', points: [{ x: 400, y: 400 }, { x: 450, y: 450 }], color: '#111827', width: 4, arrow: true }] });
    Consensus.start('cz'); Consensus.setTool('select');
  });
  await maya.waitForSelector('#p-consensus:not([hidden])');
  assert.equal(await t.locator('#consensus-ink-layer g[data-ink="k3"] path').count(), 2, 'an arrow stroke is drawn with its head');
  const at = (x, y) => t.evaluate(([wx, wy]) => { const cm = State.consensusMode, r = document.getElementById('consensus-main').getBoundingClientRect(); return { x: r.left + (wx + cm.view.x) * cm.view.z, y: r.top + (wy + cm.view.y) * cm.view.z }; }, [x, y]);
  await drag(t, await at(30, 30), await at(230, 170), 8);
  assert.deepEqual(await t.evaluate(() => InkSel.consensus.ids().sort()), ['k1', 'k2']);
  assert.match(await t.textContent('#selbar'), /2 strokes/);

  await t.click('[data-sb="ink-#10b981"]');
  await maya.waitForFunction(() => [...document.querySelectorAll('#cm-ink path')].filter((x) => x.getAttribute('stroke') === '#10b981').length === 2);

  await t.click('[data-sb="ink-note"]');
  assert.deepEqual(await t.evaluate(() => [State.consensusMode.ink.map((s) => s.id), State.consensusMode.items.length]), [['k3'], 1]);
  await maya.waitForFunction(() => document.querySelectorAll('#cm-items .c-item img').length === 1, null, { timeout: 8000 });
  await t.keyboard.press('Control+z');
  await maya.waitForFunction(() => document.querySelectorAll('#cm-items .c-item').length === 0 && document.querySelectorAll('#cm-ink path').length >= 3);
  await t.keyboard.press('Control+y');
  await t.evaluate(() => Consensus.stop());
  await maya.waitForSelector('#p-consensus', { state: 'hidden' });
  const kids = await t.evaluate(() => State.items.filter((i) => i.parentZone === 'cz').map((i) => i.sub));
  assert.deepEqual(kids, ['sketch'], 'the note made on the model stays in the model zone');
  assert.equal(await t.evaluate(() => State.items.find((i) => i.id === 'cz').children.length), 1);
});

test('breakout room: select room notes and ink together, make one note from the ink, and undo', async () => {
  const t = await env.teacher('desktop');
  await t.evaluate(() => {
    StateManager.addItem({ id: 'bz', type: 'zone', zoneType: 'breakout', title: 'Room', x: 0, y: 0, w: 320, h: 240, roomColor: '#8b5cf6', participants: [], groupId: null,
      subItems: [{ id: 'bn', type: 'note', sub: 'idea', text: 'room note', x: 300, y: 0, w: 200, h: 150 }, { id: 'bm', type: 'note', sub: 'notice', text: 'far note', x: 900, y: 600, w: 200, h: 150 }],
      subInk: [{ id: 'b1', points: [{ x: 0, y: 0 }, { x: 100, y: 20 }], color: '#ef4444', width: 4 }, { id: 'b2', points: [{ x: 10, y: 40 }, { x: 120, y: 60 }], color: '#ef4444', width: 4 }] });
    Breakout.open('bz'); Breakout.setTool('select');
  });
  const at = (x, y) => t.evaluate(([wx, wy]) => { const v = Breakout._state.view, r = document.getElementById('breakout-main').getBoundingClientRect(); return { x: r.left + (wx + v.x) * v.z, y: r.top + (wy + v.y) * v.z }; }, [x, y]);
  await drag(t, await at(-30, -30), await at(520, 170), 8);
  assert.deepEqual(await t.evaluate(() => [[...Breakout._state.sel], InkSel.breakout.ids().sort()]), [['bn'], ['b1', 'b2']]);
  assert.match(await t.textContent('#selbar'), /1 item · 2 strokes/);

  // Shift-click adds the far note; dragging one of them moves the whole selection
  const far = await at(1000, 680);
  await t.keyboard.down('Shift'); await t.mouse.click(far.x, far.y); await t.keyboard.up('Shift');
  assert.deepEqual(await t.evaluate(() => [...Breakout._state.sel].sort()), ['bm', 'bn']);
  const grab = await at(400, 75);
  await drag(t, grab, { x: grab.x + 50, y: grab.y + 25 }, 6);
  const moved = await t.evaluate(() => { const z = Breakout._getZone(); return [z.subItems.map((i) => Math.round(i.x)), Math.round(z.subInk[0].points[0].x)]; });
  const dx = moved[0][0] - 300;
  assert.ok(dx > 20, `the selection moved (${dx})`);
  assert.deepEqual(moved, [[300 + dx, 900 + dx], dx], 'notes and ink moved by the same amount');

  await t.click('[data-sb="ink-note"]');
  assert.deepEqual(await t.evaluate(() => { const z = Breakout._getZone(); return [z.subInk.length, z.subItems.map((i) => i.sub)]; }), [0, ['idea', 'notice', 'sketch']]);
  await t.keyboard.press('Control+z');
  assert.deepEqual(await t.evaluate(() => { const z = Breakout._getZone(); return [z.subInk.length, z.subItems.length]; }), [2, 2]);
  await t.evaluate(() => Breakout.close());
});
