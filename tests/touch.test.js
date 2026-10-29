'use strict';
/** Real touch input (Chrome DevTools touch events → pointer events) on a phone-sized screen. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env;
before(async () => { env = await boot(); });
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

/** A tiny finger simulator: touch(page).drag([x,y] → [x,y]) or .pinch(center, from, to). */
async function fingers(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async drag([x0, y0], [x1, y1], steps = 12) {
      await send('touchStart', [[x0, y0]]);
      for (let i = 1; i <= steps; i++) { await send('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]); await sleep(8); }
      await send('touchEnd', []);
    },
    async pinch([cx, cy], from, to, steps = 12) {
      const pts = (d) => [[cx - d / 2, cy], [cx + d / 2, cy]];
      await send('touchStart', pts(from));
      for (let i = 1; i <= steps; i++) { await send('touchMove', pts(from + ((to - from) * i) / steps)); await sleep(8); }
      await send('touchEnd', []);
    }
  };
}

test('student can draw a sketch with a finger and send it', async () => {
  const teacher = await env.teacher('desktop');
  const code = await teacher.evaluate(() => Network.getCode());
  await teacher.evaluate(() => Network.transitionTo('OPEN'));
  const s = await env.student(code, 'Maya', 'phone', 3);
  await s.waitForSelector('.type-tile.t-sketch');
  await s.click('.type-tile.t-sketch');
  await s.waitForSelector('#p-sketch:not([hidden])');
  await s.waitForTimeout(500);
  const box = await s.locator('#s-canvas').boundingBox();
  const f = await fingers(s);
  const scrollBefore = await s.evaluate(() => document.querySelector('#p-sketch .page-body').scrollTop);
  await f.drag([box.x + 40, box.y + 60], [box.x + box.width - 40, box.y + box.height - 60]);   // diagonal stroke across the canvas
  assert.equal(await s.isEnabled('#s-send'), true, 'the stroke registered');
  assert.equal(await s.evaluate(() => document.querySelector('#p-sketch .page-body').scrollTop), scrollBefore, 'drawing does not scroll the page');
  const ink = await s.evaluate(() => { const c = document.getElementById('s-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  assert.ok(ink > 500, `pixels were drawn (${ink})`);
  await s.click('#s-send');
  await teacher.waitForFunction(() => State.items.some((i) => i.sub === 'sketch' && i.src));
});

test('teacher on a phone: one finger pans, drags notes, and two fingers pinch-zoom', async () => {
  const p = await env.teacher('phone');
  await p.evaluate(() => {
    StateManager.addItem({ id: 'tn', type: 'note', sub: 'idea', text: 'Drag me', x: 60, y: 200, w: 220, h: 170, author: 'T', votes: 0, groupId: null });
    StateManager.setSelection([]); Viewport.fit(false);
  });
  await p.waitForTimeout(500);
  const f = await fingers(p);
  const view = () => p.evaluate(() => ({ x: State.view.x, y: State.view.y, z: State.view.z }));

  const v0 = await view();
  await f.drag([200, 120], [120, 220]);                                           // empty canvas near the top: pan
  const v1 = await view();
  assert.ok(Math.abs(v1.x - v0.x) > 20 || Math.abs(v1.y - v0.y) > 20, `one-finger drag pans the board (${JSON.stringify(v0)} → ${JSON.stringify(v1)})`);

  const n0 = await p.evaluate(() => { const n = State.items[0]; return { x: n.x, y: n.y }; });
  const box = await p.locator('[id="tn"]').boundingBox();
  await f.drag([box.x + box.width / 2, box.y + box.height - 20], [box.x + box.width / 2 + 60, box.y + box.height - 20 + 80]);
  const n1 = await p.evaluate(() => { const n = State.items[0]; return { x: n.x, y: n.y }; });
  assert.ok(Math.hypot(n1.x - n0.x, n1.y - n0.y) > 30, `dragging a note by its body moves it (${n0.x},${n0.y} → ${n1.x},${n1.y})`);
  assert.deepEqual(await view().then((v) => [v.x, v.y]), [v1.x, v1.y], 'the board itself did not pan while the note moved');

  const z0 = (await view()).z;
  await f.pinch([195, 420], 80, 220);
  const z1 = (await view()).z;
  assert.ok(z1 > z0 * 1.5, `pinching out zooms in (${z0.toFixed(2)} → ${z1.toFixed(2)})`);
  await f.pinch([195, 420], 220, 90);
  assert.ok((await view()).z < z1 * 0.7, 'pinching in zooms out');
});
