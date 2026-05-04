<script>
  // PropositionsList — flat 5-col grid (kind / text / src / conf / actions).
  // Affiche un échantillon top-N + "+M autres" row si total > propositions.length.
  //
  // Props :
  //   propositions : Array<{ id, target_kind, proposed_text, source_filename?,
  //                          source, count, confidence }>
  //   total : number — total après filtres (peut être > propositions.length)
  //   onAction : (id, action) => void — actions: 'accept' | 'reject' | 'revise'
  //   onSeeAll : () => void

  let {
    propositions = [],
    total = null,
    onAction = () => {},
    onSeeAll = () => {},
  } = $props();

  function srcLabel(p) {
    const src = p.source_filename || p.source || "—";
    const c = p.count ?? 1;
    const conf = (typeof p.confidence === "number") ? p.confidence.toFixed(2) : "—";
    return `${src} · count ${c} · ${conf}`;
  }

  let extras = $derived(() => {
    if (total === null || total === undefined) return 0;
    return Math.max(0, total - propositions.length);
  });
</script>

<div class="prop-list">
  {#each propositions as p (p.id)}
    <div class="prop-row">
      <div class="kind">{p.target_kind || "—"}</div>
      <div class="text">{p.proposed_text}</div>
      <div class="src">{srcLabel(p)}</div>
      <div class="conf">conf {(typeof p.confidence === "number") ? p.confidence.toFixed(2) : "—"}</div>
      <div class="actions">
        <button type="button" class="btn-small accept" onclick={() => onAction(p.id, "accept")} title="Accepter">✓</button>
        <button type="button" class="btn-small" onclick={() => onAction(p.id, "revise")} title="Éditer">éditer</button>
        <button type="button" class="btn-small reject" onclick={() => onAction(p.id, "reject")} title="Rejeter">✗</button>
      </div>
    </div>
  {:else}
    <div class="prop-empty">Aucune proposition pour ces filtres.</div>
  {/each}

  {#if extras() > 0}
    <div class="prop-row more">
      <div class="kind muted">—</div>
      <div class="text muted">+ {extras()} autres propositions matchent les filtres</div>
      <div class="src"></div>
      <div class="conf"></div>
      <div class="actions">
        <button type="button" class="btn-small" onclick={onSeeAll}>tout voir</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .prop-list {
    margin-top: 14px;
    border: 1px solid var(--rule);
    border-radius: 3px;
  }
  .prop-row {
    display: grid;
    grid-template-columns: 90px 1fr 1fr 110px 130px;
    gap: 14px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--rule);
    align-items: center;
  }
  .prop-row:last-child { border-bottom: none; }
  .prop-row:hover:not(.more) { background: var(--paper-subtle, #ecebe4); }
  .prop-row.more { background: var(--paper-subtle, #ecebe4); }

  .kind {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    color: var(--ink-40);
    letter-spacing: 0.06em;
  }
  .kind.muted { color: var(--ink-30); }
  .text {
    font-family: var(--font, Georgia, serif);
    font-size: 14px;
    line-height: 1.4;
    color: var(--ink);
  }
  .text.muted { color: var(--ink-40); }
  .src {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conf {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-70);
  }

  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .btn-small {
    font-family: var(--font-mono);
    font-size: 10.5px;
    padding: 5px 9px;
    border: 1px solid var(--rule-strong);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    color: var(--ink);
  }
  .btn-small:hover { background: var(--paper); }
  .btn-small.accept { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn-small.accept:hover { background: var(--vermillon); border-color: var(--vermillon); }
  .btn-small.reject { color: var(--ink-40); }
  .btn-small.reject:hover { color: var(--vermillon); border-color: var(--vermillon); }

  .prop-empty {
    padding: 28px 16px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
  }

  @media (max-width: 700px) {
    .prop-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .actions { justify-content: flex-start; }
  }
</style>
