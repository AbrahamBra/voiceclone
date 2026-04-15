<script>
  import { fly } from "svelte/transition";
  import { api } from "$lib/api.js";
  import { authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let { onclose } = $props();

  let apiKey = $state("");
  let saving = $state(false);
  let usage = $state({ budget_cents: 0, spent_cents: 0, remaining_cents: 0, has_own_key: false });

  $effect(() => {
    fetchUsage();
  });

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

  @media (max-width: 480px) {
    .modal { width: 95%; }
  }
</style>
