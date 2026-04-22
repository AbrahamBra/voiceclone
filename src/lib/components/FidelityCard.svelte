<script>
  import { api } from "$lib/api.js";
  import { getRelativeTime } from "$lib/utils.js";
  import { showToast } from "$lib/stores/ui.js";

  let { personaId, reloadToken = 0, onAskAddPosts } = $props();

  let fidelity = $state(null);
  let fidelityLoading = $state(true);
  let recalculating = $state(false);

  let scoreDelta = $derived.by(() => {
    if (!fidelity?.history || fidelity.history.length < 2) return null;
    const h = fidelity.history;
    const current = h[h.length - 1]?.score_global;
    const previous = h[h.length - 2]?.score_global;
    if (current == null || previous == null) return null;
    return current - previous;
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

  $effect(() => {
    // Depend on both personaId and reloadToken so parent can trigger reload
    personaId; reloadToken;
    if (personaId) loadFidelity();
  });
</script>

{#if !fidelityLoading && fidelity?.current}
  {@const cur = fidelity.current}
  <div class="fidelity-section">
    <div class="fidelity-header">
      <div class="fidelity-title-block">
        <span class="fidelity-title">FIDELITE VOCALE</span>
        <span class="fidelity-subtitle">Coherence du clone avec ton style d'ecriture LinkedIn</span>
      </div>
      <div class="fidelity-headline">
        <span class="fidelity-big-score">{cur.score_global}<span class="fidelity-score-unit">/100</span></span>
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
      <div class="fidelity-themes-label">Fidelite par theme</div>
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
        {#if recalculating}
          <span class="fidelity-spinner" aria-hidden="true"></span>
          Calcul...
        {:else}
          Recalculer
        {/if}
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
      <div class="fidelity-warning">Precision limitee — ajoute plus de posts de reference (ideal : ≥10)</div>
    {/if}
  </div>
{:else if !fidelityLoading && fidelity?.can_calculate}
  <div class="fidelity-section fidelity-empty">
    <span class="fidelity-title">FIDELITE VOCALE</span>
    <p>{fidelity.chunk_count} posts indexes. Lance le premier calcul pour voir le score.</p>
    <button class="fidelity-add-posts" onclick={recalcFidelity} disabled={recalculating}>
      {#if recalculating}
        <span class="fidelity-spinner" aria-hidden="true"></span>
        Calcul en cours...
      {:else}
        Calculer le score
      {/if}
    </button>
  </div>
{:else if !fidelityLoading && fidelity && !fidelity.can_calculate}
  <div class="fidelity-section fidelity-empty">
    <span class="fidelity-title">FIDELITE VOCALE</span>
    <p>Pas assez de posts LinkedIn pour calculer (minimum 3).</p>
    <button class="fidelity-add-posts" onclick={onAskAddPosts}>
      Ajouter des posts de reference
    </button>
  </div>
{/if}

<style>
  .fidelity-section {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .fidelity-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .fidelity-title-block {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }
  .fidelity-title {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .fidelity-subtitle {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }
  .fidelity-score-unit {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    font-weight: var(--fw-regular);
    margin-left: 0.125rem;
  }
  .fidelity-themes-label {
    font-size: 0.5625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
  }
  .fidelity-headline {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }
  .fidelity-big-score {
    font-family: var(--font-mono);
    font-size: var(--fs-data-lg);
    font-weight: var(--fw-medium);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1;
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
    background: var(--rule-strong);
    overflow: hidden;
    margin-bottom: 10px;
  }
  .fidelity-bar-fill {
    height: 100%;
    background: var(--ink);
    transition: width 0.4s linear;
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
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
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
  .fidelity-add-posts {
    margin-top: 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    padding: 0.25rem 0.625rem;
    font-size: 0.6875rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }
  .fidelity-add-posts:hover:not(:disabled) { color: var(--text); border-color: var(--text-tertiary); }
  .fidelity-add-posts:disabled { opacity: 0.6; cursor: default; }
  .fidelity-spinner {
    display: inline-block;
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--border);
    border-top-color: var(--text-secondary);
    border-radius: 50%;
    animation: fidelity-spin 0.8s linear infinite;
  }
  @keyframes fidelity-spin {
    to { transform: rotate(360deg); }
  }
</style>
