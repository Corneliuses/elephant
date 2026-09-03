<script lang="ts">
  import { flip } from 'svelte/animate'
  import type { Player } from '$shared/game/types'
  import { accentOf } from './avatars'

  let { players, highlight = [] }: { players: Player[]; highlight?: string[] } = $props()
</script>

<ol class="board">
  {#each players as p, i (p.id)}
    <li
      animate:flip={{ duration: 420 }}
      class:lead={i === 0 && p.score > 0}
      class:bumped={highlight.includes(p.id)}
      style="--accent: {accentOf(p.id)}"
    >
      <span class="rank">{i + 1}</span>
      <span class="face">{p.avatar}</span>
      <span class="name">{p.name}</span>
      <span class="score">{p.score}</span>
    </li>
  {/each}
</ol>

<style>
  .board { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.8rem;
    border: var(--border);
    border-radius: var(--r-pill);
    background: var(--card);
    box-shadow: var(--lift);
    font-weight: 800;
  }
  .lead { background: var(--sun); }
  .rank { width: 1.2rem; text-align: center; color: var(--ink-soft); font-weight: 900; }
  .face {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--accent);
  }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .score { font-size: 1.25rem; font-weight: 900; font-variant-numeric: tabular-nums; }
  /* Points landing: the row takes the hit. */
  .bumped .score { animation: bump 520ms var(--spring) both; }
  @keyframes bump {
    0% { transform: scale(1); }
    35% { transform: scale(1.7); color: var(--hot); }
    100% { transform: scale(1); }
  }
</style>
