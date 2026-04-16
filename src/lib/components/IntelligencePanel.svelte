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

  let fidelity = $state(null);
  let fidelityLoading = $state(true);
  let recalculating = $state(false);

  // Extraction progress state
  let exProgress = $state(0);
  let exStep = $state("");
  let exDone = $state(false);
  let exDoneCount = $state(0);

  const ENTITY_TYPE_ORDER = ["concept", "framework", "tool", "person", "company", "metric", "belief"];

  $effect(() => {
    if (personaId) { loadData(); loadFidelity(); }
  });

  async function loadFidelity() {
    fidelityLoading = true;
    try {
      fidelity = await api(`/api/fidelity?persona=${personaId}`);
    } catch {
      fidelity = null;
    } finally {
      fidelityLoading = false;
    }
  }

  async function recalcFidelity() {
    recalculating = true;
    try {
      await api("/api/fidelity", {
        method: "POST",
        body: JSON.stringify({ personaId }),
      });
      await loadFidelity();
      showToast("Score recalcule");
    } catch (e) {
      if (e.status === 429) showToast("Recalcul limite a 1x/heure");
      else showToast("Erreur de recalcul");
    } finally {
      recalculating = false;
    }
  }

  let scoreDelta = $derived.by(() => {
    if (!fidelity?.history || fidelity.history.length < 2) return null;
    const h = fidelity.history;
    const current = h[h.length - 1]?.score_global;
    const previous = h[h.length - 2]?.score_global;
    if (current == null || previous == null) return null;
    return current - previous;
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

<!-- Fidelity Score -->
{#if !fidelityLoading && fidelity?.current}
  {@const cur = fidelity.current}
  <div class="fidelity-section">
    <div class="fidelity-header">
      <span class="fidelity-title">FIDELITE VOCALE</span>
      <div class="fidelity-headline">
        <span class="fidelity-big-score">{cur.score_global}</span>
        {#if scoreDelta != null}
          <span class="fidelity-delta" class:positive={scoreDelta > 2} class:negative={scoreDelta < -2}>
            {scoreDelta > 0 ? "+" : ""}{scoreDelta} pts
          </span>
        {/if}
      </div>
    </div>

    <div class="fidelity-bar-track">
      <div class="fidelity-bar-fill" style="width: {cur.score_global}%"></div>
    </div>

    {#if cur.scores_by_theme?.length > 0}
      <div class="fidelity-themes">
        {#each cur.scores_by_theme as t}
          <div class="fidelity-theme">
            <span class="fidelity-theme-name">{t.theme}</span>
            <div class="fidelity-theme-bar">
              <div class="fidelity-theme-fill" style="width: {t.score}%"></div>
            </div>
            <span class="fidelity-theme-score">{t.score}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="fidelity-meta">
      <span>{fidelity.chunk_count} posts</span>
      <span>·</span>
      <span>{getRelativeTime(cur.calculated_at)}</span>
      <button class="fidelity-recalc" onclick={recalcFidelity} disabled={recalculating}>
        {recalculating ? "..." : "Recalculer"}
      </button>
    </div>

    {#if fidelity.history.length > 2}
      {@const pts = fidelity.history}
      {@const maxS = Math.max(...pts.map(p => p.score_global), 1)}
      {@const minS = Math.min(...pts.map(p => p.score_global), 0)}
      {@const range = Math.max(maxS - minS, 1)}
      <div class="fidelity-sparkline">
        <svg viewBox="0 0 200 40" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="var(--accent)"
            stroke-width="1.5"
            points={pts.map((p, i) =>
              `${(i / (pts.length - 1)) * 200},${40 - ((p.score_global - minS) / range) * 36}`
            ).join(" ")}
          />
          {#each pts as p, i}
            <circle
              cx="{(i / (pts.length - 1)) * 200}"
              cy="{40 - ((p.score_global - minS) / range) * 36}"
              r="2" fill="var(--accent)"
            />
          {/each}
        </svg>
      </div>
    {/if}

    {#if cur.low_confidence}
      <div class="fidelity-warning">Score base sur peu de donnees — precision limitee</div>
    {/if}
  </div>
{:else if !fidelityLoading && fidelity && !fidelity.can_calculate}
  <div class="fidelity-section fidelity-empty">
    <span class="fidelity-title">FIDELITE VOCALE</span>
    <p>Pas assez de posts LinkedIn pour calculer (minimum 3).</p>
  </div>
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
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--border);
    background: rgba(255,255,255,0.02);
  }
  .intel-ex-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.375rem;
  }
  .intel-ex-step {
    font-size: 0.6875rem;
    color: var(--text-secondary);
  }
  .intel-ex-pct {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .intel-ex-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }
  .intel-ex-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 1.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .intel-ex-labels {
    display: flex;
    justify-content: space-between;
  }
  .intel-ex-labels span {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
    transition: color 0.4s;
  }
  .intel-ex-labels span.done {
    color: var(--accent);
  }
  .intel-ex-done {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.6875rem;
    color: var(--success, #4ade80);
    animation: fadeIn 0.3s ease;
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

  .fidelity-section {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .fidelity-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .fidelity-title {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .fidelity-headline {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }
  .fidelity-big-score {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .fidelity-delta {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .fidelity-delta.positive { color: var(--success); }
  .fidelity-delta.negative { color: var(--error); }
  .fidelity-bar-track {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 0.625rem;
  }
  .fidelity-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.6s ease;
  }
  .fidelity-themes {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .fidelity-theme {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .fidelity-theme-name {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    min-width: 8rem;
    flex-shrink: 0;
  }
  .fidelity-theme-bar {
    flex: 1;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .fidelity-theme-fill {
    height: 100%;
    background: var(--accent);
    opacity: 0.7;
    border-radius: 2px;
    transition: width 0.4s;
  }
  .fidelity-theme-score {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 1.5rem;
    text-align: right;
  }
  .fidelity-meta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.625rem;
    color: var(--text-tertiary);
  }
  .fidelity-recalc {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    padding: 0.125rem 0.375rem;
    font-size: 0.5625rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .fidelity-recalc:hover:not(:disabled) { color: var(--text); border-color: var(--text-tertiary); }
  .fidelity-recalc:disabled { opacity: 0.4; cursor: default; }
  .fidelity-sparkline {
    margin-top: 0.5rem;
    height: 40px;
  }
  .fidelity-sparkline svg {
    width: 100%;
    height: 100%;
  }
  .fidelity-warning {
    font-size: 0.5625rem;
    color: var(--warning);
    margin-top: 0.375rem;
  }
  .fidelity-empty p {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin: 0.375rem 0 0;
  }
</style>
