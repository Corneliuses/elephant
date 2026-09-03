<script lang="ts">
  import type { ProjectedTurn } from '$shared/game/types'
  import type { Stroke } from '$shared/room/protocol'
  import Canvas from './Canvas.svelte'
  import { room } from './room.svelte'

  let { turn, index }: { turn: ProjectedTurn; index: number } = $props()

  const game = $derived(room.game!)
  const drawer = $derived(game.players[turn.drawerId])
  const correct = $derived(turn.guesses.find((g) => g.id === turn.correctGuessId) ?? null)
  const favorite = $derived(turn.guesses.find((g) => g.id === turn.favoriteGuessId) ?? null)

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
    <div class="skipped">Skipped</div>
  {:else}
    <Canvas {strokes} epoch={index} />
  {/if}
  <figcaption>
    <span class="by">{drawer?.avatar} {drawer?.name}</span>
    {#if turn.intent}<em class="was">“{turn.intent}”</em>{/if}
    {#if correct}<span class="line"><span class="pip ok">✓</span>{correct.text}</span>{/if}
    {#if favorite}<span class="line"><span class="pip fun">★</span>{favorite.text}</span>{/if}
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
