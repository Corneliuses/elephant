/**
 * The Elephant game state machine.
 *
 * Pure: no clock, no randomness (seeds are passed in), no I/O. Every
 * function returns new objects and never mutates its input. See
 * docs/DESIGN.md for the phase diagram and the events table.
 */
import { DEFAULT_CONFIG } from './config'
import { shuffle } from './random'
import type {
  ApplyResult,
  GameConfig,
  GameEvent,
  GameState,
  Guess,
  Phase,
  Player,
  PlayerId,
  ProjectedState,
  ProjectedTurn,
  Turn,
} from './types'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createGame(code: string, config: Partial<GameConfig> = {}): GameState {
  return {
    code,
    config: { ...DEFAULT_CONFIG, ...config },
    phase: 'lobby',
    organizerId: null,
    players: {},
    round: 0,
    drawOrder: [],
    drawerIdx: 0,
    turn: null,
    turns: [],
    timerEndsAt: null,
    graceEndsAt: null,
    nextGuessSeq: 1,
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const CONNECTION_EVENTS = new Set<GameEvent['type']>(['timeout', 'disconnect', 'reconnect', 'leave'])
const LIVE_PHASES: readonly Phase[] = ['drawing', 'judging', 'reveal']

export function apply(state: GameState, event: GameEvent): ApplyResult {
  if (state.phase === 'ended' && !CONNECTION_EVENTS.has(event.type)) {
    return fail(state, 'game has ended')
  }

  switch (event.type) {
    case 'join':
      return join(state, event)
    case 'set_ready':
      return setReady(state, event)
    case 'start_game':
      return startGame(state, event)
    case 'set_intent':
      return setIntent(state, event)
    case 'submit_guess':
      return submitGuess(state, event)
    case 'end_drawing':
      return endDrawing(state, event)
    case 'judge':
      return judge(state, event)
    case 'grade':
      return grade(state, event)
    case 'advance':
      return advance(state, event)
    case 'next_round':
      return nextRound(state, event)
    case 'end_game':
      return endGame(state, event)
    case 'disconnect':
      return disconnect(state, event)
    case 'reconnect':
      return reconnect(state, event)
    case 'leave':
      return leave(state, event)
    case 'timeout':
      return timeout(state, event)
  }
}

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>

function ok(state: GameState): ApplyResult {
  return { state }
}
function fail(state: GameState, error: string): ApplyResult {
  return { state, error }
}

// --- Lobby -----------------------------------------------------------------

function join(state: GameState, ev: Ev<'join'>): ApplyResult {
  if (state.players[ev.playerId]) return fail(state, 'player already joined')
  const name = ev.name.trim()
  if (name.length === 0 || name.length > state.config.nameMaxLen) return fail(state, 'invalid name')
  const avatar = ev.avatar.trim()
  if (avatar.length === 0) return fail(state, 'invalid avatar')

  const player: Player = {
    id: ev.playerId,
    name,
    avatar,
    ready: false,
    connected: true,
    joinedAt: ev.now,
    score: 0,
  }
  return ok({
    ...state,
    players: { ...state.players, [player.id]: player },
    organizerId: state.organizerId ?? player.id,
  })
}

function setReady(state: GameState, ev: Ev<'set_ready'>): ApplyResult {
  const player = state.players[ev.playerId]
  if (!player) return fail(state, 'unknown player')

  if (state.phase === 'lobby') {
    return ok(setPlayer(state, player.id, { ready: ev.ready }))
  }
  if (!ev.ready) return fail(state, 'can only un-ready in the lobby')

  let next = setPlayer(state, player.id, { ready: true })
  if (LIVE_PHASES.includes(state.phase) && !state.drawOrder.includes(player.id)) {
    next = { ...next, drawOrder: [...state.drawOrder, player.id] }
  }
  return ok(next)
}

function startGame(state: GameState, ev: Ev<'start_game'>): ApplyResult {
  if (state.phase !== 'lobby') return fail(state, 'can only start from the lobby')
  if (ev.playerId !== state.organizerId) return fail(state, 'only the organizer can start the game')
  const eligible = eligiblePlayers(state)
  if (eligible.length < state.config.minPlayers) {
    return fail(state, `need at least ${state.config.minPlayers} ready, connected players`)
  }
  return ok(startRound(state, shuffle(eligible, ev.seed), 1, ev.now))
}

// --- Drawing ---------------------------------------------------------------

function setIntent(state: GameState, ev: Ev<'set_intent'>): ApplyResult {
  if (state.phase !== 'drawing' || !state.turn) return fail(state, 'not in drawing phase')
  if (ev.playerId !== state.turn.drawerId) return fail(state, 'only the drawer can set intent')
  const text = ev.text.trim().slice(0, state.config.guessMaxLen)
  return ok({ ...state, turn: { ...state.turn, intent: text.length > 0 ? text : null } })
}

function submitGuess(state: GameState, ev: Ev<'submit_guess'>): ApplyResult {
  if (state.phase !== 'drawing' || !state.turn) return fail(state, 'not in drawing phase')
  const player = state.players[ev.playerId]
  if (!player) return fail(state, 'unknown player')
  if (ev.playerId === state.turn.drawerId) return fail(state, 'the drawer cannot guess')
  if (!player.ready) return fail(state, 'player is not ready')
  const text = ev.text.trim()
  if (text.length === 0 || text.length > state.config.guessMaxLen) return fail(state, 'invalid guess')

  const existing = state.turn.guesses.find((g) => g.playerId === player.id)
  const others = state.turn.guesses.filter((g) => g.playerId !== player.id)
  const guess: Guess = existing
    ? { ...existing, text, submittedAt: ev.now }
    : { id: `g${state.nextGuessSeq}`, playerId: player.id, text, submittedAt: ev.now }

  return ok({
    ...state,
    nextGuessSeq: existing ? state.nextGuessSeq : state.nextGuessSeq + 1,
    turn: { ...state.turn, guesses: [...others, guess] },
  })
}

function endDrawing(state: GameState, ev: Ev<'end_drawing'>): ApplyResult {
  if (state.phase !== 'drawing' || !state.turn) return fail(state, 'not in drawing phase')
  if (ev.playerId !== state.turn.drawerId) return fail(state, 'only the drawer can end drawing')
  // The grader compares guesses against this, so there is nothing to grade
  // without it. The client keeps "Done" disabled until it is set.
  if (state.turn.intent === null) return fail(state, 'say what you are drawing first')
  return ok(finishDrawing(state, ev.now))
}

// --- Judging ---------------------------------------------------------------

/** The drawer's only call: which answer they liked most. */
function judge(state: GameState, ev: Ev<'judge'>): ApplyResult {
  if (state.phase !== 'judging' || !state.turn) return fail(state, 'not in judging phase')
  const turn = state.turn
  if (ev.playerId !== turn.drawerId) return fail(state, 'only the drawer can judge')

  const favorite = turn.guesses.find((g) => g.id === ev.favoriteGuessId)
  if (!favorite) return fail(state, 'unknown guess id')

  // The same guess may be both correct and the favorite, and then earns both.
  const next = addScore(state, favorite.playerId, state.config.favoritePoints)
  return ok(enterReveal({ ...next, turn: { ...turn, favoriteGuessId: favorite.id } }, ev.now))
}

/**
 * The grader's verdict, applied by the transport. Accepted during judging or
 * reveal: grading runs concurrently with the drawer's choice, so it can land
 * on either side of it.
 */
function grade(state: GameState, ev: Ev<'grade'>): ApplyResult {
  const live = state.turn
  if (!live) return fail(state, 'no turn to grade')
  if (state.phase !== 'judging' && state.phase !== 'reveal') return fail(state, 'not gradeable now')
  if (live.grading !== 'pending') return fail(state, 'already graded')

  const correct = ev.correctGuessId === null ? null : live.guesses.find((g) => g.id === ev.correctGuessId)
  if (ev.correctGuessId !== null && !correct) return fail(state, 'unknown guess id')

  const turn: Turn = {
    ...live,
    grading: ev.ok ? 'done' : 'unavailable',
    correctGuessId: ev.ok ? (correct?.id ?? null) : null,
  }
  let next: GameState = { ...state, turn }
  // During reveal the live turn is already recorded, so keep both in step.
  if (state.phase === 'reveal') {
    next = { ...next, turns: [...state.turns.slice(0, -1), turn] }
  }
  if (correct && ev.ok) next = addScore(next, correct.playerId, state.config.correctPoints)
  return ok(next)
}

// --- Reveal / round end ----------------------------------------------------

function advance(state: GameState, ev: Ev<'advance'>): ApplyResult {
  if (state.phase !== 'reveal') return fail(state, 'not in reveal phase')
  if (ev.playerId !== state.organizerId) return fail(state, 'only the organizer can advance')
  return ok(beginTurn(state, state.drawerIdx + 1, ev.now))
}

function nextRound(state: GameState, ev: Ev<'next_round'>): ApplyResult {
  if (state.phase !== 'round_end') return fail(state, 'not in round_end phase')
  if (ev.playerId !== state.organizerId) return fail(state, 'only the organizer can start a round')
  const eligible = eligiblePlayers(state)
  if (eligible.length < state.config.minPlayers) {
    return fail(state, `need at least ${state.config.minPlayers} ready, connected players`)
  }
  return ok(startRound(state, shuffle(eligible, ev.seed), state.round + 1, ev.now))
}

function endGame(state: GameState, ev: Ev<'end_game'>): ApplyResult {
  if (state.phase !== 'round_end') return fail(state, 'not in round_end phase')
  if (ev.playerId !== state.organizerId) return fail(state, 'only the organizer can end the game')
  return ok({ ...state, phase: 'ended', turn: null, timerEndsAt: null, graceEndsAt: null })
}

// --- Connections -----------------------------------------------------------

function disconnect(state: GameState, ev: Ev<'disconnect'>): ApplyResult {
  const player = state.players[ev.playerId]
  if (!player) return fail(state, 'unknown player')

  let next = setPlayer(state, player.id, { connected: false })
  if (state.organizerId === player.id) next = promoteOrganizer(next)
  if (isJudgeablePhase(state) && state.turn?.drawerId === player.id) {
    next = { ...next, graceEndsAt: ev.now + state.config.graceMs }
  }
  return ok(next)
}

function reconnect(state: GameState, ev: Ev<'reconnect'>): ApplyResult {
  const player = state.players[ev.playerId]
  if (!player) return fail(state, 'unknown player')

  let next = setPlayer(state, player.id, { connected: true })
  if (state.turn?.drawerId === player.id && state.graceEndsAt !== null) {
    next = { ...next, graceEndsAt: null }
  }
  return ok(next)
}

function leave(state: GameState, ev: Ev<'leave'>): ApplyResult {
  const player = state.players[ev.playerId]
  if (!player) return fail(state, 'unknown player')

  const { [player.id]: _removed, ...players } = state.players
  let next: GameState = { ...state, players }
  if (state.organizerId === player.id) next = promoteOrganizer(next)

  if (next.turn) {
    next = { ...next, turn: { ...next.turn, guesses: next.turn.guesses.filter((g) => g.playerId !== player.id) } }
  }

  const idx = next.drawOrder.indexOf(player.id)
  if (idx === -1) return ok(next)

  const drawOrder = next.drawOrder.filter((id) => id !== player.id)
  if (idx < next.drawerIdx) {
    return ok({ ...next, drawOrder, drawerIdx: next.drawerIdx - 1 })
  }
  if (idx > next.drawerIdx) {
    return ok({ ...next, drawOrder })
  }
  // The leaver is the current drawer.
  if (isJudgeablePhase(next) && next.turn) {
    // Their turn is abandoned; the slot they vacated now holds the next drawer.
    return ok(beginTurn(recordSkipped({ ...next, drawOrder }), idx, ev.now))
  }
  // Reveal (turn already recorded) or a finished round: keep the pointer
  // just before the vacated slot so the next advance lands on the right player.
  return ok({ ...next, drawOrder, drawerIdx: idx - 1 })
}

// --- Timers ----------------------------------------------------------------

function timeout(state: GameState, ev: Ev<'timeout'>): ApplyResult {
  const mainDue = state.timerEndsAt !== null && ev.now >= state.timerEndsAt
  const graceDue = state.graceEndsAt !== null && ev.now >= state.graceEndsAt
  if (!mainDue && !graceDue) return ok(state)

  // When both have passed, honour the earlier deadline first; the DO will
  // call again for the other one.
  const graceFirst = graceDue && (!mainDue || state.graceEndsAt! <= state.timerEndsAt!)

  if (graceFirst) {
    const drawerGone = state.turn && !state.players[state.turn.drawerId]?.connected
    if (isJudgeablePhase(state) && drawerGone) {
      return ok(beginTurn(recordSkipped(state), state.drawerIdx + 1, ev.now))
    }
    // Stale grace (drawer came back, or phase moved on): just clear it.
    return ok({ ...state, graceEndsAt: null })
  }

  switch (state.phase) {
    case 'drawing':
      return ok(finishDrawing(state, ev.now))
    case 'judging':
      return ok(enterReveal(state, ev.now))
    case 'reveal':
      return ok(beginTurn(state, state.drawerIdx + 1, ev.now))
    default:
      return ok({ ...state, timerEndsAt: null })
  }
}

/** Earliest pending deadline, for the DO to schedule its alarm. */
export function nextAlarmAt(state: GameState): number | null {
  const deadlines = [state.timerEndsAt, state.graceEndsAt].filter((t): t is number => t !== null)
  return deadlines.length === 0 ? null : Math.min(...deadlines)
}

// ---------------------------------------------------------------------------
// Transitions shared by several events
// ---------------------------------------------------------------------------

function startRound(state: GameState, order: PlayerId[], round: number, now: number): GameState {
  return beginTurn({ ...state, round, drawOrder: order, turn: null, graceEndsAt: null }, 0, now)
}

/**
 * Start the turn at `idx`, skipping over disconnected drawers. If nobody is
 * left, end the round.
 */
function beginTurn(state: GameState, idx: number, now: number): GameState {
  let next = state
  while (idx < next.drawOrder.length) {
    const drawerId = next.drawOrder[idx]!
    if (next.players[drawerId]?.connected) {
      const turn: Turn = {
        round: next.round,
        drawerId,
        intent: null,
        guesses: [],
        correctGuessId: null,
        grading: 'pending',
        favoriteGuessId: null,
        skipped: false,
      }
      return {
        ...next,
        phase: 'drawing',
        drawerIdx: idx,
        turn,
        timerEndsAt: now + next.config.drawingMs,
        graceEndsAt: null,
      }
    }
    next = {
      ...next,
      turns: [
        ...next.turns,
        {
          round: next.round,
          drawerId,
          intent: null,
          guesses: [],
          correctGuessId: null,
          grading: 'unavailable',
          favoriteGuessId: null,
          skipped: true,
        },
      ],
    }
    idx++
  }
  return {
    ...next,
    phase: 'round_end',
    drawerIdx: next.drawOrder.length,
    turn: null,
    timerEndsAt: null,
    graceEndsAt: null,
  }
}

/** Drawing is over: judge if there is anything to judge, else straight to reveal. */
function finishDrawing(state: GameState, now: number): GameState {
  if (!state.turn || state.turn.guesses.length === 0) {
    // Nothing to grade, so settle it here rather than leaving the turn
    // waiting for a verdict that will never be asked for.
    const settled = state.turn ? { ...state, turn: { ...state.turn, grading: 'done' as const } } : state
    return enterReveal(settled, now)
  }
  return { ...state, phase: 'judging', timerEndsAt: now + state.config.judgingMs }
}

/** The live turn is final; record it and show the reveal screen. */
function enterReveal(state: GameState, now: number): GameState {
  const turn = state.turn!
  return {
    ...state,
    phase: 'reveal',
    turn,
    turns: [...state.turns, turn],
    timerEndsAt: now + state.config.revealMs,
    graceEndsAt: null,
  }
}

/** Abandon the live turn (drawer gone) and record it as skipped. */
function recordSkipped(state: GameState): GameState {
  const turn: Turn = { ...state.turn!, skipped: true, grading: 'unavailable' }
  return { ...state, turn: null, turns: [...state.turns, turn], graceEndsAt: null }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isJudgeablePhase(state: GameState): boolean {
  return state.phase === 'drawing' || state.phase === 'judging'
}

function eligiblePlayers(state: GameState): PlayerId[] {
  return Object.values(state.players)
    .filter((p) => p.ready && p.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => p.id)
}

function setPlayer(state: GameState, id: PlayerId, patch: Partial<Player>): GameState {
  const player = state.players[id]
  if (!player) return state
  return { ...state, players: { ...state.players, [id]: { ...player, ...patch } } }
}

function addScore(state: GameState, id: PlayerId, points: number): GameState {
  const player = state.players[id]
  if (!player) return state
  return setPlayer(state, id, { score: player.score + points })
}

/**
 * Hand the organizer role to the longest-connected other player. If nobody
 * else is connected, the current organizer keeps it (or, if they have left,
 * the earliest-joined remaining player gets it).
 */
function promoteOrganizer(state: GameState): GameState {
  const byJoin = Object.values(state.players).sort((a, b) => a.joinedAt - b.joinedAt)
  const candidate =
    byJoin.find((p) => p.connected && p.id !== state.organizerId) ??
    (state.organizerId !== null && state.players[state.organizerId] ? null : byJoin[0])
  return candidate ? { ...state, organizerId: candidate.id } : state
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * The state as one viewer is allowed to see it. Hides guess authorship
 * (except the viewer's own) and the drawer's intent until the reveal.
 */
export function project(state: GameState, viewerId: PlayerId | null): ProjectedState {
  const { turn, nextGuessSeq: _seq, ...rest } = state
  const revealed = !LIVE_PHASES.includes(state.phase) || state.phase === 'reveal'

  const projectTurn = (t: Turn, everything: boolean): ProjectedTurn => ({
    ...t,
    intent: everything || t.drawerId === viewerId ? t.intent : null,
    // Nobody sees the verdict before the reveal, drawer included: it would
    // colour their favourite pick and spoil the moment.
    correctGuessId: everything ? t.correctGuessId : null,
    guesses: t.guesses.map((g) => ({
      ...g,
      playerId: everything || g.playerId === viewerId ? g.playerId : null,
    })),
  })

  return {
    ...rest,
    turns: state.turns.map((t) => projectTurn(t, true)),
    turn: turn ? projectTurn(turn, revealed) : null,
    you: viewerId,
  }
}
