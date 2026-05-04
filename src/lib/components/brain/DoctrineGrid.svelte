<script>
  // DoctrineGrid — 7 cells (identity / hard_rules / errors / icp_patterns
  // / scoring / process / templates), affichées dans un ordre fixe.
  //
  // Props :
  //   sections : Array<{ kind, prose_chars, pending_count, summary? }>
  //   onCellClick : (kind: string) => void
  //
  // Click sur cell = drill-down (V1 : juste console.log + onCellClick).

  let {
    sections = [],
    onCellClick = () => {},
  } = $props();

  // Ordre canonique des cells (mockup) :
  const KIND_ORDER = ["identity", "hard_rules", "errors", "icp_patterns",
                       "scoring", "process", "templates"];

  let cellsByKind = $derived(() => {
    const m = {};
    for (const s of sections) m[s.kind] = s;
    return KIND_ORDER.map(k => m[k] || { kind: k, prose_chars: 0, pending_count: 0 });
  });

  function fmtChars(n) {
    if (!n) return "0";
    if (n >= 10000) return Math.round(n / 1000) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function fmtMeta(s) {
    const filled = (s.prose_chars || 0) > 0;
    const pending = s.pending_count || 0;
    if (filled) {
      const summary = s.summary ? " · " + s.summary : "";
      const pendingPart = pending > 0 ? ` · pending ${pending}` : "";
      return "prose" + (summary || pendingPart);
    }
    return pending > 0 ? `vide · pending ${pending}` : "vide";
  }
</script>

<div class="doc-grid" aria-label="Doctrine — 7 sections">
  {#each cellsByKind() as s (s.kind)}
    <button
      type="button"
      class="cell"
      onclick={() => onCellClick(s.kind)}
      aria-label="Section {s.kind}"
    >
      <div class="name">{s.kind}</div>
      <div class="num" class:empty={(s.prose_chars || 0) === 0}>{fmtChars(s.prose_chars)}</div>
      <div class="meta">{fmtMeta(s)}</div>
    </button>
  {/each}
</div>

<style>
  .doc-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    margin-top: 14px;
    background: var(--rule);
    border: 1px solid var(--rule);
    border-radius: 3px;
    overflow: hidden;
  }
  .cell {
    background: var(--paper);
    padding: 14px 12px;
    cursor: pointer;
    border: none;
    text-align: left;
    color: var(--ink);
    font-family: inherit;
    transition: background 0.1s;
  }
  .cell:hover { background: var(--paper-subtle, #ecebe4); }
  .cell:focus-visible { outline: 2px solid var(--vermillon); outline-offset: -2px; }

  .name {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    color: var(--ink-40);
    letter-spacing: 0.06em;
  }
  .num {
    font-family: var(--font, Georgia, serif);
    font-size: 22px;
    font-weight: 500;
    margin-top: 6px;
    line-height: 1;
  }
  .num.empty { color: var(--ink-30); }
  .meta {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-30);
    margin-top: 4px;
  }

  @media (max-width: 900px) {
    .doc-grid { grid-template-columns: repeat(4, 1fr); }
  }
  @media (max-width: 700px) {
    .doc-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
