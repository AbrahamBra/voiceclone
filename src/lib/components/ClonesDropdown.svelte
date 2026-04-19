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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
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
  .empty {
    padding: 12px;
    font-size: 11px;
    color: var(--ink-40);
    text-align: center;
  }
</style>
