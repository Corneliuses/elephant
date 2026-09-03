import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedState } from '$shared/game/types'
import { CLOSE_LEFT, CLOSE_REPLACED, CLOSE_ROOM_GONE, CLOSE_UNAUTHORIZED } from '$shared/room/protocol'
import type { ClientMessage, ServerMessage } from '$shared/room/protocol'

/** Stands in for the browser WebSocket, driven by the test. */
class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  static get last(): FakeWS {
    const ws = FakeWS.instances.at(-1)
    if (!ws) throw new Error('no socket was opened')
    return ws
  }

  readyState = 0
  sent: string[] = []
  #listeners: Record<string, ((e: unknown) => void)[]> = {}

  constructor(readonly url: string) {
    FakeWS.instances.push(this)
  }

  addEventListener(type: string, fn: (e: unknown) => void) {
    ;(this.#listeners[type] ??= []).push(fn)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return
    this.readyState = 3
    this.#emit('close', { code, reason })
  }

  /* --- test drivers --- */
  accept() {
    this.readyState = 1
    this.#emit('open', {})
  }
  deliver(msg: ServerMessage) {
    this.#emit('message', { data: JSON.stringify(msg) })
  }
  /** Close initiated by the server. */
  serverClose(code: number) {
    this.readyState = 3
    this.#emit('close', { code, reason: '' })
  }
  get outbox(): ClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMessage)
  }

  #emit(type: string, e: unknown) {
    for (const fn of this.#listeners[type] ?? []) fn(e)
  }
}

function stateMsg(over: Partial<ProjectedState> = {}): ServerMessage {
  const you = over.you ?? 'p1'
  return {
    type: 'state',
    now: Date.now(),
    state: {
      code: 'ABCD',
      config: { minPlayers: 3 } as ProjectedState['config'],
      phase: 'lobby',
      organizerId: 'p1',
      players: {
        p1: { id: 'p1', name: 'Ada', avatar: '🐘', ready: true, connected: true, joinedAt: 10, score: 4 },
        p2: { id: 'p2', name: 'Bo', avatar: '🦊', ready: false, connected: true, joinedAt: 20, score: 9 },
      },
      round: 0,
      drawOrder: [],
      drawerIdx: 0,
      turn: null,
      turns: [],
      timerEndsAt: null,
      graceEndsAt: null,
      you,
      ...over,
    } as ProjectedState,
  }
}

/** Fresh module instance per test: the store is a singleton. */
async function freshRoom() {
  vi.resetModules()
  const mod = await import('./room.svelte')
  return mod.room
}

type Room = Awaited<ReturnType<typeof freshRoom>>
let room: Room

beforeEach(async () => {
  FakeWS.instances = []
  localStorage.clear()
  vi.stubGlobal('WebSocket', FakeWS)
  // The clock starts a rAF loop on sync; keep it from recursing under tests.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  room = await freshRoom()
})

afterEach(() => {
  room.disconnect()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('connect', () => {
  it('opens a socket without credentials on a first visit', () => {
    room.connect('ABCD')
    expect(room.status).toBe('connecting')
    expect(FakeWS.last.url).toContain('/api/rooms/ABCD/ws')
    expect(FakeWS.last.url).not.toContain('playerId')

    FakeWS.last.accept()
    expect(room.status).toBe('open')
    // Socket is up but we have not identified ourselves.
    expect(room.needsJoin).toBe(true)
  })

  it('sends stored credentials so the server reconnects rather than re-joins', () => {
    localStorage.setItem('elephant:creds:ABCD', JSON.stringify({ playerId: 'p1', secret: 's3cret' }))
    room.connect('ABCD')
    expect(FakeWS.last.url).toContain('playerId=p1')
    expect(FakeWS.last.url).toContain('secret=s3cret')
  })

  it('is idempotent for the same room', () => {
    room.connect('ABCD')
    room.connect('ABCD')
    expect(FakeWS.instances).toHaveLength(1)
  })

  it('survives credentials that are not valid JSON', () => {
    localStorage.setItem('elephant:creds:ABCD', 'not json')
    room.connect('ABCD')
    expect(FakeWS.last.url).not.toContain('playerId')
  })
})

describe('join', () => {
  it('stores the credentials the welcome carries', () => {
    room.connect('ABCD')
    FakeWS.last.accept()
    room.join('Ada', '🐘')
    expect(FakeWS.last.outbox).toEqual([{ type: 'join', name: 'Ada', avatar: '🐘' }])

    FakeWS.last.deliver({ type: 'welcome', playerId: 'p1', secret: 's3cret' })
    expect(JSON.parse(localStorage.getItem('elephant:creds:ABCD')!)).toEqual({
      playerId: 'p1',
      secret: 's3cret',
    })
  })

  it('drops messages sent before the socket is open', () => {
    room.connect('ABCD')
    room.join('Ada', '🐘')
    expect(FakeWS.last.sent).toEqual([])
  })
})

describe('state', () => {
  beforeEach(() => {
    room.connect('ABCD')
    FakeWS.last.accept()
  })

  it('exposes the viewer and the derived roles', () => {
    FakeWS.last.deliver(stateMsg())
    expect(room.needsJoin).toBe(false)
    expect(room.me?.name).toBe('Ada')
    expect(room.isOrganizer).toBe(true)
    expect(room.isDrawer).toBe(false)
    expect(room.phase).toBe('lobby')
  })

  it('is not the organizer when someone else is', () => {
    FakeWS.last.deliver(stateMsg({ you: 'p2' }))
    expect(room.isOrganizer).toBe(false)
    expect(room.me?.name).toBe('Bo')
  })

  it('knows when the viewer is drawing', () => {
    FakeWS.last.deliver(
      stateMsg({
        phase: 'drawing',
        turn: {
          round: 1,
          drawerId: 'p1',
          intent: null,
          guesses: [],
          correctGuessId: null,
          grading: 'pending',
          favoriteGuessId: null,
          skipped: false,
        },
      }),
    )
    expect(room.isDrawer).toBe(true)
  })

  it('orders players by join time and the leaderboard by score', () => {
    FakeWS.last.deliver(stateMsg())
    expect(room.players.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(room.ranked.map((p) => p.id)).toEqual(['p2', 'p1'])
  })

  it('surfaces server errors', () => {
    FakeWS.last.deliver({ type: 'error', message: 'only the organizer can start the game' })
    expect(room.error).toMatch(/organizer/)
  })
})

describe('strokes', () => {
  beforeEach(() => {
    room.connect('ABCD')
    FakeWS.last.accept()
  })

  it('appends a relayed batch without bumping the epoch', () => {
    FakeWS.last.deliver({ type: 'strokes', strokes: [{ t: 'up' }] })
    const epoch = room.strokeEpoch
    FakeWS.last.deliver({ type: 'strokes', strokes: [{ t: 'up' }] })
    expect(room.strokes).toHaveLength(2)
    expect(room.strokeEpoch).toBe(epoch)
  })

  it('replaces the buffer and bumps the epoch on a reset', () => {
    FakeWS.last.deliver({ type: 'strokes', strokes: [{ t: 'up' }, { t: 'up' }] })
    const epoch = room.strokeEpoch
    FakeWS.last.deliver({ type: 'strokes', strokes: [], reset: true })
    expect(room.strokes).toEqual([])
    // The canvas relies on this to know it must repaint rather than append.
    expect(room.strokeEpoch).toBe(epoch + 1)
  })
})

describe('closing', () => {
  beforeEach(() => {
    room.connect('ABCD')
    FakeWS.last.accept()
  })

  it('forgets bad credentials and tries again fresh', async () => {
    vi.useFakeTimers()
    localStorage.setItem('elephant:creds:ABCD', JSON.stringify({ playerId: 'p1', secret: 'stale' }))
    FakeWS.last.deliver(stateMsg())

    FakeWS.last.serverClose(CLOSE_UNAUTHORIZED)
    expect(localStorage.getItem('elephant:creds:ABCD')).toBeNull()
    expect(room.game).toBeNull()

    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWS.instances).toHaveLength(2)
    expect(FakeWS.last.url).not.toContain('playerId')
  })

  it('stops for good when the room is gone', async () => {
    vi.useFakeTimers()
    FakeWS.last.serverClose(CLOSE_ROOM_GONE)
    expect(room.status).toBe('gone')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(FakeWS.instances).toHaveLength(1)
  })

  it('stops when we chose to leave', async () => {
    vi.useFakeTimers()
    FakeWS.last.serverClose(CLOSE_LEFT)
    expect(room.status).toBe('idle')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(FakeWS.instances).toHaveLength(1)
  })

  it('reconnects with backoff after an unexpected drop', async () => {
    vi.useFakeTimers()
    FakeWS.last.deliver(stateMsg())

    FakeWS.last.serverClose(1006)
    expect(room.status).toBe('reconnecting')
    // Nothing yet: the first retry waits.
    expect(FakeWS.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(300)
    expect(FakeWS.instances).toHaveLength(2)

    // Second failure waits longer than the first.
    FakeWS.last.serverClose(1006)
    await vi.advanceTimersByTimeAsync(300)
    expect(FakeWS.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(300)
    expect(FakeWS.instances).toHaveLength(3)
  })

  it('caps the backoff', async () => {
    vi.useFakeTimers()
    for (let i = 0; i < 8; i++) {
      FakeWS.last.serverClose(1006)
      await vi.advanceTimersByTimeAsync(5_000)
    }
    expect(FakeWS.instances).toHaveLength(9)
  })

  it('a socket replaced by a newer one still reconnects', async () => {
    vi.useFakeTimers()
    FakeWS.last.serverClose(CLOSE_REPLACED)
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWS.instances).toHaveLength(2)
  })

  it('keeps the last state on screen while reconnecting', () => {
    FakeWS.last.deliver(stateMsg())
    FakeWS.last.serverClose(1006)
    // A blank screen mid-game would be worse than slightly stale data.
    expect(room.game).not.toBeNull()
    expect(room.status).toBe('reconnecting')
  })
})

describe('waking up', () => {
  it('reconnects immediately when the tab becomes visible again', async () => {
    vi.useFakeTimers()
    room.connect('ABCD')
    FakeWS.last.accept()
    FakeWS.last.serverClose(1006)

    // Unlocking the phone should not wait out the backoff.
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWS.instances).toHaveLength(2)
  })

  it('does nothing when the socket is still healthy', () => {
    room.connect('ABCD')
    FakeWS.last.accept()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWS.instances).toHaveLength(1)
  })

  it('stops listening once disconnected', () => {
    room.connect('ABCD')
    FakeWS.last.accept()
    room.disconnect()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWS.instances).toHaveLength(1)
  })
})

describe('leave', () => {
  it('tells the server, forgets the credentials, and resets', () => {
    room.connect('ABCD')
    FakeWS.last.accept()
    FakeWS.last.deliver({ type: 'welcome', playerId: 'p1', secret: 's3cret' })
    FakeWS.last.deliver(stateMsg())

    room.leave()
    expect(FakeWS.last.outbox.at(-1)).toEqual({ type: 'leave' })
    expect(localStorage.getItem('elephant:creds:ABCD')).toBeNull()
    expect(room.game).toBeNull()
    expect(room.code).toBeNull()
    expect(room.status).toBe('idle')
  })

  it('does not reconnect afterwards', async () => {
    vi.useFakeTimers()
    room.connect('ABCD')
    FakeWS.last.accept()
    room.leave()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(FakeWS.instances).toHaveLength(1)
  })
})
