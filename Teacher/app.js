/* InquiryDQB teacher console — core logic (state, items, network, consensus, breakout).
   UI chrome (panels, flyouts, dialogs, boards home) lives in shell.js. */
const $ = id => document.getElementById(id);
const genId = () => DQBUI.genId();
// esc() escapes quotes too, so it is safe in text *and* attribute contexts.
const sanitizeHTML = DQBUI.esc;
const { esc, safeId, safeColor, safeImg, clampStr } = DQBUI;

/* --- CONSTANTS --- */
window.TYPES = {
    // col: paper colour · bor: border / accent · ink: header text (≥ 4.5:1 on the header tint)
    notice: { col: '#fef3c7', bor: '#d97706', ink: '#92400e', icon: '👁️', lbl: 'Notice' },
    wonder: { col: '#bae6fd', bor: '#0284c7', ink: '#075985', icon: '❓', lbl: 'Wonder' },
    idea:   { col: '#bbf7d0', bor: '#166534', ink: '#14532d', icon: '💡', lbl: 'Idea' },
    test:   { col: '#fecaca', bor: '#dc2626', ink: '#7f1d1d', icon: '🧪', lbl: 'Testable' },
    meta:   { col: '#f8fafc', bor: '#64748b', ink: '#334155', icon: '📝', lbl: 'Note' },
    sketch: { col: '#ffffff', bor: '#64748b', ink: '#334155', icon: '✏️', lbl: 'Sketch' },
    claim: { col: '#fffbeb', bor: '#d97706', ink: '#92400e', icon: '🤔', lbl: 'Claim' },
    evidence: { col: '#f0f9ff', bor: '#0284c7', ink: '#075985', icon: '📊', lbl: 'Evidence' },
    reasoning: { col: '#f0fdf4', bor: '#166534', ink: '#14532d', icon: '🔗', lbl: 'Reasoning' }
};

/* Colour groups: a student in a group writes into zones of the same colour. */
window.GROUPS = [
    { color: '#ef4444', name: 'Red' }, { color: '#f97316', name: 'Orange' }, { color: '#10b981', name: 'Green' },
    { color: '#3b82f6', name: 'Blue' }, { color: '#8b5cf6', name: 'Purple' }, { color: '#ec4899', name: 'Pink' }
];
window.groupName = (c) => { const g = GROUPS.find(x => x.color === String(c || '').toLowerCase()); return g ? g.name : (c ? 'Colour' : ''); };

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
    // class rules (persisted per device, not per board). anyZone: students without a zone of their own may pick any open zone
    settings: { names: true, approve: false, anyZone: true, peers: true },
    pending: [],            // student notes waiting for teacher approval
    votes: {}, blocked: {}, spaceDown: false, multiSelect: false, hasEntered: false,
    muted: {},              // student id (sid) -> true
    groupOf: {},            // student id (sid) -> group colour, so a group survives a dropped connection
    shared: [],             // ids of link cards, media items and zones (sets to explore) shared with the class right now (live only; not saved)
    explore: {},            // zone id -> student sid -> item id -> {o: opened, d: done, s: starred} (live only)
    timer: { endsAt: 0, running: false, remainingMs: 0, totalMs: 0 }
};

/* --- STATE MANAGER with EVENTS --- */
window.StateManager = {
    _queue: null,
    _notify: (action, payload) => {
        if (StateManager._queue) { StateManager._queue.push([action, payload]); return; }
        const event = new CustomEvent('statechange', { detail: { action, payload } });
        window.dispatchEvent(event);
    },
    /** Runs fn with change events held back, then sends them all: a composite edit (move notes and ink,
        turn strokes into a note) becomes one undo step, because history is snapshotted on the first event. */
    batch: (fn) => {
        const outer = !StateManager._queue;
        if (outer) StateManager._queue = [];
        try { return fn(); }
        finally {
            if (outer) { const q = StateManager._queue; StateManager._queue = null; q.forEach(([a, p]) => StateManager._notify(a, p)); }
        }
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
    /** Annotations on a picture, video or card: not undo steps (students add them live), saved and synced like any change. */
    setAnnos: (id, annos) => {
        const item = State.items.find(i => i.id === id); if (!item) return;
        item.annos = annos;
        StateManager._notify('items:annos', { id, annos });
    },
    deleteItems: (ids, options = { silent: false }) => {
        State.items = State.items.filter(i => !ids.includes(i.id));
        State.selection = State.selection.filter(id => !ids.includes(id));
        if (!options.silent) StateManager._notify('items:delete', { ids });
    },

    // Selection (items). A new item selection also drops selected ink unless keepInk is set (shift-click, box select).
    setSelection: (ids, options = { silent: false }) => {
        State.selection = ids;
        if (!options.keepInk && window.InkSel && InkSel.board) InkSel.board.clear(true);
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
    if (action === 'items:annos') {
        Board.save(true);
        Render.all();
        if (!State.isCoHost) Network.pushItem(payload.id);
        if (window.Shell && Shell.MediaView) Shell.MediaView.refresh(payload.id);
        if (Network.peer) Network.relay(action, payload);
        return;
    }
    // a shared card that is deleted or edited: students see the change
    if (State.shared.length && !State.isCoHost && payload && Network.touchesShared(action, payload)) Network._sharedChanged();
    if (window.Shell && Shell.MediaView && action === 'items:update' && (payload.items || []).some(u => u.id === Shell.MediaView.id)) Shell.MediaView.refresh(Shell.MediaView.id);
    // an open zone was renamed, recoloured or removed: students see what they can write into now
    if (Network.zonesWatch(action, payload)) Network._zonesChanged();

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
    // "is this item live right now" belongs to the running activity, not to the board, so undo never touches it
    _snap: () => JSON.stringify({ items: State.items, ink: State.ink }, (k, v) => (k === 'isOpen' ? undefined : v)),
    _restore: (json) => {
        const s = JSON.parse(json), live = new Set(State.items.filter(i => i.isOpen).map(i => i.id));
        const annos = new Map(State.items.filter(i => Array.isArray(i.annos)).map(i => [i.id, i.annos]));   // annotations are not undone
        StateManager.setFullState(s, { silent: true });
        State.items.forEach(i => { if (annos.has(i.id)) i.annos = annos.get(i.id); });
        if (State.isCoHost) State.items.forEach(i => { if (live.has(i.id)) i.isOpen = true; });   // a co-host mirrors the host's live items
        else Network.syncOpenFlags();
        State.selection = State.selection.filter(id => State.items.some(i => i.id === id));
        StateManager._notify('state:fullsync', s);
    },
    reset: () => { ActionHistory.stack = []; ActionHistory.index = -1; ActionHistory.push(); },
    push: () => {
        const snapshot = ActionHistory._snap();
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
        ActionHistory._restore(ActionHistory.stack[ActionHistory.index]);
        if (window.Shell) { Shell.syncHistory(); Shell.onSelection(); }
        UI.toast("Undone");
    },
    redo: () => {
        if (!ActionHistory.canRedo()) return;
        ActionHistory.index++;
        ActionHistory._restore(ActionHistory.stack[ActionHistory.index]);
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
    /** Glides the board so an item sits in the middle of the clear area, keeping the zoom. */
    centerOn: (it) => {
        const r = Viewport.rect(), z = State.view.z;
        Viewport.animateTo({ z, x: (r.x + r.w / 2) / z - (it.x + it.w / 2), y: (r.y + r.h / 2) / z - (it.y + it.h / 2) });
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
    /** Local database name. A host that signs teachers in gives each account its own (DQB_HOST.ns). */
    name: () => { const ns = safeId(String(DQBUI.host().ns || '')); return ns ? 'DQB_Ultimate_' + ns : 'DQB_Ultimate'; },
    init: () => new Promise(resolve => {
        let req;
        try { req = indexedDB.open(DB.name(), 2); }
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
    /** localStorage key of the last open board (per host account). */
    lastKey: () => { const ns = safeId(String(DQBUI.host().ns || '')); return ns ? 'lastBoard:' + ns : 'lastBoard'; },
    /** The host's account storage ({list, load, save, remove, rename}), or null when boards live on this device only. */
    cloud: () => { const c = DQBUI.host().storage; return c && typeof c.save === 'function' && typeof c.load === 'function' ? c : null; },
    /** Resolves with the promise's value, or rejects after ms (a slow network must never block opening a board). */
    within: (promise, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); Promise.resolve(promise).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); }),
    create: (tpl, name) => {
        State.id = genId(); State.name = clampStr(name || "My Board", 60);
        Board.rev = 0; Board._localRev = -1; Board._cloudRev = -1; Board._ts = 0;
        StateManager.setFullState({ items: [], ink: [], view: { x: 0, y: 0, z: 1 } }, { silent: true });
        localStorage.setItem(Board.lastKey(), State.id);
        ActionHistory.reset();
        Board.start({ fresh: true, template: tpl });
    },
    /** Opens a board: the newest of the copy on this device and the copy in the host account. */
    load: async (id) => {
        if (!safeId(id)) { UI.toast("Could not load that board.", 'error'); return; }
        let b = (await DB.getAll('boards')).find(x => x.id === id), remote = null;
        const cloud = Board.cloud();
        Board._cloudDirty = false;
        if (cloud) {
            try { remote = await Board.within(cloud.load(id), 8000); } catch (e) { remote = null; }   // offline: the copy on this device
            if (remote && Array.isArray(remote.items) && (!b || (Number(remote.ts) || 0) > (Number(b.ts) || 0))) {
                b = { id, name: clampStr(remote.name || 'My Board', 60), items: remote.items, ink: Array.isArray(remote.ink) ? remote.ink : [], view: remote.view, ts: Number(remote.ts) || Date.now() };
                DB.save(b).catch(() => {});
            } else if (b) Board._cloudDirty = !remote || (Number(b.ts) || 0) > (Number(remote.ts) || 0);    // this device has newer work: send it up
        }
        if (!b) { UI.toast(cloud ? "That board could not be opened. Check the connection and try again." : "That board could not be found on this device.", 'error'); if (window.Shell) Shell.Home.render(); return; }
        State.id = b.id; State.name = b.name || 'My Board';
        Board.rev = 0; Board._localRev = 0; Board._ts = Number(b.ts) || 0; Board._cloudRev = Board._cloudDirty ? -1 : 0;
        const items = (Array.isArray(b.items) ? b.items : []).map(i => Sanitize.item(i)).filter(Boolean);
        StateManager.setFullState({ items, ink: Sanitize.strokes(b.ink, 5000), view: Board.view(b.view) }, { silent: true });
        localStorage.setItem(Board.lastKey(), State.id);
        ActionHistory.reset();
        Board.start({ fresh: false });
        if (Board._cloudDirty) Board.cloudSave();
    },
    view: (v) => (v && typeof v === 'object' ? { x: Sanitize.num(v.x), y: Sanitize.num(v.y), z: Math.max(0.05, Math.min(5, Sanitize.num(v.z, 1, 5) || 1)) } : { x: 0, y: 0, z: 1 }),
    start: (opts) => {
        opts = opts || {};
        State.shared = [];
        Network.syncOpenFlags();             // a board saved mid-activity must not reopen showing zones as live
        Render.start();
        if (window.Shell) Shell.enterBoard(opts);
        if (!State.isCoHost) Network.host();
        if (window.Inbox) Inbox.start();       // what students added while the board was open without the console
        if (State.id) {
            if (window._autoSaveInterval) clearInterval(window._autoSaveInterval);
            window._autoSaveInterval = setInterval(() => Board.save(true, true), 30000);   // a safety net: writes only what changed
        }
        if (opts.template) UI.loadTemplate(opts.template);
        else if (opts.fresh) Board.save(true);
        DQBUI.emit('board', { id: State.id, name: State.name, fresh: !!opts.fresh });
    },
    setStartView: () => { Board.save(true); UI.toast("Start view saved", 'success'); },
    _timer: null,
    /** rev counts changes; the copy on this device and the account copy each remember the rev they hold. */
    rev: 0, _localRev: -1, _cloudRev: -1,
    save: (silent, unchanged) => {
        if (State.isCoHost || !State.id) return;
        if (!unchanged) Board.rev++;
        if (window.Shell) Shell.setSave('saving');
        clearTimeout(Board._timer);
        Board._timer = setTimeout(Board.flush, silent ? 450 : 0);
    },
    flush: async () => {
        clearTimeout(Board._timer);
        if (State.isCoHost || !State.id) return;
        const rev = Board.rev, changed = rev !== Board._localRev, ts = (changed || !Board._ts) ? Date.now() : Board._ts;
        try {
            if (changed || !Board._ts) await DB.save({ id: State.id, name: State.name, items: State.items, ink: State.ink, view: State.view, ts });
            Board._ts = ts; Board._localRev = rev;
            if (!Board.cloud() && window.Inbox) Inbox.flushAcks();
            if (Board.cloud() && rev !== Board._cloudRev) { Board._cloudDirty = true; Board.cloudSave(); }
            else if (window.Shell && !Board._cloudBusy && !Board._cloudDirty) Shell.setSave('saved');
        } catch (error) {
            console.error("Board.save failed:", error);
            if (window.Shell) Shell.setSave('error', error && error.message);
            if (Board.cloud()) { Board._cloudDirty = true; Board.cloudSave(); }       // the account copy still protects the work
        }
    },
    /* ---- the host account copy: sent a moment after the last change, one upload at a time ---- */
    _cloudDirty: false, _cloudBusy: false, _cloudT: null, _ts: 0,
    cloudSave: (delay) => {
        if (!Board.cloud() || State.isCoHost || !State.id) return;
        if (window.Shell) Shell.setSave('saving');
        clearTimeout(Board._cloudT);
        Board._cloudT = setTimeout(Board.cloudFlush, delay == null ? 2500 : delay);
    },
    cloudFlush: async () => {
        clearTimeout(Board._cloudT);
        const cloud = Board.cloud();
        if (!cloud || State.isCoHost || !State.id || !Board._cloudDirty) { if (cloud && window.Shell && !Board._cloudBusy && !Board._cloudDirty) Shell.setSave('saved'); return true; }
        if (Board._cloudBusy) { Board._cloudAgain = true; return false; }
        Board._cloudBusy = true; Board._cloudDirty = false; Board._cloudAgain = false;
        const id = State.id, rev = Board.rev;
        try {
            await Board.within(cloud.save({ id, name: State.name, items: State.items, ink: State.ink, view: State.view, ts: Board._ts || Date.now() }), 30000);
            if (State.id === id) { Board._cloudRev = rev; if (window.Inbox) Inbox.flushAcks(); }
            if (State.id === id && Board.rev !== rev) Board._cloudAgain = true;                // changed while it was on its way
            else if (window.Shell && State.id === id) Shell.setSave('saved', null, true);
            return true;
        } catch (e) {
            Board._cloudDirty = true;
            if (window.Shell && State.id === id) Shell.setSave('local', e && e.message);
            clearTimeout(Board._cloudT); Board._cloudT = setTimeout(Board.cloudFlush, 20000);  // try again in a while (and as soon as we are back online)
            return false;
        } finally {
            Board._cloudBusy = false;
            if (Board._cloudAgain) { Board._cloudAgain = false; Board.cloudSave(800); }
        }
    },
    exit: async () => {
        const n = Object.keys(State.students).filter(k => k !== 'HOST' && State.students[k].role !== 'cohost').length;
        const where = Board.cloud() ? (DQBUI.host().storage.label || 'your account') + ' and on this device' : 'this device';
        const ok = await DQBUI.Dialog.confirm({ title: 'Leave this board?', message: n ? `${n} student${n === 1 ? ' is' : 's are'} connected and will be disconnected. Your board is saved in ${where}.` : `Your board is saved in ${where}.`, confirmLabel: 'Leave board', icon: 'logout' });
        if (!ok) return;
        await Board.flush();
        if (Board.cloud()) { try { await Board.within(Board.cloudFlush(), 8000); } catch (e) { /* the copy on this device is complete; it is sent next time */ } }
        if (window._autoSaveInterval) clearInterval(window._autoSaveInterval);
        localStorage.removeItem(Board.lastKey());
        DQBUI.emit('leave', { id: State.id });
        const back = DQBUI.host().leaveUrl;
        if (typeof back === 'string' && back) location.href = back; else location.reload();
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
            StateManager.setFullState({ items: items.map(i => Sanitize.item(i)).filter(Boolean), ink: Sanitize.strokes(d.ink, 5000), view: Board.view(d.view) }, { silent: true });
            Board.rev = 0; Board._localRev = -1; Board._cloudRev = -1; Board._ts = 0;
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
            if (z.zoneType === 'consensus') (z.ink || []).forEach(s => InkTools.draw(ctx, s, -z.x, -z.y, 1));
        }
        for (const s of State.ink) InkTools.draw(ctx, s, 0, 0, 1);
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
            } else if (it.type === 'link') {
                ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.14)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; rr(it.x, it.y, it.w, it.h, 12); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.restore();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#93c5fd'; rr(it.x, it.y, it.w, it.h, 12); ctx.stroke();
                let ty = it.y + 22;
                ctx.fillStyle = '#1d4ed8'; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText(Render.linkLabel(it), it.x + 12, ty);
                const th = DQBUI.safeThumb(it.thumb);
                if (th) { const im = await loadImg(th); if (im) { const bw = it.w - 24, bh = Math.min(it.h * 0.45, bw * 0.6); const r = Math.max(bw / im.width, bh / im.height); ctx.save(); rr(it.x + 12, ty + 8, bw, bh, 8); ctx.clip(); ctx.drawImage(im, it.x + 12 + (bw - im.width * r) / 2, ty + 8 + (bh - im.height * r) / 2, im.width * r, im.height * r); ctx.restore(); ty += bh + 8; } }
                ctx.fillStyle = '#0f172a'; ty += 22 + wrap(it.title, it.x + 12, ty + 4, it.w - 24, 19, '700 15px Inter, sans-serif');
                ctx.fillStyle = '#475569'; wrap(Sanitize.hostOf(it.url), it.x + 12, Math.min(ty, it.y + it.h - 12), it.w - 24, 16, '12px Inter, sans-serif');
            } else if (it.type === 'media') {
                ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.14)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; rr(it.x, it.y, it.w, it.h, 12); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.restore();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#c4b5fd'; rr(it.x, it.y, it.w, it.h, 12); ctx.stroke();
                ctx.fillStyle = '#6d28d9'; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText(Render.mediaLabel(it), it.x + 12, it.y + 22);
                const fx = it.x + 12, fy = it.y + 32, fw = it.w - 24, fh = Math.max(40, it.h - 80);
                ctx.save(); rr(fx, fy, fw, fh, 8); ctx.clip(); ctx.fillStyle = '#0f172a'; ctx.fillRect(fx, fy, fw, fh);
                const src = it.kind === 'image' ? (safeImg(it.src, 1500000) || DQBUI.safeThumb(it.src)) : (safeImg(it.thumb, 150000) || DQBUI.safeThumb(it.thumb));
                const im = src ? await loadImg(src) : null;
                if (im) { const r = it.kind === 'image' ? Math.min(fw / im.width, fh / im.height) : Math.max(fw / im.width, fh / im.height); ctx.drawImage(im, fx + (fw - im.width * r) / 2, fy + (fh - im.height * r) / 2, im.width * r, im.height * r); }
                if (it.kind === 'image' && im) {                      // the drawings on the picture come with it
                    const r = Math.min(fw / im.width, fh / im.height), iw = im.width * r, ih = im.height * r, ox = fx + (fw - iw) / 2, oy = fy + (fh - ih) / 2;
                    (it.annos || []).filter(a => a.k === 'ink').forEach(a => { ctx.save(); ctx.strokeStyle = a.c; ctx.lineWidth = Math.max(1, a.w * iw * (a.tool === 'hl' ? 3 : 1)); ctx.globalAlpha = a.tool === 'hl' ? 0.38 : 1; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath(); a.pts.forEach((pt, k) => { const x = ox + pt[0] * iw, y = oy + pt[1] * ih; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.restore(); });
                }
                if (it.kind === 'video') { ctx.fillStyle = 'rgba(239,68,68,0.95)'; ctx.beginPath(); ctx.arc(fx + fw / 2, fy + fh / 2, 24, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(fx + fw / 2 - 8, fy + fh / 2 - 12); ctx.lineTo(fx + fw / 2 + 12, fy + fh / 2); ctx.lineTo(fx + fw / 2 - 8, fy + fh / 2 + 12); ctx.closePath(); ctx.fill(); }
                ctx.restore();
                ctx.fillStyle = '#0f172a'; wrap(it.title || (it.kind === 'video' ? 'Video' : 'Picture'), it.x + 12, fy + fh + 22, it.w - 24, 18, '700 14px Inter, sans-serif');
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

window.addEventListener('online', () => { if (Board._cloudDirty) Board.cloudSave(300); });

/* --- INK TOOLS: geometry, painting and conversion shared by the board, consensus models and breakout rooms --- */
window.InkTools = {
    NS: 'http://www.w3.org/2000/svg',
    /** Drawn line width (markers are drawn three times wider, at 40% opacity). */
    width: (s) => (parseFloat(s && s.width) || 4) * (s && s.highlight ? 3 : 1),
    pathD: (pts) => { if (!pts || !pts.length) return ''; let d = `M ${pts[0].x} ${pts[0].y}`; for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`; return d; },
    /** The two barbs and tip of an arrow stroke, or null. */
    arrowHead: (s) => {
        const p = s && s.points; if (!s.arrow || !p || p.length < 2) return null;
        const a = p[p.length - 1]; let b = p[0];
        for (let i = p.length - 2; i >= 0; i--) { if (Math.hypot(a.x - p[i].x, a.y - p[i].y) > 8) { b = p[i]; break; } }
        const ang = Math.atan2(a.y - b.y, a.x - b.x), L = 10 + (parseFloat(s.width) || 4) * 2;
        return { tip: a, l: { x: a.x - L * Math.cos(ang - 0.45), y: a.y - L * Math.sin(ang - 0.45) }, r: { x: a.x - L * Math.cos(ang + 0.45), y: a.y - L * Math.sin(ang + 0.45) } };
    },
    /** World bounds of strokes, padded by half the line width (and arrow heads). */
    bounds: (strokes) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        (strokes || []).forEach(s => {
            if (!s || !Array.isArray(s.points)) return;
            const r = InkTools.width(s) / 2 + (s.arrow ? 10 + (parseFloat(s.width) || 4) * 2 : 0);
            s.points.forEach(p => { if (p.x - r < minX) minX = p.x - r; if (p.y - r < minY) minY = p.y - r; if (p.x + r > maxX) maxX = p.x + r; if (p.y + r > maxY) maxY = p.y + r; });
        });
        return isFinite(minX) ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
    },
    segDist: (px, py, ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    },
    /** True when the world point (x, y) is within tol of the stroke's line. */
    hit: (s, x, y, tol) => {
        const p = s && s.points; if (!p || !p.length) return false;
        const r = tol + InkTools.width(s) / 2, b = InkTools.bounds([s]);
        if (!b || x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) return false;
        if (p.length === 1) return Math.hypot(p[0].x - x, p[0].y - y) <= r;
        for (let i = 1; i < p.length; i++) if (InkTools.segDist(x, y, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y) <= r) return true;
        return false;
    },
    /** True when any part of the stroke lies inside the world rectangle {x0, y0, x1, y1}. */
    inRect: (s, r) => {
        const p = s && s.points; if (!p || !p.length) return false;
        const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
        if (p.some(q => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1)) return true;
        const b = InkTools.bounds([s]);
        if (!b || b.maxX < x0 || b.minX > x1 || b.maxY < y0 || b.minY > y1) return false;
        const o = (a, c, d) => Math.sign((c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x));
        const cross = (a, c, d, e) => o(a, c, d) !== o(a, c, e) && o(d, e, a) !== o(d, e, c);
        const edges = [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]];
        for (let i = 1; i < p.length; i++) for (const [e0, e1] of edges) if (cross(p[i - 1], p[i], e0, e1)) return true;
        return false;
    },
    translate: (s, dx, dy) => ({ ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }),
    /**
     * Paints strokes into an <svg>: one <g data-ink="id"> per stroke so a selection can be moved by transform.
     * o.sel (Set) draws a halo behind selected strokes; o.offset {dx, dy} shifts them (live drag preview).
     */
    paint: (svg, strokes, o) => {
        if (!svg) return;
        o = o || {};
        const NS = InkTools.NS, sel = o.sel && o.sel.size ? o.sel : null, off = o.offset;
        const mk = (tag, attrs) => { const el = document.createElementNS(NS, tag); Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k])); return el; };
        svg.textContent = '';
        const frag = document.createDocumentFragment(), picked = [];
        (strokes || []).forEach(s => {
            if (!s || !Array.isArray(s.points) || s.points.length < 2) return;
            const g = mk('g', { 'data-ink': s.id }), d = InkTools.pathD(s.points), col = safeColor(s.color) || '#000000', w = InkTools.width(s);
            const isSel = !!(sel && sel.has(s.id));
            if (isSel) { g.appendChild(mk('path', { d, class: 'ink-halo', 'stroke-width': w + 10, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); picked.push(s); }
            const path = mk('path', { d, stroke: col, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
            if (s.highlight) path.setAttribute('opacity', '0.4');
            g.appendChild(path);
            const ah = InkTools.arrowHead(s);
            if (ah) g.appendChild(mk('path', { d: `M ${ah.l.x} ${ah.l.y} L ${ah.tip.x} ${ah.tip.y} L ${ah.r.x} ${ah.r.y} Z`, fill: col, stroke: col, 'stroke-width': Math.max(1, (parseFloat(s.width) || 4) / 2), 'stroke-linejoin': 'round' }));
            if (isSel && off) g.setAttribute('transform', `translate(${off.dx} ${off.dy})`);
            frag.appendChild(g);
        });
        if (picked.length > 1) {
            const b = InkTools.bounds(picked), pad = 6;
            const box = mk('rect', { class: 'ink-selbox', x: b.minX - pad, y: b.minY - pad, width: b.w + pad * 2, height: b.h + pad * 2, rx: 6 });
            if (off) box.setAttribute('transform', `translate(${off.dx} ${off.dy})`);
            frag.appendChild(box);
        }
        svg.appendChild(frag);
    },
    /** Draws one stroke on a 2D canvas; world point p lands at ((p.x - ox) * k, (p.y - oy) * k). */
    draw: (ctx, s, ox, oy, k) => {
        const p = s && s.points; if (!p || p.length < 2) return;
        k = k || 1; ox = ox || 0; oy = oy || 0;
        const col = safeColor(s.color) || '#000000', X = q => (q.x - ox) * k, Y = q => (q.y - oy) * k;
        ctx.save();
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = InkTools.width(s) * k;
        if (s.highlight) ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[0])); for (let i = 1; i < p.length; i++) ctx.lineTo(X(p[i]), Y(p[i])); ctx.stroke();
        const ah = InkTools.arrowHead(s);
        if (ah) { ctx.lineWidth = Math.max(1, (parseFloat(s.width) || 4) / 2) * k; ctx.beginPath(); ctx.moveTo(X(ah.l), Y(ah.l)); ctx.lineTo(X(ah.tip), Y(ah.tip)); ctx.lineTo(X(ah.r), Y(ah.r)); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        ctx.restore();
    },
    /**
     * Renders strokes into one transparent PNG, sharp at up to 2x, kept small enough to sync to students.
     * Returns { src, x, y, w, h } where x/y/w/h is the drawing's box on the board, or null.
     */
    toImage: (strokes, o) => {
        o = o || {};
        const b = InkTools.bounds(strokes); if (!b) return null;
        const m = o.margin == null ? 10 : o.margin;
        const w = Math.max(24, b.w + m * 2), h = Math.max(24, b.h + m * 2), x = (b.minX + b.maxX) / 2 - w / 2, y = (b.minY + b.maxY) / 2 - h / 2;
        let k = Math.min(2, (o.maxSide || 1800) / Math.max(w, h));
        for (let attempt = 0; attempt < 5; attempt++) {
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
            const ctx = cv.getContext('2d');
            strokes.forEach(s => InkTools.draw(ctx, s, x, y, k));
            const src = cv.toDataURL('image/png');
            if (src.length <= (o.maxBytes || 1400000)) return { src, x, y, w, h };
            k *= 0.6;
        }
        return null;
    },
    /** Groups strokes whose boxes touch or sit within `gap` of each other: one group per drawing. */
    clusters: (strokes, gap) => {
        gap = gap == null ? 60 : gap;
        const n = strokes.length, box = strokes.map(s => InkTools.bounds([s])), parent = strokes.map((_, i) => i);
        const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const a = box[i], c = box[j];
            if (a && c && a.minX - gap <= c.maxX && c.minX - gap <= a.maxX && a.minY - gap <= c.maxY && c.minY - gap <= a.maxY) parent[find(i)] = find(j);
        }
        const groups = new Map();
        strokes.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
        return [...groups.values()];
    }
};

/**
 * Selected ink on one canvas. Each workspace (board, consensus model, breakout room) creates one with an adapter:
 *   ink()            current strokes          zoom()     current zoom        svg()   the <svg> the strokes are painted in
 *   commit(newInk)   store + history + sync   changed()  repaint + toolbar   toNotes(images, keepInk) turn drawings into notes
 */
window.InkSel = {
    THICKNESS: [['Thin', 2], ['Medium', 4], ['Thick', 8], ['Extra thick', 14]],
    create: (cfg) => {
        const api = {
            sel: new Set(),
            count: () => api.sel.size,
            has: (id) => api.sel.has(id),
            ids: () => [...api.sel],
            strokes: () => cfg.ink().filter(s => api.sel.has(s.id)),
            prune: () => { if (!api.sel.size) return; const live = new Set(cfg.ink().map(s => s.id)); api.sel.forEach(id => { if (!live.has(id)) api.sel.delete(id); }); },
            set: (ids, additive) => { if (!additive) api.sel.clear(); (ids || []).forEach(id => api.sel.add(id)); cfg.changed(); },
            toggle: (id) => { if (api.sel.has(id)) api.sel.delete(id); else api.sel.add(id); cfg.changed(); },
            clear: (quiet) => { if (!api.sel.size) return; api.sel.clear(); if (!quiet) cfg.changed(); },
            selectAll: () => { api.sel = new Set(cfg.ink().map(s => s.id)); cfg.changed(); },
            /** Topmost stroke under a world point, with a tolerance in screen pixels. */
            hitAt: (x, y, tolPx) => { const ink = cfg.ink(), tol = (tolPx || 10) / (cfg.zoom() || 1); for (let i = ink.length - 1; i >= 0; i--) if (InkTools.hit(ink[i], x, y, tol)) return ink[i].id; return null; },
            inRect: (r) => cfg.ink().filter(s => InkTools.inRect(s, r)).map(s => s.id),
            bounds: () => InkTools.bounds(api.strokes()),
            /** Union of the selected strokes' boxes on screen (for placing the selection toolbar). */
            screenRect: () => {
                const svg = cfg.svg(); if (!svg || !api.sel.size) return null;
                let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
                svg.querySelectorAll('g[data-ink]').forEach(g => { if (!api.sel.has(g.getAttribute('data-ink'))) return; const rc = g.getBoundingClientRect(); if (!rc.width && !rc.height) return; l = Math.min(l, rc.left); t = Math.min(t, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom); });
                return isFinite(l) ? { left: l, top: t, right: r, bottom: b } : null;
            },
            /** Live drag preview: shifts the painted selection without touching the data. */
            preview: (dx, dy) => {
                const svg = cfg.svg(); if (!svg) return;
                const t = `translate(${dx} ${dy})`;
                svg.querySelectorAll('g[data-ink]').forEach(g => { if (api.sel.has(g.getAttribute('data-ink'))) g.setAttribute('transform', t); });
                const box = svg.querySelector('.ink-selbox'); if (box) box.setAttribute('transform', t);
            },
            map: (fn) => { if (!api.sel.size) return; cfg.commit(cfg.ink().map(s => (api.sel.has(s.id) ? fn(s) : s))); },
            recolor: (c) => { c = safeColor(c); if (c) api.map(s => ({ ...s, color: c })); },
            setStrokeWidth: (w) => { w = Math.max(1, Math.min(40, parseFloat(w) || 4)); api.map(s => ({ ...s, width: w })); },
            translate: (dx, dy) => { if (dx || dy) api.map(s => InkTools.translate(s, dx, dy)); },
            remove: () => {
                const n = api.sel.size; if (!n) return 0;
                const keep = cfg.ink().filter(s => !api.sel.has(s.id));
                api.sel.clear(); cfg.commit(keep); cfg.changed();
                return n;
            },
            duplicate: (dx, dy) => {
                const copies = api.strokes().map(s => ({ ...InkTools.translate(s, dx == null ? 24 : dx, dy == null ? 24 : dy), id: genId() }));
                if (!copies.length) return [];
                api.sel = new Set(copies.map(c => c.id));
                cfg.commit(cfg.ink().concat(copies)); cfg.changed();
                return copies;
            },
            /** The selected strokes become ONE sketch note (as many images as asked when `each` is set). */
            combine: (each) => {
                const strokes = api.strokes(); if (!strokes.length) return null;
                const images = (each ? strokes.map(s => [s]) : [strokes]).map(g => InkTools.toImage(g)).filter(Boolean);
                if (!images.length) { UI.toast('That drawing is too large to turn into a note', 'error'); return null; }
                const keep = cfg.ink().filter(s => !api.sel.has(s.id));
                api.sel.clear();
                const made = cfg.toNotes(images, keep);
                UI.toast(images.length === 1 ? (strokes.length > 1 ? `${strokes.length} strokes combined into one note` : 'Stroke turned into a note') : `${images.length} notes made from your ink`, 'success');
                return made;
            },
            /** Every drawing (strokes that touch or sit close together) becomes its own note. */
            pinAll: () => {
                const ink = cfg.ink();
                if (!ink.length) { UI.toast('There is no ink to pin', 'warn'); return null; }
                const images = InkTools.clusters(ink).map(g => InkTools.toImage(g)).filter(Boolean);
                if (!images.length) return null;
                api.sel.clear();
                const made = cfg.toNotes(images, []);
                UI.toast(`Pinned ${ink.length} stroke${ink.length === 1 ? '' : 's'} as ${images.length} note${images.length === 1 ? '' : 's'}`, 'success');
                return made;
            }
        };
        return api;
    }
};

/* --- INK & DRAWING (main board) --- */
window.InkManager = {
    currentPath: [],
    sketchMode: false,
    setColor: (c) => {
        State.draw.color = c;
        if (InkSel.board.count()) { InkSel.board.recolor(c); if (window.Shell) Shell.syncDraw(); return; }
        if (State.tool !== 'draw') window.setTool('draw');
        if (window.Shell) Shell.syncDraw();
    },
    setWidth: (w) => { State.draw.width = Math.max(1, Math.min(40, parseInt(w) || 4)); if (window.Shell) Shell.syncDraw(); },
    toggleSketchMode: (on) => {
        InkManager.sketchMode = on === undefined ? !InkManager.sketchMode : !!on;
        if (window.Shell) Shell.syncDraw();
        UI.toast(InkManager.sketchMode ? 'Sketch notes: each stroke becomes a note' : 'Annotate: drawing on the board');
    },
    /** A sketch note that shows `img` where the ink was (the note's header sits just above the drawing). */
    noteFromImage: (img) => {
        const head = 34, caption = 36, w = Math.max(140, Math.round(img.w)), h = Math.max(140, Math.round(img.h + head + caption));
        const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
        return { id: genId(), type: 'note', sub: 'sketch', src: img.src, text: '', x: Math.round(cx - w / 2), y: Math.round(cy - (h - head - caption) / 2 - head), w, h, groupId: null };
    },
    strokeToItem: (pts, color, width) => {
        if (!pts || pts.length < 2) return null;
        const img = InkTools.toImage([{ id: 'tmp', points: pts, color: safeColor(color) || State.draw.color, width: width || State.draw.width }]);
        return img ? InkManager.noteFromImage(img) : null;
    },
    pinToItems: () => InkSel.board.pinAll(),
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
    pointsToPath: (pts) => InkTools.pathD(pts),
    clear: async () => {
        if (!State.ink.length) { UI.toast('There is no ink to clear', 'warn'); return; }
        const ok = await DQBUI.Dialog.confirm({ title: 'Clear all ink?', message: 'Every drawing on the board will be removed. You can undo this.', confirmLabel: 'Clear ink', danger: true });
        if (!ok) return;
        InkSel.board.clear(true); StateManager.setInk([]); if (window.Shell) Shell.onSelection();
    },
    eraseAt: (x, y, inkArray, zoom) => {
        const thresh = 20 / (zoom || State.view.z);
        const initLen = inkArray.length;
        const filteredInk = inkArray.filter(s => !s.points.some(p => Math.hypot(p.x - x, p.y - y) < thresh));
        if (filteredInk.length !== initLen) return { changed: true, newInk: filteredInk };
        return { changed: false, newInk: inkArray };
    }
};

InkSel.board = InkSel.create({
    ink: () => State.ink,
    zoom: () => State.view.z,
    svg: () => $('ink-layer'),
    commit: (ink) => StateManager.setInk(ink),
    changed: () => { Render.ink(); if (window.Shell) Shell.onSelection(); },
    toNotes: (images, keep) => {
        const notes = images.map(InkManager.noteFromImage);
        StateManager.batch(() => {
            StateManager.setInk(keep);
            StateManager.addItems(notes);
            StateManager.setSelection(notes.map(n => n.id));
        });
        return notes;
    }
});

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
                case 'link-open': Actions.openLink(id); break;
                case 'link-share': Network.toggleShare(id); break;
                case 'media-open': case 'annos': Actions.openMedia(id); break;
                case 'explore-progress': if (window.Shell) Shell.ExploreProgress.open(id); break;
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
        const openSet = new Set(Network.openZoneIds());

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
                if (col) el.style.setProperty('--zc', col); else el.style.removeProperty('--zc');
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
                const txt = (i.type === 'poll' || i.type === 'graph' || i.zoneType === 'exit') ? (i.isOpen ? 'Stop' : 'Broadcast') : (i.isOpen ? (openSet.has(i.id) ? 'Close' : 'Stop') : 'Open');
                if (zbtn.textContent !== txt) zbtn.textContent = txt;
                zbtn.classList.toggle('active', !!i.isOpen);
            }
            if (i.type === 'note' && !i.src && !el.classList.contains('consensus-child')) {
                const head = TYPES[i.sub] || TYPES.meta;
                if (wrapper) { wrapper.style.background = head.col; wrapper.style.borderColor = head.bor; }
                const h = el.querySelector('.i-head'); if (h) { h.style.background = head.bor + '26'; h.style.color = head.ink || head.bor; }
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
            if (i.type === 'link') Render.updateLink(el, i);
            if (i.type === 'media') Render.updateMedia(el, i);
            if (i.type === 'link' || i.type === 'media') Render.updateStats(el, i);
            if (i.type === 'zone') Render.updateZoneShare(el, i);

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
    _fillInk: (svg, ink) => { InkTools.paint(svg, ink); },
    /** Board ink. Strokes are picked by geometry (see InputController), so the painted paths take no pointer events. */
    ink: () => {
        InkSel.board.prune();
        const d = State.drag, live = d && d.mode === 'move' && d.moved && d.inkIds && d.inkIds.length;
        InkTools.paint($('ink-layer'), State.ink, { sel: InkSel.board.sel, offset: live ? { dx: d.dx || 0, dy: d.dy || 0 } : null });
        Render._mmDirty = true; Render._selDirty = true;
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
        if (d.type === 'media') el.dataset.kind = d.kind === 'video' ? 'video' : 'image';
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
        else if (d.type === 'link') { title = Render.linkLabel(d); iconHtml = icon(d.kind === 'link' ? 'link' : 'book', 'sm'); }
        else if (d.type === 'media') { title = Render.mediaLabel(d); iconHtml = icon(d.kind === 'video' ? 'video' : 'image', 'sm'); }
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
        else if (d.type === 'link') inner = `<div class="link-card"><img class="lc-thumb" alt="" draggable="false" hidden><div class="lc-body"><div class="lc-title"></div><div class="lc-desc"></div><div class="lc-host"></div></div><div class="lc-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="link-open">${icon('link', 'sm')}Open</button>${State.isCoHost ? '' : `<button type="button" class="btn btn-soft btn-sm lc-share" data-act="link-share" aria-label="Share with students">${icon('send', 'sm')}<span>Share</span></button>`}<span class="grow"></span><span class="card-stats"></span></div></div>`;
        else if (d.type === 'media') inner = `<div class="media-card"><div class="mc-frame"><img class="mc-img" alt="" draggable="false" hidden>${d.kind === 'video' ? `<span class="mc-play" aria-hidden="true">${icon('play', 'lg')}</span><span class="mc-prov"></span>` : ''}</div><div class="mc-title"></div><div class="lc-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="media-open">${icon(d.kind === 'video' ? 'play' : 'eye', 'sm')}${d.kind === 'video' ? 'Watch' : 'View'}</button>${State.isCoHost ? '' : `<button type="button" class="btn btn-soft btn-sm lc-share" data-act="link-share" aria-label="Share with students">${icon('send', 'sm')}<span>Share</span></button>`}<span class="grow"></span><span class="card-stats"></span></div></div>`;
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
            const h = wrap.querySelector('.i-head'); h.style.background = head.bor + '26'; h.style.color = head.ink || head.bor;
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
        // start where it belongs: otherwise the transform transition flies a new item in from the board's origin
        el.style.transform = `translate(${Number(d.x) || 0}px, ${Number(d.y) || 0}px)`;
        if (d.w) el.style.width = d.w + 'px';
        if (d.h) el.style.height = d.h + 'px';
        return el;
    },

    linkLabel: (d) => (d.kind === 'resource' ? 'Resource' : (d.kind === 'collection' ? 'Collection' : 'Link')) + (d.source ? ' · ' + d.source : ''),
    /** Link / resource card: text through textContent, the picture only if safeThumb accepts it. */
    updateLink: (el, d) => {
        const shared = Network.isShared(d.id);
        const sig = [d.title, d.desc, d.url, d.thumb, d.kind, d.source, shared].join('\u0001');
        if (el._lsig === sig) return; el._lsig = sig;
        const q = (c) => el.querySelector(c);
        if (q('.lc-title')) q('.lc-title').textContent = d.title || '';
        if (q('.lc-desc')) { q('.lc-desc').textContent = d.desc || ''; q('.lc-desc').hidden = !d.desc; }
        if (q('.lc-host')) q('.lc-host').textContent = Sanitize.hostOf(d.url);
        const img = q('.lc-thumb'), th = DQBUI.safeThumb(d.thumb);
        if (img) { if (th) { if (img.getAttribute('src') !== th) img.src = th; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; } }
        const auth = q('.auth-span'); if (auth) auth.textContent = Render.linkLabel(d);
        el.classList.toggle('is-shared', shared);
        const b = q('.lc-share'); if (b) Render.shareButton(b, d.id);
    },
    /** The Share button on a card: on while it is shared on its own or as part of a shared zone. */
    shareButton: (b, id) => {
        const own = (State.shared || []).includes(id), viaSet = !own && Network.isShared(id);
        b.classList.toggle('on', own || viaSet); b.setAttribute('aria-pressed', String(own));
        b.setAttribute('aria-label', own ? 'Shared – stop sharing with students' : (viaSet ? 'In set – shared with its zone; share it on its own too' : 'Share with students'));
        const t = b.querySelector('span'); if (t) t.textContent = own ? 'Shared' : (viaSet ? 'In set' : 'Share');
    },
    mediaLabel: (d) => (d.kind === 'video' ? 'Video' + (d.video ? ' · ' + DQBMedia.providerName(d.video) : '') : 'Picture') + (d.source ? ' · ' + d.source : ''),
    /** Picture / video card: the picture (or the video's cover) and the title. */
    updateMedia: (el, d) => {
        const shared = Network.isShared(d.id);
        const th = d.kind === 'image' ? (DQBUI.safeImg(d.thumb, 150000) || DQBUI.safeThumb(d.thumb) || DQBUI.safeImg(d.src, 1500000) || DQBUI.safeThumb(d.src)) : (DQBUI.safeImg(d.thumb, 150000) || DQBUI.safeThumb(d.thumb));
        const sig = [d.title, th ? th.length + th.slice(-24) : '', d.kind, d.source, JSON.stringify(d.video || null), shared].join('\u0001');
        if (el._msig === sig) return; el._msig = sig;
        const q = (c) => el.querySelector(c);
        const img = q('.mc-img');
        if (img) { if (th) { if (img.getAttribute('src') !== th) img.src = th; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; } }
        const t = q('.mc-title'); if (t) { t.textContent = d.title || (d.kind === 'video' ? 'Video' : 'Picture'); }
        const pv = q('.mc-prov'); if (pv) pv.textContent = d.video ? DQBMedia.providerName(d.video) : '';
        const auth = q('.auth-span'); if (auth) auth.textContent = Render.mediaLabel(d);
        el.classList.toggle('is-shared', shared);
        const b = q('.lc-share'); if (b) Render.shareButton(b, d.id);
    },
    /** Comments and markup on a card, and how far students got with it when it is in a shared set. */
    updateStats: (el, d) => {
        const box = el.querySelector('.card-stats'); if (!box) return;
        const c = DQBMedia.counts(d.annos), ex = Network.exploreCounts(d.id);
        const sig = [c.comments, c.ink + c.marks, c.pend, ex ? ex.done + '/' + ex.stars + '/' + ex.opened : ''].join('|');
        if (box._sig === sig) return; box._sig = sig;
        const parts = [];
        if (ex && ex.opened) parts.push(`<span class="cs" title="Students who opened it">${icon('eye', 'sm')}${ex.opened}</span>`);
        if (ex && ex.done) parts.push(`<span class="cs" title="Students who finished it">${icon('check', 'sm')}${ex.done}</span>`);
        if (ex && ex.stars) parts.push(`<span class="cs" title="Students who starred it">${icon('star', 'sm')}${ex.stars}</span>`);
        if (c.comments) parts.push(`<button type="button" class="cs cs-btn${c.pend ? ' pend' : ''}" data-act="annos" title="${c.pend ? c.pend + ' waiting for approval' : 'Comments'}" aria-label="${c.comments} comment${c.comments === 1 ? '' : 's'}${c.pend ? ', ' + c.pend + ' waiting for approval' : ''}: open">${icon('comment', 'sm')}${c.comments}</button>`);
        if (c.ink + c.marks && d.type === 'media') parts.push(`<span class="cs" title="Drawings, callouts and hotspots">${icon('pen', 'sm')}${c.ink + c.marks}</span>`);
        box.innerHTML = parts.join('');
    },
    /** A zone shared for exploring says so, with how many students are on it. */
    updateZoneShare: (el, d) => {
        const shared = (State.shared || []).includes(d.id);
        el.classList.toggle('is-shared', shared);
        let tag = el.querySelector('.zone-share-tag');
        if (!shared) { if (tag) tag.remove(); return; }
        if (!tag) { tag = document.createElement('button'); tag.type = 'button'; tag.className = 'zone-share-tag'; tag.dataset.act = 'explore-progress'; el.appendChild(tag); }
        const n = Object.keys(State.explore[d.id] || {}).length;
        const txt = n ? `Exploring · ${n} student${n === 1 ? '' : 's'}` : 'Shared to explore';
        if (tag.textContent !== txt) { tag.textContent = txt; tag.setAttribute('aria-label', txt + ': show progress'); }
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
        if (type === 'link') { Actions.promptLink(); return null; }
        if (type === 'media') { if (sub === 'video') Actions.promptVideo(); else Actions.pickImage(); return null; }

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
    /** Asks for a web address and a title, then adds a link card. */
    promptLink: async (it) => {
        UI.closeAllMenus();
        const url = await DQBUI.Dialog.prompt({ title: it ? 'Edit link' : 'Add a link', message: 'The web address students will open (it must start with https:// or http://).', value: it ? it.url : 'https://', confirmLabel: 'Next', maxLength: 2048 });
        if (url == null) return;
        const clean = DQBUI.safeUrl(String(url).trim());
        if (!clean) { UI.toast('That isn’t a full web address. It must start with https:// or http://', 'warn'); return; }
        const title = await DQBUI.Dialog.prompt({ title: 'Title', message: 'What should the card say?', value: it ? it.title : Sanitize.hostOf(clean), confirmLabel: it ? 'Save' : 'Add', maxLength: 200 });
        if (title == null) return;
        if (it) { StateManager.updateItem(it.id, { url: clean, title: clampStr(title, 200).trim() || Sanitize.hostOf(clean) }); if ((State.shared || []).includes(it.id)) Network.pushShared(); return; }
        Actions.addLink({ url: clean, title, kind: 'link' });
    },
    /** Adds a link / resource card (from the Insert menu or a host library). Returns the item, or null. */
    addLink: (card, at, opts) => {
        const r = Sanitize.item({ ...card, id: genId(), type: 'link', x: 0, y: 0, w: card.thumb ? 280 : 260, h: card.thumb ? 320 : (card.desc ? 210 : 160) });
        if (!r) { UI.toast('That card can’t be added: its address isn’t a web page.', 'warn'); return null; }
        const c = at || Viewport.centerWorld();
        const pos = Board.getFreeSpace(c.x - r.w / 2, c.y - r.h / 2, r.w, r.h);
        r.x = pos.x; r.y = pos.y;
        StateManager.addItem(r);
        if (!opts || opts.select !== false) StateManager.setSelection([r.id]);
        return r;
    },
    /** Adds several cards in a new zone (a whole collection). Returns how many were added. */
    addLinkZone: (title, cards) => {
        const list = (cards || []).map(c => { const v = DQBMedia.parseVideo(c.url); return v ? Sanitize.item({ id: genId(), type: 'media', kind: 'video', title: c.title, desc: c.desc, thumb: c.thumb, video: v, url: c.url, ref: c.ref, source: c.source, x: 0, y: 0, w: 260, h: 300, annos: [] }) : Sanitize.item({ ...c, id: genId(), type: 'link', x: 0, y: 0, w: 260, h: c.thumb ? 320 : 190 }); }).filter(Boolean).slice(0, 40);
        if (!list.length) return 0;
        const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(list.length)))), cw = 280, ch = 320, pad = 24;
        const w = cols * cw + pad * 2 - 20, h = Math.ceil(list.length / cols) * ch + pad * 2 + 30;
        const c = Viewport.centerWorld(), pos = Board.getFreeSpace(c.x - w / 2, c.y - h / 2, w, h);
        const zone = { id: genId(), type: 'zone', title: clampStr(title || 'Collection', 80), x: pos.x, y: pos.y, w, h, children: list.map(i => i.id) };
        list.forEach((it, k) => { it.x = pos.x + pad + (k % cols) * cw; it.y = pos.y + pad + 30 + Math.floor(k / cols) * ch; it.parentZone = zone.id; });
        StateManager.batch(() => { StateManager.addItems([zone].concat(list)); StateManager.setSelection([zone.id]); });
        setTimeout(() => Viewport.centerOn(zone), 60);
        return list.length;
    },
    /* ---------- pictures and videos ---------- */
    /** Places a media item ({kind, title, src | video, thumb, aspect, ...}) near the centre. Returns it, or null. */
    addMedia: (m, at, opts) => {
        const isVideo = m.kind === 'video';
        const w = 320, h = isVideo ? 300 : Math.round(Math.max(200, Math.min(420, 40 + 300 / Math.max(0.4, Math.min(2.5, m.aspect || 1.5)) + 100)));
        const r = Sanitize.item({ ...m, id: genId(), type: 'media', x: 0, y: 0, w, h, annos: [] });
        if (!r) { UI.toast(isVideo ? 'That video can’t be added.' : 'That picture can’t be added.', 'warn'); return null; }
        const c = at || Viewport.centerWorld();
        const pos = Board.getFreeSpace(c.x - r.w / 2, c.y - r.h / 2, r.w, r.h);
        r.x = pos.x; r.y = pos.y;
        StateManager.addItem(r);
        if (!opts || opts.select !== false) StateManager.setSelection([r.id]);
        return r;
    },
    /** Insert › Image: a picture from this device (it is re-encoded and kept in the board). */
    pickImage: () => {
        UI.closeAllMenus();
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp';
        input.addEventListener('change', async () => { const f = input.files && input.files[0]; if (f) await Actions.addImageFile(f); });
        input.click();
    },
    addImageFile: async (file, at, title) => {
        const enc = await DQBMedia.encodeImage(file);
        if (!enc || !enc.src) { UI.toast('That picture couldn’t be added. Try a JPEG or PNG file.', 'warn'); return null; }
        const name = title || (file && file.name ? String(file.name).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() : '');
        const it = Actions.addMedia({ kind: 'image', title: clampStr(name || 'Picture', 200), src: enc.src, thumb: enc.thumb, aspect: enc.aspect }, at);
        if (it) UI.toast('Picture added. Open it to add comments, callouts and hotspots.', 'success');
        return it;
    },
    /** Insert › Video: a YouTube, Vimeo or video-file address. */
    promptVideo: async (prefill) => {
        UI.closeAllMenus();
        const url = await DQBUI.Dialog.prompt({ title: 'Add a video', message: 'Paste a YouTube or Vimeo address, or a link to a video file (.mp4, .webm).', value: prefill || 'https://', confirmLabel: 'Next', maxLength: 2048, icon: 'video', validate: (v) => (DQBMedia.parseVideo(v) ? null : 'That isn’t a YouTube, Vimeo or video-file address.') });
        if (url == null) return null;
        const v = DQBMedia.parseVideo(url); if (!v) return null;
        const title = await DQBUI.Dialog.prompt({ title: 'Title', message: 'What should the card say?', value: DQBMedia.providerName(v) + ' video', confirmLabel: 'Add', maxLength: 200, icon: 'video' });
        if (title == null) return null;
        const it = Actions.addMedia({ kind: 'video', title: clampStr(title, 200).trim() || 'Video', video: v, url: DQBMedia.watchUrl(v) });
        if (it) UI.toast('Video added. Open it to add callouts and hotspots at moments in the video.', 'success');
        return it;
    },
    /** A library resource that is a video, as a video item. */
    addVideoFromLink: (card, at) => {
        const v = DQBMedia.parseVideo(card.url); if (!v) return null;
        return Actions.addMedia({ kind: 'video', title: card.title, desc: card.desc, thumb: card.thumb, video: v, url: card.url, ref: card.ref, source: card.source }, at);
    },
    openMedia: (id) => {
        const it = State.items.find(i => i.id === id && (i.type === 'media' || i.type === 'link')); if (!it || !window.Shell) return;
        Shell.MediaView.open(id);
    },
    /** A new annotation from the console (the teacher or a co-host). */
    addAnno: (id, a) => {
        const it = State.items.find(i => i.id === id); if (!it) return;
        if (State.isCoHost) { const h = State.students['HOST']; if (h) SafeSend(h.conn, { type: 'ANNO_ADD', item: id, id: a.id || genId(), a }); return; }
        const clean = DQBMedia.cleanAnno({ ...a, by: { n: 'Teacher', r: 't', sid: 'host' }, ts: Date.now(), pend: false }, { video: it.kind === 'video' });
        if (!clean) return;
        if (it.type === 'link' && clean.k !== 'comment') return;
        const list = it.annos || [];
        if (list.length >= DQBMedia.LIMITS.perItem) { UI.toast('This has as many annotations as it can hold. Delete some first.', 'warn'); return; }
        StateManager.setAnnos(id, list.concat([clean]));
    },
    delAnnos: (id, ids) => {
        const it = State.items.find(i => i.id === id); if (!it || !Array.isArray(ids)) return;
        if (State.isCoHost) { const h = State.students['HOST']; if (h) SafeSend(h.conn, { type: 'ANNO_DEL', item: id, ids }); return; }
        const gone = new Set(ids);
        (it.annos || []).forEach(a => { if (a.re && gone.has(a.re)) gone.add(a.id); });          // replies go with their comment
        StateManager.setAnnos(id, (it.annos || []).filter(a => !gone.has(a.id)));
    },
    approveAnno: (id, aid) => {
        const it = State.items.find(i => i.id === id); if (!it) return;
        if (State.isCoHost) { const h = State.students['HOST']; if (h) SafeSend(h.conn, { type: 'ANNO_OK', item: id, aid }); return; }
        StateManager.setAnnos(id, (it.annos || []).map(a => (a.id === aid ? (({ pend, ...rest }) => rest)(a) : a)));
    },
    openLink: (id) => {
        const it = State.items.find(i => i.id === id && i.type === 'link'); if (!it) return;
        const url = DQBUI.safeUrl(it.url); if (!url) return;
        const w = window.open(url, '_blank', 'noopener,noreferrer'); if (w) { try { w.opener = null; } catch (e) { /* ignore */ } }
    },
    renameMedia: async (id) => {
        const it = State.items.find(i => i.id === id && i.type === 'media'); if (!it) return;
        const t = await DQBUI.Dialog.prompt({ title: 'Rename', value: it.title || '', confirmLabel: 'Save', maxLength: 200 });
        if (t == null) return;
        StateManager.updateItem(id, { title: clampStr(t, 200).trim() || it.title });
    },
    /** A link card that is a YouTube / Vimeo / video-file address becomes a video item in the same place. */
    linkToVideo: (id) => {
        const it = State.items.find(i => i.id === id && i.type === 'link'); if (!it) return;
        const v = DQBMedia.parseVideo(it.url); if (!v) return;
        const m = Sanitize.item({ id: genId(), type: 'media', kind: 'video', title: it.title, desc: it.desc, thumb: it.thumb, video: v, url: it.url, ref: it.ref, source: it.source, x: it.x, y: it.y, w: 320, h: 300, parentZone: it.parentZone, annos: it.annos || [] });
        if (!m) return;
        StateManager.batch(() => {
            const z = it.parentZone && State.items.find(x => x.id === it.parentZone);
            StateManager.addItem(m);
            if (z) StateManager.updateItem(z.id, { children: (z.children || []).map(c => (c === it.id ? m.id : c)) });
            StateManager.deleteItems([it.id]);
            StateManager.setSelection([m.id]);
        });
        if (State.shared.includes(it.id)) { State.shared = State.shared.map(x => (x === it.id ? m.id : x)); Network.pushShared(); }
    },
    /** Puts a picture on the board as an image note (pictures are stored in the board, so they are converted to a data-URI here). */
    addImage: async (src, caption) => {
        const data = await Actions.imageData(src);
        if (!data) { UI.toast('That picture couldn’t be added.', 'warn'); return null; }
        const c = Viewport.centerWorld(), w = 260, h = 240;
        const pos = Board.getFreeSpace(c.x - w / 2, c.y - h / 2, w, h);
        const it = { id: genId(), type: 'note', sub: 'sketch', src: data, text: clampStr(caption || '', 120), w, h, x: pos.x, y: pos.y, votes: 0, groupId: null };
        StateManager.addItem(it); StateManager.setSelection([it.id]);
        return it;
    },
    /** Loads a same-site picture and re-encodes it (at most 900 px, JPEG) so it is small enough to save and sync. */
    imageData: (src) => new Promise((resolve) => {
        const s = DQBUI.safeThumb(src) || DQBUI.safeImg(src);
        if (!s) return resolve(null);
        const im = new Image();
        im.onload = () => {
            try {
                const k = Math.min(1, 900 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
                const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
                const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height);
                const out = cv.toDataURL('image/jpeg', 0.84);
                resolve(DQBUI.safeImg(out, 1400000) || null);
            } catch (e) { resolve(null); }                              // a cross-site picture taints the canvas: refused
        };
        im.onerror = () => resolve(null);
        im.src = s;
    }),
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
            const ids = selection.map(i => i.id), zones = selection.filter(Network.openableZone), allLocked = selection.every(i => i.locked);
            items.push({ label: inGroup ? 'Ungroup' : 'Group items', icon: 'group', onClick: inGroup ? Actions.ungroupSelection : Actions.groupSelection });
            items.push({ label: 'Arrange…', icon: 'grid', onClick: () => Shell.Arrange.open() });
            if (selection.some(i => i.type === 'note')) items.push({ label: 'Move to zone…', icon: 'zone', onClick: () => Actions.showZoneList() });
            if (zones.length) {
                const open = Network.openZoneIds(), allOpen = zones.every(z => open.includes(z.id));
                items.push({ label: allOpen ? 'Close these zones' : `Open ${zones.length > 1 ? zones.length + ' zones' : 'zone'} for students`, icon: allOpen ? 'stop' : 'broadcast', onClick: () => (allOpen ? Network.closeZones(zones.map(z => z.id)) : Network.openZones(zones.map(z => z.id))) });
            }
            items.push({ label: allLocked ? 'Unlock all' : 'Lock all in place', icon: allLocked ? 'unlock' : 'lock', onClick: () => Actions.lockMany(ids, !allLocked) });
            items.push({ label: 'Duplicate', icon: 'copy', kbd: '⌘D', onClick: Actions.duplicate });
            items.push({ label: 'Save as template', icon: 'template', onClick: () => Actions.saveSelectionAsTemplate() });
            items.push({ separator: true });
            items.push({ label: `Delete ${selection.length} items`, icon: 'trash', danger: true, kbd: '⌫', onClick: () => Actions.delete() });
            return items;
        }
        if (item.type === 'link') {
            const shared = (State.shared || []).includes(item.id);
            items.push({ label: 'Open link', icon: 'link', onClick: () => Actions.openLink(item.id) });
            items.push({ label: 'Comments', icon: 'comment', onClick: () => Actions.openMedia(item.id) });
            if (!State.isCoHost) items.push({ label: shared ? 'Stop sharing with students' : 'Share with students', icon: shared ? 'stop' : 'send', onClick: () => Network.toggleShare(item.id) });
            if (item.kind === 'link') items.push({ label: 'Edit link…', icon: 'pencil', onClick: () => Actions.promptLink(item) });
            if (DQBMedia.parseVideo(item.url)) items.push({ label: 'Turn into a video', icon: 'video', onClick: () => Actions.linkToVideo(item.id) });
            items.push({ separator: true });
        }
        if (item.type === 'media') {
            const shared = (State.shared || []).includes(item.id);
            items.push({ label: item.kind === 'video' ? 'Watch and annotate' : 'View and annotate', icon: item.kind === 'video' ? 'play' : 'eye', onClick: () => Actions.openMedia(item.id) });
            if (!State.isCoHost) items.push({ label: shared ? 'Stop sharing with students' : 'Share with students', icon: shared ? 'stop' : 'send', onClick: () => Network.toggleShare(item.id) });
            items.push({ label: 'Rename…', icon: 'pencil', onClick: () => Actions.renameMedia(item.id) });
            if (item.kind === 'video' && item.video) items.push({ label: 'Open on ' + DQBMedia.providerName(item.video), icon: 'link', onClick: () => { const u = DQBMedia.watchUrl(item.video); if (u) window.open(u, '_blank', 'noopener,noreferrer'); } });
            items.push({ separator: true });
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
            if (!item.zoneType && !State.isCoHost && Network.setItems(item).length) {
                const shared = (State.shared || []).includes(item.id);
                items.push({ label: shared ? 'Stop sharing to explore' : 'Share to explore', icon: shared ? 'stop' : 'explore', onClick: () => Network.toggleShare(item.id) });
                if (shared) items.push({ label: 'Exploring progress', icon: 'checks', onClick: () => Shell.ExploreProgress.open(item.id) });
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
    /** Adds a colour zone for each of the first n groups that has none yet, in a row near the middle of the screen,
        and selects every zone of those groups so they can be opened together. */
    createGroupZones: (n) => {
        const groups = Network.groupColors(n).map(c => GROUPS.find(g => g.color === c));
        const has = (c) => State.items.some(i => Network.openableZone(i) && i.color === c);
        const missing = groups.filter(g => !has(g.color));
        const w = 320, h = 360, gap = 40;
        let zones = [];
        if (missing.length) {
            const total = missing.length * w + (missing.length - 1) * gap, c = Viewport.centerWorld();
            const pos = Board.getFreeSpace(c.x - total / 2, c.y - h / 2, total, h);
            zones = missing.map((g, k) => ({ id: genId(), type: 'zone', title: `${g.name} group`, color: g.color, x: pos.x + k * (w + gap), y: pos.y, w, h, children: [], groupId: null }));
        }
        const colors = new Set(groups.map(g => g.color));
        StateManager.batch(() => {
            if (zones.length) StateManager.addItems(zones);
            StateManager.setSelection(State.items.filter(i => Network.openableZone(i) && colors.has(i.color)).map(i => i.id));
        });
        if (zones.length) Viewport.centerOn({ x: zones[0].x, y: zones[0].y, w: zones[zones.length - 1].x + w - zones[0].x, h });
        return zones;
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
    setTypeMany: (ids, sub) => {
        const notes = ids.map(id => State.items.find(i => i.id === id)).filter(i => i && i.type === 'note' && !i.src);
        if (!notes.length || !TYPES[sub]) return;
        StateManager.updateItems(notes.map(n => ({ id: n.id, props: { sub } })));
        UI.toast(`${notes.length} note${notes.length === 1 ? '' : 's'} changed to ${TYPES[sub].lbl}`, 'success');
    },
    lockMany: (ids, lock) => {
        const items = ids.map(id => State.items.find(i => i.id === id)).filter(Boolean);
        if (!items.length) return;
        StateManager.updateItems(items.map(i => ({ id: i.id, props: { locked: !!lock } })));
        UI.toast(lock ? `${items.length} item${items.length === 1 ? '' : 's'} locked in place` : `${items.length} item${items.length === 1 ? '' : 's'} unlocked`);
    },
    /** Deletes item `id`, or everything selected — notes and ink together, as one undo step. */
    delete: (id) => {
        const targets = id ? [id] : State.selection.slice();
        const strokes = id ? 0 : InkSel.board.count();
        if (targets.length === 0 && !strokes) return;
        StateManager.batch(() => {
            if (strokes) InkSel.board.remove();
            if (targets.length) HierarchyManager.delete(targets);
        });
        UI.closeAllMenus();
        const n = targets.length, what = n && strokes ? `${n} item${n === 1 ? '' : 's'} and ${strokes} stroke${strokes === 1 ? '' : 's'} deleted`
            : (strokes ? (strokes > 1 ? `${strokes} strokes deleted` : 'Stroke deleted') : (n > 1 ? `${n} items deleted` : 'Deleted'));
        DQBUI.Toast.show(what, { action: { label: 'Undo', onClick: () => ActionHistory.undo() } });
    },
    selectAll: () => {
        InkSel.board.sel = new Set(State.ink.map(s => s.id));
        StateManager.setSelection(State.items.map(i => i.id), { keepInk: true });
    },
    /** Menu for selected ink (right-click on a stroke, or ⋯ in the selection toolbar). */
    inkMenuItems: () => {
        const ink = Workspace.ink(), n = ink.count(), caps = Workspace.caps(), strokes = ink.strokes();
        const items = [];
        if (caps.combine) items.push({ label: n > 1 ? 'Make one note' : 'Make a note', icon: 'note', kbd: 'J', onClick: () => ink.combine() });
        if (caps.combine && n > 1) items.push({ label: `Make ${n} separate notes`, icon: 'files', onClick: () => ink.combine(true) });
        items.push({ label: 'Duplicate', icon: 'copy', kbd: '⌘D', onClick: () => Workspace.duplicateSelection() });
        items.push({ header: 'Thickness' });
        InkSel.THICKNESS.forEach(([lbl, px]) => items.push({ label: lbl, checked: strokes.length > 0 && strokes.every(s => (parseFloat(s.width) || 4) === px), onClick: () => ink.setStrokeWidth(px) }));
        items.push({ separator: true });
        items.push({ label: 'Select all ink', icon: 'select', onClick: () => ink.selectAll() });
        items.push({ label: n > 1 ? `Delete ${n} strokes` : 'Delete stroke', icon: 'trash', danger: true, kbd: '⌫', onClick: () => Workspace.deleteSelection() });
        return items;
    },
    sel: (id) => {
        StateManager.setSelection([id]);
        const i = State.items.find(x => x.id === id);
        if (i && i.type === 'zone') {
            if (State.activeSorts[i.id] || (State.activity && State.activity.targetId === i.id && !Network._openZonesRunning())) {
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
    /** Duplicates the selection: items (with what is inside zones) and selected ink, shifted by the same amount. */
    duplicate: () => {
        const sel = State.selection.map(id => State.items.find(x => x.id === id)).filter(Boolean);
        const strokes = InkSel.board.count();
        if (!sel.length && !strokes) return;
        if (!sel.length) { InkSel.board.duplicate(); return; }
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
        StateManager.batch(() => {
            const inkCopies = strokes ? InkSel.board.duplicate(dx, dy) : [];
            StateManager.addItems(copies);
            if (inkCopies.length) InkSel.board.sel = new Set(inkCopies.map(c => c.id));
            StateManager.setSelection(sel.map(o => map[o.id]), { keepInk: true });
        });
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
        /** Starts dragging item `id`, or — when only `inkId` is given — the selected ink led by that stroke.
            Selected strokes travel with selected items, so a mixed selection moves as one. */
        down: (e, id, inkId) => {
            const item = id ? State.items.find(i => i.id === id) : null;
            if (id && (!item || item.locked)) return;
            if (!id && !inkId) return;

            AutoScroll.start();

            const r = $('viewport').getBoundingClientRect();
            const wx = (e.clientX - r.left) / State.view.z - State.view.x;
            const wy = (e.clientY - r.top) / State.view.z - State.view.y;

            const moveTargetIds = new Set();
            if (!item) {
                State.selection.forEach(selId => { const s = State.items.find(i => i.id === selId); if (s && !s.locked) moveTargetIds.add(selId); });
            } else if (item.groupId) {
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
            const carriesInk = !!inkId || (!!item && State.selection.includes(id));

            State.drag = {
                mode: 'move', primaryId: item ? id : null, primaryInk: inkId || null,
                moveTargets: moveTargets.map(i => ({ id: i.id, startX: i.x, startY: i.y })),
                inkIds: carriesInk ? InkSel.board.ids() : [], dx: 0, dy: 0,
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

            const primaryItem = d.primaryId ? State.items.find(i => i.id === d.primaryId) : null;
            if (d.primaryId && !primaryItem) return;

            const r = $('viewport').getBoundingClientRect();
            const wx = (e.clientX - r.left) / State.view.z - State.view.x;
            const wy = (e.clientY - r.top) / State.view.z - State.view.y;
            let dx = wx - d.mouseStartX;
            let dy = wy - d.mouseStartY;

            const primaryTarget = primaryItem && d.moveTargets.find(t => t.id === d.primaryId);
            if (primaryTarget) {
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
            d.dx = dx; d.dy = dy;
            if (d.inkIds.length) InkSel.board.preview(dx, dy);

            if (primaryItem && primaryItem.type !== 'zone') {
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

            State.drag = null;
            StateManager.batch(() => Modes.Move._commit(d));
        },
        _commit: (d) => {
            const updatedItems = d.moveTargets.map(t => State.items.find(i => i.id === t.id)).filter(Boolean);
            const primaryItem = updatedItems.find(i => i.id === d.primaryId);
            if (d.inkIds.length && (d.dx || d.dy)) InkSel.board.translate(d.dx, d.dy);

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
            } else if (!primaryItem) {
                // led by ink: a selected note stays in its zone while it is still inside it
                const touched = new Set();
                d.moveTargets.forEach(target => {
                    const item = State.items.find(i => i.id === target.id);
                    if (!item || !item.parentZone || d.moveTargets.some(t => t.id === item.parentZone)) return;
                    const z = State.items.find(i => i.id === item.parentZone); if (!z) return;
                    const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
                    touched.add(z.id);
                    if (!(cx > z.x && cx < z.x + z.w && cy > z.y && cy < z.y + z.h)) HierarchyManager.unlink(item.id);
                });
                touched.forEach(id => LayoutSystem.update(id));
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
            const additive = e.shiftKey || e.metaKey || e.ctrlKey;
            State.drag = { mode:'box', sx: e.clientX - r.left, sy: e.clientY - r.top, baseItems: additive ? State.selection.slice() : [], baseInk: additive ? InkSel.board.ids() : [] };
            if (!additive) { StateManager.setSelection([]); UI.closeAllMenus(); }
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
            // ink inside the box, in world coordinates
            const z = State.view.z, wr = { x0: l / z - State.view.x, y0: t / z - State.view.y, x1: (l + w) / z - State.view.x, y1: (t + h) / z - State.view.y };
            InkSel.board.sel = new Set([...d.baseInk, ...InkSel.board.inRect(wr)]);
            StateManager.setSelection([...new Set([...d.baseItems, ...newlySelected])], { keepInk: true });
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
        window.addEventListener('blur', () => { State.spaceDown = false; SnapSystem.suspended = false; });
        window.addEventListener('keydown', e => { if (e.key === 'Alt') SnapSystem.suspended = true; });
        window.addEventListener('keyup', e => { if (e.key === 'Alt') SnapSystem.suspended = false; });
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

        const itemEl = t.closest('.item');
        const handle = t.closest('.resize-h');
        const tool = InputController.tool();
        const evt = e;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const capture = () => { try { $('viewport').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
        // strokes are picked by distance (a fixed number of screen pixels, wider for fingers), never by their thin painted path
        const inkAt = () => { if (itemEl) return null; const w = Viewport.toWorld(e.clientX, e.clientY); return InkSel.board.hitAt(w.x, w.y, e.pointerType === 'touch' ? 18 : 9); };

        if (e.button === 1 || e.button === 2) {
            Modes.Pan.down(evt); State.drag.secondary = e.button === 2; State.drag.itemId = itemEl ? itemEl.id : null; State.drag.inkId = e.button === 2 ? inkAt() : null; capture(); return;
        }
        if (tool === 'pan' || tool === 'select') {
            if (handle && itemEl) { Modes.Resize.down(evt, itemEl.id); capture(); return; }
            if (itemEl) {
                const wasSelected = State.selection.includes(itemEl.id);
                if (!additive) { if (!wasSelected) StateManager.setSelection([itemEl.id]); }
                else {
                    const newSel = wasSelected ? State.selection.filter(id => id !== itemEl.id) : [...State.selection, itemEl.id];
                    StateManager.setSelection(newSel, { keepInk: true });
                }
                Modes.Move.down(evt, itemEl.id);
                if (State.drag) { State.drag.wasSelected = wasSelected && State.selection.length === 1 && !InkSel.board.count(); capture(); }
                return;
            }
            const inkId = inkAt();
            if (inkId) {
                const ink = InkSel.board, was = ink.has(inkId);
                if (additive) {
                    ink.toggle(inkId);
                    if (ink.has(inkId)) { Modes.Move.down(evt, null, inkId); capture(); }
                    return;
                }
                if (!was && (tool === 'pan' || e.pointerType === 'touch')) { Modes.Pan.down(evt); State.drag.inkTap = inkId; capture(); return; }   // a tap selects it, a drag pans
                if (!was) { ink.sel = new Set([inkId]); StateManager.setSelection([], { keepInk: true }); }
                Modes.Move.down(evt, null, inkId); capture(); return;
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
        if (!State.drag) { if (e.pointerType === 'mouse') InputController.hover(e); return; }
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
                    else if (d.inkId) { if (!InkSel.board.has(d.inkId)) { InkSel.board.sel = new Set([d.inkId]); StateManager.setSelection([], { keepInk: true }); } DQBUI.Menu.open({ anchor: { clientX: e.clientX, clientY: e.clientY }, items: Actions.inkMenuItems(), title: 'Ink' }); }
                    else Shell.canvasMenu(e);
                } else if (d.inkTap) { InkSel.board.sel = new Set([d.inkTap]); StateManager.setSelection([], { keepInk: true }); UI.closeAllMenus(); }
                else { StateManager.setSelection([]); UI.closeAllMenus(); }
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
    /** Pointer cursor over a stroke, so it is clear that ink can be picked up. */
    hover: DQBUI.throttle((e) => {
        const v = $('viewport'), tool = InputController.tool();
        let on = false;
        if ((tool === 'select' || tool === 'pan') && !State.drag && e.target && e.target.closest && e.target.closest('#viewport') && !e.target.closest('.item')) {
            const w = Viewport.toWorld(e.clientX, e.clientY); on = !!InkSel.board.hitAt(w.x, w.y, 9);
        }
        if (v.classList.contains('ink-hover') !== on) v.classList.toggle('ink-hover', on);
    }, 60),
    dblclick: (e) => {
        if (Workspace.mode !== 'board') return;
        const itemEl = e.target.closest('.item');
        if (itemEl) {
            const it = State.items.find(i => i.id === itemEl.id);
            if (it && it.type === 'note' && !it.src) Actions.editText(it.id);
            else if (it && it.type === 'zone' && !it.zoneType) Actions.rename(it.id);
            else if (it && it.type === 'media') Actions.openMedia(it.id);
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
            // trackpad pinch arrives as a stream of ctrl+wheel events with small deltas; a mouse wheel sends one big step per click
            const pinch = e.ctrlKey && e.deltaMode === 0 && Math.abs(dy) < 50;
            const f = pinch ? Math.exp(-dy * 0.012) : Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0018);
            InputController.zoom(f, e.clientX, e.clientY);
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
        if (!State.selection.length && !InkSel.board.count()) return;
        const ids = new Set(State.selection);
        State.selection.forEach(id => HierarchyManager.getDescendants(id).forEach(c => ids.add(c)));
        StateManager.batch(() => {
            StateManager.updateItems([...ids].map(id => { const i = State.items.find(x => x.id === id); return i && !i.locked ? { id, props: { x: i.x + dx, y: i.y + dy } } : null; }).filter(Boolean));
            InkSel.board.translate(dx, dy);
        });
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
        if (mod && k === 'a') { e.preventDefault(); Actions.selectAll(); return; }
        if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) Actions.ungroupSelection(); else Actions.groupSelection(); return; }
        if (mod) return;
        if (e.key === 'Escape') {
            if (State.selection.length || InkSel.board.count()) StateManager.setSelection([]);
            else if (State.tool === 'draw' || State.tool === 'eraser' || State.tool === 'laser') window.setTool(Shell.defaultTool());
            return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            Actions.delete();
            return;
        }
        if (k === 'j' && InkSel.board.count()) { InkSel.board.combine(); return; }
        if (e.key.startsWith('Arrow') && (State.selection.length || InkSel.board.count())) {
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

    suspended: false,                                            // true while Alt is held: move freely
    enabled: () => { try { return localStorage.getItem('dqb_snap') !== '0'; } catch (e) { return true; } },

    getSnap: (item, newX, newY) => {
        const threshold = SnapSystem.threshold / State.view.z;
        let finalX = newX, finalY = newY;
        SnapSystem.activeGuides = [];
        if (SnapSystem.suspended || !SnapSystem.enabled()) return { x: newX, y: newY };

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
    hostOf: (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'Link'; } },
    /** What a student is sent about a shared card: only display fields, re-checked. */
    shared: (it) => ({ id: it.id, title: clampStr(it.title, 200), desc: clampStr(it.desc, 500), url: DQBUI.safeUrl(it.url), thumb: DQBUI.safeThumb(it.thumb) || null, kind: it.kind || 'link', source: it.source ? clampStr(it.source, 60) : null }),
    /** A card takes comments only (no places or moments). */
    linkAnnos: (list) => DQBMedia.cleanAnnos(list, { video: false }).filter(a => a.k === 'comment').map(a => { delete a.x; delete a.y; return a; }),
    strokes: (arr, max) => (Array.isArray(arr) ? arr.slice(0, max || 600) : []).map(s => {
        if (!s || !Array.isArray(s.points)) return null;
        const pts = s.points.slice(0, 6000).map(p => ({ x: Sanitize.num(p && p.x), y: Sanitize.num(p && p.y) }));
        if (pts.length < 2) return null;
        return { id: safeId(s.id) || genId(), points: pts, color: safeColor(s.color) || '#000000', width: Math.max(1, Math.min(40, Sanitize.num(s.width, 4))), highlight: !!s.highlight, arrow: !!s.arrow };
    }).filter(Boolean),
    item: (r, depth) => {
        depth = depth || 0;
        if (!r || typeof r !== 'object') return null;
        const type = ['note', 'zone', 'poll', 'graph', 'spin', 'link', 'media'].includes(r.type) ? r.type : null;
        const id = safeId(r.id);
        if (!type || !id) return null;
        const o = { id, type, x: Sanitize.num(r.x), y: Sanitize.num(r.y), w: Math.min(4000, Math.max(40, Sanitize.num(r.w, 200, 4000))), h: Math.min(4000, Math.max(40, Sanitize.num(r.h, 150, 4000))), groupId: safeId(r.groupId) || null };
        if (safeId(r.parentZone)) o.parentZone = r.parentZone;
        if (r.locked) o.locked = true;
        if (type === 'zone' || type === 'poll' || type === 'graph') o.isOpen = !!r.isOpen;   // explicit false, so a zone closing reaches co-hosts
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
        } else if (type === 'link') {
            o.url = DQBUI.safeUrl(r.url);
            if (!o.url) return null;                                   // a card that opens nothing (or something unsafe) is dropped
            o.title = clampStr(r.title, 200).trim() || Sanitize.hostOf(o.url);
            o.desc = clampStr(r.desc, 500);
            const th = DQBUI.safeThumb(r.thumb); if (th) o.thumb = th;
            o.kind = ['resource', 'collection', 'link'].includes(r.kind) ? r.kind : 'link';
            if (safeId(String(r.ref == null ? '' : r.ref))) o.ref = String(r.ref);
            if (r.source) o.source = clampStr(r.source, 60);
            if (Array.isArray(r.annos) && r.annos.length) o.annos = Sanitize.linkAnnos(r.annos);
        } else if (type === 'media') {
            o.kind = r.kind === 'video' ? 'video' : 'image';
            o.title = clampStr(r.title, 200).trim();
            o.desc = clampStr(r.desc, 500);
            if (o.kind === 'image') { const src = safeImg(r.src, 1500000) || DQBUI.safeThumb(r.src); if (!src) return null; o.src = src; }
            else { const v = DQBMedia.cleanVideo(r.video); if (!v) return null; o.video = v; }
            const th = safeImg(r.thumb, 150000) || DQBUI.safeThumb(r.thumb); if (th) o.thumb = th;
            const ar = Number(r.aspect); if (ar > 0.1 && ar < 10) o.aspect = Math.round(ar * 1000) / 1000;
            const url = DQBUI.safeUrl(r.url); if (url) o.url = url;
            if (safeId(String(r.ref == null ? '' : r.ref))) o.ref = String(r.ref);
            if (r.source) o.source = clampStr(r.source, 60);
            o.annos = DQBMedia.cleanAnnos(r.annos, { video: o.kind === 'video' });
        }
        return o;
    }
};

/* --- NETWORK & ACTIVITY MANAGER --- */
// What a connected *student* may ask the host to do. Everything else is co-host only.
const STUDENT_MESSAGES = new Set(['NOTE', 'IMG_NOTE', 'DELETE_NOTE', 'POLL_VOTE', 'DATA_SUBMIT', 'SUBMIT_VOTE', 'SUBMIT_SORT', 'COMMENT', 'EXIT_SUBMIT', 'CONSENSUS_INK', 'HEARTBEAT', 'LEAVE', 'VIEW', 'ANNO_ADD', 'ANNO_DEL', 'EXPLORE']);
const SHARE_LIMIT = 12;
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
        const old = Network.peer; Network.peer = null;          // detach first: the old peer's close/disconnect events must not trigger a rebuild
        if (old) { old._intentional = true; try { old.destroy(); } catch (e) { /* ignore */ } }
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
            DQBUI.emit('hosting', { code: Net.peerIdToCode(pid), boardId: State.id, name: State.name });
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
        Network.setStatus('connecting');
        setTimeout(() => Network.host(true), 400);          // let the notice reach students before the old session is torn down
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
            const big = State.isCoHost || (State.students[c.peer] && State.students[c.peer].role === 'cohost');   // a co-host syncs whole boards
            if (typeof d === 'string' && d.length > (big ? 40000000 : 4000000)) return;
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
        targetId = targetId || null; payload = payload ? { ...payload, rid: genId() } : null;   // rid: lets students answer again when an item is re-run
        State.votes = {};                       // one response per student per activity

        Network.broadcast({ type: 'STOP_ACT' });
        if (type !== 'OPEN') Network.broadcast({ type: 'MODE', val: 'LOCKED' });

        State.activity = { type, targetId, payload };
        Network.syncOpenFlags();
        StateManager.setActivity(State.activity);

        const openZones = type === 'ZONE_ACT' && payload && payload.subType === 'OPEN_ZONE';
        if (type === 'OPEN') {
            Network.broadcast({ type: 'MODE', val: 'OPEN' });
        } else if (targetId) {
            if (openZones) Network.pushZones();                // every student gets the zones they may write into
            else if (type === 'ZONE_ACT') {
                Network.broadcast({ ...payload, type: payload.subType });
                const modeLabel = payload.subType === 'ACT_DISCUSS' ? 'Discussion' : 'Results';
                const zContainer = $(`zr-${targetId}`);
                if (zContainer) { zContainer.innerHTML = `<h4>${modeLabel}</h4><div class="muted">Waiting for responses…</div>`; zContainer.classList.add('active'); }
            } else if (type === 'WIDGET_ACT' || type === 'EXIT_TICKET') {
                Network.broadcast(payload);
            }
        }
        if (window.Shell) Shell.syncActivity();
        const n = openZones ? (payload.zones || []).length : 0;
        UI.toast(type === 'LOCKED' ? 'Board locked' : (type === 'OPEN' ? 'Board open — students can add notes' : (openZones ? (n > 1 ? `${n} zones open — students can add notes` : 'Zone open — students can add notes') : 'Activity started')), type === 'LOCKED' ? '' : 'success');
    },

    /* ---------- open zones (several can be open at once; each student writes into the ones meant for them) ---------- */
    openableZone: (z) => !!z && z.type === 'zone' && !['consensus', 'breakout', 'exit'].includes(z.zoneType),
    _openZonesRunning: () => { const a = State.activity; return a.type === 'ZONE_ACT' && !!a.payload && a.payload.subType === 'OPEN_ZONE'; },
    /** Ids of the zones students can add notes to right now, in the order they were opened. */
    openZoneIds: () => {
        if (!Network._openZonesRunning()) return [];
        const a = State.activity, ids = Array.isArray(a.payload.zones) ? a.payload.zones : [a.targetId];
        return ids.filter(id => Network.openableZone(State.items.find(i => i.id === id)));
    },
    openZoneItems: () => Network.openZoneIds().map(id => State.items.find(i => i.id === id)),
    /** Mirrors the running activity onto items' isOpen flags (they drive the Live badge and Stop buttons). */
    syncOpenFlags: () => {
        const a = State.activity, live = a.type !== 'OPEN' && a.type !== 'LOCKED';
        const open = new Set(live ? [a.targetId].concat(Network.openZoneIds()).filter(Boolean) : []);
        const changed = [];
        State.items.forEach(i => { const v = open.has(i.id); if (!!i.isOpen !== v) { if (v) i.isOpen = true; else delete i.isOpen; changed.push({ id: i.id }); } });
        if (changed.length && Network.peer && !State.isCoHost) Network.relay('items:update', { items: changed });
        return changed.length;
    },
    /** Sets exactly which zones are open. Starts an open-zones round if something else was running; [] locks the board. */
    setOpenZones: (ids) => {
        ids = [...new Set(ids)].filter(id => Network.openableZone(State.items.find(i => i.id === id)));
        const running = Network._openZonesRunning();
        if (!ids.length) { if (running) Network.transitionTo('LOCKED'); return; }
        if (!running) { Network.transitionTo('ZONE_ACT', ids[0], { type: 'OPEN_ZONE', subType: 'OPEN_ZONE', actId: ids[0], zones: ids, items: [] }); return; }
        const before = Network.openZoneIds();
        const a = State.activity;
        State.activity = { type: 'ZONE_ACT', targetId: ids[0], payload: { ...a.payload, actId: ids[0], zones: ids } };
        Network.syncOpenFlags();
        StateManager.setActivity(State.activity);
        Network.pushZones();
        const added = ids.filter(id => !before.includes(id)), removed = before.filter(id => !ids.includes(id));
        const title = (id) => ((State.items.find(i => i.id === id) || {}).title || 'Zone');
        if (added.length === 1 && !removed.length) UI.toast(`${title(added[0])} is open too · ${ids.length} zones open`, 'success');
        else if (removed.length === 1 && !added.length) UI.toast(`${title(removed[0])} closed · ${ids.length} still open`);
        else UI.toast(`${ids.length} zone${ids.length === 1 ? '' : 's'} open`, 'success');
    },
    openZones: (ids) => Network.setOpenZones(Network.openZoneIds().concat(ids)),
    closeZones: (ids) => Network.setOpenZones(Network.openZoneIds().filter(id => !ids.includes(id))),
    /** What one student may write into: open zones of their colour plus uncoloured ones. Students with none of their own
        may pick any open zone, or wait to be put in a group (Class rules). */
    zonesFor: (st) => {
        const open = Network.openZoneItems();
        const own = open.filter(z => !safeColor(z.color) || (st && st.color && z.color === st.color));
        if (own.length || !open.length) return { zones: own, placed: true };
        return { zones: State.settings.anyZone ? open : [], placed: false };
    },
    zoneInfo: (z) => ({ id: z.id, title: clampStr(z.title || 'Zone', 80), zoneType: z.zoneType === 'cer' ? 'cer' : null, color: safeColor(z.color) || null, group: safeColor(z.color) ? groupName(z.color) : null }),
    /** The OPEN_ZONE message for one student (older student apps read actId/title/zoneType: their first zone). */
    zoneMsg: (st) => {
        const a = State.activity, r = Network.zonesFor(st), first = r.zones[0] || null;
        return {
            type: 'OPEN_ZONE', subType: 'OPEN_ZONE', rid: a.payload && a.payload.rid, items: [],
            actId: first ? first.id : null, title: first ? clampStr(first.title || 'Zone', 80) : '', zoneType: first ? first.zoneType || null : null,
            zones: r.zones.map(Network.zoneInfo), unplaced: !r.placed, waiting: !r.zones.length
        };
    },
    pushZones: () => {
        if (!Network._openZonesRunning()) return;
        Object.values(State.students).forEach(s => { if (s.role === 'student') SafeSend(s.conn, Network.zoneMsg(s)); });
        if (window.Shell) { Shell.syncActivity(); Roster(); }
    },
    zonesWatch: (action, payload) => {
        if (State.isCoHost || !Network._openZonesRunning() || !payload) return false;
        const raw = State.activity.payload.zones || [State.activity.targetId];
        if (action === 'items:delete') return (payload.ids || []).some(id => raw.includes(id));
        if (action === 'items:update') return (payload.items || []).some(u => raw.includes(u.id) && ('title' in u || 'color' in u || 'zoneType' in u));
        return action === 'state:fullsync';
    },
    _zonesChanged: DQBUI.debounce(() => {
        if (!Network._openZonesRunning()) return;
        const ids = Network.openZoneIds();
        if (!ids.length) { Network.transitionTo('LOCKED'); return; }
        const a = State.activity;
        if (ids.join() !== (a.payload.zones || []).join()) { State.activity = { ...a, targetId: ids[0], payload: { ...a.payload, actId: ids[0], zones: ids } }; Network.syncOpenFlags(); Render.all(); }
        Network.pushZones();
    }, 120),
    /** Students who have no open zone of their own (no group, or no zone open for their group). */
    unplaced: () => Object.entries(State.students).filter(([, s]) => s.role === 'student' && !Network.zonesFor(s).placed),
    toggleOpenMode: (isOn) => { if (isOn) Network.transitionTo('OPEN'); else Network.transitionTo('LOCKED'); },

    startActivity: (mode) => {
        let targets = []; let zoneId = null;
        const votable = (n) => n && (n.type === 'note' || n.type === 'link' || n.type === 'media');
        State.selection.forEach(id => {
            const i = State.items.find(x => x.id === id); if (!i) return;
            if (votable(i)) targets.push(i);
            else if (i.type === 'zone') {
                zoneId = i.id;
                if (i.children) i.children.forEach(cid => { const n = State.items.find(x => x.id === cid); if (n) targets.push(n); });
            }
        });
        targets = [...new Set(targets)].filter(votable);

        if (targets.length < 1 && mode === 'discuss') { UI.toast("Select a zone, some notes or some cards to discuss", 'warn'); return; }
        if (targets.length < 2 && mode !== 'discuss') { UI.toast("This activity needs at least 2 notes, cards, pictures or videos in the zone", 'warn'); return; }

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
        const itemsList = targets.map(n => (n.type === 'note' ? { id: n.id, text: clampStr(n.text, 300), sub: n.sub }
            : { id: n.id, text: clampStr(n.title || (n.type === 'media' ? (n.kind === 'video' ? 'Video' : 'Picture') : 'Link'), 300), sub: n.type === 'link' ? 'link' : n.kind, thumb: (safeImg(n.thumb, 150000) || DQBUI.safeThumb(n.thumb)) || undefined }));
        Network.transitionTo('ZONE_ACT', zoneId, { type: subType, subType: subType, actId: zoneId, items: itemsList });
    },
    stopActivity: () => { Network.transitionTo('LOCKED'); },

    toggleZone: (id) => {
        const item = State.items.find(x => x.id === id);
        if (!item) return;
        const open = Network.openZoneIds(), a = State.activity;
        if (open.includes(id)) { Network.closeZones([id]); return; }                                   // close just this zone
        if (a.targetId === id && a.type !== 'LOCKED' && a.type !== 'OPEN') { Network.transitionTo('LOCKED'); return; }   // stop the vote / poll / ticket it runs
        if (item.zoneType === 'exit') Network.broadcastExit(id);
        else if (item.type === 'poll') Network.broadcastPoll(id);
        else if (item.type === 'graph') Network.broadcastGraph(id);
        else if (Network.openableZone(item)) Network.openZones([id]);                                 // opens alongside any zones already open
    },
    openZone: (id) => Network.openZones([id]),
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
    /** Picking the student's current group again takes them out of it. */
    assignStudentColor: (pid, color) => {
        const student = State.students[pid];
        if (student) Network.setStudentColor(pid, student.color === color ? null : color);
    },
    setStudentColor: (pid, color, quiet) => {
        const s = State.students[pid]; if (!s) return;
        s.color = safeColor(color) || null;
        if (s.color) State.groupOf[s.sid] = s.color; else delete State.groupOf[s.sid];
        SafeSend(s.conn, { type: 'SET_COLOR', color: s.color, name: s.color ? groupName(s.color) : null });
        if (Network._openZonesRunning()) SafeSend(s.conn, Network.zoneMsg(s));
        if (!quiet) { Roster(); if (window.Shell) Shell.syncActivity(); }
    },
    /** Shares students out across colour groups, filling the smallest group first. */
    _spread: (list, colors, counts) => {
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        list.forEach(([pid]) => {
            const c = colors.reduce((best, x) => (counts[x] < counts[best] ? x : best), colors[0]);
            counts[c]++; Network.setStudentColor(pid, c, true);
        });
    },
    /** Puts every student without a zone of their own into one of the open colour zones' groups. */
    assignUnplaced: () => {
        const colors = [...new Set(Network.openZoneItems().map(z => safeColor(z.color)).filter(Boolean))];
        const todo = Network.unplaced();
        if (!colors.length || !todo.length) return 0;
        const counts = {}; colors.forEach(c => { counts[c] = 0; });
        Object.values(State.students).forEach(s => { if (s.role === 'student' && s.color in counts) counts[s.color]++; });
        Network._spread(todo, colors, counts);
        Roster(); if (window.Shell) Shell.syncActivity();
        UI.toast(`${todo.length} student${todo.length === 1 ? '' : 's'} put in a group`, 'success');
        return todo.length;
    },
    /** The colours for n groups: colours of zones already on the board first (in reading order), then the rest of the palette. */
    groupColors: (n) => {
        const used = [];
        State.items.filter(i => Network.openableZone(i) && GROUPS.some(g => g.color === i.color))
            .sort((a, b) => (Math.round(a.y / 200) - Math.round(b.y / 200)) || (a.x - b.x))
            .forEach(z => { if (!used.includes(z.color)) used.push(z.color); });
        return used.concat(GROUPS.map(g => g.color).filter(c => !used.includes(c))).slice(0, Math.max(1, Math.min(GROUPS.length, n | 0)));
    },
    /** Splits the class into n balanced colour groups (onlyNew: keep existing groups, place the rest). */
    makeGroups: (n, onlyNew) => {
        const colors = Network.groupColors(Math.max(2, n | 0));
        const students = Object.entries(State.students).filter(([, s]) => s.role === 'student');
        const counts = {}; colors.forEach(c => { counts[c] = 0; });
        let todo = students;
        if (onlyNew) { students.forEach(([, s]) => { if (s.color in counts) counts[s.color]++; }); todo = students.filter(([, s]) => !(s.color in counts)); }
        Network._spread(todo.slice(), colors, counts);
        Roster(); if (window.Shell) Shell.syncActivity();
        return todo.length;
    },
    clearGroups: () => {
        Object.keys(State.students).forEach(pid => { if (State.students[pid].role === 'student' && State.students[pid].color) Network.setStudentColor(pid, null, true); });
        State.groupOf = {};
        Roster(); if (window.Shell) Shell.syncActivity();
    },

    /* ---------- links shared with the class (students get a "Shared with you" list; never the board itself) ---------- */
    /* ---------- sharing: cards, pictures, videos, and zones as sets to explore ---------- */
    /** What can be shared: a link card, a picture or video, or a plain zone with at least one card, picture or video in it. */
    shareable: (it) => !!it && ((it.type === 'link' && !!DQBUI.safeUrl(it.url)) || it.type === 'media' || (it.type === 'zone' && !it.zoneType && Network.setItems(it).length > 0)),
    /** The things in a zone that students explore: cards, pictures, videos, and the teacher's own text notes as prompts. */
    setItems: (z) => (z && z.children ? z.children : []).map(id => State.items.find(i => i.id === id)).filter(i => i && (i.type === 'link' || i.type === 'media' || (i.type === 'note' && !i.sid && !i.src && (i.text || '').trim()))).slice(0, 40),
    /** Shared on its own, or inside a shared zone. */
    isShared: (id) => (State.shared || []).includes(id) || (State.shared || []).some(z => { const zone = State.items.find(i => i.id === z && i.type === 'zone'); return !!zone && (zone.children || []).includes(id); }),
    /** A zone with a group colour is only for that group. */
    setVisible: (st, z) => !z.color || (st && safeColor(st.color) === safeColor(z.color)),
    /** The item a student may look at: shared on its own, or in a shared zone they can see. Returns it or null. */
    visibleItem: (st, id) => {
        if (!id || !st) return null;
        const it = State.items.find(i => i.id === id); if (!it || (it.type !== 'link' && it.type !== 'media')) return null;
        if (State.shared.includes(id)) return it;
        const z = State.items.find(i => i.type === 'zone' && State.shared.includes(i.id) && (i.children || []).includes(id));
        return z && Network.setVisible(st, z) ? it : null;
    },
    /** One entry of a student's "Shared with you" list (display fields only, re-checked; no picture data, no annotations). */
    sharedEntry: (it) => {
        if (it.type === 'link') { const o = Sanitize.shared(it); o.type = 'link'; return o.url ? o : null; }
        if (it.type === 'media') {
            const o = { id: it.id, type: 'media', kind: it.kind, title: clampStr(it.title, 200) || (it.kind === 'video' ? 'Video' : 'Picture'), desc: clampStr(it.desc, 500), source: it.source ? clampStr(it.source, 60) : null };
            const th = safeImg(it.thumb, 150000) || DQBUI.safeThumb(it.thumb); if (th) o.thumb = th;
            if (it.kind === 'video') o.video = DQBMedia.cleanVideo(it.video);
            if (it.aspect) o.aspect = it.aspect;
            return o;
        }
        if (it.type === 'note') return { id: it.id, type: 'text', text: clampStr(it.text, 600) };
        return null;
    },
    sharedFor: (st) => State.shared.map(id => State.items.find(i => i.id === id)).filter(Boolean).map(it => {
        if (it.type !== 'zone') return Network.sharedEntry(it);
        if (!Network.setVisible(st, it)) return null;
        return { id: it.id, type: 'set', title: clampStr(it.title || 'Zone', 80), color: safeColor(it.color) || null, group: safeColor(it.color) ? groupName(it.color) : null, items: Network.setItems(it).map(Network.sharedEntry).filter(Boolean) };
    }).filter(Boolean),
    /** Kept for hosts and older callers: the shared link cards. */
    sharedItems: () => State.shared.map(id => State.items.find(i => i.id === id && i.type === 'link')).filter(Boolean).map(Sanitize.shared).filter(x => x.url),
    pushShared: () => {
        Object.values(State.students).forEach(st => { if (st.role === 'student') SafeSend(st.conn, { type: 'SHARED', items: Network.sharedFor(st) }); });
        Render.all(); if (window.Shell) Shell.SelBar.render();
    },
    toggleShare: (id) => {
        if (State.isCoHost) { UI.toast('Only the host can share with students.', 'warn'); return; }
        const it = State.items.find(i => i.id === id); if (!it) return;
        const label = clampStr(it.title || it.text || 'that', 40);
        if (State.shared.includes(id)) {
            State.shared = State.shared.filter(x => x !== id);
            if (it.type === 'zone') delete State.explore[id];
            Network.pushShared(); UI.toast(`Stopped sharing “${label}”`); return;
        }
        if (!Network.shareable(it)) { UI.toast(it.type === 'zone' ? 'Put a card, picture or video in the zone first: students explore what is inside it.' : 'That can’t be shared.', 'warn'); return; }
        if (State.shared.length >= SHARE_LIMIT) { UI.toast(`At most ${SHARE_LIMIT} things can be shared at once. Stop sharing one first.`, 'warn'); return; }
        State.shared = State.shared.concat([id]);
        Network.pushShared();
        const n = Network.studentCount();
        const forGroup = it.type === 'zone' && safeColor(it.color) ? ` (the ${groupName(it.color)} group)` : '';
        UI.toast(n ? `Shared with ${forGroup ? 'the ' + groupName(it.color) + ' group' : n + ' student' + (n === 1 ? '' : 's')}` : `Shared: students${forGroup} see it as soon as they join`, 'success');
        DQBUI.emit('share', { id, title: it.title || '', url: it.url || (it.video ? DQBMedia.watchUrl(it.video) : ''), kind: it.type === 'zone' ? 'set' : (it.type === 'media' ? it.kind : it.kind), ref: it.ref || null });
    },
    /** Did this change touch something shared (so students need a fresh list)? */
    touchesShared: (action, payload) => {
        if (action === 'state:fullsync') return true;
        const sharedZones = State.shared.filter(id => { const z = State.items.find(i => i.id === id); return z && z.type === 'zone'; });
        const inSet = (id) => sharedZones.some(z => { const zone = State.items.find(i => i.id === z); return zone && (zone.children || []).includes(id); });
        if (action === 'items:delete') return (payload.ids || []).some(id => State.shared.includes(id) || sharedZones.length);
        if (action === 'items:add') return sharedZones.length > 0 && (payload.items || []).some(i => sharedZones.includes(i.parentZone));
        if (action === 'items:update') return (payload.items || []).some(u => ((State.shared.includes(u.id) || inSet(u.id)) && ['title', 'url', 'desc', 'thumb', 'text', 'video', 'kind', 'src', 'color', 'children'].some(k => k in u)) || ('parentZone' in u && sharedZones.length) || (sharedZones.includes(u.id) && 'children' in u));
        return false;
    },
    _sharedChanged: DQBUI.debounce(() => {
        const before = State.shared.join();
        State.shared = State.shared.filter(id => Network.shareable(State.items.find(i => i.id === id)));
        Object.keys(State.explore).forEach(z => { if (!State.shared.includes(z)) delete State.explore[z]; });
        Object.values(State.students).forEach(st => { if (st.role === 'student') SafeSend(st.conn, { type: 'SHARED', items: Network.sharedFor(st) }); });   // also carries edited titles
        if (before !== State.shared.join()) Render.all();
    }, 150),

    /* ---------- one item for the students looking at it (VIEW / ITEM) ---------- */
    itemMsg: (st, it, withSrc) => {
        const m = { type: 'ITEM', id: it.id, annos: DQBMedia.visibleTo(it.annos || [], { teacher: false, sid: st.sid, peers: State.settings.peers !== false, names: !!State.settings.names }) };
        if (withSrc && it.type === 'media' && it.kind === 'image') m.src = it.src;
        return m;
    },
    _itemT: {},
    /** After annotations change: everyone looking at the item gets the new list (a burst of changes is sent once). */
    pushItem: (id) => {
        if (Network._itemT[id]) return;
        Network._itemT[id] = setTimeout(() => {
            delete Network._itemT[id];
            const it = State.items.find(i => i.id === id);
            Object.values(State.students).forEach(st => {
                if (st.role !== 'student' || st.viewing !== id) return;
                if (!it || !Network.visibleItem(st, id)) { SafeSend(st.conn, { type: 'ITEM', id, gone: true }); st.viewing = null; return; }
                SafeSend(st.conn, Network.itemMsg(st, it, false));
            });
        }, 120);
    },
    /** Rules changed: what students see of each other's annotations may have too. */
    pushAllItems: () => { Object.values(State.students).forEach(st => { if (st.role === 'student' && st.viewing) Network.pushItem(st.viewing); }); },

    /* ---------- exploring a shared set ---------- */
    exploreCounts: (id) => {
        const zid = State.shared.find(z => { const zone = State.items.find(i => i.id === z && i.type === 'zone'); return zone && (zone.children || []).includes(id); });
        if (!zid) return null;
        const c = { opened: 0, done: 0, stars: 0 };
        Object.values(State.explore[zid] || {}).forEach(rec => { const r = rec[id]; if (!r) return; if (r.o) c.opened++; if (r.d) c.done++; if (r.s) c.stars++; });
        return c;
    },
    _exploreChanged: DQBUI.debounce(() => { Render.all(); if (window.Shell && Shell.ExploreProgress) Shell.ExploreProgress.refresh(); }, 200),

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
            if (!Network._allow(conn, d.type === 'IMG_NOTE' ? 5 : (d.type === 'ANNO_ADD' ? 2 : 1))) return;
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
                if (!fromHostToCohost) {                      // a co-host's board: which items are live is still the host's call
                    StateManager.setFullState({ items, ink: Sanitize.strokes(d.ink) }, silent);
                    Network.syncOpenFlags();
                    StateManager._notify('state:fullsync', { items, ink: State.ink });
                    break;
                }
                StateManager.setFullState({ items, ink: Sanitize.strokes(d.ink), activity: d.activity }, silent);
                if (fromHostToCohost) { if (first || !State.hasEntered) { State.hasEntered = true; Shell.enterBoard({ cohost: true }); } nr(); Shell.syncBoardState(); }
                break;
            }
            case 'NOTE_UPDATE': { const n = Sanitize.item(d.note); if (n) { if (!fromHostToCohost) delete n.annos; fromHostToCohost ? (StateManager.updateItem(n.id, n, silent), nr()) : StateManager.updateItem(n.id, n); } break; }
            case 'BATCH_UPDATE': {
                const ups = (Array.isArray(d.items) ? d.items : []).slice(0, 500).map(i => Sanitize.item(i)).filter(Boolean).map(i => { if (!fromHostToCohost) delete i.annos; return { id: i.id, props: i }; });
                if (ups.length) { fromHostToCohost ? (StateManager.updateItems(ups, silent), nr()) : StateManager.updateItems(ups); }
                break;
            }
            case 'ADD_ITEM': {
                const n = Sanitize.item(d.item); if (!n) break;
                if (State.items.find(i => i.id === n.id)) { if (!fromHostToCohost) delete n.annos; fromHostToCohost ? (StateManager.updateItem(n.id, n, silent), nr()) : StateManager.updateItem(n.id, n); }
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
                // we are a co-host and the host deleted something: mirror it (the host already re-linked zones and relays those updates)
                if (fromHostToCohost) { if (State.items.some(i => i.id === id)) { StateManager.deleteItems([id], silent); nr(); } break; }
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
                Network._contributed(st, 'poll');
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
                Network._contributed(st, 'data');
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
                Network._contributed(st, d.type === 'SUBMIT_SORT' ? 'rank' : 'vote');
                break;
            }
            case 'VIEW': {
                if (fromHostToCohost) break;
                const id = d.item == null ? null : safeId(d.item);
                if (!id) { st.viewing = null; break; }
                const it = Network.visibleItem(st, id);
                if (!it) { SafeSend(conn, { type: 'ITEM', id, gone: true }); break; }
                st.viewing = id;
                SafeSend(conn, Network.itemMsg(st, it, true));
                break;
            }
            case 'ANNO_ADD': {
                if (fromHostToCohost) break;
                const cohost = st.role === 'cohost';
                const itemId = safeId(d.item);
                const it = cohost ? State.items.find(i => i.id === itemId && (i.type === 'media' || i.type === 'link')) : Network.visibleItem(st, itemId);
                const aid = safeId(d.a && d.a.id);
                const status = (s) => SafeSend(conn, { type: 'ANNO_STATUS', id: itemId, aid, status: s });
                if (!it) { status('gone'); break; }
                if (!cohost && State.muted[st.sid]) { SafeSend(conn, { type: 'MUTE', on: true }); status('muted'); break; }
                const list = it.annos || [];
                if (aid && list.some(a => a.id === aid)) { status('ok'); break; }                    // sent again from the outbox
                if (list.length >= DQBMedia.LIMITS.perItem || (!cohost && list.filter(a => a.by.sid === st.sid).length >= DQBMedia.LIMITS.perStudent)) { status('limit'); break; }
                const a = DQBMedia.cleanAnno({ ...(d.a && typeof d.a === 'object' ? d.a : {}), by: cohost ? { n: 'Co-host', r: 't', sid: 'cohost' } : { n: st.name, r: 's', sid: st.sid }, ts: Date.now(), pend: !cohost && !!State.settings.approve, mine: false }, { student: !cohost, video: it.kind === 'video' });
                if (!a || (it.type === 'link' && a.k !== 'comment')) { status('bad'); break; }
                if (it.type === 'link') { delete a.x; delete a.y; delete a.t; delete a.t2; }
                if (a.re && !list.some(x => x.id === a.re && x.k === 'comment' && !x.re)) delete a.re;
                StateManager.setAnnos(it.id, list.concat([a]));
                status(a.pend ? 'pending' : 'ok');
                if (!cohost) Network._contributed(st, a.k === 'ink' ? 'markup' : 'comment');
                break;
            }
            case 'ANNO_DEL': {
                if (fromHostToCohost) break;
                const cohost = st.role === 'cohost';
                const it = cohost ? State.items.find(i => i.id === safeId(d.item)) : Network.visibleItem(st, safeId(d.item));
                if (!it || !Array.isArray(it.annos)) break;
                const ids = (Array.isArray(d.ids) ? d.ids : [d.aid]).map(safeId).filter(Boolean).slice(0, 800);
                const gone = new Set(ids.filter(x => it.annos.some(a => a.id === x && (cohost || a.by.sid === st.sid))));
                if (!gone.size) break;
                it.annos.forEach(a => { if (a.re && gone.has(a.re)) gone.add(a.id); });
                StateManager.setAnnos(it.id, it.annos.filter(a => !gone.has(a.id)));
                break;
            }
            case 'ANNO_OK': {
                if (fromHostToCohost || st.role !== 'cohost') break;
                Actions.approveAnno(safeId(d.item), safeId(d.aid));
                break;
            }
            case 'ANNOS_SET': {                                    // host -> co-host: the annotations on one item
                if (!fromHostToCohost) break;
                const it = State.items.find(i => i.id === safeId(d.id)); if (!it) break;
                it.annos = it.type === 'link' ? Sanitize.linkAnnos(d.annos) : DQBMedia.cleanAnnos(d.annos, { video: it.kind === 'video' });
                nr(); if (window.Shell && Shell.MediaView) Shell.MediaView.refresh(it.id);
                break;
            }
            case 'EXPLORE': {
                if (fromHostToCohost || st.role !== 'student') break;
                const z = State.items.find(i => i.id === safeId(d.set) && i.type === 'zone' && State.shared.includes(i.id));
                if (!z || !Network.setVisible(st, z)) break;
                const id = safeId(d.id); if (!id || !Network.setItems(z).some(i => i.id === id)) break;
                const bySid = State.explore[z.id] || (State.explore[z.id] = {});
                const rec = bySid[st.sid] || (bySid[st.sid] = {});
                const cur = rec[id] || {};
                const next = { o: !!(cur.o || d.open || d.done), d: typeof d.done === 'boolean' ? d.done : !!cur.d, s: typeof d.star === 'boolean' ? d.star : !!cur.s };
                rec[id] = next;
                if (next.o && !cur.o) Network._contributed(st, 'explore');
                Network._exploreChanged();
                break;
            }
            case 'COMMENT': {
                if (!State.items.some(i => i.id === d.targetId)) break;
                const text = clampStr(d.text, 500).trim(); if (!text) break;
                State.comments.push({ type: 'COMMENT', targetId: d.targetId, text, author: State.settings.names ? st.name : 'Student', tag: ['feedback', 'question', 'connection'].includes(d.tag) ? d.tag : 'feedback' });
                if (State.comments.length > 1000) State.comments.shift();
                Network.updateDiscussion(); Render.all();
                Network._contributed(st, 'comment');
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
                Network._contributed(st, 'exit');
                break;
            }
            case 'CONSENSUS_INK':
                if (State.consensusMode.active && State.consensusMode.participants.includes(pid)) {
                    const s = Sanitize.strokes([d.ink])[0]; if (s) Consensus.handleInk(s);
                }
                break;
        }
    },

    /** The host's record of a student (a signed-in account), or null for a guest. */
    hostStudent: (sid) => {
        const r = DQBUI.host().roster;
        if (!r || typeof r.lookup !== 'function') return null;
        try { const m = r.lookup(sid); return m && typeof m === 'object' ? m : null; } catch (e) { return null; }
    },
    _join: (pid, d, conn) => {
        const sid = safeId(d.sid) || pid;
        const refuse = (reason, msg) => { SafeSend(conn, { type: 'KICKED', reason, msg: msg ? clampStr(msg, 200) : undefined }); setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 150); };
        if (State.blocked[sid]) return refuse('removed');
        const known = Network.hostStudent(sid), roster = DQBUI.host().roster;
        if (roster && typeof roster.admit === 'function') {
            let ok = true; try { ok = roster.admit(sid, known) !== false; } catch (e) { ok = true; }
            if (!ok) return refuse('restricted', roster.refusal || 'This board is only open to the teacher’s own students. Sign in with your student account, then join again.');
        }
        const typed = clampStr(String(d.name || '').replace(/[\u0000-\u001f<>]/g, ''), 24).trim() || 'Student';
        const name = known && known.name ? clampStr(String(known.name).replace(/[\u0000-\u001f<>]/g, ''), 24).trim() || typed : typed;
        const avatar = Net.AVATARS.includes(d.avatar) ? d.avatar : '😀';
        // the same student reconnecting replaces their previous (stale) connection
        let carried = {};
        Object.keys(State.students).forEach(k => {
            const o = State.students[k];
            if (o.sid === sid && k !== pid && o.role === 'student') { carried = { color: o.color }; try { o.conn.close(); } catch (e) { /* ignore */ } delete State.students[k]; State.consensusMode.participants = State.consensusMode.participants.map(p => p === k ? pid : p); }
        });
        conn._joined = true;
        // a student who drops off and comes back keeps their group
        const color = safeColor(carried.color) || safeColor(State.groupOf[sid]) || (known && safeColor(known.color)) || null;
        const student = State.students[pid] = { name, avatar, sid, conn, role: 'student', color, joinedAt: Date.now(), verified: !!(known && known.verified), info: known && known.info ? clampStr(known.info, 60) : '' };
        if (color) State.groupOf[sid] = color;
        const a = State.activity;
        let welcomeMode = 'LOCKED', actPayload = null;
        if (a.type === 'OPEN') welcomeMode = 'OPEN';
        else if (Network._openZonesRunning()) { welcomeMode = 'OPEN_ZONE'; actPayload = Network.zoneMsg(student); }
        else if (a.type === 'ZONE_ACT' || a.type === 'WIDGET_ACT') { welcomeMode = a.payload.subType; actPayload = a.payload; }
        else if (a.type === 'EXIT_TICKET') { welcomeMode = 'EXIT_TICKET'; actPayload = a.payload; }
        const mine = State.items.filter(i => i.type === 'note' && i.sid === sid).map(i => ({ id: i.id, text: i.text, sub: i.sub }));
        const t = State.timer;
        SafeSend(conn, {
            type: 'WELCOME', boardId: State.id, mode: welcomeMode, payload: actPayload, sync: mine, v: 2,
            rules: { names: State.settings.names, approve: State.settings.approve, peers: State.settings.peers !== false }, muted: !!State.muted[sid], color: student.color,
            pending: State.pending.filter(p => p.sid === sid).map(p => p.id),
            timer: { running: t.running, remainingMs: t.running ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs, totalMs: t.totalMs },
            shared: Network.sharedFor(student)
        });
        DQBUI.emit('join', { sid, name, verified: student.verified, boardId: State.id });
        if (color) SafeSend(conn, { type: 'SET_COLOR', color, name: groupName(color) });
        if (State.consensusMode.active) {
            SafeSend(conn, Consensus.startMsg()); SafeSend(conn, Consensus.viewMsg());
            if (State.consensusMode.participants.includes(pid)) SafeSend(conn, { type: 'CONSENSUS_PERMS', canDraw: true });
        }
        Roster(); Consensus.renderParticipants();
        if (window.Shell) Shell.Panel.flashJoined(student);          // the record may already be gone if the connection dropped while we answered
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
        // zone targeting: the zone the student picked, if it is one of the zones open to them, otherwise their first one
        let zone = null;
        if (Network._openZonesRunning()) {
            const mine = Network.zonesFor(st).zones;
            if (!mine.length) return reject(Network.openZoneIds().length ? 'group' : 'locked');
            const want = safeId(d.zoneId);
            zone = (want && mine.find(z => z.id === want)) || mine[0];
        }

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
            Network._contributed(st, 'note');
            return;
        }
        Network._placeNote(item, zone ? zone.id : null);
        SafeSend(conn, { type: 'NOTE_STATUS', id, status: 'approved' });
        Network._contributed(st, 'note');
    },
    _contributed: (st, kind) => { if (st && st.role === 'student') DQBUI.emit('contribution', { sid: st.sid, kind, boardId: State.id, verified: !!st.verified }); },
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
            const { zoneId, ts, studentName, avatar, inbox, openSet, ...item } = p;
            Network._placeNote(item, inbox ? Inbox.zoneFor(openSet) : zoneId);
        }
        if (p.inbox) Inbox.decided(p.inbox);                // from the board's inbox: the host can let it go
        if (stu) SafeSend(stu.conn, { type: 'NOTE_STATUS', id, status: ok ? 'approved' : 'rejected', reason: ok ? undefined : 'declined' });
        Shell.syncQueue();
    },
    approveAll: () => { State.pending.slice().forEach(p => Network.approve(p.id, true)); },

    /* ---------- results ---------- */
    _resultsHtml: (actId) => {
        const submissions = State.activeSorts[actId] || [];
        const scores = {};
        submissions.forEach(sub => { if (Array.isArray(sub)) sub.forEach((itemId, idx) => { scores[itemId] = (scores[itemId] || 0) + (sub.length - idx); }); else scores[sub] = (scores[sub] || 0) + 1; });
        const label = (item) => (!item ? 'Unknown' : (item.type === 'note' ? (item.text ? item.text.substring(0, 40) : (item.src ? 'Sketch' : 'Note')) : clampStr(item.title || (item.type === 'media' ? (item.kind === 'video' ? 'Video' : 'Picture') : 'Link'), 40)));
        const results = Object.keys(scores).map(id => ({ text: label(State.items.find(x => x.id === id)), score: scores[id] })).sort((a, b) => b.score - a.score);
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
            const raw = item ? (item.type === 'note' ? item.text : item.title) : '';
            const txt = raw ? raw.substring(0, 24) + (raw.length > 24 ? '…' : '') : (item && item.type === 'note' ? 'Sketch' : 'Item');
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
            case 'items:annos': if (!State.isCoHost) msgs.push({ type: 'ANNOS_SET', id: payload.id, annos: payload.annos }); break;
        }
        if (!msgs.length) return;
        if (State.isCoHost) { const h = State.students['HOST']; if (h) msgs.forEach(m => SafeSend(h.conn, m)); }
        else Object.values(State.students).forEach(s => { if (s.role === 'cohost') msgs.forEach(m => SafeSend(s.conn, m)); });
    }
};

/* --- STUDENTS' WORK FROM WHILE THE BOARD WAS CLOSED (DQB_HOST.inbox) ---
   A host site can leave a board open for its students without the console: it keeps what they add (the messages a live board
   gets) in an inbox. The console takes the inbox in when the board opens, and every few seconds while it is open, checks every
   message again as it would a live one, and tells the host what it took in once the board is saved, so nothing is lost or
   added twice. Notes waiting for approval stay in the inbox until the teacher decides. What students did is counted by the host
   when they did it, so nothing here is counted again. */
window.Inbox = {
    timer: null, busy: false, board: null, taken: new Set(), toAck: [], open: null,
    api: () => { const b = DQBUI.host().inbox; return b && typeof b.pull === 'function' && typeof b.ack === 'function' ? b : null; },
    start: () => {
        clearInterval(Inbox.timer); Inbox.timer = null;
        Inbox.board = State.id; Inbox.taken = new Set(); Inbox.toAck = []; Inbox.setOpen(null);
        if (!Inbox.api() || State.isCoHost || !State.id) return;
        Inbox.pull();
        Inbox.timer = setInterval(() => { if (!document.hidden) Inbox.pull(); }, 15000);
    },
    /** How the host opened the board for the session a message came from. */
    settings: (s) => {
        s = s && typeof s === 'object' ? s : {};
        return { notes: !!s.notes, zone: safeId(s.zone) || '', see: !!s.see, names: s.names !== false, approve: !!s.approve, shared: (Array.isArray(s.shared) ? s.shared : []).slice(0, 50).map(safeId).filter(Boolean) };
    },
    pull: async () => {
        const api = Inbox.api(), board = State.id;
        if (!api || Inbox.busy || !board || board !== Inbox.board || State.isCoHost) return;
        Inbox.busy = true;
        try {
            let res;
            const have = State.pending.filter(p => p.inbox).map(p => p.inbox);         // already in the approval queue: listed, not sent again
            try { res = await api.pull(board, { have }); } catch (e) { return; }      // offline: next time
            if (State.id !== board || !res || typeof res !== 'object') return;
            Inbox.setOpen(res.open);
            const sessions = res.sessions && typeof res.sessions === 'object' ? res.sessions : {};
            const entries = (Array.isArray(res.entries) ? res.entries : []).slice(0, 1000);
            const counts = { note: 0, comment: 0, markup: 0, explore: 0 }, done = [];
            let changed = false;
            entries.forEach(e => {
                const id = Number(e && e.id);
                if (!(id > 0) || Inbox.taken.has(id) || e.held) return;
                let r = {};
                try { r = Inbox.merge(e, Inbox.settings(sessions[e.session])); } catch (err) { console.warn('Inbox: could not take in', err); }
                if (r.kind) { counts[r.kind]++; if (r.kind !== 'explore') changed = true; }
                if (r.wait) return;                                                      // a note waiting for approval stays in the inbox
                Inbox.taken.add(id); done.push(id);
            });
            // notes in the approval queue that their student took back (the host no longer lists them)
            if (entries.length < 1000) {
                const there = new Set(entries.map(e => Number(e && e.id)));
                const before = State.pending.length;
                State.pending = State.pending.filter(p => !p.inbox || there.has(p.inbox));
                if (State.pending.length !== before) Shell.syncQueue();
            }
            if (counts.explore) Network._exploreChanged();
            if (done.length) { if (changed) Board.save(true); Inbox.toAck.push({ ids: done, rev: Board.rev }); }
            Inbox.toast(counts);
            Inbox.flushAcks();
            if (res.more && done.length) setTimeout(() => Inbox.pull(), 6000);       // the rest, once these are saved and acknowledged
        } finally { Inbox.busy = false; }
    },
    /** One message, checked like a live one. Returns { kind } when it added something, { wait: true } for a note waiting for approval. */
    merge: (e, set) => {
        const sid = safeId(e.sid), d = e.msg && typeof e.msg === 'object' ? e.msg : null;
        if (!sid || !d || State.blocked[sid]) return {};
        const name = clampStr(String(e.name || '').replace(/[\u0000-\u001f<>]/g, ''), 24).trim() || 'Student';
        switch (d.type) {
            case 'NOTE': case 'IMG_NOTE': return Inbox.note(e, d, sid, name, set);
            case 'DELETE_NOTE': {
                const id = safeId(d.id); if (!id) return {};
                const k = State.pending.findIndex(p => p.id === id && p.sid === sid);
                if (k > -1) { const p = State.pending.splice(k, 1)[0]; if (p.inbox) Inbox.decided(p.inbox); Shell.syncQueue(); }
                const it = State.items.find(x => x.id === id);
                if (it && it.sid === sid) HierarchyManager.delete([id]);
                return {};
            }
            case 'ANNO_ADD': return Inbox.anno(e, d, sid, name, set);
            case 'ANNO_DEL': {
                const it = Inbox.visible(set, safeId(d.item));
                if (!it || !Array.isArray(it.annos)) return {};
                const ids = (Array.isArray(d.ids) ? d.ids : []).map(safeId).filter(Boolean).slice(0, 800);
                const gone = new Set(ids.filter(x => it.annos.some(a => a.id === x && a.by && a.by.sid === sid)));
                if (!gone.size) return {};
                it.annos.forEach(a => { if (a.re && gone.has(a.re)) gone.add(a.id); });
                StateManager.setAnnos(it.id, it.annos.filter(a => !gone.has(a.id)));
                return {};
            }
            case 'EXPLORE': {
                // progress shows on a zone the console is sharing now; the host has counted it either way
                const z = State.items.find(i => i.id === safeId(d.set) && i.type === 'zone');
                if (!z || !set.shared.includes(z.id) || !State.shared.includes(z.id)) return {};
                const id = safeId(d.id); if (!id || !Network.setItems(z).some(i => i.id === id)) return {};
                const bySid = State.explore[z.id] || (State.explore[z.id] = {});
                const rec = bySid[sid] || (bySid[sid] = {});
                const cur = rec[id] || {};
                rec[id] = { o: !!(cur.o || d.open || d.done), d: typeof d.done === 'boolean' ? d.done : !!cur.d, s: typeof d.star === 'boolean' ? d.star : !!cur.s };
                return { kind: 'explore' };
            }
        }
        return {};
    },
    note: (e, d, sid, name, set) => {
        const id = safeId(d.id);
        if (!id || !set.notes) return {};
        const existing = State.items.find(x => x.id === id);
        if (existing && existing.sid !== sid) return {};                               // someone else's note
        if (!existing && State.items.filter(x => x.sid === sid).length >= 80) return {};
        const author = set.names ? name : 'Student';
        let item;
        if (d.type === 'NOTE') {
            const text = clampStr(d.text, 1000); if (!text.trim()) return {};
            const sub = NOTE_SUBS_STUDENT.includes(d.sub) ? d.sub : 'notice';
            if (existing) { if (existing.text !== text || existing.sub !== sub) StateManager.updateItem(id, { text, sub }); return {}; }
            item = { id, type: 'note', sub, text, author, sid, w: 220, h: 170, votes: 0, groupId: null };
        } else {
            const src = safeImg(d.src, 1500000); if (!src || existing) return {};
            item = { id, type: 'note', sub: 'sketch', src, text: clampStr(d.text, 120), author, sid, w: 240, h: 240, votes: 0, groupId: null };
        }
        if (set.approve) {
            if (State.pending.some(p => p.id === id)) return { wait: true };
            State.pending.push({ ...item, zoneId: null, ts: Number(e.ts) || Date.now(), studentName: name, avatar: '📬', inbox: Number(e.id), openSet: set });
            Shell.syncQueue(true);
            return { wait: true, kind: 'note' };
        }
        Network._placeNote(item, Inbox.zoneFor(set));
        return { kind: 'note' };
    },
    anno: (e, d, sid, name, set) => {
        const it = Inbox.visible(set, safeId(d.item));
        if (!it) return {};
        const list = it.annos || [];
        const aid = safeId(d.a && d.a.id) || safeId(d.id);
        if (!aid || list.some(a => a.id === aid)) return {};
        if (list.length >= DQBMedia.LIMITS.perItem || list.filter(a => a.by && a.by.sid === sid).length >= DQBMedia.LIMITS.perStudent) return {};
        const a = DQBMedia.cleanAnno({ ...(d.a && typeof d.a === 'object' ? d.a : {}), id: aid, by: { n: name, r: 's', sid }, ts: Number(e.ts) || Date.now(), pend: !!set.approve, mine: false }, { student: true, video: it.kind === 'video' });
        if (!a || (it.type === 'link' && a.k !== 'comment')) return {};
        if (it.type === 'link') { delete a.x; delete a.y; delete a.t; delete a.t2; }
        if (a.re && !list.some(x => x.id === a.re && x.k === 'comment' && !x.re)) delete a.re;
        StateManager.setAnnos(it.id, list.concat([a]));
        return { kind: a.k === 'ink' ? 'markup' : 'comment' };
    },
    /** A card, picture or video the opening shared: on its own, or in a shared zone. */
    visible: (set, id) => {
        const it = id && State.items.find(i => i.id === id && (i.type === 'media' || i.type === 'link'));
        if (!it) return null;
        if (set.shared.includes(id)) return it;
        return set.shared.some(zid => { const z = State.items.find(i => i.id === zid && i.type === 'zone'); return z && (z.children || []).includes(id); }) ? it : null;
    },
    /** Where the opening's notes go: the zone the teacher chose, or a "From students" zone (made the first time it is needed). */
    zoneFor: (set) => {
        const want = set && set.zone ? State.items.find(z => z.id === set.zone && z.type === 'zone' && !z.zoneType) : null;
        if (want) return want.id;
        let z = State.items.find(i => i.type === 'zone' && !i.zoneType && i.title === 'From students');
        if (!z) {
            const w = 400, h = 440, b = Viewport.contentBounds(), c = Viewport.centerWorld();
            const pos = b ? Board.getFreeSpace(b.maxX + 80, b.minY + 30, w, h) : Board.getFreeSpace(c.x - w / 2, c.y - h / 2, w, h);
            z = { id: genId(), type: 'zone', title: 'From students', x: pos.x, y: pos.y, w, h, children: [] };
            StateManager.addItem(z);
        }
        return z.id;
    },
    /** The teacher approved or declined a note from the inbox: the host can let it go once the board is saved. */
    decided: (inboxId) => {
        if (!(inboxId > 0)) return;
        Inbox.taken.add(inboxId);
        Board.save(true);
        Inbox.toAck.push({ ids: [inboxId], rev: Board.rev });
    },
    /** Tells the host which messages are in the board, once the board holding them is saved (in the account, if there is one). */
    flushAcks: async () => {
        const api = Inbox.api(), board = Inbox.board;
        if (!api || !board || State.id !== board || !Inbox.toAck.length) return;
        const saved = Board.cloud() ? Board._cloudRev : Board._localRev;
        const ready = Inbox.toAck.filter(a => saved >= a.rev);
        if (!ready.length) return;
        Inbox.toAck = Inbox.toAck.filter(a => saved < a.rev);
        try { await api.ack(board, [].concat(...ready.map(a => a.ids))); }
        catch (e) { if (State.id === board) Inbox.toAck = ready.concat(Inbox.toAck); }   // asked again after the next save or pull
    },
    toast: (c) => {
        const parts = [];
        if (c.note) parts.push(`${c.note} note${c.note === 1 ? '' : 's'}`);
        if (c.comment) parts.push(`${c.comment} comment${c.comment === 1 ? '' : 's'}`);
        if (c.markup) parts.push(`${c.markup} drawing${c.markup === 1 ? '' : 's'}`);
        if (parts.length) UI.toast(`From students: ${parts.join(', ')}`, 'success');
    },
    /** The board is open for students now (the host says so): a chip in the top bar, with when it closes. */
    setOpen: (o) => {
        const el = $('open-chip');
        Inbox.open = o && typeof o === 'object' ? { until: o.until ? new Date(o.until) : null } : null;
        if (!el) return;
        el.hidden = !Inbox.open;
        if (!Inbox.open) return;
        const u = Inbox.open.until && !isNaN(Inbox.open.until.getTime()) ? Inbox.open.until : null;
        let when = '';
        try { when = u ? u.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''; } catch (e) { when = ''; }
        const label = when ? `Open until ${when}` : 'Open for students';
        const txt = $('open-label'); if (txt && txt.textContent !== label) txt.textContent = label;
        el.setAttribute('aria-label', `${label}: students can add to this board without you`);
    },
    explain: async () => {
        const api = Inbox.api(), url = api && typeof api.manageUrl === 'function' ? String(api.manageUrl(State.id) || '') : '';
        const msg = 'The students you chose can add to this board while you are not running it. What they add appears here: when you open the board, and within a few seconds while it is open.';
        if (!/^(https?:\/\/|\/)/.test(url)) { DQBUI.Dialog.alert({ title: 'Open for students', message: msg, icon: 'exit' }); return; }
        const ok = await DQBUI.Dialog.confirm({ title: 'Open for students', message: msg + ' Change who can join, or close it, on the website.', confirmLabel: 'Change or close', icon: 'exit' });
        if (ok) window.open(url, '_blank', 'noopener');
    }
};
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#open-chip')) Inbox.explain(); });

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
        board:     { insert: true,  select: true, laser: true,  brush: false, sketch: true,  pin: true,  combine: true, minimap: true,  templates: true },
        consensus: { insert: false, select: true, laser: false, brush: true,  sketch: false, pin: false, combine: true, minimap: false, templates: false },
        breakout:  { insert: true,  select: true, laser: true,  brush: false, sketch: true,  pin: true,  combine: true, minimap: false, templates: true }
    })[Workspace.mode],
    /** The ink selection of the canvas in front of the teacher. */
    ink: () => InkSel[Workspace.mode] || InkSel.board,
    duplicateSelection: () => { if (Workspace.mode === 'board') Actions.duplicate(); else if (Workspace.mode === 'consensus') InkSel.consensus.duplicate(); else Breakout.duplicateSelected(); },
    deleteSelection: () => { if (Workspace.mode === 'board') Actions.delete(); else if (Workspace.mode === 'consensus') Consensus.deleteSelection(); else Breakout.deleteSelected(); },
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
            cancel: () => { Consensus.currentPath = []; Consensus.drag = null; const t = $('cm-temp-ink'); if (t) t.innerHTML = ''; $('cm-marquee').style.display = 'none'; Consensus.renderInk(); }
        });
    },
    _viewChanged: () => {
        if (window.Shell) Shell.syncZoom();
        const now = performance.now();
        const send = () => { if (State.consensusMode.active) Network.broadcast(Consensus.viewMsg()); };
        if (now - Consensus._lastView > 120) { Consensus._lastView = now; send(); }
        clearTimeout(Consensus._vt); Consensus._vt = setTimeout(send, 160);
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
        InkSel.consensus.clear(true);
        UI.closeAllMenus();
        Workspace.set('consensus');
        Consensus._hist = []; Consensus._hi = -1; Consensus._pushHistory();
        Consensus.renderItems(); Consensus.renderInk(); Consensus.loop(); Consensus.renderParticipants();
        Consensus.setTool('pan');
        Consensus.fitInitial();
        Network.broadcast(Consensus.startMsg());
        Consensus._viewChanged();
        if (window.Shell && DQBUI.isMobile() === false) Shell.Panel.open();
    },
    /** What a student needs to join the shared model (also sent to students who join or reconnect mid-session). */
    startMsg: () => {
        const cm = State.consensusMode;
        return { type: 'CONSENSUS_START', zoneId: cm.zoneId, ink: cm.ink, items: Consensus.itemsPayload(), title: cm.title };
    },
    viewMsg: () => {
        const cm = State.consensusMode, r = $('consensus-main').getBoundingClientRect();
        return { type: 'CONSENSUS_VIEW_SYNC', view: { x: cm.view.x, y: cm.view.y, z: cm.view.z }, size: { w: Math.round(r.width), h: Math.round(r.height) } };
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
            // notes made from ink during the session join the model zone; the rest keep their new places
            const added = cm.items.filter(c => !State.items.some(i => i.id === c.id)).map(c => ({ ...JSON.parse(JSON.stringify(c)), x: c.x + zone.x, y: c.y + zone.y, parentZone: zone.id }));
            const updates = cm.items.filter(c => !added.some(a => a.id === c.id)).map(c => ({ id: c.id, props: { x: c.x + zone.x, y: c.y + zone.y } }));
            updates.push({ id: zone.id, props: { ink: JSON.parse(JSON.stringify(cm.ink)), children: (zone.children || []).concat(added.map(a => a.id)) } });
            StateManager.batch(() => { if (added.length) StateManager.addItems(added); StateManager.updateItems(updates); });
        }
        InkSel.consensus.clear(true);
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
        if (window.Shell && InkSel.consensus.count()) Shell.positionSelBar();
        Consensus._animationFrame = requestAnimationFrame(Consensus.loop);
    },
    renderTempInk: () => {
        const svg = $('cm-temp-ink'); if (!svg) return;
        const cm = State.consensusMode;
        if (Consensus.drag && Consensus.drag.mode === 'draw' && Consensus.currentPath.length > 1) {
            const t = `scale(${cm.view.z}) translate(${cm.view.x} ${cm.view.y})`;      // SVG attribute syntax: no units
            svg.innerHTML = `<g transform="${t}"><path d="${InkManager.pointsToPath(Consensus.currentPath)}" stroke="${safeColor(cm.color) || '#000'}" stroke-width="${cm.brush === 'highlight' ? cm.width * 3 : cm.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${cm.brush === 'highlight' ? 0.4 : 1}"/></g>`;
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
        InkSel.consensus.prune();
        const d = Consensus.drag, live = d && d.mode === 'move-ink' && d.moved;
        InkTools.paint($('consensus-ink-layer'), State.consensusMode.ink, { sel: InkSel.consensus.sel, offset: live ? { dx: d.dx, dy: d.dy } : null });
    },
    handleInk: (ink) => {
        State.consensusMode.ink.push(ink);
        Consensus.renderInk(); Consensus._pushHistory();
        Network.broadcast({ type: 'CONSENSUS_INK', ink });
    },
    /** What students see of the model's notes (also part of CONSENSUS_START). */
    itemsPayload: () => State.consensusMode.items.map(i => ({ id: i.id, type: i.type, sub: i.sub, text: clampStr(i.text, 500), src: i.src ? safeImg(i.src, 1500000) : undefined, x: i.x, y: i.y, w: i.w, h: i.h })),
    broadcastItems: () => Network.broadcast({ type: 'CONSENSUS_ITEMS', items: Consensus.itemsPayload() }),
    // history covers the drawing and the notes on the model (notes made from ink, notes moved)
    _snapshot: () => JSON.stringify({ ink: State.consensusMode.ink, items: State.consensusMode.items }),
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
        const cm = State.consensusMode, snap = JSON.parse(Consensus._hist[Consensus._hi]);
        const itemsChanged = JSON.stringify(cm.items) !== JSON.stringify(snap.items);
        cm.ink = snap.ink; cm.items = snap.items;
        Consensus.renderInk(); Network.broadcast({ type: 'CONSENSUS_SET_INK', ink: cm.ink });
        if (itemsChanged) { Consensus.renderItems(); Consensus.broadcastItems(); }
        if (window.Shell) { Shell.syncHistory(); Shell.onSelection(); }
    },
    deleteSelection: () => {
        const n = InkSel.consensus.remove();
        if (n) DQBUI.Toast.show(n > 1 ? `${n} strokes deleted` : 'Stroke deleted', { action: { label: 'Undo', onClick: () => Consensus.undo() } });
    },
    undo: () => { if (!Consensus.canUndo()) return; Consensus._hi--; Consensus._applyHistory(); },
    redo: () => { if (!Consensus.canRedo()) return; Consensus._hi++; Consensus._applyHistory(); },

    setTool: (tool) => {
        const cm = State.consensusMode;
        // legacy tool names fold into tool + brush
        if (tool === 'highlight' || tool === 'arrow') { cm.brush = tool; tool = 'draw'; }
        else if (tool === 'draw') { if (!['draw', 'highlight', 'arrow'].includes(cm.brush)) cm.brush = 'draw'; }
        cm.tool = tool;
        if (tool !== 'pan' && tool !== 'select') InkSel.consensus.clear();
        const main = $('consensus-main');
        main.className = tool === 'pan' ? 'cm-pan' : (tool === 'draw' || tool === 'eraser' ? 'cm-draw' : '');
        if (window.Shell) Shell.syncTools();
    },
    setBrush: (b) => { State.consensusMode.brush = b; Consensus.setTool('draw'); },
    setColor: (color) => {
        State.consensusMode.color = color;
        if (InkSel.consensus.count()) { InkSel.consensus.recolor(color); if (window.Shell) Shell.syncDraw(); return; }
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
        const itemEl = e.target.closest('.item'), ink = InkSel.consensus, additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const pan = (extra) => { Consensus.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: cm.view.x, vy: cm.view.y, ...extra }; return true; };
        if (e.button === 1 || e.button === 2) return pan();
        if ((tool === 'select' || tool === 'pan') && !itemEl) {
            const hit = ink.hitAt(coords.x, coords.y, e.pointerType === 'touch' ? 18 : 9);
            if (hit) {
                if (additive) { ink.toggle(hit); if (!ink.has(hit)) return false; }
                else if (!ink.has(hit)) {
                    if (tool === 'pan' || e.pointerType === 'touch') return pan({ inkTap: hit });       // tap selects, drag pans
                    ink.set([hit]);
                }
                Consensus.drag = { mode: 'move-ink', sx: coords.x, sy: coords.y, sx0: e.clientX, sy0: e.clientY, dx: 0, dy: 0, moved: false };
                return true;
            }
            if (tool === 'select' && e.pointerType !== 'touch') {
                const r = $('consensus-main').getBoundingClientRect();
                Consensus.drag = { mode: 'box', sx: e.clientX - r.left, sy: e.clientY - r.top, base: additive ? ink.ids() : [] };
                if (!additive) ink.clear();
                return true;
            }
            return pan({ tapClear: true });
        }
        if (tool === 'pan') return pan();
        if (tool === 'select' && itemEl) {
            const item = cm.items.find(i => i.id === itemEl.id);
            if (item) { ink.clear(); Consensus.drag = { mode: 'move', item, sx: coords.x, sy: coords.y, ix: item.x, iy: item.y }; return true; }
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
            if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
        } else if (d.mode === 'move-ink') {
            if (!d.moved) { if (Math.hypot(e.clientX - d.sx0, e.clientY - d.sy0) < 5) return; d.moved = true; }
            d.dx = coords.x - d.sx; d.dy = coords.y - d.sy;
            InkSel.consensus.preview(d.dx, d.dy);
        } else if (d.mode === 'box') {
            const r = $('consensus-main').getBoundingClientRect(), m = $('cm-marquee');
            const x = e.clientX - r.left, y = e.clientY - r.top, l = Math.min(x, d.sx), t = Math.min(y, d.sy), w = Math.abs(x - d.sx), h = Math.abs(y - d.sy);
            Object.assign(m.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', display: 'block' });
            const wr = { x0: l / view.z - view.x, y0: t / view.z - view.y, x1: (l + w) / view.z - view.x, y1: (t + h) / view.z - view.y };
            InkSel.consensus.set(d.base.concat(InkSel.consensus.inRect(wr)));
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
        Consensus.drag = null;
        if (d.mode === 'draw' && Consensus.currentPath.length > 1) {
            Consensus.handleInk({ id: genId(), points: [...Consensus.currentPath], color: cm.color, width: cm.width, highlight: cm.brush === 'highlight', arrow: cm.brush === 'arrow' });
        } else if (d.mode === 'eraser' && d.erased) Consensus._pushHistory();
        else if (d.mode === 'move') { Network.broadcast({ type: 'CONSENSUS_ITEM_MOVE', id: d.item.id, x: d.item.x, y: d.item.y }); if (d.item.x !== d.ix || d.item.y !== d.iy) Consensus._pushHistory(); }
        else if (d.mode === 'move-ink') { if (d.moved && (d.dx || d.dy)) InkSel.consensus.translate(d.dx, d.dy); else Consensus.renderInk(); }
        else if (d.mode === 'box') { $('cm-marquee').style.display = 'none'; }
        else if (d.mode === 'pan' && !d.moved) {
            if (d.inkTap) InkSel.consensus.set([d.inkTap]);
            else if (d.tapClear) InkSel.consensus.clear();
        }
        Consensus.currentPath = [];
        const t = $('cm-temp-ink'); if (t) t.innerHTML = '';
    },
    _keydown: (e) => {
        const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), ink = InkSel.consensus;
        if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) Consensus.redo(); else Consensus.undo(); }
        else if (mod && k === 'y') { e.preventDefault(); Consensus.redo(); }
        else if (mod && k === 'a') { e.preventDefault(); ink.selectAll(); }
        else if (mod && k === 'd') { e.preventDefault(); ink.duplicate(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && ink.count()) { e.preventDefault(); Consensus.deleteSelection(); }
        else if (e.key.startsWith('Arrow') && ink.count()) { e.preventDefault(); const s = e.shiftKey ? 50 : 10; ink.translate(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); }
        else if (k === 'j' && !mod && ink.count()) ink.combine();
        else if (e.key === 'Escape') { if (ink.count()) ink.clear(); else Consensus.stop(); }
        else if (!mod) { if (k === 'v') Consensus.setTool('select'); else if (k === 'h') Consensus.setTool('pan'); else if (k === 'p') Consensus.setTool('draw'); else if (k === 'e') Consensus.setTool('eraser'); else if (e.key === '+' || e.key === '=') Consensus.zoom(1.2); else if (e.key === '-') Consensus.zoom(1 / 1.2); }
    }
};

InkSel.consensus = InkSel.create({
    ink: () => State.consensusMode.ink,
    zoom: () => State.consensusMode.view.z,
    svg: () => $('consensus-ink-layer'),
    commit: (ink) => {
        State.consensusMode.ink = ink;
        Consensus.renderInk(); Consensus._pushHistory();
        Network.broadcast({ type: 'CONSENSUS_SET_INK', ink });
    },
    changed: () => { Consensus.renderInk(); if (window.Shell) Shell.onSelection(); },
    /** A note made from ink sits on the model exactly where the drawing was (model notes have no header). */
    toNotes: (images, keep) => {
        const cm = State.consensusMode;
        const notes = images.map(img => ({ id: genId(), type: 'note', sub: 'sketch', src: img.src, text: '', x: Math.round(img.x), y: Math.round(img.y), w: Math.max(40, Math.round(img.w)), h: Math.max(40, Math.round(img.h)), parentZone: cm.zoneId, groupId: null, votes: 0 }));
        cm.ink = keep; cm.items.push(...notes);
        Consensus.renderItems(); Consensus.renderInk(); Consensus._pushHistory();
        Network.broadcast({ type: 'CONSENSUS_SET_INK', ink: cm.ink }); Consensus.broadcastItems();
        if (window.Shell) Shell.onSelection();
        return notes;
    }
});

/* --- BREAKOUT BOARD MANAGER --- */
window.Breakout = {
    drag: null, currentPath: [], _frame: null, _zoneId: null, _thumbTimer: null, _history: [], _historyIdx: -1,
    // sel: ids of selected room items (selected ink lives in InkSel.breakout)
    _state: { view: { x: 0, y: 0, z: 1 }, tool: 'pan', color: '#ef4444', width: 4, sel: new Set(), sketchMode: false },

    _getZone: () => State.items.find(i => i.id === Breakout._zoneId),

    open: (zoneId) => {
        const zone = State.items.find(i => i.id === zoneId);
        if (!zone) return;
        Breakout._zoneId = zoneId; Breakout.drag = null; Breakout.currentPath = []; Breakout._history = []; Breakout._historyIdx = -1;
        Breakout._state = { view: { x: 0, y: 0, z: 1 }, tool: 'pan', color: '#ef4444', width: 4, sel: new Set(), sketchMode: false };
        InkSel.breakout.clear(true);
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
    _setSelected: (id) => Breakout._select(id ? [id] : []),
    /** Selects room items; a fresh selection drops selected ink unless keepInk (shift-click, box select). */
    _select: (ids, additive, keepInk) => {
        const sel = Breakout._state.sel;
        if (!additive) sel.clear();
        (ids || []).forEach(id => sel.add(id));
        if (!keepInk) InkSel.breakout.clear(true);
        document.querySelectorAll('#breakout-items-layer .item').forEach(el => el.classList.toggle('selected', sel.has(el.id.slice(3))));
        Breakout.renderInk();
        if (window.Shell) { Shell.syncTools(); Shell.onSelection(); }
    },
    selectedItems: () => { const z = Breakout._getZone(); return z ? (z.subItems || []).filter(i => Breakout._state.sel.has(i.id)) : []; },
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
        el.className = `item ${itemType}${item.zoneType ? ' zone-' + String(item.zoneType).replace(/[^a-z]/gi, '') : ''}${Breakout._state.sel.has(item.id) ? ' selected' : ''}`;
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

        if (itemType === 'note' && item.sub !== 'sketch' && !item.src) { wrap.style.background = head.col; wrap.style.borderColor = head.bor; const h = wrap.querySelector('.i-head'); h.style.background = head.bor + '26'; h.style.color = head.ink || head.bor; }
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
        const sel = Breakout._state.sel;
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
            if (sel.has(id)) { sel.delete(id); Breakout._select([], true, true); return; }
            Breakout._select([id], true, true);
        } else if (!sel.has(id)) Breakout._select([id]);
        const coords = Breakout._screenToWorld(e);
        if (e.target.closest('.resize-h')) Breakout.drag = { mode: 'resize-item', item, el, sx: coords.x, sy: coords.y, iw: item.w || 180, ih: item.h || 130 };
        else Breakout._beginMove(e, coords);
        try { $('breakout-main').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        Breakout._activePointer = e.pointerId;
    },
    /** Drag of the whole selection: selected room items and selected ink move together. */
    _beginMove: (e, coords) => {
        const items = Breakout.selectedItems().map(item => ({ item, el: document.getElementById(`bk-${item.id}`), ix: item.x, iy: item.y }));
        Breakout.drag = { mode: 'move-sel', items, ink: InkSel.breakout.count() > 0, sx: coords.x, sy: coords.y, sx0: e.clientX, sy0: e.clientY, dx: 0, dy: 0, moved: false };
    },
    renderInk: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        InkSel.breakout.prune();
        const d = Breakout.drag, live = d && d.mode === 'move-sel' && d.moved && d.ink;
        InkTools.paint($('breakout-ink-layer'), zone.subInk || [], { sel: InkSel.breakout.sel, offset: live ? { dx: d.dx, dy: d.dy } : null });
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
        if (tool !== 'select' && tool !== 'pan') Breakout._select([]); else if (window.Shell) Shell.syncTools();
    },
    setColor: (color) => {
        Breakout._state.color = color;
        if (InkSel.breakout.count()) { InkSel.breakout.recolor(color); if (window.Shell) Shell.syncDraw(); return; }
        if (Breakout._state.tool !== 'draw') Breakout.setTool('draw'); else if (window.Shell) Shell.syncDraw();
    },
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
    /** Deletes the selected room items and selected ink as one undo step. */
    deleteSelected: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const sel = Breakout._state.sel, ink = InkSel.breakout, n = sel.size, strokes = ink.count();
        if (!n && !strokes) return;
        zone.subItems = (zone.subItems || []).filter(i => !sel.has(i.id));
        if (strokes) zone.subInk = (zone.subInk || []).filter(s => !ink.has(s.id));
        sel.clear(); ink.clear(true);
        Breakout.renderItems(); Breakout.renderInk(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
        if (window.Shell) { Shell.syncTools(); Shell.onSelection(); }
        const what = n && strokes ? `${n} item${n === 1 ? '' : 's'} and ${strokes} stroke${strokes === 1 ? '' : 's'} deleted` : (strokes ? (strokes > 1 ? `${strokes} strokes deleted` : 'Stroke deleted') : (n > 1 ? `${n} items deleted` : 'Deleted'));
        DQBUI.Toast.show(what, { action: { label: 'Undo', onClick: () => Breakout.undo() } });
    },
    duplicateSelected: () => {
        const zone = Breakout._getZone(); if (!zone) return;
        const items = Breakout.selectedItems(), ink = InkSel.breakout;
        if (!items.length && !ink.count()) return;
        const copies = items.map(i => ({ ...JSON.parse(JSON.stringify(i)), id: genId(), x: i.x + 30, y: i.y + 30 }));
        const inkCopies = ink.strokes().map(s => ({ ...InkTools.translate(s, 30, 30), id: genId() }));
        if (!zone.subItems) zone.subItems = [];
        zone.subItems.push(...copies); zone.subInk = (zone.subInk || []).concat(inkCopies);
        Breakout._state.sel = new Set(copies.map(c => c.id)); ink.sel = new Set(inkCopies.map(c => c.id));
        Breakout.renderItems(); Breakout.renderInk(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
        if (window.Shell) { Shell.syncTools(); Shell.onSelection(); }
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
        Breakout._state.sel.clear(); InkSel.breakout.clear(true);
        Breakout.renderItems(); Breakout.renderInk(); Breakout._scheduleThumbUpdate();
        if (window.Shell) { Shell.syncHistory(); Shell.onSelection(); }
    },
    canUndo: () => Breakout._historyIdx > 0, canRedo: () => Breakout._historyIdx < Breakout._history.length - 1,
    undo: () => { if (!Breakout.canUndo()) return; Breakout._historyIdx--; Breakout._applyHistory(); },
    redo: () => { if (!Breakout.canRedo()) return; Breakout._historyIdx++; Breakout._applyHistory(); },
    _keydown: (e) => {
        const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), ink = InkSel.breakout, any = Breakout._state.sel.size || ink.count();
        if (e.key === 'Escape') { if (any) Breakout._select([]); else Breakout.close(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && any) { e.preventDefault(); Breakout.deleteSelected(); }
        else if (mod && k === 'a') { e.preventDefault(); const z = Breakout._getZone(); ink.sel = new Set(((z && z.subInk) || []).map(s => s.id)); Breakout._select(((z && z.subItems) || []).map(i => i.id), false, true); }
        else if (mod && k === 'd') { e.preventDefault(); Breakout.duplicateSelected(); }
        else if (k === 'j' && !mod && ink.count()) ink.combine();
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
    _strokeToItem: (points, color, width) => InkManager.strokeToItem(points, color, width),
    pinInkAsItems: () => { if (Breakout._getZone()) InkSel.breakout.pinAll(); },
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
            cancel: () => { Breakout.drag = null; Breakout.currentPath = []; $('bk-marquee').style.display = 'none'; Breakout.renderInk(); }
        });
        // item drags start on the item element (it stops propagation), so listen for their move/up on the window too
        const itemDrag = (e) => Breakout.drag && Breakout.drag.fromItem !== false && (Breakout.drag.mode === 'move-sel' || Breakout.drag.mode === 'resize-item') && e.pointerId === Breakout._activePointer;
        window.addEventListener('pointermove', (e) => { if (itemDrag(e)) { e.preventDefault(); Breakout._onMove(e); } }, { passive: false });
        window.addEventListener('pointerup', (e) => { if (itemDrag(e)) Breakout._onEnd(e); });
    },
    _onDown: (e) => {
        if (!Breakout._zoneId) return false;
        if (e.target.closest('.item') && ['select', 'pan'].includes(Breakout._state.tool)) return false;
        const tool = Breakout._state.tool, coords = Breakout._screenToWorld(e), v = Breakout._state.view;
        const ink = InkSel.breakout, additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const pan = (extra) => { Breakout.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, ...extra }; return true; };
        if (e.button === 1 || e.button === 2) return pan();
        if (tool === 'pan' || tool === 'select') {
            const hit = ink.hitAt(coords.x, coords.y, e.pointerType === 'touch' ? 18 : 9);
            if (hit) {
                if (additive) { ink.toggle(hit); if (!ink.has(hit)) return false; }
                else if (!ink.has(hit)) {
                    if (tool === 'pan' || e.pointerType === 'touch') return pan({ inkTap: hit });        // tap selects, drag pans
                    ink.sel = new Set([hit]); Breakout._select([], false, true);
                }
                Breakout._beginMove(e, coords); Breakout.drag.fromItem = false;      // the canvas gesture handler delivers move / up
                return true;
            }
            if (tool === 'select' && e.pointerType !== 'touch') {
                const r = $('breakout-main').getBoundingClientRect();
                Breakout.drag = { mode: 'box', sx: e.clientX - r.left, sy: e.clientY - r.top, baseItems: additive ? [...Breakout._state.sel] : [], baseInk: additive ? ink.ids() : [] };
                if (!additive) Breakout._select([]);
                return true;
            }
            return pan({ tapClear: true });
        }
        if (tool === 'draw') { Breakout.drag = { mode: 'draw' }; Breakout.currentPath = [coords]; return true; }
        if (tool === 'eraser') { Breakout.drag = { mode: 'eraser' }; return true; }
        if (tool === 'laser') { Breakout.drag = { mode: 'laser' }; return true; }
        return false;
    },
    _onMove: (e) => {
        const d = Breakout.drag; if (!d) return;
        const coords = Breakout._screenToWorld(e), v = Breakout._state.view;
        if (d.mode === 'pan') { v.x = d.vx + (e.clientX - d.sx) / v.z; v.y = d.vy + (e.clientY - d.sy) / v.z; if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true; }
        else if (d.mode === 'draw') { const last = Breakout.currentPath[Breakout.currentPath.length - 1]; if (!last || Math.hypot(coords.x - last.x, coords.y - last.y) > 0.6) Breakout.currentPath.push(coords); }
        else if (d.mode === 'move-sel') {
            if (!d.moved) { if (Math.hypot(e.clientX - d.sx0, e.clientY - d.sy0) < 5) return; d.moved = true; }
            d.dx = coords.x - d.sx; d.dy = coords.y - d.sy;
            d.items.forEach(t => { t.item.x = t.ix + d.dx; t.item.y = t.iy + d.dy; if (t.el) t.el.style.transform = `translate(${t.item.x}px,${t.item.y}px)`; });
            if (d.ink) InkSel.breakout.preview(d.dx, d.dy);
        } else if (d.mode === 'box') {
            const r = $('breakout-main').getBoundingClientRect(), m = $('bk-marquee'), zone = Breakout._getZone(); if (!zone) return;
            const x = e.clientX - r.left, y = e.clientY - r.top, l = Math.min(x, d.sx), t = Math.min(y, d.sy), w = Math.abs(x - d.sx), h = Math.abs(y - d.sy);
            Object.assign(m.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', display: 'block' });
            const wr = { x0: l / v.z - v.x, y0: t / v.z - v.y, x1: (l + w) / v.z - v.x, y1: (t + h) / v.z - v.y };
            const hitItems = (zone.subItems || []).filter(i => i.x < wr.x1 && i.x + (i.w || 180) > wr.x0 && i.y < wr.y1 && i.y + (i.h || 130) > wr.y0).map(i => i.id);
            InkSel.breakout.sel = new Set(d.baseInk.concat(InkSel.breakout.inRect(wr)));
            Breakout._select(d.baseItems.concat(hitItems), false, true);
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
        Breakout.drag = null;
        if (d.mode === 'move-sel') {
            if (d.moved && (d.dx || d.dy)) {
                if (d.ink) InkSel.breakout.translate(d.dx, d.dy);          // stores moved ink and items as one history step
                else Breakout._pushHistory();
                Breakout._scheduleThumbUpdate();
            } else if (d.ink) Breakout.renderInk();
        }
        if (d.mode === 'box') $('bk-marquee').style.display = 'none';
        if (d.mode === 'pan' && !d.moved) {
            if (d.inkTap) { InkSel.breakout.sel = new Set([d.inkTap]); Breakout._select([], false, true); }
            else if (d.tapClear) Breakout._select([]);
        }
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
        if (d.mode === 'resize-item' && (d.item.w !== d.iw || d.item.h !== d.ih)) { Breakout._pushHistory(); Breakout._scheduleThumbUpdate(); }
        Breakout.currentPath = [];
        if ($('bk-temp-ink')) $('bk-temp-ink').innerHTML = '';
    }
};

InkSel.breakout = InkSel.create({
    ink: () => { const z = Breakout._getZone(); return (z && z.subInk) || []; },
    zoom: () => Breakout._state.view.z,
    svg: () => $('breakout-ink-layer'),
    commit: (ink) => { const z = Breakout._getZone(); if (!z) return; z.subInk = ink; Breakout.renderInk(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate(); },
    changed: () => { Breakout.renderInk(); if (window.Shell) { Shell.syncTools(); Shell.onSelection(); } },
    toNotes: (images, keep) => {
        const z = Breakout._getZone(); if (!z) return [];
        const notes = images.map(InkManager.noteFromImage);
        z.subInk = keep; if (!z.subItems) z.subItems = []; z.subItems.push(...notes);
        Breakout._state.sel = new Set(notes.map(n => n.id));
        Breakout.renderItems(); Breakout.renderInk(); Breakout._pushHistory(); Breakout._scheduleThumbUpdate();
        if (window.Shell) { Shell.syncTools(); Shell.onSelection(); }
        return notes;
    }
});

/* --- TOOL + SMALL GLOBALS --- */
window.setTool = function (t) {
    if (Workspace.mode !== 'board') { Workspace.setTool(t); return; }
    State.tool = t;
    if (t !== 'select') State.multiSelect = false;
    if (t !== 'pan' && t !== 'select') InkSel.board.clear();       // a pen colour must not silently recolour selected ink
    $('viewport').className = t === 'pan' ? 'panning' : (t === 'draw' || t === 'eraser' ? 'drawing' : (t === 'laser' ? 'laser' : ''));
    if (window.Shell) Shell.syncTools();
};
window.SafeSend = function (conn, data) {
    try { if (conn && conn.open) { conn.send(JSON.stringify(data)); return true; } } catch (e) { console.warn('send failed', e); }
    return false;
};
window.Roster = function () { if (window.Shell) Shell.Panel.renderRoster(); };
window.Tab = function (n) { if (window.Shell) Shell.Panel.showTab(['students', 'activity', 'queue'][n] || 'students'); };
