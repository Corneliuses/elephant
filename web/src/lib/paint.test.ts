import { beforeEach, describe, expect, it } from 'vitest'
import type { Stroke } from '$shared/room/protocol'
import { type PaintTarget, StrokePainter } from './paint'

/** Records every call so tests can assert on what reached the canvas. */
class FakeCtx implements PaintTarget {
  strokeStyle = ''
  fillStyle = ''
  lineWidth = 0
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  calls: string[] = []
  /** Line segments actually drawn, as [x1,y1,x2,y2] in pixels. */
  segments: number[][] = []
  clears = 0
  #from: [number, number] = [0, 0]

  beginPath() { this.calls.push('beginPath') }
  moveTo(x: number, y: number) { this.#from = [x, y]; this.calls.push('moveTo') }
  lineTo(x: number, y: number) { this.segments.push([...this.#from, x, y]); this.calls.push('lineTo') }
  stroke() { this.calls.push('stroke') }
  arc() { this.calls.push('arc') }
  fill() { this.calls.push('fill') }
  clearRect() { this.clears++; this.calls.push('clearRect') }
}

const PX = 100
const down = (x: number, y: number, color = '#000', width = 0.02): Stroke =>
  ({ t: 'down', x, y, color, width })
const move = (x: number, y: number): Stroke => ({ t: 'move', x, y })
const up = (): Stroke => ({ t: 'up' })

let ctx: FakeCtx
let painter: StrokePainter

beforeEach(() => {
  ctx = new FakeCtx()
  painter = new StrokePainter(ctx, PX)
})

describe('sync', () => {
  it('repaints in full the first time', () => {
    expect(painter.sync([down(0, 0), move(1, 1)], 0)).toBe('full')
    expect(painter.painted).toBe(2)
    expect(ctx.clears).toBe(1)
  })

  it('does nothing when neither the buffer nor the epoch moved', () => {
    const strokes = [down(0, 0)]
    painter.sync(strokes, 0)
    ctx.calls = []
    expect(painter.sync(strokes, 0)).toBe('none')
    expect(ctx.calls).toEqual([])
  })

  it('paints only the new strokes when the buffer grew', () => {
    const strokes: Stroke[] = [down(0, 0), move(0.5, 0.5)]
    painter.sync(strokes, 0)
    ctx.segments = []
    ctx.clears = 0

    strokes.push(move(1, 1))
    expect(painter.sync(strokes, 0)).toBe('incremental')
    expect(ctx.clears).toBe(0)
    // Exactly one new segment, continuing from the previous point.
    expect(ctx.segments).toEqual([[50, 50, 100, 100]])
    expect(painter.painted).toBe(3)
  })

  it('repaints in full when the epoch changes, even at the same length', () => {
    painter.sync([down(0, 0), move(1, 1)], 0)
    ctx.clears = 0
    ctx.segments = []

    // A reset that happens to produce an identical length: a length check
    // alone would miss this and leave the previous drawing on screen.
    expect(painter.sync([down(0.2, 0.2), move(0.4, 0.4)], 1)).toBe('full')
    expect(ctx.clears).toBe(1)
    expect(ctx.segments).toEqual([[20, 20, 40, 40]])
  })

  it('repaints in full when the buffer shrank', () => {
    painter.sync([down(0, 0), move(1, 1), move(0.5, 0.5)], 0)
    ctx.clears = 0
    expect(painter.sync([down(0, 0)], 0)).toBe('full')
    expect(ctx.clears).toBe(1)
    expect(painter.painted).toBe(1)
  })

  it('handles an empty buffer', () => {
    expect(painter.sync([], 0)).toBe('full')
    expect(painter.painted).toBe(0)
    expect(painter.sync([], 0)).toBe('none')
  })

  it('forgets everything on resize so the next sync redraws at the new scale', () => {
    painter.sync([down(0, 0), move(1, 1)], 0)
    painter.resize(200)
    ctx.segments = []
    expect(painter.sync([down(0, 0), move(1, 1)], 0)).toBe('full')
    // Same normalised coordinates, new pixel size.
    expect(ctx.segments).toEqual([[0, 0, 200, 200]])
  })
})

describe('draw', () => {
  it('scales normalised coordinates and width by the canvas size', () => {
    painter.sync([down(0.25, 0.75, '#ff0000', 0.1)], 0)
    expect(ctx.strokeStyle).toBe('#ff0000')
    expect(ctx.lineWidth).toBe(10)
  })

  it('never lets a stroke fall below one pixel', () => {
    painter.sync([down(0, 0, '#000', 0.000001)], 0)
    expect(ctx.lineWidth).toBe(1)
  })

  it('marks a dot on pointer-down so a tap leaves ink', () => {
    painter.sync([down(0.5, 0.5)], 0)
    expect(ctx.calls).toContain('arc')
    expect(ctx.calls).toContain('fill')
  })

  it('ignores a move with no pen down', () => {
    painter.sync([move(0.5, 0.5)], 0)
    expect(ctx.segments).toEqual([])
  })

  it('stops the line at pointer-up rather than joining to the next stroke', () => {
    painter.sync([down(0, 0), move(0.5, 0.5), up(), move(1, 1)], 0)
    // Only the segment before the lift; the trailing move is orphaned.
    expect(ctx.segments).toEqual([[0, 0, 50, 50]])
  })

  it('starts a fresh line after a new pointer-down', () => {
    painter.sync([down(0, 0), move(0.5, 0.5), up(), down(0.8, 0.8), move(1, 1)], 0)
    expect(ctx.segments).toEqual([
      [0, 0, 50, 50],
      [80, 80, 100, 100],
    ])
  })

  it('clear wipes the canvas and lifts the pen', () => {
    painter.sync([down(0, 0), { t: 'clear' }, move(1, 1)], 0)
    // One clear for the full repaint, one for the stroke itself.
    expect(ctx.clears).toBe(2)
    // The move after a clear has no pen, so nothing is drawn.
    expect(ctx.segments).toEqual([])
  })
})
