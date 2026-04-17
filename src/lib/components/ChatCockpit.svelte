<script>
  // Cockpit header for the chat page.
  // Always-on readings: collapse_idx, fidelity, session-level rule count.
  // Hover on any metric reveals its mini-decomposition.

  let {
    personaName = "",
    personaAvatar = "?",
    scenario = "",
    // Live readings — parent page computes these from fidelity API + last SSE done event
    collapseIdx = null,     // number 0..100 or null if unknown
    fidelity = null,        // number 0..1 or null
    breakdown = null,       // { ttr, kurtosis, questionRatio, signaturePresence, forbiddenHits, avgSentenceLen }
    // UI slots
    rulesActiveCount = 0,
    rulesPanelOpen = false,
    feedbackOpen = false,
    settingsOpen = false,
    sidebarOpen = false,
    // Callbacks
    onBack,
    onToggleSidebar,
    onToggleRules,
    onToggleFeedback,
    onToggleSettings,
  } = $props();

  function fmt(n, d = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toFixed(d);
  }

  // Fidelity threshold line (matches lib/fidelity.js default)
  const FIDELITY_THRESHOLD = 0.72;
  let fidelityState = $derived(
    fidelity === null ? "unknown" :
    fidelity >= FIDELITY_THRESHOLD ? "ok" : "drift"
  );

  let collapseState = $derived(
    collapseIdx === null ? "unknown" :
    collapseIdx >= 70 ? "ok" :
    collapseIdx >= 50 ? "warn" : "bad"
  );
</script>

<header class="cockpit">
  <!-- Left cluster — identity -->
  <div class="left">
    <button class="icon-btn mobile-menu" onclick={() => onToggleSidebar?.()} aria-label="Conversations">☰</button>
    <button class="icon-btn back" onclick={() => onBack?.()} aria-label="Retour">←</button>
    <div class="id">
      <span class="avatar">{personaAvatar}</span>
      <div class="id-text">
        <span class="pname">{personaName}</span>
        {#if scenario}
          <span class="scenario mono">{scenario}</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Center cluster — live readings -->
  <div class="gauges" role="group" aria-label="Live pipeline readings">
    <div
      class="gauge"
      data-state={collapseState}
      tabindex="0"
      aria-label="Collapse index: {fmt(collapseIdx, 1)}"
    >
      <span class="g-key">collapse</span>
      <span class="g-val mono">{fmt(collapseIdx, 1)}</span>
      <div class="tip" role="tooltip">
        <div class="tip-head">collapse index</div>
        <div class="tip-row"><span>style preservation score 0–100</span></div>
        <div class="tip-row"><span>≥ 70</span><span class="tip-ok">healthy</span></div>
        <div class="tip-row"><span>50–70</span><span class="tip-warn">warn</span></div>
        <div class="tip-row"><span>&lt; 50</span><span class="tip-bad">collapsed</span></div>
      </div>
    </div>

    <div
      class="gauge"
      data-state={fidelityState}
      tabindex="0"
      aria-label="Fidelity cosine: {fmt(fidelity, 3)}, threshold {FIDELITY_THRESHOLD}"
    >
      <span class="g-key">fidelity</span>
      <span class="g-val mono">{fmt(fidelity, 3)}</span>
      <div class="tip" role="tooltip">
        <div class="tip-head">fidelity · cosine to source corpus</div>
        {#if breakdown}
          <div class="tip-row"><span>ttr</span><span class="mono">{fmt(breakdown.ttr, 2)}</span></div>
          <div class="tip-row"><span>kurtosis</span><span class="mono">{fmt(breakdown.kurtosis, 2)}</span></div>
          <div class="tip-row"><span>q ratio</span><span class="mono">{fmt(breakdown.questionRatio, 2)}</span></div>
          <div class="tip-row"><span>signature</span><span class="mono">{fmt(breakdown.signaturePresence, 2)}</span></div>
          <div class="tip-row"><span>forbidden</span><span class="mono">{breakdown.forbiddenHits ?? 0}</span></div>
          <div class="tip-row"><span>avg sent.</span><span class="mono">{fmt(breakdown.avgSentenceLen, 0)}</span></div>
        {:else}
          <div class="tip-row"><span>no breakdown yet — send a message</span></div>
        {/if}
        <div class="tip-row tip-thresh"><span>threshold</span><span class="mono">{FIDELITY_THRESHOLD.toFixed(3)}</span></div>
      </div>
    </div>

    <div
      class="gauge gauge-rules"
      data-state={rulesActiveCount > 0 ? "fired" : "idle"}
      aria-label="Rules fired: {rulesActiveCount}"
    >
      <span class="g-key">rules</span>
      <span class="g-val mono">{rulesActiveCount}</span>
    </div>
  </div>

  <!-- Right cluster — actions -->
  <div class="right">
    <button
      class="tab-btn mono"
      class:active={rulesPanelOpen}
      onclick={() => onToggleRules?.()}
      aria-pressed={rulesPanelOpen}
    >rules</button>
    <button
      class="tab-btn mono"
      class:active={feedbackOpen}
      onclick={() => onToggleFeedback?.()}
      aria-pressed={feedbackOpen}
    >feedback</button>
    <button
      class="tab-btn mono"
      class:active={settingsOpen}
      onclick={() => onToggleSettings?.()}
      aria-pressed={settingsOpen}
    >settings</button>
  </div>
</header>

<style>
  .cockpit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    background: var(--paper);
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    position: relative;
  }

  .left, .right { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .right { justify-content: flex-end; }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 6px;
    transition: color 0.08s linear;
  }
  .icon-btn:hover { color: var(--ink); }
  .mobile-menu { display: none; }

  .id { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .avatar {
    width: 22px; height: 22px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    display: inline-flex; align-items: center; justify-content: center;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--ink-70);
  }
  .id-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .pname {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.005em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .scenario {
    font-size: 10px;
    color: var(--ink-40);
    text-transform: lowercase;
  }

  /* ───── Gauges ───── */
  .gauges {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
  }
  .gauge {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 10px;
    border-right: 1px solid var(--rule-strong);
    cursor: default;
  }
  .gauge:last-child { border-right: none; }
  .g-key {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40);
  }
  .g-val {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    letter-spacing: -0.01em;
  }

  /* State colors */
  .gauge[data-state="drift"] .g-val,
  .gauge[data-state="bad"] .g-val,
  .gauge[data-state="fired"] .g-val { color: var(--vermillon); }
  .gauge[data-state="warn"] .g-val { color: #b87300; }
  .gauge[data-state="unknown"] .g-val,
  .gauge[data-state="idle"] .g-val { color: var(--ink-40); }

  /* Hover tooltip */
  .tip {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    min-width: 220px;
    background: var(--ink);
    color: var(--paper);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0;
    pointer-events: none;
    z-index: 20;
    transition: opacity 0.1s linear, transform 0.1s linear;
    box-shadow: 0 2px 8px rgba(20, 20, 26, 0.15);
  }
  .tip::before {
    content: "";
    position: absolute;
    top: -5px; left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-bottom-color: var(--ink);
    border-top: 0;
  }
  .gauge:hover .tip,
  .gauge:focus-within .tip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }
  .tip-head {
    color: var(--paper);
    font-weight: 600;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(245, 242, 236, 0.12);
  }
  .tip-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
    color: rgba(245, 242, 236, 0.72);
  }
  .tip-row .mono { color: var(--paper); }
  .tip-ok { color: #9be38d; }
  .tip-warn { color: #f0b050; }
  .tip-bad { color: #ef7666; }
  .tip-thresh {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(245, 242, 236, 0.12);
  }

  /* ───── Right tabs ───── */
  .tab-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color 0.08s linear, border-color 0.08s linear, background 0.08s linear;
  }
  .tab-btn:hover { color: var(--ink); border-color: var(--ink-40); }
  .tab-btn.active {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }

  /* Rules gauge: when fired, flash vermillon */
  .gauge-rules[data-state="fired"] .g-val {
    color: var(--vermillon);
    font-weight: 700;
  }

  @media (max-width: 768px) {
    .mobile-menu { display: block; }
    .cockpit { grid-template-columns: auto 1fr auto; padding: 6px 10px; gap: 8px; }
    .scenario { display: none; }
    .icon-btn {
      min-width: var(--touch-min);
      min-height: var(--touch-min);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tab-btn {
      padding: 10px 10px;
      font-size: 10px;
      min-height: var(--touch-min);
      min-width: var(--touch-min);
    }
    .gauge {
      padding: 10px 10px;
      min-height: var(--touch-min);
    }
  }
  @media (max-width: 560px) {
    .gauges { order: 3; grid-column: 1 / -1; justify-content: center; }
    .cockpit { grid-template-columns: auto 1fr auto; }
  }
</style>
