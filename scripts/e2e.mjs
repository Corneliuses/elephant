/*
 * Full-stack smoke tests: real Worker, real Durable Object, real browsers.
 *
 *   npm run build && npx wrangler dev --port 8787   # terminal 1
 *   node scripts/e2e.mjs                            # terminal 2
 *
 * Each scenario builds its own room, so they are independent and can be run
 * in any order. Rooms are created through the API rather than the UI when a
 * scenario needs short timers.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.ELEPHANT_URL ?? 'http://127.0.0.1:8787'
// Use the sandbox's preinstalled Chromium when present, otherwise let
// Playwright pick the browser it downloaded itself (CI runners).
const PRESET = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium'
const EXECUTABLE = PRESET && existsSync(PRESET) ? PRESET : null

const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {})
if (!EXECUTABLE) log('using Playwright-managed Chromium')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pages = []

/**
 * `locale` sets what the browser reports as its language, which is what the
 * client's picker defaults to. Pinning it to English keeps every other
 * scenario reading English text whatever the machine running this is set to.
 */
async function newPage(locale = 'en-US') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log('  !! pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && log('  !! console:', m.text()))
  pages.push(page)
  return page
}

/** Create a room through the API so scenarios can shorten the timers. */
async function createRoom(body = {}) {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`create room failed: ${res.status}`)
  return (await res.json()).code
}

const atPhase = (page, phase, timeout = 15000) =>
  page.waitForFunction((p) => document.body.dataset.phase === p, phase, { timeout })

async function joinAs(page, code, name) {
  await page.goto(`${BASE}/g/${code}`)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Join the room' }).click()
  await page.getByRole('button', { name: /I'm ready/ }).waitFor({ timeout: 10000 })
  return page
}

/**
 * Three players joined, ready, and started: the first drawer is deciding
 * what to draw. Returns the pages keyed by name. The drawer may finish at
 * once unless a scenario says otherwise; the minimum has its own scenario.
 */
async function startedRoom(config = {}) {
  const code = await createRoom({ config: { minDrawingMs: 0, ...config } })
  const by = {}
  for (const name of ['Ada', 'Bo', 'Cy']) by[name] = await joinAs(await newPage(), code, name)
  for (const p of Object.values(by)) await p.getByRole('button', { name: /I'm ready/ }).click()
  const organizer = by.Ada
  await organizer.waitForFunction(() => document.body.textContent.includes('3 ready'), null, { timeout: 10000 })
  await organizer.getByRole('button', { name: 'Start game' }).click()
  for (const p of Object.values(by)) await atPhase(p, 'prep')
  return { code, by, organizer }
}

/**
 * Who holds the pen right now, as seen by `viewer`. The header names the
 * drawer to everyone else, in the viewer's own language; a header that names
 * nobody is the drawer's own.
 */
async function whoDraws(by, viewer) {
  const text = await viewer.evaluate(() => document.querySelector('header strong')?.textContent ?? '')
  const named = Object.keys(by).find((name) => text.includes(name))
  if (named) return named
  return Object.entries(by).find(([, p]) => p === viewer)[0]
}

// The drawer's own controls, in every language a scenario runs in.
const INTENT_FIELD = /What you are drawing|Ce que vous dessinez|Lo que estás dibujando|你在画什么/
const START_BUTTON = /Start drawing|Commencer à dessiner|Empezar a dibujar|开始画/
const DONE_BUTTON = /Done drawing|J'ai fini|He terminado|画好了/

/** The drawer must say what it is before "Start drawing" unlocks the clock. */
async function beginDrawing(page, intent = 'a giraffe on a jet ski') {
  await page.getByLabel(INTENT_FIELD).fill(intent)
  const start = page.getByRole('button', { name: START_BUTTON })
  await start.waitFor({ timeout: 10000 })
  await start.click()
  await atPhase(page, 'drawing')
}

/** "Done drawing" unlocks once the minimum drawing time has run. */
async function finishDrawing(page) {
  const done = page.getByRole('button', { name: DONE_BUTTON })
  await done.waitFor({ timeout: 10000 })
  await done.click()
}

const inkOn = (page, selector = 'canvas') =>
  page.evaluate((sel) => {
    const cv = document.querySelector(sel)
    if (!cv) return -1
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  }, selector)

async function scribble(page) {
  const box = await page.locator('canvas').boundingBox()
  await page.mouse.move(box.x + 40, box.y + 60)
  await page.mouse.down()
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(box.x + 40 + i * 8, box.y + 60 + Math.sin(i / 3) * 40)
    await page.waitForTimeout(12)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
}

/**
 * Open a real IME composition in `locator`, the way a phone's Chinese
 * keyboard does. `page.fill()` cannot reach this: it sets the value outright,
 * with no composition and no candidate key to get wrong.
 *
 * Returns the CDP session, whose `Input.insertText` commits the candidate.
 */
async function composeInto(page, locator, text) {
  const cdp = await page.context().newCDPSession(page)
  await locator.focus()
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await page.waitForTimeout(100)
  return cdp
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const results = []
// ELEPHANT_ONLY=languages runs just the scenarios whose name contains it.
const only = process.env.ELEPHANT_ONLY ?? ''

async function run(name, fn) {
  if (only && !name.includes(only)) return
  log(`\n▸ ${name}`)
  const before = pages.length
  try {
    await fn()
    log('  ✓ passed')
    results.push([name, true])
  } catch (e) {
    log(`  ✗ ${e.message.split('\n').slice(0, 3).join('\n    ')}`)
    results.push([name, false])
  } finally {
    // Close this scenario's pages so its sockets do not leak into the next.
    for (const p of pages.splice(before)) await p.context().close().catch(() => {})
  }
}

await run('a full game, start to gallery', async () => {
  const { code, by, organizer } = await startedRoom()
  const drawing = await whoDraws(by, organizer)
  const drawer = by[drawing]
  const guessers = Object.entries(by).filter(([name]) => name !== drawing)

  // Everyone waits while the drawer decides; the clock starts on their tap.
  await guessers[0][1].getByText(`${drawing} is deciding`).waitFor({ timeout: 10000 })
  await beginDrawing(drawer, 'a snake on a rollercoaster')
  for (const [, p] of guessers) await atPhase(p, 'drawing')
  // The drawer keeps their own note in view; nobody else sees it.
  await drawer.getByText('a snake on a rollercoaster').waitFor({ timeout: 10000 })
  assert(!(await guessers[0][1].getByText('a snake on a rollercoaster').isVisible()), 'a guesser saw the note')

  await scribble(drawer)
  const drawn = await inkOn(drawer)
  const relayed = await inkOn(guessers[0][1])
  log(`  ink drawer=${drawn} watcher=${relayed}`)
  assert(drawn > 0, 'drawer canvas is blank')
  assert(drawn === relayed, `relay mismatch: ${drawn} vs ${relayed}`)

  const [[name1, g1], [name2, g2]] = guessers
  await g1.getByLabel('Your guess').fill('a snake having a bad day')
  await g1.getByRole('button', { name: 'Guess' }).click()
  // The drawer sees *who* has answered — not what — so they know when to stop.
  await drawer.locator('.chip.in', { hasText: name1 }).waitFor({ timeout: 10000 })
  assert((await drawer.locator('.chip.in').count()) === 1, `${name2} was marked as answered before guessing`)
  assert(!(await drawer.getByText('a snake having a bad day').isVisible()), 'the drawer saw the guess text')
  await g2.getByLabel('Your guess').fill('the worm from Dune')
  await g2.getByRole('button', { name: 'Guess' }).click()
  await drawer.locator('.chip.in', { hasText: name2 }).waitFor({ timeout: 10000 })
  await drawer.waitForFunction(() => document.body.textContent.includes('2 guesses'), null, { timeout: 10000 })
  log(`  drawer saw ${name1} and ${name2} answer`)

  await finishDrawing(drawer)
  await drawer.getByRole('heading', { name: /favourite/i }).waitFor({ timeout: 10000 })
  await g1.getByText('Sit tight…').waitFor({ timeout: 10000 })
  // One tap now: correctness is graded server-side.
  await drawer.getByRole('button', { name: /worm from Dune/ }).click()

  for (const p of Object.values(by)) await atPhase(p, 'reveal')
  // The reveal stages the board in after the bubbles and the intent.
  await organizer.locator('.board li').first().waitFor({ timeout: 10000 })
  const scores = await organizer.evaluate(() =>
    [...document.querySelectorAll('.board li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
  )
  log('  leaderboard:', scores.join(' | '))
  // No Gemini key in local dev, so the turn goes ungraded and only the
  // drawer's favourite scores.
  const twos = scores.filter((s) => / 2$/.test(s)).length
  assert(twos === 1, `expected exactly one player on 2 points, got ${twos}`)
  await organizer.getByText(/could not be checked|Nobody got it right|marks the answer/).waitFor({ timeout: 10000 })

  // Play out the remaining turns.
  await organizer.getByRole('button', { name: 'Next' }).click()
  for (let i = 1; i < 3; i++) {
    await atPhase(organizer, 'prep')
    const who = await whoDraws(by, organizer)
    await beginDrawing(by[who])
    await finishDrawing(by[who])
    await atPhase(organizer, 'reveal')
    await organizer.getByRole('button', { name: 'Next' }).click()
  }
  await organizer.getByRole('button', { name: 'Another round' }).waitFor({ timeout: 10000 })

  await organizer.getByRole('button', { name: 'End the game' }).click()
  await organizer.getByRole('heading', { name: /wins|Game over/ }).waitFor({ timeout: 10000 })
  await organizer.getByText('The gallery').waitFor({ timeout: 10000 })
  await sleep(900)
  const tiles = await organizer.locator('figure.turn').count()
  assert(tiles === 3, `expected 3 gallery tiles, got ${tiles}`)
  const galleryInk = await inkOn(organizer, 'figure.turn canvas')
  log(`  gallery tiles=${tiles} ink=${galleryInk}`)
  assert(galleryInk > 0, 'the stored drawing did not replay in the gallery')
  await organizer.screenshot({ path: '/tmp/e2e-ended.png', fullPage: true })
  void code
})

await run('the drawing timer expires on its own', async () => {
  // Nobody touches anything: the DO alarm has to move the phase along.
  const { by, organizer } = await startedRoom({ drawingMs: 2500, revealMs: 60_000 })
  const drawer = by[await whoDraws(by, organizer)]
  const guesser = Object.values(by).find((p) => p !== drawer)
  await beginDrawing(drawer)
  await atPhase(guesser, 'drawing')

  await guesser.getByLabel('Your guess').fill('a hasty guess')
  await guesser.getByRole('button', { name: 'Guess' }).click()
  await drawer.waitForFunction(() => document.body.textContent.includes('1 guess'), null, { timeout: 10000 })

  await atPhase(drawer, 'judging', 15000)
  log('  drawing timed out into judging without anyone clicking')
  for (const p of Object.values(by)) await atPhase(p, 'judging')
})

await run('judging times out with no awards', async () => {
  const { by, organizer } = await startedRoom({ drawingMs: 60_000, judgingMs: 2500, revealMs: 60_000 })
  const drawer = by[await whoDraws(by, organizer)]
  const guesser = Object.values(by).find((p) => p !== drawer)
  await beginDrawing(drawer)
  await atPhase(guesser, 'drawing')

  await guesser.getByLabel('Your guess').fill('nobody will judge this')
  await guesser.getByRole('button', { name: 'Guess' }).click()
  await finishDrawing(drawer)
  await atPhase(drawer, 'judging')

  // The drawer walks away. Everyone should still reach the reveal, scoreless.
  await atPhase(drawer, 'reveal', 15000)
  const scores = await organizer.evaluate(() =>
    [...document.querySelectorAll('.board li')].map((li) => li.textContent.trim()),
  )
  assert(scores.every((s) => /0$/.test(s)), `expected nobody to score, got ${scores.join(' | ')}`)
  log('  reveal reached with no points awarded')
})

await run('a drawer who vanishes has their turn skipped', async () => {
  const { by, organizer } = await startedRoom({ drawingMs: 60_000, graceMs: 2000, revealMs: 60_000 })
  const who = await whoDraws(by, organizer)
  const drawer = by[who]
  const watcher = Object.values(by).find((p) => p !== drawer)

  // Close the drawer's browser while they are still deciding: the socket
  // drops, grace expires, turn skipped.
  await drawer.context().close()
  await watcher.waitForFunction(
    () => document.body.dataset.phase === 'prep' && document.querySelector('header strong'),
    null,
    { timeout: 20000 },
  )
  await watcher.waitForFunction(
    (gone) => (document.querySelector('header strong')?.textContent ?? '').indexOf(gone) === -1,
    who,
    { timeout: 20000 },
  )
  const rest = Object.fromEntries(Object.entries(by).filter(([name]) => name !== who))
  const next = await whoDraws(rest, watcher)
  log(`  ${who} vanished; play moved on`)
  assert(next !== who, 'the vanished drawer is somehow still drawing')
})

await run('a second round can be started', async () => {
  const { by, organizer } = await startedRoom({ drawingMs: 60_000, revealMs: 60_000 })

  for (let i = 0; i < 3; i++) {
    await atPhase(organizer, 'prep')
    const who = await whoDraws(by, organizer)
    await beginDrawing(by[who])
    await finishDrawing(by[who])
    await atPhase(organizer, 'reveal')
    await organizer.getByRole('button', { name: 'Next' }).click()
  }
  await atPhase(organizer, 'round_end')
  await organizer.getByRole('button', { name: 'Another round' }).click()

  await atPhase(organizer, 'prep')
  // Scores carrying across rounds is covered by the reducer tests; what this
  // proves is that round_end -> next_round -> prep works over the wire.
  const phase = await organizer.evaluate(() => document.body.dataset.phase)
  assert(phase === 'prep', 'round two did not start')
  log('  round two under way')
})

await run('the drawer cannot start without saying what it is', async () => {
  const { by, organizer } = await startedRoom({ drawingMs: 60_000 })
  const drawer = by[await whoDraws(by, organizer)]

  const start = drawer.getByRole('button', { name: /Say what it is first/ })
  await start.waitFor({ timeout: 10000 })
  assert(await start.isDisabled(), 'Start was enabled with no intent set')
  // Nobody's clock is running yet.
  const guesser = Object.values(by).find((p) => p !== drawer)
  assert(!(await guesser.getByLabel('Your guess').isVisible()), 'guessers had a guess bar before the clock started')

  await drawer.getByLabel('What you are drawing').fill('an elephant, obviously')
  await drawer.getByRole('button', { name: 'Start drawing' }).waitFor({ timeout: 10000 })
  await drawer.getByRole('button', { name: 'Start drawing' }).click()
  await atPhase(drawer, 'drawing')
  await guesser.getByLabel('Your guess').waitFor({ timeout: 10000 })
  await drawer.getByRole('button', { name: 'Done drawing' }).click()
  await atPhase(drawer, 'reveal')
  await drawer.getByText(/an elephant, obviously/).waitFor({ timeout: 10000 })
  log('  gated until the note was written, then started the clock')
})

await run('the drawer cannot finish before the minimum drawing time', async () => {
  const { by, organizer } = await startedRoom({ drawingMs: 60_000, minDrawingMs: 2500 })
  const drawer = by[await whoDraws(by, organizer)]
  await beginDrawing(drawer)

  // "Done" is locked and counts down rather than vanishing.
  const locked = drawer.getByRole('button', { name: /Done in \d+ s/ })
  await locked.waitFor({ timeout: 10000 })
  assert(await locked.isDisabled(), 'Done was enabled before the minimum had run')
  const label = await locked.textContent()

  const done = drawer.getByRole('button', { name: 'Done drawing' })
  await done.waitFor({ timeout: 10000 })
  await done.click()
  await atPhase(drawer, 'reveal')
  log(`  "${label.trim()}" held the drawer, then let them finish`)
})

await run('four languages in one room at once', async () => {
  const code = await createRoom({ config: { drawingMs: 60_000, minDrawingMs: 0 } })

  // Ada's phone is English and she leaves it alone.
  const ada = await joinAs(await newPage(), code, 'Ada')

  // Bo's phone is French. Nobody chose anything: the interface arrives
  // French because the browser said so.
  const bo = await newPage('fr-FR')
  await bo.goto(`${BASE}/g/${code}`)
  await bo.getByRole('heading', { name: 'Qui êtes-vous ?' }).waitFor({ timeout: 10000 })
  await bo.getByLabel('Votre nom').fill('Bo')
  await bo.getByRole('button', { name: 'Rejoindre la salle' }).click()

  // Cy's phone is English and he switches to Chinese by hand.
  const cy = await newPage()
  await cy.goto(`${BASE}/g/${code}`)
  await cy.getByLabel('Language').selectOption('zh')
  await cy.getByLabel('你的名字').fill('小明')
  await cy.getByRole('button', { name: '进入房间' }).click()

  // Three interfaces, three languages, one lobby.
  await ada.getByRole('button', { name: /I'm ready/ }).waitFor({ timeout: 10000 })
  await bo.getByRole('button', { name: /Je suis prêt/ }).waitFor({ timeout: 10000 })
  await cy.getByRole('button', { name: /我准备好了/ }).waitFor({ timeout: 10000 })
  log('  lobby rendered in en, fr and zh at the same time')

  // Nobody's name is translated: everyone sees everyone as they typed it.
  for (const p of [ada, bo, cy]) await p.getByText('小明').waitFor({ timeout: 10000 })

  const by = { Ada: ada, Bo: bo, 小明: cy }
  await ada.getByRole('button', { name: /I'm ready/ }).click()
  await bo.getByRole('button', { name: /Je suis prêt/ }).click()
  await cy.getByRole('button', { name: /我准备好了/ }).click()
  await ada.getByRole('button', { name: 'Start game' }).click()
  for (const p of [ada, bo, cy]) await atPhase(p, 'prep')

  // Whoever draws writes their note in any language, then the others guess
  // in their own script.
  const drawing = await whoDraws(by, ada)
  const drawer = by[drawing]
  const guessers = Object.entries(by).filter(([name]) => name !== drawing)
  await beginDrawing(drawer, '大象')
  for (const [, p] of guessers) await atPhase(p, 'drawing')
  const texts = ['un éléphant qui danse', '一只跳舞的大象']
  for (const [i, [, page]] of guessers.entries()) {
    await page.getByLabel(/Your guess|Votre réponse|你的猜测/).fill(texts[i])
    await page.getByRole('button', { name: /^(Guess|Proposer|提交)$/ }).click()
    // Each guesser's own answer is echoed back to them as typed.
    await page.getByText(texts[i]).waitFor({ timeout: 10000 })
  }

  await finishDrawing(drawer)
  await atPhase(drawer, 'judging')

  // Translation needs a Gemini key, which local dev has none of, so every
  // screen shows both guesses exactly as typed — the fallback when no
  // rendering ever arrives.
  for (const p of [ada, bo, cy]) {
    for (const text of texts) await p.getByText(text).waitFor({ timeout: 10000 })
  }
  log('  guesses in French and Chinese relayed as typed to every screen')

  // Meanwhile the furniture around them is in three different languages.
  const prompt = await drawer.evaluate(() => document.querySelector('h2')?.textContent?.trim())
  assert(prompt, 'the drawer got no judging prompt')
  const waiting = await Promise.all(
    guessers.map(([, p]) => p.evaluate(() => document.querySelector('.waiting')?.textContent?.trim())),
  )
  assert(new Set(waiting).size === waiting.length, `both guessers saw the same wait text: ${waiting}`)
  log(`  drawer prompted "${prompt}"; guessers waiting in ${waiting.join(' / ')}`)
})

await run('an IME candidate key does not submit the form behind it', async () => {
  // The Enter that picks a Chinese candidate is the same Enter that submits
  // the form the field sits in. Take the name field first: it is the one a
  // player writing Chinese cannot avoid, and whatever it sends is the name
  // they are stuck with for the rest of the game.
  const code = await createRoom({ config: { drawingMs: 60_000, minDrawingMs: 0 } })
  const cy = await newPage()
  await cy.goto(`${BASE}/g/${code}`)
  const nameField = cy.getByLabel('Your name')
  await nameField.waitFor({ timeout: 10000 })

  const cdp = await composeInto(cy, nameField, 'xiaoming')
  await cy.keyboard.press('Enter')
  await cy.waitForTimeout(300)
  assert(await nameField.isVisible(), 'a composing Enter joined the room as raw pinyin')

  // Committing the candidate and tapping Join does work.
  await cdp.send('Input.insertText', { text: '小明' })
  await cy.getByRole('button', { name: 'Join the room' }).click()
  await cy.getByRole('button', { name: /I'm ready/ }).waitFor({ timeout: 10000 })
  assert((await cy.textContent('.roster')).includes('小明'), 'joined under the wrong name')
  log('  the name field kept the candidate key to itself')

  // Same key, same trap, on the guess bar.
  const by = { 小明: cy }
  for (const name of ['Ada', 'Bo']) by[name] = await joinAs(await newPage(), code, name)
  for (const p of Object.values(by)) await p.getByRole('button', { name: /I'm ready/ }).click()
  await cy.waitForFunction(() => document.body.textContent.includes('3'), null, { timeout: 10000 })
  await cy.getByRole('button', { name: 'Start game' }).click()
  for (const p of Object.values(by)) await atPhase(p, 'prep')

  // The same key on the drawer's note: a composing Enter must not start the
  // clock with half-typed pinyin as the thing being drawn.
  const drawing = await whoDraws(by, by.Ada)
  const drawer = by[drawing]
  const intentField = drawer.getByLabel(INTENT_FIELD)
  const cdp1 = await composeInto(drawer, intentField, 'daxiang')
  await drawer.keyboard.press('Enter')
  await drawer.waitForTimeout(300)
  assert((await drawer.evaluate(() => document.body.dataset.phase)) === 'prep', 'a composing Enter started the clock')
  await cdp1.send('Input.insertText', { text: '大象' })
  await drawer.getByRole('button', { name: START_BUTTON }).click()
  for (const p of Object.values(by)) await atPhase(p, 'drawing')
  log('  the note field kept the candidate key to itself')

  const guesser = Object.entries(by).find(([name]) => name !== drawing)[1]
  const guessField = guesser.getByLabel(/Your guess|你的猜测/)
  const cdp2 = await composeInto(guesser, guessField, 'daxiang')
  await guesser.keyboard.press('Enter')
  await guesser.waitForTimeout(400)
  assert(!(await guesser.locator('.mine').isVisible()), 'a composing Enter sent half-typed pinyin as a guess')

  // And a tap on the button is never swallowed, composition or not.
  await cdp2.send('Input.insertText', { text: '大象' })
  await guesser.getByRole('button', { name: /^(Guess|提交)$/ }).click()
  await guesser.getByText('大象').waitFor({ timeout: 10000 })
  log('  the guess bar waited for the candidate, then sent it on the tap')
})

// ---------------------------------------------------------------------------

await browser.close()

const failed = results.filter(([, ok]) => !ok)
log('\n' + '─'.repeat(46))
for (const [name, ok] of results) log(`${ok ? '✓' : '✗'} ${name}`)
log(`${results.length - failed.length}/${results.length} scenarios passed`)
if (failed.length) process.exit(1)
