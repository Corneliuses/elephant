export type PlayerId = string
export type GuessId = string

export type Phase = 'lobby' | 'prep' | 'drawing' | 'judging' | 'reveal' | 'round_end' | 'ended'

/**
 * The languages the client can show. Shared with the client's dictionary and
 * with the translator, which renders every guess into each of them so a
 * player reads the room in whichever one they picked.
 */
export const LANGS = ['en', 'fr', 'es', 'zh'] as const
export type Lang = (typeof LANGS)[number]

/** One piece of player text in every language the client can show. */
export type Translations = Partial<Record<Lang, string>>

export interface GameConfig {
  /** How long the drawer has to say what they will draw before the turn is skipped, ms. */
  prepMs: number
  /** Drawing timer, ms. */
  drawingMs: number
  /** How long the drawer must keep drawing before they may finish early, ms. */
  minDrawingMs: number
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
  /**
   * `text` in every language the client can show, once the translator has
   * been through the turn. Null until then, or if translation failed, in
   * which case everyone reads the guess as typed.
   */
  translations: Translations | null
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
   * What the drawer says they are drawing. Required before the timer will
   * start, because the grader has nothing to compare guesses against
   * without it. Private until the reveal.
   */
  intent: string | null
  /** `intent` in every language, filled in alongside the guesses' translations. */
  intentTranslations: Translations | null
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
  /** The drawer has said what they will draw: start the clock. */
  | (Base & { type: 'start_drawing'; playerId: PlayerId })
  | (Base & { type: 'submit_guess'; playerId: PlayerId; text: string })
  | (Base & { type: 'end_drawing'; playerId: PlayerId })
  | (Base & { type: 'judge'; playerId: PlayerId; favoriteGuessId: GuessId })
  /**
   * The grader's verdict, applied by the transport rather than a player.
   * `correctGuessId` is null when no guess was right; `ok: false` means
   * grading could not be carried out at all.
   */
  | (Base & { type: 'grade'; correctGuessId: GuessId | null; ok: boolean })
  /**
   * The translator's rendering of the turn's text, applied by the transport.
   * Keyed by guess id; ids that no longer match a guess are ignored.
   */
  | (Base & { type: 'translate'; guesses: Record<GuessId, Translations>; intent: Translations | null })
  | (Base & { type: 'advance'; playerId: PlayerId })
  | (Base & { type: 'next_round'; playerId: PlayerId; seed: number })
  | (Base & { type: 'end_game'; playerId: PlayerId })
  | (Base & { type: 'disconnect'; playerId: PlayerId })
  | (Base & { type: 'reconnect'; playerId: PlayerId })
  | (Base & { type: 'leave'; playerId: PlayerId })
  | (Base & { type: 'timeout' })

/**
 * Why an event was rejected, as a stable tag rather than prose.
 *
 * `ApplyResult.error` stays English and is what logs and tests read; this is
 * what the client renders, in whichever language its player picked. Codes
 * group by cause, so several messages can share one — every "only the
 * organizer can …" refusal is `not_organizer`.
 */
export type ErrorCode =
  | 'game_ended'
  | 'already_joined'
  | 'invalid_name'
  | 'invalid_avatar'
  | 'unknown_player'
  | 'not_in_lobby'
  | 'unready_outside_lobby'
  | 'not_organizer'
  | 'need_more_players'
  | 'not_prep'
  | 'not_drawing'
  | 'not_drawer'
  | 'drawer_cannot_guess'
  | 'not_ready'
  | 'invalid_guess'
  | 'intent_required'
  | 'too_early'
  | 'not_judging'
  | 'unknown_guess'
  | 'nothing_to_grade'
  | 'not_gradeable'
  | 'already_graded'
  | 'not_reveal'
  | 'not_round_end'

export interface ApplyResult {
  /** The new state, or the unchanged input state when `error` is set. */
  state: GameState
  error?: string
  /** Set whenever `error` is. What the client localises. */
  code?: ErrorCode
}

/** A guess as seen by a particular viewer. `playerId` is null when hidden. */
export interface ProjectedGuess {
  id: GuessId
  playerId: PlayerId | null
  text: string
  submittedAt: number
  translations: Translations | null
}

export interface ProjectedTurn extends Omit<Turn, 'guesses' | 'intent' | 'intentTranslations'> {
  intent: string | null
  intentTranslations: Translations | null
  guesses: ProjectedGuess[]
  /**
   * Who has a guess in, whatever it says. Visible to everyone, drawer
   * included, so they can tell when to stop; sorted by id rather than by
   * submission so it cannot be lined up against the anonymous guess list.
   */
  answered: PlayerId[]
}

export interface ProjectedState extends Omit<GameState, 'turn' | 'turns' | 'nextGuessSeq'> {
  turns: ProjectedTurn[]
  turn: ProjectedTurn | null
  /** The viewer's own id, echoed so the client doesn't have to track it. */
  you: PlayerId | null
}
