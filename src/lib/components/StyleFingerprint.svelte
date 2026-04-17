<script>
  // Radial (hexagonal) style fingerprint — one per persona.
  //
  // 6 axes, all normalised to [0..1]:
  //   01 · ttr                (direct, higher = more lexical diversity)
  //   02 · question ratio     (direct)
  //   03 · signature presence (direct, how many signature phrases land)
  //   04 · forbidden cleanliness (1 - clamp(forbiddenHits / 3, 0, 1))
  //   05 · sentence length    (avgSentenceLen mapped [5..30] -> [0..1])
  //   06 · kurtosis           (kurtosis mapped [0..5] -> [0..1], tail richness)
  //
  // Shape is the draft (what the clone currently produces).
  // Optional ghost underlay is the source (what we're aiming at).

  /**
   * @typedef {Object} StyleMetrics
   * @property {number} ttr
   * @property {number} questionRatio
   * @property {number} signaturePresence
   * @property {number} forbiddenHits
   * @property {number} avgSentenceLen
   * @property {number} kurtosis
   */

  let {
    /** @type {StyleMetrics | null} */
    draft = null,
    /** @type {StyleMetrics | null} */
    source = null,
    size = 56,
    strokeWidth = 1.25,
    showLabels = false,
    tooltip = false,
    label = "",
  } = $props();

  const AXES = [
    { key: "ttr",   short: "ttr", label: "diversité lexicale (ttr)" },
    { key: "q",     short: "q",   label: "ratio questions" },
    { key: "sig",   short: "sig", label: "présence signature" },
    { key: "clean", short: "cln", label: "propre (inv. interdits)" },
    { key: "len",   short: "lon", label: "longueur phrase moy." },
    { key: "kurt",  short: "krt", label: "kurtosis (queue)" },
  ];

  function clamp01(v) {
    if (typeof v !== "number" || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function normalise(m) {
    if (!m) return null;
    return {
      ttr:   clamp01(m.ttr),
      q:     clamp01(m.questionRatio),
      sig:   clamp01(m.signaturePresence),
      clean: clamp01(1 - ((m.forbiddenHits ?? 0) / 3)),
      len:   clamp01(((m.avgSentenceLen ?? 0) - 5) / 25),
      kurt:  clamp01((m.kurtosis ?? 0) / 5),
    };
  }

  /** Convert normalized map to SVG polygon points around a hexagon. */
  function polygonPoints(values, radius, cx, cy) {
    if (!values) return "";
    const pts = AXES.map((axis, i) => {
      const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2; // start at top
      const r = radius * values[axis.key];
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return pts.join(" ");
  }

  function axisEndpoints(radius, cx, cy) {
    return AXES.map((axis, i) => {
      const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
      return {
        key: axis.key,
        short: axis.short,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    });
  }

  let cx = $derived(size / 2);
  let cy = $derived(size / 2);
  let radius = $derived(size / 2 - (showLabels ? 14 : 3));
  let draftNorm = $derived(normalise(draft));
  let sourceNorm = $derived(normalise(source));
  let axisPts = $derived(axisEndpoints(radius, cx, cy));
  let draftPoly = $derived(polygonPoints(draftNorm, radius, cx, cy));
  let sourcePoly = $derived(polygonPoints(sourceNorm, radius, cx, cy));
  let hasData = $derived(!!draftNorm);

  // Pre-compute three concentric ring radii (0.33, 0.66, 1.0)
  let rings = $derived([radius * 0.33, radius * 0.66, radius]);
</script>

<span class="fp-host" class:fp-has-tip={tooltip} tabindex={tooltip ? 0 : -1}>
<svg
  class="fingerprint"
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  aria-label={label || "Empreinte stylistique"}
  role="img"
>
  <!-- Grid rings -->
  {#each rings as r}
    <polygon
      points={polygonPoints({ ttr:1, q:1, sig:1, clean:1, len:1, kurt:1 }, r, cx, cy)}
      class="ring"
    />
  {/each}

  <!-- Axes -->
  {#each axisPts as p}
    <line x1={cx} y1={cy} x2={p.x} y2={p.y} class="axis" />
    {#if showLabels}
      <text
        x={p.x + (p.x > cx ? 2 : p.x < cx ? -2 : 0)}
        y={p.y + (p.y > cy ? 8 : p.y < cy ? -3 : 3)}
        class="axis-label"
        text-anchor={p.x > cx + 1 ? "start" : p.x < cx - 1 ? "end" : "middle"}
      >{p.short}</text>
    {/if}
  {/each}

  <!-- Source shape (ghost) -->
  {#if sourceNorm}
    <polygon points={sourcePoly} class="source-shape" />
  {/if}

  <!-- Draft shape -->
  {#if hasData}
    <polygon points={draftPoly} class="draft-shape" />
    {#each AXES as axis, i}
      {@const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2}
      {@const r = radius * draftNorm[axis.key]}
      <circle
        cx={cx + Math.cos(angle) * r}
        cy={cy + Math.sin(angle) * r}
        r="1.4"
        class="draft-point"
      />
    {/each}
  {:else}
    <!-- Empty state: small center dot -->
    <circle cx={cx} cy={cy} r="1.5" class="empty-dot" />
  {/if}
</svg>

{#if tooltip && draftNorm}
  <span class="fp-tip" role="tooltip">
    <span class="fp-tip-head mono">empreinte stylistique</span>
    {#each AXES as axis}
      <span class="fp-tip-row">
        <span class="fp-tip-label">{axis.label}</span>
        <span class="fp-tip-val mono">{(draftNorm[axis.key] * 100).toFixed(0)}%</span>
        {#if sourceNorm}
          <span class="fp-tip-src mono">/{(sourceNorm[axis.key] * 100).toFixed(0)}</span>
        {/if}
      </span>
    {/each}
    {#if sourceNorm}
      <span class="fp-tip-foot mono">brouillon / source</span>
    {/if}
  </span>
{/if}
</span>

<style>
  .fingerprint {
    display: block;
    overflow: visible;
  }

  .ring {
    fill: none;
    stroke: var(--rule-strong);
    stroke-width: 0.6;
  }

  .axis {
    stroke: var(--rule);
    stroke-width: 0.6;
  }

  .axis-label {
    font-family: var(--font-mono);
    font-size: 7px;
    fill: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .source-shape {
    fill: var(--rule-strong);
    stroke: var(--ink-40);
    stroke-width: 0.8;
    stroke-dasharray: 2 2;
    opacity: 0.6;
  }

  .draft-shape {
    fill: color-mix(in srgb, var(--vermillon) 14%, transparent);
    stroke: var(--vermillon);
    stroke-width: var(--fp-stroke, 1.25);
    stroke-linejoin: round;
  }

  .draft-point {
    fill: var(--vermillon);
  }

  .empty-dot {
    fill: var(--ink-20);
  }

  /* ── Hover tooltip ── */
  .fp-host {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .fp-host.fp-has-tip {
    cursor: help;
    outline: none;
  }

  .fp-tip {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    min-width: 200px;
    background: var(--ink);
    color: var(--paper);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    opacity: 0;
    pointer-events: none;
    z-index: 40;
    transition: opacity 0.1s linear, transform 0.1s linear;
    box-shadow: 0 2px 8px rgba(20, 20, 26, 0.15);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fp-tip::before {
    content: "";
    position: absolute;
    top: -5px;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-bottom-color: var(--ink);
    border-top: 0;
  }
  .fp-host:hover .fp-tip,
  .fp-host:focus-visible .fp-tip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }

  .fp-tip-head {
    color: var(--paper);
    font-weight: 600;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(245, 242, 236, 0.12);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 9px;
  }
  .fp-tip-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    align-items: baseline;
    font-size: 10px;
    padding: 1px 0;
    color: rgba(245, 242, 236, 0.72);
  }
  .fp-tip-label { color: rgba(245, 242, 236, 0.7); }
  .fp-tip-val { color: var(--paper); font-variant-numeric: tabular-nums; }
  .fp-tip-src { color: rgba(245, 242, 236, 0.4); font-variant-numeric: tabular-nums; }
  .fp-tip-foot {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(245, 242, 236, 0.12);
    font-size: 8.5px;
    color: rgba(245, 242, 236, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
</style>
