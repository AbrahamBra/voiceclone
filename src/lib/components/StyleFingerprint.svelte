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
    label = "",
  } = $props();

  const AXES = [
    { key: "ttr",           short: "ttr" },
    { key: "q",             short: "q" },
    { key: "sig",           short: "sig" },
    { key: "clean",         short: "cln" },
    { key: "len",           short: "len" },
    { key: "kurt",          short: "krt" },
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

<svg
  class="fingerprint"
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  aria-label={label || "Style fingerprint"}
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
</style>
