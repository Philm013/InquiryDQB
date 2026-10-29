/* ==========================================================================
   InquiryDQB shared UI runtime
   - esc / safe* helpers (output escaping + untrusted-input validation)
   - Theme (auto / light / dark)
   - Overlay (stack of bottom sheets / modals with focus trap, Esc, back button, drag-to-dismiss)
   - Dialog  (promise based confirm / prompt / alert — replaces native alert/confirm/prompt)
   - Menu    (popover on desktop, action sheet on phones)
   - Toast   (snackbars)
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------- */
  /* Escaping & validation helpers                                           */
  /* ---------------------------------------------------------------------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  /** Escape text for safe use in HTML text AND quoted attribute contexts. */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return ESC[c]; }); }
  /** Allow only simple identifiers (ids that end up in DOM ids / inline handlers). */
  function safeId(s) { return (typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s)) ? s : ''; }
  /** Allow only #hex colours. */
  function safeColor(c) { return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? c : ''; }
  var IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  /** Allow only raster data-URIs (no svg, no external urls) under a size cap. */
  function safeImg(s, max) { return (typeof s === 'string' && s.length <= (max || 2500000) && IMG_RE.test(s)) ? s : ''; }
  function clampStr(s, n) { return String(s == null ? '' : s).slice(0, n); }
  function num(v, min, max, dflt) { v = Number(v); if (!isFinite(v)) return dflt; return Math.max(min, Math.min(max, v)); }
  function genId() { return Math.random().toString(36).slice(2, 11); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function throttle(fn, ms) { var last = 0, t; return function () { var a = arguments, c = this, now = Date.now(); if (now - last >= ms) { last = now; fn.apply(c, a); } else { clearTimeout(t); t = setTimeout(function () { last = Date.now(); fn.apply(c, a); }, ms - (now - last)); } }; }
  function isMobile() { return global.matchMedia('(max-width: 767px)').matches; }
  function icon(name, cls) { return global.icon ? global.icon(name, cls) : ''; }
  function h(html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; }
  function haptic(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) { /* ignore */ } }

  var _scripts = {};
  /** Load a script once; resolves when ready. */
  function loadScript(src) {
    if (_scripts[src]) return _scripts[src];
    _scripts[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = res; s.onerror = function () { delete _scripts[src]; rej(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return _scripts[src];
  }
  function copyText(text) {
    if (navigator.clipboard && global.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
        document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e) { return false; }
    }
  }
  /** Screen-reader announcement. */
  function announce(msg) {
    var el = document.getElementById('sr-live');
    if (!el) { el = document.createElement('div'); el.id = 'sr-live'; el.className = 'sr-only'; el.setAttribute('aria-live', 'polite'); el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 30);
  }

  /* ---------------------------------------------------------------------- */
  /* Theme                                                                   */
  /* ---------------------------------------------------------------------- */
  var Theme = {
    KEY: 'dqb_theme',
    get: function () { try { return localStorage.getItem(Theme.KEY) || 'auto'; } catch (e) { return 'auto'; } },
    set: function (v) {
      try { if (v === 'auto') localStorage.removeItem(Theme.KEY); else localStorage.setItem(Theme.KEY, v); } catch (e) { /* ignore */ }
      Theme.apply(v);
    },
    apply: function (v) {
      v = v || Theme.get();
      if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) { try { meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff'); } catch (e) { /* ignore */ } }
    }
  };
  Theme.apply();
  if (global.matchMedia) { try { global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { Theme.apply(); }); } catch (e) { /* old Safari */ } }

  /* On-screen keyboard offset so sheets stay above the keyboard (iOS / Android). */
  if (global.visualViewport) {
    var vv = global.visualViewport;
    var updKb = function () {
      var kb = Math.max(0, global.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb > 90 ? Math.round(kb) + 'px' : '0px');
    };
    vv.addEventListener('resize', updKb); vv.addEventListener('scroll', updKb);
  }

  /* ---------------------------------------------------------------------- */
  /* Hist: one history entry per open sheet / page so the back gesture closes them */
  /* ---------------------------------------------------------------------- */
  var Hist = (function () {
    var stack = [], ignore = 0;
    function push(entry) {
      try { global.history.pushState({ dqb: stack.length + 1 }, ''); } catch (e) { entry.noHist = true; }
      stack.push(entry);
    }
    /** Called when a sheet/page closes by itself (button, programmatic) rather than via the back button. */
    function remove(entry) {
      var i = stack.lastIndexOf(entry);
      if (i < 0 || entry.noHist) { if (i > -1) stack.splice(i, 1); return; }
      if (i === stack.length - 1) { stack.pop(); ignore++; try { global.history.back(); } catch (e) { ignore--; } }
      else entry.dead = true;                       // not on top: leave the browser entry, ignore it later
    }
    global.addEventListener('popstate', function () {
      if (ignore > 0) { ignore--; return; }
      var e = stack.pop();
      if (e && !e.dead && e.onPop) e.onPop();
    });
    return { push: push, remove: remove, depth: function () { return stack.length; } };
  })();

  /* ---------------------------------------------------------------------- */
  /* Overlay: stack of sheets / modals                                       */
  /* ---------------------------------------------------------------------- */
  var Overlay = (function () {
    var stack = [], uid = 0, lockCount = 0;
    var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function focusables(root) { return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) { return el.offsetWidth || el.offsetHeight || el === document.activeElement; }); }
    function appRoots() { return document.querySelectorAll('[data-app-root]'); }
    function syncInert() {
      var any = stack.length > 0;
      Array.prototype.forEach.call(appRoots(), function (el) { try { el.inert = any; } catch (e) { /* ignore */ } });
      stack.forEach(function (o, i) { try { o.el.inert = i !== stack.length - 1; } catch (e) { /* ignore */ } });
    }
    function lock(on) {
      lockCount += on ? 1 : -1;
      document.documentElement.classList.toggle('ov-lock', lockCount > 0);
    }

    function open(opts) {
      opts = opts || {};
      var id = ++uid;
      var kind = opts.kind || 'sheet';
      var el = document.createElement('div'); el.className = 'ov'; el.setAttribute('data-overlay', id);
      var backdrop = document.createElement('div'); backdrop.className = 'ov-backdrop';
      var sheet = document.createElement('div');
      sheet.className = 'sheet size-' + (opts.size || 'md') + (opts.flush ? ' flush' : '') + (opts.className ? ' ' + opts.className : '');
      sheet.setAttribute('role', kind === 'dialog' && opts.alert ? 'alertdialog' : 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.tabIndex = -1;
      var titleId = 'ovt-' + id;
      var html = '<div class="sheet-handle" aria-hidden="true"></div>';
      if (opts.title) html += '<div class="sheet-h"><h2 id="' + titleId + '">' + esc(opts.title) + '</h2>' + (opts.dismissible === false || opts.hideClose ? '' : '<button type="button" class="icon-btn" data-ov-close aria-label="Close">' + icon('close') + '</button>') + '</div>';
      html += '<div class="sheet-b"></div>';
      sheet.innerHTML = html;
      if (opts.title) sheet.setAttribute('aria-labelledby', titleId);
      var body = sheet.querySelector('.sheet-b');
      var footerEl = null;
      var self = {
        id: id, el: el, sheet: sheet, body: body, closed: false, result: undefined, opts: opts, _hist: false, _popped: false,
        close: function (result) { close(self, result); },
        setTitle: function (t) { var h2 = sheet.querySelector('h2'); if (h2) h2.textContent = t; },
        setContent: function (c) { setContent(body, c); },
        setFooter: function (f) { buildFooter(f); },
        footerEl: null
      };
      self.finished = new Promise(function (res) { self._resolve = res; });

      function setContent(target, c) {
        target.textContent = '';
        if (c == null) return;
        if (typeof c === 'string') { target.innerHTML = c; if (global.hydrateIcons) global.hydrateIcons(target); }
        else target.appendChild(c);
      }
      function buildFooter(f) {
        if (footerEl) { footerEl.remove(); footerEl = null; }
        if (!f || (Array.isArray(f) && !f.length)) { self.footerEl = null; return; }
        footerEl = document.createElement('div'); footerEl.className = 'sheet-f' + (kind === 'dialog' ? ' dlg-actions' : '') + (opts.stackedFooter ? ' stacked' : '');
        if (Array.isArray(f)) {
          f.forEach(function (a) {
            var b = document.createElement('button'); b.type = 'button';
            b.className = 'btn ' + ({ primary: 'btn-primary', danger: 'btn-danger', secondary: 'btn-secondary', ghost: 'btn-ghost', soft: 'btn-soft', 'danger-soft': 'btn-danger-soft' }[a.kind || 'secondary'] || '');
            b.innerHTML = (a.icon ? icon(a.icon) : '') + '<span>' + esc(a.label) + '</span>';
            if (a.disabled) b.disabled = true;
            if (a.id) b.id = a.id;
            if (a.autofocus) b.setAttribute('data-autofocus', '');
            b.addEventListener('click', function () {
              var keep = a.onClick ? a.onClick(self, b) === false : false;
              if (!keep && a.close !== false) self.close(a.value);
            });
            footerEl.appendChild(b);
          });
        } else if (typeof f === 'string') { footerEl.innerHTML = f; if (global.hydrateIcons) global.hydrateIcons(footerEl); }
        else footerEl.appendChild(f);
        sheet.appendChild(footerEl); self.footerEl = footerEl;
      }
      setContent(body, opts.content);
      buildFooter(opts.footer);

      el.appendChild(backdrop); el.appendChild(sheet);
      var prevFocus = document.activeElement;
      document.body.appendChild(el);
      stack.push(self); lock(true); syncInert();

      // history entry so the phone back gesture closes the sheet instead of leaving the app
      if (opts.history !== false) { self._h = { onPop: function () { close(self, undefined, true, true); } }; Hist.push(self._h); }

      // dismiss
      backdrop.addEventListener('pointerdown', function () { if (opts.dismissible !== false) close(self, undefined, true); });
      el.addEventListener('click', function (e) { var c = e.target.closest && e.target.closest('[data-ov-close]'); if (c && el.contains(c)) close(self, undefined, true); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && opts.dismissible !== false && stack[stack.length - 1] === self) { e.stopPropagation(); e.preventDefault(); close(self, undefined, true); }
        else if (e.key === 'Tab') {
          var f = focusables(sheet); if (!f.length) { e.preventDefault(); sheet.focus(); return; }
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      enableDrag(self);

      // focus
      setTimeout(function () {
        if (self.closed) return;
        var t = (opts.initialFocus && sheet.querySelector(opts.initialFocus)) || sheet.querySelector('[data-autofocus]') || sheet.querySelector('.sheet-b input:not([type=hidden]), .sheet-b textarea') || null;
        if (!t) { var f = focusables(sheet).filter(function (n) { return !n.hasAttribute('data-ov-close'); }); t = f[0] || sheet; }
        try { t.focus({ preventScroll: true }); if (t.select && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && opts.selectOnFocus) t.select(); } catch (e) { /* ignore */ }
      }, 30);
      self._restore = prevFocus;
      if (opts.onOpen) opts.onOpen(self);
      return self;
    }

    function close(o, result, fromUser, viaPop) {
      if (o.closed) return;
      o.closed = true; o.result = result;
      var i = stack.indexOf(o); if (i > -1) stack.splice(i, 1);
      lock(false); syncInert();
      if (o._h && !viaPop) Hist.remove(o._h);
      var done = function () {
        if (o.el.parentNode) o.el.remove();
        var r = o._restore; if (r && r.focus && document.contains(r) && !stack.length) { try { r.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        else if (stack.length) { var top = stack[stack.length - 1]; var f = focusables(top.sheet)[0]; if (f && !top.sheet.contains(document.activeElement)) f.focus({ preventScroll: true }); }
        if (o.opts.onClose) { try { o.opts.onClose(result, !!fromUser); } catch (e) { console.error(e); } }
        o._resolve(result);
      };
      if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
      o.el.classList.add('closing'); o.sheet.classList.add('closing');
      var fin = false; var end = function () { if (fin) return; fin = true; done(); };
      o.sheet.addEventListener('animationend', end, { once: true }); setTimeout(end, 260);
    }

    function enableDrag(o) {
      var sheet = o.sheet; if (o.opts.dismissible === false) return;
      var handleEls = sheet.querySelectorAll('.sheet-handle, .sheet-h');
      var startY = 0, dy = 0, t0 = 0, active = false;
      function down(e) {
        if (!isMobile() || e.target.closest('button, a, input, textarea, select')) return;
        active = true; startY = e.clientY; dy = 0; t0 = Date.now(); sheet.classList.add('dragging');
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      function move(e) { if (!active) return; dy = Math.max(0, e.clientY - startY); sheet.style.transform = 'translateY(' + dy + 'px)'; }
      function up() {
        if (!active) return; active = false; sheet.classList.remove('dragging');
        var v = dy / Math.max(1, Date.now() - t0);
        if (dy > 110 || (v > 0.55 && dy > 30)) { sheet.style.transition = 'transform 0.18s ease-in'; sheet.style.transform = 'translateY(105%)'; close(o, undefined, true); }
        else { sheet.style.transition = 'transform 0.2s var(--ease)'; sheet.style.transform = ''; setTimeout(function () { sheet.style.transition = ''; }, 220); }
      }
      Array.prototype.forEach.call(handleEls, function (n) { n.addEventListener('pointerdown', down); n.addEventListener('pointermove', move); n.addEventListener('pointerup', up); n.addEventListener('pointercancel', up); });
    }

    // Escape closes the top layer even when focus has wandered out of it (for example onto <body> after a click on the backdrop edge)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented || !stack.length) return;
      var top = stack[stack.length - 1];
      if (top.opts && top.opts.dismissible === false) return;
      e.preventDefault(); close(top, undefined, true);
    });

    return {
      open: open,
      top: function () { return stack[stack.length - 1] || null; },
      count: function () { return stack.length; },
      closeAll: function () { stack.slice().reverse().forEach(function (o) { close(o); }); }
    };
  })();

  /* ---------------------------------------------------------------------- */
  /* Dialog: promise based replacements for alert / confirm / prompt         */
  /* ---------------------------------------------------------------------- */
  var Dialog = {
    confirm: function (o) {
      o = o || {};
      var tone = o.danger ? 'danger' : (o.tone || '');
      var ico = o.icon || (o.danger ? 'trash' : 'info');
      return new Promise(function (resolve) {
        Overlay.open({
          kind: 'dialog', size: 'sm', dismissible: o.dismissible !== false,
          content: '<div class="dlg"><div class="dlg-ico ' + tone + '">' + icon(ico, 'lg') + '</div><h3>' + esc(o.title || 'Are you sure?') + '</h3>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') + '</div>',
          footer: [
            { label: o.cancelLabel || 'Cancel', kind: 'secondary', value: false },
            { label: o.confirmLabel || 'Confirm', kind: o.danger ? 'danger' : 'primary', value: true, autofocus: !o.danger }
          ],
          onClose: function (v) { resolve(v === true); }
        });
      });
    },
    alert: function (o) {
      o = o || {};
      return new Promise(function (resolve) {
        Overlay.open({
          kind: 'dialog', size: 'sm', alert: true,
          content: '<div class="dlg"><div class="dlg-ico ' + (o.tone || '') + '">' + icon(o.icon || 'info', 'lg') + '</div><h3>' + esc(o.title || '') + '</h3>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') + '</div>',
          footer: [{ label: o.okLabel || 'OK', kind: 'primary', autofocus: true }],
          onClose: function () { resolve(); }
        });
      });
    },
    prompt: function (o) {
      o = o || {};
      return new Promise(function (resolve) {
        var multi = !!o.multiline;
        var inputHtml = multi
          ? '<textarea class="textarea" id="dlg-in" rows="' + (o.rows || 4) + '" maxlength="' + (o.maxLength || 500) + '" placeholder="' + esc(o.placeholder || '') + '">' + esc(o.value || '') + '</textarea>'
          : '<input class="input" id="dlg-in" type="text" maxlength="' + (o.maxLength || 80) + '" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') + '">';
        var ov = Overlay.open({
          kind: 'dialog', size: 'sm', selectOnFocus: true,
          content: '<div class="dlg"><div class="dlg-ico">' + icon(o.icon || 'pencil', 'lg') + '</div><h3>' + esc(o.title || 'Enter a value') + '</h3>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') + '<div class="field">' + (o.label ? '<label for="dlg-in">' + esc(o.label) + '</label>' : '') + inputHtml + '<div class="error" id="dlg-err" hidden></div></div></div>',
          footer: [
            { label: o.cancelLabel || 'Cancel', kind: 'secondary', value: null },
            { label: o.confirmLabel || 'OK', kind: 'primary', close: false, onClick: function () { submit(); } }
          ],
          onClose: function (v) { resolve(v === undefined ? null : v); }
        });
        function submit() {
          var inp = ov.sheet.querySelector('#dlg-in'); var v = inp.value.trim();
          var err = ov.sheet.querySelector('#dlg-err');
          var msg = null;
          if (o.required !== false && !v) msg = o.requiredMessage || 'Please enter a value.';
          else if (o.validate) msg = o.validate(v);
          if (msg) { err.textContent = msg; err.hidden = false; inp.classList.add('invalid'); inp.focus(); return; }
          ov.close(v);
        }
        var inp = ov.sheet.querySelector('#dlg-in');
        inp.addEventListener('input', function () { inp.classList.remove('invalid'); ov.sheet.querySelector('#dlg-err').hidden = true; });
        if (!multi) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Menu: popover (desktop) / action sheet (phones)                         */
  /* ---------------------------------------------------------------------- */
  var Menu = (function () {
    var current = null;
    function closeCurrent() { if (current) { current.close(); } }

    function open(o) {
      closeCurrent();
      var items = (o.items || []).filter(Boolean);
      var asSheet = o.sheet !== false && isMobile();
      var inst;
      if (asSheet) {
        var wrap = document.createElement('div'); wrap.className = 'list';
        items.forEach(function (it) {
          if (it.separator) { var sp = document.createElement('div'); sp.style.cssText = 'height:8px'; wrap.appendChild(sp); return; }
          if (it.header) { var hd = document.createElement('div'); hd.className = 'section-label'; hd.textContent = it.header; wrap.appendChild(hd); return; }
          var b = document.createElement('button'); b.type = 'button'; b.className = 'list-row';
          if (it.disabled) b.disabled = true;
          b.innerHTML = (it.icon ? '<span class="ico" ' + (it.danger ? 'style="background:var(--danger-50);color:var(--danger)"' : '') + '>' + icon(it.icon) + '</span>' : '') +
            '<span class="grow"><span class="t" ' + (it.danger ? 'style="color:var(--danger)"' : '') + '>' + esc(it.label) + '</span>' + (it.sub ? '<div class="s">' + esc(it.sub) + '</div>' : '') + '</span>' +
            (it.checked ? icon('check') : '');
          b.addEventListener('click', function () { if (!it.keepOpen) ov.close(); if (it.onClick) setTimeout(function () { it.onClick(); }, 0); });
          wrap.appendChild(b);
        });
        var ov = Overlay.open({ title: o.title || '', content: wrap, size: 'sm', flush: false, onClose: function () { if (current === inst) current = null; if (o.onClose) o.onClose(); } });
        inst = { close: function () { ov.close(); } };
        current = inst; return inst;
      }

      var m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
      if (o.width) m.style.minWidth = o.width + 'px';
      items.forEach(function (it) {
        if (it.separator) { var sp = document.createElement('div'); sp.className = 'menu-sep'; m.appendChild(sp); return; }
        if (it.header) { var hd = document.createElement('div'); hd.className = 'menu-head'; hd.textContent = it.header; m.appendChild(hd); return; }
        var b = document.createElement('button'); b.type = 'button'; b.className = 'menu-item' + (it.danger ? ' danger' : ''); b.setAttribute('role', 'menuitem');
        if (it.disabled) b.disabled = true;
        b.innerHTML = (it.icon ? icon(it.icon) : '') + '<span>' + esc(it.label) + '</span>' + (it.kbd ? '<span class="kbd">' + esc(kbd(it.kbd)) + '</span>' : '') + (it.checked ? '<span class="chk">' + icon('check', 'sm') + '</span>' : '');
        b.addEventListener('click', function () { if (!it.keepOpen) inst.close(); if (it.onClick) it.onClick(); });
        m.appendChild(b);
      });
      document.body.appendChild(m);
      // position
      var r;
      var a = o.anchor;
      if (a && a.getBoundingClientRect) r = a.getBoundingClientRect();
      else if (a && typeof a.clientX === 'number') r = { left: a.clientX, right: a.clientX, top: a.clientY, bottom: a.clientY, width: 0, height: 0 };
      else r = { left: 20, right: 20, top: 20, bottom: 20, width: 0, height: 0 };
      var mw = m.offsetWidth, mh = m.offsetHeight, vw = global.innerWidth, vh = global.innerHeight, pad = 8;
      var place = o.place || 'below';
      var x, y;
      if (place === 'right') { x = r.right + 8; y = r.top; }
      else if (place === 'above') { x = (o.align === 'end') ? r.right - mw : r.left; y = r.top - mh - 8; }
      else { x = (o.align === 'end') ? r.right - mw : r.left; y = r.bottom + 6; }
      if (y + mh > vh - pad) y = Math.max(pad, (place === 'right' ? vh - mh - pad : r.top - mh - 6));
      if (y < pad) y = pad;
      if (x + mw > vw - pad) x = Math.max(pad, vw - mw - pad);
      if (x < pad) x = pad;
      m.style.left = x + 'px'; m.style.top = y + 'px';
      var first = m.querySelector('.menu-item:not([disabled])'); if (first) first.focus({ preventScroll: true });

      function onDown(e) { if (!m.contains(e.target)) inst.close(); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inst.close(); if (a && a.focus) a.focus(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var list = Array.prototype.slice.call(m.querySelectorAll('.menu-item:not([disabled])')); if (!list.length) return;
          var i = list.indexOf(document.activeElement); i = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length; list[i].focus();
        } else if (e.key === 'Tab') { inst.close(); }
      }
      setTimeout(function () { document.addEventListener('pointerdown', onDown, true); }, 0);
      document.addEventListener('keydown', onKey, true);
      global.addEventListener('resize', closeCurrent); global.addEventListener('blur', closeCurrent);
      inst = {
        close: function () {
          if (inst.done) return; inst.done = true;
          document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true);
          global.removeEventListener('resize', closeCurrent); global.removeEventListener('blur', closeCurrent);
          m.remove(); if (current === inst) current = null; if (o.onClose) o.onClose();
        }
      };
      current = inst; return inst;
    }
    return { open: open, close: closeCurrent, isOpen: function () { return !!current; } };
  })();

  /* Shortcut labels are written with Mac symbols; show Ctrl/Shift spellings elsewhere. */
  var isMac = /Mac|iPhone|iPad|iPod/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '');
  function kbd(label) {
    return isMac ? label : String(label).replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+').replace(/⇧\s*=/g, 'Shift =').replace(/⇧/g, 'Shift+');
  }

  /* ---------------------------------------------------------------------- */
  /* Toasts                                                                  */
  /* ---------------------------------------------------------------------- */
  var Toast = (function () {
    var host = null, recent = {};
    function ensure() {
      if (host && document.body.contains(host)) return host;
      host = document.getElementById('toasts');
      if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
      return host;
    }
    function show(msg, o) {
      o = o || {};
      if (typeof o === 'string') o = { type: o };
      var key = (o.type || '') + msg; var now = Date.now();
      if (recent[key] && now - recent[key] < 900) return null; recent[key] = now;
      var h = ensure();
      while (h.children.length >= 2) h.firstChild.remove();
      var t = document.createElement('div'); t.className = 'toast ' + (o.type || '');
      var ic = o.icon || ({ success: 'ok', error: 'x-circle', warn: 'warn', info: 'info' }[o.type]);
      t.innerHTML = (ic ? icon(ic) : '') + '<span>' + esc(msg) + '</span>';
      if (o.action) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'toast-action'; b.textContent = o.action.label;
        b.addEventListener('click', function () { try { o.action.onClick(); } finally { dismiss(); } });
        t.appendChild(b);
      }
      // a newer message pushes older ones out quickly so toasts never pile up over the content
      Array.prototype.forEach.call(h.children, function (c) { if (c._dismiss && !c._sticky) { clearTimeout(c._timer); c._timer = setTimeout(c._dismiss, 1200); } });
      h.appendChild(t);
      var dismiss = function () { if (t.classList.contains('out')) return; t.classList.add('out'); setTimeout(function () { t.remove(); }, 200); };
      var dur = o.duration == null ? (o.action ? 6000 : (o.type === 'error' ? 4500 : 2800)) : o.duration;
      t._dismiss = dismiss; t._sticky = !!o.action;
      if (dur > 0) t._timer = setTimeout(dismiss, dur);
      return { dismiss: dismiss };
    }
    return {
      show: show,
      success: function (m, o) { return show(m, Object.assign({ type: 'success' }, o)); },
      error: function (m, o) { return show(m, Object.assign({ type: 'error' }, o)); },
      warn: function (m, o) { return show(m, Object.assign({ type: 'warn' }, o)); },
      info: function (m, o) { return show(m, Object.assign({ type: 'info' }, o)); }
    };
  })();

  /* Never let a native dialog block the app: route accidental calls to the in-app UI. */
  global.alert = function (m) { Toast.info(String(m)); };

  global.DQBUI = {
    esc: esc, safeId: safeId, safeColor: safeColor, safeImg: safeImg, clampStr: clampStr, num: num, genId: genId,
    debounce: debounce, throttle: throttle, isMobile: isMobile, icon: icon, h: h, haptic: haptic,
    loadScript: loadScript, copyText: copyText, announce: announce, kbd: kbd, isMac: isMac,
    Theme: Theme, Hist: Hist, Overlay: Overlay, Dialog: Dialog, Menu: Menu, Toast: Toast
  };
})(window);
