<script>
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import LearningFeed from "./LearningFeed.svelte";
  import FidelityCard from "./FidelityCard.svelte";
  import PostsIngestModal from "./PostsIngestModal.svelte";

  let { personaId, extracting = false } = $props();

  let data = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let expandedCorrections = $state(new Set());
  let expandedEntities = $state(new Set());
  let confirmingDelete = $state(null);

  let showPostsModal = $state(false);
  let fidelityReloadToken = $state(0);

  // Extraction progress state
  let exProgress = $state(0);
  let exStep = $state("");
  let exDone = $state(false);
  let exDoneCount = $state(0);

  const ENTITY_TYPE_ORDER = ["concept", "framework", "tool", "person", "company", "metric", "belief"];

  $effect(() => {
    if (personaId) loadData();
  });

  const STEPS = [
    { at: 0,    progress: 0,  label: "Lecture du document..." },
    { at: 1800, progress: 28, label: "Extraction des concepts..." },
    { at: 5000, progress: 55, label: "Construction du graphe..." },
    { at: 9000, progress: 82, label: "Finalisation..." },
  ];

  let stepTimers = [];
  let reloadTimer = null;
  let doneTimer = null;

  $effect(() => {
    if (extracting) {
      // Reset state
      exProgress = 0;
      exStep = STEPS[0].label;
      exDone = false;

      // Animate steps
      stepTimers.forEach(clearTimeout);
      stepTimers = STEPS.slice(1).map(s =>
        setTimeout(() => { exProgress = s.progress; exStep = s.label; }, s.at)
      );

      // Reload data — server awaits extraction before responding, so data is already ready
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => loadData(true), 1000);
    }
    return () => {
      stepTimers.forEach(clearTimeout);
      if (reloadTimer) clearTimeout(reloadTimer);
      if (doneTimer) clearTimeout(doneTimer);
    };
  });

  async function loadData(fromExtraction = false) {
    loading = true;
    error = null;
    try {
      data = await api(`/api/feedback?persona=${personaId}`);
      if (fromExtraction) {
        exProgress = 100;
        exStep = "";
        exDone = true;
        exDoneCount = data.entities.length;
        doneTimer = setTimeout(() => { exDone = false; }, 3000);
      }
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

{#if extracting || exDone}
  <div class="intel-extraction-bar">
    {#if exDone}
      <div class="intel-ex-done">
        <span class="intel-ex-check">✓</span>
        <span>{exDoneCount} entité{exDoneCount !== 1 ? "s" : ""} dans le graphe</span>
      </div>
    {:else}
      <div class="intel-ex-header">
        <span class="intel-ex-step">{exStep}</span>
        <span class="intel-ex-pct">{exProgress}%</span>
      </div>
      <div class="intel-ex-track">
        <div class="intel-ex-fill" style="width: {exProgress}%"></div>
      </div>
      <div class="intel-ex-labels">
        <span class:done={exProgress >= 28}>Lecture</span>
        <span class:done={exProgress >= 55}>Concepts</span>
        <span class:done={exProgress >= 82}>Graphe</span>
        <span class:done={exProgress >= 100}>Sauvegarde</span>
      </div>
    {/if}
  </div>
{/if}

<FidelityCard
  {personaId}
  reloadToken={fidelityReloadToken}
  onAskAddPosts={() => showPostsModal = true}
/>

<div class="learning-section">
  <LearningFeed {personaId} />
</div>

{#if showPostsModal}
  <PostsIngestModal
    {personaId}
    onClose={() => showPostsModal = false}
    onSuccess={() => fidelityReloadToken++}
  />
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
      <span class="intel-stat-value">{data.stats.relations_total ?? 0}</span>
      <span class="intel-stat-label">relations</span>
    </div>
    <div class="intel-stat" class:intel-stat-alert={data.stats.contradictions_count > 0}>
      <span class="intel-stat-value">{data.stats.contradictions_count ?? 0}</span>
      <span class="intel-stat-label">contradictions</span>
    </div>
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.confidence_avg}</span>
      <span class="intel-stat-label">confiance</span>
    </div>
  </div>

  {#if data.contradictions?.length > 0}
    <div class="intel-section">
      <h4 class="intel-section-title">Contradictions <span class="intel-count">{data.contradictions.length}</span></h4>
      {#each data.contradictions as c}
        <div class="intel-contradiction">
          <div class="intel-contradiction-pair mono">
            <span class="intel-contradiction-from">{c.from}</span>
            <span class="intel-contradiction-arrow">↮</span>
            <span class="intel-contradiction-to">{c.to}</span>
          </div>
          {#if c.description}
            <p class="intel-contradiction-desc">{c.description}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Corrections -->
  <div class="intel-section">
    <h4 class="intel-section-title">Corrections <span class="intel-count">{data.corrections.length}</span></h4>
    {#if data.corrections.length === 0}
      <p class="intel-empty">Aucune correction. Corrigez les reponses ou donnez des instructions dans le chat.</p>
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
  .intel-extraction-bar {
    padding: 10px 16px;
    border-bottom: 1px solid var(--rule-strong);
    background: var(--paper);
    font-family: var(--font-mono);
  }
  .intel-ex-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.375rem;
  }
  .intel-ex-step {
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .intel-ex-pct {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }
  .intel-ex-track {
    height: 3px;
    background: var(--rule-strong);
    overflow: hidden;
    margin-bottom: 8px;
  }
  .intel-ex-fill {
    height: 100%;
    background: var(--vermillon);
    transition: width 0.4s linear;
  }
  .intel-ex-labels {
    display: flex;
    justify-content: space-between;
  }
  .intel-ex-labels span {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    transition: color 0.4s linear;
  }
  .intel-ex-labels span.done {
    color: var(--vermillon);
  }
  .intel-ex-done {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: #2d7a3e;
    animation: fadeIn 0.3s linear;
  }
  .intel-ex-check {
    font-size: 0.75rem;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
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
    flex-wrap: wrap;
    gap: 1px;
    padding: 0;
    border-bottom: 1px solid var(--rule-strong);
    background: var(--rule-strong);
  }
  .intel-stat {
    flex: 1 0 33%;
    text-align: center;
    padding: 10px 8px;
    background: var(--paper-subtle);
  }
  .intel-stat-alert .intel-stat-value { color: var(--vermillon); }
  .intel-stat-value {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-h3);
    font-weight: var(--fw-semi);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .intel-stat-label {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .intel-contradiction {
    padding: 6px 8px;
    border-left: 2px solid var(--vermillon);
    background: color-mix(in srgb, var(--vermillon) 4%, transparent);
    margin-bottom: 4px;
  }
  .intel-contradiction-pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 10.5px;
    color: var(--ink);
  }
  .intel-contradiction-arrow { color: var(--vermillon); font-weight: 600; }
  .intel-contradiction-from,
  .intel-contradiction-to { color: var(--ink-70); }
  .intel-contradiction-desc {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--ink-40);
    line-height: 1.4;
  }

  .intel-section {
    padding: 0.5rem;
  }
  .intel-section-title {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    font-weight: var(--fw-semi);
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 10px 8px 6px;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
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
  .intel-correction:hover { background: var(--paper); }
  .intel-correction-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
    cursor: pointer;
    font-size: 0.6875rem;
  }
  .intel-correction-date {
    font-family: var(--font-mono);
    color: var(--ink-40);
    font-size: var(--fs-nano);
    flex-shrink: 0;
    min-width: 3.5rem;
    font-variant-numeric: tabular-nums;
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
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 6px 8px 2px;
    display: block;
  }
  .intel-entity {
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.1s;
  }
  .intel-entity:hover { background: var(--paper); }
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
    background: var(--rule-strong);
    overflow: hidden;
    min-width: 2rem;
  }
  .intel-confidence-fill {
    height: 100%;
    background: var(--ink);
    transition: width 0.3s linear;
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
