<script>
  // Refonte de DoctrineGrid en visualization "fondation qui se remplit".
  // 7 bars horizontales représentant les sections doctrine, hauteur fixe,
  // remplissage = #222 (rempli), #ddd (vide). Pédagogie inline qui pointe
  // le kind avec le plus de leverage potentiel ("X props pending sur kind Y
  // → arbitrer là baisserait le plus tes corrections").
  //
  // Props :
  //   sections : Array<{ kind, prose_chars, pending_count }>
  //   onCellClick : (kind: string) => void

  let {
    sections = [],
    onCellClick = () => {},
  } = $props();

  const KIND_ORDER = ["identity", "hard_rules", "errors", "icp_patterns",
                       "scoring", "process", "templates"];

  let cells = $derived(() => {
    const m = {};
    for (const s of sections) m[s.kind] = s;
    return KIND_ORDER.map(k => m[k] || { kind: k, prose_chars: 0, pending_count: 0 });
  });

  let pedagogy = $derived(() => {
    const filled = cells().filter(c => c.prose_chars > 0).length;
    const total = cells().length;
    const empty = cells().filter(c => c.prose_chars === 0);
    if (empty.length === 0) {
      return `${filled}/${total} sections remplies. Doctrine complète sur les 7 axes.`;
    }
    const topEmpty = empty.reduce((best, c) => (c.pending_count > (best?.pending_count || 0) ? c : best), null);
    if (!topEmpty || topEmpty.pending_count === 0) {
      return `${filled}/${total} sections remplies. Aucune proposition pending pour les sections vides.`;
    }
    return `${empty.length} sections vides + ${topEmpty.pending_count} props pending sur "${topEmpty.kind}" → arbitrer là baisserait le plus tes corrections.`;
  });

  let totalChars = $derived(() => cells().reduce((sum, c) => sum + (c.prose_chars || 0), 0));
  let filledCount = $derived(() => cells().filter(c => c.prose_chars > 0).length);
</script>

<div class="block">
  <div class="label">Fondation (Doctrine)</div>

  <div class="bars">
    {#each cells() as cell (cell.kind)}
      <button
        type="button"
        class="bar"
        class:filled={cell.prose_chars > 0}
        title="{cell.kind} · {cell.prose_chars} chars · {cell.pending_count} props pending"
        onclick={() => onCellClick(cell.kind)}
        aria-label="Section {cell.kind}"
      ></button>
    {/each}
  </div>

  <div class="meta">{filledCount()}/{cells().length} sections · {totalChars().toLocaleString("fr-FR")} chars</div>
  <div class="pedagogy">{pedagogy()}</div>
</div>

<style>
  .block {
    padding: 12px 14px;
  }
  .label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }
  .bars {
    display: flex;
    gap: 2px;
    margin: 6px 0;
  }
  .bar {
    height: 24px;
    flex: 1;
    background: #ddd;
    cursor: pointer;
    border: none;
    transition: background 0.1s;
    padding: 0;
  }
  .bar.filled { background: #222; }
  .bar:hover { opacity: 0.8; }
  .bar:focus-visible { outline: 2px solid var(--vermillon); outline-offset: 2px; }

  .meta {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-40);
    margin-top: 6px;
  }
  .pedagogy {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-40);
    margin-top: 8px;
    font-style: italic;
    line-height: 1.4;
  }
</style>
