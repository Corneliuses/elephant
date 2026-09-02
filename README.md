# Elephant

A phones-in-a-circle drawing game. One person draws for 90 seconds, everyone
else guesses, and the drawer awards points for the **correct** answer and the
**funniest** answer.

Named for the parable of the blind men and the elephant (Tittha Sutta): each
guesser feels one part of the picture and names it with confidence. Only the
drawer knows the whole elephant.

- [Proposal](docs/PROPOSAL.md) — what we're building and why
- [Design](docs/DESIGN.md) — architecture, state machine, protocol, edge cases

## Status

Backend done, no UI yet.

- `src/game/` — pure game state machine, tested.
- `src/room/` — Cloudflare Durable Object per room: WebSockets, storage,
  alarms, stroke relay, plus the wire protocol. Tested in workerd.
- `src/worker.ts` — HTTP router (`/api/rooms`).
- `web/` — Svelte 5 PWA client. Not started.

```sh
npm install
npm test          # game core in node, room in workerd
npm run dev       # wrangler dev
```
