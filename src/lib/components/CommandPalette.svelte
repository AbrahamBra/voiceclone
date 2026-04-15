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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="palette-overlay" onclick={handleBackdrop} transition:fly={{ y: 0, duration: 100 }}>
  <div class="palette" onkeydown={handleKeydown}>
    <div class="search-row">
      <span class="search-icon">&#128269;</span>
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="Rechercher une conversation..."
      />
      <kbd>esc</kbd>
    </div>
    <div class="results">
      {#if filtered.length === 0}
        <div class="empty">Aucun resultat</div>
      {:else}
        {#each filtered as conv, i (conv.id)}
          <button
            class="result-item"
            class:selected={i === selectedIndex}
            onclick={() => onselect(conv.id)}
            onmouseenter={() => (selectedIndex = i)}
          >
            <span class="result-title">{conv.title || "Sans titre"}</span>
            {#if conv.updatedAt}
              <span class="result-date">
                {new Date(conv.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
              </span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    z-index: 200;
  }

  .palette {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    max-width: 480px;
    width: 90%;
    overflow: hidden;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .search-icon {
    font-size: 0.85rem;
    color: var(--text-tertiary);
  }

  .search-row input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 0.875rem;
    outline: none;
  }

  kbd {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.1rem 0.35rem;
    font-family: inherit;
  }

  .results {
    max-height: 300px;
    overflow-y: auto;
  }

  .empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 0.8125rem;
  }

  .result-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
  }

  .result-item:hover,
  .result-item.selected {
    background: var(--bg);
  }

  .result-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .result-date {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    flex-shrink: 0;
    margin-left: 0.5rem;
  }

  @media (max-width: 480px) {
    .palette { width: 95%; }
    .palette-overlay { padding-top: 10vh; }
  }
</style>
