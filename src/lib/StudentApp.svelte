<script lang="ts">
  // src/lib/StudentApp.svelte
  import '../app.css'; // Re-use teacher css for now
  import { onMount } from 'svelte';

  let currentScreen = 'setup';

  onMount(() => {
    // Logic to handle screen changes will go here
  });

</script>

<div id="app">
    {#if currentScreen === 'setup'}
        <!-- Setup Screen Content -->
        <div id="scr-setup" class="screen active">
            <div class="card" style="max-width: 400px; width: 90%;">
                <div class="hero-title">InquiryDQB</div>
                <div class="hero-sub">Student Companion</div>
                
                <div style="text-align:left; width:100%; margin-bottom:8px; font-weight:700; color:#64748b; font-size:0.9rem">CHOOSE AVATAR</div>
                <div class="av-grid" id="av-grid"></div>
                
                <div style="text-align:left; width:100%; margin-bottom:8px; font-weight:700; color:#64748b; font-size:0.9rem">YOUR NAME</div>
                <input id="inp-name" placeholder="Enter your name" style="text-align:center; font-weight:bold">
                
                <button class="btn" on:click={() => currentScreen = 'join'}>Next ➔</button>
            </div>
        </div>
    {:else if currentScreen === 'join'}
        <!-- Join Screen Content -->
        <div id="scr-join" class="screen active">
            <div class="card">
                <h2>Join Class</h2>
                <div id="reader" style="border-radius:12px; overflow:hidden; margin-bottom:16px; width:100%"></div>
                <button class="btn" id="btn-scan">📸 Scan QR Code</button>
                <div style="margin: 10px 0; color: #94a3b8">- OR -</div>
                <input id="inp-id" placeholder="Enter Session ID" style="text-align:center; text-transform:uppercase; letter-spacing: 2px;">
                <button class="btn btn-s" on:click={() => currentScreen = 'lobby'}>Connect Manually</button>
            </div>
        </div>
    {:else if currentScreen === 'lobby'}
        <!-- Lobby Screen Content -->
        <div id="scr-lobby" class="screen active">
            <div class="lobby-header">
                <div class="user-badge">
                    <span id="my-av"></span>
                    <span id="my-name"></span>
                </div>
                <div style="display:flex; gap:8px; align-items:center">
                    <div id="status-badge" class="status-pill">Connecting...</div>
                    <button class="btn-icon">✕</button>
                </div>
            </div>
        </div>
    {/if}
</div>