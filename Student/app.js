/* ==========================================================================
   InquiryDQB — Student app
   Views (setup · join · board · notes) + task pages (write · sketch · poll · graph · exit · model)
   Connection layer with automatic reconnect, an offline outbox and delivery receipts.
   ========================================================================== */
(function () {
  'use strict';
  const { Overlay, Dialog, Toast, Theme, Hist, esc, safeId, safeColor, safeImg, clampStr } = DQBUI;
  const $ = id => document.getElementById(id);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const on = (el, ev, fn, o) => { if (el) el.addEventListener(ev, fn, o); };
  const ic = icon;

  const TYPES = {
    notice:    { icon: '👁️', lbl: 'Notice',    ph: 'I notice…',                   hint: 'Describe something you can see, hear or measure.' },
    wonder:    { icon: '❓', lbl: 'Wonder',    ph: 'I wonder…',                   hint: 'Ask a question you would like to investigate.' },
    idea:      { icon: '💡', lbl: 'Idea',      ph: 'My idea is…',                 hint: 'Share a thought, explanation or suggestion.' },
    test:      { icon: '🧪', lbl: 'Test',      ph: 'We could test this by…',      hint: 'How could the class find out?' },
    claim:     { icon: '🤔', lbl: 'Claim',     ph: 'My claim is…',                hint: 'State your answer to the question.' },
    evidence:  { icon: '📊', lbl: 'Evidence',  ph: 'My evidence is…',             hint: 'What data or observations support your claim?' },
    reasoning: { icon: '🔗', lbl: 'Reasoning', ph: 'This evidence shows… because…', hint: 'Explain how the evidence supports the claim.' },
    sketch:    { icon: '✏️', lbl: 'Sketch',    ph: '', hint: '' }
  };
  const OPEN_TYPES = ['notice', 'wonder', 'idea', 'test'], CER_TYPES = ['claim', 'evidence', 'reasoning'];
  const MAX_TEXT = 400;

  /* ====================================================================== */
  /* State + persistence                                                     */
  /* ====================================================================== */
  const State = window.StudentState = {
    me: { sid: '', name: '', av: '😀', color: null },
    target: null,            // { peerId, code }
    boardId: null, notes: [],
    activity: { type: 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null },
    rules: { names: true, approve: false }, muted: false,
    responded: {}, everConnected: false, tab: 'board', view: 'setup',
    timer: { running: false, endsAt: 0, remainingMs: 0, totalMs: 0 },
    outbox: []
  };

  /** An "activity round": the teacher stamps every start with a fresh `rid`, so a student can answer again when the same item is re-run. */
  const actKey = () => { const a = State.activity; return a.rid || (a.id + ':' + a.sub); };
  const isDone = () => !!State.responded[actKey()];
  const markDone = () => { State.responded[actKey()] = true; };

  const Store = {
    db: null,
    init() {
      return new Promise(resolve => {
        // profile: localStorage first (always available), IndexedDB for notes
        try { const p = JSON.parse(localStorage.getItem('dqb_profile') || 'null'); if (p) Object.assign(State.me, p); } catch (e) { /* ignore */ }
        if (!State.me.sid) { State.me.sid = DQBUI.genId() + DQBUI.genId(); Store.saveProfile(); }
        let req;
        try { req = indexedDB.open('DQB_Student', 2); } catch (e) { resolve(); return; }
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'key' });
        };
        req.onerror = () => resolve();
        req.onsuccess = e => {
          Store.db = e.target.result;
          try {
            const tx = Store.db.transaction(['profile', 'notes'], 'readonly');
            tx.objectStore('profile').get('me').onsuccess = ev => { const r = ev.target.result; if (r && r.val && !State.me.name) Object.assign(State.me, { name: r.val.name || '', av: r.val.av || State.me.av }); };
            tx.objectStore('notes').getAll().onsuccess = ev => { State.notes = ev.target.result || []; };
            tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
          } catch (err) { resolve(); }
        };
      });
    },
    saveProfile() {
      try { localStorage.setItem('dqb_profile', JSON.stringify({ sid: State.me.sid, name: State.me.name, av: State.me.av })); } catch (e) { /* ignore */ }
      if (Store.db) { try { Store.db.transaction('profile', 'readwrite').objectStore('profile').put({ key: 'me', val: { name: State.me.name, av: State.me.av } }); } catch (e) { /* ignore */ } }
    },
    saveNote(n) {
      const i = State.notes.findIndex(x => x.id === n.id);
      if (i >= 0) State.notes[i] = n; else State.notes.push(n);
      if (Store.db) { try { Store.db.transaction('notes', 'readwrite').objectStore('notes').put(n); } catch (e) { /* ignore */ } }
      Views.renderNotes();
    },
    delNote(id) {
      State.notes = State.notes.filter(x => x.id !== id);
      if (Store.db) { try { Store.db.transaction('notes', 'readwrite').objectStore('notes').delete(id); } catch (e) { /* ignore */ } }
      Views.renderNotes();
    },
    lastJoin() { try { const j = JSON.parse(localStorage.getItem('dqb_last_join') || 'null'); return j && Date.now() - j.ts < 8 * 3600 * 1000 ? j : null; } catch (e) { return null; } },
    setLastJoin(t) { try { if (t) localStorage.setItem('dqb_last_join', JSON.stringify({ peerId: t.peerId, code: t.code, ts: Date.now() })); else localStorage.removeItem('dqb_last_join'); } catch (e) { /* ignore */ } }
  };

  /* ====================================================================== */
  /* Connection                                                              */
  /* ====================================================================== */
  const Conn = {
    state: 'idle', peer: null, conn: null, attempts: 0, timer: null, wd: null, beat: 0, intentional: false, first: true,

    setState(s, info) {
      Conn.state = s; Conn.info = info || null;
      const pill = $('conn-pill'), txt = $('conn-text'), dot = $('conn-dot'), banner = $('banner');
      pill.classList.remove('on', 'wait', 'off'); dot.className = 'dot';
      if (s === 'online') { pill.classList.add('on'); dot.classList.add('ok'); txt.textContent = 'Connected'; banner.hidden = true; }
      else if (s === 'offline') { pill.classList.add('off'); dot.classList.add('bad'); txt.textContent = 'Offline'; Conn.banner('You’re offline. Notes you write will be sent when you’re back.', true); }
      else { pill.classList.add('wait'); dot.classList.add('warn'); txt.textContent = s === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'; if (State.everConnected) Conn.banner(s === 'reconnecting' ? 'Lost connection — trying to reconnect…' : 'Connecting…'); else banner.hidden = true; }
      Views.syncChrome();
    },
    banner(msg, bad) {
      const b = $('banner'); b.hidden = false; b.classList.toggle('bad', !!bad);
      b.innerHTML = `${ic('wifi-off', 'sm')}<span>${esc(msg)}</span><button type="button" class="btn btn-secondary" id="banner-retry">Retry now</button>${Conn.attempts >= 3 ? '<button type="button" class="btn btn-ghost" id="banner-newcode">New code</button>' : ''}`;
      on($('banner-retry'), 'click', () => Conn.retryNow());
      on($('banner-newcode'), 'click', () => { Conn.stop(); Store.setLastJoin(null); State.target = null; State.everConnected = false; Pages.closeAll(); Views.show('join'); });
    },

    start(target) {
      Conn.target = State.target = target; Conn.intentional = false; Conn.attempts = 0; Conn.first = true;
      State.boardId = null;
      Conn.setState('connecting');
      Conn.dial();
    },
    async ensurePeer() {
      return new Promise((resolve, reject) => {
        const p = Conn.peer;
        if (p && !p.destroyed && !p.disconnected && p.open) return resolve(p);
        if (p) { try { p.destroy(); } catch (e) { /* ignore */ } Conn.peer = null; }
        let np; try { np = Net.newPeer(); } catch (e) { reject({ type: 'browser-incompatible' }); return; }
        Conn.peer = np;
        const to = setTimeout(() => reject({ type: 'network' }), 12000);
        np.on('open', () => { clearTimeout(to); resolve(np); });
        np.on('error', err => { clearTimeout(to); if (np.open) Conn.onPeerError(err); else reject(err); });
        np.on('disconnected', () => { if (Conn.peer === np && !Conn.intentional && Conn.state === 'online') { /* data channel may still work; the watchdog handles real loss */ try { np.reconnect(); } catch (e) { /* ignore */ } } });
      });
    },
    async dial() {
      clearTimeout(Conn.timer); clearInterval(Conn.wd);
      if (Conn.intentional || !Conn.target) return;
      try {
        const peer = await Conn.ensurePeer();
        if (Conn.intentional) return;
        if (Conn.conn) { try { Conn.conn.close(); } catch (e) { /* ignore */ } Conn.conn = null; }
        const c = peer.connect(Conn.target.peerId, { reliable: true });
        Conn.conn = c;
        const guard = setTimeout(() => { if (!c.open && Conn.conn === c) { try { c.close(); } catch (e) { /* ignore */ } Conn.fail({ type: 'peer-unavailable' }); } }, 10000);
        c.on('open', () => {
          clearTimeout(guard); Conn.beat = Date.now();
          Conn.raw({ type: 'JOIN', name: State.me.name, avatar: State.me.av, sid: State.me.sid, v: 2 });
          Conn.wd = setInterval(() => { if (Date.now() - Conn.beat > 10000 && Conn.conn === c) { try { c.close(); } catch (e) { /* ignore */ } Conn.onClose(c); } }, 3000);
        });
        c.on('data', d => { Conn.beat = Date.now(); let m; try { m = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return; } try { Handle(m); } catch (e) { console.error(e); } });
        c.on('close', () => { clearTimeout(guard); Conn.onClose(c); });
        c.on('error', () => { clearTimeout(guard); });
      } catch (err) { Conn.fail(err); }
    },
    onPeerError(err) {
      if (err.type === 'peer-unavailable') Conn.fail(err);
    },
    fail(err) {
      if (Conn.intentional) return;
      clearInterval(Conn.wd);
      const info = Net.explainPeerError(err);
      if (err.type === 'peer-unavailable' && Conn.first && !State.everConnected) {
        Conn.intentional = true; Conn.setState('idle'); Store.setLastJoin(null);
        Views.show('join'); Views.joinError(info.msg);
        return;
      }
      Conn.setState(State.everConnected || Conn.attempts > 0 ? 'reconnecting' : 'connecting', info);
      Conn.schedule();
    },
    onClose(c) {
      if (Conn.intentional || (c && Conn.conn !== c)) return;
      clearInterval(Conn.wd);
      if (Conn.state === 'online') Conn.setState('reconnecting');
      Conn.schedule();
    },
    schedule() {
      if (Conn.intentional) return;
      clearTimeout(Conn.timer);
      Conn.first = false;
      if (Conn.attempts > 6 && Conn.state !== 'offline') Conn.setState('offline');
      Conn.timer = setTimeout(() => Conn.dial(), Net.backoff(Conn.attempts++));
    },
    retryNow() { if (!Conn.target || Conn.intentional) return; Conn.attempts = 0; Conn.setState(State.everConnected ? 'reconnecting' : 'connecting'); Conn.dial(); },
    stop() {
      Conn.intentional = true; clearTimeout(Conn.timer); clearInterval(Conn.wd); State.outbox = [];
      if (Conn.conn) { try { Conn.raw({ type: 'LEAVE' }); Conn.conn.close(); } catch (e) { /* ignore */ } Conn.conn = null; }
      if (Conn.peer) { try { Conn.peer.destroy(); } catch (e) { /* ignore */ } Conn.peer = null; }
      Conn.setState('idle'); $('banner').hidden = true;
    },
    raw(msg) { try { if (Conn.conn && Conn.conn.open) { Conn.conn.send(JSON.stringify(msg)); return true; } } catch (e) { console.warn('send failed', e); } return false; },
    /** Sends a message; durable messages wait in the outbox while offline. */
    send(msg, durable) {
      if (Conn.state === 'online' && Conn.raw(msg)) return true;
      if (durable) { State.outbox = State.outbox.filter(m => !(m.id && m.id === msg.id && m.type === msg.type)); State.outbox.push(msg); }
      return false;
    },
    flush() {
      const q = State.outbox; State.outbox = [];
      q.forEach(m => Conn.send(m, true));
      // anything we saved as "sending" in an earlier session
      State.notes.filter(n => n.status === 'sending' && n.boardId === State.boardId && !q.some(m => m.id === n.id)).forEach(n => Conn.send(noteMsg(n), true));
    }
  };
  function noteMsg(n) { return n.src ? { type: 'IMG_NOTE', id: n.id, src: n.src, text: n.text, zoneId: n.zoneId || null } : { type: 'NOTE', id: n.id, sub: n.sub, text: n.text, zoneId: n.zoneId || null }; }
  window.addEventListener('online', () => { if (Conn.state !== 'online') Conn.retryNow(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Conn.target && !Conn.intentional && Conn.state !== 'online') Conn.retryNow(); });

  /* ====================================================================== */
  /* Message handling                                                        */
  /* ====================================================================== */
  function setActivity(a) {
    const prev = State.activity;
    State.activity = Object.assign({ type: 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null }, a);
    const changed = prev.type !== State.activity.type || prev.id !== State.activity.id || prev.sub !== State.activity.sub || prev.rid !== State.activity.rid;
    Views.renderBoard(); Views.syncChrome();
    if (changed) {
      const t = State.activity.type;
      if (t === 'OPEN') DQBUI.announce('Your teacher opened the board. You can add notes.');
      else if (t === 'LOCKED' && prev.type !== 'LOCKED') DQBUI.announce('The board is locked.');
      Write.sync();
    }
  }
  function autoOpenTask() {
    const a = State.activity;
    if (isDone()) return;
    if (a.type === 'POLL') { Pages.closeAll(['p-poll']); Poll.open(); }
    else if (a.type === 'GRAPH') { Pages.closeAll(['p-graph']); Graph.open(); }
    else if (a.type === 'EXIT') { Pages.closeAll(['p-exit']); Exit.open(); }
  }

  function Handle(d) {
    if (!d || typeof d.type !== 'string') return;
    switch (d.type) {
      case 'HEARTBEAT': break;
      case 'WELCOME': {
        const first = !State.everConnected;
        State.boardId = d.boardId || 'board'; State.everConnected = true; Conn.attempts = 0;
        if (d.rules) State.rules = { names: d.rules.names !== false, approve: !!d.rules.approve };
        State.muted = !!d.muted; State.me.color = d.color || null;
        Store.setLastJoin(Conn.target);
        (d.sync || []).forEach(n => { const l = State.notes.find(x => x.id === n.id); if (l) { l.text = clampStr(n.text, 1000); l.sub = n.sub; if (l.status !== 'approved') { l.status = 'approved'; } Store.saveNote(l); } });
        (d.pending || []).forEach(id => { const l = State.notes.find(x => x.id === id); if (l && l.status !== 'pending') { l.status = 'pending'; Store.saveNote(l); } });
        if (d.timer) Timer.set(d.timer);
        Conn.setState('online');
        State.activity = { type: 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null };
        if (d.payload) Handle(d.payload); else if (d.mode) Handle({ type: 'MODE', val: d.mode });
        else setActivity({});
        Views.show('board', true); Views.setTab('board'); Views.renderNotes(); Views.renderMe();
        if (first) Toast.success('You’re in!', { duration: 1800 });
        Conn.flush();
        break;
      }
      case 'MODE': { Pages.closeAll(['p-write', 'p-sketch']); setActivity({ type: d.val === 'OPEN' ? 'OPEN' : 'LOCKED' }); break; }
      case 'ZONE_ACT': case 'OPEN_ZONE': case 'ACT_VOTE': case 'ACT_SORT': case 'ACT_DISCUSS': {
        const sub = d.type === 'ZONE_ACT' ? (d.subType || d.type) : d.type;
        const items = (Array.isArray(d.items) ? d.items : []).slice(0, 100).map(i => ({ id: safeId(i.id), text: clampStr(i.text, 300), sub: i.sub })).filter(i => i.id);
        if (sub !== 'OPEN_ZONE') Pages.closeAll();
        if (sub === 'ACT_SORT') Rank.reset(items);
        if (sub === 'ACT_VOTE') Vote.reset();
        setActivity({ type: 'ZONE', id: safeId(d.actId), rid: safeId(d.rid), sub, title: clampStr(d.title, 80), zoneType: d.zoneType || null, items });
        break;
      }
      case 'ACT_POLL': { const id = safeId(d.actId); Pages.closeAll(); setActivity({ type: 'POLL', id, rid: safeId(d.rid), title: clampStr(d.q, 200), payload: { q: clampStr(d.q, 200), opts: (Array.isArray(d.opts) ? d.opts : []).slice(0, 12).map(o => clampStr(o && o.lbl, 80)) } }); Poll.reset(); autoOpenTask(); break; }
      case 'ACT_GRAPH': { const id = safeId(d.actId); Pages.closeAll(); setActivity({ type: 'GRAPH', id, rid: safeId(d.rid), title: clampStr(d.title, 120), payload: {} }); autoOpenTask(); break; }
      case 'EXIT_TICKET': {
        const id = safeId(d.actId); Pages.closeAll();
        setActivity({ type: 'EXIT', id, rid: safeId(d.rid), title: 'Exit ticket', payload: { mode: ['short', 'smiley', 'mc', 'multi', 'lw'].includes(d.mode) ? d.mode : 'short', prompt: clampStr(d.prompt, 300), opts: (Array.isArray(d.opts) ? d.opts : []).slice(0, 12).map(o => clampStr(o, 80)) } });
        autoOpenTask(); break;
      }
      case 'STOP_ACT': { Pages.closeAll(['p-write', 'p-sketch']); setActivity({ type: 'LOCKED' }); break; }
      case 'SET_COLOR': State.me.color = safeColor(d.color) || null; Views.renderMe(); break;
      case 'RULES': if (d.rules) { State.rules = { names: d.rules.names !== false, approve: !!d.rules.approve }; Write.sync(); } break;
      case 'MUTE': State.muted = !!d.on; Views.renderBoard(); Views.syncChrome(); Write.sync(); if (State.muted) Toast.warn('Your teacher paused notes from you for now.'); else Toast.success('You can add notes again.'); break;
      case 'KICKED': Conn.stop(); Store.setLastJoin(null); State.everConnected = false; Pages.closeAll(); Views.ended(d.reason === 'code-reset' ? 'The class code was reset' : 'You were removed from the class', d.reason === 'code-reset' ? 'Your teacher generated a new code. Ask for it to rejoin.' : 'Your teacher removed you from this session.'); break;
      case 'TIMER': Timer.set(d); break;
      case 'NOTE_STATUS': {
        const n = State.notes.find(x => x.id === d.id); if (!n) break;
        n.status = d.status === 'approved' ? 'approved' : (d.status === 'pending' ? 'pending' : 'rejected'); n.reason = d.reason || null; Store.saveNote(n);
        if (n.status === 'rejected') Toast.warn(rejectMsg(d.reason));
        break;
      }
      case 'CONSENSUS_START': CM.start(d); break;
      case 'CONSENSUS_STOP': CM.stop(); break;
      case 'CONSENSUS_PERMS': CM.setPerms(!!d.canDraw); break;
      case 'CONSENSUS_INK': CM.addInk(d.ink); break;
      case 'CONSENSUS_CLEAR': CM.setInk([]); break;
      case 'CONSENSUS_SET_INK': CM.setInk(d.ink); break;
      case 'CONSENSUS_ITEM_MOVE': CM.moveItem(d.id, d.x, d.y); break;
      case 'CONSENSUS_VIEW_SYNC': CM.hostView(d); break;
    }
  }
  function rejectMsg(r) { return ({ locked: 'The board is locked, so that note wasn’t added. It’s saved in My notes.', muted: 'Your teacher paused notes from you.', color: 'That zone is for a different group.', limit: 'You’ve reached the note limit for this session.', image: 'That drawing was too large to send. Try a simpler one.', declined: 'Your teacher didn’t add that note.' })[r] || 'That note wasn’t added to the board.'; }

  /* ====================================================================== */
  /* Pages (full-screen task screens with history support)                   */
  /* ====================================================================== */
  const Pages = {
    stack: [],
    open(id, o) {
      const el = $(id); if (!el || !el.hidden) return;
      o = o || {};
      el.hidden = false; el.classList.remove('closing');
      const entry = { onPop: () => Pages.close(id, true) };
      Hist.push(entry);
      Pages.stack.push({ id, el, entry, onClose: o.onClose });
      Pages.inert();
      setTimeout(() => { const f = o.focus ? el.querySelector(o.focus) : el.querySelector('textarea, input:not([type=hidden]), .page-body button, h2'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }, 60);
      const h2 = el.querySelector('h2'); if (h2) DQBUI.announce(h2.textContent);
    },
    close(id, viaPop) {
      const i = Pages.stack.findIndex(p => p.id === id); if (i < 0) return;
      const p = Pages.stack.splice(i, 1)[0];
      if (!viaPop) Hist.remove(p.entry);
      p.el.classList.add('closing');
      setTimeout(() => { p.el.hidden = true; p.el.classList.remove('closing'); }, 190);
      Pages.inert();
      if (p.onClose) p.onClose();
    },
    closeAll(except) { Pages.stack.slice().reverse().forEach(p => { if (!except || !except.includes(p.id)) Pages.close(p.id); }); },
    isOpen(id) { return Pages.stack.some(p => p.id === id); },
    inert() { const any = Pages.stack.length > 0; ['main', 'topbar', 'tabbar', 'banner'].forEach(n => { try { $(n).inert = any; } catch (e) { /* ignore */ } }); }
  };
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) { const pg = c.closest('.page'); if (pg) { if (pg.id === 'p-sketch' || pg.id === 'p-write' || pg.id === 'p-consensus') Pages.close(pg.id); else Pages.close(pg.id); } } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && Overlay.count() === 0 && Pages.stack.length) Pages.close(Pages.stack[Pages.stack.length - 1].id); });

  /* ====================================================================== */
  /* Views                                                                   */
  /* ====================================================================== */
  const Views = {
    names: ['setup', 'join', 'board', 'notes', 'ended'],
    show(name, silent) {
      State.view = name;
      Views.names.forEach(n => { const el = $('v-' + n); if (el) el.hidden = n !== name; });
      Views.syncChrome();
      $('main').scrollTop = 0;
      if (name === 'setup') { const chip = $('join-chip'); chip.hidden = !State.target; if (State.target) $('join-chip-code').textContent = State.target.code ? Net.formatCode(State.target.code) : 'from a link'; }
      if (name === 'join') { $('code-err').hidden = true; $('scan-err').hidden = true; }
      if (!silent && name === 'setup') setTimeout(() => $('inp-name').focus({ preventScroll: true }), 80);
    },
    setTab(t) {
      State.tab = t;
      if (State.view === 'board' || State.view === 'notes') Views.show(t === 'notes' ? 'notes' : 'board', true);
      $$('#tabbar [data-tab]').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    },
    syncChrome() {
      const inApp = State.view === 'board' || State.view === 'notes';
      $('topbar').hidden = !inApp; $('tabbar').hidden = !inApp;
      const canAdd = Write.canAdd();
      $('tab-add').classList.toggle('disabled', !canAdd);
      $('tab-add').setAttribute('aria-disabled', String(!canAdd));
      const n = State.notes.filter(x => x.boardId === State.boardId).length;
      const b = $('notes-badge'); b.hidden = !n; b.textContent = n;
    },
    renderMe() {
      $('me-av').textContent = State.me.av; $('me-name').textContent = State.me.name || 'Student';
      const btn = $('me-btn'); btn.classList.toggle('has-color', !!State.me.color); btn.style.borderColor = State.me.color || ''; btn.style.background = State.me.color ? State.me.color + '22' : '';
    },
    joinError(msg) { const e = $('code-err'); e.textContent = msg; e.hidden = false; $('inp-code').classList.add('invalid'); },
    ended(title, msg) { $('ended-title').textContent = title; $('ended-msg').textContent = msg; Views.show('ended'); },

    /* ---- the board tab ---- */
    statusCard(emoji, title, text, live) { return `<div class="card status-card ${live ? 'live' : ''}">${live ? '<span class="live-tag">LIVE</span>' : ''}<div class="big" aria-hidden="true">${emoji}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`; },
    typeTiles(types) {
      return `<div class="type-tiles">${types.map(t => `<button type="button" class="type-tile t-${t}" data-act="add" data-type="${t}"><span class="emoji" aria-hidden="true">${TYPES[t].icon}</span><b>${TYPES[t].lbl}</b><small>${esc(TYPES[t].hint)}</small></button>`).join('')}<button type="button" class="type-tile t-sketch wide" data-act="sketch"><span class="emoji" aria-hidden="true">✏️</span><span><b>Draw a sketch</b><br><small>Use your finger or a mouse to draw an idea.</small></span></button></div>`;
    },
    renderBoard() {
      const box = $('board-content'); if (!box) return;
      const a = State.activity; let html = '';
      if (State.muted) html += `<div class="warn-box">${ic('volume-x', 'sm')} Your teacher paused notes from you for now.</div>`;
      if (a.type === 'LOCKED') html += Views.statusCard('👀', 'Eyes on the board', 'Your teacher will open the board when it’s time to share ideas. Hang tight!');
      else if (a.type === 'OPEN') html += Views.statusCard('✨', 'The board is open', 'Choose what you’d like to add.', true) + Views.typeTiles(OPEN_TYPES);
      else if (a.type === 'ZONE') {
        if (a.sub === 'OPEN_ZONE') {
          const cer = a.zoneType === 'cer';
          html += Views.statusCard(cer ? '🏛️' : '📌', a.title || 'Add to this zone', cer ? 'Build an argument: add a claim, evidence and reasoning.' : 'Your notes will go into this zone on the board.', true) + Views.typeTiles(cer ? CER_TYPES : OPEN_TYPES);
        } else if (a.sub === 'ACT_VOTE') html += Vote.html();
        else if (a.sub === 'ACT_SORT') html += Rank.html();
        else if (a.sub === 'ACT_DISCUSS') html += Discuss.html();
      } else {
        const done = isDone();
        const label = { POLL: 'Quick poll', GRAPH: 'Class data', EXIT: 'Exit ticket' }[a.type];
        html += done ? `<div class="card done-card"><div class="ok">${ic('check', 'lg')}</div><div><b>Response sent</b><div class="text-2">Thanks! Wait for your teacher to move on.</div></div></div>`
          : `<div class="card act-card"><div class="act-head"><span class="act-tag">${label}</span></div><h2>${esc(a.title || '')}</h2><button type="button" class="btn btn-primary btn-lg" data-act="open-task">Answer now</button></div>`;
      }
      box.innerHTML = html; hydrateIcons(box);
      if (a.type === 'ZONE' && a.sub === 'ACT_SORT') Rank.mount();
    },

    /* ---- my notes tab ---- */
    renderNotes() {
      const list = $('notes-list'); if (!list) return;
      const notes = State.notes.filter(n => n.boardId === State.boardId || (!State.boardId && false)).sort((a, b) => b.ts - a.ts);
      $('notes-count').textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
      if (!notes.length) { list.innerHTML = `<div class="card empty"><div class="em-ico">${ic('note', 'lg')}</div><div class="em-t">No notes yet</div><div>Tap the <b>+</b> button when your teacher opens the board.</div></div>`; Views.syncChrome(); return; }
      const label = { sending: ['Sending…', 'status-sending'], approved: ['On the board', 'status-approved'], pending: ['Waiting for your teacher', 'status-pending'], rejected: ['Not added', 'status-rejected'] };
      list.innerHTML = notes.map(n => {
        const t = TYPES[n.sub] || TYPES.notice, st = label[n.status || 'approved'];
        return `<article class="note-card t-${esc(TYPES[n.sub] ? n.sub : 'notice')}" data-id="${esc(n.id)}">${n.src ? `<img alt="Your drawing" data-img="${esc(n.id)}">${n.text ? `<div class="txt" style="margin-top:8px;font-size:1.05rem">${esc(n.text)}</div>` : ''}` : `<div class="txt">${esc(n.text)}</div>`}<div class="meta"><span class="chip">${t.icon} ${t.lbl}</span><span class="chip ${st[1]}">${st[0]}</span><span class="grow"></span>${n.status === 'rejected' && n.reason === 'locked' ? `<button type="button" class="btn btn-soft btn-sm" data-act="retry" data-id="${esc(n.id)}">${ic('refresh', 'sm')}Try again</button>` : ''}<button type="button" class="icon-btn sm" data-act="del" data-id="${esc(n.id)}" aria-label="Delete this note">${ic('trash', 'sm')}</button></div></article>`;
      }).join('');
      $$('img[data-img]', list).forEach(img => { const n = State.notes.find(x => x.id === img.dataset.img); const s = n && safeImg(n.src, 3000000); if (s) img.src = s; });
      Views.syncChrome();
    }
  };

  /* ---- board interactions (event delegation) ---- */
  on($('board-content'), 'click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'add') Write.open(b.dataset.type);
    else if (act === 'sketch') Sketch.open();
    else if (act === 'open-task') autoOpenTaskForce();
    else if (act === 'pick-vote') Vote.pick(b.dataset.id);
    else if (act === 'send-vote') Vote.send();
    else if (act === 'send-rank') Rank.send();
    else if (act === 'comment') Discuss.open(b.dataset.id);
  });
  function autoOpenTaskForce() { const a = State.activity; if (a.type === 'POLL') Poll.open(); else if (a.type === 'GRAPH') Graph.open(); else if (a.type === 'EXIT') Exit.open(); }
  on($('notes-list'), 'click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const n = State.notes.find(x => x.id === b.dataset.id); if (!n) return;
    if (b.dataset.act === 'del') {
      const ok = await Dialog.confirm({ title: 'Delete this note?', message: n.status === 'approved' || n.status === 'sending' ? 'It will also be removed from the board.' : 'This can’t be undone.', confirmLabel: 'Delete', danger: true });
      if (!ok) return; Conn.send({ type: 'DELETE_NOTE', id: n.id }, true); Store.delNote(n.id); Toast.show('Note deleted');
    } else if (b.dataset.act === 'retry') {
      if (!Write.canAdd()) { Toast.warn('The board is locked right now.'); return; }
      n.status = 'sending'; n.reason = null; Store.saveNote(n); Conn.send(noteMsg(n), true);
    }
  });
  on($('tabbar'), 'click', e => {
    const t = e.target.closest('[data-tab]'); if (t) { Views.setTab(t.dataset.tab); return; }
    if (e.target.closest('#tab-add')) { if (!Write.canAdd()) { Toast.info(State.muted ? 'Your teacher paused notes from you for now.' : 'Your teacher hasn’t opened the board for notes yet.'); return; } Write.openDefault(); }
  });

  /* ====================================================================== */
  /* Vote · Rank · Discuss                                                   */
  /* ====================================================================== */
  const Vote = {
    choice: null, sent: false,
    reset() { Vote.choice = null; Vote.sent = false; },
    html() {
      const a = State.activity;
      if (isDone()) return `<div class="card done-card"><div class="ok">${ic('check', 'lg')}</div><div><b>Vote sent</b><div class="text-2">Thanks! Your vote has been counted.</div></div></div>`;
      return `<div class="card act-card"><div class="act-head"><span class="act-tag">Vote</span></div><h2>Which one do you pick?</h2><div class="choice-list" role="radiogroup" aria-label="Notes to vote for">${a.items.map(i => `<button type="button" class="choice" role="radio" aria-checked="${Vote.choice === i.id}" data-act="pick-vote" data-id="${esc(i.id)}"><span class="mark">${ic('check', 'sm')}</span><span class="txt" style="font-family:var(--font-hand);font-size:1.15rem">${esc(i.text || 'Sketch')}</span></button>`).join('')}</div></div><div class="sticky-act"><button type="button" class="btn btn-primary btn-lg btn-block" data-act="send-vote" ${Vote.choice ? '' : 'disabled'}>Submit vote</button></div>`;
    },
    pick(id) { Vote.choice = id; Views.renderBoard(); },
    send() {
      if (!Vote.choice) return;
      Conn.send({ type: 'SUBMIT_VOTE', actId: State.activity.id, choiceId: Vote.choice }, true);
      markDone(); DQBUI.haptic(15); Toast.success('Vote sent'); Views.renderBoard();
    }
  };
  const Rank = {
    order: [],
    reset(items) { Rank.order = items.slice(); },
    html() {
      const a = State.activity;
      if (isDone()) return `<div class="card done-card"><div class="ok">${ic('check', 'lg')}</div><div><b>Ranking sent</b><div class="text-2">Thanks! Your order has been counted.</div></div></div>`;
      return `<div class="card act-card"><div class="act-head"><span class="act-tag">Rank</span></div><h2>Put them in order</h2><p class="text-2">Drag the handle (or use the arrows). Best idea first.</p><div class="sort-list" id="sort-list" aria-label="Notes to rank"></div></div><div class="sticky-act"><button type="button" class="btn btn-primary btn-lg btn-block" data-act="send-rank">Submit ranking</button></div>`;
    },
    mount() {
      const list = $('sort-list'); if (!list) return;
      const draw = () => {
        list.innerHTML = Rank.order.map((i, idx) => `<div class="sort-item" data-id="${esc(i.id)}"><span class="rank">${idx + 1}</span><span class="txt">${esc(i.text || 'Sketch')}</span><button type="button" class="icon-btn mv" data-mv="-1" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>${ic('up', 'sm')}</button><button type="button" class="icon-btn mv" data-mv="1" aria-label="Move down" ${idx === Rank.order.length - 1 ? 'disabled' : ''}>${ic('down', 'sm')}</button><button type="button" class="grip" data-grip aria-label="Drag to reorder">${ic('grip')}</button></div>`).join('');
      };
      draw();
      on(list, 'click', e => {
        const mv = e.target.closest('[data-mv]'); if (!mv) return;
        const id = mv.closest('.sort-item').dataset.id, i = Rank.order.findIndex(x => x.id === id), j = i + +mv.dataset.mv;
        if (j < 0 || j >= Rank.order.length) return;
        [Rank.order[i], Rank.order[j]] = [Rank.order[j], Rank.order[i]]; draw();
        const f = list.querySelector(`[data-id="${CSS.escape(id)}"] [data-mv="${mv.dataset.mv}"]`) || list.querySelector(`[data-id="${CSS.escape(id)}"] .mv`); if (f) f.focus({ preventScroll: true });
      });
      // pointer drag on the grip
      let drag = null;
      on(list, 'pointerdown', e => {
        const g = e.target.closest('[data-grip]'); if (!g) return;
        const item = g.closest('.sort-item'); e.preventDefault();
        drag = { item, startY: e.clientY }; item.classList.add('dragging'); try { g.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      on(list, 'pointermove', e => {
        if (!drag) return;
        const { item } = drag; item.style.transform = `translateY(${e.clientY - drag.startY}px)`;
        const r = item.getBoundingClientRect(), mid = r.top + r.height / 2;
        const next = item.nextElementSibling, prev = item.previousElementSibling;
        if (next) { const nr = next.getBoundingClientRect(); if (mid > nr.top + nr.height / 2) { const before = item.getBoundingClientRect().top; list.insertBefore(next, item); drag.startY += item.getBoundingClientRect().top - before; item.style.transform = `translateY(${e.clientY - drag.startY}px)`; } }
        if (prev) { const pr = prev.getBoundingClientRect(); if (mid < pr.top + pr.height / 2) { const before = item.getBoundingClientRect().top; list.insertBefore(item, prev); drag.startY += item.getBoundingClientRect().top - before; item.style.transform = `translateY(${e.clientY - drag.startY}px)`; } }
      });
      const end = () => {
        if (!drag) return; drag.item.classList.remove('dragging'); drag.item.style.transform = '';
        const ids = $$('.sort-item', list).map(n => n.dataset.id); Rank.order = ids.map(id => Rank.order.find(x => x.id === id)).filter(Boolean); drag = null; draw();
      };
      on(list, 'pointerup', end); on(list, 'pointercancel', end);
    },
    send() {
      Conn.send({ type: 'SUBMIT_SORT', actId: State.activity.id, order: Rank.order.map(i => i.id) }, true);
      markDone(); DQBUI.haptic(15); Toast.success('Ranking sent'); Views.renderBoard();
    }
  };
  const Discuss = {
    html() {
      const a = State.activity;
      return `<div class="card act-card"><div class="act-head"><span class="act-tag">Discuss</span></div><h2>Add your thoughts</h2><p class="text-2">Tap a note to give feedback, ask a question or make a connection.</p><div class="choice-list">${a.items.map(i => `<button type="button" class="note-chip t-${esc(TYPES[i.sub] ? i.sub : 'notice')}" data-act="comment" data-id="${esc(i.id)}">${esc(i.text || 'Sketch')}</button>`).join('')}</div></div>`;
    },
    open(id) {
      const it = State.activity.items.find(i => i.id === id); if (!it) return;
      let tag = 'feedback';
      const wrap = DQBUI.h(`<div class="stack"><div class="note-chip t-${esc(TYPES[it.sub] ? it.sub : 'notice')}" style="cursor:default">${esc(it.text || 'Sketch')}</div><div class="tag-row" role="radiogroup" aria-label="Kind of comment">${[['feedback', 'Feedback'], ['question', 'Question'], ['connection', 'Connection']].map(([v, l]) => `<button type="button" class="chip ${v === tag ? 'active' : ''}" role="radio" aria-checked="${v === tag}" data-tag="${v}">${l}</button>`).join('')}</div><div class="field"><label for="cm-text">Your comment</label><textarea class="textarea" id="cm-text" rows="3" maxlength="300" placeholder="Type your comment…"></textarea></div></div>`);
      on(wrap, 'click', e => { const b = e.target.closest('[data-tag]'); if (!b) return; tag = b.dataset.tag; $$('[data-tag]', wrap).forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); }); });
      Overlay.open({ title: 'Add a comment', content: wrap, size: 'sm', initialFocus: '#cm-text', footer: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Post', kind: 'primary', icon: 'send', close: false, onClick: (ov) => { const t = wrap.querySelector('#cm-text').value.trim(); if (!t) { wrap.querySelector('#cm-text').focus(); return false; } Conn.send({ type: 'COMMENT', targetId: id, text: t, tag }, true); ov.close(); Toast.success('Comment posted'); } }] });
    }
  };

  /* ====================================================================== */
  /* Write a note                                                            */
  /* ====================================================================== */
  const Write = {
    type: 'notice', types: OPEN_TYPES,
    zoneActive() { const a = State.activity; return a.type === 'ZONE' && a.sub === 'OPEN_ZONE'; },
    canAdd() { const a = State.activity; return !State.muted && (a.type === 'OPEN' || (a.type === 'ZONE' && a.sub === 'OPEN_ZONE')); },
    ctxTypes() { return (Write.zoneActive() && State.activity.zoneType === 'cer') ? CER_TYPES : OPEN_TYPES; },
    openDefault() { Write.open(Write.ctxTypes()[0]); },
    open(type) {
      if (!Write.canAdd()) { Toast.info('The board isn’t open for notes right now.'); return; }
      Write.types = Write.ctxTypes();
      if (!Write.types.includes(type)) type = Write.types[0];
      const draft = Write.loadDraft();
      Write.type = type;
      $('w-chips').innerHTML = Write.types.map(t => `<button type="button" class="chip" role="radio" aria-checked="false" data-type="${t}">${TYPES[t].icon} ${TYPES[t].lbl}</button>`).join('');
      $('w-txt').value = draft && draft.sub === type ? draft.text : '';
      Write.setType(type, true);
      Pages.open('p-write', { focus: '#w-txt' });
      Write.sync();
    },
    setType(t, init) {
      Write.type = t; const info = TYPES[t];
      $('w-title').textContent = 'New ' + info.lbl.toLowerCase() + (t === 'claim' || t === 'evidence' || t === 'reasoning' ? '' : ' note');
      $('w-txt').placeholder = info.ph; $('w-hint').textContent = info.hint;
      const paper = $('w-paper'); paper.className = 'note-paper t-' + t;
      $$('#w-chips .chip').forEach(c => { const a = c.dataset.type === t; c.classList.toggle('active', a); c.setAttribute('aria-checked', String(a)); });
      if (!init) { const d = Write.loadDraft(); if (d && d.sub === t && !$('w-txt').value) $('w-txt').value = d.text; }
      Write.sync();
    },
    count() { const n = $('w-txt').value.length; const c = $('w-count'); c.textContent = `${n} / ${MAX_TEXT}`; c.classList.toggle('near', n > MAX_TEXT - 40); $('w-send').disabled = !$('w-txt').value.trim() || !Write.canAdd(); },
    sync() {
      if (!Pages.isOpen('p-write')) return;
      const w = $('w-warn');
      if (!Write.canAdd()) { w.hidden = false; w.textContent = State.muted ? 'Your teacher paused notes from you. Your draft is saved.' : 'The board was locked, so this note can’t be sent yet. Your draft is saved.'; }
      else { w.hidden = true; }
      const hint = State.rules.approve ? ' Your teacher will check notes before they appear.' : (State.rules.names ? '' : ' Your name won’t be shown.');
      $('w-hint').textContent = TYPES[Write.type].hint + hint;
      Write.count();
    },
    loadDraft() { try { const d = JSON.parse(localStorage.getItem('dqb_draft') || 'null'); return d && Date.now() - d.ts < 86400000 ? d : null; } catch (e) { return null; } },
    saveDraft: DQBUI.debounce(() => { try { const t = $('w-txt').value; if (t.trim()) localStorage.setItem('dqb_draft', JSON.stringify({ sub: Write.type, text: t, ts: Date.now() })); else localStorage.removeItem('dqb_draft'); } catch (e) { /* ignore */ } }, 400),
    send() {
      const text = $('w-txt').value.trim();
      if (!text || !Write.canAdd()) return;
      const n = { id: DQBUI.genId(), sub: Write.type, text: clampStr(text, MAX_TEXT), ts: Date.now(), boardId: State.boardId || 'board', status: 'sending', zoneId: Write.zoneActive() ? State.activity.id : null };
      Store.saveNote(n); Conn.send(noteMsg(n), true);
      try { localStorage.removeItem('dqb_draft'); } catch (e) { /* ignore */ }
      $('w-txt').value = ''; Pages.close('p-write'); DQBUI.haptic(15);
      Toast.success(State.rules.approve ? 'Sent — waiting for your teacher' : 'Sent to the board', { duration: 2000 });
    },
    init() {
      on($('w-txt'), 'input', () => { Write.count(); Write.saveDraft(); });
      on($('w-chips'), 'click', e => { const b = e.target.closest('[data-type]'); if (b) { Write.setType(b.dataset.type); $('w-txt').focus(); } });
      on($('w-send'), 'click', Write.send);
      on($('w-sketch'), 'click', () => { Pages.close('p-write'); setTimeout(() => Sketch.open(), 220); });
    }
  };

  /* ====================================================================== */
  /* Sketch                                                                  */
  /* ====================================================================== */
  const COLORS = [['#111827', 'Black'], ['#ef4444', 'Red'], ['#f97316', 'Orange'], ['#10b981', 'Green'], ['#3b82f6', 'Blue'], ['#8b5cf6', 'Purple']];
  const Sketch = {
    ctx: null, color: '#111827', size: 3, erase: false, drawing: false, last: null, history: [], dirty: false, ready: false,
    open() {
      if (!Write.canAdd()) { Toast.info('The board isn’t open for notes right now.'); return; }
      Pages.open('p-sketch', { focus: '#s-caption' });
      requestAnimationFrame(() => { Sketch.layout(); Sketch.sync(); });
    },
    layout() {
      const wrap = $('s-wrap'), cv = $('s-canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth || 320, h = Math.round(Math.min(Math.max(w * 0.9, 240), window.innerHeight * 0.52));
      wrap.style.height = h + 'px';
      if (cv.width === Math.round(w * dpr) && cv.height === Math.round(h * dpr) && Sketch.ctx) return;
      let snap = null; if (Sketch.ctx && Sketch.dirty) { snap = document.createElement('canvas'); snap.width = cv.width; snap.height = cv.height; snap.getContext('2d').drawImage(cv, 0, 0); }
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const ctx = Sketch.ctx = cv.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (snap) ctx.drawImage(snap, 0, 0, cv.width, cv.height);
      Sketch.dpr = dpr;
    },
    sync() {
      const w = $('s-warn');
      if (!Write.canAdd()) { w.hidden = false; w.textContent = 'The board was locked, so this drawing can’t be sent yet. Your drawing is kept here.'; } else w.hidden = true;
      $('s-send').disabled = !Sketch.dirty || !Write.canAdd();
      $('s-undo').disabled = Sketch.history.length === 0; $('s-clear').disabled = !Sketch.dirty;
    },
    pos(e) { const r = $('s-canvas').getBoundingClientRect(); return { x: (e.clientX - r.left) * ($('s-canvas').width / r.width), y: (e.clientY - r.top) * ($('s-canvas').height / r.height) }; },
    snapshot() { try { Sketch.history.push(Sketch.ctx.getImageData(0, 0, $('s-canvas').width, $('s-canvas').height)); if (Sketch.history.length > 20) Sketch.history.shift(); } catch (e) { /* ignore */ } },
    down(e) {
      if (!Sketch.ctx) return; e.preventDefault(); try { $('s-canvas').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      Sketch.snapshot(); Sketch.drawing = true; Sketch.last = Sketch.pos(e);
      const c = Sketch.ctx; c.globalCompositeOperation = Sketch.erase ? 'destination-out' : 'source-over'; c.strokeStyle = Sketch.color; c.fillStyle = Sketch.color;
      c.lineWidth = (Sketch.erase ? Sketch.size * 3 : Sketch.size) * Sketch.dpr * (e.pointerType === 'pen' && e.pressure ? 0.6 + e.pressure * 0.8 : 1);
      c.beginPath(); c.arc(Sketch.last.x, Sketch.last.y, c.lineWidth / 2, 0, Math.PI * 2); c.fill(); Sketch.dirty = true; Sketch.mid = Sketch.last; Sketch.sync();
    },
    move(e) {
      if (!Sketch.drawing) return; e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e], c = Sketch.ctx;
      (events.length ? events : [e]).forEach(ev => {
        const p = Sketch.pos(ev), m = { x: (Sketch.last.x + p.x) / 2, y: (Sketch.last.y + p.y) / 2 };
        c.beginPath(); c.moveTo(Sketch.mid.x, Sketch.mid.y); c.quadraticCurveTo(Sketch.last.x, Sketch.last.y, m.x, m.y); c.stroke(); Sketch.last = p; Sketch.mid = m;
      });
    },
    up() { if (!Sketch.drawing) return; Sketch.drawing = false; Sketch.sync(); },
    undo() { const s = Sketch.history.pop(); if (!s) return; Sketch.ctx.putImageData(s, 0, 0); Sketch.dirty = Sketch.history.length > 0 || false; if (!Sketch.history.length) { Sketch.dirty = false; } Sketch.sync(); },
    async clear() { if (!Sketch.dirty) return; const ok = await Dialog.confirm({ title: 'Clear your drawing?', confirmLabel: 'Clear', danger: true }); if (!ok) return; Sketch.snapshot(); Sketch.ctx.clearRect(0, 0, $('s-canvas').width, $('s-canvas').height); Sketch.dirty = false; Sketch.sync(); },
    exportData() {
      const cv = $('s-canvas'), maxW = 900, k = Math.min(1, maxW / cv.width);
      const out = document.createElement('canvas'); out.width = Math.round(cv.width * k); out.height = Math.round(cv.height * k);
      out.getContext('2d').drawImage(cv, 0, 0, out.width, out.height);
      let data = out.toDataURL('image/png');
      if (data.length > 1300000) { const k2 = 0.6; const o2 = document.createElement('canvas'); o2.width = Math.round(out.width * k2); o2.height = Math.round(out.height * k2); o2.getContext('2d').drawImage(out, 0, 0, o2.width, o2.height); data = o2.toDataURL('image/png'); }
      return data;
    },
    send() {
      if (!Sketch.dirty || !Write.canAdd()) return;
      const src = Sketch.exportData();
      const n = { id: DQBUI.genId(), sub: 'sketch', text: clampStr($('s-caption').value.trim(), 80), src, ts: Date.now(), boardId: State.boardId || 'board', status: 'sending', zoneId: Write.zoneActive() ? State.activity.id : null };
      Store.saveNote(n); Conn.send(noteMsg(n), true);
      Sketch.ctx.clearRect(0, 0, $('s-canvas').width, $('s-canvas').height); Sketch.dirty = false; Sketch.history = []; $('s-caption').value = '';
      Pages.close('p-sketch'); DQBUI.haptic(15); Toast.success(State.rules.approve ? 'Sent — waiting for your teacher' : 'Drawing sent', { duration: 2000 });
    },
    init() {
      const sw = $('s-colors');
      sw.innerHTML = COLORS.map(([c, n], i) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="${n}" aria-pressed="${i === 0}"></button>`).join('');
      on(sw, 'click', e => { const b = e.target.closest('[data-c]'); if (!b) return; Sketch.color = b.dataset.c; Sketch.erase = false; $('s-eraser').setAttribute('aria-pressed', 'false'); $$('#s-colors .swatch').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
      on($('s-sizes'), 'click', e => { const b = e.target.closest('[data-w]'); if (!b) return; Sketch.size = +b.dataset.w; $$('#s-sizes button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
      on($('s-eraser'), 'click', () => { Sketch.erase = !Sketch.erase; $('s-eraser').setAttribute('aria-pressed', String(Sketch.erase)); $('s-eraser').classList.toggle('active', Sketch.erase); });
      const cv = $('s-canvas');
      on(cv, 'pointerdown', Sketch.down); on(cv, 'pointermove', Sketch.move); on(cv, 'pointerup', Sketch.up); on(cv, 'pointercancel', Sketch.up);
      on($('s-undo'), 'click', Sketch.undo); on($('s-clear'), 'click', Sketch.clear); on($('s-send'), 'click', Sketch.send);
      window.addEventListener('resize', DQBUI.debounce(() => { if (Pages.isOpen('p-sketch')) Sketch.layout(); }, 150));
    }
  };

  /* ====================================================================== */
  /* Poll · Graph · Exit ticket                                              */
  /* ====================================================================== */
  const Poll = {
    choice: -1, reset() { Poll.choice = -1; },
    open() {
      const p = State.activity.payload || { q: '', opts: [] };
      $('poll-q').textContent = p.q;
      const list = $('poll-opts');
      list.innerHTML = p.opts.map((o, i) => `<button type="button" class="choice" role="radio" aria-checked="${Poll.choice === i}" data-i="${i}"><span class="letter">${'ABCDEFGHIJKL'[i] || i + 1}</span><span class="txt">${esc(o)}</span></button>`).join('');
      $('poll-send').disabled = Poll.choice < 0;
      Pages.open('p-poll');
    },
    init() {
      on($('poll-opts'), 'click', e => { const b = e.target.closest('[data-i]'); if (!b) return; Poll.choice = +b.dataset.i; $$('#poll-opts .choice').forEach(x => x.setAttribute('aria-checked', String(x === b))); $('poll-send').disabled = false; DQBUI.haptic(8); });
      on($('poll-send'), 'click', () => { if (Poll.choice < 0) return; Conn.send({ type: 'POLL_VOTE', actId: State.activity.id, idx: Poll.choice }, true); markDone(); Pages.close('p-poll'); Views.renderBoard(); Toast.success('Vote sent'); DQBUI.haptic(15); });
    }
  };
  const Graph = {
    open() { $('graph-q').textContent = State.activity.title || 'Class data'; $('graph-val').value = ''; $('graph-err').hidden = true; Pages.open('p-graph', { focus: '#graph-val' }); },
    init() {
      const send = () => {
        const raw = $('graph-val').value.trim().replace(',', '.'), v = Number(raw);
        if (!raw || !Number.isFinite(v)) { const e = $('graph-err'); e.textContent = 'Please enter a number.'; e.hidden = false; $('graph-val').focus(); return; }
        Conn.send({ type: 'DATA_SUBMIT', actId: State.activity.id, val: v }, true); markDone(); Pages.close('p-graph'); Views.renderBoard(); Toast.success('Sent'); DQBUI.haptic(15);
      };
      on($('graph-send'), 'click', send); on($('graph-val'), 'keydown', e => { if (e.key === 'Enter') send(); });
    }
  };
  const Exit = {
    val: null, sel: new Set(),
    open() {
      const p = State.activity.payload, area = $('exit-area'); Exit.val = null; Exit.sel = new Set(); $('exit-err').hidden = true;
      $('exit-q').textContent = p.prompt;
      const names = { short: 'Short answer', smiley: 'Rating', mc: 'Multiple choice', multi: 'Select all that apply', lw: 'Learn & wonder' };
      $('exit-badge').textContent = names[p.mode];
      if (p.mode === 'short') area.innerHTML = `<textarea class="textarea" id="ex-txt" rows="6" maxlength="500" placeholder="Type your response here…" aria-label="Your response"></textarea><div class="muted counter" style="text-align:right"><span id="ex-n">0</span> / 500</div>`;
      else if (p.mode === 'smiley') area.innerHTML = `<div class="smileys" role="radiogroup" aria-label="Rating">${[['😡', 'Not at all'], ['🙁', 'Not really'], ['😐', 'Somewhat'], ['🙂', 'Mostly'], ['😀', 'Absolutely!']].map(([e, l]) => `<button type="button" class="smiley" role="radio" aria-checked="false" data-v="${e}" aria-label="${l}"><span>${e}</span><small>${l}</small></button>`).join('')}</div>`;
      else if (p.mode === 'mc') area.innerHTML = `<div class="choice-list" role="radiogroup">${p.opts.map((o, i) => `<button type="button" class="choice" role="radio" aria-checked="false" data-i="${i}"><span class="letter">${'ABCDEFGHIJKL'[i]}</span><span class="txt">${esc(o)}</span></button>`).join('')}</div>`;
      else if (p.mode === 'multi') area.innerHTML = `<div class="choice-list">${p.opts.map((o, i) => `<button type="button" class="choice" aria-pressed="false" data-i="${i}"><span class="mark sq">${ic('check', 'sm')}</span><span class="txt">${esc(o)}</span></button>`).join('')}</div>`;
      else if (p.mode === 'lw') area.innerHTML = `<div class="lw-field"><label for="ex-l">💡 I learned…</label><textarea class="textarea" id="ex-l" rows="3" maxlength="300" placeholder="Something I learned today was…"></textarea></div><div class="lw-field"><label for="ex-w">❓ I wonder…</label><textarea class="textarea" id="ex-w" rows="3" maxlength="300" placeholder="I’m still wondering about…"></textarea></div>`;
      Pages.open('p-exit', { focus: p.mode === 'short' ? '#ex-txt' : (p.mode === 'lw' ? '#ex-l' : '.page-body button') });
    },
    init() {
      const area = $('exit-area');
      on(area, 'input', e => { if (e.target.id === 'ex-txt') $('ex-n').textContent = e.target.value.length; });
      on(area, 'click', e => {
        const p = State.activity.payload; const b = e.target.closest('button'); if (!b || !p) return;
        if (p.mode === 'smiley') { Exit.val = b.dataset.v; $$('.smiley', area).forEach(x => x.setAttribute('aria-checked', String(x === b))); }
        else if (p.mode === 'mc') { Exit.val = p.opts[+b.dataset.i]; $$('.choice', area).forEach(x => x.setAttribute('aria-checked', String(x === b))); }
        else if (p.mode === 'multi') { const i = +b.dataset.i; if (Exit.sel.has(i)) Exit.sel.delete(i); else Exit.sel.add(i); b.setAttribute('aria-pressed', String(Exit.sel.has(i))); }
        DQBUI.haptic(8);
      });
      on($('exit-send'), 'click', () => {
        const p = State.activity.payload; let val = null;
        if (p.mode === 'short') val = ($('ex-txt').value || '').trim();
        else if (p.mode === 'lw') { const l = $('ex-l').value.trim(), w = $('ex-w').value.trim(); val = (l || w) ? { l, w } : null; }
        else if (p.mode === 'multi') val = [...Exit.sel].sort((a, b) => a - b).map(i => p.opts[i]); else val = Exit.val;
        if (!val || (Array.isArray(val) && !val.length)) { const e = $('exit-err'); e.textContent = p.mode === 'short' || p.mode === 'lw' ? 'Please write a response first.' : 'Please choose an answer first.'; e.hidden = false; return; }
        Conn.send({ type: 'EXIT_SUBMIT', actId: State.activity.id, val }, true); markDone(); Pages.close('p-exit'); Views.renderBoard(); Toast.success('Response sent'); DQBUI.haptic(15);
      });
    }
  };

  /* ====================================================================== */
  /* Shared model (consensus)                                                */
  /* ====================================================================== */
  const CM = {
    active: false, canDraw: false, view: { x: 0, y: 0, z: 1 }, follow: true, ink: [], color: '#ef4444', pan: false, pts: new Map(), pinch: null, path: null, host: null,
    start(d) {
      CM.active = true; CM.canDraw = false; CM.follow = true; CM.view = { x: 0, y: 0, z: 1 }; CM.host = null;
      CM.ink = (Array.isArray(d.ink) ? d.ink : []).map(CM.cleanInk).filter(Boolean);
      const NS = 'http://www.w3.org/2000/svg';
      const box = $('cm-items'); box.textContent = '';
      (Array.isArray(d.items) ? d.items : []).slice(0, 200).forEach(i => {
        const id = safeId(i.id); if (!id) return;
        const el = document.createElement('div'); el.id = 'ci-' + id; el.className = `c-item t-${TYPES[i.sub] ? i.sub : 'notice'}`;
        el.style.cssText = `transform:translate(${+i.x || 0}px,${+i.y || 0}px);width:${Math.max(40, +i.w || 180)}px;height:${Math.max(40, +i.h || 120)}px`;
        const s = i.src ? safeImg(i.src, 1500000) : ''; if (s) { const im = document.createElement('img'); im.src = s; im.alt = 'Sketch'; el.appendChild(im); } else el.textContent = clampStr(i.text, 500);
        box.appendChild(el);
      });
      $('cm-title').textContent = clampStr(d.title, 60) || 'Class model';
      CM.renderInk(); CM.setPerms(false); CM.fitDefault();
      Pages.closeAll(['p-consensus']);
      Pages.open('p-consensus'); CM.loop();
    },
    fitDefault() { const r = $('cm-view').getBoundingClientRect(); const items = $$('.c-item', $('cm-items')); if (!r.width) { CM.view = { x: 20, y: 20, z: 0.6 }; return; } let w = 600, h = 500; CM.view = { z: Math.min(1, r.width / (w + 40)), x: 20, y: 20 }; CM.view.z = Math.max(0.25, CM.view.z); },
    stop() { if (!CM.active) return; CM.active = false; Pages.close('p-consensus'); Toast.info('The shared model has ended', { duration: 2200 }); },
    setPerms(can) {
      CM.canDraw = can; $('cm-sub').textContent = can ? 'You can draw' : 'Watching'; $('cm-tools').hidden = !can;
      if (can) { Toast.success('You can draw on the model now'); CM.pan = false; $('cm-pan').setAttribute('aria-pressed', 'false'); }
    },
    cleanInk(s) { if (!s || !Array.isArray(s.points)) return null; const pts = s.points.slice(0, 6000).map(p => ({ x: +p.x || 0, y: +p.y || 0 })); if (pts.length < 2) return null; return { id: safeId(s.id) || DQBUI.genId(), points: pts, color: safeColor(s.color) || '#000000', width: Math.max(1, Math.min(40, +s.width || 4)), highlight: !!s.highlight, arrow: !!s.arrow }; },
    addInk(raw) { const s = CM.cleanInk(raw); if (!s || CM.ink.some(x => x.id === s.id)) return; CM.ink.push(s); CM.renderInk(); },
    setInk(arr) { CM.ink = (Array.isArray(arr) ? arr : []).map(CM.cleanInk).filter(Boolean); CM.renderInk(); },
    renderInk() {
      const svg = $('cm-ink'); svg.textContent = ''; const NS = 'http://www.w3.org/2000/svg';
      CM.ink.forEach(s => {
        const p = document.createElementNS(NS, 'path'); p.setAttribute('d', s.points.map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${q.y}`).join(' ')); p.setAttribute('stroke', s.color); p.setAttribute('stroke-width', s.highlight ? s.width * 3 : s.width);
        p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); if (s.highlight) p.setAttribute('opacity', '0.4'); svg.appendChild(p);
        if (s.arrow && s.points.length > 1) { const a = s.points[s.points.length - 1], b = s.points[Math.max(0, s.points.length - 6)]; const ang = Math.atan2(a.y - b.y, a.x - b.x), L = 10 + s.width * 2; const h = document.createElementNS(NS, 'path'); h.setAttribute('d', `M ${a.x} ${a.y} L ${a.x - L * Math.cos(ang - 0.45)} ${a.y - L * Math.sin(ang - 0.45)} M ${a.x} ${a.y} L ${a.x - L * Math.cos(ang + 0.45)} ${a.y - L * Math.sin(ang + 0.45)}`); h.setAttribute('stroke', s.color); h.setAttribute('stroke-width', s.width); h.setAttribute('fill', 'none'); h.setAttribute('stroke-linecap', 'round'); svg.appendChild(h); }
      });
    },
    moveItem(id, x, y) { const el = $('ci-' + id); if (el && isFinite(x) && isFinite(y)) el.style.transform = `translate(${x}px,${y}px)`; },
    hostView(d) {
      if (!CM.active || !d.view || !d.size) return;
      CM.host = d; if (CM.follow) CM.applyHost();
    },
    applyHost() {
      const d = CM.host; if (!d) return; const r = $('cm-view').getBoundingClientRect(); if (!r.width) return;
      const hz = +d.view.z || 1, W = d.size.w / hz, H = d.size.h / hz, cx = d.size.w / 2 / hz - d.view.x, cy = d.size.h / 2 / hz - d.view.y;
      const z = Math.max(0.1, Math.min(r.width / W, r.height / H, 6));
      CM.view = { z, x: r.width / 2 / z - cx, y: r.height / 2 / z - cy };
    },
    setFollow(on_) { CM.follow = on_; const b = $('cm-follow'); b.setAttribute('aria-pressed', String(on_)); b.innerHTML = ic(on_ ? 'eye' : 'eye-off', 'sm') + (on_ ? 'Following teacher' : 'Free look'); if (on_) CM.applyHost(); },
    loop() { if (!CM.active) return; $('cm-world').style.transform = `scale(${CM.view.z}) translate(${CM.view.x}px, ${CM.view.y}px)`; CM.renderTemp(); requestAnimationFrame(CM.loop); },
    renderTemp() { const t = $('cm-temp'); if (CM.path && CM.path.length > 1) t.innerHTML = `<g transform="scale(${CM.view.z}) translate(${CM.view.x} ${CM.view.y})"><path d="${CM.path.map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${q.y}`).join(' ')}" stroke="${CM.color}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`; else if (t.innerHTML) t.innerHTML = ''; },
    world(e) { const r = $('cm-view').getBoundingClientRect(); return { x: (e.clientX - r.left) / CM.view.z - CM.view.x, y: (e.clientY - r.top) / CM.view.z - CM.view.y }; },
    init() {
      const sw = $('cm-colors'); sw.innerHTML = COLORS.concat([['#ffffff', 'White']]).slice(0, 6).map(([c, n], i) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="${n}" aria-pressed="${c === CM.color}"></button>`).join('');
      CM.color = '#111827'; $$('#cm-colors .swatch').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0)));
      on(sw, 'click', e => { const b = e.target.closest('[data-c]'); if (!b) return; CM.color = b.dataset.c; CM.pan = false; $('cm-pan').setAttribute('aria-pressed', 'false'); $$('#cm-colors .swatch').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
      on($('cm-pan'), 'click', () => { CM.pan = !CM.pan; $('cm-pan').setAttribute('aria-pressed', String(CM.pan)); });
      on($('cm-follow'), 'click', () => CM.setFollow(!CM.follow));
      const v = $('cm-view');
      on(v, 'pointerdown', e => {
        CM.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (CM.pts.size === 2) { CM.path = null; const [a, b] = [...CM.pts.values()], r = v.getBoundingClientRect(), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; CM.pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z: CM.view.z, wx: (cx - r.left) / CM.view.z - CM.view.x, wy: (cy - r.top) / CM.view.z - CM.view.y }; CM.setFollowOff(); return; }
        if (CM.pts.size > 1) return;
        try { v.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (CM.canDraw && !CM.pan) CM.path = [CM.world(e)]; else { CM.drag = { x: e.clientX, y: e.clientY, vx: CM.view.x, vy: CM.view.y }; }
      });
      on(v, 'pointermove', e => {
        if (CM.pts.has(e.pointerId)) CM.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (CM.pinch && CM.pts.size >= 2) { const [a, b] = [...CM.pts.values()], r = v.getBoundingClientRect(), d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; const nz = Math.max(0.1, Math.min(6, CM.pinch.z * d / CM.pinch.d)); CM.view = { z: nz, x: (cx - r.left) / nz - CM.pinch.wx, y: (cy - r.top) / nz - CM.pinch.wy }; return; }
        if (CM.path) { const p = CM.world(e), l = CM.path[CM.path.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 0.6) CM.path.push(p); }
        else if (CM.drag) { CM.view.x = CM.drag.vx + (e.clientX - CM.drag.x) / CM.view.z; CM.view.y = CM.drag.vy + (e.clientY - CM.drag.y) / CM.view.z; if (Math.hypot(e.clientX - CM.drag.x, e.clientY - CM.drag.y) > 6) CM.setFollowOff(); }
      });
      const up = e => {
        CM.pts.delete(e.pointerId); if (CM.pinch) { if (CM.pts.size < 2) CM.pinch = null; return; }
        if (CM.path && CM.path.length > 1) { const ink = { id: DQBUI.genId(), points: CM.path.slice(), color: CM.color, width: 4 }; CM.addInk(ink); Conn.send({ type: 'CONSENSUS_INK', ink }); }
        CM.path = null; CM.drag = null;
      };
      on(v, 'pointerup', up); on(v, 'pointercancel', up);
      on(v, 'wheel', e => { e.preventDefault(); const r = v.getBoundingClientRect(), nz = Math.max(0.1, Math.min(6, CM.view.z * Math.exp(-e.deltaY * 0.0015))), px = e.clientX - r.left, py = e.clientY - r.top; CM.view = { z: nz, x: px / nz - (px / CM.view.z - CM.view.x), y: py / nz - (py / CM.view.z - CM.view.y) }; CM.setFollowOff(); }, { passive: false });
    },
    setFollowOff() { if (CM.follow) CM.setFollow(false); }
  };

  /* ====================================================================== */
  /* Timer                                                                   */
  /* ====================================================================== */
  const Timer = {
    tick: null,
    set(t) {
      State.timer = { running: !!t.running, remainingMs: Math.max(0, +t.remainingMs || 0), totalMs: +t.totalMs || 0, endsAt: t.running ? Date.now() + Math.max(0, +t.remainingMs || 0) : 0 };
      Timer.render();
    },
    rem() { const t = State.timer; return t.running ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs; },
    render() {
      const t = State.timer, pill = $('timer-pill'), r = Timer.rem();
      clearInterval(Timer.tick);
      const show = t.running || (t.totalMs && r > 0 && r < t.totalMs);
      pill.hidden = !show;
      const fmt = ms => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
      $('timer-text').textContent = fmt(r); pill.classList.toggle('low', t.running && r < 10000);
      if (t.running) Timer.tick = setInterval(() => {
        const x = Timer.rem(); $('timer-text').textContent = fmt(x); pill.classList.toggle('low', x < 10000);
        if (x <= 0) { clearInterval(Timer.tick); State.timer.running = false; State.timer.remainingMs = 0; pill.hidden = true; Toast.show('Time’s up!', { icon: 'timer', duration: 5000 }); DQBUI.haptic([200, 100, 200]); DQBUI.announce('Time is up'); }
      }, 250);
    }
  };

  /* ====================================================================== */
  /* Setup · join · profile                                                  */
  /* ====================================================================== */
  const Onboard = {
    av: '😀',
    init() {
      const grid = $('av-grid');
      grid.innerHTML = Net.AVATARS.map(a => `<button type="button" class="av" role="radio" aria-checked="false" data-av="${a}" aria-label="Avatar ${a}">${a}</button>`).join('');
      Onboard.pick(State.me.av || Net.AVATARS[0]);
      on(grid, 'click', e => { const b = e.target.closest('[data-av]'); if (b) Onboard.pick(b.dataset.av); });
      on(grid, 'keydown', e => { const items = $$('.av', grid), i = items.indexOf(document.activeElement); if (i < 0) return; let n = i; if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % items.length; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length; else return; e.preventDefault(); items[n].focus(); Onboard.pick(items[n].dataset.av); });
      const go = () => {
        const name = clampStr($('inp-name').value.replace(/[<>\u0000-\u001f]/g, '').trim(), 24);
        if (!name) { const e = $('name-err'); e.textContent = 'Please enter your name so your teacher knows who you are.'; e.hidden = false; $('inp-name').classList.add('invalid'); $('inp-name').focus(); return; }
        State.me.name = name; State.me.av = Onboard.av; Store.saveProfile(); Views.renderMe();
        Onboard.afterProfile();
      };
      on($('btn-setup'), 'click', go);
      on($('inp-name'), 'keydown', e => { if (e.key === 'Enter') go(); });
      on($('inp-name'), 'input', () => { $('name-err').hidden = true; $('inp-name').classList.remove('invalid'); });

      const connect = () => {
        const raw = $('inp-code').value, p = Net.parseJoinInput(raw), err = $('code-err');
        if (!p) { err.textContent = raw.trim() ? 'That doesn’t look like a class code. It’s 6 letters and numbers, like ABC-123.' : 'Please enter the class code from your teacher’s screen.'; err.hidden = false; $('inp-code').classList.add('invalid'); $('inp-code').focus(); return; }
        err.hidden = true; Onboard.stopScan(); Onboard.begin(p);
      };
      on($('btn-connect'), 'click', connect);
      on($('inp-code'), 'keydown', e => { if (e.key === 'Enter') connect(); });
      on($('inp-code'), 'input', e => { $('code-err').hidden = true; $('inp-code').classList.remove('invalid'); const v = e.target.value; if (/^https?:|join=/.test(v)) { const p = Net.parseJoinInput(v); if (p) { Onboard.begin(p); } } });
      on($('btn-scan'), 'click', Onboard.scan);
      on($('btn-edit-me'), 'click', () => { Views.show('setup'); $('inp-name').value = State.me.name; Onboard.pick(State.me.av); });
      on($('btn-rejoin'), 'click', () => { Views.show('join'); });
      on($('me-btn'), 'click', Profile.open);
    },
    pick(a) { Onboard.av = a; $$('#av-grid .av').forEach(b => b.setAttribute('aria-checked', String(b.dataset.av === a))); },
    afterProfile() {
      if (State.target) { Onboard.begin(State.target); return; }
      const lj = Store.lastJoin(); if (lj) { Onboard.begin({ peerId: lj.peerId, code: lj.code }); return; }
      Views.show('join'); setTimeout(() => $('inp-code').focus({ preventScroll: true }), 100);
    },
    begin(target) {
      State.target = target; Views.show('board', true); Views.setTab('board'); Views.renderMe(); State.notes = State.notes || [];
      $('board-content').innerHTML = Views.statusCard('📡', 'Connecting…', 'Joining your class. This takes a moment.');
      Conn.start(target);
    },
    async scan() {
      const reader = $('reader'), err = $('scan-err'); err.hidden = true; reader.hidden = false; $('btn-scan').hidden = true;
      try { await DQBUI.loadScript('../vendor/html5-qrcode.min.js'); } catch (e) { return Onboard.scanFail('The scanner couldn’t load. Please type the code instead.'); }
      try {
        Onboard.scanner = new Html5Qrcode('reader');
        await Onboard.scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, txt => { const p = Net.parseJoinInput(txt); if (p) { Onboard.stopScan(); Onboard.begin(p); } }, () => {});
      } catch (e) {
        const m = String(e && (e.name || e.message || e));
        Onboard.scanFail(/NotAllowed|Permission/i.test(m) ? 'Camera access is blocked. Allow the camera in your browser settings, or type the code instead.' : (/NotFound|Devices/i.test(m) ? 'No camera was found. Please type the code instead.' : (!window.isSecureContext ? 'The camera needs a secure (https) page. Please type the code instead.' : 'The camera couldn’t start. Please type the code instead.')));
      }
    },
    scanFail(msg) { const err = $('scan-err'); err.textContent = msg; err.hidden = false; $('reader').hidden = true; $('btn-scan').hidden = false; $('inp-code').focus(); },
    async stopScan() { const s = Onboard.scanner; Onboard.scanner = null; if (s) { try { await s.stop(); s.clear(); } catch (e) { /* ignore */ } } $('reader').hidden = true; $('btn-scan').hidden = false; }
  };

  const Profile = {
    open() {
      let av = State.me.av;
      const code = State.target && State.target.code ? Net.formatCode(State.target.code) : '';
      const wrap = DQBUI.h(`<div class="stack" style="gap:18px"><div class="field"><label>Avatar</label><div class="prof-grid" id="pf-av" role="radiogroup">${Net.AVATARS.map(a => `<button type="button" class="av" role="radio" aria-checked="${a === av}" data-av="${a}" aria-label="Avatar ${a}">${a}</button>`).join('')}</div></div><div class="field"><label for="pf-name">Name</label><input class="input" id="pf-name" maxlength="24" value="${esc(State.me.name)}"></div><div class="field"><label>Appearance</label><div class="seg" id="pf-theme" role="group">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${Theme.get() === v}">${l}</button>`).join('')}</div></div>${code ? `<div class="help-box" style="background:var(--surface-2);padding:12px 14px;border-radius:12px"><div class="muted" style="font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Class code</div><div style="font-size:1.4rem;font-weight:800;letter-spacing:.14em;font-family:ui-monospace,Menlo,monospace">${esc(code)}</div></div>` : ''}<button type="button" class="btn btn-danger-soft btn-block" id="pf-leave">${ic('logout')}Leave class</button></div>`);
      on(wrap, 'click', e => { const b = e.target.closest('[data-av]'); if (b) { av = b.dataset.av; $$('#pf-av .av', wrap).forEach(x => x.setAttribute('aria-checked', String(x === b))); } const t = e.target.closest('#pf-theme [data-v]'); if (t) { Theme.set(t.dataset.v); $$('#pf-theme button', wrap).forEach(x => x.setAttribute('aria-pressed', String(x === t))); } });
      const ov = Overlay.open({ title: 'You', content: wrap, size: 'sm', footer: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', kind: 'primary', close: false, onClick: () => { const n = clampStr(wrap.querySelector('#pf-name').value.replace(/[<>\u0000-\u001f]/g, '').trim(), 24); if (!n) { wrap.querySelector('#pf-name').focus(); return false; } const changed = n !== State.me.name || av !== State.me.av; State.me.name = n; State.me.av = av; Store.saveProfile(); Views.renderMe(); ov.close(); if (changed && Conn.state === 'online') { Conn.raw({ type: 'JOIN', name: n, avatar: av, sid: State.me.sid, v: 2 }); } Toast.success('Saved'); } }] });
      on(wrap.querySelector('#pf-leave'), 'click', async () => { const ok = await Dialog.confirm({ title: 'Leave this class?', message: 'Your notes stay on this device.', confirmLabel: 'Leave', danger: true, icon: 'logout' }); if (!ok) return; ov.close(); Conn.stop(); Store.setLastJoin(null); State.target = null; State.everConnected = false; State.boardId = null; Pages.closeAll(); Views.show('join'); });
    }
  };

  /* ====================================================================== */
  /* Boot                                                                    */
  /* ====================================================================== */
  async function boot() {
    hydrateIcons(document); Theme.apply();
    await Store.init();
    Onboard.init(); Write.init(); Sketch.init(); Poll.init(); Graph.init(); Exit.init(); CM.init();
    Views.renderMe(); Views.renderNotes();
    const params = new URLSearchParams(location.search), jp = params.get('join');
    if (jp) State.target = Net.parseJoinInput(jp);
    Net.peerOptions();                                  // persists ?peerHost=… before the query string is cleaned
    if (location.search) history.replaceState(history.state, '', location.pathname);
    $('inp-name').value = State.me.name || '';
    if (State.me.name) Onboard.afterProfile(); else Views.show('setup');
    document.body.dataset.ready = '1';
  }
  boot();
})();
