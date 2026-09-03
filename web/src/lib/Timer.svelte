<script lang="ts">
  import { clock } from './clock.svelte'

  let { endsAt, total, label = '' }: { endsAt: number; total: number; label?: string } = $props()

  const remaining = $derived(Math.max(0, endsAt - clock.now))
  const seconds = $derived(Math.ceil(remaining / 1000))
  const fraction = $derived(total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0)
  /** Last ten seconds: pulse, and shake harder as it runs out. */
  const urgent = $derived(remaining <= 10_000 && remaining > 0)

  const R = 26
  const C = 2 * Math.PI * R
</script>

<div class="timer" class:urgent style="--urgency: {urgent ? 1 - remaining / 10_000 : 0}">
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <circle class="track" cx="32" cy="32" r={R} />
    <circle
      class="fill"
      cx="32"
      cy="32"
      r={R}
      stroke-dasharray={C}
      stroke-dashoffset={C * (1 - fraction)}
    />
  </svg>
  <span class="num" aria-live="off">{seconds}</span>
  {#if label}<span class="label">{label}</span>{/if}
</div>

<style>
  .timer {
    position: relative;
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    /* Amplitude scales with how little time is left. */
    animation: shake calc(420ms - var(--urgency) * 280ms) ease-in-out infinite;
  }
  .timer:not(.urgent) { animation: none; }
  svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  circle { fill: none; stroke-width: 7; stroke-linecap: round; }
  .track { stroke: var(--card); }
  .fill { stroke: var(--leaf); transition: stroke 300ms var(--out); }
  .urgent .fill { stroke: var(--hot); }
  .num {
    font-size: 1.5rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .urgent .num { color: var(--hot); }
  .label {
    position: absolute;
    bottom: -1.1rem;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0) scale(1); }
    25% { transform: translateX(calc(var(--urgency) * -2px)) scale(1.04); }
    75% { transform: translateX(calc(var(--urgency) * 2px)) scale(1.04); }
  }
</style>
