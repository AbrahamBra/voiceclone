<script>
  // Liste des contradictions ouvertes/punted/resolved.
  // Cards A vs B avec 5 actions : keep_a, keep_b, both_false_positive,
  // reject_both, punt.
  //
  // Props :
  //   contradictions : Array (shape de GET /api/v2/contradictions)
  //   loading : bool
  //   onResolve : (id, action, note?) => Promise<void>
  //
  // Actions disabled tant que onResolve === null (mode read-only en V1.0
  // jusqu'à ce que /api/v2/contradictions/:id/resolve land).

  import { showToast } from "$lib/stores/ui.js";

  let {
    contradictions = [],
    loading = false,
    onResolve = null,
  } = $props();

  let busyId = $state(null);

  async function handleAction(id, action) {
    if (!onResolve) {
      showToast("L'endpoint resolve arrive dans le prochain commit — la card est encore read-only.", "info");
      return;
    }
    busyId = id;
    try { await onResolve(id, action); }
    catch (e) { showToast(e.message || "Action échouée", "error"); }
    finally { busyId = null; }
  }

  // Visual weight ∝ count : à count=1 weight=1, à count≥3 weight=2 (max).
  function weight(c) {
    if (!c) return 1;
    return Math.min(2, 1 + Math.log2(Math.max(1, c) || 1) / 2);
  }
</script>

{#if loading}
  <p class="empty">chargement…</p>
{:else if contradictions.length === 0}
  <p class="empty">Aucune contradiction ouverte. Le clone est cohérent (ou rien n'a encore été scanné).</p>
{:else}
  <div class="note">
    <strong>Pourquoi cette liste ?</strong> Pour chaque paire ci-dessous, le système a détecté que les 2 propositions disent l'inverse. Si tu acceptes les 2, le clone reçoit des règles incompatibles. Choisis laquelle garder.
  </div>

  {#each contradictions as c (c.id)}
    <article class="arb-card" aria-busy={busyId === c.id}>
      <header class="meta-row">
        <span class="kind">{c.kind}</span>
        <span class="cos">cosine {c.cosine.toFixed(3)}</span>
        {#if c.reason}<span class="reason">{c.reason}</span>{/if}
      </header>

      <div class="side a" style="--w: {weight(c.a?.count)}">
        <div class="label">
          A · count {c.a?.count ?? "—"}
          {#if c.a?.intent}· intent {c.a.intent}{/if}
        </div>
        <div class="text">{c.a?.text ?? "(proposition supprimée)"}</div>
        {#if c.a?.sources?.length}
          <div class="sources">
            {#each c.a.sources as src}
              <span class="source-chip">📄 {src}</span>
            {/each}
          </div>
        {/if}
      </div>

      <div class="vs">vs.</div>

      <div class="side b" style="--w: {weight(c.b?.count)}">
        <div class="label">
          B · count {c.b?.count ?? "—"}
          {#if c.b?.intent}· intent {c.b.intent}{/if}
        </div>
        <div class="text">{c.b?.text ?? "(proposition supprimée)"}</div>
        {#if c.b?.sources?.length}
          <div class="sources">
            {#each c.b.sources as src}
              <span class="source-chip">📄 {src}</span>
            {/each}
          </div>
        {/if}
      </div>

      <footer class="actions">
        <button type="button" class="btn tertiary" disabled={busyId === c.id} onclick={() => handleAction(c.id, "punt")}>⏸ punter</button>
        <button type="button" class="btn tertiary" disabled={busyId === c.id} onclick={() => handleAction(c.id, "both_false_positive")}>les 2 (faux positif)</button>
        <button type="button" class="btn" disabled={busyId === c.id} onclick={() => handleAction(c.id, "reject_both")}>rejeter les 2</button>
        <button type="button" class="btn primary" disabled={busyId === c.id || !c.a} onclick={() => handleAction(c.id, "keep_a")}>garder A</button>
        <button type="button" class="btn primary" disabled={busyId === c.id || !c.b} onclick={() => handleAction(c.id, "keep_b")}>garder B</button>
      </footer>
    </article>
  {/each}
{/if}

<style>
  .empty {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    padding: 24px 0;
    text-align: center;
  }
  .note {
    background: var(--paper-subtle, #ecebe4);
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    padding: 12px 16px;
    margin: 14px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-70, #35353f);
  }
  .note strong { color: var(--ink); }

  .arb-card {
    display: grid;
    grid-template-columns: 1fr 60px 1fr;
    gap: 0;
    margin-top: 18px;
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    background: var(--paper);
  }
  .arb-card[aria-busy="true"] { opacity: 0.6; }

  .meta-row {
    grid-column: 1 / -1;
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }
  .kind { color: var(--ink-70, #35353f); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
  .cos { color: var(--vermillon-dim, #b43b28); }

  .side {
    padding: 18px;
    /* visual weight via background lightness */
    background: color-mix(in srgb, var(--paper-subtle, #ecebe4) calc((var(--w, 1) - 1) * 100%), var(--paper));
  }
  .side.b { border-left: 1px solid var(--rule); }
  .label { font-family: var(--font-mono); font-size: 10px; color: var(--ink-40); margin-bottom: 6px; letter-spacing: 0.06em; }
  .text { font-family: var(--font, Georgia, serif); font-size: 15px; line-height: 1.45; color: var(--ink); }

  .vs {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font, Georgia, serif);
    font-style: italic;
    font-size: 14px;
    color: var(--ink-40);
    border-left: 1px solid var(--rule);
    border-right: 1px solid var(--rule);
  }

  .sources {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px dashed var(--rule);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .source-chip {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 8px;
    background: var(--paper-subtle, #ecebe4);
    border: 1px solid var(--rule);
    border-radius: 2px;
    color: var(--ink-70, #35353f);
  }

  .actions {
    grid-column: 1 / -1;
    padding: 12px 14px;
    border-top: 1px solid var(--rule);
    background: var(--paper-subtle, #ecebe4);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 7px 12px;
    border-radius: 2px;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--ink);
  }
  .btn:hover:not(:disabled) { background: var(--paper); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn.primary:hover:not(:disabled) { background: var(--ink-90, #1c1c23); }
  .btn.tertiary { color: var(--ink-40); }

  @media (max-width: 700px) {
    .arb-card { grid-template-columns: 1fr; }
    .vs {
      grid-column: 1 / -1;
      padding: 6px;
      border: none;
      border-top: 1px dashed var(--rule);
      border-bottom: 1px dashed var(--rule);
    }
    .side.b { border-left: none; }
    .actions { justify-content: stretch; }
    .actions .btn { flex: 1 1 auto; }
  }
</style>
