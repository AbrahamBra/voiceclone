<script>
  // Persistent session audit strip — bottom of the chat page.
  // Running totals for the current conversation: elapsed time, messages,
  // rewrites, drifts, tokens, average cache hit rate. Reset when the parent
  // switches conversation.

  /**
   * @typedef {Object} Totals
   * @property {number} msgCount        bot messages answered
   * @property {number} rewriteCount    messages that triggered a rewrite
   * @property {number} driftCount      messages that triggered fidelity_drift
   * @property {number} inputTokens     cumulative input tokens
   * @property {number} outputTokens    cumulative output tokens
   * @property {number} cacheReadTokens cumulative cached-read input tokens
   * @property {number} ruleFireCount   cumulative rule activations
   */

  let {
    /** @type {Totals} */
    totals = {
      msgCount: 0,
      rewriteCount: 0,
      driftCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      ruleFireCount: 0,
    },
    /** ms timestamp of first message in the current conversation, or null */
    sessionStart = null,
  } = $props();

  // Wall-clock tick for the elapsed counter. Only runs when a session exists.
  let now = $state(Date.now());
  let tickId;
  $effect(() => {
    if (sessionStart) {
      now = Date.now();
      tickId = setInterval(() => { now = Date.now(); }, 1000);
      return () => clearInterval(tickId);
    }
  });

  function fmtDuration(ms) {
    if (!ms || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h${String(m % 60).padStart(2, "0")}`;
    if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}`;
    return `${s}s`;
  }

  function fmtTokens(n) {
    if (!n) return "0";
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1)}k`;
  }

  let elapsed = $derived(sessionStart ? now - sessionStart : 0);
  let totalTokens = $derived(totals.inputTokens + totals.outputTokens);
  let cacheRate = $derived(
    totals.inputTokens > 0
      ? Math.round((totals.cacheReadTokens / totals.inputTokens) * 100)
      : null
  );
  let anyActivity = $derived(totals.msgCount > 0 || !!sessionStart);

  // Narrative footer: short human-readable sentence that updates live.
  // Describes what the pipeline has done this session in plain French.
  // Screenshot-friendly, onboarding-friendly.
  let narrative = $derived(buildNarrative(totals, cacheRate));

  function buildNarrative(t, cache) {
    if (!t || t.msgCount === 0) {
      return "session au repos — envoie un message pour démarrer.";
    }

    const plural = (n, s, p) => `${n} ${n > 1 ? p : s}`;
    const parts = [];

    // Primary sentence: activity
    parts.push(plural(t.msgCount, "message", "messages"));

    // Rewrites + drifts narrative
    if (t.rewriteCount === 0 && t.driftCount === 0) {
      parts.push("aucune dérive, fidélité préservée");
    } else if (t.rewriteCount > 0 && t.driftCount === 0) {
      parts.push(`${plural(t.rewriteCount, "réécriture", "réécritures")} — voix récupérée à chaque fois`);
    } else if (t.driftCount > 0 && t.rewriteCount >= t.driftCount) {
      parts.push(`${plural(t.driftCount, "dérive", "dérives")} détectée${t.driftCount > 1 ? "s" : ""}, rattrapée${t.driftCount > 1 ? "s" : ""} par réécriture`);
    } else if (t.driftCount > 0) {
      parts.push(`${plural(t.driftCount, "dérive non résolue", "dérives non résolues")} — calibration à affiner`);
    }

    // Cache efficiency
    if (cache !== null && cache >= 80) {
      const saved = Math.round(t.cacheReadTokens / 1000);
      if (saved > 0) {
        parts.push(`cache ${cache}% — ${saved}k tokens économisés`);
      }
    }

    return parts.join(" · ") + ".";
  }
</script>

<section class="audit-wrap" class:idle={!anyActivity} aria-label="Totaux de session">
  <div class="audit-strip mono" role="status">
    <span class="cell cell-primary">
      <span class="k">session</span>
      <span class="v">{fmtDuration(elapsed)}</span>
    </span>
    <span class="sep">·</span>

    <span class="cell">
      <span class="k">msg</span>
      <span class="v">{totals.msgCount}</span>
    </span>
    <span class="sep">·</span>

    <span class="cell" class:hot={totals.rewriteCount > 0}>
      <span class="k">réécritures</span>
      <span class="v">{totals.rewriteCount}</span>
    </span>
    <span class="sep">·</span>

    <span class="cell" class:hot={totals.driftCount > 0}>
      <span class="k">dérives</span>
      <span class="v">{totals.driftCount}</span>
    </span>
    <span class="sep">·</span>

    <span class="cell">
      <span class="k">règles</span>
      <span class="v">{totals.ruleFireCount}</span>
    </span>
    <span class="sep">·</span>

    <span class="cell">
      <span class="k">tokens</span>
      <span class="v">{fmtTokens(totalTokens)}</span>
    </span>
    <span class="sep">·</span>

    <span class="cell">
      <span class="k">cache</span>
      <span class="v">{cacheRate === null ? "—" : `${cacheRate}%`}</span>
    </span>

    {#if anyActivity}
      <span class="pulse" aria-hidden="true"></span>
    {/if}
  </div>

  <p class="audit-narrative" aria-live="polite">{narrative}</p>
</section>

<style>
  .audit-wrap {
    background: var(--paper-subtle);
    border-top: 1px solid var(--rule-strong);
    display: flex;
    flex-direction: column;
  }

  .audit-strip {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 16px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    white-space: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    position: relative;
  }
  .audit-strip::-webkit-scrollbar { display: none; }

  .audit-wrap.idle .v { color: var(--ink-20); }

  /* Narrative footer — human sentence below the mono strip.
     Screenshot-friendly summary of what the pipeline has done. */
  .audit-narrative {
    margin: 0;
    padding: 4px 16px 8px;
    font-family: var(--font);
    font-size: 12.5px;
    line-height: var(--lh-snug);
    color: var(--ink-70);
    font-style: italic;
    border-top: 1px dashed var(--rule);
  }
  .audit-wrap.idle .audit-narrative {
    color: var(--ink-40);
  }

  .cell {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .cell .k {
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9px;
  }
  .cell .v {
    color: var(--ink);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cell-primary .v {
    color: var(--ink);
  }
  .cell.hot .v {
    color: var(--vermillon);
  }

  .sep {
    color: var(--ink-20);
    user-select: none;
  }

  .pulse {
    margin-left: auto;
    width: 6px;
    height: 6px;
    background: var(--vermillon);
    animation: audit-pulse 1.6s linear infinite;
    flex-shrink: 0;
  }
  @keyframes audit-pulse {
    0%, 70%, 100% { opacity: 1; }
    85% { opacity: 0.2; }
  }

  @media (max-width: 640px) {
    .audit-strip { font-size: 10px; padding: 6px 10px; gap: 6px; }
    .cell .k { font-size: 8.5px; }
  }
</style>
