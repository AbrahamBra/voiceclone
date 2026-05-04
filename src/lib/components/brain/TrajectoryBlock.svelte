<script>
  // Bloc Trajectoire : 2 metrics (corrections ↘, autonomie ↗) avec sparklines SVG
  // + phrase pédago. Pour la zone construction du cockpit V2.
  //
  // Props :
  //   trajectory : { correction_rate: { current_value, delta, series }, autonomy_pct: {...} }
  //   loading : bool

  let {
    trajectory = null,
    loading = false,
  } = $props();

  function pointsFor(series, height = 28, width = 80) {
    if (!series || series.length === 0) return "";
    const max = Math.max(...series, 1);
    const min = Math.min(...series, 0);
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / (series.length - 1 || 1)) * width;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  let pedagogy = $derived(() => {
    if (!trajectory) return "";
    const aut = trajectory.autonomy_pct;
    if (!aut) return "";
    const currentPct = Math.round((aut.current_value || 0) * 100);
    const oldestPct = Math.round((aut.series?.[0] || 0) * 100);
    const weeks = aut.series?.length || 8;
    return `Ton clone produit ${currentPct}% de messages sans correction. Il y a ${weeks - 1} sem. : ${oldestPct}%.`;
  });
</script>

<div class="block">
  <div class="label">Trajectoire</div>

  {#if loading}
    <div class="loading">Chargement…</div>
  {:else if trajectory}
    <div class="metric">
      <div class="metric-text">
        <div class="caption">Corrections setters / sem.</div>
        <div class="value">
          {trajectory.correction_rate.current_value}
          {trajectory.correction_rate.delta < 0 ? "↘" : trajectory.correction_rate.delta > 0 ? "↗" : "→"}
        </div>
      </div>
      <svg width="80" height="28" viewBox="0 0 80 28" class="spark">
        <polyline points={pointsFor(trajectory.correction_rate.series)} stroke="#222" stroke-width="1.5" fill="none"/>
      </svg>
    </div>

    <div class="metric">
      <div class="metric-text">
        <div class="caption">Autonomie msg.</div>
        <div class="value">
          {Math.round(trajectory.autonomy_pct.current_value * 100)}%
          {trajectory.autonomy_pct.delta > 0 ? "↗" : trajectory.autonomy_pct.delta < 0 ? "↘" : "→"}
        </div>
      </div>
      <svg width="80" height="28" viewBox="0 0 80 28" class="spark">
        <polyline points={pointsFor(trajectory.autonomy_pct.series)} stroke="#c45339" stroke-width="1.5" fill="none"/>
      </svg>
    </div>

    <div class="pedagogy">{pedagogy()}</div>
  {:else}
    <div class="loading">—</div>
  {/if}
</div>

<style>
  .block {
    padding: 12px 14px;
    border-bottom: 1px solid var(--rule);
  }
  .label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }
  .metric {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 4px 0;
  }
  .caption {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-40);
  }
  .value {
    font-family: var(--font, Georgia, serif);
    font-size: 18px;
    line-height: 1;
    margin-top: 2px;
  }
  .spark { opacity: 0.7; }
  .pedagogy {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-40);
    margin-top: 8px;
    font-style: italic;
    line-height: 1.4;
  }
  .loading { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); }
</style>
