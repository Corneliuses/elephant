<script lang="ts">
  /*
   * Who has a guess in. The drawer reads it to decide when to stop: once
   * everyone has answered there is nothing to wait for. Only *that* someone
   * answered is shown, never what — the guesses themselves stay anonymous
   * until the reveal.
   */
  import { flip } from 'svelte/animate'
  import { room } from './room.svelte'
  import { accentOf } from './avatars'
  import { t } from './i18n.svelte'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  /** Everyone who may guess this turn, in roster order. */
  const guessers = $derived(room.players.filter((p) => p.ready && p.id !== turn.drawerId))
  const answered = $derived(new Set(turn.answered))
</script>

<div class="strip">
  <span class="count">{turn.answered.length > 0 ? t.s.guessesIn(turn.answered.length) : t.s.noGuessesYet}</span>
  <div class="chips">
    {#each guessers as p (p.id)}
      <span
        class="chip"
        class:in={answered.has(p.id)}
        class:off={!p.connected}
        style="--accent: {accentOf(p.id)}"
        animate:flip={{ duration: 260 }}
      >
        <span class="face">{p.avatar}</span>
        <span class="name">{p.name}</span>
        {#if answered.has(p.id)}<span class="tick">✓</span>{/if}
      </span>
    {/each}
  </div>
</div>

<style>
  .strip { display: grid; gap: 0.35rem; }
  .count { font-size: 0.8rem; font-weight: 800; color: var(--ink-soft); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 10rem;
    padding: 0.2rem 0.6rem 0.2rem 0.25rem;
    border: 2px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--card);
    font-size: 0.8rem;
    font-weight: 800;
    opacity: 0.45;
    transition: opacity var(--fast) var(--out), transform var(--base) var(--spring), background var(--fast) var(--out);
  }
  /* Lights up with a pop the moment their guess lands. */
  .chip.in { opacity: 1; background: var(--sun); transform: scale(1.04); }
  .chip.off { opacity: 0.25; }
  .face {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: var(--accent);
    font-size: 0.85rem;
  }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tick { color: var(--ink); animation: stamp 320ms var(--spring) both; }
  @keyframes stamp {
    from { transform: scale(2.2) rotate(-18deg); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
</style>
