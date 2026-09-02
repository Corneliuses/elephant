/**
 * Edge router: creates rooms, forwards room requests to the RoomDO, and
 * (milestone 3) serves the PWA. See docs/DESIGN.md.
 */
import { CODE_ALPHABET, CODE_LENGTH, type CreateRoomRequest } from './room/protocol'

export { RoomDO } from './room/room'

const ROOM_PATH = /^\/api\/rooms\/([A-Za-z]+)(\/.*)?$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/rooms') return createRoom(request, env)

    const m = ROOM_PATH.exec(url.pathname)
    if (m) {
      const code = m[1]!.toUpperCase()
      const sub = m[2] ?? ''
      if (code.length !== CODE_LENGTH) return json({ error: 'room not found' }, 404)
      const stub = env.ROOM.get(env.ROOM.idFromName(code))

      if (sub === '' && request.method === 'GET') return stub.fetch(roomUrl('/info', url))
      if (sub === '/ws' && request.method === 'GET') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          return json({ error: 'expected websocket upgrade' }, 426)
        }
        return stub.fetch(new Request(roomUrl('/ws', url), request))
      }
      if (/^\/turns\/\d+\/strokes$/.test(sub) && request.method === 'GET') return stub.fetch(roomUrl(sub, url))
    }

    return json({ error: 'not found' }, 404)
  },
} satisfies ExportedHandler<Env>

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: CreateRoomRequest = {}
  const text = await request.text()
  if (text.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
      body = parsed as CreateRoomRequest
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
  }

  // Codes are random; on the rare collision with a live room, try again.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const stub = env.ROOM.get(env.ROOM.idFromName(code))
    const res = await stub.fetch('https://room/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, config: body.config, room: body.room }),
    })
    if (res.status !== 409) return res
  }
  return json({ error: 'could not allocate a room code' }, 503)
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ''
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return code
}

/** Internal DO URL; the host is arbitrary, the query string is preserved. */
function roomUrl(path: string, original: URL): string {
  return `https://room${path}${original.search}`
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
