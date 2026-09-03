/**
 * RoomDO: one Durable Object per room. Thin glue around the pure game
 * machine in src/game — sockets, storage, alarms, and the stroke relay.
 * See docs/DESIGN.md.
 */
import { DurableObject } from 'cloudflare:workers'
import { DEFAULT_CONFIG } from '../game/config'
import { apply, createGame, nextAlarmAt, project } from '../game/machine'
import type { GameConfig, GameEvent, GameState, PlayerId } from '../game/types'
import {
  CLOSE_LEFT,
  CLOSE_REPLACED,
  CLOSE_ROOM_GONE,
  CLOSE_UNAUTHORIZED,
  DEFAULT_ROOM_OPTIONS,
  type ClientMessage,
  type CreateRoomRequest,
  type RoomInfo,
  type RoomOptions,
  type ServerMessage,
  type Stroke,
} from './protocol'

interface Attachment {
  playerId: PlayerId | null
}

interface RoomMeta {
  options: RoomOptions
  /** When the last socket closed; null while anyone is connected. */
  emptySince: number | null
  /** When the game entered `ended`. */
  endedAt: number | null
}

const KEY_GAME = 'game'
const KEY_META = 'meta'
const keySecret = (id: PlayerId) => `secret:${id}`
const keyStrokes = (turnIdx: number) => `strokes:${turnIdx}`

const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_STROKES_PER_TURN = 20_000

export class RoomDO extends DurableObject<Env> {
  private game: GameState | null = null
  private meta: RoomMeta | null = null
  /** Stroke buffer for the live turn. */
  private strokes: Stroke[] = []
  /** Which index in `game.turns` the buffer belongs to; -1 when no live turn. */
  private strokesTurn = -1

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(() => this.load())
  }

  private async load(): Promise<void> {
    const s = this.ctx.storage
    this.game = (await s.get<GameState>(KEY_GAME)) ?? null
    this.meta = (await s.get<RoomMeta>(KEY_META)) ?? null
    this.strokesTurn = this.game ? liveTurnIndex(this.game) : -1
    this.strokes = this.strokesTurn >= 0 ? ((await s.get<Stroke[]>(keyStrokes(this.strokesTurn))) ?? []) : []
  }

  // -------------------------------------------------------------------------
  // HTTP (only ever called by the worker)
  // -------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'POST' && path === '/create') return this.handleCreate(request)
    if (!this.game) return json({ error: 'room not found' }, 404)

    if (request.method === 'GET' && path === '/info') {
      const info: RoomInfo = {
        code: this.game.code,
        phase: this.game.phase,
        playerCount: Object.keys(this.game.players).length,
      }
      return json(info)
    }

    if (request.method === 'GET' && path === '/ws') return this.handleUpgrade(request, url)

    const m = /^\/turns\/(\d+)\/strokes$/.exec(path)
    if (request.method === 'GET' && m) {
      const idx = Number(m[1])
      // A turn that exists but was never drawn on has no stored strokes.
      // That is an empty drawing, not a missing turn.
      const known = idx >= 0 && (idx < this.game.turns.length || idx === this.strokesTurn)
      if (!known) return json({ error: 'turn not found' }, 404)
      const strokes =
        idx === this.strokesTurn ? this.strokes : await this.ctx.storage.get<Stroke[]>(keyStrokes(idx))
      return json(strokes ?? [])
    }

    return json({ error: 'not found' }, 404)
  }

  private async handleCreate(request: Request): Promise<Response> {
    if (this.game && this.game.phase !== 'ended') return json({ error: 'room exists' }, 409)
    const body = (await request.json()) as CreateRoomRequest & { code: string }
    if (this.game) await this.destroy()
    this.game = createGame(body.code, sanitizeConfig(body.config))
    this.meta = { options: sanitizeRoomOptions(body.room), emptySince: null, endedAt: null }
    await this.ctx.storage.put({ [KEY_GAME]: this.game, [KEY_META]: this.meta })
    await this.scheduleAlarm()
    return json({ code: body.code }, 201)
  }

  private async handleUpgrade(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected websocket' }, 426)
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    setAttachment(server, { playerId: null })

    const playerId = url.searchParams.get('playerId')
    const secret = url.searchParams.get('secret')
    if (playerId !== null || secret !== null) {
      await this.handleReconnect(server, playerId ?? '', secret ?? '')
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  private async handleReconnect(ws: WebSocket, playerId: PlayerId, secret: string): Promise<void> {
    const expected = await this.ctx.storage.get<string>(keySecret(playerId))
    if (!this.game || !expected || expected !== secret || !this.game.players[playerId]) {
      send(ws, { type: 'error', message: 'unauthorized' })
      ws.close(CLOSE_UNAUTHORIZED, 'unauthorized')
      return
    }
    // One socket per player: retire any other.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && getAttachment(other).playerId === playerId) {
        other.close(CLOSE_REPLACED, 'replaced by a newer connection')
      }
    }
    setAttachment(ws, { playerId })
    await this.touchPresence()
    const r = apply(this.game, { type: 'reconnect', now: Date.now(), playerId })
    if (!r.error) await this.commit(r.state)
    else this.broadcastState()
    send(ws, { type: 'strokes', strokes: this.strokes, reset: true })
  }

  // -------------------------------------------------------------------------
  // WebSocket handlers (hibernation API)
  // -------------------------------------------------------------------------

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.game) {
      ws.close(CLOSE_ROOM_GONE, 'room gone')
      return
    }
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) {
      send(ws, { type: 'error', message: 'invalid message' })
      return
    }
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      send(ws, { type: 'error', message: 'invalid message: not JSON' })
      return
    }
    if (!isRecord(msg) || typeof msg['type'] !== 'string') {
      send(ws, { type: 'error', message: 'invalid message' })
      return
    }

    const { playerId } = getAttachment(ws)
    if (msg['type'] === 'join') return this.handleJoin(ws, playerId, msg)
    if (playerId === null) {
      send(ws, { type: 'error', message: 'join first' })
      return
    }
    if (msg['type'] === 'stroke') return this.handleStroke(ws, playerId, msg)
    if (msg['type'] === 'leave') return this.handleLeave(ws, playerId)

    const event = toGameEvent(msg, playerId, Date.now())
    if (typeof event === 'string') {
      send(ws, { type: 'error', message: event })
      return
    }
    const r = apply(this.game, event)
    if (r.error) {
      send(ws, { type: 'error', message: r.error })
      return
    }
    await this.commit(r.state)
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Complete the closing handshake; the hibernation API leaves that to us.
    try {
      ws.close(code, reason)
    } catch {
      /* already closed */
    }
    await this.handleGone(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleGone(ws)
  }

  private async handleJoin(ws: WebSocket, existing: PlayerId | null, msg: Record<string, unknown>): Promise<void> {
    if (existing !== null) {
      send(ws, { type: 'error', message: 'already joined' })
      return
    }
    const name = typeof msg['name'] === 'string' ? msg['name'] : ''
    const avatar = typeof msg['avatar'] === 'string' ? msg['avatar'] : ''
    const playerId = crypto.randomUUID().slice(0, 8)
    const r = apply(this.game!, { type: 'join', now: Date.now(), playerId, name, avatar })
    if (r.error) {
      send(ws, { type: 'error', message: r.error })
      return
    }
    const secret = crypto.randomUUID()
    await this.ctx.storage.put(keySecret(playerId), secret)
    setAttachment(ws, { playerId })
    await this.touchPresence()
    send(ws, { type: 'welcome', playerId, secret })
    await this.commit(r.state)
    send(ws, { type: 'strokes', strokes: this.strokes, reset: true })
  }

  private async handleStroke(ws: WebSocket, playerId: PlayerId, msg: Record<string, unknown>): Promise<void> {
    const strokes = msg['strokes']
    if (!Array.isArray(strokes) || !strokes.every(isStroke)) {
      send(ws, { type: 'error', message: 'invalid stroke batch' })
      return
    }
    const game = this.game!
    // Silently drop anything that isn't the current drawer, mid-drawing.
    if (game.phase !== 'drawing' || game.turn?.drawerId !== playerId) return
    if (this.strokes.length + strokes.length > MAX_STROKES_PER_TURN) return

    this.strokes.push(...strokes)
    void this.ctx.storage.put(keyStrokes(this.strokesTurn), this.strokes)
    const out = JSON.stringify({ type: 'strokes', strokes } satisfies ServerMessage)
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) safeSend(other, out)
    }
  }

  private async handleLeave(ws: WebSocket, playerId: PlayerId): Promise<void> {
    const r = apply(this.game!, { type: 'leave', now: Date.now(), playerId })
    if (r.error) {
      send(ws, { type: 'error', message: r.error })
      return
    }
    await this.ctx.storage.delete(keySecret(playerId))
    setAttachment(ws, { playerId: null })
    ws.close(CLOSE_LEFT, 'left')
    await this.commit(r.state)
    await this.touchPresence(ws)
  }

  /** A socket is gone (closed or errored). */
  private async handleGone(ws: WebSocket): Promise<void> {
    const { playerId } = getAttachment(ws)
    if (playerId !== null && this.game?.players[playerId]) {
      const stillConnected = this.ctx
        .getWebSockets()
        .some((other) => other !== ws && other.readyState === WebSocket.READY_STATE_OPEN && getAttachment(other).playerId === playerId)
      if (!stillConnected) {
        const r = apply(this.game, { type: 'disconnect', now: Date.now(), playerId })
        if (!r.error) await this.commit(r.state)
      }
    }
    await this.touchPresence(ws)
  }

  // -------------------------------------------------------------------------
  // State, broadcast, alarms
  // -------------------------------------------------------------------------

  /** Persist a new game state, keep the stroke buffer aligned, broadcast, re-arm. */
  private async commit(next: GameState): Promise<void> {
    const prev = this.game
    this.game = next
    const puts: Record<string, unknown> = { [KEY_GAME]: next }

    const turnIdx = liveTurnIndex(next)
    let resetStrokes = false
    if (turnIdx !== this.strokesTurn) {
      this.strokes = []
      this.strokesTurn = turnIdx
      resetStrokes = turnIdx >= 0
    }
    if (next.phase === 'ended' && prev?.phase !== 'ended' && this.meta) {
      this.meta = { ...this.meta, endedAt: Date.now() }
      puts[KEY_META] = this.meta
    }
    await this.ctx.storage.put(puts)

    // Reset goes first so clients clear the canvas before rendering the new phase.
    if (resetStrokes) this.broadcast({ type: 'strokes', strokes: [], reset: true })
    this.broadcastState()
    await this.scheduleAlarm()
  }

  private broadcastState(): void {
    const game = this.game
    if (!game) return
    const now = Date.now()
    for (const ws of this.ctx.getWebSockets()) {
      const { playerId } = getAttachment(ws)
      safeSend(ws, JSON.stringify({ type: 'state', state: project(game, playerId), now } satisfies ServerMessage))
    }
  }

  private broadcast(msg: ServerMessage): void {
    const out = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) safeSend(ws, out)
  }

  /** Recompute whether the room is empty; `leaving` is a socket on its way out. */
  private async touchPresence(leaving?: WebSocket): Promise<void> {
    if (!this.meta) return
    const anyone = this.ctx
      .getWebSockets()
      .some((ws) => ws !== leaving && ws.readyState === WebSocket.READY_STATE_OPEN && getAttachment(ws).playerId !== null)
    const emptySince = anyone ? null : (this.meta.emptySince ?? Date.now())
    if (emptySince !== this.meta.emptySince) {
      this.meta = { ...this.meta, emptySince }
      await this.ctx.storage.put(KEY_META, this.meta)
      await this.scheduleAlarm()
    }
  }

  override async alarm(): Promise<void> {
    const now = Date.now()

    // Game timers: the reducer processes one deadline per call.
    if (this.game) {
      let state = this.game
      let changed = false
      for (let i = 0; i < 16; i++) {
        const at = nextAlarmAt(state)
        if (at === null || at > now) break
        const r = apply(state, { type: 'timeout', now })
        if (r.error || r.state === state) break
        state = r.state
        changed = true
      }
      if (changed) await this.commit(state)
    }

    // Garbage collection.
    if (this.meta && this.game) {
      const { options, emptySince, endedAt } = this.meta
      const idleExpired = emptySince !== null && now - emptySince >= options.idleTtlMs
      const endedExpired = endedAt !== null && now - endedAt >= options.endedTtlMs
      if (idleExpired || endedExpired) {
        await this.destroy()
        return
      }
    }

    await this.scheduleAlarm()
  }

  private async scheduleAlarm(): Promise<void> {
    const candidates: number[] = []
    if (this.game) {
      const at = nextAlarmAt(this.game)
      if (at !== null) candidates.push(at)
    }
    if (this.meta) {
      if (this.meta.emptySince !== null) candidates.push(this.meta.emptySince + this.meta.options.idleTtlMs)
      if (this.meta.endedAt !== null) candidates.push(this.meta.endedAt + this.meta.options.endedTtlMs)
    }
    if (candidates.length === 0) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(Math.max(Math.min(...candidates), Date.now() + 1))
  }

  private async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_ROOM_GONE, 'room closed')
      } catch {
        /* already closed */
      }
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.game = null
    this.meta = null
    this.strokes = []
    this.strokesTurn = -1
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index in `turns` that the live turn has (reveal) or will have (drawing/judging). */
function liveTurnIndex(game: GameState): number {
  switch (game.phase) {
    case 'drawing':
    case 'judging':
      return game.turns.length
    case 'reveal':
      return game.turns.length - 1
    default:
      return -1
  }
}

function toGameEvent(msg: Record<string, unknown>, playerId: PlayerId, now: number): GameEvent | string {
  const str = (k: string) => (typeof msg[k] === 'string' ? (msg[k] as string) : null)
  const seed = () => crypto.getRandomValues(new Uint32Array(1))[0]!
  switch (msg['type'] as ClientMessage['type']) {
    case 'set_ready':
      if (typeof msg['ready'] !== 'boolean') return 'invalid message: ready must be boolean'
      return { type: 'set_ready', now, playerId, ready: msg['ready'] }
    case 'start_game':
      return { type: 'start_game', now, playerId, seed: seed() }
    case 'next_round':
      return { type: 'next_round', now, playerId, seed: seed() }
    case 'set_intent': {
      const text = str('text')
      if (text === null) return 'invalid message: text must be a string'
      return { type: 'set_intent', now, playerId, text }
    }
    case 'submit_guess': {
      const text = str('text')
      if (text === null) return 'invalid message: text must be a string'
      return { type: 'submit_guess', now, playerId, text }
    }
    case 'judge': {
      const funniestGuessId = str('funniestGuessId')
      if (funniestGuessId === null) return 'invalid message: funniestGuessId required'
      const correct = msg['correctGuessId']
      if (correct !== undefined && correct !== null && typeof correct !== 'string') {
        return 'invalid message: correctGuessId must be a string'
      }
      return { type: 'judge', now, playerId, funniestGuessId, correctGuessId: (correct as string | null | undefined) ?? null }
    }
    case 'end_drawing':
    case 'advance':
    case 'end_game':
      return { type: msg['type'] as 'end_drawing' | 'advance' | 'end_game', now, playerId }
    default:
      return `unknown message type: ${String(msg['type'])}`
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isStroke(x: unknown): x is Stroke {
  if (!isRecord(x)) return false
  const num = (k: string) => typeof x[k] === 'number' && Number.isFinite(x[k])
  switch (x['t']) {
    case 'down':
      return num('x') && num('y') && typeof x['color'] === 'string' && num('width')
    case 'move':
      return num('x') && num('y')
    case 'up':
    case 'clear':
      return true
    default:
      return false
  }
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt

function sanitizeConfig(c: Partial<GameConfig> | undefined): Partial<GameConfig> {
  if (!isRecord(c)) return {}
  const d = DEFAULT_CONFIG
  const hour = 3_600_000
  return {
    drawingMs: clamp(c.drawingMs, 1, hour, d.drawingMs),
    judgingMs: clamp(c.judgingMs, 1, hour, d.judgingMs),
    revealMs: clamp(c.revealMs, 1, hour, d.revealMs),
    graceMs: clamp(c.graceMs, 1, hour, d.graceMs),
    minPlayers: clamp(c.minPlayers, 2, 100, d.minPlayers),
    guessMaxLen: clamp(c.guessMaxLen, 1, 500, d.guessMaxLen),
    nameMaxLen: clamp(c.nameMaxLen, 1, 100, d.nameMaxLen),
    correctPoints: clamp(c.correctPoints, 0, 100, d.correctPoints),
    funniestPoints: clamp(c.funniestPoints, 0, 100, d.funniestPoints),
  }
}

function sanitizeRoomOptions(o: Partial<RoomOptions> | undefined): RoomOptions {
  const d = DEFAULT_ROOM_OPTIONS
  const week = 7 * 24 * 3_600_000
  if (!isRecord(o)) return d
  return {
    idleTtlMs: clamp(o.idleTtlMs, 1, week, d.idleTtlMs),
    endedTtlMs: clamp(o.endedTtlMs, 1, week, d.endedTtlMs),
  }
}

function getAttachment(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { playerId: null }
}

function setAttachment(ws: WebSocket, a: Attachment): void {
  ws.serializeAttachment(a)
}

function send(ws: WebSocket, msg: ServerMessage): void {
  safeSend(ws, JSON.stringify(msg))
}

function safeSend(ws: WebSocket, text: string): void {
  try {
    ws.send(text)
  } catch {
    /* socket already closing */
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
