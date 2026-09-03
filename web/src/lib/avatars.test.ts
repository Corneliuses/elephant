import { describe, expect, it } from 'vitest'
import { AVATARS, accentOf } from './avatars'

describe('accentOf', () => {
  it('is stable for a player id', () => {
    expect(accentOf('abc123')).toBe(accentOf('abc123'))
  })

  it('always returns a palette variable', () => {
    for (const id of ['a', 'zz', 'player-9', '']) {
      expect(accentOf(id)).toMatch(/^var\(--[a-z]+\)$/)
    }
  })

  it('spreads ids across the palette rather than collapsing to one colour', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => accentOf(`player${i}`)))
    expect(seen.size).toBeGreaterThan(4)
  })
})

describe('AVATARS', () => {
  it('has no duplicates', () => {
    expect(new Set(AVATARS).size).toBe(AVATARS.length)
  })
})
