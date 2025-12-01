<script lang="ts">
  import { uiStore } from '../stores/uiStore';
</script>

<div id="sidebar" class:closed={!$uiStore.sidebarOpen}>
    <div style="padding:15px; border-bottom:1px solid #374151; display:flex; justify-content:space-between; align-items:flex-start; flex-shrink: 0;">
        <div style="flex:1">
            <div style="font-size:0.75rem; color:#9ca3af; font-weight:800; text-transform:uppercase; margin-bottom:6px;">Board Name</div>
            <input class="in-txt" id="board-name" value="My Board">
        </div>
        <button class="btn-s" style="width:auto; margin: 24px 0 0 10px; padding:8px 12px; height: 44px; min-height:0;" on:click={() => uiStore.toggleSidebar()}>✕</button>
    </div>
    <div class="tab-head">
        <div class="tab-btn active" on:click={() => console.log('roster')}>Roster <span id="conn-badge">0</span></div>
        <div class="tab-btn" on:click={() => console.log('activity')}>Activity</div>
    </div>
    <div id="tab-roster" class="tab-content active">
        <div id="roster" style="width: 100%;"><div style="text-align:center">Waiting for connections...</div></div>
    </div>
    <div id="tab-activity" class="tab-content">
        <div id="act-controls" style="display:none; margin-bottom:10px; width: 100%;">
            <div style="padding:10px; background:#374151; border-radius:8px; margin-bottom:10px">
                <div style="font-weight:bold; color:#60a5fa;">Active Session</div>
                <div id="act-info" style="font-size:0.8rem;"></div>
            </div>
            <button class="btn-s" style="background:#7f1d1d; color:#fecaca" on:click={() => console.log('stop activity')}>Stop Activity</button>
        </div>
        <div id="act-results" style="width: 100%;"><div style="text-align:center">Select a Zone to see activity or create an Exit Ticket.</div></div>
    </div>
    <!-- Sidebar Actions -->
    <div style="margin-top:auto; padding:15px; border-top:1px solid #374151; display:flex; flex-direction:column; gap:8px; flex-shrink: 0;">
        <button class="sub-btn" on:click={() => console.log('a11y')}>♿ Accessibility View</button>
        <button class="sub-btn" style="background:#7f1d1d; color:#fecaca" on:click={() => console.log('exit board')}>🚪 Exit Board</button>
    </div>
</div>