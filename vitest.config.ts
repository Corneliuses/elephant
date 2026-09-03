import { fileURLToPath } from 'node:url'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

const shared = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'game',
          include: ['src/game/**/*.test.ts'],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'room',
          include: ['src/room/**/*.test.ts'],
        },
      },
      {
        // The svelte plugin is what compiles runes in `.svelte.ts` modules.
        plugins: [svelte({ configFile: false })],
        resolve: { alias: { $shared: shared }, conditions: ['browser'] },
        test: {
          name: 'web',
          include: ['web/src/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
})
