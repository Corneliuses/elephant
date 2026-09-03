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

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
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

/** Three players joined, ready, and started. Returns them keyed by name. */
async function startedRoom(config = {}) {
  const code = await createRoom({ config })
  const by = {}
  for (const name of ['Ada', 'Bo', 'Cy']) by[name] = await joinAs(await newPage(), code, name)
  for (const p of Object.values(by)) await p.getByRole('button', { name: /I'm ready/ }).click()
  const organizer = by.Ada
  await organizer.waitForFunction(() => document.body.textContent.includes('3 ready'), null, { timeout: 10000 })
  await organizer.getByRole('button', { name: 'Start game' }).click()
  for (const p of Object.values(by)) await atPhase(p, 'drawing')
  return { code, by, organizer }
}

/** Who is drawing right now, as seen by `page`. */
const drawerName = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('header strong')?.textContent ?? ''
    return t.includes('You are') ? null : t.replace(' is drawing', '')
  })

async function whoDraws(by, viewer) {
  const seen = await drawerName(viewer)
  if (seen) return seen
  return Object.entries(by).find(([, p]) => p === viewer)[0]
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

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const results = []

async function run(name, fn) {
  log(`\n▸ ${name}`)
  const before = pages.length
  try {
    await fn()
    log('  ✓ passed')
    results.push([name, true])
  } catch (e) {
    log(`  ✗ ${e.message.split('\n')[0]}`)
    results.push([name, false])
  } finally {
    // Close this scenario's pages so its sockets do not leak into the next.
    for (const p of pages.splice(before)) await p.context().close().catch(() => {})
  }
}

await run('a full game, start to gallery', async () => {
  const { code, by, organizer } = await startedRoom()
  const drawer = by[await whoDraws(by, organizer)]
  const guessers = Object.values(by).filter((p) => p !== drawer)

  await scribble(drawer)
  const drawn = await inkOn(drawer)
  const relayed = await inkOn(guessers[0])
  log(`  ink drawer=${drawn} watcher=${relayed}`)
  assert(drawn > 0, 'drawer canvas is blank')
  assert(drawn === relayed, `relay mismatch: ${drawn} vs ${relayed}`)

  await guessers[0].getByLabel('Your guess').fill('a snake having a bad day')
  await guessers[0].getByRole('button', { name: 'Guess' }).click()
  await guessers[1].getByLabel('Your guess').fill('the worm from Dune')
  await guessers[1].getByRole('button', { name: 'Guess' }).click()
  await drawer.waitForFunction(() => document.body.textContent.includes('2 guesses'), null, { timeout: 10000 })

  await drawer.getByRole('button', { name: 'Done drawing' }).click()
  await drawer.getByRole('heading', { name: 'Who got it right?' }).waitFor({ timeout: 10000 })
  await guessers[0].getByText('Sit tight…').waitFor({ timeout: 10000 })
  await drawer.getByRole('button', { name: /snake having/ }).click()
  await drawer.getByRole('heading', { name: 'Which one is funniest?' }).waitFor({ timeout: 10000 })
  await drawer.getByRole('button', { name: /worm from Dune/ }).click()

  for (const p of Object.values(by)) await atPhase(p, 'reveal')
  // The reveal stages the board in after the bubbles and the intent.
  await organizer.locator('.board li').first().waitFor({ timeout: 10000 })
  const scores = await organizer.evaluate(() =>
    [...document.querySelectorAll('.board li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
  )
  log('  leaderboard:', scores.join(' | '))
  const twos = scores.filter((s) => / 2$/.test(s)).length
  assert(twos === 2, `expected two players on 2 points, got ${twos}`)

  // Play out the remaining turns.
  await organizer.getByRole('button', { name: 'Next' }).click()
  for (let i = 1; i < 3; i++) {
    await atPhase(organizer, 'drawing')
    const who = await whoDraws(by, organizer)
    await by[who].getByRole('button', { name: 'Done drawing' }).click()
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

  await guesser.getByLabel('Your guess').fill('nobody will judge this')
  await guesser.getByRole('button', { name: 'Guess' }).click()
  await drawer.getByRole('button', { name: 'Done drawing' }).click()
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

  // Close the drawer's browser: the socket drops, grace expires, turn skipped.
  await drawer.context().close()
  await watcher.waitForFunction(
    () => document.body.dataset.phase === 'drawing' && document.querySelector('header strong'),
    null,
    { timeout: 20000 },
  )
  await watcher.waitForFunction(
    (gone) => (document.querySelector('header strong')?.textContent ?? '').indexOf(gone) === -1,
    who,
    { timeout: 20000 },
  )
  const next = await drawerName(watcher)
  log(`  ${who} vanished; play moved on`)
  assert(next !== who, 'the vanished drawer is somehow still drawing')
})

await run('a second round can be started', async () => {
  const { by, organizer } = await startedRoom({ drawingMs: 60_000, revealMs: 60_000 })

  for (let i = 0; i < 3; i++) {
    await atPhase(organizer, 'drawing')
    const who = await whoDraws(by, organizer)
    await by[who].getByRole('button', { name: 'Done drawing' }).click()
    await atPhase(organizer, 'reveal')
    await organizer.getByRole('button', { name: 'Next' }).click()
  }
  await atPhase(organizer, 'round_end')
  await organizer.getByRole('button', { name: 'Another round' }).click()

  await atPhase(organizer, 'drawing')
  // Scores carrying across rounds is covered by the reducer tests; what this
  // proves is that round_end -> next_round -> drawing works over the wire.
  const phase = await organizer.evaluate(() => document.body.dataset.phase)
  assert(phase === 'drawing', 'round two did not start')
  log('  round two under way')
})

// ---------------------------------------------------------------------------

await browser.close()

const failed = results.filter(([, ok]) => !ok)
log('\n' + '─'.repeat(46))
for (const [name, ok] of results) log(`${ok ? '✓' : '✗'} ${name}`)
log(`${results.length - failed.length}/${results.length} scenarios passed`)
if (failed.length) process.exit(1)
