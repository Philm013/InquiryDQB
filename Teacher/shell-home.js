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
      const t = $('home-theme');
      const upd = () => { const v = Theme.get(); t.innerHTML = ic(THEME_ICON[v]); t.setAttribute('aria-label', `Theme: ${v}. Change theme`); };
      on(t, 'click', () => { const order = ['auto', 'light', 'dark']; const nx = order[(order.indexOf(Theme.get()) + 1) % 3]; Theme.set(nx); upd(); Toast.show(`Theme: ${nx === 'auto' ? 'match device' : nx}`); });
      upd();
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
      const boards = (await DB.getAll('boards')).filter(b => b && b.id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      Shell.Home.boards = boards;
      if (!boards.length) {
        grid.innerHTML = `<div class="board-empty card empty"><div class="em-ico">${ic('folder', 'lg')}</div><div class="em-t">No saved boards yet</div><div>${DB.ok ? 'Create a board above — it saves automatically on this device.' : 'Your browser is blocking local storage, so boards can’t be saved here. You can still run sessions and export boards.'}</div></div>`;
        return;
      }
      grid.innerHTML = boards.map(b => {
        const n = (b.items || []).filter(i => i.type === 'note').length;
        return `<div class="board-card" data-id="${esc(b.id)}"><canvas class="thumb" aria-hidden="true"></canvas><div class="meta"><div class="grow" style="min-width:0"><div class="bn truncate">${esc(b.name || 'Untitled board')}</div><div class="bs">${n} note${n === 1 ? '' : 's'} · ${esc(ago(b.ts || 0))}</div></div><button type="button" class="icon-btn" data-menu aria-label="Board options for ${esc(b.name || 'board')}">${ic('more')}</button></div><button type="button" class="board-open" data-open aria-label="Open ${esc(b.name || 'board')}"></button></div>`;
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
      try { await DB._put('boards', { ...b, name: DQBUI.clampStr(name, 60) }); } catch (e) { Toast.error('Couldn’t rename the board'); }
      Shell.Home.render();
    },
    async duplicate(b) {
      try { await DB._put('boards', { ...b, id: DQBUI.genId(), name: DQBUI.clampStr((b.name || 'Board') + ' (copy)', 60), ts: Date.now() }); Toast.success('Board duplicated'); } catch (e) { Toast.error('Couldn’t duplicate the board'); }
      Shell.Home.render();
    },
    download(b) {
      const blob = new Blob([JSON.stringify({ app: 'InquiryDQB', version: 2, name: b.name, items: b.items, ink: b.ink || [], view: b.view }, null, 2)], { type: 'application/json' });
      Board._download(blob, `${(b.name || 'board').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.json`);
    },
    async remove(b) {
      const ok = await DQBUI.Dialog.confirm({ title: `Delete “${b.name || 'this board'}”?`, message: 'This removes the board from this device. Download a copy first if you might need it again.', confirmLabel: 'Delete board', danger: true });
      if (!ok) return;
      try { await DB.remove('boards', b.id); Toast.show('Board deleted'); } catch (e) { Toast.error('Couldn’t delete the board'); }
      if (localStorage.getItem('lastBoard') === b.id) localStorage.removeItem('lastBoard');
      Shell.Home.render();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Shell.init); else Shell.init();
})();
