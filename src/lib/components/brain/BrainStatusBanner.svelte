<script>
  // Status banner top-of-page : 4 cells de comptage + bouton import.
  // Click sur cell émet `oncellclick` (parent gère scroll/focus vers la
  // section correspondante).
  //
  // Props :
  //   counts : { contradictions_open, propositions_pending,
  //              propositions_pending_doc, propositions_pending_chat,
  //              auto_merged, doctrine_sections_filled, doctrine_sections_total }
  //   loading : bool
  //   onCellClick : (cellId: 'contradictions'|'propositions'|'merged'|'doctrine') => void
  //   onImportClick : () => void

  let {
    counts = null,
    loading = false,
    onCellClick = () => {},
    onImportClick = () => {},
  } = $props();
</script>

<div class="status-banner" class:loading>
  <button
    type="button"
    class="cell"
    class:alert={counts?.contradictions_open > 0}
    onclick={() => onCellClick("contradictions")}
    aria-label="Contradictions ouvertes"
  >
    <span class="num" class:alert={counts?.contradictions_open > 0}>{counts?.contradictions_open ?? "—"}</span>
    <span class="lbl">contradictions</span>
    <span class="meta">à arbitrer</span>
  </button>

  <button
    type="button"
    class="cell"
    onclick={() => onCellClick("propositions")}
    aria-label="Propositions pending"
  >
    <span class="num">{counts?.propositions_pending ?? "—"}</span>
    <span class="lbl">propositions</span>
    <span class="meta">
      {#if counts}
        {counts.propositions_pending_doc} doc · {counts.propositions_pending_chat} chat
      {:else}
        pending
      {/if}
    </span>
  </button>

  <button
    type="button"
    class="cell"
    onclick={() => onCellClick("merged")}
    aria-label="Auto-mergées"
  >
    <span class="num">{counts?.auto_merged ?? "—"}</span>
    <span class="lbl">auto-mergées</span>
    <span class="meta">synonymes</span>
  </button>

  <button
    type="button"
    class="cell"
    onclick={() => onCellClick("doctrine")}
    aria-label="Doctrine"
  >
    <span class="num">
      {counts ? `${counts.doctrine_sections_filled}/${counts.doctrine_sections_total}` : "—"}
    </span>
    <span class="lbl">doctrine</span>
    <span class="meta">sections remplies</span>
  </button>

  <div class="import-cell">
    <button type="button" class="import-btn" onclick={onImportClick}>
      + importer un doc
    </button>
  </div>
</div>

<style>
  .status-banner {
    display: grid;
    grid-template-columns: repeat(4, 1fr) auto;
    gap: 1px;
    background: var(--rule-strong);
    margin-top: 16px;
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    overflow: hidden;
  }
  .status-banner.loading .num { opacity: 0.4; }

  .cell {
    background: var(--paper);
    padding: 14px 18px;
    cursor: pointer;
    transition: background 0.1s;
    border: none;
    text-align: left;
    color: var(--ink);
    font-family: inherit;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cell:hover { background: var(--paper-subtle, #ecebe4); }
  .cell:focus-visible { outline: 2px solid var(--vermillon); outline-offset: -2px; }

  .num {
    font-family: var(--font, Georgia, serif);
    font-size: 30px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .num.alert { color: var(--vermillon); }
  .lbl {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: lowercase;
    letter-spacing: 0.08em;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-30);
  }

  .import-cell {
    background: var(--paper);
    display: flex;
    align-items: center;
    padding: 0 18px;
  }
  .import-btn {
    background: var(--ink);
    color: var(--paper);
    border: none;
    padding: 11px 18px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
    letter-spacing: 0.02em;
  }
  .import-btn:hover { background: var(--vermillon-dim, #b43b28); }

  @media (max-width: 700px) {
    .status-banner { grid-template-columns: 1fr 1fr; }
    .import-cell { grid-column: 1 / -1; padding: 14px 18px; }
    .import-btn { width: 100%; }
  }
</style>
