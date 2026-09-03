<script lang="ts">
  import { room } from './lib/room.svelte'
  import { router } from './lib/router.svelte'
  import Home from './screens/Home.svelte'
  import Join from './screens/Join.svelte'
  import Lobby from './screens/Lobby.svelte'
  import Toast from './lib/Toast.svelte'

  // Runs whenever router.code changes — Svelte tracks the read, so there is
  // no dependency array to keep in sync.
  $effect(() => {
    const code = router.code
    if (code) room.connect(code)
    else room.disconnect()
  })
</script>

<Toast />

{#if !router.code}
  <Home />
{:else if room.status === 'gone'}
  <div class="screen center">
    <h1>This room is gone</h1>
    <p>Rooms disappear once everyone has left.</p>
    <button class="btn primary" onclick={() => router.go('/')}>Start a new one</button>
  </div>
{:else if room.needsJoin}
  <Join />
{:else if !room.game}
  <div class="screen center">
    <div class="pulse">🐘</div>
    <p>{room.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>
  </div>
{:else if room.game.phase === 'lobby'}
  <Lobby />
{:else}
  <div class="screen center">
    <h1>{room.game.phase}</h1>
    <p>This screen is next.</p>
  </div>
{/if}

<style>
  .center {
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .pulse {
    font-size: 4rem;
    animation: breathe 1.6s ease-in-out infinite;
  }
  /* Idle is alive: waiting states always have a low-amplitude loop. */
  @keyframes breathe {
    0%, 100% { transform: scale(1) rotate(-3deg); }
    50% { transform: scale(1.12) rotate(3deg); }
  }
</style>
