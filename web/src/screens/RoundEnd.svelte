<script lang="ts">
  import { fly } from 'svelte/transition'
  import Leaderboard from '../lib/Leaderboard.svelte'
  import { room } from '../lib/room.svelte'
  import { t } from '../lib/i18n.svelte'

  const game = $derived(room.game!)
  const leader = $derived(room.ranked[0])
  const enough = $derived(room.players.filter((p) => p.ready && p.connected).length >= game.config.minPlayers)
</script>

<div class="screen">
  <header in:fly={{ y: -14, duration: 300 }}>
    <p class="kicker">{t.s.roundDone(game.round)}</p>
    {#if leader && leader.score > 0}
      <div class="winner">
        <span class="face">{leader.avatar}</span>
        <h1>{t.s.leads(leader.name)}</h1>
      </div>
    {:else}
      <h1>{t.s.nobodyScored}</h1>
    {/if}
  </header>

  <Leaderboard players={room.ranked} />

  <div class="spacer"></div>

  {#if room.isOrganizer}
    <button class="btn primary wide" disabled={!enough} onclick={() => room.send({ type: 'next_round' })}>
      {t.s.anotherRound}
    </button>
    <button class="btn ghost wide" onclick={() => room.send({ type: 'end_game' })}>{t.s.endTheGame}</button>
    {#if !enough}
      <p class="note">{t.s.needReadyPlayers(game.config.minPlayers)}</p>
    {/if}
  {:else}
    <p class="note">{t.s.waitingOrganizer}</p>
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
