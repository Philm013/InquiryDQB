'use strict';
/**
 * Host integration (window.DQB_HOST): what a site that embeds InquiryDQB can plug in.
 * A fake host is installed before the app loads; everything runs over real WebRTC with the local PeerServer.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env, teacher, code;
const T = (fn, arg) => teacher.evaluate(fn, arg);
const SID_ANA = 'tt-anaAccount0000001';

/** Installed in the teacher's page before any app script runs. */
function teacherHost(arg) {
  const store = arg.seed || {};
  window.__store = store; window.__events = [];
  ['hosting', 'board', 'contribution', 'join', 'share', 'leave', 'rename'].forEach((n) => window.addEventListener('dqb:' + n, (e) => window.__events.push([n, e.detail])));
  const copy = (x) => JSON.parse(JSON.stringify(x));
  window.DQB_HOST = {
    ns: 'acct42',
    brand: { name: 'TestSite', sub: 'Inquiry boards · TestSite', homeUrl: '/', homeLabel: 'Back to TestSite' },
    verifiedLabel: 'Signed in with TestSite',
    storage: {
      label: 'your TestSite account',
      list: async () => Object.values(store).map((b) => ({ id: b.id, name: b.name, ts: b.ts, notes: b.items.filter((i) => i.type === 'note').length, preview: b.items.map((i) => ({ type: i.type, x: i.x, y: i.y, w: i.w, h: i.h })) })),
      load: async (id) => (store[id] ? copy(store[id]) : null),
      save: async (b) => { store[b.id] = copy(b); window.__saves = (window.__saves || 0) + 1; return { ts: b.ts }; },
      remove: async (id) => { delete store[id]; },
      rename: async (id, name) => { if (store[id]) store[id].name = name; }
    },
    library: {
      name: 'TestSite', title: 'Add from TestSite',
      search: async (q, kind) => (kind === 'collection'
        ? [{ id: 7, kind: 'collection', title: 'Pond life', desc: 'Three tools', url: 'https://example.org/collection/7', meta: '3 resources' }]
        : [
          { id: 11, kind: 'resource', title: 'Water cycle simulator', desc: 'Move the sun and watch evaporation.', url: 'https://example.org/sim', thumb: '/icons/icon-192.png', meta: 'Interactive' },
          { id: 12, kind: 'resource', title: 'Bad link', url: 'javascript:alert(1)' },
          { id: 14, kind: 'resource', title: 'Tadpoles hatching', desc: 'Time-lapse.', url: 'https://youtu.be/dQw4w9WgXcQ?t=42', meta: 'Video' }
        ].filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()))),
      items: async () => [
        { id: 21, title: 'Frog life cycle', url: 'https://example.org/frog' },
        { id: 22, title: 'Pond dipping guide', url: 'https://example.org/pond', thumb: '/icons/icon-192.png' },
        { id: 23, title: 'Duckweed video', url: 'https://example.org/duckweed' }
      ]
    },
    roster: {
      lookup: (sid) => (arg.roster || {})[sid] || null,
      admit: (sid, known) => !window.__onlyMine || !!known,
      refusal: 'Only students in my class can join this board.'
    },
    share: { title: 'Send to your class', label: 'Send', status: () => 'Not sent yet', open: (info) => { window.__shareOpened = info; } },
    rules: [{ title: 'Only my students can join', sub: 'Guests are turned away', get: () => !!window.__onlyMine, set: (v) => { window.__onlyMine = v; } }],
    groupActions: [{ label: 'Use class groups', hint: 'Colours follow the groups in your class list.', run: () => { window.__groupsRun = true; } }]
  };
}
/** Installed in a student's page: a signed-in account. */
function studentHost(arg) {
  window.DQB_HOST = { identity: { sid: arg.sid, name: arg.name }, identityHint: 'This is the name on your TestSite account.', live: async () => arg.live || [] };
}

async function open(device, urlPath, init, arg) {
  const c = await env.context(device);
  if (init) await c.addInitScript(init, arg);
  const page = await c.newPage();
  page.on('pageerror', (e) => env.pageErrors.push(`${urlPath}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) env.pageErrors.push(`${urlPath} console: ${m.text()}`); });
  await page.goto(env.origin + urlPath);
  return page;
}
async function guest(name, device = 'phone') {
  const p = await env.open(device, '/Student/?join=' + code);
  await p.waitForSelector('body[data-ready="1"]');
  await p.fill('#inp-name', name);
  await p.click('#btn-setup');
  return p;
}
const connected = (p) => p.waitForFunction(() => document.getElementById('conn-text').textContent === 'Connected', null, { timeout: 25000 });

before(async () => {
  env = await boot();
  teacher = await open('desktop', '/Teacher/', teacherHost, { roster: { [SID_ANA]: { name: 'Ana B.', verified: true, color: '#3b82f6', info: '5A' } } });
  await teacher.waitForSelector('.host-home');
  await teacher.click('#btn-new-board');
  await teacher.waitForFunction(() => window.Network && Network.status === 'ready', null, { timeout: 20000 });
  code = await T(() => Network.getCode());
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('the host brand, local namespace and events are in place', async () => {
  assert.equal(await T(() => DB.name()), 'DQB_Ultimate_acct42');
  assert.equal(await T(() => Board.lastKey()), 'lastBoard:acct42');
  const ev = await T(() => window.__events.map((e) => e[0]));
  assert.ok(ev.includes('board') && ev.includes('hosting'), 'board and hosting events reach the host');
  assert.equal(await T(() => window.__events.find((e) => e[0] === 'hosting')[1].code), code);
});

test('boards are saved to the host account and open from it on another device', async () => {
  await T(() => { const it = Actions.create('note', 'idea'); StateManager.updateItem(it.id, { text: 'Saved to the account' }); });
  await teacher.waitForFunction(() => Object.values(window.__store).some((b) => b.items.some((i) => i.text === 'Saved to the account')), null, { timeout: 15000 });
  await teacher.waitForFunction(() => document.querySelector('#save-status').textContent.trim() === 'Saved');
  assert.match(await teacher.getAttribute('#save-status', 'title'), /TestSite account/);
  // nothing changed: the 30-second safety net must not upload again
  const saves = await T(() => window.__saves);
  await T(() => Board.save(true, true));
  await teacher.waitForTimeout(3200);
  assert.equal(await T(() => window.__saves), saves, 'an unchanged board is not uploaded again');

  // a second device: empty browser storage, same account
  const seed = await T(() => window.__store);
  const other = await open('desktop', '/Teacher/', teacherHost, { seed });
  await other.waitForSelector('.board-card');
  assert.doesNotMatch(await other.textContent('#saved-list'), /this device only/);
  await other.click('.board-card [data-open]');
  await other.waitForFunction(() => State.items.some((i) => i.text === 'Saved to the account'), null, { timeout: 15000 });
  await other.context().close();
});

test('the library adds resource cards, pictures and whole collections; unsafe links never become cards', async () => {
  await T(() => Shell.Library.open());
  await teacher.waitForSelector('.lib-row');
  assert.equal(await teacher.locator('.lib-row').count(), 2, 'the javascript: result is filtered out');
  assert.equal(await teacher.locator('.lib-row [data-lib="video"]').count(), 1, 'only the video resource offers “Video”');
  await teacher.click('.lib-row [data-lib="card"]');
  await teacher.waitForFunction(() => State.items.some((i) => i.type === 'link' && i.title === 'Water cycle simulator'));
  const card = await T(() => State.items.find((i) => i.type === 'link'));
  assert.equal(card.url, 'https://example.org/sim');
  assert.equal(card.thumb, '/icons/icon-192.png');
  assert.equal(card.kind, 'resource');
  assert.equal(card.ref, '11');
  await teacher.waitForFunction((id) => { const el = document.getElementById(id); return el && el.querySelector('.lc-title').textContent === 'Water cycle simulator' && !el.querySelector('.lc-thumb').hidden; }, card.id);

  // "Picture" adds a picture students can annotate (re-encoded into the board), "Video" a playable video
  await teacher.click('.lib-row [data-lib="image"]');
  await teacher.waitForFunction(() => State.items.some((i) => i.type === 'media' && i.kind === 'image' && /^data:image\/jpeg;base64,/.test(i.src || '') && i.title === 'Water cycle simulator' && i.ref === '11'));
  await teacher.click('.lib-row [data-lib="video"]');
  await teacher.waitForFunction(() => State.items.some((i) => i.type === 'media' && i.kind === 'video' && i.video.p === 'youtube' && i.video.id === 'dQw4w9WgXcQ' && i.video.start === 42 && i.ref === '14'));

  await teacher.click('[data-lk="collection"]');
  await teacher.waitForSelector('.lib-row [data-lib="all"]');
  await teacher.click('.lib-row [data-lib="all"]');
  await teacher.waitForFunction(() => { const z = State.items.find((i) => i.type === 'zone' && i.title === 'Pond life'); return z && z.children.length === 3; });
  await T(() => DQBUI.Overlay.closeAll());

  const unsafe = await T(() => [
    Sanitize.item({ id: 'x1', type: 'link', url: 'javascript:alert(1)', title: 'x' }),
    Sanitize.item({ id: 'x2', type: 'link', url: 'https://ok.example/', thumb: '//evil.example/a.png', title: '<img src=x onerror=alert(1)>' })
  ]);
  assert.equal(unsafe[0], null);
  assert.equal(unsafe[1].thumb, undefined, 'a picture from another site is dropped');
  const x2 = await T(() => { const it = Actions.addLink({ url: 'https://ok.example/', title: '<img src=x onerror=alert(1)>' }); return document.getElementById(it.id).querySelector('.lc-title').innerHTML; });
  assert.match(x2, /&lt;img/, 'card titles are text, never markup');
});

test('Insert > Link asks for an address and a title', async () => {
  await teacher.click('#rail-add');
  await teacher.click('#insert-content [data-add="link"]');
  await teacher.fill('#dlg-in', 'not a link');
  await teacher.click('.dlg-actions .btn-primary');
  await teacher.waitForFunction(() => /isn’t a full web address/.test(document.body.textContent));
  await teacher.click('#rail-add');
  await teacher.click('#insert-content [data-add="link"]');
  await teacher.fill('#dlg-in', 'https://example.org/article');
  await teacher.click('.dlg-actions .btn-primary');
  await teacher.waitForFunction(() => document.querySelectorAll('#dlg-in').length === 1 && document.querySelector('#dlg-in').value === 'example.org');
  await teacher.fill('#dlg-in', 'Reading for today');
  await teacher.click('.dlg-actions .btn-primary');
  await teacher.waitForFunction(() => State.items.some((i) => i.type === 'link' && i.title === 'Reading for today' && i.kind === 'link'));
});

test('signed-in students: the host names them, marks them on the roster and places them in their group', async () => {
  const ana = await open('phone', '/Student/?join=' + code, studentHost, { sid: SID_ANA, name: 'Ana Account' });
  await ana.waitForSelector('body[data-ready="1"]');
  assert.equal(await ana.inputValue('#inp-name'), 'Ana Account');
  assert.equal(await ana.getAttribute('#inp-name', 'readonly'), '');
  await ana.click('#av-grid .av:nth-child(5)');
  await ana.click('#btn-setup');
  await connected(ana);
  await teacher.waitForFunction((sid) => Object.values(State.students).some((s) => s.sid === sid && s.verified), SID_ANA);
  const st = await T((sid) => Object.values(State.students).find((s) => s.sid === sid), SID_ANA);
  assert.equal(st.name, 'Ana B.');
  assert.equal(st.color, '#3b82f6');
  await T(() => Shell.Panel.renderRoster());
  assert.equal(await teacher.locator('#roster .vmark').count(), 1);

  // her note is reported to the host as a contribution from a signed-in student
  await T(() => Network.transitionTo('OPEN'));
  await ana.click('.type-tile.t-idea');
  await ana.fill('#w-txt', 'Ana writes from her account');
  await ana.click('#w-send');
  await teacher.waitForFunction((sid) => window.__events.some((e) => e[0] === 'contribution' && e[1].sid === sid && e[1].kind === 'note' && e[1].verified), SID_ANA);

  // the name is fixed in the profile, the avatar is remembered for the account only
  assert.equal(await ana.evaluate((sid) => localStorage.getItem('dqb_av:' + sid), SID_ANA), '🚀');
  assert.equal(await ana.evaluate(() => localStorage.getItem('dqb_profile')), null, 'the account name is never stored for the next guest on this device');
  await ana.context().close();
});

test('the host can keep a board to its own students', async () => {
  await T(() => Shell.Panel.open('students'));
  await teacher.click('#rule-host-0');
  assert.equal(await T(() => window.__onlyMine), true);
  const stranger = await guest('Stranger');
  await stranger.waitForSelector('#v-ended:not([hidden])', { timeout: 25000 });
  assert.match(await stranger.textContent('#v-ended'), /Only students in my class can join this board/);
  await teacher.click('#rule-host-0');
  assert.equal(await T(() => window.__onlyMine), false);
  await stranger.context().close();
});

test('shared links reach every student, late joiners included, and can be withdrawn', async () => {
  const leo = await guest('Leo');
  await connected(leo);
  const id = await T(() => State.items.find((i) => i.type === 'link' && i.title === 'Water cycle simulator').id);
  await T((x) => Network.toggleShare(x), id);
  await leo.waitForSelector('.shared-item');
  assert.equal(await leo.getAttribute('.shared-item', 'href'), 'https://example.org/sim');
  assert.equal(await leo.getAttribute('.shared-item', 'target'), '_blank');
  assert.match(await leo.getAttribute('.shared-item', 'rel'), /noopener/);
  assert.equal(await leo.getAttribute('.shared-item img', 'src'), '/icons/icon-192.png');
  assert.equal(await T((x) => document.getElementById(x).classList.contains('is-shared'), id), true);
  assert.ok(await T(() => window.__events.some((e) => e[0] === 'share' && e[1].ref === '11')));

  const late = await guest('Mia');
  await connected(late);
  await late.waitForSelector('.shared-item');

  // a hostile message cannot put a script link on a student's device
  await T(() => Network.broadcast({ type: 'SHARED', items: [{ id: 'evil', title: 'Click me', url: 'javascript:alert(1)' }, { id: 'ok', title: 'Fine', url: 'https://example.org/fine', thumb: 'https://evil.example/p.png' }] }));
  await leo.waitForFunction(() => document.querySelectorAll('.shared-item').length === 1 && /Fine/.test(document.querySelector('.shared-item').textContent));
  assert.equal(await leo.locator('.shared-item img').count(), 0, 'a picture from another site is not shown');

  await T((x) => { Network.toggleShare(x); Network.toggleShare(x); }, id);   // back to the real list (shared again)
  await leo.waitForFunction(() => /Water cycle simulator/.test((document.querySelector('.shared-item') || {}).textContent || ''));   // an empty list comes first
  await T((x) => Network.toggleShare(x), id);
  await leo.waitForFunction(() => !document.querySelector('.shared-item'));
  // deleting a shared card withdraws it too
  await T((x) => Network.toggleShare(x), id);
  await late.waitForSelector('.shared-item');
  await T((x) => Actions.delete(x), id);
  await late.waitForFunction(() => !document.querySelector('.shared-item'));
  await leo.context().close(); await late.context().close();
});

test('share sheet, groups sheet and the join screen show what the host adds', async () => {
  await T(() => Shell.Share.open());
  await teacher.waitForSelector('[data-host-share]');
  await teacher.click('[data-host-share]');
  assert.equal(await T(() => window.__shareOpened.code), code);
  await T(() => DQBUI.Overlay.closeAll());
  await T(() => Shell.Groups.open());
  await teacher.click('[data-host-group="0"]');
  assert.equal(await T(() => window.__groupsRun), true);
  await T(() => DQBUI.Overlay.closeAll());

  // a signed-in student without a code sees the live board and joins with one tap
  const sid = 'tt-liveStudent0000002';
  const ben = await open('phone', '/Student/', (a) => { localStorage.setItem('dqb_av:' + a.sid, '🦊'); window.DQB_HOST = { identity: { sid: a.sid, name: 'Ben' }, live: async () => [{ code: a.code, title: 'Pond study', teacher: 'Ms K' }] }; }, { sid, code });
  await ben.waitForSelector('.live-item');
  assert.match(await ben.textContent('.live-item'), /Pond study[\s\S]*Ms K/);
  await ben.click('.live-item');
  await connected(ben);
  await ben.context().close();
});
