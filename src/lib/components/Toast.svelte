<script lang="ts">
  // src/lib/components/Toast.svelte
  import { onMount } from 'svelte';

  export let message = "Toast message";
  export let duration = 3000;

  let show = false;

  onMount(() => {
    show = true;
    setTimeout(() => {
      show = false;
    }, duration);
  });
</script>

{#if show}
<div class="toast">
    {message}
</div>
{/if}
