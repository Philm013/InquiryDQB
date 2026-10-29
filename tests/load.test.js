'use strict';
/** A full class at once: 30 students join together and each sends three notes. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env;
before(async () => { env = await boot(); });
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('30 students join at once, 90 notes arrive, and the teacher stays responsive', async () => {
  const N = 30;
  const teacher = await env.teacher('desktop');
  const code = await teacher.evaluate(() => Network.getCode());
  await teacher.evaluate(() => Network.transitionTo('OPEN'));

  // one page plays all thirty students using the real protocol (cheaper than thirty browser windows)
  const hub = await env.open('desktop', '/Student/');
  await hub.waitForSelector('body[data-ready="1"]');
  const joined = await hub.evaluate(async ({ code, N }) => {
    const conns = [];
    await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
      const peer = Net.newPeer();
      peer.on('error', () => resolve());
      peer.on('open', () => {
        const c = peer.connect(Net.codeToPeerId(code), { reliable: true });
        c.on('error', () => resolve());
        c.on('open', () => { c.send(JSON.stringify({ type: 'JOIN', name: 'Student ' + (i + 1), avatar: Net.AVATARS[i % 16], sid: 'LOAD' + String(i).padStart(4, '0'), v: 2 })); conns.push(c); resolve(); });
      });
    })));
    window.__conns = conns;
    return conns.length;
  }, { code, N });
  assert.equal(joined, N);
  await teacher.waitForFunction((n) => Network.studentCount() === n, N, { timeout: 30000 });

  await hub.evaluate(() => {
    window.__conns.forEach((c, i) => {
      for (let k = 0; k < 3; k++) c.send(JSON.stringify({ type: 'NOTE', id: `L${i}_${k}`, sub: ['notice', 'wonder', 'idea'][k], text: `Note ${k + 1} from student ${i + 1}` }));
    });
  });
  await teacher.waitForFunction((n) => State.items.filter((i) => i.type === 'note').length === n, N * 3, { timeout: 30000 });

  const stats = await teacher.evaluate(() => {
    const boxes = State.items.map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }));
    let overlaps = 0;
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a], q = boxes[b];
      if (p.x < q.x + q.w - 4 && q.x < p.x + p.w - 4 && p.y < q.y + q.h - 4 && q.y < p.y + p.h - 4) overlaps++;
    }
    const t = performance.now(); Render.all();
    return { overlaps, renderMs: performance.now() - t, status: Network.status, students: Network.studentCount() };
  });
  assert.equal(stats.overlaps, 0, 'new notes land in free space instead of on top of each other');
  assert.ok(stats.renderMs < 250, `a full re-render takes ${Math.round(stats.renderMs)} ms`);
  assert.equal(stats.status, 'ready');
  assert.equal(stats.students, N);
});
