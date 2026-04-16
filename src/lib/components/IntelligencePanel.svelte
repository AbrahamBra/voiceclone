<script>
  import { api } from "$lib/api.js";
  import { getRelativeTime } from "$lib/utils.js";
  import { showToast } from "$lib/stores/ui.js";

  let { personaId, extracting = false } = $props();

  let data = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let expandedCorrections = $state(new Set());
  let expandedEntities = $state(new Set());
  let confirmingDelete = $state(null);

  const ENTITY_TYPE_ORDER = ["concept", "framework", "tool", "person", "company", "metric", "belief"];

  $effect(() => {
    if (personaId) loadData();
  });

  let reloadTimeout = $state(null);
  $effect(() => {
    if (extracting) {
      if (reloadTimeout) clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(() => {
        loadData();
      }, 12000);
    }
  });

  async function loadData() {
    loading = true;
    error = null;
    try {
      data = await api(`/api/feedback?persona=${personaId}`);
    } catch (e) {
      error = e.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  function toggleCorrection(id) {
    const next = new Set(expandedCorrections);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedCorrections = next;
  }

  function toggleEntity(id) {
    const next = new Set(expandedEntities);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedEntities = next;
  }

  function startDelete(id) {
    confirmingDelete = id;
    setTimeout(() => { if (confirmingDelete === id) confirmingDelete = null; }, 4000);
  }

  async function confirmDelete(id) {
    try {
      await api(`/api/feedback?persona=${personaId}&correction=${id}`, { method: "DELETE" });
      data.corrections = data.corrections.filter(c => c.id !== id);
      data.stats.corrections_total--;
      confirmingDelete = null;
      showToast("Correction supprimee");
    } catch {
      showToast("Erreur lors de la suppression");
      confirmingDelete = null;
    }
  }

  let groupedEntities = $derived.by(() => {
    if (!data?.entities) return [];
    return ENTITY_TYPE_ORDER
      .map(type => ({
        type,
        items: data.entities.filter(e => e.type === type),
      }))
      .filter(g => g.items.length > 0);
  });

  function confidenceColor(c) {
    if (c >= 0.8) return "var(--success)";
    if (c >= 0.6) return "var(--warning)";
    return "var(--error)";
  }
</script>

{#if extracting}
  <div class="intel-extracting">Analyse en cours...</div>
{/if}

{#if loading}
  <div class="intel-loading">Chargement...</div>
{:else if error}
  <div class="intel-error">
    {error}
    <button class="intel-retry" onclick={loadData}>Reessayer</button>
  </div>
{:else if data}
  <!-- Stats -->
  <div class="intel-stats">
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.corrections_total}</span>
      <span class="intel-stat-label">corrections</span>
    </div>
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.entities_total}</span>
      <span class="intel-stat-label">entites</span>
    </div>
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.confidence_avg}</span>
      <span class="intel-stat-label">confiance</span>
    </div>
  </div>

  <!-- Corrections -->
  <div class="intel-section">
    <h4 class="intel-section-title">Corrections <span class="intel-count">{data.corrections.length}</span></h4>
    {#if data.corrections.length === 0}
      <p class="intel-empty">Aucune correction. Utilisez le bouton Corriger sur les reponses.</p>
    {:else}
      {#each data.corrections as c (c.id)}
        <div class="intel-correction" class:expanded={expandedCorrections.has(c.id)}>
          <div class="intel-correction-header" onclick={() => toggleCorrection(c.id)}>
            <span class="intel-correction-date">{getRelativeTime(c.created_at)}</span>
            <span class="intel-correction-text">
              {c.correction.length > 80 ? c.correction.slice(0, 80) + "..." : c.correction}
            </span>
            {#if confirmingDelete === c.id}
              <button class="intel-delete-btn confirming" onclick={(e) => { e.stopPropagation(); confirmDelete(c.id); }}>
                Supprimer ?
              </button>
            {:else}
              <button class="intel-delete-btn" onclick={(e) => { e.stopPropagation(); startDelete(c.id); }}>
                &times;
              </button>
            {/if}
          </div>
          {#if expandedCorrections.has(c.id)}
            <div class="intel-correction-detail">
              {#if c.correction.length > 80}
                <p class="intel-correction-full">{c.correction}</p>
              {/if}
              {#if c.user_message}
                <p class="intel-context">User: {c.user_message}</p>
              {/if}
              {#if c.bot_message}
                <p class="intel-context">Bot: {c.bot_message}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Entities -->
  <div class="intel-section">
    <h4 class="intel-section-title">Connaissances <span class="intel-count">{data.entities.length}</span></h4>
    {#if data.entities.length === 0}
      <p class="intel-empty">Aucune entite. Le graphe se construit automatiquement via les corrections.</p>
    {:else}
      {#each groupedEntities as group}
        <div class="intel-entity-group">
          <span class="intel-group-label">{group.type}</span>
          {#each group.items as e (e.id)}
            <div class="intel-entity" onclick={() => toggleEntity(e.id)}>
              <div class="intel-entity-header">
                <span class="intel-entity-name">{e.name}</span>
                <div class="intel-confidence-bar">
                  <div
                    class="intel-confidence-fill"
                    style="width: {(e.confidence || 1) * 100}%; background: {confidenceColor(e.confidence || 1)}"
                  ></div>
                </div>
                {#if e.last_matched_at}
                  <span class="intel-entity-used">{getRelativeTime(e.last_matched_at)}</span>
                {/if}
              </div>
              {#if expandedEntities.has(e.id)}
                <div class="intel-entity-detail">
                  {#if e.description}
                    <p class="intel-entity-desc">{e.description}</p>
                  {/if}
                  {#if e.relations.length > 0}
                    <ul class="intel-relations">
                      {#each e.relations as r}
                        <li>{r.type} {r.target} <span class="intel-rel-conf">({r.confidence})</span></li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .intel-extracting {
    padding: 0.375rem 1rem;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .intel-extracting::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    display: inline-block;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .intel-loading, .intel-error {
    padding: 1rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-align: center;
  }
  .intel-retry {
    display: block;
    margin: 0.5rem auto 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    cursor: pointer;
  }
  .intel-retry:hover { color: var(--text); border-color: var(--text-tertiary); }

  .intel-stats {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .intel-stat {
    flex: 1;
    text-align: center;
  }
  .intel-stat-value {
    display: block;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }
  .intel-stat-label {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .intel-section {
    padding: 0.5rem;
  }
  .intel-section-title {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.5rem;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .intel-count {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .intel-empty {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    padding: 0.5rem;
    margin: 0;
  }

  .intel-correction {
    border-radius: var(--radius);
    margin-bottom: 2px;
    transition: background 0.1s;
  }
  .intel-correction:hover { background: rgba(255, 255, 255, 0.03); }
  .intel-correction-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
    cursor: pointer;
    font-size: 0.6875rem;
  }
  .intel-correction-date {
    color: var(--text-tertiary);
    font-size: 0.625rem;
    flex-shrink: 0;
    min-width: 3.5rem;
  }
  .intel-correction-text {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .intel-delete-btn {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0 0.25rem;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .intel-delete-btn:hover { color: var(--error); }
  .intel-delete-btn.confirming {
    color: var(--error);
    font-size: 0.625rem;
  }
  .intel-correction-detail {
    padding: 0.25rem 0.5rem 0.5rem 4.25rem;
  }
  .intel-correction-full {
    color: var(--text);
    font-size: 0.6875rem;
    margin: 0 0 0.375rem;
  }
  .intel-context {
    color: var(--text-tertiary);
    font-size: 0.625rem;
    margin: 0.125rem 0;
    font-style: italic;
  }

  .intel-entity-group {
    margin-bottom: 0.5rem;
  }
  .intel-group-label {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.5rem;
    display: block;
  }
  .intel-entity {
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.1s;
  }
  .intel-entity:hover { background: rgba(255, 255, 255, 0.03); }
  .intel-entity-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.6875rem;
  }
  .intel-entity-name {
    color: var(--text);
    font-weight: 500;
    flex-shrink: 0;
  }
  .intel-confidence-bar {
    flex: 1;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    min-width: 2rem;
  }
  .intel-confidence-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }
  .intel-entity-used {
    color: var(--text-tertiary);
    font-size: 0.5625rem;
    flex-shrink: 0;
  }
  .intel-entity-detail {
    padding: 0.125rem 0.5rem 0.375rem;
  }
  .intel-entity-desc {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    margin: 0 0 0.25rem;
  }
  .intel-relations {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .intel-relations li {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    padding: 0.0625rem 0;
  }
  .intel-rel-conf { opacity: 0.6; }
</style>
