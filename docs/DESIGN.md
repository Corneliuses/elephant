# Elephant — Design

## Goals

- Real-time, low-latency drawing for a handful of phones in one room.
- Server is the single authority on game phase, timers, and scoring.
- Survive phone locks, tab backgrounding, and deploys without killing a
  game in progress.
- Game logic is pure, deterministic, and unit-testable with no I/O.

## Non-goals

- Horizontal scale beyond "one room fits in one Durable Object" (it will,
  by orders of magnitude).
- Long-term storage of games.

## Architecture

```
┌──────────────┐   HTTPS (static)   ┌──────────────────────────┐
│  PWA client  │◄──────────────────►│  Cloudflare Worker       │
│  (phone)     │                    │  - serves static assets   │
│              │   WebSocket        │  - routes /g/:code → DO   │
│              │◄──────────────────►│                          │
└──────────────┘                    │  ┌────────────────────┐  │
                                    │  │ RoomDO (per room)  │  │
                                    │  │  - holds sockets   │  │
                                    │  │  - runs game.ts    │  │
                                    │  │  - storage + alarm │  │
                                    │  └────────────────────┘  │
                                    └──────────────────────────┘
```

**One Durable Object per room**, named by room code. The DO:

- accepts WebSockets using the Hibernatable WebSocket API, tagged with the
  player id, so idle rooms cost nothing;
- keeps the authoritative `GameState` in memory and persists it to DO
  storage on every change;
- relays stroke events (not part of `GameState`, see below);
- uses the DO **alarm** for every timer (drawing, judging, reveal,
  disconnect grace);
- projects the state per player before sending (guessers never see
  authors during judging; only the drawer sees their own intent).

Everything the DO does is thin glue. The rules live in `src/game/`.

## Layering

```
src/game/         pure state machine — zero I/O, zero Cloudflare imports
src/room/         RoomDO (sockets, storage, alarm, stroke relay) + wire protocol
src/worker.ts     router; will also serve static assets                   (milestone 3)
web/              PWA client: Svelte + Vite                                 (milestone 3)
```

The boundary is `apply(state, event) → { state, error? }`. The DO never
mutates state itself; it constructs events (from client messages, from
alarms, from socket lifecycle) and applies them.

## Game state machine

### Phases

```
            start_game (organizer, ≥3 ready)
  LOBBY ───────────────────────────────────► DRAWING
                                                │
                     end_drawing (drawer) / timeout (90s)
                                                │
                                                ▼
                                             JUDGING ─── no guesses ──┐
                                                │                     │
                          judge (drawer) / timeout (60s, no awards)   │
                                                │                     │
                                                ▼                     │
                                             REVEAL ◄─────────────────┘
                                                │
                          advance (organizer) / timeout (8s)
                                                │
                     ┌──────────────────────────┴───────────────┐
                     │ more drawers this round                  │ everyone has drawn
                     ▼                                          ▼
                  DRAWING                                   ROUND_END
                                                                │
                                        next_round (organizer)  │  end_game (organizer)
                                                ▼               ▼
                                             DRAWING          ENDED
```

### State shape

```ts
type Phase = 'lobby' | 'drawing' | 'judging' | 'reveal' | 'round_end' | 'ended'

interface GameState {
  code: string
  phase: Phase
  organizerId: PlayerId | null
  players: Record<PlayerId, Player>
  round: number                     // 0 in lobby, 1 for first round
  drawOrder: PlayerId[]             // this round's order
  drawerIdx: number                 // index into drawOrder
  turn: Turn | null                 // the live turn (drawing/judging/reveal)
  turns: Turn[]                     // completed turns, for gallery
  timerEndsAt: number | null        // ms epoch; the "main" deadline for the phase
  graceEndsAt: number | null        // ms epoch; drawer-disconnect grace, if any
}

interface Player {
  id: PlayerId
  name: string
  avatar: string
  ready: boolean
  connected: boolean
  joinedAt: number
  score: number
}

interface Turn {
  drawerId: PlayerId
  intent: string | null             // drawer's private note; public at reveal
  guesses: Guess[]                  // in submission order
  correctGuessId: GuessId | null
  funniestGuessId: GuessId | null
  skipped: boolean                  // drawer left / disconnected past grace
}

interface Guess { id: GuessId; playerId: PlayerId; text: string; submittedAt: number }
```

### Events

All events carry `now` (ms epoch) so the reducer never calls `Date.now()`.

| Event | From | Allowed in | Effect |
|---|---|---|---|
| `join {playerId, name, avatar}` | client | any but `ended` | Add player (not ready). First player becomes organizer. |
| `set_ready {playerId, ready}` | client | any but `ended` | Toggle in the lobby. Mid-game only `ready: true` is accepted, and during `drawing`/`judging`/`reveal` it appends the player to `drawOrder`. |
| `start_game {playerId, seed}` | organizer | `lobby` | Requires ≥3 ready players. Shuffles ready players into `drawOrder` (seeded), starts round 1, turn 1. |
| `set_intent {playerId, text}` | drawer | `drawing` | Private note of what's being drawn. |
| `submit_guess {playerId, text}` | guesser | `drawing` | Upsert this player's guess. Editing moves it to the end of the order. |
| `end_drawing {playerId}` | drawer | `drawing` | Early finish → `judging` (or straight to `reveal` if no guesses). |
| `judge {playerId, correctGuessId?, funniestGuessId}` | drawer | `judging` | Award points → `reveal`. |
| `advance {playerId}` | organizer | `reveal` | Skip the reveal timer. |
| `next_round {playerId, seed}` | organizer | `round_end` | New round with all connected players, reshuffled. |
| `end_game {playerId}` | organizer | `round_end` | → `ended`. |
| `disconnect {playerId}` | DO | any | Mark disconnected. Drawer in `drawing`/`judging` starts grace timer. Organizer disconnect promotes the longest-connected player. |
| `reconnect {playerId}` | DO | any | Mark connected; clear grace if drawer. |
| `leave {playerId}` | client/DO | any | Remove player. Current drawer leaving skips the turn. |
| `timeout` | DO (alarm) | timed phases | Fires whichever deadline has passed (the earlier one first if both have): drawing → judging; judging → reveal with no awards; reveal → next turn; grace → skip turn. Before any deadline it is a no-op. |

`nextAlarmAt(state)` returns the earliest pending deadline (or `null`) so
the DO can call `storage.setAlarm()` after every change.

### Scoring rules

- `judge` requires `funniestGuessId` unless the turn has zero guesses
  (in which case the reducer never enters `judging` at all).
- `correctGuessId` is optional.
- `correctGuessId !== funniestGuessId` unless there is exactly one guess.
- Each award is 2 points to the guess's author.
- The drawer earns nothing.
- A skipped turn awards nothing and is recorded with `skipped: true`.

### Turn advancement

After `reveal`, `drawerIdx + 1`. If it equals `drawOrder.length`, phase →
`round_end`. Otherwise start a new turn with the next drawer. If the next
drawer is disconnected, skip them (recorded as a skipped turn) and try the
following one; if nobody in the remaining order is connected, → `round_end`.

### Late joiners

A `join` mid-game adds the player but does nothing else: they are in the
room but not in the game until they hit **Ready**. `set_ready` during
`drawing`/`judging`/`reveal` appends them to `drawOrder` so they draw this
round, and from then on they can `submit_guess`. `set_ready` during
`round_end` just marks them; they're included when the organizer starts
the next round. Only ready players may guess.

### Draw order

Seeded Fisher–Yates over the eligible players so the reducer stays pure and
tests are deterministic. The DO supplies `seed` from `crypto.getRandomValues`.

## Strokes are not game state

Drawing produces 30–60 events/second. Threading those through an immutable
reducer and persisting on each one is wasteful and pointless: strokes have
no rules. The DO handles them separately:

- A `stroke` message from the current drawer during `drawing` is appended
  to an in-memory `strokes: Stroke[]` buffer and fanned out to every other
  socket. Strokes from anyone else, or in any other phase, are dropped.
- The buffer is persisted to storage in batches (e.g. every 500 ms) so a
  DO restart mid-turn loses at most half a second of ink.
- On reconnect or late join, the client receives the full buffer to replay.
- When the turn ends, the buffer is attached to the completed `Turn` for
  the gallery, then cleared.

```ts
type Stroke =
  | { t: 'down'; x: number; y: number; color: string; width: number }
  | { t: 'move'; x: number; y: number }
  | { t: 'up' }
  | { t: 'clear' }
```

Coordinates are normalised to `[0, 1]` so every phone renders the same
picture regardless of screen size.

## HTTP API (worker)

| Route | Purpose |
|---|---|
| `POST /api/rooms` | Create a room. Body `{config?, room?}` (see `CreateRoomRequest`). Returns `201 {code}`. |
| `GET /api/rooms/:code` | `RoomInfo` `{code, phase, playerCount}` or 404. |
| `GET /api/rooms/:code/ws` | WebSocket upgrade (426 without `Upgrade`, 404 for unknown rooms). Optional `?playerId=&secret=` to reconnect. |
| `GET /api/rooms/:code/turns/:i/strokes` | Stroke log of turn `i` for the gallery. |

Config overrides at creation are clamped to sane ranges (each timer 1 ms
to 1 h, etc.); the same fields the game uses. `room.idleTtlMs` and
`room.endedTtlMs` control garbage collection.

The worker forwards to the DO with the room code baked into the DO name
(`idFromName(code)`); the DO learns its code from the `/create` body.
Creation retries with a fresh code if the DO already holds a live game.

## Wire protocol

Types live in `src/room/protocol.ts` and are shared with the client.

**Client → server.** The game events minus `now` and `playerId` (the DO
stamps both; anything the client sends for those is ignored), plus:

- `join {name, avatar}` — first message on a fresh socket.
- `stroke {strokes: Stroke[]}` — batched; accepted only from the current
  drawer during `drawing`, silently dropped otherwise, `error` if malformed.
- `leave` — remove the player; the server closes the socket with 4000.

**Server → client.**

- `welcome {playerId, secret}` — once, after a successful `join`.
- `state {state: ProjectedState}` — full projected state on connect and
  after every change. Small enough (<10 KB) that diffs aren't worth it.
- `strokes {strokes, reset?}` — relay batch, or with `reset: true` the
  full buffer to replace whatever the client has. A reset is sent on
  join/reconnect and (empty) when a new turn starts, **before** the
  `state` that announces the turn, so the canvas clears first.
- `error {message}` — from a rejected event or malformed message. The
  socket stays open.

Messages over 64 KB or that are not a JSON object with a string `type`
are rejected. Close codes: 4000 left, 4001 unauthorized, 4002 replaced
by a newer socket for the same player, 4004 room gone.

`project(state, viewerId)` strips: other players' guess authorship during
`drawing`/`judging`; `intent` unless viewer is the drawer or phase is
`reveal`+.

## Reconnection

On first join the client stores `{code, playerId, secret}` in
`localStorage`. The WebSocket URL carries `playerId` + `secret`; the DO
checks it against storage and, if valid, applies `reconnect` instead of
`join` (no `welcome` is sent). A bad or unknown credential gets an
`error` then close 4001. One socket per player: a new one closes the old
with 4002 without marking the player disconnected. Socket close applies
`disconnect` only when the player has no other open socket. The DO never
removes a player on disconnect — only an explicit `leave` or the room
being garbage collected does.

The DO uses the Hibernatable WebSocket API; the player id is kept in the
socket attachment so it survives hibernation.

## Room lifecycle

- Room codes: 4 uppercase letters from an alphabet without look-alikes
  (no I or O).
- The Worker creates a room by picking a code and asking the DO to
  `/create`; a 409 (live game already there) means pick another.
- A room with no connected players for 30 minutes deletes its storage
  (via alarm). A room in `ended` for 24 hours does the same, closing any
  remaining sockets with 4004. The DO alarm is the single timer: it
  serves game deadlines, the disconnect grace, and both TTLs, always
  armed at the earliest of them.

## Timers

| Timer | Duration | Set on |
|---|---|---|
| Drawing | 90 s | entering `drawing` |
| Judging | 60 s | entering `judging` |
| Reveal | 8 s | entering `reveal` |
| Drawer-disconnect grace | 15 s | drawer `disconnect` during `drawing`/`judging` |

All durations are constants in `src/game/config.ts`. They can be
overridden per room at creation (`POST /api/rooms` body); the room tests
use millisecond values to exercise the alarm path.

## Testing strategy

`src/game/` is tested with vitest, no mocks: build a state, apply events,
assert on the result. Coverage targets every row of the events table and
every edge case in the proposal.

`src/room/` is tested with `@cloudflare/vitest-pool-workers`: the suite
drives the real worker through `SELF` over HTTP and WebSockets and fires
DO alarms with `runDurableObjectAlarm`. Miniflare also runs real alarms,
so tests that set millisecond TTLs assert on the outcome rather than on
whether the manual alarm call did the work.

## Client stack

- **Svelte 5 + Vite**, TypeScript, served as static assets from the Worker.
  Chosen over React + Motion because Svelte ships springs, enter/exit
  transitions, and FLIP natively, so the animation-heavy brief is covered
  without a 30 KB motion library, and because a smaller bundle matters on
  a phone on bar Wi-Fi.
- **State:** one `$state` store holding the latest `ProjectedState` from
  the socket, plus a thin layer of local "optimistic" flags so taps answer
  before the round-trip (a pressed Ready flips immediately and reconciles
  when the server echoes).
- **Drawing canvas:** a plain `<canvas>` component that consumes the
  stroke feed directly. Not a Svelte-managed DOM tree: strokes never touch
  the reactive graph.
- **PWA:** `vite-plugin-pwa` for the manifest and a minimal service worker
  (precache the shell, network-first for everything else). No offline
  play; the point is the home-screen install and full-screen chrome.
- **Shared types:** the client imports `GameEvent` / `ProjectedState`
  from `src/game/` so the wire protocol has one definition.

## Client: look and feel

The proposal's brief: **bright, fun, engaging; reactive and crunchy; heavy
use of animation.** This section turns that into rules the client is built
against.

### Visual language

- **Colour.** A small, saturated palette on a light ground: one hot
  primary, two or three loud accents, ink-black outlines. Each player's
  avatar carries one accent so their name, guess bubble, and score share a
  colour everywhere they appear. Dark mode is a *different bright*, not a
  dimmed one.
- **Type.** One chunky display face for headings, numbers and buttons; one
  clean sans for body. Sizes err large: this is read at arm's length on a
  phone in a noisy room.
- **Shape.** Big radii, thick borders, hard drop shadows that shift on
  press. Cards and buttons look like things you can pick up.
- **The canvas** is the one calm surface: white, edge-to-edge, no chrome
  over it. Everything loud lives around it.

### Motion principles

1. **Respond before the server does.** Every tap gets local feedback in
   the same frame: press squash, colour flip, sound. The server's state
   arrives ~50 ms later and the UI reconciles quietly. Never gate a button
   animation on a round-trip.
2. **Crunchy, not floaty.** Durations 120–300 ms for feedback, 300–600 ms
   for transitions. Spring easings with visible overshoot for arrivals;
   sharp ease-out for exits. Nothing linear, nothing slow.
3. **Choreograph phase changes.** A phase change is a scene change:
   outgoing elements leave, a beat, incoming elements stagger in. The order
   tells the story (timer leaves → answers arrive → drawer's pick pops).
4. **Idle is alive.** Waiting states have a low-amplitude loop: the timer
   ring breathes, the ready badges bob, the "waiting for drawer" dots
   march. Small, cheap, always there.
5. **Weight.** Points have mass: they fly from the guess to the score,
   the score bumps when they land, the leaderboard reorders with players
   physically sliding past each other.
6. **Sound and haptics are part of the feel** (short ticks, pops, a
   whoosh on reveal, a single vibrate on award) but everything must read
   without them: phones are muted in company.

### Signature moments

| Moment | What happens |
|---|---|
| Ready toggle | Button squashes, flips colour with a pop, avatar bounces in the roster. Organizer's roster ripples as each badge lands. |
| Start game | Lobby cards scatter off-screen, the canvas slides up, the drawer's avatar stamps onto it, the 90-s ring snaps full and starts draining. |
| Timer | Ring drains with a taut easing; last 10 s it pulses and the whole timer shakes harder each second. |
| Guess submitted | Bubble thunks into the drawer's list with a squash; the guesser's own bubble sticks to their screen with a wiggle. Editing a guess slides it to the end. |
| End of drawing | Canvas shrinks to a card, answers cascade in one by one (staggered, anonymous). Drawer taps to mark **Correct** (green stamp, screen flash) and **Funniest** (gold burst, confetti). |
| Reveal | Each bubble flips to show its author's avatar. Points spawn as chips, fly to the leaderboard, land with a bump. The drawer's intent unfurls last: *"It was… a giraffe on a jet ski."* |
| Leaderboard | Rows slide past each other on reorder; the leader's row gets a subtle shimmer; ties wobble. |
| Round end / final | Winner's card grows and rocks; the gallery deals every drawing out like cards. |
| Errors / rejections | Shake, not a modal. A red wiggle on the thing that was tapped. |

### Implementation constraints

- Animate only `transform` and `opacity`. No layout-triggering properties
  in loops. Anything else must be a one-off transition.
- The drawing canvas renders strokes directly (no per-stroke DOM); it is
  never inside an animating ancestor during `drawing`.
- Motion comes from Svelte's built-ins, not a third-party library:
  `svelte/motion` (`spring`, `tweened`) for values with physics,
  `svelte/transition` (`in:`/`out:`, `fly`, `scale`, `crossfade`) for
  enter/exit choreography, and `svelte/animate` (`flip`) for the
  leaderboard reorder. The Web Animations API fills the gaps (long idle
  loops, anything that must stay smooth while the canvas is busy).
  Feedback micro-interactions are plain CSS. Do not add a motion library.
- Honour `prefers-reduced-motion`: cut loops, replace movement with fades,
  keep the feedback (colour, sound) so the game still feels responsive.
- Every animation is interruptible. A new state arriving mid-transition
  retargets; it never queues. Svelte's `spring` store does this natively
  (setting a new target keeps current velocity); transitions are keyed so
  a replaced element runs its `out:` while the new one runs its `in:`.
- Budget: 60 fps on a mid-range Android from three years ago. Test there,
  not on the newest iPhone.

### Accessibility

Bright is not the same as legible. Text and outlines meet WCAG AA contrast
against every accent. Colour never carries meaning alone (correct is a
check *and* green; funniest is a star *and* gold). Touch targets ≥ 44 px.

## Open questions

- Should a reconnecting organizer reclaim organizer status? (v1: no.)
- Should the reveal show guesses one at a time on the drawer's tap, or all
  at once? Client concern; the state machine is indifferent.
- Do we want a "kick player" for the organizer? Cheap to add as a `leave`
  issued by the organizer.
- ~~Motion library: Motion (Framer) vs. Web Animations API + custom
  springs.~~ Decided: Svelte built-ins plus WAAPI. See *Client stack*.
