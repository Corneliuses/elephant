# Elephant — Proposal

## One-liner

A mobile-web party game for 3–12 people in the same room. One player draws
for 90 seconds; everyone else guesses; the drawer picks the correct answer
and the funniest answer. Points accumulate, the pen passes, and after
everyone has drawn the organizer starts a new round or ends the game.

## Why

Drawing-and-guessing games are reliably fun, but the existing ones are
either bloated, ad-driven, or reward speed over wit. Elephant makes the
**funniest** answer worth exactly as much as the **correct** one, so the
game is as good for people who can't draw as for people who can.

The name comes from the parable of the blind men and the elephant
(Tittha Sutta). Every guesser sees one piece of the picture and names it
with total confidence. Only the drawer holds the whole elephant. That
tension — partial views, confident naming, one person who knows — *is*
the game.

## Player experience

1. **Join.** Someone opens the site, gets a room, and shares the link
   (`/g/ABCD`). Everyone else opens it on their phone.
2. **Identify.** Enter a name, pick an avatar, tap **Ready**.
3. **Lobby.** The organizer sees who's ready and taps **Start** once at
   least three people are in.
4. **Draw.** The drawer decides what to draw (free choice), optionally
   types it in privately, and has 90 seconds. Strokes stream live to
   everyone.
5. **Guess.** Every other player types a guess. Guesses can be edited
   until the timer ends.
6. **Judge.** The drawer sees anonymous answers in submission order and
   picks **Correct** (optional) and **Funniest** (required). 2 points each.
7. **Reveal.** Everyone sees who wrote what, what the drawer meant, and
   the updated leaderboard.
8. **Pass the pen.** Next player draws. Late joiners are slotted at the
   end of the order.
9. **Round end.** After everyone has drawn, the organizer picks
   **New round** or **End game**. End game shows final standings and a
   gallery of every drawing with its winning captions.

## Rules (v1)

- 2 pts for the answer the drawer marks correct (0 or 1 per turn).
- 2 pts for the answer the drawer marks funniest (exactly 1 per turn if
  there are any guesses).
- Correct and funniest must be different players, unless only one guess
  was submitted.
- The drawer earns no points. Judging is the reward.
- Minimum 3 players to start. No hard maximum; UI is tuned for ≤12.

## Decisions already made

| Question | Decision |
|---|---|
| Prompts or free draw? | **Free draw.** The drawer may privately note their intent for the reveal. |
| Drawer incentive? | **None.** |
| Platform | **Mobile web / PWA.** No native apps, no TV view in v1. |
| Backend | **Cloudflare Workers + Durable Objects.** One DO per room. See [DESIGN.md](DESIGN.md). |
| Persistence | Rooms live in DO storage for the life of the game; nothing long-term. |

## Out of scope for v1

- Accounts, history, friends lists.
- TV / big-screen "host" view.
- Custom prompt packs (moot with free draw).
- Reactions during drawing, sound, spectator mode. All on the backlog.
- Moderation / profanity filtering. It's a room of friends.

## Milestones

1. **Core** — pure game state machine with tests. *(this repo, now)*
2. **Transport** — Durable Object wrapping the machine; WebSocket protocol;
   reconnection; alarms for timers.
3. **Client** — PWA: lobby, canvas, guess input, judging, reveal,
   leaderboard. Mobile-first.
4. **Polish** — gallery/export, reactions, timer sound, install prompt.

## Risks

- **Phones lock and Safari drops sockets.** Reconnection must be
  first-class from milestone 2, not retrofitted.
- **Free draw can produce unguessable drawings.** Mitigated by the
  funniest award: an unguessable drawing still produces a winner.
- **Workers runtime constraints** (no `setInterval` across hibernation,
  limited npm). Mitigated by keeping game logic pure and transport thin.
