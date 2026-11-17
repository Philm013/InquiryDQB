'use strict';
/**
 * Pictures and videos on a board (`type: 'media'`) and annotations on them: comments pinned to a place or a moment,
 * callouts, hotspots and markup, in the viewer (shared/media.js) on the console and in the student app, over real WebRTC.
 * YouTube and Vimeo are never contacted: their players are stand-ins served by Playwright that speak the same postMessage
 * protocols, so the tests also prove nothing is requested from them until someone presses play.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./harness');

let env, teacher, rogue, code, imgId, vidId, ytId, vmId;
const T = (fn, arg) => teacher.evaluate(fn, arg);
const annos = (id) => T((x) => (State.items.find((i) => i.id === x).annos || []), id);
const send = (msg) => rogue.evaluate((m) => window.__rogue.conn.send(JSON.stringify(m)), msg);
const received = () => rogue.evaluate(() => window.__rogue.log.slice());
const thirdParty = [];

const FAKE_YT = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;color:#fff;font:14px sans-serif">fake YouTube<script>
const q = new URLSearchParams(location.search);
let t = +(q.get('start') || 0), playing = q.get('autoplay') === '1', last = performance.now();
const tick = () => { const n = performance.now(); if (playing) t += (n - last) / 1000; last = n; };
const send = () => { tick(); parent.postMessage(JSON.stringify({ event: 'infoDelivery', info: { currentTime: t, duration: 120, playerState: playing ? 1 : 2 } }), '*'); };
addEventListener('message', (e) => { let d; try { d = JSON.parse(e.data); } catch (x) { return; }
  if (d.event === 'listening') { parent.postMessage(JSON.stringify({ event: 'onReady', info: null }), '*'); send(); }
  if (d.event === 'command') { tick(); if (d.func === 'seekTo') t = d.args[0]; if (d.func === 'playVideo') playing = true; if (d.func === 'pauseVideo') playing = false; send(); }
});
setInterval(() => { if (playing) send(); }, 250);
</script>`;
const FAKE_VIMEO = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#123;color:#fff;font:14px sans-serif">fake Vimeo<script>
const q = new URLSearchParams(location.search);
let t = +((location.hash.match(/t=(\\d+)/) || [])[1] || 0), playing = q.get('autoplay') === '1', last = performance.now();
const tick = () => { const n = performance.now(); if (playing) t += (n - last) / 1000; last = n; };
const post = (o) => parent.postMessage(JSON.stringify(o), '*');
addEventListener('message', (e) => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } tick();
  if (d.method === 'getDuration') post({ method: 'getDuration', value: 90 });
  if (d.method === 'setCurrentTime') { t = d.value; post({ event: 'seeked', data: { seconds: t, duration: 90 } }); }
  if (d.method === 'play') { playing = true; post({ event: 'play', data: { seconds: t, duration: 90 } }); }
  if (d.method === 'pause') { playing = false; post({ event: 'pause', data: { seconds: t, duration: 90 } }); }
});
post({ event: 'ready' });
setInterval(() => { if (playing) { tick(); post({ event: 'timeupdate', data: { seconds: t, duration: 90 } }); } }, 250);
</script>`;

async function fakePlayers(page) {
  const c = page.context();
  c.on('request', (r) => { if (!r.url().startsWith(env.origin) && /^https?:/.test(r.url())) thirdParty.push(r.url()); });
  await c.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_YT }));
  await c.route('https://player.vimeo.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_VIMEO }));
}
/** A picture drawn in the page, added the way Insert › Picture adds one. */
const addPicture = (page, name) => page.evaluate(async (n) => {
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800; const c = cv.getContext('2d');
  c.fillStyle = '#38bdf8'; c.fillRect(0, 0, 1200, 800); c.fillStyle = '#166534'; c.fillRect(0, 560, 1200, 240); c.fillStyle = '#fde047'; c.beginPath(); c.arc(980, 180, 100, 0, 7); c.fill();
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  return (await Actions.addImageFile(new File([blob], n + '.png', { type: 'image/png' }))).id;
}, name);
const stageBox = (page, scope) => page.locator((scope || '') + ' .mv-stage').boundingBox();

before(async () => {
  env = await boot();
  teacher = await env.teacher('desktop');
  await fakePlayers(teacher);
  code = await T(() => Network.getCode());
  imgId = await addPicture(teacher, 'pond-survey');
  [vidId, ytId, vmId] = await T(() => [
    Actions.addMedia({ kind: 'video', title: 'Pond clip', video: { p: 'file', url: '/tests/fixtures/clip.webm' } }, { x: 900, y: 0 }).id,
    Actions.addMedia({ kind: 'video', title: 'Frogs (YouTube)', video: DQBMedia.parseVideo('https://youtu.be/dQw4w9WgXcQ?t=42') }, { x: 0, y: 600 }).id,
    Actions.addMedia({ kind: 'video', title: 'Herons (Vimeo)', video: DQBMedia.parseVideo('https://vimeo.com/76979871') }, { x: 900, y: 600 }).id
  ]);
});
after(async () => {
  assert.deepEqual(env.pageErrors, [], 'no uncaught page errors during the run');
  await env.close();
});

test('video addresses: YouTube, Vimeo and video files are recognised, anything else is not', async () => {
  const r = await T(() => {
    const P = DQBMedia.parseVideo;
    return {
      yt: [P('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), P('https://youtu.be/dQw4w9WgXcQ?t=42'), P('https://youtube.com/shorts/dQw4w9WgXcQ'), P('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=7')],
      vm: [P('https://vimeo.com/76979871'), P('https://vimeo.com/76979871/abcdef1234'), P('https://player.vimeo.com/video/76979871?h=abcdef1234#t=65s'), P('https://vimeo.com/channels/staffpicks/76979871')],
      files: [P('https://cdn.example.org/clips/frog.mp4?x=1'), P('/media/frog.webm')],
      bad: [P('javascript:alert(1)'), P('http://evil.example/a.mp4'), P('https://www.youtube.com/watch?v=short'), P('data:video/mp4;base64,AAAA'), P('https://example.org/page'), P('https://vimeo.com/channels/staffpicks'), P('https://x.example/' + 'a'.repeat(3000) + '.mp4')],
      embed: DQBMedia.embedUrl(P('https://youtu.be/dQw4w9WgXcQ?t=42')),
      vembed: DQBMedia.embedUrl(P('https://vimeo.com/76979871/abcdef1234')),
      clean: [DQBMedia.cleanVideo({ p: 'youtube', id: '"><script>' }), DQBMedia.cleanVideo({ p: 'file', url: 'javascript:alert(1)' }), DQBMedia.cleanVideo({ p: 'vimeo', id: '123456', h: 'zz' }), DQBMedia.cleanVideo({ p: 'evil', id: 'x' })]
    };
  });
  assert.deepEqual(r.yt, [{ p: 'youtube', id: 'dQw4w9WgXcQ', start: 90 }, { p: 'youtube', id: 'dQw4w9WgXcQ', start: 42 }, { p: 'youtube', id: 'dQw4w9WgXcQ', start: 0 }, { p: 'youtube', id: 'dQw4w9WgXcQ', start: 7 }]);
  assert.deepEqual(r.vm, [{ p: 'vimeo', id: '76979871', start: 0 }, { p: 'vimeo', id: '76979871', h: 'abcdef1234', start: 0 }, { p: 'vimeo', id: '76979871', h: 'abcdef1234', start: 65 }, { p: 'vimeo', id: '76979871', start: 0 }]);
  assert.deepEqual(r.files, [{ p: 'file', url: 'https://cdn.example.org/clips/frog.mp4?x=1', start: 0 }, { p: 'file', url: '/media/frog.webm', start: 0 }]);
  assert.ok(r.bad.every((x) => x === null), 'nothing else is a video: ' + JSON.stringify(r.bad));
  assert.match(r.embed, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?enablejsapi=1&.*&start=42$/, 'YouTube without its tracking cookies');
  assert.match(r.vembed, /^https:\/\/player\.vimeo\.com\/video\/76979871\?dnt=1&.*&h=abcdef1234$/, 'Vimeo with do-not-track');
  assert.deepEqual(r.clean, [null, null, { p: 'vimeo', id: '123456', start: 0 }, null]);
});

test('a picture or video item keeps only safe data, and its annotations are re-checked', async () => {
  const r = await T(() => ({
    svg: Sanitize.item({ id: 'm1', type: 'media', kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=' }),
    remote: Sanitize.item({ id: 'm2', type: 'media', kind: 'image', src: 'https://evil.example/a.png' }),
    novideo: Sanitize.item({ id: 'm3', type: 'media', kind: 'video', video: { p: 'youtube', id: 'nope' } }),
    vid: Sanitize.item({ id: 'm4', type: 'media', kind: 'video', video: { p: 'youtube', id: 'dQw4w9WgXcQ' }, title: '<b>t</b>', thumb: 'https://evil.example/t.png', annos: [
      { id: 'a1', k: 'comment', text: '<img src=x onerror=alert(1)>', x: 5, y: -1, t: 12, by: { n: '<b>Eve</b>', r: 's', sid: 'tt-x' } },
      { id: 'a2', k: 'ink', pts: [[0, 0]], c: 'red' },
      { id: 'a3', k: 'hotspot', text: 'no place to sit' },
      { id: 'a4', k: 'script', text: 'x' },
      { id: 'a5', k: 'comment', text: 'a reply to nothing', re: 'nope' },
      { id: 'a6', k: 'ink', pts: [[0.1, 0.1], [2, 0.5]], c: 'javascript:alert(1)', w: 9, tool: 'bomb' }
    ] })
  }));
  assert.equal(r.svg, null, 'SVG pictures are refused');
  assert.equal(r.remote, null, 'pictures from another site are refused');
  assert.equal(r.novideo, null, 'a video with no valid source is dropped');
  assert.equal(r.vid.thumb, undefined, 'a cover picture from another site is dropped');
  assert.deepEqual(r.vid.annos.map((a) => a.id), ['a1', 'a5', 'a6']);
  const [a1, a5, a6] = r.vid.annos;
  assert.equal(a1.text, '<img src=x onerror=alert(1)>', 'text is kept as text');
  assert.deepEqual([a1.x, a1.y, a1.t, a1.by.n], [1, 0, 12, 'bEve/b']);
  assert.equal(a5.re, undefined, 'a reply to a missing comment becomes a comment');
  assert.deepEqual([a6.pts[1][0], a6.c, a6.w, a6.tool], [1, '#ef4444', 0.06, 'pen']);
});

test('the teacher annotates a picture in the viewer: a pinned comment, a drawing, a callout and a hotspot', async () => {
  await T((id) => Actions.openMedia(id), imgId);
  await teacher.waitForSelector('.mv-stage img.mv-img');
  const st = await stageBox(teacher);
  await teacher.click('.mv-tool[data-tool="pin"]');
  await teacher.mouse.click(st.x + st.width * 0.3, st.y + st.height * 0.6);
  await teacher.fill('.mv-in', 'Is this algae or <b>duckweed</b>?');
  await teacher.click('[data-mv="post"]');
  await teacher.click('.mv-tool[data-tool="arrow"]');
  await teacher.mouse.move(st.x + st.width * 0.5, st.y + st.height * 0.5); await teacher.mouse.down();
  await teacher.mouse.move(st.x + st.width * 0.7, st.y + st.height * 0.3, { steps: 6 }); await teacher.mouse.up();
  await teacher.click('.mv-tool[data-tool="callout"]');
  await teacher.mouse.click(st.x + st.width * 0.75, st.y + st.height * 0.2);
  await teacher.fill('.mv-pop textarea', 'The sun: <img src=x onerror=window.__pwned=1>');
  await teacher.click('.mv-pop [data-pl="add"]');
  await teacher.click('.mv-tool[data-tool="hotspot"]');
  await teacher.mouse.click(st.x + st.width * 0.15, st.y + st.height * 0.85);
  await teacher.fill('.mv-pop textarea', 'Reeds: home for dragonfly nymphs');
  await teacher.click('.mv-pop [data-pl="add"]');
  const list = await annos(imgId);
  assert.deepEqual(list.map((a) => a.k), ['comment', 'ink', 'callout', 'hotspot']);
  const [pin, ink] = list;
  assert.ok(Math.abs(pin.x - 0.3) < 0.02 && Math.abs(pin.y - 0.6) < 0.02, 'the pin sits where it was placed');
  assert.equal(pin.by.r, 't');
  assert.equal(ink.tool, 'arrow'); assert.equal(ink.pts.length, 2);
  assert.equal(await teacher.locator('.mv-marks .mv-pin').textContent(), '1');
  assert.equal(await teacher.locator('.mv-thread .mv-c-t').first().textContent(), 'Is this algae or <b>duckweed</b>?');
  assert.equal(await teacher.locator('.mv-thread b:text("duckweed")').count(), 0, 'comments are text, never markup');
  assert.equal(await teacher.locator('.mv-callout img').count(), 0);
  assert.equal(await T(() => window.__pwned), undefined);
  assert.equal(await teacher.locator('.mv-ink path').count(), 1);
  // the card on the board counts them
  await T(() => DQBUI.Overlay.closeAll());
  await teacher.waitForFunction((id) => { const el = document.getElementById(id); return el && /1/.test(el.querySelector('.card-stats .cs-btn').textContent); }, imgId);
});

test('on a video file, comments and hotspots sit at moments: the timeline shows them and clicking one moves the video', async () => {
  await T((id) => Actions.openMedia(id), vidId);
  await teacher.waitForFunction(() => { const v = document.querySelector('.mv-stage video'); return v && v.readyState >= 1; }, null, { timeout: 15000 });
  await teacher.evaluate(() => { const v = document.querySelector('.mv-stage video'); v.muted = true; v.currentTime = 4; });
  await teacher.waitForFunction(() => /^0:04/.test(document.querySelector('.mv-clock').textContent));
  await teacher.fill('.mv-in', 'The colours change here');
  await teacher.click('[data-mv="post"]');
  await teacher.evaluate(() => { document.querySelector('.mv-stage video').currentTime = 9; });
  await teacher.waitForFunction(() => /^0:09/.test(document.querySelector('.mv-clock').textContent));
  await teacher.click('.mv-tool[data-tool="hotspot"]');
  const st = await stageBox(teacher);
  await teacher.mouse.click(st.x + st.width / 2, st.y + st.height / 2);
  await teacher.fill('.mv-pop textarea', 'What changed?');
  await teacher.selectOption('.mv-pop .mv-dur', '5');
  await teacher.click('.mv-pop [data-pl="add"]');
  await teacher.click('.mv-tool[data-tool="view"]');
  const list = await annos(vidId);
  assert.equal(list[0].k, 'comment'); assert.ok(Math.abs(list[0].t - 4) < 0.3, 'the comment is at 0:04 (' + list[0].t + ')');
  assert.equal(list[1].k, 'hotspot'); assert.ok(Math.abs(list[1].t - 9) < 0.3); assert.ok(Math.abs(list[1].t2 - list[1].t - 5) < 0.01); assert.equal(list[1].pause, true);
  await teacher.waitForFunction(() => document.querySelectorAll('.mv-tm').length === 2);
  // the hotspot is on screen only during its moment
  assert.equal(await teacher.locator('.mv-marks .mv-hot').count(), 1);
  await teacher.click('.mv-tm.k-comment');
  await teacher.waitForFunction(() => Math.abs(document.querySelector('.mv-stage video').currentTime - 4) < 0.3);
  await teacher.waitForFunction(() => document.querySelectorAll('.mv-marks .mv-hot').length === 0);
  await T(() => DQBUI.Overlay.closeAll());
});

test('YouTube and Vimeo load nothing until someone presses play, then the viewer drives them through their postMessage protocols', async () => {
  const before = thirdParty.length;
  // YouTube (starts at 0:42 from the address)
  await T((id) => Actions.openMedia(id), ytId);
  await teacher.waitForSelector('.mv-cover');
  assert.equal(await teacher.locator('.mv-stage iframe').count(), 0);
  await teacher.waitForTimeout(300);
  assert.equal(thirdParty.length, before, 'nothing was requested from YouTube yet');
  await T((id) => Actions.addAnno(id, { k: 'callout', text: 'Watch the legs', x: 0.5, y: 0.4, t: 90, t2: 100 }), ytId);
  await teacher.click('.mv-cover');
  const src = await teacher.locator('.mv-stage iframe').getAttribute('src');
  assert.match(src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?enablejsapi=1.*&start=42&autoplay=1$/);
  await teacher.waitForFunction(() => / \/ 2:00$/.test(document.querySelector('.mv-clock').textContent) && /^0:4[2-9]/.test(document.querySelector('.mv-clock').textContent), null, { timeout: 15000 });
  await teacher.waitForSelector('.mv-tm.k-callout');
  await teacher.click('.mv-tm.k-callout');                                   // seekTo(90) through the protocol
  await teacher.waitForFunction(() => /^1:3\d/.test(document.querySelector('.mv-clock').textContent), null, { timeout: 10000 });
  await teacher.waitForSelector('.mv-marks .mv-callout');                    // the callout is on screen at its moment
  await teacher.click('[data-mv="pp"]');                                     // pause
  await teacher.waitForFunction(() => document.querySelector('[data-mv="pp"]').getAttribute('aria-label') === 'Play');
  await T(() => DQBUI.Overlay.closeAll());
  // Vimeo
  await T((id) => Actions.openMedia(id), vmId);
  await teacher.click('.mv-cover');
  assert.match(await teacher.locator('.mv-stage iframe').getAttribute('src'), /^https:\/\/player\.vimeo\.com\/video\/76979871\?dnt=1&.*&autoplay=1$/);
  await teacher.waitForFunction(() => / \/ 1:30$/.test(document.querySelector('.mv-clock').textContent), null, { timeout: 15000 });
  await T((id) => Actions.addAnno(id, { k: 'comment', text: 'A heron lands', t: 30 }), vmId);
  await teacher.click('.mv-at');
  await teacher.waitForFunction(() => /^0:3\d/.test(document.querySelector('.mv-clock').textContent), null, { timeout: 10000 });
  await T(() => DQBUI.Overlay.closeAll());
  assert.ok(thirdParty.every((u) => /^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//.test(u)), 'only the two players, and only after play: ' + thirdParty.join(' '));
});

test('students: a shared picture arrives with the teacher’s callout and hotspot; their comment and drawing reach the teacher, who replies', async () => {
  await T((id) => Network.toggleShare(id), imgId);
  const maya = await env.student(code, 'Maya', 'phone');
  await maya.waitForSelector('.shared-item.media');
  await maya.click('.shared-item.media');
  await maya.waitForSelector('#p-media .mv-stage img.mv-img', { timeout: 15000 });
  await maya.waitForSelector('#p-media .mv-callout');
  assert.match(await maya.textContent('#p-media .mv-callout'), /^The sun: <img/, 'the callout is text');
  await maya.click('#p-media .mv-hot');
  assert.equal(await maya.textContent('#p-media .mv-pop .mv-pop-t'), 'Reeds: home for dragonfly nymphs');
  await maya.click('#p-media .mv-pop-x');
  const st = await stageBox(maya, '#p-media');
  await maya.click('#p-media .mv-tool[data-tool="pin"]');
  await maya.mouse.click(st.x + st.width * 0.2, st.y + st.height * 0.8);
  await maya.fill('#p-media .mv-in', 'I can see reeds by the water');
  await maya.click('#p-media [data-mv="post"]');
  await maya.click('#p-media .mv-tool[data-tool="pen"]');
  await maya.mouse.move(st.x + st.width * 0.5, st.y + st.height * 0.5); await maya.mouse.down();
  await maya.mouse.move(st.x + st.width * 0.7, st.y + st.height * 0.6, { steps: 8 }); await maya.mouse.up();
  await teacher.waitForFunction((id) => State.items.find((i) => i.id === id).annos.filter((a) => a.by.r === 's').length === 2, imgId, { timeout: 15000 });
  const mine = (await annos(imgId)).filter((a) => a.by.r === 's');
  assert.deepEqual(mine.map((a) => [a.k, a.by.n]), [['comment', 'Maya'], ['ink', 'Maya']]);
  assert.ok(mine.every((a) => a.by.sid), 'the teacher knows who wrote it');
  const comment = mine[0];
  await T(({ id, re }) => Actions.addAnno(id, { k: 'comment', text: 'Good eye! What lives in reeds?', re }), { id: imgId, re: comment.id });
  await maya.waitForFunction(() => [...document.querySelectorAll('#p-media .mv-c.reply .mv-c-t')].some((e) => e.textContent === 'Good eye! What lives in reeds?'), null, { timeout: 15000 });
  assert.equal(await maya.locator('#p-media .mv-c:not(.reply)', { hasText: 'I can see reeds by the water' }).locator('b').first().textContent(), 'You');
  await maya.context().close();
});

test('class rules decide what classmates see: names, each other’s comments, and approval first', async () => {
  const ana = await env.student(code, 'Ana', 'phone');
  const ben = await env.student(code, 'Ben', 'phone');
  for (const p of [ana, ben]) { await p.waitForSelector('.shared-item.media'); await p.click('.shared-item.media'); await p.waitForSelector('#p-media .mv-in'); }
  await ana.fill('#p-media .mv-in', 'Ana thinks it is duckweed');
  await ana.click('#p-media [data-mv="post"]');
  const seen = (p) => p.evaluate(() => [...document.querySelectorAll('#p-media .mv-c')].map((li) => li.querySelector('b').textContent + ': ' + li.querySelector('.mv-c-t').textContent));
  await ben.waitForFunction(() => /Ana thinks/.test(document.querySelector('#p-media .mv-thread').textContent), null, { timeout: 15000 });
  assert.ok((await seen(ben)).includes('Ana: Ana thinks it is duckweed'), 'names on: classmates see who wrote it');
  // names off: classmates see "Classmate"; the teacher still sees the name
  await T(() => { State.settings.names = false; Network.pushAllItems(); });
  await ben.waitForFunction(() => /Classmate/.test(document.querySelector('#p-media .mv-thread').textContent), null, { timeout: 10000 });
  assert.ok((await seen(ben)).includes('Classmate: Ana thinks it is duckweed'));
  assert.ok((await seen(ana)).includes('You: Ana thinks it is duckweed'), 'her own stays hers');
  // peers off: only the teacher's and their own
  await T(() => { State.settings.names = true; State.settings.peers = false; Network.pushAllItems(); });
  await ben.waitForFunction(() => !/Ana thinks/.test(document.querySelector('#p-media .mv-thread').textContent), null, { timeout: 10000 });
  assert.ok((await seen(ana)).includes('You: Ana thinks it is duckweed'));
  // approval first: a new comment waits; classmates see it once the teacher approves
  await T(() => { State.settings.peers = true; State.settings.approve = true; Network.broadcast({ type: 'RULES', rules: { names: true, approve: true, peers: true } }); Network.pushAllItems(); });
  await ana.waitForFunction(() => /checks comments/.test(document.querySelector('#p-media .mv-notice').textContent));
  await ana.fill('#p-media .mv-in', 'Second thought: it is algae');
  await ana.click('#p-media [data-mv="post"]');
  await teacher.waitForFunction((id) => State.items.find((i) => i.id === id).annos.some((a) => a.text === 'Second thought: it is algae' && a.pend), imgId, { timeout: 15000 });
  await ana.waitForFunction(() => /Waiting for your teacher/.test(document.querySelector('#p-media .mv-thread').textContent), null, { timeout: 10000 });
  await ben.waitForTimeout(600);
  assert.ok(!(await seen(ben)).some((x) => /Second thought/.test(x)), 'not shown to classmates before approval');
  const aid = (await annos(imgId)).find((a) => a.text === 'Second thought: it is algae').id;
  await T(({ id, aid }) => Actions.approveAnno(id, aid), { id: imgId, aid });
  await ben.waitForFunction(() => /Second thought/.test(document.querySelector('#p-media .mv-thread').textContent), null, { timeout: 10000 });
  await T(() => { State.settings.approve = false; Network.broadcast({ type: 'RULES', rules: { names: true, approve: false, peers: true } }); });
  await ana.context().close(); await ben.context().close();
});

test('a hotspot that pauses stops the student’s video at its moment and points them to it', async () => {
  await T((id) => Network.toggleShare(id), vidId);
  const leo = await env.student(code, 'Leo', 'phone');
  await leo.waitForSelector('.shared-item.media >> text=Pond clip');
  await leo.click('.shared-item.media >> text=Pond clip');
  await leo.waitForFunction(() => { const v = document.querySelector('#p-media video'); return v && v.readyState >= 2; }, null, { timeout: 15000 });
  await leo.evaluate(() => { const v = document.querySelector('#p-media video'); v.muted = true; v.currentTime = 7.6; v.play(); });
  await leo.waitForFunction(() => { const v = document.querySelector('#p-media video'); return v.paused && v.currentTime > 8.8 && v.currentTime < 9.4; }, null, { timeout: 10000 });
  await leo.waitForSelector('#p-media .mv-hot.attn');
  await leo.click('#p-media .mv-hot');
  assert.equal(await leo.textContent('#p-media .mv-pop .mv-pop-t'), 'What changed?');
  await leo.click('#p-media .mv-pop button:has-text("Keep watching")');
  await leo.waitForFunction(() => !document.querySelector('#p-media video').paused);
  await leo.context().close();
});

test('hostile students: no callouts or hotspots, nothing on items not shared with them, only their own deletions, and limits', async () => {
  rogue = await env.open('phone', '/Student/');
  await rogue.waitForSelector('body[data-ready="1"]');
  await rogue.evaluate((c) => new Promise((resolve, reject) => {
    const peer = Net.newPeer();
    window.__rogue = { peer, conn: null, log: [] };
    peer.on('error', reject);
    peer.on('open', () => {
      const conn = peer.connect(Net.codeToPeerId(c), { reliable: true });
      window.__rogue.conn = conn;
      conn.on('data', (d) => { try { window.__rogue.log.push(typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { /* ignore */ } });
      conn.on('open', () => resolve(true));
    });
  }), code);
  await send({ type: 'JOIN', name: 'Eve', sid: 'EVE0000000000001', v: 2 });
  await teacher.waitForFunction(() => Object.values(State.students).some((s) => s.sid === 'EVE0000000000001'));
  const status = async (aid) => { await rogue.waitForFunction((x) => window.__rogue.log.some((m) => m.type === 'ANNO_STATUS' && m.aid === x), aid, { timeout: 10000 }); return (await received()).find((m) => m.type === 'ANNO_STATUS' && m.aid === aid).status; };
  // a callout from a student, a forged teacher, an item that is not shared
  await send({ type: 'ANNO_ADD', id: 'ev1', item: imgId, a: { id: 'ev1', k: 'callout', text: 'I am the teacher now', x: 0.5, y: 0.5 } });
  assert.equal(await status('ev1'), 'bad');
  await send({ type: 'ANNO_ADD', id: 'ev2', item: imgId, a: { id: 'ev2', k: 'comment', text: 'Hello', by: { n: 'Teacher', r: 't', sid: 'host' }, pend: false } });
  assert.equal(await status('ev2'), 'ok');
  const ev2 = (await annos(imgId)).find((a) => a.id === 'ev2');
  assert.deepEqual([ev2.by.n, ev2.by.r, ev2.by.sid], ['Eve', 's', 'EVE0000000000001'], 'who wrote it comes from the connection, not the message');
  await T((id) => Network.toggleShare(id), ytId); await T((id) => Network.toggleShare(id), ytId);   // shared then withdrawn
  await send({ type: 'ANNO_ADD', id: 'ev3', item: ytId, a: { id: 'ev3', k: 'comment', text: 'sneaky' } });
  assert.equal(await status('ev3'), 'gone');
  await send({ type: 'VIEW', item: ytId });
  await rogue.waitForFunction((id) => window.__rogue.log.some((m) => m.type === 'ITEM' && m.id === id && m.gone), ytId);
  // what a student receives about others: no ids
  await send({ type: 'VIEW', item: imgId });
  await rogue.waitForFunction((id) => window.__rogue.log.some((m) => m.type === 'ITEM' && m.id === id && m.annos), imgId);
  const item = (await received()).filter((m) => m.type === 'ITEM' && m.id === imgId).pop();
  assert.ok(typeof item.src === 'string' && item.src.startsWith('data:image/jpeg'), 'the picture comes with the first ITEM');
  assert.ok(item.annos.every((a) => !a.by.sid), 'no student ids are sent to students');
  assert.ok(item.annos.some((a) => a.id === 'ev2' && a.mine));
  // deleting someone else's annotation does nothing; deleting one's own works
  const teacherPin = (await annos(imgId)).find((a) => a.k === 'comment' && a.by.r === 't').id;
  await send({ type: 'ANNO_DEL', item: imgId, ids: [teacherPin, 'ev2'] });
  await teacher.waitForFunction((id) => !State.items.find((i) => i.id === id).annos.some((a) => a.id === 'ev2'), imgId);
  assert.ok((await annos(imgId)).some((a) => a.id === teacherPin), 'the teacher’s comment is still there');
  // an enormous stroke is cut down; 60 annotations per student per item
  await send({ type: 'ANNO_ADD', id: 'ev4', item: imgId, a: { id: 'ev4', k: 'ink', pts: Array.from({ length: 5000 }, (_, k) => [k / 5000, 0.5]), c: '#000000', w: 0.01 } });
  assert.equal(await status('ev4'), 'ok');
  assert.equal((await annos(imgId)).find((a) => a.id === 'ev4').pts.length, 1500);
  for (let k = 0; k < 62; k++) { await send({ type: 'ANNO_ADD', id: 'f' + k, item: imgId, a: { id: 'f' + k, k: 'comment', text: 'spam ' + k } }); await rogue.waitForTimeout(140); }
  await rogue.waitForFunction(() => window.__rogue.log.some((m) => m.type === 'ANNO_STATUS' && m.status === 'limit'), null, { timeout: 15000 });
  assert.equal((await annos(imgId)).filter((a) => a.by.sid === 'EVE0000000000001').length, 60);
  assert.equal(await T(() => window.__pwned), undefined);
});

test('undo never takes students’ annotations away', async () => {
  const n = (await annos(imgId)).length;
  await T(() => { const it = Actions.create('note', 'idea'); StateManager.updateItem(it.id, { text: 'undo me' }); });
  await T((id) => StateManager.setAnnos(id, State.items.find((i) => i.id === id).annos.concat([DQBMedia.cleanAnno({ id: 'late1', k: 'comment', text: 'arrived after the note', by: { n: 'Ana', r: 's', sid: 'ANA' } })])), imgId);
  await T(() => { ActionHistory.undo(); ActionHistory.undo(); });
  assert.equal(await T(() => State.items.some((i) => i.text === 'undo me')), false, 'the note was undone');
  const after = await annos(imgId);
  assert.equal(after.length, n + 1);
  assert.ok(after.some((a) => a.id === 'late1'));
});
