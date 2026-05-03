<script>
  // Mode bar — 2 modes : 🎯 Arbitrage / 📚 Doctrine.
  //
  // Props :
  //   mode      : 'arbitrage' | 'doctrine'
  //   counts    : same shape as BrainStatusBanner (utilisé pour les badges)
  //   onChange  : (next: 'arbitrage'|'doctrine') => void

  let { mode = "arbitrage", counts = null, onChange = () => {} } = $props();

  let arbCount = $derived(counts ? (counts.contradictions_open + counts.propositions_pending) : null);
  let docCount = $derived(counts ? `${counts.doctrine_sections_filled}/${counts.doctrine_sections_total}` : null);
</script>

<div class="mode-bar" role="tablist">
  <button
    type="button"
    class="mode"
    class:active={mode === "arbitrage"}
    role="tab"
    aria-selected={mode === "arbitrage"}
    onclick={() => onChange("arbitrage")}
  >
    <span class="ico">🎯</span>
    <span class="label">Arbitrage</span>
    {#if arbCount !== null}
      <span class="badge">{arbCount}</span>
    {/if}
  </button>
  <button
    type="button"
    class="mode"
    class:active={mode === "doctrine"}
    role="tab"
    aria-selected={mode === "doctrine"}
    onclick={() => onChange("doctrine")}
  >
    <span class="ico">📚</span>
    <span class="label">Doctrine</span>
    {#if docCount !== null}
      <span class="badge">{docCount}</span>
    {/if}
  </button>
</div>

<style>
  .mode-bar {
    display: flex;
    gap: 4px;
    margin-top: 24px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .mode {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-40);
    padding: 12px 18px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: color 0.1s, border-color 0.1s;
  }
  .mode:hover { color: var(--ink); }
  .mode.active {
    color: var(--ink);
    border-bottom-color: var(--vermillon);
    font-weight: 600;
  }
  .ico { font-size: 14px; }
  .label { text-transform: lowercase; }
  .badge {
    font-size: 10px;
    color: var(--ink-40);
    padding: 2px 6px;
    background: var(--paper-subtle, #ecebe4);
    border-radius: 2px;
  }
  .mode.active .badge { color: var(--ink); background: var(--paper); border: 1px solid var(--rule-strong); }
</style>
