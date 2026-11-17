'use strict';
/**
 * The browser history behind sheets (the phone back gesture closes them). A sheet that hands over to another sheet, and dialogs
 * that follow each other, must leave the browser on the entry the app thinks it is on: closing the last one must never go back
 * a page too far and leave the board (it used to on phones: Add › library › Done went back to the previous page).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env;

function host() {
  window.DQB_HOST = {
    library: {
      name: 'TestSite', title: 'Add from TestSite',
      search: async () => [{ id: 11, kind: 'resource', title: 'Water cycle simulator', url: 'https://example.org/sim', meta: 'Interactive' }]
    }
  };
}
async function phoneTeacher(extra) {
  const c = await env.context('phone', extra);
  await c.addInitScript(host);
  const p = await c.newPage();
  p.on('pageerror', (e) => env.pageErrors.push('history: ' + e.message));
  await p.goto(env.origin + '/Teacher/');
  await p.click('#btn-new-board');
  await p.waitForFunction(() => window.Network && Network.status === 'ready', null, { timeout: 20000 });
  return p;
}
const onBoard = async (p) => {
  assert.equal(new URL(p.url()).pathname, '/Teacher/', 'still on the console');
  assert.equal(await p.evaluate(() => history.state), null, 'back on the board’s own history entry');
  assert.equal(await p.evaluate(() => !!document.querySelector('#viewport') && Workspace.mode === 'board'), true);
};

before(async () => { env = await boot(); });
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('on a phone, Add › library › Card › Done stays on the board, and Back still closes the next sheet', async () => {
  const p = await phoneTeacher();
  await p.tap('#nav-add');
  await p.locator('[data-act="library"]').filter({ visible: true }).first().tap();   // the Add sheet hands over to the library
  await p.waitForSelector('.lib-row');
  await p.tap('.lib-row [data-lib="card"]');
  await p.locator('.sheet-f button', { hasText: 'Done' }).tap();
  await p.waitForTimeout(700);
  await onBoard(p);
  assert.equal(await p.evaluate(() => State.items.filter((i) => i.type === 'link').length), 1);

  // the back gesture closes a sheet and nothing else
  await p.tap('#nav-add');
  await p.waitForSelector('.ov .sheet');
  await p.goBack({ waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(600);
  assert.equal(await p.locator('.ov').count(), 0, 'Back closed the sheet');
  await onBoard(p);
  await p.context().close();
});

test('dialogs that follow each other (Insert › Link) stay on the board, with reduced motion too', async () => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const p = await phoneTeacher({ reducedMotion });
    await p.evaluate(() => { Actions.promptLink(); });
    await p.waitForSelector('.ov input');
    await p.fill('.ov input', 'https://example.org/page');
    await p.locator('.ov .sheet-f button', { hasText: 'Next' }).tap();
    await p.waitForFunction(() => [...document.querySelectorAll('.ov:not(.closing) .dlg h3')].some((h) => h.textContent === 'Title'));
    await p.fill('.ov:not(.closing) input', 'Example page');
    await p.locator('.ov:not(.closing) .sheet-f button', { hasText: 'Add' }).tap();
    await p.waitForTimeout(700);
    await onBoard(p);
    assert.equal(await p.evaluate(() => State.items.filter((i) => i.type === 'link' && i.title === 'Example page').length), 1, reducedMotion);
    await p.context().close();
  }
});

test('a sheet that opens while the browser is still going back for the last one keeps its place in history', async () => {
  const p = await phoneTeacher();
  for (let k = 0; k < 3; k++) {
    await p.evaluate(async () => {
      const a = DQBUI.Overlay.open({ title: 'First', content: 'x' });
      a.close();
      await new Promise((r) => setTimeout(r, 0));                     // the batched "back" is on its way now
      const b = DQBUI.Overlay.open({ title: 'Second', content: 'y' });    // …and this sheet opens before the browser gets there
      b.close();
    });
    await p.waitForTimeout(500);
    await onBoard(p);
  }
  // the back gesture still closes exactly one sheet
  await p.evaluate(() => { DQBUI.Overlay.open({ title: 'Third', content: 'z' }); });
  await p.goBack({ waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(500);
  assert.equal(await p.locator('.ov').count(), 0);
  await onBoard(p);
  await p.context().close();
});
