'use strict';
/** Shared model, reconnects, the offline outbox, removing a student and resetting the class code. */
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
  // Leo joins by typing a sloppy, lower-case, spaced code
  leo = await env.open('phone', '/Student/');
  await leo.waitForSelector('body[data-ready="1"]');
  await leo.fill('#inp-name', 'Leo');
  await leo.click('#btn-setup');
  await leo.waitForSelector('#inp-code');
  await leo.fill('#inp-code', `${code.slice(0, 3)} - ${code.slice(3).toLowerCase()}`);
  await leo.click('#btn-connect');
  await leo.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 25000 });
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('shared model: students watch, can be allowed to draw, follow the teacher, and late joiners land inside it', async () => {
  await T(() => {
    StateManager.addItem({ id: 'cz1', type: 'zone', zoneType: 'consensus', title: 'Class model', x: 100, y: 100, w: 600, h: 520, children: ['c1', 'c2'], ink: [], groupId: null });
    StateManager.addItem({ id: 'c1', type: 'note', sub: 'idea', text: 'Salt lowers the freezing point', x: 140, y: 180, w: 200, h: 140, parentZone: 'cz1', author: 'Teacher', votes: 0, groupId: null });
    StateManager.addItem({ id: 'c2', type: 'note', sub: 'notice', text: 'Ice near the salt melts first', x: 400, y: 300, w: 200, h: 140, parentZone: 'cz1', author: 'Teacher', votes: 0, groupId: null });
    Consensus.start('cz1');
  });
  await maya.waitForSelector('#p-consensus:not([hidden])');
  await maya.waitForFunction(() => document.querySelectorAll('#cm-items .c-item').length === 2);
  assert.equal(await maya.textContent('#cm-sub'), 'Watching');
  assert.equal(await maya.isVisible('#cm-tools'), false);

  const pid = await T(() => Object.entries(State.students).find(([, s]) => s.name === 'Maya')[0]);
  await T((id) => Consensus.toggleParticipant(id), pid);
  await maya.waitForSelector('#cm-tools', { state: 'visible' });
  const box = await maya.locator('#cm-view').boundingBox();
  await maya.mouse.move(box.x + 60, box.y + 200);
  await maya.mouse.down();
  for (let i = 0; i < 25; i++) await maya.mouse.move(box.x + 60 + i * 9, box.y + 200 + Math.sin(i / 3) * 30);
  await maya.mouse.up();
  await teacher.waitForFunction(() => State.consensusMode.ink.length === 1);
  await leo.waitForFunction(() => document.querySelectorAll('#cm-ink path').length >= 1);          // other students see it too

  const before = await leo.evaluate(() => document.getElementById('cm-world').style.transform);
  await T(() => { State.consensusMode.view.z *= 1.5; Consensus._viewChanged(); });
  await leo.waitForFunction((b) => document.getElementById('cm-world').style.transform !== b, before);
  const vb = await leo.locator('#cm-view').boundingBox();
  await leo.mouse.move(vb.x + 100, vb.y + 300);
  await leo.mouse.down();
  await leo.mouse.move(vb.x + 220, vb.y + 340, { steps: 8 });
  await leo.mouse.up();
  assert.match(await leo.textContent('#cm-follow'), /Free look/, 'panning turns off follow');
  await leo.click('#cm-follow');
  assert.match(await leo.textContent('#cm-follow'), /Following/);

  const zoe = await env.student(code, 'Zoe', 'phone', 9);
  await zoe.waitForSelector('#p-consensus:not([hidden])', { timeout: 8000 });                         // joined mid-session
  await T(() => Consensus.stop());
  await maya.waitForSelector('#p-consensus', { state: 'hidden' });
  await zoe.waitForSelector('#p-consensus', { state: 'hidden' });
  await T(() => { State.consensusMode.active = false; });
  await zoe.context().close();
});

test('a locked board keeps the draft and blocks sending; reopening restores and delivers it', async () => {
  await T(() => Network.transitionTo('OPEN'));
  await maya.waitForSelector('.type-tile');
  await maya.click('.type-tile.t-notice');
  await maya.fill('#w-txt', 'half written thought');
  await T(() => Network.transitionTo('LOCKED'));
  await maya.waitForSelector('#w-warn', { state: 'visible' });
  assert.equal(await maya.isDisabled('#w-send'), true);
  await maya.click('#p-write [data-close]');
  await maya.waitForSelector('#p-write', { state: 'hidden' });
  await maya.click('#tab-add', { force: true });                                                      // aria-disabled, but still tappable
  await maya.waitForTimeout(300);
  assert.equal(await maya.isVisible('#p-write'), false);
  await T(() => Network.transitionTo('OPEN'));
  await maya.waitForFunction(() => document.getElementById('tab-add').getAttribute('aria-disabled') === 'false');
  await maya.click('#tab-add');
  await maya.waitForSelector('#p-write:not([hidden])');
  assert.equal(await maya.inputValue('#w-txt'), 'half written thought');
  await maya.click('#w-send');
  await teacher.waitForFunction(() => State.items.some((i) => i.text === 'half written thought'));
});

test('a dropped connection reconnects automatically without duplicating the student', async () => {
  const pid = await T(() => Object.entries(State.students).find(([, s]) => s.name === 'Maya')[0]);
  await T((id) => State.students[id].conn.close(), pid);
  await maya.waitForFunction(() => /Reconnecting|Connecting/.test(document.getElementById('conn-text').textContent), null, { timeout: 15000 });
  await maya.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 30000 });
  assert.equal(await T(() => Object.values(State.students).filter((s) => s.name === 'Maya').length), 1);
  assert.ok((await maya.locator('.type-tile').count()) >= 4, 'the open board is restored after reconnecting');
});

test('notes written while the host is gone wait in the outbox and arrive when it returns', async () => {
  await T(() => Network._teardown());                                                                 // the host disappears
  await maya.waitForFunction(() => /Reconnecting|Connecting|Offline/.test(document.getElementById('conn-text').textContent), null, { timeout: 15000 });
  await maya.waitForSelector('#banner', { state: 'visible' });
  await maya.click('#tab-add');
  await maya.waitForSelector('#p-write:not([hidden])');
  await maya.fill('#w-txt', 'written while offline');
  await maya.click('#w-send');
  await maya.click('#tab-notes');
  assert.match(await maya.textContent('#notes-list'), /Sending/);
  await T(() => Network.host());                                                                       // same code comes back
  await teacher.waitForFunction(() => Network.status === 'ready', null, { timeout: 15000 });
  await maya.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 40000 });
  await teacher.waitForFunction(() => State.items.some((i) => i.text === 'written while offline'), null, { timeout: 15000 });
  await maya.waitForFunction(() => !/Sending/.test(document.getElementById('notes-list').textContent));
});

test('a removed student is told so and cannot rejoin; a new code tells everyone', async () => {
  await teacher.waitForFunction(() => Object.values(State.students).some((s) => s.name === 'Leo'));
  const leoPid = await T(() => Object.entries(State.students).find(([, s]) => s.name === 'Leo')[0]);
  T((id) => Network.kick(id), leoPid);
  await teacher.waitForSelector('.dlg-actions .btn-danger');
  await teacher.click('.dlg-actions .btn-danger');
  await leo.waitForSelector('#v-ended', { state: 'visible' });
  assert.match(await leo.textContent('#ended-title'), /removed/i);
  await leo.click('#btn-rejoin');
  await leo.fill('#inp-code', code);
  await leo.click('#btn-connect');
  await leo.waitForSelector('#v-ended', { state: 'visible', timeout: 10000 });                         // the block survives a rejoin attempt

  T(() => Network.resetCode());
  await teacher.waitForSelector('.dlg-actions .btn-primary');
  await teacher.click('.dlg-actions .btn-primary');
  await maya.waitForSelector('#v-ended', { state: 'visible', timeout: 10000 });
  assert.match(await maya.textContent('#ended-title'), /code was reset/i);
  await teacher.waitForFunction((old) => Network.status === 'ready' && Network.getCode() !== old, code, { timeout: 15000 });
});
