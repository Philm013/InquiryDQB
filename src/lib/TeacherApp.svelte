<script lang="ts">
  import '../app.css';
  import Sidebar from './components/Sidebar.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import Minimap from './components/Minimap.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import Item from './components/Item.svelte';
  import Drawers from './components/Drawers.svelte';
  import { boardStore } from './stores/boardStore';
  import { uiStore } from './stores/uiStore';

  const items = boardStore.items;

  // Example of how to add an item
  function addExampleItem() {
    boardStore.addItem({
      id: Math.random().toString(),
      type: 'note',
      text: 'New item',
      x: 200,
      y: 200,
      w: 200,
      h: 150,
      icon: '💡',
      author: 'Teacher'
    });
  }
</script>

<div id="app">
    <Sidebar />
    <div id="viewport">
        <div id="bg-grid"></div>
        <div id="world" style="transform: translate({$boardStore.view.x}px, {$boardStore.view.y}px) scale({$boardStore.view.z})">
            <svg id="ink-layer"></svg>
            <div id="items-layer">
                {#each $boardStore.items as item}
                    <Item {item} />
                {/each}
            </div>
            <div id="ghost-layer"></div>
        </div>
        <div id="marquee"></div>
        <Minimap />
    </div>
    <Toolbar />
    <Drawers />
    <ContextMenu />

    <!-- Example button to test the store -->
    <button style="position: absolute; top: 10px; right: 10px; z-index: 9999;" on:click={addExampleItem}>Add Item</button>
</div>