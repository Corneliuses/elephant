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
src/room/         Durable Object: sockets, storage, alarm, stroke relay   (milestone 2)
src/worker.ts     router + static assets                                  (milestone 2)
web/              PWA client                                              (milestone 3)
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
| `join {playerId, name, avatar}` | client | any but `ended` | Add player. First player becomes organizer. During a round, appended to `drawOrder`. |
| `set_ready {playerId, ready}` | client | `lobby` | Toggle ready. |
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
| `timeout` | DO (alarm) | timed phases | Fires whichever deadline has passed: drawing → judging; judging → reveal with no awards; reveal → next turn; grace → skip turn. |

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

A `join` during `drawing`/`judging`/`reveal` appends the player to
`drawOrder` so they draw this round. They can `submit_guess` immediately.
A `join` during `round_end` just adds them to `players`; they're included
when the organizer starts the next round.

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

## Wire protocol (milestone 2)

Client → server messages are the game events above minus `now` and
`playerId` (the DO stamps both), plus `stroke`. Server → client:

- `state {state: ProjectedState}` — full projected state on connect and
  after every change. Small enough (<10 KB) that diffs aren't worth it.
- `strokes {strokes: Stroke[]}` — batched relay.
- `error {message}` — from a rejected event.

`project(state, viewerId)` strips: other players' guess authorship during
`drawing`/`judging`; `intent` unless viewer is the drawer or phase is
`reveal`+.

## Reconnection

On first join the client stores `{code, playerId, secret}` in
`localStorage`. The WebSocket URL carries `playerId` + `secret`; the DO
checks it against storage and, if valid, applies `reconnect` instead of
`join`. Socket close applies `disconnect`. The DO never removes a player
on disconnect — only an explicit `leave` or the room being garbage
collected does.

## Room lifecycle

- Room codes: 4 uppercase letters, excluding ambiguous glyphs (I, O).
- The Worker creates a room by picking a code and forwarding to the DO.
- A room with no connected players for 30 minutes deletes its storage
  (via alarm). A room in `ended` for 24 hours does the same.

## Timers

| Timer | Duration | Set on |
|---|---|---|
| Drawing | 90 s | entering `drawing` |
| Judging | 60 s | entering `judging` |
| Reveal | 8 s | entering `reveal` |
| Drawer-disconnect grace | 15 s | drawer `disconnect` during `drawing`/`judging` |

All durations are constants in `src/game/config.ts` and can be overridden
by passing a `config` to the reducer (tests use short values).

## Testing strategy

`src/game/` is tested with vitest, no mocks: build a state, apply events,
assert on the result. Coverage targets every row of the events table and
every edge case in the proposal. The DO layer (milestone 2) is tested with
`@cloudflare/vitest-pool-workers` against a real Miniflare DO.

## Open questions

- Should a reconnecting organizer reclaim organizer status? (v1: no.)
- Should the reveal show guesses one at a time on the drawer's tap, or all
  at once? Client concern; the state machine is indifferent.
- Do we want a "kick player" for the organizer? Cheap to add as a `leave`
  issued by the organizer.
