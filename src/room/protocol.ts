/**
 * Wire protocol between the PWA client and a RoomDO. Shared by both sides.
 *
 * The client never sends `playerId` or `now`: the DO stamps both from the
 * socket's identity and its own clock before applying a game event.
 */
import type { GameConfig, GuessId, Phase, PlayerId, ProjectedState } from '../game/types'

/**
 * A drawing event. `x`, `y` and `width` are all normalised to [0, 1] as a
 * fraction of the canvas, which is rendered at a fixed 1:1 aspect ratio, so
 * every device reproduces the same picture at any screen size.
 */
export type Stroke =
  | { t: 'down'; x: number; y: number; color: string; width: number }
  | { t: 'move'; x: number; y: number }
  | { t: 'up' }
  | { t: 'clear' }

export type ClientMessage =
  | { type: 'join'; name: string; avatar: string }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_game' }
  | { type: 'set_intent'; text: string }
  | { type: 'submit_guess'; text: string }
  | { type: 'end_drawing' }
  | { type: 'judge'; correctGuessId?: GuessId | null; funniestGuessId: GuessId }
  | { type: 'advance' }
  | { type: 'next_round' }
  | { type: 'end_game' }
  | { type: 'leave' }
  | { type: 'stroke'; strokes: Stroke[] }

export type ServerMessage =
  /** Sent once after a successful `join`. Persist these to reconnect. */
  | { type: 'welcome'; playerId: PlayerId; secret: string }
  /**
   * Full projected state, sent on connect and after every change.
   * `now` is the server's clock at send time; clients use it to correct
   * their own skew before rendering `timerEndsAt` as a countdown.
   */
  | { type: 'state'; state: ProjectedState; now: number }
  /** Stroke batch. `reset: true` means "replace what you have with this". */
  | { type: 'strokes'; strokes: Stroke[]; reset?: boolean }
  | { type: 'error'; message: string }

/** Room-level housekeeping, distinct from game rules. */
export interface RoomOptions {
  /** Delete the room this long after the last socket closes. */
  idleTtlMs: number
  /** Delete the room this long after the game ends. */
  endedTtlMs: number
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  idleTtlMs: 30 * 60_000,
  endedTtlMs: 24 * 60 * 60_000,
}

export interface CreateRoomRequest {
  config?: Partial<GameConfig>
  room?: Partial<RoomOptions>
}

export interface CreateRoomResponse {
  code: string
}

export interface RoomInfo {
  code: string
  phase: Phase
  playerCount: number
}

/** Room codes: 4 chars from an alphabet without look-alikes. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
export const CODE_LENGTH = 4

/** WebSocket close codes the server uses. */
export const CLOSE_LEFT = 4000
export const CLOSE_UNAUTHORIZED = 4001
export const CLOSE_REPLACED = 4002
export const CLOSE_ROOM_GONE = 4004
