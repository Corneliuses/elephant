<script lang="ts">
  import type { Stroke } from '$shared/room/protocol'

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
    onstrokes?: (batch: Stroke[]) => void
  } = $props()

  let el: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null
  /** How many strokes are already on screen. */
  let painted = 0
  let pen: { x: number; y: number } | null = null
  let px = 0
  let down = false

  function reset(): void {
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.scale(el.width / px, el.width / px)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    painted = 0
    pen = null
  }

  /** Paint one stroke. Each segment is stroked on its own: O(1) per point,
   *  rather than re-stroking a growing path on every move. */
  function draw(s: Stroke): void {
    if (!ctx) return
    switch (s.t) {
      case 'clear':
        ctx.clearRect(0, 0, px, px)
        pen = null
        break
      case 'down':
        ctx.strokeStyle = s.color
        ctx.lineWidth = Math.max(1, s.width * px)
        pen = { x: s.x, y: s.y }
        // A dot, so a tap leaves a mark even with no movement.
        ctx.beginPath()
        ctx.arc(s.x * px, s.y * px, ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fillStyle = s.color
        ctx.fill()
        break
      case 'move':
        if (!pen) break
        ctx.beginPath()
        ctx.moveTo(pen.x * px, pen.y * px)
        ctx.lineTo(s.x * px, s.y * px)
        ctx.stroke()
        pen = { x: s.x, y: s.y }
        break
      case 'up':
        pen = null
        break
    }
  }

  function repaint(): void {
    reset()
    for (const s of strokes) draw(s)
    painted = strokes.length
  }

  function resize(): void {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    const dpr = Math.min(devicePixelRatio || 1, 2)
    px = rect.width
    el.width = Math.round(rect.width * dpr)
    el.height = Math.round(rect.width * dpr)
    repaint()
  }

  $effect(() => {
    ctx = el.getContext('2d')
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    return () => ro.disconnect()
  })

  // Reading `epoch` and `strokes.length` is the subscription: this re-runs
  // whenever either changes, painting only what is new.
  $effect(() => {
    epoch
    const n = strokes.length
    if (n < painted) {
      repaint()
      return
    }
    for (let i = painted; i < n; i++) draw(strokes[i]!)
    painted = n
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
