<script lang="ts">
  import { fly } from 'svelte/transition'
  import Burst from '../lib/Burst.svelte'
  import Leaderboard from '../lib/Leaderboard.svelte'
  import TurnCard from '../lib/TurnCard.svelte'
  import { room } from '../lib/room.svelte'
  import { router } from '../lib/router.svelte'

  const game = $derived(room.game!)
  const winner = $derived(room.ranked[0])
  const played = $derived(game.turns.filter((t) => !t.skipped).length)
</script>

<div class="screen">
  <header in:fly={{ y: -16, duration: 320 }}>
    <div class="crown">
      <Burst count={30} />
      <span class="face">{winner?.avatar ?? '🐘'}</span>
    </div>
    <h1>{winner ? `${winner.name} wins` : 'Game over'}</h1>
    <p class="sub">{played} drawing{played === 1 ? '' : 's'} over {game.round} round{game.round === 1 ? '' : 's'}</p>
  </header>

  <Leaderboard players={room.ranked} />

  {#if game.turns.length}
    <h2 class="gallery-title">The gallery</h2>
    <div class="gallery">
      {#each game.turns as turn, i (i)}
        <div in:fly={{ y: 24, duration: 300, delay: i * 60 }}>
          <TurnCard {turn} index={i} />
        </div>
      {/each}
    </div>
  {/if}

  <button class="btn primary wide" onclick={() => { room.leave(); router.go('/') }}>
    New game
  </button>
</div>

<style>
  header { text-align: center; display: grid; justify-items: center; gap: 0.2rem; }
  .crown { position: relative; display: grid; place-items: center; }
  .face { font-size: 4rem; animation: rock 2.4s ease-in-out infinite; }
  .sub { margin: 0; font-weight: 800; color: var(--ink-soft); }
  .gallery-title { text-align: center; margin-top: 0.6rem; }
  /* Equal rows so tiles with longer captions do not leave holes. */
  .gallery { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; grid-auto-rows: 1fr; }
  .gallery > :global(*) { height: 100%; }
  .gallery :global(figure.turn) { height: 100%; align-content: start; }
  @keyframes rock {
    0%, 100% { transform: rotate(-7deg) scale(1); }
    50% { transform: rotate(7deg) scale(1.06); }
  }
</style>
