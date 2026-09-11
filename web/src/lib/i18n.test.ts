import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LANGS, LANG_NAMES, detect, t } from './i18n.svelte'
import type { Lang } from './i18n.svelte'

beforeEach(() => {
  localStorage.clear()
  t.set('en')
})

describe('detect', () => {
  it('honours a stored choice over the device', () => {
    expect(detect('zh', ['fr-FR', 'en'])).toBe('zh')
  })

  it('falls back to the device when nothing is stored', () => {
    expect(detect(null, ['es-MX', 'en-US'])).toBe('es')
  })

  it('matches on the primary subtag', () => {
    // fr-CA is French; zh-TW reads Traditional and gets Simplified text,
    // which is imperfect and still far better than English.
    expect(detect(null, ['fr-CA'])).toBe('fr')
    expect(detect(null, ['zh-TW'])).toBe('zh')
    expect(detect(null, ['ZH-HANT-HK'])).toBe('zh')
  })

  it('walks the preference list past languages it does not have', () => {
    expect(detect(null, ['pt-BR', 'de', 'es'])).toBe('es')
  })

  it('lands on English when nothing matches, or the store is junk', () => {
    expect(detect(null, ['ja', 'ko'])).toBe('en')
    expect(detect(null, [])).toBe('en')
    expect(detect('klingon', ['ja'])).toBe('en')
  })
})

describe('the dictionaries', () => {
  /**
   * Probes stand in for whatever a phrase interpolates. They are strings so
   * one probe fits both the name-shaped and count-shaped arguments; what is
   * being asserted is that the value reaches the output at all, since a
   * translation that drops its `${name}` still typechecks.
   */
  const PROBES = ['«A»', '«B»']

  const render = (value: unknown): string =>
    typeof value === 'function' ? (value as (...a: unknown[]) => string)(...PROBES.slice(0, value.length)) : String(value)

  for (const lang of LANGS) {
    describe(lang, () => {
      it('has a name written in its own language', () => {
        expect(LANG_NAMES[lang]).toBeTruthy()
      })

      it('says something for every phrase', () => {
        t.set(lang)
        for (const [key, value] of Object.entries(t.s)) {
          expect(render(value).trim(), key).not.toBe('')
        }
      })

      it('keeps every value it is handed', () => {
        t.set(lang)
        for (const [key, value] of Object.entries(t.s)) {
          if (typeof value !== 'function') continue
          for (const probe of PROBES.slice(0, value.length)) {
            expect(render(value), `${key} drops ${probe}`).toContain(probe)
          }
        }
      })
    })
  }

  it('translates: no two languages share a phrase that should differ', () => {
    // A missed translation usually shows up as an English string copied
    // across, so check a sample that has no reason to be identical.
    const sample = (lang: Lang) => {
      t.set(lang)
      return [t.s.startAGame, t.s.whoAreYou, t.s.next, t.s.errGeneric].join('|')
    }
    const all = LANGS.map(sample)
    expect(new Set(all).size).toBe(LANGS.length)
  })
})

describe('choosing a language', () => {
  it('swaps the whole interface at once', () => {
    t.set('fr')
    expect(t.s.startAGame).toBe('Lancer une partie')
    t.set('zh')
    expect(t.s.startAGame).toBe('开始游戏')
  })

  it('remembers the choice', () => {
    t.set('es')
    expect(localStorage.getItem('elephant:lang')).toBe('es')
    expect(detect(localStorage.getItem('elephant:lang'), ['en'])).toBe('es')
  })

  it('survives a browser that refuses storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    expect(() => t.set('fr')).not.toThrow()
    expect(t.s.next).toBe('Suivant')
    spy.mockRestore()
  })

  it('tells the document, so the right glyphs are drawn', () => {
    // Han characters are drawn differently for Simplified Chinese than for
    // Japanese; the script subtag is what settles it.
    t.set('zh')
    expect(document.documentElement.lang).toBe('zh-Hans')
    t.set('fr')
    expect(document.documentElement.lang).toBe('fr')
  })
})

describe('error wording', () => {
  it('speaks the player’s language', () => {
    t.set('fr')
    expect(t.error('invalid_guess', 3)).toBe('Écrivez une réponse.')
    t.set('zh')
    expect(t.error('invalid_guess', 3)).toBe('请先写下你的猜测。')
  })

  it('fills in the minimum player count', () => {
    expect(t.error('need_more_players', 3)).toContain('3')
    t.set('es')
    expect(t.error('need_more_players', 5)).toContain('5')
  })

  it('gives one honest sentence for the refusals only a bug can cause', () => {
    // These are all gated in the UI, so reaching one means the client is
    // wrong — better a sentence the player can read than English prose.
    for (const code of ['not_organizer', 'not_drawer', 'already_graded', 'bad_request'] as const) {
      expect(t.error(code, 3)).toBe(t.s.errGeneric)
    }
  })

  it('has its own wording for what a player can really provoke', () => {
    for (const code of ['invalid_name', 'invalid_guess', 'intent_required', 'game_ended', 'unauthorized'] as const) {
      expect(t.error(code, 3)).not.toBe(t.s.errGeneric)
    }
  })

  it('never leaks the server’s English into another language', () => {
    t.set('zh')
    for (const code of ['invalid_name', 'not_organizer', 'unauthorized', 'need_more_players'] as const) {
      expect(t.error(code, 3)).not.toMatch(/[A-Za-z]{3}/)
    }
  })
})
