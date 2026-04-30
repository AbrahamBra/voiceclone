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
    title="Source du lead — sélectionne pour activer le playbook spécifique"
  >
    <span class="dot" class:active={!!current}></span>
    <span class="label">
      {#if current}
        Source : {current.label}
      {:else}
        Pas de source — protocole global seul
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
          <span class="item-label">Aucune source</span>
          <span class="item-hint">Protocole global seul (comportement par défaut)</span>
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
  .source-core-picker {
    position: relative;
    font-size: 13px;
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
    border-radius: 8px;
    border: 1px solid var(--border, rgba(255,255,255,0.12));
    background: var(--surface, rgba(255,255,255,0.04));
    color: var(--text, inherit);
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .trigger:hover:not(:disabled) {
    background: var(--surface-hover, rgba(255,255,255,0.08));
    border-color: var(--border-strong, rgba(255,255,255,0.2));
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted, rgba(255,255,255,0.25));
    flex-shrink: 0;
  }
  .dot.active {
    background: var(--accent, #6ee7b7);
    box-shadow: 0 0 6px var(--accent, #6ee7b7);
  }
  .label {
    white-space: nowrap;
  }
  .caret {
    opacity: 0.6;
    font-size: 10px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 10;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 11;
    min-width: 280px;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--surface-raised, #1a1a1a);
    border: 1px solid var(--border, rgba(255,255,255,0.12));
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
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
    padding: 8px 10px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 100ms ease;
  }
  .item:hover {
    background: var(--surface-hover, rgba(255,255,255,0.06));
  }
  .item.selected {
    background: var(--surface-active, rgba(110, 231, 183, 0.12));
  }
  .item-label {
    font-weight: 500;
  }
  .item-hint {
    font-size: 11px;
    opacity: 0.65;
  }
</style>
