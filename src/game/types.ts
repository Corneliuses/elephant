export type PlayerId = string
export type GuessId = string

export type Phase = 'lobby' | 'drawing' | 'judging' | 'reveal' | 'round_end' | 'ended'

export interface GameConfig {
  /** Drawing timer, ms. */
  drawingMs: number
  /** Judging timer, ms. Expiry awards nothing. */
  judgingMs: number
  /** Reveal screen duration, ms. */
  revealMs: number
  /** Grace period after the drawer disconnects before their turn is skipped, ms. */
  graceMs: number
  /** Minimum ready+connected players to start a game or a new round. */
  minPlayers: number
  /** Max length of a guess after trimming. */
  guessMaxLen: number
  /** Max length of a name after trimming. */
  nameMaxLen: number
  /** Points for the guess the grader marks correct. */
  correctPoints: number
  /** Points for the guess the drawer picks as their favorite. */
  favoritePoints: number
  /** How long the transport may spend grading before giving up, ms. */
  gradingMs: number
}

export interface Player {
  id: PlayerId
  name: string
  avatar: string
  ready: boolean
  connected: boolean
  joinedAt: number
  score: number
}

export interface Guess {
  id: GuessId
  playerId: PlayerId
  text: string
  submittedAt: number
}

/**
 * Whether the correctness verdict has arrived. Grading happens outside the
 * reducer (it is a network call), so the turn carries its progress.
 */
export type Grading = 'pending' | 'done' | 'unavailable'

export interface Turn {
  round: number
  drawerId: PlayerId
  /**
   * What the drawer says they are drawing. Required before they may finish,
   * because the grader has nothing to compare guesses against without it.
   * Private until the reveal.
   */
  intent: string | null
  /** In submission order. Editing a guess moves it to the end. */
  guesses: Guess[]
  /** Chosen by the grader, not the drawer. Hidden until the reveal. */
  correctGuessId: GuessId | null
  grading: Grading
  /** The drawer's pick. May be the same guess as `correctGuessId`. */
  favoriteGuessId: GuessId | null
  /** True when the turn ended without judging (drawer left or timed out of grace). */
  skipped: boolean
}

export interface GameState {
  code: string
  config: GameConfig
  phase: Phase
  organizerId: PlayerId | null
  players: Record<PlayerId, Player>
  /** 0 in the lobby; 1 for the first round. */
  round: number
  /** This round's draw order. Late-ready players are appended. */
  drawOrder: PlayerId[]
  /** Index into drawOrder of the current (or most recent) drawer. */
  drawerIdx: number
  /** The live turn during drawing / judging / reveal. */
  turn: Turn | null
  /** Completed turns, oldest first. */
  turns: Turn[]
  /** Main deadline for the current phase (drawing, judging, reveal), ms epoch. */
  timerEndsAt: number | null
  /** Drawer-disconnect grace deadline, ms epoch. */
  graceEndsAt: number | null
  /** Monotonic counter for guess ids. */
  nextGuessSeq: number
}

interface Base {
  /** ms epoch, supplied by the caller. The reducer never reads the clock. */
  now: number
}

export type GameEvent =
  | (Base & { type: 'join'; playerId: PlayerId; name: string; avatar: string })
  | (Base & { type: 'set_ready'; playerId: PlayerId; ready: boolean })
  | (Base & { type: 'start_game'; playerId: PlayerId; seed: number })
  | (Base & { type: 'set_intent'; playerId: PlayerId; text: string })
  | (Base & { type: 'submit_guess'; playerId: PlayerId; text: string })
  | (Base & { type: 'end_drawing'; playerId: PlayerId })
  | (Base & { type: 'judge'; playerId: PlayerId; favoriteGuessId: GuessId })
  /**
   * The grader's verdict, applied by the transport rather than a player.
   * `correctGuessId` is null when no guess was right; `ok: false` means
   * grading could not be carried out at all.
   */
  | (Base & { type: 'grade'; correctGuessId: GuessId | null; ok: boolean })
  | (Base & { type: 'advance'; playerId: PlayerId })
  | (Base & { type: 'next_round'; playerId: PlayerId; seed: number })
  | (Base & { type: 'end_game'; playerId: PlayerId })
  | (Base & { type: 'disconnect'; playerId: PlayerId })
  | (Base & { type: 'reconnect'; playerId: PlayerId })
  | (Base & { type: 'leave'; playerId: PlayerId })
  | (Base & { type: 'timeout' })

export interface ApplyResult {
  /** The new state, or the unchanged input state when `error` is set. */
  state: GameState
  error?: string
}

/** A guess as seen by a particular viewer. `playerId` is null when hidden. */
export interface ProjectedGuess {
  id: GuessId
  playerId: PlayerId | null
  text: string
  submittedAt: number
}

export interface ProjectedTurn extends Omit<Turn, 'guesses' | 'intent'> {
  intent: string | null
  guesses: ProjectedGuess[]
}

export interface ProjectedState extends Omit<GameState, 'turn' | 'turns' | 'nextGuessSeq'> {
  turns: ProjectedTurn[]
  turn: ProjectedTurn | null
  /** The viewer's own id, echoed so the client doesn't have to track it. */
  you: PlayerId | null
}
