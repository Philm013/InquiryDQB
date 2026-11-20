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
  const State = {
    me: { sid: '', name: '', av: '😀', color: null, group: '', locked: false },
    shared: [],              // what the teacher shared: links, pictures and videos, and sets to explore ({ id, type: 'link' | 'media' | 'set', … })
    target: null,            // { peerId, code } for a live board, or { open: id } for a board open without the teacher
    open: null,              // a board open without the teacher (Box): { id, title, until, teacher, lesson, notes, zone, wall }
    boardId: null, notes: [],
    // zones: the open zones this student may write into ({ id, title, zoneType, color, group }); zonePick: the one they chose
    activity: { type: 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null, zones: [], waiting: false, unplaced: false },
    zonePick: null,
    rules: { names: true, approve: false, peers: true }, muted: false,
    responded: {}, everConnected: false, tab: 'board', view: 'setup',
    timer: { running: false, endsAt: 0, remainingMs: 0, totalMs: 0 },
    outbox: []
  };

  /** An "activity round": the teacher stamps every start with a fresh `rid`, so a student can answer again when the same item is re-run. */
  const actKey = () => { const a = State.activity; return a.rid || (a.id + ':' + a.sub); };
  const isDone = () => !!State.responded[actKey()];
  const markDone = () => { State.responded[actKey()] = true; };

  /** A signed-in student's identity from the host site ({ sid, name }): the name is theirs and the sid is issued by the site. */
  function hostIdentity() {
    const id = DQBUI.host().identity;
    if (!id || typeof id !== 'object' || !safeId(String(id.sid || ''))) return null;
    const name = clampStr(String(id.name || '').replace(/[<>\u0000-\u001f]/g, '').trim(), 24);
    return name ? { sid: String(id.sid), name } : null;
  }
  /** Notes written on this device by the person using it now (a shared school device keeps each student's notes apart). */
  const isMine = (n) => (State.me.locked ? n.sid === State.me.sid : (!n.sid || n.sid === State.me.sid));

  const Store = {
    db: null,
    init() {
      return new Promise(resolve => {
        const ident = hostIdentity();
        if (ident) {
          // signed in: the site says who this is; only the avatar choice is remembered (per account, never the name for guests)
          Object.assign(State.me, { sid: ident.sid, name: ident.name, locked: true });
          try { const av = localStorage.getItem('dqb_av:' + ident.sid); if (Net.AVATARS.includes(av)) State.me.av = av; } catch (e) { /* ignore */ }
        } else {
          // profile: localStorage first (always available), IndexedDB for notes
          try { const p = JSON.parse(localStorage.getItem('dqb_profile') || 'null'); if (p) Object.assign(State.me, { sid: p.sid || '', name: p.name || '', av: p.av || State.me.av }); } catch (e) { /* ignore */ }
          if (!State.me.sid) { State.me.sid = Net.genCode(16); Store.saveProfile(); }          // crypto-random: it identifies this student to the teacher
        }
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
            tx.objectStore('profile').get('me').onsuccess = ev => { const r = ev.target.result; if (r && r.val && !State.me.name && !State.me.locked) Object.assign(State.me, { name: r.val.name || '', av: r.val.av || State.me.av }); };
            tx.objectStore('notes').getAll().onsuccess = ev => { State.notes = ev.target.result || []; };
            tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
          } catch (err) { resolve(); }
        };
      });
    },
    saveProfile() {
      if (State.me.locked) { try { localStorage.setItem('dqb_av:' + State.me.sid, State.me.av); } catch (e) { /* ignore */ } return; }
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
    setLastJoin(t) { try { if (t) localStorage.setItem('dqb_last_join', JSON.stringify(t.open ? { open: t.open, sid: State.me.sid, ts: Date.now() } : { peerId: t.peerId, code: t.code, ts: Date.now() })); else localStorage.removeItem('dqb_last_join'); } catch (e) { /* ignore */ } }
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
      if (target.open) { Box.start(target.open); return; }     // no teacher to connect to: the host site keeps the board
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
    retryNow() { if (!Conn.target || Conn.intentional) return; if (Box.id) { Box.kick(); return; } Conn.attempts = 0; Conn.setState(State.everConnected ? 'reconnecting' : 'connecting'); Conn.dial(); },
    stop() {
      Box.stop();
      Conn.intentional = true; clearTimeout(Conn.timer); clearInterval(Conn.wd); State.outbox = [];
      if (Conn.conn) { try { Conn.raw({ type: 'LEAVE' }); Conn.conn.close(); } catch (e) { /* ignore */ } Conn.conn = null; }
      if (Conn.peer) { try { Conn.peer.destroy(); } catch (e) { /* ignore */ } Conn.peer = null; }
      Conn.setState('idle'); $('banner').hidden = true;
    },
    raw(msg) { try { if (Conn.conn && Conn.conn.open) { Conn.conn.send(JSON.stringify(msg)); return true; } } catch (e) { console.warn('send failed', e); } return false; },
    /** Sends a message; durable messages wait in the outbox while offline. */
    send(msg, durable) {
      if (Box.id) return Box.send(msg, durable);
      if (Conn.state === 'online' && Conn.raw(msg)) return true;
      if (durable) { State.outbox = State.outbox.filter(m => !(m.id && m.id === msg.id && m.type === msg.type)); State.outbox.push(msg); }
      return false;
    },
    flush() {
      const q = State.outbox; State.outbox = [];
      q.forEach(m => Conn.send(m, true));
      // anything we saved as "sending" in an earlier session
      State.notes.filter(n => n.status === 'sending' && n.boardId === State.boardId && isMine(n) && !q.some(m => m.id === n.id)).forEach(n => Conn.send(noteMsg(n), true));
    }
  };
  function noteMsg(n) { return n.src ? { type: 'IMG_NOTE', id: n.id, src: n.src, text: n.text, zoneId: n.zoneId || null } : { type: 'NOTE', id: n.id, sub: n.sub, text: n.text, zoneId: n.zoneId || null }; }
  /* ====================================================================== */
  /* Boards open without the teacher (DQB_HOST.mailbox)                      */
  /* ====================================================================== */
  /* A teacher can leave a board open for their students without running it. The host site stands in for the teacher's app: it
     says what the student can do, shows what is shared (and the notes on the board, if the teacher allows it), and keeps what the
     student adds. The teacher's app takes it all in the next time it opens the board. The messages are the ones a live board
     gets, so writing, sketching, comments, drawings and exploring work as they do in class. The host checks every message and
     the teacher's app checks it again. */
  const Box = {
    TYPES: ['NOTE', 'IMG_NOTE', 'DELETE_NOTE', 'ANNO_ADD', 'ANNO_DEL', 'EXPLORE'],
    id: null, gen: 0, timer: null, polling: false, draining: null, fails: 0, viewing: null,
    api() { const m = DQBUI.host().mailbox; return m && typeof m.view === 'function' && typeof m.send === 'function' ? m : null; },
    validId(v) { return /^\d{1,10}$/.test(String(v)) && Number(v) > 0 ? Number(v) : 0; },
    date(v) { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; },
    when(d) { try { return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); } },
    start(id) {
      Box.stop();
      Box.id = id; Box.fails = 0;
      Box.poll();
    },
    stop() { clearTimeout(Box.timer); Box.timer = null; Box.id = null; Box.viewing = null; Box.draining = null; Box.polling = false; Box.sig = null; Box.gen++; State.open = null; },
    /** Asks again now: back online, the page shown again, or Retry. */
    kick() { if (!Box.id) return; clearTimeout(Box.timer); Box.poll(); },
    later(ms) { clearTimeout(Box.timer); if (Box.id) Box.timer = setTimeout(() => Box.poll(), ms); },
    async poll() {
      const api = Box.api(), id = Box.id, gen = Box.gen;
      if (!api || !id || Box.polling) return;
      Box.polling = true;
      let v = null, failed = false;
      try { v = await api.view(id); } catch (e) { failed = true; }
      if (gen !== Box.gen) return;                                   // left, or opened another board meanwhile
      Box.polling = false;
      if (failed || !v || typeof v !== 'object') { Box.offline(); return; }
      if (v.gone) { Box.closed(v.msg); return; }
      Box.fails = 0;
      Box.apply(v);
      if (Box.viewing) Box.item(Box.viewing, !MediaPage.src);       // new comments; the picture itself only if it is not here yet
      Box.drain();
      Box.later(document.hidden ? 90000 : 20000);
    },
    offline() {
      Box.fails++;
      Conn.setState(Box.fails > 6 ? 'offline' : (State.everConnected ? 'reconnecting' : 'connecting'));
      Box.later(Net.backoff(Box.fails));
    },
    /** The board closed (or was never open for this student). */
    closed(msg) {
      const was = !!State.open;
      Conn.stop(); Store.setLastJoin(null); State.target = null; State.everConnected = false; Pages.closeAll(); Shared.set([], true);
      Views.ended(was ? 'This board is closed now' : 'This board isn’t open', clampStr(msg, 200) || (was ? 'Your teacher closed it. Everything you added is kept for them, and your notes stay in My notes.' : 'It may have closed, or it isn’t for your class. Ask your teacher.'));
    },
    /** The board as the host shows it to this student. */
    apply(v) {
      const first = !State.open;
      const sig = JSON.stringify([v.board, v.until, v.teacher, v.lesson, v.notes, v.rules, v.shared, v.wall]);
      const same = !first && sig === Box.sig; Box.sig = sig;
      const z = v.notes && v.notes.zone && safeId(v.notes.zone.id) ? { id: safeId(v.notes.zone.id), title: clampStr(v.notes.zone.title, 80) || 'Zone' } : null;
      State.open = {
        id: Box.id, title: clampStr(v.board && v.board.title, 80) || 'Class board', until: Box.date(v.until),
        teacher: clampStr(v.teacher, 60), lesson: clampStr(v.lesson, 80), notes: !!(v.notes && v.notes.open), zone: z, wall: Box.wall(v.wall)
      };
      State.boardId = safeId(v.board && v.board.id) || ('open-' + Box.id);
      if (v.rules) State.rules = { names: v.rules.names !== false, approve: !!v.rules.approve, peers: v.rules.peers !== false };
      State.muted = false; State.me.color = null; State.me.group = '';
      State.activity = { type: State.open.notes ? 'OPEN' : 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null, zones: [], waiting: false, unplaced: false };
      // where this student's notes are: on the board, kept for the teacher, waiting to be checked, or not kept
      const mine = v.mine && typeof v.mine === 'object' ? v.mine : {};
      State.notes.filter(n => n.boardId === State.boardId && isMine(n)).forEach(n => {
        const st = { on: 'approved', queued: 'sent', pending: 'pending', removed: 'rejected' }[mine[n.id]];
        if (!st || (n.status === st && (st !== 'rejected' || n.reason === 'removed'))) return;
        n.status = st; n.reason = st === 'rejected' ? 'removed' : null; Store.saveNote(n);
      });
      if (first) {
        State.everConnected = true; Store.setLastJoin(Conn.target);
        Shared.set(v.shared, true);
        Conn.setState('online');
        Views.show('board', true); Views.setTab('board'); Views.renderNotes(); Views.renderMe();
        Toast.success('You’re in!', { duration: 1800 });
        // notes saved as "sending" on this device earlier
        State.notes.filter(n => n.status === 'sending' && n.boardId === State.boardId && isMine(n) && !State.outbox.some(m => m.id === n.id)).forEach(n => Box.send(noteMsg(n), true));
      } else {
        if (Conn.state !== 'online') Conn.setState('online');
        if (same) return;
        Shared.set(v.shared);
      }
      Views.renderBoard(); Views.syncChrome(); Write.sync(); Sketch.sync(); MediaPage.sync(); Wall.render();
    },
    /** The notes on the board, re-checked (the host leaves it out when the teacher keeps notes private). */
    wall(w) {
      if (!w || typeof w !== 'object') return null;
      let left = 600;
      const note = (n) => (n && typeof n === 'object' && safeId(n.id) ? { id: safeId(n.id), sub: TYPES[n.sub] ? n.sub : 'notice', text: clampStr(n.text, 1000), author: clampStr(n.author, 40) || 'Classmate', mine: !!n.mine, sketch: !!n.sketch, waiting: !!n.waiting } : null);
      const take = (list) => { const out = (Array.isArray(list) ? list : []).slice(0, Math.max(0, left)).map(note).filter(Boolean); left -= out.length; return out; };
      const zones = (Array.isArray(w.zones) ? w.zones : []).slice(0, 100).map(z => ({ id: safeId(z && z.id) || '', title: clampStr(z && z.title, 80) || 'Zone', notes: take(z && z.notes) })).filter(z => z.notes.length);
      const loose = take(w.loose);
      return { zones, loose, count: zones.reduce((t, z) => t + z.notes.length, 0) + loose.length };
    },
    /** Sends a message through the host, in order, one at a time. Everything waits in the outbox while offline. */
    send(msg, durable) {
      if (!msg || !Box.id) return false;
      if (msg.type === 'VIEW') { Box.viewing = msg.item ? safeId(msg.item) : null; if (Box.viewing) Box.item(Box.viewing, true); return true; }
      if (!Box.TYPES.includes(msg.type)) return false;               // class activities (votes, polls, …) need the teacher there
      State.outbox = State.outbox.filter(m => !(m.id && m.id === msg.id && m.type === msg.type));
      State.outbox.push(msg);
      Box.drain();
      return true;
    },
    async drain() {
      const api = Box.api(), id = Box.id, gen = Box.gen;
      if (!api || !id || Box.draining || !State.open) return;       // sent once the board is open
      const token = Box.draining = {};
      let changed = false;
      try {
        while (State.outbox.length) {
          const msg = State.outbox[0];
          let res;
          try { res = await api.send(id, msg); } catch (e) { if (gen === Box.gen) Box.offline(); return; }   // kept; sent later
          if (gen !== Box.gen) return;
          const k = State.outbox.indexOf(msg); if (k >= 0) State.outbox.splice(k, 1);
          const status = res && typeof res.status === 'string' ? res.status : 'bad';
          if (status === 'closed') { Box.closed(res.msg); return; }
          Box.result(msg, status);
          if (/NOTE$/.test(msg.type)) changed = true;
        }
      } finally { if (Box.draining === token) Box.draining = null; }
      if (changed) Box.later(1500);                                 // show the board with it soon
    },
    result(msg, status) {
      if (msg.type === 'NOTE' || msg.type === 'IMG_NOTE') {
        const n = State.notes.find(x => x.id === msg.id); if (!n) return;
        if (status === 'queued' || status === 'pending') { n.status = status === 'pending' ? 'pending' : 'sent'; n.reason = null; }
        else { n.status = 'rejected'; n.reason = status === 'limit' || status === 'locked' ? status : (msg.type === 'IMG_NOTE' && status === 'bad' ? 'image' : null); Toast.warn(rejectMsg(n.reason)); }
        Store.saveNote(n);
      } else if (msg.type === 'ANNO_ADD' && status !== 'queued') MediaPage.onStatus({ aid: msg.id, status });
    },
    /** One picture, video or card with the comments and drawings this student may see (withSrc: the picture too). */
    async item(itemId, withSrc) {
      const api = Box.api(), id = Box.id, gen = Box.gen;
      if (!api || typeof api.item !== 'function' || !id) return;
      let d; try { d = await api.item(id, itemId, { src: !!withSrc }); } catch (e) { return; }
      if (gen !== Box.gen || !d || typeof d !== 'object') return;
      if (d.closed) { Box.closed(d.msg); return; }
      MediaPage.onItem(Object.assign({}, d, { id: itemId }));
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Box.id) Box.kick(); });

  window.addEventListener('online', () => { if (Conn.state !== 'online') Conn.retryNow(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Conn.target && !Conn.intentional && Conn.state !== 'online') Conn.retryNow(); });

  /* ====================================================================== */
  /* Message handling                                                        */
  /* ====================================================================== */
  function setActivity(a) {
    const prev = State.activity;
    State.activity = Object.assign({ type: 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null, zones: [], waiting: false, unplaced: false }, a);
    const zoneSig = (x) => (x.zones || []).map(z => z.id + ':' + z.title + ':' + z.zoneType).join('|') + (x.waiting ? '!' : '');
    const changed = prev.type !== State.activity.type || prev.id !== State.activity.id || prev.sub !== State.activity.sub || prev.rid !== State.activity.rid;
    const zonesChanged = zoneSig(prev) !== zoneSig(State.activity);
    Views.renderBoard(); Views.syncChrome();
    if (changed || zonesChanged) {
      const t = State.activity.type, z = State.activity.zones || [];
      if (t === 'OPEN') DQBUI.announce('Your teacher opened the board. You can add notes.');
      else if (t === 'LOCKED' && prev.type !== 'LOCKED') DQBUI.announce('The board is locked.');
      else if (Write.zoneActive()) DQBUI.announce(State.activity.waiting ? 'Your teacher is putting you in a group.' : (z.length > 1 ? `${z.length} zones are open. Choose where your note goes.` : `${z[0].title} is open. You can add notes.`));
      Write.sync(); Sketch.sync();
    }
  }
  function autoOpenTask() {
    const a = State.activity;
    if (isDone()) return;
    if (a.type === 'POLL') { Pages.closeAll(['p-poll'].concat(KEEP_PAGES)); Poll.open(); }
    else if (a.type === 'GRAPH') { Pages.closeAll(['p-graph'].concat(KEEP_PAGES)); Graph.open(); }
    else if (a.type === 'EXIT') { Pages.closeAll(['p-exit'].concat(KEEP_PAGES)); Exit.open(); }
  }
  const KEEP_PAGES = ['p-explore', 'p-media'];

  function Handle(d) {
    if (!d || typeof d.type !== 'string') return;
    switch (d.type) {
      case 'HEARTBEAT': break;
      case 'WELCOME': {
        const first = !State.everConnected;
        State.boardId = d.boardId || 'board'; State.everConnected = true; Conn.attempts = 0;
        if (d.rules) State.rules = { names: d.rules.names !== false, approve: !!d.rules.approve, peers: d.rules.peers !== false };
        State.muted = !!d.muted; State.me.color = d.color || null;
        Store.setLastJoin(Conn.target);
        (d.sync || []).forEach(n => { const l = State.notes.find(x => x.id === n.id); if (l) { l.text = clampStr(n.text, 1000); l.sub = n.sub; if (l.status !== 'approved') { l.status = 'approved'; } Store.saveNote(l); } });
        (d.pending || []).forEach(id => { const l = State.notes.find(x => x.id === id); if (l && l.status !== 'pending') { l.status = 'pending'; Store.saveNote(l); } });
        if (d.timer) Timer.set(d.timer);
        Shared.set(d.shared, true);
        Conn.setState('online');
        State.activity = { type: 'LOCKED', id: null, rid: null, sub: null, title: '', zoneType: null, items: [], payload: null };
        if (d.payload) Handle(d.payload); else if (d.mode) Handle({ type: 'MODE', val: d.mode });
        else setActivity({});
        Views.show('board', true); Views.setTab('board'); Views.renderNotes(); Views.renderMe();
        if (first) Toast.success('You’re in!', { duration: 1800 });
        Conn.flush();
        MediaPage.resume();
        break;
      }
      case 'MODE': { Pages.closeAll(['p-write', 'p-sketch'].concat(KEEP_PAGES)); setActivity({ type: d.val === 'OPEN' ? 'OPEN' : 'LOCKED' }); break; }
      case 'ZONE_ACT': case 'OPEN_ZONE': case 'ACT_VOTE': case 'ACT_SORT': case 'ACT_DISCUSS': {
        const sub = d.type === 'ZONE_ACT' ? (d.subType || d.type) : d.type;
        const items = (Array.isArray(d.items) ? d.items : []).slice(0, 100).map(i => ({ id: safeId(i.id), text: clampStr(i.text, 300), sub: ['link', 'image', 'video'].includes(i.sub) ? i.sub : (TYPES[i.sub] ? i.sub : 'notice') })).filter(i => i.id);
        if (sub !== 'OPEN_ZONE') Pages.closeAll(KEEP_PAGES);
        if (sub === 'ACT_SORT') Rank.reset(items);
        if (sub === 'ACT_VOTE') Vote.reset();
        if (sub === 'OPEN_ZONE') {
          // the zones this student may write into; an older teacher app sends a single zone as actId
          let zones = Array.isArray(d.zones) ? d.zones.slice(0, 24).map(z => ({ id: safeId(z && z.id), title: clampStr(z && z.title, 80) || 'Zone', zoneType: z && z.zoneType === 'cer' ? 'cer' : null, color: safeColor(z && z.color) || null, group: clampStr(z && z.group, 24) })).filter(z => z.id) : null;
          if (!zones) zones = safeId(d.actId) ? [{ id: safeId(d.actId), title: clampStr(d.title, 80) || 'Zone', zoneType: d.zoneType === 'cer' ? 'cer' : null, color: null, group: '' }] : [];
          if (!zones.some(z => z.id === State.zonePick)) State.zonePick = zones.length ? zones[0].id : null;
          setActivity({ type: 'ZONE', id: State.zonePick, rid: safeId(d.rid), sub, title: zones.length ? zones[0].title : '', zoneType: null, items, zones, waiting: !zones.length || !!d.waiting, unplaced: !!d.unplaced });
          break;
        }
        setActivity({ type: 'ZONE', id: safeId(d.actId), rid: safeId(d.rid), sub, title: clampStr(d.title, 80), zoneType: d.zoneType === 'cer' ? 'cer' : null, items });
        break;
      }
      case 'ACT_POLL': { const id = safeId(d.actId); Pages.closeAll(KEEP_PAGES); setActivity({ type: 'POLL', id, rid: safeId(d.rid), title: clampStr(d.q, 200), payload: { q: clampStr(d.q, 200), opts: (Array.isArray(d.opts) ? d.opts : []).slice(0, 12).map(o => clampStr(o && o.lbl, 80)) } }); Poll.reset(); autoOpenTask(); break; }
      case 'ACT_GRAPH': { const id = safeId(d.actId); Pages.closeAll(KEEP_PAGES); setActivity({ type: 'GRAPH', id, rid: safeId(d.rid), title: clampStr(d.title, 120), payload: {} }); autoOpenTask(); break; }
      case 'EXIT_TICKET': {
        const id = safeId(d.actId); Pages.closeAll(KEEP_PAGES);
        setActivity({ type: 'EXIT', id, rid: safeId(d.rid), title: 'Exit ticket', payload: { mode: ['short', 'smiley', 'mc', 'multi', 'lw'].includes(d.mode) ? d.mode : 'short', prompt: clampStr(d.prompt, 300), opts: (Array.isArray(d.opts) ? d.opts : []).slice(0, 12).map(o => clampStr(o, 80)) } });
        autoOpenTask(); break;
      }
      case 'STOP_ACT': { Pages.closeAll(['p-write', 'p-sketch'].concat(KEEP_PAGES)); setActivity({ type: 'LOCKED' }); break; }
      case 'SET_COLOR': {
        const had = State.me.color;
        State.me.color = safeColor(d.color) || null; State.me.group = State.me.color ? (clampStr(d.name, 24) || 'colour') : '';
        Views.renderMe(); Views.renderBoard();
        if (State.me.color && State.me.color !== had) Toast.info(`You’re in the ${State.me.group} group`, { duration: 2400 });
        break;
      }
      case 'RULES': if (d.rules) { State.rules = { names: d.rules.names !== false, approve: !!d.rules.approve, peers: d.rules.peers !== false }; Write.sync(); MediaPage.sync(); } break;
      case 'MUTE': State.muted = !!d.on; Views.renderBoard(); Views.syncChrome(); Write.sync(); MediaPage.sync(); if (State.muted) Toast.warn('Your teacher paused notes from you for now.'); else Toast.success('You can add notes again.'); break;
      case 'KICKED': {
        Conn.stop(); Store.setLastJoin(null); State.everConnected = false; Pages.closeAll(); Shared.set([], true);
        if (d.reason === 'restricted') { Views.ended('This board is for the teacher’s own students', clampStr(d.msg, 200) || 'Sign in with your student account, then join again.'); break; }
        Views.ended(d.reason === 'code-reset' ? 'The class code was reset' : 'You were removed from the class', d.reason === 'code-reset' ? 'Your teacher generated a new code. Ask for it to rejoin.' : 'Your teacher removed you from this session.');
        break;
      }
      case 'SHARED': Shared.set(d.items); break;
      case 'ITEM': MediaPage.onItem(d); break;
      case 'ANNO_STATUS': MediaPage.onStatus(d); break;
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
      case 'CONSENSUS_ITEMS': if (CM.active) CM.setItems(d.items); break;
      case 'CONSENSUS_VIEW_SYNC': CM.hostView(d); break;
    }
  }
  function rejectMsg(r) { return ({ removed: 'Your teacher didn’t keep that note on the board.', locked: 'The board is locked, so that note wasn’t added. It’s saved in My notes.', muted: 'Your teacher paused notes from you.', color: 'That zone is for a different group.', group: 'You’re not in a group yet, so that note wasn’t added. It’s saved in My notes.', limit: 'You’ve reached the note limit for this session.', image: 'That drawing was too large to send. Try a simpler one.', declined: 'Your teacher didn’t add that note.' })[r] || 'That note wasn’t added to the board.'; }
  const RETRY_REASONS = ['locked', 'group', 'color'];

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
      const n = State.notes.filter(x => x.boardId === State.boardId && isMine(x)).length;
      const b = $('notes-badge'); b.hidden = !n; b.textContent = n;
    },
    renderMe() {
      $('me-av').textContent = State.me.av; $('me-name').textContent = State.me.name || 'Student'; $('me-btn').setAttribute('aria-label', (State.me.name || 'Student') + ', your profile');
      const btn = $('me-btn'); btn.classList.toggle('has-color', !!State.me.color); btn.style.borderColor = State.me.color || ''; btn.style.background = State.me.color ? State.me.color + '22' : '';
    },
    joinError(msg) { const e = $('code-err'); e.textContent = msg; e.hidden = false; $('inp-code').classList.add('invalid'); },
    ended(title, msg) { $('ended-title').textContent = title; $('ended-msg').textContent = msg; Views.show('ended'); },

    /* ---- the board tab ---- */
    statusCard(emoji, title, text, live) { return `<div class="card status-card ${live ? 'live' : ''}">${live ? '<span class="live-tag">LIVE</span>' : ''}<div class="big" aria-hidden="true">${emoji}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`; },
    typeTiles(types) {
      return `<div class="type-tiles">${types.map(t => `<button type="button" class="type-tile t-${t}" data-act="add" data-type="${t}"><span class="emoji" aria-hidden="true">${TYPES[t].icon}</span><b>${TYPES[t].lbl}</b><small>${esc(TYPES[t].hint)}</small></button>`).join('')}<button type="button" class="type-tile t-sketch wide" data-act="sketch"><span class="emoji" aria-hidden="true">✏️</span><span><b>Draw a sketch</b><br><small>Use your finger or a mouse to draw an idea.</small></span></button></div>`;
    },
    /** Which control has focus, so a redraw can put it back (data-act, data-id and data-type name a control). */
    focusKey(box) { const a = document.activeElement; return a && a !== box && box.contains(a) && a.dataset && a.dataset.act ? [a.dataset.act, a.dataset.id || '', a.dataset.type || ''].join('|') : null; },
    refocus(box, key) {
      if (!key) return;
      const el = $$('[data-act]', box).find(x => [x.dataset.act, x.dataset.id || '', x.dataset.type || ''].join('|') === key);
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    },
    renderBoard() {
      const box = $('board-content'); if (!box) return;
      const keep = Views.focusKey(box);
      if (State.open) { box.innerHTML = Views.openHtml(); hydrateIcons(box); Shared.fillThumbs(box); Views.refocus(box, keep); return; }
      const a = State.activity; let html = '';
      if (State.muted) html += `<div class="warn-box">${ic('volume-x', 'sm')} Your teacher paused notes from you for now.</div>`;
      if (a.type === 'LOCKED') html += Views.statusCard('👀', 'Eyes on the board', 'Your teacher will open the board when it’s time to share ideas. Hang tight!');
      else if (a.type === 'OPEN') html += Views.statusCard('✨', 'The board is open', 'Choose what you’d like to add.', true) + Views.typeTiles(OPEN_TYPES);
      else if (a.type === 'ZONE') {
        if (a.sub === 'OPEN_ZONE') {
          const z = Write.zone(), many = (a.zones || []).length > 1, cer = !!(z && z.zoneType === 'cer');
          if (a.waiting || !z) html += State.me.color
            ? Views.statusCard('⏳', `The ${State.me.group || 'group'} zone isn’t open`, 'Other groups are adding notes right now. Your teacher will open your group’s zone or move you to another group.')
            : Views.statusCard('🧩', 'Waiting for a group', 'Your teacher is putting the class into groups. You can add notes as soon as you’re in one.');
          else {
            if (many) html += ZonePick.card();
            else html += Views.statusCard(cer ? '🏛️' : '📌', z.title || 'Add to this zone', cer ? 'Build an argument: add a claim, evidence and reasoning.' : (z.group ? `Your notes go into the ${z.group} group’s zone.` : 'Your notes will go into this zone on the board.'), true);
            if (a.unplaced) html += `<div class="info-box">${ic('info', 'sm')}<span>${State.me.color ? `The ${esc(State.me.group || 'group')} zone isn’t open, so you can add to any open zone for now.` : 'You’re not in a group yet, so you can add to any open zone.'}</span></div>`;
            html += Views.typeTiles(cer ? CER_TYPES : OPEN_TYPES);
          }
        } else if (a.sub === 'ACT_VOTE') html += Vote.html();
        else if (a.sub === 'ACT_SORT') html += Rank.html();
        else if (a.sub === 'ACT_DISCUSS') html += Discuss.html();
      } else {
        const done = isDone();
        const label = { POLL: 'Quick poll', GRAPH: 'Class data', EXIT: 'Exit ticket' }[a.type];
        html += done ? `<div class="card done-card"><div class="ok">${ic('check', 'lg')}</div><div><b>Response sent</b><div class="text-2">Thanks! Wait for your teacher to move on.</div></div></div>`
          : `<div class="card act-card"><div class="act-head"><span class="act-tag">${label}</span></div><h2>${esc(a.title || '')}</h2><button type="button" class="btn btn-primary btn-lg" data-act="open-task">Answer now</button></div>`;
      }
      box.innerHTML = Shared.html() + html; hydrateIcons(box);
      Shared.fillThumbs(box);
      if (a.type === 'ZONE' && a.sub === 'ACT_SORT') Rank.mount();
      Views.refocus(box, keep);
    },

    /** A board open without the teacher: what it is and until when, what is shared, adding notes and the notes on it. */
    openHtml() {
      const o = State.open;
      const text = o.notes ? (o.zone ? `Add your notices, wonders and ideas. They go into “${o.zone.title}” on the board.` : 'Add your notices, wonders and ideas to the board.') : 'Look at what your teacher shared, comment on it and explore.';
      const meta = [o.teacher, o.lesson, o.until ? 'Open until ' + Box.when(o.until) : ''].filter(Boolean).join(' · ');
      let html = `<div class="card status-card open-card"><span class="open-tag">${ic('exit', 'sm')}Open for you</span><div class="big" aria-hidden="true">${o.notes ? '📬' : '🔎'}</div><h2>${esc(o.title)}</h2><p>${esc(text)}</p>${meta ? `<p class="open-meta">${esc(meta)}</p>` : ''}</div>`;
      html += Shared.html();
      if (o.notes) html += `<h2 class="section-label">Add to the board</h2>` + Views.typeTiles(OPEN_TYPES);
      if (o.wall) html += Wall.card();
      else if (o.notes) html += `<div class="info-box">${ic('eye-off', 'sm')}<span>Only your teacher sees what you add.</span></div>`;
      return html;
    },

    /* ---- my notes tab ---- */
    renderNotes() {
      const list = $('notes-list'); if (!list) return;
      const notes = State.notes.filter(n => n.boardId === State.boardId && isMine(n)).sort((a, b) => b.ts - a.ts);
      $('notes-count').textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
      if (!notes.length) { list.innerHTML = `<div class="card empty"><div class="em-ico">${ic('note', 'lg')}</div><div class="em-t">No notes yet</div><div>Tap the <b>+</b> button when your teacher opens the board.</div></div>`; Views.syncChrome(); return; }
      const label = { sending: ['Sending…', 'status-sending'], sent: ['Sent to your teacher', 'status-sent'], approved: ['On the board', 'status-approved'], pending: ['Waiting for your teacher', 'status-pending'], rejected: ['Not added', 'status-rejected'] };
      list.innerHTML = notes.map(n => {
        const t = TYPES[n.sub] || TYPES.notice, st = label[n.status || 'approved'];
        return `<article class="note-card t-${esc(TYPES[n.sub] ? n.sub : 'notice')}" data-id="${esc(n.id)}">${n.src ? `<img alt="Your drawing" data-img="${esc(n.id)}">${n.text ? `<div class="txt" style="margin-top:8px;font-size:1.05rem">${esc(n.text)}</div>` : ''}` : `<div class="txt">${esc(n.text)}</div>`}<div class="meta"><span class="chip">${t.icon} ${t.lbl}</span><span class="chip ${st[1]}">${st[0]}</span><span class="grow"></span>${n.status === 'rejected' && RETRY_REASONS.includes(n.reason) ? `<button type="button" class="btn btn-soft btn-sm" data-act="retry" data-id="${esc(n.id)}">${ic('refresh', 'sm')}Try again</button>` : ''}<button type="button" class="icon-btn sm" data-act="del" data-id="${esc(n.id)}" aria-label="Delete this note">${ic('trash', 'sm')}</button></div></article>`;
      }).join('');
      $$('img[data-img]', list).forEach(img => { const n = State.notes.find(x => x.id === img.dataset.img); const s = n && safeImg(n.src, 3000000); if (s) img.src = s; });
      Views.syncChrome();
    }
  };

  /* ---- links the teacher shared with the class ---- */
  const Shared = {
    /** One entry, re-checked: a link, a picture or video, a teacher's note (inside a set) or a set to explore. */
    entry(x, inSet) {
      if (!x || typeof x !== 'object') return null;
      const id = safeId(x.id); if (!id) return null;
      const type = ['media', 'set', 'text'].includes(x.type) ? x.type : 'link';
      if (type === 'link') {
        const url = DQBUI.safeUrl(x.url); if (!url) return null;
        return { id, type, title: clampStr(x.title, 200) || 'Link', desc: clampStr(x.desc, 500), url, thumb: DQBUI.safeThumb(x.thumb), kind: ['resource', 'collection', 'link'].includes(x.kind) ? x.kind : 'link', source: clampStr(x.source, 60) };
      }
      if (type === 'media') {
        const kind = x.kind === 'video' ? 'video' : 'image';
        const o = { id, type, kind, title: clampStr(x.title, 200) || (kind === 'video' ? 'Video' : 'Picture'), desc: clampStr(x.desc, 500), thumb: safeImg(x.thumb, 150000) || DQBUI.safeThumb(x.thumb), source: clampStr(x.source, 60), aspect: Number(x.aspect) > 0.1 && Number(x.aspect) < 10 ? Number(x.aspect) : 0 };
        if (kind === 'video') { o.video = DQBMedia.cleanVideo(x.video); if (!o.video) return null; }
        return o;
      }
      if (type === 'text') { const text = clampStr(x.text, 600).trim(); return inSet && text ? { id, type, text } : null; }
      if (inSet) return null;
      const items = (Array.isArray(x.items) ? x.items : []).slice(0, 40).map(i => Shared.entry(i, true)).filter(Boolean);
      return items.some(i => i.type !== 'text') ? { id, type: 'set', title: clampStr(x.title, 80) || 'Explore', color: safeColor(x.color), group: clampStr(x.group, 24), items } : null;
    },
    clean(list) { return (Array.isArray(list) ? list : []).slice(0, 12).map(x => Shared.entry(x, false)).filter(Boolean); },
    /** Finds an item anywhere in what is shared: {item, set} (set: the set it is in, or null). */
    find(id) {
      for (const x of State.shared) {
        if (x.id === id) return { item: x, set: null };
        if (x.type === 'set') { const i = x.items.find(y => y.id === id); if (i) return { item: i, set: x }; }
      }
      return null;
    },
    set(list, quiet) {
      const before = new Set(State.shared.map(x => x.id));
      State.shared = Shared.clean(list);
      const added = State.shared.filter(x => !before.has(x.id));
      if (!quiet && added.length) {
        const one = added[0];
        Toast.show(added.length === 1 ? (one.type === 'set' ? `Your teacher shared “${one.title}” to explore` : `Your teacher shared “${one.title}”`) : `Your teacher shared ${added.length} things`, { icon: one.type === 'set' ? 'explore' : (one.type === 'media' ? (one.kind === 'video' ? 'video' : 'image') : 'link'), duration: 3200 });
        DQBUI.haptic(15); DQBUI.announce('Your teacher shared something with the class.');
      }
      if (State.view === 'board') Views.renderBoard();
      Explore.sync(); MediaPage.check();
    },
    html() {
      if (!State.shared.length) return '';
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
      const row = (x) => {
        if (x.type === 'set') {
          const p = Explore.progress(x), n = x.items.filter(i => i.type !== 'text').length;
          return `<button type="button" class="shared-item set" data-act="open-set" data-id="${esc(x.id)}"${x.color ? ` style="--zc:${esc(x.color)}"` : ''}><span class="ph set" aria-hidden="true">${ic('explore')}</span><span class="tx"><b>${esc(x.title)}</b><small>${n} thing${n === 1 ? '' : 's'} to explore${x.group ? ` · ${esc(x.group)} group` : ''}</small><span class="xp-bar" aria-hidden="true"><i style="width:${p.pct}%"></i></span><span class="src">${p.done ? `${p.done} of ${p.total} done` : (p.opened ? 'Started' : 'Not started yet')}</span></span><span class="go" aria-hidden="true">${ic('chev-right', 'sm')}</span></button>`;
        }
        if (x.type === 'media') return `<button type="button" class="shared-item media" data-act="open-media" data-id="${esc(x.id)}">${x.thumb ? `<img alt="" data-thumb="${esc(x.id)}" loading="lazy">` : `<span class="ph" aria-hidden="true">${ic(x.kind === 'video' ? 'video' : 'image')}</span>`}<span class="tx"><b>${esc(x.title)}</b><small>${x.kind === 'video' ? 'Video · watch it and comment at moments' : 'Picture · look closely, comment and draw on it'}</small></span><span class="go" aria-hidden="true">${ic(x.kind === 'video' ? 'play' : 'eye', 'sm')}</span></button>`;
        return `<div class="shared-row"><a class="shared-item" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" data-act="follow" data-id="${esc(x.id)}">${x.thumb ? `<img alt="" data-thumb="${esc(x.id)}" loading="lazy">` : `<span class="ph" aria-hidden="true">${ic(x.kind === 'link' ? 'link' : 'book')}</span>`}<span class="tx"><b>${esc(x.title)}</b>${x.desc ? `<small>${esc(x.desc)}</small>` : ''}<span class="src">${esc(x.source || host(x.url))}</span></span><span class="go" aria-hidden="true">${ic('chev-right', 'sm')}</span><span class="sr-only"> (opens in a new tab)</span></a><button type="button" class="icon-btn sm shared-cmt" data-act="link-comments" data-id="${esc(x.id)}" aria-label="Comments on ${esc(x.title)}">${ic('comment', 'sm')}</button></div>`;
      };
      return `<section class="shared card" aria-labelledby="shared-h"><div class="shared-head"><span class="ico">${ic('link', 'sm')}</span><h2 id="shared-h">Shared with you</h2><span class="muted">${State.shared.length}</span></div><div class="shared-list">${State.shared.map(row).join('')}</div></section>`;
    },
    fillThumbs(box) { $$('img[data-thumb]', box).forEach(img => { const f = Shared.find(img.dataset.thumb); if (f && f.item.thumb) img.src = f.item.thumb; }); }
  };

  /* ---- exploring a set: every card, picture and video in a zone the teacher shared ---- */
  const Explore = {
    id: null,
    key(setId) { return 'dqb_explore:' + (State.me.sid || '') + ':' + (State.boardId || '') + ':' + setId; },
    get(setId) { try { const r = JSON.parse(localStorage.getItem(Explore.key(setId)) || '{}'); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; } },
    put(setId, rec) { try { localStorage.setItem(Explore.key(setId), JSON.stringify(rec)); } catch (e) { /* ignore */ } },
    progress(set) {
      const rec = Explore.get(set.id), list = set.items.filter(i => i.type !== 'text');
      const done = list.filter(i => rec[i.id] && rec[i.id].d).length, opened = list.filter(i => rec[i.id] && rec[i.id].o).length;
      return { done, opened, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
    },
    /** Remembers progress on this device and tells the teacher (it waits in the outbox while offline). */
    mark(setId, id, patch) {
      const rec = Explore.get(setId), before = rec[id] || {};
      const next = Object.assign({}, before, patch);
      if (next.d) next.o = true;
      rec[id] = next; Explore.put(setId, rec);
      Conn.send({ type: 'EXPLORE', set: setId, id, open: !!next.o, done: !!next.d, star: !!next.s }, true);
      if (Explore.id === setId) Explore.render();
      if (State.view === 'board') Views.renderBoard();
      const set = State.shared.find(s => s.id === setId);
      if (set && patch.d && !before.d) { const p = Explore.progress(set); if (p.done === p.total) { Toast.success('You explored everything in this set!'); DQBUI.haptic(20); } }
    },
    open(id) {
      const set = State.shared.find(s => s.id === id && s.type === 'set'); if (!set) return;
      Explore.id = id;
      Explore.render();
      if (!Pages.isOpen('p-explore')) Pages.open('p-explore', { focus: '.page-bar [data-close]', onClose: () => { Explore.id = null; } });
    },
    /** The shared list changed: keep the page in step (or close it if the set was withdrawn). */
    sync() {
      if (!Explore.id) return;
      if (!State.shared.some(s => s.id === Explore.id && s.type === 'set')) { Pages.close('p-explore'); Explore.id = null; Toast.info('Your teacher stopped sharing that set.'); return; }
      Explore.render();
    },
    render() {
      const set = State.shared.find(s => s.id === Explore.id && s.type === 'set'); if (!set) return;
      const rec = Explore.get(set.id), p = Explore.progress(set);
      $('xp-title').textContent = set.title;
      $('xp-sub').textContent = `${p.done} of ${p.total} done`;
      const prompts = set.items.filter(i => i.type === 'text');
      $('xp-head').innerHTML = `<div class="xp-meter" role="progressbar" aria-label="Your progress" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}" aria-valuetext="${p.done} of ${p.total} done"><i style="width:${p.pct}%"></i></div>`
        + (prompts.length ? prompts.map(t => `<div class="xp-prompt">${ic('megaphone', 'sm')}<span></span></div>`).join('') : `<p class="text-2 xp-hint">Open each one, take a look, then tick it off. Star the ones you found most useful.</p>`);
      $$('.xp-prompt span', $('xp-head')).forEach((el, k) => { el.textContent = prompts[k].text; });
      const list = $('xp-list');
      list.innerHTML = set.items.filter(i => i.type !== 'text').map((i, k) => {
        const r = rec[i.id] || {}, kind = i.type === 'link' ? (i.kind === 'link' ? 'Link' : 'Resource') : (i.kind === 'video' ? 'Video' : 'Picture');
        const main = i.type === 'link'
          ? `<a class="btn btn-primary btn-sm" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" data-x="open" data-id="${esc(i.id)}">${ic('link', 'sm')}<span>Open</span><span class="sr-only"> ${esc(i.title)} (opens in a new tab)</span></a><button type="button" class="btn btn-secondary btn-sm" data-x="look" data-id="${esc(i.id)}" aria-label="Comment on ${esc(i.title)}">${ic('comment', 'sm')}<span>Comment</span></button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-x="look" data-id="${esc(i.id)}" aria-label="${i.kind === 'video' ? 'Watch' : 'Look at'} ${esc(i.title)}">${ic(i.kind === 'video' ? 'play' : 'eye', 'sm')}<span>${i.kind === 'video' ? 'Watch' : 'Look closely'}</span></button>`;
        return `<article class="xp-item${r.d ? ' done' : ''}" data-id="${esc(i.id)}"><div class="xp-top">${i.thumb ? `<img alt="" data-xthumb="${esc(i.id)}" loading="lazy">` : `<span class="ph" aria-hidden="true">${ic(i.type === 'link' ? 'book' : (i.kind === 'video' ? 'video' : 'image'))}</span>`}<div class="xp-tx"><span class="xp-kind">${k + 1} · ${kind}${r.o && !r.d ? ' · opened' : ''}</span><b></b><small></small></div></div><div class="xp-acts">${main}<span class="grow"></span><button type="button" class="icon-btn sm xp-star" data-x="star" data-id="${esc(i.id)}" aria-pressed="${!!r.s}" aria-label="Star ${esc(i.title)}">${ic('star', 'sm')}</button><button type="button" class="btn btn-sm xp-done${r.d ? ' on' : ''}" data-x="done" data-id="${esc(i.id)}" aria-pressed="${!!r.d}">${ic('check', 'sm')}<span>${r.d ? 'Done' : 'Mark done'}</span></button></div></article>`;
      }).join('');
      $$('.xp-item', list).forEach(el => { const i = set.items.find(x => x.id === el.dataset.id); el.querySelector('.xp-tx b').textContent = i.title; const s = el.querySelector('.xp-tx small'); if (i.desc) s.textContent = i.desc; else s.remove(); });
      $$('img[data-xthumb]', list).forEach(img => { const i = set.items.find(x => x.id === img.dataset.xthumb); if (i && i.thumb) img.src = i.thumb; });
      hydrateIcons(list); hydrateIcons($('xp-head'));
    }
  };
  on($('xp-list'), 'click', e => {
    const b = e.target.closest('[data-x]'); if (!b || !Explore.id) return;
    const set = State.shared.find(s => s.id === Explore.id); if (!set) return;
    const i = set.items.find(x => x.id === b.dataset.id); if (!i) return;
    const rec = Explore.get(set.id)[i.id] || {};
    if (b.dataset.x === 'open') Explore.mark(set.id, i.id, { o: true });                      // the link itself opens in a new tab
    else if (b.dataset.x === 'look') { Explore.mark(set.id, i.id, { o: true }); MediaPage.open(i, set.id); }
    else if (b.dataset.x === 'star') { Explore.mark(set.id, i.id, { s: !rec.s }); }
    else if (b.dataset.x === 'done') { Explore.mark(set.id, i.id, { d: !rec.d }); DQBUI.announce(rec.d ? 'Marked as not done' : 'Marked as done'); }
  });

  /* ---- one picture, video or card: the viewer (shared/media.js), with comments and markup ---- */
  const MediaPage = {
    id: null, setId: null, item: null, viewer: null, src: null, annos: [], local: [],
    viewItem() {
      const e = MediaPage.item;
      return e.type === 'link' ? { id: e.id, kind: 'link', title: e.title, desc: e.desc, url: e.url, thumb: e.thumb, source: e.source }
        : { id: e.id, kind: e.kind, title: e.title, desc: e.desc, src: MediaPage.src, thumb: e.thumb, video: e.video, aspect: e.aspect, source: e.source };
    },
    notice() {
      if (State.muted) return 'Your teacher paused comments from you for now.';
      if (Conn.state !== 'online') return 'You’re offline. What you add is sent when you reconnect.';
      if (State.rules.approve) return 'Your teacher checks comments before classmates see them.';
      if (!State.rules.peers) return 'Only your teacher sees your comments and drawings.';
      return '';
    },
    open(entry, setId) {
      if (MediaPage.viewer) { MediaPage.viewer.destroy(); MediaPage.viewer = null; }
      Object.assign(MediaPage, { id: entry.id, setId: setId || null, item: entry, src: null, annos: [], local: [] });
      $('md-title').textContent = entry.title || (entry.type === 'link' ? 'Link' : (entry.kind === 'video' ? 'Video' : 'Picture'));
      $('md-sub').textContent = entry.type === 'link' ? 'Comments' : (entry.kind === 'video' ? 'Video · ' + DQBMedia.providerName(entry.video) : 'Picture');
      const body = $('md-body'); body.textContent = '';
      MediaPage.viewer = DQBMedia.Viewer(body, {
        item: MediaPage.viewItem(), annos: [], me: { sid: State.me.sid, name: State.me.name, role: 's' },
        canAdd: !State.muted, notice: MediaPage.notice(),
        onAdd: (a) => MediaPage.add(a), onDelete: (ids) => MediaPage.del(ids),
        onOpenLink: () => { if (MediaPage.setId) Explore.mark(MediaPage.setId, MediaPage.id, { o: true }); }
      });
      if (!Pages.isOpen('p-media')) Pages.open('p-media', { focus: '.page-bar [data-close]', onClose: () => MediaPage.closed() });
      Conn.send({ type: 'VIEW', item: entry.id });
    },
    closed() {
      if (MediaPage.viewer) { MediaPage.viewer.destroy(); MediaPage.viewer = null; }
      if (MediaPage.id) Conn.send({ type: 'VIEW', item: null });
      MediaPage.id = null; MediaPage.item = null;
    },
    resume() { if (MediaPage.id) { Conn.send({ type: 'VIEW', item: MediaPage.id }); MediaPage.sync(); } },
    /** The shared list changed: the item may have been withdrawn or renamed. */
    check() {
      if (!MediaPage.id) return;
      const f = Shared.find(MediaPage.id);
      if (!f) { Toast.info('Your teacher stopped sharing this.'); Pages.close('p-media'); return; }
      if (f.item.title !== MediaPage.item.title) { MediaPage.item = f.item; $('md-title').textContent = f.item.title; if (MediaPage.viewer) MediaPage.viewer.setItem(MediaPage.viewItem()); }
    },
    sync() { if (MediaPage.viewer) MediaPage.viewer.setCanAdd(!State.muted, MediaPage.notice()); },
    render() { if (MediaPage.viewer) MediaPage.viewer.setAnnos(MediaPage.annos.concat(MediaPage.local)); },
    onItem(d) {
      if (!MediaPage.id || safeId(d.id) !== MediaPage.id) return;
      if (d.gone) { Toast.info('Your teacher stopped sharing this.'); Pages.close('p-media'); return; }
      if (typeof d.src === 'string' && MediaPage.item.type === 'media' && MediaPage.item.kind === 'image') {
        const s = safeImg(d.src, 1600000) || DQBUI.safeThumb(d.src);
        if (s && s !== MediaPage.src) { MediaPage.src = s; MediaPage.viewer.setItem(MediaPage.viewItem()); }
      }
      MediaPage.annos = DQBMedia.cleanAnnos(d.annos, { video: MediaPage.item.kind === 'video' });
      MediaPage.local = MediaPage.local.filter(l => !MediaPage.annos.some(a => a.id === l.id));
      MediaPage.render();
    },
    onStatus(d) {
      const aid = safeId(d.aid), mine = MediaPage.local.find(l => l.id === aid);
      if (d.status === 'pending' && mine) { mine.pend = true; MediaPage.render(); return; }
      if (['limit', 'muted', 'bad', 'gone'].includes(d.status)) {
        MediaPage.local = MediaPage.local.filter(l => l.id !== aid); MediaPage.render();
        if (d.status === 'limit') Toast.warn('You’ve added as many comments and drawings here as you can.');
        else if (d.status === 'muted') Toast.warn('Your teacher paused comments from you.');
      }
    },
    add(a) {
      const clean = DQBMedia.cleanAnno(Object.assign({}, a, { id: DQBUI.genId(), by: { n: State.me.name, r: 's' }, ts: Date.now() }), { student: true, video: MediaPage.item.kind === 'video' });
      if (!clean || !MediaPage.id) return;
      const wire = Object.assign({}, clean); delete wire.by; delete wire.mine; delete wire.pend;
      clean.mine = true; if (State.rules.approve) clean.pend = true;
      MediaPage.local.push(clean); MediaPage.render();
      Conn.send({ type: 'ANNO_ADD', id: clean.id, item: MediaPage.id, a: wire }, true);    // kept in the outbox while offline
      if (MediaPage.setId) Explore.mark(MediaPage.setId, MediaPage.id, { o: true });
    },
    del(ids) {
      const gone = new Set(ids);
      MediaPage.local = MediaPage.local.filter(l => !gone.has(l.id) && !gone.has(l.re));
      MediaPage.annos = MediaPage.annos.filter(a => !gone.has(a.id) && !gone.has(a.re));
      MediaPage.render();
      Conn.send({ type: 'ANNO_DEL', item: MediaPage.id, ids: ids.slice(0, 50) }, true);
    }
  };

  /* ---- the notes on a board open without the teacher (when the teacher lets students see them) ---- */
  const Wall = {
    card() {
      const w = State.open.wall, z = w.zones.length;
      return `<button type="button" class="card wall-card" data-act="open-wall"><span class="ph" aria-hidden="true">${ic('grid')}</span><span class="tx"><b>See the board</b><small>${w.count ? `${w.count} note${w.count === 1 ? '' : 's'}${z ? ` in ${z} zone${z === 1 ? '' : 's'}` : ''} from your class` : 'No notes yet. Be the first to add one!'}</small></span><span class="go" aria-hidden="true">${ic('chev-right', 'sm')}</span></button>`;
    },
    sig: null,
    open() { if (!State.open || !State.open.wall) return; Wall.sig = null; Pages.open('p-wall', { focus: '.page-bar [data-close]' }); Wall.render(); },
    render() {
      if (!Pages.isOpen('p-wall')) return;
      const w = State.open && State.open.wall;
      if (!w) { Pages.close('p-wall'); return; }
      const sig = JSON.stringify(w); if (sig === Wall.sig) return; Wall.sig = sig;
      $('wall-sub').textContent = `${w.count} note${w.count === 1 ? '' : 's'}`;
      const note = (n) => { const t = TYPES[n.sub] || TYPES.notice; return `<article class="note-card wall-note t-${esc(n.sub)}${n.mine ? ' mine' : ''}">${n.sketch ? `<div class="wall-sketch">${ic('pen', 'sm')}<span>Sketch</span></div>` : ''}${n.text ? `<div class="txt">${esc(n.text)}</div>` : ''}<div class="meta"><span class="chip">${t.icon} ${t.lbl}</span><span class="chip">${esc(n.author)}</span>${n.waiting ? `<span class="chip wall-new">${n.mine ? 'Sent' : 'New'}</span>` : ''}</div></article>`; };
      const section = (title, notes) => `<section class="wall-zone"><h3>${esc(title)} <span class="muted">${notes.length}</span></h3><div class="wall-grid">${notes.map(note).join('')}</div></section>`;
      const list = $('wall-list');
      list.innerHTML = w.count ? w.zones.map(z => section(z.title, z.notes)).join('') + (w.loose.length ? section(w.zones.length ? 'Around the board' : 'On the board', w.loose) : '')
        : `<div class="card empty"><div class="em-ico">${ic('note', 'lg')}</div><div class="em-t">No notes on the board yet</div><div>${State.open.notes ? 'Add the first one!' : 'Check back later.'}</div></div>`;
      hydrateIcons(list);
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
    else if (act === 'pick-zone') ZonePick.choose(b.dataset.id);
    else if (act === 'open-set') Explore.open(b.dataset.id);
    else if (act === 'open-wall') Wall.open();
    else if (act === 'open-media') { const x = State.shared.find(s => s.id === b.dataset.id); if (x) MediaPage.open(x, null); }
    else if (act === 'link-comments') { const x = State.shared.find(s => s.id === b.dataset.id); if (x) MediaPage.open(x, null); }
  });
  function autoOpenTaskForce() { const a = State.activity; if (a.type === 'POLL') Poll.open(); else if (a.type === 'GRAPH') Graph.open(); else if (a.type === 'EXIT') Exit.open(); }
  on($('notes-list'), 'click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const n = State.notes.find(x => x.id === b.dataset.id); if (!n) return;
    if (b.dataset.act === 'del') {
      const ok = await Dialog.confirm({ title: 'Delete this note?', message: n.status === 'approved' || n.status === 'sending' ? 'It will also be removed from the board.' : 'This can’t be undone.', confirmLabel: 'Delete', danger: true });
      if (!ok) return; Conn.send({ type: 'DELETE_NOTE', id: n.id }, true); Store.delNote(n.id); Toast.show('Note deleted');
    } else if (b.dataset.act === 'retry') {
      if (!Write.canAdd()) { Toast.warn(Write.zoneActive() && State.activity.waiting ? 'You’re not in a group yet. Your teacher will put you in one.' : 'The board is locked right now.'); return; }
      n.status = 'sending'; n.reason = null; n.zoneId = Write.targetZoneId(); Store.saveNote(n); Conn.send(noteMsg(n), true);
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
  /* Choosing a zone (when the teacher has several open for this student)    */
  /* ====================================================================== */
  const ZonePick = {
    sub(z) { return [z.zoneType === 'cer' ? 'Claim · Evidence · Reasoning' : '', z.group ? `${z.group} group` : (z.color ? '' : 'Everyone')].filter(Boolean).join(' · '); },
    /** Board tab: one radio card per zone. */
    card() {
      const a = State.activity, cur = Write.zone();
      return `<div class="card act-card zone-pick"><div class="act-head"><span class="live-tag">LIVE</span></div><h2 id="zp-h">Choose where your note goes</h2><div class="choice-list" role="radiogroup" aria-labelledby="zp-h">${a.zones.map(z => `<button type="button" class="choice zone-choice" role="radio" aria-checked="${!!cur && cur.id === z.id}" data-act="pick-zone" data-id="${esc(z.id)}"${z.color ? ` style="--zc:${z.color}"` : ''}><span class="mark">${ic('check', 'sm')}</span><span class="txt"><b>${esc(z.title)}</b>${ZonePick.sub(z) ? `<small>${esc(ZonePick.sub(z))}</small>` : ''}</span><span class="zdot${z.color ? '' : ' any'}" aria-hidden="true"></span></button>`).join('')}</div></div>`;
    },
    /** Write and sketch pages: where this note will go (a chip per zone when there is a choice). */
    row(el) {
      if (!el) return;
      const a = State.activity, zones = Write.zoneActive() && !a.waiting ? (a.zones || []) : [];
      el.hidden = !zones.length;
      if (!zones.length) { el.innerHTML = ''; return; }
      const cur = Write.zone();
      el.innerHTML = zones.length === 1
        ? `<span class="zr-label">Adding to</span><span class="chip zone-chip static"${zones[0].color ? ` style="--zc:${zones[0].color}"` : ''}><span class="zdot${zones[0].color ? '' : ' any'}" aria-hidden="true"></span>${esc(zones[0].title)}</span>`
        : `<span class="zr-label" id="${el.id}-l">Adding to</span><div class="chip-row" role="radiogroup" aria-labelledby="${el.id}-l">${zones.map(z => `<button type="button" class="chip zone-chip" role="radio" aria-checked="${!!cur && cur.id === z.id}" data-zone="${esc(z.id)}"${z.color ? ` style="--zc:${z.color}"` : ''}><span class="zdot${z.color ? '' : ' any'}" aria-hidden="true"></span>${esc(z.title)}</button>`).join('')}</div>`;
    },
    choose(id) {
      const a = State.activity, z = (a.zones || []).find(x => x.id === id); if (!z) return;
      const before = Write.ctxTypes();
      State.zonePick = z.id; a.id = z.id;
      Views.renderBoard();
      ZonePick.row($('w-zone')); ZonePick.row($('s-zone'));
      if (Pages.isOpen('p-write') && Write.ctxTypes() !== before) Write.retype();
      DQBUI.haptic(8);
    },
    init() { ['w-zone', 's-zone'].forEach(id => on($(id), 'click', e => { const b = e.target.closest('[data-zone]'); if (b) ZonePick.choose(b.dataset.zone); })); }
  };

  /* ====================================================================== */
  /* Write a note                                                            */
  /* ====================================================================== */
  const Write = {
    type: 'notice', types: OPEN_TYPES,
    zoneActive() { const a = State.activity; return a.type === 'ZONE' && a.sub === 'OPEN_ZONE'; },
    /** The zone a new note goes into: the student's pick, or their only zone. */
    zone() { const a = State.activity; if (!Write.zoneActive() || a.waiting) return null; const zs = a.zones || []; return zs.find(z => z.id === State.zonePick) || zs[0] || null; },
    targetZoneId() { const z = Write.zone(); return z ? z.id : null; },
    canAdd() { const a = State.activity; return !State.muted && (a.type === 'OPEN' || (Write.zoneActive() && !!Write.zone())); },
    ctxTypes() { const z = Write.zone(); return (z && z.zoneType === 'cer') ? CER_TYPES : OPEN_TYPES; },
    /** The note types change when the student switches between a CER zone and a regular one. */
    retype() {
      Write.types = Write.ctxTypes();
      $('w-chips').innerHTML = Write.types.map(t => `<button type="button" class="chip" role="radio" aria-checked="false" data-type="${t}">${TYPES[t].icon} ${TYPES[t].lbl}</button>`).join('');
      Write.setType(Write.types.includes(Write.type) ? Write.type : Write.types[0], true);
    },
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
      ZonePick.row($('w-zone'));
      if (Write.canAdd() && Write.ctxTypes() !== Write.types) Write.retype();
      const w = $('w-warn');
      if (!Write.canAdd()) { w.hidden = false; w.textContent = State.muted ? 'Your teacher paused notes from you. Your draft is saved.' : (Write.zoneActive() ? 'You’re not in a group yet, so this note can’t be sent. Your draft is saved.' : 'The board was locked, so this note can’t be sent yet. Your draft is saved.'); }
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
      const n = { id: DQBUI.genId(), sub: Write.type, text: clampStr(text, MAX_TEXT), ts: Date.now(), boardId: State.boardId || 'board', status: 'sending', zoneId: Write.targetZoneId(), sid: State.me.sid };
      Store.saveNote(n); Conn.send(noteMsg(n), true);
      try { localStorage.removeItem('dqb_draft'); } catch (e) { /* ignore */ }
      $('w-txt').value = ''; Pages.close('p-write'); DQBUI.haptic(15);
      const z = Write.zone();
      Toast.success(State.rules.approve ? 'Sent — waiting for your teacher' : (z && (State.activity.zones || []).length > 1 ? `Sent to ${z.title}` : 'Sent to the board'), { duration: 2000 });
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
      const side = window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;       // phone on its side: tools sit beside the canvas
      const body = wrap.parentElement, cs = getComputedStyle(body);
      const w = wrap.clientWidth || 320, h = side ? Math.max(140, Math.round(body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))) : Math.round(Math.min(Math.max(w * 0.9, 240), window.innerHeight * 0.52));
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
      ZonePick.row($('s-zone'));
      if (!Write.canAdd()) { w.hidden = false; w.textContent = Write.zoneActive() && !State.muted ? 'You’re not in a group yet, so this drawing can’t be sent. It’s kept here.' : 'The board was locked, so this drawing can’t be sent yet. Your drawing is kept here.'; } else w.hidden = true;
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
      const n = { id: DQBUI.genId(), sub: 'sketch', text: clampStr($('s-caption').value.trim(), 80), src, ts: Date.now(), boardId: State.boardId || 'board', status: 'sending', zoneId: Write.targetZoneId(), sid: State.me.sid };
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
      CM.setItems(d.items);
      $('cm-title').textContent = clampStr(d.title, 60) || 'Class model';
      CM.renderInk(); CM.setPerms(false); CM.fitDefault();
      Pages.closeAll(['p-consensus']);
      Pages.open('p-consensus'); CM.loop();
    },
    /** The notes and sketches placed on the model (sent at the start, and again whenever the teacher changes them). */
    setItems(list) {
      const box = $('cm-items'); box.textContent = '';
      (Array.isArray(list) ? list : []).slice(0, 200).forEach(i => {
        const id = safeId(i && i.id); if (!id) return;
        const el = document.createElement('div'); el.id = 'ci-' + id; el.className = `c-item t-${TYPES[i.sub] ? i.sub : 'notice'}`;
        el.style.cssText = `transform:translate(${+i.x || 0}px,${+i.y || 0}px);width:${Math.max(40, +i.w || 180)}px;height:${Math.max(40, +i.h || 120)}px`;
        const s = i.src ? safeImg(i.src, 1500000) : ''; if (s) { const im = document.createElement('img'); im.src = s; im.alt = 'Sketch'; el.appendChild(im); } else el.textContent = clampStr(i.text, 500);
        box.appendChild(el);
      });
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
      on($('live-list'), 'click', e => { const o = e.target.closest('[data-open]'); if (o) { const id = Box.validId(o.dataset.open); if (id) { Onboard.stopScan(); Onboard.begin({ open: id }); } return; } const b = e.target.closest('[data-live]'); if (!b) return; const p = Net.parseJoinInput(b.dataset.live); if (p) { Onboard.stopScan(); Onboard.begin(p); } });
      on($('btn-edit-me'), 'click', () => { Views.show('setup'); $('inp-name').value = State.me.name; Onboard.pick(State.me.av); });
      on($('btn-rejoin'), 'click', () => { Views.show('join'); Onboard.live(); });
      on($('me-btn'), 'click', Profile.open);
    },
    pick(a) { Onboard.av = a; $$('#av-grid .av').forEach(b => b.setAttribute('aria-checked', String(b.dataset.av === a))); },
    afterProfile() {
      if (State.target) { Onboard.begin(State.target); return; }
      const lj = Store.lastJoin();
      if (lj && lj.open) { if (Box.api() && Box.validId(lj.open) && lj.sid === State.me.sid) { Onboard.begin({ open: Box.validId(lj.open) }); return; } }
      else if (lj) { Onboard.begin({ peerId: lj.peerId, code: lj.code }); return; }
      Views.show('join'); Onboard.live(); setTimeout(() => $('inp-code').focus({ preventScroll: true }), 100);
    },
    /** Boards the host says are live for this student right now (DQB_HOST.live() -> [{code, title, teacher}]), and boards open
        for them without the teacher (DQB_HOST.mailbox.list() -> [{id, title, teacher, lesson, until}]). */
    async live() {
      const fn = DQBUI.host().live, mb = Box.api(), box = $('live-list');
      if (!box || (typeof fn !== 'function' && !(mb && typeof mb.list === 'function'))) return;
      const ask = (f) => (typeof f === 'function' ? Promise.resolve().then(f).catch(() => []) : Promise.resolve([]));
      let [list, open] = await Promise.all([ask(fn), ask(mb && typeof mb.list === 'function' ? () => mb.list() : null)]);
      list = (Array.isArray(list) ? list : []).map(x => ({ code: String(x && x.code || '').toUpperCase(), title: clampStr(x && x.title, 80) || 'Class board', teacher: clampStr(x && x.teacher, 60), lesson: clampStr(x && x.lesson, 80) })).filter(x => Net.parseJoinInput(x.code)).slice(0, 6);
      open = (Array.isArray(open) ? open : []).map(x => ({ id: Box.validId(x && x.id), title: clampStr(x && x.title, 80) || 'Class board', teacher: clampStr(x && x.teacher, 60), lesson: clampStr(x && x.lesson, 80), until: Box.date(x && x.until) })).filter(x => x.id).slice(0, 10);
      if ((!list.length && !open.length) || State.view !== 'join') { box.hidden = true; box.innerHTML = ''; return; }
      box.innerHTML = (list.length ? `<div class="section-label">Live now</div>` + list.map(x => `<button type="button" class="live-item card" data-live="${esc(x.code)}"><span class="live-tag">LIVE</span><span class="tx"><b>${esc(x.title)}</b><small>${esc([x.teacher, x.lesson].filter(Boolean).join(' · ') || 'Your class')}</small></span><span class="btn btn-primary btn-sm" aria-hidden="true">Join</span></button>`).join('') : '')
        + (open.length ? `<div class="section-label">Open for you</div>` + open.map(x => `<button type="button" class="live-item open-item card" data-open="${x.id}"><span class="open-tag">Open</span><span class="tx"><b>${esc(x.title)}</b><small>${esc([x.teacher, x.lesson, x.until ? 'until ' + Box.when(x.until) : ''].filter(Boolean).join(' · ') || 'Your class')}</small></span><span class="btn btn-secondary btn-sm" aria-hidden="true">Open</span></button>`).join('') : '');
      box.hidden = false;
    },
    begin(target) {
      State.target = target; Views.show('board', true); Views.setTab('board'); Views.renderMe(); State.notes = State.notes || [];
      $('board-content').innerHTML = target.open ? Views.statusCard('📬', 'Opening the board…', 'Getting your class board. This takes a moment.') : Views.statusCard('📡', 'Connecting…', 'Joining your class. This takes a moment.');
      Conn.start(target);
    },
    async scan() {
      const reader = $('reader'), err = $('scan-err'); err.hidden = true; reader.hidden = false; $('btn-scan').hidden = true;
      try { await DQBUI.loadScript(DQBUI.asset('vendor/html5-qrcode.min.js')); } catch (e) { return Onboard.scanFail('The scanner couldn’t load. Please type the code instead.'); }
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
      const wrap = DQBUI.h(`<div class="stack" style="gap:18px"><div class="field"><label>Avatar</label><div class="prof-grid" id="pf-av" role="radiogroup">${Net.AVATARS.map(a => `<button type="button" class="av" role="radio" aria-checked="${a === av}" data-av="${a}" aria-label="Avatar ${a}">${a}</button>`).join('')}</div></div><div class="field"><label for="pf-name">Name</label><input class="input" id="pf-name" maxlength="24" value="${esc(State.me.name)}"${State.me.locked ? ' readonly aria-describedby="pf-name-hint"' : ''}>${State.me.locked ? `<div class="hint" id="pf-name-hint">${esc(DQBUI.host().identityHint || 'This is the name on your account.')}</div>` : ''}</div><div class="field"><label>Appearance</label><div class="seg" id="pf-theme" role="group">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${Theme.get() === v}">${l}</button>`).join('')}</div></div>${code ? `<div class="help-box" style="background:var(--surface-2);padding:12px 14px;border-radius:12px"><div class="muted" style="font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Class code</div><div style="font-size:1.4rem;font-weight:800;letter-spacing:.14em;font-family:ui-monospace,Menlo,monospace">${esc(code)}</div></div>` : ''}<button type="button" class="btn btn-danger-soft btn-block" id="pf-leave">${ic('logout')}${Box.id ? 'Leave this board' : 'Leave class'}</button></div>`);
      on(wrap, 'click', e => { const b = e.target.closest('[data-av]'); if (b) { av = b.dataset.av; $$('#pf-av .av', wrap).forEach(x => x.setAttribute('aria-checked', String(x === b))); } const t = e.target.closest('#pf-theme [data-v]'); if (t) { Theme.set(t.dataset.v); $$('#pf-theme button', wrap).forEach(x => x.setAttribute('aria-pressed', String(x === t))); } });
      const ov = Overlay.open({ title: 'You', content: wrap, size: 'sm', footer: [{ label: 'Cancel', kind: 'secondary' }, { label: 'Save', kind: 'primary', close: false, onClick: () => { const n = State.me.locked ? State.me.name : clampStr(wrap.querySelector('#pf-name').value.replace(/[<>\u0000-\u001f]/g, '').trim(), 24); if (!n) { wrap.querySelector('#pf-name').focus(); return false; } const changed = n !== State.me.name || av !== State.me.av; State.me.name = n; State.me.av = av; Store.saveProfile(); Views.renderMe(); ov.close(); if (changed && Conn.state === 'online') { Conn.raw({ type: 'JOIN', name: n, avatar: av, sid: State.me.sid, v: 2 }); } Toast.success('Saved'); } }] });
      on(wrap.querySelector('#pf-leave'), 'click', async () => { const open = !!Box.id; const ok = await Dialog.confirm({ title: open ? 'Leave this board?' : 'Leave this class?', message: open ? 'What you added is kept for your teacher, and your notes stay on this device.' : 'Your notes stay on this device.', confirmLabel: 'Leave', danger: true, icon: 'logout' }); if (!ok) return; ov.close(); Conn.stop(); Store.setLastJoin(null); State.target = null; State.everConnected = false; State.boardId = null; Pages.closeAll(); Shared.set([], true); Views.show('join'); Onboard.live(); });
    }
  };

  /* ====================================================================== */
  /* Boot                                                                    */
  /* ====================================================================== */
  async function boot() {
    hydrateIcons(document); Theme.apply();
    await Store.init();
    Onboard.init(); Write.init(); Sketch.init(); Poll.init(); Graph.init(); Exit.init(); CM.init(); ZonePick.init();
    Views.renderMe(); Views.renderNotes();
    const params = new URLSearchParams(location.search), jp = params.get('join'), op = Box.validId(params.get('open') || '');
    if (jp) State.target = Net.parseJoinInput(jp);
    else if (op && Box.api()) State.target = { open: op };          // a board open without the teacher (signed-in students)
    Net.peerOptions();                                  // persists ?peerHost=… before the query string is cleaned
    if (location.search) history.replaceState(history.state, '', location.pathname);
    $('inp-name').value = State.me.name || '';
    if (State.me.locked) { $('inp-name').readOnly = true; const h = $('name-hint'); if (h) { h.textContent = DQBUI.host().identityHint || 'This is the name on your account.'; h.hidden = false; } }
    const avatarChosen = !State.me.locked || (function () { try { return !!localStorage.getItem('dqb_av:' + State.me.sid); } catch (e) { return true; } })();
    if (State.me.name && avatarChosen) Onboard.afterProfile(); else Views.show('setup');
    document.body.dataset.ready = '1';
  }
  boot();
})();
