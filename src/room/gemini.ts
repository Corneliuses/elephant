/**
 * The one call shape both the grader and the translator make: a prompt in,
 * JSON matching a schema out, through the Gemini Interactions API. Pure
 * fetch plus envelope parsing, no DO, so it runs under node in tests.
 */

export const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
// Matches the `GEMINI_MODEL` var in wrangler.jsonc, which normally supplies
// this. Only reached when that var is missing, so it should still name a
// model that works: the free tier counts its request quota per model, and
// both tasks are trivial classification or translation against a hard
// deadline rather than anything that rewards a heavier reasoner.
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'

/**
 * Ask for JSON in the given schema. Resolves to the reply envelope, or null
 * on any failure — non-200, timeout, network, unreadable body — so callers
 * have one branch to write and the game never blocks on it.
 */
export async function ask(
  apiKey: string,
  model: string,
  prompt: string,
  schema: object,
  timeoutMs: number,
): Promise<unknown | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model,
        input: prompt,
        response_format: { type: 'text', mime_type: 'application/json', schema },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

/**
 * Pull the model's JSON text out of an Interactions `steps` list.
 *
 * The real reply is a list of steps, not a single string: reasoning comes
 * first and the answer last, so the *first* step is the wrong one to read.
 * Only `model_output` steps carry the reply, and its `content` is a list of
 * parts, so the text parts are concatenated in order.
 */
function fromSteps(body: object): string | null {
  const steps = (body as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return null
  let text = ''
  for (const step of steps) {
    if (typeof step !== 'object' || step === null) continue
    if ((step as { type?: unknown }).type !== 'model_output') continue
    const content = (step as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue
      if ((part as { type?: unknown }).type !== 'text') continue
      const t = (part as { text?: unknown }).text
      if (typeof t === 'string') text += t
    }
  }
  return text === '' ? null : text
}

/**
 * Pull the model's JSON text out of the response envelope.
 *
 * The Interactions API returns it as a `steps` list (see `fromSteps`). The
 * `output_text` convenience field and the older `generateContent`
 * `candidates` shape are also accepted, so a change of endpoint does not
 * silently stop grading or translation.
 */
export function extractText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const direct = (body as { output_text?: unknown }).output_text
  if (typeof direct === 'string') return direct
  const stepped = fromSteps(body)
  if (stepped !== null) return stepped
  const candidates = (body as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return null
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = (parts[0] as { text?: unknown } | undefined)?.text
  return typeof text === 'string' ? text : null
}

/** `extractText`, then JSON. Null when either step fails. */
export function extractJson(body: unknown): unknown | null {
  const text = extractText(body)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Player text goes into a numbered list; newlines would let it forge structure. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
