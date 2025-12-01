<script lang="ts">
  // src/lib/components/ContextMenu.svelte
  export let x = 0;
  export let y = 0;
  export let show = false;
</script>

{#if show}
<div id="context-menu" style="left: {x}px; top: {y}px;">
    <!-- Context menu content will be dynamic -->
</div>
{/if}
