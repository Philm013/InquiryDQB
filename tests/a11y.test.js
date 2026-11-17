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
let env, code, host;

async function violations(page) {
  await page.addScriptTag({ path: AXE });             // contexts below use bypassCSP: axe is injected as an inline script
  return page.evaluate(async () => {
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] });
    return res.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}
/** Waits for sheets and pages to finish animating in: contrast measured mid-fade is wrong (looping animations are ignored). */
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || !a.effect || a.effect.getTiming().iterations === Infinity), null, { timeout: 5000 }).catch(() => {});
const clean = async (page, label) => { await settled(page); assert.deepEqual(await violations(page), [], `${label} has accessibility violations`); };

before(async () => {
  env = await boot();
  host = await env.teacher('desktop');
  code = await host.evaluate(() => Network.getCode());
  await host.evaluate(() => {
    StateManager.addItem({ id: 'za', type: 'zone', title: 'Red team', color: '#ef4444', x: 0, y: 0, w: 320, h: 320, children: [], groupId: null });
    StateManager.addItem({ id: 'zb', type: 'zone', title: 'Blue team', color: '#3b82f6', x: 400, y: 0, w: 320, h: 320, children: [], groupId: null });
    Network.transitionTo('OPEN');
  });
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
      await p.evaluate(() => { InkSel.board.clear(); StateManager.setInk([{ id: 'k1', points: [{ x: 700, y: 520 }, { x: 900, y: 560 }], color: '#ef4444', width: 4 }, { id: 'k2', points: [{ x: 700, y: 600 }, { x: 900, y: 610 }], color: '#3b82f6', width: 4 }]); StateManager.setSelection([]); InkSel.board.set(['k1', 'k2']); });
      await p.waitForTimeout(300);
      await clean(p, `teacher ink selection ${device} ${scheme}`);
      const openZones = () => { StateManager.addItem({ id: 'zc', type: 'zone', title: 'Blue team', color: '#3b82f6', x: 40, y: 500, w: 330, h: 300, children: [], groupId: null }); Network.openZones(['z1', 'zc']); Shell.Panel.open('activity'); };
      for (const [label, open] of [['share sheet', () => Shell.Share.open()], ['class panel', () => Shell.Panel.open('students')], ['settings', () => Shell.Settings.open()], ['groups sheet', () => Shell.Groups.open()], ['open zones activity', openZones]]) {
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
    await host.evaluate(() => Network.openZones(['za', 'zb']));                       // a student without a group chooses between two zones
    await s.waitForSelector('.zone-choice');
    await s.waitForTimeout(300);
    await clean(s, `student zone picker ${scheme}`);
    await s.click('.zone-choice[data-id="zb"]');
    await s.click('.type-tile.t-wonder');
    await s.waitForSelector('#w-zone:not([hidden])');
    await s.waitForTimeout(300);
    await clean(s, `student write with zone choice ${scheme}`);
    await s.click('#p-write [data-close]');
    await s.waitForSelector('#p-write', { state: 'hidden' });
    await host.evaluate(() => Network.transitionTo('OPEN'));
    await s.waitForFunction(() => /The board is open/.test(document.getElementById('board-content').textContent));
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

/* Host-integration UI: link cards on the board, the library sheet and a student's "Shared with you" list. */
function libraryHost() {
  window.DQB_HOST = { library: { name: 'TestSite', search: async () => [
    { id: 1, kind: 'resource', title: 'Water cycle simulator', desc: 'Move the sun and watch evaporation.', url: 'https://example.org/sim', thumb: '/icons/icon-192.png', meta: 'Interactive · Science' },
    { id: 2, kind: 'resource', title: 'Frog life cycle', url: 'https://example.org/frog', meta: 'Video' }
  ] } };
}
for (const scheme of ['light', 'dark']) {
  test(`link cards, library and shared links (${scheme})`, async () => {
    for (const device of ['desktop', 'phone']) {
      const c = await env.context(device, { colorScheme: scheme, bypassCSP: true });
      await c.addInitScript(libraryHost);
      const p = await c.newPage();
      await p.goto(env.origin + '/Teacher/');
      await p.click('#btn-new-board');
      await p.waitForFunction(() => window.Network && Network.status === 'ready');
      await p.evaluate(() => {
        Actions.addLink({ url: 'https://example.org/sim', title: 'Water cycle simulator', desc: 'Move the sun and watch evaporation.', thumb: '/icons/icon-192.png', kind: 'resource', source: 'TestSite' }, null, { select: false });
        Actions.addLink({ url: 'https://example.org/read', title: 'Reading for today', kind: 'link' }, null, { select: false });
        document.activeElement && document.activeElement.blur(); Viewport.fit(false);
      });
      await p.waitForTimeout(500);
      await clean(p, `teacher link cards ${device} ${scheme}`);
      await p.evaluate(() => { const id = State.items.find((i) => i.type === 'link').id; StateManager.setSelection([id]); Network.toggleShare(id); });
      await p.waitForTimeout(400);
      await clean(p, `teacher shared card selected ${device} ${scheme}`);
      await p.evaluate(() => { StateManager.setSelection([]); Shell.Library.open(); });
      await p.waitForSelector('.lib-row');
      await p.waitForTimeout(400);
      await clean(p, `teacher library sheet ${device} ${scheme}`);
      if (device === 'phone') {
        const libCode = await p.evaluate(() => Network.getCode());
        const s = await (await env.context('phone', { colorScheme: scheme, bypassCSP: true })).newPage();
        await s.goto(env.origin + '/Student/?join=' + libCode);
        await s.waitForSelector('body[data-ready="1"]');
        await s.fill('#inp-name', 'Maya');
        await s.click('#btn-setup');
        await s.waitForSelector('.shared-item');
        await s.waitForTimeout(2600);                                               // let the welcome toast clear
        await clean(s, `student shared links ${scheme}`);
      }
    }
  });
}

/* Pictures, videos and exploring: the viewer on the console, and a student's set, explorer and viewer. */
for (const scheme of ['light', 'dark']) {
  test(`pictures, videos and exploring (${scheme})`, async () => {
    const c = await env.context('desktop', { colorScheme: scheme, bypassCSP: true });
    const p = await c.newPage();
    await p.goto(env.origin + '/Teacher/');
    await p.click('#btn-new-board');
    await p.waitForFunction(() => window.Network && Network.status === 'ready');
    const ids = await p.evaluate(async () => {
      const cv = document.createElement('canvas'); cv.width = 900; cv.height = 600; const g = cv.getContext('2d'); g.fillStyle = '#0ea5e9'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#15803d'; g.fillRect(0, 400, 900, 200);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const pic = await Actions.addImageFile(new File([blob], 'pond.png', { type: 'image/png' }));
      Actions.addAnno(pic.id, { k: 'comment', text: 'What lives here?', x: 0.3, y: 0.7 });
      Actions.addAnno(pic.id, { k: 'callout', text: 'The water line', x: 0.5, y: 0.6 });
      Actions.addAnno(pic.id, { k: 'hotspot', text: 'Reeds', x: 0.15, y: 0.8 });
      Actions.addAnno(pic.id, { k: 'ink', pts: [[0.6, 0.2], [0.8, 0.3]], c: '#ef4444', w: 0.006, tool: 'arrow' });
      Actions.addLinkZone('Pond life', [{ url: 'https://example.org/frog', title: 'Frog life cycle', desc: 'From spawn to frog.', kind: 'resource' }, { url: 'https://example.org/pond', title: 'Pond dipping', kind: 'resource' }]);
      const zone = State.items.find((i) => i.type === 'zone');
      const vid = Actions.addMedia({ kind: 'video', title: 'Pond clip', video: { p: 'file', url: '/tests/fixtures/clip.webm' } });
      HierarchyManager.link(vid.id, zone.id); LayoutSystem.update(zone.id);
      Network.toggleShare(pic.id); Network.toggleShare(zone.id);
      DQBUI.Overlay.closeAll(); StateManager.setSelection([]); document.activeElement && document.activeElement.blur(); Viewport.fit(false);
      return { pic: pic.id, vid: vid.id, zone: zone.id };
    });
    await p.waitForTimeout(500);
    await clean(p, `teacher board with pictures, videos and a shared set ${scheme}`);
    await p.evaluate((id) => Actions.openMedia(id), ids.pic);
    await p.waitForSelector('.mv-stage img.mv-img'); await p.waitForTimeout(400);
    await clean(p, `teacher picture viewer ${scheme}`);
    await p.evaluate(() => DQBUI.Overlay.closeAll());
    await p.evaluate((id) => Actions.openMedia(id), ids.vid);
    await p.waitForSelector('.mv-stage video'); await p.waitForTimeout(400);
    await clean(p, `teacher video viewer ${scheme}`);
    await p.evaluate(() => DQBUI.Overlay.closeAll());
    await p.evaluate((id) => Shell.ExploreProgress.open(id), ids.zone);
    await p.waitForTimeout(400);
    await clean(p, `teacher exploring progress ${scheme}`);
    await p.evaluate(() => DQBUI.Overlay.closeAll());
    // a teacher on a phone: the same viewer as a full-height sheet
    const pp = await (await env.context('phone', { colorScheme: scheme, bypassCSP: true })).newPage();
    await pp.goto(env.origin + '/Teacher/');
    await pp.click('#btn-new-board');
    await pp.waitForFunction(() => window.Network && Network.status === 'ready');
    await pp.evaluate(() => { const it = Actions.addMedia({ kind: 'video', title: 'Pond clip', video: { p: 'file', url: '/tests/fixtures/clip.webm' } }); Actions.addAnno(it.id, { k: 'comment', text: 'At this moment', t: 3 }); Actions.openMedia(it.id); });
    await pp.waitForSelector('.mv-stage video'); await pp.waitForTimeout(500);
    await clean(pp, `teacher phone video viewer ${scheme}`);
    // the student's side
    const code2 = await p.evaluate(() => Network.getCode());
    const s = await (await env.context('phone', { colorScheme: scheme, bypassCSP: true })).newPage();
    await s.goto(env.origin + '/Student/?join=' + code2);
    await s.waitForSelector('body[data-ready="1"]');
    await s.fill('#inp-name', 'Maya');
    await s.click('#btn-setup');
    await s.waitForSelector('.shared-item.set');
    await s.waitForTimeout(2600);                                                   // let the welcome toast clear
    await clean(s, `student shared picture and set ${scheme}`);
    await s.click('.shared-item.set');
    await s.waitForSelector('#p-explore .xp-item'); await s.waitForTimeout(400);
    await s.click('#p-explore .xp-item >> nth=0 >> [data-x="done"]');
    await clean(s, `student explorer ${scheme}`);
    await s.click('#p-explore [data-close]');
    await s.waitForSelector('#p-explore', { state: 'hidden' });
    await s.click('.shared-item.media');
    await s.waitForSelector('#p-media .mv-stage img.mv-img'); await s.waitForTimeout(500);
    await clean(s, `student picture viewer ${scheme}`);
    await s.click('#p-media .mv-hot');
    await s.waitForTimeout(200);
    await clean(s, `student hotspot revealed ${scheme}`);
  });
}
