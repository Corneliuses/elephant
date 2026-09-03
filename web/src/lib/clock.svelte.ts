/**
 * A single ticking clock for the whole app, corrected against the server.
 *
 * One rAF loop drives every countdown; components read `clock.now` and the
 * compiler updates only the nodes that depend on it. rAF pauses on its own
 * when the tab is hidden, so a backgrounded phone costs nothing.
 */
class Clock {
  /** Server-corrected wall clock, ms epoch. */
  now = $state(Date.now())

  #offset = 0
  #running = false

  /** Fold in the server timestamp that came with a state message. */
  sync(serverNow: number): void {
    this.#offset = serverNow - Date.now()
    this.now = Date.now() + this.#offset
    this.#start()
  }

  #start(): void {
    if (this.#running) return
    this.#running = true
    const tick = () => {
      this.now = Date.now() + this.#offset
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}

export const clock = new Clock()
