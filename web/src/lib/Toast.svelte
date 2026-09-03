<script lang="ts">
  import { fly } from 'svelte/transition'
  import { room } from './room.svelte'

  let timer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    if (room.error === null) return
    clearTimeout(timer)
    timer = setTimeout(() => (room.error = null), 2600)
    // Cleanup runs before the effect re-runs and on unmount.
    return () => clearTimeout(timer)
  })
</script>

{#if room.error}
  <div class="toast" transition:fly={{ y: -20, duration: 220 }} role="alert">
    {room.error}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    top: max(0.75rem, env(safe-area-inset-top));
    left: 50%;
    translate: -50% 0;
    z-index: 50;
    max-width: min(90vw, 420px);
    padding: 0.8rem 1.1rem;
    border: var(--border);
    border-radius: var(--r-pill);
    background: var(--hot);
    color: #fff;
    font-weight: 800;
    box-shadow: var(--lift);
  }
</style>
