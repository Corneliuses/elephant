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

Early. The pure game state machine lives in `src/game/` with tests. No
transport or UI yet.

```sh
npm install
npm test
```
