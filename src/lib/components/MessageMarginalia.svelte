<script>
  // Right-margin marginalia for a bot message — the Phase C move.
  // Shows the pipeline's annotations next to the text instead of under it.
  // Renders blocks: stamp, timing, fidelity, rules active, style, diff toggle.

  import StyleFingerprint from "./StyleFingerprint.svelte";
  import { ruleLabelFor } from "$lib/rule-catalog.js";

  let {
    message,
    stamp = "",         // "14:42:17"
    seq = null,
    prevFidelity = null, // cosine from previous bot message, for Δ
    sourceStyle = null,  // source_style baseline for the ghost overlay
    showDiff = $bindable(false),
  } = $props();

  function fmtMs(ms) {
    if (!ms && ms !== 0) return null;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
  function fmtNum(n, d = 2) {
    if (typeof n !== "number" || Number.isNaN(n)) return "—";
    return n.toFixed(d);
  }
  function fmtTokens(t) {
    if (!t) return null;
    return `${t.input ?? 0}→${t.output ?? 0}t`;
  }
  function fmtCacheRate(t) {
    if (!t || !t.input) return null;
    return `${Math.round(((t.cache_read ?? 0) / t.input) * 100)}%`;
  }

  let hasTiming = $derived(!!message?.timing?.totalMs);
  let hasFidelity = $derived(typeof message?.fidelity?.similarity === "number");
  let hasRules = $derived(Array.isArray(message?.violations) && message.violations.length > 0);
  let hasStyle = $derived(!!message?.live_style);
  let hasDiff = $derived(!!(message?.rewritten && message?.original));

  let fidelityDelta = $derived(
    hasFidelity && typeof prevFidelity === "number"
      ? message.fidelity.similarity - prevFidelity
      : null
  );

  let seqStr = $derived(seq !== null && seq !== undefined ? String(seq).padStart(3, "0") : null);
  let modelShort = $derived(
    message?.model ? message.model.replace(/^claude-/, "").replace(/-\d{8}$/, "") : null
  );
</script>

<aside class="marg" aria-label="Annotations du message">
  <header class="marg-head mono">
    <span class="marg-tag">bot{seqStr ? `:${seqStr}` : ""}</span>
    {#if stamp}<span class="marg-time">{stamp}</span>{/if}
    {#if modelShort}<span class="marg-model">{modelShort}</span>{/if}
  </header>

  {#if hasTiming || message?.tokens}
    <section class="marg-block">
      <div class="marg-label mono">délai</div>
      <div class="marg-row mono">
        {#if hasTiming}
          <span>{fmtMs(message.timing.totalMs)}</span>
          {#if message.timing.generateMs && message.timing.generateMs !== message.timing.totalMs}
            <span class="marg-sub">(gén. {fmtMs(message.timing.generateMs)})</span>
          {/if}
        {/if}
      </div>
      {#if message?.tokens}
        <div class="marg-row mono">
          <span>{fmtTokens(message.tokens)}</span>
          {#if fmtCacheRate(message.tokens)}
            <span class="marg-sub">cache {fmtCacheRate(message.tokens)}</span>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#if hasFidelity}
    <section class="marg-block">
      <div class="marg-label mono">fidélité</div>
      <div class="marg-row marg-row-big mono">
        <span class="marg-big">{fmtNum(message.fidelity.similarity, 3)}</span>
        {#if fidelityDelta !== null}
          <span class="marg-delta" class:neg={fidelityDelta < 0}>
            Δ {fidelityDelta >= 0 ? "+" : ""}{fidelityDelta.toFixed(3)}
          </span>
        {/if}
      </div>
      {#if typeof message.fidelity.threshold === "number"}
        <div class="marg-sub mono">seuil {message.fidelity.threshold.toFixed(3)}</div>
      {/if}
    </section>
  {/if}

  {#if hasRules}
    <section class="marg-block">
      <div class="marg-label mono">règles / {message.violations.length}</div>
      <ul class="marg-rules">
        {#each message.violations as v}
          <li class="marg-rule severity-{v.severity || 'light'}">
            <span class="marg-rule-tick" aria-hidden="true">●</span>
            <span class="marg-rule-name mono">{ruleLabelFor(v.type)}</span>
            {#if v.detail && v.detail !== "—"}
              <span class="marg-rule-detail">{v.detail}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if hasStyle}
    <section class="marg-block marg-style">
      <div class="marg-label mono">style</div>
      <div class="marg-style-body">
        <div class="marg-grid mono">
          <span class="marg-k">ttr</span><span class="marg-v">{fmtNum(message.live_style.ttr, 2)}</span>
          <span class="marg-k">kurt</span><span class="marg-v">{fmtNum(message.live_style.kurtosis, 2)}</span>
          <span class="marg-k">q</span><span class="marg-v">{fmtNum(message.live_style.questionRatio, 2)}</span>
          <span class="marg-k">sig</span><span class="marg-v">{fmtNum(message.live_style.signaturePresence, 2)}</span>
          <span class="marg-k">int</span><span class="marg-v">{message.live_style.forbiddenHits ?? 0}</span>
          <span class="marg-k">lon</span><span class="marg-v">{fmtNum(message.live_style.avgSentenceLen, 0)}</span>
        </div>
        <div class="marg-fp" title="Ce message vs. signature source">
          <StyleFingerprint
            draft={message.live_style}
            source={sourceStyle}
            size={54}
            strokeWidth={1}
          />
        </div>
      </div>
    </section>
  {/if}

  {#if hasDiff}
    <section class="marg-block marg-diff">
      <button
        class="marg-diff-toggle mono"
        class:open={showDiff}
        onclick={() => showDiff = !showDiff}
        aria-expanded={showDiff}
      >
        <span class="marg-diff-arrow">{showDiff ? "▾" : "▸"}</span>
        <span>{showDiff ? "cacher" : "voir"} passe 1</span>
        <span class="marg-diff-badge">remplacée</span>
      </button>
    </section>
  {/if}

  {#if message?.rewritten && !hasDiff}
    <section class="marg-block">
      <span class="marg-rewrite-badge mono">réécrit</span>
    </section>
  {/if}
</aside>

<style>
  .marg {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    line-height: var(--lh-snug);
  }

  .marg-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding-bottom: 0;
    border-bottom: none;
    flex: 0 0 auto;
  }
  .marg-tag {
    color: var(--ink);
    font-weight: var(--fw-semi);
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .marg-time {
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }
  .marg-model {
    color: var(--ink-30);
    font-size: 10px;
    margin-left: auto;
  }

  .marg-block {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 4px;
  }
  .marg-label {
    font-size: 8.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .marg-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .marg-row-big { align-items: baseline; }
  .marg-big {
    font-size: 13px;
    font-weight: var(--fw-medium);
    color: var(--ink);
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .marg-sub {
    color: var(--ink-40);
    font-size: 9.5px;
  }
  .marg-delta {
    color: #2d7a3e;
    font-size: 10px;
  }
  .marg-delta.neg { color: var(--vermillon); }

  /* ── Rules list ── */
  .marg-rules {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .marg-rule {
    display: grid;
    grid-template-columns: 10px auto 1fr;
    gap: 5px;
    align-items: baseline;
    font-size: 10.5px;
    color: var(--ink-70);
  }
  .marg-rule-tick {
    color: var(--ink-20);
    font-size: 8px;
    line-height: 1;
  }
  .marg-rule.severity-hard .marg-rule-tick,
  .marg-rule.severity-strong .marg-rule-tick {
    color: var(--vermillon);
  }
  .marg-rule.severity-hard .marg-rule-name,
  .marg-rule.severity-strong .marg-rule-name {
    color: var(--vermillon);
    font-weight: var(--fw-semi);
  }
  .marg-rule.severity-light .marg-rule-name {
    color: var(--ink-70);
  }
  .marg-rule-detail {
    color: var(--ink-40);
    font-size: 9.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 2 / -1;
  }

  /* ── Style block: numbers grid + mini fingerprint ── */
  .marg-style-body {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: center;
  }
  .marg-fp {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    flex-shrink: 0;
  }

  .marg-grid {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 2px 8px;
    align-items: baseline;
    font-size: 10.5px;
  }
  .marg-k {
    color: var(--ink-40);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .marg-v {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* ── Diff toggle ── */
  .marg-diff-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 2px 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-70);
    text-align: left;
    transition: color var(--dur-fast) var(--ease);
  }
  .marg-diff-toggle:hover, .marg-diff-toggle.open {
    color: var(--vermillon);
  }
  .marg-diff-arrow {
    color: var(--vermillon);
    font-size: 9px;
    width: 10px;
  }
  .marg-diff-badge {
    margin-left: auto;
    font-size: 8.5px;
    color: var(--vermillon);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid var(--vermillon);
    padding: 1px 4px;
  }

  .marg-rewrite-badge {
    display: inline-block;
    font-size: 8.5px;
    color: var(--vermillon);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid var(--vermillon);
    padding: 1px 5px;
    align-self: flex-start;
  }

  /* Style block: masque la grille détaillée, garde le fingerprint */
  .marg-style .marg-grid { display: none; }
  .marg-style-body { gap: 4px; }
  .marg-fp { transform: scale(0.75); transform-origin: left center; }

  /* Règles : rangée horizontale scrollable */
  .marg-rules {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 3px 8px;
    max-height: 40px;
    overflow-y: auto;
  }
  .marg-rule { grid-template-columns: 8px auto; }
  .marg-rule-detail { display: none; }
</style>
