import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = fileURLToPath(new URL('../src', import.meta.url))

export default defineConfig({
  // Set explicitly: the config is invoked from the repo root via npm scripts.
  root: here,
  plugins: [svelte()],
  resolve: {
    // Lets the client import the wire types straight from the worker source,
    // so protocol drift is a type error rather than a runtime surprise.
    alias: { $shared: shared },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: {
    // `..` so the aliased imports above resolve outside web/.
    fs: { allow: ['..'] },
    // `npm run dev` (wrangler) serves the API on 8787; ws:true proxies the socket too.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', ws: true, changeOrigin: true },
    },
  },
})
