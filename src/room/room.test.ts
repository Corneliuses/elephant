import { env, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../game/config'
import type { GameConfig, ProjectedState } from '../game/types'
import {
  CLOSE_LEFT,
  CLOSE_REPLACED,
  CLOSE_UNAUTHORIZED,
  CODE_ALPHABET,
  CODE_LENGTH,
  type ClientMessage,
  type CreateRoomRequest,
  type RoomInfo,
  type RoomOptions,
  type ServerMessage,
  type Stroke,
} from './protocol'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'https://elephant.test'

async function createRoom(body: CreateRoomRequest = {}): Promise<string> {
  const r = await SELF.fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(r.status).toBe(201)
  const { code } = (await r.json()) as { code: string }
  return code
}

async function roomInfo(code: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/rooms/${code}`)
}

function stub(code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A tiny test client over the room WebSocket with a typed inbox. */
class Client {
  private inbox: ServerMessage[] = []
  private waiters: (() => void)[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  playerId: string | null = null
  secret: string | null = null

  constructor(readonly ws: WebSocket) {
    ws.accept()
    ws.addEventListener('message', (e) => {
      this.inbox.push(JSON.parse(e.data as string) as ServerMessage)
      for (const w of this.waiters.splice(0)) w()
    })
    this.closed = new Promise((resolve) => {
      ws.addEventListener('close', (e) => {
        resolve({ code: e.code, reason: e.reason })
        for (const w of this.waiters.splice(0)) w()
      })
    })
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg))
  }

  /** Send something that is not a valid ClientMessage. */
  sendAny(msg: Record<string, unknown>) {
    this.ws.send(JSON.stringify(msg))
  }

  sendRaw(text: string) {
    this.ws.send(text)
  }

  /** Next message of the given type, leaving other messages in the inbox. */
  async next<T extends ServerMessage['type']>(type: T, timeoutMs = 2000): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type)
      if (i !== -1) return this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`timed out waiting for '${type}'; inbox: ${JSON.stringify(this.inbox)}`)
      await Promise.race([new Promise<void>((r) => this.waiters.push(r)), sleep(remaining)])
    }
  }

  /** Consume state messages until one satisfies `pred`; returns it. */
  async stateWhere(pred: (s: ProjectedState) => boolean, timeoutMs = 2000): Promise<ProjectedState> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const { state } = await this.next('state', Math.max(1, deadline - Date.now()))
      if (pred(state)) return state
    }
  }

  /** Drain queued state messages and return the most recent (waits for at least one). */
  async latestState(): Promise<ProjectedState> {
    let last = (await this.next('state')).state
    // Give any in-flight broadcasts a tick to land, then drain.
    await sleep(10)
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === 'state')
      if (i === -1) return last
      last = (this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: 'state' }>).state
    }
  }

  /** True if a message of this type is queued right now. */
  has(type: ServerMessage['type']): boolean {
    return this.inbox.some((m) => m.type === type)
  }

  /** Drop everything queued so far. */
  clear() {
    this.inbox = []
  }

  async join(name: string, avatar = '🐘'): Promise<ProjectedState> {
    this.send({ type: 'join', name, avatar })
    const w = await this.next('welcome')
    this.playerId = w.playerId
    this.secret = w.secret
    return (await this.next('state')).state
  }

  close(code = 1000) {
    this.ws.close(code, 'test')
  }
}

async function connect(code: string, creds?: { playerId: string; secret: string }): Promise<Client> {
  const q = creds ? `?playerId=${encodeURIComponent(creds.playerId)}&secret=${encodeURIComponent(creds.secret)}` : ''
  const r = await SELF.fetch(`${BASE}/api/rooms/${code}/ws${q}`, { headers: { Upgrade: 'websocket' } })
  expect(r.status).toBe(101)
  return new Client(r.webSocket!)
}

/** Room with a, b, c joined and ready. a is organizer. */
async function readyRoom(config: Partial<GameConfig> = {}, room: Partial<RoomOptions> = {}) {
  const code = await createRoom({ config, room })
  const a = await connect(code)
  await a.join('A')
  const b = await connect(code)
  await b.join('B')
  const c = await connect(code)
  await c.join('C')
  for (const cl of [a, b, c]) cl.send({ type: 'set_ready', ready: true })
  await a.stateWhere((s) => Object.values(s.players).every((p) => p.ready))
  for (const cl of [a, b, c]) cl.clear()
  return { code, a, b, c, clients: { a, b, c } }
}

/** Start the game and return the clients keyed by role. */
async function startedRoom(config: Partial<GameConfig> = {}, room: Partial<RoomOptions> = {}) {
  const r = await readyRoom(config, room)
  r.a.send({ type: 'start_game' })
  const s = await r.a.stateWhere((s) => s.phase === 'drawing')
  const drawerId = s.turn!.drawerId
  const byId = (id: string) => [r.a, r.b, r.c].find((c) => c.playerId === id)!
  const drawer = byId(drawerId)
  const guessers = [r.a, r.b, r.c].filter((c) => c !== drawer)
  for (const cl of [r.a, r.b, r.c]) cl.clear()
  return { ...r, drawer, guessers, byId }
}

const stroke = (t: 'down' | 'move' | 'up', x = 0.5, y = 0.5): Stroke =>
  t === 'down' ? { t, x, y, color: '#000', width: 4 } : t === 'move' ? { t, x, y } : { t }

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

describe('rooms API', () => {
  it('creates a room with a 4-letter code from the safe alphabet', async () => {
    const code = await createRoom()
    expect(code).toHaveLength(CODE_LENGTH)
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
  })

  it('reports room info', async () => {
    const code = await createRoom()
    const r = await roomInfo(code)
    expect(r.status).toBe(200)
    expect((await r.json()) as RoomInfo).toEqual({ code, phase: 'lobby', playerCount: 0 })
  })

  it('applies config overrides at creation', async () => {
    const code = await createRoom({ config: { drawingMs: 1234 } })
    const a = await connect(code)
    const s = await a.join('A')
    expect(s.config.drawingMs).toBe(1234)
    expect(s.config.judgingMs).toBe(DEFAULT_CONFIG.judgingMs)
  })

  it('rejects malformed create bodies', async () => {
    const r = await SELF.fetch(`${BASE}/api/rooms`, { method: 'POST', body: 'not json' })
    expect(r.status).toBe(400)
  })

  it('404s for unknown rooms', async () => {
    expect((await roomInfo('ZZZZ')).status).toBe(404)
    const ws = await SELF.fetch(`${BASE}/api/rooms/ZZZZ/ws`, { headers: { Upgrade: 'websocket' } })
    expect(ws.status).toBe(404)
  })

  it('requires an Upgrade header on the ws endpoint', async () => {
    const code = await createRoom()
    const r = await SELF.fetch(`${BASE}/api/rooms/${code}/ws`)
    expect(r.status).toBe(426)
  })

  it('404s unknown routes', async () => {
    expect((await SELF.fetch(`${BASE}/api/nope`)).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Join and state
// ---------------------------------------------------------------------------

describe('join', () => {
  it('welcomes the player and sends a state addressed to them', async () => {
    const code = await createRoom()
    const a = await connect(code)
    a.send({ type: 'join', name: 'Ada', avatar: '🦉' })
    const w = await a.next('welcome')
    expect(w.playerId).toBeTruthy()
    expect(w.secret).toBeTruthy()
    const { state } = await a.next('state')
    expect(state.you).toBe(w.playerId)
    expect(state.organizerId).toBe(w.playerId)
    expect(state.players[w.playerId]).toMatchObject({ name: 'Ada', avatar: '🦉', ready: false, connected: true })
  })

  it('also sends the (empty) stroke buffer on join', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const m = await a.next('strokes')
    expect(m).toEqual({ type: 'strokes', strokes: [], reset: true })
  })

  it('returns game errors without welcoming', async () => {
    const code = await createRoom()
    const a = await connect(code)
    a.send({ type: 'join', name: '   ', avatar: 'x' })
    const e = await a.next('error')
    expect(e.message).toMatch(/name/)
    expect(a.has('welcome')).toBe(false)
  })

  it('broadcasts to everyone with per-viewer projection', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const b = await connect(code)
    const sb = await b.join('B')
    const sa = await a.stateWhere((s) => Object.keys(s.players).length === 2)
    expect(sa.you).toBe(a.playerId)
    expect(sb.you).toBe(b.playerId)
    expect(Object.keys(sa.players).sort()).toEqual(Object.keys(sb.players).sort())
    const info = (await (await roomInfo(code)).json()) as RoomInfo
    expect(info.playerCount).toBe(2)
  })

  it('rejects game messages before join', async () => {
    const code = await createRoom()
    const a = await connect(code)
    a.send({ type: 'set_ready', ready: true })
    expect((await a.next('error')).message).toMatch(/join/)
  })

  it('rejects a second join on the same socket', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    a.send({ type: 'join', name: 'Again', avatar: 'x' })
    expect((await a.next('error')).message).toMatch(/already/)
  })

  it('ignores client-supplied playerId and now', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const b = await connect(code)
    await b.join('B')
    a.clear()
    b.clear()
    // b tries to ready-up a.
    b.sendAny({ type: 'set_ready', ready: true, playerId: a.playerId, now: 1 })
    const s = await a.stateWhere((s) => s.players[b.playerId!]!.ready)
    expect(s.players[a.playerId!]!.ready).toBe(false)
  })

  it('survives malformed and unknown messages', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    a.sendRaw('{not json')
    expect((await a.next('error')).message).toMatch(/invalid/i)
    a.sendAny({ type: 'teleport' })
    expect((await a.next('error')).message).toMatch(/unknown/i)
    a.send({ type: 'set_ready', ready: true })
    const s = await a.stateWhere((s) => s.players[a.playerId!]!.ready)
    expect(s.phase).toBe('lobby')
  })
})

// ---------------------------------------------------------------------------
// Reconnect and disconnect
// ---------------------------------------------------------------------------

describe('reconnect', () => {
  it('marks a player disconnected when their socket closes, and reconnected with credentials', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const b = await connect(code)
    await b.join('B')
    b.close()
    let s = await a.stateWhere((s) => !s.players[b.playerId!]!.connected)
    expect(s.players[b.playerId!]).toBeDefined()

    const b2 = await connect(code, { playerId: b.playerId!, secret: b.secret! })
    const sb = await b2.next('state')
    expect(sb.state.you).toBe(b.playerId)
    expect(b2.has('welcome')).toBe(false)
    s = await a.stateWhere((s) => s.players[b.playerId!]!.connected)
    expect(s.players[b.playerId!]!.name).toBe('B')
  })

  it('rejects a bad secret and closes the socket', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const bad = await connect(code, { playerId: a.playerId!, secret: 'nope' })
    expect((await bad.next('error')).message).toMatch(/unauthori[sz]ed/i)
    expect((await bad.closed).code).toBe(CLOSE_UNAUTHORIZED)
  })

  it('rejects an unknown playerId', async () => {
    const code = await createRoom()
    const bad = await connect(code, { playerId: 'ghost', secret: 'x' })
    expect((await bad.closed).code).toBe(CLOSE_UNAUTHORIZED)
  })

  it('replaces an existing socket for the same player', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const a2 = await connect(code, { playerId: a.playerId!, secret: a.secret! })
    await a2.next('state')
    expect((await a.closed).code).toBe(CLOSE_REPLACED)
    // The player is still connected (via a2), and a2 still works.
    a2.send({ type: 'set_ready', ready: true })
    const s = await a2.stateWhere((s) => s.players[a.playerId!]!.ready)
    expect(s.players[a.playerId!]!.connected).toBe(true)
  })

  it('leave removes the player and closes the socket', async () => {
    const code = await createRoom()
    const a = await connect(code)
    await a.join('A')
    const b = await connect(code)
    await b.join('B')
    b.send({ type: 'leave' })
    expect((await b.closed).code).toBe(CLOSE_LEFT)
    const s = await a.stateWhere((s) => !(b.playerId! in s.players))
    expect(Object.keys(s.players)).toEqual([a.playerId])
    // Their credentials no longer work.
    const b2 = await connect(code, { playerId: b.playerId!, secret: b.secret! })
    expect((await b2.closed).code).toBe(CLOSE_UNAUTHORIZED)
  })
})

// ---------------------------------------------------------------------------
// Game flow over the wire
// ---------------------------------------------------------------------------

describe('game flow', () => {
  it('only the organizer can start; everyone sees the drawing phase', async () => {
    const { a, b, c } = await readyRoom()
    b.send({ type: 'start_game' })
    expect((await b.next('error')).message).toMatch(/organizer/)
    const before = Date.now()
    a.send({ type: 'start_game' })
    for (const cl of [a, b, c]) {
      const s = await cl.stateWhere((s) => s.phase === 'drawing')
      expect(s.round).toBe(1)
      expect(s.timerEndsAt).toBeGreaterThanOrEqual(before + DEFAULT_CONFIG.drawingMs)
      expect(s.timerEndsAt).toBeLessThan(before + DEFAULT_CONFIG.drawingMs + 5000)
    }
  })

  it('relays the drawer’s strokes to guessers only', async () => {
    const { drawer, guessers } = await startedRoom()
    const batch = [stroke('down', 0.1, 0.1), stroke('move', 0.2, 0.2), stroke('up')]
    drawer.send({ type: 'stroke', strokes: batch })
    for (const g of guessers) {
      const m = await g.next('strokes')
      expect(m.strokes).toEqual(batch)
      expect(m.reset).toBeFalsy()
    }
    // Not echoed to the drawer.
    await sleep(50)
    expect(drawer.has('strokes')).toBe(false)
  })

  it('drops strokes from non-drawers and outside the drawing phase', async () => {
    const { drawer, guessers } = await startedRoom()
    const [g1, g2] = guessers as [Client, Client]
    g1.send({ type: 'stroke', strokes: [stroke('down')] })
    await sleep(50)
    expect(g2.has('strokes')).toBe(false)
    expect(drawer.has('strokes')).toBe(false)

    drawer.send({ type: 'end_drawing' })
    await drawer.stateWhere((s) => s.phase !== 'drawing')
    drawer.send({ type: 'stroke', strokes: [stroke('down')] })
    await sleep(50)
    expect(g1.has('strokes')).toBe(false)
  })

  it('rejects malformed stroke batches', async () => {
    const { drawer, guessers } = await startedRoom()
    drawer.sendAny({ type: 'stroke', strokes: [{ t: 'zap' }] })
    expect((await drawer.next('error')).message).toMatch(/stroke/)
    drawer.sendAny({ type: 'stroke', strokes: 'nope' })
    expect((await drawer.next('error')).message).toMatch(/stroke/)
    await sleep(20)
    expect(guessers[0]!.has('strokes')).toBe(false)
  })

  it('sends the buffered strokes to a reconnecting or new socket', async () => {
    const { code, drawer, guessers } = await startedRoom()
    const b1 = [stroke('down', 0.1, 0.1), stroke('move', 0.2, 0.2)]
    const b2 = [stroke('up')]
    drawer.send({ type: 'stroke', strokes: b1 })
    drawer.send({ type: 'stroke', strokes: b2 })
    await guessers[0]!.next('strokes')
    await guessers[0]!.next('strokes')

    // New player joining mid-turn.
    const z = await connect(code)
    await z.join('Z')
    const m = await z.next('strokes')
    expect(m).toEqual({ type: 'strokes', strokes: [...b1, ...b2], reset: true })

    // Guesser reconnecting.
    const g = guessers[1]!
    g.close()
    const g2 = await connect(code, { playerId: g.playerId!, secret: g.secret! })
    const m2 = await g2.next('strokes')
    expect(m2).toEqual({ type: 'strokes', strokes: [...b1, ...b2], reset: true })
  })

  it('hides guess authors from the drawer until reveal, and runs a full turn', async () => {
    const { a, drawer, guessers, byId } = await startedRoom()
    const [g1, g2] = guessers as [Client, Client]
    g1.send({ type: 'submit_guess', text: 'cat' })
    g2.send({ type: 'submit_guess', text: 'dog' })

    const sd = await drawer.stateWhere((s) => s.turn!.guesses.length === 2)
    expect(sd.turn!.guesses.map((g) => g.playerId)).toEqual([null, null])
    const s1 = await g1.stateWhere((s) => s.turn!.guesses.length === 2)
    expect(s1.turn!.guesses.map((g) => g.playerId)).toEqual([g1.playerId, null])

    drawer.send({ type: 'set_intent', text: 'a catdog' })
    const si = await drawer.stateWhere((s) => s.turn!.intent === 'a catdog')
    expect(si.turn!.intent).toBe('a catdog')
    const sg = await g1.latestState()
    expect(sg.turn!.intent).toBeNull()

    drawer.send({ type: 'end_drawing' })
    await drawer.stateWhere((s) => s.phase === 'judging')
    const [catId, dogId] = sd.turn!.guesses.map((g) => g.id) as [string, string]
    drawer.send({ type: 'judge', correctGuessId: catId, funniestGuessId: dogId })

    const sr = await g2.stateWhere((s) => s.phase === 'reveal')
    expect(sr.turn!.guesses.map((g) => g.playerId)).toEqual([g1.playerId, g2.playerId])
    expect(sr.turn!.intent).toBe('a catdog')
    expect(sr.players[g1.playerId!]!.score).toBe(DEFAULT_CONFIG.correctPoints)
    expect(sr.players[g2.playerId!]!.score).toBe(DEFAULT_CONFIG.funniestPoints)
    expect(sr.players[drawer.playerId!]!.score).toBe(0)

    // Organizer advances; the new drawer gets a fresh (reset) stroke buffer.
    for (const cl of [a, g1, g2, drawer]) cl.clear()
    a.send({ type: 'advance' })
    const s2 = await a.stateWhere((s) => s.phase === 'drawing' && s.drawerIdx === 1)
    const next = byId(s2.turn!.drawerId)
    expect(next).not.toBe(drawer)
    const reset = await next.next('strokes')
    expect(reset).toEqual({ type: 'strokes', strokes: [], reset: true })
  })

  it('serves a completed turn’s strokes for the gallery', async () => {
    const { code, drawer, guessers } = await startedRoom()
    const batch = [stroke('down', 0.3, 0.3), stroke('up')]
    drawer.send({ type: 'stroke', strokes: batch })
    await guessers[0]!.next('strokes')
    drawer.send({ type: 'end_drawing' })
    await drawer.stateWhere((s) => s.phase === 'reveal')

    const r = await SELF.fetch(`${BASE}/api/rooms/${code}/turns/0/strokes`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual(batch)
    expect((await SELF.fetch(`${BASE}/api/rooms/${code}/turns/7/strokes`)).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Alarms drive the timers
// ---------------------------------------------------------------------------

describe('alarms', () => {
  it('has no alarm while idle in the lobby with players connected', async () => {
    const { code } = await readyRoom()
    expect(await runDurableObjectAlarm(stub(code))).toBe(false)
  })

  it('arms an alarm when a timer starts and re-arms after an early fire', async () => {
    const { code, a } = await startedRoom()
    // Not due yet: no-op, but still scheduled afterwards.
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    await sleep(20)
    expect(a.has('state')).toBe(false)
    expect(((await (await roomInfo(code)).json()) as RoomInfo).phase).toBe('drawing')
  })

  it('advances the phase when the drawing timer expires', async () => {
    const { code, a, guessers } = await startedRoom({ drawingMs: 30 })
    guessers[0]!.send({ type: 'submit_guess', text: 'x' })
    await a.stateWhere((s) => s.turn!.guesses.length === 1)
    await sleep(40)
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    const s = await a.stateWhere((s) => s.phase === 'judging')
    expect(s.timerEndsAt).toBeGreaterThan(Date.now() - 1000)
  })

  it('chains through judging and reveal on successive expiries', async () => {
    const { code, a } = await startedRoom({ drawingMs: 10, judgingMs: 10, revealMs: 10 })
    await sleep(15)
    await runDurableObjectAlarm(stub(code))
    // No guesses → straight to reveal.
    await a.stateWhere((s) => s.phase === 'reveal')
    await sleep(15)
    await runDurableObjectAlarm(stub(code))
    const s = await a.stateWhere((s) => s.phase === 'drawing' && s.drawerIdx === 1)
    expect(s.turns).toHaveLength(1)
  })

  it('skips the turn when the drawer disconnects past the grace period', async () => {
    const { code, a, drawer, guessers } = await startedRoom({ graceMs: 20 })
    drawer.close()
    const watcher = guessers[0]!
    await watcher.stateWhere((s) => !s.players[drawer.playerId!]!.connected)
    await sleep(30)
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    const s = await watcher.stateWhere((s) => s.drawerIdx === 1)
    expect(s.turns[0]).toMatchObject({ drawerId: drawer.playerId, skipped: true })
    expect(s.phase).toBe('drawing')
    void a
  })
})

// ---------------------------------------------------------------------------
// Garbage collection
// ---------------------------------------------------------------------------

describe('garbage collection', () => {
  it('deletes an idle room after idleTtlMs', async () => {
    const code = await createRoom({ room: { idleTtlMs: 20 } })
    const a = await connect(code)
    await a.join('A')
    a.close()
    await a.closed
    await sleep(30)
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    expect((await roomInfo(code)).status).toBe(404)
    const ws = await SELF.fetch(`${BASE}/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket' } })
    expect(ws.status).toBe(404)
  })

  it('does not delete a room that someone reconnected to', async () => {
    const code = await createRoom({ room: { idleTtlMs: 20 } })
    const a = await connect(code)
    await a.join('A')
    a.close()
    await a.closed
    const a2 = await connect(code, { playerId: a.playerId!, secret: a.secret! })
    await a2.next('state')
    await sleep(30)
    await runDurableObjectAlarm(stub(code))
    expect((await roomInfo(code)).status).toBe(200)
  })

  it('deletes an ended room after endedTtlMs even with sockets open', async () => {
    const { code, a, drawer, byId } = await startedRoom({ drawingMs: 5, revealMs: 5 }, { endedTtlMs: 20 })
    // Burn through the round: three drawers, no guesses.
    for (let i = 0; i < 3; i++) {
      const s = await a.stateWhere((st) => st.phase === 'drawing' && st.drawerIdx === i)
      byId(s.turn!.drawerId).send({ type: 'end_drawing' })
      await a.stateWhere((st) => st.phase === 'reveal')
      a.send({ type: 'advance' })
    }
    await a.stateWhere((s) => s.phase === 'round_end')
    a.send({ type: 'end_game' })
    await a.stateWhere((s) => s.phase === 'ended')
    await sleep(30)
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    expect((await roomInfo(code)).status).toBe(404)
    void drawer
  })
})
