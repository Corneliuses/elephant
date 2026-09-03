<script lang="ts">
  import type { Player, ProjectedGuess } from '$shared/game/types'
  import { accentOf } from './avatars'

  let {
    guess,
    author = null,
    mine = false,
    badge = null,
    delay = 0,
    disabled = false,
    onpick,
  }: {
    guess: ProjectedGuess
    author?: Player | null | undefined
    mine?: boolean
    badge?: 'correct' | 'favorite' | 'both' | null
    /** Stagger, ms. The cascade is what makes the list feel dealt out. */
    delay?: number
    disabled?: boolean
    onpick?: (() => void) | undefined
  } = $props()

  const classes = $derived(
    [
      'bubble',
      mine && 'mine',
      (badge === 'correct' || badge === 'both') && 'correct',
      (badge === 'favorite' || badge === 'both') && 'favorite',
    ]
      .filter(Boolean)
      .join(' '),
  )
</script>

<!-- A snippet is Svelte's render prop: markup defined once, rendered wherever. -->
{#snippet body()}
  <span class="who">
    {#if author}
      <span class="face" style="background: {accentOf(author.id)}">{author.avatar}</span>
    {:else}
      <span class="face anon">?</span>
    {/if}
  </span>

  <span class="text">{guess.text}</span>

  {#if badge}
    <span class="badges">
      {#if badge === 'correct' || badge === 'both'}<span class="badge ok">✓</span>{/if}
      {#if badge === 'favorite' || badge === 'both'}<span class="badge fun">★</span>{/if}
    </span>
  {/if}
{/snippet}

{#if onpick}
  <button class="{classes} pickable" style="--delay: {delay}ms" {disabled} onclick={onpick}>
    {@render body()}
  </button>
{:else}
  <div class={classes} style="--delay: {delay}ms">
    {@render body()}
  </div>
{/if}

<style>
  .bubble {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: var(--border);
    border-radius: var(--r);
    background: var(--card);
    box-shadow: var(--lift);
    text-align: left;
    font: inherit;
    font-weight: 700;
    color: inherit;
    /* Dealt out one at a time, not dumped as a list. */
    animation: land 320ms var(--spring) both;
    animation-delay: var(--delay);
  }
  .pickable { cursor: pointer; transition: transform var(--fast) var(--out), box-shadow var(--fast) var(--out); }
  .pickable:active:not(:disabled) { transform: translateY(3px); box-shadow: var(--lift-press); }
  .pickable:disabled { opacity: 0.4; cursor: default; }
  .mine { background: var(--sun); }
  .correct { border-color: var(--leaf); background: color-mix(in srgb, var(--leaf) 22%, var(--card)); }
  .favorite { background: color-mix(in srgb, var(--sun) 55%, var(--card)); }
  .correct.favorite { background: color-mix(in srgb, var(--sun) 45%, var(--leaf) 25%); }

  .face {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    font-size: 1.1rem;
    flex: none;
  }
  .anon { background: var(--paper); font-weight: 900; color: var(--ink-soft); }
  .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .badges { display: flex; gap: 0.25rem; flex: none; }
  .badge {
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    border: 2px solid var(--line);
    border-radius: 50%;
    font-weight: 900;
    animation: stamp 340ms var(--spring) both;
  }
  .ok { background: var(--leaf); }
  .fun { background: var(--sun); }

  @keyframes land {
    from { opacity: 0; transform: translateY(14px) scale(0.94); }
    to { opacity: 1; transform: none; }
  }
  @keyframes stamp {
    from { transform: scale(2.4) rotate(-18deg); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
