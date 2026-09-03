/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Secrets are not described by wrangler.jsonc, so `wrangler types` cannot
 * generate them. Declared here and merged into the generated `Env`.
 *
 *   npx wrangler secret put GEMINI_API_KEY
 *
 * Optional on purpose: without a key the game still runs, and turns are
 * recorded as ungraded rather than failing.
 */
interface Env {
  GEMINI_API_KEY?: string
  /** Overrides the default Gemini model without a code change. */
  GEMINI_MODEL?: string
}
