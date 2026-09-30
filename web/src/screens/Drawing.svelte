<script lang="ts">
  import { fly, scale } from 'svelte/transition'
  import { earliestEndAt } from '$shared/game/machine'
  import type { Stroke } from '$shared/room/protocol'
  import Answered from '../lib/Answered.svelte'
  import Canvas from '../lib/Canvas.svelte'
  import Timer from '../lib/Timer.svelte'
  import { clock } from '../lib/clock.svelte'
  import { room } from '../lib/room.svelte'
  import { accentOf } from '../lib/avatars'
  import { t } from '../lib/i18n.svelte'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])
  const myGuess = $derived(turn.guesses.find((g) => g.playerId === game.you) ?? null)

  const COLORS = ['#1a1523', '#ff3d71', '#2bb3ff', '#2bd97c', '#ffc93c', '#a855f7']
  const WIDTHS = [0.008, 0.022, 0.055]

  let color = $state(COLORS[0]!)
  let width = $state(WIDTHS[1]!)
  let guess = $state('')

  /**
   * Everyone else needs a fair look before the drawer can call it, so "Done"
   * stays locked for the first `minDrawingMs` and counts down. The clock is
   * server-corrected, so the button unlocks when the server would agree.
   */
  const lockedFor = $derived(Math.max(0, earliestEndAt(game) - clock.now))
  const canFinish = $derived(lockedFor === 0)

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

  /*
   * Text input has to survive an IME. Typing Chinese, Japanese or Korean
   * means composing several keystrokes into each character, and the Enter
   * that picks a candidate is the same Enter that would submit this form —
   * which would send half-finished pinyin as somebody's guess.
   *
   * The keystroke is where the two are told apart, because that is the only
   * place they differ: a commit Enter carries `isComposing`, so it is
   * stopped before it can submit anything. By the time a submit does arrive
   * it is either that same Enter after the composition closed, or a tap on
   * the button — which blurred the field first, committing the composition.
   * Neither is ever refused: swallowing a tap loses a guess silently.
   */
  let guessEl = $state<HTMLInputElement | null>(null)
  let composing = $state(false)

  function onGuessKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.isComposing || composing)) e.preventDefault()
  }

  function submitGuess(e: SubmitEvent) {
    e.preventDefault()
    // The element, not the binding: it holds the committed characters.
    const text = (guessEl?.value ?? guess).trim()
    if (!text) return
    room.send({ type: 'submit_guess', text })
    // The card below becomes the record; the field goes back to inviting a change.
    guess = ''
  }

  function finish() {
    room.send({ type: 'end_drawing' })
  }
</script>

<div class="screen">
  <header>
    <div class="who">
      <span class="face" style="background: {accentOf(turn.drawerId)}">{drawer?.avatar}</span>
      <div>
        <strong>{room.isDrawer ? t.s.youAreDrawing : t.s.isDrawing(drawer?.name ?? '')}</strong>
        {#if room.isDrawer && turn.intent}
          <!-- Their own note, fixed before the clock started. Nobody else sees it. -->
          <p class="sub note">“{turn.intent}”</p>
        {/if}
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

  <!-- Who has answered. The drawer reads it to know when to stop. -->
  <Answered />

  {#if room.isDrawer}
    <div class="tools" in:fly={{ y: 16, duration: 240 }}>
      <div class="swatches">
        {#each COLORS as c (c)}
          <button
            class="swatch"
            class:on={c === color}
            style="background: {c}"
            aria-label={t.s.colour(c)}
            onclick={() => (color = c)}
          ></button>
        {/each}
      </div>
      <div class="sizes">
        {#each WIDTHS as w (w)}
          <button class="size" class:on={w === width} aria-label={t.s.brushSize} onclick={() => (width = w)}>
            <span style="width: {6 + w * 260}px; height: {6 + w * 260}px"></span>
          </button>
        {/each}
        <button class="size wipe" onclick={clearCanvas} aria-label={t.s.clearCanvas}>✕</button>
      </div>
    </div>

    <button
      class="btn primary wide"
      disabled={!canFinish}
      onclick={finish}
    >
      {canFinish ? t.s.doneDrawing : t.s.doneIn(Math.ceil(lockedFor / 1000))}
    </button>
  {:else}
    <form class="guessbar" onsubmit={submitGuess}>
      <input
        class="field"
        bind:this={guessEl}
        bind:value={guess}
        placeholder={myGuess ? t.s.changeGuessPlaceholder : t.s.whatIsIt}
        maxlength="100"
        aria-label={t.s.yourGuess}
        onkeydown={onGuessKey}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
      />
      <button class="btn primary" disabled={!guess.trim()}>{myGuess ? t.s.changeBtn : t.s.guessBtn}</button>
    </form>

    {#if myGuess}
      <div class="mine" in:scale={{ duration: 260, start: 0.85 }}>
        <span class="tag">{t.s.yourGuess}</span>
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
  .note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
