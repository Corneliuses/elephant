<script lang="ts">
  import { fly } from 'svelte/transition'
  import Burst from '../lib/Burst.svelte'
  import Canvas from '../lib/Canvas.svelte'
  import GuessBubble from '../lib/GuessBubble.svelte'
  import Timer from '../lib/Timer.svelte'
  import { room } from '../lib/room.svelte'
  import { accentOf } from '../lib/avatars'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])
  const only = $derived(turn.guesses.length === 1)

  // Two taps, not a dual-select: "which is right?" then "which is funniest?".
  let correctId = $state<string | null>(null)
  let step = $state<'correct' | 'funniest' | 'sent'>('correct')
  let bursting = $state(false)

  function pickCorrect(id: string | null) {
    correctId = id
    step = 'funniest'
  }

  function pickFunniest(id: string) {
    step = 'sent'
    bursting = true
    room.send({ type: 'judge', correctGuessId: correctId, funniestGuessId: id })
  }
</script>

<div class="screen">
  <header>
    <div class="who">
      <span class="face" style="background: {accentOf(turn.drawerId)}">{drawer?.avatar}</span>
      <strong>{room.isDrawer ? 'Your call' : `${drawer?.name} is choosing`}</strong>
    </div>
    {#if game.timerEndsAt}
      <Timer endsAt={game.timerEndsAt} total={game.config.judgingMs} />
    {/if}
  </header>

  <!-- The drawing shrinks to a card; the answers become the subject. -->
  <div class="shrunk">
    <Canvas strokes={room.strokes} epoch={room.strokeEpoch} />
  </div>

  {#if room.isDrawer}
    <div class="prompt" in:fly={{ y: -10, duration: 220 }}>
      {#if step === 'correct'}
        <h2>Who got it right?</h2>
      {:else if step === 'funniest'}
        <h2>Which one is funniest?</h2>
      {:else}
        <h2>Nice.</h2>
      {/if}
    </div>
  {:else}
    <p class="waiting">Sit tight…</p>
  {/if}

  <div class="list">
    {#each turn.guesses as guess, i (guess.id)}
      <GuessBubble
        {guess}
        mine={guess.playerId === game.you}
        delay={i * 70}
        badge={guess.id === correctId ? 'correct' : null}
        disabled={step === 'funniest' && guess.id === correctId && !only}
        onpick={room.isDrawer && step !== 'sent'
          ? () => (step === 'correct' ? pickCorrect(guess.id) : pickFunniest(guess.id))
          : undefined}
      />
    {/each}
  </div>

  {#if room.isDrawer && step === 'correct'}
    <button class="btn ghost wide" onclick={() => pickCorrect(null)}>Nobody got it</button>
  {/if}

  {#if bursting}<Burst />{/if}
</div>

<style>
  header { display: flex; align-items: center; gap: 0.8rem; }
  .who { display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 0; }
  .face {
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    border: var(--border);
    border-radius: 50%;
    font-size: 1.3rem;
    flex: none;
  }
  /* Keep the drawing visible but subordinate. */
  .shrunk { width: 45%; max-width: 190px; margin: 0 auto; }
  .prompt { text-align: center; }
  .waiting { margin: 0; text-align: center; font-weight: 800; color: var(--ink-soft); }
  .list { display: grid; gap: 0.5rem; overflow-y: auto; }
</style>
