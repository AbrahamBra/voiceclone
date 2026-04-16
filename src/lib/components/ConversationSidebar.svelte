<script>
  import { conversations } from "$lib/stores/chat.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { groupByDate, getRelativeTime } from "$lib/utils.js";
  import IntelligencePanel from "./IntelligencePanel.svelte";
  import KnowledgePanel from "./KnowledgePanel.svelte";

  let activeTab = $state("conversations");
  let intelligenceExtracting = $state(false);
  let extractingTimeout = $state(null);

  function handleKnowledgeUpload() {
    intelligenceExtracting = true;
    if (extractingTimeout) clearTimeout(extractingTimeout);
    extractingTimeout = setTimeout(() => {
      intelligenceExtracting = false;
    }, 15000);
  }

  let {
    personaId,
    currentConvId,
    onselectconversation,
    onnewconversation,
    onswitchclone,
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

  let grouped = $derived(
    searchResults
      ? null
      : groupByDate($conversations, "last_message_at")
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
  <div class="sidebar-tabs">
    <button
      class="sidebar-tab"
      class:active={activeTab === "knowledge"}
      onclick={() => activeTab = "knowledge"}
    >Connaissance</button>
    <button
      class="sidebar-tab"
      class:active={activeTab === "intelligence"}
      onclick={() => activeTab = "intelligence"}
    >Intelligence{#if intelligenceExtracting && activeTab !== "intelligence"}<span class="tab-dot"></span>{/if}</button>
    <button
      class="sidebar-tab"
      class:active={activeTab === "conversations"}
      onclick={() => activeTab = "conversations"}
    >Conversations</button>
  </div>

  {#if activeTab === "intelligence"}
    <div class="sidebar-content">
      <IntelligencePanel {personaId} extracting={intelligenceExtracting} />
    </div>
  {:else if activeTab === "knowledge"}
    <div class="sidebar-content">
      <KnowledgePanel {personaId} onupload={handleKnowledgeUpload} />
    </div>
  {:else}
  <div class="conv-sidebar-header">
    <button class="conv-switch-btn" onclick={onswitchclone}>
      &larr; Changer de clone
    </button>
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
                    {conv.title || "Sans titre"}
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
  {/if}
</aside>

<style>
  .conv-sidebar {
    width: 280px;
    min-width: 280px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .sidebar-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-tertiary);
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.5rem 0;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    font-family: inherit;
  }
  .sidebar-tab:hover { color: var(--text-secondary); }
  .sidebar-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .tab-dot {
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 4px;
    vertical-align: middle;
    opacity: 0.7;
    animation: tab-pulse 1.5s ease-in-out infinite;
  }
  @keyframes tab-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
  }

  .conv-sidebar-header {
    padding: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .conv-switch-btn {
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    cursor: pointer;
    margin-bottom: 0.5rem;
    transition: color 0.15s, border-color 0.15s;
    text-align: left;
    font-family: var(--font);
  }

  .conv-switch-btn:hover {
    color: var(--text-secondary);
    border-color: var(--text-tertiary);
  }

  .conv-new-btn {
    width: 100%;
    padding: 0.5rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
    transition: opacity 0.15s;
    font-family: var(--font);
  }

  .conv-new-btn:hover { opacity: 0.9; }

  .conv-search {
    width: 100%;
    padding: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.8rem;
    font-family: inherit;
    outline: none;
  }

  .conv-search::placeholder { color: var(--text-tertiary); }
  .conv-search:focus { border-color: var(--text-tertiary); }

  .conv-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .conv-group-label {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.5rem 0.75rem 0.25rem;
  }

  .conv-item {
    padding: 0.75rem;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 2px;
    transition: background 0.15s;
  }

  .conv-item:hover { background: var(--bg); }
  .conv-item.active { background: var(--bg); border-left: 2px solid var(--accent); }

  .conv-item-title {
    font-size: 0.85rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .conv-item-meta {
    font-size: 0.7rem;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .conv-item-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .conv-item-row .conv-item-title {
    flex: 1;
    min-width: 0;
  }

  .conv-item-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .conv-item:hover .conv-item-actions {
    opacity: 1;
  }

  .conv-action-btn {
    width: 22px;
    height: 22px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-tertiary);
    font-size: 0.8rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: color 0.15s, background 0.15s;
  }

  .conv-action-btn:hover {
    color: var(--text-secondary);
    background: var(--border);
  }

  .conv-action-delete:hover {
    color: var(--error, #ef4444);
    background: rgba(239, 68, 68, 0.1);
  }

  .conv-delete-confirm {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 4px;
    font-size: 0.7rem;
  }

  .conv-delete-confirm span {
    color: var(--error, #ef4444);
  }

  .conv-confirm-yes,
  .conv-confirm-no {
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.675rem;
    cursor: pointer;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    transition: background 0.15s;
  }

  .conv-confirm-yes:hover {
    background: rgba(239, 68, 68, 0.15);
    color: var(--error, #ef4444);
    border-color: var(--error, #ef4444);
  }

  .conv-confirm-no:hover {
    background: var(--border);
  }

  .conv-title-edit {
    width: 100%;
    padding: 0.125rem 0.25rem;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
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
