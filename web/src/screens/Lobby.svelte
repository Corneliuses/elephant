<script lang="ts">
  import { flip } from 'svelte/animate'
  import { fly, scale } from 'svelte/transition'
  import { room } from '../lib/room.svelte'
  import PlayerChip from '../lib/PlayerChip.svelte'

  const game = $derived(room.game!)
  const readyCount = $derived(room.players.filter((p) => p.ready && p.connected).length)
  const minPlayers = $derived(game.config.minPlayers)
  const canStart = $derived(room.isOrganizer && readyCount >= minPlayers)
  const iAmReady = $derived(room.me?.ready ?? false)

  // Optimistic: flip the button the instant it is tapped, then let the
  // server's next state message become the truth.
  let pending = $state<boolean | null>(null)
  const shown = $derived(pending ?? iAmReady)
  $effect(() => {
    // Once the server agrees with us, stop overriding.
    if (pending !== null && pending === iAmReady) pending = null
  })

  function toggleReady() {
    const next = !shown
    pending = next
    room.send({ type: 'set_ready', ready: next })
  }

  async function share() {
    const url = location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Elephant', text: `Join my game: ${game.code}`, url })
        return
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      room.error = 'Link copied'
    } catch {
      /* clipboard unavailable */
    }
  }
</script>

<div class="screen">
  <header>
    <button class="code" onclick={share} title="Share this room">
      <span class="letters">{game.code}</span>
      <span class="hint">tap to share</span>
    </button>
  </header>

  <div class="roster">
    {#each room.players as player (player.id)}
      <div animate:flip={{ duration: 320 }} in:fly={{ y: 14, duration: 260 }} out:scale={{ duration: 160 }}>
        <PlayerChip {player} crown={player.id === game.organizerId} />
      </div>
    {/each}
  </div>

  <div class="spacer"></div>

  <footer>
    <p class="count" class:go={readyCount >= minPlayers}>
      {readyCount} ready
      {#if readyCount < minPlayers}· need {minPlayers - readyCount} more{/if}
    </p>

    <button class="btn wide" class:on={shown} onclick={toggleReady}>
      {shown ? "I'm ready ✓" : "I'm ready"}
    </button>

    {#if room.isOrganizer}
      <button class="btn primary wide" disabled={!canStart} onclick={() => room.send({ type: 'start_game' })}>
        Start game
      </button>
    {:else if readyCount >= minPlayers}
      <p class="waiting">Waiting for the organizer to start…</p>
    {/if}
  </footer>
</div>

<style>
  header { display: grid; place-items: center; }
  .code {
    display: grid;
    gap: 0.1rem;
    padding: 0.6rem 1.6rem;
    border: var(--border);
    border-radius: var(--r-lg);
    background: var(--sun);
    box-shadow: var(--lift-lg);
    cursor: pointer;
    transition: transform var(--fast) var(--out), box-shadow var(--fast) var(--out);
  }
  .code:active { transform: translateY(3px); box-shadow: var(--lift-press); }
  .letters { font-size: 2.6rem; font-weight: 900; letter-spacing: 0.28em; text-indent: 0.28em; }
  .hint { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.55; }

  .roster { display: grid; gap: 0.5rem; }
  .spacer { flex: 1; }
  footer { display: grid; gap: 0.7rem; }
  .count { margin: 0; text-align: center; font-weight: 800; color: var(--ink-soft); }
  .count.go { color: var(--leaf); }
  .btn.on { background: var(--leaf); }
  .waiting { margin: 0; text-align: center; font-weight: 800; color: var(--ink-soft); }
</style>
