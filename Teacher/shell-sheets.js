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
      if (Shell.installPrompt) items.push({ label: 'Install app', icon: 'download', onClick: () => { Shell.installPrompt.prompt(); Shell.installPrompt = null; } });
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
      const url = Network.joinUrl(), studentPage = (new URL('../Student/', location.href)).href.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const statusHtml = s === 'ready' ? `<span class="dot ok"></span>Ready · ${n ? `${n} student${n === 1 ? '' : 's'} connected` : 'waiting for students'}`
        : s === 'connecting' ? `<span class="dot warn"></span>Connecting to the class service…`
        : `<span class="dot bad"></span>Offline — students can’t join right now`;
      const err = Network.statusInfo;
      wrap.innerHTML = `
        <div class="share-hero">
          <div class="status-line" role="status">${statusHtml}</div>
          <div class="qr-box ${s === 'ready' ? '' : 'off'}" id="share-qr" aria-label="QR code for the join link"></div>
          <div class="center"><div class="label">Join code</div><div class="code-big" id="share-code" aria-label="Join code ${esc(code || '')}">${code ? esc(Net.formatCode(code)) : '– – –'}</div></div>
          <div class="row" style="gap:8px;width:100%;flex-wrap:wrap">
            <button type="button" class="btn btn-primary grow" data-copy="code" ${code ? '' : 'disabled'}>${ic('copy')}Copy code</button>
            <button type="button" class="btn btn-secondary grow" data-copy="link" ${code ? '' : 'disabled'}>${ic('link')}Copy link</button>
            ${navigator.share ? `<button type="button" class="btn btn-secondary grow" data-share ${code ? '' : 'disabled'}>${ic('share')}Share…</button>` : ''}
          </div>
          <p class="muted center" style="font-size:.875rem">Students open <b>${esc(studentPage)}</b> and type the code, or scan the QR code with their camera. <a href="${esc(url)}" target="_blank" rel="noopener">Preview as a student ↗</a></p>
        </div>
        ${s !== 'ready' ? `<div class="help-box" style="margin-top:14px"><b>${esc(err ? err.title : (s === 'connecting' ? 'Connecting…' : 'Not connected'))}</b><div style="margin-top:4px">${esc(err ? err.msg : 'Setting up your class. This usually takes a second or two.')}</div>${s === 'error' ? `<button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" data-retry>${ic('refresh', 'sm')}Try again</button>` : ''}</div>` : ''}
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
        Shell.Share._qrHtml = qr.innerHTML;
      } else if (code && Shell.Share._qrHtml) qr.innerHTML = Shell.Share._qrHtml;
      if (!code) qr.innerHTML = `<div class="muted" style="text-align:center;padding:30px 10px">${ic('qr', 'xl')}</div>`;
      $$('[data-copy]', ov.body).forEach(b => on(b, 'click', async () => {
        const k = b.dataset.copy; const text = k === 'code' ? code : (k === 'link' ? url : Network.cohostCode());
        const ok = await DQBUI.copyText(text); Toast[ok ? 'success' : 'warn'](ok ? (k === 'code' ? 'Code copied' : (k === 'link' ? 'Link copied' : 'Co-host code copied')) : 'Couldn’t copy — select the text and copy it manually');
      }));
      on(ov.body.querySelector('[data-retry]'), 'click', () => Network.retry());
      on(ov.body.querySelector('[data-share]'), 'click', () => navigator.share({ title: 'Join my InquiryDQB board', text: `Join code ${Net.formatCode(code)}`, url }).catch(() => {}));
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
        ${isMobile() ? '' : `<div class="field"><label>Mouse wheel</label><div class="seg" id="set-wheel" role="group" aria-label="Mouse wheel behaviour"><button type="button" data-v="pan" aria-pressed="${wheel === 'pan'}">Scroll to pan</button><button type="button" data-v="zoom" aria-pressed="${wheel === 'zoom'}">Scroll to zoom</button></div><div class="hint">Pinch on a trackpad or hold Ctrl/⌘ to zoom either way.</div></div>
        <div class="field"><label>Minimap</label><div class="row" style="gap:8px"><div class="seg grow" id="set-mm-size" role="group" aria-label="Minimap size">${[[160, 'Small'], [200, 'Medium'], [260, 'Large']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${s.mmSize === v}">${l}</button>`).join('')}</div><select class="select" id="set-mm-pos" style="width:auto" aria-label="Minimap position"><option value="br">Bottom right</option><option value="bl">Bottom left</option><option value="tr">Top right</option><option value="tl">Top left</option></select></div></div>`}
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
      const cols = [['#ef4444', 'Red'], ['#f97316', 'Orange'], ['#10b981', 'Green'], ['#3b82f6', 'Blue'], ['#8b5cf6', 'Purple']];
      const wrap = h(`<div class="stack"><div class="swatches" role="group" aria-label="Zone colour">${cols.map(([c, n]) => `<button type="button" class="swatch" data-c="${c}" style="background:${c};width:44px;height:44px" aria-label="${n}" aria-pressed="${z.color === c}"></button>`).join('')}<button type="button" class="swatch" data-c="" style="width:44px;height:44px;background:var(--surface-2);display:flex;align-items:center;justify-content:center" aria-label="No colour" aria-pressed="${!z.color}">${ic('close', 'sm')}</button></div><p class="muted" style="font-size:.875rem">Colour a zone to make it a group zone: only students assigned the same colour group (Class → student menu) can add notes to it.</p></div>`);
      const ov = Overlay.open({ title: 'Zone colour', content: wrap, size: 'sm' });
      on(wrap, 'click', e => { const b = e.target.closest('[data-c]'); if (!b) return; StateManager.updateItem(id, { color: b.dataset.c || null }); ov.close(); });
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
      const kind = { note: (TYPES[i.sub] || TYPES.meta).lbl + (i.src ? ' sketch' : ' note'), poll: 'Poll', graph: 'Live graph', spin: 'Spinner', zone: ({ cer: 'CER builder', consensus: 'Consensus model', exit: 'Exit ticket', breakout: 'Breakout board' })[i.zoneType] || 'Zone' }[i.type] || i.type;
      let text = i.text || i.title || i.q || '';
      if (i.type === 'note' && i.src && !text) text = '(drawing)';
      if (i.type === 'zone' && i.zoneType === 'exit') text = i.prompt;
      let extra = '';
      if (i.type === 'poll') extra = (i.opts || []).map(o => `${o.lbl}: ${o.v}`).join(' · ');
      if (i.type === 'graph') extra = (i.data || []).length ? 'Values: ' + i.data.join(', ') : 'No data yet';
      if (i.type === 'spin') extra = 'Options: ' + (i.opts || []).join(', ');
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
      const rows = [['Select', 'V'], ['Hand (pan)', 'H or hold Space'], ['Draw', 'P'], ['Eraser', 'E'], ['Laser pointer', 'L'], ['New note', 'N or double-click'], ['Add menu', 'A'], ['Delete', '⌫ / Delete'], ['Undo / redo', '⌘Z / ⇧⌘Z'], ['Duplicate', '⌘D'], ['Select all', '⌘A'], ['Group / ungroup', '⌘G / ⇧⌘G'], ['Nudge selection', 'Arrow keys (⇧ = bigger)'], ['Zoom in / out', '+ / −'], ['Zoom 100%', '0'], ['Fit to screen', '⇧1'], ['Minimap', 'M'], ['This list', '?']];
      Overlay.open({ title: 'Keyboard shortcuts', size: 'md', content: `<div class="shortcut-grid">${rows.map(([a, k]) => `<div>${esc(a)}</div><div>${k.split(' or ').map(x => `<span class="kbd">${esc(x)}</span>`).join(' or ')}</div>`).join('')}</div><p class="muted" style="margin-top:14px;font-size:.8125rem">On Windows and Linux use Ctrl instead of ⌘.</p>`, footer: [{ label: 'Close', kind: 'primary' }] });
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
    try { await DQBUI.loadScript('../vendor/html5-qrcode.min.js'); } catch (e) { onError('The scanner couldn’t load. Type the code instead.'); return null; }
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
