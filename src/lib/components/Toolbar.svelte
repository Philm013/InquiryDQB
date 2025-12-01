<script lang="ts">
  import { uiStore } from '../stores/uiStore';
</script>

<!-- DESKTOP TOOLBAR -->
<div id="desktop-toolbar">
    <button class="tb-btn" on:click={() => uiStore.toggleSidebar()}>☰ Menu</button>
    <div class="sep"></div>
    <button class="tb-btn" class:active={$uiStore.tool === 'pan'} on:click={() => uiStore.setTool('pan')}>✋ Pan</button>
    <button class="tb-btn" class:active={$uiStore.tool === 'select'} on:click={() => uiStore.setTool('select')}>⛝ Select</button>
    <button class="tb-btn" class:active={$uiStore.tool === 'draw'} on:click={() => uiStore.toggleDrawer('draw')}>✏️ Draw</button>
    <div class="sep"></div>
    <button class="tb-btn" on:click={() => uiStore.toggleDrawer('board')}>⚙️ Board</button>
    <button class="tb-btn" on:click={() => uiStore.toggleDrawer('add')}>➕ Add</button>
    <button class="tb-btn" id="btn-arrange" style="display:none" on:click={() => uiStore.toggleDrawer('arrange')}>📏 Arrange</button>
    <div class="sep"></div>
    <button class="tb-btn" on:click={() => console.log('undo')}>↩️</button>
    <button class="tb-btn" on:click={() => console.log('redo')}>↪️</button>
</div>

<!-- MOBILE DOCK -->
<div id="mobile-dock">
    <button class="dock-btn" on:click={() => uiStore.toggleSidebar()}>☰</button>
    <div class="sep-mobile"></div>
    <button class="dock-btn" class:active={$uiStore.tool === 'pan'} on:click={() => uiStore.setTool('pan')}>✋</button>
    <button class="dock-btn" class:active={$uiStore.tool === 'select'} on:click={() => uiStore.setTool('select')}>⛝</button>
    <button class="dock-btn" on:click={() => uiStore.toggleDrawer('draw')}>✏️</button>
    <button class="dock-btn" on:click={() => uiStore.toggleDrawer('add')}>➕</button>
    <button class="dock-btn" id="mt-arrange" style="display:none" on:click={() => uiStore.toggleDrawer('arrange')}>📏</button>
    <button class="dock-btn" on:click={() => uiStore.toggleDrawer('board')}>⚙️</button>
    <div class="sep-mobile"></div>
    <button class="dock-btn" on:click={() => console.log('undo')}>↩️</button>
    <button class="dock-btn" on:click={() => console.log('redo')}>↪️</button>
</div>