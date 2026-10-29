/* InquiryDQB teacher console — core logic (state, items, network, consensus, breakout).
   UI chrome (panels, flyouts, dialogs, boards home) lives in shell.js. */
const $ = id => document.getElementById(id);
const genId = () => DQBUI.genId();
// esc() escapes quotes too, so it is safe in text *and* attribute contexts.
const sanitizeHTML = DQBUI.esc;
const { esc, safeId, safeColor, safeImg, clampStr } = DQBUI;

/* --- CONSTANTS --- */
window.TYPES = {
    notice: { col: '#fef3c7', bor: '#d97706', icon: '👁️', lbl: 'Notice' },
    wonder: { col: '#bae6fd', bor: '#0284c7', icon: '❓', lbl: 'Wonder' },
    idea:   { col: '#bbf7d0', bor: '#166534', icon: '💡', lbl: 'Idea' },
    test:   { col: '#fecaca', bor: '#dc2626', icon: '🧪', lbl: 'Testable' },
    meta:   { col: '#f8fafc', bor: '#64748b', icon: '📝', lbl: 'Note' },
    sketch: { col: '#ffffff', bor: '#64748b', icon: '✏️', lbl: 'Sketch' },
    claim: { col: '#fffbeb', bor: '#d97706', icon: '🤔', lbl: 'Claim' },
    evidence: { col: '#f0f9ff', bor: '#0284c7', icon: '📊', lbl: 'Evidence' },
    reasoning: { col: '#f0fdf4', bor: '#166534', icon: '🔗', lbl: 'Reasoning' }
};

/* --- STATE & HISTORY --- */
window.State = {
    id: null, name: 'My Board',
    items: [], ink: [], selection: [],
    view: { x: 0, y: 0, z: 1 },
    tool: 'pan', students: {}, drag: null,
    
    // Centralized Activity State
    activity: { type: 'LOCKED', targetId: null, payload: null }, 
    
    // NEW: Consensus Modeling State
    consensusMode: {
        active: false,
        zoneId: null,
        ink: [],
        items: [],
        view: { x: 0, y: 0, z: 1 },
        participants: [], // Array of student peer IDs with drawing permission
        tool: 'pan',
        brush: 'draw',
        title: '',
        color: '#ef4444',
        width: 4
    },
    
    activeSorts: {}, comments: [],
    touch: { dist: 0 },
    draw: { color: '#ef4444', width: 4 },
    isCoHost: false,
    // class rules (persisted per device, not per board)
    settings: { names: true, approve: false },
    pending: [],            // student notes waiting for teacher approval
    votes: {}, blocked: {}, spaceDown: false, multiSelect: false, hasEntered: false,
    muted: {},              // student id (sid) -> true
    timer: { endsAt: 0, running: false, remainingMs: 0, totalMs: 0 }
};

/* --- STATE MANAGER with EVENTS --- */
window.StateManager = {
    _notify: (action, payload) => {
        const event = new CustomEvent('statechange', { detail: { action, payload } });
        window.dispatchEvent(event);
    },
    
    // Full State
    setFullState: (newState, options = { silent: false }) => {
        State.items = newState.items || [];
        State.ink = newState.ink || [];
        if (newState.activity) State.activity = newState.activity;
        if (newState.view) State.view = newState.view;
        if (!options.silent) StateManager._notify('state:fullsync', newState);
    },

    // Items
    addItem: (item, options = { silent: false }) => {
        State.items.push(item);
        if (!options.silent) StateManager._notify('items:add', { items: [item] });
    },
    addItems: (items, options = { silent: false }) => {
        State.items.push(...items);
        if (!options.silent) StateManager._notify('items:add', { items });
    },
    updateItem: (id, props, options = { silent: false }) => {
        const item = State.items.find(i => i.id === id);
        if (item) {
            Object.assign(item, props);
            if (!options.silent) StateManager._notify('items:update', { items: [{ id, ...props }] });
        }
    },
    updateItems: (updates, options = { silent: false }) => { // updates = [{id, props}, ...]
        const updatedItems = [];
        updates.forEach(u => {
            const item = State.items.find(i => i.id === u.id);
            if (item) {
                Object.assign(item, u.props);
                updatedItems.push({id: u.id, ...u.props});
            }
        });
        if (!options.silent && updatedItems.length > 0) StateManager._notify('items:update', { items: updatedItems });
    },
    deleteItems: (ids, options = { silent: false }) => {
        State.items = State.items.filter(i => !ids.includes(i.id));
        State.selection = State.selection.filter(id => !ids.includes(id));
        if (!options.silent) StateManager._notify('items:delete', { ids });
    },

    // Selection
    setSelection: (ids, options = { silent: false }) => {
        State.selection = ids;
        if (!options.silent) StateManager._notify('selection:set', { ids });
    },

    // Ink
    addInk: (inkStroke, options = { silent: false }) => {
        State.ink.push(inkStroke);
        if (!options.silent) StateManager._notify('ink:add', { ink: inkStroke });
    },
    setInk: (inkArray, options = { silent: false }) => {
        State.ink = inkArray;
        if (!options.silent) StateManager._notify('ink:set', { ink: inkArray });
    },
    
    // View
    updateView: (props, options = { silent: false }) => {
        Object.assign(State.view, props);
        if (!options.silent) StateManager._notify('view:update', { view: State.view });
    },
    
    // Activity
    setActivity: (activity, options = { silent: false }) => {
        State.activity = activity;
        if (!options.silent) StateManager._notify('activity:set', { activity });
    }
};

window.addEventListener('statechange', (e) => {
    const { action, payload } = e.detail;

    const dataChangingActions = [
        'items:add', 'items:update', 'items:delete', 
        'ink:add', 'ink:set', 'state:fullsync'
    ];

    if (dataChangingActions.includes(action)) {
        ActionHistory.push();
        Board.save(true);
    }

    // Handle rendering
    if (action.startsWith('items:') || action.startsWith('selection:') || action === 'state:fullsync') {
        Render.all();
        if (action.startsWith('selection:') && window.Shell) Shell.onSelection();
    } else if (action.startsWith('ink:')) {
        Render.ink();
    } else if (action.startsWith('view:')) {
        Render.sync();
    } else if (action === 'activity:set') {
        Render.all();
        UI.updateOpenNotesButton(payload.activity.type === 'OPEN');
    }

    // Handle networking: students never receive board state; co-hosts (and the host, when we are one) do
    if (Network.peer) Network.relay(action, payload);

});


window.ActionHistory = {
    stack: [], index: -1,
    MAX: 40, MAX_CHARS: 24000000,        // cap memory: sketches are stored as data-URIs
    reset: () => { ActionHistory.stack = []; ActionHistory.index = -1; ActionHistory.push(); },
    push: () => {
        const snapshot = JSON.stringify({ items: State.items, ink: State.ink });
        if (ActionHistory.index > -1 && ActionHistory.stack[ActionHistory.index] === snapshot) return;
        ActionHistory.stack = ActionHistory.stack.slice(0, ActionHistory.index + 1);
        ActionHistory.stack.push(snapshot);
        ActionHistory.index = ActionHistory.stack.length - 1;
        let total = ActionHistory.stack.reduce((a, s) => a + s.length, 0);
        while (ActionHistory.stack.length > 1 && (ActionHistory.stack.length > ActionHistory.MAX || total > ActionHistory.MAX_CHARS)) {
            total -= ActionHistory.stack.shift().length; ActionHistory.index--;
        }
        if (window.Shell) Shell.syncHistory();
    },
    canUndo: () => ActionHistory.index > 0,
    canRedo: () => ActionHistory.index < ActionHistory.stack.length - 1,
    undo: () => {
        if (!ActionHistory.canUndo()) return;
        ActionHistory.index--;
        StateManager.setFullState(JSON.parse(ActionHistory.stack[ActionHistory.index]));
        State.selection = State.selection.filter(id => State.items.some(i => i.id === id));
        if (window.Shell) { Shell.syncHistory(); Shell.onSelection(); }
        UI.toast("Undone");
    },
    redo: () => {
        if (!ActionHistory.canRedo()) return;
        ActionHistory.index++;
        StateManager.setFullState(JSON.parse(ActionHistory.stack[ActionHistory.index]));
        State.selection = State.selection.filter(id => State.items.some(i => i.id === id));
        if (window.Shell) { Shell.syncHistory(); Shell.onSelection(); }
        UI.toast("Redone");
    }
};

/* --- AUTO SCROLL SYSTEM --- */
window.AutoScroll = {
    active: false,
    vx: 0, vy: 0,
    margin: 50,
    maxSpeed: 15,
    interval: null,
    lastEvt: null,
    
    start: () => {
        if(AutoScroll.active) return;
        AutoScroll.active = true;
        AutoScroll.loop();
    },
    
    stop: () => {
        AutoScroll.active = false;
        AutoScroll.vx = 0; AutoScroll.vy = 0;
        if(AutoScroll.interval) cancelAnimationFrame(AutoScroll.interval);
        AutoScroll.interval = null;
    },
    
    check: (e) => {
        AutoScroll.lastEvt = e;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const m = AutoScroll.margin;
        
        AutoScroll.vx = 0; 
        AutoScroll.vy = 0;

        const zFactor = Math.max(0.5, State.view.z);

        if (e.clientX < m) {
            const intensity = (m - e.clientX) / m;
            AutoScroll.vx = (AutoScroll.maxSpeed * intensity) / zFactor;
        } else if (e.clientX > w - m) {
            const intensity = (e.clientX - (w - m)) / m;
            AutoScroll.vx = -(AutoScroll.maxSpeed * intensity) / zFactor;
        }
        
        if (e.clientY < m) {
            const intensity = (m - e.clientY) / m;
            AutoScroll.vy = (AutoScroll.maxSpeed * intensity) / zFactor;
        } else if (e.clientY > h - m) {
            const intensity = (e.clientY - (h - m)) / m;
            AutoScroll.vy = -(AutoScroll.maxSpeed * intensity) / zFactor;
        }
    },
    
    loop: () => {
        if (!AutoScroll.active) return;
        
        if (AutoScroll.vx !== 0 || AutoScroll.vy !== 0) {
            StateManager.updateView({ x: State.view.x + AutoScroll.vx, y: State.view.y + AutoScroll.vy });
            
            if (State.drag && State.drag.mode === 'move' && AutoScroll.lastEvt) {
                Modes.Move.move(AutoScroll.lastEvt);
            }
        }
        
        AutoScroll.interval = requestAnimationFrame(AutoScroll.loop);
    }
};

/* --- HIERARCHY & DATA MANAGER --- */
window.HierarchyManager = {
    link: (childId, zoneId, index = -1) => {
        const zone = State.items.find(i => i.id === zoneId);
        const child = State.items.find(i => i.id === childId);
        if (!zone || !child || zone.type !== 'zone') return;

        if (child.parentZone && child.parentZone !== zoneId) {
            HierarchyManager.unlink(child.id);
        }

        if (!zone.children) zone.children = [];
        
        const currentIdx = zone.children.indexOf(childId);
        if (currentIdx > -1) zone.children.splice(currentIdx, 1);

        if (index >= 0 && index <= zone.children.length) {
            zone.children.splice(index, 0, childId);
        } else {
            zone.children.push(childId);
        }
        child.parentZone = zoneId;
        StateManager.updateItems([{id: child.id, props: {parentZone: zoneId}}, {id: zone.id, props: {children: zone.children}}]);
    },

    unlink: (childId) => {
        const child = State.items.find(i => i.id === childId);
        if (!child || !child.parentZone) return;

        const zone = State.items.find(i => i.id === child.parentZone);
        const oldParentZone = child.parentZone;
        delete child.parentZone;

        if (zone && zone.children) {
            zone.children = zone.children.filter(id => id !== childId);
            StateManager.updateItems([{id: childId, props: {parentZone: undefined}}, {id: zone.id, props: {children: zone.children}}]);
        } else {
            StateManager.updateItem(childId, {parentZone: undefined});
        }
    },

    getDescendants: (itemId) => {
        const item = State.items.find(i => i.id === itemId);
        if (!item || item.type !== 'zone' || !item.children) {
            return [];
        }
        let descendants = [...item.children];
        item.children.forEach(childId => {
            descendants.push(...HierarchyManager.getDescendants(childId));
        });
        return descendants;
    },

    delete: (ids) => {
        if (!Array.isArray(ids)) ids = [ids];
        const itemsToDelete = new Set(ids);
        
        ids.forEach(id => {
            const item = State.items.find(i => i.id === id);
            if (item && item.groupId) {
                State.items.forEach(i => {
                    if (i.groupId === item.groupId) itemsToDelete.add(i.id);
                });
            }
        });

        const finalIds = Array.from(itemsToDelete);
        finalIds.forEach(id => {
            const item = State.items.find(i => i.id === id);
            if (!item) return;
            if (item.type === 'zone' && item.children) {
                [...item.children].forEach(cid => HierarchyManager.unlink(cid));
            }
            if (item.parentZone) {
                HierarchyManager.unlink(id);
            }
        });

        StateManager.deleteItems(finalIds);
    }
};


/* --- ROBUST LAYOUT ENGINE --- */
window.LayoutSystem = {
    padding: 20,
    gap: 15,
    headerH: 50,
    
    update: (zoneId, ghostItem = null, ghostIndex = -1) => {
        const zone = State.items.find(i => i.id === zoneId);
        if(!zone || !zone.children) return;

        let items = zone.children
            .map(id => State.items.find(i => i.id === id))
            .filter(i => i); 

        if(ghostItem) {
            items = items.filter(i => i.id !== ghostItem.id);
        }

        if (ghostItem && ghostIndex > -1) {
            if(ghostIndex > items.length) ghostIndex = items.length;
            items.splice(ghostIndex, 0, ghostItem);
        }

        let contentHeight = 0;
        if (zone.zoneType === 'cer') {
            contentHeight = LayoutSystem.layoutColumns(zone, items, 3);
        } else if (zone.zoneType === 'consensus') {
            let maxY = 0;
            items.forEach(item => {
                const bottom = (item.y - zone.y) + item.h;
                if (bottom > maxY) maxY = bottom;
            });
            contentHeight = maxY + LayoutSystem.padding;
        } else {
            contentHeight = LayoutSystem.layoutFlow(zone, items);
        }

        // Type-specific minimum heights: CER/consensus need more room for multi-column layout
        const zoneMinH = { cer: 300, exit: 200, consensus: 300 };
        const minH = zoneMinH[zone.zoneType] || 150;
        // Use zone.h as a floor so zones only expand, never shrink
        const newH = Math.max(minH, zone.h, contentHeight);
        
        if (newH !== zone.h) {
            // Use silent:true to avoid undo history spam and network broadcasts for layout-only changes
            StateManager.updateItem(zone.id, { h: newH }, { silent: true });
        }
    },

    layoutFlow: (zone, items) => {
        const effectiveW = zone.w - (LayoutSystem.padding * 2);
        let x = LayoutSystem.padding;
        let y = LayoutSystem.headerH + (zone.zoneType === 'exit' ? 40 : 0);
        let currentRowH = 0;
        const updates = [];

        items.forEach(item => {
            if (x + item.w > effectiveW + LayoutSystem.padding && x > LayoutSystem.padding) {
                x = LayoutSystem.padding;
                y += currentRowH + LayoutSystem.gap;
                currentRowH = 0;
            }

            const newPos = { x: zone.x + x, y: zone.y + y };
            LayoutSystem.apply(zone, item, x, y);
            if (!item._isVirtual) {
                updates.push({ id: item.id, props: newPos });
            }
            x += item.w + LayoutSystem.gap;
            if (item.h > currentRowH) currentRowH = item.h;
        });
        
        if (updates.length > 0) {
            StateManager.updateItems(updates, { silent: true });
        }

        return y + currentRowH + LayoutSystem.padding;
    },

    layoutColumns: (zone, items, colCount) => {
        const colW = (zone.w - (LayoutSystem.padding * 2)) / colCount;
        // Items must fit within their column (leave padding on both sides)
        // 80px minimum ensures even narrow columns have usable item width
        const maxItemW = Math.max(80, Math.floor(colW - LayoutSystem.padding * 2));
        const colY = new Array(colCount).fill(74); // 44px i-head + 30px CER col labels
        const updates = [];

        items.forEach(item => {
            let colIdx = 0;
            if (item.sub === 'claim') colIdx = 0;
            else if (item.sub === 'evidence') colIdx = 1;
            else if (item.sub === 'reasoning') colIdx = 2;
            else {
                if(item._isVirtual) {
                   const relX = item._dragX - zone.x;
                   colIdx = Math.floor(relX / colW);
                } else {
                   const center = (item.x - zone.x) + (item.w/2);
                   colIdx = Math.floor(center / colW);
                }
            }

            if(colIdx < 0) colIdx = 0;
            if(colIdx >= colCount) colIdx = colCount - 1;

            const props = {};
            // Enforce width constraint so items don't overflow into adjacent columns
            if (!item._isVirtual && item.w > maxItemW) {
                item.w = maxItemW;
                props.w = maxItemW;
            }

            const tx = LayoutSystem.padding + (colIdx * colW) + (colW/2 - item.w/2);
            const ty = colY[colIdx];

            const newPos = { x: zone.x + tx, y: zone.y + ty };
            LayoutSystem.apply(zone, item, tx, ty);
            if (!item._isVirtual) {
                props.x = newPos.x;
                props.y = newPos.y;
                updates.push({ id: item.id, props });
            }
            
            colY[colIdx] += item.h + LayoutSystem.gap;
        });
        
        if (updates.length > 0) {
            StateManager.updateItems(updates, { silent: true });
        }

        return Math.max(...colY) + LayoutSystem.padding;
    },

    apply: (zone, item, relX, relY) => {
        const absX = zone.x + relX;
        const absY = zone.y + relY;

        if(item._isVirtual) {
            const ghost = document.getElementById('ghost-layer');
            ghost.innerHTML = `<div class="ghost-slot" style="transform: translate(${absX}px, ${absY}px); width:${item.w}px; height:${item.h}px;"></div>`;
        } else {
            item.x = absX;
            item.y = absY;
            const el = document.getElementById(item.id);
            if(el && !el.classList.contains('dragging')) {
                el.style.transform = `translate(${absX}px, ${absY}px)`;
            }
        }
    },

    getIndex: (zone, x, y, excludeId = null) => {
        if (!zone.children) return 0;

        const children = zone.children
            .filter(id => id !== excludeId)
            .map(id => State.items.find(i => i.id === id))
            .filter(Boolean);

        if (children.length === 0) return 0;

        for (const child of children) {
            const childCenterY = child.y + child.h / 2;
            if (y < childCenterY - 20) {
                return zone.children.indexOf(child.id);
            }
            if (y < child.y + child.h && x < child.x + child.w / 2) {
                 return zone.children.indexOf(child.id);
            }
        }
        return zone.children.filter(id => id !== excludeId).length;
    }
};

/* --- SYSTEM TEMPLATES --- */
window.SYSTEM_TEMPLATES = [
    { name: "See-Think-Wonder", items: [{type:'zone',title:'I See',x:0,y:0,w:300,h:400},{type:'zone',title:'I Think',x:340,y:0,w:300,h:400},{type:'zone',title:'I Wonder',x:680,y:0,w:300,h:400}] },
    { name: "K-W-L Chart", items: [{type:'zone',title:'What I Know',x:0,y:0,w:300,h:500},{type:'zone',title:'What I Want to Know',x:340,y:0,w:300,h:500},{type:'zone',title:'What I Learned',x:680,y:0,w:300,h:500}] },
    { name: "Frayer Model", items: [{type:'zone',title:'Definition',x:0,y:0,w:300,h:200},{type:'zone',title:'Characteristics',x:340,y:0,w:300,h:200},{type:'zone',title:'Examples',x:0,y:240,w:300,h:200},{type:'zone',title:'Non-Examples',x:340,y:240,w:300,h:200}] },
    { name: "Venn Diagram", items: [{type:'zone',title:'Topic A',x:0,y:0,w:300,h:400},{type:'zone',title:'Both',x:340,y:0,w:300,h:400},{type:'zone',title:'Topic B',x:680,y:0,w:300,h:400}] },
    { name: "Four Corners", items: [{type:'zone',title:'Strongly Agree',x:0,y:0,w:300,h:250},{type:'zone',title:'Agree',x:340,y:0,w:300,h:250},{type:'zone',title:'Disagree',x:0,y:290,w:300,h:250},{type:'zone',title:'Strongly Disagree',x:340,y:290,w:300,h:250}] },
    { name: "Compass Points", items: [{type:'zone',title:'North (Need to Know)',x:340,y:0,w:300,h:200},{type:'zone',title:'West (Worrisome)',x:0,y:240,w:300,h:200},{type:'zone',title:'East (Excited)',x:680,y:240,w:300,h:200},{type:'zone',title:'South (Stance/Steps)',x:340,y:480,w:300,h:200}] }
];

/* --- VIEWPORT HELPERS (the "clear" area excludes top/bottom bars on phones and the docked panel on desktop) --- */
window.Viewport = {
    insets: () => {
        const mobile = DQBUI.isMobile();
        const top = mobile ? ($('topbar') ? $('topbar').offsetHeight : 0) : 0;
        const bottom = mobile ? ($('bottomnav') ? $('bottomnav').offsetHeight : 0) : 0;
        const right = (!mobile && $('app').classList.contains('panel-open')) ? 384 : 0;
        const left = mobile ? 0 : 76;
        return { top, bottom, left, right };
    },
    /** Screen rect of the unobstructed canvas region. */
    rect: () => {
        const i = Viewport.insets();
        return { x: i.left, y: i.top, w: Math.max(100, window.innerWidth - i.left - i.right), h: Math.max(100, window.innerHeight - i.top - i.bottom) };
    },
    /** World coordinates of the centre of the clear region. */
    centerWorld: () => {
        const r = Viewport.rect();
        return { x: (r.x + r.w / 2) / State.view.z - State.view.x, y: (r.y + r.h / 2) / State.view.z - State.view.y };
    },
    toWorld: (clientX, clientY) => {
        const r = $('viewport').getBoundingClientRect();
        return { x: (clientX - r.left) / State.view.z - State.view.x, y: (clientY - r.top) / State.view.z - State.view.y };
    },
    /** Bounding box of every board item (and ink) in world coordinates, or null when empty. */
    contentBounds: () => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        State.items.forEach(i => { minX = Math.min(minX, i.x); minY = Math.min(minY, i.y - (i.type === 'zone' ? 30 : 0)); maxX = Math.max(maxX, i.x + i.w); maxY = Math.max(maxY, i.y + i.h); });
        State.ink.forEach(s => (s.points || []).forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }));
        return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    },
    fit: (animate) => {
        const b = Viewport.contentBounds();
        const r = Viewport.rect();
        if (!b) { StateManager.updateView({ x: 0, y: 0, z: 1 }, { silent: true }); Render.sync(); return; }
        const pad = 48;
        const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY);
        const z = Math.max(0.1, Math.min(1.25, Math.min((r.w - pad * 2) / w, (r.h - pad * 2) / h)));
        const target = { z, x: (r.x + r.w / 2) / z - (b.minX + w / 2), y: (r.y + r.h / 2) / z - (b.minY + h / 2) };
        if (animate === false) { StateManager.updateView(target); return; }
        Viewport.animateTo(target);
    },
    zoomBy: (factor) => {
        const r = Viewport.rect();
        InputController.zoom(factor, r.x + r.w / 2, r.y + r.h / 2);
    },
    animateTo: (target, ms) => {
        const from = { x: State.view.x, y: State.view.y, z: State.view.z };
        const dur = ms || 280, t0 = performance.now();
        const ease = t => 1 - Math.pow(1 - t, 3);
        cancelAnimationFrame(Viewport._raf);
        const step = (now) => {
            const t = Math.min(1, (now - t0) / dur), k = ease(t);
            StateManager.updateView({ x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, z: from.z + (target.z - from.z) * k });
            if (t < 1) Viewport._raf = requestAnimationFrame(step);
        };
        Viewport._raf = requestAnimationFrame(step);
    },
    isContentVisible: () => {
        if (!State.items.length) return true;
        const r = Viewport.rect(), z = State.view.z;
        const vx0 = r.x / z - State.view.x, vy0 = r.y / z - State.view.y, vx1 = (r.x + r.w) / z - State.view.x, vy1 = (r.y + r.h) / z - State.view.y;
        return State.items.some(i => i.x < vx1 && i.x + i.w > vx0 && i.y < vy1 && i.y + i.h > vy0);
    }
};

/* --- UI ADAPTERS (all chrome — panels, sheets, menus — lives in shell.js) --- */
const TOAST_TYPE_BY_ICON = { '✅': 'success', '⚠️': 'warn', '❌': 'error', '🗑️': 'success', '💾': 'success', '📌': 'success', '🖊️': 'info', '✏️': 'info', '🎨': 'success' };
window.UI = {
    /** Toast. Leading emoji from older call sites are converted into a status icon. */
    toast: (msg, type) => {
        let m = String(msg == null ? '' : msg), t = type || '';
        const lead = m.match(/^\s*((?:\p{Extended_Pictographic}|‍|️)+)\s*/u);
        if (lead) { if (!t) t = TOAST_TYPE_BY_ICON[lead[1]] || TOAST_TYPE_BY_ICON[lead[1].replace(/️/g, '')] || ''; m = m.slice(lead[0].length); }
        if (!m) return null;
        return DQBUI.Toast.show(m, { type: t });
    },
    confirmAsync: (o) => DQBUI.Dialog.confirm(o),
    promptAsync: (o) => DQBUI.Dialog.prompt(o),
    /* legacy callback style wrappers */
    confirm: (msg, title, onOk, onCancel, icon) => {
        const danger = /delete|clear|remove|cannot be undone|leave/i.test(String(msg) + ' ' + String(title));
        return DQBUI.Dialog.confirm({ title: title || 'Are you sure?', message: msg, danger, confirmLabel: danger ? (/delete|remove/i.test(title + msg) ? 'Delete' : 'Clear') : 'Confirm' })
            .then(ok => { if (ok) { if (onOk) onOk(); } else if (onCancel) onCancel(); return ok; });
    },
    prompt: (msg, defaultVal, title, onOk, onCancel) => {
        return DQBUI.Dialog.prompt({ title: title || 'Enter a value', message: msg, value: defaultVal || '' })
            .then(v => { if (v == null) { if (onCancel) onCancel(); } else if (onOk) onOk(v); return v; });
    },
    notify: (msg, title, icon) => DQBUI.Dialog.alert({ title: title || 'Notice', message: msg }),
    closeAllMenus: () => {
        DQBUI.Menu.close();
        if (window.Shell) Shell.closeFlyouts();
    },
    loadTemplate: (t) => {
        const groupId = genId();
        const c = Viewport.centerWorld();
        const allX = t.items.flatMap(i => [i.x, i.x + (i.w || 200)]);
        const allY = t.items.flatMap(i => [i.y, i.y + (i.h || 150)]);
        const tplCx = (Math.min(...allX) + Math.max(...allX)) / 2;
        const tplCy = (Math.min(...allY) + Math.max(...allY)) / 2;
        const offX = c.x - tplCx, offY = c.y - tplCy;
        const newItems = t.items.map(i => {
            const item = { ...JSON.parse(JSON.stringify(i)), id: genId(), groupId: groupId };
            item.x += offX; item.y += offY;
            if (item.type === 'zone' && !item.children) item.children = [];
            return item;
        });
        StateManager.addItems(newItems);
        StateManager.setSelection([]);
        setTimeout(() => Viewport.fit(), 60);
    },
    toggleZoneResults: (id) => {
        const el = document.getElementById(`zr-${id}`);
        if (el) {
            el.classList.toggle('active');
            if (el.classList.contains('active') && State.activity && State.activity.targetId === id) {
                if (State.activity.type === 'ZONE_ACT' && State.activity.payload.subType === 'ACT_DISCUSS') Network.updateDiscussion();
                else Network.updateResults(id);
            }
        }
    },
    toggleFullScreen: () => {
        if (!document.fullscreenElement) {
            const el = document.documentElement;
            (el.requestFullscreen || el.webkitRequestFullscreen || (() => Promise.reject())).call(el).catch(() => UI.toast('Full screen is not available in this browser', 'warn'));
        } else if (document.exitFullscreen) document.exitFullscreen();
    },
    toggleOpenNotes: () => { Network.toggleOpenMode(State.activity.type !== 'OPEN'); },
    updateOpenNotesButton: (isOpen) => { if (window.Shell) Shell.syncBoardState(); },
    showSettingsModal: () => { if (window.Shell) Shell.Share.open(); },
    showTemplates: () => { if (window.Shell) Shell.Templates.open(); },
    toggleA11y: () => { if (window.Shell) Shell.A11y.open(); },
    saveTemplate: () => { Actions.saveSelectionAsTemplate(true); }
};

/* --- PERSISTENCE --- */
window.DB = {
    db: null, ok: true,
    init: () => new Promise(resolve => {
        let req;
        try { req = indexedDB.open('DQB_Ultimate', 2); }
        catch (e) { DB.ok = false; resolve(); if (window.Shell) Shell.onDbError(e); return; }
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
        };
        req.onsuccess = e => { DB.db = e.target.result; resolve(); };
        req.onerror = () => { DB.ok = false; resolve(); if (window.Shell) Shell.onDbError(req.error); };
        req.onblocked = () => { DB.ok = false; resolve(); };
    }),
    _put: (store, value) => new Promise((resolve, reject) => {
        if (!DB.db) return reject(new Error('Storage is not available in this browser mode.'));
        try {
            const tx = DB.db.transaction(store, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = ev => reject(ev.target.error);
            tx.onabort = ev => reject(ev.target.error || new Error('Save aborted'));
            tx.objectStore(store).put(value);
        } catch (err) { reject(err); }
    }),
    save: (board) => {
        if (State.isCoHost) return Promise.resolve();
        if (!board || !board.id || typeof board.id !== 'string') return Promise.reject(new Error("Attempted to save board with invalid ID."));
        return DB._put('boards', board);
    },
    saveTemplate: (tpl) => {
        if (!tpl || !tpl.id || typeof tpl.id !== 'string') return Promise.reject(new Error("Attempted to save template with invalid ID."));
        return DB._put('templates', tpl);
    },
    getAll: (store) => new Promise(resolve => {
        if (!DB.db) return resolve([]);
        try { const req = DB.db.transaction(store, 'readonly').objectStore(store).getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => resolve([]); }
        catch (e) { resolve([]); }
    }),
    remove: (store, id) => new Promise((resolve, reject) => {
        if (!DB.db) return resolve();
        try { const tx = DB.db.transaction(store, 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = e => reject(e.target.error); tx.objectStore(store).delete(id); }
        catch (e) { reject(e); }
    })
};

window.Board = {
    list: () => (window.Shell ? Shell.Home.render() : null),
    create: (tpl) => {
        State.id = genId(); State.name = "My Board";
        StateManager.setFullState({ items: [], ink: [], view: { x: 0, y: 0, z: 1 } }, { silent: true });
        localStorage.setItem('lastBoard', State.id);
        ActionHistory.reset();
        Board.start({ fresh: true, template: tpl });
    },
    load: async (id) => {
        if (!id) { UI.toast("Could not load that board.", 'error'); return; }
        const b = (await DB.getAll('boards')).find(x => x.id === id);
        if (!b) { UI.toast("That board could not be found on this device.", 'error'); if (window.Shell) Shell.Home.render(); return; }
        State.id = b.id; State.name = b.name || 'My Board';
        // Boards saved by older versions may contain odd values; normalise defensively.
        const items = (Array.isArray(b.items) ? b.items : []).filter(i => i && typeof i === 'object' && safeId(i.id));
        StateManager.setFullState({ items, ink: Array.isArray(b.ink) ? b.ink : [], view: b.view || { x: 0, y: 0, z: 1 } }, { silent: true });
        localStorage.setItem('lastBoard', State.id);
        ActionHistory.reset();
        Board.start({ fresh: false });
    },
    start: (opts) => {
        opts = opts || {};
        Render.start();
        if (window.Shell) Shell.enterBoard(opts);
        if (!State.isCoHost) Network.host();
        if (State.id) {
            if (window._autoSaveInterval) clearInterval(window._autoSaveInterval);
            window._autoSaveInterval = setInterval(() => Board.save(true), 30000);
        }
        if (opts.template) UI.loadTemplate(opts.template);
        else if (opts.fresh) Board.save(true);
    },
    setStartView: () => { Board.save(true); UI.toast("Start view saved", 'success'); },
    _timer: null,
    save: (silent) => {
        if (State.isCoHost || !State.id) return;
        if (window.Shell) Shell.setSave('saving');
        clearTimeout(Board._timer);
        Board._timer = setTimeout(Board.flush, silent ? 450 : 0);
    },
    flush: async () => {
        clearTimeout(Board._timer);
        if (State.isCoHost || !State.id) return;
        try {
            await DB.save({ id: State.id, name: State.name, items: State.items, ink: State.ink, view: State.view, ts: Date.now() });
            if (window.Shell) Shell.setSave('saved');
        } catch (error) {
            console.error("Board.save failed:", error);
            if (window.Shell) Shell.setSave('error', error && error.message);
        }
    },
    exit: async () => {
        const n = Object.keys(State.students).filter(k => k !== 'HOST' && State.students[k].role !== 'cohost').length;
        const ok = await DQBUI.Dialog.confirm({ title: 'Leave this board?', message: n ? `${n} student${n === 1 ? ' is' : 's are'} connected and will be disconnected. Your board is saved on this device.` : 'Your board is saved on this device.', confirmLabel: 'Leave board', icon: 'logout' });
        if (!ok) return;
        await Board.flush();
        if (window._autoSaveInterval) clearInterval(window._autoSaveInterval);
        localStorage.removeItem('lastBoard');
        location.reload();
    },
    /** Imports a board exported as JSON. Validates shape and sanitises ids before use. */
    import: async (input) => {
        const f = input.files && input.files[0]; if (!f) return;
        input.value = '';
        if (f.size > 40 * 1024 * 1024) { UI.toast('That file is too large to import.', 'error'); return; }
        try {
            const d = JSON.parse(await f.text());
            if (!d || typeof d !== 'object' || !Array.isArray(d.items)) throw new Error('not a board');
            const items = d.items.filter(i => i && typeof i === 'object' && i.type).map(i => ({ ...i, id: safeId(i.id) || genId() }));
            State.id = genId(); State.name = clampStr(d.name || "Imported board", 60);
            StateManager.setFullState({ items, ink: Array.isArray(d.ink) ? d.ink : [], view: d.view || { x: 0, y: 0, z: 1 } }, { silent: true });
            ActionHistory.reset();
            Board.start({ fresh: true });
            setTimeout(() => Viewport.fit(false), 80);
        } catch (e) { UI.toast("That file isn't a valid InquiryDQB board.", 'error'); }
    },
    export: () => {
        const boardData = { app: 'InquiryDQB', version: 2, name: State.name, items: State.items, ink: State.ink, view: State.view };
        const blob = new Blob([JSON.stringify(boardData, null, 2)], { type: 'application/json' });
        Board._download(blob, `${(State.name || 'board').replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'board'}.json`);
        UI.toast("Board exported", 'success');
    },
    _download: (blob, name) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
    /** Exports the whole board as a PNG picture (zones, notes, polls, ink). */
    exportPNG: async () => {
        const b = Viewport.contentBounds();
        if (!b) { UI.toast("There's nothing on the board to export yet.", 'warn'); return; }
        const pad = 48, maxDim = 6000;
        const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
        const scale = Math.min(2, maxDim / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
        const ctx = cv.getContext('2d'); ctx.scale(scale, scale);
        const dark = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.translate(pad - b.minX, pad - b.minY);
        const rr = (x, y, ww, hh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); };
        const wrap = (text, x, y, maxW, lh, font) => {
            ctx.font = font; const lines = [];
            String(text || '').split('\n').forEach(par => { let line = ''; par.split(' ').forEach(word => { const t = line ? line + ' ' + word : word; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t; }); lines.push(line); });
            lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh)); return lines.length * lh;
        };
        const zones = State.items.filter(i => i.type === 'zone'), others = State.items.filter(i => i.type !== 'zone');
        for (const z of zones) {
            const col = safeColor(z.color) || (z.zoneType === 'breakout' ? (safeColor(z.roomColor) || '#8b5cf6') : '#94a3b8');
            ctx.save(); rr(z.x, z.y, z.w, z.h, 16); ctx.fillStyle = col + '18'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.setLineDash(z.color ? [] : [8, 6]); ctx.stroke(); ctx.restore();
            ctx.fillStyle = col; ctx.font = '700 15px Inter, sans-serif'; ctx.fillText(z.title || 'Zone', z.x + 12, z.y - 10);
            if (z.zoneType === 'cer') { ctx.fillStyle = '#94a3b8'; ctx.font = '800 11px Inter, sans-serif'; ['CLAIM', 'EVIDENCE', 'REASONING'].forEach((l, i) => ctx.fillText(l, z.x + (z.w / 3) * i + 14, z.y + 24)); }
            if (z.zoneType === 'exit') { ctx.fillStyle = '#334155'; ctx.font = '600 14px Inter, sans-serif'; wrap(z.prompt, z.x + 14, z.y + 56, z.w - 28, 20, '600 14px Inter, sans-serif'); }
        }
        for (const s of State.ink) { if (!s.points || s.points.length < 2) continue; ctx.strokeStyle = safeColor(s.color) || '#111'; ctx.lineWidth = parseFloat(s.width) || 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y); s.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); }
        const loadImg = (src) => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
        for (const it of others) {
            if (it.type === 'note') {
                const head = TYPES[it.sub] || TYPES.meta;
                ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; rr(it.x, it.y, it.w, it.h, 12); ctx.fillStyle = head.col; ctx.fill(); ctx.restore();
                ctx.lineWidth = 1.5; ctx.strokeStyle = head.bor; rr(it.x, it.y, it.w, it.h, 12); ctx.stroke();
                ctx.fillStyle = head.bor; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText(((head.icon || '') + ' ' + (it.author || head.lbl)).trim(), it.x + 10, it.y + 20);
                if (it.src && safeImg(it.src)) { const im = await loadImg(it.src); if (im) { const bw = it.w - 12, bh = it.h - 62; const r = Math.min(bw / im.width, bh / im.height); ctx.drawImage(im, it.x + 6 + (bw - im.width * r) / 2, it.y + 30, im.width * r, im.height * r); } if (it.text) { ctx.fillStyle = '#334155'; ctx.font = '12px Inter, sans-serif'; ctx.fillText(it.text.slice(0, 40), it.x + 10, it.y + it.h - 10); } }
                else { ctx.fillStyle = '#1f2937'; wrap(it.text, it.x + 12, it.y + 44, it.w - 24, 22, '20px "Patrick Hand", "Segoe Print", cursive'); }
            } else if (it.type === 'poll') {
                ctx.save(); rr(it.x, it.y, it.w, it.h, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#cbd5e1'; ctx.stroke(); ctx.restore();
                ctx.fillStyle = '#0f172a'; ctx.font = '700 14px Inter, sans-serif'; ctx.fillText(it.q || 'Poll', it.x + 12, it.y + 24);
                const tot = (it.opts || []).reduce((a, o) => a + (o.v || 0), 0);
                (it.opts || []).forEach((o, i) => { const yy = it.y + 38 + i * 30; ctx.fillStyle = '#e2e8f0'; rr(it.x + 10, yy, it.w - 20, 24, 6); ctx.fill(); if (tot) { ctx.fillStyle = '#93c5fd'; rr(it.x + 10, yy, (it.w - 20) * (o.v / tot), 24, 6); ctx.fill(); } ctx.fillStyle = '#0f172a'; ctx.font = '600 12px Inter, sans-serif'; ctx.fillText(`${o.lbl}  ·  ${o.v}`, it.x + 18, yy + 16); });
            } else if (it.type === 'graph') {
                ctx.save(); rr(it.x, it.y, it.w, it.h, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#cbd5e1'; ctx.stroke(); ctx.restore();
                ctx.fillStyle = '#0f172a'; ctx.font = '700 14px Inter, sans-serif'; ctx.fillText(it.title || 'Graph', it.x + 12, it.y + 24);
                const data = it.data || [], mx = Math.max(...data, 10), bw = (it.w - 24) / Math.max(1, data.length);
                data.forEach((v, i) => { const bh = (it.h - 60) * (v / mx); ctx.fillStyle = '#2563eb'; ctx.fillRect(it.x + 12 + i * bw + 2, it.y + it.h - 12 - bh, Math.max(2, bw - 4), bh); });
            } else { ctx.save(); rr(it.x, it.y, it.w, it.h, 12); ctx.fillStyle = '#f1f5f9'; ctx.fill(); ctx.restore(); ctx.fillStyle = '#334155'; ctx.font = '700 13px Inter, sans-serif'; ctx.fillText(it.type === 'spin' ? 'Spinner' : it.type, it.x + 12, it.y + 24); }
        }
        cv.toBlob(blob => { if (!blob) { UI.toast('Could not create the image.', 'error'); return; } Board._download(blob, `${(State.name || 'board').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.png`); UI.toast('Picture saved', 'success'); }, 'image/png');
    },
    /** Finds an empty spot near (preferX, preferY) for a w x h item. */
    getFreeSpace: (preferX, preferY, w, h) => {
        const pad = 24;
        const hit = (cx, cy) => State.items.some(i => cx < i.x + i.w + pad && cx + w + pad > i.x && cy < i.y + i.h + pad && cy + h + pad > i.y);
        if (!hit(preferX, preferY)) return { x: preferX, y: preferY };
        const step = Math.max(40, Math.min(w, h) / 2);
        for (let r = step; r <= 2400; r += step) {
            const steps = Math.max(8, Math.ceil((2 * Math.PI * r) / (step * 1.1)));
            for (let s = 0; s < steps; s++) {
                const a = (s / steps) * Math.PI * 2;
                const nx = preferX + Math.cos(a) * r, ny = preferY + Math.sin(a) * r;
                if (!hit(nx, ny)) return { x: nx, y: ny };
            }
        }
        const b = Viewport.contentBounds();
        return b ? { x: b.maxX + 60, y: preferY } : { x: preferX, y: preferY };
    }
};

/* --- INK & DRAWING --- */
window.InkManager = {
    currentPath: [],
    sketchMode: false,
    selectedId: null,
    selPoint: null,
    setColor: (c) => {
        State.draw.color = c;
        if (InkManager.selectedId) { InkManager.colorSelected(c); return; }
        if (State.tool !== 'draw') window.setTool('draw');
        if (window.Shell) Shell.syncDraw();
    },
    setWidth: (w) => { State.draw.width = Math.max(1, Math.min(40, parseInt(w) || 4)); if (window.Shell) Shell.syncDraw(); },
    toggleSketchMode: (on) => {
        InkManager.sketchMode = on === undefined ? !InkManager.sketchMode : !!on;
        if (window.Shell) Shell.syncDraw();
        UI.toast(InkManager.sketchMode ? 'Sketch notes: each stroke becomes a note' : 'Annotate: drawing on the board');
    },
    strokeToItem: (pts, color, width) => {
        if (!pts || pts.length < 2) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(p => {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        });
        const margin = 16;
        const bx = minX - margin, by = minY - margin;
        const bw = Math.max(80, maxX - minX + margin * 2);
        const contentH = Math.max(60, maxY - minY + margin * 2);
        const bh = contentH;
        const canvas = document.createElement('canvas');
        canvas.width = bw; canvas.height = bh;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = safeColor(color) || State.draw.color;
        ctx.lineWidth = width || State.draw.width;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x - bx, p.y - by); else ctx.lineTo(p.x - bx, p.y - by); });
        ctx.stroke();
        const src = canvas.toDataURL();
        const uiChrome = 70; // header (34px) + caption (36px)
        return { id: genId(), type: 'note', sub: 'sketch', src, text: '', x: bx, y: by, w: bw, h: Math.max(140, contentH + uiChrome) };
    },
    pinToItems: () => {
        if (State.ink.length === 0) { UI.toast("There is no ink to pin", 'warn'); return; }
        const newItems = State.ink.map(s => InkManager.strokeToItem(s.points, s.color, s.width)).filter(Boolean);
        if (newItems.length > 0) {
            StateManager.setInk([]);
            StateManager.addItems(newItems);
            UI.toast(`Pinned ${newItems.length} drawing${newItems.length > 1 ? 's' : ''} as notes`, 'success');
        }
    },
    start: (x, y) => { InkManager.currentPath = [{x,y}]; },
    move: (x, y) => { InkManager.currentPath.push({x,y}); InkManager.renderTemp(); },
    end: () => {
        if(InkManager.currentPath.length > 1) {
            if (InkManager.sketchMode) {
                const it = InkManager.strokeToItem(InkManager.currentPath);
                if (it) StateManager.addItem(it);
            } else {
                const newInk = { id: genId(), points: [...InkManager.currentPath], color: State.draw.color, width: State.draw.width };
                StateManager.addInk(newInk);
            }
        }
        InkManager.currentPath = []; InkManager.renderTemp();
    },
    renderTemp: () => {
        const svg = $('ink-layer'); const temp = document.getElementById('temp-ink'); if(temp) temp.remove();
        if(InkManager.currentPath.length < 2) return;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", InkManager.pointsToPath(InkManager.currentPath));
        path.setAttribute("stroke", State.draw.color);
        path.setAttribute("stroke-width", State.draw.width);
        path.setAttribute("fill", "none"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
        path.id = "temp-ink"; svg.appendChild(path);
    },
    pointsToPath: (pts) => { if(!pts || pts.length===0) return ""; let d=`M ${pts[0].x} ${pts[0].y}`; for(let i=1;i<pts.length;i++) d+=` L ${pts[i].x} ${pts[i].y}`; return d; },
    clear: async () => {
        if (!State.ink.length) { UI.toast('There is no ink to clear', 'warn'); return; }
        const ok = await DQBUI.Dialog.confirm({ title: 'Clear all ink?', message: 'Every drawing on the board will be removed. You can undo this.', confirmLabel: 'Clear ink', danger: true });
        if (!ok) return;
        InkManager.selectedId = null; StateManager.setInk([]); if (window.Shell) Shell.onSelection();
    },
    eraseAt: (x, y, inkArray, zoom) => {
        const thresh = 20 / (zoom || State.view.z);
        const initLen = inkArray.length;
        const filteredInk = inkArray.filter(s => !s.points.some(p => Math.hypot(p.x - x, p.y - y) < thresh));
        if (filteredInk.length !== initLen) return { changed: true, newInk: filteredInk };
        return { changed: false, newInk: inkArray };
    },
    selectStroke: (id, e) => {
        if (State.tool !== 'select' && State.tool !== 'pan') return;
        e.stopPropagation();
        InkManager.selectedId = id;
        InkManager.selPoint = { x: e.clientX, y: e.clientY };
        State.selection = [];
        Render.ink(); Render.all();
        if (window.Shell) Shell.onSelection();
    },
    deselectStroke: () => {
        if (!InkManager.selectedId) return;
        InkManager.selectedId = null;
        Render.ink();
        if (window.Shell) Shell.onSelection();
    },
    hideInkToolbar: () => { if (window.Shell) Shell.onSelection(); },
    deleteSelected: () => {
        if (!InkManager.selectedId) return;
        const newInk = State.ink.filter(s => s.id !== InkManager.selectedId);
        InkManager.selectedId = null;
        StateManager.setInk(newInk);
        if (window.Shell) Shell.onSelection();
    },
    colorSelected: (color) => {
        if (!InkManager.selectedId) return;
        const sid = InkManager.selectedId;
        const newInk = State.ink.map(s => s.id === sid ? { ...s, color } : s);
        StateManager.setInk(newInk);
        InkManager.selectedId = sid;
        Render.ink();
    },
    pinSelected: () => {
        if (!InkManager.selectedId) return;
        const stroke = State.ink.find(s => s.id === InkManager.selectedId);
        if (!stroke) return;
        const item = InkManager.strokeToItem(stroke.points, stroke.color, stroke.width);
        if (item) {
            const newInk = State.ink.filter(s => s.id !== InkManager.selectedId);
            InkManager.selectedId = null;
            StateManager.setInk(newInk);
            StateManager.addItem(item);
            if (window.Shell) Shell.onSelection();
            UI.toast("Stroke pinned as a note", 'success');
        }
    }
};

/* --- RENDER --- */
window.Render = {
    _running: false, _lastT: '', _mmDirty: true, _selDirty: true,
    start: () => {
        if (Render._running) { Render.all(); return; }
        Render._running = true;
        Render.initDelegation();
        Render.all();
        const frame = () => { Render.sync(); requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
    },
    loop: () => Render.start(),   // legacy name

    /** One delegated listener replaces the per-item inline onclick handlers. */
    initDelegation: () => {
        const handler = (e) => {
            const t = e.target.closest('[data-act]'); if (!t) return;
            const itemEl = t.closest('.item'); const id = itemEl ? itemEl.id : null;
            if (!id && t.dataset.act !== 'noop') return;
            e.stopPropagation();
            switch (t.dataset.act) {
                case 'zone-toggle': Network.toggleZone(id); break;
                case 'consensus-start': Consensus.start(id); break;
                case 'breakout-open': Breakout.open(id); break;
                case 'results': UI.toggleZoneResults(id); break;
                case 'menu': Actions.showContextMenu(e, id); break;
                case 'spin': Actions.spin(id); break;
                case 'comments': Actions.showComments(id); break;
            }
        };
        ['items-layer', 'consensus-items-layer'].forEach(n => { const el = $(n); if (el) el.addEventListener('click', handler); });
    },

    /** Runs every animation frame; only touches the DOM when something changed. */
    sync: () => {
        const v = State.view;
        const t = `scale(${v.z}) translate(${v.x}px, ${v.y}px)`;
        let viewChanged = false;
        if (Render._lastT !== t) {
            Render._lastT = t; viewChanged = true;
            $('world').style.transform = t;
            $('bg-grid').style.backgroundPosition = `${v.x * v.z}px ${v.y * v.z}px`;
            const gs = Math.max(8, 24 * v.z);
            $('bg-grid').style.backgroundSize = `${gs}px ${gs}px`;
        }
        const dragging = State.drag && State.drag.mode === 'move';
        let geoChanged = false;
        for (let k = 0; k < State.items.length; k++) {
            const i = State.items[k];
            const el = document.getElementById(i.id); if (!el) continue;
            const moving = dragging && State.drag.moveTargets.some(m => m.id === i.id);
            const sig = i.x + '|' + i.y + '|' + i.w + '|' + i.h;
            if (moving) { geoChanged = true; continue; }
            if (el._sig !== sig) {
                el._sig = sig; geoChanged = true;
                el.style.transform = `translate(${i.x}px, ${i.y}px)`;
                el.style.width = i.w + 'px'; if (i.h) el.style.height = i.h + 'px';
            }
        }
        if (viewChanged || geoChanged || State.drag) { Render._mmDirty = true; Render._selDirty = true; }
        if (Render._mmDirty) { Render._mmDirty = false; Render.minimap(); if (window.Shell) Shell.syncZoom(); }
        if (Render._selDirty) { Render._selDirty = false; if (window.Shell) Shell.positionSelBar(); }
        if (window.Shell && (viewChanged || geoChanged)) Shell.checkContentVisible();
    },

    /** Re-sync every item's classes, colours and content (called after state changes). */
    all: () => {
        const layer = $('items-layer');
        State.items.sort((a, b) => (a.type === 'zone' ? -1 : 1) - (b.type === 'zone' ? -1 : 1));
        const hasActiveZone = (State.activity.type === 'ZONE_ACT' || State.activity.type === 'EXIT_TICKET' || State.activity.type === 'WIDGET_ACT');

        State.items.forEach(i => {
            let el = document.getElementById(i.id);
            if (!el) {
                el = Render.createItem(i);
                layer.appendChild(el);
            }
            // geometry is applied by sync(); force an update after structural changes
            el._sig = null;
            el.classList.toggle('selected', State.selection.includes(i.id));
            el.classList.toggle('grouped', !!i.groupId);
            el.classList.toggle('locked', !!i.locked);
            el.classList.toggle('pending', !!i.pending);

            const wrapper = el.querySelector('.jiggle-wrapper');
            if (i.type === 'zone') {
                const lbl = el.querySelector('.zone-label'); if (lbl && lbl.textContent !== i.title) lbl.textContent = i.title || 'Zone';
                el.classList.toggle('zone-active', !!i.isOpen);
                el.classList.toggle('zone-locked', hasActiveZone && !i.isOpen);
                const iHead = el.querySelector('.i-head');
                let liveBadge = el.querySelector('.live-badge');
                if (i.isOpen) {
                    if (!liveBadge && iHead) { liveBadge = document.createElement('span'); liveBadge.className = 'live-badge'; liveBadge.textContent = 'Live'; iHead.querySelector('.hd-l').appendChild(liveBadge); }
                } else if (liveBadge) liveBadge.remove();
                const col = safeColor(i.color);
                if (wrapper) {
                    wrapper.style.borderColor = col || (i.zoneType === 'breakout' ? (safeColor(i.roomColor) || '#8b5cf6') : '');
                    wrapper.style.borderStyle = col ? 'solid' : '';
                    wrapper.style.borderWidth = col ? '3px' : '';
                    wrapper.style.background = col ? col + '1a' : '';
                }
                if (iHead) iHead.style.background = col ? col + '28' : '';
                if (lbl) { lbl.style.color = col || ''; lbl.style.background = col ? col + '1a' : ''; lbl.style.borderColor = col ? col + '60' : ''; }
                if (i.zoneType === 'consensus') {
                    const svg = el.querySelector('.consensus-zone-svg');
                    if (svg) Render._fillInk(svg, i.ink);
                }
                if (i.zoneType === 'breakout') {
                    const thumb = el.querySelector('.breakout-thumb');
                    if (thumb) Breakout.renderThumb(i, thumb);
                }
            }
            // header action button text
            const zbtn = el.querySelector('[data-act="zone-toggle"]');
            if (zbtn) {
                const txt = (i.type === 'poll' || i.type === 'graph' || i.zoneType === 'exit') ? (i.isOpen ? 'Stop' : 'Broadcast') : (i.isOpen ? 'Open ●' : 'Open');
                if (zbtn.textContent !== txt) zbtn.textContent = txt;
                zbtn.classList.toggle('active', !!i.isOpen);
            }
            if (i.type === 'note' && !i.src && !el.classList.contains('consensus-child')) {
                const head = TYPES[i.sub] || TYPES.meta;
                if (wrapper) { wrapper.style.background = head.col; wrapper.style.borderColor = head.bor; }
                const h = el.querySelector('.i-head'); if (h) { h.style.background = head.bor + '26'; h.style.color = head.bor; }
                const icon = el.querySelector('.icon-span'); if (icon) icon.textContent = head.icon;
                const auth = el.querySelector('.auth-span'); if (auth) auth.textContent = i.author || head.lbl;
            }

            // comment badge
            const cmts = State.comments.filter(c => c.targetId === i.id);
            let badge = el.querySelector('.cmt-badge');
            if (cmts.length > 0) {
                if (!badge) {
                    badge = document.createElement('button'); badge.type = 'button'; badge.className = 'cmt-badge'; badge.dataset.act = 'comments'; badge.title = 'View comments'; badge.setAttribute('aria-label', 'View comments');
                    el.appendChild(badge);
                }
                badge.textContent = cmts.length;
            } else if (badge) badge.remove();

            const baseZ = i.type === 'zone' ? 1 : (i.z || 10);
            el.style.zIndex = baseZ;

            if (i.type === 'poll') Render.updatePoll(el, i);
            if (i.type === 'spin') Render.updateSpin(el, i);
            if (i.type === 'graph') Render.updateGraph(el, i);

            if (i.type === 'note' && !i.src) {
                const txt = el.querySelector('textarea');
                if (txt && txt.value !== (i.text || '') && document.activeElement !== txt) txt.value = i.text || '';
            }
        });
        Array.from(layer.children).forEach(c => { if (!State.items.find(i => i.id === c.id)) c.remove(); });
        Render.ink();
        Render._mmDirty = true; Render._selDirty = true;
        if (window.Shell) Shell.afterRender();
    },
    _fillInk: (svg, ink) => {
        svg.textContent = '';
        (ink || []).forEach(s => {
            if (!s || !s.points) return;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', InkManager.pointsToPath(s.points)); path.setAttribute('stroke', safeColor(s.color) || '#000');
            path.setAttribute('stroke-width', parseFloat(s.width) || 4); path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(path);
        });
    },
    ink: () => {
        const sel = InkManager.selectedId;
        const svg = $('ink-layer'); svg.textContent = '';
        State.ink.forEach(s => {
            if (!s || !s.points) return;
            const d = InkManager.pointsToPath(s.points);
            const col = safeColor(s.color) || '#000';
            if (sel === s.id) {
                const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                halo.setAttribute('d', d); halo.setAttribute('stroke', 'rgba(37,99,235,0.3)'); halo.setAttribute('stroke-width', (parseFloat(s.width) || 4) + 10);
                halo.setAttribute('fill', 'none'); halo.setAttribute('stroke-linecap', 'round'); halo.setAttribute('pointer-events', 'none'); svg.appendChild(halo);
            }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d); path.setAttribute('stroke', col); path.setAttribute('stroke-width', parseFloat(s.width) || 4);
            path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
            path.style.pointerEvents = 'stroke'; path.style.cursor = 'pointer';
            // fat invisible hit area helps on touch screens
            path.addEventListener('click', ev => InkManager.selectStroke(s.id, ev));
            svg.appendChild(path);
        });
        Render._mmDirty = true;
    },
    minimap: () => {
        const canvas = $('minimap'), cont = $('minimap-container');
        if (!canvas || !cont || cont.classList.contains('hidden') || cont.offsetWidth === 0) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cw = cont.clientWidth, ch = cont.clientHeight;
        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const cs = getComputedStyle(document.documentElement);
        const accent = cs.getPropertyValue('--accent').trim() || '#2563eb';
        const zoneStroke = cs.getPropertyValue('--border-strong').trim() || 'rgba(0,0,0,.2)';

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        State.items.forEach(i => { minX = Math.min(minX, i.x); minY = Math.min(minY, i.y); maxX = Math.max(maxX, i.x + i.w); maxY = Math.max(maxY, i.y + i.h); });
        if (!State.items.length) { minX = 0; minY = 0; maxX = window.innerWidth; maxY = window.innerHeight; }
        const vw = window.innerWidth / State.view.z, vh = window.innerHeight / State.view.z, vx = -State.view.x, vy = -State.view.y;
        minX = Math.min(minX, vx); minY = Math.min(minY, vy); maxX = Math.max(maxX, vx + vw); maxY = Math.max(maxY, vy + vh);
        const padding = 60; minX -= padding; minY -= padding; maxX += padding; maxY += padding;
        const worldW = maxX - minX, worldH = maxY - minY;
        if (worldW <= 0 || worldH <= 0) return;
        const scale = Math.min(cw / worldW, ch / worldH);
        const ox = (cw - worldW * scale) / 2, oy = (ch - worldH * scale) / 2;
        const mapX = v => (v - minX) * scale + ox, mapY = v => (v - minY) * scale + oy;

        State.items.forEach(i => {
            if (i.type === 'zone') {
                ctx.fillStyle = (safeColor(i.color) || '#2563eb') + '14'; ctx.fillRect(mapX(i.x), mapY(i.y), i.w * scale, i.h * scale);
                ctx.strokeStyle = safeColor(i.color) || (i.zoneType === 'breakout' ? (safeColor(i.roomColor) || '#8b5cf6') : zoneStroke); ctx.lineWidth = 1;
                ctx.strokeRect(mapX(i.x), mapY(i.y), i.w * scale, i.h * scale);
            } else {
                ctx.fillStyle = TYPES[i.sub] ? TYPES[i.sub].bor : '#94a3b8';
                ctx.fillRect(mapX(i.x), mapY(i.y), Math.max(2, i.w * scale), Math.max(2, i.h * scale));
            }
        });
        State.ink.forEach(s => {
            if (!s.points || s.points.length < 2) return;
            ctx.strokeStyle = safeColor(s.color) || '#000'; ctx.lineWidth = Math.max(0.6, parseFloat(s.width) * scale * 0.6); ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(mapX(s.points[0].x), mapY(s.points[0].y)); s.points.slice(1).forEach(p => ctx.lineTo(mapX(p.x), mapY(p.y))); ctx.stroke();
        });
        ctx.strokeStyle = accent; ctx.fillStyle = accent + '22'; ctx.lineWidth = 2;
        ctx.fillRect(mapX(vx), mapY(vy), vw * scale, vh * scale); ctx.strokeRect(mapX(vx), mapY(vy), vw * scale, vh * scale);
        canvas.worldInfo = { minX, minY, scale, ox, oy };
    },
    /** Click / drag on the minimap pans the board. */
    minimapPointer: (e) => {
        const canvas = $('minimap'), info = canvas.worldInfo; if (!info || !(info.scale > 0)) return;
        const rect = canvas.getBoundingClientRect();
        const wx = ((e.clientX - rect.left) - info.ox) / info.scale + info.minX;
        const wy = ((e.clientY - rect.top) - info.oy) / info.scale + info.minY;
        StateManager.updateView({ x: -wx + (window.innerWidth / State.view.z) / 2, y: -wy + (window.innerHeight / State.view.z) / 2 });
    },

    /* ---------- item factory (DOM built with APIs / escaped strings only) ---------- */
    createItem: (d) => {
        const type = String(d.type || 'note').replace(/[^a-z]/gi, '') || 'note';
        const el = document.createElement('div');
        el.id = d.id; el.className = `item ${type}`;
        if (d.zoneType) el.classList.add('zone-' + String(d.zoneType).replace(/[^a-z]/gi, ''));
        const parent = d.parentZone ? State.items.find(x => x.id === d.parentZone) : null;
        const isConsensusChild = !!(parent && parent.zoneType === 'consensus');
        if (isConsensusChild) el.classList.add('consensus-child');

        const head = TYPES[d.sub] || TYPES.meta;
        const isZoneLike = d.type === 'zone';
        let title, iconHtml = '';
        if (isZoneLike) {
            title = ({ cer: 'CER Builder', consensus: 'Consensus Model', exit: 'Exit Ticket', breakout: 'Breakout Board' })[d.zoneType] || 'Zone';
            iconHtml = icon(({ cer: 'cer', consensus: 'consensus', exit: 'ticket', breakout: 'rocket' })[d.zoneType] || 'zone', 'sm');
        } else if (d.type === 'poll') { title = 'Poll'; iconHtml = icon('poll', 'sm'); }
        else if (d.type === 'spin') { title = 'Spinner'; iconHtml = icon('spin', 'sm'); }
        else if (d.type === 'graph') { title = 'Live graph'; iconHtml = icon('graph', 'sm'); }
        else { title = d.author || head.lbl; iconHtml = esc(head.icon); }

        // header action buttons
        let ctl = '';
        if (d.type === 'poll' || d.type === 'graph' || d.zoneType === 'exit') ctl = `<button type="button" class="btn-toggle" data-act="zone-toggle">Broadcast</button>`;
        else if (d.zoneType === 'consensus') ctl = `<button type="button" class="btn-toggle" data-act="consensus-start">Start modeling</button>`;
        else if (d.zoneType === 'breakout') ctl = `<button type="button" class="btn-toggle" data-act="breakout-open">Launch</button>`;
        else if (isZoneLike) ctl = `<button type="button" class="btn-toggle" data-act="zone-toggle">Open</button>`;
        const res = (isZoneLike && d.zoneType !== 'breakout') ? `<button type="button" class="btn-toggle results-btn" id="btn-res-${esc(d.id)}" data-act="results">Results</button>` : '';

        // body
        let inner = '';
        if (d.type === 'note') {
            if (d.sub === 'sketch' || d.src) inner = `<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;border-radius:inherit"><img draggable="false" alt="Sketch" style="flex:1;min-height:0;width:100%;object-fit:contain;background:${isConsensusChild ? 'transparent' : 'rgba(255,255,255,.7)'}">${!isConsensusChild ? `<textarea class="caption-in" placeholder="Caption…" aria-label="Caption"></textarea>` : ''}</div>`;
            else inner = `<textarea class="note-in" placeholder="Type here…" aria-label="Note text" ${isConsensusChild ? 'style="font-weight:bold"' : ''}></textarea>`;
        } else if (isZoneLike) {
            if (d.zoneType === 'cer') inner = `<div class="cer-grid"><div class="cer-col">Claim</div><div class="cer-col">Evidence</div><div class="cer-col">Reasoning</div></div>`;
            else if (d.zoneType === 'consensus') inner = `<svg class="consensus-zone-svg" style="width:100%;height:100%;pointer-events:none"></svg>`;
            else if (d.zoneType === 'exit') {
                const exitMode = String(d.exitMode || d.mode || 'exit');
                const modeIcon = { short: 'short', smiley: 'smile', mc: 'radio', multi: 'checks', lw: 'brain' }[exitMode] || 'ticket';
                const modeName = { short: 'Short answer', smiley: 'Rating', mc: 'Multiple choice', multi: 'Multi-select', lw: 'Learn / Wonder' }[exitMode] || 'Exit ticket';
                inner = `<div class="exit-head">${icon(modeIcon, 'sm')}<span>${esc(modeName)}</span></div><div class="exit-prompt">${esc(d.prompt)}</div><div style="flex:1;position:relative"></div>`;
            } else if (d.zoneType === 'breakout') inner = `<canvas class="breakout-thumb" style="width:100%;height:100%;display:block"></canvas>`;
            else inner = `<div class="zone-hint">Drop notes here</div>`;
            inner += `<div id="zr-${esc(d.id)}" class="zone-res-box"></div>`;
        } else if (d.type === 'poll') inner = `<div class="poll-q"></div><div class="poll-opts"></div>`;
        else if (d.type === 'graph') inner = `<div class="graph-wrap"><div class="graph-bars"></div><div class="graph-empty">${icon('graph', 'lg')}<div><b>No data yet</b><br>Press Broadcast, then students enter a number.</div></div><div class="graph-stats"></div></div>`;
        else if (d.type === 'spin') inner = `<div class="spin-box"><div class="spin-stage"><div class="spin-pointer"></div><svg class="spin-svg" viewBox="0 0 100 100"></svg></div><button type="button" class="btn btn-soft btn-sm" data-act="spin">${icon('spin', 'sm')}Spin</button><div class="spin-result" aria-live="polite" style="font-weight:700;min-height:1.2em"></div></div>`;

        if (isZoneLike) { const lab = document.createElement('div'); lab.className = 'zone-label'; lab.textContent = d.title || 'Zone'; el.appendChild(lab); }
        const wrap = document.createElement('div'); wrap.className = 'jiggle-wrapper';
        wrap.innerHTML = `
            <div class="i-head">
                <div class="hd-l"><span class="icon-span">${iconHtml}</span><span class="auth-span"></span>${ctl}${res}</div>
                <button type="button" class="menu-trigger" data-act="menu" aria-label="Item options">${icon('more-v', 'sm')}</button>
            </div>
            <div class="i-body">${inner}</div>
            <div class="resize-h" role="button" aria-label="Resize item"></div>`;
        wrap.querySelector('.auth-span').textContent = title;
        el.appendChild(wrap);

        if (isConsensusChild) { /* styled by CSS */ }
        if (d.zoneType === 'breakout') wrap.style.borderColor = safeColor(d.roomColor) || '#8b5cf6';
        if (d.type === 'note' && !isConsensusChild) {
            wrap.style.background = head.col; wrap.style.borderColor = head.bor;
            const h = wrap.querySelector('.i-head'); h.style.background = head.bor + '26'; h.style.color = head.bor;
        }

        // content that came from users is assigned through DOM properties (never parsed as HTML)
        const img = wrap.querySelector('img');
        if (img) { const s = safeImg(d.src); if (s) img.src = s; else img.alt = 'Image unavailable'; }
        const ta = wrap.querySelector('textarea');
        if (ta) {
            ta.value = d.type === 'note' ? (d.src ? (d.text || '') : (d.text || '')) : '';
            ta.addEventListener('input', e => {
                clearTimeout(ta._t);
                ta._t = setTimeout(() => StateManager.updateItem(d.id, { text: clampStr(e.target.value, 2000) }), 500);
            });
            ta.addEventListener('blur', () => { if (ta._t) { clearTimeout(ta._t); ta._t = null; StateManager.updateItem(d.id, { text: clampStr(ta.value, 2000) }); } });
        }
        return el;
    },

    updatePoll: (el, d) => {
        const q = el.querySelector('.poll-q'); if (q && q.textContent !== d.q) q.textContent = d.q || '';
        const box = el.querySelector('.poll-opts'); if (!box) return;
        const opts = Array.isArray(d.opts) ? d.opts : [];
        const sig = JSON.stringify(opts.map(o => [o.lbl, o.v]));
        if (box._sig === sig) return; box._sig = sig;
        const tot = opts.reduce((a, b) => a + (b.v || 0), 0);
        box.textContent = '';
        opts.forEach(o => {
            const row = document.createElement('div'); row.className = 'poll-row';
            const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = (tot ? (o.v / tot) * 100 : 0) + '%';
            const lbl = document.createElement('div'); lbl.className = 'lbl';
            const a = document.createElement('span'); a.textContent = o.lbl; const b = document.createElement('span'); b.textContent = o.v || 0;
            lbl.append(a, b); row.append(fill, lbl); box.appendChild(row);
        });
    },
    updateGraph: (el, d) => {
        const data = (Array.isArray(d.data) ? d.data : []).filter(v => typeof v === 'number' && isFinite(v));
        const bars = el.querySelector('.graph-bars'), empty = el.querySelector('.graph-empty'), stats = el.querySelector('.graph-stats');
        if (!bars) return;
        const sig = JSON.stringify(data); if (bars._sig === sig) return; bars._sig = sig;
        empty.style.display = data.length ? 'none' : 'flex';
        bars.textContent = '';
        const max = Math.max(...data, 1);
        data.slice(-60).forEach(v => {
            const b = document.createElement('div'); b.className = 'graph-bar'; b.style.height = Math.max(2, (Math.abs(v) / max) * 100) + '%';
            const lab = document.createElement('div'); lab.className = 'v'; lab.textContent = Number.isInteger(v) ? v : v.toFixed(1); b.appendChild(lab); bars.appendChild(b);
        });
        if (data.length) {
            const sorted = [...data].sort((a, b) => a - b), n = sorted.length;
            const mean = data.reduce((a, b) => a + b, 0) / n, med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
            const f = x => Number.isInteger(x) ? x : x.toFixed(1);
            stats.textContent = `n ${n}  ·  mean ${f(mean)}  ·  median ${f(med)}  ·  ${f(sorted[0])}–${f(sorted[n - 1])}`;
        } else stats.textContent = '';
    },
    updateSpin: (el, d) => {
        const svg = el.querySelector('.spin-svg'); if (!svg) return;
        const opts = (Array.isArray(d.opts) && d.opts.length ? d.opts : ['A', 'B']).map(String);
        const sig = JSON.stringify(opts);
        if (svg._sig !== sig) {
            svg._sig = sig;
            const colors = ['#fecaca', '#fed7aa', '#fde68a', '#bbf7d0', '#bae6fd', '#c7d2fe'];
            const slice = 360 / opts.length;
            svg.textContent = '';
            const NS = 'http://www.w3.org/2000/svg';
            opts.forEach((o, i) => {
                const a1 = (i * slice) * Math.PI / 180, a2 = ((i + 1) * slice) * Math.PI / 180;
                const x1 = 50 + 50 * Math.cos(a1), y1 = 50 + 50 * Math.sin(a1), x2 = 50 + 50 * Math.cos(a2), y2 = 50 + 50 * Math.sin(a2);
                const path = document.createElementNS(NS, 'path');
                path.setAttribute('d', `M50,50 L${x1},${y1} A50,50 0 ${slice > 180 ? 1 : 0},1 ${x2},${y2} Z`); path.setAttribute('fill', colors[i % 6]); path.setAttribute('stroke', '#fff'); path.setAttribute('stroke-width', '1');
                svg.appendChild(path);
                const mid = (a1 + a2) / 2, tx = 50 + 31 * Math.cos(mid), ty = 50 + 31 * Math.sin(mid);
                const t = document.createElementNS(NS, 'text');
                t.setAttribute('x', tx); t.setAttribute('y', ty); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
                t.setAttribute('font-size', opts.length > 6 ? '5' : '6.5'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', '#1f2937');
                t.setAttribute('transform', `rotate(${(mid * 180 / Math.PI)} ${tx} ${ty})`);
                t.textContent = o.length > 9 ? o.slice(0, 8) + '…' : o; svg.appendChild(t);
            });
        }
        const ang = d.ang || 0;
        if (svg._ang !== ang) {
            svg._ang = ang;
            svg.style.transform = `rotate(${ang}deg)`;
            svg.style.transition = 'transform 3s cubic-bezier(0.2,0.8,0.2,1)';
            const res = el.querySelector('.spin-result');
            if (res) {
                const slice = 360 / opts.length;
                const theta = (((270 - ang) % 360) + 360) % 360;
                const chosen = opts[Math.floor(theta / slice) % opts.length];
                if (ang) { res.textContent = ''; clearTimeout(res._t); res._t = setTimeout(() => { res.textContent = chosen; }, 3100); } else res.textContent = '';
            }
        }
    }
};

/* --- ACTIONS --- */
window.Actions = {
    /** Adds an item to the board at the centre of the visible area. */
    create: (type, sub, at) => {
        const c = at || Viewport.centerWorld();
        const id = genId();
        let it = { id, type, w: 200, h: 150, groupId: null };
        if (type === 'note') { it.sub = sub || 'notice'; it.text = ''; it.w = 220; it.h = 170; }
        if (type === 'zone') { it.w = 320; it.h = 320; it.children = []; it.title = `Zone ${State.items.filter(i => i.type === 'zone' && !i.zoneType).length + 1}`; }
        if (type === 'cer') { it.type = 'zone'; it.zoneType = 'cer'; it.title = "Argument Builder (CER)"; it.w = 600; it.h = 400; it.children = []; }
        if (type === 'consensus') { it.type = 'zone'; it.zoneType = 'consensus'; it.title = "Consensus Model"; it.w = 600; it.h = 520; it.children = []; it.ink = []; }
        if (type === 'breakout') {
            it.type = 'zone'; it.zoneType = 'breakout'; it.title = "Breakout Board"; it.w = 320; it.h = 240;
            it.roomColor = '#8b5cf6'; it.participants = []; it.subItems = []; it.subInk = [];
        }
        if (type === 'poll') { it.q = "Question?"; it.opts = [{ lbl: 'Yes', v: 0 }, { lbl: 'No', v: 0 }]; it.w = 260; it.h = 170; }
        if (type === 'spin') { it.ang = 0; it.opts = ['A', 'B', 'C', 'D']; it.w = 220; it.h = 260; }
        if (type === 'graph') { it.title = "Class Data"; it.data = []; it.w = 320; it.h = 220; }

        const pos = at ? { x: c.x - it.w / 2, y: c.y - it.h / 2 } : Board.getFreeSpace(c.x - it.w / 2, c.y - it.h / 2, it.w, it.h);
        it.x = pos.x; it.y = pos.y;
        StateManager.addItem(it);
        StateManager.setSelection([id]);
        UI.closeAllMenus();
        if (at && it.type === 'note') {            // double-clicking inside a zone drops the note into that zone
            const z = State.items.find(z => z.type === 'zone' && !['breakout', 'consensus'].includes(z.zoneType) && c.x > z.x && c.x < z.x + z.w && c.y > z.y && c.y < z.y + z.h);
            if (z) { HierarchyManager.link(id, z.id); LayoutSystem.update(z.id); }
        }
        if (it.type === 'note') setTimeout(() => Actions.editText(id), 90);
        if (it.type === 'poll') setTimeout(() => Actions.editPoll(id), 140);
        return it;
    },
    /** Enter text-editing mode on a note (notes are dragged by their body until you start editing). */
    editText: (id) => {
        const el = document.getElementById(id), it = State.items.find(i => i.id === id);
        if (!el || !it || it.type !== 'note' || it.locked) return;
        const ta = el.querySelector('textarea'); if (!ta) return;
        document.querySelectorAll('.item.editing').forEach(n => { if (n !== el) n.classList.remove('editing'); });
        el.classList.add('editing');
        ta.focus({ preventScroll: true });
        const v = ta.value; try { ta.setSelectionRange(v.length, v.length); } catch (e) { /* ignore */ }
        ta.addEventListener('blur', () => el.classList.remove('editing'), { once: true });
        // keep the note above the on-screen keyboard
        setTimeout(() => {
            const vv = window.visualViewport; if (!vv) return;
            const r = el.getBoundingClientRect(), limit = vv.height - 16;
            if (r.bottom > limit) StateManager.updateView({ y: State.view.y - (r.bottom - limit + 30) / State.view.z });
            else if (r.top < 70) StateManager.updateView({ y: State.view.y + (70 - r.top) / State.view.z });
        }, 320);
    },
    /** Opens the exit-ticket form, then adds the ticket to the board (or to the breakout room). */
    createExit: (mode, onSubmit) => {
        UI.closeAllMenus();
        const submit = onSubmit || ((q, opts) => Actions.submitExitCreate(mode, q, opts));
        if (mode === 'lw') { submit("List one thing you learned and one thing you wonder.", null); return; }
        Shell.ExitCreate.open(mode, submit);
    },
    submitExitCreate: (mode, promptTxt, opts) => {
        const c = Viewport.centerWorld();
        const it = { id: genId(), type: 'zone', zoneType: 'exit', exitMode: mode, title: 'Exit Ticket', prompt: clampStr(promptTxt, 300), opts: opts, w: 420, h: 320, children: [] };
        const pos = Board.getFreeSpace(c.x - it.w / 2, c.y - it.h / 2, it.w, it.h);
        it.x = pos.x; it.y = pos.y;
        StateManager.addItem(it);
        StateManager.setSelection([it.id]);
    },

    /* ----- menus ----- */
    menuItems: (id) => {
        const selection = State.items.filter(i => State.selection.includes(i.id));
        const item = State.items.find(x => x.id === id) || selection[0];
        if (!item) return [];
        const multi = selection.length > 1;
        const inGroup = !!(selection[0] || item).groupId;
        const items = [];
        if (multi) {
            items.push({ label: inGroup ? 'Ungroup' : 'Group items', icon: 'group', onClick: inGroup ? Actions.ungroupSelection : Actions.groupSelection });
            items.push({ label: 'Arrange…', icon: 'grid', onClick: () => Shell.Arrange.open() });
            if (selection.some(i => i.type === 'note')) items.push({ label: 'Move to zone…', icon: 'zone', onClick: () => Actions.showZoneList() });
            items.push({ label: 'Duplicate', icon: 'copy', kbd: '⌘D', onClick: Actions.duplicate });
            items.push({ label: 'Save as template', icon: 'template', onClick: () => Actions.saveSelectionAsTemplate() });
            items.push({ separator: true });
            items.push({ label: `Delete ${selection.length} items`, icon: 'trash', danger: true, kbd: '⌫', onClick: () => Actions.delete() });
            return items;
        }
        if (item.type === 'note') {
            ['notice', 'wonder', 'idea', 'test'].forEach(k => { if (!item.src) items.push({ label: `${TYPES[k].icon}  ${TYPES[k].lbl}`, checked: item.sub === k, onClick: () => Actions.setType(item.id, k) }); });
            if (!item.src) items.push({ separator: true });
            items.push({ label: 'Move to zone…', icon: 'zone', onClick: () => Actions.showZoneList() });
        } else if (item.type === 'zone') {
            if (!item.zoneType || item.zoneType === 'cer') {
                items.push({ header: 'Run an activity' });
                items.push({ label: 'Vote', icon: 'vote', onClick: () => Network.startActivity('vote') });
                items.push({ label: 'Rank', icon: 'rank', onClick: () => Network.startActivity('sort') });
                items.push({ label: 'Discuss', icon: 'discuss', onClick: () => Network.startActivity('discuss') });
                items.push({ separator: true });
            }
            if (!item.zoneType) items.push({ label: 'Rename', icon: 'pencil', onClick: () => Actions.rename(item.id) });
            if (!item.zoneType || item.zoneType === 'cer') items.push({ label: 'Colour…', icon: 'palette', onClick: () => Shell.ColorPick.open(item.id) });
            if (item.zoneType === 'breakout') items.push({ label: 'Rename', icon: 'pencil', onClick: () => Actions.rename(item.id) });
        } else if (item.type === 'poll') {
            items.push({ label: 'Edit question', icon: 'pencil', onClick: () => Actions.editPoll(item.id) });
            items.push({ label: 'Reset votes', icon: 'reset', onClick: () => Actions.resetPoll(item.id) });
        } else if (item.type === 'spin') {
            items.push({ label: 'Edit options', icon: 'pencil', onClick: () => Actions.editSpin(item.id) });
        } else if (item.type === 'graph') {
            items.push({ label: 'Rename', icon: 'pencil', onClick: () => Actions.renameGraph(item.id) });
            items.push({ label: 'Clear data', icon: 'reset', onClick: () => StateManager.updateItem(item.id, { data: [] }) });
        }
        items.push({ label: item.locked ? 'Unlock' : 'Lock in place', icon: item.locked ? 'unlock' : 'lock', onClick: () => Actions.toggleLock(item.id) });
        items.push({ label: 'Duplicate', icon: 'copy', kbd: '⌘D', onClick: () => { StateManager.setSelection([item.id]); Actions.duplicate(); } });
        items.push({ label: 'Comments', icon: 'comment', onClick: () => Actions.showComments(item.id) });
        if (inGroup) items.push({ label: 'Ungroup', icon: 'ungroup', onClick: Actions.ungroupSelection });
        items.push({ separator: true });
        items.push({ label: 'Delete', icon: 'trash', danger: true, kbd: '⌫', onClick: () => Actions.delete(item.id) });
        return items;
    },
    showContextMenu: (e, id) => {
        const item = State.items.find(x => x.id === id);
        if (!item) return;
        if (!State.selection.includes(id)) Actions.sel(id);
        const anchor = e && e.target && e.target.closest ? (e.target.closest('[data-act="menu"]') || e.target) : { clientX: e.clientX, clientY: e.clientY };
        DQBUI.Menu.open({ anchor, align: 'end', items: Actions.menuItems(id), title: item.type === 'note' ? 'Note' : (item.title || item.type) });
    },
    setZoneColor: (id, color) => {
        const item = State.items.find(i => i.id === id);
        if (item && item.type === 'zone') {
            StateManager.updateItem(id, { color: item.color === color ? null : color });
        }
    },
    saveSelectionAsTemplate: async () => {
        const selectedItems = State.selection.map(id => State.items.find(i => i.id === id)).filter(Boolean);
        if (selectedItems.length === 0) { UI.toast('Select something to save as a template first', 'warn'); return; }
        const name = await DQBUI.Dialog.prompt({ title: 'Save as template', message: 'Give this layout a name so you can reuse it on any board.', placeholder: 'e.g. Exit routine', confirmLabel: 'Save template', icon: 'template' });
        if (!name) return;
        const minX = Math.min(...selectedItems.map(i => i.x)), minY = Math.min(...selectedItems.map(i => i.y));
        const tplItems = selectedItems.map(i => {
            const clone = JSON.parse(JSON.stringify(i));
            clone.x -= minX; clone.y -= minY;
            delete clone.groupId; delete clone.parentZone; clone.text = clone.type === 'note' ? '' : clone.text;
            return clone;
        });
        try { await DB.saveTemplate({ id: genId(), name: clampStr(name, 60), items: tplItems }); UI.toast("Template saved", 'success'); }
        catch (e) { UI.toast("Couldn't save the template on this device", 'error'); }
    },
    showZoneList: () => {
        const zones = State.items.filter(i => i.type === 'zone' && i.zoneType !== 'breakout');
        const items = zones.map(z => ({ label: z.title || 'Zone', icon: 'zone', onClick: () => Actions.moveToZone(z.id) }));
        if (zones.length) items.push({ separator: true });
        items.push({ label: 'New zone from selection', icon: 'plus', onClick: () => Actions.groupToZone() });
        const anchor = $('selbar') && !$('selbar').hidden ? $('selbar') : document.body;
        DQBUI.Menu.open({ anchor, items, title: 'Move to zone', place: 'above' });
    },
    moveToZone: (zoneId) => {
        const items = State.selection.map(id => State.items.find(i => i.id === id)).filter(i => i && i.type === 'note');
        if (items.length === 0) return;
        const oldZoneIds = new Set(items.map(i => i.parentZone).filter(Boolean));
        items.forEach(i => HierarchyManager.link(i.id, zoneId));
        LayoutSystem.update(zoneId);
        oldZoneIds.forEach(id => { if (id !== zoneId) LayoutSystem.update(id); });
    },
    groupToZone: async () => {
        const sel = State.selection.map(id => State.items.find(i => i.id === id)).filter(i => i && i.type === 'note');
        if (sel.length === 0) { UI.toast('Select some notes first', 'warn'); return; }
        const name = await DQBUI.Dialog.prompt({ title: 'New zone', message: 'Name the zone these notes will move into.', value: 'Group', confirmLabel: 'Create zone', icon: 'zone' });
        if (!name) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        sel.forEach(i => { minX = Math.min(minX, i.x); minY = Math.min(minY, i.y); maxX = Math.max(maxX, i.x + i.w); maxY = Math.max(maxY, i.y + i.h); });
        const z = { id: genId(), type: 'zone', title: clampStr(name, 60), x: minX - 20, y: minY - 50, w: (maxX - minX) + 40, h: (maxY - minY) + 70, children: sel.map(i => i.id) };
        StateManager.addItem(z);
        sel.forEach(i => HierarchyManager.link(i.id, z.id));
        LayoutSystem.update(z.id);
        Actions.sel(z.id);
        setTimeout(() => { sel.forEach(i => { const el = $(i.id); if (el) el.classList.add('snap-anim'); }); }, 50);
    },
    groupSelection: () => {
        if (State.selection.length < 2) return;
        const groupId = genId();
        StateManager.updateItems(State.selection.map(id => ({ id, props: { groupId } })));
        UI.toast("Items grouped", 'success');
    },
    ungroupSelection: () => {
        const item = State.items.find(i => State.selection.includes(i.id));
        if (!item || !item.groupId) return;
        const groupId = item.groupId;
        StateManager.updateItems(State.items.filter(i => i.groupId === groupId).map(i => ({ id: i.id, props: { groupId: null } })));
        UI.toast("Items ungrouped");
    },
    setType: (id, sub) => { StateManager.updateItem(id, { sub }); },
    delete: (id) => {
        const targets = id ? [id] : State.selection.slice();
        if (targets.length === 0) return;
        const n = targets.length;
        HierarchyManager.delete(targets);
        UI.closeAllMenus();
        DQBUI.Toast.show(n > 1 ? `${n} items deleted` : 'Deleted', { action: { label: 'Undo', onClick: () => ActionHistory.undo() } });
    },
    sel: (id) => {
        StateManager.setSelection([id]);
        const i = State.items.find(x => x.id === id);
        if (i && i.type === 'zone') {
            if (State.activeSorts[i.id] || State.activity && State.activity.targetId === i.id) {
                if (window.Shell && Shell.Panel.isOpen()) Shell.Panel.showTab('activity');
                Network.updateResults(i.id);
            }
        }
    },
    spin: (id) => {
        const i = State.items.find(x => x.id === id); if (!i) return;
        StateManager.updateItem(id, { ang: (i.ang || 0) + 1440 + Math.floor(Math.random() * 360) });
    },
    rename: async (id) => {
        const i = State.items.find(x => x.id === id); if (!i) return;
        const n = await DQBUI.Dialog.prompt({ title: i.zoneType === 'breakout' ? 'Rename breakout board' : 'Rename zone', value: i.title, confirmLabel: 'Rename', maxLength: 60 });
        if (n) StateManager.updateItem(id, { title: clampStr(n, 60) });
    },
    renameGraph: async (id) => {
        const i = State.items.find(x => x.id === id); if (!i) return;
        const n = await DQBUI.Dialog.prompt({ title: 'Graph title', value: i.title, confirmLabel: 'Save', maxLength: 60 });
        if (n) StateManager.updateItem(id, { title: clampStr(n, 60) });
    },
    editPoll: (id) => {
        const p = State.items.find(x => x.id === id); if (!p) return;
        Shell.PollEdit.open(p);
    },
    resetPoll: (id) => {
        const p = State.items.find(x => x.id === id); if (!p) return;
        StateManager.updateItem(id, { opts: p.opts.map(o => ({ lbl: o.lbl, v: 0 })) });
        UI.toast('Votes reset');
    },
    editSpin: async (id) => {
        const s = State.items.find(x => x.id === id); if (!s) return;
        const v = await DQBUI.Dialog.prompt({ title: 'Spinner options', message: 'One option per line (2 to 12).', value: (s.opts || []).join('\n'), multiline: true, rows: 6, confirmLabel: 'Save', validate: (t) => { const n = t.split('\n').map(x => x.trim()).filter(Boolean).length; return (n < 2 || n > 12) ? 'Enter between 2 and 12 options.' : null; } });
        if (v) StateManager.updateItem(id, { opts: v.split('\n').map(x => clampStr(x.trim(), 40)).filter(Boolean).slice(0, 12), ang: 0 });
    },
    showComments: (id) => { Shell.Comments.open(id); },
    postComment: (id, txt) => {
        txt = clampStr(txt, 500).trim(); if (!id || !txt) return;
        const cmt = { type: 'COMMENT', targetId: id, text: txt, author: 'Teacher', tag: 'feedback' };
        State.comments.push(cmt);
        Network.broadcast(cmt);
        Render.all();
    },
    toggleLock: (id) => {
        const i = State.items.find(x => x.id === id);
        if (i) StateManager.updateItem(id, { locked: !i.locked });
    },
    layoutZone: (zoneId) => { LayoutSystem.update(zoneId); },
    addToZone: (zoneId, noteId) => {
        HierarchyManager.link(noteId, zoneId);
        LayoutSystem.update(zoneId);
    },
    align: (mode) => {
        const allSelected = State.selection.map(id => State.items.find(i => i.id === id)).filter(x=>x);
        if(allSelected.length < 2) return;
        
        const items = allSelected.filter(item => {
            if (item.parentZone && State.selection.includes(item.parentZone)) return false;
            return true;
        });
        
        if(items.length < 2) return;
        
        const updates = [];

        if(mode === 'left') { const min = Math.min(...items.map(i=>i.x)); items.forEach(i=>updates.push({id:i.id, props:{x:min}})); }
        if(mode === 'center') { const avg = items.reduce((a,b)=>a+(b.x+b.w/2),0)/items.length; items.forEach(i=>updates.push({id:i.id, props:{x:avg-i.w/2}})); }
        if(mode === 'right') { const max = Math.max(...items.map(i=>i.x+i.w)); items.forEach(i=>updates.push({id:i.id, props:{x:max-i.w}})); }
        if(mode === 'top') { const min = Math.min(...items.map(i=>i.y)); items.forEach(i=>updates.push({id:i.id, props:{y:min}})); }
        if(mode === 'middle') { const avg = items.reduce((a,b)=>a+(b.y+b.h/2),0)/items.length; items.forEach(i=>updates.push({id:i.id, props:{y:avg-i.h/2}})); }
        if(mode === 'bottom') { const max = Math.max(...items.map(i=>i.y+i.h)); items.forEach(i=>updates.push({id:i.id, props:{y:max-i.h}})); }
        
        StateManager.updateItems(updates);
    },
    distribute: (axis) => {
        const allSelected = State.selection.map(id => State.items.find(i => i.id === id)).filter(x=>x);
        if(allSelected.length < 3) return;

        const items = allSelected.filter(item => {
            if (item.parentZone && State.selection.includes(item.parentZone)) return false;
            return true;
        });

        if(items.length < 3) return;
        const updates = [];

        if(axis === 'h') {
            items.sort((a,b) => a.x - b.x); const min = items[0].x; const max = items[items.length-1].x; const span = max - min; const step = span / (items.length - 1);
            items.forEach((item, i) => { updates.push({id:item.id, props:{x: min + (step * i)}}) });
        } else {
            items.sort((a,b) => a.y - b.y); const min = items[0].y; const max = items[items.length-1].y; const span = max - min; const step = span / (items.length - 1);
            items.forEach((item, i) => { updates.push({id:item.id, props:{y: min + (step * i)}}) });
        }
        StateManager.updateItems(updates);
    },
    matchSize: () => {
        const allSelected = State.selection.map(id => State.items.find(i => i.id === id)).filter(x=>x);
        if(allSelected.length < 2) return;

        const items = allSelected.filter(item => {
            if (item.parentZone && State.selection.includes(item.parentZone)) return false;
            return true;
        });

        const maxW = Math.max(...items.map(i=>i.w)); const maxH = Math.max(...items.map(i=>i.h));
        const updates = items.map(i => ({ id: i.id, props: { w: maxW, h: maxH } }));
        StateManager.updateItems(updates);
    },
    arrangeGrid: () => {
        let items = State.selection.length > 0 
            ? State.selection.map(id => State.items.find(i => i.id === id)).filter(x=>x) 
            : State.items.filter(i => i.type === 'note');
        
        if(items.length === 0) return;

        items = items.filter(item => !item.parentZone || !State.selection.includes(item.parentZone));

        const cols = Math.ceil(Math.sqrt(items.length)); const startX = Math.min(...items.map(i=>i.x)); const startY = Math.min(...items.map(i=>i.y)); const pad = 20;
        items.sort((a,b) => (a.y - b.y) || (a.x - b.x));
        let cx = startX, cy = startY; let rowH = 0;
        const updates = [];
        items.forEach((item, i) => {
            if(i > 0 && i % cols === 0) { cx = startX; cy += rowH + pad; rowH = 0; }
            updates.push({id:item.id, props:{x:cx, y:cy}});
            cx += item.w + pad; if(item.h > rowH) rowH = item.h;
        });
        StateManager.updateItems(updates);
    },
    collectByType: () => {
        const types = ['notice', 'wonder', 'idea', 'test', 'meta', 'sketch'];
        let startX = -State.view.x + 100; let startY = -State.view.y + 100;
        const updates = [];
        types.forEach(t => {
            const items = State.items.filter(i => i.type === 'note' && (i.sub || 'meta') === t);
            if(items.length === 0) return;
            const cols = Math.ceil(Math.sqrt(items.length)); let cx = startX, cy = startY; let rowH = 0, maxGroupW = 0;
            items.forEach((item, i) => {
                if(i > 0 && i % cols === 0) { cx = startX; cy += rowH + 20; rowH = 0; }
                updates.push({id:item.id, props:{x:cx, y:cy}});
                cx += item.w + 20; if(item.h > rowH) rowH = item.h; if(cx - startX > maxGroupW) maxGroupW = cx - startX;
            });
            startX += maxGroupW + 100;
        });
        StateManager.updateItems(updates);
    },
    collectByUser: () => {
        const users = [...new Set(State.items.filter(i=>i.author).map(i=>i.author))];
        let startX = -State.view.x + 100; let startY = -State.view.y + 100;
        const updates = [];
        users.forEach(u => {
            const items = State.items.filter(i => i.author === u);
            if(items.length === 0) return;
            const cols = Math.ceil(Math.sqrt(items.length)); let cx = startX, cy = startY; let rowH = 0, maxGroupW = 0;
            items.forEach((item, i) => {
                if(i > 0 && i % cols === 0) { cx = startX; cy += rowH + 20; rowH = 0; }
                updates.push({id:item.id, props:{x:cx, y:cy}});
                cx += item.w + 20; if(item.h > rowH) rowH = item.h; if(cx - startX > maxGroupW) maxGroupW = cx - startX;
            });
            startX += maxGroupW + 100;
        });
        StateManager.updateItems(updates);
    },
    bringFront: () => { 
        const updates = State.selection.map(id => {
            const i = State.items.find(x=>x.id===id);
            return i ? { id, props: { z: (i.z || 10) + 1 } } : null;
        }).filter(Boolean);
        StateManager.updateItems(updates);
    },
    sendBack: () => { 
        const updates = State.selection.map(id => {
            const i = State.items.find(x=>x.id===id);
            return i ? { id, props: { z: Math.max(1, (i.z || 10) - 1) } } : null;
        }).filter(Boolean);
        StateManager.updateItems(updates);
    },
    duplicate: () => {
        const sel = State.selection.map(id => State.items.find(x => x.id === id)).filter(Boolean);
        if (!sel.length) return;
        const ids = new Set(sel.map(i => i.id));
        sel.forEach(i => { if (i.type === 'zone' && i.children) i.children.forEach(cid => ids.add(cid)); });
        const originals = [...ids].map(id => State.items.find(x => x.id === id)).filter(Boolean);
        const map = {}; originals.forEach(o => { map[o.id] = genId(); });
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        originals.forEach(o => { minX = Math.min(minX, o.x); minY = Math.min(minY, o.y); maxX = Math.max(maxX, o.x + o.w); maxY = Math.max(maxY, o.y + o.h); });
        const pos = Board.getFreeSpace(minX + 40, minY + 40, maxX - minX, maxY - minY);
        const dx = pos.x - minX, dy = pos.y - minY;
        const copies = originals.map(o => {
            const c = JSON.parse(JSON.stringify(o));
            c.id = map[o.id]; c.x += dx; c.y += dy; c.groupId = null; delete c.isOpen; delete c.pending;
            if (c.children) c.children = c.children.map(cid => map[cid]).filter(Boolean);
            if (c.parentZone) { if (map[c.parentZone]) c.parentZone = map[c.parentZone]; else delete c.parentZone; }
            return c;
        });
        StateManager.addItems(copies);
        StateManager.setSelection(sel.map(o => map[o.id]));
    }
};

/* --- MODES DEFINITIONS --- */
window.Modes = {
    Pan: {
        down: (e) => { State.drag = { mode:'pan', sx:e.clientX, sy:e.clientY, vx:State.view.x, vy:State.view.y }; $('viewport').classList.add('panning'); UI.closeAllMenus(); },
        move: (e) => { StateManager.updateView({ x: State.drag.vx + (e.clientX - State.drag.sx)/State.view.z, y: State.drag.vy + (e.clientY - State.drag.sy)/State.view.z }); },
        up: () => { $('viewport').classList.remove('panning'); }
    },
    Move: {
        down: (e, id) => {
            const item = State.items.find(i => i.id === id);
            if (!item || item.locked) return;

            AutoScroll.start();

            const r = $('viewport').getBoundingClientRect();
            const wx = (e.clientX - r.left) / State.view.z - State.view.x;
            const wy = (e.clientY - r.top) / State.view.z - State.view.y;

            const moveTargetIds = new Set();
            if (item.groupId) {
                State.items.forEach(i => { if (i.groupId === item.groupId) moveTargetIds.add(i.id); });
            } else if (State.selection.includes(id) && State.selection.length > 1) {
                State.selection.forEach(selId => moveTargetIds.add(selId));
            } else {
                moveTargetIds.add(id);
            }

            const finalTargetIds = new Set(moveTargetIds);
            moveTargetIds.forEach(targetId => {
                HierarchyManager.getDescendants(targetId).forEach(descId => finalTargetIds.add(descId));
            });

            const moveTargets = Array.from(finalTargetIds)
                .map(iId => State.items.find(i => i.id === iId)).filter(Boolean);

            State.drag = {
                mode: 'move', primaryId: id,
                moveTargets: moveTargets.map(i => ({ id: i.id, startX: i.x, startY: i.y })),
                mouseStartX: wx, mouseStartY: wy, sx0: e.clientX, sy0: e.clientY, moved: false,
                hoverZoneId: null, targetIndex: -1
            };
            // visual changes (lift, no-transition) only start once the pointer actually moves
        },
        move: (e) => {
            const d = State.drag;
            if (!d) return;
            if (!d.moved) {
                if (Math.hypot(e.clientX - d.sx0, e.clientY - d.sy0) < 5) return;   // dead-zone: a tap is not a drag
                d.moved = true;
                d.moveTargets.forEach(t => {
                    const el = document.getElementById(t.id);
                    if (el) { el.classList.add('no-transition'); el.style.zIndex = (parseInt(el.style.zIndex) || 10) + 10000; }
                });
            }

            AutoScroll.check(e);

            const primaryItem = State.items.find(i => i.id === d.primaryId);
            if (!primaryItem) return;

            const r = $('viewport').getBoundingClientRect();
            const wx = (e.clientX - r.left) / State.view.z - State.view.x;
            const wy = (e.clientY - r.top) / State.view.z - State.view.y;
            let dx = wx - d.mouseStartX;
            let dy = wy - d.mouseStartY;

            const primaryTarget = d.moveTargets.find(t => t.id === d.primaryId);
            
            const potentialX = primaryTarget.startX + dx;
            const potentialY = primaryTarget.startY + dy;

            const cx = potentialX + primaryItem.w / 2;
            const cy = potentialY + primaryItem.h / 2;
            const hitZone = (primaryItem.type !== 'zone') && State.items.find(z => z.type === 'zone' && z.id !== primaryItem.id && cx > z.x && cx < z.x + z.w && cy > z.y && cy < z.y + z.h);

            if (hitZone) {
                SnapSystem.clearGuides();
            } else {
                const snapResult = SnapSystem.getSnap(primaryItem, potentialX, potentialY);
                dx = snapResult.x - primaryTarget.startX;
                dy = snapResult.y - primaryTarget.startY;
                SnapSystem.drawGuides();
            }

            d.moveTargets.forEach(target => {
                const item = State.items.find(i => i.id === target.id);
                if (item) {
                    item.x = target.startX + dx;
                    item.y = target.startY + dy;
                    const el = document.getElementById(item.id);
                    if (el) el.style.transform = `translate(${item.x}px, ${item.y}px)`;
                }
            });

            if (primaryItem.type !== 'zone') {
                const currentCx = primaryItem.x + primaryItem.w / 2;
                const currentCy = primaryItem.y + primaryItem.h / 2;
                const currentHitZone = State.items.find(z => z.type === 'zone' && z.id !== primaryItem.id && currentCx > z.x && currentCx < z.x + z.w && currentCy > z.y && currentCy < z.y + z.h);

                if (d.hoverZoneId && (!currentHitZone || currentHitZone.id !== d.hoverZoneId)) {
                    document.getElementById(d.hoverZoneId)?.classList.remove('drag-over');
                    LayoutSystem.update(d.hoverZoneId);
                    d.hoverZoneId = null; d.targetIndex = -1;
                    $('ghost-layer').innerHTML = '';
                    // Clear expand timer when leaving zone
                    if (d._expandTimer) { clearTimeout(d._expandTimer); d._expandTimer = null; }
                }
                if (currentHitZone) {
                    d.hoverZoneId = currentHitZone.id;
                    document.getElementById(currentHitZone.id).classList.add('drag-over');
                    
                    if (currentHitZone.zoneType === 'consensus') {
                         d.targetIndex = -1; 
                         $('ghost-layer').innerHTML = '';
                    } else {
                        const newIndex = LayoutSystem.getIndex(currentHitZone, currentCx, currentCy, primaryItem.id);
                        if (d.targetIndex !== newIndex) {
                            d.targetIndex = newIndex;
                            const virt = { ...primaryItem, _isVirtual: true, _dragX: primaryItem.x, _dragY: primaryItem.y };
                            LayoutSystem.update(currentHitZone.id, virt, newIndex);
                        }
                    }

                    // Auto-expand zone when item is held near right or bottom edge for 600ms
                    const nearRight = currentCx > (currentHitZone.x + currentHitZone.w - primaryItem.w * 0.8);
                    const nearBottom = (primaryItem.y + primaryItem.h) > (currentHitZone.y + currentHitZone.h - 30);
                    if ((nearRight || nearBottom) && !d._expandTimer) {
                        d._expandTimer = setTimeout(() => {
                            d._expandTimer = null;
                            const zone = State.items.find(i => i.id === d.hoverZoneId);
                            if (!zone) return;
                            const updates = {};
                            if (nearRight) updates.w = zone.w + primaryItem.w + LayoutSystem.gap;
                            if (nearBottom) updates.h = zone.h + primaryItem.h + LayoutSystem.gap;
                            StateManager.updateItem(zone.id, updates, { silent: true });
                            LayoutSystem.update(zone.id);
                            UI.toast("↔ Zone expanded");
                        }, 600);
                    } else if (!nearRight && !nearBottom && d._expandTimer) {
                        clearTimeout(d._expandTimer);
                        d._expandTimer = null;
                    }
                }
            }
        },
        up: (e) => {
            const d = State.drag;
            if(!d) return;

            AutoScroll.stop();
            if (!d.moved) { State.drag = null; return; }   // plain tap: nothing moved, nothing to save or broadcast

            if (d._expandTimer) { clearTimeout(d._expandTimer); d._expandTimer = null; }
            SnapSystem.clearGuides();
            $('ghost-layer').innerHTML = '';
            document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));

            d.moveTargets.forEach(target => {
                const el = document.getElementById(target.id);
                if (el) {
                    el.classList.remove('no-transition');
                    el.style.zIndex = (parseInt(el.style.zIndex) || 10010) - 10000;
                }
            });

            const updatedItems = d.moveTargets.map(t => State.items.find(i => i.id === t.id)).filter(Boolean);
            const primaryItem = updatedItems.find(i => i.id === d.primaryId);

            if (primaryItem && primaryItem.type !== 'zone' && !d.hoverZoneId) {
                const cx = primaryItem.x + primaryItem.w / 2;
                const cy = primaryItem.y + primaryItem.h / 2;
                const finalHitZone = State.items.find(z => z.type === 'zone' && z.id !== primaryItem.id && cx > z.x && cx < z.x + z.w && cy > z.y && cy < z.y + z.h);
                if (finalHitZone) {
                    d.hoverZoneId = finalHitZone.id;
                    d.targetIndex = LayoutSystem.getIndex(finalHitZone, cx, cy, primaryItem.id);
                }
            }

            if (d.hoverZoneId) {
                const zone = State.items.find(i => i.id === d.hoverZoneId);
                if (zone) {
                    const itemsToLink = updatedItems.filter(i => i && i.type !== 'zone');
                    // Capture old parent zones before linking so we can reflow them
                    const oldZoneIds = new Set(itemsToLink.map(i => i.parentZone).filter(Boolean));
                    const primaryItemToLink = itemsToLink.find(i => i.id === d.primaryId);
                    
                    if (primaryItemToLink) {
                        HierarchyManager.link(primaryItemToLink.id, d.hoverZoneId, d.targetIndex);
                        itemsToLink.forEach(item => {
                            if (item.id !== d.primaryId) HierarchyManager.link(item.id, d.hoverZoneId);
                        });
                    } else {
                        itemsToLink.forEach(item => HierarchyManager.link(item.id, d.hoverZoneId));
                    }
                    LayoutSystem.update(d.hoverZoneId);
                    // Reflow any zones items were moved away from
                    oldZoneIds.forEach(id => { if (id !== d.hoverZoneId) LayoutSystem.update(id); });
                }
            } else {
                d.moveTargets.forEach(target => {
                    const item = State.items.find(i => i.id === target.id);
                    if (item && item.parentZone) {
                        const oldZone = State.items.find(z => z.id === item.parentZone);
                        if (oldZone && !d.moveTargets.find(t => t.id === oldZone.id)) {
                            const oldParentId = item.parentZone;
                            HierarchyManager.unlink(item.id);
                            LayoutSystem.update(oldParentId);
                        }
                    }
                });
            }
            
            const updates = updatedItems.map(i => ({ id: i.id, props: { x: i.x, y: i.y } }));
            StateManager.updateItems(updates);

            State.drag = null;
        }
    },
    Resize: {
        down: (e, id) => {
            const r = $('viewport').getBoundingClientRect();
            const x = (e.clientX - r.left)/State.view.z - State.view.x;
            const y = (e.clientY - r.top)/State.view.z - State.view.y;
            const item = State.items.find(i=>i.id===id);
            State.drag = { mode:'resize', id:id, sx:x, sy:y, ow:item.w, oh:item.h };
        },
        move: (e) => {
            const r = $('viewport').getBoundingClientRect();
            const x = (e.clientX - r.left)/State.view.z - State.view.x;
            const y = (e.clientY - r.top)/State.view.z - State.view.y;
            const d = State.drag;
            const i = State.items.find(x=>x.id===d.id);
            
            const newW = Math.max(150, d.ow + (x - d.sx)); 
            const newH = Math.max(150, d.oh + (y - d.sy));
            
            StateManager.updateItem(i.id, { w: newW, h: newH }, { silent: true });
            
            if (i.parentZone) {
                LayoutSystem.update(i.parentZone);
            }
            // If the item being resized is a zone, reflow its children
            if (i.type === 'zone') {
                LayoutSystem.update(i.id);
            }
        },
        up: (e) => { 
            const i = State.items.find(x=>x.id===State.drag.id);
            StateManager.updateItem(i.id, { w: i.w, h: i.h });
            
            if(i && i.parentZone) {
                LayoutSystem.update(i.parentZone);
            }
            // If a zone was resized, reflow its children
            if(i && i.type === 'zone') {
                LayoutSystem.update(i.id);
            }
            State.drag = null;
        }
    },
    Marquee: {
        down: (e) => {
            const r = $('viewport').getBoundingClientRect();
            State.drag = { mode:'box', sx: e.clientX - r.left, sy: e.clientY - r.top };
            if(!e.shiftKey) { StateManager.setSelection([]); UI.closeAllMenus(); }
        },
        move: (e) => {
            const r = $('viewport').getBoundingClientRect();
            const relX = e.clientX - r.left; const relY = e.clientY - r.top;
            const d = State.drag;
            const l = Math.min(relX, d.sx), t = Math.min(relY, d.sy), w = Math.abs(relX - d.sx), h = Math.abs(relY - d.sy);
            const m = $('marquee');
            m.style.left = l + 'px'; m.style.top = t + 'px'; m.style.width = w + 'px'; m.style.height = h + 'px'; m.style.display='block';
            const globalL = l + r.left, globalT = t + r.top, globalR = globalL + w, globalB = globalT + h;
            
            const newlySelected = [];
            State.items.forEach(i => {
                const el = document.getElementById(i.id); if(!el) return;
                const rect = el.getBoundingClientRect();
                if (globalL < rect.right && globalR > rect.left && globalT < rect.bottom && globalB > rect.top) {
                    newlySelected.push(i.id);
                }
            });
            StateManager.setSelection([...new Set([...(e.shiftKey ? State.selection : []), ...newlySelected])]);
        },
        up: (e) => { $('marquee').style.display='none'; State.drag = null; }
    },
    Draw: {
        down: (e) => {
            const r = $('viewport').getBoundingClientRect();
            const x = (e.clientX - r.left)/State.view.z - State.view.x;
            const y = (e.clientY - r.top)/State.view.z - State.view.y;
            State.drag = { mode:'draw' }; InkManager.start(x, y);
        },
        move: (e) => {
            const r = $('viewport').getBoundingClientRect();
            const x = (e.clientX - r.left)/State.view.z - State.view.x;
            const y = (e.clientY - r.top)/State.view.z - State.view.y;
            InkManager.move(x, y);
        },
        up: () => { InkManager.end(); State.drag = null; }
    },
    Eraser: {
        down: (e) => { State.drag = { mode:'eraser' }; },
        move: (e) => {
            const r = $('viewport').getBoundingClientRect();
            const x = (e.clientX - r.left)/State.view.z - State.view.x;
            const y = (e.clientY - r.top)/State.view.z - State.view.y;
            const { changed, newInk } = InkManager.eraseAt(x, y, State.ink);
            if (changed) {
                StateManager.setInk(newInk);
            }
        },
        up: () => { State.drag = null; }
    },
    Laser: {
        down: (e) => { State.drag = { mode:'laser' }; Modes.Laser.move(e); },
        move: (e) => {
            const r = $('viewport').getBoundingClientRect();
            const x = e.clientX - r.left; const y = e.clientY - r.top;
            const dot = document.createElement('div');
            dot.className = 'laser-dot'; dot.style.left = x + 'px'; dot.style.top = y + 'px';
            $('viewport').appendChild(dot);
            setTimeout(() => dot.remove(), 600);
            if (Network.peer) { const w = Viewport.toWorld(e.clientX, e.clientY); Network.broadcast({ type:'LASER', x: w.x, y: w.y }); }
        },
        up: () => { State.drag = null; }
    }
};

/* --- INPUT CONTROLLER (Pointer Events: one code path for mouse, pen and touch) --- */
window.InputController = {
    pointers: new Map(), pinch: null,
    tool: () => State.spaceDown ? 'pan' : State.tool,
    init: () => {
        const v = $('viewport');
        v.addEventListener('pointerdown', InputController.down);
        window.addEventListener('pointermove', InputController.move, { passive: false });
        window.addEventListener('pointerup', InputController.up);
        window.addEventListener('pointercancel', InputController.up);
        v.addEventListener('wheel', InputController.wheel, { passive: false });
        v.addEventListener('dblclick', InputController.dblclick);
        window.addEventListener('keydown', InputController.keydown);
        window.addEventListener('keyup', InputController.keyup);
        window.addEventListener('blur', () => { State.spaceDown = false; });
        window.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
    },
    down: (e) => {
        if (Workspace.mode !== 'board') return;
        const t = e.target;
        if (t.closest('input, textarea, select, [data-act]')) return;
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        InputController.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (InputController.pointers.size === 2) { InputController.beginPinch(); return; }
        if (InputController.pointers.size > 2) return;
        UI.closeAllMenus();
        // leaving text editing mode when pressing elsewhere
        document.querySelectorAll('.item.editing').forEach(n => { if (!t.closest('.item.editing')) { n.classList.remove('editing'); const ta = n.querySelector('textarea'); if (ta) ta.blur(); } });

        if (InkManager.selectedId && !t.closest('#ink-layer')) InkManager.deselectStroke();
        const itemEl = t.closest('.item');
        const handle = t.closest('.resize-h');
        const tool = InputController.tool();
        const evt = e;
        const capture = () => { try { $('viewport').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } };

        if (e.button === 1 || e.button === 2) {
            Modes.Pan.down(evt); State.drag.secondary = e.button === 2; State.drag.itemId = itemEl ? itemEl.id : null; capture(); return;
        }
        if (tool === 'pan' || tool === 'select') {
            if (handle && itemEl) { Modes.Resize.down(evt, itemEl.id); capture(); return; }
            if (itemEl) {
                const wasSelected = State.selection.includes(itemEl.id);
                if (!e.shiftKey && !e.metaKey && !e.ctrlKey) { if (!wasSelected) StateManager.setSelection([itemEl.id]); }
                else {
                    const newSel = wasSelected ? State.selection.filter(id => id !== itemEl.id) : [...State.selection, itemEl.id];
                    StateManager.setSelection(newSel);
                }
                Modes.Move.down(evt, itemEl.id);
                if (State.drag) { State.drag.wasSelected = wasSelected && State.selection.length === 1; capture(); }
                return;
            }
            const useBox = tool === 'select' && (e.pointerType !== 'touch' || State.multiSelect);
            if (useBox) Modes.Marquee.down(evt); else Modes.Pan.down(evt);
            capture(); return;
        }
        if (tool === 'draw') { Modes.Draw.down(evt); capture(); return; }
        if (tool === 'eraser') { Modes.Eraser.down(evt); capture(); return; }
        if (tool === 'laser') { Modes.Laser.down(evt); capture(); return; }
    },
    beginPinch: () => {
        // abandon whatever single-finger gesture was in progress
        const d = State.drag;
        if (d) {
            if (d.mode === 'draw') { InkManager.currentPath = []; InkManager.renderTemp(); }
            else if (d.mode === 'move') { Modes.Move.up({}); }
            else if (d.mode === 'resize') Modes.Resize.up();
            else if (d.mode === 'box') Modes.Marquee.up();
            else if (d.mode === 'pan') Modes.Pan.up();
            State.drag = null; AutoScroll.stop();
        }
        const pts = [...InputController.pointers.values()];
        const r = $('viewport').getBoundingClientRect();
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        InputController.pinch = {
            dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)), z: State.view.z,
            wx: (cx - r.left) / State.view.z - State.view.x, wy: (cy - r.top) / State.view.z - State.view.y
        };
    },
    move: (e) => {
        if (Workspace.mode !== 'board') return;
        if (InputController.pointers.has(e.pointerId)) InputController.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (InputController.pinch && InputController.pointers.size >= 2) {
            e.preventDefault();
            const pts = [...InputController.pointers.values()], p = InputController.pinch, r = $('viewport').getBoundingClientRect();
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
            const nz = Math.max(0.1, Math.min(5, p.z * dist / p.dist));
            StateManager.updateView({ z: nz, x: (cx - r.left) / nz - p.wx, y: (cy - r.top) / nz - p.wy });
            return;
        }
        if (!State.drag) return;
        if (e.cancelable) e.preventDefault();
        const m = State.drag.mode;
        if (m === 'pan') Modes.Pan.move(e);
        else if (m === 'move') Modes.Move.move(e);
        else if (m === 'resize') Modes.Resize.move(e);
        else if (m === 'box') Modes.Marquee.move(e);
        else if (m === 'draw') Modes.Draw.move(e);
        else if (m === 'eraser') Modes.Eraser.move(e);
        else if (m === 'laser') Modes.Laser.move(e);
    },
    up: (e) => {
        if (Workspace.mode !== 'board' && !InputController.pointers.size) return;
        InputController.pointers.delete(e.pointerId);
        if (InputController.pinch) { if (InputController.pointers.size < 2) InputController.pinch = null; return; }
        if (!State.drag) return;
        const d = State.drag, m = d.mode;
        if (m === 'pan') {
            const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
            if (dist < 5) {
                if (d.secondary) {
                    if (d.itemId) { if (!State.selection.includes(d.itemId)) Actions.sel(d.itemId); DQBUI.Menu.open({ anchor: { clientX: e.clientX, clientY: e.clientY }, items: Actions.menuItems(d.itemId) }); }
                    else Shell.canvasMenu(e);
                } else { StateManager.setSelection([]); InkManager.deselectStroke(); UI.closeAllMenus(); }
            }
            Modes.Pan.up();
        }
        else if (m === 'move') {
            const wasSelected = d.wasSelected, id = d.primaryId, moved = d.moved;
            Modes.Move.up(e);
            // tapping an already-selected note starts editing its text
            if (!moved && wasSelected && e.pointerType !== 'mouse') Actions.editText(id);
        }
        else if (m === 'resize') Modes.Resize.up();
        else if (m === 'box') Modes.Marquee.up();
        else if (m === 'draw') Modes.Draw.up();
        else if (m === 'eraser') Modes.Eraser.up();
        else if (m === 'laser') Modes.Laser.up();
        if (State.drag) State.drag = null;
    },
    dblclick: (e) => {
        if (Workspace.mode !== 'board') return;
        const itemEl = e.target.closest('.item');
        if (itemEl) {
            const it = State.items.find(i => i.id === itemEl.id);
            if (it && it.type === 'note' && !it.src) Actions.editText(it.id);
            else if (it && it.type === 'zone' && !it.zoneType) Actions.rename(it.id);
            return;
        }
        if (e.target.closest('[data-act], input, textarea')) return;
        if (State.tool !== 'select' && State.tool !== 'pan') return;
        const w = Viewport.toWorld(e.clientX, e.clientY);
        Actions.create('note', 'notice', w);
    },
    wheel: (e) => {
        e.preventDefault();
        let dx = e.deltaX, dy = e.deltaY;
        if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= window.innerHeight; dy *= window.innerHeight; }
        const zoomMode = (localStorage.getItem('dqb_wheel') || 'pan') === 'zoom';
        if (e.ctrlKey || e.metaKey || zoomMode) {
            const k = e.ctrlKey ? 0.012 : 0.0016;   // trackpad pinch arrives as ctrl+wheel with small deltas
            InputController.zoom(Math.exp(-dy * k), e.clientX, e.clientY);
        } else {
            if (e.shiftKey && !dx) { dx = dy; dy = 0; }
            StateManager.updateView({ x: State.view.x - dx / State.view.z, y: State.view.y - dy / State.view.z });
        }
    },
    zoom: (factor, cx, cy) => {
        const oz = State.view.z; let nz = oz * factor; nz = Math.max(0.1, Math.min(nz, 5));
        const r = $('viewport').getBoundingClientRect();
        const px = cx - r.left, py = cy - r.top;
        const wx = (px / oz) - State.view.x; const wy = (py / oz) - State.view.y;
        StateManager.updateView({ x: (px / nz) - wx, y: (py / nz) - wy, z: nz });
    },
    nudge: (dx, dy) => {
        if (!State.selection.length) return;
        const ids = new Set(State.selection);
        State.selection.forEach(id => HierarchyManager.getDescendants(id).forEach(c => ids.add(c)));
        StateManager.updateItems([...ids].map(id => { const i = State.items.find(x => x.id === id); return i && !i.locked ? { id, props: { x: i.x + dx, y: i.y + dy } } : null; }).filter(Boolean));
    },
    keydown: (e) => {
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
            if (e.key === 'Escape' && tag === 'TEXTAREA') { e.target.blur(); }
            return;
        }
        if (DQBUI.Overlay.count() > 0) return;
        const mod = e.metaKey || e.ctrlKey;
        const k = e.key.toLowerCase();
        if (Workspace.mode === 'breakout') { Breakout._keydown(e); return; }
        if (Workspace.mode === 'consensus') { Consensus._keydown(e); return; }

        if (e.code === 'Space') { e.preventDefault(); if (!State.spaceDown) { State.spaceDown = true; $('viewport').classList.add('panning'); } return; }
        if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) ActionHistory.redo(); else ActionHistory.undo(); return; }
        if (mod && k === 'y') { e.preventDefault(); ActionHistory.redo(); return; }
        if (mod && k === 'd') { e.preventDefault(); Actions.duplicate(); return; }
        if (mod && k === 'a') { e.preventDefault(); StateManager.setSelection(State.items.map(i => i.id)); return; }
        if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) Actions.ungroupSelection(); else Actions.groupSelection(); return; }
        if (mod) return;
        if (e.key === 'Escape') {
            if (InkManager.selectedId) InkManager.deselectStroke();
            else if (State.selection.length) StateManager.setSelection([]);
            else if (State.tool === 'draw' || State.tool === 'eraser' || State.tool === 'laser') window.setTool(Shell.defaultTool());
            return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            if (InkManager.selectedId) InkManager.deleteSelected(); else Actions.delete();
            return;
        }
        if (e.key.startsWith('Arrow') && State.selection.length) {
            e.preventDefault(); const s = e.shiftKey ? 50 : 10;
            InputController.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); return;
        }
        if (e.key === '?' || (e.key === '/' && e.shiftKey)) { Shell.Shortcuts.open(); return; }
        if (e.key === '+' || e.key === '=') { Viewport.zoomBy(1.2); return; }
        if (e.key === '-' || e.key === '_') { Viewport.zoomBy(1 / 1.2); return; }
        if (e.key === '0') { Viewport.animateTo({ x: State.view.x, y: State.view.y, z: 1 }); return; }
        if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) { Viewport.fit(); return; }
        switch (k) {
            case 'v': window.setTool('select'); break;
            case 'h': window.setTool('pan'); break;
            case 'p': case 'd': window.setTool('draw'); break;
            case 'e': window.setTool('eraser'); break;
            case 'l': window.setTool('laser'); break;
            case 'n': Actions.create('note', 'notice'); break;
            case 'a': Shell.Insert.toggle(); break;
            case 'm': Shell.toggleMinimap(); break;
        }
    },
    keyup: (e) => { if (e.code === 'Space') { State.spaceDown = false; $('viewport').classList.toggle('panning', State.tool === 'pan'); } }
};

/* --- MAGNETIC SNAP SYSTEM --- */
window.SnapSystem = {
    threshold: 10,
    activeGuides: [],

    getSnap: (item, newX, newY) => {
        const threshold = SnapSystem.threshold / State.view.z;
        let finalX = newX, finalY = newY;
        SnapSystem.activeGuides = [];

        const itemBounds = {
            left: newX, right: newX + item.w, top: newY, bottom: newY + item.h,
            cx: newX + item.w / 2, cy: newY + item.h / 2
        };

        const otherItems = State.items.filter(i => i.id !== item.id && !State.drag.moveTargets.find(t => t.id === i.id) && !i.parentZone);

        let bestSnapX = { dist: Infinity }, bestSnapY = { dist: Infinity };

        otherItems.forEach(other => {
            const otherBounds = {
                left: other.x, right: other.x + other.w, top: other.y, bottom: other.y + other.h,
                cx: other.x + other.w / 2, cy: other.y + other.h / 2
            };
            
            ['left', 'right'].forEach(p1 => {
                ['left', 'right'].forEach(p2 => {
                    const dist = Math.abs(itemBounds[p1] - otherBounds[p2]);
                    if (dist < threshold && dist < bestSnapX.dist) {
                        bestSnapX = { dist, val: otherBounds[p2] - (itemBounds[p1] - newX), guide: otherBounds[p2] };
                    }
                });
            });

            const distCx = Math.abs(itemBounds.cx - otherBounds.cx);
            if (distCx < threshold && distCx < bestSnapX.dist) {
                bestSnapX = { dist: distCx, val: otherBounds.cx - (itemBounds.cx - newX), guide: otherBounds.cx };
            }

            ['top', 'bottom'].forEach(p1 => {
                ['top', 'bottom'].forEach(p2 => {
                    const dist = Math.abs(itemBounds[p1] - otherBounds[p2]);
                    if (dist < threshold && dist < bestSnapY.dist) {
                        bestSnapY = { dist, val: otherBounds[p2] - (itemBounds[p1] - newY), guide: otherBounds[p2] };
                    }
                });
            });

            const distCy = Math.abs(itemBounds.cy - otherBounds.cy);
            if (distCy < threshold && distCy < bestSnapY.dist) {
                bestSnapY = { dist: distCy, val: otherBounds.cy - (itemBounds.cy - newY), guide: otherBounds.cy };
            }
        });

        if (bestSnapX.dist < Infinity) {
            finalX = bestSnapX.val;
            SnapSystem.activeGuides.push({ type: 'v', pos: bestSnapX.guide });
        }
        if (bestSnapY.dist < Infinity) {
            finalY = bestSnapY.val;
            SnapSystem.activeGuides.push({ type: 'h', pos: bestSnapY.guide });
        }

        return { x: finalX, y: finalY };
    },

    drawGuides: () => {
        const layer = $('ghost-layer');
        SnapSystem.clearGuides(true);
        SnapSystem.activeGuides.forEach(g => {
            const el = document.createElement('div');
            el.className = `snap-guide ${g.type}`;
            if (g.type === 'v') {
                el.style.left = `${g.pos}px`;
                el.style.top = '0';
                el.style.height = '10000px'; 
                el.style.transform = 'translateY(-5000px)';
            } else {
                el.style.top = `${g.pos}px`;
                el.style.left = '0';
                el.style.width = '10000px';
                el.style.transform = 'translateX(-5000px)';
            }
            layer.appendChild(el);
        });
    },

    clearGuides: (instant = false) => {
        const layer = $('ghost-layer');
        Array.from(layer.querySelectorAll('.snap-guide')).forEach(g => g.remove());
    }
};


/* --- INPUT SANITISING (everything that arrives from the network or a file is untrusted) --- */
window.Sanitize = {
    num: (v, d, lim) => { v = Number(v); lim = lim || 1e6; return Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : (d || 0); },
    strokes: (arr, max) => (Array.isArray(arr) ? arr.slice(0, max || 600) : []).map(s => {
        if (!s || !Array.isArray(s.points)) return null;
        const pts = s.points.slice(0, 6000).map(p => ({ x: Sanitize.num(p && p.x), y: Sanitize.num(p && p.y) }));
        if (pts.length < 2) return null;
        return { id: safeId(s.id) || genId(), points: pts, color: safeColor(s.color) || '#000000', width: Math.max(1, Math.min(40, Sanitize.num(s.width, 4))), highlight: !!s.highlight, arrow: !!s.arrow };
    }).filter(Boolean),
    item: (r, depth) => {
        depth = depth || 0;
        if (!r || typeof r !== 'object') return null;
        const type = ['note', 'zone', 'poll', 'graph', 'spin'].includes(r.type) ? r.type : null;
        const id = safeId(r.id);
        if (!type || !id) return null;
        const o = { id, type, x: Sanitize.num(r.x), y: Sanitize.num(r.y), w: Math.min(4000, Math.max(40, Sanitize.num(r.w, 200, 4000))), h: Math.min(4000, Math.max(40, Sanitize.num(r.h, 150, 4000))), groupId: safeId(r.groupId) || null };
        if (safeId(r.parentZone)) o.parentZone = r.parentZone;
        if (r.locked) o.locked = true;
        if (Number.isFinite(r.z)) o.z = Math.max(1, Math.min(9999, r.z | 0));
        if (type === 'note') {
            o.sub = ['notice', 'wonder', 'idea', 'test', 'meta', 'sketch', 'claim', 'evidence', 'reasoning'].includes(r.sub) ? r.sub : 'notice';
            o.text = clampStr(r.text, 2000); o.votes = 0;
            if (r.author) o.author = clampStr(r.author, 24);
            if (safeId(r.sid)) o.sid = r.sid;
            if (r.src) { const s = safeImg(r.src); if (s) { o.src = s; o.sub = 'sketch'; } }
        } else if (type === 'zone') {
            o.title = clampStr(r.title || 'Zone', 80);
            o.children = (Array.isArray(r.children) ? r.children : []).map(safeId).filter(Boolean).slice(0, 500);
            if (['cer', 'consensus', 'exit', 'breakout'].includes(r.zoneType)) o.zoneType = r.zoneType;
            if (safeColor(r.color)) o.color = r.color;
            if (r.isOpen) o.isOpen = true;
            if (o.zoneType === 'exit') {
                const m = r.exitMode || r.mode; o.exitMode = ['short', 'smiley', 'mc', 'multi', 'lw'].includes(m) ? m : 'short';
                o.prompt = clampStr(r.prompt, 300); o.opts = Array.isArray(r.opts) ? r.opts.map(x => clampStr(x, 80)).filter(Boolean).slice(0, 12) : null;
            }
            if (o.zoneType === 'consensus') o.ink = Sanitize.strokes(r.ink);
            if (o.zoneType === 'breakout') {
                o.roomColor = safeColor(r.roomColor) || '#8b5cf6';
                o.participants = (Array.isArray(r.participants) ? r.participants : []).filter(x => typeof x === 'string').map(x => x.slice(0, 64)).slice(0, 300);
                o.subItems = (depth < 1 && Array.isArray(r.subItems)) ? r.subItems.map(s => Sanitize.item(s, depth + 1)).filter(Boolean).slice(0, 300) : [];
                o.subInk = Sanitize.strokes(r.subInk);
            }
        } else if (type === 'poll') {
            o.q = clampStr(r.q, 200);
            o.opts = (Array.isArray(r.opts) ? r.opts : []).slice(0, 12).map(x => ({ lbl: clampStr(x && x.lbl, 80), v: Math.max(0, Sanitize.num(x && x.v, 0, 1e6) | 0) }));
            if (o.opts.length < 2) o.opts = [{ lbl: 'Yes', v: 0 }, { lbl: 'No', v: 0 }];
        } else if (type === 'graph') {
            o.title = clampStr(r.title, 60);
            o.data = (Array.isArray(r.data) ? r.data : []).filter(v => typeof v === 'number' && isFinite(v)).slice(0, 500);
        } else if (type === 'spin') {
            o.ang = Sanitize.num(r.ang, 0, 1e7);
            o.opts = (Array.isArray(r.opts) && r.opts.length ? r.opts : ['A', 'B', 'C', 'D']).map(x => clampStr(x, 40)).slice(0, 12);
        }
        return o;
    }
};

/* --- NETWORK & ACTIVITY MANAGER --- */
// What a connected *student* may ask the host to do. Everything else is co-host only.
const STUDENT_MESSAGES = new Set(['NOTE', 'IMG_NOTE', 'DELETE_NOTE', 'POLL_VOTE', 'DATA_SUBMIT', 'SUBMIT_VOTE', 'SUBMIT_SORT', 'COMMENT', 'EXIT_SUBMIT', 'CONSENSUS_INK', 'HEARTBEAT', 'LEAVE']);
const NOTE_SUBS_STUDENT = ['notice', 'wonder', 'idea', 'test', 'claim', 'evidence', 'reasoning'];
const SORT_LIMIT = 200;

window.Network = {
    peer: null, status: 'offline', statusInfo: null, _retry: 0, _idTries: 0, _hb: null, _reconnectT: null, _cohost: null,
    qrScanner: null,

    setStatus: (s, info) => { Network.status = s; Network.statusInfo = info || null; if (window.Shell) Shell.syncConn(); },
    getCode: () => Net.peerIdToCode(localStorage.getItem('dqb_host_id')),
    getCohostKey: () => {
        let k = localStorage.getItem('dqb_cohost_key');
        if (!k) { k = Net.genCode(8); localStorage.setItem('dqb_cohost_key', k); }
        return k;
    },
    joinUrl: () => { const c = Network.getCode(); return c ? Net.joinUrl(c) : ''; },
    cohostCode: () => { const c = Network.getCode(); return c ? `${c}.${Network.getCohostKey()}` : ''; },
    studentCount: () => Object.values(State.students).filter(s => s.role === 'student').length,

    _teardown: () => {
        clearTimeout(Network._reconnectT); Network._reconnectT = null;
        if (Network.peer) { try { Network.peer.destroy(); } catch (e) { /* ignore */ } Network.peer = null; }
    },

    /** Starts (or restarts) hosting under a short join code. Pass regen=true for a brand-new code. */
    host: (regen) => {
        if (State.isCoHost) return;
        Network._teardown();
        let id = localStorage.getItem('dqb_host_id');
        if (regen || !id || !Net.peerIdToCode(id)) {
            id = Net.codeToPeerId(Net.genCode(6));
            if (regen) { try { localStorage.removeItem('dqb_cohost_key'); } catch (e) { /* ignore */ } }
        }
        Network.setStatus('connecting');
        let peer;
        try { peer = Net.newPeer(id); }
        catch (e) { Network.setStatus('error', { title: 'Browser not supported', msg: 'This browser cannot create peer-to-peer connections.' }); return; }
        Network.peer = peer;
        peer.on('open', pid => {
            localStorage.setItem('dqb_host_id', pid);
            Network._retry = 0; Network._idTries = 0;
            Network.setStatus('ready');
            Network._startHeartbeat();
        });
        peer.on('connection', c => Network._onConnection(c));
        peer.on('disconnected', () => {
            if (peer !== Network.peer) return;
            Network.setStatus('connecting', { title: 'Reconnecting…', msg: 'Lost contact with the connection service.' });
            Network._scheduleReconnect();
        });
        peer.on('close', () => { if (peer === Network.peer && !peer._intentional) { Network.setStatus('error', { title: 'Connection closed', msg: 'The connection service closed the session.' }); Network._scheduleReconnect(true); } });
        peer.on('error', (err) => {
            if (peer !== Network.peer) return;
            if (err.type === 'unavailable-id') {
                // someone else (or a stale session of ours) holds this code
                if (++Network._idTries <= 3) { setTimeout(() => Network.host(Network._idTries >= 2), 600 * Network._idTries); return; }
            }
            console.warn('Peer error', err);
            Network.setStatus('error', Net.explainPeerError(err));
            if (err.type !== 'browser-incompatible') Network._scheduleReconnect(true);
        });
    },
    _scheduleReconnect: (rebuild) => {
        if (State.isCoHost && !Network._cohost) return;
        clearTimeout(Network._reconnectT);
        Network._reconnectT = setTimeout(() => {
            Network._reconnectT = null;
            if (State.isCoHost) { if (Network._cohost) Network.connectAsCohost(Network._cohost.code, Network._cohost.key, true); return; }
            if (!Network.peer || Network.peer.destroyed || rebuild) Network.host();
            else if (Network.peer.disconnected) { try { Network.peer.reconnect(); } catch (e) { Network.host(); } }
        }, Net.backoff(Network._retry++));
    },
    retry: () => { Network._retry = 0; Network._idTries = 0; if (State.isCoHost && Network._cohost) Network.connectAsCohost(Network._cohost.code, Network._cohost.key, true); else Network.host(); },
    resetCode: async () => {
        const ok = await DQBUI.Dialog.confirm({ title: 'Generate a new code?', message: Network.studentCount() ? 'Connected students will be disconnected and will need the new code to rejoin.' : 'Students will need the new code to join.', confirmLabel: 'New code', icon: 'refresh' });
        if (!ok) return false;
        Object.values(State.students).forEach(s => { SafeSend(s.conn, { type: 'KICKED', reason: 'code-reset' }); });
        State.students = {}; State.blocked = {}; Roster();
        Network.host(true);
        return true;
    },
    _startHeartbeat: () => {
        if (Network._hb) return;
        Network._hb = setInterval(() => { if (Network.peer && !Network.peer.destroyed) Network.broadcast({ type: 'HEARTBEAT' }); }, 3000);
    },

    _onConnection: (c) => {
        c._joined = false;
        const t = setTimeout(() => { if (!c._joined) { try { c.close(); } catch (e) { /* ignore */ } } }, 15000);
        c.on('data', d => {
            if (typeof d === 'string' && d.length > 4000000) return;
            let msg; try { msg = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return; }
            try { Network.handle(c.peer, msg, c); } catch (e) { console.error(e); }
        });
        c.on('close', () => { clearTimeout(t); Network._dropConn(c); });
        c.on('error', (e) => console.warn('Connection error', e));
    },
    _dropConn: (c) => {
        const st = State.students[c.peer];
        if (st && st.conn === c) {
            delete State.students[c.peer];
            State.consensusMode.participants = State.consensusMode.participants.filter(p => p !== c.peer);
            Roster(); Consensus.renderParticipants(); if (Workspace.mode === 'breakout') Breakout.renderParticipants();
            if (window.Shell && st.role === 'student') Shell.Panel.flashLeft(st);
        }
    },
    _allow: (conn, cost) => {
        const now = performance.now();
        const b = conn._bucket || (conn._bucket = { tokens: 40, ts: now });
        b.tokens = Math.min(40, b.tokens + (now - b.ts) / 1000 * 15); b.ts = now;
        if (b.tokens < (cost || 1)) return false;
        b.tokens -= (cost || 1); return true;
    },
    kick: async (pid) => {
        const s = State.students[pid]; if (!s) return;
        const ok = await DQBUI.Dialog.confirm({ title: `Remove ${s.name}?`, message: 'They will be disconnected and can’t rejoin until you generate a new code.', confirmLabel: 'Remove', danger: true, icon: 'user-x' });
        if (!ok) return;
        State.blocked[s.sid] = true;
        SafeSend(s.conn, { type: 'KICKED', reason: 'removed' });
        setTimeout(() => { try { s.conn.close(); } catch (e) { /* ignore */ } }, 150);
        delete State.students[pid]; Roster(); Consensus.renderParticipants();
        UI.toast(`${s.name} removed`);
    },
    toggleMute: (pid) => {
        const s = State.students[pid]; if (!s) return;
        State.muted[s.sid] = !State.muted[s.sid];
        SafeSend(s.conn, { type: 'MUTE', on: !!State.muted[s.sid] });
        Roster();
        UI.toast(State.muted[s.sid] ? `${s.name} can’t add notes right now` : `${s.name} can add notes again`);
    },

    /* ---------- co-host (a second teacher device) ---------- */
    connectAsCohost: (code, key, silentRetry) => {
        State.isCoHost = true;
        Network._cohost = { code, key };
        Network._teardown();
        Network.setStatus('connecting');
        let peer;
        try { peer = Net.newPeer(); } catch (e) { Network.setStatus('error', { title: 'Browser not supported', msg: 'This browser cannot create peer-to-peer connections.' }); return; }
        Network.peer = peer;
        peer.on('open', () => {
            const conn = peer.connect(Net.codeToPeerId(code), { reliable: true });
            conn.on('open', () => {
                Network._retry = 0;
                State.students['HOST'] = { name: 'HOST', conn, role: 'host' };
                State.lastHostBeat = Date.now();
                conn.send(JSON.stringify({ type: 'AUTH_COHOST', key }));
            });
            conn.on('data', d => { try { Network.handle('HOST', typeof d === 'string' ? JSON.parse(d) : d, conn); } catch (e) { console.error(e); } });
            conn.on('close', () => { if (peer !== Network.peer) return; delete State.students['HOST']; Network.setStatus('connecting', { title: 'Host disconnected', msg: 'Trying to reconnect…' }); Network._scheduleReconnect(); });
            conn.on('error', () => { /* handled by close */ });
        });
        peer.on('error', (err) => {
            if (peer !== Network.peer) return;
            if (err.type === 'peer-unavailable') { Network.setStatus('error', Net.explainPeerError(err)); if (!State.items.length && !silentRetry) { DQBUI.Dialog.alert({ title: 'Couldn’t find that board', message: 'Check the co-host code and make sure the host has the board open.', tone: 'warn', icon: 'warn' }); State.isCoHost = false; } else Network._scheduleReconnect(); return; }
            Network.setStatus('error', Net.explainPeerError(err)); Network._scheduleReconnect();
        });
        peer.on('disconnected', () => { if (peer === Network.peer) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
        if (!Network._cohostWatch) Network._cohostWatch = setInterval(() => {
            if (State.isCoHost && State.students['HOST'] && Date.now() - (State.lastHostBeat || 0) > 12000) { try { State.students['HOST'].conn.close(); } catch (e) { /* ignore */ } }
        }, 4000);
    },
    requestSync: () => { if (State.students['HOST']) SafeSend(State.students['HOST'].conn, { type: 'SYNC_REQ' }); },

    /* ---------- activities ---------- */
    transitionTo: (type, targetId, payload) => {
        targetId = targetId || null; payload = payload || null;
        State.votes = {};                       // one response per student per activity
        const updates = State.items.map(i => ({ id: i.id, props: { isOpen: false } }));
        StateManager.updateItems(updates, { silent: true });

        Network.broadcast({ type: 'STOP_ACT' });
        if (type !== 'OPEN') Network.broadcast({ type: 'MODE', val: 'LOCKED' });

        StateManager.setActivity({ type, targetId, payload });

        if (type === 'OPEN') {
            Network.broadcast({ type: 'MODE', val: 'OPEN' });
        } else if (targetId) {
            StateManager.updateItem(targetId, { isOpen: true });
            if (type === 'ZONE_ACT') {
                Network.broadcast({ ...payload, type: payload.subType });
                const modeLabel = payload.subType === 'ACT_DISCUSS' ? 'Discussion' : 'Results';
                const zContainer = $(`zr-${targetId}`);
                if (zContainer && payload.subType !== 'OPEN_ZONE') { zContainer.innerHTML = `<h4>${modeLabel}</h4><div class="muted">Waiting for responses…</div>`; zContainer.classList.add('active'); }
            } else if (type === 'WIDGET_ACT' || type === 'EXIT_TICKET') {
                Network.broadcast(payload);
            }
        }
        if (window.Shell) Shell.syncActivity();
        UI.toast(type === 'LOCKED' ? 'Board locked' : (type === 'OPEN' ? 'Board open — students can add notes' : 'Activity started'), type === 'LOCKED' ? '' : 'success');
    },
    toggleOpenMode: (isOn) => { if (isOn) Network.transitionTo('OPEN'); else Network.transitionTo('LOCKED'); },

    startActivity: (mode) => {
        let targets = []; let zoneId = null;
        State.selection.forEach(id => {
            const i = State.items.find(x => x.id === id); if (!i) return;
            if (i.type === 'note') targets.push(i);
            else if (i.type === 'zone') {
                zoneId = i.id;
                if (i.children) i.children.forEach(cid => { const n = State.items.find(x => x.id === cid); if (n) targets.push(n); });
            }
        });
        targets = [...new Set(targets)].filter(n => n.type === 'note');

        if (targets.length < 1 && mode === 'discuss') { UI.toast("Select a zone or some notes to discuss", 'warn'); return; }
        if (targets.length < 2 && mode !== 'discuss') { UI.toast("This activity needs at least 2 notes in the zone", 'warn'); return; }

        if (!zoneId) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            targets.forEach(t => { minX = Math.min(minX, t.x); minY = Math.min(minY, t.y); maxX = Math.max(maxX, t.x + t.w); maxY = Math.max(maxY, t.y + t.h); });
            zoneId = genId(); const pad = 40;
            const newZone = { id: zoneId, type: 'zone', title: 'Activity zone', x: minX - pad, y: minY - pad - 40, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 + 40, children: targets.map(t => t.id) };
            StateManager.addItem(newZone);
            targets.forEach(t => HierarchyManager.link(t.id, zoneId));
            Actions.sel(zoneId);
        } else { Actions.sel(zoneId); }

        State.activeSorts[zoneId] = [];
        const subType = mode === 'vote' ? 'ACT_VOTE' : (mode === 'sort' ? 'ACT_SORT' : 'ACT_DISCUSS');
        const itemsList = targets.map(n => ({ id: n.id, text: clampStr(n.text, 300), sub: n.sub }));
        Network.transitionTo('ZONE_ACT', zoneId, { type: subType, subType: subType, actId: zoneId, items: itemsList });
    },
    stopActivity: () => { Network.transitionTo('LOCKED'); },

    toggleZone: (id) => {
        if (State.activity.targetId === id && State.activity.type !== 'LOCKED') { Network.transitionTo('LOCKED'); return; }
        const item = State.items.find(x => x.id === id);
        if (!item) return;
        if (item.zoneType === 'exit') Network.broadcastExit(id);
        else if (item.type === 'poll') Network.broadcastPoll(id);
        else if (item.type === 'graph') Network.broadcastGraph(id);
        else if (item.type === 'zone' && item.zoneType !== 'consensus' && item.zoneType !== 'breakout') Network.openZone(id);
    },
    openZone: (id) => {
        const z = State.items.find(x => x.id === id);
        Network.transitionTo('ZONE_ACT', id, { type: 'OPEN_ZONE', subType: 'OPEN_ZONE', actId: id, title: z.title, zoneType: z.zoneType, items: [] });
    },
    broadcastPoll: (id) => {
        const p = State.items.find(x => x.id === id);
        Network.transitionTo('WIDGET_ACT', id, { type: 'ACT_POLL', subType: 'ACT_POLL', actId: id, q: p.q, opts: p.opts.map(o => ({ lbl: o.lbl, v: 0 })) });
    },
    broadcastGraph: (id) => {
        const g = State.items.find(x => x.id === id);
        Network.transitionTo('WIDGET_ACT', id, { type: 'ACT_GRAPH', subType: 'ACT_GRAPH', actId: id, title: g.title });
    },
    broadcastExit: (id) => {
        const item = State.items.find(x => x.id === id);
        Network.transitionTo('EXIT_TICKET', id, { type: 'EXIT_TICKET', subType: 'EXIT_TICKET', actId: id, mode: item.exitMode, prompt: item.prompt, opts: item.opts, single: true });
    },
    assignStudentColor: (pid, color) => {
        const student = State.students[pid];
        if (student) {
            student.color = student.color === color ? null : color;
            SafeSend(student.conn, { type: 'SET_COLOR', color: student.color });
            Roster();
        }
    },

    /* ---------- class timer ---------- */
    timerBroadcast: () => {
        const t = State.timer;
        Network.broadcast({ type: 'TIMER', running: t.running, remainingMs: t.running ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs, totalMs: t.totalMs });
    },

    _isOpenForNotes: () => {
        const a = State.activity;
        return a.type === 'OPEN' || (a.type === 'ZONE_ACT' && a.payload && a.payload.subType === 'OPEN_ZONE');
    },
    _once: (bucket, actId, sid) => {            // true the first time a student responds to an activity
        const k = actId + '|' + sid;
        if (State.votes[k]) return false;
        State.votes[k] = true; return true;
    },

    /* ---------- the message router (host + co-host) ---------- */
    handle: (pid, d, conn) => {
        if (!d || typeof d.type !== 'string') return;
        const silent = { silent: true };
        const fromHostToCohost = State.isCoHost;                    // we are a co-host: messages come from the (trusted) host
        let st = State.students[pid];

        if (!fromHostToCohost) {
            if (d.type === 'JOIN') return Network._join(pid, d, conn);
            if (d.type === 'AUTH_COHOST') return Network._authCohost(pid, d, conn);
            if (!st) return;                                       // must JOIN first
            if (!Network._allow(conn, d.type === 'IMG_NOTE' ? 5 : 1)) return;
            if (st.role !== 'cohost' && !STUDENT_MESSAGES.has(d.type)) return;
        }
        const nr = () => { Render.all(); };                           // silent updates still need a repaint

        switch (d.type) {
            case 'HEARTBEAT': if (fromHostToCohost) State.lastHostBeat = Date.now(); break;
            case 'AUTH_OK': Network.setStatus('ready'); break;
            case 'AUTH_FAIL':
                State.isCoHost = false; Network._cohost = null; Network._teardown(); Network.setStatus('offline');
                DQBUI.Dialog.alert({ title: 'Co-host code not accepted', message: 'The code was wrong or has been reset. Ask the host for the current co-host code.', tone: 'warn', icon: 'warn' });
                if (window.Shell) Shell.leaveBoard();
                break;
            case 'SYNC_REQ': SafeSend(conn, { type: 'FULL_SYNC', items: State.items, ink: State.ink, activity: State.activity }); break;
            case 'LEAVE': break;

            /* ---- co-host / host board sync ---- */
            case 'FULL_SYNC': {
                const items = (Array.isArray(d.items) ? d.items : []).map(i => Sanitize.item(i)).filter(Boolean);
                const first = !State.items.length && !State.id;
                StateManager.setFullState({ items, ink: Sanitize.strokes(d.ink), activity: d.activity }, fromHostToCohost ? silent : { silent: false });
                if (fromHostToCohost) { if (first || !State.hasEntered) { State.hasEntered = true; Shell.enterBoard({ cohost: true }); } nr(); Shell.syncBoardState(); }
                break;
            }
            case 'NOTE_UPDATE': { const n = Sanitize.item(d.note); if (n) { fromHostToCohost ? (StateManager.updateItem(n.id, n, silent), nr()) : StateManager.updateItem(n.id, n); } break; }
            case 'BATCH_UPDATE': {
                const ups = (Array.isArray(d.items) ? d.items : []).slice(0, 500).map(i => Sanitize.item(i)).filter(Boolean).map(i => ({ id: i.id, props: i }));
                if (ups.length) { fromHostToCohost ? (StateManager.updateItems(ups, silent), nr()) : StateManager.updateItems(ups); }
                break;
            }
            case 'ADD_ITEM': {
                const n = Sanitize.item(d.item); if (!n) break;
                if (State.items.find(i => i.id === n.id)) { fromHostToCohost ? (StateManager.updateItem(n.id, n, silent), nr()) : StateManager.updateItem(n.id, n); }
                else fromHostToCohost ? (StateManager.addItem(n, silent), nr()) : StateManager.addItem(n);
                break;
            }
            case 'GROUP_ITEMS': StateManager.updateItems((Array.isArray(d.ids) ? d.ids : []).filter(safeId).map(id => ({ id, props: { groupId: safeId(d.groupId) || null } })), fromHostToCohost ? silent : undefined); if (fromHostToCohost) nr(); break;
            case 'UNGROUP_ITEMS': StateManager.updateItems(State.items.filter(i => i.groupId === d.groupId).map(i => ({ id: i.id, props: { groupId: null } })), fromHostToCohost ? silent : undefined); if (fromHostToCohost) nr(); break;
            case 'ZONE_REORDER': {
                if (!safeId(d.zoneId) || !Array.isArray(d.children)) break;
                const kids = d.children.filter(safeId);
                StateManager.updateItem(d.zoneId, { children: kids }, silent);
                kids.forEach(cid => StateManager.updateItem(cid, { parentZone: d.zoneId }, silent));
                LayoutSystem.update(d.zoneId); nr(); Board.save(true);
                break;
            }
            case 'INK_ADD': { const s = Sanitize.strokes([d.ink])[0]; if (s) { fromHostToCohost ? (StateManager.addInk(s, silent), Render.ink()) : StateManager.addInk(s); } break; }
            case 'LASER': {
                if (!fromHostToCohost || !isFinite(d.x) || !isFinite(d.y)) break;
                const dot = document.createElement('div'); dot.className = 'laser-dot';
                const sp = { x: (d.x + State.view.x) * State.view.z, y: (d.y + State.view.y) * State.view.z };
                dot.style.left = sp.x + 'px'; dot.style.top = sp.y + 'px'; $('viewport').appendChild(dot); setTimeout(() => dot.remove(), 600);
                break;
            }
            case 'STATE_META': if (fromHostToCohost) { if (d.name) { State.name = clampStr(d.name, 60); Shell.syncName(); } } break;
            case 'KICKED': break;

            /* ---- student contributions ---- */
            case 'NOTE':
            case 'IMG_NOTE': Network._studentNote(pid, st, d, conn); break;
            case 'DELETE_NOTE': {
                const id = safeId(d.id); if (!id) break;
                const pend = State.pending.findIndex(p => p.id === id && p.sid === st.sid);
                if (pend > -1) { State.pending.splice(pend, 1); Shell.syncQueue(); break; }
                const it = State.items.find(x => x.id === id);
                if (it && (st.role === 'cohost' || (it.sid && it.sid === st.sid))) HierarchyManager.delete([id]);
                break;
            }
            case 'POLL_VOTE': {
                const p = State.items.find(x => x.id === d.actId && x.type === 'poll');
                const idx = Number.isInteger(d.idx) ? d.idx : -1;
                if (!p || State.activity.targetId !== p.id || !p.opts[idx] || !Network._once('poll', p.id, st.sid)) break;
                p.opts[idx].v = (p.opts[idx].v || 0) + 1;
                StateManager.updateItem(p.id, { opts: p.opts });
                if (window.confetti) confetti({ particleCount: 40, spread: 55, origin: { y: 0.8 }, disableForReducedMotion: true });
                break;
            }
            case 'DATA_SUBMIT': {
                const g = State.items.find(x => x.id === d.actId && x.type === 'graph');
                const v = Number(d.val);
                if (!g || State.activity.targetId !== g.id || !Number.isFinite(v) || Math.abs(v) > 1e9) break;
                if (!Network._once('graph', g.id, st.sid)) break;
                g.data = (g.data || []).concat([Math.round(v * 1000) / 1000]).slice(-500);
                StateManager.updateItem(g.id, { data: g.data });
                break;
            }
            case 'SUBMIT_VOTE':
            case 'SUBMIT_SORT': {
                const act = State.activity;
                if (act.type !== 'ZONE_ACT' || act.targetId !== d.actId || !act.payload || !Array.isArray(act.payload.items)) break;
                const valid = new Set(act.payload.items.map(i => i.id));
                if (d.type === 'SUBMIT_VOTE' && (act.payload.subType !== 'ACT_VOTE' || !valid.has(d.choiceId))) break;
                if (d.type === 'SUBMIT_SORT' && (act.payload.subType !== 'ACT_SORT' || !Array.isArray(d.order) || !d.order.every(x => valid.has(x)))) break;
                if (!Network._once('sort', d.actId, st.sid)) break;
                if (!State.activeSorts[d.actId]) State.activeSorts[d.actId] = [];
                if (State.activeSorts[d.actId].length < SORT_LIMIT) State.activeSorts[d.actId].push(d.type === 'SUBMIT_SORT' ? d.order.slice(0, 100) : d.choiceId);
                Network.updateResults(d.actId);
                break;
            }
            case 'COMMENT': {
                if (!State.items.some(i => i.id === d.targetId)) break;
                const text = clampStr(d.text, 500).trim(); if (!text) break;
                State.comments.push({ type: 'COMMENT', targetId: d.targetId, text, author: State.settings.names ? st.name : 'Student', tag: ['feedback', 'question', 'connection'].includes(d.tag) ? d.tag : 'feedback' });
                if (State.comments.length > 1000) State.comments.shift();
                Network.updateDiscussion(); Render.all();
                break;
            }
            case 'EXIT_SUBMIT': {
                const zone = State.items.find(x => x.id === d.actId && x.zoneType === 'exit');
                if (!zone || State.activity.targetId !== zone.id) break;
                if (State.muted[st.sid] || !Network._once('exit', zone.id, st.sid)) break;
                let txt;
                if (Array.isArray(d.val)) txt = d.val.slice(0, 12).map(v => clampStr(v, 80)).join(', ');
                else if (d.val && typeof d.val === 'object') txt = `Learned: ${clampStr(d.val.l, 300)}\nWonder: ${clampStr(d.val.w, 300)}`;
                else txt = clampStr(d.val, 600);
                if (!txt || !txt.trim()) break;
                const newNote = { id: genId(), type: 'note', sub: 'notice', text: txt, author: State.settings.names ? st.name : 'Student', sid: st.sid, w: 200, h: 150, votes: 0, parentZone: zone.id, x: zone.x + 20, y: zone.y + 80 };
                StateManager.addItem(newNote);
                if (!zone.children) zone.children = [];
                zone.children.push(newNote.id);
                StateManager.updateItem(zone.id, { children: zone.children });
                LayoutSystem.update(zone.id);
                break;
            }
            case 'CONSENSUS_INK':
                if (State.consensusMode.active && State.consensusMode.participants.includes(pid)) {
                    const s = Sanitize.strokes([d.ink])[0]; if (s) Consensus.handleInk(s);
                }
                break;
        }
    },

    _join: (pid, d, conn) => {
        const sid = safeId(d.sid) || pid;
        if (State.blocked[sid]) { SafeSend(conn, { type: 'KICKED', reason: 'removed' }); setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 150); return; }
        const name = clampStr(String(d.name || '').replace(/[\u0000-\u001f<>]/g, ''), 24).trim() || 'Student';
        const avatar = Net.AVATARS.includes(d.avatar) ? d.avatar : '😀';
        // the same student reconnecting replaces their previous (stale) connection
        let carried = {};
        Object.keys(State.students).forEach(k => {
            const o = State.students[k];
            if (o.sid === sid && k !== pid && o.role === 'student') { carried = { color: o.color }; try { o.conn.close(); } catch (e) { /* ignore */ } delete State.students[k]; State.consensusMode.participants = State.consensusMode.participants.map(p => p === k ? pid : p); }
        });
        conn._joined = true;
        State.students[pid] = { name, avatar, sid, conn, role: 'student', color: carried.color || null, joinedAt: Date.now() };
        const a = State.activity;
        let welcomeMode = 'LOCKED', actPayload = null;
        if (a.type === 'OPEN') welcomeMode = 'OPEN';
        else if (a.type === 'ZONE_ACT' || a.type === 'WIDGET_ACT') { welcomeMode = a.payload.subType; actPayload = a.payload; }
        else if (a.type === 'EXIT_TICKET') { welcomeMode = 'EXIT_TICKET'; actPayload = a.payload; }
        const mine = State.items.filter(i => i.type === 'note' && i.sid === sid).map(i => ({ id: i.id, text: i.text, sub: i.sub }));
        const t = State.timer;
        SafeSend(conn, {
            type: 'WELCOME', boardId: State.id, mode: welcomeMode, payload: actPayload, sync: mine, v: 2,
            rules: { names: State.settings.names, approve: State.settings.approve }, muted: !!State.muted[sid], color: State.students[pid].color,
            pending: State.pending.filter(p => p.sid === sid).map(p => p.id),
            timer: { running: t.running, remainingMs: t.running ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs, totalMs: t.totalMs }
        });
        if (State.students[pid].color) SafeSend(conn, { type: 'SET_COLOR', color: State.students[pid].color });
        Roster(); Consensus.renderParticipants();
        if (window.Shell) Shell.Panel.flashJoined(State.students[pid]);
        else UI.toast(`${name} joined`);
    },
    _authCohost: (pid, d, conn) => {
        if (typeof d.key !== 'string' || d.key !== Network.getCohostKey()) { SafeSend(conn, { type: 'AUTH_FAIL' }); setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 200); return; }
        conn._joined = true;
        State.students[pid] = { name: 'Co-host', avatar: '👑', sid: pid, conn, role: 'cohost' };
        SafeSend(conn, { type: 'AUTH_OK' });
        SafeSend(conn, { type: 'STATE_META', name: State.name });
        SafeSend(conn, { type: 'FULL_SYNC', items: State.items, ink: State.ink, activity: State.activity });
        Roster();
        UI.toast('A co-host joined', 'success');
    },
    _studentNote: (pid, st, d, conn) => {
        const reject = (reason) => SafeSend(conn, { type: 'NOTE_STATUS', id: safeId(d.id), status: 'rejected', reason });
        const id = safeId(d.id); if (!id) return;
        if (State.muted[st.sid]) { SafeSend(conn, { type: 'MUTE', on: true }); return reject('muted'); }
        if (!Network._isOpenForNotes()) return reject('locked');
        // zone targeting (only the currently opened zone is allowed)
        let zoneId = null;
        if (State.activity.type === 'ZONE_ACT' && State.activity.payload && State.activity.payload.subType === 'OPEN_ZONE') zoneId = State.activity.targetId;
        const zone = zoneId ? State.items.find(z => z.id === zoneId) : null;
        if (zone && zone.color && st.color !== zone.color) return reject('color');

        const existing = State.items.find(x => x.id === id);
        if (existing && existing.sid !== st.sid) return;                        // can't overwrite someone else's note
        if (!existing && State.items.filter(x => x.sid === st.sid).length >= 80) return reject('limit');

        const author = State.settings.names ? st.name : 'Student';
        const sub = NOTE_SUBS_STUDENT.includes(d.sub) ? d.sub : 'notice';
        let item;
        if (d.type === 'NOTE') {
            const text = clampStr(d.text, 1000); if (!text.trim()) return;
            if (existing) { StateManager.updateItem(id, { text, sub }); return; }
            item = { id, type: 'note', sub, text, author, sid: st.sid, w: 220, h: 170, votes: 0, groupId: null };
        } else {
            const src = safeImg(d.src, 1500000); if (!src) return reject('image');
            if (existing) return;
            item = { id, type: 'note', sub: 'sketch', src, text: clampStr(d.text, 120), author, sid: st.sid, w: 240, h: 240, votes: 0, groupId: null };
        }
        if (State.settings.approve) {
            if (State.pending.some(p => p.id === id)) return;
            State.pending.push({ ...item, zoneId: zone ? zone.id : null, ts: Date.now(), studentName: st.name, avatar: st.avatar });
            SafeSend(conn, { type: 'NOTE_STATUS', id, status: 'pending' });
            Shell.syncQueue(true);
            return;
        }
        Network._placeNote(item, zone ? zone.id : null);
        SafeSend(conn, { type: 'NOTE_STATUS', id, status: 'approved' });
    },
    _placeNote: (item, zoneId) => {
        const c = Viewport.centerWorld();
        const pos = Board.getFreeSpace(c.x - item.w / 2, c.y - item.h / 2, item.w, item.h);
        item.x = pos.x; item.y = pos.y;
        StateManager.addItem(item);
        if (zoneId && State.items.find(z => z.id === zoneId)) Actions.addToZone(zoneId, item.id);
    },
    approve: (id, ok) => {
        const k = State.pending.findIndex(p => p.id === id); if (k < 0) return;
        const p = State.pending.splice(k, 1)[0];
        const stu = Object.values(State.students).find(s => s.sid === p.sid);
        if (ok) {
            const { zoneId, ts, studentName, avatar, ...item } = p;
            Network._placeNote(item, zoneId);
        }
        if (stu) SafeSend(stu.conn, { type: 'NOTE_STATUS', id, status: ok ? 'approved' : 'rejected', reason: ok ? undefined : 'declined' });
        Shell.syncQueue();
    },
    approveAll: () => { State.pending.slice().forEach(p => Network.approve(p.id, true)); },

    /* ---------- results ---------- */
    _resultsHtml: (actId) => {
        const submissions = State.activeSorts[actId] || [];
        const scores = {};
        submissions.forEach(sub => { if (Array.isArray(sub)) sub.forEach((itemId, idx) => { scores[itemId] = (scores[itemId] || 0) + (sub.length - idx); }); else scores[sub] = (scores[sub] || 0) + 1; });
        const results = Object.keys(scores).map(id => { const item = State.items.find(x => x.id === id); return { text: item && item.text ? item.text.substring(0, 40) : (item && item.src ? 'Sketch' : 'Unknown'), score: scores[id] }; }).sort((a, b) => b.score - a.score);
        const max = results.length ? results[0].score : 1;
        return `<div style="margin-bottom:10px;font-weight:700;color:var(--text-2)">${submissions.length} response${submissions.length === 1 ? '' : 's'}</div>` +
            (results.length ? results.map((r, i) => `<div class="result-row"><div style="width:24px;font-weight:700;color:var(--text-3)">#${i + 1}</div><div style="flex:2;font-weight:600">${esc(r.text)}</div><div class="bar-bg"><div class="bar-fill" style="width:${(r.score / max) * 100}%"></div></div><div style="font-weight:700;color:var(--accent);min-width:20px;text-align:right">${r.score}</div></div>`).join('') : '<div class="muted">Waiting for responses…</div>');
    },
    updateResults: (actId) => {
        const btn = $(`btn-res-${actId}`); if (btn) btn.classList.add('active');
        const html = Network._resultsHtml(actId);
        const zContainer = $(`zr-${actId}`); if (zContainer) zContainer.innerHTML = `<h4>Activity results</h4>` + html;
        if (window.Shell) Shell.setActivityResults(html);
    },
    updateDiscussion: () => {
        if (!State.activity || State.activity.type !== 'ZONE_ACT') return;
        const actId = State.activity.targetId;
        const btn = $(`btn-res-${actId}`); if (btn) btn.classList.add('active');
        const relevant = State.comments.filter(c => c.targetId === actId || (State.activity.payload.items && State.activity.payload.items.find(i => i.id === c.targetId)));
        const html = relevant.map(c => {
            const item = State.items.find(x => x.id === c.targetId);
            const txt = item && item.text ? item.text.substring(0, 24) + (item.text.length > 24 ? '…' : '') : 'Sketch';
            return `<div class="disc-item"><div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-3);margin-bottom:4px"><span>${esc(c.author)}</span><span>Re: ${esc(txt)}</span></div><span class="disc-tag dt-${esc(c.tag)}">${esc(c.tag)}</span><span>${esc(c.text)}</span></div>`;
        }).reverse().join('') || '<div class="muted">No comments yet.</div>';
        const zContainer = $(`zr-${actId}`); if (zContainer) zContainer.innerHTML = `<h4>Discussion</h4>` + html;
        if (window.Shell) Shell.setActivityResults(html);
    },

    /** Send to everyone connected to us (students + co-hosts, or the host when we are a co-host). */
    broadcast: (msg) => { Object.values(State.students).forEach(s => SafeSend(s.conn, msg)); },
    /** Keep co-hosts in step with item/ink changes (students never receive board state). */
    relay: (action, payload) => {
        const msgs = [];
        switch (action) {
            case 'items:add': payload.items.forEach(item => msgs.push({ type: 'ADD_ITEM', item })); break;
            case 'items:update': {
                const full = payload.items.map(p => State.items.find(i => i.id === p.id)).filter(Boolean);
                if (full.length === 1) msgs.push({ type: 'NOTE_UPDATE', note: full[0] }); else if (full.length) msgs.push({ type: 'BATCH_UPDATE', items: full });
                break;
            }
            case 'items:delete': payload.ids.forEach(id => msgs.push({ type: 'DELETE_NOTE', id })); break;
            case 'ink:add': msgs.push({ type: 'INK_ADD', ink: payload.ink }); break;
            case 'ink:set': case 'state:fullsync': msgs.push({ type: 'FULL_SYNC', items: State.items, ink: State.ink }); break;
        }
        if (!msgs.length) return;
        if (State.isCoHost) { const h = State.students['HOST']; if (h) msgs.forEach(m => SafeSend(h.conn, m)); }
        else Object.values(State.students).forEach(s => { if (s.role === 'cohost') msgs.forEach(m => SafeSend(s.conn, m)); });
    }
};

/* --- WORKSPACE ROUTER: the same top bar / rail / bottom nav drive the board, a consensus model, or a breakout room --- */
window.Workspace = {
    mode: 'board',
    set: (m) => {
        Workspace.mode = m;
        const app = $('app');
        app.classList.remove('ws-board', 'ws-consensus', 'ws-breakout'); app.classList.add('ws-' + m);
        $('consensus-overlay').hidden = m !== 'consensus';
        $('breakout-overlay').hidden = m !== 'breakout';
        if (window.Shell) Shell.onWorkspace(m);
    },
    caps: () => ({
        board:     { insert: true,  select: true, laser: true,  brush: false, sketch: true,  pin: true,  minimap: true,  templates: true },
        consensus: { insert: false, select: true, laser: false, brush: true,  sketch: false, pin: false, minimap: false, templates: false },
        breakout:  { insert: true,  select: true, laser: true,  brush: false, sketch: true,  pin: true,  minimap: false, templates: true }
    })[Workspace.mode],
    tool: () => Workspace.mode === 'board' ? State.tool : (Workspace.mode === 'consensus' ? State.consensusMode.tool : Breakout._state.tool),
    setTool: (t) => { if (Workspace.mode === 'board') window.setTool(t); else if (Workspace.mode === 'consensus') Consensus.setTool(t); else Breakout.setTool(t); },
    undo: () => { if (Workspace.mode === 'board') ActionHistory.undo(); else if (Workspace.mode === 'consensus') Consensus.undo(); else Breakout.undo(); },
    redo: () => { if (Workspace.mode === 'board') ActionHistory.redo(); else if (Workspace.mode === 'consensus') Consensus.redo(); else Breakout.redo(); },
    canUndo: () => Workspace.mode === 'board' ? ActionHistory.canUndo() : (Workspace.mode === 'consensus' ? Consensus.canUndo() : Breakout.canUndo()),
    canRedo: () => Workspace.mode === 'board' ? ActionHistory.canRedo() : (Workspace.mode === 'consensus' ? Consensus.canRedo() : Breakout.canRedo()),
    zoomBy: (f) => { if (Workspace.mode === 'board') Viewport.zoomBy(f); else if (Workspace.mode === 'consensus') Consensus.zoom(f); else Breakout.zoom(f); },
    zoomReset: () => { if (Workspace.mode === 'board') Viewport.animateTo({ x: State.view.x, y: State.view.y, z: 1 }); else if (Workspace.mode === 'consensus') Consensus.zoom(null); else Breakout.zoom(null); },
    fit: () => { if (Workspace.mode === 'board') Viewport.fit(); else if (Workspace.mode === 'consensus') Consensus.zoom(null); else Breakout.fit(); },
    zoomPct: () => Math.round((Workspace.mode === 'board' ? State.view.z : (Workspace.mode === 'consensus' ? State.consensusMode.view.z : Breakout._state.view.z)) * 100),
    insert: (type, sub) => { if (Workspace.mode === 'board') Actions.create(type, sub); else if (Workspace.mode === 'breakout') Breakout.createItem(type, sub); },
    insertExit: (mode) => { if (Workspace.mode === 'board') Actions.createExit(mode); else if (Workspace.mode === 'breakout') Breakout.createExit(mode); },
    loadTemplate: (t) => { if (Workspace.mode === 'breakout') Breakout.loadTemplate(t); else UI.loadTemplate(t); },
    draw: () => {
        if (Workspace.mode === 'board') return { color: State.draw.color, width: State.draw.width, brush: 'draw', sketch: InkManager.sketchMode };
        if (Workspace.mode === 'consensus') return { color: State.consensusMode.color, width: State.consensusMode.width, brush: State.consensusMode.brush, sketch: false };
        return { color: Breakout._state.color, width: Breakout._state.width, brush: 'draw', sketch: Breakout._state.sketchMode };
    },
    setColor: (c) => { if (Workspace.mode === 'board') InkManager.setColor(c); else if (Workspace.mode === 'consensus') Consensus.setColor(c); else Breakout.setColor(c); },
    setWidth: (w) => { if (Workspace.mode === 'board') InkManager.setWidth(w); else if (Workspace.mode === 'consensus') Consensus.setWidth(w); else Breakout.setWidth(w); },
    setBrush: (b) => { if (Workspace.mode === 'consensus') Consensus.setBrush(b); },
    setSketch: (on) => { if (Workspace.mode === 'board') InkManager.toggleSketchMode(on); else if (Workspace.mode === 'breakout') Breakout.toggleSketchMode(on); },
    clearInk: () => { if (Workspace.mode === 'board') InkManager.clear(); else if (Workspace.mode === 'consensus') Consensus.clearInk(); else Breakout.clearInk(); },
    pinInk: () => { if (Workspace.mode === 'board') InkManager.pinToItems(); else if (Workspace.mode === 'breakout') Breakout.pinInkAsItems(); },
    exit: () => { if (Workspace.mode === 'consensus') Consensus.stop(); else if (Workspace.mode === 'breakout') Breakout.close(); },
    title: () => Workspace.mode === 'consensus' ? ('Modeling · ' + (State.consensusMode.title || '')) : (Workspace.mode === 'breakout' ? ('Room · ' + ((Breakout._getZone() || {}).title || '')) : State.name)
};

/* --- GESTURES: pointer-based pan / pinch-zoom / wheel shared by consensus + breakout canvases --- */
window.Gestures = {
    attach: (el, cfg) => {
        const pts = new Map(); let pinch = null, active = false;
        const down = (e) => {
            if (cfg.skip && cfg.skip(e)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) {
                if (active) { cfg.cancel(); active = false; }
                const [a, b] = [...pts.values()], v = cfg.getView(), r = el.getBoundingClientRect();
                const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
                pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z: v.z, wx: (cx - r.left) / v.z - v.x, wy: (cy - r.top) / v.z - v.y };
                return;
            }
            if (pts.size > 2) return;
            active = !!cfg.down(e);
            if (active) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        };
        const move = (e) => {
            if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch && pts.size >= 2) {
                e.preventDefault();
                const [a, b] = [...pts.values()], r = el.getBoundingClientRect();
                const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
                const nz = Math.max(0.1, Math.min(8, pinch.z * dist / pinch.dist));
                cfg.setView({ z: nz, x: (cx - r.left) / nz - pinch.wx, y: (cy - r.top) / nz - pinch.wy });
                return;
            }
            if (active) { if (e.cancelable) e.preventDefault(); cfg.move(e); }
        };
        const up = (e) => {
            const had = pts.delete(e.pointerId);
            if (pinch) { if (pts.size < 2) pinch = null; return; }
            if (active && had) { active = false; cfg.up(e); }
        };
        const wheel = (e) => {
            e.preventDefault();
            const v = cfg.getView(), r = el.getBoundingClientRect();
            let dx = e.deltaX, dy = e.deltaY; if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
            if (e.ctrlKey || e.metaKey || localStorage.getItem('dqb_wheel') === 'zoom') {
                const nz = Math.max(0.1, Math.min(8, v.z * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016))));
                const px = e.clientX - r.left, py = e.clientY - r.top;
                cfg.setView({ z: nz, x: px / nz - (px / v.z - v.x), y: py / nz - (py / v.z - v.y) });
            } else cfg.setView({ z: v.z, x: v.x - dx / v.z, y: v.y - dy / v.z });
        };
        el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); el.addEventListener('wheel', wheel, { passive: false });
    }
};

/* --- CONSENSUS MODELING MANAGER --- */
window.Consensus = {
    drag: null, currentPath: [], _animationFrame: null, _hist: [], _hi: -1, _lastView: 0,

    init: () => {
        Gestures.attach($('consensus-main'), {
            skip: (e) => State.consensusMode.active === false || (e.pointerType === 'mouse' && ![0, 1, 2].includes(e.button)),
            getView: () => State.consensusMode.view,
            setView: (v) => { Object.assign(State.consensusMode.view, v); Consensus._viewChanged(); },
            down: Consensus.inputStart, move: Consensus.inputMove, up: Consensus.inputEnd,
            cancel: () => { Consensus.currentPath = []; Consensus.drag = null; const t = $('cm-temp-ink'); if (t) t.innerHTML = ''; }
        });
    },
    _viewChanged: () => {
        if (window.Shell) Shell.syncZoom();
        const now = performance.now();
        if (now - Consensus._lastView > 120) { Consensus._lastView = now; Network.broadcast({ type: 'CONSENSUS_VIEW_SYNC', view: State.consensusMode.view }); }
        clearTimeout(Consensus._vt); Consensus._vt = setTimeout(() => Network.broadcast({ type: 'CONSENSUS_VIEW_SYNC', view: State.consensusMode.view }), 160);
    },

    start: (zoneId) => {
        const zone = State.items.find(i => i.id === zoneId);
        if (!zone) return;
        const cm = State.consensusMode;
        cm.active = true; cm.zoneId = zoneId; cm.title = zone.title;
        cm.ink = JSON.parse(JSON.stringify(zone.ink || []));
        cm.participants = [];
        cm.view = { x: 0, y: 0, z: 1 };
        cm.tool = 'pan'; cm.brush = 'draw';
        cm.items = (zone.children || []).map(id => State.items.find(i => i.id === id)).filter(Boolean).map(item => {
            const clone = JSON.parse(JSON.stringify(item)); clone.x -= zone.x; clone.y -= zone.y; return clone;
        });
        UI.closeAllMenus();
        Workspace.set('consensus');
        Consensus._hist = []; Consensus._hi = -1; Consensus._pushHistory();
        Consensus.renderItems(); Consensus.renderInk(); Consensus.loop(); Consensus.renderParticipants();
        Consensus.setTool('pan');
        Consensus.fitInitial();
        Network.broadcast({ type: 'CONSENSUS_START', zoneId, ink: cm.ink, items: cm.items.map(i => ({ id: i.id, type: i.type, sub: i.sub, text: clampStr(i.text, 500), src: i.src ? safeImg(i.src, 1500000) : undefined, x: i.x, y: i.y, w: i.w, h: i.h })), title: zone.title });
        if (window.Shell && DQBUI.isMobile() === false) Shell.Panel.open();
    },
    fitInitial: () => {
        // centre the model's content in the canvas
        const cm = State.consensusMode, r = $('consensus-main').getBoundingClientRect();
        let minX = 0, minY = 0, maxX = 600, maxY = 500;
        const zone = State.items.find(i => i.id === cm.zoneId); if (zone) { maxX = zone.w; maxY = zone.h; }
        const pad = 60, z = Math.max(0.2, Math.min(1.2, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2 - 120) / (maxY - minY))));
        cm.view = { z, x: (r.width / 2) / z - (minX + maxX) / 2, y: (r.height / 2 - 20) / z - (minY + maxY) / 2 };
        if (window.Shell) Shell.syncZoom();
    },
    stop: () => {
        const cm = State.consensusMode;
        if (!cm.active) return;
        const zone = State.items.find(i => i.id === cm.zoneId);
        if (zone) {
            const updates = cm.items.map(c => ({ id: c.id, props: { x: c.x + zone.x, y: c.y + zone.y } }));
            updates.push({ id: zone.id, props: { ink: JSON.parse(JSON.stringify(cm.ink)) } });
            StateManager.updateItems(updates);
        }
        cm.active = false; cm.participants = [];
        $('consensus-items-layer').innerHTML = '';
        if (Consensus._animationFrame) cancelAnimationFrame(Consensus._animationFrame);
        Network.broadcast({ type: 'CONSENSUS_STOP' });
        Workspace.set('board');
        Render.all();
    },
    loop: () => {
        if (!State.consensusMode.active) return;
        const v = State.consensusMode.view;
        $('consensus-world').style.transform = `scale(${v.z}) translate(${v.x}px, ${v.y}px)`;
        Consensus.renderTempInk();
        Consensus._animationFrame = requestAnimationFrame(Consensus.loop);
    },
    renderTempInk: () => {
        const svg = $('cm-temp-ink'); if (!svg) return;
        const cm = State.consensusMode;
        if (Consensus.drag && Consensus.drag.mode === 'draw' && Consensus.currentPath.length > 1) {
            const t = `scale(${cm.view.z}) translate(${cm.view.x}px, ${cm.view.y}px)`;
            svg.innerHTML = `<g transform="${t}" style="transform-origin:0 0"><path d="${InkManager.pointsToPath(Consensus.currentPath)}" stroke="${safeColor(cm.color) || '#000'}" stroke-width="${cm.brush === 'highlight' ? cm.width * 3 : cm.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${cm.brush === 'highlight' ? 0.4 : 1}"/></g>`;
        } else svg.innerHTML = '';
    },
    renderItems: () => {
        const layer = $('consensus-items-layer'); layer.textContent = '';
        State.consensusMode.items.forEach(item => {
            const el = Render.createItem(item);
            el.style.transform = `translate(${item.x}px, ${item.y}px)`; el.style.width = item.w + 'px'; el.style.height = item.h + 'px';
            layer.appendChild(el);
        });
    },
    renderParticipants: () => {
        const c = $('consensus-participants'); if (!c) return;
        const list = Object.entries(State.students).filter(([pid, s]) => s.role === 'student');
        if (!list.length) { c.innerHTML = `<div class="empty"><div class="em-ico">${icon('users', 'lg')}</div><div>No students connected yet.</div></div>`; return; }
        c.innerHTML = list.map(([pid, s]) => {
            const on = State.consensusMode.participants.includes(pid);
            return `<button type="button" class="participant-row ${on ? 'active' : ''}" data-pid="${esc(pid)}" aria-pressed="${on}"><input type="checkbox" ${on ? 'checked' : ''} tabindex="-1" aria-hidden="true"><span style="font-size:1.3rem">${esc(s.avatar)}</span><span class="grow truncate" style="font-weight:600">${esc(s.name)}</span><span class="chip ${on ? 'success' : ''}">${on ? 'Can draw' : 'Watching'}</span></button>`;
        }).join('');
        c.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => Consensus.toggleParticipant(b.dataset.pid)));
    },
    toggleParticipant: (pid) => {
        const cm = State.consensusMode, idx = cm.participants.indexOf(pid);
        if (idx > -1) cm.participants.splice(idx, 1); else cm.participants.push(pid);
        Consensus.renderParticipants();
        const s = State.students[pid]; if (s) SafeSend(s.conn, { type: 'CONSENSUS_PERMS', canDraw: idx === -1 });
    },
    renderInk: () => {
        const svg = $('consensus-ink-layer');
        const defs = svg.querySelector('defs');
        svg.textContent = ''; if (defs) svg.appendChild(defs);
        const NS = 'http://www.w3.org/2000/svg';
        State.consensusMode.ink.forEach(s => {
            const col = safeColor(s.color) || '#000';
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', InkManager.pointsToPath(s.points)); path.setAttribute('stroke', col);
            path.setAttribute('stroke-width', s.highlight ? (parseFloat(s.width) || 4) * 3 : (parseFloat(s.width) || 4));
            path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
            if (s.highlight) path.setAttribute('opacity', '0.4');
            if (s.arrow) {
                const markerId = `cm-arrow-${col.replace('#', '')}`;
                if (!svg.querySelector(`#${markerId}`)) {
                    const d2 = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
                    const marker = document.createElementNS(NS, 'marker');
                    marker.setAttribute('id', markerId); marker.setAttribute('markerWidth', '10'); marker.setAttribute('markerHeight', '7'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '3.5'); marker.setAttribute('orient', 'auto');
                    const poly = document.createElementNS(NS, 'polygon'); poly.setAttribute('points', '0 0, 10 3.5, 0 7'); poly.setAttribute('fill', col);
                    marker.appendChild(poly); d2.appendChild(marker);
                }
                path.setAttribute('marker-end', `url(#${markerId})`);
            }
            svg.appendChild(path);
        });
    },
    handleInk: (ink) => {
        State.consensusMode.ink.push(ink);
        Consensus.renderInk(); Consensus._pushHistory();
        Network.broadcast({ type: 'CONSENSUS_INK', ink });
    },
    _snapshot: () => JSON.stringify(State.consensusMode.ink),
    _pushHistory: () => {
        const snap = Consensus._snapshot();
        if (Consensus._hist[Consensus._hi] === snap) return;
        Consensus._hist = Consensus._hist.slice(0, Consensus._hi + 1); Consensus._hist.push(snap);
        if (Consensus._hist.length > 60) Consensus._hist.shift();
        Consensus._hi = Consensus._hist.length - 1;
        if (window.Shell) Shell.syncHistory();
    },
    canUndo: () => Consensus._hi > 0, canRedo: () => Consensus._hi < Consensus._hist.length - 1,
    _applyHistory: () => {
        State.consensusMode.ink = JSON.parse(Consensus._hist[Consensus._hi]);
        Consensus.renderInk(); Network.broadcast({ type: 'CONSENSUS_SET_INK', ink: State.consensusMode.ink });
        if (window.Shell) Shell.syncHistory();
    },
    undo: () => { if (!Consensus.canUndo()) return; Consensus._hi--; Consensus._applyHistory(); },
    redo: () => { if (!Consensus.canRedo()) return; Consensus._hi++; Consensus._applyHistory(); },

    setTool: (tool) => {
        const cm = State.consensusMode;
        // legacy tool names fold into tool + brush
        if (tool === 'highlight' || tool === 'arrow') { cm.brush = tool; tool = 'draw'; }
        else if (tool === 'draw') { if (!['draw', 'highlight', 'arrow'].includes(cm.brush)) cm.brush = 'draw'; }
        cm.tool = tool;
        const main = $('consensus-main');
        main.className = tool === 'pan' ? 'cm-pan' : (tool === 'draw' || tool === 'eraser' ? 'cm-draw' : '');
        if (window.Shell) Shell.syncTools();
    },
    setBrush: (b) => { State.consensusMode.brush = b; Consensus.setTool('draw'); },
    setColor: (color) => {
        State.consensusMode.color = color;
        if (State.consensusMode.tool !== 'draw') Consensus.setTool('draw'); else if (window.Shell) Shell.syncDraw();
    },
    setWidth: (w) => { State.consensusMode.width = Math.max(1, Math.min(40, parseInt(w) || 4)); if (window.Shell) Shell.syncDraw(); },
    zoom: (factor) => {
        const view = State.consensusMode.view;
        if (factor === null) Consensus.fitInitial();
        else {
            const oz = view.z, nz = Math.max(0.1, Math.min(oz * factor, 8));
            const rect = $('consensus-main').getBoundingClientRect(), cx = rect.width / 2, cy = rect.height / 2;
            view.x = (cx / nz) - (cx / oz - view.x); view.y = (cy / nz) - (cy / oz - view.y); view.z = nz;
        }
        Consensus._viewChanged();
    },
    clearInk: async () => {
        if (!State.consensusMode.ink.length) { UI.toast('Nothing to clear', 'warn'); return; }
        const ok = await DQBUI.Dialog.confirm({ title: 'Clear the model drawing?', message: 'All strokes will be removed for everyone. You can undo this.', confirmLabel: 'Clear drawing', danger: true });
        if (!ok) return;
        State.consensusMode.ink = []; Consensus.renderInk(); Consensus._pushHistory();
        Network.broadcast({ type: 'CONSENSUS_CLEAR' });
    },
    screenToWorld: (evt) => {
        const rect = $('consensus-main').getBoundingClientRect(), v = State.consensusMode.view;
        return { x: (evt.clientX - rect.left) / v.z - v.x, y: (evt.clientY - rect.top) / v.z - v.y };
    },
    inputStart: (e) => {
        const cm = State.consensusMode, tool = cm.tool, coords = Consensus.screenToWorld(e);
        const itemEl = e.target.closest('.item');
        if (e.button === 1 || e.button === 2 || tool === 'pan' || (tool === 'select' && !itemEl)) {
            Consensus.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: cm.view.x, vy: cm.view.y }; return true;
        }
        if (tool === 'select' && itemEl) {
            const item = cm.items.find(i => i.id === itemEl.id);
            if (item) { Consensus.drag = { mode: 'move', item, sx: coords.x, sy: coords.y, ix: item.x, iy: item.y }; return true; }
            return false;
        }
        if (tool === 'draw') { Consensus.drag = { mode: 'draw' }; Consensus.currentPath = [coords]; return true; }
        if (tool === 'eraser') { Consensus.drag = { mode: 'eraser' }; return true; }
        return false;
    },
    _moveBroadcast: DQBUI.throttle((id, x, y) => Network.broadcast({ type: 'CONSENSUS_ITEM_MOVE', id, x, y }), 60),
    inputMove: (e) => {
        const d = Consensus.drag; if (!d) return;
        const cm = State.consensusMode, view = cm.view, coords = Consensus.screenToWorld(e);
        if (d.mode === 'pan') {
            view.x = d.vx + (e.clientX - d.sx) / view.z; view.y = d.vy + (e.clientY - d.sy) / view.z; Consensus._viewChanged();
        } else if (d.mode === 'move') {
            const item = d.item; item.x = d.ix + (coords.x - d.sx); item.y = d.iy + (coords.y - d.sy);
            const el = document.getElementById(item.id); if (el) el.style.transform = `translate(${item.x}px, ${item.y}px)`;
            Consensus._moveBroadcast(item.id, item.x, item.y);
        } else if (d.mode === 'draw') {
            const last = Consensus.currentPath[Consensus.currentPath.length - 1];
            if (!last || Math.hypot(coords.x - last.x, coords.y - last.y) > 0.6) Consensus.currentPath.push(coords);
        } else if (d.mode === 'eraser') {
            const { changed, newInk } = InkManager.eraseAt(coords.x, coords.y, cm.ink, view.z);
            if (changed) { cm.ink = newInk; Consensus.renderInk(); d.erased = true; Network.broadcast({ type: 'CONSENSUS_SET_INK', ink: cm.ink }); }
        }
    },
    inputEnd: () => {
        const d = Consensus.drag; if (!d) return;
        const cm = State.consensusMode;
        if (d.mode === 'draw' && Consensus.currentPath.length > 1) {
            Consensus.handleInk({ id: genId(), points: [...Consensus.currentPath], color: cm.color, width: cm.width, highlight: cm.brush === 'highlight', arrow: cm.brush === 'arrow' });
        } else if (d.mode === 'eraser' && d.erased) Consensus._pushHistory();
        else if (d.mode === 'move') Network.broadcast({ type: 'CONSENSUS_ITEM_MOVE', id: d.item.id, x: d.item.x, y: d.item.y });
        Consensus.drag = null; Consensus.currentPath = [];
        const t = $('cm-temp-ink'); if (t) t.innerHTML = '';
    },
    _keydown: (e) => {
        const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
        if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) Consensus.redo(); else Consensus.undo(); }
        else if (mod && k === 'y') { e.preventDefault(); Consensus.redo(); }
        else if (e.key === 'Escape') Consensus.stop();
        else if (!mod) { if (k === 'v') Consensus.setTool('select'); else if (k === 'h') Consensus.setTool('pan'); else if (k === 'p') Consensus.setTool('draw'); else if (k === 'e') Consensus.setTool('eraser'); else if (e.key === '+' || e.key === '=') Consensus.zoom(1.2); else if (e.key === '-') Consensus.zoom(1 / 1.2); }
    }
};

/* --- BREAKOUT BOARD MANAGER --- */
window.Breakout = {
    drag: null, currentPath: [], _frame: null, _zoneId: null, _thumbTimer: null, _history: [], _historyIdx: -1,
    _state: { view: { x: 0, y: 0, z: 1 }, tool: 'pan', color: '#ef4444', width: 4, selectedId: null, sketchMode: false },

    _getZone: () => State.items.find(i => i.id === Breakout._zoneId),

    open: (zoneId) => {
        const zone = State.items.find(i => i.id === zoneId);
        if (!zone) return;
        Breakout._zoneId = zoneId; Breakout.drag = null; Breakout.currentPath = []; Breakout._history = []; Breakout._historyIdx = -1;
        Breakout._state = { view: { x: 0, y: 0, z: 1 }, tool: 'pan', color: '#ef4444', width: 4, selectedId: null, sketchMode: false };
        UI.closeAllMenus();
        Workspace.set('breakout');
        Breakout.setTool('pan');
        Breakout.renderItems(); Breakout.renderInk(); Breakout.renderParticipants();
        Breakout._pushHistory();
        Breakout.fit(true);
        if (!Breakout._frame) Breakout._loop();
    },
    close: () => {
        Breakout._setSelected(null);
        Breakout.drag = null; Breakout.currentPath = []; Breakout._history = []; Breakout._historyIdx = -1;
        if (Breakout._frame) { cancelAnimationFrame(Breakout._frame); Breakout._frame = null; }
        $('breakout-items-layer').textContent = '';
        if ($('bk-temp-ink')) $('bk-temp-ink').innerHTML = '';
        const zone = Breakout._getZone();
        if (zone) StateManager.updateItem(zone.id, { subItems: zone.subItems, subInk: zone.subInk });
        Breakout._zoneId = null;
        Workspace.set('board');
        Render.all();
    },
    _setSelected: (id) => {
        Breakout._state.selectedId = id;
        document.querySelectorAll('#breakout-items-layer .item').forEach(el => el.classList.toggle('selected', !!id && el.id === `bk-${id}`));
        if (window.Shell) { Shell.syncTools(); Shell.onSelection(); }
    },
    _loop: () => {
        if (!Breakout._zoneId) return;
        const view = Breakout._state.view;
        $('breakout-world').style.transform = `scale(${view.z}) translate(${view.x}px,${view.y}px)`;
        const g = $('breakout-bg-grid'); const gs = Math.max(8, 24 * view.z);
        g.style.backgroundSize = `${gs}px ${gs}px`; g.style.backgroundPosition = `${view.x * view.z}px ${view.y * view.z}px`;
        Breakout.renderTempInk();
        if (window.Shell) Shell.positionSelBar();
        Breakout._frame = requestAnimationFrame(Breakout._loop);
    },
    renderTempInk: () => {
        const svg = $('bk-temp-ink'); if (!svg) return;
        if (Breakout.drag && Breakout.drag.mode === 'draw' && Breakout.currentPath.length > 1) {
            svg.innerHTML = `<path d="${InkManager.pointsToPath(Breakout.currentPath)}" stroke="${safeColor(Breakout._state.color) || '#000'}" stroke-width="${Breakout._state.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
        } else svg.innerHTML = '';
    },
    renderItems: () => {
        const layer = $('breakout-items-layer'); layer.textContent = '';
        const zone = Breakout._getZone(); if (!zone) return;
        (zone.subItems || []).forEach(item => layer.appendChild(Breakout.createItemEl(item)));
    },
    createItemEl: (item) => {
        const itemType = ['note', 'zone', 'poll', 'graph', 'spin'].includes(item.type) ? item.type : 'note';
        const el = document.createElement('div');
        el.id = `bk-${item.id}`;
        el.className = `item ${itemType}${item.zoneType ? ' zone-' + String(item.zoneType).replace(/[^a-z]/gi, '') : ''}${Breakout._state.selectedId === item.id ? ' selected' : ''}`;
        el.style.cssText = `position:absolute;transform:translate(${Number(item.x) || 0}px,${Number(item.y) || 0}px);width:${Number(item.w) || 180}px;height:${Number(item.h) || 130}px;`;
        const head = TYPES[item.sub] || TYPES.meta;
        let inner = '', iconHtml = '', title = '';

        if (itemType === 'note') {
            inner = (item.sub === 'sketch' || item.src)
                ? `<div style="display:flex;flex-direction:column;height:100%;overflow:hidden"><img draggable="false" alt="Sketch" style="flex:1;min-height:0;width:100%;object-fit:contain;background:rgba(255,255,255,.7)"><textarea class="caption-in" placeholder="Caption…"></textarea></div>`
                : `<textarea class="note-in" placeholder="Type here…"></textarea>`;
            iconHtml = esc(head.icon); title = head.lbl;
        } else if (itemType === 'zone') {
            const lab = document.createElement('div'); lab.className = 'zone-label'; lab.textContent = item.title || 'Zone'; el.appendChild(lab);
            if (item.zoneType === 'cer') { inner = `<div class="cer-grid"><div class="cer-col">Claim</div><div class="cer-col">Evidence</div><div class="cer-col">Reasoning</div></div>`; title = 'CER Builder'; iconHtml = icon('cer', 'sm'); }
            else if (item.zoneType === 'consensus') { inner = `<svg class="consensus-zone-svg" style="width:100%;height:100%;pointer-events:none"></svg>`; title = 'Consensus Model'; iconHtml = icon('consensus', 'sm'); }
            else if (item.zoneType === 'exit') {
                inner = `<div class="exit-head">${icon('ticket', 'sm')}<span>${esc(String(item.exitMode || item.mode || 'exit'))}</span></div><div class="exit-prompt">${esc(item.prompt)}</div>`; title = 'Exit Ticket'; iconHtml = icon('ticket', 'sm');
            } else { inner = `<div class="zone-hint">Drop notes here</div>`; title = item.title || 'Zone'; iconHtml = icon('zone', 'sm'); }
        } else if (itemType === 'poll') { inner = `<div class="poll-q"></div><div class="poll-opts"></div>`; iconHtml = icon('poll', 'sm'); title = 'Poll'; }
        else if (itemType === 'graph') { inner = `<div class="graph-wrap"><div class="graph-bars"></div><div class="graph-empty">${icon('graph', 'lg')}<div>No data yet</div></div><div class="graph-stats"></div></div>`; iconHtml = icon('graph', 'sm'); title = item.title || 'Graph'; }
        else if (itemType === 'spin') { inner = `<div class="spin-box"><div class="spin-stage"><div class="spin-pointer"></div><svg class="spin-svg" viewBox="0 0 100 100"></svg></div><button type="button" class="btn btn-soft btn-sm" data-act="bk-spin">${icon('spin', 'sm')}Spin</button><div class="spin-result" style="font-weight:700;min-height:1.2em"></div></div>`; iconHtml = icon('spin', 'sm'); title = 'Spinner'; }

        const wrap = document.createElement('div'); wrap.className = 'jiggle-wrapper';
        wrap.innerHTML = `<div class="i-head"><div class="hd-l"><span class="icon-span">${iconHtml}</span><span class="auth-span"></span></div></div><div class="i-body">${inner}</div><div class="resize-h" role="button" aria-label="Resize item"></div>`;
        wrap.querySelector('.auth-span').textContent = title;
        el.appendChild(wrap);

        if (itemType === 'note' && item.sub !== 'sketch' && !item.src) { wrap.style.background = head.col; wrap.style.borderColor = head.bor; const h = wrap.querySelector('.i-head'); h.style.background = head.bor + '26'; h.style.color = head.bor; }
        else if (itemType === 'zone' && safeColor(item.color)) { wrap.style.borderColor = item.color; wrap.style.borderWidth = '3px'; wrap.style.borderStyle = 'solid'; wrap.style.background = item.color + '1a'; }
        const img = wrap.querySelector('img'); if (img) { const s = safeImg(item.src); if (s) img.src = s; }
        const ta = wrap.querySelector('textarea');
        if (ta) {
            ta.value = item.text || '';
            ta.addEventListener('input', () => { clearTimeout(ta._t); ta._t = setTimeout(() => { item.text = clampStr(ta.value, 2000); Breakout._scheduleThumbUpdate(); }, 400); });
        }
        if (itemType === 'poll') Render.updatePoll(el, item);
        if (itemType === 'graph') Render.updateGraph(el, item);
        if (itemType === 'spin') Render.updateSpin(el, item);
        const spinBtn = el.querySelector('[data-act="bk-spin"]'); if (spinBtn) { spinBtn.addEventListener('click', ev => { ev.stopPropagation(); Breakout._spinItem(item.id); }); spinBtn.addEventListener('pointerdown', ev => ev.stopPropagation()); }
        el.addEventListener('pointerdown', Breakout._itemDown);
        return el;
    },
    _spinItem: (id) => {
        const zone = Breakout._getZone(); if (!zone) return;
        const item = (zone.subItems || []).find(i => i.id === id); if (!item) return;
        item.ang = (item.ang || 0) + 1440 + Math.floor(Math.random() * 360);
        const el = document.getElementById(`bk-${id}`); if (el) Render.updateSpin(el, item);
    },
    _itemDown: (e) => {
        const tool = Breakout._state.tool;
        if (tool !== 'select' && tool !== 'pan') return;
        if (e.target.closest('textarea, [data-act]') && !e.target.closest('.i-head')) { if (e.target.closest('textarea')) return; }
        const zone = Breakout._getZone(); if (!zone) return;
        const el = e.currentTarget, id = el.id.replace('bk-', '');
        const item = (zone.subItems || []).find(i => i.id === id); if (!item) return;
        e.stopPropagation();
        Breakout._setSelected(id);
        const coords = Breakout._screenToWorld(e);
        if (e.target.closest('.resize-h')) Breakout.drag = { mode: 'resize-item', item, el, sx: coords.x, sy: coords.y, iw: item.w || 180, ih: item.h || 130 };
        else Breakout.drag = { mode: 'move-item', item, el, sx: coords.x, sy: coords.y, ix: item.x, iy: item.y, sx0: e.clientX, sy0: e.clientY, moved: false };
        try { $('breakout-main').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        Breakout._activePointer = e.pointerId;
    },
    renderInk: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const svg = $('breakout-ink-layer'); svg.textContent = '';
        (zone.subInk || []).forEach(s => {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', InkManager.pointsToPath(s.points)); p.setAttribute('stroke', safeColor(s.color) || '#000'); p.setAttribute('stroke-width', parseFloat(s.width) || 4);
            p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); svg.appendChild(p);
        });
    },
    renderParticipants: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const container = $('breakout-participants'); if (!container) return;
        const members = zone.participants || [];
        const cnt = $('breakout-member-count'); if (cnt) cnt.textContent = `${members.filter(m => State.students[m]).length} in room`;
        const list = Object.entries(State.students).filter(([pid, s]) => s.role === 'student');
        container.innerHTML = list.map(([pid, s]) => {
            const isIn = members.includes(pid);
            return `<button type="button" class="bk-participant-row ${isIn ? 'active' : ''}" data-pid="${esc(pid)}" aria-pressed="${isIn}"><input type="checkbox" ${isIn ? 'checked' : ''} tabindex="-1" aria-hidden="true"><span style="font-size:1.3rem">${esc(s.avatar)}</span><span class="grow truncate" style="font-weight:600">${esc(s.name)}</span></button>`;
        }).join('') || `<div class="empty"><div class="em-ico">${icon('users', 'lg')}</div><div>No students connected yet.</div></div>`;
        container.querySelectorAll('[data-pid]').forEach(b => b.addEventListener('click', () => Breakout.toggleMember(b.dataset.pid)));
    },
    toggleMember: (pid) => {
        const zone = Breakout._getZone(); if (!zone) return;
        if (!zone.participants) zone.participants = [];
        const idx = zone.participants.indexOf(pid);
        if (idx > -1) zone.participants.splice(idx, 1); else zone.participants.push(pid);
        StateManager.updateItem(zone.id, { participants: zone.participants }, { silent: true });
        Breakout.renderParticipants();
    },
    setTool: (tool) => {
        Breakout._state.tool = tool;
        $('breakout-main').className = tool === 'pan' ? 'bk-pan' : (tool === 'draw' || tool === 'eraser' || tool === 'laser' ? 'bk-draw' : '');
        if (tool !== 'select') Breakout._setSelected(null); else if (window.Shell) Shell.syncTools();
    },
    setColor: (color) => { Breakout._state.color = color; if (Breakout._state.tool !== 'draw') Breakout.setTool('draw'); else if (window.Shell) Shell.syncDraw(); },
    setWidth: (w) => { Breakout._state.width = Math.max(1, Math.min(40, parseInt(w) || 4)); if (window.Shell) Shell.syncDraw(); },
    zoom: (factor) => {
        const view = Breakout._state.view;
        if (factor === null) { view.z = 1; view.x = 0; view.y = 0; }
        else {
            const oz = view.z, nz = Math.max(0.1, Math.min(oz * factor, 8));
            const rect = $('breakout-main').getBoundingClientRect();
            view.x = (rect.width / 2 / nz) - (rect.width / 2 / oz - view.x); view.y = (rect.height / 2 / nz) - (rect.height / 2 / oz - view.y); view.z = nz;
        }
        if (window.Shell) Shell.syncZoom();
    },
    fit: (quiet) => {
        const zone = Breakout._getZone(); if (!zone) return;
        const rect = $('breakout-main').getBoundingClientRect(), view = Breakout._state.view;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        (zone.subItems || []).forEach(i => { minX = Math.min(minX, i.x); minY = Math.min(minY, i.y); maxX = Math.max(maxX, i.x + (i.w || 180)); maxY = Math.max(maxY, i.y + (i.h || 130)); });
        (zone.subInk || []).forEach(s => s.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }));
        if (!isFinite(minX)) { view.z = 1; view.x = rect.width / 2 - 100; view.y = rect.height / 2 - 100; if (window.Shell) Shell.syncZoom(); return; }
        const pad = 80, z = Math.max(0.15, Math.min(1.2, Math.min((rect.width - pad * 2) / (maxX - minX || 1), (rect.height - pad * 2 - 100) / (maxY - minY || 1))));
        view.z = z; view.x = (rect.width / 2) / z - (minX + maxX) / 2; view.y = (rect.height / 2 - 20) / z - (minY + maxY) / 2;
        if (window.Shell) Shell.syncZoom();
    },
    clearInk: async () => {
        const zone = Breakout._getZone(); if (!zone) return;
        if (!(zone.subInk || []).length) { UI.toast('Nothing to clear', 'warn'); return; }
        const ok = await DQBUI.Dialog.confirm({ title: 'Clear drawings in this room?', message: 'You can undo this.', confirmLabel: 'Clear ink', danger: true });
        if (!ok) return;
        zone.subInk = []; Breakout.renderInk(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
    },
    deleteSelected: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const id = Breakout._state.selectedId; if (!id) return;
        zone.subItems = (zone.subItems || []).filter(i => i.id !== id);
        Breakout._setSelected(null); Breakout.renderItems(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
    },
    _pushHistory: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        Breakout._history = Breakout._history.slice(0, Breakout._historyIdx + 1);
        Breakout._history.push({ subItems: JSON.parse(JSON.stringify(zone.subItems || [])), subInk: JSON.parse(JSON.stringify(zone.subInk || [])) });
        if (Breakout._history.length > 50) Breakout._history.shift();
        Breakout._historyIdx = Breakout._history.length - 1;
        if (window.Shell) Shell.syncHistory();
    },
    _applyHistory: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const snap = Breakout._history[Breakout._historyIdx]; if (!snap) return;
        zone.subItems = JSON.parse(JSON.stringify(snap.subItems)); zone.subInk = JSON.parse(JSON.stringify(snap.subInk));
        Breakout._setSelected(null); Breakout.renderItems(); Breakout.renderInk(); Breakout._scheduleThumbUpdate();
        if (window.Shell) Shell.syncHistory();
    },
    canUndo: () => Breakout._historyIdx > 0, canRedo: () => Breakout._historyIdx < Breakout._history.length - 1,
    undo: () => { if (!Breakout.canUndo()) return; Breakout._historyIdx--; Breakout._applyHistory(); },
    redo: () => { if (!Breakout.canRedo()) return; Breakout._historyIdx++; Breakout._applyHistory(); },
    _keydown: (e) => {
        const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
        if (e.key === 'Escape') { if (Breakout._state.selectedId) Breakout._setSelected(null); else Breakout.close(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && Breakout._state.selectedId) { e.preventDefault(); Breakout.deleteSelected(); }
        else if (mod && !e.shiftKey && k === 'z') { e.preventDefault(); Breakout.undo(); }
        else if (mod && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); Breakout.redo(); }
        else if (!mod) { if (k === 'v') Breakout.setTool('select'); else if (k === 'h') Breakout.setTool('pan'); else if (k === 'p') Breakout.setTool('draw'); else if (k === 'e') Breakout.setTool('eraser'); else if (k === 'l') Breakout.setTool('laser'); else if (e.key === '+' || e.key === '=') Breakout.zoom(1.2); else if (e.key === '-') Breakout.zoom(1 / 1.2); }
    },

    createItem: (type, sub) => {
        const zone = Breakout._getZone(); if (!zone) return;
        if (!zone.subItems) zone.subItems = [];
        const view = Breakout._state.view, r = $('breakout-main').getBoundingClientRect();
        const insetsTop = DQBUI.isMobile() ? ($('topbar').offsetHeight) : 0, insetsBottom = DQBUI.isMobile() ? ($('bottomnav').offsetHeight) : 0;
        const cx = (r.width / 2) / view.z - view.x, cy = ((r.height - insetsBottom + insetsTop) / 2) / view.z - view.y;
        const it = { id: genId() };
        const place = (w, h) => { it.w = w; it.h = h; const pos = Breakout._free(cx - w / 2, cy - h / 2, w, h, zone.subItems); it.x = pos.x; it.y = pos.y; };
        if (type === 'note') { it.type = 'note'; it.sub = sub || 'notice'; it.text = ''; place(200, 150); }
        else if (type === 'zone') { it.type = 'zone'; it.title = `Zone ${zone.subItems.filter(i => i.type === 'zone').length + 1}`; place(300, 300); }
        else if (type === 'cer') { it.type = 'zone'; it.zoneType = 'cer'; it.title = "Argument Builder (CER)"; place(600, 400); }
        else if (type === 'consensus') { it.type = 'zone'; it.zoneType = 'consensus'; it.title = "Consensus Model"; it.ink = []; place(600, 520); }
        else if (type === 'poll') { it.type = 'poll'; it.q = "Question?"; it.opts = [{ lbl: 'Yes', v: 0 }, { lbl: 'No', v: 0 }]; place(260, 170); }
        else if (type === 'graph') { it.type = 'graph'; it.title = "Class Data"; it.data = []; place(320, 220); }
        else if (type === 'spin') { it.type = 'spin'; it.ang = 0; it.opts = ['A', 'B', 'C', 'D']; place(220, 260); }
        else return;
        zone.subItems.push(it);
        Breakout.renderItems(); Breakout._pushHistory();
        Breakout.setTool('select'); Breakout._setSelected(it.id);
        Breakout._scheduleThumbUpdate();
    },
    _free: (px, py, w, h, items) => {
        const pad = 20, hit = (x, y) => items.some(i => x < i.x + (i.w || 180) + pad && x + w + pad > i.x && y < i.y + (i.h || 130) + pad && y + h + pad > i.y);
        if (!hit(px, py)) return { x: px, y: py };
        const step = Math.max(40, Math.min(w, h) / 2);
        for (let r = step; r <= 1600; r += step) { const n = Math.max(8, Math.ceil(2 * Math.PI * r / (step * 1.1))); for (let s = 0; s < n; s++) { const a = s / n * Math.PI * 2, x = px + Math.cos(a) * r, y = py + Math.sin(a) * r; if (!hit(x, y)) return { x, y }; } }
        return { x: px + 30, y: py + 30 };
    },
    createExit: (mode) => {
        if (mode === 'lw') { Breakout._addExit(mode, "List one thing you learned and one thing you wonder.", null); return; }
        Actions.createExit(mode, (q, opts) => Breakout._addExit(mode, q, opts));
    },
    _addExit: (mode, promptTxt, opts) => {
        const zone = Breakout._getZone(); if (!zone) return;
        if (!zone.subItems) zone.subItems = [];
        const view = Breakout._state.view, r = $('breakout-main').getBoundingClientRect();
        const it = { id: genId(), type: 'zone', zoneType: 'exit', exitMode: mode, title: 'Exit Ticket', prompt: clampStr(promptTxt, 300), opts, w: 420, h: 320 };
        const pos = Breakout._free(r.width / 2 / view.z - view.x - it.w / 2, r.height / 2 / view.z - view.y - it.h / 2, it.w, it.h, zone.subItems);
        it.x = pos.x; it.y = pos.y;
        zone.subItems.push(it);
        Breakout.renderItems(); Breakout._pushHistory(); Breakout.setTool('select'); Breakout._setSelected(it.id); Breakout._scheduleThumbUpdate();
    },
    loadTemplate: (t) => {
        const zone = Breakout._getZone(); if (!zone) return;
        if (!zone.subItems) zone.subItems = [];
        const view = Breakout._state.view, r = $('breakout-main').getBoundingClientRect();
        const cx = r.width / 2 / view.z - view.x, cy = r.height / 2 / view.z - view.y;
        const allX = t.items.flatMap(i => [i.x, i.x + (i.w || 200)]), allY = t.items.flatMap(i => [i.y, i.y + (i.h || 150)]);
        const offX = cx - (Math.min(...allX) + Math.max(...allX)) / 2, offY = cy - (Math.min(...allY) + Math.max(...allY)) / 2;
        t.items.forEach(i => { const item = { ...JSON.parse(JSON.stringify(i)), id: genId(), x: i.x + offX, y: i.y + offY }; delete item.children; delete item.parentZone; if (item.type === 'zone' && !item.zoneType) item.title = item.title || 'Zone'; zone.subItems.push(item); });
        Breakout.renderItems(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
    },
    toggleSketchMode: (on) => {
        Breakout._state.sketchMode = on === undefined ? !Breakout._state.sketchMode : !!on;
        if (Breakout._state.sketchMode && Breakout._state.tool !== 'draw') Breakout.setTool('draw');
        if (window.Shell) Shell.syncDraw();
    },
    _strokeToItem: (points, color, width) => {
        if (!points || points.length < 2) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        const margin = 16, bx = minX - margin, by = minY - margin, bw = Math.max(80, maxX - minX + margin * 2), contentH = Math.max(60, maxY - minY + margin * 2);
        const canvas = document.createElement('canvas'); canvas.width = bw; canvas.height = contentH;
        const ctx = canvas.getContext('2d'); ctx.strokeStyle = safeColor(color) || '#000'; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x - bx, p.y - by); else ctx.lineTo(p.x - bx, p.y - by); }); ctx.stroke();
        return { id: genId(), type: 'note', sub: 'sketch', src: canvas.toDataURL(), text: '', x: bx, y: by, w: bw, h: Math.max(140, contentH + 70) };
    },
    pinInkAsItems: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const ink = zone.subInk || [];
        if (ink.length === 0) { UI.toast("There is no ink to pin", 'warn'); return; }
        const newItems = ink.map(s => Breakout._strokeToItem(s.points, s.color, s.width)).filter(Boolean);
        if (newItems.length > 0) {
            zone.subInk = []; if (!zone.subItems) zone.subItems = []; zone.subItems.push(...newItems);
            Breakout.renderItems(); Breakout.renderInk(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
            UI.toast(`Pinned ${newItems.length} drawing${newItems.length > 1 ? 's' : ''} as notes`, 'success');
        }
    },
    setRoomColor: (color) => {
        const zone = Breakout._getZone(); if (!zone) return;
        zone.roomColor = safeColor(color) || '#8b5cf6';
        StateManager.updateItem(zone.id, { roomColor: zone.roomColor });
        if (window.Shell) Shell.syncRoomColor();
    },
    _screenToWorld: (evt) => {
        const rect = $('breakout-main').getBoundingClientRect(), v = Breakout._state.view;
        return { x: (evt.clientX - rect.left) / v.z - v.x, y: (evt.clientY - rect.top) / v.z - v.y };
    },
    _scheduleThumbUpdate: () => {
        if (Breakout._thumbTimer) clearTimeout(Breakout._thumbTimer);
        Breakout._thumbTimer = setTimeout(() => {
            const zone = Breakout._getZone() || State.items.find(i => i.id === Breakout._lastZone); if (!zone) return;
            const el = document.getElementById(zone.id), thumb = el && el.querySelector('.breakout-thumb');
            if (thumb) Breakout.renderThumb(zone, thumb);
            Breakout._thumbTimer = null;
        }, 500);
    },
    renderThumb: (zone, canvas) => {
        if (!canvas || !canvas.getContext) return;
        const items = zone.subItems || [], ink = zone.subInk || [];
        const w = canvas.offsetWidth || 280, h = canvas.offsetHeight || 180;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
        if (items.length === 0 && ink.length === 0) { ctx.fillStyle = 'rgba(139,92,246,0.06)'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = 'rgba(100,116,139,.8)'; ctx.font = '600 13px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Empty room', w / 2, h / 2 + 4); return; }
        let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
        items.forEach(i => { mnX = Math.min(mnX, i.x); mnY = Math.min(mnY, i.y); mxX = Math.max(mxX, i.x + i.w); mxY = Math.max(mxY, i.y + i.h); });
        ink.forEach(s => s.points.forEach(p => { mnX = Math.min(mnX, p.x); mnY = Math.min(mnY, p.y); mxX = Math.max(mxX, p.x); mxY = Math.max(mxY, p.y); }));
        if (!isFinite(mnX)) return;
        const pad = 20, ww = mxX - mnX + pad * 2, wh = mxY - mnY + pad * 2, sc = Math.min(w / ww, h / wh);
        const ox = (w - ww * sc) / 2, oy = (h - wh * sc) / 2, tx = v => (v - mnX + pad) * sc + ox, ty = v => (v - mnY + pad) * sc + oy;
        items.forEach(i => {
            const t = i.type || 'note';
            if (t === 'zone') { ctx.fillStyle = 'rgba(37,99,235,0.08)'; ctx.strokeStyle = safeColor(i.color) || 'rgba(100,116,139,.5)'; }
            else { const hd = TYPES[i.sub] || TYPES.meta; ctx.fillStyle = (t === 'poll' || t === 'graph') ? '#bfdbfe' : (t === 'spin' ? '#c7d2fe' : hd.col); ctx.strokeStyle = t === 'note' ? hd.bor : '#64748b'; }
            ctx.lineWidth = 1; ctx.beginPath(); ctx.rect(tx(i.x), ty(i.y), i.w * sc, i.h * sc); ctx.fill(); ctx.stroke();
        });
        ink.forEach(s => { if (!s.points || s.points.length < 2) return; ctx.strokeStyle = safeColor(s.color) || '#000'; ctx.lineWidth = Math.max(1, parseFloat(s.width) * sc); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(tx(s.points[0].x), ty(s.points[0].y)); s.points.slice(1).forEach(p => ctx.lineTo(tx(p.x), ty(p.y))); ctx.stroke(); });
    },

    /* pointer handling on the room canvas */
    initEvents: () => {
        Gestures.attach($('breakout-main'), {
            skip: (e) => !Breakout._zoneId || e.target.closest('textarea, input, [data-act]') && !e.target.closest('.i-head'),
            getView: () => Breakout._state.view,
            setView: (v) => { Object.assign(Breakout._state.view, v); if (window.Shell) Shell.syncZoom(); },
            down: Breakout._onDown, move: Breakout._onMove, up: Breakout._onEnd,
            cancel: () => { Breakout.drag = null; Breakout.currentPath = []; }
        });
        // item drags start on the item element (it stops propagation), so listen for their move/up on the window too
        window.addEventListener('pointermove', (e) => { if (Breakout.drag && (Breakout.drag.mode === 'move-item' || Breakout.drag.mode === 'resize-item') && e.pointerId === Breakout._activePointer) { e.preventDefault(); Breakout._onMove(e); } }, { passive: false });
        window.addEventListener('pointerup', (e) => { if (Breakout.drag && (Breakout.drag.mode === 'move-item' || Breakout.drag.mode === 'resize-item') && e.pointerId === Breakout._activePointer) Breakout._onEnd(e); });
    },
    _onDown: (e) => {
        if (!Breakout._zoneId) return false;
        if (e.target.closest('.item') && ['select', 'pan'].includes(Breakout._state.tool)) return false;
        Breakout._setSelected(null);
        const tool = Breakout._state.tool, coords = Breakout._screenToWorld(e);
        if (tool === 'pan' || tool === 'select' || e.button === 1 || e.button === 2) { const v = Breakout._state.view; Breakout.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }; return true; }
        if (tool === 'draw') { Breakout.drag = { mode: 'draw' }; Breakout.currentPath = [coords]; return true; }
        if (tool === 'eraser') { Breakout.drag = { mode: 'eraser' }; return true; }
        if (tool === 'laser') { Breakout.drag = { mode: 'laser' }; return true; }
        return false;
    },
    _onMove: (e) => {
        const d = Breakout.drag; if (!d) return;
        const coords = Breakout._screenToWorld(e), v = Breakout._state.view;
        if (d.mode === 'pan') { v.x = d.vx + (e.clientX - d.sx) / v.z; v.y = d.vy + (e.clientY - d.sy) / v.z; }
        else if (d.mode === 'draw') { const last = Breakout.currentPath[Breakout.currentPath.length - 1]; if (!last || Math.hypot(coords.x - last.x, coords.y - last.y) > 0.6) Breakout.currentPath.push(coords); }
        else if (d.mode === 'move-item') {
            if (!d.moved) { if (Math.hypot(e.clientX - d.sx0, e.clientY - d.sy0) < 5) return; d.moved = true; }
            d.item.x = d.ix + (coords.x - d.sx); d.item.y = d.iy + (coords.y - d.sy);
            d.el.style.transform = `translate(${d.item.x}px,${d.item.y}px)`;
        } else if (d.mode === 'resize-item') {
            d.item.w = Math.max(140, d.iw + (coords.x - d.sx)); d.item.h = Math.max(100, d.ih + (coords.y - d.sy));
            d.el.style.width = `${d.item.w}px`; d.el.style.height = `${d.item.h}px`;
        } else if (d.mode === 'eraser') {
            const zone = Breakout._getZone(); if (!zone) return;
            const { changed, newInk } = InkManager.eraseAt(coords.x, coords.y, zone.subInk || [], v.z);
            if (changed) { zone.subInk = newInk; Breakout.renderInk(); d.erased = true; }
        } else if (d.mode === 'laser') {
            const rect = $('breakout-main').getBoundingClientRect();
            const dot = document.createElement('div'); dot.className = 'laser-dot'; dot.style.left = (e.clientX - rect.left) + 'px'; dot.style.top = (e.clientY - rect.top) + 'px';
            $('breakout-main').appendChild(dot); setTimeout(() => dot.remove(), 600);
        }
    },
    _onEnd: () => {
        const d = Breakout.drag; if (!d) return;
        const zone = Breakout._getZone();
        if (d.mode === 'draw' && Breakout.currentPath.length > 1 && zone) {
            if (Breakout._state.sketchMode) {
                const it = Breakout._strokeToItem(Breakout.currentPath, Breakout._state.color, Breakout._state.width);
                if (it) { if (!zone.subItems) zone.subItems = []; zone.subItems.push(it); Breakout.renderItems(); }
            } else {
                if (!zone.subInk) zone.subInk = [];
                zone.subInk.push({ id: genId(), points: [...Breakout.currentPath], color: Breakout._state.color, width: Breakout._state.width });
                Breakout.renderInk();
            }
            Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
        }
        if (d.mode === 'eraser' && d.erased) { Breakout._pushHistory(); Breakout._scheduleThumbUpdate(); }
        if (d.mode === 'move-item' && d.moved) { Breakout._pushHistory(); Breakout._scheduleThumbUpdate(); }
        if (d.mode === 'resize-item' && (d.item.w !== d.iw || d.item.h !== d.ih)) { Breakout._pushHistory(); Breakout._scheduleThumbUpdate(); }
        Breakout.drag = null; Breakout.currentPath = [];
        if ($('bk-temp-ink')) $('bk-temp-ink').innerHTML = '';
    }
};

/* --- TOOL + SMALL GLOBALS --- */
window.setTool = function (t) {
    if (Workspace.mode !== 'board') { Workspace.setTool(t); return; }
    State.tool = t;
    if (t !== 'select') State.multiSelect = false;
    if (t !== 'pan' && t !== 'select') { InkManager.deselectStroke(); }
    $('viewport').className = t === 'pan' ? 'panning' : (t === 'draw' || t === 'eraser' ? 'drawing' : (t === 'laser' ? 'laser' : ''));
    if (window.Shell) Shell.syncTools();
};
window.SafeSend = function (conn, data) {
    try { if (conn && conn.open) { conn.send(JSON.stringify(data)); return true; } } catch (e) { console.warn('send failed', e); }
    return false;
};
window.Roster = function () { if (window.Shell) Shell.Panel.renderRoster(); };
window.Tab = function (n) { if (window.Shell) Shell.Panel.showTab(['students', 'activity', 'queue'][n] || 'students'); };
