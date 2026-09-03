/*
 * Renders the app icons from one SVG using the Chromium that is already
 * available for the end-to-end tests, so there is no image toolchain to
 * install. Run after changing the mark:  node scripts/icons.mjs
 */
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PRESET = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium'
const EXECUTABLE = PRESET && existsSync(PRESET) ? PRESET : null

/** `pad` leaves the safe zone Android needs to crop a maskable icon. */
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ff3d71"/>
  <text x="50" y="${50 + pad * 0.36}" font-size="${pad * 0.72}" text-anchor="middle"
        dominant-baseline="middle" font-family="sans-serif">🐘</text>
</svg>`

const targets = [
  { file: 'icon-192.png', size: 192, pad: 78 },
  { file: 'icon-512.png', size: 512, pad: 78 },
  // Maskable: the mark shrinks so a circular crop cannot clip it.
  { file: 'icon-maskable-512.png', size: 512, pad: 54 },
  { file: 'apple-touch-icon.png', size: 180, pad: 72 },
]

mkdirSync('web/public', { recursive: true })
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {})

for (const { file, size, pad } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<body style="margin:0">${svg(size, pad).replace('width="' + size + '"', 'width="100%"').replace('height="' + size + '"', 'height="100%"')}</body>`,
  )
  await page.screenshot({ path: `web/public/${file}`, omitBackground: false })
  await page.close()
  console.log('wrote', file, `${size}x${size}`)
}

await browser.close()
