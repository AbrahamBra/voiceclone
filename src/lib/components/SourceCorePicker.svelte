<script>
  // Source-core picker — migration 055.
  // Sits near the chat header and lets the operator tag the lead origin so the
  // backend assembles the right source-specific playbook on top of the global
  // protocol. Locked once the conversation has narrative messages — switching
  // mid-thread would mean the back half of the conv was answered with a
  // different playbook than the front half.

  import { SOURCE_CORES, findSourceCore } from "$lib/source-core.js";

  /**
   * @typedef {{
   *   value: string|null,
   *   onchange: (value: string|null) => void,
   *   disabled?: boolean,
   * }} Props
   */

  /** @type {Props} */
  let { value, onchange, disabled = false } = $props();

  let open = $state(false);
  let current = $derived(findSourceCore(value));

  function pick(id) {
    open = false;
    onchange(id);
  }

  function clear() {
    open = false;
    onchange(null);
  }
</script>

<div class="source-core-picker" class:disabled>
  <button
    type="button"
    class="trigger"
    onclick={() => { if (!disabled) open = !open; }}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    title="D'où vient ce contact ? Active des règles d'écriture spécifiques à l'origine."
  >
    <span class="dot" class:active={!!current}></span>
    <span class="label">
      {#if current}
        Origine : {current.label}
      {:else}
        D'où vient ce contact ?
      {/if}
    </span>
    <span class="caret">▾</span>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => open = false}></div>
    <ul class="menu" role="listbox">
      <li>
        <button type="button" class="item" class:selected={!current} onclick={clear}>
          <span class="item-label">Origine inconnue</span>
          <span class="item-hint">Aucune règle d'écriture spécifique (par défaut)</span>
        </button>
      </li>
      {#each SOURCE_CORES as sc (sc.id)}
        <li>
          <button
            type="button"
            class="item"
            class:selected={current?.id === sc.id}
            onclick={() => pick(sc.id)}
          >
            <span class="item-label">{sc.label}</span>
            <span class="item-hint">{sc.hint}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Aligné sur le design system Laboratoire/Observatoire (paper / ink / vermillon).
     Cf src/app.css. */
  .source-core-picker {
    position: relative;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--ink);
  }
  .source-core-picker.disabled .trigger {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
    transition: background 0.08s linear;
  }
  .trigger:hover:not(:disabled) {
    background: var(--paper-subtle);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink-20);
    flex-shrink: 0;
  }
  .dot.active {
    background: var(--vermillon);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--vermillon) 20%, transparent);
  }
  .label {
    white-space: nowrap;
  }
  .caret {
    color: var(--ink-40);
    font-size: 10px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 49;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 320px;
    max-height: 60vh;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
  .menu li {
    display: block;
  }
  .item {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 12px;
    background: transparent;
    border: 0;
    border-bottom: 1px dashed var(--rule);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.08s linear;
  }
  .menu li:last-child .item {
    border-bottom: none;
  }
  .item:hover {
    background: var(--paper-subtle);
  }
  .item.selected {
    background: var(--paper-subtle);
    box-shadow: inset 2px 0 0 var(--vermillon);
  }
  .item-label {
    font-weight: var(--fw-medium);
    color: var(--ink);
  }
  .item-hint {
    font-size: 11px;
    color: var(--ink-40);
    line-height: var(--lh-snug);
  }
</style>
