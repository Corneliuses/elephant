<script lang="ts">
  import { fly, scale } from 'svelte/transition'
  import type { Stroke } from '$shared/room/protocol'
  import Canvas from '../lib/Canvas.svelte'
  import Timer from '../lib/Timer.svelte'
  import { room } from '../lib/room.svelte'
  import { accentOf } from '../lib/avatars'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])
  const myGuess = $derived(turn.guesses.find((g) => g.playerId === game.you) ?? null)

  const COLORS = ['#1a1523', '#ff3d71', '#2bb3ff', '#2bd97c', '#ffc93c', '#a855f7']
  const WIDTHS = [0.008, 0.022, 0.055]

  let color = $state(COLORS[0]!)
  let width = $state(WIDTHS[1]!)
  let intent = $state('')
  /** The grader needs this, so finishing is gated on it. */
  const canFinish = $derived(intent.trim().length > 0)
  let guess = $state('')

  // Network sends are batched; local painting is not. The drawer sees ink in
  // the same frame they made it, while the wire carries ~20 batches a second.
  let outbox: Stroke[] = []
  let flushTimer: ReturnType<typeof setInterval> | null = null

  $effect(() => {
    if (!room.isDrawer) return
    flushTimer = setInterval(() => {
      if (outbox.length === 0) return
      room.send({ type: 'stroke', strokes: outbox })
      outbox = []
    }, 50)
    return () => {
      if (flushTimer) clearInterval(flushTimer)
      flushTimer = null
    }
  })

  function onstrokes(batch: Stroke[]) {
    // The server never echoes our own strokes back, so paint them locally.
    room.strokes.push(...batch)
    outbox.push(...batch)
  }

  function clearCanvas() {
    onstrokes([{ t: 'clear' }])
  }

  function submitGuess(e: SubmitEvent) {
    e.preventDefault()
    const text = guess.trim()
    if (!text) return
    room.send({ type: 'submit_guess', text })
    // The card below becomes the record; the field goes back to inviting a change.
    guess = ''
  }

  let intentTimer: ReturnType<typeof setTimeout> | null = null
  function onIntent() {
    if (intentTimer) clearTimeout(intentTimer)
    intentTimer = setTimeout(() => room.send({ type: 'set_intent', text: intent }), 400)
  }

  /**
   * Flush the debounced note before finishing. The button unlocks on local
   * state, so a fast tap would otherwise reach the server before the intent
   * does and be rejected.
   */
  function finish() {
    if (intentTimer) {
      clearTimeout(intentTimer)
      intentTimer = null
    }
    room.send({ type: 'set_intent', text: intent })
    room.send({ type: 'end_drawing' })
  }

  $effect(() => {
    // Adopt whatever the server already has, e.g. after a reconnect.
    if (turn.intent && !intent) intent = turn.intent
  })
</script>

<div class="screen">
  <header>
    <div class="who">
      <span class="face" style="background: {accentOf(turn.drawerId)}">{drawer?.avatar}</span>
      <div>
        <strong>{room.isDrawer ? 'You are drawing' : `${drawer?.name} is drawing`}</strong>
        <p class="sub">
          {#if turn.guesses.length > 0}
            <!-- The drawer wants this too: it is how they decide when to stop. -->
            {turn.guesses.length} guess{turn.guesses.length === 1 ? '' : 'es'} in
          {:else if room.isDrawer}
            Draw anything. They guess.
          {:else}
            No guesses yet
          {/if}
        </p>
      </div>
    </div>
    {#if game.timerEndsAt}
      <Timer endsAt={game.timerEndsAt} total={game.config.drawingMs} />
    {/if}
  </header>

  <Canvas
    strokes={room.strokes}
    epoch={room.strokeEpoch}
    drawable={room.isDrawer}
    {color}
    {width}
    {onstrokes}
  />

  {#if room.isDrawer}
    <div class="tools" in:fly={{ y: 16, duration: 240 }}>
      <div class="swatches">
        {#each COLORS as c (c)}
          <button
            class="swatch"
            class:on={c === color}
            style="background: {c}"
            aria-label="Colour {c}"
            onclick={() => (color = c)}
          ></button>
        {/each}
      </div>
      <div class="sizes">
        {#each WIDTHS as w (w)}
          <button class="size" class:on={w === width} aria-label="Brush size" onclick={() => (width = w)}>
            <span style="width: {6 + w * 260}px; height: {6 + w * 260}px"></span>
          </button>
        {/each}
        <button class="size wipe" onclick={clearCanvas} aria-label="Clear the canvas">✕</button>
      </div>
    </div>

    <input
      class="field"
      class:needed={!canFinish}
      bind:value={intent}
      oninput={onIntent}
      placeholder="What is it? (needed, and only you see it)"
      maxlength="100"
      aria-label="What you are drawing"
    />

    <button
      class="btn primary wide"
      disabled={!canFinish}
      onclick={finish}
    >
      {canFinish ? 'Done drawing' : 'Say what it is first'}
    </button>
  {:else}
    <form class="guessbar" onsubmit={submitGuess}>
      <input
        class="field"
        bind:value={guess}
        placeholder={myGuess ? 'Change your guess…' : 'What is it?'}
        maxlength="100"
        aria-label="Your guess"
      />
      <button class="btn primary" disabled={!guess.trim()}>{myGuess ? 'Change' : 'Guess'}</button>
    </form>

    {#if myGuess}
      <div class="mine" in:scale={{ duration: 260, start: 0.85 }}>
        <span class="tag">Your guess</span>
        <strong>{myGuess.text}</strong>
      </div>
    {/if}
  {/if}
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
  .sub { margin: 0.1rem 0 0; font-size: 0.85rem; font-weight: 700; color: var(--ink-soft); }

  /* Wraps to two rows on narrow phones rather than running off the edge. */
  .tools {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem 0.9rem;
    flex-wrap: wrap;
  }
  .swatches, .sizes { display: flex; gap: 0.4rem; }
  .swatch {
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    border: var(--border);
    border-radius: 50%;
    cursor: pointer;
    transition: transform var(--fast) var(--spring);
  }
  .swatch.on { transform: scale(1.25); }
  .swatch:active { transform: scale(0.9); }
  .size {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    border: var(--border);
    border-radius: var(--r-sm);
    background: var(--card);
    cursor: pointer;
    transition: transform var(--fast) var(--spring), background var(--fast) var(--out);
  }
  .size span { display: block; border-radius: 50%; background: var(--ink); }
  .size.on { background: var(--sun); transform: scale(1.1); }
  .size:active { transform: scale(0.9); }
  .wipe { font-weight: 900; }

  .field.needed { border-color: var(--hot); }
  .guessbar { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; }
  .mine {
    display: grid;
    gap: 0.15rem;
    padding: 0.7rem 1rem;
    border: var(--border);
    border-radius: var(--r);
    background: var(--sun);
    box-shadow: var(--lift);
  }
  .tag { font-size: 0.7rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
</style>
