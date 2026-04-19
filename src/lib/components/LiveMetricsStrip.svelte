<script>
  // Compact always-visible strip of style metrics below the chat.
  // Mirrors the landing page's 04/05 panels: exposes what was hidden in the
  // cockpit tooltip. Pulses when values change after each SSE `done` event.

  let {
    breakdown = null,   // { ttr, kurtosis, avgSentenceLen, questionRatio, signaturePresence, forbiddenHits }
    fidelity = null,    // 0..1 cosine
    collapseIdx = null, // 0..100
  } = $props();

  const FIDELITY_THRESHOLD = 0.72;

  function fmt(n, d = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toFixed(d);
  }

  // Animation trigger: bump a key on each meaningful value change. The key drives
  // a CSS class toggle via a $effect that resets after 600ms — single source of truth.
  let pulseKey = $state(0);
  let pulsing = $state(false);
  let lastSig = $state("");

  $effect(() => {
    const sig = JSON.stringify([fidelity, collapseIdx, breakdown]);
    if (sig === lastSig) return;
    lastSig = sig;
    if (pulseKey === 0) { pulseKey = 1; return; } // skip initial mount
    pulsing = true;
    const id = setTimeout(() => { pulsing = false; }, 600);
    return () => clearTimeout(id);
  });

  // Live fidelity state for color (mirror cockpit logic).
  let fidelityState = $derived(
    fidelity === null ? "unknown" :
    fidelity >= FIDELITY_THRESHOLD ? "ok" : "drift"
  );
</script>

<div class="strip" class:pulsing aria-label="Métriques de style en direct">
  <div class="strip-head mono">
    <span class="sh-idx">04</span>
    <span class="sh-name">métriques style</span>
  </div>

  <div class="metric">
    <span class="m-k mono">collapse</span>
    <span class="m-v mono">{fmt(collapseIdx, 0)}</span>
    <span class="m-bar"><span class="m-bar-fill" style="width: {Math.max(0, Math.min(100, collapseIdx ?? 0))}%"></span></span>
  </div>

  {#if breakdown}
    <div class="metric">
      <span class="m-k mono">ttr</span>
      <span class="m-v mono">{fmt(breakdown.ttr, 2)}</span>
      <span class="m-bar"><span class="m-bar-fill" style="width: {Math.max(0, Math.min(100, (breakdown.ttr ?? 0) * 100))}%"></span></span>
    </div>
    <div class="metric">
      <span class="m-k mono">kurtosis</span>
      <span class="m-v mono">{fmt(breakdown.kurtosis, 1)}</span>
      <span class="m-bar"><span class="m-bar-fill" style="width: {Math.max(0, Math.min(100, Math.abs(breakdown.kurtosis ?? 0) * 25))}%"></span></span>
    </div>
    <div class="metric">
      <span class="m-k mono">ratio ?</span>
      <span class="m-v mono">{fmt(breakdown.questionRatio, 2)}</span>
      <span class="m-bar"><span class="m-bar-fill" style="width: {Math.max(0, Math.min(100, (breakdown.questionRatio ?? 0) * 200))}%"></span></span>
    </div>
    <div class="metric">
      <span class="m-k mono">signature</span>
      <span class="m-v mono">{fmt(breakdown.signaturePresence, 2)}</span>
      <span class="m-bar"><span class="m-bar-fill" style="width: {Math.max(0, Math.min(100, (breakdown.signaturePresence ?? 0) * 100))}%"></span></span>
    </div>
    <div class="metric">
      <span class="m-k mono">interdits</span>
      <span class="m-v mono">{breakdown.forbiddenHits ?? 0}</span>
      <span class="m-bar"><span class="m-bar-fill m-bar-red" style="width: {Math.max(0, Math.min(100, (breakdown.forbiddenHits ?? 0) * 20))}%"></span></span>
    </div>
  {/if}

  <div class="fidelity" data-state={fidelityState}>
    <div class="fid-head mono">
      <span class="sh-idx">05</span>
      <span class="sh-name">fidélité</span>
    </div>
    <div class="fid-big mono">{fmt(fidelity, 3)}</div>
    <div class="fid-thresh mono">seuil {FIDELITY_THRESHOLD.toFixed(3)}</div>
    <div class="fid-bar">
      <div class="fid-bar-fill" style="width: {Math.max(0, Math.min(100, (fidelity ?? 0) * 100))}%"></div>
      <div class="fid-bar-threshold" style="left: {FIDELITY_THRESHOLD * 100}%"></div>
    </div>
  </div>
</div>

<style>
  .strip {
    display: grid;
    grid-template-columns: auto repeat(6, minmax(0, 1fr)) minmax(140px, 1.4fr);
    gap: 14px;
    align-items: center;
    padding: 10px 16px;
    border-top: 1px solid var(--rule-strong, #d4d0c7);
    border-bottom: 1px solid var(--rule, #e5e3dd);
    background: var(--paper-subtle, #faf9f5);
    font-family: var(--font-ui, sans-serif);
    transition: background 0.2s linear;
  }
  .strip.pulsing {
    background: color-mix(in srgb, var(--vermillon, #d93e30) 4%, var(--paper-subtle, #faf9f5));
  }

  .strip-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-40, #9a9690);
    border-right: 1px dashed var(--rule, #e5e3dd);
    padding-right: 12px;
  }
  .sh-idx { color: var(--vermillon, #d93e30); font-weight: 600; }
  .sh-name { color: var(--ink, #1a1a1a); font-weight: 600; }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .m-k {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-40, #9a9690);
  }
  .m-v {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink, #1a1a1a);
    font-variant-numeric: tabular-nums;
    transition: color 0.3s linear;
  }
  .strip.pulsing .m-v { color: var(--vermillon, #d93e30); }
  .m-bar {
    height: 2px;
    background: var(--rule-strong, #d4d0c7);
    position: relative;
    overflow: hidden;
    border-radius: 1px;
  }
  .m-bar-fill {
    display: block;
    height: 100%;
    background: var(--ink, #1a1a1a);
    transition: width 0.4s ease-out, background 0.3s linear;
  }
  .strip.pulsing .m-bar-fill { background: var(--vermillon, #d93e30); }
  .m-bar-red { background: var(--vermillon, #d93e30); }

  .fidelity {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto auto;
    column-gap: 10px;
    row-gap: 2px;
    padding-left: 12px;
    border-left: 1px dashed var(--rule, #e5e3dd);
    align-items: baseline;
  }
  .fid-head {
    grid-column: 1;
    grid-row: 1 / 4;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-40, #9a9690);
  }
  .fid-big {
    grid-column: 2;
    grid-row: 1;
    font-size: 22px;
    font-weight: 500;
    color: var(--ink, #1a1a1a);
    letter-spacing: -0.02em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    transition: color 0.3s linear;
  }
  .fidelity[data-state="drift"] .fid-big { color: var(--vermillon, #d93e30); }
  .fid-thresh {
    grid-column: 2;
    grid-row: 2;
    font-size: 9.5px;
    color: var(--ink-40, #9a9690);
  }
  .fid-bar {
    grid-column: 2;
    grid-row: 3;
    height: 3px;
    background: var(--rule-strong, #d4d0c7);
    position: relative;
    overflow: visible;
    margin-top: 2px;
    border-radius: 1px;
  }
  .fid-bar-fill {
    height: 100%;
    background: var(--ink, #1a1a1a);
    transition: width 0.4s ease-out, background 0.3s linear;
  }
  .fidelity[data-state="drift"] .fid-bar-fill { background: var(--vermillon, #d93e30); }
  .fid-bar-threshold {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--vermillon, #d93e30);
    opacity: 0.6;
  }

  @media (max-width: 900px) {
    .strip {
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      padding: 8px 12px;
    }
    .strip-head { grid-column: 1 / -1; border-right: 0; padding-right: 0; padding-bottom: 6px; border-bottom: 1px dashed var(--rule, #e5e3dd); flex-direction: row; gap: 8px; }
    .fidelity { grid-column: 1 / -1; border-left: 0; padding-left: 0; padding-top: 6px; border-top: 1px dashed var(--rule, #e5e3dd); }
  }
  @media (max-width: 480px) {
    .strip { grid-template-columns: repeat(2, 1fr); }
  }
</style>
