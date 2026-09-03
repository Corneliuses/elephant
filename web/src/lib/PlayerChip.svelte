<script lang="ts">
  import type { Player } from '$shared/game/types'
  import { accentOf } from './avatars'

  let { player, showScore = false, crown = false }: {
    player: Player
    showScore?: boolean
    crown?: boolean
  } = $props()
</script>

<div class="chip" class:off={!player.connected} style="--accent: {accentOf(player.id)}">
  <span class="face">{player.avatar}</span>
  <span class="name">{player.name}</span>
  {#if crown}<span class="crown" title="Organizer">👑</span>{/if}
  {#if showScore}<span class="score">{player.score}</span>{/if}
  {#if player.ready && !showScore}<span class="tick">✓</span>{/if}
</div>

<style>
  .chip {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.85rem;
    border: var(--border);
    border-radius: var(--r-pill);
    background: var(--card);
    box-shadow: var(--lift);
    font-weight: 800;
  }
  .chip.off { opacity: 0.45; }
  .face {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--accent);
    font-size: 1.1rem;
  }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .score { font-size: 1.2rem; font-weight: 900; }
  .tick { color: var(--leaf); font-weight: 900; }
</style>
