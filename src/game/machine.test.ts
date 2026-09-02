import { describe, expect, it } from 'vitest'
import { apply, createGame, nextAlarmAt, project } from './machine'
import { DEFAULT_CONFIG } from './config'
import type { GameEvent, GameState, GuessId, PlayerId } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = 1_000_000
const CFG = DEFAULT_CONFIG

/** Apply a chain of events, asserting none of them error. */
function run(state: GameState, ...events: GameEvent[]): GameState {
  for (const ev of events) {
    const r = apply(state, ev)
    if (r.error) throw new Error(`unexpected error on ${ev.type}: ${r.error}`)
    state = r.state
  }
  return state
}

/** Apply one event and return the error message (or undefined). */
function fails(state: GameState, ev: GameEvent): string | undefined {
  const r = apply(state, ev)
  // State must be unchanged when an error is returned.
  if (r.error) expect(r.state).toBe(state)
  return r.error
}

function join(playerId: PlayerId, now = T0): GameEvent {
  return { type: 'join', now, playerId, name: playerId.toUpperCase(), avatar: '🐘' }
}
function ready(playerId: PlayerId, ready = true, now = T0): GameEvent {
  return { type: 'set_ready', now, playerId, ready }
}
function guess(playerId: PlayerId, text: string, now = T0 + 1000): GameEvent {
  return { type: 'submit_guess', now, playerId, text }
}

/** Lobby with players a, b, c, d — a is organizer; a, b, c ready; d not ready. */
function lobby(): GameState {
  return run(
    createGame('ABCD'),
    join('a', T0),
    join('b', T0 + 1),
    join('c', T0 + 2),
    join('d', T0 + 3),
    ready('a'),
    ready('b'),
    ready('c'),
  )
}

/** A game in the drawing phase with a, b, c in the order given. */
function drawing(order: PlayerId[] = ['a', 'b', 'c'], now = T0 + 10): GameState {
  let s = lobby()
  // Find a seed that yields the requested order so tests can be explicit.
  for (let seed = 0; seed < 500; seed++) {
    const r = apply(s, { type: 'start_game', now, playerId: 'a', seed })
    if (r.error) throw new Error(r.error)
    if (r.state.drawOrder.join() === order.join()) return r.state
  }
  throw new Error(`no seed produced order ${order.join()}`)
}

function drawerOf(s: GameState): PlayerId {
  return s.drawOrder[s.drawerIdx]!
}
function guessIds(s: GameState): GuessId[] {
  return s.turn!.guesses.map((g) => g.id)
}

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

describe('createGame', () => {
  it('starts in the lobby with no players', () => {
    const s = createGame('ABCD')
    expect(s.code).toBe('ABCD')
    expect(s.phase).toBe('lobby')
    expect(s.players).toEqual({})
    expect(s.organizerId).toBeNull()
    expect(s.round).toBe(0)
    expect(s.drawOrder).toEqual([])
    expect(s.turn).toBeNull()
    expect(s.turns).toEqual([])
    expect(s.timerEndsAt).toBeNull()
    expect(s.config).toEqual(DEFAULT_CONFIG)
  })

  it('accepts config overrides', () => {
    const s = createGame('ABCD', { drawingMs: 5 })
    expect(s.config.drawingMs).toBe(5)
    expect(s.config.judgingMs).toBe(DEFAULT_CONFIG.judgingMs)
  })
})

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

describe('join', () => {
  it('adds a connected, not-ready player with zero score', () => {
    const s = run(createGame('ABCD'), join('a'))
    expect(s.players['a']).toEqual({
      id: 'a',
      name: 'A',
      avatar: '🐘',
      ready: false,
      connected: true,
      joinedAt: T0,
      score: 0,
    })
  })

  it('makes the first player the organizer', () => {
    const s = run(createGame('ABCD'), join('a'), join('b'))
    expect(s.organizerId).toBe('a')
  })

  it('rejects a duplicate player id', () => {
    const s = run(createGame('ABCD'), join('a'))
    expect(fails(s, join('a'))).toMatch(/already/)
  })

  it('trims names and rejects empty or over-long ones', () => {
    const s = run(createGame('ABCD'), { type: 'join', now: T0, playerId: 'a', name: '  Zed ', avatar: 'x' })
    expect(s.players['a']!.name).toBe('Zed')
    expect(fails(s, { type: 'join', now: T0, playerId: 'b', name: '   ', avatar: 'x' })).toMatch(/name/)
    expect(
      fails(s, { type: 'join', now: T0, playerId: 'b', name: 'x'.repeat(CFG.nameMaxLen + 1), avatar: 'x' }),
    ).toMatch(/name/)
  })

  it('rejects joining an ended game', () => {
    const s = { ...lobby(), phase: 'ended' as const }
    expect(fails(s, join('z'))).toMatch(/ended/)
  })

  it('does not put a mid-game joiner into the draw order until they are ready', () => {
    const s = run(drawing(), join('z', T0 + 50))
    expect(s.players['z']).toBeDefined()
    expect(s.drawOrder).toEqual(['a', 'b', 'c'])
  })
})

describe('set_ready', () => {
  it('toggles ready in the lobby', () => {
    let s = run(createGame('ABCD'), join('a'))
    s = run(s, ready('a', true))
    expect(s.players['a']!.ready).toBe(true)
    s = run(s, ready('a', false))
    expect(s.players['a']!.ready).toBe(false)
  })

  it('rejects an unknown player', () => {
    expect(fails(createGame('ABCD'), ready('nope'))).toMatch(/unknown/i)
  })

  it('appends a late-ready player to the draw order mid-round', () => {
    const s = run(drawing(), join('z', T0 + 50), ready('z', true, T0 + 51))
    expect(s.drawOrder).toEqual(['a', 'b', 'c', 'z'])
  })

  it('does not duplicate a player already in the draw order', () => {
    const s = run(drawing(), ready('b', true, T0 + 51))
    expect(s.drawOrder).toEqual(['a', 'b', 'c'])
  })

  it('does not allow un-readying once a game is running', () => {
    expect(fails(drawing(), ready('b', false, T0 + 51))).toMatch(/lobby/)
  })

  it('accepts ready during round_end without touching the finished order', () => {
    const s = roundEnd()
    const s2 = run(s, join('z', T0 + 900), ready('z', true, T0 + 901))
    expect(s2.players['z']!.ready).toBe(true)
    expect(s2.drawOrder).toEqual(s.drawOrder)
  })
})

describe('start_game', () => {
  it('requires the organizer', () => {
    expect(fails(lobby(), { type: 'start_game', now: T0, playerId: 'b', seed: 1 })).toMatch(/organizer/)
  })

  it('requires minPlayers ready and connected players', () => {
    const s = run(createGame('ABCD'), join('a'), join('b'), ready('a'), ready('b'))
    expect(fails(s, { type: 'start_game', now: T0, playerId: 'a', seed: 1 })).toMatch(/3/)

    // Three ready, but one of them disconnected: still not enough.
    const s2 = run(lobby(), { type: 'disconnect', now: T0, playerId: 'c' })
    expect(fails(s2, { type: 'start_game', now: T0, playerId: 'a', seed: 1 })).toMatch(/3/)
  })

  it('only includes ready players in the draw order', () => {
    const s = run(lobby(), { type: 'start_game', now: T0 + 10, playerId: 'a', seed: 1 })
    expect([...s.drawOrder].sort()).toEqual(['a', 'b', 'c'])
    expect(s.drawOrder).not.toContain('d')
  })

  it('is deterministic for a given seed', () => {
    const a = run(lobby(), { type: 'start_game', now: T0, playerId: 'a', seed: 42 })
    const b = run(lobby(), { type: 'start_game', now: T0, playerId: 'a', seed: 42 })
    expect(a.drawOrder).toEqual(b.drawOrder)
  })

  it('shuffles: different seeds can produce different orders', () => {
    const orders = new Set<string>()
    for (let seed = 0; seed < 20; seed++) {
      orders.add(run(lobby(), { type: 'start_game', now: T0, playerId: 'a', seed }).drawOrder.join())
    }
    expect(orders.size).toBeGreaterThan(1)
  })

  it('enters drawing with round 1, the first drawer, a fresh turn, and a timer', () => {
    const s = run(lobby(), { type: 'start_game', now: T0 + 10, playerId: 'a', seed: 1 })
    expect(s.phase).toBe('drawing')
    expect(s.round).toBe(1)
    expect(s.drawerIdx).toBe(0)
    expect(s.turn).toEqual({
      round: 1,
      drawerId: s.drawOrder[0],
      intent: null,
      guesses: [],
      correctGuessId: null,
      funniestGuessId: null,
      skipped: false,
    })
    expect(s.timerEndsAt).toBe(T0 + 10 + CFG.drawingMs)
    expect(s.graceEndsAt).toBeNull()
  })

  it('rejects outside the lobby', () => {
    expect(fails(drawing(), { type: 'start_game', now: T0, playerId: 'a', seed: 1 })).toMatch(/lobby/)
  })
})

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

describe('set_intent', () => {
  it('lets the drawer record what they are drawing', () => {
    const s = run(drawing(), { type: 'set_intent', now: T0 + 20, playerId: 'a', text: '  a giraffe on a jet ski ' })
    expect(s.turn!.intent).toBe('a giraffe on a jet ski')
  })

  it('rejects non-drawers', () => {
    expect(fails(drawing(), { type: 'set_intent', now: T0, playerId: 'b', text: 'x' })).toMatch(/drawer/)
  })

  it('rejects outside the drawing phase', () => {
    const s = run(drawing(), guess('b', 'cat'), { type: 'end_drawing', now: T0 + 30, playerId: 'a' })
    expect(s.phase).toBe('judging')
    expect(fails(s, { type: 'set_intent', now: T0, playerId: 'a', text: 'x' })).toMatch(/drawing/)
  })
})

describe('submit_guess', () => {
  it('records a guess in submission order with a stable id', () => {
    const s = run(drawing(), guess('b', 'cat', T0 + 100), guess('c', 'dog', T0 + 200))
    expect(s.turn!.guesses.map((g) => [g.playerId, g.text, g.submittedAt])).toEqual([
      ['b', 'cat', T0 + 100],
      ['c', 'dog', T0 + 200],
    ])
    const [g1, g2] = guessIds(s)
    expect(g1).not.toBe(g2)
  })

  it('upserts: editing keeps the id but moves the guess to the end', () => {
    const s1 = run(drawing(), guess('b', 'cat', T0 + 100), guess('c', 'dog', T0 + 200))
    const bId = s1.turn!.guesses[0]!.id
    const s2 = run(s1, guess('b', 'catfish', T0 + 300))
    expect(s2.turn!.guesses.map((g) => [g.id, g.text, g.submittedAt])).toEqual([
      [s1.turn!.guesses[1]!.id, 'dog', T0 + 200],
      [bId, 'catfish', T0 + 300],
    ])
  })

  it('trims and rejects empty or over-long guesses', () => {
    const s = run(drawing(), guess('b', '  cat  '))
    expect(s.turn!.guesses[0]!.text).toBe('cat')
    expect(fails(s, guess('c', '   '))).toMatch(/guess/)
    expect(fails(s, guess('c', 'x'.repeat(CFG.guessMaxLen + 1)))).toMatch(/guess/)
  })

  it('rejects the drawer', () => {
    expect(fails(drawing(), guess('a', 'me'))).toMatch(/drawer/)
  })

  it('rejects players who are not ready (late joiners who have not hit ready)', () => {
    const s = run(drawing(), join('z', T0 + 50))
    expect(fails(s, guess('z', 'hi'))).toMatch(/ready/)
    expect(fails(s, guess('d', 'hi'))).toMatch(/ready/)
  })

  it('rejects outside the drawing phase', () => {
    const s = run(drawing(), guess('b', 'cat'), { type: 'end_drawing', now: T0 + 30, playerId: 'a' })
    expect(fails(s, guess('c', 'late'))).toMatch(/drawing/)
  })
})

describe('end_drawing', () => {
  it('moves to judging with a judging timer when there are guesses', () => {
    const s = run(drawing(), guess('b', 'cat'), { type: 'end_drawing', now: T0 + 500, playerId: 'a' })
    expect(s.phase).toBe('judging')
    expect(s.timerEndsAt).toBe(T0 + 500 + CFG.judgingMs)
  })

  it('skips straight to reveal when there are no guesses', () => {
    const s = run(drawing(), { type: 'end_drawing', now: T0 + 500, playerId: 'a' })
    expect(s.phase).toBe('reveal')
    expect(s.timerEndsAt).toBe(T0 + 500 + CFG.revealMs)
    expect(s.turn!.correctGuessId).toBeNull()
    expect(s.turn!.funniestGuessId).toBeNull()
    expect(s.turn!.skipped).toBe(false)
    expect(s.turns).toHaveLength(1)
  })

  it('rejects non-drawers', () => {
    expect(fails(drawing(), { type: 'end_drawing', now: T0, playerId: 'b' })).toMatch(/drawer/)
  })
})

describe('timeout during drawing', () => {
  it('is a no-op before the deadline', () => {
    const s = drawing()
    const r = apply(s, { type: 'timeout', now: s.timerEndsAt! - 1 })
    expect(r.error).toBeUndefined()
    expect(r.state).toBe(s)
  })

  it('ends drawing at the deadline', () => {
    const s0 = run(drawing(), guess('b', 'cat'))
    const s = run(s0, { type: 'timeout', now: s0.timerEndsAt! })
    expect(s.phase).toBe('judging')
    expect(s.timerEndsAt).toBe(s0.timerEndsAt! + CFG.judgingMs)
  })
})

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

function judging(): GameState {
  return run(
    drawing(),
    guess('b', 'cat', T0 + 100),
    guess('c', 'dog', T0 + 200),
    { type: 'end_drawing', now: T0 + 500, playerId: 'a' },
  )
}

describe('judge', () => {
  it('awards points for correct and funniest and moves to reveal', () => {
    const s0 = judging()
    const [bGuess, cGuess] = guessIds(s0) as [GuessId, GuessId]
    const s = run(s0, { type: 'judge', now: T0 + 600, playerId: 'a', correctGuessId: bGuess, funniestGuessId: cGuess })
    expect(s.phase).toBe('reveal')
    expect(s.players['b']!.score).toBe(CFG.correctPoints)
    expect(s.players['c']!.score).toBe(CFG.funniestPoints)
    expect(s.players['a']!.score).toBe(0)
    expect(s.turn!.correctGuessId).toBe(bGuess)
    expect(s.turn!.funniestGuessId).toBe(cGuess)
    expect(s.timerEndsAt).toBe(T0 + 600 + CFG.revealMs)
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0]).toBe(s.turn)
  })

  it('allows no correct answer', () => {
    const s0 = judging()
    const [, cGuess] = guessIds(s0) as [GuessId, GuessId]
    const s = run(s0, { type: 'judge', now: T0 + 600, playerId: 'a', funniestGuessId: cGuess })
    expect(s.turn!.correctGuessId).toBeNull()
    expect(s.players['b']!.score).toBe(0)
    expect(s.players['c']!.score).toBe(CFG.funniestPoints)
  })

  it('rejects the same guess for both awards when there is more than one guess', () => {
    const s0 = judging()
    const [bGuess] = guessIds(s0) as [GuessId]
    expect(
      fails(s0, { type: 'judge', now: T0, playerId: 'a', correctGuessId: bGuess, funniestGuessId: bGuess }),
    ).toMatch(/different/)
  })

  it('allows the same guess for both awards when it is the only guess', () => {
    const s0 = run(drawing(), guess('b', 'cat'), { type: 'end_drawing', now: T0 + 500, playerId: 'a' })
    const [bGuess] = guessIds(s0) as [GuessId]
    const s = run(s0, { type: 'judge', now: T0 + 600, playerId: 'a', correctGuessId: bGuess, funniestGuessId: bGuess })
    expect(s.players['b']!.score).toBe(CFG.correctPoints + CFG.funniestPoints)
  })

  it('rejects unknown guess ids', () => {
    const s0 = judging()
    const [bGuess] = guessIds(s0) as [GuessId]
    expect(fails(s0, { type: 'judge', now: T0, playerId: 'a', funniestGuessId: 'nope' })).toMatch(/guess/)
    expect(fails(s0, { type: 'judge', now: T0, playerId: 'a', correctGuessId: 'nope', funniestGuessId: bGuess })).toMatch(
      /guess/,
    )
  })

  it('rejects non-drawers and wrong phase', () => {
    const s0 = judging()
    const [bGuess] = guessIds(s0) as [GuessId]
    expect(fails(s0, { type: 'judge', now: T0, playerId: 'b', funniestGuessId: bGuess })).toMatch(/drawer/)
    expect(fails(drawing(), { type: 'judge', now: T0, playerId: 'a', funniestGuessId: 'x' })).toMatch(/judging/)
  })

  it('times out with no awards', () => {
    const s0 = judging()
    const s = run(s0, { type: 'timeout', now: s0.timerEndsAt! })
    expect(s.phase).toBe('reveal')
    expect(s.turn!.correctGuessId).toBeNull()
    expect(s.turn!.funniestGuessId).toBeNull()
    expect(s.players['b']!.score).toBe(0)
    expect(s.players['c']!.score).toBe(0)
    expect(s.turns).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Reveal → next turn / round end
// ---------------------------------------------------------------------------

function reveal(): GameState {
  const s0 = judging()
  const [bGuess, cGuess] = guessIds(s0) as [GuessId, GuessId]
  return run(s0, { type: 'judge', now: T0 + 600, playerId: 'a', correctGuessId: bGuess, funniestGuessId: cGuess })
}

/** Play through all three turns of round 1 to reach round_end. */
function roundEnd(): GameState {
  let s = reveal()
  // Turn 2: b draws
  s = run(s, { type: 'advance', now: T0 + 700, playerId: 'a' })
  expect(drawerOf(s)).toBe('b')
  s = run(s, guess('a', 'x', T0 + 710), { type: 'end_drawing', now: T0 + 720, playerId: 'b' })
  s = run(s, { type: 'judge', now: T0 + 730, playerId: 'b', funniestGuessId: guessIds(s)[0]! })
  // Turn 3: c draws
  s = run(s, { type: 'advance', now: T0 + 740, playerId: 'a' })
  expect(drawerOf(s)).toBe('c')
  s = run(s, { type: 'end_drawing', now: T0 + 750, playerId: 'c' })
  s = run(s, { type: 'advance', now: T0 + 760, playerId: 'a' })
  expect(s.phase).toBe('round_end')
  return s
}

describe('advance', () => {
  it('requires the organizer and the reveal phase', () => {
    expect(fails(reveal(), { type: 'advance', now: T0, playerId: 'b' })).toMatch(/organizer/)
    expect(fails(drawing(), { type: 'advance', now: T0, playerId: 'a' })).toMatch(/reveal/)
  })

  it('starts the next drawer with a fresh turn and timer', () => {
    const s = run(reveal(), { type: 'advance', now: T0 + 700, playerId: 'a' })
    expect(s.phase).toBe('drawing')
    expect(s.drawerIdx).toBe(1)
    expect(s.turn!.drawerId).toBe('b')
    expect(s.turn!.guesses).toEqual([])
    expect(s.turn!.intent).toBeNull()
    expect(s.timerEndsAt).toBe(T0 + 700 + CFG.drawingMs)
    expect(s.turns).toHaveLength(1)
  })

  it('reveal timeout does the same as advance', () => {
    const s0 = reveal()
    const s = run(s0, { type: 'timeout', now: s0.timerEndsAt! })
    expect(s.phase).toBe('drawing')
    expect(s.turn!.drawerId).toBe('b')
  })

  it('reaches round_end after the last drawer', () => {
    const s = roundEnd()
    expect(s.phase).toBe('round_end')
    expect(s.turn).toBeNull()
    expect(s.timerEndsAt).toBeNull()
    expect(s.turns).toHaveLength(3)
    expect(s.turns.map((t) => t.drawerId)).toEqual(['a', 'b', 'c'])
  })

  it('preserves scores across turns', () => {
    const s = roundEnd()
    expect(s.players['b']!.score).toBe(CFG.correctPoints)
    expect(s.players['c']!.score).toBe(CFG.funniestPoints)
    expect(s.players['a']!.score).toBe(CFG.funniestPoints)
  })

  it('includes a late-ready player at the end of the round', () => {
    let s = run(reveal(), join('z', T0 + 650), ready('z', true, T0 + 651))
    s = run(s, { type: 'advance', now: T0 + 700, playerId: 'a' }) // b
    s = run(s, { type: 'end_drawing', now: T0 + 710, playerId: 'b' })
    s = run(s, { type: 'advance', now: T0 + 720, playerId: 'a' }) // c
    s = run(s, { type: 'end_drawing', now: T0 + 730, playerId: 'c' })
    s = run(s, { type: 'advance', now: T0 + 740, playerId: 'a' }) // z
    expect(s.phase).toBe('drawing')
    expect(drawerOf(s)).toBe('z')
  })

  it('skips a disconnected next drawer and records a skipped turn', () => {
    let s = run(reveal(), { type: 'disconnect', now: T0 + 650, playerId: 'b' })
    s = run(s, { type: 'advance', now: T0 + 700, playerId: 'a' })
    expect(s.phase).toBe('drawing')
    expect(drawerOf(s)).toBe('c')
    expect(s.turns).toHaveLength(2)
    expect(s.turns[1]).toMatchObject({ drawerId: 'b', skipped: true, guesses: [] })
  })

  it('goes to round_end when every remaining drawer is disconnected', () => {
    let s = run(
      reveal(),
      { type: 'disconnect', now: T0 + 650, playerId: 'b' },
      { type: 'disconnect', now: T0 + 651, playerId: 'c' },
    )
    s = run(s, { type: 'advance', now: T0 + 700, playerId: 'a' })
    expect(s.phase).toBe('round_end')
    expect(s.turns.map((t) => [t.drawerId, t.skipped])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
    ])
  })
})

// ---------------------------------------------------------------------------
// Round end
// ---------------------------------------------------------------------------

describe('next_round', () => {
  it('requires the organizer and round_end', () => {
    expect(fails(roundEnd(), { type: 'next_round', now: T0, playerId: 'b', seed: 1 })).toMatch(/organizer/)
    expect(fails(drawing(), { type: 'next_round', now: T0, playerId: 'a', seed: 1 })).toMatch(/round_end/)
  })

  it('starts round 2 with all ready, connected players and keeps scores', () => {
    const s0 = run(roundEnd(), ready('d', true, T0 + 900))
    const s = run(s0, { type: 'next_round', now: T0 + 1000, playerId: 'a', seed: 7 })
    expect(s.phase).toBe('drawing')
    expect(s.round).toBe(2)
    expect(s.drawerIdx).toBe(0)
    expect([...s.drawOrder].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(s.turn!.round).toBe(2)
    expect(s.turns).toHaveLength(3)
    expect(s.players['b']!.score).toBe(CFG.correctPoints)
    expect(s.timerEndsAt).toBe(T0 + 1000 + CFG.drawingMs)
  })

  it('excludes disconnected players and enforces minPlayers', () => {
    const s0 = run(roundEnd(), { type: 'disconnect', now: T0 + 900, playerId: 'c' })
    expect(fails(s0, { type: 'next_round', now: T0, playerId: 'a', seed: 1 })).toMatch(/3/)
    const s1 = run(s0, ready('d', true, T0 + 901))
    const s = run(s1, { type: 'next_round', now: T0 + 1000, playerId: 'a', seed: 1 })
    expect([...s.drawOrder].sort()).toEqual(['a', 'b', 'd'])
  })
})

describe('end_game', () => {
  it('requires the organizer and round_end', () => {
    expect(fails(roundEnd(), { type: 'end_game', now: T0, playerId: 'b' })).toMatch(/organizer/)
    expect(fails(drawing(), { type: 'end_game', now: T0, playerId: 'a' })).toMatch(/round_end/)
  })

  it('moves to ended and freezes the game', () => {
    const s = run(roundEnd(), { type: 'end_game', now: T0 + 900, playerId: 'a' })
    expect(s.phase).toBe('ended')
    expect(s.timerEndsAt).toBeNull()
    expect(fails(s, ready('a', true))).toMatch(/ended/)
    expect(fails(s, { type: 'next_round', now: T0, playerId: 'a', seed: 1 })).toMatch(/ended/)
    // Timeouts are harmless.
    const r = apply(s, { type: 'timeout', now: T0 + 99999 })
    expect(r.error).toBeUndefined()
    expect(r.state).toBe(s)
  })
})

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe('disconnect / reconnect', () => {
  it('marks players disconnected and reconnected without removing them', () => {
    let s = run(lobby(), { type: 'disconnect', now: T0, playerId: 'b' })
    expect(s.players['b']!.connected).toBe(false)
    expect(s.players['b']!.ready).toBe(true)
    s = run(s, { type: 'reconnect', now: T0, playerId: 'b' })
    expect(s.players['b']!.connected).toBe(true)
  })

  it('rejects unknown players', () => {
    expect(fails(lobby(), { type: 'disconnect', now: T0, playerId: 'zz' })).toMatch(/unknown/i)
    expect(fails(lobby(), { type: 'reconnect', now: T0, playerId: 'zz' })).toMatch(/unknown/i)
  })

  it('promotes the longest-connected player when the organizer disconnects', () => {
    let s = run(lobby(), { type: 'disconnect', now: T0, playerId: 'a' })
    expect(s.organizerId).toBe('b')
    // The original organizer does not reclaim the role on reconnect.
    s = run(s, { type: 'reconnect', now: T0, playerId: 'a' })
    expect(s.organizerId).toBe('b')
  })

  it('promotes by join time, skipping disconnected players', () => {
    let s = run(lobby(), { type: 'disconnect', now: T0, playerId: 'b' })
    s = run(s, { type: 'disconnect', now: T0, playerId: 'a' })
    expect(s.organizerId).toBe('c')
  })

  it('keeps the organizer if nobody else is connected', () => {
    const s = run(createGame('X'), join('a'), { type: 'disconnect', now: T0, playerId: 'a' })
    expect(s.organizerId).toBe('a')
  })

  it('starts a grace timer when the drawer disconnects during drawing', () => {
    const s = run(drawing(), { type: 'disconnect', now: T0 + 100, playerId: 'a' })
    expect(s.phase).toBe('drawing')
    expect(s.graceEndsAt).toBe(T0 + 100 + CFG.graceMs)
  })

  it('does not start a grace timer for a guesser', () => {
    const s = run(drawing(), { type: 'disconnect', now: T0 + 100, playerId: 'b' })
    expect(s.graceEndsAt).toBeNull()
  })

  it('clears the grace timer when the drawer reconnects', () => {
    const s = run(
      drawing(),
      { type: 'disconnect', now: T0 + 100, playerId: 'a' },
      { type: 'reconnect', now: T0 + 200, playerId: 'a' },
    )
    expect(s.graceEndsAt).toBeNull()
  })

  it('skips the turn when grace expires with the drawer still gone', () => {
    const s0 = run(drawing(), guess('b', 'cat'), { type: 'disconnect', now: T0 + 100, playerId: 'a' })
    const s = run(s0, { type: 'timeout', now: s0.graceEndsAt! })
    expect(s.phase).toBe('drawing')
    expect(drawerOf(s)).toBe('b')
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0]).toMatchObject({ drawerId: 'a', skipped: true })
    expect(s.players['b']!.score).toBe(0)
    expect(s.graceEndsAt).toBeNull()
  })

  it('grace carries into judging and skips there too', () => {
    const s0 = run(drawing(), guess('b', 'cat'), { type: 'disconnect', now: T0 + 100, playerId: 'a' })
    // Drawing deadline fires first (grace is later than drawing end only if disconnect was late; force it).
    const s1 = run(s0, { type: 'timeout', now: s0.timerEndsAt! })
    expect(s1.phase).toBe('judging')
    expect(s1.graceEndsAt).toBe(s0.graceEndsAt)
    // Grace already expired by now, so the very next timeout skips.
    const s = run(s1, { type: 'timeout', now: s1.timerEndsAt! - 1 })
    expect(s.turns[0]).toMatchObject({ drawerId: 'a', skipped: true })
    expect(drawerOf(s)).toBe('b')
  })

  it('a disconnected drawer whose turn is skipped can still guess after reconnecting', () => {
    const s0 = run(drawing(), { type: 'disconnect', now: T0 + 100, playerId: 'a' })
    let s = run(s0, { type: 'timeout', now: s0.graceEndsAt! })
    s = run(s, { type: 'reconnect', now: s0.graceEndsAt! + 1, playerId: 'a' }, guess('a', 'back', s0.graceEndsAt! + 2))
    expect(s.turn!.guesses[0]!.playerId).toBe('a')
  })
})

describe('leave', () => {
  it('removes the player entirely', () => {
    const s = run(lobby(), { type: 'leave', now: T0, playerId: 'd' })
    expect(s.players['d']).toBeUndefined()
  })

  it('promotes a new organizer when the organizer leaves', () => {
    const s = run(lobby(), { type: 'leave', now: T0, playerId: 'a' })
    expect(s.organizerId).toBe('b')
  })

  it('removes a not-yet-drawn player from the order without disturbing the current drawer', () => {
    const s = run(drawing(), { type: 'leave', now: T0 + 100, playerId: 'c' })
    expect(s.drawOrder).toEqual(['a', 'b'])
    expect(s.drawerIdx).toBe(0)
    expect(drawerOf(s)).toBe('a')
  })

  it('removes an already-drawn player and keeps drawerIdx pointing at the same drawer', () => {
    const s0 = run(reveal(), { type: 'advance', now: T0 + 700, playerId: 'a' })
    expect(drawerOf(s0)).toBe('b')
    const s = run(s0, { type: 'leave', now: T0 + 710, playerId: 'a' })
    expect(s.drawOrder).toEqual(['b', 'c'])
    expect(s.drawerIdx).toBe(0)
    expect(drawerOf(s)).toBe('b')
    expect(s.phase).toBe('drawing')
  })

  it('skips the turn immediately when the current drawer leaves', () => {
    const s = run(drawing(), guess('b', 'cat'), { type: 'leave', now: T0 + 100, playerId: 'a' })
    expect(s.players['a']).toBeUndefined()
    expect(s.drawOrder).toEqual(['b', 'c'])
    expect(s.phase).toBe('drawing')
    expect(drawerOf(s)).toBe('b')
    expect(s.turns[0]).toMatchObject({ drawerId: 'a', skipped: true })
  })

  it('drops the leaver’s guess from the live turn', () => {
    const s = run(drawing(), guess('b', 'cat'), guess('c', 'dog'), { type: 'leave', now: T0 + 100, playerId: 'b' })
    expect(s.turn!.guesses.map((g) => g.playerId)).toEqual(['c'])
  })

  it('goes to round_end when the last drawer of the round leaves mid-turn', () => {
    let s = run(reveal(), { type: 'advance', now: T0 + 700, playerId: 'a' })
    s = run(s, { type: 'end_drawing', now: T0 + 710, playerId: 'b' })
    s = run(s, { type: 'advance', now: T0 + 720, playerId: 'a' })
    expect(drawerOf(s)).toBe('c')
    s = run(s, { type: 'leave', now: T0 + 730, playerId: 'c' })
    expect(s.phase).toBe('round_end')
  })

  it('rejects unknown players', () => {
    expect(fails(lobby(), { type: 'leave', now: T0, playerId: 'zz' })).toMatch(/unknown/i)
  })
})

// ---------------------------------------------------------------------------
// nextAlarmAt
// ---------------------------------------------------------------------------

describe('nextAlarmAt', () => {
  it('is null in untimed phases', () => {
    expect(nextAlarmAt(lobby())).toBeNull()
    expect(nextAlarmAt(roundEnd())).toBeNull()
    expect(nextAlarmAt(run(roundEnd(), { type: 'end_game', now: T0, playerId: 'a' }))).toBeNull()
  })

  it('is the phase deadline in timed phases', () => {
    const d = drawing()
    expect(nextAlarmAt(d)).toBe(d.timerEndsAt)
    const j = judging()
    expect(nextAlarmAt(j)).toBe(j.timerEndsAt)
    const r = reveal()
    expect(nextAlarmAt(r)).toBe(r.timerEndsAt)
  })

  it('is the earlier of the phase deadline and the grace deadline', () => {
    const s = run(drawing(), { type: 'disconnect', now: T0 + 100, playerId: 'a' })
    expect(nextAlarmAt(s)).toBe(Math.min(s.timerEndsAt!, s.graceEndsAt!))
    expect(nextAlarmAt(s)).toBe(s.graceEndsAt)
  })
})

// ---------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------

describe('project', () => {
  it('hides guess authors from everyone but the author during drawing and judging', () => {
    const s = run(drawing(), guess('b', 'cat'), guess('c', 'dog'))
    const forDrawer = project(s, 'a')
    expect(forDrawer.turn!.guesses.map((g) => g.playerId)).toEqual([null, null])
    expect(forDrawer.turn!.guesses.map((g) => g.text)).toEqual(['cat', 'dog'])
    const forB = project(s, 'b')
    expect(forB.turn!.guesses.map((g) => g.playerId)).toEqual(['b', null])
    const forSpectator = project(s, null)
    expect(forSpectator.turn!.guesses.map((g) => g.playerId)).toEqual([null, null])
  })

  it('hides intent from everyone but the drawer before reveal', () => {
    const s = run(drawing(), { type: 'set_intent', now: T0, playerId: 'a', text: 'secret' })
    expect(project(s, 'a').turn!.intent).toBe('secret')
    expect(project(s, 'b').turn!.intent).toBeNull()
    expect(project(s, null).turn!.intent).toBeNull()
  })

  it('reveals everything from the reveal phase on', () => {
    const s = run(
      judging(),
      { type: 'judge', now: T0 + 600, playerId: 'a', funniestGuessId: guessIds(judging())[0]! },
    )
    const forB = project(s, 'b')
    expect(forB.turn!.guesses.map((g) => g.playerId)).toEqual(['b', 'c'])
  })

  it('also reveals completed turns in history', () => {
    const s = run(reveal(), { type: 'advance', now: T0 + 700, playerId: 'a' })
    // Turn 1 is in history; turn 2 is live with no guesses yet.
    const p = project(s, 'c')
    expect(p.turns[0]!.guesses.map((g) => g.playerId)).toEqual(['b', 'c'])
  })

  it('echoes the viewer id and omits internals', () => {
    const p = project(drawing(), 'b')
    expect(p.you).toBe('b')
    expect('nextGuessSeq' in p).toBe(false)
    expect(project(drawing(), null).you).toBeNull()
  })

  it('does not mutate the underlying state', () => {
    const s = run(drawing(), guess('b', 'cat'))
    const before = JSON.stringify(s)
    project(s, 'a')
    expect(JSON.stringify(s)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
  it('never mutates the input state', () => {
    const s = drawing()
    const before = JSON.stringify(s)
    run(s, guess('b', 'cat'), { type: 'set_intent', now: T0, playerId: 'a', text: 'x' })
    apply(s, { type: 'disconnect', now: T0, playerId: 'a' })
    apply(s, { type: 'leave', now: T0, playerId: 'a' })
    expect(JSON.stringify(s)).toBe(before)
  })

  it('round-trips through JSON (persistable)', () => {
    const s = reveal()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})
