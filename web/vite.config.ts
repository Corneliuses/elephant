import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = fileURLToPath(new URL('../src', import.meta.url))

export default defineConfig({
  // Set explicitly: the config is invoked from the repo root via npm scripts.
  root: here,
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Elephant',
        short_name: 'Elephant',
        description: 'Draw badly. Guess wildly. Reward your favourite.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff8ed',
        theme_color: '#ff3d71',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The shell is cached so the app opens instantly; the API never is.
        // A cached room state would be worse than no state at all.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
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
