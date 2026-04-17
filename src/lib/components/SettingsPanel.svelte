<script>
  // Settings as a right-side panel (replaces SettingsModal).
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import SidePanel from "./SidePanel.svelte";

  let { open = false, personaId = null, onClose } = $props();

  let apiKey = $state("");
  let saving = $state(false);
  let usage = $state({ budget_cents: 0, spent_cents: 0, remaining_cents: 0, has_own_key: false });
  let contributors = $state({ contributors: [], is_shared: false, source_persona_name: null });

  $effect(() => {
    if (open) {
      fetchUsage();
      if (personaId) fetchContributors();
    }
  });

  async function fetchContributors() {
    try {
      const resp = await fetch(`/api/contributors?persona=${personaId}`, { headers: authHeaders() });
      if (resp.ok) contributors = await resp.json();
    } catch {}
  }

  async function fetchUsage() {
    try {
      const url = personaId ? `/api/usage?persona=${personaId}` : "/api/usage";
      const resp = await fetch(url, { headers: authHeaders() });
      if (resp.ok) usage = await resp.json();
    } catch {}
  }

  async function save() {
    const key = apiKey.trim();
    if (!key) { onClose?.(); return; }
    saving = true;
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ anthropic_api_key: key }),
      });
      showToast("Clé API sauvegardée");
      onClose?.();
    } catch {
      saving = false;
    }
  }

  const pct = $derived(
    usage.budget_cents > 0
      ? Math.min(100, (usage.spent_cents / usage.budget_cents) * 100)
      : 0
  );
</script>

<SidePanel {open} title="Réglages" width={380} {onClose}>
  <section class="block">
    <div class="kv-line">
      <span class="kv-k mono">budget</span>
      <span class="kv-v mono">{(usage.spent_cents / 100).toFixed(2)} / {(usage.budget_cents / 100).toFixed(2)} €</span>
    </div>
    <div class="budget-bar">
      <div class="budget-bar-fill" style="width: {pct}%" class:high={pct > 80}></div>
    </div>
    {#if usage.has_own_key}
      <div class="kv-line">
        <span class="kv-k mono">key</span>
        <span class="kv-v mono accent">personal key active</span>
      </div>
    {/if}
  </section>

  <section class="block">
    <div class="field-label mono">Clé API Anthropic (optionnel)</div>
    <input
      type="text"
      bind:value={apiKey}
      placeholder="sk-ant-…"
      spellcheck="false"
      autocomplete="off"
    />
    <p class="hint">Utilise ta propre clé pour bypasser le budget.</p>
  </section>

  {#if contributors.contributors.length > 0 || contributors.is_shared}
    <section class="block">
      <div class="field-label mono">
        Contributeurs{contributors.is_shared ? ` · ${contributors.source_persona_name || "partagé"}` : ""}
      </div>
      {#if contributors.contributors.length > 0}
        <ul class="contrib">
          {#each contributors.contributors as c}
            <li>
              <span class="c-name">{c.name}</span>
              <span class="c-stats mono">
                {c.corrections_count} corr.{c.knowledge_count > 0 ? ` · ${c.knowledge_count} docs` : ""}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">Aucune contribution trackée</p>
      {/if}
      {#if contributors.is_shared}
        <p class="shared-badge mono">Intelligence partagée</p>
      {/if}
    </section>
  {/if}

  <section class="actions">
    <button class="btn-ghost mono" onclick={() => onClose?.()}>Fermer</button>
    <button class="btn-solid mono" disabled={saving} onclick={save}>
      {saving ? "Sauvegarde…" : "Sauvegarder"}
    </button>
  </section>
</SidePanel>

<style>
  .block {
    padding: 12px 0;
    border-bottom: 1px dashed var(--rule);
  }
  .block:first-child { padding-top: 0; }
  .block:last-of-type { border-bottom: 0; }

  .field-label {
    font-size: 9.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 6px;
  }

  .kv-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 2px 0;
    font-size: 11.5px;
  }
  .kv-k { color: var(--ink-40); text-transform: uppercase; letter-spacing: 0.08em; }
  .kv-v { color: var(--ink); font-variant-numeric: tabular-nums; }
  .accent { color: var(--vermillon); }

  .budget-bar {
    margin-top: 6px;
    height: 4px;
    background: var(--rule-strong);
  }
  .budget-bar-fill {
    height: 100%;
    background: var(--ink);
    transition: width 0.15s linear, background 0.15s linear;
  }
  .budget-bar-fill.high { background: var(--vermillon); }

  input {
    width: 100%;
    padding: 7px 9px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    transition: border-color 0.08s linear;
  }
  input:focus { border-color: var(--vermillon); }

  .hint {
    font-size: 11px;
    color: var(--ink-40);
    line-height: 1.45;
    margin-top: 6px;
  }

  .contrib {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .contrib li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px dashed var(--rule);
    font-size: 12px;
  }
  .contrib li:last-child { border-bottom: 0; }
  .c-name { color: var(--ink); font-weight: 500; }
  .c-stats { color: var(--ink-40); font-size: 10.5px; }

  .shared-badge {
    margin-top: 8px;
    font-size: 10px;
    color: var(--vermillon);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding-top: 12px;
    margin-top: 12px;
    border-top: 1px solid var(--rule-strong);
  }
  .btn-ghost, .btn-solid {
    padding: 6px 12px;
    font-size: 11px;
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    transition: all 0.08s linear;
  }
  .btn-ghost { background: transparent; color: var(--ink-70); }
  .btn-ghost:hover { color: var(--ink); border-color: var(--ink-40); }
  .btn-solid { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn-solid:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .btn-solid:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
