<script>
  import { fly } from "svelte/transition";
  import { api } from "$lib/api.js";
  import { authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let { onclose, personaId = null } = $props();

  let apiKey = $state("");
  let saving = $state(false);
  let usage = $state({ budget_cents: 0, spent_cents: 0, remaining_cents: 0, has_own_key: false });
  let contributors = $state({ contributors: [], is_shared: false, source_persona_name: null });

  $effect(() => {
    fetchUsage();
    if (personaId) fetchContributors();
  });

  async function fetchContributors() {
    try {
      const resp = await fetch(`/api/contributors?persona=${personaId}`, { headers: authHeaders() });
      if (resp.ok) contributors = await resp.json();
    } catch {}
  }

  async function fetchUsage() {
    try {
      const resp = await fetch("/api/usage", { headers: authHeaders() });
      if (resp.ok) usage = await resp.json();
    } catch {}
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose();
  }

  async function save() {
    const key = apiKey.trim();
    if (!key) {
      onclose();
      return;
    }
    saving = true;
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ anthropic_api_key: key }),
      });
      showToast("Cle API sauvegardee");
      onclose();
    } catch {
      saving = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleBackdrop} transition:fly={{ y: 0, duration: 150 }}>
  <div class="modal">
    <h3>Parametres</h3>
    <p class="hint">
      Budget : {(usage.spent_cents / 100).toFixed(2)}&euro; / {(usage.budget_cents / 100).toFixed(2)}&euro; utilises{usage.has_own_key ? " (cle perso active)" : ""}
    </p>
    <div class="field">
      <label for="settings-key">Cle API Anthropic (optionnel)</label>
      <input
        id="settings-key"
        type="text"
        bind:value={apiKey}
        placeholder="sk-ant-..."
      />
    </div>
    {#if contributors.contributors.length > 0 || contributors.is_shared}
      <div class="contributors">
        <h4>Contributeurs{contributors.is_shared ? ` · ${contributors.source_persona_name || "partage"}` : ""}</h4>
        {#if contributors.contributors.length > 0}
          <ul>
            {#each contributors.contributors as c}
              <li>
                <span class="name">{c.name}</span>
                <span class="stats">{c.corrections_count} corrections{c.knowledge_count > 0 ? `, ${c.knowledge_count} docs` : ""}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">Aucune contribution trackee</p>
        {/if}
        {#if contributors.is_shared}
          <p class="shared-badge">Intelligence partagee</p>
        {/if}
      </div>
    {/if}

    <div class="actions">
      <button class="btn-cancel" onclick={onclose}>Fermer</button>
      <button class="btn-submit" disabled={saving} onclick={save}>
        {saving ? "Sauvegarde..." : "Sauvegarder"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
    max-width: 400px;
    width: 90%;
  }

  h3 {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    color: var(--text);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0 0 0.75rem;
  }

  .field {
    margin-bottom: 0.75rem;
  }

  label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }

  input {
    width: 100%;
    padding: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn-cancel,
  .btn-submit {
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius);
    border: none;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .btn-cancel {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-cancel:hover {
    color: var(--text);
  }

  .btn-submit {
    background: var(--accent);
    color: #fff;
  }

  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .contributors {
    margin-bottom: 0.75rem;
    padding: 0.5rem;
    background: var(--bg);
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }

  .contributors h4 {
    margin: 0 0 0.375rem;
    font-size: 0.8125rem;
    color: var(--text);
  }

  .contributors ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .contributors li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.2rem 0;
    font-size: 0.75rem;
  }

  .contributors .name {
    color: var(--text);
    font-weight: 500;
  }

  .contributors .stats {
    color: var(--text-secondary);
  }

  .contributors .empty {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .shared-badge {
    font-size: 0.6875rem;
    color: var(--accent);
    margin: 0.375rem 0 0;
    font-weight: 500;
  }

  @media (max-width: 480px) {
    .modal { width: 95%; }
  }
</style>
