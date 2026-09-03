/** Tiny router: the only real route is /g/CODE. */
class Router {
  path = $state(location.pathname)
  /** Room code from /g/ABCD, or null on the home screen. */
  code = $derived(/^\/g\/([A-Za-z]{4})\/?$/.exec(this.path)?.[1]?.toUpperCase() ?? null)

  constructor() {
    addEventListener('popstate', () => (this.path = location.pathname))
  }

  go(path: string): void {
    history.pushState({}, '', path)
    this.path = path
  }
}

export const router = new Router()
