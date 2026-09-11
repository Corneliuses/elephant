<script lang="ts">
  import { router } from '../lib/router.svelte'
  import { t } from '../lib/i18n.svelte'
  import LangPicker from '../lib/LangPicker.svelte'

  let creating = $state(false)
  let joinCode = $state('')
  let failed = $state(false)

  async function createRoom() {
    creating = true
    failed = false
    try {
      const res = await fetch('/api/rooms', { method: 'POST', body: '{}' })
      if (!res.ok) throw new Error(String(res.status))
      const { code } = (await res.json()) as { code: string }
      router.go(`/g/${code}`)
    } catch {
      failed = true
      creating = false
    }
  }

  /**
   * What the field amounts to: the four letters a room code can be made of.
   *
   * Derived rather than read off `joinCode`, because a submit can land while
   * an IME composition is still open and the field has not been tidied yet.
   * Navigating with anything else in hand lands on a URL the router's own
   * pattern rejects, which drops the player back here with no explanation.
   */
  const cleanCode = $derived(joinCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))

  function joinRoom(e: SubmitEvent) {
    e.preventDefault()
    if (cleanCode.length === 4) router.go(`/g/${cleanCode}`)
  }

  /**
   * Keep the field itself to those letters too.
   *
   * A phone left in a Chinese or Japanese IME emits candidate text into this
   * field, which would eat the 4-character budget with characters no code
   * contains. Filtering waits for the composition to finish: editing the
   * value mid-composition fights the IME and drops keystrokes.
   */
  let composing = $state(false)
  function tidyCode() {
    if (composing) return
    joinCode = cleanCode
  }
</script>

<div class="screen home">
  <div class="hero">
    <div class="logo">🐘</div>
    <h1>Elephant</h1>
    <p class="tag">{t.s.tagline}</p>
  </div>

  <div class="actions">
    <button class="btn primary wide" onclick={createRoom} disabled={creating}>
      {creating ? t.s.makingRoom : t.s.startAGame}
    </button>

    <form class="join" onsubmit={joinRoom}>
      <input
        class="field code"
        bind:value={joinCode}
        placeholder={t.s.codePlaceholder}
        maxlength="4"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        aria-label={t.s.roomCodeLabel}
        oninput={tidyCode}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => {
          composing = false
          tidyCode()
        }}
      />
      <button class="btn ghost" disabled={cleanCode.length !== 4}>{t.s.join}</button>
    </form>

    {#if failed}
      <p class="err">{t.s.serverUnreachable}</p>
    {/if}

    <div class="lang"><LangPicker /></div>
  </div>
</div>

<style>
  .home { justify-content: center; text-align: center; }
  .hero { display: grid; gap: 0.4rem; margin-bottom: 2rem; }
  .logo {
    font-size: 5.5rem;
    line-height: 1;
    animation: sway 3.5s ease-in-out infinite;
  }
  h1 { font-size: 3rem; }
  .tag { margin: 0; color: var(--ink-soft); font-weight: 700; }
  .actions { display: grid; gap: 0.9rem; }
  .join { display: grid; grid-template-columns: 1fr auto; gap: 0.6rem; }
  .code {
    text-align: center;
    letter-spacing: 0.35em;
    text-indent: 0.35em;
    font-weight: 900;
    font-size: 1.3rem;
    text-transform: uppercase;
  }
  .err { color: var(--hot); font-weight: 800; margin: 0; }
  .lang { display: grid; justify-items: center; margin-top: 0.4rem; }
  @keyframes sway {
    0%, 100% { transform: rotate(-6deg) translateY(0); }
    50% { transform: rotate(6deg) translateY(-8px); }
  }
</style>
