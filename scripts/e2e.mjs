/*
 * Full-stack smoke test: real Worker, real Durable Object, real browsers.
 *
 *   npm run build && npx wrangler dev --port 8787   # terminal 1
 *   node scripts/e2e.mjs                            # terminal 2
 *
 * Drives three players through create -> join -> ready -> start -> draw ->
 * guess, and asserts the drawing relays pixel-identically to a guesser.
 */
import { chromium } from 'playwright'

const BASE = process.env.ELEPHANT_URL ?? 'http://127.0.0.1:8787'
const EXECUTABLE = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium'
const log = (...a) => console.log(...a)

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {})
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  !! pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('  !! console:', m.text()))
  return page
}

const join = async (page, name) => {
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Join the room' }).click()
  await page.getByRole('button', { name: /I'm ready/ }).waitFor({ timeout: 5000 })
}

const a = await mk()
await a.goto(BASE)
await a.getByRole('button', { name: 'Start a game' }).click()
await a.waitForURL(/\/g\/[A-Z]{4}/, { timeout: 10000 })
const code = a.url().split('/g/')[1]
log('room created:', code)
await join(a, 'Ada')

const b = await mk(); await b.goto(`${BASE}/g/${code}`); await join(b, 'Bo')
const c = await mk(); await c.goto(`${BASE}/g/${code}`); await join(c, 'Cy')
log('three players joined')

for (const p of [a, b, c]) await p.getByRole('button', { name: /I'm ready/ }).click()
await a.getByRole('button', { name: 'Start game' }).waitFor({ state: 'visible' })
await a.waitForFunction(() => document.body.textContent.includes('3 ready'), null, { timeout: 5000 })
log('all ready')

await a.getByRole('button', { name: 'Start game' }).click()
const atPhase = (page, phase, timeout = 8000) =>
  page.waitForFunction((p) => document.body.dataset.phase === p, phase, { timeout })

for (const [n, p] of [['a', a], ['b', b], ['c', c]])
  await atPhase(p, 'drawing').then(() => log(`  ${n}: drawing phase`))

// Who is drawing?
const pages = { Ada: a, Bo: b, Cy: c }
const drawerName = await a.evaluate(() => {
  const t = document.querySelector('header strong')?.textContent ?? ''
  return t.includes('You are') ? 'Ada' : t.replace(' is drawing', '')
})
log('drawer:', drawerName)
const drawer = pages[drawerName]
const watcher = Object.entries(pages).find(([n]) => n !== drawerName)[1]

// Draw a stroke.
const box = await drawer.locator('canvas').boundingBox()
await drawer.mouse.move(box.x + 40, box.y + 60)
await drawer.mouse.down()
for (let i = 0; i < 25; i++) {
  await drawer.mouse.move(box.x + 40 + i * 8, box.y + 60 + Math.sin(i / 3) * 40)
  await drawer.waitForTimeout(12)
}
await drawer.mouse.up()
await drawer.waitForTimeout(400)

const inked = (page) =>
  page.evaluate(() => {
    const cv = document.querySelector('canvas')
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
const drawerInk = await inked(drawer)
const watcherInk = await inked(watcher)
log('ink on drawer canvas :', drawerInk)
log('ink on watcher canvas:', watcherInk)
if (drawerInk === 0) throw new Error('drawer canvas is blank')
if (drawerInk !== watcherInk) throw new Error(`relay mismatch: ${drawerInk} vs ${watcherInk}`)

// A guesser guesses.
await watcher.getByLabel('Your guess').fill('a snake having a bad day')
await watcher.getByRole('button', { name: 'Guess' }).click()
await drawer.waitForFunction(() => document.body.textContent.includes('1 guess'), null, { timeout: 5000 })
  .then(() => log('drawer sees the guess count'))
await watcher.getByText('Your guess').waitFor({ timeout: 3000 }).then(() => log('guesser sees own guess'))

await drawer.screenshot({ path: '/tmp/drawer.png' })
await watcher.screenshot({ path: '/tmp/guesser.png' })

// --- judging -------------------------------------------------------------
const third = Object.entries(pages).find(([n]) => n !== drawerName && pages[n] !== watcher)[1]
await third.getByLabel('Your guess').fill('the worm from Dune')
await third.getByRole('button', { name: 'Guess' }).click()
await drawer.waitForFunction(() => document.body.textContent.includes('2 guesses'), null, { timeout: 5000 })

await drawer.getByRole('button', { name: 'Done drawing' }).click()
await drawer.getByRole('heading', { name: 'Who got it right?' }).waitFor({ timeout: 5000 })
log('judging: drawer prompted for the correct answer')
await watcher.getByText('Sit tight…').waitFor({ timeout: 5000 })
log('judging: guessers see the waiting state')

await drawer.getByRole('button', { name: /snake having/ }).click()
await drawer.getByRole('heading', { name: 'Which one is funniest?' }).waitFor({ timeout: 5000 })
await drawer.screenshot({ path: '/tmp/judging.png' })
await drawer.getByRole('button', { name: /worm from Dune/ }).click()
log('judging: both awards made')

// --- reveal --------------------------------------------------------------
for (const p of Object.values(pages)) await atPhase(p, 'reveal')
for (const p of Object.values(pages)) {
  await p.getByText(/It was…|never said what it was|Nobody guessed/).waitFor({ timeout: 8000 })
}
log('reveal: intent shown to everyone')
await watcher.waitForTimeout(1200)
await watcher.screenshot({ path: '/tmp/reveal.png' })

const scores = await a.evaluate(() =>
  [...document.querySelectorAll('.board li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
)
log('leaderboard:', scores)
if (!scores.some((s) => /\b2\b/.test(s))) throw new Error('expected someone to have scored 2')

// --- play out the round --------------------------------------------------
await a.getByRole('button', { name: 'Next' }).click()
for (let i = 1; i < 3; i++) {
  await atPhase(a, 'drawing')
  const who = await a.evaluate(() => {
    const t = document.querySelector('header strong')?.textContent ?? ''
    return t.includes('You are') ? 'Ada' : t.replace(' is drawing', '')
  })
  await pages[who].getByRole('button', { name: 'Done drawing' }).click()
  await atPhase(a, 'reveal')
  await a.getByRole('button', { name: 'Next' }).click()
}
await a.getByRole('button', { name: 'Another round' }).waitFor({ timeout: 8000 })
log('round_end reached')
await a.screenshot({ path: '/tmp/roundend.png' })

// --- end the game --------------------------------------------------------
await a.getByRole('button', { name: 'End the game' }).click()
await a.getByRole('heading', { name: /wins|Game over/ }).waitFor({ timeout: 8000 })
await a.getByText('The gallery').waitFor({ timeout: 5000 })
await a.waitForTimeout(900)
const tiles = await a.locator('figure.turn').count()
log('gallery tiles:', tiles)
if (tiles !== 3) throw new Error(`expected 3 gallery tiles, got ${tiles}`)
const galleryInk = await a.evaluate(() => {
  const cv = document.querySelector('figure.turn canvas')
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
  return n
})
log('ink in first gallery tile:', galleryInk)
if (galleryInk === 0) throw new Error('gallery drawing did not load')
await a.screenshot({ path: '/tmp/ended.png', fullPage: true })

log('screenshots written')

await browser.close()
log('\nPASS')
