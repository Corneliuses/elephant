/**
 * Stroke painting, extracted from Canvas.svelte so the repaint rules can be
 * tested without a DOM.
 *
 * The invariant this exists to protect: paint *incrementally* when the buffer
 * has grown, and repaint in full when it was replaced. Getting that wrong
 * corrupts drawings quietly rather than failing loudly.
 */
import type { Stroke } from '$shared/room/protocol'

/**
 * The subset of CanvasRenderingContext2D that painting needs. The style
 * properties keep the real API's union so a live context is assignable;
 * only strings are ever written.
 */
export interface PaintTarget {
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  fill(): void
  clearRect(x: number, y: number, w: number, h: number): void
}

export type SyncResult = 'none' | 'incremental' | 'full'

export class StrokePainter {
  #ctx: PaintTarget
  /** Canvas edge length in CSS pixels; strokes are normalised to [0, 1]. */
  #px: number
  #painted = 0
  #epoch = -1
  #pen: { x: number; y: number } | null = null

  constructor(ctx: PaintTarget, px: number) {
    this.#ctx = ctx
    this.#px = px
    this.#ctx.lineCap = 'round'
    this.#ctx.lineJoin = 'round'
  }

  /** How many strokes are currently on screen. */
  get painted(): number {
    return this.#painted
  }

  /** Canvas resized: everything must be drawn again at the new scale. */
  resize(px: number): void {
    this.#px = px
    this.#epoch = -1
    this.#painted = 0
  }

  /**
   * Bring the canvas up to date with `strokes`.
   *
   * A changed `epoch` means the buffer was replaced rather than appended to,
   * which a length comparison alone cannot detect: a reset can leave the array
   * the same length it already was.
   */
  sync(strokes: readonly Stroke[], epoch: number): SyncResult {
    if (epoch !== this.#epoch || strokes.length < this.#painted) {
      this.#epoch = epoch
      this.#repaint(strokes)
      return 'full'
    }
    if (strokes.length === this.#painted) return 'none'
    for (let i = this.#painted; i < strokes.length; i++) this.draw(strokes[i]!)
    this.#painted = strokes.length
    return 'incremental'
  }

  #repaint(strokes: readonly Stroke[]): void {
    this.#ctx.clearRect(0, 0, this.#px, this.#px)
    this.#pen = null
    for (const s of strokes) this.draw(s)
    this.#painted = strokes.length
  }

  /**
   * Paint one stroke. Each segment is stroked on its own rather than
   * re-stroking a growing path, so cost stays constant per point.
   */
  draw(s: Stroke): void {
    const ctx = this.#ctx
    const px = this.#px
    switch (s.t) {
      case 'clear':
        ctx.clearRect(0, 0, px, px)
        this.#pen = null
        break
      case 'down':
        ctx.strokeStyle = s.color
        ctx.fillStyle = s.color
        ctx.lineWidth = Math.max(1, s.width * px)
        this.#pen = { x: s.x, y: s.y }
        // A dot, so a tap leaves a mark even without movement.
        ctx.beginPath()
        ctx.arc(s.x * px, s.y * px, ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'move': {
        const pen = this.#pen
        if (!pen) break
        ctx.beginPath()
        ctx.moveTo(pen.x * px, pen.y * px)
        ctx.lineTo(s.x * px, s.y * px)
        ctx.stroke()
        this.#pen = { x: s.x, y: s.y }
        break
      }
      case 'up':
        this.#pen = null
        break
    }
  }
}
