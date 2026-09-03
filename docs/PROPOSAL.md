# Elephant — Proposal

## One-liner

A mobile-web party game for 3–12 people in the same room. One player draws
for 90 seconds; everyone else guesses; the drawer picks the correct answer
and their favourite answer. Points accumulate, the pen passes, and after
everyone has drawn the organizer starts a new round or ends the game.

## Why

Drawing-and-guessing games are reliably fun, but the existing ones are
either bloated, ad-driven, or reward speed over wit. Elephant makes the
**favourite** answer worth exactly as much as the **correct** one, so the
game is as good for people who can't draw as for people who can. And
because correctness is graded automatically, the drawer never has to
arbitrate anything but their own taste.

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
6. **Judge.** Correctness is decided by an LLM comparing the guesses
   against what the drawer said they were drawing. The drawer's only job
   is to pick their **favourite** answer. 2 points each, and one answer
   can win both.
7. **Reveal.** Everyone sees who wrote what, what the drawer meant, and
   the updated leaderboard.
8. **Pass the pen.** Next player draws. Late joiners are slotted at the
   end of the order.
9. **Round end.** After everyone has drawn, the organizer picks
   **New round** or **End game**. End game shows final standings and a
   gallery of every drawing with its winning captions.

## Look and feel

**Bright, fun, engaging. Reactive and crunchy. Animation everywhere.**

- **Bright.** Saturated, high-contrast colour. Big type. Thick outlines.
  Nothing muted, nothing corporate. It should look like a party game from
  across the table.
- **Fun and engaging.** Every screen has something moving or waiting to
  react. Idle states are never static: the lobby breathes, the timer
  pulses, the leaderboard jostles.
- **Reactive.** Every tap answers *instantly*, before the network does.
  Buttons squash on press and spring on release. Ready flips with a pop.
  Guesses land with a thunk. Nothing feels like a form.
- **Crunchy.** Feedback has weight and snap: short, punchy easings,
  overshoot, a little shake, haptics where the platform allows. The game
  should feel good to poke at even when nothing is happening.
- **Heavy use of animation.** Phase changes are choreographed transitions,
  not cuts. Points fly to the leaderboard. The reveal is a staged moment,
  not a table. Animation is a core deliverable of the client, not polish.

Details and the motion vocabulary are in [DESIGN.md](DESIGN.md#client-look-and-feel).

## Rules (v1)

- 2 pts for the answer **graded correct** — at most one per turn, and when
  several guesses are right it goes to whoever submitted first.
- 2 pts for the answer the drawer picks as their **favourite** (exactly 1
  per turn if there are any guesses).
- **The same answer can win both**, for 4 points.
- Correctness is graded by an LLM, not by the drawer. It compares each
  guess against the drawer's own note of what they drew, so the drawer
  must write that note before they can finish drawing.
- If grading fails or is not configured, the turn is recorded as ungraded
  and only the favourite scores. The game never blocks on it.
- The drawer earns no points. Picking a favourite is the reward.
- Minimum 3 players to start. No hard maximum; UI is tuned for ≤12.

## Decisions already made

| Question | Decision |
|---|---|
| Prompts or free draw? | **Free draw.** The drawer must note what they drew — the grader needs it, and it is shown at the reveal. |
| Who decides "correct"? | **An LLM** (Gemini), server-side. The drawer only picks a favourite, so their taste is the only thing they arbitrate. |
| Several guesses correct? | **First submitted wins**, keeping the payout at 4 points a turn. |
| Drawer incentive? | **None.** |
| Platform | **Mobile web / PWA.** No native apps, no TV view in v1. |
| Backend | **Cloudflare Workers + Durable Objects.** One DO per room. See [DESIGN.md](DESIGN.md). |
| Persistence | Rooms live in DO storage for the life of the game; nothing long-term. |
| Aesthetic | **Bright, fun, engaging.** Reactive and crunchy feel; heavy use of animation. Motion is a core client deliverable. |
| Client framework | **Svelte 5 + Vite.** Native springs, transitions, and FLIP cover the animation brief without a motion library. |

## Out of scope for v1

- Accounts, history, friends lists.
- TV / big-screen "host" view.
- Custom prompt packs (moot with free draw).
- Reactions during drawing and spectator mode. On the backlog.
- Moderation / profanity filtering. It's a room of friends.

## Milestones

1. **Core** — pure game state machine with tests. *(done)*
2. **Transport** — Durable Object wrapping the machine; WebSocket protocol;
   reconnection; alarms for timers. *(done)*
3. **Client** — Svelte PWA: lobby, canvas, guess input, judging, reveal,
   leaderboard, gallery. Mobile-first. Built animated from the start: the
   motion system, press feedback, and phase transitions ship with the
   first usable screen, not after. *(done)*
4. **Grading** — correctness decided by Gemini from the DO, concurrently
   with the drawer's pick, degrading to "ungraded" on any failure.
   *(done — see DESIGN.md "Grading")*
5. **Polish** — reactions during drawing, sound design, drawing undo,
   export/share of the gallery. *(next)*

The game is playable end to end and deployed at
[elephant.brcornelius.com](https://elephant.brcornelius.com).

## Risks

- **Phones lock and Safari drops sockets.** Reconnection must be
  first-class from milestone 2, not retrofitted.
- **Free draw can produce unguessable drawings.** Mitigated by the
  favourite award: an unguessable drawing still produces a winner.
- **Animation on low-end phones.** Heavy motion can stutter or drain
  batteries on cheap Androids. Mitigated by animating only `transform` and
  `opacity`, keeping the canvas off the main animation layer, and honouring
  `prefers-reduced-motion`.
- **Workers runtime constraints** (no `setInterval` across hibernation,
  limited npm). Mitigated by keeping game logic pure and transport thin.
