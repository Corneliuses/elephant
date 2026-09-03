/*
 * The one piece of shared state in the app: a live connection to a RoomDO
 * plus the latest projected game state it sent us.
 *
 * The `.svelte.ts` extension is what lets runes ($state/$derived) work in a
 * plain module. A single instance is exported at the bottom — no provider,
 * no context, no store subscriptions. Components import it and read it.
 */
import type { PlayerId, ProjectedState } from '$shared/game/types'
import { CLOSE_LEFT, CLOSE_ROOM_GONE, CLOSE_UNAUTHORIZED } from '$shared/room/protocol'
import type { ClientMessage, ServerMessage, Stroke } from '$shared/room/protocol'
import { clock } from './clock.svelte'

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'gone'

interface Creds {
  playerId: PlayerId
  secret: string
}

const credsKey = (code: string) => `elephant:creds:${code}`

function loadCreds(code: string): Creds | null {
  try {
    const raw = localStorage.getItem(credsKey(code))
    return raw ? (JSON.parse(raw) as Creds) : null
  } catch {
    return null
  }
}

function saveCreds(code: string, creds: Creds): void {
  try {
    localStorage.setItem(credsKey(code), JSON.stringify(creds))
  } catch {
    /* private mode; the session still works until reload */
  }
}

function clearCreds(code: string): void {
  try {
    localStorage.removeItem(credsKey(code))
  } catch {
    /* ignore */
  }
}

const RECONNECT_BASE_MS = 300
const RECONNECT_MAX_MS = 5_000

class Room {
  /* --- reactive fields. Assigning to these updates the DOM. --- */
  code = $state<string | null>(null)
  status = $state<Status>('idle')
  game = $state<ProjectedState | null>(null)
  strokes = $state<Stroke[]>([])
  /** Bumped whenever the buffer is replaced, so the canvas knows to repaint. */
  strokeEpoch = $state(0)
  /** Last server-rejected action, shown then cleared by the UI. */
  error = $state<string | null>(null)

  /* --- derived: recomputed automatically, cached, no dependency array --- */
  me = $derived(this.game && this.game.you ? (this.game.players[this.game.you] ?? null) : null)
  phase = $derived(this.game?.phase ?? null)
  isOrganizer = $derived(!!this.game && this.game.you === this.game.organizerId)
  isDrawer = $derived(!!this.game?.turn && this.game.turn.drawerId === this.game.you)
  /** Socket is up but we have not identified ourselves yet. */
  needsJoin = $derived(this.status === 'open' && this.game === null)
  /** Everyone in the room, longest-standing first. */
  players = $derived(
    Object.values(this.game?.players ?? {}).sort((a, b) => a.joinedAt - b.joinedAt),
  )
  /** Leaderboard order: score first, then join order as a stable tiebreak. */
  ranked = $derived(
    [...this.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt),
  )

  #ws: WebSocket | null = null
  #retry = 0
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #deliberate = false

  connect(code: string): void {
    if (this.code === code && this.#ws) return
    this.disconnect()
    this.code = code
    this.#deliberate = false
    this.#open()
    // Phones lock and browsers drop sockets. Coming back to the tab is the
    // strongest hint that we should re-check the connection immediately
    // rather than waiting out a backoff.
    document.addEventListener('visibilitychange', this.#onVisible)
    window.addEventListener('online', this.#onVisible)
  }

  disconnect(): void {
    this.#deliberate = true
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#retryTimer = null
    document.removeEventListener('visibilitychange', this.#onVisible)
    window.removeEventListener('online', this.#onVisible)
    this.#ws?.close()
    this.#ws = null
  }

  /** Identify to the server. Only needed when `needsJoin` is true. */
  join(name: string, avatar: string): void {
    this.send({ type: 'join', name, avatar })
  }

  send(msg: ClientMessage): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(msg))
  }

  /** Leave for good: tells the server, then forgets our credentials. */
  leave(): void {
    const code = this.code
    this.send({ type: 'leave' })
    if (code) clearCreds(code)
    this.disconnect()
    this.game = null
    this.code = null
    this.status = 'idle'
  }

  #onVisible = (): void => {
    if (document.visibilityState !== 'visible') return
    if (!this.#ws || this.#ws.readyState > WebSocket.OPEN) {
      if (this.#retryTimer) clearTimeout(this.#retryTimer)
      this.#retry = 0
      this.#open()
    }
  }

  #open(): void {
    const code = this.code
    if (!code || this.#deliberate) return

    const creds = loadCreds(code)
    const q = creds
      ? `?playerId=${encodeURIComponent(creds.playerId)}&secret=${encodeURIComponent(creds.secret)}`
      : ''
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${scheme}//${location.host}/api/rooms/${code}/ws${q}`)
    this.#ws = ws
    this.status = this.game ? 'reconnecting' : 'connecting'

    ws.addEventListener('open', () => {
      this.#retry = 0
      this.status = 'open'
    })

    ws.addEventListener('message', (e) => {
      this.#receive(JSON.parse(e.data as string) as ServerMessage, code)
    })

    ws.addEventListener('close', (e) => {
      if (this.#ws !== ws) return
      this.#ws = null
      if (e.code === CLOSE_UNAUTHORIZED) {
        // Stale credentials: forget them so the next attempt joins fresh.
        clearCreds(code)
        this.game = null
        this.#scheduleRetry()
        return
      }
      if (e.code === CLOSE_ROOM_GONE) {
        this.status = 'gone'
        return
      }
      if (e.code === CLOSE_LEFT || this.#deliberate) {
        this.status = 'idle'
        return
      }
      this.#scheduleRetry()
    })
  }

  #receive(msg: ServerMessage, code: string): void {
    switch (msg.type) {
      case 'welcome':
        saveCreds(code, { playerId: msg.playerId, secret: msg.secret })
        break
      case 'state':
        this.game = msg.state
        // Phones' clocks drift. Deadlines arrive as server epoch ms, so
        // track the offset and render countdowns against corrected time.
        clock.sync(msg.now)
        break
      case 'strokes':
        // A reset means "replace what you have" — sent on join and whenever
        // a new turn starts, always before the state that announces it.
        if (msg.reset) {
          this.strokes = msg.strokes
          this.strokeEpoch++
        } else {
          // Mutating is fine: $state is deeply reactive, and appending beats
          // rebuilding the array 20x a second during a live drawing.
          this.strokes.push(...msg.strokes)
        }
        break
      case 'error':
        this.error = msg.message
        break
    }
  }

  #scheduleRetry(): void {
    if (this.#deliberate) return
    this.status = 'reconnecting'
    const wait = Math.min(RECONNECT_BASE_MS * 2 ** this.#retry, RECONNECT_MAX_MS)
    this.#retry++
    this.#retryTimer = setTimeout(() => this.#open(), wait)
  }
}

export const room = new Room()
