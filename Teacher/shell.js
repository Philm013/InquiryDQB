/* ==========================================================================
   InquiryDQB Teacher — UI shell (chrome)
   Top bar · tool rail · flyouts · selection toolbar · class panel · bottom nav
   The same chrome drives the board, a consensus model, and a breakout room via Workspace.
   ========================================================================== */
(function () {
  'use strict';
  const { Overlay, Menu, Toast, Theme } = DQBUI;
  const isMobile = DQBUI.isMobile;
  const ic = icon;
  const mq = window.matchMedia('(max-width: 767px)');
  const on = (el, ev, fn, o) => { if (el) el.addEventListener(ev, fn, o); };
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const Shell = window.Shell = {
    defaultTool: () => (window.matchMedia('(pointer: coarse)').matches ? 'pan' : 'select'),
    settings: { mmOn: null, mmPos: 'br', mmSize: 200 }
  };

  /* ====================================================================== */
  /* Presenting content: desktop flyout next to a trigger / phone sheet      */
  /* ====================================================================== */
  Shell.Flyout = {
    cur: null,
    open(name, anchor, node, o) {
      o = o || {};
      if (Shell.Flyout.cur && Shell.Flyout.cur.name === name) { Shell.Flyout.close(); return; }
      Shell.Flyout.close();
      const fly = document.createElement('div');
      fly.className = 'flyout' + (o.narrow ? ' narrow' : '');
      fly.setAttribute('role', 'dialog'); fly.setAttribute('aria-label', o.title || name);
      if (o.title) { const t = document.createElement('div'); t.className = 'flyout-title'; t.innerHTML = `<span>${DQBUI.esc(o.title)}</span>`; fly.appendChild(t); }
      fly.appendChild(node); node.hidden = false;
      $('app').appendChild(fly);
      const r = anchor.getBoundingClientRect(), fw = fly.offsetWidth, fh = fly.offsetHeight;
      let left = o.below ? r.left : r.right + 12, top = o.below ? r.bottom + 10 : r.top;
      if (o.above) { left = r.left; top = r.top - fh - 10; }
      left = Math.max(12, Math.min(left, window.innerWidth - fw - 12));
      top = Math.max(70, Math.min(top, window.innerHeight - fh - 12));
      fly.style.left = left + 'px'; fly.style.top = top + 'px';
      const onDown = (e) => { if (!fly.contains(e.target) && !anchor.contains(e.target) && !e.target.closest('.menu, .ov')) Shell.Flyout.close(); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); Shell.Flyout.close(); anchor.focus(); } };
      setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
      document.addEventListener('keydown', onKey, true);
      anchor.setAttribute('aria-expanded', 'true');
      Shell.Flyout.cur = { name, fly, node, anchor, onDown, onKey, onClose: o.onClose };
      const first = fly.querySelector('button, input'); if (first && o.focus) first.focus();
    },
    close() {
      const c = Shell.Flyout.cur; if (!c) return;
      Shell.Flyout.cur = null;
      document.removeEventListener('pointerdown', c.onDown, true); document.removeEventListener('keydown', c.onKey, true);
      c.anchor.removeAttribute('aria-expanded');
      $('stash').appendChild(c.node);
      c.fly.remove();
      if (c.onClose) c.onClose();
    }
  };
  Shell.closeFlyouts = () => { Shell.Flyout.close(); };

  /** Shows a stash node as a flyout (desktop) or bottom sheet (phones). */
  Shell.present = function (name, node, o) {
    o = o || {};
    if (!isMobile() && o.anchor) { Shell.Flyout.open(name, o.anchor, node, o); return null; }
    Shell.Flyout.close();
    const ov = Overlay.open({ title: o.title || '', content: node, size: o.size || 'md', className: o.tall ? 'tall' : '', onClose: () => { $('stash').appendChild(node); if (o.onClose) o.onClose(); } });
    node.hidden = false;
    return ov;
  };

  /* ---------------------------------------------------------------------- */
  /* Insert menu                                                             */
  /* ---------------------------------------------------------------------- */
  Shell.Insert = {
    ov: null,
    open(anchor) {
      const node = $('insert-content');
      const bk = Workspace.mode === 'breakout';
      $$('[data-add="breakout"], [data-add="consensus"]', node).forEach(b => { b.hidden = bk; });
      $$('[data-act="templates"]', node).forEach(b => { b.hidden = !Workspace.caps().templates; });
      Shell.Insert.ov = Shell.present('insert', node, { anchor: anchor || $('rail-add'), title: 'Add to board', size: 'md', tall: false, onClose: () => { Shell.Insert.ov = null; Shell.syncNav(); } });
      Shell.syncNav();
    },
    close() { Shell.Flyout.close(); if (Shell.Insert.ov) Shell.Insert.ov.close(); },
    toggle() { if (Shell.Flyout.cur && Shell.Flyout.cur.name === 'insert') Shell.Flyout.close(); else if (Shell.Insert.ov) Shell.Insert.ov.close(); else if (Workspace.caps().insert) Shell.Insert.open(); },
    init() {
      on($('insert-content'), 'click', (e) => {
        const t = e.target.closest('[data-add], [data-exit], [data-act]'); if (!t) return;
        if (t.dataset.act === 'templates') { Shell.Insert.close(); Shell.Templates.open(); return; }
        Shell.Insert.close();
        if (t.dataset.add) { const [type, sub] = t.dataset.add.split(':'); Workspace.insert(type, sub); }
        else if (t.dataset.exit) Workspace.insertExit(t.dataset.exit);
      });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Drawing options + tools                                                 */
  /* ---------------------------------------------------------------------- */
  const SWATCHES = [['#ef4444', 'Red'], ['#f97316', 'Orange'], ['#eab308', 'Yellow'], ['#10b981', 'Green'], ['#3b82f6', 'Blue'], ['#8b5cf6', 'Purple'], ['#111827', 'Black'], ['#ffffff', 'White']];
  Shell.Draw = {
    ov: null,
    init() {
      const sw = $('swatches');
      sw.innerHTML = SWATCHES.map(([c, n]) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="${n}" aria-pressed="false"></button>`).join('');
      on(sw, 'click', e => { const b = e.target.closest('[data-color]'); if (b) Workspace.setColor(b.dataset.color); });
      on($('draw-width'), 'input', e => Workspace.setWidth(e.target.value));
      on($('brush-seg'), 'click', e => { const b = e.target.closest('[data-brush]'); if (b) Workspace.setBrush(b.dataset.brush); });
      on($('sketch-seg'), 'click', e => { const b = e.target.closest('[data-sketch]'); if (b) Workspace.setSketch(b.dataset.sketch === '1'); });
      on($('draw-pin'), 'click', () => Workspace.pinInk());
      on($('draw-clear'), 'click', () => Workspace.clearInk());
    },
    open(anchor) {
      Shell.syncDraw();
      Shell.Draw.ov = Shell.present('draw', $('draw-content'), { anchor: anchor || $('rail-draw'), title: 'Drawing', size: 'sm', onClose: () => { Shell.Draw.ov = null; } });
    }
  };
  Shell.syncDraw = function () {
    const d = Workspace.draw(), caps = Workspace.caps();
    $$('#swatches .swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === String(d.color).toLowerCase())));
    const w = $('draw-width'); if (w && +w.value !== +d.width) w.value = d.width;
    const wv = $('draw-width-val'); if (wv) wv.textContent = d.width + ' px';
    const dot = $('width-dot'); if (dot) { const s = Math.max(3, Math.min(30, d.width)); dot.style.width = dot.style.height = s + 'px'; dot.style.background = d.color; dot.style.boxShadow = d.color.toLowerCase() === '#ffffff' ? '0 0 0 1px var(--border-strong)' : 'none'; }
    $('brush-field').hidden = !caps.brush;
    $$('#brush-seg [data-brush]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.brush === d.brush)));
    $('sketch-field').hidden = !caps.sketch;
    $$('#sketch-seg [data-sketch]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.sketch === '1') === !!d.sketch)));
    $('sketch-hint').textContent = d.sketch ? 'Each stroke becomes its own movable note — great for quick sketches.' : 'Drawing stays on the board as ink. Use Pin to turn it into notes.';
    $('draw-pin').hidden = !caps.pin;
    // keep the selected ink stroke in step
    Shell.SelBar.render();
  };

  /* Tools sheet (phones): tool switcher + drawing options + view controls + undo/redo */
  Shell.Tools = {
    ov: null,
    open() {
      const wrap = document.createElement('div'); wrap.className = 'stack'; wrap.style.gap = '18px';
      const caps = Workspace.caps();
      const tools = [['select', 'select', 'Select'], ['pan', 'hand', 'Move'], ['draw', 'pen', 'Draw'], ['eraser', 'eraser', 'Erase']].concat(caps.laser ? [['laser', 'laser', 'Laser']] : []);
      const toolsHtml = `<div class="tile-grid" style="grid-template-columns:repeat(${tools.length},1fr)" role="group" aria-label="Tool">${tools.map(([t, i, l]) => `<button type="button" class="tile" data-tool="${t}" aria-pressed="${Workspace.tool() === t}" style="${Workspace.tool() === t ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">${ic(i)}<span>${l}</span></button>`).join('')}</div>`;
      wrap.innerHTML = toolsHtml +
        (Workspace.mode === 'board' ? `<div class="rule-row" style="padding:0;border:0"><div class="grow"><div class="t" style="font-weight:600">Box-select with one finger</div><div class="s muted" style="font-size:.8125rem">Drag on empty space to select several notes.</div></div><button type="button" class="switch" role="switch" id="t-multi" aria-checked="${State.multiSelect}" aria-label="Box select"></button></div>` : '') +
        `<div class="row" style="gap:8px"><button type="button" class="btn btn-secondary grow" id="t-undo" ${Workspace.canUndo() ? '' : 'disabled'}>${ic('undo')}Undo</button><button type="button" class="btn btn-secondary grow" id="t-redo" ${Workspace.canRedo() ? '' : 'disabled'}>${ic('redo')}Redo</button></div>` +
        `<div class="field"><label>View</label><div class="row" style="gap:8px"><button type="button" class="icon-btn soft lg" id="t-zout" aria-label="Zoom out">${ic('minus')}</button><div class="grow center" style="font-weight:700" id="t-pct">${Workspace.zoomPct()}%</div><button type="button" class="icon-btn soft lg" id="t-zin" aria-label="Zoom in">${ic('plus')}</button><button type="button" class="btn btn-secondary" id="t-fit">${ic('fit')}Fit</button></div></div>` +
        (caps.minimap ? `<div class="rule-row" style="padding:0;border:0"><div class="grow"><div class="t" style="font-weight:600">Show minimap</div></div><button type="button" class="switch" role="switch" id="t-mm" aria-checked="${Shell.mmVisible()}" aria-label="Show minimap"></button></div>` : '') +
        `<div id="t-draw-mount"></div>`;
      const draw = $('draw-content');
      const ov = Overlay.open({ title: 'Tools', content: wrap, size: 'md', onClose: () => { $('stash').appendChild(draw); Shell.Tools.ov = null; Shell.syncNav(); } });
      Shell.Tools.ov = ov;
      draw.hidden = false; wrap.querySelector('#t-draw-mount').appendChild(draw); Shell.syncDraw();
      const mount = wrap.querySelector('#t-draw-mount'); mount.hidden = Workspace.tool() !== 'draw';
      on(wrap, 'click', (e) => {
        const t = e.target.closest('[data-tool]');
        if (t) { Workspace.setTool(t.dataset.tool); if (t.dataset.tool === 'draw') { wrap.querySelector('#t-draw-mount').hidden = false; $$('[data-tool]', wrap).forEach(b => { const a = b.dataset.tool === 'draw'; b.style.cssText = a ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''; }); } else ov.close(); return; }
        if (e.target.closest('#t-undo')) { Workspace.undo(); ov.close(); }
        else if (e.target.closest('#t-redo')) { Workspace.redo(); ov.close(); }
        else if (e.target.closest('#t-zin')) { Workspace.zoomBy(1.25); $('t-pct').textContent = Workspace.zoomPct() + '%'; }
        else if (e.target.closest('#t-zout')) { Workspace.zoomBy(0.8); $('t-pct').textContent = Workspace.zoomPct() + '%'; }
        else if (e.target.closest('#t-fit')) { Workspace.fit(); ov.close(); }
        else if (e.target.closest('#t-mm')) { const b = $('t-mm'); const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); Shell.setMinimap(v); }
        else if (e.target.closest('#t-multi')) { const b = $('t-multi'); const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); State.multiSelect = v; if (v) window.setTool('select'); Shell.syncTools(); }
      });
      Shell.syncNav();
    }
  };

  /* ====================================================================== */
  /* Status: connection · save · zoom · history                              */
  /* ====================================================================== */
  Shell.syncConn = function () {
    const chip = $('conn-chip'), dot = $('conn-dot'), lab = $('conn-label'); if (!chip) return;
    const s = Network.status, n = Network.studentCount();
    chip.classList.remove('ready', 'error', 'connecting');
    dot.className = 'dot';
    if (State.isCoHost) {
      const host = !!State.students['HOST'];
      chip.classList.add(host ? 'ready' : 'connecting'); dot.classList.add(host ? 'ok' : 'warn'); lab.textContent = host ? 'Co-host' : 'Reconnecting…';
    } else if (s === 'ready') { chip.classList.add('ready'); dot.classList.add('ok'); lab.textContent = n ? `${n} online` : Net.formatCode(Network.getCode() || ''); }
    else if (s === 'connecting') { chip.classList.add('connecting'); dot.classList.add('warn'); lab.textContent = 'Connecting…'; }
    else if (s === 'error') { chip.classList.add('error'); dot.classList.add('bad'); lab.textContent = 'Offline'; }
    else { dot.className = 'dot'; lab.textContent = 'Not shared'; }
    chip.setAttribute('aria-label', `Connection: ${lab.textContent}. Open sharing options`);
    Shell.Panel.updateCounts();
    if (Shell.Share.ov) Shell.Share.refresh();
  };
  let saveTimer = null;
  Shell.setSave = function (state, msg) {
    const el = $('save-status'); if (!el) return;
    el.className = 'save-status ' + (state === 'saving' ? 'saving' : (state === 'error' ? 'err' : ''));
    const label = state === 'saving' ? 'Saving…' : (state === 'error' ? 'Not saved' : 'Saved');
    el.innerHTML = ic(state === 'error' ? 'warn' : (state === 'saving' ? 'refresh' : 'check'), 'sm') + `<span>${label}</span>`;
    el.title = state === 'error' ? (msg || 'This board could not be saved on this device') : 'Saved on this device';
    if (state === 'error' && !Shell._saveWarned) { Shell._saveWarned = true; Toast.warn('This board couldn’t be saved on this device. Export it from the menu to keep a copy.', { duration: 7000 }); }
    if (state === 'saved') Shell._saveWarned = false;
  };
  Shell.onDbError = function () { Toast.warn('Your browser is blocking local storage, so boards can’t be saved here. You can still run a session and export the board.', { duration: 8000 }); const n = $('saved-list'); if (n) Shell.Home.render(); };
  Shell.syncZoom = function () { const z = $('zoom-pct'); if (z) { const t = Workspace.zoomPct() + '%'; if (z.textContent !== t) { z.textContent = t; z.setAttribute('aria-label', t + ' zoom, open zoom menu'); } } };
  Shell.syncHistory = function () {
    const u = $('rail-undo'), r = $('rail-redo'); if (!u) return;
    u.disabled = !Workspace.canUndo(); r.disabled = !Workspace.canRedo();
  };
  Shell.syncName = function () { const n = $('board-name'); if (n && document.activeElement !== n) n.value = State.name; };
  Shell.leaveBoard = function () { /* co-host auth failed before entering a board */ const s = Shell.Join && Shell.Join.ov; if (s) s.close(); };

  /* ====================================================================== */
  /* Tool rail / nav sync                                                    */
  /* ====================================================================== */
  Shell.syncTools = function () {
    const t = Workspace.tool(), caps = Workspace.caps();
    $$('#rail [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('rail-laser').hidden = !caps.laser; $('rail-add').hidden = !caps.insert;
    const modeLabels = { draw: 'Drawing', eraser: 'Eraser', laser: 'Laser pointer' };
    const chip = $('mode-chip');
    const showChip = isMobile() && (modeLabels[t] || (State.multiSelect && t === 'select' && Workspace.mode === 'board'));
    chip.hidden = !showChip;
    if (showChip) { $('mode-chip-label').textContent = modeLabels[t] || 'Box select'; chip.querySelector('.i').outerHTML = ic(t === 'eraser' ? 'eraser' : (t === 'laser' ? 'laser' : (t === 'select' ? 'select' : 'pen')), 'sm'); }
    Shell.syncNav(); Shell.syncHistory(); Shell.SelBar.render();
  };
  Shell.syncRoomColor = function () {
    const z = Breakout._getZone(); if (!z) return;
    $$('#room-colors .swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === (z.roomColor || '#8b5cf6'))));
  };

  /* mobile bottom navigation: rebuilt per workspace */
  Shell.syncNav = function () {
    const nav = $('bottomnav'); if (!nav) return;
    const m = Workspace.mode, t = Workspace.tool();
    const panelOpen = Shell.Panel.isOpen(), insertOpen = !!Shell.Insert.ov, toolsOpen = !!Shell.Tools.ov;
    const q = Shell.queueCount ? Shell.queueCount() : 0, n = Network.studentCount();
    const items = [];
    if (m === 'board') {
      items.push({ id: 'nav-board', i: 'note', l: 'Board', cur: !panelOpen && !insertOpen && !toolsOpen, f: () => { Overlay.closeAll(); Viewport.fit(); } });
      items.push({ id: 'nav-class', i: 'users', l: 'Class', act: panelOpen, badge: (q || n) ? (q ? q : n) : 0, f: () => Shell.Panel.toggle() });
      items.push({ id: 'nav-add', fab: true, i: 'plus', l: 'Add', f: () => Shell.Insert.toggle() });
      items.push({ id: 'nav-tools', i: t === 'draw' ? 'pen' : (t === 'eraser' ? 'eraser' : (t === 'laser' ? 'laser' : 'hand')), l: 'Tools', act: toolsOpen || ['draw', 'eraser', 'laser'].includes(t), f: () => Shell.Tools.open() });
      items.push({ id: 'nav-more', i: 'more', l: 'More', f: () => Shell.More.open() });
    } else {
      items.push({ id: 'nav-hand', i: t === 'select' ? 'select' : 'hand', l: t === 'select' ? 'Select' : 'Move', f: () => Workspace.setTool(t === 'pan' ? 'select' : 'pan') });
      items.push({ id: 'nav-tools', i: 'pen', l: 'Draw', act: toolsOpen || ['draw', 'eraser', 'laser'].includes(t), f: () => Shell.Tools.open() });
      if (Workspace.caps().insert) items.push({ id: 'nav-add', fab: true, i: 'plus', l: 'Add', f: () => Shell.Insert.toggle() });
      else items.push({ id: 'nav-undo', fab: true, i: 'undo', l: 'Undo', f: () => Workspace.undo() });
      items.push({ id: 'nav-class', i: 'users', l: m === 'consensus' ? 'Students' : 'Room', act: panelOpen, f: () => Shell.Panel.toggle() });
      items.push({ id: 'nav-exit', i: 'stop', l: m === 'consensus' ? 'End' : 'Close', danger: true, f: () => Workspace.exit() });
    }
    nav.innerHTML = items.map(it => `<button type="button" class="nav-btn${it.fab ? ' nav-fab' : ''}${it.act ? ' active' : ''}${it.danger ? ' danger' : ''}" id="${it.id}" ${it.cur ? 'aria-current="page"' : ''} ${it.fab ? `aria-label="${it.l}"` : ''}>${it.fab ? `<span class="fab">${ic(it.i, 'lg')}</span>` : ic(it.i) + `<span>${it.l}</span>`}${it.badge ? `<span class="badge nav-badge">${it.badge}</span>` : ''}</button>`).join('');
    items.forEach(it => on($(it.id), 'click', it.f));
  };

  /* ====================================================================== */
  /* Selection toolbar                                                       */
  /* ====================================================================== */
  Shell.SelBar = {
    ctx() {
      if (Workspace.mode === 'board') {
        if (InkManager.selectedId) return { kind: 'ink' };
        const sel = State.selection.map(id => State.items.find(i => i.id === id)).filter(Boolean);
        if (sel.length === 1) return { kind: 'one', item: sel[0] };
        if (sel.length > 1) return { kind: 'many', items: sel };
      } else if (Workspace.mode === 'breakout' && Breakout._state.selectedId) return { kind: 'bk' };
      return null;
    },
    btn(o) {
      // the accessible name must contain the visible text (WCAG 2.5.3): "Idea" + "Change type" → "Idea – change type"
      const vis = o.label ? `${o.emoji ? o.emoji + ' ' : ''}${o.label}` : '';
      const name = vis ? ((o.title && o.title.toLowerCase().indexOf(o.label.toLowerCase()) === 0) ? o.title : (o.title && o.title !== o.label ? `${vis} – ${o.title.charAt(0).toLowerCase()}${o.title.slice(1)}` : vis)) : (o.title || o.id);
      return `<button type="button" class="sb-btn${o.danger ? ' danger' : ''}${o.accent ? ' accent' : ''}${o.on ? ' on' : ''}${o.keep ? ' keep-label' : ''}" data-sb="${o.id}" aria-label="${DQBUI.esc(name)}" title="${DQBUI.esc(o.title || o.label || '')}">${o.icon ? ic(o.icon) : ''}${o.emoji ? `<span class="sb-emoji">${DQBUI.esc(o.emoji)}</span>` : ''}${o.label ? `<span>${DQBUI.esc(o.label)}</span>` : ''}${o.dot ? `<span class="sb-dot" style="background:${o.dot}"></span>` : ''}</button>`; },
    render() {
      const bar = $('selbar'); if (!bar) return;
      const c = Shell.SelBar.ctx();
      if (!c) { bar.hidden = true; bar.innerHTML = ''; Shell.SelBar.actions = {}; return; }
      const A = Shell.SelBar.actions = {}; const B = Shell.SelBar.btn; const parts = [];
      const add = (o, fn) => { parts.push(B(o)); A[o.id] = fn; };
      const sep = () => parts.push('<span class="sb-sep"></span>');
      const more = (id) => add({ id: 'more', icon: 'more', title: 'More actions' }, (e) => DQBUI.Menu.open({ anchor: e.currentTarget, items: Actions.menuItems(id), align: 'end', place: isMobile() ? 'above' : 'below' }));
      if (c.kind === 'ink') {
        ['#ef4444', '#3b82f6', '#10b981', '#111827', '#f97316'].forEach(col => add({ id: 'ink-' + col, dot: col, title: 'Colour ' + col }, () => InkManager.colorSelected(col)));
        sep(); add({ id: 'ink-pin', icon: 'pin', label: 'Pin', keep: true, title: 'Turn this stroke into a note' }, () => InkManager.pinSelected());
        add({ id: 'ink-del', icon: 'trash', danger: true, title: 'Delete stroke' }, () => InkManager.deleteSelected());
      } else if (c.kind === 'bk') {
        add({ id: 'bk-del', icon: 'trash', danger: true, label: 'Delete', keep: true, title: 'Delete item' }, () => Breakout.deleteSelected());
      } else if (c.kind === 'many') {
        parts.push(`<span class="sb-count">${c.items.length} selected</span>`); sep();
        const grouped = !!c.items[0].groupId;
        add({ id: 'grp', icon: grouped ? 'ungroup' : 'group', title: grouped ? 'Ungroup' : 'Group' }, grouped ? Actions.ungroupSelection : Actions.groupSelection);
        add({ id: 'arr', icon: 'grid', title: 'Arrange' }, (e) => Shell.Arrange.open(e.currentTarget));
        if (c.items.some(i => i.type === 'note')) add({ id: 'mtz', icon: 'zone', title: 'Move to zone' }, () => Actions.showZoneList());
        add({ id: 'dup', icon: 'copy', title: 'Duplicate' }, Actions.duplicate);
        sep(); add({ id: 'del', icon: 'trash', danger: true, title: 'Delete' }, () => Actions.delete());
      } else {
        const it = c.item, id = it.id;
        const live = !!it.isOpen;
        if (it.type === 'note') {
          if (!it.src) add({ id: 'edit', icon: 'pencil', label: 'Edit', keep: true, accent: true, title: 'Edit text' }, () => Actions.editText(id));
          if (!it.src) add({ id: 'type', emoji: (TYPES[it.sub] || TYPES.meta).icon, label: (TYPES[it.sub] || TYPES.meta).lbl, title: 'Change note type' }, (e) => DQBUI.Menu.open({ anchor: e.currentTarget, place: isMobile() ? 'above' : 'below', items: ['notice', 'wonder', 'idea', 'test'].map(k => ({ label: `${TYPES[k].icon}  ${TYPES[k].lbl}`, checked: it.sub === k, onClick: () => Actions.setType(id, k) })) }));
          add({ id: 'zone', icon: 'zone', title: 'Move to a zone' }, () => Actions.showZoneList());
        } else if (it.type === 'zone') {
          if (it.zoneType === 'consensus') add({ id: 'model', icon: 'consensus', label: 'Start modeling', keep: true, accent: true }, () => Consensus.start(id));
          else if (it.zoneType === 'breakout') add({ id: 'launch', icon: 'rocket', label: 'Launch', keep: true, accent: true }, () => Breakout.open(id));
          else if (it.zoneType === 'exit') add({ id: 'bcast', icon: live ? 'stop' : 'broadcast', label: live ? 'Stop' : 'Broadcast', keep: true, accent: !live, on: live }, () => Network.toggleZone(id));
          else {
            add({ id: 'open', icon: live ? 'stop' : 'broadcast', label: live ? 'Stop' : 'Open', keep: true, accent: !live, on: live, title: live ? 'Stop this activity' : 'Let students add notes to this zone' }, () => Network.toggleZone(id));
            sep();
            add({ id: 'vote', icon: 'vote', label: 'Vote', title: 'Students vote on the notes in this zone' }, () => Network.startActivity('vote'));
            add({ id: 'rank', icon: 'rank', label: 'Rank', title: 'Students rank the notes' }, () => Network.startActivity('sort'));
            add({ id: 'disc', icon: 'discuss', label: 'Discuss', title: 'Students comment on the notes' }, () => Network.startActivity('discuss'));
            sep();
            add({ id: 'colour', icon: 'palette', title: 'Zone colour' }, () => Shell.ColorPick.open(id));
          }
        } else if (it.type === 'poll' || it.type === 'graph') {
          add({ id: 'bcast', icon: live ? 'stop' : 'broadcast', label: live ? 'Stop' : 'Broadcast', keep: true, accent: !live, on: live }, () => Network.toggleZone(id));
          if (it.type === 'poll') add({ id: 'edit', icon: 'pencil', title: 'Edit poll' }, () => Actions.editPoll(id));
        } else if (it.type === 'spin') {
          add({ id: 'spin', icon: 'spin', label: 'Spin', keep: true, accent: true }, () => Actions.spin(id));
          add({ id: 'edit', icon: 'pencil', title: 'Edit options' }, () => Actions.editSpin(id));
        }
        sep();
        add({ id: 'lock', icon: it.locked ? 'unlock' : 'lock', on: !!it.locked, title: it.locked ? 'Unlock' : 'Lock in place' }, () => Actions.toggleLock(id));
        add({ id: 'dup', icon: 'copy', title: 'Duplicate' }, () => Actions.duplicate());
        more(id);
        add({ id: 'del', icon: 'trash', danger: true, title: 'Delete' }, () => Actions.delete(id));
      }
      bar.innerHTML = parts.join('');
      bar.hidden = false;
      Shell._selSig = null;
      Shell.positionSelBar();
    },
    init() {
      on($('selbar'), 'click', (e) => { const b = e.target.closest('[data-sb]'); if (b && Shell.SelBar.actions[b.dataset.sb]) { e.stopPropagation(); Shell.SelBar.actions[b.dataset.sb](e); } });
      on($('selbar'), 'pointerdown', e => e.stopPropagation());
    }
  };
  Shell.onSelection = function () { Shell.SelBar.render(); Shell.Panel.onSelection && Shell.Panel.onSelection(); };
  Shell.positionSelBar = function () {
    const bar = $('selbar'); if (!bar || bar.hidden) return;
    if (isMobile()) { bar.style.left = bar.style.top = ''; bar.style.translate = ''; bar.style.opacity = State.drag && State.drag.mode === 'move' && State.drag.moved ? '0.3' : ''; return; }
    const c = Shell.SelBar.ctx(); if (!c) return;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    if (c.kind === 'ink') { const p = InkManager.selPoint || { x: innerWidth / 2, y: innerHeight / 2 }; l = r = p.x; t = b = p.y; }
    else {
      const ids = c.kind === 'bk' ? ['bk-' + Breakout._state.selectedId] : State.selection;
      ids.forEach(id => { const el = document.getElementById(id); if (!el) return; const rc = el.getBoundingClientRect(); l = Math.min(l, rc.left); t = Math.min(t, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom); });
    }
    if (!isFinite(l)) { bar.style.opacity = '0'; return; }
    const w = bar.offsetWidth, h = bar.offsetHeight;
    let x = (l + r) / 2, y = t - 14, below = false;
    if (y - h < 70) { y = b + 14; below = true; }
    x = Math.max(w / 2 + 12, Math.min(innerWidth - w / 2 - 12, x));
    y = Math.max(h + 70, Math.min(innerHeight - 20 - (below ? h : 0), y));
    bar.style.left = x + 'px'; bar.style.top = y + 'px';
    bar.style.translate = below ? '-50% 0' : '-50% -100%';
    bar.style.opacity = (State.drag && (State.drag.mode === 'move' || State.drag.mode === 'pan') && (State.drag.moved || State.drag.mode === 'pan')) ? '0.25' : '';
  };

  /* ====================================================================== */
  /* After-render hooks, empty state, board state, activity, queue           */
  /* ====================================================================== */
  Shell.afterRender = function () {
    const empty = $('empty-state');
    if (empty) empty.hidden = !(Workspace.mode === 'board' && !State.items.length && !State.ink.length && !State.isCoHost && !$('app').hidden);
    Shell.SelBar.render();
    Shell.syncBoardState(); Shell.syncActivity();
    if (Shell.Comments.ov) Shell.Comments.refresh();
    if (Shell.A11y.ov) Shell.A11y.refresh();
    Shell.checkContentVisible();
  };
  Shell.checkContentVisible = function () {
    const pill = $('home-pill'); if (!pill) return;
    const show = Workspace.mode === 'board' && !$('app').hidden && State.items.length > 0 && !Viewport.isContentVisible();
    if (pill.hidden === show) pill.hidden = !show;
  };
  Shell.syncBoardState = function () {
    const a = State.activity.type, lock = $('state-lock'), open = $('state-open'); if (!lock) return;
    const card = $('board-state');
    const isOpen = a === 'OPEN', isLocked = a === 'LOCKED', running = !isOpen && !isLocked;
    lock.setAttribute('aria-pressed', String(isLocked)); open.setAttribute('aria-pressed', String(isOpen));
    $('state-title').textContent = isOpen ? 'Board is open' : (isLocked ? 'Board is locked' : 'Activity running');
    $('state-sub').textContent = isOpen ? 'Students can add notes right now.' : (isLocked ? 'Students can watch but not add notes.' : 'Stop the activity to lock or open the board.');
    $('state-pill').hidden = isLocked; card.classList.toggle('open', isOpen || running);
  };
  Shell.syncActivity = function () {
    const a = State.activity; const ctl = $('act-controls'); if (!ctl) return;
    const running = a.type !== 'LOCKED' && a.type !== 'OPEN';
    ctl.hidden = !running;
    if (running) {
      const it = State.items.find(i => i.id === a.targetId);
      const kind = a.payload && a.payload.subType || a.type;
      const names = { ACT_VOTE: 'Vote', ACT_SORT: 'Rank', ACT_DISCUSS: 'Discussion', OPEN_ZONE: 'Open zone', ACT_POLL: 'Poll', ACT_GRAPH: 'Live graph', EXIT_TICKET: 'Exit ticket' };
      $('act-name').textContent = (names[kind] || 'Activity') + (it && it.title ? ` · ${it.title}` : (it && it.q ? ` · ${it.q}` : ''));
      $('act-info').textContent = a.payload && a.payload.items && a.payload.items.length ? `${a.payload.items.length} notes · ${Network.studentCount()} students connected` : `${Network.studentCount()} students connected`;
    } else {
      const res = $('act-results');
      if (res && !res.querySelector('.empty')) res.innerHTML = `<div class="empty"><div class="em-ico">${ic('vote', 'lg')}</div><div class="em-t">No activity running</div><div>Open a zone, run a vote or rank from a zone’s toolbar, or broadcast a poll or exit ticket.</div></div>`;
    }
  };
  Shell.setActivityResults = function (html) { const r = $('act-results'); if (r) r.innerHTML = html; };
  Shell.queueCount = () => State.pending.length;
  Shell.syncQueue = function (flash) {
    const n = State.pending.length;
    const q = $('queue-count'); q.textContent = n; q.hidden = !n;
    const list = $('queue-list');
    list.innerHTML = n ? `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="section-label" style="padding:0">${n} waiting</div><button type="button" class="btn btn-soft btn-sm" data-q="all">${ic('check', 'sm')}Approve all</button></div>` +
      State.pending.map(p => `<div class="card q-card" data-id="${DQBUI.esc(p.id)}"><div class="who">${DQBUI.esc(p.avatar || '')} ${DQBUI.esc(p.studentName || p.author)} · ${DQBUI.esc((TYPES[p.sub] || TYPES.meta).lbl)}</div>${p.src ? `<img alt="Sketch" data-src="1">` : ''}<div class="txt">${DQBUI.esc(p.text)}</div><div class="q-actions"><button type="button" class="btn btn-danger-soft btn-sm" data-q="no">${ic('close', 'sm')}Decline</button><button type="button" class="btn btn-primary btn-sm" data-q="yes">${ic('check', 'sm')}Approve</button></div></div>`).join('')
      : `<div class="empty"><div class="em-ico">${ic('inbox', 'lg')}</div><div class="em-t">Nothing waiting</div><div>Turn on “Approve notes first” in Class rules and student notes will wait here for you.</div></div>`;
    $$('#queue-list img[data-src]').forEach((img, i) => { const s = DQBUI.safeImg(State.pending[i] && State.pending[i].src); if (s) img.src = s; });
    Shell.Panel.updateCounts();
    if (flash && n && !Shell.Panel.isOpen()) Toast.info(`${n} note${n === 1 ? '' : 's'} waiting for approval`, { action: { label: 'Review', onClick: () => Shell.Panel.open('queue') }, duration: 5000 });
    Shell.syncNav();
  };

  /* ====================================================================== */
  /* Class panel (docked on desktop, sheet on phones)                        */
  /* ====================================================================== */
  Shell.Panel = {
    ov: null, tab: 'students',
    isOpen() { return isMobile() ? !!Shell.Panel.ov : $('app').classList.contains('panel-open'); },
    open(tab) {
      if (tab) Shell.Panel.showTab(tab);
      if (Shell.Panel.isOpen()) return;
      const body = $('panel-body');
      Shell.Panel.updateTitle();
      if (isMobile()) {
        const ov = Overlay.open({ title: $('panel-title').textContent, content: body, size: 'lg', className: 'tall', flush: true, onClose: () => { $('panel-mount').appendChild(body); Shell.Panel.ov = null; Shell.syncNav(); } });
        Shell.Panel.ov = ov; body.hidden = false;
      } else { $('panel-mount').appendChild(body); $('app').classList.add('panel-open'); $('btn-panel').setAttribute('aria-pressed', 'true'); }
      Shell.syncNav(); Shell.Panel.renderRoster();
    },
    close() {
      if (isMobile()) { if (Shell.Panel.ov) Shell.Panel.ov.close(); }
      else { $('app').classList.remove('panel-open'); $('btn-panel').setAttribute('aria-pressed', 'false'); }
      Shell.syncNav();
    },
    toggle() { if (Shell.Panel.isOpen()) Shell.Panel.close(); else Shell.Panel.open(); },
    updateTitle() { const t = Workspace.mode === 'consensus' ? 'Participants' : (Workspace.mode === 'breakout' ? 'Breakout room' : 'Class'); $('panel-title').textContent = t; $('btn-panel').setAttribute('aria-label', t + ' panel'); $('btn-panel').dataset.tip = t; if (Shell.Panel.ov) Shell.Panel.ov.setTitle(t); },
    showTab(name) {
      Shell.Panel.tab = name;
      ['students', 'activity', 'queue'].forEach(k => { const tab = $('ptab-' + k), sec = $('pt-' + k); if (tab) tab.setAttribute('aria-selected', String(k === name)); if (sec) sec.hidden = k !== name; });
    },
    updateCounts() {
      const n = Network.studentCount(), q = State.pending.length;
      const b = $('conn-badge'); if (b) { b.textContent = q || n; b.hidden = !(q || n); }
      $('roster-count').textContent = n; $('roster-count2').textContent = n ? `· ${n}` : '';
    },
    onSelection: null,
    flashJoined(s) { Toast.show(`${s.avatar} ${s.name} joined`, { duration: 2200 }); },
    flashLeft(s) { /* silent: students drop off and rejoin often */ },
    renderRoster() {
      Shell.Panel.updateCounts();
      const box = $('roster'); if (!box) return;
      const list = Object.entries(State.students).filter(([, s]) => s.role === 'student').sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
      const cohosts = Object.values(State.students).filter(s => s.role === 'cohost').length;
      if (!list.length) {
        box.innerHTML = `<div class="empty"><div class="em-ico">${ic('users', 'lg')}</div><div class="em-t">Waiting for students</div><div>Share the code or QR so students can join from any phone, tablet or laptop.</div><button type="button" class="btn btn-primary" id="roster-share">${ic('qr')}Show join code</button></div>`;
        on($('roster-share'), 'click', () => Shell.Share.open());
      } else {
        const COLORS = { '#ef4444': 'Red', '#3b82f6': 'Blue', '#10b981': 'Green', '#f97316': 'Orange', '#8b5cf6': 'Purple' };
        box.innerHTML = list.map(([pid, s]) => `<div class="stu${State.muted[s.sid] ? ' muted-stu' : ''}"><div class="av">${DQBUI.esc(s.avatar)}${s.color ? `<span class="pip" style="background:${DQBUI.safeColor(s.color)}"></span>` : ''}</div><div class="grow"><div class="nm truncate">${DQBUI.esc(s.name)}</div><div class="st">${State.muted[s.sid] ? 'Muted · can’t add notes' : (s.color ? (COLORS[s.color] || 'Group') + ' group' : 'Connected')}</div></div><button type="button" class="icon-btn" data-pid="${DQBUI.esc(pid)}" aria-label="Actions for ${DQBUI.esc(s.name)}">${ic('more')}</button></div>`).join('') + (cohosts ? `<div class="stu"><div class="av">👑</div><div class="grow"><div class="nm">Co-host${cohosts > 1 ? 's' : ''}</div><div class="st">${cohosts} connected</div></div></div>` : '');
        $$('#roster [data-pid]').forEach(b => on(b, 'click', () => {
          const pid = b.dataset.pid, s = State.students[pid]; if (!s) return;
          const items = [
            { label: State.muted[s.sid] ? 'Allow notes again' : 'Mute (stop notes)', icon: State.muted[s.sid] ? 'volume-2' : 'volume-x', onClick: () => Network.toggleMute(pid) },
            { header: 'Colour group' }
          ].concat(Object.entries(COLORS).map(([c, n]) => ({ label: n, checked: s.color === c, onClick: () => Network.assignStudentColor(pid, c) })))
           .concat([{ separator: true }, { label: 'Remove from class', icon: 'user-x', danger: true, onClick: () => Network.kick(pid) }]);
          DQBUI.Menu.open({ anchor: b, items, align: 'end', title: s.name });
        }));
      }
      if (Workspace.mode === 'consensus') Consensus.renderParticipants();
      if (Workspace.mode === 'breakout') Breakout.renderParticipants();
      Shell.syncNav();
    },
    init() {
      on($('btn-panel'), 'click', () => Shell.Panel.toggle());
      on($('panel-close'), 'click', () => Shell.Panel.close());
      ['students', 'activity', 'queue'].forEach(k => on($('ptab-' + k), 'click', () => Shell.Panel.showTab(k)));
      on($('state-lock'), 'click', () => Network.transitionTo('LOCKED'));
      on($('state-open'), 'click', () => Network.transitionTo('OPEN'));
      on($('act-stop'), 'click', () => Network.stopActivity());
      on($('queue-list'), 'click', (e) => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        if (b.dataset.q === 'all') return Network.approveAll();
        const id = b.closest('[data-id]').dataset.id; Network.approve(id, b.dataset.q === 'yes');
      });
      // class rules
      const rules = JSON.parse(localStorage.getItem('dqb_rules') || '{}');
      State.settings.names = rules.names !== false; State.settings.approve = !!rules.approve;
      const sync = () => { $('rule-names').setAttribute('aria-checked', String(State.settings.names)); $('rule-approve').setAttribute('aria-checked', String(State.settings.approve)); };
      sync();
      const save = () => { localStorage.setItem('dqb_rules', JSON.stringify(State.settings)); sync(); Network.broadcast({ type: 'RULES', rules: { names: State.settings.names, approve: State.settings.approve } }); };
      on($('rule-names'), 'click', () => { State.settings.names = !State.settings.names; save(); });
      on($('rule-approve'), 'click', () => { State.settings.approve = !State.settings.approve; save(); if (State.settings.approve) Toast.info('New notes will wait in Approvals until you accept them'); else if (State.pending.length) Toast.info(`${State.pending.length} notes are still waiting in Approvals`); });
      Shell.Panel.showTab('students'); Shell.syncQueue();
    }
  };

  /* class timer */
  Shell.Timer = {
    chip: null, tick: null,
    fmt(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); },
    remaining() { const t = State.timer; return t.running ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs; },
    init() {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chip'; chip.id = 'timer-chip'; chip.hidden = true; chip.style.cssText = 'height:34px;font-variant-numeric:tabular-nums;font-weight:800;cursor:pointer';
      chip.addEventListener('click', () => Shell.Panel.open('students'));
      $('conn-chip').before(chip); Shell.Timer.chip = chip;
      on($('timer-presets'), 'click', e => { const b = e.target.closest('[data-min]'); if (!b) return; const ms = +b.dataset.min * 60000; Object.assign(State.timer, { running: false, remainingMs: ms, totalMs: ms }); Shell.Timer.render(true); });
      on($('timer-toggle'), 'click', () => {
        const t = State.timer;
        if (t.running) { t.remainingMs = Math.max(0, t.endsAt - Date.now()); t.running = false; }
        else { if (!t.remainingMs) { Toast.warn('Pick a time first'); return; } t.endsAt = Date.now() + t.remainingMs; t.running = true; }
        Shell.Timer.render(true);
      });
      on($('timer-reset'), 'click', () => { const t = State.timer; t.running = false; t.remainingMs = t.totalMs; Shell.Timer.render(true); });
      Shell.Timer.render();
    },
    render(broadcast) {
      const t = State.timer, rem = Shell.Timer.remaining();
      $('timer-readout').textContent = Shell.Timer.fmt(rem); $('timer-readout').classList.toggle('low', t.running && rem < 10000);
      $('timer-toggle').innerHTML = ic(t.running ? 'pause' : 'play', 'sm') + `<span>${t.running ? 'Pause' : (t.totalMs && rem < t.totalMs ? 'Resume' : 'Start')}</span>`;
      const chip = Shell.Timer.chip; chip.hidden = !(t.running || (t.totalMs && rem < t.totalMs && rem > 0)); chip.innerHTML = ic('timer', 'sm') + Shell.Timer.fmt(rem);
      chip.classList.toggle('danger', t.running && rem < 10000);
      if (broadcast) Network.timerBroadcast();
      clearInterval(Shell.Timer.tick);
      if (t.running) Shell.Timer.tick = setInterval(() => {
        const r = Shell.Timer.remaining();
        if (r <= 0) { clearInterval(Shell.Timer.tick); t.running = false; t.remainingMs = 0; Shell.Timer.render(true); Toast.success('Time’s up!', { duration: 6000 }); Shell.Timer.chime(); DQBUI.haptic([200, 100, 200]); return; }
        $('timer-readout').textContent = Shell.Timer.fmt(r); $('timer-readout').classList.toggle('low', r < 10000); Shell.Timer.chip.lastChild.textContent = Shell.Timer.fmt(r);
      }, 250);
    },
    chime() { try { const C = window.AudioContext || window.webkitAudioContext, c = new C(); [660, 880, 660].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; o.connect(g); g.connect(c.destination); const t = c.currentTime + i * 0.22; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.start(t); o.stop(t + 0.22); }); } catch (e) { /* ignore */ } }
  };

  /* ====================================================================== */
  /* Minimap                                                                 */
  /* ====================================================================== */
  Shell.mmVisible = () => { const v = Shell.settings.mmOn; return v == null ? !isMobile() : !!v; };
  Shell.setMinimap = function (on_) {
    Shell.settings.mmOn = !!on_; saveMM();
    Shell.applyMinimap(); Render._mmDirty = true;
  };
  Shell.toggleMinimap = () => { if (Workspace.caps().minimap) Shell.setMinimap(!Shell.mmVisible()); };
  function saveMM() { try { localStorage.setItem('dqb_mm', JSON.stringify(Shell.settings)); } catch (e) { /* ignore */ } }
  Shell.applyMinimap = function () {
    const c = $('minimap-container'), s = Shell.settings;
    const show = Shell.mmVisible() && Workspace.caps().minimap && Workspace.mode === 'board' && !$('app').hidden;
    c.classList.toggle('hidden', !show);
    c.classList.remove('pos-tl', 'pos-tr', 'pos-bl'); if (s.mmPos !== 'br') c.classList.add('pos-' + s.mmPos);
    c.style.setProperty('--mm-w', (isMobile() ? 124 : s.mmSize) + 'px');
    $('btn-minimap').setAttribute('aria-pressed', String(Shell.mmVisible()));
    Render._mmDirty = true;
  };
  function initMinimap() {
    try { Object.assign(Shell.settings, JSON.parse(localStorage.getItem('dqb_mm') || '{}')); } catch (e) { /* ignore */ }
    const mm = $('minimap'); let down = false;
    on(mm, 'pointerdown', e => { down = true; mm.setPointerCapture(e.pointerId); Render.minimapPointer(e); e.stopPropagation(); });
    on(mm, 'pointermove', e => { if (down) Render.minimapPointer(e); });
    on(mm, 'pointerup', () => { down = false; }); on(mm, 'pointercancel', () => { down = false; });
    on($('btn-minimap'), 'click', () => Shell.toggleMinimap());
  }

  /* ====================================================================== */
  /* Workspace switching                                                     */
  /* ====================================================================== */
  Shell.onWorkspace = function (m) {
    const board = m === 'board';
    $('board-name').hidden = !board; $('ws-title').hidden = board;
    $('save-status').hidden = !board;
    if (!board) $('ws-title').textContent = m === 'consensus' ? `Modeling · ${State.consensusMode.title || ''}` : `Room · ${(Breakout._getZone() || {}).title || ''}`;
    const back = $('tb-back'); back.setAttribute('aria-label', board ? 'Back to boards' : 'Back to board'); back.dataset.tip = board ? 'Back to boards' : 'Back to board';
    $$('#panel-body > div').forEach(d => d.hidden = true);
    $(m === 'board' ? 'panel-board' : (m === 'consensus' ? 'panel-consensus' : 'panel-breakout')).hidden = false;
    Shell.Panel.updateTitle();
    $('btn-share').hidden = !board || State.isCoHost;
    ensureExitBtn(m);
    Shell.Flyout.close(); Overlay.closeAll();
    if (!isMobile() && !board && m === 'consensus') { /* panel opened by Consensus.start */ }
    if (board && Shell.Panel.ov) Shell.Panel.ov.close();
    if (m === 'breakout') { Shell.syncRoomColor(); }
    Shell.applyMinimap(); Shell.syncTools(); Shell.syncZoom(); Shell.syncHistory(); Shell.syncDraw(); Shell.afterRender(); Shell.Panel.renderRoster();
  };
  function ensureExitBtn(m) {
    let b = $('btn-ws-exit');
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'btn-ws-exit'; b.className = 'btn btn-danger btn-sm hide-mobile'; b.addEventListener('click', () => Workspace.exit()); $('btn-share').before(b); }
    b.hidden = m === 'board'; b.innerHTML = ic('stop', 'sm') + `<span>${m === 'consensus' ? 'End session' : 'Close room'}</span>`;
  }

  /* ====================================================================== */
  /* Entering a board                                                        */
  /* ====================================================================== */
  Shell.enterBoard = function (opts) {
    opts = opts || {};
    $('landing').hidden = true; $('app').hidden = false;
    if (opts.cohost) { State.name = State.name || 'Shared board'; }
    $('board-name').value = State.name; $('board-name').readOnly = !!State.isCoHost;
    State.tool = Shell.defaultTool();
    State.multiSelect = false;
    Workspace.set('board');
    window.setTool(State.tool);
    Shell.applyMinimap(); Shell.setSave('saved');
    Shell.syncConn(); Shell.syncBoardState(); Shell.syncActivity(); Shell.syncHistory();
    Shell.afterRender();
    if (opts.fresh && !isMobile()) setTimeout(() => $('empty-state').hidden || $('empty-state').querySelector('button').focus({ preventScroll: true }), 120);
    history.replaceState(history.state, '', location.pathname + location.search.replace(/[?&]cohost=[^&]*/, ''));
    Shell.Join && Shell.Join.ov && Shell.Join.ov.close();
  };

  /* canvas context menu (right click on empty space) */
  Shell.canvasMenu = function (e) {
    const w = Viewport.toWorld(e.clientX, e.clientY);
    DQBUI.Menu.open({ anchor: { clientX: e.clientX, clientY: e.clientY }, items: [
      { label: 'New note here', icon: 'note', onClick: () => Actions.create('note', 'notice', w) },
      { label: 'New zone here', icon: 'zone', onClick: () => Actions.create('zone', null, { x: w.x + 160, y: w.y + 160 }) },
      { label: 'Add…', icon: 'plus', onClick: () => Shell.Insert.open($('rail-add')) },
      { separator: true },
      { label: 'Select all', icon: 'select', kbd: '⌘A', onClick: () => StateManager.setSelection(State.items.map(i => i.id)) },
      { label: 'Fit board to screen', icon: 'fit', kbd: '⇧1', onClick: () => Viewport.fit() }
    ] });
  };

  /* ====================================================================== */
  /* Init                                                                    */
  /* ====================================================================== */
  Shell.init = function () {
    hydrateIcons(document);
    Shell.Insert.init(); Shell.Draw.init(); Shell.SelBar.init(); initMinimap();
    $('room-colors').innerHTML = ['#ef4444', '#f97316', '#eab308', '#10b981', '#3b82f6', '#8b5cf6'].map(c => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Room colour ${c}" aria-pressed="false"></button>`).join('');
    on($('room-colors'), 'click', e => { const b = e.target.closest('[data-color]'); if (b) Breakout.setRoomColor(b.dataset.color); });

    // top bar
    on($('tb-back'), 'click', () => { if (Workspace.mode === 'board') Board.exit(); else Workspace.exit(); });
    const nameIn = $('board-name');
    on(nameIn, 'input', () => { State.name = DQBUI.clampStr(nameIn.value, 60); Board.save(true); });
    on(nameIn, 'keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') nameIn.blur(); });
    on(nameIn, 'blur', () => { if (!nameIn.value.trim()) { nameIn.value = 'My Board'; State.name = 'My Board'; } });
    on($('btn-share'), 'click', () => Shell.Share.open());
    on($('conn-chip'), 'click', () => Shell.Share.open());
    on($('btn-more'), 'click', e => Shell.More.open(e.currentTarget));

    // rail
    $$('#rail [data-tool]').forEach(b => on(b, 'click', () => {
      const t = b.dataset.tool;
      Workspace.setTool(t);
      if (t === 'draw') Shell.Draw.open(b); else Shell.Flyout.close();
    }));
    on($('rail-add'), 'click', e => Shell.Insert.toggle());
    on($('rail-undo'), 'click', () => Workspace.undo()); on($('rail-redo'), 'click', () => Workspace.redo());
    on($('zoom-in'), 'click', () => Workspace.zoomBy(1.25)); on($('zoom-out'), 'click', () => Workspace.zoomBy(0.8)); on($('zoom-fit'), 'click', () => Workspace.fit());
    on($('zoom-pct'), 'click', e => DQBUI.Menu.open({ anchor: e.currentTarget, place: 'above', items: [
      { label: 'Zoom to 50%', onClick: () => Shell.zoomTo(0.5) }, { label: 'Zoom to 100%', kbd: '0', onClick: () => Workspace.zoomReset() }, { label: 'Zoom to 200%', onClick: () => Shell.zoomTo(2) }, { separator: true }, { label: 'Fit to screen', kbd: '⇧1', icon: 'fit', onClick: () => Workspace.fit() }] }));
    on($('home-pill'), 'click', () => Viewport.fit());
    on($('mode-chip-done'), 'click', () => { State.multiSelect = false; Workspace.setTool(Workspace.mode === 'board' ? Shell.defaultTool() : 'pan'); });
    $$('#empty-state [data-empty]').forEach(b => on(b, 'click', () => { const k = b.dataset.empty; if (k === 'note') Actions.create('note', 'notice'); else if (k === 'template') Shell.Templates.open(); else Shell.Share.open(); }));

    Shell.Panel.init(); Shell.Timer.init();
    Shell.syncNav(); Shell.syncHistory();

    // typing on a phone: hide the bottom bars so they don't float above the keyboard
    document.addEventListener('focusin', e => { if (isMobile() && e.target.matches && e.target.matches('textarea, input[type=text], input:not([type]), input[type=search]') && !e.target.closest('.ov')) document.documentElement.classList.add('typing'); });
    document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches || !document.activeElement.matches('textarea, input')) document.documentElement.classList.remove('typing'); }, 80));

    mq.addEventListener ? mq.addEventListener('change', Shell.onBreakpoint) : mq.addListener(Shell.onBreakpoint);
    window.addEventListener('resize', DQBUI.debounce(() => { Render._mmDirty = true; Render._selDirty = true; Shell.applyMinimap(); }, 100));
    document.addEventListener('visibilitychange', () => { if (document.hidden) Board.flush(); else Shell.checkNetwork(); });
    window.addEventListener('pagehide', () => { Board.flush(); });
    window.addEventListener('online', () => Shell.checkNetwork());
    window.addEventListener('beforeunload', (e) => { if (!State.isCoHost && Network.studentCount() > 0 && !$('app').hidden) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); Shell.installPrompt = e; });

    DB.init().then(() => { Shell.Home.init(); Shell.Home.render(); });
    InputController.init(); Consensus.init(); Breakout.initEvents();
    const cohostParam = new URLSearchParams(location.search).get('cohost');
    if (cohostParam) setTimeout(() => Shell.Join.open(cohostParam), 300);
  };
  Shell.zoomTo = (z) => { const r = Viewport.rect(); InputController.zoom(z / State.view.z, r.x + r.w / 2, r.y + r.h / 2); };
  Shell.onBreakpoint = function () {
    // the panel moves between a docked column and a sheet when the window crosses the phone breakpoint
    if (Shell.Panel.ov) Shell.Panel.ov.close();
    $('app').classList.remove('panel-open');
    Shell.Flyout.close(); Shell.applyMinimap(); Shell.syncNav(); Shell.syncTools(); Shell.SelBar.render();
  };
  Shell.checkNetwork = function () {
    if (State.isCoHost || $('app').hidden) { if (State.isCoHost && Network._cohost && !State.students['HOST']) Network.retry(); return; }
    const p = Network.peer;
    if (!p || p.destroyed) Network.host(); else if (p.disconnected) { try { p.reconnect(); } catch (e) { Network.host(); } }
  };
})();
