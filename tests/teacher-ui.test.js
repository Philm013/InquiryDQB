'use strict';
/** Teacher console: real pointer and keyboard input on desktop, tap-driven navigation on a phone. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env;
before(async () => { env = await boot(); });
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('desktop: create, edit, drag, resize, marquee-select, delete and undo', async () => {
  const p = await env.teacher('desktop');
  const E = (fn, arg) => p.evaluate(fn, arg);
  const vp = await p.locator('#viewport').boundingBox();
  const at = (x, y) => [vp.x + x, vp.y + y];
  assert.equal(await E(() => State.tool), 'select', 'select is the default tool with a mouse');

  for (const [x, y, text] of [[300, 200, 'Ice melts'], [800, 300, 'Salt helps'], [500, 560, 'Why?']]) {
    await p.mouse.dblclick(...at(x, y));                                          // double-click on empty canvas adds a note
    await p.waitForTimeout(350);
    await p.keyboard.type(text);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
  }
  assert.deepEqual(await E(() => State.items.map((i) => i.text).sort()), ['Ice melts', 'Salt helps', 'Why?']);

  const n0 = await E(() => ({ id: State.items[0].id, x: State.items[0].x, y: State.items[0].y, w: State.items[0].w }));
  const box = await p.locator(`[id="${n0.id}"]`).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 120, box.y + box.height - 20 + 90, { steps: 10 });
  await p.mouse.up();
  const moved = await E((id) => { const n = State.items.find((i) => i.id === id); return { x: n.x, y: n.y }; }, n0.id);
  assert.ok(Math.abs(moved.x - n0.x - 120) < 8 && Math.abs(moved.y - n0.y - 90) < 8, `dragged by ~120,90 (was ${moved.x - n0.x},${moved.y - n0.y})`);
  assert.equal(await p.isVisible('#selbar'), true, 'selection toolbar appears');

  const handle = await p.locator(`[id="${n0.id}"] .resize-h`).boundingBox();
  await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await p.mouse.down();
  await p.mouse.move(handle.x + 90, handle.y + 70, { steps: 8 });
  await p.mouse.up();
  assert.ok((await E((id) => State.items.find((i) => i.id === id).w, n0.id)) > n0.w + 40, 'resize handle grows the note');

  await p.mouse.click(...at(1100, 700));
  assert.equal(await E(() => State.selection.length), 0, 'clicking the canvas clears the selection');
  await p.mouse.move(...at(160, 110));
  await p.mouse.down();
  await p.mouse.move(...at(1150, 760), { steps: 12 });
  await p.mouse.up();
  assert.equal(await E(() => State.selection.length), 3, 'a marquee selects everything it covers');

  await p.keyboard.press('Delete');
  assert.equal(await E(() => State.items.length), 0);
  await p.waitForSelector('.toast .toast-action');                                  // “Undo” is offered
  await p.keyboard.press('Control+z');
  assert.equal(await E(() => State.items.length), 3, 'Ctrl+Z brings the notes back');

  await p.click('#zoom-fit');
  await p.waitForTimeout(400);
  assert.equal(await E(() => State.items.every((i) => { const r = document.getElementById(i.id).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })), true, 'fit shows everything');
  const z0 = await E(() => State.view.z);
  await p.keyboard.down('Control');
  await p.mouse.move(...at(700, 400));
  await p.mouse.wheel(0, -300);
  await p.keyboard.up('Control');
  const z1 = await E(() => State.view.z);
  assert.ok(z1 > z0 * 1.1 && z1 < z0 * 1.5, `a wheel click zooms by a modest step (${z0.toFixed(2)} → ${z1.toFixed(2)})`);
});

test('desktop: drawing tools, shortcuts, menus and exports', async () => {
  const p = await env.teacher('desktop');
  const E = (fn, arg) => p.evaluate(fn, arg);
  const vp = await p.locator('#viewport').boundingBox();
  for (const [key, id] of [['h', 'rail-pan'], ['v', 'rail-select'], ['p', 'rail-draw'], ['e', 'rail-eraser']]) {
    await p.keyboard.press(key);
    assert.equal(await p.getAttribute('#' + id, 'aria-pressed'), 'true', `${key.toUpperCase()} selects ${id}`);
  }
  await p.keyboard.press('p');
  await p.mouse.move(vp.x + 300, vp.y + 150);
  await p.mouse.down();
  await p.mouse.move(vp.x + 600, vp.y + 180, { steps: 15 });
  await p.mouse.up();
  assert.equal(await E(() => State.ink.length), 1, 'the pen draws');
  await p.keyboard.press('e');
  await p.mouse.move(vp.x + 450, vp.y + 140);
  await p.mouse.down();
  await p.mouse.move(vp.x + 450, vp.y + 230, { steps: 10 });
  await p.mouse.up();
  assert.equal(await E(() => State.ink.length), 0, 'the eraser removes it');
  await p.keyboard.press('v');

  await p.click('#rail-add');
  await p.waitForSelector('.flyout');
  assert.ok((await p.locator('.flyout .tile').count()) >= 8, 'the Add flyout lists every item type');
  await p.keyboard.press('Escape');
  await p.keyboard.press('?');
  await p.waitForSelector('.sheet');
  assert.match(await p.textContent('.sheet'), /Keyboard shortcuts/);
  await p.keyboard.press('Escape');

  await E(() => { Actions.create('note', 'idea'); });
  await p.keyboard.press('Escape');
  const [json] = await Promise.all([p.waitForEvent('download'), E(() => Board.export())]);
  assert.match(json.suggestedFilename(), /\.json$/);
  const [png] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), E(() => Board.exportPNG())]);
  assert.match(png.suggestedFilename(), /\.png$/);
  await E(() => Shell.A11y.open());
  await p.waitForSelector('.a11y-list');
  assert.match(await p.textContent('.a11y-list'), /Idea|idea/i);
});

test('desktop: boards persist, and a co-host can join, edit and is refused with the wrong key', async () => {
  const host = await env.teacher('desktop');
  await host.evaluate(() => StateManager.addItem({ id: 'n1', type: 'note', sub: 'idea', text: 'persist me', x: 100, y: 100, w: 200, h: 140, author: 'T', votes: 0, groupId: null }));
  const code = await host.evaluate(() => Network.getCode());
  const cohostCode = await host.evaluate(() => Network.cohostCode());

  const co = await env.open('desktop', '/Teacher/');
  await co.click('#btn-join-cohost');
  await co.fill('#jn-code', cohostCode);
  await co.click('.sheet-f .btn-primary');
  await co.waitForFunction(() => window.State && State.items.some((i) => i.id === 'n1'), null, { timeout: 20000 });
  await co.evaluate(() => StateManager.updateItem('n1', { text: 'edited by co-host' }));
  await host.waitForFunction(() => State.items.find((i) => i.id === 'n1').text === 'edited by co-host');
  await host.evaluate(() => StateManager.addItem({ id: 'n2', type: 'note', sub: 'wonder', text: 'from host', x: 400, y: 100, w: 200, h: 140, author: 'T', votes: 0, groupId: null }));
  await co.waitForFunction(() => State.items.some((i) => i.id === 'n2'));

  const bad = await env.open('desktop', '/Teacher/');
  await bad.click('#btn-join-cohost');
  await bad.fill('#jn-code', `${code}.WRONGKEY`);
  await bad.click('.sheet-f .btn-primary');
  await bad.waitForTimeout(3000);
  assert.equal(await bad.evaluate(() => State.items.length), 0, 'the wrong key never receives the board');

  // leaving saves the board; it is listed on the home screen and reopens intact
  await host.waitForTimeout(500);
  await host.click('#tb-back');
  await host.click('.dlg-actions .btn-primary');
  await host.waitForSelector('#saved-list .board-card [data-open]');
  await host.locator('#saved-list .board-card [data-open]').first().click();
  await host.waitForFunction(() => State.items.length === 2 && State.items.some((i) => i.text === 'edited by co-host'));
});

test('phone: bottom navigation, tap-to-select, sheets and the system back button', async () => {
  const p = await env.teacher('phone');
  const E = (fn, arg) => p.evaluate(fn, arg);
  assert.equal(await p.isVisible('#bottomnav'), true);
  assert.equal(await E(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
  await E(() => { StateManager.addItem({ id: 'tapme', type: 'note', sub: 'idea', text: 'Tap me', x: 40, y: 120, w: 220, h: 170, author: 'T', votes: 0, groupId: null }); StateManager.setSelection([]); Viewport.fit(false); });
  await p.waitForTimeout(500);
  const id = await E(() => State.items[0].id);
  const box = await p.locator(`[id="${id}"]`).boundingBox();
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 15);
  await p.waitForFunction((i) => State.selection.includes(i), id);
  assert.equal(await p.isVisible('#selbar'), true, 'tapping a note selects it and shows its actions');

  await p.click('#nav-add');
  await p.waitForSelector('.sheet');
  await p.goBack();                                                               // the phone's back gesture closes the sheet, not the board
  await p.waitForSelector('.sheet', { state: 'detached' });
  assert.equal(await E(() => !document.getElementById('app').hidden), true, 'still on the board');

  await p.click('#nav-class');
  await p.waitForSelector('.sheet #panel-body');                                  // on phones the class panel is a sheet
  await p.goBack();
  await p.waitForSelector('.sheet', { state: 'detached' });

  for (const target of ['nav-tools', 'nav-more']) {
    await p.click('#' + target);
    await p.waitForSelector('.sheet, .menu');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.sheet, .menu', { state: 'detached' });
  }
  const tooSmall = await E(() => [...document.querySelectorAll('button, a, [role=button]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && e.offsetParent && (r.width < 36 || r.height < 36) && !e.closest('.item') && !e.matches('.resize-h'); }).map((e) => e.id || e.className).slice(0, 8));
  assert.deepEqual(tooSmall, [], 'touch targets on the phone board are at least 36px');
});
