<script>
  import { fly } from "svelte/transition";
  import { tick } from "svelte";

  let { conversations, onselect, onclose } = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl = $state(undefined);

  let filtered = $derived(
    query.trim()
      ? conversations.filter((c) =>
          (c.title || "Sans titre").toLowerCase().includes(query.toLowerCase())
        )
      : conversations
  );

  // Reset selection when filter changes
  $effect(() => {
    filtered; // subscribe
    selectedIndex = 0;
  });

  // Auto-focus input on mount
  $effect(() => {
    tick().then(() => inputEl?.focus());
  });

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      onselect(filtered[selectedIndex].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }

  function fmtDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="palette-overlay" onclick={handleBackdrop} transition:fly={{ y: 0, duration: 100 }}>
  <div class="palette" onkeydown={handleKeydown}>
    <header class="palette-head mono">
      <span class="palette-tag">recherche</span>
      <span class="palette-count">{filtered.length} / {conversations.length}</span>
    </header>

    <div class="search-row">
      <span class="search-prefix mono">›</span>
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="Rechercher une conversation…"
      />
      <kbd class="mono">esc</kbd>
    </div>

    <div class="results">
      {#if filtered.length === 0}
        <div class="empty mono">aucun résultat</div>
      {:else}
        {#each filtered as conv, i (conv.id)}
          <button
            class="result-item"
            class:selected={i === selectedIndex}
            onclick={() => onselect(conv.id)}
            onmouseenter={() => (selectedIndex = i)}
          >
            <span class="result-caret mono" aria-hidden="true">{i === selectedIndex ? "›" : " "}</span>
            <span class="result-title">{conv.title || "Sans titre"}</span>
            {#if conv.last_message_at}
              <span class="result-date mono">{fmtDate(conv.last_message_at)}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <footer class="palette-foot mono">
      <span class="foot-hint"><kbd class="mono">↑</kbd><kbd class="mono">↓</kbd> naviguer</span>
      <span class="foot-hint"><kbd class="mono">↵</kbd> ouvrir</span>
      <span class="foot-hint"><kbd class="mono">esc</kbd> fermer</span>
    </footer>
  </div>
</div>

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 26, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 18vh;
    z-index: var(--z-modal, 40);
  }

  .palette {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    max-width: 520px;
    width: 90%;
    overflow: hidden;
    font-family: var(--font-ui);
    box-shadow: 0 12px 40px rgba(20, 20, 26, 0.14);
    display: flex;
    flex-direction: column;
  }

  .palette-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 8px 14px;
    border-bottom: 1px dashed var(--rule);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40);
  }
  .palette-tag {
    color: var(--ink);
    font-weight: var(--fw-semi);
  }
  .palette-count {
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
  }
  .search-prefix {
    font-size: 16px;
    color: var(--vermillon);
    font-weight: var(--fw-semi);
    line-height: 1;
  }
  .search-row input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    outline: none;
  }
  .search-row input::placeholder {
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-70);
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    padding: 2px 6px;
    line-height: 1;
    letter-spacing: 0.04em;
  }

  .results {
    max-height: 340px;
    overflow-y: auto;
    flex: 1;
  }

  .empty {
    padding: 24px 14px;
    text-align: center;
    color: var(--ink-40);
    font-size: var(--fs-tiny);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .result-item {
    width: 100%;
    display: grid;
    grid-template-columns: 14px 1fr auto;
    align-items: baseline;
    gap: 8px;
    padding: 8px 14px;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    cursor: pointer;
    text-align: left;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }

  .result-item.selected {
    background: var(--paper-subtle);
    border-left-color: var(--vermillon);
  }

  .result-caret {
    color: var(--vermillon);
    font-weight: var(--fw-semi);
  }

  .result-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .result-date {
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: lowercase;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .palette-foot {
    display: flex;
    gap: 16px;
    padding: 8px 14px;
    border-top: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    font-size: 9.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-wrap: wrap;
  }
  .foot-hint {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }

  @media (max-width: 480px) {
    .palette { width: 95%; }
    .palette-overlay { padding-top: 10vh; }
    .palette-foot { padding: 8px 10px; gap: 10px; }
  }
</style>
