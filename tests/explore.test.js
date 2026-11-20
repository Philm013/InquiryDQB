'use strict';
/**
 * Exploring: a zone shared with the class becomes a set every student works through on their own device (open, finish,
 * star, comment), with the teacher seeing progress per card and per student. Coloured zones go to their group only, the
 * set follows the board while it is shared, and vote / rank / discuss work on cards, pictures and videos too.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env, teacher, code, ids;
const T = (fn, arg) => teacher.evaluate(fn, arg);

before(async () => {
  env = await boot();
  teacher = await env.teacher('desktop');
  code = await T(() => Network.getCode());
  ids = await T(async () => {
    Actions.addLinkZone('Pond life', [
      { url: 'https://example.org/frog', title: 'Frog life cycle', desc: 'From spawn to frog in five stages.', kind: 'resource', source: 'TestSite' },
      { url: 'https://example.org/pond', title: 'Pond dipping guide', desc: 'How to sample a pond safely.', kind: 'resource', source: 'TestSite', thumb: '/icons/icon-192.png' },
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Tadpoles hatching', kind: 'resource', source: 'TestSite' }
    ]);
    const zone = State.items.find((i) => i.type === 'zone' && i.title === 'Pond life');
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 400; const c = cv.getContext('2d'); c.fillStyle = '#16a34a'; c.fillRect(0, 0, 600, 400);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const pic = await Actions.addImageFile(new File([blob], 'duckweed.png', { type: 'image/png' }), { x: zone.x + 40, y: zone.y + zone.h + 80 });
    HierarchyManager.link(pic.id, zone.id);
    const prompt = Actions.create('note', 'meta', { x: zone.x + 20, y: zone.y + 20 });
    StateManager.updateItem(prompt.id, { text: 'Start with the life cycle, then the video.' });
    HierarchyManager.link(prompt.id, zone.id);
    // a student's note in the zone is not part of what is explored
    const theirs = { id: 'stu1', type: 'note', sub: 'notice', text: 'A student note', author: 'Ana', sid: 'ANA0000000000001', x: zone.x + 30, y: zone.y + 60, w: 200, h: 150, votes: 0 };
    StateManager.addItem(theirs); HierarchyManager.link(theirs.id, zone.id);
    LayoutSystem.update(zone.id);
    return { zone: zone.id, pic: pic.id, frog: State.items.find((i) => i.title === 'Frog life cycle').id, pond: State.items.find((i) => i.title === 'Pond dipping guide').id, video: State.items.find((i) => i.title === 'Tadpoles hatching').id };
  });
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('a collection’s video resources become playable videos in the zone', async () => {
  const v = await T((id) => State.items.find((i) => i.id === id), ids.video);
  assert.equal(v.type, 'media'); assert.equal(v.kind, 'video'); assert.deepEqual(v.video, { p: 'youtube', id: 'dQw4w9WgXcQ', start: 0 });
});

test('a zone shared to explore reaches each student as a set: cards, pictures, videos and the teacher’s prompt', async () => {
  assert.equal(await T((id) => Network.setItems(State.items.find((i) => i.id === id)).length, ids.zone), 5, 'four things and the prompt, not the student’s note');
  await T((id) => Network.toggleShare(id), ids.zone);
  const maya = await env.student(code, 'Maya', 'phone');
  await maya.waitForSelector('.shared-item.set');
  assert.match(await maya.textContent('.shared-item.set'), /Pond life.*4 things to explore.*Not started yet/s);
  await maya.click('.shared-item.set');
  await maya.waitForSelector('#p-explore .xp-item');
  assert.equal(await maya.locator('#p-explore .xp-item').count(), 4);
  assert.equal(await maya.textContent('#p-explore .xp-prompt'), 'Start with the life cycle, then the video.');
  assert.ok(!(await maya.textContent('#p-explore')).includes('A student note'));
  const kinds = await maya.locator('#p-explore .xp-kind').allTextContents();
  assert.deepEqual(kinds.map((k) => k.replace(/^\d+ · /, '')), ['Resource', 'Resource', 'Video', 'Picture']);
  // only display fields travel in the list: no picture data, no annotations, no board positions
  const list = await T(() => JSON.parse(JSON.stringify(Network.sharedFor({ sid: 'x', color: null }))));
  const set = list.find((x) => x.type === 'set');
  assert.ok(set.items.every((i) => !('src' in i) && !('annos' in i) && !('x' in i)), JSON.stringify(set.items.map((i) => Object.keys(i))));
  await maya.context().close();
});

test('opening, finishing and starring: the teacher sees it per card and per student; the student keeps it after a reload', async () => {
  const ben = await env.student(code, 'Ben', 'phone');
  await ben.click('.shared-item.set');
  await ben.waitForSelector('#p-explore .xp-item');
  const item = (title) => ben.locator('#p-explore .xp-item', { hasText: title });
  // a link opens in a new tab: that counts as opened
  const [tab] = await Promise.all([ben.context().waitForEvent('page'), item('Frog life cycle').locator('[data-x="open"]').click()]);
  assert.equal(tab.url(), 'https://example.org/frog');
  await tab.close();
  await item('Frog life cycle').locator('[data-x="done"]').click();
  await item('Pond dipping guide').locator('[data-x="star"]').click();
  // the picture: looking at it counts as opened, and a comment from the set reaches the teacher
  await item('duckweed').locator('[data-x="look"]').click();
  await ben.waitForSelector('#p-media .mv-stage img.mv-img', { timeout: 15000 });
  await ben.fill('#p-media .mv-in', 'It floats on the surface');
  await ben.click('#p-media [data-mv="post"]');
  await ben.click('#p-media [data-close]');
  await ben.waitForSelector('#p-explore:not([hidden])');
  assert.match(await ben.textContent('#xp-sub'), /1 of 4 done/);
  await teacher.waitForFunction(({ z, frog, pond, pic }) => {
    const r = Object.values(State.explore[z] || {})[0] || {};
    return r[frog] && r[frog].d && r[frog].o && r[pond] && r[pond].s && r[pic] && r[pic].o;
  }, { z: ids.zone, frog: ids.frog, pond: ids.pond, pic: ids.pic }, { timeout: 15000 });
  await teacher.waitForFunction((id) => (State.items.find((i) => i.id === id).annos || []).some((a) => a.text === 'It floats on the surface' && a.by.n === 'Ben'), ids.pic);
  // on the board: the cards count it; the zone says it is being explored; the progress sheet has a row per student
  await teacher.waitForFunction((id) => { const el = document.getElementById(id); return el && el.querySelector('.card-stats [title="Students who finished it"]'); }, ids.frog);
  await teacher.waitForFunction((id) => /Exploring · 1 student/.test((document.querySelector('#' + CSS.escape(id) + ' .zone-share-tag') || {}).textContent || ''), ids.zone);
  await T((id) => Shell.ExploreProgress.open(id), ids.zone);
  await teacher.waitForSelector('.xp-table');
  const row = await teacher.locator('.xp-table tbody tr', { hasText: 'Ben' }).textContent();
  assert.match(row, /Done.*1\/4/s);
  await T(() => DQBUI.Overlay.closeAll());
  // a reload on the same device: progress is still there (and it is the same student)
  await ben.reload();
  await ben.waitForFunction(() => document.getElementById('conn-text') && document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 25000 });
  await ben.waitForSelector('.shared-item.set');
  assert.match(await ben.textContent('.shared-item.set'), /1 of 4 done/);
  await ben.click('.shared-item.set');
  await ben.waitForSelector('#p-explore .xp-item.done');
  assert.equal(await ben.getAttribute('#p-explore .xp-item:has-text("Pond dipping guide") [data-x="star"]', 'aria-pressed'), 'true');
  await ben.context().close();
});

test('a coloured zone goes only to its group, and finishing everything is celebrated', async () => {
  await T((id) => StateManager.updateItem(id, { color: '#ef4444' }), ids.zone);
  const red = await env.student(code, 'Rosa', 'phone');
  const blue = await env.student(code, 'Bea', 'phone');
  const sid = async (name) => T((n) => Object.entries(State.students).find(([, s]) => s.name === n)[0], name);
  await T(({ r, b }) => { Network.setStudentColor(r, '#ef4444'); Network.setStudentColor(b, '#3b82f6'); Network.pushShared(); }, { r: await sid('Rosa'), b: await sid('Bea') });
  await red.waitForSelector('.shared-item.set');
  assert.match(await red.textContent('.shared-item.set'), /Red group/);
  await blue.waitForTimeout(800);
  assert.equal(await blue.locator('.shared-item.set').count(), 0, 'another group does not get it');
  // finishing every item
  await red.click('.shared-item.set');
  await red.waitForSelector('#p-explore .xp-item');
  for (const b of await red.locator('#p-explore [data-x="done"]').all()) await b.click();
  await red.waitForFunction(() => /You explored everything/.test(document.body.textContent));
  await T((id) => StateManager.updateItem(id, { color: null }), ids.zone);
  await red.context().close(); await blue.context().close();
});

test('the set follows the board while it is shared, and withdrawing it closes the explorer', async () => {
  const leo = await env.student(code, 'Leo', 'phone');
  await leo.click('.shared-item.set');
  await leo.waitForSelector('#p-explore .xp-item');
  const n = await leo.locator('#p-explore .xp-item').count();
  await T((z) => { const it = Actions.addLink({ url: 'https://example.org/heron', title: 'Herons hunting', kind: 'resource' }); HierarchyManager.link(it.id, z); LayoutSystem.update(z); }, ids.zone);
  await leo.waitForFunction((k) => document.querySelectorAll('#p-explore .xp-item').length === k + 1, n, { timeout: 10000 });
  await T((id) => StateManager.updateItem(id, { title: 'Frog life cycle (updated)' }), ids.frog);
  await leo.waitForSelector('#p-explore .xp-item:has-text("Frog life cycle (updated)")');
  await T((z) => Network.toggleShare(z), ids.zone);
  await leo.waitForFunction(() => document.getElementById('p-explore').hidden, null, { timeout: 10000 });
  await leo.waitForFunction(() => !document.querySelector('.shared-item.set'));
  await leo.context().close();
});

test('vote and rank work on resource cards, pictures and videos', async () => {
  const kim = await env.student(code, 'Kim', 'phone');
  await T((z) => { StateManager.setSelection([z]); Network.startActivity('vote'); }, ids.zone);
  await kim.waitForSelector('[data-act="pick-vote"]');
  const choices = await kim.locator('[data-act="pick-vote"]').allTextContents();
  assert.ok(choices.some((c) => /Pond dipping guide/.test(c)) && choices.some((c) => /Tadpoles hatching/.test(c)) && choices.some((c) => /duckweed/.test(c)), choices.join(' | '));
  assert.ok(choices.some((c) => /Start with the life cycle/.test(c)), 'the teacher’s note in the zone is a choice like any note');
  await kim.click('[data-act="pick-vote"]:has-text("Tadpoles hatching")');
  await kim.click('[data-act="send-vote"]');
  await teacher.waitForFunction(() => /Tadpoles hatching/.test(document.querySelector('.zone-res-box.active, #act-results') ? (document.querySelector('.zone-res-box.active') || document.querySelector('#act-results')).textContent : ''), null, { timeout: 15000 });
  await T(() => Network.stopActivity());
  await kim.context().close();
});
