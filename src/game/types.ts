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
  /** Points for the guess marked correct. */
  correctPoints: number
  /** Points for the guess marked funniest. */
  funniestPoints: number
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

export interface Turn {
  round: number
  drawerId: PlayerId
  /** Drawer's private note of what they're drawing. Public from reveal on. */
  intent: string | null
  /** In submission order. Editing a guess moves it to the end. */
  guesses: Guess[]
  correctGuessId: GuessId | null
  funniestGuessId: GuessId | null
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
  | (Base & {
      type: 'judge'
      playerId: PlayerId
      correctGuessId?: GuessId | null
      funniestGuessId: GuessId
    })
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
