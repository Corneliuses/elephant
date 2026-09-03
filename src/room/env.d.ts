/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Secrets are not described by wrangler.jsonc, so `wrangler types` cannot
 * generate them. Declared here and merged into the generated `Env`.
 *
 *   npx wrangler secret put GEMINI_API_KEY
 *
 * (or Settings → Variables and Secrets → type "Secret", in the dashboard.)
 *
 * Optional on purpose: without a key the game still runs, and turns are
 * recorded as ungraded rather than failing.
 *
 * `GEMINI_MODEL` is *not* here — it is a plain var in wrangler.jsonc, so
 * `wrangler types` generates it. Run `npm run types` after changing it.
 */
interface Env {
  GEMINI_API_KEY?: string
}
