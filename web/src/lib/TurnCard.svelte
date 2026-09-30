<script lang="ts">
  import type { ProjectedTurn } from '$shared/game/types'
  import type { Stroke } from '$shared/room/protocol'
  import Canvas from './Canvas.svelte'
  import { room } from './room.svelte'
  import { t } from './i18n.svelte'

  let { turn, index }: { turn: ProjectedTurn; index: number } = $props()

  const game = $derived(room.game!)
  const drawer = $derived(game.players[turn.drawerId])
  const correct = $derived(turn.guesses.find((g) => g.id === turn.correctGuessId) ?? null)
  const favorite = $derived(turn.guesses.find((g) => g.id === turn.favoriteGuessId) ?? null)
  // In the viewer's language, with what was typed beneath when it differs,
  // the same as the reveal showed it.
  const note = $derived(turn.intent ? t.read(turn.intent, turn.intentTranslations) : null)
  const correctText = $derived(correct ? t.read(correct.text, correct.translations) : null)
  const favoriteText = $derived(favorite ? t.read(favorite.text, favorite.translations) : null)

  let strokes = $state<Stroke[]>([])
  let loaded = false

  $effect(() => {
    // A completed turn's drawing never changes, so fetch it once. Without the
    // guard this re-runs on every state message, since it reads game.code.
    if (loaded) return
    loaded = true
    let live = true
    fetch(`/api/rooms/${game.code}/turns/${index}/strokes`)
      .then((r) => (r.ok ? (r.json() as Promise<Stroke[]>) : []))
      .then((s) => {
        if (live) strokes = s
      })
      .catch(() => {})
    return () => {
      live = false
    }
  })
</script>

<figure class="card turn">
  {#if turn.skipped}
    <div class="skipped">{t.s.skipped}</div>
  {:else}
    <Canvas {strokes} epoch={index} />
  {/if}
  <figcaption>
    <span class="by">{drawer?.avatar} {drawer?.name}</span>
    {#if note}
      <em class="was">“{note.text}”{#if note.original}<span class="orig">{note.original}</span>{/if}</em>
    {/if}
    {#if correctText}
      <span class="line"><span class="pip ok">✓</span><span>{correctText.text}{#if correctText.original}<span class="orig">{correctText.original}</span>{/if}</span></span>
    {/if}
    {#if favoriteText}
      <span class="line"><span class="pip fun">★</span><span>{favoriteText.text}{#if favoriteText.original}<span class="orig">{favoriteText.original}</span>{/if}</span></span>
    {/if}
  </figcaption>
</figure>

<style>
  .turn { margin: 0; padding: 0.6rem; display: grid; gap: 0.5rem; }
  .skipped {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 3px dashed var(--ink-soft);
    border-radius: var(--r);
    color: var(--ink-soft);
    font-weight: 900;
  }
  figcaption { display: grid; gap: 0.2rem; font-size: 0.85rem; font-weight: 700; }
  .by { font-weight: 900; }
  .was { color: var(--ink-soft); }
  .orig { display: block; font-size: 0.75rem; font-weight: 600; font-style: normal; color: var(--ink-soft); }
  .line { display: flex; align-items: center; gap: 0.35rem; overflow-wrap: anywhere; }
  .pip {
    display: grid;
    place-items: center;
    width: 1.2rem;
    height: 1.2rem;
    border: 2px solid var(--line);
    border-radius: 50%;
    font-size: 0.7rem;
    font-weight: 900;
    flex: none;
  }
  .ok { background: var(--leaf); }
  .fun { background: var(--sun); }
</style>
