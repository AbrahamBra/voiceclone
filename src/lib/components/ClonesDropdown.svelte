<script>
  import { fly } from "svelte/transition";

  let {
    personas = [],
    currentPersonaId = null,
    open = false,
    onSelect,
    onClose,
  } = $props();

  let containerEl = $state();

  function handleSelect(p) {
    if (p.id === currentPersonaId) return;
    onSelect?.(p.id);
    onClose?.();
  }

  function handleKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose?.();
    }
  }

  $effect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (containerEl && !containerEl.contains(e.target)) {
        onClose?.();
      }
    }
    const t = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  });
</script>

{#if open}
  <div
    class="dropdown"
    bind:this={containerEl}
    role="listbox"
    aria-label="Changer de clone"
    onkeydown={handleKey}
    transition:fly={{ y: -4, duration: 120 }}
  >
    {#if personas.length === 0}
      <div class="empty mono">aucun clone chargé</div>
    {:else}
      {#each personas as p}
        <button
          class="option"
          class:current={p.id === currentPersonaId}
          disabled={p.id === currentPersonaId}
          onclick={() => handleSelect(p)}
          role="option"
          aria-selected={p.id === currentPersonaId}
        >
          <span class="opt-avatar">{p.avatar || "?"}</span>
          <span class="opt-name">{p.name}</span>
          {#if p.triage && p.triage !== "ok"}
            <span
              class="triage-dot"
              data-kind={p.triage}
              title={p.triageLabel || p.triage}
              aria-label={p.triageLabel || p.triage}
            ></span>
          {/if}
          {#if p.id === currentPersonaId}
            <span class="opt-tag mono">courant</span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 240px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 50;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px dashed var(--rule);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--ink);
    transition: background 0.08s linear;
  }
  .option:last-child {
    border-bottom: none;
  }
  .option:hover:not(:disabled) {
    background: var(--paper-subtle);
  }
  .option:disabled {
    cursor: default;
    color: var(--ink-40);
  }
  .option.current {
    background: var(--paper-subtle);
  }
  .opt-avatar {
    width: 20px;
    height: 20px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 10px;
    flex-shrink: 0;
  }
  .opt-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt-tag {
    font-size: 9px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  /* Triage dot — même palette que hub pour cohérence.
     drift = rouge (priorité 0), stale/never = ocre (priorité 1), warn = ocre pâle. */
  .triage-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .triage-dot[data-kind="drift"] {
    background: var(--vermillon);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--vermillon) 20%, transparent);
    animation: driftPulse 2s ease-in-out infinite;
  }
  .triage-dot[data-kind="stale"],
  .triage-dot[data-kind="never"] { background: #b87300; }
  .triage-dot[data-kind="warn"] { background: #b87300; opacity: 0.55; }
  @keyframes driftPulse {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--vermillon) 20%, transparent); }
    50%      { box-shadow: 0 0 0 4px color-mix(in srgb, var(--vermillon) 10%, transparent); }
  }
  .empty {
    padding: 12px;
    font-size: 11px;
    color: var(--ink-40);
    text-align: center;
  }
</style>
