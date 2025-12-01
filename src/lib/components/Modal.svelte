<script lang="ts">
  // src/lib/components/Modal.svelte
  export let show = false;
  export let title = "Modal Title";
</script>

{#if show}
<div class="modal-bg">
    <div class="modal">
        <h2 style="margin-top:0; color:var(--accent)">{title}</h2>
        <slot></slot>
    </div>
</div>
{/if}
