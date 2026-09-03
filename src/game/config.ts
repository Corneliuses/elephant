import type { GameConfig } from './types'

export const DEFAULT_CONFIG: GameConfig = {
  drawingMs: 90_000,
  judgingMs: 60_000,
  revealMs: 8_000,
  graceMs: 15_000,
  minPlayers: 3,
  guessMaxLen: 100,
  nameMaxLen: 24,
  correctPoints: 2,
  favoritePoints: 2,
  gradingMs: 10_000,
}
