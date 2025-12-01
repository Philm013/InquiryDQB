<script lang="ts">
  import { uiStore } from '../stores/uiStore';
  import Drawer from './Drawer.svelte';
</script>

<Drawer open={$uiStore.activeDrawer === 'draw'}>
    <div class="tool-row">
        <div class="color-btn" style="background:#ef4444"></div>
        <div class="color-btn" style="background:#3b82f6"></div>
        <div class="color-btn" style="background:#10b981"></div>
        <div class="color-btn" style="background:#000000; border-color:#6b7280"></div>
    </div>
    <div class="tool-row">
        <input type="range" min="2" max="10" value="4" style="flex:1">
    </div>
    <div class="tool-row">
        <button class="sub-btn">🧹 Eraser</button>
        <button class="sub-btn">🔦 Laser</button>
        <button class="sub-btn">🗑️ Clear All</button>
    </div>
</Drawer>

<Drawer open={$uiStore.activeDrawer === 'add'}>
    <div class="tool-row">
        <button class="sub-btn" style="background:#fef3c7; color:#92400e">👁️ Notice</button>
        <button class="sub-btn" style="background:#bae6fd; color:#075985">❓ Wonder</button>
        <button class="sub-btn" style="background:#bbf7d0; color:#166534">💡 Idea</button>
    </div>
    <div class="tool-row">
        <button class="sub-btn">🔳 Zone</button>
        <button class="sub-btn">🏛️ CER</button>
        <button class="sub-btn">📐 Consensus</button>
    </div>
    <div class="tool-row">
        <button class="sub-btn">📊 Poll</button>
        <button class="sub-btn">📈 Graph</button>
        <button class="sub-btn">🎡 Spin</button>
    </div>
    <div class="tool-row" style="border-top:1px solid #4b5563; margin-top:5px; padding-top:5px">
            <button class="sub-btn">📄 Templates</button>
            <button class="sub-btn" style="background:#4f46e5; color:white; border-color:#6366f1">🚪 Exit Ticket</button>
    </div>
</Drawer>

<Drawer open={$uiStore.activeDrawer === 'board'}>
    <div style="width:100%; text-align:center; color:#9ca3af; font-size:0.8rem; margin-bottom:8px; font-weight:bold">BOARD CONTROLS</div>
    <div class="tool-row">
            <button class="sub-btn" id="drawer-open-notes-btn">🔓 Open Board</button>
            <button class="sub-btn">📡 Share</button>
    </div>
    <div class="tool-row">
            <button class="sub-btn">📍 Set Start View</button>
            <button class="sub-btn">⛶ Fullscreen</button>
    </div>
</Drawer>

<Drawer open={$uiStore.activeDrawer === 'arrange'}>
    <!-- Arrange tools -->
</Drawer>
