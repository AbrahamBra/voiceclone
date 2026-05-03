<script>
  // BatchBar — toolbar filter + slider + matched count + boutons batch.
  // Callback-driven : parent owne `filters`, on émet onFilterChange à chaque
  // changement local. Pas de bind:filters.
  //
  // Bonus serendipity : micro-histogramme cumulatif aligné au slider, pour
  // visualiser "où vivent les props" et choisir un seuil informé.
  //
  // Buckets verrouillés par l'endpoint distribution :
  //   [1.00, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50]

  let {
    filters = { target_kind: null, confidence_min: 0.85 },
    distribution = null,        // { all: [[1.00, n], …], hard_rules: […], … }
    onFilterChange = () => {},
    onBatchAccept = () => {},
    onBatchReject = () => {},
  } = $props();

  const KIND_OPTIONS = [
    { value: null, label: "toutes" },
    { value: "hard_rules", label: "hard_rules" },
    { value: "icp_patterns", label: "icp_patterns" },
    { value: "process", label: "process" },
    { value: "templates", label: "templates" },
    { value: "errors", label: "errors" },
    { value: "scoring", label: "scoring" },
    { value: "identity", label: "identity" },
    { value: "custom", label: "custom" },
  ];

  // Distribution pour le kind actif (ou 'all').
  let activeKindBuckets = $derived(() => {
    if (!distribution) return null;
    return distribution[filters.target_kind || "all"] || distribution.all || null;
  });

  // matched = bucket avec bucket_min <= confidence_min, en prenant le plus
  // grand bucket_min qui satisfait. La distribution est triée DESC :
  // [1.00, 0.95, …, 0.50]. On cherche le premier bucket dont min <= conf_min.
  let matched = $derived(() => {
    const b = activeKindBuckets();
    if (!b) return 0;
    const found = b.find(([min]) => min <= filters.confidence_min + 1e-9);
    return found ? found[1] : 0;
  });

  // Histogramme : count incrémental par bucket (pas cumulatif, pour voir la densité).
  // bucket[i] - bucket[i-1] dans l'ordre DESC du tableau (ou inverser).
  let histogramBars = $derived(() => {
    const b = activeKindBuckets();
    if (!b) return [];
    // b en ordre DESC. Différentiel : bucket count à `0.95` = total@0.95 - total@1.00 (props @ [0.95, 1.00))
    const bars = [];
    for (let i = 0; i < b.length; i++) {
      const [min, cum] = b[i];
      const cumPrev = i === 0 ? 0 : b[i - 1][1];
      bars.push({ min, density: cum - cumPrev });
    }
    // bars : [@1.00 = density(>=1.00), @0.95 = density([0.95, 1.00)), …, @0.50 = density([0.50, 0.55))]
    // Pour l'affichage gauche-droite 0.50 → 1.00, on inverse :
    return bars.slice().reverse();
  });

  let maxDensity = $derived(() => {
    const bars = histogramBars();
    return Math.max(1, ...bars.map(b => b.density));
  });

  function handleKindChange(e) {
    const v = e.target.value === "" ? null : e.target.value;
    onFilterChange({ ...filters, target_kind: v });
  }

  function handleConfChange(e) {
    const v = Math.round(Number(e.target.value) * 100) / 100;
    onFilterChange({ ...filters, confidence_min: v });
  }
</script>

<div class="batch-wrap">
  <div class="batch-bar">
    <div class="filter-group">
      <span class="label">section</span>
      <select value={filters.target_kind ?? ""} onchange={handleKindChange}>
        {#each KIND_OPTIONS as opt}
          {@const total = distribution?.[opt.value || "all"]?.find(b => b[0] <= 0.50 + 1e-9)?.[1] ?? null}
          <option value={opt.value ?? ""}>{opt.label}{total !== null ? ` (${total})` : ""}</option>
        {/each}
      </select>
    </div>

    <div class="filter-group">
      <span class="label">confidence ≥</span>
      <input
        type="range"
        min="0.50"
        max="1.00"
        step="0.05"
        value={filters.confidence_min}
        oninput={handleConfChange}
      />
      <span class="conf-val">{filters.confidence_min.toFixed(2)}</span>
    </div>

    <div class="matched"><strong>{matched()}</strong> propositions matchent</div>
    <div class="spacer"></div>
    <button type="button" class="batch-btn danger" onclick={onBatchReject} disabled={matched() === 0}>
      rejeter ({matched()})
    </button>
    <button type="button" class="batch-btn primary" onclick={onBatchAccept} disabled={matched() === 0}>
      ✓ accepter ({matched()})
    </button>
  </div>

  {#if histogramBars().length}
    <div class="histo" aria-label="Distribution des propositions par confidence">
      {#each histogramBars() as bar}
        {@const active = bar.min >= filters.confidence_min - 1e-9}
        <div class="bar-cell" title="{bar.min.toFixed(2)} : {bar.density} props">
          <div
            class="bar"
            class:active
            style="height: {Math.round((bar.density / maxDensity()) * 100)}%"
          ></div>
          <span class="bar-label">{bar.min.toFixed(2)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .batch-wrap { margin-top: 14px; }

  .batch-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: var(--paper-subtle, #ecebe4);
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    flex-wrap: wrap;
  }
  .label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .filter-group { display: flex; align-items: center; gap: 8px; }
  select, input[type=range] {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 8px;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    border-radius: 2px;
    color: var(--ink);
  }
  input[type=range] { width: 140px; padding: 0; }
  .conf-val {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    min-width: 36px;
  }
  .matched {
    font-family: var(--font, Georgia, serif);
    font-size: 13px;
    color: var(--ink-70);
    border-left: 1px solid var(--rule-strong);
    padding-left: 14px;
  }
  .matched strong { font-weight: 600; color: var(--ink); }
  .spacer { flex: 1 1 auto; }

  .batch-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 8px 14px;
    border-radius: 2px;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--ink);
  }
  .batch-btn:hover:not(:disabled) { background: var(--paper); }
  .batch-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .batch-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .batch-btn.danger { color: var(--vermillon-dim, #b43b28); border-color: var(--vermillon-dim, #b43b28); }
  .batch-btn.danger:hover:not(:disabled) {
    background: var(--vermillon);
    color: var(--paper);
    border-color: var(--vermillon);
  }

  .histo {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 36px;
    padding: 6px 16px 0;
    margin-top: 4px;
  }
  .bar-cell {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    min-height: 28px;
  }
  .bar {
    width: 100%;
    background: var(--ink-30, #aaa);
    transition: background 0.1s, height 0.15s;
    min-height: 1px;
    align-self: stretch;
    margin-top: auto;
  }
  .bar.active { background: var(--vermillon); }
  .bar-label {
    font-family: var(--font-mono);
    font-size: 8.5px;
    color: var(--ink-40);
    margin-top: 2px;
    line-height: 1;
  }

  @media (max-width: 700px) {
    .batch-bar { gap: 10px; padding: 10px; }
    input[type=range] { width: 100px; }
    .matched { border-left: none; padding-left: 0; }
  }
</style>
