/*
 * Per-player language. One room routinely holds four of them.
 *
 * Language is a purely local choice: it never reaches the server and no
 * other player sees it. What crosses the wire — names, guesses, the drawer's
 * note — stays exactly as it was typed, because the drawing is the shared
 * medium and half the fun is reading a guess you only half understand. The
 * grader is the one thing that has to cope with the mixture, and it does that
 * by judging meaning rather than wording (see src/room/grader.ts).
 *
 * The `.svelte.ts` extension is what lets `$state` work outside a component.
 * Read `t.s.<key>` in markup and the text re-renders when the picker changes.
 */
import type { WireErrorCode } from '$shared/room/protocol'

export const LANGS = ['en', 'fr', 'es', 'zh'] as const
export type Lang = (typeof LANGS)[number]

/** Each language named in itself. Never translated — that is the point. */
export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  zh: '中文',
}

/**
 * What goes in `<html lang>`. Not the same as our key: for Chinese the script
 * subtag is what picks the right Han glyphs, since the same code point is
 * drawn differently in Simplified Chinese, Japanese and Korean.
 */
const HTML_LANG: Record<Lang, string> = { en: 'en', fr: 'fr', es: 'es', zh: 'zh-Hans' }

const STORE_KEY = 'elephant:lang'

interface Strings {
  // Shell
  language: string
  roomGone: string
  roomGoneBody: string
  startNewOne: string
  connecting: string
  reconnecting: string
  // Home
  tagline: string
  makingRoom: string
  startAGame: string
  codePlaceholder: string
  roomCodeLabel: string
  join: string
  serverUnreachable: string
  // Join
  whoAreYou: string
  room: (code: string) => string
  yourName: string
  pickAvatar: string
  joinRoom: string
  // Lobby
  shareRoom: string
  tapToShare: string
  joinMyGame: (code: string) => string
  linkCopied: string
  readyCount: (n: number) => string
  needMore: (n: number) => string
  imReady: string
  startGame: string
  waitingToStart: string
  // Drawing
  youAreDrawing: string
  isDrawing: (name: string) => string
  guessesIn: (n: number) => string
  drawAnything: string
  noGuessesYet: string
  colour: (c: string) => string
  brushSize: string
  clearCanvas: string
  intentPlaceholder: string
  intentLabel: string
  doneDrawing: string
  sayWhatFirst: string
  changeGuessPlaceholder: string
  whatIsIt: string
  yourGuess: string
  guessBtn: string
  changeBtn: string
  // Judging
  yourPick: string
  isChoosing: (name: string) => string
  nice: string
  whichFavourite: string
  checkingCorrect: string
  correctSettled: string
  sitTight: string
  // Reveal
  by: (name: string) => string
  itWas: string
  neverSaid: (name: string) => string
  stillChecking: string
  couldNotCheck: string
  checkMarks: string
  nobodyRight: string
  next: string
  // Round end
  roundDone: (n: number) => string
  leads: (name: string) => string
  nobodyScored: string
  anotherRound: string
  endTheGame: string
  needReadyPlayers: (n: number) => string
  waitingOrganizer: string
  // Ended
  wins: (name: string) => string
  gameOver: string
  summary: (drawings: number, rounds: number) => string
  theGallery: string
  newGame: string
  // Bits
  skipped: string
  organizer: string
  // Refusals the player can actually provoke
  errNameNeeded: string
  errGuessNeeded: string
  errIntentNeeded: string
  errNeedPlayers: (n: number) => string
  errGameOver: string
  errLostPlace: string
  errGeneric: string
}

const en: Strings = {
  language: 'Language',
  roomGone: 'This room is gone',
  roomGoneBody: 'Rooms disappear once everyone has left.',
  startNewOne: 'Start a new one',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  tagline: 'Draw badly. Guess wildly. Reward your favourite.',
  makingRoom: 'Making a room…',
  startAGame: 'Start a game',
  codePlaceholder: 'CODE',
  roomCodeLabel: 'Room code',
  join: 'Join',
  serverUnreachable: 'Could not reach the server. Try again?',
  whoAreYou: 'Who are you?',
  room: (code) => `Room ${code}`,
  yourName: 'Your name',
  pickAvatar: 'Pick an avatar',
  joinRoom: 'Join the room',
  shareRoom: 'Share this room',
  tapToShare: 'tap to share',
  joinMyGame: (code) => `Join my game: ${code}`,
  linkCopied: 'Link copied',
  readyCount: (n) => `${n} ready`,
  needMore: (n) => `· need ${n} more`,
  imReady: "I'm ready",
  startGame: 'Start game',
  waitingToStart: 'Waiting for the organizer to start…',
  youAreDrawing: 'You are drawing',
  isDrawing: (name) => `${name} is drawing`,
  guessesIn: (n) => `${n} guess${n === 1 ? '' : 'es'} in`,
  drawAnything: 'Draw anything. They guess.',
  noGuessesYet: 'No guesses yet',
  colour: (c) => `Colour ${c}`,
  brushSize: 'Brush size',
  clearCanvas: 'Clear the canvas',
  intentPlaceholder: 'What is it? (needed, and only you see it)',
  intentLabel: 'What you are drawing',
  doneDrawing: 'Done drawing',
  sayWhatFirst: 'Say what it is first',
  changeGuessPlaceholder: 'Change your guess…',
  whatIsIt: 'What is it?',
  yourGuess: 'Your guess',
  guessBtn: 'Guess',
  changeBtn: 'Change',
  yourPick: 'Your pick',
  isChoosing: (name) => `${name} is choosing`,
  nice: 'Nice.',
  whichFavourite: 'Which one is your favourite?',
  checkingCorrect: 'Checking who got it right…',
  correctSettled: 'Who got it right is already settled.',
  sitTight: 'Sit tight…',
  by: (name) => `by ${name}`,
  itWas: 'It was…',
  neverSaid: (name) => `${name} never said what it was.`,
  stillChecking: 'Still checking the answers…',
  couldNotCheck: 'Answers could not be checked this turn.',
  checkMarks: '✓ marks the answer that got it.',
  nobodyRight: 'Nobody got it right.',
  next: 'Next',
  roundDone: (n) => `Round ${n} done`,
  leads: (name) => `${name} leads`,
  nobodyScored: 'Nobody scored',
  anotherRound: 'Another round',
  endTheGame: 'End the game',
  needReadyPlayers: (n) => `Need ${n} ready players for another round.`,
  waitingOrganizer: 'Waiting for the organizer…',
  wins: (name) => `${name} wins`,
  gameOver: 'Game over',
  summary: (d, r) => `${d} drawing${d === 1 ? '' : 's'} over ${r} round${r === 1 ? '' : 's'}`,
  theGallery: 'The gallery',
  newGame: 'New game',
  skipped: 'Skipped',
  organizer: 'Organizer',
  errNameNeeded: 'Pick a name first.',
  errGuessNeeded: 'Type a guess first.',
  errIntentNeeded: 'Say what you are drawing first.',
  errNeedPlayers: (n) => `Need ${n} ready players.`,
  errGameOver: 'The game is over.',
  errLostPlace: 'You lost your place in this room.',
  errGeneric: "That didn't work.",
}

const fr: Strings = {
  language: 'Langue',
  roomGone: "Cette salle n'existe plus",
  roomGoneBody: 'Les salles disparaissent une fois que tout le monde est parti.',
  startNewOne: 'En créer une autre',
  connecting: 'Connexion…',
  reconnecting: 'Reconnexion…',
  tagline: 'Dessinez mal. Devinez large. Récompensez votre préféré.',
  makingRoom: 'Création de la salle…',
  startAGame: 'Lancer une partie',
  codePlaceholder: 'CODE',
  roomCodeLabel: 'Code de la salle',
  join: 'Rejoindre',
  serverUnreachable: 'Serveur injoignable. Réessayer ?',
  whoAreYou: 'Qui êtes-vous ?',
  room: (code) => `Salle ${code}`,
  yourName: 'Votre nom',
  pickAvatar: 'Choisissez un avatar',
  joinRoom: 'Rejoindre la salle',
  shareRoom: 'Partager cette salle',
  tapToShare: 'toucher pour partager',
  joinMyGame: (code) => `Rejoins ma partie : ${code}`,
  linkCopied: 'Lien copié',
  readyCount: (n) => `${n} prêt${n > 1 ? 's' : ''}`,
  needMore: (n) => `· encore ${n}`,
  imReady: 'Je suis prêt',
  startGame: 'Commencer',
  waitingToStart: "En attente de l'organisateur…",
  youAreDrawing: 'À vous de dessiner',
  isDrawing: (name) => `${name} dessine`,
  guessesIn: (n) => `${n} proposition${n > 1 ? 's' : ''}`,
  drawAnything: 'Dessinez ce que vous voulez. À eux de deviner.',
  noGuessesYet: 'Aucune proposition',
  colour: (c) => `Couleur ${c}`,
  brushSize: 'Taille du pinceau',
  clearCanvas: 'Effacer le dessin',
  intentPlaceholder: "C'est quoi ? (obligatoire, vous seul le voyez)",
  intentLabel: 'Ce que vous dessinez',
  doneDrawing: "J'ai fini",
  sayWhatFirst: "Dites d'abord ce que c'est",
  changeGuessPlaceholder: 'Changer de réponse…',
  whatIsIt: "C'est quoi ?",
  yourGuess: 'Votre réponse',
  guessBtn: 'Proposer',
  changeBtn: 'Changer',
  yourPick: 'À vous de choisir',
  isChoosing: (name) => `${name} choisit`,
  nice: 'Parfait.',
  whichFavourite: 'Laquelle préférez-vous ?',
  checkingCorrect: 'Vérification des bonnes réponses…',
  correctSettled: 'Les bonnes réponses sont déjà décidées.',
  sitTight: 'Un instant…',
  by: (name) => `par ${name}`,
  itWas: "C'était…",
  neverSaid: (name) => `${name} n'a jamais dit ce que c'était.`,
  stillChecking: 'Vérification des réponses…',
  couldNotCheck: "Impossible de vérifier les réponses ce tour-ci.",
  checkMarks: '✓ indique la bonne réponse.',
  nobodyRight: "Personne n'a trouvé.",
  next: 'Suivant',
  roundDone: (n) => `Manche ${n} terminée`,
  leads: (name) => `${name} est en tête`,
  nobodyScored: 'Aucun point marqué',
  anotherRound: 'Une autre manche',
  endTheGame: 'Terminer la partie',
  needReadyPlayers: (n) => `Il faut ${n} joueurs prêts pour une autre manche.`,
  waitingOrganizer: "En attente de l'organisateur…",
  wins: (name) => `${name} gagne`,
  gameOver: 'Partie terminée',
  summary: (d, r) => `${d} dessin${d > 1 ? 's' : ''} en ${r} manche${r > 1 ? 's' : ''}`,
  theGallery: 'La galerie',
  newGame: 'Nouvelle partie',
  skipped: 'Passé',
  organizer: 'Organisateur',
  errNameNeeded: 'Choisissez un nom.',
  errGuessNeeded: 'Écrivez une réponse.',
  errIntentNeeded: "Dites d'abord ce que vous dessinez.",
  errNeedPlayers: (n) => `Il faut ${n} joueurs prêts.`,
  errGameOver: 'La partie est terminée.',
  errLostPlace: 'Vous avez perdu votre place dans cette salle.',
  errGeneric: "Ça n'a pas marché.",
}

const es: Strings = {
  language: 'Idioma',
  roomGone: 'Esta sala ya no existe',
  roomGoneBody: 'Las salas desaparecen cuando se va todo el mundo.',
  startNewOne: 'Crear una nueva',
  connecting: 'Conectando…',
  reconnecting: 'Reconectando…',
  tagline: 'Dibuja mal. Adivina a lo loco. Premia tu favorita.',
  makingRoom: 'Creando la sala…',
  startAGame: 'Empezar una partida',
  codePlaceholder: 'CÓDIGO',
  roomCodeLabel: 'Código de la sala',
  join: 'Entrar',
  serverUnreachable: 'No se pudo conectar con el servidor. ¿Reintentar?',
  whoAreYou: '¿Quién eres?',
  room: (code) => `Sala ${code}`,
  yourName: 'Tu nombre',
  pickAvatar: 'Elige un avatar',
  joinRoom: 'Entrar en la sala',
  shareRoom: 'Compartir esta sala',
  tapToShare: 'toca para compartir',
  joinMyGame: (code) => `Únete a mi partida: ${code}`,
  linkCopied: 'Enlace copiado',
  readyCount: (n) => `${n} ${n === 1 ? 'listo' : 'listos'}`,
  needMore: (n) => `· ${n === 1 ? 'falta' : 'faltan'} ${n}`,
  imReady: 'Estoy listo',
  startGame: 'Empezar',
  waitingToStart: 'Esperando a que empiece el organizador…',
  youAreDrawing: 'Te toca dibujar',
  isDrawing: (name) => `${name} está dibujando`,
  guessesIn: (n) => `${n} respuesta${n === 1 ? '' : 's'}`,
  drawAnything: 'Dibuja lo que quieras. Ellos adivinan.',
  noGuessesYet: 'Aún no hay respuestas',
  colour: (c) => `Color ${c}`,
  brushSize: 'Grosor del pincel',
  clearCanvas: 'Borrar el dibujo',
  intentPlaceholder: '¿Qué es? (obligatorio, solo lo ves tú)',
  intentLabel: 'Lo que estás dibujando',
  doneDrawing: 'He terminado',
  sayWhatFirst: 'Di primero qué es',
  changeGuessPlaceholder: 'Cambia tu respuesta…',
  whatIsIt: '¿Qué es?',
  yourGuess: 'Tu respuesta',
  guessBtn: 'Responder',
  changeBtn: 'Cambiar',
  yourPick: 'Tú eliges',
  isChoosing: (name) => `${name} está eligiendo`,
  nice: 'Genial.',
  whichFavourite: '¿Cuál es tu favorita?',
  checkingCorrect: 'Comprobando quién acertó…',
  correctSettled: 'Quién acertó ya está decidido.',
  sitTight: 'Un momento…',
  by: (name) => `por ${name}`,
  itWas: 'Era…',
  neverSaid: (name) => `${name} nunca dijo qué era.`,
  stillChecking: 'Revisando las respuestas…',
  couldNotCheck: 'No se pudieron comprobar las respuestas en este turno.',
  checkMarks: '✓ marca la respuesta que acertó.',
  nobodyRight: 'Nadie acertó.',
  next: 'Siguiente',
  roundDone: (n) => `Ronda ${n} terminada`,
  leads: (name) => `${name} va en cabeza`,
  nobodyScored: 'Nadie puntuó',
  anotherRound: 'Otra ronda',
  endTheGame: 'Terminar la partida',
  needReadyPlayers: (n) => `Hacen falta ${n} jugadores listos para otra ronda.`,
  waitingOrganizer: 'Esperando al organizador…',
  wins: (name) => `${name} gana`,
  gameOver: 'Fin de la partida',
  summary: (d, r) => `${d} dibujo${d === 1 ? '' : 's'} en ${r} ronda${r === 1 ? '' : 's'}`,
  theGallery: 'La galería',
  newGame: 'Nueva partida',
  skipped: 'Saltado',
  organizer: 'Organizador',
  errNameNeeded: 'Elige un nombre.',
  errGuessNeeded: 'Escribe una respuesta.',
  errIntentNeeded: 'Di primero qué estás dibujando.',
  errNeedPlayers: (n) => `Hacen falta ${n} jugadores listos.`,
  errGameOver: 'La partida ha terminado.',
  errLostPlace: 'Has perdido tu sitio en esta sala.',
  errGeneric: 'No ha funcionado.',
}

const zh: Strings = {
  language: '语言',
  roomGone: '这个房间已经不在了',
  roomGoneBody: '所有人离开后，房间就会消失。',
  startNewOne: '新建一个',
  connecting: '连接中…',
  reconnecting: '重新连接中…',
  tagline: '画得难看，猜得离谱，奖励你最喜欢的。',
  makingRoom: '正在创建房间…',
  startAGame: '开始游戏',
  codePlaceholder: '房间码',
  roomCodeLabel: '房间码',
  join: '加入',
  serverUnreachable: '无法连接服务器，再试一次？',
  whoAreYou: '你是谁？',
  room: (code) => `房间 ${code}`,
  yourName: '你的名字',
  pickAvatar: '选择头像',
  joinRoom: '进入房间',
  shareRoom: '分享这个房间',
  tapToShare: '点击分享',
  joinMyGame: (code) => `来玩我的游戏：${code}`,
  linkCopied: '链接已复制',
  readyCount: (n) => `${n} 人已准备`,
  needMore: (n) => `· 还差 ${n} 人`,
  imReady: '我准备好了',
  startGame: '开始',
  waitingToStart: '等待房主开始…',
  youAreDrawing: '轮到你画',
  isDrawing: (name) => `${name} 正在画`,
  guessesIn: (n) => `已有 ${n} 个猜测`,
  drawAnything: '随便画，让他们猜。',
  noGuessesYet: '还没有人猜',
  colour: (c) => `颜色 ${c}`,
  brushSize: '笔刷粗细',
  clearCanvas: '清空画布',
  intentPlaceholder: '这是什么？（必填，只有你能看到）',
  intentLabel: '你在画什么',
  doneDrawing: '画好了',
  sayWhatFirst: '先说说这是什么',
  changeGuessPlaceholder: '换一个猜测…',
  whatIsIt: '这是什么？',
  yourGuess: '你的猜测',
  guessBtn: '提交',
  changeBtn: '修改',
  yourPick: '你来选',
  isChoosing: (name) => `${name} 正在选`,
  nice: '不错。',
  whichFavourite: '你最喜欢哪一个？',
  checkingCorrect: '正在判断谁猜对了…',
  correctSettled: '谁猜对了已经定下来了。',
  sitTight: '稍等…',
  by: (name) => `${name} 画的`,
  itWas: '这是…',
  neverSaid: (name) => `${name} 没有说这是什么。`,
  stillChecking: '还在核对答案…',
  couldNotCheck: '本轮无法核对答案。',
  checkMarks: '✓ 标出猜对的答案。',
  nobodyRight: '没有人猜对。',
  next: '继续',
  roundDone: (n) => `第 ${n} 轮结束`,
  leads: (name) => `${name} 领先`,
  nobodyScored: '没有人得分',
  anotherRound: '再来一轮',
  endTheGame: '结束游戏',
  needReadyPlayers: (n) => `再来一轮需要 ${n} 名准备好的玩家。`,
  waitingOrganizer: '等待房主…',
  wins: (name) => `${name} 获胜`,
  gameOver: '游戏结束',
  summary: (d, r) => `${r} 轮里画了 ${d} 幅`,
  theGallery: '作品展',
  newGame: '新游戏',
  skipped: '已跳过',
  organizer: '房主',
  errNameNeeded: '请先取个名字。',
  errGuessNeeded: '请先写下你的猜测。',
  errIntentNeeded: '请先说说你在画什么。',
  errNeedPlayers: (n) => `需要 ${n} 名准备好的玩家。`,
  errGameOver: '游戏已经结束。',
  errLostPlace: '你在这个房间里的位置已经失效。',
  errGeneric: '操作没有成功。',
}

const DICT: Record<Lang, Strings> = { en, fr, es, zh }

const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang)

/**
 * The player's language: their last choice, else the phone's own setting.
 *
 * Matching is on the primary subtag, so fr-CA lands on French and zh-TW on
 * Chinese — Traditional readers get Simplified text, which is imperfect but
 * far better than English.
 */
export function detect(stored: string | null, preferred: readonly string[]): Lang {
  if (isLang(stored)) return stored
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}

function read(): string | null {
  try {
    return localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

class I18n {
  lang = $state<Lang>('en')

  constructor() {
    this.lang = detect(read(), navigator.languages ?? [navigator.language])
    this.#applyToDocument()
  }

  /** The active dictionary. Reading it in markup subscribes to `lang`. */
  get s(): Strings {
    return DICT[this.lang]
  }

  set(lang: Lang): void {
    this.lang = lang
    try {
      localStorage.setItem(STORE_KEY, lang)
    } catch {
      /* private mode: the choice still holds for this session */
    }
    this.#applyToDocument()
  }

  /**
   * Wording for a refusal the server sent.
   *
   * Most codes are unreachable by tapping: the client disables the button
   * long before the server would refuse, so they mean a bug rather than
   * something the player did. Those collapse into one honest sentence in the
   * player's own language, which beats showing them English prose. The codes
   * the UI really can provoke get their own wording.
   */
  error(code: WireErrorCode, minPlayers: number): string {
    const s = this.s
    switch (code) {
      case 'invalid_name':
        return s.errNameNeeded
      case 'invalid_guess':
        return s.errGuessNeeded
      case 'intent_required':
        return s.errIntentNeeded
      case 'need_more_players':
        return s.errNeedPlayers(minPlayers)
      case 'game_ended':
        return s.errGameOver
      case 'unauthorized':
        return s.errLostPlace
      default:
        return s.errGeneric
    }
  }

  #applyToDocument(): void {
    document.documentElement.lang = HTML_LANG[this.lang]
  }
}

export const t = new I18n()
