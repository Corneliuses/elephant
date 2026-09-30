<script lang="ts">
  /*
   * The turn opens here: the drawer says what they will draw, privately,
   * and the drawing clock starts only when they tap Start. Everyone else
   * waits. The note is the thing every guess is graded against, so it is
   * settled before anyone has seen a line.
   */
  import { fly, scale } from 'svelte/transition'
  import { clean } from '$shared/game/machine'
  import Timer from '../lib/Timer.svelte'
  import { room } from '../lib/room.svelte'
  import { accentOf } from '../lib/avatars'
  import { t } from '../lib/i18n.svelte'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])

  let intent = $state('')
  // The reducer's own test for "something was typed": a note of nothing
  // but invisible characters must not unlock a Start the server refuses.
  const canStart = $derived(clean(intent).length > 0)

  /*
   * The same IME guard as the guess bar (see Drawing.svelte): the Enter that
   * picks a Chinese candidate must not be the Enter that starts the clock.
   */
  let intentEl = $state<HTMLInputElement | null>(null)
  let composing = $state(false)

  function onIntentKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.isComposing || composing)) e.preventDefault()
  }

  let intentTimer: ReturnType<typeof setTimeout> | null = null
  function onIntent() {
    if (intentTimer) clearTimeout(intentTimer)
    intentTimer = setTimeout(() => room.send({ type: 'set_intent', text: intent }), 400)
  }

  /**
   * Flush the debounced note before starting. The button unlocks on local
   * state, so a fast tap would otherwise reach the server before the note
   * does and be refused.
   */
  function start(e: SubmitEvent) {
    e.preventDefault()
    if (intentTimer) {
      clearTimeout(intentTimer)
      intentTimer = null
    }
    // The element, not the binding: a tap blurred the field, which committed
    // any open composition, and the element holds the finished characters.
    const text = clean(intentEl?.value ?? intent)
    if (!text) return
    room.send({ type: 'set_intent', text })
    room.send({ type: 'start_drawing' })
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
      <strong>{room.isDrawer ? t.s.yourTurn : t.s.isDeciding(drawer?.name ?? '')}</strong>
    </div>
    {#if game.timerEndsAt}
      <Timer endsAt={game.timerEndsAt} total={game.config.prepMs} />
    {/if}
  </header>

  {#if room.isDrawer}
    <form class="prep" onsubmit={start} in:fly={{ y: 16, duration: 260 }}>
      <h1>{t.s.whatWillYouDraw}</h1>
      <p class="hint">{t.s.drawAnything} {t.s.prepHint}</p>
      <input
        class="field"
        class:needed={!canStart}
        bind:this={intentEl}
        bind:value={intent}
        oninput={onIntent}
        onkeydown={onIntentKey}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
        placeholder={t.s.intentPlaceholder}
        maxlength="100"
        aria-label={t.s.intentLabel}
      />
      <button class="btn primary wide" disabled={!canStart}>
        {canStart ? t.s.startDrawing : t.s.sayWhatFirst}
      </button>
    </form>
  {:else}
    <div class="waiting" in:scale={{ duration: 300, start: 0.8 }}>
      <span class="big" style="background: {accentOf(turn.drawerId)}">{drawer?.avatar}</span>
      <p>{t.s.sitTight}</p>
    </div>
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

  .prep { display: grid; gap: 0.8rem; margin-top: 1rem; }
  .hint { margin: 0; font-weight: 700; color: var(--ink-soft); }
  .field.needed { border-color: var(--hot); }

  /* Idle is alive: the drawer's avatar thinks out loud while everyone waits. */
  .waiting {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.8rem;
    text-align: center;
  }
  .waiting p { margin: 0; font-weight: 800; color: var(--ink-soft); }
  .big {
    display: grid;
    place-items: center;
    width: 6rem;
    height: 6rem;
    border: var(--border);
    border-radius: 50%;
    font-size: 3.2rem;
    box-shadow: var(--lift-lg);
    animation: think 1.8s ease-in-out infinite;
  }
  @keyframes think {
    0%, 100% { transform: rotate(-4deg) scale(1); }
    50% { transform: rotate(4deg) scale(1.06); }
  }
</style>
