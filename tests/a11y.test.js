'use strict';
/**
 * Automated accessibility audit with axe-core (WCAG 2.0/2.1 A + AA and best practices) across the landing page,
 * teacher console and student app, in light and dark themes and on desktop and phone.
 * It cannot replace a manual screen-reader and keyboard pass, but it keeps contrast, names, roles and landmarks from regressing.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

const AXE = require.resolve('axe-core/axe.min.js');
let env, code;

async function violations(page) {
  await page.addScriptTag({ path: AXE });             // contexts below use bypassCSP: axe is injected as an inline script
  return page.evaluate(async () => {
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] });
    return res.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}
const clean = async (page, label) => assert.deepEqual(await violations(page), [], `${label} has accessibility violations`);

before(async () => {
  env = await boot();
  const t = await env.teacher('desktop');
  code = await t.evaluate(() => Network.getCode());
  await t.evaluate(() => Network.transitionTo('OPEN'));
});
after(async () => { await env.close(); });

for (const scheme of ['light', 'dark']) {
  test(`landing page (${scheme})`, async () => {
    for (const device of ['desktop', 'phone']) {
      const p = await env.open(device, null, { colorScheme: scheme, bypassCSP: true });
      await p.goto(env.origin + '/');
      await p.waitForTimeout(400);
      await clean(p, `landing ${device} ${scheme}`);
    }
  });

  test(`teacher console (${scheme})`, async () => {
    for (const device of ['desktop', 'phone']) {
      const c = await env.context(device, { colorScheme: scheme, bypassCSP: true });
      const p = await c.newPage();
      await p.goto(env.origin + '/Teacher/');
      await clean(p, `teacher home ${device} ${scheme}`);
      await p.click('#btn-new-board');
      await p.waitForFunction(() => window.Network && Network.status === 'ready');
      await p.evaluate(() => {
        StateManager.addItem({ id: 'z1', type: 'zone', title: 'I notice', x: 40, y: 40, w: 330, h: 400, children: [], groupId: null });
        [['a', 'notice', 'The ice melted'], ['b', 'wonder', 'Why?'], ['c', 'idea', 'Use salt'], ['d', 'test', 'Race three cubes']].forEach(([id, sub, text], i) => {
          StateManager.addItem({ id, type: 'note', sub, text, author: 'Maya', x: 400 + i * 10, y: 40 + i * 150, w: 240, h: 130, votes: 0, groupId: null });
        });
        StateManager.addItem({ id: 'pl', type: 'poll', q: 'Which melts first?', opts: [{ lbl: 'Salted', v: 2 }, { lbl: 'Plain', v: 1 }], x: 700, y: 40, w: 260, h: 170, groupId: null });
        StateManager.addItem({ id: 'gr', type: 'graph', title: 'Melt time', data: [3, 4, 4, 6], x: 700, y: 260, w: 320, h: 220, groupId: null });
        document.activeElement && document.activeElement.blur();
        DQBUI.Overlay.closeAll(); StateManager.setSelection([]); Viewport.fit(false);
      });
      await p.waitForTimeout(500);
      await clean(p, `teacher board ${device} ${scheme}`);
      await p.evaluate(() => StateManager.setSelection(['a']));
      await p.waitForTimeout(300);
      await clean(p, `teacher selection ${device} ${scheme}`);
      for (const [label, open] of [['share sheet', () => Shell.Share.open()], ['class panel', () => Shell.Panel.open('students')], ['settings', () => Shell.Settings.open()]]) {
        await p.evaluate(() => { Shell.Panel.close(); DQBUI.Overlay.closeAll(); StateManager.setSelection([]); });
        await p.waitForTimeout(350);
        await p.evaluate(open);
        await p.waitForTimeout(500);
        await clean(p, `teacher ${label} ${device} ${scheme}`);
      }
    }
  });

  test(`student app (${scheme})`, async () => {
    const c = await env.context('phone', { colorScheme: scheme, bypassCSP: true });
    const s = await c.newPage();
    await s.goto(env.origin + '/Student/?join=' + code);
    await s.waitForSelector('body[data-ready="1"]');
    await clean(s, `student setup ${scheme}`);
    await s.fill('#inp-name', 'Maya');
    await s.click('#btn-setup');
    await s.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected');
    await s.waitForSelector('.type-tile');
    await s.waitForTimeout(2600);                                                   // let the welcome toast clear
    await clean(s, `student board ${scheme}`);
    await s.click('.type-tile.t-idea');
    await s.waitForSelector('#p-write:not([hidden])');
    await s.fill('#w-txt', 'A thought');
    await s.waitForTimeout(300);
    await clean(s, `student write ${scheme}`);
    await s.click('#w-sketch');
    await s.waitForSelector('#p-sketch:not([hidden])');
    await s.waitForTimeout(400);
    await clean(s, `student sketch ${scheme}`);
    await s.click('#p-sketch [data-close]');
    await s.waitForSelector('#p-sketch', { state: 'hidden' });
    await s.click('#tab-notes');
    await s.waitForTimeout(450);                                                    // the view fades in; audit the settled colours
    await clean(s, `student my notes ${scheme}`);
    await s.click('#me-btn');
    await s.waitForSelector('.sheet');
    await s.waitForTimeout(300);
    await clean(s, `student profile ${scheme}`);
  });
}
