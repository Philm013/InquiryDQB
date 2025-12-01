<script lang="ts">
  // src/lib/components/Item.svelte
  export let item: any;
</script>

<div class="item {item.type}" style="transform: translate({item.x}px, {item.y}px); width: {item.w}px; height: {item.h}px;">
    <div class="jiggle-wrapper">
        <div class="i-head">
            <div>
                <span class="icon-span">{item.icon}</span>
                <span class="auth-span">{item.author}</span>
            </div>
            <div class="menu-trigger" on:click={() => console.log('context menu')}>⋮</div>
        </div>
        <div class="i-body">
            {#if item.type === 'note'}
                <textarea class="note-in" placeholder="Empty note..." value={item.text}></textarea>
            {/if}
        </div>
        <div class="resize-h"></div>
    </div>
</div>
