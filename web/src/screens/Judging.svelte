<script lang="ts">
  import { fly } from 'svelte/transition'
  import Burst from '../lib/Burst.svelte'
  import Canvas from '../lib/Canvas.svelte'
  import GuessBubble from '../lib/GuessBubble.svelte'
  import Timer from '../lib/Timer.svelte'
  import { room } from '../lib/room.svelte'
  import { accentOf } from '../lib/avatars'

  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])

  // One tap: the drawer only picks a favourite. Correctness is graded
  // server-side and stays hidden from everyone until the reveal.
  let sent = $state(false)
  let bursting = $state(false)

  function pickFavorite(id: string) {
    sent = true
    bursting = true
    room.send({ type: 'judge', favoriteGuessId: id })
  }
</script>

<div class="screen">
  <header>
    <div class="who">
      <span class="face" style="background: {accentOf(turn.drawerId)}">{drawer?.avatar}</span>
      <strong>{room.isDrawer ? 'Your pick' : `${drawer?.name} is choosing`}</strong>
    </div>
    {#if game.timerEndsAt}
      <Timer endsAt={game.timerEndsAt} total={game.config.judgingMs} />
    {/if}
  </header>

  <!-- The drawing shrinks to a card; the answers become the subject. -->
  <div class="shrunk">
    <Canvas strokes={room.strokes} epoch={room.strokeEpoch} />
  </div>

  {#if room.isDrawer}
    <div class="prompt" in:fly={{ y: -10, duration: 220 }}>
      <h2>{sent ? 'Nice.' : 'Which one is your favourite?'}</h2>
      {#if !sent}
        <p class="hint">
          {#if turn.grading === 'pending'}
            Checking who got it right…
          {:else}
            Who got it right is already settled.
          {/if}
        </p>
      {/if}
    </div>
  {:else}
    <p class="waiting">Sit tight…</p>
  {/if}

  <div class="list">
    {#each turn.guesses as guess, i (guess.id)}
      <GuessBubble
        {guess}
        mine={guess.playerId === game.you}
        delay={i * 70}
        onpick={room.isDrawer && !sent ? () => pickFavorite(guess.id) : undefined}
      />
    {/each}
  </div>

  {#if bursting}<Burst />{/if}
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
  /* Keep the drawing visible but subordinate. */
  .shrunk { width: 45%; max-width: 190px; margin: 0 auto; }
  .prompt { text-align: center; }
  .hint { margin: 0.15rem 0 0; font-size: 0.85rem; font-weight: 700; color: var(--ink-soft); }
  .waiting { margin: 0; text-align: center; font-weight: 800; color: var(--ink-soft); }
  .list { display: grid; gap: 0.5rem; overflow-y: auto; }
</style>
