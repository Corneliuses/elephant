import { env, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../game/config'
import type { GameConfig, GameState, ProjectedState } from '../game/types'
import { upgradeStoredGame } from './room'
import {
  CLOSE_LEFT,
  CLOSE_REPLACED,
  CLOSE_ROOM_GONE,
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

/**
 * Room with a, b, c joined and ready. a is organizer. The drawer may finish
 * at once unless a test says otherwise: the minimum drawing time has its
 * own tests, and everything else would just be waiting it out.
 */
async function readyRoom(config: Partial<GameConfig> = {}, room: Partial<RoomOptions> = {}) {
  const code = await createRoom({ config: { minDrawingMs: 0, ...config }, room })
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

/** Start the game: the first drawer is deciding what to draw. */
async function prepRoom(config: Partial<GameConfig> = {}, room: Partial<RoomOptions> = {}) {
  const r = await readyRoom(config, room)
  r.a.send({ type: 'start_game' })
  const s = await r.a.stateWhere((s) => s.phase === 'prep')
  const drawerId = s.turn!.drawerId
  const byId = (id: string) => [r.a, r.b, r.c].find((c) => c.playerId === id)!
  const drawer = byId(drawerId)
  const guessers = [r.a, r.b, r.c].filter((c) => c !== drawer)
  for (const cl of [r.a, r.b, r.c]) cl.clear()
  return { ...r, drawer, guessers, byId }
}

/** The drawer says what it is and starts the clock; `watchers` wait for it too. */
async function begin(drawer: Client, intent = 'a giraffe on a jet ski', watchers: Client[] = []): Promise<void> {
  drawer.send({ type: 'set_intent', text: intent })
  await drawer.stateWhere((s) => s.turn?.intent === intent)
  drawer.send({ type: 'start_drawing' })
  for (const cl of [drawer, ...watchers]) await cl.stateWhere((s) => s.phase === 'drawing')
}

/** Start the game with the first drawer's clock running. Clients keyed by role. */
async function startedRoom(config: Partial<GameConfig> = {}, room: Partial<RoomOptions> = {}) {
  const r = await prepRoom(config, room)
  await begin(r.drawer, undefined, r.guessers)
  for (const cl of [r.a, r.b, r.c]) cl.clear()
  return r
}

/** End the turn. The note was written before the clock started. */
function finish(drawer: Client): void {
  drawer.send({ type: 'end_drawing' })
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

  it('never lets the minimum drawing time outlast the clock', async () => {
    // With a one-second clock the default 30 s minimum would lock "Done"
    // until the timer ended the turn on its own.
    const short = await connect(await createRoom({ config: { drawingMs: 1000 } }))
    expect((await short.join('A')).config.minDrawingMs).toBe(1000)
    const explicit = await connect(await createRoom({ config: { drawingMs: 1000, minDrawingMs: 5000 } }))
    expect((await explicit.join('A')).config.minDrawingMs).toBe(1000)
    const under = await connect(await createRoom({ config: { drawingMs: 1000, minDrawingMs: 400 } }))
    expect((await under.join('A')).config.minDrawingMs).toBe(400)
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

  it('still reaches the Worker for /api/* with static assets configured', async () => {
    // `run_worker_first: ["/api/*"]` in wrangler.jsonc must keep the API
    // ahead of the asset store; a regression here serves index.html instead.
    const r = await SELF.fetch(`${BASE}/api/rooms`, { method: 'POST', body: '{}' })
    expect(r.status).toBe(201)
    expect(r.headers.get('content-type')).toContain('application/json')
  })
})

// ---------------------------------------------------------------------------
// Stored games from before a deploy
// ---------------------------------------------------------------------------

describe('upgradeStoredGame', () => {
  /** A game as persisted before prep, the minimum, and translation existed. */
  const old = () => {
    const guess = { id: 'g1', playerId: 'b', text: 'cat', submittedAt: 5 }
    const turn = {
      round: 1,
      drawerId: 'a',
      intent: 'a dog',
      guesses: [guess],
      correctGuessId: null,
      grading: 'pending',
      favoriteGuessId: null,
      skipped: false,
    }
    const { prepMs: _p, minDrawingMs: _m, ...config } = DEFAULT_CONFIG
    return JSON.parse(
      JSON.stringify({
        code: 'OLDR',
        config: { ...config, drawingMs: 20_000 },
        phase: 'drawing',
        organizerId: 'a',
        players: {},
        round: 1,
        drawOrder: ['a', 'b', 'c'],
        drawerIdx: 0,
        turn,
        turns: [{ ...turn, guesses: [] }],
        timerEndsAt: 1,
        graceEndsAt: null,
        nextGuessSeq: 2,
      }),
    ) as GameState
  }

  it('fills in the timers a room from before this code never had', () => {
    const g = upgradeStoredGame(old())
    expect(g.config.prepMs).toBe(DEFAULT_CONFIG.prepMs)
    expect(g.config.minDrawingMs).toBe(20_000)
    expect(g.config.drawingMs).toBe(20_000)
    expect(g.config.judgingMs).toBe(DEFAULT_CONFIG.judgingMs)
  })

  it('gives old turns and guesses the translation fields a fresh one has', () => {
    const g = upgradeStoredGame(old())
    expect(g.turn!.intentTranslations).toBeNull()
    expect(g.turn!.guesses[0]!.translations).toBeNull()
    expect(g.turns[0]!.intentTranslations).toBeNull()
    expect(g.turn!.intent).toBe('a dog')
  })

  it('leaves a current game as it is', () => {
    const current = upgradeStoredGame(old())
    expect(upgradeStoredGame(current)).toEqual(current)
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

  it('stamps each state message with the server clock', async () => {
    const code = await createRoom()
    const a = await connect(code)
    a.send({ type: 'join', name: 'A', avatar: 'x' })
    await a.next('welcome')
    const before = Date.now()
    const m = await a.next('state')
    expect(m.now).toBeGreaterThanOrEqual(before - 1000)
    expect(m.now).toBeLessThanOrEqual(Date.now() + 1000)
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
    // The code is what the client shows: a player reading the app in French
    // must not be handed the English message beside it.
    expect(e.code).toBe('invalid_name')
    expect(a.has('welcome')).toBe(false)
  })

  it('tags transport-level refusals too', async () => {
    const code = await createRoom()
    const a = await connect(code)
    a.send({ type: 'set_ready', ready: true })
    expect((await a.next('error')).code).toBe('bad_request')
    await a.join('A')
    a.sendRaw('{not json')
    expect((await a.next('error')).code).toBe('bad_request')
    a.send({ type: 'join', name: 'Again', avatar: 'x' })
    expect((await a.next('error')).code).toBe('already_joined')
  })

  it('keeps a name typed in any script', async () => {
    // Names go through the reducer untouched apart from NFC and trimming;
    // nothing down here assumes Latin text.
    const code = await createRoom()
    const a = await connect(code)
    const s = await a.join('小明')
    expect(s.players[a.playerId!]!.name).toBe('小明')
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
  it('only the organizer can start; everyone sees the first drawer deciding', async () => {
    const { a, b, c } = await readyRoom()
    b.send({ type: 'start_game' })
    expect((await b.next('error')).message).toMatch(/organizer/)
    const before = Date.now()
    a.send({ type: 'start_game' })
    for (const cl of [a, b, c]) {
      const s = await cl.stateWhere((s) => s.phase === 'prep')
      expect(s.round).toBe(1)
      expect(s.timerEndsAt).toBeGreaterThanOrEqual(before + DEFAULT_CONFIG.prepMs)
      expect(s.timerEndsAt).toBeLessThan(before + DEFAULT_CONFIG.prepMs + 5000)
    }
  })

  it('starts the drawing clock only once the drawer has said what it is', async () => {
    const { drawer, guessers } = await prepRoom()
    const [g1] = guessers as [Client, Client]
    // Nothing to guess at yet.
    g1.send({ type: 'submit_guess', text: 'early' })
    expect((await g1.next('error')).code).toBe('not_drawing')
    // And no clock without a note.
    drawer.send({ type: 'start_drawing' })
    expect((await drawer.next('error')).code).toBe('intent_required')

    drawer.send({ type: 'set_intent', text: 'a catdog' })
    const si = await drawer.stateWhere((s) => s.turn!.intent === 'a catdog')
    expect(si.phase).toBe('prep')
    // Only the drawer sees the note.
    const sg = await g1.latestState()
    expect(sg.turn!.intent).toBeNull()

    const before = Date.now()
    drawer.send({ type: 'start_drawing' })
    const s = await g1.stateWhere((s) => s.phase === 'drawing')
    expect(s.timerEndsAt).toBeGreaterThanOrEqual(before + DEFAULT_CONFIG.drawingMs)
    // Strokes flow only now.
    drawer.send({ type: 'stroke', strokes: [stroke('down')] })
    expect((await g1.next('strokes')).strokes).toEqual([stroke('down')])
  })

  it('refuses to end the turn before the minimum drawing time', async () => {
    const { drawer, guessers } = await startedRoom({ minDrawingMs: 60_000 })
    finish(drawer)
    const e = await drawer.next('error')
    expect(e.code).toBe('too_early')
    expect(e.message).toMatch(/longer/)
    await sleep(20)
    expect(guessers[0]!.has('state')).toBe(false)
  })

  it('lets the turn end once the minimum has run', async () => {
    const { drawer } = await startedRoom({ minDrawingMs: 30 })
    await sleep(40)
    finish(drawer)
    await drawer.stateWhere((s) => s.phase === 'reveal')
  })

  it('tells everyone who has answered without saying what', async () => {
    const { drawer, guessers } = await startedRoom()
    const [g1, g2] = guessers as [Client, Client]
    g2.send({ type: 'submit_guess', text: 'second to be listed, first in' })
    await drawer.stateWhere((s) => s.turn!.answered.length === 1)
    g1.send({ type: 'submit_guess', text: 'cat' })
    const sd = await drawer.stateWhere((s) => s.turn!.answered.length === 2)
    expect(sd.turn!.answered).toEqual([g1.playerId, g2.playerId].sort())
    expect(sd.turn!.guesses.map((g) => g.playerId)).toEqual([null, null])
  })

  it('leaves the guesses untranslated when no key is configured', async () => {
    // The state local dev and this suite run in: everyone reads the guess
    // as typed, and nothing waits on a translation that will never come.
    const { drawer, guessers } = await startedRoom()
    guessers[0]!.send({ type: 'submit_guess', text: '大象' })
    await drawer.stateWhere((s) => s.turn!.guesses.length === 1)
    finish(drawer)
    const s = await guessers[1]!.stateWhere((s) => s.phase === 'judging')
    expect(s.turn!.guesses[0]!.translations).toBeNull()
    expect(s.turn!.intentTranslations).toBeNull()
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

    finish(drawer)
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
    const { a, drawer, guessers, byId } = await prepRoom()
    await begin(drawer, 'a catdog')
    const [g1, g2] = guessers as [Client, Client]
    g1.send({ type: 'submit_guess', text: 'cat' })
    g2.send({ type: 'submit_guess', text: 'dog' })

    const sd = await drawer.stateWhere((s) => s.turn!.guesses.length === 2)
    expect(sd.turn!.guesses.map((g) => g.playerId)).toEqual([null, null])
    const s1 = await g1.stateWhere((s) => s.turn!.guesses.length === 2)
    expect(s1.turn!.guesses.map((g) => g.playerId)).toEqual([g1.playerId, null])
    expect(s1.turn!.intent).toBeNull()

    finish(drawer)
    await drawer.stateWhere((s) => s.phase === 'judging')
    const [, dogId] = sd.turn!.guesses.map((g) => g.id) as [string, string]
    // Correctness is the grader's job now; the drawer only picks a favourite.
    drawer.send({ type: 'judge', favoriteGuessId: dogId })

    const sr = await g2.stateWhere((s) => s.phase === 'reveal')
    expect(sr.turn!.guesses.map((g) => g.playerId)).toEqual([g1.playerId, g2.playerId])
    expect(sr.turn!.intent).toBe('a catdog')
    // No API key is configured in tests, so the turn goes ungraded and only
    // the drawer's favourite scores.
    expect(sr.turn!.grading).toBe('unavailable')
    expect(sr.turn!.correctGuessId).toBeNull()
    expect(sr.players[g1.playerId!]!.score).toBe(0)
    expect(sr.players[g2.playerId!]!.score).toBe(DEFAULT_CONFIG.favoritePoints)
    expect(sr.players[drawer.playerId!]!.score).toBe(0)

    // Organizer advances; the new drawer gets a fresh (reset) stroke buffer.
    for (const cl of [a, g1, g2, drawer]) cl.clear()
    a.send({ type: 'advance' })
    const s2 = await a.stateWhere((s) => s.phase === 'prep' && s.drawerIdx === 1)
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
    finish(drawer)
    await drawer.stateWhere((s) => s.phase === 'reveal')

    const r = await SELF.fetch(`${BASE}/api/rooms/${code}/turns/0/strokes`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual(batch)
    expect((await SELF.fetch(`${BASE}/api/rooms/${code}/turns/7/strokes`)).status).toBe(404)
  })

  it('serves an empty array for a turn nobody drew on', async () => {
    const { code, drawer, a } = await startedRoom()
    finish(drawer)
    await a.stateWhere((s) => s.phase === 'reveal')
    const r = await SELF.fetch(`${BASE}/api/rooms/${code}/turns/0/strokes`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
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
    const s = await a.stateWhere((s) => s.phase === 'prep' && s.drawerIdx === 1)
    expect(s.turns).toHaveLength(1)
  })

  it('skips a drawer who never says what they will draw', async () => {
    const { code, a, drawer } = await prepRoom({ prepMs: 30 })
    await sleep(40)
    expect(await runDurableObjectAlarm(stub(code))).toBe(true)
    const s = await a.stateWhere((s) => s.drawerIdx === 1)
    expect(s.turns[0]).toMatchObject({ drawerId: drawer.playerId, skipped: true })
    expect(s.phase).toBe('prep')
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
    expect(s.phase).toBe('prep')
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
    // The real alarm may already have fired; either way the room is gone.
    await runDurableObjectAlarm(stub(code))
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
    const { code, a, drawer, byId } = await startedRoom({}, { endedTtlMs: 20 })
    // Burn through the round by hand: three drawers, no guesses, organizer advances.
    let drawerId = drawer.playerId!
    for (let i = 0; i < 3; i++) {
      if (i > 0) await begin(byId(drawerId))
      finish(byId(drawerId))
      await a.stateWhere((st) => st.phase === 'reveal')
      a.send({ type: 'advance' })
      if (i < 2) {
        const s = await a.stateWhere((st) => st.phase === 'prep' && st.drawerIdx === i + 1)
        drawerId = s.turn!.drawerId
      }
    }
    await a.stateWhere((s) => s.phase === 'round_end')
    a.send({ type: 'end_game' })
    await a.stateWhere((s) => s.phase === 'ended')
    await sleep(30)
    await runDurableObjectAlarm(stub(code))
    expect((await roomInfo(code)).status).toBe(404)
    expect((await a.closed).code).toBe(CLOSE_ROOM_GONE)
  })
})
