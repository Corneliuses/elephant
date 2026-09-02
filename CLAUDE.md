# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Elephant is a mobile-web party drawing game: one player draws for 90 s,
the others guess, the drawer awards 2 pts for the correct answer and 2 pts
for the funniest. Read `docs/PROPOSAL.md` for the rules and decisions and
`docs/DESIGN.md` for the architecture, events table, and client brief.
Those two docs are the source of truth; keep them in sync when behaviour
or decisions change.

Decided stack (only milestone 1 exists so far):

- `src/game/` — pure game state machine (done, tested)
- `src/room/` — Cloudflare Durable Object per room, WebSockets, alarms (not started)
- `src/worker.ts` — router + static assets (not started)
- `web/` — Svelte 5 + Vite PWA client (not started)

## Commands

```sh
npm install
npm test                                  # vitest run (all)
npx vitest run src/game/machine.test.ts   # one file
npx vitest run -t "grace carries"         # tests matching a name
npm run test:watch
npm run typecheck                         # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
```

There is no lint or format step yet. No build step yet either; the game
core is consumed as TypeScript source.

## Architecture of `src/game/`

The whole game is a pure reducer. Nothing in this directory may import
from Cloudflare, read the clock, or call `Math.random`.

- `apply(state, event) → { state, error? }`. On error the returned `state`
  is the *same object* passed in (tests assert identity). Never mutate;
  always spread. State must round-trip through JSON (it is persisted to DO
  storage).
- Every event carries `now` (ms epoch). Randomness comes in as a `seed`
  on `start_game` / `next_round` and goes through `random.ts` (mulberry32
  + Fisher–Yates) so draw orders are reproducible.
- Timers are data, not callbacks: `timerEndsAt` (phase deadline) and
  `graceEndsAt` (drawer-disconnect grace). The transport layer calls
  `nextAlarmAt(state)` after every change to schedule its alarm and sends
  a `timeout` event when it fires. `timeout` before any deadline is a
  no-op; when two deadlines have both passed, the *earlier* one is
  processed and the caller is expected to fire again.
- `project(state, viewerId)` is what goes over the wire. It hides guess
  authors (except the viewer's own) and the drawer's `intent` until the
  reveal phase, and strips `nextGuessSeq`.
- Phases: `lobby → drawing → judging → reveal → (drawing | round_end) → (drawing | ended)`.
  `judging` is skipped when there are no guesses. Completed turns are
  appended to `turns` on entering `reveal` (or when skipped); `turn` is the
  live one and, during reveal, is the same object as `turns[at(-1)]`.
- Strokes are deliberately **not** in this state. The DO relays and
  buffers them separately (see DESIGN.md "Strokes are not game state").

Rules that are easy to get wrong when extending:

- Late joiners are added to `players` on `join` but enter `drawOrder` only
  when they `set_ready` during a live phase. Only ready players may guess.
  `set_ready(false)` is lobby-only.
- `drawerIdx` bookkeeping on `leave`: index below the current drawer →
  decrement; the current drawer leaving during drawing/judging → record a
  skipped turn and begin the turn at the same index; during reveal → set
  `drawerIdx = idx - 1` so the next `advance` lands correctly. At
  `round_end`, `drawerIdx === drawOrder.length`.
- Organizer promotion picks the earliest-joined *connected* other player;
  a reconnecting former organizer does not reclaim the role.
- Correct and funniest must be different guesses unless there is exactly
  one guess. The drawer never scores.

## Tests

`src/game/machine.test.ts` is organised by event, with helpers at the top
(`lobby()`, `drawing()`, `judging()`, `reveal()`, `roundEnd()`) that build
fixtures by replaying events. `drawing(order)` searches seeds until the
requested draw order appears, so tests can name drawers explicitly. `run()`
throws on any error; `fails()` returns the error and asserts state
identity. Add new behaviour test-first in the matching `describe` block
and keep the docs' events table current.

## Conventions

- ESM, TypeScript strict. Prefer `Extract<GameEvent, {type: T}>` (the
  `Ev<T>` alias) for handler signatures.
- Error strings are matched by regex in tests (e.g. `/organizer/`,
  `/drawing/`, `/3/` for the min-player count). Keep the key noun in the
  message when rewording.
- Config lives in `DEFAULT_CONFIG` and is stored on the state; tests use
  the defaults and compute deadlines from them rather than overriding.
