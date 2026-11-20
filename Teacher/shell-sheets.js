/* ==========================================================================
   InquiryDQB Teacher — sheets & dialogs (share, settings, templates, comments, …)
   All of these are bottom sheets on phones and centred modals on desktop.
   ========================================================================== */
(function () {
  'use strict';
  const { Overlay, Toast, Theme, Menu } = DQBUI;
  const esc = DQBUI.esc, ic = icon, isMobile = DQBUI.isMobile;
  const on = (el, ev, fn, o) => { if (el) el.addEventListener(ev, fn, o); };
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  /* ---------------------------------------------------------------------- */
  /* Thumbnails (boards home + template picker)                              */
  /* ---------------------------------------------------------------------- */
  Shell.drawThumb = function (canvas, items, ink) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 240, hh = canvas.clientHeight || 150;
    canvas.width = w * dpr; canvas.height = hh * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hh);
    items = items || []; ink = ink || [];
    if (!items.length && !ink.length) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-3') || '#94a3b8'; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Empty board', w / 2, hh / 2 + 4); return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    items.forEach(i => { const iw = i.w || 200, ih = i.h || 150; minX = Math.min(minX, i.x); minY = Math.min(minY, i.y); maxX = Math.max(maxX, i.x + iw); maxY = Math.max(maxY, i.y + ih); });
    ink.forEach(s => (s.points || []).forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }));
    const pad = 14, sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (hh - pad * 2) / Math.max(1, maxY - minY));
    const ox = (w - (maxX - minX) * sc) / 2 - minX * sc, oy = (hh - (maxY - minY) * sc) / 2 - minY * sc;
    const cs = getComputedStyle(document.documentElement), border = cs.getPropertyValue('--border-strong').trim() || 'rgba(0,0,0,.2)';
    items.filter(i => i.type === 'zone').forEach(i => {
      const col = DQBUI.safeColor(i.color) || (i.zoneType === 'breakout' ? '#8b5cf6' : '#2563eb');
      ctx.fillStyle = col + '14'; ctx.strokeStyle = DQBUI.safeColor(i.color) ? col : border; ctx.lineWidth = 1; ctx.setLineDash(DQBUI.safeColor(i.color) ? [] : [3, 2]);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(i.x * sc + ox, i.y * sc + oy, (i.w || 200) * sc, (i.h || 150) * sc, 4) : ctx.rect(i.x * sc + ox, i.y * sc + oy, (i.w || 200) * sc, (i.h || 150) * sc); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (i.title && (i.w || 200) * sc > 36) { ctx.fillStyle = cs.getPropertyValue('--text-2') || '#475569'; ctx.font = `600 ${Math.max(7, Math.min(10, 11 * sc * 2))}px Inter, sans-serif`; ctx.textAlign = 'left'; ctx.fillText(String(i.title).slice(0, 18), i.x * sc + ox + 4, i.y * sc + oy + 10); }
    });
    items.filter(i => i.type !== 'zone').forEach(i => {
      const t = (typeof TYPES !== 'undefined' && TYPES[i.sub]) || { col: '#e2e8f0', bor: '#94a3b8' };
      ctx.fillStyle = i.type === 'note' ? t.col : '#dbeafe'; ctx.strokeStyle = i.type === 'note' ? t.bor : '#60a5fa'; ctx.lineWidth = 1;
      ctx.fillRect(i.x * sc + ox, i.y * sc + oy, Math.max(3, (i.w || 200) * sc), Math.max(3, (i.h || 150) * sc)); ctx.strokeRect(i.x * sc + ox, i.y * sc + oy, Math.max(3, (i.w || 200) * sc), Math.max(3, (i.h || 150) * sc));
    });
    ink.forEach(s => { if (!s.points || s.points.length < 2) return; ctx.strokeStyle = DQBUI.safeColor(s.color) || '#000'; ctx.lineWidth = Math.max(0.6, (s.width || 4) * sc); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.points[0].x * sc + ox, s.points[0].y * sc + oy); s.points.slice(1).forEach(p => ctx.lineTo(p.x * sc + ox, p.y * sc + oy)); ctx.stroke(); });
  };

  /* ---------------------------------------------------------------------- */
  /* More menu                                                               */
  /* ---------------------------------------------------------------------- */
  Shell.More = {
    open(anchor) {
      const m = Workspace.mode, board = m === 'board';
      const items = [];
      if (board && !State.isCoHost) items.push({ label: 'Share & invite students', icon: 'qr', onClick: () => Shell.Share.open() });
      if (board) items.push({ label: 'Templates', icon: 'template', onClick: () => Shell.Templates.open() });
      if (board && Shell.Library.available()) items.push({ label: (DQBUI.host().library.title || 'Add from the library'), icon: 'book', onClick: () => Shell.Library.open() });
      if (board) {
        items.push({ header: 'Save & export' });
        items.push({ label: 'Download as picture (PNG)', icon: 'image', onClick: () => Board.exportPNG() });
        items.push({ label: 'Download board file (JSON)', icon: 'download', onClick: () => Board.export() });
        items.push({ label: 'Print or save as PDF', icon: 'print', onClick: () => Shell.printOutline() });
        items.push({ header: 'View' });
        items.push({ label: 'Accessibility view', icon: 'a11y', onClick: () => Shell.A11y.open() });
        if (!isMobile()) items.push({ label: Shell.mmVisible() ? 'Hide minimap' : 'Show minimap', icon: 'map-pin', kbd: 'M', onClick: () => Shell.toggleMinimap() });
        if (!State.isCoHost) items.push({ label: 'Save current view as start view', icon: 'map-pin', onClick: () => Board.setStartView() });
      }
      items.push({ label: 'Full screen', icon: 'maximize', onClick: () => UI.toggleFullScreen() });
      items.push({ separator: true });
      items.push({ label: 'Settings', icon: 'settings', onClick: () => Shell.Settings.open() });
      if (!isMobile()) items.push({ label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', onClick: () => Shell.Shortcuts.open() });
      if (Shell.installPrompt) items.push({ label: 'Install app', icon: 'download', onClick: () => Shell.install() });
      if (board) { items.push({ separator: true }); items.push({ label: 'Leave board', icon: 'logout', danger: true, onClick: () => Board.exit() }); }
      DQBUI.Menu.open({ anchor: anchor || $('btn-more'), items, align: 'end', title: 'More' });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Share / invite                                                          */
  /* ---------------------------------------------------------------------- */
  Shell.Share = {
    ov: null, _qrFor: null,
    open() {
      if (State.isCoHost) { Toast.info('Only the host can share this board.'); return; }
      if (Shell.Share.ov) return;
      const wrap = document.createElement('div'); wrap.id = 'share-body';
      Shell.Share.ov = Overlay.open({
        title: 'Invite students', content: wrap, size: 'md',
        footer: [{ label: 'New code', kind: 'danger-soft', icon: 'refresh', close: false, onClick: async () => { await Network.resetCode(); } }, { label: 'Done', kind: 'primary' }],
        onClose: () => { Shell.Share.ov = null; Shell.Share._qrFor = null; }
      });
      Shell.Share.refresh();
    },
    refresh() {
      const ov = Shell.Share.ov; if (!ov) return;
      const wrap = ov.body.firstElementChild; if (!wrap) return;
      const s = Network.status, code = Network.getCode(), n = Network.studentCount();
      const hostPage = DQBUI.host().joinPage, url = Network.joinUrl();
      const studentPage = (typeof hostPage === 'string' && /^https?:\/\//.test(hostPage) ? hostPage : (new URL('../Student/', location.href)).href).replace(/^https?:\/\//, '').replace(/\/$/, '');
      const statusHtml = s === 'ready' ? `<span class="dot ok"></span>Ready · ${n ? `${n} student${n === 1 ? '' : 's'} connected` : 'waiting for students'}`
        : s === 'connecting' ? `<span class="dot warn"></span>Connecting to the class service…`
        : `<span class="dot bad"></span>Offline — students can’t join right now`;
      const err = Network.statusInfo, hs = DQBUI.host().share;
      const hostShare = hs && typeof hs.open === 'function' ? `<div class="host-share card"><div class="grow"><div class="t">${esc(hs.title || 'Send to your class')}</div><div class="s">${esc(typeof hs.status === 'function' ? (hs.status() || '') : (hs.hint || ''))}</div></div><button type="button" class="btn btn-primary" data-host-share ${code ? '' : 'disabled'}>${ic('send')}${esc(hs.label || 'Send')}</button></div>` : '';
      wrap.innerHTML = hostShare + `
        <div class="share-hero">
          <div class="status-line" role="status">${statusHtml}</div>
          <div class="qr-box ${s === 'ready' ? '' : 'off'}" id="share-qr" role="img" aria-label="QR code that opens the student join page"></div>
          <div class="center"><div class="label">Join code</div><div class="code-big" id="share-code" aria-label="Join code ${esc(code || '')}">${code ? esc(Net.formatCode(code)) : '– – –'}</div></div>
          <div class="row" style="gap:8px;width:100%;flex-wrap:wrap">
            <button type="button" class="btn btn-primary grow" data-copy="code" ${code ? '' : 'disabled'}>${ic('copy')}Copy code</button>
            <button type="button" class="btn btn-secondary grow" data-copy="link" ${code ? '' : 'disabled'}>${ic('link')}Copy link</button>
            ${navigator.share ? `<button type="button" class="btn btn-secondary grow" data-share ${code ? '' : 'disabled'}>${ic('share')}Share…</button>` : ''}
          </div>
          <p class="muted center" style="font-size:.875rem">Students open <b>${esc(studentPage)}</b> and type the code, or scan the QR code with their camera. <a href="${esc(url)}" target="_blank" rel="noopener">Preview as a student ↗</a></p>
        </div>
        ${s !== 'ready' ? `<div class="help-box" style="margin-top:14px"><b>${esc(err ? err.title : (s === 'connecting' ? 'Connecting…' : 'Not connected'))}</b><div style="margin-top:4px">${esc(err ? err.msg : 'Setting up your class. This usually takes a second or two.')}</div>${(s === 'error' || err) ? `<button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" data-retry>${ic('refresh', 'sm')}Try again</button>` : ''}</div>` : ''}
        <details class="help-box" style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Add a co-host</summary>
          <div style="margin-top:8px">A second teacher device can join with this private code and help run the board.</div>
          <div class="row" style="margin-top:10px;gap:8px"><code class="grow" style="font-size:1.05rem;font-weight:700;letter-spacing:.06em;user-select:all;-webkit-user-select:all">${esc(Network.cohostCode() || '—')}</code><button type="button" class="btn btn-secondary btn-sm" data-copy="cohost" ${code ? '' : 'disabled'}>${ic('copy', 'sm')}Copy</button></div>
        </details>
        <details class="help-box" style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Students can’t connect?</summary>
          <ul><li>Check everyone has internet access (Wi-Fi or mobile data).</li><li>Some school networks block peer-to-peer (WebRTC) traffic. Try a phone hotspot, or ask IT to allow WebRTC and <b>wss://0.peerjs.com</b>.</li><li>Keep this board open on the teacher device — closing the tab ends the session.</li><li>Make sure students type the code exactly, or use the link.</li></ul>
        </details>`;
      // QR (re-generated only when the code changes)
      const qr = ov.body.querySelector('#share-qr');
      if (code && Shell.Share._qrFor !== url) {
        Shell.Share._qrFor = url;
        try { new QRCode(qr, { text: url, width: 200, height: 200, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
        catch (e) { qr.textContent = 'QR code unavailable'; }
        qr.querySelectorAll('img, canvas').forEach(n => { n.setAttribute('alt', ''); n.setAttribute('aria-hidden', 'true'); });
        Shell.Share._qrHtml = qr.innerHTML;
      } else if (code && Shell.Share._qrHtml) qr.innerHTML = Shell.Share._qrHtml;
      if (!code) qr.innerHTML = `<div class="muted" style="text-align:center;padding:30px 10px">${ic('qr', 'xl')}</div>`;
      $$('[data-copy]', ov.body).forEach(b => on(b, 'click', async () => {
        const k = b.dataset.copy; const text = k === 'code' ? code : (k === 'link' ? url : Network.cohostCode());
        const ok = await DQBUI.copyText(text); Toast[ok ? 'success' : 'warn'](ok ? (k === 'code' ? 'Code copied' : (k === 'link' ? 'Link copied' : 'Co-host code copied')) : 'Couldn’t copy — select the text and copy it manually');
      }));
      on(ov.body.querySelector('[data-retry]'), 'click', () => Network.retry());
      on(ov.body.querySelector('[data-host-share]'), 'click', () => { try { hs.open({ code, url, boardId: State.id, name: State.name }); } catch (e) { console.error(e); } });
      on(ov.body.querySelector('[data-share]'), 'click', () => navigator.share({ title: 'Join my InquiryDQB board', text: `Join code ${Net.formatCode(code)}`, url }).catch(() => {}));
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Library: a host's resources and collections (DQB_HOST.library)          */
  /* search(q, kind) -> [{id, kind, title, desc, url, thumb, meta, source}]  */
  /* items(collectionId) -> the resources in a collection (optional)         */
  /* ---------------------------------------------------------------------- */
  Shell.Library = {
    ov: null, kind: 'resource', q: '', results: [], seq: 0,
    available() { const l = DQBUI.host().library; return !!(l && typeof l.search === 'function'); },
    open() {
      if (!Shell.Library.available()) return;
      if (Shell.Library.ov) return;
      const L = DQBUI.host().library;
      const wrap = document.createElement('div'); wrap.className = 'lib stack'; wrap.style.gap = '12px';
      wrap.innerHTML = `
        <div class="seg" role="group" aria-label="What to search">${[['resource', 'Resources'], ['collection', 'Collections']].map(([k, l]) => `<button type="button" data-lk="${k}" aria-pressed="${Shell.Library.kind === k}">${l}</button>`).join('')}</div>
        <div class="lib-search"><span class="lib-ico" aria-hidden="true">${ic('search', 'sm')}</span><input type="search" class="input" id="lib-q" placeholder="Search ${esc(L.name || 'the library')}…" aria-label="Search ${esc(L.name || 'the library')}" autocomplete="off" enterkeyhint="search"></div>
        <div id="lib-results" class="lib-results" aria-live="polite"></div>`;
      Shell.Library.ov = Overlay.open({ title: L.title || 'Add from the library', content: wrap, size: 'lg', initialFocus: '#lib-q', footer: [{ label: 'Done', kind: 'primary' }], onClose: () => { Shell.Library.ov = null; } });
      const input = wrap.querySelector('#lib-q'); input.value = Shell.Library.q;
      const run = DQBUI.debounce(() => Shell.Library.search(input.value), 250);
      on(input, 'input', run);
      on(input, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); Shell.Library.search(input.value); } });
      on(wrap, 'click', e => {
        const k = e.target.closest('[data-lk]');
        if (k) { Shell.Library.kind = k.dataset.lk; $$('[data-lk]', wrap).forEach(b => b.setAttribute('aria-pressed', String(b === k))); Shell.Library.search(input.value); return; }
        const b = e.target.closest('[data-lib]'); if (!b) return;
        const r = Shell.Library.results[+b.dataset.n]; if (!r) return;
        Shell.Library.act(b.dataset.lib, r, b);
      });
      Shell.Library.search(Shell.Library.q);
    },
    async search(q) {
      const L = DQBUI.host().library, ov = Shell.Library.ov; if (!ov || !L) return;
      Shell.Library.q = String(q || '').slice(0, 100);
      const box = ov.body.querySelector('#lib-results'), my = ++Shell.Library.seq;
      box.setAttribute('aria-busy', 'true');
      if (!box.children.length) box.innerHTML = `<div class="muted lib-msg">Searching…</div>`;
      let list = [];
      try { list = await L.search(Shell.Library.q.trim(), Shell.Library.kind); } catch (e) { if (my === Shell.Library.seq) { box.innerHTML = `<div class="lib-msg err">The library can’t be reached right now. Check the connection and try again.</div>`; box.removeAttribute('aria-busy'); } return; }
      if (my !== Shell.Library.seq || !Shell.Library.ov) return;
      Shell.Library.results = (Array.isArray(list) ? list : []).slice(0, 40).map(r => ({ id: String(r.id), kind: r.kind === 'collection' ? 'collection' : 'resource', title: DQBUI.clampStr(r.title, 200), desc: DQBUI.clampStr(r.desc, 500), url: DQBUI.safeUrl(r.url), thumb: DQBUI.safeThumb(r.thumb), meta: DQBUI.clampStr(r.meta, 120), source: r.source ? DQBUI.clampStr(r.source, 60) : (L.name || '') })).filter(r => r.url);
      box.removeAttribute('aria-busy');
      if (!Shell.Library.results.length) { box.innerHTML = `<div class="muted lib-msg">${Shell.Library.q ? 'Nothing found. Try other words.' : 'Nothing here yet.'}</div>`; return; }
      box.innerHTML = Shell.Library.results.map((r, n) => `
        <div class="lib-row" role="group" aria-label="${esc(r.title)}">
          ${r.thumb ? `<img class="lib-thumb" alt="" data-n="${n}" loading="lazy">` : `<span class="lib-thumb lib-ph" aria-hidden="true">${ic(r.kind === 'collection' ? 'layers' : 'book')}</span>`}
          <div class="grow lib-text"><div class="t">${esc(r.title)}</div>${r.meta ? `<div class="s">${esc(r.meta)}</div>` : ''}</div>
          <div class="lib-acts">
            <button type="button" class="btn btn-primary btn-sm" data-lib="card" data-n="${n}" aria-label="Add a card for ${esc(r.title)}">${ic('plus', 'sm')}Card</button>
            ${r.kind === 'resource' && DQBMedia.parseVideo(r.url) ? `<button type="button" class="btn btn-secondary btn-sm" data-lib="video" data-n="${n}" aria-label="Add ${esc(r.title)} as a video students can watch and comment on">${ic('video', 'sm')}Video</button>` : ''}
            ${r.kind === 'resource' && r.thumb && !DQBMedia.parseVideo(r.url) ? `<button type="button" class="btn btn-secondary btn-sm" data-lib="image" data-n="${n}" aria-label="Add the picture of ${esc(r.title)} to annotate">${ic('image', 'sm')}Picture</button>` : ''}
            ${r.kind === 'collection' && typeof L.items === 'function' ? `<button type="button" class="btn btn-secondary btn-sm" data-lib="all" data-n="${n}" aria-label="Add every resource in ${esc(r.title)}">${ic('layers', 'sm')}All</button>` : ''}
            <button type="button" class="btn btn-soft btn-sm" data-lib="share" data-n="${n}" aria-label="Add ${esc(r.title)} and share it with students">${ic('send', 'sm')}Share</button>
          </div>
        </div>`).join('');
      $$('img.lib-thumb', box).forEach(img => { const r = Shell.Library.results[+img.dataset.n]; if (r && r.thumb) img.src = r.thumb; });
    },
    async act(what, r, btn) {
      if (Workspace.mode !== 'board') { Toast.info('Go back to the main board to add things from the library.'); return; }
      const card = { url: r.url, title: r.title, desc: r.desc, thumb: r.thumb, kind: r.kind, ref: r.id, source: r.source };
      if (what === 'card') { if (Actions.addLink(card)) Toast.success('Card added'); }
      else if (what === 'share') { const it = Actions.addLink(card); if (it) Network.toggleShare(it.id); }
      else if (what === 'image') {
        btn.disabled = true;
        const enc = await DQBMedia.encodeImage(r.thumb);
        btn.disabled = false;
        const it = enc && enc.src ? Actions.addMedia({ kind: 'image', title: r.title, desc: r.desc, src: enc.src, thumb: enc.thumb, aspect: enc.aspect, url: r.url, ref: r.id, source: r.source }) : null;
        if (it) Toast.success('Picture added: open it to comment and mark it up'); else Toast.warn('That picture couldn’t be added.');
      }
      else if (what === 'video') { if (Actions.addVideoFromLink(card)) Toast.success('Video added: students can watch it and comment at moments'); }
      else if (what === 'all') {
        btn.disabled = true;
        let list = [];
        try { list = await DQBUI.host().library.items(r.id); } catch (e) { list = null; }
        btn.disabled = false;
        if (!Array.isArray(list)) { Toast.warn('That collection couldn’t be loaded.'); return; }
        const n = Actions.addLinkZone(r.title, list.map(x => ({ url: x.url, title: x.title, desc: x.desc, thumb: x.thumb, kind: 'resource', ref: String(x.id), source: r.source })));
        if (n) Toast.success(`${n} resource${n === 1 ? '' : 's'} added in a zone`); else Toast.info('That collection has no resources to add.');
      }
    }
  };

  /* ---------------------------------------------------------------------- */
  /* A picture, video or card in the viewer (shared/media.js)               */
  /* ---------------------------------------------------------------------- */
  Shell.MediaView = {
    ov: null, v: null, id: null,
    itemOf(it) {
      if (it.type === 'link') return { id: it.id, kind: 'link', title: it.title, desc: it.desc, url: it.url, thumb: it.thumb, source: it.source };
      return { id: it.id, kind: it.kind, title: it.title, desc: it.desc, src: it.src, thumb: it.thumb, video: it.video, aspect: it.aspect, source: it.source };
    },
    footer(it) {
      const f = [];
      if (!State.isCoHost) { const shared = (State.shared || []).includes(it.id); f.push({ label: shared ? 'Stop sharing' : 'Share with students', kind: shared ? 'secondary' : 'primary', icon: shared ? 'stop' : 'send', close: false, onClick: () => { Network.toggleShare(it.id); Shell.MediaView.refresh(it.id); return false; } }); }
      const src = it.type === 'media' && it.kind === 'video' ? DQBMedia.watchUrl(it.video) : (it.type === 'link' ? DQBUI.safeUrl(it.url) : DQBUI.safeUrl(it.url));
      if (src) f.push({ label: it.type === 'media' && it.kind === 'video' ? (it.video.p === 'file' ? 'Open the video file' : 'Open on ' + DQBMedia.providerName(it.video)) : 'Open page', kind: 'ghost', icon: 'link', close: false, onClick: () => { window.open(src, '_blank', 'noopener,noreferrer'); return false; } });
      f.push({ label: 'Done', kind: 'secondary' });
      return f;
    },
    open(id) {
      const it = State.items.find(i => i.id === id && (i.type === 'media' || i.type === 'link')); if (!it) return;
      if (Shell.MediaView.ov) Shell.MediaView.ov.close();
      const wrap = document.createElement('div'); wrap.className = 'mv-host';
      const mine = {};                 // this sheet's own viewer: a sheet that finishes closing later must not touch the next one
      const ov = Overlay.open({
        title: it.title || (it.type === 'link' ? 'Comments' : (it.kind === 'video' ? 'Video' : 'Picture')), content: wrap, size: 'lg', className: 'mv-sheet' + (it.type === 'link' ? ' mv-sheet-link' : ''),
        footer: Shell.MediaView.footer(it),
        onClose: () => { if (mine.v) mine.v.destroy(); if (Shell.MediaView.ov === ov) { Shell.MediaView.v = null; Shell.MediaView.ov = null; Shell.MediaView.id = null; } }
      });
      Shell.MediaView.ov = ov; Shell.MediaView.id = id;
      Shell.MediaView.v = mine.v = DQBMedia.Viewer(wrap, {
        item: Shell.MediaView.itemOf(it), annos: it.annos || [], me: { sid: State.isCoHost ? 'cohost' : 'host', name: State.isCoHost ? 'Co-host' : 'Teacher', role: 't' },
        onAdd: (a) => Actions.addAnno(id, a), onDelete: (ids) => Actions.delAnnos(id, ids), onApprove: (aid) => Actions.approveAnno(id, aid)
      });
      setTimeout(() => { if (Shell.MediaView.v) Shell.MediaView.v.focus(); }, 60);
    },
    refresh(id) {
      if (!Shell.MediaView.ov || Shell.MediaView.id !== id) return;
      const it = State.items.find(i => i.id === id);
      if (!it) { Shell.MediaView.ov.close(); return; }
      Shell.MediaView.ov.setTitle(it.title || (it.kind === 'video' ? 'Video' : 'Picture'));
      Shell.MediaView.ov.setFooter(Shell.MediaView.footer(it));
      Shell.MediaView.v.setItem(Shell.MediaView.itemOf(it));
      Shell.MediaView.v.setAnnos(it.annos || []);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Exploring a shared zone: who has opened, finished and starred what     */
  /* ---------------------------------------------------------------------- */
  Shell.ExploreProgress = {
    ov: null, id: null,
    open(id) {
      const z = State.items.find(i => i.id === id && i.type === 'zone'); if (!z) return;
      if (Shell.ExploreProgress.ov) Shell.ExploreProgress.ov.close();
      const wrap = document.createElement('div'); wrap.className = 'xp stack';
      Shell.ExploreProgress.id = id;
      const ov = Shell.ExploreProgress.ov = Overlay.open({ title: 'Exploring · ' + (z.title || 'Zone'), content: wrap, size: 'lg', footer: [{ label: (State.shared || []).includes(id) ? 'Stop sharing' : 'Share to explore', kind: 'secondary', close: false, onClick: () => { Network.toggleShare(id); Shell.ExploreProgress.refresh(); return false; } }, { label: 'Done', kind: 'primary' }], onClose: () => { if (Shell.ExploreProgress.ov === ov) { Shell.ExploreProgress.ov = null; Shell.ExploreProgress.id = null; } } });
      Shell.ExploreProgress.refresh();
    },
    refresh() {
      const ov = Shell.ExploreProgress.ov; if (!ov) return;
      const z = State.items.find(i => i.id === Shell.ExploreProgress.id); if (!z) { ov.close(); return; }
      const items = Network.setItems(z).filter(i => i.type !== 'note'), rec = State.explore[z.id] || {};
      const names = {}; Object.values(State.students).forEach(s => { if (s.role === 'student') names[s.sid] = s; });
      const sids = Object.keys(rec).concat(Object.keys(names).filter(s => !rec[s] && Network.setVisible(names[s], z)));
      const shared = (State.shared || []).includes(z.id);
      const head = `<p class="muted" style="margin:0">${shared ? (safeColor(z.color) ? `Shared with the ${esc(groupName(z.color))} group.` : 'Shared with the whole class.') + ' Each student opens the things in this zone on their own device, marks them done and stars favourites.' : 'Not shared right now. Share the zone so students can explore it.'}</p>`;
      if (!items.length) { ov.body.firstChild.innerHTML = head + '<div class="muted">There is nothing to explore in this zone yet.</div>'; return; }
      const cell = (r) => (!r ? '<td class="xp-c"><span class="sr-only">Not opened</span></td>' : `<td class="xp-c ${r.d ? 'done' : 'seen'}">${r.d ? ic('check', 'sm') + '<span class="sr-only">Done</span>' : ic('eye', 'sm') + '<span class="sr-only">Opened</span>'}${r.s ? `<span class="xp-star" title="Starred">${ic('star', 'sm')}<span class="sr-only"> and starred</span></span>` : ''}</td>`);
      const totals = items.map(i => Network.exploreCounts(i.id) || { opened: 0, done: 0, stars: 0 });
      ov.body.firstChild.innerHTML = head + (sids.length ? `<div class="xp-scroll"><table class="xp-table"><caption class="sr-only">What each student has explored</caption><thead><tr><th scope="col">Student</th>${items.map(i => `<th scope="col" title="${esc(i.title || '')}"><span>${esc(clampStr(i.title || (i.kind === 'video' ? 'Video' : 'Picture'), 28))}</span></th>`).join('')}<th scope="col">Done</th></tr></thead><tbody>${sids.map(sid => { const s = names[sid], r = rec[sid] || {}; const done = items.filter(i => r[i.id] && r[i.id].d).length; return `<tr><th scope="row">${esc(s ? s.name : 'Left the board')}</th>${items.map(i => cell(r[i.id])).join('')}<td class="xp-n">${done}/${items.length}</td></tr>`; }).join('')}</tbody><tfoot><tr><th scope="row">Class</th>${totals.map(t => `<td class="xp-n">${t.done}${ic('check', 'sm')} ${t.stars ? t.stars + ic('star', 'sm') : ''}</td>`).join('')}<td></td></tr></tfoot></table></div>` : '<div class="muted">No students have joined yet.</div>');
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Settings                                                                */
  /* ---------------------------------------------------------------------- */
  Shell.Settings = {
    open() {
      const wrap = document.createElement('div'); wrap.className = 'stack'; wrap.style.gap = '20px';
      const theme = Theme.get(), wheel = localStorage.getItem('dqb_wheel') || 'pan', s = Shell.settings;
      const po = Net.peerOptions();
      wrap.innerHTML = `
        <div class="field"><label>Appearance</label><div class="seg" id="set-theme" role="group" aria-label="Theme">${[['auto', 'monitor', 'Auto'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([v, i, l]) => `<button type="button" data-v="${v}" aria-pressed="${theme === v}">${ic(i, 'sm')}${l}</button>`).join('')}</div></div>
        ${isMobile() ? '' : `<div class="field"><label>Mouse wheel</label><div class="seg" id="set-wheel" role="group" aria-label="Mouse wheel behaviour"><button type="button" data-v="pan" aria-pressed="${wheel === 'pan'}">Scroll to pan</button><button type="button" data-v="zoom" aria-pressed="${wheel === 'zoom'}">Scroll to zoom</button></div><div class="hint">Pinch on a trackpad or hold Ctrl or ⌘ to zoom either way.</div></div>
        <div class="field"><label>Minimap</label><div class="row" style="gap:8px"><div class="seg grow" id="set-mm-size" role="group" aria-label="Minimap size">${[[160, 'Small'], [200, 'Medium'], [260, 'Large']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${s.mmSize === v}">${l}</button>`).join('')}</div><select class="select" id="set-mm-pos" style="width:auto" aria-label="Minimap position"><option value="br">Bottom right</option><option value="bl">Bottom left</option><option value="tr">Top right</option><option value="tl">Top left</option></select></div></div>`}
        <div class="field"><label>Moving things</label><div class="rule-row"><div class="grow"><div class="t">Snap to guides</div><div class="s">Items line up with their neighbours as you drag.${isMobile() ? '' : ' Hold Alt to move freely.'}</div></div><button type="button" class="switch" role="switch" id="set-snap" aria-checked="${SnapSystem.enabled()}" aria-label="Snap to guides"></button></div></div>
        <div class="field"><label>Connection service</label>${po && po.host ? `<div class="help-box">Using a custom server: <b>${esc(po.host)}</b>:${esc(po.port)}<button type="button" class="btn btn-secondary btn-sm" id="set-peer-reset" style="margin-top:8px">Use the default service</button></div>` : `<div class="hint">Using the free public PeerJS service. Schools can run their own PeerServer and pass <code>?peerHost=…</code> in the page address.</div>`}</div>
        <div class="field"><label>This device</label><div class="hint">Boards are saved in this browser only. Clearing site data removes them — use <b>Download board file</b> to keep a backup.</div></div>`;
      const ov = Overlay.open({ title: 'Settings', content: wrap, size: 'md', footer: [{ label: 'Done', kind: 'primary' }] });
      on(wrap, 'click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return; const grp = b.parentElement.id, v = b.dataset.v;
        $$('[data-v]', b.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        if (grp === 'set-theme') Theme.set(v);
        else if (grp === 'set-wheel') localStorage.setItem('dqb_wheel', v);
        else if (grp === 'set-mm-size') { s.mmSize = +v; Shell.setMinimap(true); }
      });
      on(wrap.querySelector('#set-snap'), 'click', e => { const b = e.currentTarget, v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); try { localStorage.setItem('dqb_snap', v ? '1' : '0'); } catch (err) { /* ignore */ } });
      const pos = wrap.querySelector('#set-mm-pos'); if (pos) { pos.value = s.mmPos; on(pos, 'change', () => { s.mmPos = pos.value; Shell.setMinimap(true); }); }
      on(wrap.querySelector('#set-peer-reset'), 'click', () => { try { localStorage.removeItem('dqb_peer'); } catch (e) { /* ignore */ } Toast.success('Reload the page to use the default service'); });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Templates                                                               */
  /* ---------------------------------------------------------------------- */
  Shell.Templates = {
    async open() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="tabs" role="tablist" style="margin-bottom:14px"><button type="button" role="tab" data-t="system" aria-selected="true">Built-in</button><button type="button" role="tab" data-t="user" aria-selected="false">My templates</button></div><div class="tpl-pick" id="tpl-pick"></div>`;
      const ov = Overlay.open({ title: 'Templates', content: wrap, size: 'lg' });
      const render = async (kind) => {
        $$('[data-t]', wrap).forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === kind)));
        const box = wrap.querySelector('#tpl-pick');
        const list = kind === 'system' ? SYSTEM_TEMPLATES : await DB.getAll('templates');
        if (!list.length) { box.style.display = 'block'; box.innerHTML = `<div class="empty"><div class="em-ico">${ic('template', 'lg')}</div><div class="em-t">No saved templates yet</div><div>Select items on your board, open the ⋯ menu and choose <b>Save as template</b>.</div></div>`; return; }
        box.style.display = '';
        box.innerHTML = list.map((t, i) => `<div class="tpl-card" style="position:relative"><button type="button" data-use="${i}" style="all:unset;cursor:pointer;display:flex;flex-direction:column;gap:8px;width:100%" aria-label="Use template ${esc(t.name)}"><canvas></canvas><span class="tn">${esc(t.name)}</span></button>${kind === 'user' ? `<button type="button" class="icon-btn sm" data-del="${i}" aria-label="Delete template ${esc(t.name)}" style="position:absolute;top:6px;right:6px;background:var(--surface)">${ic('trash', 'sm')}</button>` : ''}</div>`).join('');
        $$('canvas', box).forEach((c, i) => Shell.drawThumb(c, list[i].items, []));
        $$('[data-use]', box).forEach(b => on(b, 'click', () => { ov.close(); Workspace.loadTemplate(list[+b.dataset.use]); }));
        $$('[data-del]', box).forEach(b => on(b, 'click', async () => { const t = list[+b.dataset.del]; if (await DQBUI.Dialog.confirm({ title: `Delete “${t.name}”?`, confirmLabel: 'Delete', danger: true })) { await DB.remove('templates', t.id); render('user'); } }));
      };
      $$('[data-t]', wrap).forEach(b => on(b, 'click', () => render(b.dataset.t)));
      render('system');
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Comments on an item                                                     */
  /* ---------------------------------------------------------------------- */
  Shell.Comments = {
    ov: null, id: null,
    open(id) {
      Shell.Comments.id = id;
      const it = State.items.find(i => i.id === id); if (!it) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="cmt-list" id="cmt-list" aria-live="polite"></div><div class="field"><label for="cmt-input">Reply as teacher</label><textarea class="textarea" id="cmt-input" rows="2" maxlength="500" placeholder="Write feedback or a question…"></textarea></div>`;
      Shell.Comments.ov = Overlay.open({
        title: 'Comments', content: wrap, size: 'md',
        footer: [{ label: 'Close', kind: 'secondary' }, { label: 'Post', kind: 'primary', icon: 'send', close: false, onClick: () => { const v = wrap.querySelector('#cmt-input'); if (!v.value.trim()) { v.focus(); return; } Actions.postComment(Shell.Comments.id, v.value); v.value = ''; Shell.Comments.refresh(); } }],
        onClose: () => { Shell.Comments.ov = null; }
      });
      Shell.Comments.refresh();
    },
    refresh() {
      const box = Shell.Comments.ov && Shell.Comments.ov.body.querySelector('#cmt-list'); if (!box) return;
      const cm = State.comments.filter(c => c.targetId === Shell.Comments.id);
      box.innerHTML = cm.length ? cm.map(c => `<div class="disc-item"><div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--text-3);margin-bottom:4px"><span>${esc(c.author)}</span></div><span class="disc-tag dt-${esc(c.tag)}">${esc(c.tag)}</span><span>${esc(c.text)}</span></div>`).join('') : `<div class="empty"><div class="em-ico">${ic('comment', 'lg')}</div><div>No comments on this item yet.</div></div>`;
      box.scrollTop = box.scrollHeight;
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Poll editor / exit-ticket creator / colour picker                       */
  /* ---------------------------------------------------------------------- */
  Shell.PollEdit = {
    open(p) {
      const wrap = h(`<div class="stack"><div class="field"><label for="pe-q">Question</label><input class="input" id="pe-q" maxlength="200" value="${esc(p.q)}" placeholder="Ask something…"></div><div class="field"><label for="pe-o">Answer choices <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">· one per line (2–8)</span></label><textarea class="textarea" id="pe-o" rows="5" placeholder="Yes&#10;No&#10;Not sure">${esc((p.opts || []).map(o => o.lbl).join('\n'))}</textarea><div class="error" id="pe-err" hidden></div></div></div>`);
      const ov = Overlay.open({ title: 'Edit poll', content: wrap, size: 'sm', initialFocus: '#pe-q', selectOnFocus: true, footer: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save poll', kind: 'primary', close: false, onClick: () => {
        const q = wrap.querySelector('#pe-q').value.trim(), opts = wrap.querySelector('#pe-o').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
        const err = wrap.querySelector('#pe-err');
        if (!q) { err.textContent = 'Please enter a question.'; err.hidden = false; return false; }
        if (opts.length < 2) { err.textContent = 'Add at least two answer choices.'; err.hidden = false; return false; }
        StateManager.updateItem(p.id, { q: DQBUI.clampStr(q, 200), opts: opts.map(l => ({ lbl: DQBUI.clampStr(l, 80), v: 0 })) });
        ov.close(); Toast.success('Poll updated');
      } }] });
    }
  };
  Shell.ExitCreate = {
    open(mode, submit) {
      const titles = { short: 'Short answer', smiley: 'Rating scale', mc: 'Multiple choice', multi: 'Multi-select' };
      const labels = { short: 'Question', smiley: 'Statement to rate', mc: 'Question', multi: 'Prompt (select all that apply)' };
      const defaults = { short: 'What was the most important thing you learned today?', smiley: 'I feel confident about today’s lesson.', mc: 'Which statement is correct?', multi: 'Which topics did we cover?' };
      const opts = mode === 'mc' || mode === 'multi';
      const wrap = h(`<div class="stack"><div class="field"><label for="ex-q">${labels[mode] || 'Question'}</label><textarea class="textarea" id="ex-q" rows="3" maxlength="300">${esc(defaults[mode] || '')}</textarea></div>${opts ? `<div class="field"><label for="ex-o">Choices <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">· one per line (2–8)</span></label><textarea class="textarea" id="ex-o" rows="4">${mode === 'mc' ? 'Option A\nOption B\nOption C' : 'Topic A\nTopic B\nTopic C'}</textarea></div>` : ''}<div class="error" id="ex-err" hidden></div></div>`);
      Overlay.open({ title: `Exit ticket · ${titles[mode] || ''}`, content: wrap, size: 'sm', initialFocus: '#ex-q', selectOnFocus: true, footer: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Add to board', kind: 'primary', close: false, onClick: (ov) => {
        const q = wrap.querySelector('#ex-q').value.trim(), err = wrap.querySelector('#ex-err'); let o = null;
        if (!q) { err.textContent = 'Please enter a question.'; err.hidden = false; return false; }
        if (opts) { o = wrap.querySelector('#ex-o').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8); if (o.length < 2) { err.textContent = 'Add at least two choices.'; err.hidden = false; return false; } }
        ov.close(); submit(q, o);
      } }] });
    }
  };
  Shell.ColorPick = {
    open(id) {
      const z = State.items.find(i => i.id === id); if (!z) return;
      const cols = GROUPS.map(g => [g.color, g.name]);
      const wrap = h(`<div class="stack"><div class="swatches" role="group" aria-label="Zone colour">${cols.map(([c, n]) => `<button type="button" class="swatch" data-c="${c}" style="background:${c};width:44px;height:44px" aria-label="${n}" aria-pressed="${z.color === c}"></button>`).join('')}<button type="button" class="swatch" data-c="" style="width:44px;height:44px;background:var(--surface-2);display:flex;align-items:center;justify-content:center" aria-label="No colour" aria-pressed="${!z.color}">${ic('close', 'sm')}</button></div><p class="muted" style="font-size:.875rem">Colour a zone to make it a group zone: students in the same colour group write into it. Open several colour zones at once and every group gets its own. Set up groups from Class → Groups.</p></div>`);
      const ov = Overlay.open({ title: 'Zone colour', content: wrap, size: 'sm' });
      on(wrap, 'click', e => { const b = e.target.closest('[data-c]'); if (!b) return; StateManager.updateItem(id, { color: b.dataset.c || null }); ov.close(); });
    }
  };
  /* ---------------------------------------------------------------------- */
  /* Groups: split the class into colour groups (pairs with colour zones)    */
  /* ---------------------------------------------------------------------- */
  Shell.Groups = {
    ov: null, n: 0, who: 'all', zones: true,
    students() { return Object.entries(State.students).filter(([, s]) => s.role === 'student'); },
    open() {
      if (Shell.Groups.ov) return;
      const coloured = new Set(State.items.filter(i => Network.openableZone(i) && DQBUI.safeColor(i.color)).map(i => i.color)).size;
      if (!Shell.Groups.n) Shell.Groups.n = Math.max(2, Math.min(GROUPS.length, coloured >= 2 ? coloured : Math.ceil(Shell.Groups.students().length / 5) || 4));
      const wrap = document.createElement('div'); wrap.className = 'stack groups-sheet'; wrap.style.gap = '18px';
      Shell.Groups.ov = Overlay.open({
        title: 'Groups', content: wrap, size: 'md',
        footer: [
          { label: 'Clear groups', kind: 'danger-soft', icon: 'close', close: false, onClick: () => { Network.clearGroups(); Shell.Groups.refresh(); Toast.show('Groups cleared'); } },
          { label: 'Make groups', kind: 'primary', icon: 'users', close: false, onClick: () => Shell.Groups.make() }
        ],
        onClose: () => { Shell.Groups.ov = null; }
      });
      on(wrap, 'click', e => {
        const ha = e.target.closest('[data-host-group]');
        if (ha) { const a = (DQBUI.host().groupActions || [])[+ha.dataset.hostGroup]; if (a && typeof a.run === 'function') { Promise.resolve(a.run()).then(() => Shell.Groups.refresh(), () => Shell.Groups.refresh()); } return; }
        const b = e.target.closest('[data-gn], [data-gw], #gr-zones'); if (!b) return;
        if (b.dataset.gn) Shell.Groups.n = +b.dataset.gn;
        else if (b.dataset.gw) Shell.Groups.who = b.dataset.gw;
        else Shell.Groups.zones = !Shell.Groups.zones;
        Shell.Groups.refresh();
      });
      Shell.Groups.refresh();
    },
    refresh() {
      const ov = Shell.Groups.ov; if (!ov) return;
      const wrap = ov.body.firstElementChild, G = Shell.Groups, list = G.students();
      const per = list.length ? Math.ceil(list.length / G.n) : 0;
      const groups = GROUPS.map(g => ({ g, members: list.filter(([, s]) => s.color === g.color).map(([, s]) => s.name) })).filter(x => x.members.length);
      const none = list.filter(([, s]) => !s.color).map(([, s]) => s.name);
      const focusKey = document.activeElement && wrap.contains(document.activeElement) ? (document.activeElement.dataset.gn ? '[data-gn="' + document.activeElement.dataset.gn + '"]' : (document.activeElement.dataset.gw ? '[data-gw="' + document.activeElement.dataset.gw + '"]' : (document.activeElement.id ? '#' + document.activeElement.id : null))) : null;
      wrap.innerHTML = `
        <p class="text-2">Split the class into colour groups. When you open colour zones, each student writes into their own group’s zone, and several groups can work at the same time.</p>
        <div class="field"><label>Number of groups</label><div class="seg" role="group" aria-label="Number of groups">${[2, 3, 4, 5, 6].map(k => `<button type="button" data-gn="${k}" aria-pressed="${G.n === k}">${k}</button>`).join('')}</div><div class="hint">${esc(Network.groupColors(G.n).map(groupName).join(', '))} · ${list.length ? `${list.length} student${list.length === 1 ? '' : 's'} connected, about ${per} per group` : 'no students connected yet; you can still add the group zones now'}</div></div>
        ${Shell.Groups.hostActions()}
        <div class="field"><label>Who to sort</label><div class="seg" role="group" aria-label="Who to sort"><button type="button" data-gw="all" aria-pressed="${G.who === 'all'}">Everyone · new mix</button><button type="button" data-gw="new" aria-pressed="${G.who === 'new'}">Only students without a group</button></div></div>
        <div class="rule-row" style="padding:0;border:0"><div class="grow"><div class="t" style="font-weight:600">Add a zone for each group</div><div class="s muted" style="font-size:.8125rem">Adds any missing colour zones to the board and selects them, ready to open together.</div></div><button type="button" class="switch" role="switch" id="gr-zones" aria-checked="${G.zones}" aria-label="Add a zone for each group"></button></div>
        <div><div class="section-label" style="padding-top:0">Current groups</div>
        ${groups.length || none.length ? `<div class="gr-list">${groups.map(({ g, members }) => `<div class="gr-card" style="--zc:${g.color}"><div class="gr-h"><span class="oz-dot"></span><b>${esc(g.name)}</b><span class="muted">${members.length}</span></div><div class="gr-m">${members.map(esc).join(', ')}</div></div>`).join('')}${none.length ? `<div class="gr-card"><div class="gr-h"><span class="oz-dot any"></span><b>No group</b><span class="muted">${none.length}</span></div><div class="gr-m">${none.map(esc).join(', ')}</div></div>` : ''}</div>` : '<div class="muted">Nobody is in a group yet.</div>'}</div>`;
      if (focusKey) { const f = wrap.querySelector(focusKey); if (f) f.focus({ preventScroll: true }); }
    },
    /** Buttons a host adds to the Groups sheet ([{label, hint, run}]). */
    hostActions() {
      const acts = DQBUI.host().groupActions;
      if (!Array.isArray(acts) || !acts.length) return '';
      return `<div class="field"><label>From your classes</label><div class="row" style="gap:8px;flex-wrap:wrap">${acts.map((a, k) => `<button type="button" class="btn btn-secondary btn-sm" data-host-group="${k}">${ic('users', 'sm')}${esc(a.label || 'Use groups')}</button>`).join('')}</div>${acts[0] && acts[0].hint ? `<div class="hint">${esc(typeof acts[0].hint === 'function' ? acts[0].hint() : acts[0].hint)}</div>` : ''}</div>`;
    },
    make() {
      const G = Shell.Groups, moved = Network.makeGroups(G.n, G.who === 'new');
      const zones = G.zones ? Actions.createGroupZones(G.n) : [];
      Shell.Groups.refresh();
      const parts = [];
      if (G.students().length) parts.push(moved ? `${moved} student${moved === 1 ? '' : 's'} sorted into ${G.n} groups` : 'Everyone already has a group');
      if (zones.length) parts.push(`${zones.length} zone${zones.length === 1 ? '' : 's'} added`);
      Toast.success(parts.join(' · ') || `${G.n} group zones are on the board`);
    }
  };

  Shell.Arrange = {
    open(anchor) {
      const node = $('arrange-content');
      Shell.present('arrange', node, { anchor: anchor || $('selbar'), title: 'Arrange', size: 'sm', above: true, narrow: true });
    },
    init() {
      on($('arrange-content'), 'click', e => {
        const b = e.target.closest('[data-arrange]'); if (!b) return;
        const [k, v] = b.dataset.arrange.split(':');
        if (k === 'align') Actions.align(v); else if (k === 'dist') Actions.distribute(v); else if (k === 'grid') Actions.arrangeGrid(); else if (k === 'match') Actions.matchSize();
        else if (k === 'front') Actions.bringFront(); else if (k === 'back') Actions.sendBack(); else if (k === 'bytype') Actions.collectByType(); else if (k === 'byuser') Actions.collectByUser();
        if (['front', 'back', 'bytype', 'byuser', 'grid', 'match'].includes(k)) { Shell.Flyout.close(); Overlay.closeAll(); }
      });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Accessibility view / shortcuts / print                                  */
  /* ---------------------------------------------------------------------- */
  Shell.A11y = {
    ov: null,
    open() {
      const wrap = document.createElement('div');
      Shell.A11y.ov = Overlay.open({
        title: 'Accessibility view', content: wrap, size: 'lg',
        footer: [{ label: 'Copy as text', kind: 'secondary', icon: 'copy', close: false, onClick: async () => { const ok = await DQBUI.copyText(Shell.A11y.text()); Toast[ok ? 'success' : 'warn'](ok ? 'Copied' : 'Couldn’t copy'); } }, { label: 'Close', kind: 'primary' }],
        onClose: () => { Shell.A11y.ov = null; }
      });
      Shell.A11y.refresh();
    },
    describe(i) {
      const kind = { note: (TYPES[i.sub] || TYPES.meta).lbl + (i.src ? ' sketch' : ' note'), poll: 'Poll', graph: 'Live graph', spin: 'Spinner', link: Render.linkLabel(i), media: i.type === 'media' ? Render.mediaLabel(i) : '', zone: ({ cer: 'CER builder', consensus: 'Consensus model', exit: 'Exit ticket', breakout: 'Breakout board' })[i.zoneType] || 'Zone' }[i.type] || i.type;
      let text = i.text || i.title || i.q || '';
      if (i.type === 'note' && i.src && !text) text = '(drawing)';
      if (i.type === 'zone' && i.zoneType === 'exit') text = i.prompt;
      let extra = '';
      if (i.type === 'poll') extra = (i.opts || []).map(o => `${o.lbl}: ${o.v}`).join(' · ');
      if (i.type === 'graph') extra = (i.data || []).length ? 'Values: ' + i.data.join(', ') : 'No data yet';
      if (i.type === 'spin') extra = 'Options: ' + (i.opts || []).join(', ');
      const annoInfo = () => { const c = DQBMedia.counts(i.annos); return [c.comments ? `${c.comments} comment${c.comments === 1 ? '' : 's'}` : '', c.ink ? `${c.ink} drawing${c.ink === 1 ? '' : 's'}` : '', c.marks ? `${c.marks} callout${c.marks === 1 ? '' : 's'} or hotspot${c.marks === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '); };
      if (i.type === 'link') extra = [i.desc, i.url, annoInfo(), Network.isShared(i.id) ? 'shared with students' : ''].filter(Boolean).join(' · ');
      if (i.type === 'media') extra = [i.desc, i.kind === 'video' && i.video ? DQBMedia.watchUrl(i.video) : '', annoInfo(), Network.isShared(i.id) ? 'shared with students' : ''].filter(Boolean).join(' · ');
      if (i.type === 'zone' && (State.shared || []).includes(i.id)) extra = 'shared with students to explore';
      return { kind, text: text || '(empty)', extra };
    },
    list() {
      const zones = State.items.filter(i => i.type === 'zone'), out = [], seen = new Set();
      zones.forEach(z => { out.push({ item: z, depth: 0 }); seen.add(z.id); (z.children || []).forEach(cid => { const c = State.items.find(i => i.id === cid); if (c) { out.push({ item: c, depth: 1, zone: z }); seen.add(c.id); } }); });
      State.items.forEach(i => { if (!seen.has(i.id)) out.push({ item: i, depth: 0 }); });
      return out;
    },
    text() {
      return `${State.name}\n\n` + Shell.A11y.list().map(({ item, depth }) => { const d = Shell.A11y.describe(item); return `${'  '.repeat(depth)}- ${d.kind}${item.author ? ' by ' + item.author : ''}: ${d.text}${d.extra ? ' (' + d.extra + ')' : ''}`; }).join('\n');
    },
    refresh() {
      const ov = Shell.A11y.ov; if (!ov) return;
      const rows = Shell.A11y.list();
      ov.body.innerHTML = `<p class="muted" style="margin-bottom:12px">A text-only outline of everything on the board, for screen readers and keyboard users. ${rows.length} item${rows.length === 1 ? '' : 's'}.</p>` + (rows.length ? `<div class="a11y-list" role="list">${rows.map(({ item, depth, zone }, idx) => { const d = Shell.A11y.describe(item); return `<div class="a11y-row" role="listitem" style="margin-left:${depth * 18}px"><div class="row"><span class="ty grow">${esc(d.kind)}${item.author ? ' · ' + esc(item.author) : ''}${zone ? ' · in ' + esc(zone.title) : ''}</span><button type="button" class="icon-btn sm" data-i="${idx}" aria-label="Actions for this item">${ic('more')}</button></div><div class="tx">${esc(d.text)}</div>${d.extra ? `<div class="mt">${esc(d.extra)}</div>` : ''}</div>`; }).join('')}</div>` : `<div class="empty"><div class="em-ico">${ic('note', 'lg')}</div><div class="em-t">The board is empty</div></div>`);
      $$('[data-i]', ov.body).forEach(b => on(b, 'click', () => { const it = rows[+b.dataset.i].item; Actions.sel(it.id); DQBUI.Menu.open({ anchor: b, items: Actions.menuItems(it.id), align: 'end', title: 'Item actions' }); }));
    }
  };
  Shell.Shortcuts = {
    open() {
      const rows = [['Select', 'V'], ['Hand (pan)', 'H or hold Space'], ['Draw', 'P'], ['Eraser', 'E'], ['Laser pointer', 'L'], ['New note', 'N or double-click'], ['Add menu', 'A'], ['Add to or remove from the selection', '⇧ click'], ['Delete', '⌫ / Delete'], ['Undo / redo', '⌘Z / ⇧⌘Z'], ['Duplicate', '⌘D'], ['Select all notes and ink', '⌘A'], ['Turn selected ink into one note', 'J'], ['Group / ungroup', '⌘G / ⇧⌘G'], ['Nudge selection', 'Arrow keys (⇧ = bigger)'], ['Move without snapping', 'hold Alt'], ['Zoom in / out', '+ / −'], ['Zoom 100%', '0'], ['Fit to screen', '⇧1'], ['Minimap', 'M'], ['This list', '?']];
      Overlay.open({ title: 'Keyboard shortcuts', size: 'md', content: `<div class="shortcut-grid">${rows.map(([a, k]) => `<div>${esc(a)}</div><div>${k.split(' or ').map(x => `<span class="kbd">${esc(DQBUI.kbd(x))}</span>`).join(' or ')}</div>`).join('')}</div>`, footer: [{ label: 'Close', kind: 'primary' }] });
    }
  };
  Shell.printOutline = function () {
    const rows = Shell.A11y.list(), e = esc;
    const body = rows.map(({ item, depth }) => { const d = Shell.A11y.describe(item); const tag = item.type === 'zone' ? 'h2' : 'p'; return `<${tag} style="margin-left:${depth * 22}px">${item.type === 'zone' ? '' : '• '}<b>${e(d.kind)}${item.author ? ' · ' + e(item.author) : ''}</b>${item.type === 'zone' ? ': ' + e(d.text) : ' — ' + e(d.text)}${d.extra ? `<br><small>${e(d.extra)}</small>` : ''}</${tag}>`; }).join('');
    const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const d = f.contentDocument; d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${e(State.name)}</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;margin:32px}h1{margin:0 0 4px;font-size:24px}h2{margin:22px 0 6px;font-size:17px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}p{margin:4px 0}small{color:#64748b}.meta{color:#64748b;margin-bottom:12px}</style></head><body><h1>${e(State.name)}</h1><div class="meta">${new Date().toLocaleString()} · InquiryDQB</div>${body || '<p>The board is empty.</p>'}</body></html>`);
    d.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (err) { Toast.error('Printing isn’t available here'); } setTimeout(() => f.remove(), 3000); }, 250);
  };

  /* ---------------------------------------------------------------------- */
  /* QR scanner (lazy loaded) + co-host join                                  */
  /* ---------------------------------------------------------------------- */
  Shell.scanQR = async function (hostEl, onText, onError) {
    try { await DQBUI.loadScript(DQBUI.asset('vendor/html5-qrcode.min.js')); } catch (e) { onError('The scanner couldn’t load. Type the code instead.'); return null; }
    hostEl.id = hostEl.id || ('qr-reader-' + Date.now());
    const sc = new Html5Qrcode(hostEl.id);
    try {
      await sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, (txt) => onText(txt), () => {});
    } catch (err) {
      const m = String(err && (err.name || err.message || err));
      onError(/NotAllowed|Permission/i.test(m) ? 'Camera access was blocked. Allow the camera in your browser settings, or type the code instead.' : (/NotFound|Devices/i.test(m) ? 'No camera was found on this device. Type the code instead.' : (!window.isSecureContext ? 'The camera needs a secure (https) page.' : 'The camera couldn’t start. Type the code instead.')));
      return null;
    }
    return { stop: async () => { try { await sc.stop(); sc.clear(); } catch (e) { /* ignore */ } } };
  };
  Shell.Join = {
    ov: null, scanner: null,
    open(prefill) {
      const wrap = h(`<div class="stack"><p class="text-2">Join a board that another teacher is hosting. Ask the host for their <b>co-host code</b> (Share → Add a co-host).</p><div id="reader" hidden></div><div class="error" id="jn-scan-err" hidden></div><button type="button" class="btn btn-soft btn-block" id="jn-scan">${ic('qr')}Scan co-host QR</button><div class="field"><label for="jn-code">Co-host code</label><input class="input" id="jn-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123.K7Q2X9R4" style="letter-spacing:.06em;font-weight:700" value="${esc(prefill || '')}"><div class="error" id="jn-err" hidden></div></div></div>`);
      const stop = async () => { if (Shell.Join.scanner) { await Shell.Join.scanner.stop(); Shell.Join.scanner = null; } wrap.querySelector('#reader').hidden = true; wrap.querySelector('#jn-scan').hidden = false; };
      const go = () => {
        const v = wrap.querySelector('#jn-code').value, p = Net.parseCohostInput(v), err = wrap.querySelector('#jn-err');
        if (!p) { err.textContent = 'That doesn’t look like a co-host code. It looks like ABC123.K7Q2X9R4'; err.hidden = false; return; }
        err.hidden = true; stop();
        const btn = Shell.Join.ov.footerEl.querySelector('.btn-primary'); btn.disabled = true; btn.querySelector('span').textContent = 'Connecting…';
        Network.connectAsCohost(p.code, p.key);
        clearTimeout(Shell.Join._t); Shell.Join._t = setTimeout(() => { if (Shell.Join.ov) { btn.disabled = false; btn.querySelector('span').textContent = 'Join board'; if (Network.status !== 'ready') { err.textContent = 'Couldn’t reach that board yet. Check the code and that the host has the board open.'; err.hidden = false; State.isCoHost = false; } } }, 12000);
      };
      Shell.Join.ov = Overlay.open({ title: 'Join as co-host', content: wrap, size: 'sm', initialFocus: '#jn-code', footer: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Join board', kind: 'primary', close: false, onClick: go }], onClose: () => { stop(); Shell.Join.ov = null; } });
      on(wrap.querySelector('#jn-code'), 'keydown', e => { if (e.key === 'Enter') go(); });
      on(wrap.querySelector('#jn-scan'), 'click', async () => {
        const reader = wrap.querySelector('#reader'), er = wrap.querySelector('#jn-scan-err'); er.hidden = true; reader.hidden = false; wrap.querySelector('#jn-scan').hidden = true;
        Shell.Join.scanner = await Shell.scanQR(reader, (txt) => { const p = Net.parseCohostInput(txt); if (p) { wrap.querySelector('#jn-code').value = `${p.code}.${p.key}`; stop(); go(); } else { er.textContent = 'That QR code isn’t a co-host code.'; er.hidden = false; } }, (m) => { er.textContent = m; er.hidden = false; reader.hidden = true; wrap.querySelector('#jn-scan').hidden = false; });
      });
    }
  };

  Shell.Arrange.init();
})();
