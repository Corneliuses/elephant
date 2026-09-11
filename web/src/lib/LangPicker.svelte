<script lang="ts">
  /*
   * The player's own language, changed at any time. Shown where someone is
   * standing still — the home screen, the join form, the lobby — never over
   * a live drawing.
   *
   * A native <select> on purpose: it opens as the phone's own picker, which
   * is already in the right language and the right script.
   */
  import { LANGS, LANG_NAMES, t } from './i18n.svelte'
  import type { Lang } from './i18n.svelte'

  function pick(e: Event & { currentTarget: HTMLSelectElement }) {
    t.set(e.currentTarget.value as Lang)
  }
</script>

<label class="lang">
  <span aria-hidden="true">🌐</span>
  <select onchange={pick} aria-label={t.s.language}>
    <!-- `selected` rather than `value`, so the DOM is right on first paint. -->
    {#each LANGS as l (l)}
      <option value={l} selected={l === t.lang}>{LANG_NAMES[l]}</option>
    {/each}
  </select>
</label>

<style>
  .lang {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.5rem 0.3rem 0.7rem;
    border: var(--border);
    border-radius: var(--r-pill);
    background: var(--card);
    box-shadow: var(--lift);
    font-size: 0.9rem;
    font-weight: 800;
  }
  select {
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    font-weight: 800;
    padding: 0.15rem 0.1rem;
    cursor: pointer;
    /* Keep the phone's own chevron: it is the affordance people know. */
  }
  select:focus-visible { outline: 2px solid var(--sky); border-radius: var(--r-sm); }
</style>
