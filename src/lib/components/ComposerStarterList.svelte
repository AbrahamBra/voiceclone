<script>
  // Pure presentational — renders starter chips and calls onApply with the template string.
  let { starters = [], disabled = false, onApply } = $props();
</script>

<div class="starters" role="group" aria-label="Amorces de consigne">
  {#each starters as s (s.label)}
    <button
      type="button"
      class="starter-chip mono"
      onclick={() => onApply?.(s.template)}
      {disabled}
      title={s.template}
    >
      {s.label}
    </button>
  {/each}
</div>

<style>
  .starters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 4px;
  }
  .starter-chip {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px solid var(--rule);
    color: var(--ink);
    cursor: pointer;
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease),
      background var(--dur-fast, 120ms) var(--ease, ease);
  }
  .starter-chip:hover:not(:disabled) {
    border-color: var(--vermillon);
    background: var(--paper, #fff);
  }
  .starter-chip:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
