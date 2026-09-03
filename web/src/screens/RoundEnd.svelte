<script lang="ts">
  import { fly } from 'svelte/transition'
  import Leaderboard from '../lib/Leaderboard.svelte'
  import { room } from '../lib/room.svelte'

  const game = $derived(room.game!)
  const leader = $derived(room.ranked[0])
  const enough = $derived(room.players.filter((p) => p.ready && p.connected).length >= game.config.minPlayers)
</script>

<div class="screen">
  <header in:fly={{ y: -14, duration: 300 }}>
    <p class="kicker">Round {game.round} done</p>
    {#if leader && leader.score > 0}
      <div class="winner">
        <span class="face">{leader.avatar}</span>
        <h1>{leader.name} leads</h1>
      </div>
    {:else}
      <h1>Nobody scored</h1>
    {/if}
  </header>

  <Leaderboard players={room.ranked} />

  <div class="spacer"></div>

  {#if room.isOrganizer}
    <button class="btn primary wide" disabled={!enough} onclick={() => room.send({ type: 'next_round' })}>
      Another round
    </button>
    <button class="btn ghost wide" onclick={() => room.send({ type: 'end_game' })}>End the game</button>
    {#if !enough}
      <p class="note">Need {game.config.minPlayers} ready players for another round.</p>
    {/if}
  {:else}
    <p class="note">Waiting for the organizer…</p>
  {/if}
</div>

<style>
  header { text-align: center; }
  .kicker { margin: 0; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-soft); font-size: 0.8rem; }
  .winner { display: grid; justify-items: center; gap: 0.2rem; }
  .face { font-size: 3.5rem; animation: rock 2.4s ease-in-out infinite; }
  .spacer { flex: 1; }
  .note { margin: 0; text-align: center; font-weight: 800; color: var(--ink-soft); }
  @keyframes rock {
    0%, 100% { transform: rotate(-7deg) scale(1); }
    50% { transform: rotate(7deg) scale(1.06); }
  }
</style>
