<script lang="ts">
  import { fly, scale } from 'svelte/transition'
  import Canvas from '../lib/Canvas.svelte'
  import GuessBubble from '../lib/GuessBubble.svelte'
  import Leaderboard from '../lib/Leaderboard.svelte'
  import { room } from '../lib/room.svelte'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])

  function badgeFor(id: string) {
    const c = id === turn.correctGuessId
    const f = id === turn.funniestGuessId
    return c && f ? 'both' : c ? 'correct' : f ? 'funniest' : null
  }

  const scorers = $derived(
    [turn.correctGuessId, turn.funniestGuessId]
      .map((id) => turn.guesses.find((g) => g.id === id)?.playerId)
      .filter((x): x is string => !!x),
  )

  // Staged: bubbles flip to show authors, then the intent unfurls, then the
  // points land on the board. Cause and effect, not all at once.
  let showIntent = $state(false)
  let showBoard = $state(false)
  $effect(() => {
    const a = setTimeout(() => (showIntent = true), 300 + turn.guesses.length * 90)
    const b = setTimeout(() => (showBoard = true), 900 + turn.guesses.length * 90)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  })
</script>

<div class="screen">
  <div class="top">
    <div class="shrunk">
      <Canvas strokes={room.strokes} epoch={room.strokeEpoch} />
    </div>
    <div class="by">
      <span class="face">{drawer?.avatar}</span>
      <span class="cap">by {drawer?.name}</span>
    </div>
  </div>

  <div class="list">
    {#each turn.guesses as guess, i (guess.id)}
      <GuessBubble
        {guess}
        author={guess.playerId ? (game.players[guess.playerId] ?? null) : null}
        delay={i * 90}
        badge={badgeFor(guess.id)}
      />
    {/each}
  </div>

  {#if showIntent}
    <p class="intent" in:scale={{ duration: 340, start: 0.8 }}>
      {#if turn.intent}
        It was… <strong>{turn.intent}</strong>
      {:else if turn.guesses.length === 0}
        Nobody guessed.
      {:else}
        {drawer?.name} never said what it was.
      {/if}
    </p>
  {/if}

  {#if showBoard}
    <div class="board" in:fly={{ y: 20, duration: 300 }}>
      <Leaderboard players={room.ranked} highlight={scorers} />
    </div>
  {/if}

  <div class="spacer"></div>

  {#if room.isOrganizer}
    <button class="btn primary wide" onclick={() => room.send({ type: 'advance' })}>Next</button>
  {/if}
</div>

<style>
  .top { display: grid; justify-items: center; gap: 0.4rem; }
  .shrunk { width: 42%; max-width: 175px; }
  .by { display: flex; align-items: center; gap: 0.4rem; }
  .face { font-size: 1.2rem; }
  .cap { font-weight: 800; color: var(--ink-soft); }
  .list { display: grid; gap: 0.5rem; }
  .intent { margin: 0; text-align: center; font-size: 1.15rem; font-weight: 700; }
  .intent strong { font-weight: 900; }
  .spacer { flex: 1; }
</style>
