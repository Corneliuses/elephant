<script lang="ts">
  /** A cheap confetti pop. Transform + opacity only, then it removes itself. */
  let { colors = ['#ff3d71', '#ffc93c', '#2bb3ff', '#2bd97c', '#a855f7'], count = 22 }: {
    colors?: string[]
    count?: number
  } = $props()

  const bits = $derived(Array.from({ length: count }, (_, i) => ({
    i,
    angle: (360 / count) * i + (Math.random() * 20 - 10),
    dist: 70 + Math.random() * 90,
    spin: Math.random() * 720 - 360,
    delay: Math.random() * 90,
    color: colors[i % colors.length]!,
  })))
</script>

<div class="burst" aria-hidden="true">
  {#each bits as b (b.i)}
    <span
      style="
        --a: {b.angle}deg; --d: {b.dist}px; --s: {b.spin}deg;
        --delay: {b.delay}ms; background: {b.color}"
    ></span>
  {/each}
</div>

<style>
  .burst { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 20; }
  span {
    position: absolute;
    width: 10px;
    height: 14px;
    border-radius: 2px;
    animation: fly 900ms var(--out) both;
    animation-delay: var(--delay);
  }
  @keyframes fly {
    from { transform: rotate(var(--a)) translateY(0) rotate(0deg); opacity: 1; }
    to { transform: rotate(var(--a)) translateY(calc(var(--d) * -1)) rotate(var(--s)); opacity: 0; }
  }
</style>
