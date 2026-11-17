/* ==========================================================================
   InquiryDQB — media: video links, annotations (comments, callouts, hotspots, markup)
   and the viewer shared by the teacher console and the student app.
   Everything that comes from the network is untrusted: annotations go through cleanAnno(),
   video sources through parseVideo() / cleanVideo(), text is placed with textContent only.
   ========================================================================== */
(function (global) {
  'use strict';
  const U = global.DQBUI;
  const { safeId, safeColor, safeImg, safeThumb, safeUrl, clampStr, genId } = U;
  const ic = (n, c) => global.icon(n, c);

  /* ---------------------------------------------------------------------- */
  /* Video sources                                                           */
  /* ---------------------------------------------------------------------- */
  const YT_ID = /^[A-Za-z0-9_-]{11}$/, VIMEO_ID = /^\d{5,12}$/, VIMEO_H = /^[a-f0-9]{6,20}$/;
  const YT_ORIGIN = 'https://www.youtube-nocookie.com', VIMEO_ORIGIN = 'https://player.vimeo.com';

  /** Seconds from "90", "1m30s", "1h2m3s" or "1:30". */
  function parseTime(v) {
    if (v == null) return 0;
    v = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(v)) return Math.min(86400, +v);
    let m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (m && (m[1] || m[2] || m[3])) return Math.min(86400, (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
    m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    return m ? Math.min(86400, (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]) : 0;
  }

  /** A video address -> {p: 'youtube' | 'vimeo' | 'file', id | url, h?, start}, or null when it is not one. */
  function parseVideo(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s || s.length > 2048) return null;
    let u;
    try { u = new URL(s, global.location.href); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    const hashT = (u.hash.match(/[#&]t=([^&]+)/) || [])[1];
    const start = parseTime(u.searchParams.get('t') || u.searchParams.get('start') || hashT);
    if (host === 'youtu.be') { const id = u.pathname.split('/')[1] || ''; return YT_ID.test(id) ? { p: 'youtube', id, start } : null; }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
      let id = u.searchParams.get('v') || '';
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      if (m) id = m[1];
      return YT_ID.test(id) ? { p: 'youtube', id, start } : null;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = u.pathname.match(/(?:^|\/)(\d{5,12})(?:\/([a-f0-9]{6,20}))?\/?$/);
      if (!m) return null;
      const o = { p: 'vimeo', id: m[1], start }, h = m[2] || u.searchParams.get('h') || '';
      if (VIMEO_H.test(h)) o.h = h;
      return o;
    }
    if (/\.(mp4|m4v|webm|ogv|ogg|mov)$/i.test(u.pathname)) {
      const same = u.origin === global.location.origin;
      if (!same && u.protocol !== 'https:') return null;                 // never plain http from another site
      return { p: 'file', url: same ? u.pathname + u.search : u.href, start };
    }
    return null;
  }
  /** Re-checks a stored or received video source. */
  function cleanVideo(v) {
    if (!v || typeof v !== 'object') return null;
    const start = Math.max(0, Math.min(86400, Number(v.start) || 0));
    if (v.p === 'youtube' && YT_ID.test(String(v.id))) return { p: 'youtube', id: String(v.id), start };
    if (v.p === 'vimeo' && VIMEO_ID.test(String(v.id))) { const o = { p: 'vimeo', id: String(v.id), start }; if (VIMEO_H.test(String(v.h || ''))) o.h = String(v.h); return o; }
    if (v.p === 'file') { const r = parseVideo(v.url); return r && r.p === 'file' ? { p: 'file', url: r.url, start } : null; }
    return null;
  }
  const providerName = (v) => (v && v.p === 'youtube' ? 'YouTube' : (v && v.p === 'vimeo' ? 'Vimeo' : 'Video file'));
  /** The address to open the video on its own site. */
  function watchUrl(v) {
    v = cleanVideo(v); if (!v) return '';
    const t = Math.floor(v.start || 0);
    if (v.p === 'youtube') return 'https://www.youtube.com/watch?v=' + v.id + (t ? '&t=' + t + 's' : '');
    if (v.p === 'vimeo') return 'https://vimeo.com/' + v.id + (v.h ? '/' + v.h : '') + (t ? '#t=' + t + 's' : '');
    return v.url.charAt(0) === '/' ? global.location.origin + v.url : v.url;
  }
  function embedUrl(v, autoplay) {
    if (v.p === 'youtube') return YT_ORIGIN + '/embed/' + v.id + '?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=' + encodeURIComponent(global.location.origin) + (v.start ? '&start=' + Math.floor(v.start) : '') + (autoplay ? '&autoplay=1' : '');
    if (v.p === 'vimeo') return VIMEO_ORIGIN + '/video/' + v.id + '?dnt=1&playsinline=1&title=0&byline=0&portrait=0' + (v.h ? '&h=' + v.h : '') + (autoplay ? '&autoplay=1' : '') + (v.start ? '#t=' + Math.floor(v.start) + 's' : '');
    return '';
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }

  /* ---------------------------------------------------------------------- */
  /* Annotations                                                             */
  /* ---------------------------------------------------------------------- */
  const KINDS = ['comment', 'ink', 'callout', 'hotspot'];
  const TOOLS = ['pen', 'hl', 'arrow'];
  const TAGS = ['notice', 'wonder', 'idea', 'question', 'connection', 'feedback'];
  const LIMITS = { perItem: 800, perStudent: 60, text: 500, pts: 1500 };
  const SPAN = { comment: 5, callout: 6, hotspot: 8, ink: 6 };       // seconds on screen from an annotation's moment
  const unit = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 10000) / 10000;
  const secs = (v) => { if (v == null || v === '') return null; v = Number(v); return Number.isFinite(v) ? Math.round(Math.max(0, Math.min(86400, v)) * 100) / 100 : null; };
  const cleanName = (n) => clampStr(String(n == null ? '' : n).replace(/[<>\u0000-\u001f]/g, '').trim(), 24);

  /**
   * One annotation, re-checked. o.student: a student wrote it (no callouts or hotspots); o.video: false drops times.
   * Shape: {id, k, by: {n, r: 't' | 's', sid?}, ts, text?, tag?, x?, y?, t?, t2?, rad?, pause?, re?, pts?, c?, w?, tool?, pend?, mine?}
   */
  function cleanAnno(a, o) {
    o = o || {};
    if (!a || typeof a !== 'object' || !KINDS.includes(a.k)) return null;
    const k = a.k;
    if (o.student && (k === 'callout' || k === 'hotspot')) return null;
    const by = a.by && typeof a.by === 'object' ? a.by : {};
    const r = { id: safeId(a.id) || genId(), k, by: { n: cleanName(by.n) || (by.r === 't' ? 'Teacher' : 'Student'), r: by.r === 't' ? 't' : 's' } };
    if (safeId(by.sid)) r.by.sid = by.sid;
    const ts = Number(a.ts); r.ts = Number.isFinite(ts) && ts > 0 ? Math.min(4102444800000, Math.floor(ts)) : Date.now();
    if (o.video !== false) {
      const t = secs(a.t); if (t != null) r.t = t;
      const t2 = secs(a.t2); if (t2 != null && r.t != null && t2 > r.t) r.t2 = Math.min(t2, r.t + 3600);
    }
    if (k === 'ink') {
      const pts = (Array.isArray(a.pts) ? a.pts : []).slice(0, LIMITS.pts).filter(p => Array.isArray(p) && p.length >= 2).map(p => [unit(p[0]), unit(p[1])]);
      if (pts.length < 2) return null;
      r.pts = pts; r.c = safeColor(a.c) || '#ef4444';
      r.w = Math.round(Math.max(0.0015, Math.min(0.06, Number(a.w) || 0.006)) * 10000) / 10000;
      r.tool = TOOLS.includes(a.tool) ? a.tool : 'pen';
    } else {
      const text = clampStr(String(a.text == null ? '' : a.text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''), LIMITS.text).trim();
      if (!text) return null;
      r.text = text;
      const hasXY = a.x != null && a.y != null && a.x !== '' && a.y !== '' && Number.isFinite(+a.x) && Number.isFinite(+a.y);
      if (hasXY) { r.x = unit(a.x); r.y = unit(a.y); }
      if ((k === 'callout' || k === 'hotspot') && !hasXY) return null;
      if (k === 'hotspot') { r.rad = Math.round(Math.max(0.015, Math.min(0.2, Number(a.rad) || 0.045)) * 10000) / 10000; if (a.pause) r.pause = true; }
      if (k === 'comment') {
        if (safeId(a.re)) r.re = a.re;
        if (TAGS.includes(a.tag)) r.tag = a.tag;
      }
    }
    if (a.pend) r.pend = true;
    if (a.mine) r.mine = true;
    return r;
  }
  /** A whole list: at most LIMITS.perItem, replies only to comments that exist. */
  function cleanAnnos(list, o) {
    const out = (Array.isArray(list) ? list : []).slice(0, LIMITS.perItem).map(a => cleanAnno(a, o)).filter(Boolean);
    const seen = new Set(), ok = [];
    out.forEach(a => { if (!seen.has(a.id)) { seen.add(a.id); ok.push(a); } });
    const comments = new Set(ok.filter(a => a.k === 'comment' && !a.re).map(a => a.id));
    ok.forEach(a => { if (a.re && !comments.has(a.re)) delete a.re; });
    return ok;
  }
  /**
   * What one viewer may see. v: {teacher, sid, peers: classmates' annotations are shown, names: their names are shown}.
   * Students never receive another student's id; their own carry `mine`.
   */
  function visibleTo(list, v) {
    return (list || []).filter(a => v.teacher || a.by.r === 't' || (a.by.sid && a.by.sid === v.sid) || (v.peers && !a.pend)).map(a => {
      if (v.teacher) return a;
      const mine = !!(a.by.sid && a.by.sid === v.sid);
      const c = Object.assign({}, a, { by: { n: a.by.r === 't' || mine || v.names ? a.by.n : 'Classmate', r: a.by.r } });
      if (mine) c.mine = true; else delete c.mine;
      return c;
    });
  }
  /** Counts for a card: comments, markup strokes, waiting for approval. */
  function counts(list) {
    const c = { comments: 0, ink: 0, pend: 0, marks: 0 };
    (list || []).forEach(a => { if (a.k === 'comment') c.comments++; else if (a.k === 'ink') c.ink++; else c.marks++; if (a.pend) c.pend++; });
    return c;
  }

  /* ---------------------------------------------------------------------- */
  /* Players: one small interface for a <video>, YouTube and Vimeo            */
  /* {el, time(), duration(), playing(), seek(t), play(), pause(), onTime(cb), onMeta(cb), destroy()} */
  /* ---------------------------------------------------------------------- */
  function basePlayer(el) {
    const p = { el, _t: 0, _d: 0, _playing: false, _at: 0, _time: [], _meta: [] };
    p.onTime = (cb) => { p._time.push(cb); };
    p.onMeta = (cb) => { p._meta.push(cb); };
    p._fire = () => { const t = p.time(), pl = p.playing(); p._time.forEach(cb => { try { cb(t, pl); } catch (e) { console.error(e); } }); };
    p._fireMeta = (ar, d) => p._meta.forEach(cb => { try { cb(ar, d); } catch (e) { console.error(e); } });
    p.duration = () => p._d;
    p.playing = () => p._playing;
    // iframe players report the time a few times a second: in between, the time moves on with the clock
    p.time = () => p._t + (p._playing ? Math.min(1.5, (performance.now() - p._at) / 1000) : 0);
    p._set = (t, playing) => { if (typeof t === 'number' && isFinite(t)) { p._t = t; p._at = performance.now(); } if (typeof playing === 'boolean') { if (playing !== p._playing) { p._t = p.time(); p._at = performance.now(); } p._playing = playing; } };
    return p;
  }

  function filePlayer(v, title) {
    const el = document.createElement('video');
    el.controls = true; el.playsInline = true; el.preload = 'metadata'; el.setAttribute('playsinline', '');
    el.setAttribute('aria-label', title || 'Video');
    const src = v.url.charAt(0) === '/' ? v.url : safeUrl(v.url);
    if (src) el.src = src;
    const p = basePlayer(el);
    p.time = () => el.currentTime || 0;
    p.duration = () => (isFinite(el.duration) ? el.duration : 0);
    p.playing = () => !el.paused && !el.ended;
    p.seek = (t) => { try { el.currentTime = Math.max(0, t); } catch (e) { /* ignore */ } p._fire(); };
    p.play = () => { const r = el.play(); if (r && r.catch) r.catch(() => {}); };
    p.pause = () => el.pause();
    let raf = 0;
    const loop = () => { raf = 0; p._fire(); if (p.playing()) raf = requestAnimationFrame(loop); };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    ['play', 'playing'].forEach(e => el.addEventListener(e, kick));
    ['pause', 'seeked', 'timeupdate', 'ended'].forEach(e => el.addEventListener(e, () => p._fire()));
    el.addEventListener('loadedmetadata', () => {
      if (v.start && !el.currentTime) { try { el.currentTime = v.start; } catch (e) { /* ignore */ } }
      p._fireMeta(el.videoWidth && el.videoHeight ? el.videoWidth / el.videoHeight : 0, p.duration()); p._fire();
    });
    p.destroy = () => { cancelAnimationFrame(raf); try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) { /* ignore */ } };
    return p;
  }

  function frame(src, title) {
    const f = document.createElement('iframe');
    f.src = src; f.title = title || 'Video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.setAttribute('allowfullscreen', '');
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    return f;
  }

  /** YouTube through its iframe postMessage protocol (the same messages its JavaScript API uses), without loading that script. */
  function youtubePlayer(v, title, autoplay) {
    const f = frame(embedUrl(v, autoplay), title), p = basePlayer(f);
    p._t = v.start || 0;
    const post = (o) => { try { if (f.contentWindow) f.contentWindow.postMessage(JSON.stringify(Object.assign({ id: 1, channel: 'widget' }, o)), YT_ORIGIN); } catch (e) { /* ignore */ } };
    const cmd = (func, args) => post({ event: 'command', func, args: args || [] });
    let ready = false, tries = 0;
    const hello = setInterval(() => { if (ready || ++tries > 40) { clearInterval(hello); return; } post({ event: 'listening' }); }, 500);
    f.addEventListener('load', () => post({ event: 'listening' }));
    const onMsg = (e) => {
      if (e.source !== f.contentWindow || e.origin !== YT_ORIGIN) return;
      let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
      if (!d || typeof d !== 'object') return;
      if (d.event === 'onReady' || d.event === 'initialDelivery') ready = true;
      const info = d.info && typeof d.info === 'object' ? d.info : null;
      if (!info) return;
      ready = true;
      if (typeof info.duration === 'number' && info.duration > 0 && info.duration !== p._d) { p._d = info.duration; p._fireMeta(16 / 9, p._d); }
      p._set(typeof info.currentTime === 'number' ? info.currentTime : undefined, typeof info.playerState === 'number' ? info.playerState === 1 : undefined);
      p._fire();
    };
    global.addEventListener('message', onMsg);
    let tick = setInterval(() => { if (p._playing) p._fire(); }, 200);
    p.seek = (t) => { cmd('seekTo', [Math.max(0, t), true]); p._set(Math.max(0, t)); p._fire(); };
    p.play = () => cmd('playVideo');
    p.pause = () => { cmd('pauseVideo'); p._set(p.time(), false); p._fire(); };
    p.destroy = () => { global.removeEventListener('message', onMsg); clearInterval(hello); clearInterval(tick); tick = 0; try { f.src = 'about:blank'; } catch (e) { /* ignore */ } };
    return p;
  }

  /** Vimeo through its player postMessage protocol. */
  function vimeoPlayer(v, title, autoplay) {
    const f = frame(embedUrl(v, autoplay), title), p = basePlayer(f);
    p._t = v.start || 0;
    const post = (method, value) => { try { if (f.contentWindow) f.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), VIMEO_ORIGIN); } catch (e) { /* ignore */ } };
    const onMsg = (e) => {
      if (e.source !== f.contentWindow || e.origin !== VIMEO_ORIGIN) return;
      let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
      if (!d || typeof d !== 'object') return;
      if (d.event === 'ready') { ['timeupdate', 'play', 'pause', 'seeked', 'ended'].forEach(ev => post('addEventListener', ev)); post('getDuration'); return; }
      const data = d.data && typeof d.data === 'object' ? d.data : {};
      if (d.method === 'getDuration' && typeof d.value === 'number') { p._d = d.value; p._fireMeta(16 / 9, p._d); return; }
      if (typeof data.duration === 'number' && data.duration > 0 && !p._d) { p._d = data.duration; p._fireMeta(16 / 9, p._d); }
      if (d.event === 'timeupdate' || d.event === 'seeked') p._set(typeof data.seconds === 'number' ? data.seconds : undefined);
      if (d.event === 'play') p._set(typeof data.seconds === 'number' ? data.seconds : undefined, true);
      if (d.event === 'pause' || d.event === 'ended') p._set(typeof data.seconds === 'number' ? data.seconds : undefined, false);
      p._fire();
    };
    global.addEventListener('message', onMsg);
    let tick = setInterval(() => { if (p._playing) p._fire(); }, 200);
    p.seek = (t) => { post('setCurrentTime', Math.max(0, t)); p._set(Math.max(0, t)); p._fire(); };
    p.play = () => post('play');
    p.pause = () => { post('pause'); p._set(p.time(), false); p._fire(); };
    p.destroy = () => { global.removeEventListener('message', onMsg); clearInterval(tick); tick = 0; try { f.src = 'about:blank'; } catch (e) { /* ignore */ } };
    return p;
  }

  function makePlayer(v, title, autoplay) {
    if (v.p === 'file') return filePlayer(v, title);
    if (v.p === 'youtube') return youtubePlayer(v, title, autoplay);
    if (v.p === 'vimeo') return vimeoPlayer(v, title, autoplay);
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Image helpers                                                           */
  /* ---------------------------------------------------------------------- */
  /**
   * Re-encodes a picture (a File/Blob, a data URI or a same-site address) so it is small enough to keep in a board and send to
   * students: JPEG (PNG when it has transparency and stays small), at most `max` px on the long side and `bytes` long.
   * Resolves {src, thumb, aspect} or null (unreadable, or another site's picture, which would taint the canvas).
   */
  function encodeImage(input, o) {
    o = o || {};
    const max = o.max || 1800, bytes = o.bytes || 1000000;
    return new Promise((resolve) => {
      let url = null, revoke = false;
      if (input && typeof input === 'object' && typeof input.size === 'number') {
        if (!/^image\/(png|jpeg|gif|webp|bmp)$/i.test(input.type || '') || input.size > 30000000) return resolve(null);
        url = URL.createObjectURL(input); revoke = true;
      } else url = safeThumb(input) || safeImg(input);
      if (!url) return resolve(null);
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => {
        try {
          const w0 = im.naturalWidth || 1, h0 = im.naturalHeight || 1;
          const draw = (lim, type, q) => {
            const k = Math.min(1, lim / Math.max(w0, h0));
            const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
            const ctx = cv.getContext('2d');
            if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); }
            ctx.drawImage(im, 0, 0, cv.width, cv.height);
            return cv.toDataURL(type, q);
          };
          let lim = max, src = '';
          for (let i = 0; i < 6; i++) {
            src = draw(lim, 'image/jpeg', i < 3 ? 0.86 - i * 0.08 : 0.68);
            if (src.length * 0.75 <= bytes) break;
            lim = Math.round(lim * 0.8);
          }
          if (src.length * 0.75 > bytes * 1.05) return resolve(null);
          const thumb = draw(320, 'image/jpeg', 0.72);
          resolve({ src: safeImg(src, 1500000) || null, thumb: safeImg(thumb, 120000) || null, aspect: Math.round((w0 / h0) * 1000) / 1000 });
        } catch (e) { resolve(null); }
        finally { if (revoke) URL.revokeObjectURL(url); }
      };
      im.onerror = () => { if (revoke) URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Viewer                                                                  */
  /* ---------------------------------------------------------------------- */
  const COLORS = [['#ef4444', 'Red'], ['#f97316', 'Orange'], ['#eab308', 'Yellow'], ['#10b981', 'Green'], ['#3b82f6', 'Blue'], ['#8b5cf6', 'Purple'], ['#111827', 'Black'], ['#ffffff', 'White']];
  const TOOL_INFO = {
    view: ['eye', 'Look'], pin: ['map-pin', 'Comment here'], pen: ['pen', 'Pen'], hl: ['highlighter', 'Marker'], arrow: ['arrow', 'Arrow'],
    callout: ['callout', 'Callout'], hotspot: ['target', 'Hotspot']
  };
  const SVGNS = 'http://www.w3.org/2000/svg';

  /**
   * Mounts a viewer in `host`. opts:
   *   item      {id, kind: 'image' | 'video' | 'link', title, desc, src, thumb, video, aspect, url, source}
   *   me        {sid, name, role: 't' | 's'}
   *   canAdd    whether this person may add annotations now (default true); notice: why not
   *   onAdd(a)  a new annotation (not yet cleaned: the receiver cleans it)
   *   onDelete(ids), onApprove(id)   (teacher) / onDelete for one's own
   *   onOpenLink(url)                link items: open the page
   * Returns {el, setItem(item), setAnnos(list), setCanAdd(bool, notice), destroy(), player()}.
   */
  function Viewer(host, opts) {
    opts = opts || {};
    const me = Object.assign({ role: 's', sid: '', name: '' }, opts.me || {});
    const teacher = me.role === 't';
    let item = null, annos = [], player = null, mode = 'view', color = teacher ? '#3b82f6' : '#ef4444';
    let pending = null, replyTo = null, attachTime = true, ar = 16 / 9, now = 0, lastNow = 0, visSig = '', destroyed = false;
    let canAdd = opts.canAdd !== false, notice = opts.notice || '';
    const revealed = new Set();
    let ro = null, drawing = null, popFor = null;

    const root = document.createElement('div'); root.className = 'mv';
    root.innerHTML = `
      <div class="mv-main">
        <div class="mv-linkcard" hidden></div>
        <div class="mv-box">
          <div class="mv-stage">
            <div class="mv-media"></div>
            <svg class="mv-ink" aria-hidden="true" focusable="false"></svg>
            <div class="mv-marks"></div>
            <div class="mv-capture" hidden tabindex="0" role="application" aria-label="Annotation area: press Enter to place here, arrow keys to move"></div>
            <div class="mv-pop" hidden></div>
          </div>
        </div>
        <div class="mv-time" hidden>
          <button type="button" class="icon-btn sm mv-pp" data-mv="pp" aria-label="Play">${ic('play', 'sm')}</button>
          <span class="mv-clock" aria-live="off">0:00</span>
          <div class="mv-track"><div class="mv-prog"></div><div class="mv-tmarks" role="group" aria-label="Moments on this video"></div></div>
        </div>
        <div class="mv-tools" role="toolbar" aria-label="Annotation tools"></div>
      </div>
      <aside class="mv-side" aria-label="Comments">
        <div class="mv-side-h"><h3>Comments</h3><span class="mv-count muted"></span></div>
        <div class="mv-notice" hidden></div>
        <ol class="mv-thread"></ol>
        <div class="mv-compose">
          <div class="mv-ctx"></div>
          <div class="mv-crow">
            <textarea class="textarea mv-in" rows="2" maxlength="${LIMITS.text}" placeholder="Add a comment…" aria-label="Your comment"></textarea>
            <button type="button" class="btn btn-primary btn-sm mv-post" data-mv="post">${ic('send', 'sm')}<span>Post</span></button>
          </div>
        </div>
      </aside>`;
    host.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const stage = $('.mv-stage'), media = $('.mv-media'), inkSvg = $('.mv-ink'), marks = $('.mv-marks'), capture = $('.mv-capture'), pop = $('.mv-pop');
    const box = $('.mv-box'), tools = $('.mv-tools'), timeBar = $('.mv-time'), tmarks = $('.mv-tmarks'), prog = $('.mv-prog'), clock = $('.mv-clock');
    const thread = $('.mv-thread'), input = $('.mv-in'), ctx = $('.mv-ctx'), countEl = $('.mv-count'), noticeEl = $('.mv-notice'), linkCard = $('.mv-linkcard');

    const isVideo = () => !!(item && item.kind === 'video');
    const isLink = () => !!(item && item.kind === 'link');
    const span = (a) => (a.t2 != null ? a.t2 : a.t + (SPAN[a.k] || 5));
    const onNow = (a) => !isVideo() || a.t == null || (now >= a.t - 0.05 && now <= span(a));
    const comments = () => annos.filter(a => a.k === 'comment');
    /** Pinned comments in thread order get numbers 1, 2, 3 … */
    const pinNumbers = () => { const m = new Map(); let n = 0; ordered().forEach(a => { if (a.x != null && !a.re) m.set(a.id, ++n); }); return m; };
    const ordered = () => comments().filter(a => !a.re).sort((a, b) => (isVideo() ? ((a.t == null ? 1e9 : a.t) - (b.t == null ? 1e9 : b.t)) : 0) || a.ts - b.ts);

    /* ---- layout: the stage keeps the picture's shape and fits the box ---- */
    function fit() {
      if (isLink()) return;
      const bw = box.clientWidth, bh = box.clientHeight;
      if (!bw || !bh) return;
      let w = bw, h = w / ar;
      if (h > bh) { h = bh; w = h * ar; }
      stage.style.width = Math.round(w) + 'px'; stage.style.height = Math.round(h) + 'px';
      renderInk(); renderMarks(true);
    }

    /* ---- media ---- */
    function mountMedia() {
      if (player) { player.destroy(); player = null; }
      media.textContent = ''; revealed.clear();
      linkCard.hidden = !isLink(); box.hidden = isLink(); tools.hidden = isLink() || !canAdd; timeBar.hidden = !isVideo();
      root.classList.toggle('mv-is-link', isLink()); root.classList.toggle('mv-is-video', isVideo());
      if (isLink()) { renderLinkCard(); return; }
      if (item.kind === 'image') {
        ar = item.aspect > 0.1 && item.aspect < 10 ? item.aspect : ar;
        const src = safeImg(item.src, 3000000) || safeThumb(item.src);
        if (src) {
          const img = document.createElement('img'); img.className = 'mv-img'; img.alt = item.title || 'Picture'; img.draggable = false;
          img.onload = () => { if (img.naturalWidth && img.naturalHeight) { ar = img.naturalWidth / img.naturalHeight; fit(); } };
          img.src = src; media.appendChild(img);
        } else {
          const th = safeImg(item.thumb, 200000) || safeThumb(item.thumb);
          const ph = document.createElement('div'); ph.className = 'mv-loading';
          if (th) { const im = document.createElement('img'); im.alt = ''; im.src = th; ph.appendChild(im); }
          const s = document.createElement('span'); s.textContent = 'Loading the picture…'; ph.appendChild(s);
          media.appendChild(ph);
        }
      } else if (isVideo()) {
        const v = cleanVideo(item.video);
        ar = item.aspect > 0.3 && item.aspect < 4 ? item.aspect : 16 / 9;
        if (!v) { const ph = document.createElement('div'); ph.className = 'mv-loading'; ph.textContent = 'This video can’t be played here.'; media.appendChild(ph); }
        else if (v.p === 'file') attachPlayer(makePlayer(v, item.title, false));
        else {
          // a cover first: nothing loads from the video site until someone presses play
          const cover = document.createElement('button'); cover.type = 'button'; cover.className = 'mv-cover';
          const th = safeImg(item.thumb, 200000) || safeThumb(item.thumb);
          if (th) { const im = document.createElement('img'); im.alt = ''; im.src = th; cover.appendChild(im); }
          const inner = document.createElement('span'); inner.className = 'mv-cover-in';
          inner.innerHTML = `<span class="mv-play">${ic('play', 'lg')}</span><b></b><small></small>`;
          inner.querySelector('b').textContent = 'Play video';
          inner.querySelector('small').textContent = 'Loads from ' + providerName(v);
          cover.appendChild(inner);
          cover.setAttribute('aria-label', 'Play ' + (item.title || 'the video') + ' (loads from ' + providerName(v) + ')');
          cover.addEventListener('click', () => { attachPlayer(makePlayer(v, item.title, true)); cover.remove(); });
          media.appendChild(cover);
          now = v.start || 0;
        }
      }
      fit();
    }
    function attachPlayer(p) {
      if (!p) return;
      player = p; media.appendChild(p.el);
      p.onMeta((a) => { if (a > 0.3 && a < 4 && Math.abs(a - ar) > 0.01) { ar = a; fit(); } renderTimeline(); });
      p.onTime((t, playing) => tick(t, playing));
    }
    function renderLinkCard() {
      linkCard.textContent = '';
      const th = safeThumb(item.thumb) || safeImg(item.thumb, 200000);
      if (th) { const im = document.createElement('img'); im.className = 'mv-lc-thumb'; im.alt = ''; im.src = th; linkCard.appendChild(im); }
      const t = document.createElement('h3'); t.className = 'mv-lc-title'; t.textContent = item.title || 'Link'; linkCard.appendChild(t);
      if (item.desc) { const d = document.createElement('p'); d.className = 'mv-lc-desc'; d.textContent = item.desc; linkCard.appendChild(d); }
      const url = safeUrl(item.url);
      if (url) {
        const src = document.createElement('div'); src.className = 'mv-lc-src muted'; let hn = ''; try { hn = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
        src.textContent = item.source ? item.source + ' · ' + hn : hn; linkCard.appendChild(src);
        const a = document.createElement('a'); a.className = 'btn btn-secondary'; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.innerHTML = ic('link', 'sm') + '<span>Open</span><span class="sr-only"> (opens in a new tab)</span>';
        a.addEventListener('click', () => { if (opts.onOpenLink) opts.onOpenLink(url); });
        linkCard.appendChild(a);
      }
    }

    /* ---- time ---- */
    function tick(t, playing) {
      lastNow = now; now = t;
      const pp = $('.mv-pp'); if (pp) { const want = playing ? 'pause' : 'play'; if (pp.dataset.st !== want) { pp.dataset.st = want; pp.innerHTML = ic(want, 'sm'); pp.setAttribute('aria-label', playing ? 'Pause' : 'Play'); } }
      clock.textContent = fmtTime(now) + (player && player.duration() ? ' / ' + fmtTime(player.duration()) : '');
      const d = player ? player.duration() : 0;
      prog.style.width = d ? Math.min(100, (now / d) * 100) + '%' : '0';
      // a hotspot that pauses the video: stop when playback reaches it
      if (playing && !teacher && now > lastNow && now - lastNow < 2) {
        const hit = annos.find(a => a.k === 'hotspot' && a.pause && a.t != null && a.t > lastNow && a.t <= now && !revealed.has(a.id));
        if (hit && player) { player.pause(); player.seek(hit.t); setTimeout(() => { const b = marks.querySelector('[data-aid="' + hit.id + '"]'); if (b) { b.classList.add('attn'); b.focus({ preventScroll: true }); } }, 60); U.announce('The video paused at a hotspot. Tap it to find out more.'); }
      }
      renderMarks(); renderInk(true);
      updateCtx();
    }
    function renderTimeline() {
      tmarks.textContent = '';
      const d = player ? player.duration() : 0;
      if (!isVideo() || !d) return;
      const nums = pinNumbers();
      annos.filter(a => a.t != null && a.k !== 'ink' && !a.re && (teacher || a.k !== 'hotspot' || revealed.has(a.id))).forEach(a => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'mv-tm k-' + a.k + (a.by.r === 't' ? ' by-t' : '');
        b.style.left = Math.min(100, (a.t / d) * 100) + '%';
        b.dataset.seek = String(a.t); b.dataset.aid = a.id;
        const what = a.k === 'comment' ? 'Comment' + (nums.has(a.id) ? ' ' + nums.get(a.id) : '') + ' by ' + a.by.n : (a.k === 'callout' ? 'Callout' : 'Hotspot');
        b.setAttribute('aria-label', what + ' at ' + fmtTime(a.t) + (a.k !== 'hotspot' ? ': ' + clampStr(a.text, 80) : ''));
        b.title = fmtTime(a.t) + ' · ' + what;
        tmarks.appendChild(b);
      });
    }

    /* ---- drawing on the picture ---- */
    function px(p) { return [p[0] * stage.clientWidth, p[1] * stage.clientHeight]; }
    function pathFor(a) {
      const W = stage.clientWidth || 1;
      const g = document.createElementNS(SVGNS, 'g');
      const sw = Math.max(1.5, a.w * W * (a.tool === 'hl' ? 3 : 1));
      if (a.tool === 'arrow') {
        const [x1, y1] = px(a.pts[0]), [x2, y2] = px(a.pts[a.pts.length - 1]);
        const ang = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(10, sw * 3.2);
        const line = document.createElementNS(SVGNS, 'path');
        line.setAttribute('d', `M${x1} ${y1} L${x2} ${y2} M${x2 - hl * Math.cos(ang - 0.45)} ${y2 - hl * Math.sin(ang - 0.45)} L${x2} ${y2} L${x2 - hl * Math.cos(ang + 0.45)} ${y2 - hl * Math.sin(ang + 0.45)}`);
        g.appendChild(line);
      } else {
        const pts = a.pts.map(px);
        const line = document.createElementNS(SVGNS, 'path');
        let d = `M${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`; }
        d += ` L${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
        line.setAttribute('d', d); g.appendChild(line);
      }
      g.setAttribute('stroke', a.c); g.setAttribute('stroke-width', String(sw)); g.setAttribute('fill', 'none');
      g.setAttribute('stroke-linecap', 'round'); g.setAttribute('stroke-linejoin', 'round');
      if (a.tool === 'hl') g.setAttribute('stroke-opacity', '0.38');
      if (a.pend) g.setAttribute('stroke-dasharray', String(sw * 1.6) + ' ' + String(sw * 1.4));
      return g;
    }
    let inkSig = '';
    function renderInk(onlyIfChanged) {
      const list = annos.filter(a => a.k === 'ink' && onNow(a));
      const sig = list.map(a => a.id).join() + '|' + stage.clientWidth + 'x' + stage.clientHeight + (drawing ? '|d' + drawing.pts.length : '');
      if (onlyIfChanged && sig === inkSig) return;
      inkSig = sig;
      inkSvg.setAttribute('viewBox', `0 0 ${stage.clientWidth || 1} ${stage.clientHeight || 1}`);
      inkSvg.textContent = '';
      list.forEach(a => inkSvg.appendChild(pathFor(a)));
      if (drawing && drawing.pts.length > 1) inkSvg.appendChild(pathFor(drawing));
    }

    /* ---- pins, callouts and hotspots ---- */
    function renderMarks(force) {
      const nums = pinNumbers();
      const list = annos.filter(a => a.k !== 'ink' && a.x != null && !a.re && onNow(a) && (teacher || a.k !== 'hotspot' || true));
      const sig = list.map(a => a.id + (revealed.has(a.id) ? 'r' : '') + (a.pend ? 'p' : '')).join() + (pending ? '|P' + pending.x + ',' + pending.y : '') + '|' + nums.size;
      if (!force && sig === visSig) return;
      visSig = sig;
      const focused = document.activeElement && marks.contains(document.activeElement) ? document.activeElement.dataset.aid : null;
      marks.textContent = '';
      list.forEach(a => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.aid = a.id;
        b.style.left = (a.x * 100) + '%'; b.style.top = (a.y * 100) + '%';
        if (a.k === 'comment') {
          b.className = 'mv-pin' + (a.by.r === 't' ? ' by-t' : '') + (a.mine ? ' mine' : '') + (a.pend ? ' pend' : '');
          b.textContent = String(nums.get(a.id) || '•');
          b.setAttribute('aria-label', 'Comment ' + (nums.get(a.id) || '') + ' by ' + a.by.n + ': ' + clampStr(a.text, 120));
        } else if (a.k === 'callout') {
          b.className = 'mv-callout'; b.textContent = a.text;
          b.setAttribute('aria-label', 'Callout: ' + a.text);
        } else {
          const open = revealed.has(a.id) || teacher;
          b.className = 'mv-hot' + (revealed.has(a.id) ? ' seen' : '');
          const d = Math.max(28, a.rad * 2 * (stage.clientWidth || 300));
          b.style.width = b.style.height = d + 'px';
          b.innerHTML = `<span class="mv-hot-ring"></span>${revealed.has(a.id) ? ic('check', 'sm') : ''}`;
          b.setAttribute('aria-label', open ? 'Hotspot: ' + a.text : 'Hotspot: tap to find out more');
          b.setAttribute('aria-expanded', String(popFor === a.id));
        }
        marks.appendChild(b);
      });
      if (pending) {
        const p = document.createElement('span'); p.className = 'mv-pin placing'; p.textContent = '+';
        p.style.left = (pending.x * 100) + '%'; p.style.top = (pending.y * 100) + '%'; p.setAttribute('aria-hidden', 'true');
        marks.appendChild(p);
      }
      if (focused) { const f = marks.querySelector('[data-aid="' + focused + '"]'); if (f) f.focus({ preventScroll: true }); }
    }
    function showPop(a, anchor) {
      popFor = a.id;
      pop.textContent = '';
      const t = document.createElement('div'); t.className = 'mv-pop-t'; t.textContent = a.text; pop.appendChild(t);
      if (a.k === 'hotspot' && isVideo() && a.pause && player && !teacher) {
        const go = document.createElement('button'); go.type = 'button'; go.className = 'btn btn-primary btn-sm'; go.innerHTML = ic('play', 'sm') + '<span>Keep watching</span>';
        go.addEventListener('click', () => { hidePop(); player.play(); }); pop.appendChild(go);
      }
      const x = document.createElement('button'); x.type = 'button'; x.className = 'icon-btn sm mv-pop-x'; x.setAttribute('aria-label', 'Close'); x.innerHTML = ic('close', 'sm');
      x.addEventListener('click', () => { hidePop(); if (anchor) anchor.focus({ preventScroll: true }); }); pop.appendChild(x);
      pop.hidden = false;
      const left = Math.min(Math.max(a.x, 0.18), 0.82), below = a.y < 0.5;
      pop.style.left = (left * 100) + '%'; pop.style.top = below ? 'calc(' + (a.y * 100) + '% + 26px)' : ''; pop.style.bottom = below ? '' : 'calc(' + ((1 - a.y) * 100) + '% + 26px)';
      pop.setAttribute('role', 'note');
      renderMarks(true);
    }
    function hidePop() { pop.hidden = true; popFor = null; pop.textContent = ''; renderMarks(true); }

    /* ---- the comments list ---- */
    function renderThread() {
      const nums = pinNumbers(), top = ordered(), kids = comments().filter(a => a.re);
      countEl.textContent = top.length ? String(top.length + kids.length) : '';
      thread.textContent = '';
      if (!top.length) { const li = document.createElement('li'); li.className = 'mv-empty muted'; li.textContent = isVideo() ? 'No comments yet. Pause at a moment and say what you notice.' : (isLink() ? 'No comments yet.' : 'No comments yet. Tap “Comment here”, then tap the picture.'); thread.appendChild(li); }
      const entry = (a, isReply) => {
        const li = document.createElement('li'); li.className = 'mv-c' + (isReply ? ' reply' : '') + (a.pend ? ' pend' : '') + (a.by.r === 't' ? ' by-t' : '');
        li.dataset.aid = a.id;
        const head = document.createElement('div'); head.className = 'mv-c-h';
        if (!isReply && nums.has(a.id)) { const n = document.createElement('span'); n.className = 'mv-num'; n.textContent = String(nums.get(a.id)); n.setAttribute('aria-label', 'Pin ' + nums.get(a.id)); head.appendChild(n); }
        if (a.t != null && isVideo()) { const tb = document.createElement('button'); tb.type = 'button'; tb.className = 'mv-at'; tb.dataset.seek = String(a.t); tb.textContent = fmtTime(a.t); tb.setAttribute('aria-label', 'Go to ' + fmtTime(a.t)); head.appendChild(tb); }
        const who = document.createElement('b'); who.textContent = a.mine ? 'You' : a.by.n; head.appendChild(who);
        if (a.by.r === 't') { const t = document.createElement('span'); t.className = 'mv-badge'; t.textContent = 'Teacher'; head.appendChild(t); }
        if (a.pend) { const t = document.createElement('span'); t.className = 'mv-badge warn'; t.textContent = teacher ? 'Waiting for you' : 'Waiting for your teacher'; head.appendChild(t); }
        li.appendChild(head);
        const txt = document.createElement('div'); txt.className = 'mv-c-t'; txt.textContent = a.text; li.appendChild(txt);
        const acts = document.createElement('div'); acts.className = 'mv-c-a';
        const btn = (act, label, iconName, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm' + (cls ? ' ' + cls : ''); b.dataset.mv = act; b.dataset.aid = a.id; b.innerHTML = ic(iconName, 'sm') + '<span></span>'; b.querySelector('span').textContent = label; acts.appendChild(b); };
        if (!isReply && canAdd) btn('reply', 'Reply', 'comment');
        if (teacher && a.pend) btn('approve', 'Approve', 'check');
        if (teacher || a.mine) btn('del', 'Delete', 'trash', 'danger');
        if (acts.children.length) li.appendChild(acts);
        return li;
      };
      top.forEach(a => {
        thread.appendChild(entry(a, false));
        kids.filter(k => k.re === a.id).sort((x, y) => x.ts - y.ts).forEach(k => thread.appendChild(entry(k, true)));
      });
      // the teacher also sees (and can remove) callouts and hotspots
      if (teacher) {
        const extra = annos.filter(a => a.k === 'callout' || a.k === 'hotspot').sort((a, b) => (a.t || 0) - (b.t || 0) || a.ts - b.ts);
        if (extra.length) {
          const h = document.createElement('li'); h.className = 'mv-sec'; h.textContent = isVideo() ? 'Callouts and hotspots on the video' : 'Callouts and hotspots on the picture'; thread.appendChild(h);
          extra.forEach(a => {
            const li = document.createElement('li'); li.className = 'mv-c mv-x'; li.dataset.aid = a.id;
            const head = document.createElement('div'); head.className = 'mv-c-h';
            const k = document.createElement('span'); k.className = 'mv-badge'; k.textContent = a.k === 'callout' ? 'Callout' : (a.pause ? 'Hotspot · pauses' : 'Hotspot'); head.appendChild(k);
            if (a.t != null && isVideo()) { const tb = document.createElement('button'); tb.type = 'button'; tb.className = 'mv-at'; tb.dataset.seek = String(a.t); tb.textContent = fmtTime(a.t) + (a.t2 != null ? '–' + fmtTime(a.t2) : ''); head.appendChild(tb); }
            li.appendChild(head);
            const txt = document.createElement('div'); txt.className = 'mv-c-t'; txt.textContent = a.text; li.appendChild(txt);
            const acts = document.createElement('div'); acts.className = 'mv-c-a';
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm danger'; b.dataset.mv = 'del'; b.dataset.aid = a.id; b.innerHTML = ic('trash', 'sm') + '<span>Delete</span>'; acts.appendChild(b);
            li.appendChild(acts); thread.appendChild(li);
          });
        }
      }
      const inkN = annos.filter(a => a.k === 'ink').length;
      if (inkN && !isLink()) { const li = document.createElement('li'); li.className = 'mv-sec muted'; li.textContent = inkN === 1 ? '1 drawing on the ' + (isVideo() ? 'video' : 'picture') : inkN + ' drawings on the ' + (isVideo() ? 'video' : 'picture'); thread.appendChild(li); }
    }

    /* ---- tools ---- */
    function renderTools() {
      const list = ['view', 'pin', 'pen', 'hl', 'arrow'].concat(teacher ? ['callout', 'hotspot'] : []);
      const drawingTool = ['pen', 'hl', 'arrow'].includes(mode);
      tools.innerHTML = list.map(t => `<button type="button" class="mv-tool" data-tool="${t}" aria-pressed="${mode === t}" title="${TOOL_INFO[t][1]}">${ic(TOOL_INFO[t][0], 'sm')}<span>${TOOL_INFO[t][1]}</span></button>`).join('')
        + `<span class="mv-sw" ${drawingTool ? '' : 'hidden'} role="group" aria-label="Colour">${COLORS.map(([c, n]) => `<button type="button" class="mv-swatch" data-color="${c}" aria-label="${n}" aria-pressed="${c === color}" style="background:${c}"></button>`).join('')}</span>`
        + `<span class="grow"></span><button type="button" class="mv-tool" data-mv="undo" title="Remove my last annotation">${ic('undo', 'sm')}<span>Undo mine</span></button>`
        + (teacher ? `<button type="button" class="mv-tool danger" data-mv="clear-ink" title="Remove all drawings">${ic('eraser', 'sm')}<span>Clear drawings</span></button>` : '');
      const active = !isLink() && canAdd && mode !== 'view';
      capture.hidden = !active;
      capture.style.cursor = mode === 'pin' || mode === 'callout' || mode === 'hotspot' ? 'crosshair' : (active ? 'crosshair' : '');
      root.classList.toggle('mv-annotating', active);
    }
    function setMode(m) {
      if (!canAdd && m !== 'view') return;
      mode = m; pending = null;
      if (m !== 'view' && player && player.playing()) player.pause();
      hidePop(); renderTools(); renderMarks(true); updateCtx();
      if (m !== 'view') setTimeout(() => capture.focus({ preventScroll: true }), 30);
    }

    /* ---- compose ---- */
    function updateCtx() {
      ctx.textContent = '';
      const chip = (label, act) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip mv-chip'; b.dataset.mv = act; b.innerHTML = '<span></span>' + ic('close', 'sm'); b.querySelector('span').textContent = label; b.setAttribute('aria-label', label + ', remove'); ctx.appendChild(b); };
      if (replyTo) { const a = annos.find(x => x.id === replyTo); if (a) chip('Replying to ' + (a.mine ? 'yourself' : a.by.n), 'no-reply'); else replyTo = null; }
      if (pending && mode === 'pin') chip('Pinned on the ' + (isVideo() ? 'video' : 'picture'), 'no-pin');
      if (isVideo() && !replyTo && attachTime && (now > 0.5 || pending)) chip('At ' + fmtTime(pending && pending.t != null ? pending.t : now), 'no-time');
      ctx.hidden = !ctx.children.length;
      input.placeholder = replyTo ? 'Write a reply…' : (pending ? 'What do you notice here?' : (isVideo() ? 'What do you notice at this moment?' : 'Add a comment…'));
    }
    function post() {
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      if (!canAdd) return;
      const a = { k: 'comment', text, by: { n: me.name, r: me.role, sid: me.sid } };
      if (replyTo) a.re = replyTo;
      else {
        if (pending) { a.x = pending.x; a.y = pending.y; }
        if (isVideo() && attachTime && (now > 0.5 || pending)) a.t = pending && pending.t != null ? pending.t : Math.round(now * 10) / 10;
      }
      if (opts.onAdd) opts.onAdd(a);
      input.value = ''; replyTo = null; pending = null; attachTime = true;
      if (mode === 'pin') setMode('view'); else { renderMarks(true); updateCtx(); }
      U.announce('Comment posted');
    }

    /* ---- placing callouts and hotspots (teacher) ---- */
    function askPlace(kind, at) {
      popFor = null; pop.textContent = ''; pop.hidden = false; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', kind === 'callout' ? 'New callout' : 'New hotspot');
      const left = Math.min(Math.max(at.x, 0.2), 0.8), below = at.y < 0.5;
      pop.style.left = (left * 100) + '%'; pop.style.top = below ? 'calc(' + (at.y * 100) + '% + 20px)' : ''; pop.style.bottom = below ? '' : 'calc(' + ((1 - at.y) * 100) + '% + 20px)';
      const f = document.createElement('div'); f.className = 'mv-place stack';
      f.innerHTML = `<label class="mv-place-l"></label><textarea class="textarea" rows="2" maxlength="${LIMITS.text}"></textarea>`
        + (isVideo() ? `<label class="mv-place-l">Show for <select class="select mv-dur"><option value="5">5 seconds</option><option value="10" selected>10 seconds</option><option value="20">20 seconds</option><option value="60">1 minute</option><option value="0">The rest of the video</option></select></label>` : '')
        + (kind === 'hotspot' && isVideo() ? `<label class="check-row"><input type="checkbox" class="mv-pause" checked> Pause the video here for students</label>` : '')
        + `<div class="row" style="gap:8px;justify-content:flex-end"><button type="button" class="btn btn-secondary btn-sm" data-pl="cancel">Cancel</button><button type="button" class="btn btn-primary btn-sm" data-pl="add">Add</button></div>`;
      f.querySelector('.mv-place-l').textContent = kind === 'callout' ? 'Callout text' : 'What students see when they tap it';
      pop.appendChild(f);
      const ta = f.querySelector('textarea');
      f.querySelector('.mv-place-l').htmlFor = ta.id = 'mv-pl-' + genId().slice(0, 6);
      setTimeout(() => ta.focus(), 20);
      const done = (ok) => {
        if (ok) {
          const text = ta.value.trim(); if (!text) { ta.focus(); return; }
          const a = { k: kind, text, x: at.x, y: at.y, by: { n: me.name, r: 't', sid: me.sid } };
          if (isVideo()) { a.t = Math.round((at.t != null ? at.t : now) * 10) / 10; const dur = +f.querySelector('.mv-dur').value; a.t2 = dur ? a.t + dur : Math.max(a.t + 1, (player && player.duration()) || a.t + 3600); }
          if (kind === 'hotspot') { a.rad = 0.05; if (isVideo() && f.querySelector('.mv-pause').checked) a.pause = true; }
          if (opts.onAdd) opts.onAdd(a);
        }
        pop.hidden = true; pop.textContent = ''; pending = null; renderMarks(true);
        capture.focus({ preventScroll: true });
      };
      f.addEventListener('click', e => { const b = e.target.closest('[data-pl]'); if (b) done(b.dataset.pl === 'add'); });
      f.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(true); } });
    }

    /* ---- pointer input on the stage ---- */
    function rel(e) { const r = stage.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1))), y: Math.max(0, Math.min(1, (e.clientY - r.top) / (r.height || 1))) }; }
    function place(at) {
      if (mode === 'pin') { pending = { x: at.x, y: at.y, t: isVideo() ? Math.round(now * 10) / 10 : null }; replyTo = null; renderMarks(true); updateCtx(); input.focus({ preventScroll: true }); }
      else if (mode === 'callout' || mode === 'hotspot') { pending = { x: at.x, y: at.y }; renderMarks(true); askPlace(mode, { x: at.x, y: at.y, t: now }); }
    }
    capture.addEventListener('pointerdown', e => {
      if (!canAdd || e.button > 0) return;
      e.preventDefault();
      const at = rel(e);
      if (['pen', 'hl', 'arrow'].includes(mode)) {
        drawing = { k: 'ink', tool: mode, c: color, w: mode === 'hl' ? 0.008 : 0.005, pts: [[at.x, at.y]] };
        try { capture.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else place(at);
    });
    capture.addEventListener('pointermove', e => {
      if (!drawing) return;
      const at = rel(e), last = drawing.pts[drawing.pts.length - 1];
      if (Math.abs(at.x - last[0]) + Math.abs(at.y - last[1]) < 0.003) return;
      if (drawing.tool === 'arrow') drawing.pts = [drawing.pts[0], [at.x, at.y]];
      else if (drawing.pts.length < LIMITS.pts) drawing.pts.push([at.x, at.y]);
      renderInk();
    });
    const endDraw = () => {
      if (!drawing) return;
      const d = drawing; drawing = null;
      if (d.pts.length >= 2) {
        const a = { k: 'ink', tool: d.tool, c: d.c, w: d.w, pts: simplify(d.pts), by: { n: me.name, r: me.role, sid: me.sid } };
        if (isVideo()) { a.t = Math.round(now * 10) / 10; a.t2 = a.t + SPAN.ink; }
        if (opts.onAdd) opts.onAdd(a);
      }
      renderInk();
    };
    capture.addEventListener('pointerup', endDraw);
    capture.addEventListener('pointercancel', endDraw);
    capture.addEventListener('keydown', e => {
      if (!['pin', 'callout', 'hotspot'].includes(mode)) { if (e.key === 'Escape') { e.stopPropagation(); setMode('view'); } return; }
      const step = e.shiftKey ? 0.1 : 0.02;
      const p = pending || { x: 0.5, y: 0.5 };
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        pending = { x: Math.max(0, Math.min(1, p.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0))), y: Math.max(0, Math.min(1, p.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0))) };
        renderMarks(true);
      } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const at = pending || { x: 0.5, y: 0.5 }; pending = null; place(at); }
      else if (e.key === 'Escape') { e.stopPropagation(); setMode('view'); }
    });
    // a keyboard user gets a crosshair to move with the arrow keys (not shown when focus follows a click or a tap)
    capture.addEventListener('focus', () => { let kb = false; try { kb = capture.matches(':focus-visible'); } catch (e) { kb = false; } if (kb && ['pin', 'callout', 'hotspot'].includes(mode) && !pending) { pending = { x: 0.5, y: 0.5 }; renderMarks(true); } });

    /** Fewer points for long strokes (keeps the shape: drops points closer than ~0.4% of the picture to the last kept one). */
    function simplify(pts) {
      if (pts.length < 3) return pts;
      const out = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) { const l = out[out.length - 1]; if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= 0.004) out.push(pts[i]); }
      out.push(pts[pts.length - 1]);
      return out.slice(0, LIMITS.pts);
    }

    /* ---- clicks ---- */
    root.addEventListener('click', e => {
      const tool = e.target.closest('[data-tool]'); if (tool) { setMode(tool.dataset.tool === mode && mode !== 'view' ? 'view' : tool.dataset.tool); return; }
      const sw = e.target.closest('[data-color]'); if (sw) { color = sw.dataset.color; renderTools(); return; }
      const seek = e.target.closest('[data-seek]');
      if (seek && player) { player.seek(+seek.dataset.seek); const a = annos.find(x => x.id === seek.dataset.aid); if (a && a.k === 'hotspot') revealed.add(a.id); return; }
      if (seek && !player && isVideo()) { const c = media.querySelector('.mv-cover'); if (c) c.click(); return; }
      const mk = e.target.closest('.mv-marks [data-aid]');
      if (mk) {
        const a = annos.find(x => x.id === mk.dataset.aid); if (!a) return;
        if (a.k === 'hotspot' || a.k === 'callout') { if (popFor === a.id) hidePop(); else { revealed.add(a.id); showPop(a, mk); renderTimeline(); } return; }
        const li = thread.querySelector('[data-aid="' + a.id + '"]');
        if (li) { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1200); }
        return;
      }
      const b = e.target.closest('[data-mv]'); if (!b) return;
      const act = b.dataset.mv, aid = b.dataset.aid;
      if (act === 'post') post();
      else if (act === 'pp' && player) { if (player.playing()) player.pause(); else player.play(); }
      else if (act === 'pp' && !player) { const c = media.querySelector('.mv-cover'); if (c) c.click(); }
      else if (act === 'reply') { replyTo = aid; pending = null; updateCtx(); input.focus(); }
      else if (act === 'no-reply') { replyTo = null; updateCtx(); input.focus(); }
      else if (act === 'no-pin') { pending = null; renderMarks(true); updateCtx(); input.focus(); }
      else if (act === 'no-time') { attachTime = false; updateCtx(); input.focus(); }
      else if (act === 'del' && opts.onDelete) opts.onDelete([aid]);
      else if (act === 'approve' && opts.onApprove) opts.onApprove(aid);
      else if (act === 'undo' && opts.onDelete) {
        const mine = annos.filter(a => (teacher ? a.by.r === 't' && (!a.by.sid || a.by.sid === me.sid) : a.mine)).sort((a, b) => b.ts - a.ts)[0];
        if (mine) opts.onDelete([mine.id]); else U.Toast.info('Nothing of yours to remove here.');
      } else if (act === 'clear-ink' && opts.onDelete) {
        const ids = annos.filter(a => a.k === 'ink').map(a => a.id);
        if (!ids.length) { U.Toast.info('There are no drawings to clear.'); return; }
        U.Dialog.confirm({ title: 'Clear all drawings?', message: 'Every drawing on this ' + (isVideo() ? 'video' : 'picture') + ' is removed, students’ too. Comments stay.', confirmLabel: 'Clear drawings', danger: true, icon: 'eraser' }).then(ok => { if (ok) opts.onDelete(ids); });
      }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } else if (e.key === 'Escape' && (replyTo || pending)) { e.stopPropagation(); replyTo = null; pending = null; renderMarks(true); updateCtx(); } });

    if (global.ResizeObserver) { ro = new ResizeObserver(() => fit()); ro.observe(box); }
    else global.addEventListener('resize', fit);

    function setCanAdd(v, why) {
      canAdd = !!v; notice = why || '';
      noticeEl.hidden = !notice; noticeEl.textContent = notice;
      root.querySelector('.mv-compose').hidden = !canAdd;
      if (!canAdd) mode = 'view';
      tools.hidden = isLink() || !canAdd;
      renderTools(); renderThread();
    }

    const api = {
      el: root,
      player: () => player,
      setItem(it) {
        const sameMedia = item && it && item.id === it.id && item.kind === it.kind && item.src === it.src && JSON.stringify(item.video || null) === JSON.stringify(it.video || null);
        item = Object.assign({}, it);
        root.dataset.kind = item.kind;
        if (!sameMedia) mountMedia();
        renderTools(); renderThread(); renderTimeline(); renderMarks(true); renderInk(); updateCtx();
      },
      setAnnos(list) {
        annos = Array.isArray(list) ? list.slice() : [];
        if (replyTo && !annos.some(a => a.id === replyTo)) replyTo = null;
        if (popFor && !annos.some(a => a.id === popFor)) hidePop();
        renderThread(); renderTimeline(); renderMarks(true); renderInk(); updateCtx();
      },
      setCanAdd,
      /** Focus somewhere useful that does not open the on-screen keyboard: the play cover, the first tool, or the link. */
      focus() { const f = isLink() ? (linkCard.querySelector('a') || input) : (media.querySelector('.mv-cover') || tools.querySelector('.mv-tool') || input); try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } },
      destroy() {
        if (destroyed) return; destroyed = true;
        if (player) player.destroy();
        if (ro) ro.disconnect(); else global.removeEventListener('resize', fit);
        root.remove();
      }
    };
    if (opts.item) api.setItem(opts.item);
    setCanAdd(canAdd, notice);
    api.setAnnos(opts.annos || []);
    return api;
  }

  global.DQBMedia = {
    parseVideo, cleanVideo, watchUrl, embedUrl, providerName, fmtTime, parseTime,
    cleanAnno, cleanAnnos, visibleTo, counts, LIMITS, SPAN, KINDS,
    encodeImage, makePlayer, Viewer
  };
})(window);
