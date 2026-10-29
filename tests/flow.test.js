'use strict';
/** Teacher ↔ student flows over real WebRTC data channels (local PeerServer). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env, teacher, maya, leo, code;
const T = (fn, arg) => teacher.evaluate(fn, arg);

before(async () => {
  env = await boot();
  teacher = await env.teacher();
  code = await T(() => Network.getCode());
  maya = await env.student(code, 'Maya', 'phone', 3);
  leo = await env.student(code, 'Leo', 'phone', 7);
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('both students appear on the teacher roster', async () => {
  assert.equal(await T(() => Network.studentCount()), 2);
});

test('students wait while the board is locked, then see note types when it opens', async () => {
  assert.match(await maya.textContent('#board-content'), /Eyes on the board/);
  await T(() => Network.transitionTo('OPEN'));
  await maya.waitForSelector('.type-tile.t-wonder');
  assert.equal(await maya.locator('.type-tile').count(), 5);           // four note types + sketch
});

test('a typed note reaches the teacher board with the student as author', async () => {
  await maya.click('.type-tile.t-wonder');
  await maya.fill('#w-txt', 'Why does salt melt ice faster?');
  await maya.click('#w-send');
  await teacher.waitForFunction(() => State.items.some((i) => i.text === 'Why does salt melt ice faster?'));
  assert.equal(await T(() => State.items.find((i) => i.sub === 'wonder').author), 'Maya');
  await maya.click('#tab-notes');
  await maya.waitForFunction(() => /On the board/.test(document.getElementById('notes-list').textContent));
});

test('a sketch is delivered as an image note', async () => {
  await maya.click('#tab-board');
  await maya.click('.type-tile.t-sketch');
  await maya.waitForSelector('#p-sketch:not([hidden])');
  await maya.waitForTimeout(400);
  const box = await maya.locator('#s-canvas').boundingBox();
  await maya.mouse.move(box.x + 40, box.y + 40);
  await maya.mouse.down();
  for (let i = 0; i < 16; i++) await maya.mouse.move(box.x + 40 + i * 9, box.y + 60 + Math.sin(i / 2) * 30);
  await maya.mouse.up();
  await maya.fill('#s-caption', 'wave');
  await maya.click('#s-send');
  await teacher.waitForFunction(() => State.items.some((i) => i.sub === 'sketch' && /^data:image\/png/.test(i.src)));
});

test('approval mode holds notes until the teacher accepts or declines them', async () => {
  await T(() => { State.settings.approve = true; Network.broadcast({ type: 'RULES', rules: { names: true, approve: true } }); });
  await maya.click('#tab-board');
  await maya.click('.type-tile.t-idea');
  await maya.fill('#w-txt', 'Needs approval');
  await maya.click('#w-send');
  await teacher.waitForFunction(() => State.pending.length === 1);
  await maya.click('#tab-notes');
  await maya.waitForFunction(() => /Waiting for your teacher/.test(document.getElementById('notes-list').textContent));
  await T(() => Network.approve(State.pending[0].id, true));
  await maya.waitForFunction(() => /Needs approval[\s\S]*On the board/.test(document.getElementById('notes-list').textContent));

  await maya.click('#tab-board');
  await maya.click('.type-tile.t-notice');
  await maya.fill('#w-txt', 'Please decline me');
  await maya.click('#w-send');
  await teacher.waitForFunction(() => State.pending.length === 1);
  await T(() => Network.approve(State.pending[0].id, false));
  await maya.click('#tab-notes');
  await maya.waitForFunction(() => /Not added/.test(document.getElementById('notes-list').textContent));
  await T(() => { State.settings.approve = false; Network.broadcast({ type: 'RULES', rules: { names: true, approve: false } }); });
});

test('muting a student stops their notes', async () => {
  const pid = await T(() => Object.entries(State.students).find(([, s]) => s.name === 'Maya')[0]);
  await T((id) => Network.toggleMute(id), pid);
  await maya.click('#tab-board');
  await maya.waitForFunction(() => /paused notes/i.test(document.getElementById('board-content').textContent));
  assert.equal(await maya.getAttribute('#tab-add', 'aria-disabled'), 'true');
  await T((id) => Network.toggleMute(id), pid);
  await maya.waitForFunction(() => document.getElementById('tab-add').getAttribute('aria-disabled') === 'false');
});

test('vote → rank → discuss on the same zone each accept one response per student', async () => {
  await T(() => {
    StateManager.addItem({ id: 'zv1', type: 'zone', title: 'Ideas', x: 100, y: 100, w: 500, h: 320, children: [], groupId: null });
    [['na', 'Melt ice with salt', 'idea'], ['nb', 'Use a heat lamp', 'test'], ['nc', 'Why is salt a freezing-point depressant?', 'wonder']].forEach(([id, text, sub]) => {
      StateManager.addItem({ id, type: 'note', sub, text, x: 0, y: 0, w: 140, h: 120, author: 'Teacher', votes: 0, groupId: null });
      HierarchyManager.link(id, 'zv1');
    });
    StateManager.setSelection(['zv1']);
    Network.startActivity('vote');
  });
  for (const p of [maya, leo]) {
    await p.click('#tab-board');
    await p.waitForSelector('.choice');
    assert.equal(await p.isDisabled('[data-act="send-vote"]'), true, 'cannot submit before choosing');
    await p.click('.choice >> nth=1');
    await p.click('[data-act="send-vote"]');
  }
  await teacher.waitForFunction(() => (State.activeSorts.zv1 || []).length === 2);

  await T(() => { StateManager.setSelection(['zv1']); Network.startActivity('sort'); });
  await leo.waitForSelector('.sort-item');
  const first = await leo.textContent('.sort-item >> nth=0 >> .txt');
  await leo.click('.sort-item >> nth=0 >> [data-mv="1"]');
  assert.equal(await leo.textContent('.sort-item >> nth=1 >> .txt'), first, 'arrow buttons reorder');
  const grip = await leo.locator('.sort-item >> nth=2 >> [data-grip]').boundingBox();
  const top = await leo.locator('.sort-item >> nth=0').boundingBox();
  const last = await leo.textContent('.sort-item >> nth=2 >> .txt');
  await leo.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await leo.mouse.down();
  for (let i = 1; i <= 12; i++) await leo.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + ((top.y - grip.y - 10) * i) / 12);
  await leo.mouse.up();
  assert.equal(await leo.textContent('.sort-item >> nth=0 >> .txt'), last, 'dragging the handle reorders');
  await leo.click('[data-act="send-rank"]');
  await maya.waitForSelector('.sort-item');
  await maya.click('[data-act="send-rank"]');
  await teacher.waitForFunction(() => (State.activeSorts.zv1 || []).length === 2);

  await T(() => { StateManager.setSelection(['zv1']); Network.startActivity('discuss'); });
  await maya.waitForSelector('[data-act="comment"]');
  await maya.click('[data-act="comment"] >> nth=0');
  await maya.click('[data-tag="question"]');
  await maya.fill('#cm-text', 'How would you control the variables?');
  await maya.click('.sheet-f .btn-primary');
  await teacher.waitForFunction(() => State.comments.length === 1 && State.comments[0].tag === 'question' && State.comments[0].author === 'Maya');
});

test('poll, live graph and every exit-ticket format', async () => {
  await T(() => {
    StateManager.addItem({ id: 'pl1', type: 'poll', q: 'Which melts first?', opts: [{ lbl: 'Salted', v: 0 }, { lbl: 'Plain', v: 0 }], x: 700, y: 100, w: 260, h: 170, groupId: null });
    StateManager.addItem({ id: 'gr1', type: 'graph', title: 'Melt time', data: [], x: 700, y: 300, w: 320, h: 220, groupId: null });
    const ex = (id, exitMode, prompt, opts, x) => StateManager.addItem({ id, type: 'zone', zoneType: 'exit', exitMode, title: 'Exit Ticket', prompt, opts, x, y: 900, w: 400, h: 300, children: [], groupId: null });
    ex('ex1', 'mc', 'Favourite part?', ['Experiment', 'Discussion'], 0); ex('ex2', 'smiley', 'Confidence?', null, 450); ex('ex3', 'lw', 'Learn and wonder', null, 900);
    ex('ex4', 'multi', 'Tools used?', ['Timer', 'Scale'], 1350); ex('ex5', 'short', 'One sentence', null, 1800);
    Network.toggleZone('pl1');
  });
  await maya.waitForSelector('#p-poll:not([hidden])');
  await maya.click('#poll-opts .choice >> nth=0'); await maya.click('#poll-send');
  await leo.click('#poll-opts .choice >> nth=1'); await leo.click('#poll-send');
  await teacher.waitForFunction(() => State.items.find((i) => i.id === 'pl1').opts.map((o) => o.v).join() === '1,1');

  await T(() => Network.toggleZone('gr1'));
  await maya.waitForSelector('#p-graph:not([hidden])');
  await maya.fill('#graph-val', 'abc'); await maya.click('#graph-send');
  assert.equal(await maya.isVisible('#graph-err'), true, 'non-numbers are rejected');
  await maya.fill('#graph-val', '4,5'); await maya.click('#graph-send');
  await teacher.waitForFunction(() => State.items.find((i) => i.id === 'gr1').data.join() === '4.5');

  const answers = {
    ex1: () => maya.click('#exit-area .choice >> nth=1'),
    ex2: () => maya.click('#exit-area .smiley >> nth=3'),
    ex3: async () => { await maya.fill('#ex-l', 'Salt lowers the melting point'); await maya.fill('#ex-w', 'Does sugar?'); },
    ex4: async () => { await maya.click('#exit-area .choice >> nth=0'); await maya.click('#exit-area .choice >> nth=1'); },
    ex5: () => maya.fill('#ex-txt', 'Salt makes ice melt at lower temperatures.')
  };
  for (const id of Object.keys(answers)) {
    await T((x) => Network.toggleZone(x), id);
    await maya.waitForSelector('#p-exit:not([hidden])');
    await maya.click('#exit-send');
    assert.equal(await maya.isVisible('#exit-err'), true, `${id}: an empty answer is rejected`);
    await answers[id]();
    await maya.click('#exit-send');
    await maya.waitForSelector('#p-exit', { state: 'hidden' });
  }
  assert.equal(await T(() => State.items.filter((i) => /^ex\d$/.test(i.parentZone || '')).length), 5);
});

test('the class timer shows on students and clears when reset', async () => {
  await T(() => { Object.assign(State.timer, { running: true, totalMs: 90000, remainingMs: 90000, endsAt: Date.now() + 90000 }); Shell.Timer.render(true); });
  await maya.waitForSelector('#timer-pill:not([hidden])');
  assert.match(await maya.textContent('#timer-text'), /^0[01]:\d\d$/);
  await T(() => { Object.assign(State.timer, { running: false, totalMs: 0, remainingMs: 0 }); Shell.Timer.render(true); });
  await maya.waitForSelector('#timer-pill', { state: 'hidden' });
});
