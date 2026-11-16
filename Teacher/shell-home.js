/* ==========================================================================
   InquiryDQB Teacher — boards home (saved boards, templates, import)
   ========================================================================== */
(function () {
  'use strict';
  const { Toast, Theme, Overlay } = DQBUI;
  const esc = DQBUI.esc, ic = icon;
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / 86400); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
  }
  const THEME_ICON = { auto: 'monitor', light: 'sun', dark: 'moon' };

  Shell.Home = {
    boards: [],
    init() {
      on($('btn-new-board'), 'click', () => Board.create());
      on($('btn-import'), 'click', () => $('file-up').click());
      on($('file-up'), 'change', e => Board.import(e.target));
      on($('btn-join-cohost'), 'click', () => Shell.Join.open());
      Shell.Home.brand();
      const t = $('home-theme');
      const upd = () => { const v = Theme.get(); t.innerHTML = ic(THEME_ICON[v]); t.setAttribute('aria-label', `Theme: ${v}. Change theme`); };
      on(t, 'click', () => { const order = ['auto', 'light', 'dark']; const nx = order[(order.indexOf(Theme.get()) + 1) % 3]; Theme.set(nx); upd(); Toast.show(`Theme: ${nx === 'auto' ? 'match device' : nx}`); });
      upd();
    },
    /** A host's name and a way back to it (DQB_HOST.brand = {name, sub, homeUrl, homeLabel}). */
    brand() {
      const b = DQBUI.host().brand; if (!b || typeof b !== 'object') return;
      const sub = document.querySelector('.home-head .brand-sub'); if (sub && b.sub) sub.textContent = String(b.sub);
      const url = typeof b.homeUrl === 'string' && /^(\/(?!\/)|https?:\/\/)/.test(b.homeUrl) ? b.homeUrl : '';
      if (!url) return;
      const row = document.querySelector('.home-head .row'); if (!row || row.querySelector('.host-home')) return;
      const a = document.createElement('a'); a.className = 'btn btn-ghost btn-sm host-home'; a.href = url;
      a.innerHTML = ic('back', 'sm'); const span = document.createElement('span'); span.textContent = String(b.homeLabel || b.name || 'Back'); a.appendChild(span);
      row.insertBefore(a, row.firstChild);
      const note = document.querySelector('.home-note'); if (note && Board.cloud()) { note.textContent = ''; note.innerHTML = ic('shield', 'sm'); note.appendChild(document.createTextNode(' Boards are saved to ' + (DQBUI.host().storage.label || 'your account') + ' and kept on this device too, so they open without a connection.')); }
    },
    /** Boards on this device, merged with the boards in the host account (newest copy wins). */
    async boardList() {
      const local = (await DB.getAll('boards')).filter(b => b && DQBUI.safeId(String(b.id))).map(b => ({ ...b, where: 'device' }));
      const cloud = Board.cloud();
      Shell.Home.cloudError = false;
      if (!cloud || typeof cloud.list !== 'function') return local;
      let remote = null;
      try { remote = await Board.within(cloud.list(), 8000); } catch (e) { remote = null; }
      if (!Array.isArray(remote)) { Shell.Home.cloudError = true; return local; }
      const byId = new Map(local.map(b => [b.id, b]));
      remote.forEach(r => {
        const id = r && DQBUI.safeId(String(r.id)); if (!id) return;
        const ts = Number(r.ts) || 0, preview = Array.isArray(r.preview) ? r.preview : [];
        const l = byId.get(id);
        if (!l) { byId.set(id, { id, name: DQBUI.clampStr(r.name || 'Untitled board', 60), ts, items: preview, ink: [], notes: Number(r.notes) || 0, where: 'account' }); return; }
        l.where = 'both';
        if (ts > (Number(l.ts) || 0)) { l.name = DQBUI.clampStr(r.name || l.name, 60); l.ts = ts; l.items = preview; l.ink = []; l.notes = Number(r.notes) || 0; l.newerInAccount = true; }
      });
      return [...byId.values()];
    },
    /** The whole board (from this device, or from the account when it is newer or only there). */
    async full(b) {
      const cloud = Board.cloud();
      if (cloud && (b.where === 'account' || b.newerInAccount)) {
        const r = await Board.within(cloud.load(b.id), 10000);
        if (r && Array.isArray(r.items)) return { id: b.id, name: r.name || b.name, items: r.items, ink: Array.isArray(r.ink) ? r.ink : [], view: r.view, ts: Number(r.ts) || Date.now() };
      }
      return (await DB.getAll('boards')).find(x => x.id === b.id) || null;
    },
    async render() {
      const grid = $('saved-list'), tpl = $('tpl-quick');
      if (!grid) return;
      if (!tpl.dataset.built) {
        tpl.dataset.built = '1';
        tpl.innerHTML = `<button type="button" class="tpl-card" data-tpl="-1"><canvas></canvas><span class="tn">Blank board</span></button>` + SYSTEM_TEMPLATES.map((t, i) => `<button type="button" class="tpl-card" data-tpl="${i}"><canvas></canvas><span class="tn">${esc(t.name)}</span></button>`).join('');
        tpl.querySelectorAll('canvas').forEach((c, i) => { if (i === 0) { const ctx = (c.width = 300, c.height = 188, c.getContext('2d')); ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(150, 74); ctx.lineTo(150, 114); ctx.moveTo(130, 94); ctx.lineTo(170, 94); ctx.stroke(); } else Shell.drawThumb(c, SYSTEM_TEMPLATES[i - 1].items, []); });
        on(tpl, 'click', e => { const b = e.target.closest('[data-tpl]'); if (!b) return; const i = +b.dataset.tpl; Board.create(i < 0 ? null : SYSTEM_TEMPLATES[i]); });
      }
      const boards = (await Shell.Home.boardList()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      Shell.Home.boards = boards;
      const cloud = Board.cloud(), label = cloud ? (DQBUI.host().storage.label || 'your account') : '';
      const warn = Shell.Home.cloudError ? `<div class="board-warn card">${ic('wifi-off', 'sm')}<span>Couldn’t reach ${esc(label)}. Showing the boards saved on this device.</span></div>` : '';
      if (!boards.length) {
        grid.innerHTML = warn + `<div class="board-empty card empty"><div class="em-ico">${ic('folder', 'lg')}</div><div class="em-t">No saved boards yet</div><div>${cloud ? `Create a board above — it saves automatically to ${esc(label)}.` : (DB.ok ? 'Create a board above — it saves automatically on this device.' : 'Your browser is blocking local storage, so boards can’t be saved here. You can still run sessions and export boards.')}</div></div>`;
        return;
      }
      const whereTag = (b) => !cloud || Shell.Home.cloudError ? '' : (b.where === 'device' ? ` · <span class="where" title="Not in ${esc(label)} yet: it is sent when you open it">this device only</span>` : '');
      grid.innerHTML = warn + boards.map(b => {
        const n = b.where === 'account' || b.newerInAccount ? (Number(b.notes) || 0) : (b.items || []).filter(i => i.type === 'note').length;   // account previews carry a count, not the notes
        return `<div class="board-card" data-id="${esc(b.id)}"><canvas class="thumb" aria-hidden="true"></canvas><div class="meta"><div class="grow" style="min-width:0"><div class="bn truncate">${esc(b.name || 'Untitled board')}</div><div class="bs">${n} note${n === 1 ? '' : 's'} · ${esc(ago(b.ts || 0))}${whereTag(b)}</div></div><button type="button" class="icon-btn" data-menu aria-label="Board options for ${esc(b.name || 'board')}">${ic('more')}</button></div><button type="button" class="board-open" data-open aria-label="Open ${esc(b.name || 'board')}"></button></div>`;
      }).join('');
      grid.querySelectorAll('.board-card').forEach((card, i) => {
        const b = boards[i];
        Shell.drawThumb(card.querySelector('canvas'), b.items, b.ink);
        on(card.querySelector('[data-open]'), 'click', () => Board.load(b.id));
        on(card.querySelector('[data-menu]'), 'click', ev => { ev.stopPropagation(); DQBUI.Menu.open({ anchor: ev.currentTarget, align: 'end', title: b.name || 'Board', items: [
          { label: 'Open', icon: 'folder', onClick: () => Board.load(b.id) },
          { label: 'Rename', icon: 'pencil', onClick: () => Shell.Home.rename(b) },
          { label: 'Duplicate', icon: 'copy', onClick: () => Shell.Home.duplicate(b) },
          { label: 'Download file', icon: 'download', onClick: () => Shell.Home.download(b) },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => Shell.Home.remove(b) }] }); });
      });
    },
    async rename(b) {
      const name = await DQBUI.Dialog.prompt({ title: 'Rename board', value: b.name, confirmLabel: 'Rename', maxLength: 60 });
      if (!name) return;
      const clean = DQBUI.clampStr(name, 60), cloud = Board.cloud();
      try {
        if (b.where !== 'account') { const full = (await DB.getAll('boards')).find(x => x.id === b.id); if (full) await DB._put('boards', { ...full, name: clean }); }
        if (cloud && b.where !== 'device' && typeof cloud.rename === 'function') await Board.within(cloud.rename(b.id, clean), 10000);
      } catch (e) { Toast.error('Couldn’t rename the board'); }
      Shell.Home.render();
    },
    async duplicate(b) {
      try {
        const full = await Shell.Home.full(b); if (!full) throw new Error('missing');
        const copy = { ...full, id: DQBUI.genId(), name: DQBUI.clampStr((full.name || 'Board') + ' (copy)', 60), ts: Date.now() };
        await DB._put('boards', copy).catch(() => {});
        const cloud = Board.cloud(); if (cloud) await Board.within(cloud.save(copy), 15000);
        Toast.success('Board duplicated');
      } catch (e) { Toast.error('Couldn’t duplicate the board'); }
      Shell.Home.render();
    },
    async download(b) {
      let full = null; try { full = await Shell.Home.full(b); } catch (e) { full = null; }
      if (!full) { Toast.error('Couldn’t load that board to download it'); return; }
      const blob = new Blob([JSON.stringify({ app: 'InquiryDQB', version: 2, name: full.name, items: full.items, ink: full.ink || [], view: full.view }, null, 2)], { type: 'application/json' });
      Board._download(blob, `${(full.name || 'board').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.json`);
    },
    async remove(b) {
      const cloud = Board.cloud(), label = cloud ? (DQBUI.host().storage.label || 'your account') : '';
      const ok = await DQBUI.Dialog.confirm({ title: `Delete “${b.name || 'this board'}”?`, message: cloud ? `This removes the board from ${label} and from this device. Download a copy first if you might need it again.` : 'This removes the board from this device. Download a copy first if you might need it again.', confirmLabel: 'Delete board', danger: true });
      if (!ok) return;
      try {
        await DB.remove('boards', b.id);
        if (cloud && typeof cloud.remove === 'function' && b.where !== 'device') await Board.within(cloud.remove(b.id), 10000);
        Toast.show('Board deleted');
      } catch (e) { Toast.error('Couldn’t delete the board everywhere. Try again when you are online.'); }
      if (localStorage.getItem(Board.lastKey()) === b.id) localStorage.removeItem(Board.lastKey());
      Shell.Home.render();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Shell.init); else Shell.init();
})();
