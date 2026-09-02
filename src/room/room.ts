import { DurableObject } from 'cloudflare:workers'

export class RoomDO extends DurableObject {
  override async fetch(_request: Request): Promise<Response> {
    return new Response('not implemented', { status: 501 })
  }
}
