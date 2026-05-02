<script>
  // Sidebar is now conversations-only. Connaissance + Intelligence moved to
  // the /brain/[persona] route as part of the non-daily surface split.
  import { conversations } from "$lib/stores/chat.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { groupByDate, getRelativeTime } from "$lib/utils.js";

  let {
    personaId,
    currentConvId,
    onselectconversation,
    onnewconversation,
    open = false,
  } = $props();

  let searchQuery = $state("");
  let searchResults = $state(null);
  let searchTimeout = $state(null);

  // Inline editing state
  let editingId = $state(null);
  let editValue = $state("");
  let editInputEl = $state(undefined);

  // Delete confirmation state
  let deletingId = $state(null);

  // V3.6.5 — lifecycle filter. "all" = no filter (legacy view).
  // The other values mirror conversations.lifecycle_state. The filter is
  // local-only — the conversations store holds the full set already.
  /** @type {"all" | "awaiting_send" | "awaiting_reply" | "active" | "closed"} */
  let lifecycleFilter = $state("all");

  // Counts per bucket — surfaced as small numbers next to each tab so the
  // setter sees at a glance "12 drafts à envoyer" without clicking.
  let lifecycleCounts = $derived.by(() => {
    const out = { all: 0, awaiting_send: 0, awaiting_reply: 0, active: 0, closed: 0 };
    for (const c of $conversations) {
      out.all++;
      const state = c.lifecycle_state;
      if (state && Object.hasOwn(out, state)) out[state]++;
    }
    return out;
  });

  let filteredConversations = $derived.by(() => {
    if (lifecycleFilter === "all") return $conversations;
    return $conversations.filter((c) => c.lifecycle_state === lifecycleFilter);
  });

  let grouped = $derived(
    searchResults
      ? null
      : groupByDate(filteredConversations, "last_message_at")
  );

  function handleSearch(e) {
    const query = e.target.value.trim();
    searchQuery = e.target.value;
    if (searchTimeout) clearTimeout(searchTimeout);

    if (query.length < 2) {
      searchResults = null;
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const resp = await fetch(
          `/api/conversations?search=${encodeURIComponent(query)}&persona=${personaId}`,
          { headers: authHeaders() }
        );
        if (!resp.ok) return;
        const data = await resp.json();
        searchResults = data.results || [];
      } catch {}
    }, 300);
  }

  function selectConv(id) {
    onselectconversation?.(id);
  }

  function startEdit(conv, e) {
    e.stopPropagation();
    editingId = conv.id;
    editValue = conv.title || "Sans titre";
    // Focus after DOM update
    setTimeout(() => editInputEl?.focus(), 0);
  }

  async function saveEdit(convId) {
    const val = editValue.trim();
    editingId = null;
    if (!val) return;

    try {
      const resp = await fetch(`/api/conversations?id=${convId}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title: val }),
      });
      if (resp.ok) {
        conversations.update((list) =>
          list.map((c) => (c.id === convId ? { ...c, title: val } : c))
        );
      } else {
        showToast("Erreur de renommage");
      }
    } catch {
      showToast("Erreur de renommage");
    }
  }

  function cancelEdit() {
    editingId = null;
  }

  function handleEditKeydown(e, convId) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(convId);
    }
    if (e.key === "Escape") {
      cancelEdit();
    }
  }

  function confirmDelete(convId, e) {
    e.stopPropagation();
    deletingId = convId;
  }

  async function executeDelete(convId, e) {
    e.stopPropagation();
    deletingId = null;
    try {
      const resp = await fetch(`/api/conversations?id=${convId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (resp.ok) {
        conversations.update((list) => list.filter((c) => c.id !== convId));
        if (convId === currentConvId) onnewconversation?.();
        showToast("Conversation supprimée");
      } else {
        showToast("Erreur de suppression");
      }
    } catch {
      showToast("Erreur de suppression");
    }
  }

  function cancelDelete(e) {
    e.stopPropagation();
    deletingId = null;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<aside class="conv-sidebar" class:open>
  <div class="conv-sidebar-header">
    <button class="conv-new-btn" onclick={onnewconversation}>
      + Nouvelle conversation
    </button>
    <input
      class="conv-search"
      type="text"
      placeholder="Rechercher..."
      value={searchQuery}
      oninput={handleSearch}
    />
    {#if lifecycleCounts.all > 0}
    <div class="conv-filter-tabs" role="tablist" aria-label="Filtre lifecycle">
      <button
        class="conv-filter-tab"
        class:active={lifecycleFilter === "all"}
        role="tab"
        aria-selected={lifecycleFilter === "all"}
        onclick={() => (lifecycleFilter = "all")}
      >
        Toutes
        <span class="conv-filter-count">{lifecycleCounts.all}</span>
      </button>
      <button
        class="conv-filter-tab"
        class:active={lifecycleFilter === "awaiting_send"}
        role="tab"
        aria-selected={lifecycleFilter === "awaiting_send"}
        onclick={() => (lifecycleFilter = "awaiting_send")}
        title="Drafts générés, pas encore envoyés au prospect"
      >
        À envoyer
        <span class="conv-filter-count">{lifecycleCounts.awaiting_send}</span>
      </button>
      <button
        class="conv-filter-tab"
        class:active={lifecycleFilter === "awaiting_reply"}
        role="tab"
        aria-selected={lifecycleFilter === "awaiting_reply"}
        onclick={() => (lifecycleFilter = "awaiting_reply")}
        title="Message envoyé, en attente de réponse"
      >
        En attente
        <span class="conv-filter-count">{lifecycleCounts.awaiting_reply}</span>
      </button>
      <button
        class="conv-filter-tab"
        class:active={lifecycleFilter === "active"}
        role="tab"
        aria-selected={lifecycleFilter === "active"}
        onclick={() => (lifecycleFilter = "active")}
        title="Le prospect a répondu, conversation en cours"
      >
        Actives
        <span class="conv-filter-count">{lifecycleCounts.active}</span>
      </button>
      <button
        class="conv-filter-tab"
        class:active={lifecycleFilter === "closed"}
        role="tab"
        aria-selected={lifecycleFilter === "closed"}
        onclick={() => (lifecycleFilter = "closed")}
        title="Conversation terminée (RDV, hors-cible, abandon)"
      >
        Closed
        <span class="conv-filter-count">{lifecycleCounts.closed}</span>
      </button>
    </div>
    {/if}
  </div>

  <div class="conv-list">
    {#if searchResults}
      {#each searchResults as r}
        <div
          class="conv-item"
          role="button"
          tabindex="0"
          onclick={() => selectConv(r.conversation_id)}
        >
          <div class="conv-item-title">
            {r.conversation_title || "Sans titre"}
          </div>
          <div class="conv-item-meta">
            {(r.message_content_snippet || "").slice(0, 80)}...
          </div>
        </div>
      {/each}
      {#if searchResults.length === 0}
        <div class="conv-item-meta" style="padding: 0.75rem; text-align: center;">
          Aucun resultat
        </div>
      {/if}
    {:else if grouped}
      {#if filteredConversations.length === 0 && lifecycleFilter !== "all"}
        <div class="conv-empty-bucket">
          Aucune conversation dans ce filtre.
        </div>
      {/if}
      {#each Object.entries(grouped) as [label, items]}
        {#if items.length > 0}
          <div class="conv-group-label">{label}</div>
          {#each items as conv}
            <div
              class="conv-item"
              class:active={conv.id === currentConvId}
              role="button"
              tabindex="0"
              onclick={() => selectConv(conv.id)}
            >
              {#if editingId === conv.id}
                <input
                  class="conv-title-edit"
                  type="text"
                  maxlength="100"
                  bind:value={editValue}
                  bind:this={editInputEl}
                  onblur={() => saveEdit(conv.id)}
                  onkeydown={(e) => handleEditKeydown(e, conv.id)}
                  onclick={(e) => e.stopPropagation()}
                />
              {:else}
                <div class="conv-item-row">
                  <div class="conv-item-title">
                    {conv.prospect_name || conv.title || "Sans titre"}
                  </div>
                  <div class="conv-item-actions">
                    <button class="conv-action-btn" title="Renommer" onclick={(e) => startEdit(conv, e)}>&#9998;</button>
                    <button class="conv-action-btn conv-action-delete" title="Supprimer" onclick={(e) => confirmDelete(conv.id, e)}>&times;</button>
                  </div>
                </div>
              {/if}
              {#if deletingId === conv.id}
                <div class="conv-delete-confirm">
                  <span>Supprimer ?</span>
                  <button class="conv-confirm-yes" onclick={(e) => executeDelete(conv.id, e)}>Oui</button>
                  <button class="conv-confirm-no" onclick={cancelDelete}>Non</button>
                </div>
              {:else}
                <div class="conv-item-meta">
                  {getRelativeTime(conv.last_message_at)} &middot; {conv.message_count || 0} msg
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
  </div>
</aside>

<style>
  /* ─── Laboratoire sidebar ─── */
  .conv-sidebar {
    width: 260px;
    min-width: 260px;
    background: var(--paper-subtle);
    border-right: 1px solid var(--rule-strong);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-ui);
  }

  .conv-sidebar-header {
    padding: 12px;
    border-bottom: 1px solid var(--rule-strong);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .conv-new-btn {
    width: 100%;
    padding: 8px 10px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    text-align: left;
  }
  .conv-new-btn:hover {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }

  .conv-search {
    width: 100%;
    padding: 7px 9px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease);
  }
  .conv-search::placeholder { color: var(--ink-20); }
  .conv-search:focus { border-color: var(--vermillon); }

  /* ─── Lifecycle filter tabs (V3.6.5) ─── */
  .conv-filter-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
  }
  .conv-filter-tab {
    flex: 1 1 auto;
    min-width: 0;
    padding: 5px 6px;
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    letter-spacing: 0.04em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .conv-filter-tab:hover {
    background: var(--paper);
    color: var(--ink);
  }
  .conv-filter-tab.active {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .conv-filter-count {
    font-size: 0.85em;
    opacity: 0.7;
  }
  .conv-filter-tab.active .conv-filter-count {
    opacity: 1;
  }
  .conv-empty-bucket {
    padding: 14px 12px;
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    text-align: center;
  }

  .conv-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  .conv-group-label {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-weight: var(--fw-semi);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 10px 12px 4px;
  }

  .conv-item {
    padding: 8px 12px;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }

  .conv-item:hover { background: var(--paper); }
  .conv-item.active {
    background: var(--paper);
    border-left-color: var(--vermillon);
  }

  .conv-item-title {
    font-size: var(--fs-small);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .conv-item-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    margin-top: 2px;
  }

  .conv-item-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .conv-item-row .conv-item-title { flex: 1; min-width: 0; }

  .conv-item-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease);
    flex-shrink: 0;
  }
  .conv-item:hover .conv-item-actions { opacity: 1; pointer-events: auto; }

  .conv-action-btn {
    width: 22px;
    height: 22px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--ink-40);
    font-size: var(--fs-small);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .conv-action-btn:hover {
    color: var(--ink);
    border-color: var(--rule-strong);
  }
  .conv-action-delete:hover {
    color: var(--vermillon);
    border-color: var(--vermillon);
  }

  .conv-delete-confirm {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
  }
  .conv-delete-confirm span {
    color: var(--vermillon);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .conv-confirm-yes,
  .conv-confirm-no {
    padding: 3px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--ink-70);
    transition: all var(--dur-fast) var(--ease);
  }
  .conv-confirm-yes:hover {
    background: var(--vermillon);
    color: var(--paper);
    border-color: var(--vermillon);
  }
  .conv-confirm-no:hover {
    background: var(--paper-subtle);
    color: var(--ink);
  }

  .conv-title-edit {
    width: 100%;
    padding: 3px 6px;
    background: var(--paper);
    border: 1px solid var(--vermillon);
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--fs-small);
    outline: none;
  }

  @media (max-width: 768px) {
    .conv-sidebar {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      z-index: 50;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
    }
    .conv-sidebar.open {
      transform: translateX(0);
    }
  }
</style>
