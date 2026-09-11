<script lang="ts">
  import { room } from '../lib/room.svelte'
  import { router } from '../lib/router.svelte'
  import { AVATARS } from '../lib/avatars'
  import { t } from '../lib/i18n.svelte'
  import LangPicker from '../lib/LangPicker.svelte'

  let name = $state('')
  let avatar = $state<string>(AVATARS[Math.floor(Math.random() * AVATARS.length)]!)

  const canJoin = $derived(name.trim().length > 0)

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (canJoin) room.join(name.trim(), avatar)
  }
</script>

<form class="screen join" onsubmit={submit}>
  <div class="head">
    <h1>{t.s.whoAreYou}</h1>
    <p class="code">{t.s.room(router.code ?? '')}</p>
    <div class="lang"><LangPicker /></div>
  </div>

  <div class="preview" style="--accent: var(--sun)">
    <span class="big">{avatar}</span>
  </div>

  <input
    class="field"
    bind:value={name}
    placeholder={t.s.yourName}
    maxlength="24"
    autocomplete="given-name"
    aria-label={t.s.yourName}
  />

  <div class="grid" role="radiogroup" aria-label={t.s.pickAvatar}>
    {#each AVATARS as a (a)}
      <button
        type="button"
        class="pick"
        class:on={a === avatar}
        role="radio"
        aria-checked={a === avatar}
        aria-label={a}
        onclick={() => (avatar = a)}
      >{a}</button>
    {/each}
  </div>

  <button class="btn primary wide" disabled={!canJoin}>{t.s.joinRoom}</button>
</form>

<style>
  .join { justify-content: center; }
  .head { text-align: center; }
  .code { margin: 0.2rem 0 0; color: var(--ink-soft); font-weight: 800; letter-spacing: 0.2em; }
  .lang { margin-top: 0.7rem; }
  .preview { display: grid; place-items: center; }
  .big { font-size: 4.5rem; line-height: 1; }
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.4rem;
  }
  .pick {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    padding: 0;
    font-size: 1.5rem;
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    background: transparent;
    cursor: pointer;
    transition: transform var(--fast) var(--spring), background var(--fast) var(--out);
  }
  .pick:active { transform: scale(0.86); }
  .pick.on {
    border-color: var(--line);
    background: var(--sun);
    transform: scale(1.1);
  }
  @media (max-width: 380px) {
    .grid { grid-template-columns: repeat(4, 1fr); }
  }
</style>
