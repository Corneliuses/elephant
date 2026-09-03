# Building a real-time drawing game in Svelte 5

*Notes from writing the client for [Elephant](https://elephant.brcornelius.com),
a phones-in-a-circle party game: one person draws for 90 seconds, everyone else
guesses on their own phone, and the drawer awards points for the right answer
and, separately, for the funniest one.*

The backend was already done and boring in the good way — a pure reducer in
`src/game/`, a Cloudflare Durable Object per room relaying WebSocket messages.
The client was the interesting part, because a party game has an unusual
requirement profile: eight phones on bad bar Wi-Fi, a canvas taking a stroke
point every few milliseconds, and an aesthetic brief that literally said
"bright, fun, crunchy, animation-heavy."

I picked Svelte 5. Here's what that was actually like.

---

## The whole store is one class

This is the part that felt most different coming from React. All shared client
state in the app is this, in `web/src/lib/room.svelte.ts`:

```ts
class Room {
  code = $state<string | null>(null)
  status = $state<Status>('idle')
  game = $state<ProjectedState | null>(null)
  strokes = $state<Stroke[]>([])

  me = $derived(this.game?.you ? this.game.players[this.game.you] ?? null : null)
  isDrawer = $derived(!!this.game?.turn && this.game.turn.drawerId === this.game.you)
  ranked = $derived([...this.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt))
}

export const room = new Room()
```

No provider, no context, no `useSyncExternalStore`, no selector functions. A
component does `import { room } from '../lib/room.svelte'` and reads
`room.isDrawer`. The `.svelte.ts` extension is the only ceremony — it's what
tells the compiler to process runes in a plain module.

The consequence I didn't anticipate: because the store is a class instance and
not a hook, **the socket can live inside it.** `room.connect(code)` opens the
WebSocket, handles reconnect backoff, parses server messages, and assigns to
`this.game`. The reactivity is a side effect of assignment, so there's no
bridge between "network layer" and "state layer" — they're the same 217-line
file. In React I'd have written a store, a provider, a hook, and an effect to
wire the socket to the store. Here the socket *is* the store's private field.

Compare the two halves of message handling:

```ts
case 'state':
  this.game = msg.state          // every countdown, chip, and score updates
  clock.sync(msg.now)
  break
case 'strokes':
  if (msg.reset) { this.strokes = msg.strokes; this.strokeEpoch++ }
  else this.strokes.push(...msg.strokes)   // mutation is fine; $state is deep
  break
```

That `.push()` matters. Twenty times a second during a live drawing, the server
sends a batch of stroke points. In an immutable-state world each batch means
rebuilding the array. Svelte's `$state` proxies deeply, so appending is both
reactive *and* O(new points).

## `$derived` and `$effect` have no dependency arrays, and that stops being a novelty fast

I expected "no dependency array" to be a small ergonomic win. It's bigger than
that, because the dependency array is where staleness bugs come from, and there
are a *lot* of derived values in a game client.

```svelte
<script>
  const game = $derived(room.game!)
  const turn = $derived(game.turn!)
  const drawer = $derived(game.players[turn.drawerId])
  const myGuess = $derived(turn.guesses.find((g) => g.playerId === game.you) ?? null)
</script>
```

Four chained derivations across three levels of a projected server state. Any of
them can change on any socket message. I never once thought about it. The
compiler tracks the reads.

The same applies to effects. This is the whole of the app-level phase mirror:

```svelte
$effect(() => {
  document.body.dataset['phase'] = room.game?.phase ?? (router.code ? 'connecting' : 'home')
})
```

It re-runs when the phase changes because it *read* the phase. (The e2e script
keys off `<body data-phase>` to know what screen it's looking at, which turned
out to be the single most useful three lines in the repo for testing.)

## `<script>` runs once — and that reframes how you write components

The mental model shift that took longest: in Svelte 5 a component's `<script>`
body executes **once per instance**, not once per render. There is no render.
The compiler emits code that updates the specific DOM nodes depending on a
changed value.

So this is fine:

```svelte
let outbox: Stroke[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
```

A plain mutable array, declared in component scope, used as a network buffer. No
`useRef`, no wrapper. It's just a local variable in a function that runs once.

Nothing needs memoising, because nothing re-runs. I kept reaching for the
React reflex — "should this be `useMemo`?" — and having to remember the question
doesn't apply. That reflex took about three days to unlearn.

## The canvas: knowing when to leave the reactive graph

The hardest part of the client, and the place where the framework's job was to
get out of the way.

Strokes are *not* game state — the reducer never sees them; the DO relays and
buffers them separately. On the client they're an array in the store, but the
canvas cannot be a reactive DOM tree. Rendering a thousand `<path>` elements
through a diff, sixty times a second, on a three-year-old Android, is not a
plan.

So `Canvas.svelte` paints imperatively, and subscribes to exactly two scalars:

```svelte
$effect(() => {
  epoch
  strokes.length
  painter?.sync(strokes, epoch)
})
```

Those two bare expression statements *are* the subscription. Reading them
registers the dependency; the painter then decides what actually happened.

`epoch` exists because of a bug I'd have shipped otherwise. When a new turn
starts, the server sends `strokes {reset: true}` — replace your buffer. A length
comparison can't detect that: a reset can leave the array the same length it
already was, and then the canvas keeps a previous drawing's ink under the new
one. So the store bumps `strokeEpoch` whenever the buffer is *replaced* rather
than appended to, and the painter distinguishes:

```ts
sync(strokes: readonly Stroke[], epoch: number): SyncResult {
  if (epoch !== this.#epoch || strokes.length < this.#painted) {
    this.#epoch = epoch
    this.#repaint(strokes)      // full
  }
  // ...otherwise paint only strokes[painted..] — incremental
}
```

I pulled all of that into `lib/paint.ts`, outside the component, specifically so
it could be tested against a recording fake 2D context instead of a browser.
That's a general lesson rather than a Svelte one, but Svelte made it easy: the
component keeps a `StrokePainter` in a plain `let`, and the reactive surface is
five lines.

The other half is latency. Ink appears on the drawer's screen in the same frame
as the pointer event; network sends are batched on a 50 ms interval. The server
deliberately never echoes the drawer's own strokes back, so the drawer appends
locally:

```ts
function onstrokes(batch: Stroke[]) {
  room.strokes.push(...batch)   // local ink, this frame
  outbox.push(...batch)         // wire, next flush
}
```

## Animation without a motion library

The original design doc had an open question: Motion/Framer vs. Web Animations
API plus custom springs. Choosing Svelte closed it, and that was a real part of
the decision — the animation brief was heavy, and shipping 30 KB of motion
library to a phone on bar Wi-Fi was a cost I didn't want.

`svelte/transition`, `svelte/animate`, and CSS covered everything. The
leaderboard reorder — the moment scores land and players swap places, which is
the emotional peak of a round — is one attribute:

```svelte
{#each players as p, i (p.id)}
  <li animate:flip={{ duration: 420 }} class:lead={i === 0 && p.score > 0}>
```

Keyed each block, `animate:flip`, done. Guess bubbles fly in, cards scale on
award, the connecting elephant breathes via a CSS keyframe. Zero runtime
dependencies in the client bundle beyond Svelte itself.

The one place I'd flag for someone doing this again: transitions are keyed, so a
replaced element runs its `out:` while the new one runs its `in:`. That's what
you want for interruptibility — a new state arriving mid-transition retargets
rather than queues — but it means your `(key)` expressions carry more weight
than they look like they do.

## Shared types across the wire, for free

Vite alias, four lines:

```ts
resolve: { alias: { $shared: fileURLToPath(new URL('../src', import.meta.url)) } }
```

The client imports `ProjectedState` and `ClientMessage` directly from the worker
source. Not a generated package, not a duplicated `types.ts` — the same files
the Durable Object compiles against. Protocol drift is a type error at
`npm run typecheck`. This isn't Svelte's doing, but it's what a Vite-native
framework buys you, and it caught two real mismatches during the reveal-phase
work.

## Optimistic UI needs a pattern, and it's four lines

Taps have to answer before the round-trip. The pattern I settled on, from
`Lobby.svelte`:

```svelte
let pending = $state<boolean | null>(null)
const shown = $derived(pending ?? iAmReady)
$effect(() => {
  if (pending !== null && pending === iAmReady) pending = null
})
```

A nullable local override that shadows server truth, and releases itself the
moment the server agrees. Reads cleanly, no reconciliation library, and it
degrades correctly — if the server rejects the action, `pending` never matches
and the next state message wins.

## Testing

`happy-dom` plus a `FakeWS` class the tests drive by hand covers the store:
reconnect backoff, each WebSocket close code (4001 forgets credentials, 4004
stops retrying, 4000 was deliberate), and the `visibilitychange` wake-up — which
is what a phone unlocking actually produces, and the thing most likely to break
in real use.

Components themselves I test through Playwright rather than a component-testing
harness: `scripts/e2e.mjs` runs five scenarios in three real browsers against
`wrangler dev`, including a full game to the gallery and a drawer vanishing
mid-turn. That caught bugs unit tests and `tsc` did not. I don't think this is a
Svelte-specific conclusion, but Svelte components being thin — because the logic
lives in `.svelte.ts` modules and `paint.ts` — is what made "don't unit-test the
components" a defensible position rather than an excuse.

## What I'd flag if you're evaluating it

**Genuinely good:**
- Shared state without a state-management library or provider tree. This is the
  headline. The class-with-runes pattern scales to a real app.
- No dependency arrays, no memoisation, no stale-closure class of bug.
- Animation in the box, at zero bundle cost.
- Small output. The entire client — eight screens, canvas, PWA, framework and
  all app code — is **27.9 KB of gzipped JavaScript** and 3.7 KB of CSS. A
  React + Motion equivalent starts above that before I write a line.

**Real friction:**
- `$state` on a class field is a compiler transform, so it works in
  `.svelte.ts` and `.svelte` and nowhere else. Move a helper into a plain `.ts`
  and it silently stops being reactive. That's a rename away from a confusing
  afternoon.
- The docs and the ecosystem are still partly on Svelte 4 idioms (stores,
  `$:`). Search results actively mislead. Read the runes docs directly.
- Deep reactivity via proxies is convenient until you hand a `$state` array to
  something that identity-compares. My canvas needed an explicit `epoch`
  counter precisely because "did this change?" isn't always answerable from the
  value.
- Fewer escape hatches when you want to opt *out* of the framework. Doable —
  the canvas does it — but you're writing the boundary yourself.

**The honest summary:** for an app that is mostly one live server state fanned
out to a dozen small animated components, with one performance-critical
imperative island, Svelte 5 was the right call and it wasn't close. The runes
model made the store trivial, and the compiler made "just mutate the array"
a legitimate answer for the hot path.

---

*Source: [`Corneliuses/elephant`](https://github.com/Corneliuses/elephant) —
`web/` is the Svelte client, `src/game/` the pure reducer, `src/room/` the
Durable Object.*
