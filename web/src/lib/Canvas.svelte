<script lang="ts">
  import type { Stroke } from '$shared/room/protocol'
  import { StrokePainter } from './paint'

  let {
    strokes,
    epoch,
    drawable = false,
    color = '#1a1523',
    width = 0.012,
    onstrokes,
  }: {
    strokes: Stroke[]
    /** Changes when the buffer was replaced rather than appended to. */
    epoch: number
    drawable?: boolean
    color?: string
    width?: number
    onstrokes?: ((batch: Stroke[]) => void) | undefined
  } = $props()

  let el: HTMLCanvasElement
  /** Painting lives outside the reactive graph; see lib/paint.ts. */
  let painter: StrokePainter | null = null
  let down = false

  function resize(): void {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    const dpr = Math.min(devicePixelRatio || 1, 2)
    el.width = Math.round(rect.width * dpr)
    el.height = Math.round(rect.width * dpr)
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (painter) painter.resize(rect.width)
    else painter = new StrokePainter(ctx, rect.width)
    painter.sync(strokes, epoch)
  }

  $effect(() => {
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    return () => ro.disconnect()
  })

  // Reading `epoch` and `strokes.length` is the subscription: this re-runs
  // whenever either changes, and the painter decides what that implies.
  $effect(() => {
    epoch
    strokes.length
    painter?.sync(strokes, epoch)
  })

  function at(e: PointerEvent): { x: number; y: number } {
    const r = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  function start(e: PointerEvent): void {
    if (!drawable) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    down = true
    const p = at(e)
    onstrokes?.([{ t: 'down', x: p.x, y: p.y, color, width }])
  }

  function move(e: PointerEvent): void {
    if (!drawable || !down) return
    e.preventDefault()
    // Coalesced events recover the points the browser batched between frames,
    // which is the difference between a smooth curve and a polygon.
    const events = e.getCoalescedEvents?.() ?? [e]
    const batch: Stroke[] = events.map((ev) => {
      const p = at(ev)
      return { t: 'move', x: p.x, y: p.y }
    })
    if (batch.length) onstrokes?.(batch)
  }

  function end(e: PointerEvent): void {
    if (!drawable || !down) return
    down = false
    el.releasePointerCapture?.(e.pointerId)
    onstrokes?.([{ t: 'up' }])
  }
</script>

<canvas
  bind:this={el}
  class:drawable
  onpointerdown={start}
  onpointermove={move}
  onpointerup={end}
  onpointercancel={end}
></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    /* Fixed square so normalised coordinates mean the same thing everywhere. */
    aspect-ratio: 1;
    border: var(--border);
    border-radius: var(--r);
    background: #fff;
    box-shadow: var(--lift);
    /* Stop the browser treating a drag as a scroll. */
    touch-action: none;
  }
  .drawable { cursor: crosshair; }
</style>
