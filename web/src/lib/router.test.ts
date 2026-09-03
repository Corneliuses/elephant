import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshRouter() {
  vi.resetModules()
  return (await import('./router.svelte')).router
}

beforeEach(() => {
  history.pushState({}, '', '/')
})

describe('code', () => {
  it('is null on the home page', async () => {
    const router = await freshRouter()
    expect(router.code).toBeNull()
  })

  it('reads a four-letter room code out of the path', async () => {
    history.pushState({}, '', '/g/abcd')
    const router = await freshRouter()
    expect(router.code).toBe('ABCD')
  })

  it('tolerates a trailing slash', async () => {
    history.pushState({}, '', '/g/WXYZ/')
    const router = await freshRouter()
    expect(router.code).toBe('WXYZ')
  })

  it('rejects anything that is not four letters', async () => {
    const router = await freshRouter()
    for (const path of ['/g/ABC', '/g/ABCDE', '/g/12AB', '/g/', '/game/ABCD']) {
      router.go(path)
      expect(router.code, path).toBeNull()
    }
  })

  it('follows navigation', async () => {
    const router = await freshRouter()
    router.go('/g/PQRS')
    expect(router.code).toBe('PQRS')
    expect(location.pathname).toBe('/g/PQRS')
    router.go('/')
    expect(router.code).toBeNull()
  })

  it('follows back and forward', async () => {
    const router = await freshRouter()
    router.go('/g/PQRS')
    history.pushState({}, '', '/')
    dispatchEvent(new Event('popstate'))
    expect(router.code).toBeNull()
  })
})
