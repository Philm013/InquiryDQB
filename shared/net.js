/* ==========================================================================
   InquiryDQB networking helpers shared by Teacher and Student.
   - Short, human friendly join codes (instead of 36 character PeerJS UUIDs)
   - Join links / QR payloads that open the Student app pre-filled
   - Optional self-hosted PeerServer (?peerHost=...&peerPort=...&peerPath=...&peerSecure=0|1)
   - Friendly explanations for PeerJS errors
   ========================================================================== */
(function (global) {
  'use strict';
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1 — easy to read aloud and type
  var PREFIX = 'dqb-';
  var LS_PEER = 'dqb_peer';

  function genCode(len) {
    len = len || 6;
    var out = '';
    var buf = new Uint32Array(len);
    (global.crypto || global.msCrypto).getRandomValues(buf);
    for (var i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  }
  function codeToPeerId(code) { return PREFIX + String(code).toUpperCase(); }
  function peerIdToCode(id) { return (typeof id === 'string' && id.indexOf(PREFIX) === 0) ? id.slice(PREFIX.length) : null; }
  /** "ABC123" -> "ABC-123" */
  function formatCode(code) { code = String(code || ''); return code.length === 6 ? code.slice(0, 3) + '-' + code.slice(3) : code; }

  /**
   * Accepts whatever a student types, pastes or scans:
   *   "abc 123", "ABC-123", "dqb-ABC123", "https://…/Student/?join=ABC123", or a legacy 36 char id.
   * Returns { peerId, code } or null.
   */
  function parseJoinInput(input) {
    if (input == null) return null;
    var s = String(input).trim();
    if (!s) return null;
    // URL / query string
    if (/^https?:\/\//i.test(s) || s.indexOf('join=') > -1) {
      try {
        var u = new URL(s, global.location.href);
        var j = u.searchParams.get('join');
        if (!j && u.hash) j = new URLSearchParams(u.hash.replace(/^#/, '')).get('join');
        if (j) s = j; else return null;
      } catch (e) { var m = s.match(/join=([A-Za-z0-9_-]+)/); if (m) s = m[1]; else return null; }
    }
    // legacy PeerJS ids (uuid-like) keep their case
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { peerId: s, code: null };
    var compact = s.replace(/^dqb-/i, '').replace(/[\s-]+/g, '').toUpperCase();
    if (/^[A-Z0-9]{4,12}$/.test(compact)) return { peerId: codeToPeerId(compact), code: compact };
    return null;
  }

  /** Co-host codes look like ABC123.K7Q2X9R4 (join code + secret key); also accepts ?cohost= links. */
  function parseCohostInput(input) {
    if (input == null) return null;
    var s = String(input).trim();
    if (/^https?:\/\//i.test(s) || s.indexOf('cohost=') > -1) {
      try { var u = new URL(s, global.location.href); s = u.searchParams.get('cohost') || ''; } catch (e) { var m = s.match(/cohost=([A-Za-z0-9.]+)/); s = m ? m[1] : ''; }
    }
    var parts = s.toUpperCase().replace(/[\s-]+/g, '').split('.');
    if (parts.length !== 2 || !/^[A-Z0-9]{4,12}$/.test(parts[0]) || !/^[A-Z0-9]{4,16}$/.test(parts[1])) return null;
    return { code: parts[0], key: parts[1] };
  }
  /** Reads a custom PeerServer config from window.DQB_PEER_OPTS, the URL, or localStorage. */
  function peerOptions() {
    if (global.DQB_PEER_OPTS) return global.DQB_PEER_OPTS;
    var o = null;
    try {
      var p = new URLSearchParams(global.location.search);
      if (p.get('peerHost')) {
        o = { host: p.get('peerHost'), port: parseInt(p.get('peerPort') || '443', 10), path: p.get('peerPath') || '/', secure: p.get('peerSecure') !== '0' };
        try { localStorage.setItem(LS_PEER, JSON.stringify(o)); } catch (e) { /* ignore */ }
      } else if (p.get('peerReset') === '1') {
        try { localStorage.removeItem(LS_PEER); } catch (e) { /* ignore */ }
      } else {
        var raw = null; try { raw = localStorage.getItem(LS_PEER); } catch (e) { /* ignore */ }
        if (raw) o = JSON.parse(raw);
      }
    } catch (e) { o = null; }
    return o;
  }
  function newPeer(id) {
    var o = peerOptions();
    return id ? (o ? new global.Peer(id, o) : new global.Peer(id)) : (o ? new global.Peer(o) : new global.Peer());
  }
  /** Absolute URL of the Student app pre-filled with a join code (and custom peer server, if any). */
  function joinUrl(code, studentBase) {
    var base = studentBase || new URL('../Student/', global.location.href).href;
    var u = new URL(base);
    u.searchParams.set('join', code);
    var o = peerOptions();
    if (o && o.host) { u.searchParams.set('peerHost', o.host); u.searchParams.set('peerPort', o.port); u.searchParams.set('peerPath', o.path); u.searchParams.set('peerSecure', o.secure ? '1' : '0'); }
    return u.href;
  }
  var AVATARS = ['😀', '😎', '🦊', '🐱', '🚀', '🎨', '⚽', '🦄', '🍔', '🧩', '🐼', '🌈', '🎸', '🐙', '🦖', '⭐'];
  function explainPeerError(err) {
    var t = err && err.type;
    switch (t) {
      case 'network': case 'socket-error': case 'socket-closed': case 'server-error':
        return { title: 'Can’t reach the connection service', msg: 'Check the internet connection. School networks sometimes block the service — try another network or ask your IT team to allow WebRTC and wss://0.peerjs.com.' };
      case 'peer-unavailable':
        return { title: 'Class not found', msg: 'That code isn’t active. Check the code with your teacher and make sure their board is open.' };
      case 'unavailable-id':
        return { title: 'Code already in use', msg: 'That code is taken. A new one will be generated.' };
      case 'browser-incompatible':
        return { title: 'Browser not supported', msg: 'This browser can’t make peer-to-peer connections. Try an up-to-date Chrome, Edge, Safari or Firefox.' };
      case 'webrtc':
        return { title: 'Connection failed', msg: 'A direct connection could not be made. Some networks block peer-to-peer traffic; try another network.' };
      case 'disconnected':
        return { title: 'Disconnected', msg: 'Lost the connection to the service. Reconnecting…' };
      default:
        return { title: 'Connection problem', msg: (err && err.message) ? String(err.message) : 'Something went wrong with the connection.' };
    }
  }
  /** Exponential back-off with jitter: 1s, 2s, 4s … capped at 15s. */
  function backoff(attempt) { var base = Math.min(15000, 1000 * Math.pow(2, Math.max(0, attempt))); return base / 2 + Math.random() * base / 2; }

  global.Net = {
    ALPHABET: ALPHABET, PREFIX: PREFIX, genCode: genCode, codeToPeerId: codeToPeerId, peerIdToCode: peerIdToCode,
    formatCode: formatCode, parseJoinInput: parseJoinInput, parseCohostInput: parseCohostInput, AVATARS: AVATARS, peerOptions: peerOptions, newPeer: newPeer, joinUrl: joinUrl,
    explainPeerError: explainPeerError, backoff: backoff
  };
})(window);
