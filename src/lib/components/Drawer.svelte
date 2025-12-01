<script lang="ts">
  // src/lib/components/Drawer.svelte
  export let open = false;
</script>

{#if open}
<div class="drawer open">
    <slot></slot>
</div>
{/if}
