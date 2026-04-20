<script>
  // Compact scenario picker — sits to the left of the chat textarea.
  // Renders only canonical scenarios the persona supports (per persona.type
  // and, as a fallback, its legacy scenarios jsonb). When the user picks a
  // scenario, we fire `onchange(id)` — the parent is responsible for the side
  // effects (update URL, reset conversation, etc.).
  //
  // Sprint 0.b (Option A / dual-write) : the value emitted is a canonical
  // ScenarioId. The parent still needs to maintain the legacy `scenario`
  // text for back-compat; use legacyKeyFor(id) if needed.

  import {
    CANONICAL_SCENARIOS,
    supportedCanonicalScenarios,
  } from "$lib/scenarios.js";
  import { track } from "$lib/tracking.js";

  /**
   * @typedef {import("$lib/scenarios.js")} ScenariosModule
   * @typedef {Parameters<ScenariosModule["legacyKeyFor"]>[0]} ScenarioId
   */

  let {
    /** @type {{ type?: string | null, scenarios?: Record<string, unknown> | null } | null} */
    persona = null,
    /** Current canonical scenario id, or null when nothing selected yet. */
    value = null,
    /** Fired with the picked ScenarioId. */
    onchange = (/** @type {ScenarioId} */ _id) => {},
    disabled = false,
    /** Restrict the list to a single kind ("post" or "dm"). Null = all supported. */
    kind = null,
    /** Panel direction relative to trigger ("down" for top-bar, "up" for bottom-bar). */
    direction = "down",
  } = $props();

  let open = $state(false);
  let buttonEl = $state(/** @type {HTMLButtonElement | null} */ (null));
  let listEl = $state(/** @type {HTMLDivElement | null} */ (null));
  let activeIndex = $state(-1);

  let supportedIds = $derived.by(() => {
    if (!persona) return [];
    const ids = supportedCanonicalScenarios(persona);
    if (!kind) return ids;
    return ids.filter((id) => CANONICAL_SCENARIOS[id].kind === kind);
  });

  let currentLabel = $derived(
    value && CANONICAL_SCENARIOS[value]
      ? CANONICAL_SCENARIOS[value].label
      : "Choisir un scenario"
  );

  // Close when clicking outside. Wired lazily so the open-click itself doesn't
  // re-close immediately.
  $effect(() => {
    if (!open) return;
    function onDocMouseDown(/** @type {MouseEvent} */ e) {
      const t = /** @type {Node | null} */ (e.target);
      if (!t) return;
      if (buttonEl?.contains(t) || listEl?.contains(t)) return;
      open = false;
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  });

  function toggle() {
    if (disabled) return;
    open = !open;
    if (open) {
      // Focus the current selection if any, else first item.
      const idx = value ? supportedIds.indexOf(value) : 0;
      activeIndex = idx >= 0 ? idx : 0;
    }
  }

  function pick(/** @type {ScenarioId} */ id) {
    open = false;
    if (id === value) return;
    track("scenario_switched", { from: value ?? "none", to: id });
    onchange(id);
  }

  function handleKeydown(/** @type {KeyboardEvent} */ e) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      open = false;
      buttonEl?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, supportedIds.length - 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      activeIndex = 0;
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      activeIndex = supportedIds.length - 1;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const id = supportedIds[activeIndex];
      if (id) pick(id);
    }
  }
</script>

<div class="scenario-switcher" class:open class:dir-up={direction === "up"} class:dir-down={direction === "down"}>
  <button
    type="button"
    class="trigger"
    bind:this={buttonEl}
    onclick={toggle}
    onkeydown={handleKeydown}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="Scenario : {currentLabel}"
    title={currentLabel}
  >
    <span class="label">{currentLabel}</span>
    <span class="caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
  </button>

  {#if open && supportedIds.length > 0}
    <div
      class="panel"
      role="listbox"
      aria-label="Scenarios disponibles"
      bind:this={listEl}
      onkeydown={handleKeydown}
      tabindex="-1"
    >
      {#each supportedIds as id, i (id)}
        {@const def = CANONICAL_SCENARIOS[id]}
        <button
          type="button"
          class="item"
          class:active={i === activeIndex}
          class:selected={id === value}
          role="option"
          aria-selected={id === value}
          onmouseenter={() => (activeIndex = i)}
          onclick={() => pick(id)}
        >
          <strong>{def.label}</strong>
          <span>{def.description}</span>
        </button>
      {/each}
    </div>
  {:else if open}
    <div class="panel empty" role="status">
      <span>Aucun scenario supporte par ce clone.</span>
    </div>
  {/if}
</div>

<style>
  .scenario-switcher {
    position: relative;
    display: inline-flex;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    min-height: var(--touch-min);
    max-width: 220px;
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease),
      background var(--dur-fast) var(--ease);
    white-space: nowrap;
  }
  .trigger:hover:not(:disabled) { border-color: var(--vermillon); }
  .trigger:focus-visible {
    outline: 2px solid var(--vermillon);
    outline-offset: 1px;
  }
  .trigger:disabled { opacity: 0.4; cursor: not-allowed; }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret {
    font-size: 0.7em;
    color: var(--ink-40);
  }

  .panel {
    position: absolute;
    left: 0;
    min-width: 260px;
    max-width: 320px;
    max-height: 340px;
    overflow-y: auto;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    z-index: 30;
    display: flex;
    flex-direction: column;
  }
  .dir-up .panel   { bottom: calc(100% + 4px); }
  .dir-down .panel { top: calc(100% + 4px); }
  .panel.empty {
    padding: 10px 12px;
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    font-family: var(--font-ui);
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--rule-strong);
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease);
    font-family: var(--font);
  }
  .item:last-child { border-bottom: none; }
  .item:hover,
  .item.active {
    background: var(--paper-subtle);
  }
  .item.selected {
    background: var(--paper-subtle);
    border-left: 2px solid var(--vermillon);
    padding-left: 10px;
  }
  .item strong {
    font-size: var(--fs-body);
    color: var(--ink);
    font-weight: 500;
  }
  .item span {
    font-size: var(--fs-nano);
    color: var(--ink-40);
    line-height: var(--lh-normal);
  }

  @media (max-width: 480px) {
    .trigger { max-width: 140px; padding: 10px; }
    .panel { min-width: 220px; max-width: 260px; }
  }
</style>
