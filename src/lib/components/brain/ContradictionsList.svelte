<script>
  // Liste des contradictions ouvertes/punted/resolved.
  // Cards V2 D2 : A et B stacked (vs side-by-side V1), source_summary inline
  // ("A — Reflexion process.pdf · 1 mention"), 5 actions footer.
  //
  // Props :
  //   contradictions : Array (shape de GET /api/v2/contradictions)
  //   loading : bool
  //   onResolve : (id, action, note?) => Promise<void>
  //
  // Actions disabled tant que onResolve === null (mode read-only).

  import { showToast } from "$lib/stores/ui.js";

  let {
    contradictions = [],
    loading = false,
    onResolve = null,
  } = $props();

  let busyId = $state(null);

  async function handleAction(id, action) {
    if (!onResolve) {
      showToast("L'action n'est pas branchée — mode read-only.", "info");
      return;
    }
    busyId = id;
    try { await onResolve(id, action); }
    catch (e) { showToast(e.message || "Action échouée", "error"); }
    finally { busyId = null; }
  }

  function srcLabel(side) {
    if (!side) return "—";
    const summary = side.source_summary || side.source || "—";
    const count = side.count ?? 1;
    return count > 1 ? `${summary} · ${count} mentions` : summary;
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
    <article class="contra-card" aria-busy={busyId === c.id}>
      <header class="contra-head">
        <div class="kind-reason">
          <span class="kind">{c.kind}</span>
          {#if c.reason}<span class="reason"> · {c.reason}</span>{/if}
        </div>
        <div class="cosine">cosine {c.cosine?.toFixed(2) ?? "—"}</div>
      </header>

      <div class="side">
        <div class="src">A — {srcLabel(c.a)}</div>
        <div class="text">{c.a?.text || "(proposition supprimée)"}</div>
      </div>

      <div class="side">
        <div class="src">B — {srcLabel(c.b)}</div>
        <div class="text">{c.b?.text || "(proposition supprimée)"}</div>
      </div>

      <footer class="contra-actions">
        <button type="button" class="btn primary" disabled={busyId === c.id || !c.a || !onResolve} onclick={() => handleAction(c.id, "keep_a")}>garder A</button>
        <button type="button" class="btn primary" disabled={busyId === c.id || !c.b || !onResolve} onclick={() => handleAction(c.id, "keep_b")}>garder B</button>
        <div class="spacer"></div>
        <button type="button" class="btn" disabled={busyId === c.id || !onResolve} onclick={() => handleAction(c.id, "both_false_positive")}>les 2 OK</button>
        <button type="button" class="btn" disabled={busyId === c.id || !onResolve} onclick={() => handleAction(c.id, "reject_both")}>rejeter</button>
        <button type="button" class="btn" disabled={busyId === c.id || !onResolve} onclick={() => handleAction(c.id, "punt")}>plus tard</button>
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
    border-left: 3px solid var(--vermillon, #c45339);
    padding: 11px 14px;
    margin: 14px 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink-70, #35353f);
  }
  .note strong { color: var(--ink); font-weight: 600; }

  .contra-card {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 3px;
    margin-bottom: 12px;
  }
  .contra-card[aria-busy="true"] { opacity: 0.5; pointer-events: none; }

  .contra-head {
    background: var(--paper-subtle, #ecebe4);
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 10.5px;
  }
  .kind { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-70, #35353f); }
  .reason { color: var(--ink-40); }
  .cosine { color: var(--vermillon-dim, #b43b28); font-size: 10px; }

  .side {
    padding: 14px;
    border-bottom: 1px solid var(--rule);
  }
  .side:last-of-type { border-bottom: none; }
  .src {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-40);
    margin-bottom: 4px;
  }
  .text {
    font-family: var(--font, Georgia, serif);
    font-size: 14px;
    line-height: 1.4;
    color: var(--ink);
  }

  .contra-actions {
    display: flex;
    gap: 6px;
    padding: 10px 14px;
    border-top: 1px solid var(--rule);
    background: var(--paper-subtle, #ecebe4);
    flex-wrap: wrap;
    align-items: center;
  }
  .spacer { flex: 1 1 auto; }
  .btn {
    font-family: var(--font-mono);
    font-size: 10.5px;
    padding: 6px 12px;
    border: 1px solid var(--rule-strong);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    color: var(--ink);
  }
  .btn:hover:not(:disabled) { background: var(--paper); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.primary {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
    font-weight: 500;
  }
  .btn.primary:hover:not(:disabled) { background: var(--vermillon-dim, #b43b28); border-color: var(--vermillon-dim, #b43b28); }

  @media (max-width: 700px) {
    .contra-actions .spacer { display: none; }
    .contra-actions { gap: 4px; }
    .btn { font-size: 10px; padding: 5px 8px; }
  }
</style>
