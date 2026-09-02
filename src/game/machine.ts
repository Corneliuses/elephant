import type { ApplyResult, GameConfig, GameEvent, GameState, PlayerId, ProjectedState } from './types'

export function createGame(_code: string, _config?: Partial<GameConfig>): GameState {
  throw new Error('not implemented')
}

export function apply(_state: GameState, _event: GameEvent): ApplyResult {
  throw new Error('not implemented')
}

export function nextAlarmAt(_state: GameState): number | null {
  throw new Error('not implemented')
}

export function project(_state: GameState, _viewerId: PlayerId | null): ProjectedState {
  throw new Error('not implemented')
}
