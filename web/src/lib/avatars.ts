export const AVATARS = [
  '🐘', '🦊', '🐸', '🦉', '🐙', '🦩', '🐝', '🦋',
  '🐨', '🦕', '🐧', '🦔', '🐳', '🦜', '🐢', '🦆',
] as const

/** Per-player accent, stable for the life of the room. */
const ACCENTS = ['--hot', '--sky', '--leaf', '--grape', '--tang', '--mint', '--berry', '--sun']

export function accentOf(playerId: string): string {
  let h = 0
  for (let i = 0; i < playerId.length; i++) h = (h * 31 + playerId.charCodeAt(i)) >>> 0
  return `var(${ACCENTS[h % ACCENTS.length]})`
}
