<script lang="ts">
  // src/lib/components/Landing.svelte
</script>

<div id="landing">
    <div class="land-card">
        <h1 style="color:var(--accent); margin:0 0 10px 0; font-size:2.5rem">InquiryDQB</h1>
        <p style="color:#64748b; margin-bottom:30px">Teacher Console</p>
        <button class="btn-p" on:click={() => console.log('create board')}>+ New Board</button>
        <button class="btn-s" style="background:#e0e7ff; color:#4338ca" on:click={() => console.log('join')}>🤝 Join as Co-Host</button>
        <div id="saved-list" style="text-align: left; max-height: 300px; overflow-y: auto; margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 12px;"></div>
        <button class="btn-s" on:click={() => console.log('import')}>Import JSON</button>
    </div>
</div>
