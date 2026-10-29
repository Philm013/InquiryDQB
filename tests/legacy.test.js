'use strict';
/**
 * Returning users: boards and notes saved by earlier versions live in the same IndexedDB databases
 * (DQB_Ultimate, DQB_Student). They must still open, and anything hostile inside them must stay inert.
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

const put = (page, db, store, record) => page.evaluate(([name, st, rec]) => new Promise((resolve, reject) => {
  const open = indexedDB.open(name, 2);
  open.onupgradeneeded = () => { const d = open.result; if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' }); if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id' }); if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' }); if (!d.objectStoreNames.contains('profile')) d.createObjectStore('profile', { keyPath: 'key' }); };
  open.onsuccess = () => { const tx = open.result.transaction(st, 'readwrite'); tx.objectStore(st).put(rec); tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); };
  open.onerror = () => reject(open.error);
}), [db, store, record]);

test('a board saved by an older version opens, with hostile text left inert', async () => {
  const p = await env.open('desktop', '/Teacher/');
  await p.waitForSelector('#btn-new-board');
  await put(p, 'DQB_Ultimate', 'boards', {
    id: 'legacy1', name: '<img src=x onerror=window.__pwned=1>Old board', ts: Date.now() - 86400000, view: { x: 0, y: 0, z: 1 },
    ink: [{ id: 's1', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], color: 'red', width: 4 }],
    items: [
      { id: 'n1', type: 'note', sub: 'idea', text: '<b onmouseover=window.__pwned=1>old</b> note', author: '<script>window.__pwned=1</script>', x: 10, y: 10, w: 200, h: 150, votes: 0 },
      { id: 'z1', type: 'zone', title: '<svg onload=window.__pwned=1>', x: 300, y: 10, w: 300, h: 300, children: ['n2'] },
      { id: 'n2', type: 'note', sub: 'wonder', text: 'inside the zone', x: 320, y: 60, w: 200, h: 150, parentZone: 'z1' },
      { id: 'bad id\'"><x', type: 'note', sub: 'idea', text: 'odd id', x: 0, y: 0, w: 100, h: 100 },
      { id: 'p1', type: 'poll', q: '<i>question</i>', opts: [{ lbl: '<u>a</u>', v: 1 }, { lbl: 'b', v: 'oops' }], x: 700, y: 10, w: 260, h: 170 }
    ]
  });
  await p.reload();
  await p.waitForSelector('#saved-list .board-card');
  assert.match(await p.textContent('#saved-list .board-card .bn'), /<img src=x onerror=window\.__pwned=1>Old board/, 'the name is shown as text');
  assert.equal(await p.locator('#saved-list img[src="x"]').count(), 0);

  await p.locator('#saved-list .board-card [data-open]').first().click();
  await p.waitForFunction(() => window.State && State.items.some((i) => i.id === 'n1'));
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => State.items.some((i) => /bad id/.test(i.id))), false, 'items with unusable ids are dropped');
  assert.equal(await p.evaluate(() => window.__pwned), undefined, 'nothing executed');
  assert.equal(await p.locator('.item svg[onload], .item b[onmouseover], .item script').count(), 0);
  assert.equal(await p.evaluate(() => document.getElementById('n2').getBoundingClientRect().width > 0), true, 'old notes render');
  assert.match(await p.evaluate(() => document.querySelector('[id="n1"] textarea').value), /<b onmouseover/, 'text stays text');
});

test('notes and profile saved by the old student app still show up', async () => {
  const teacher = await env.teacher('desktop');
  await teacher.evaluate(() => { State.id = 'legacyBoard'; });
  const code = await teacher.evaluate(() => Network.getCode());
  const s = await env.open('phone', '/Student/?join=' + code);
  await s.waitForSelector('body[data-ready="1"]');
  await put(s, 'DQB_Student', 'profile', { key: 'me', val: { name: 'Returning Ray', av: '🦖' } });
  await put(s, 'DQB_Student', 'notes', { id: 'old1', sub: 'wonder', text: 'Old note <img src=x onerror=window.__pwned=1>', ts: Date.now() - 1000, boardId: 'legacyBoard' });
  await put(s, 'DQB_Student', 'notes', { id: 'old2', sub: 'sketch', text: 'Sketch', src: 'javascript:alert(1)', ts: Date.now() - 2000, boardId: 'legacyBoard' });
  await s.goto(env.origin + '/Student/?join=' + code);                              // reload with the data in place
  await s.waitForSelector('body[data-ready="1"]');
  await s.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 25000 });
  assert.equal(await s.textContent('#me-name'), 'Returning Ray', 'the saved name is used, no onboarding');
  await s.click('#tab-notes');
  await s.waitForFunction(() => document.querySelectorAll('#notes-list .note-card').length === 2);
  assert.match(await s.textContent('#notes-list'), /Old note <img src=x onerror=window\.__pwned=1>/);
  assert.equal(await s.locator('#notes-list img[src^="javascript"]').count(), 0, 'a bad image source is never used');
  assert.equal(await s.evaluate(() => window.__pwned), undefined);
});
