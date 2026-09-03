<script lang="ts">
  import { router } from '../lib/router.svelte'

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

  function joinRoom(e: SubmitEvent) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (code.length === 4) router.go(`/g/${code}`)
  }
</script>

<div class="screen home">
  <div class="hero">
    <div class="logo">🐘</div>
    <h1>Elephant</h1>
    <p class="tag">Draw badly. Guess wildly. Reward the funniest.</p>
  </div>

  <div class="actions">
    <button class="btn primary wide" onclick={createRoom} disabled={creating}>
      {creating ? 'Making a room…' : 'Start a game'}
    </button>

    <form class="join" onsubmit={joinRoom}>
      <input
        class="field code"
        bind:value={joinCode}
        placeholder="CODE"
        maxlength="4"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        aria-label="Room code"
      />
      <button class="btn ghost" disabled={joinCode.trim().length !== 4}>Join</button>
    </form>

    {#if failed}
      <p class="err">Could not reach the server. Try again?</p>
    {/if}
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
  @keyframes sway {
    0%, 100% { transform: rotate(-6deg) translateY(0); }
    50% { transform: rotate(6deg) translateY(-8px); }
  }
</style>
