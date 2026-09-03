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

Playable end to end and deployed at
[elephant.brcornelius.com](https://elephant.brcornelius.com).

- `src/game/` — pure game state machine, tested.
- `src/room/` — Cloudflare Durable Object per room: WebSockets, storage,
  alarms, stroke relay, plus the wire protocol. Tested in workerd.
- `src/worker.ts` — HTTP router (`/api/*`); everything else is served from
  the built client in `web/dist`.
- `web/` — Svelte 5 PWA client, installable, every phase playable.

```sh
npm install
npm test          # game in node, room in workerd, client in happy-dom
npm run build     # build the client into web/dist
npm run dev       # wrangler dev: worker + DO + built assets, :8787
npm run e2e       # five real-browser scenarios against `npm run dev`
```
