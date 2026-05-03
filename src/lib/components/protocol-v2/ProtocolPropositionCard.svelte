<script>
  // Carte individuelle d'une proposition pending — accept / revise / reject.
  //
  // Appelle POST /api/v2/propositions { action, id, ... } via le wrapper api()
  // (qui injecte les headers d'auth). Notifie le parent via onResolved(result)
  // pour que la queue se réorganise (retire la card de la liste pending).
  //
  // Visuel :
  //   target_kind badge + intent + confidence pill + count si > 1
  //   proposed_text en prose
  //   rationale italic en dessous
  //   3 actions : Accept (primary noir), Revise (textarea inline), Reject (ghost)
  //   Optionnel : champ user_note partagé pour accept/reject (pour traçabilité)

  import { api } from "$lib/api.js";

  /**
   * @type {{
   *   proposition: object,
   *   onResolved?: (result: { action: string, proposition: object, section?: object }) => void,
   * }}
   */
  let { proposition, onResolved } = $props();

  let mode = $state(/** @type {'idle'|'revising'} */ ("idle"));
  let revisedText = $state("");
  let userNote = $state("");
  let busy = $state(false);
  let error = $state(null);

  // Convergence cross-source : si la proposition a été extraite de plusieurs
  // playbooks (cf migration 070, source='playbook_extraction'), on lit la
  // liste depuis provenance.playbook_sources pour afficher un badge
  // "vu dans N sources" + détails au hover.
  const playbookSources = $derived.by(() => {
    const ps = proposition?.provenance?.playbook_sources;
    return Array.isArray(ps) ? ps : [];
  });
  const uniqueSourceCores = $derived.by(() => {
    const set = new Set();
    for (const s of playbookSources) if (s?.source_core) set.add(s.source_core);
    return Array.from(set);
  });
  const provenanceTooltip = $derived.by(() => {
    if (!playbookSources.length) return "";
    return playbookSources
      .map((s) => `${s.source_core || "?"}/T${s.toggle_idx ?? "?"}${s.toggle_title ? " " + s.toggle_title : ""}`)
      .join("\n");
  });

  function confidenceClass(c) {
    if (typeof c !== "number") return "low";
    if (c >= 0.85) return "high";
    if (c >= 0.7) return "med";
    return "low";
  }

  async function callAction(action, body) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const result = await api("/api/v2/propositions", {
        method: "POST",
        body: JSON.stringify({ action, id: proposition.id, ...body }),
      });
      onResolved?.({ action, ...result });
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      busy = false;
    }
  }

  function accept() {
    callAction("accept", userNote ? { user_note: userNote } : {});
  }

  function reject() {
    callAction("reject", userNote ? { user_note: userNote } : {});
  }

  function startRevise() {
    revisedText = proposition.proposed_text || "";
    mode = "revising";
  }

  function cancelRevise() {
    mode = "idle";
    revisedText = "";
  }

  function submitRevise() {
    const trimmed = revisedText.trim();
    if (!trimmed) {
      error = "proposed_text vide";
      return;
    }
    callAction("revise", {
      proposed_text: trimmed,
      ...(userNote ? { user_note: userNote } : {}),
    });
  }
</script>

<article class="ppc" class:revising={mode === "revising"} class:busy>
  <header class="ppc-head">
    <span class="ppc-tk">{proposition.target_kind}</span>
    <span class="ppc-intent">{proposition.intent}</span>
    {#if (proposition.count ?? 1) > 1}
      <span class="ppc-count" title="signaux fusionnés">×{proposition.count}</span>
    {/if}
    {#if playbookSources.length > 0}
      <span
        class="ppc-prov"
        class:converge={uniqueSourceCores.length >= 2}
        title={provenanceTooltip}
      >
        {#if uniqueSourceCores.length >= 2}
          ⊕ {uniqueSourceCores.length} sources
        {:else}
          {uniqueSourceCores[0]}/T{playbookSources[0].toggle_idx}
        {/if}
      </span>
    {/if}
    <span class="ppc-conf {confidenceClass(proposition.confidence)}">
      {Math.round((proposition.confidence ?? 0) * 100)}%
    </span>
  </header>

  {#if mode === "idle"}
    <div class="ppc-text">{proposition.proposed_text}</div>
    {#if proposition.rationale}
      <div class="ppc-rationale">{proposition.rationale}</div>
    {/if}
  {:else}
    <textarea
      class="ppc-textarea"
      bind:value={revisedText}
      rows="4"
      placeholder="Reformulation…"
      disabled={busy}
    ></textarea>
  {/if}

  <footer class="ppc-actions">
    <input
      class="ppc-note"
      bind:value={userNote}
      placeholder="Note optionnelle…"
      disabled={busy}
    />
    {#if mode === "idle"}
      <button type="button" class="ppc-btn ppc-ghost" onclick={reject} disabled={busy}>
        Reject
      </button>
      <button type="button" class="ppc-btn" onclick={startRevise} disabled={busy}>
        Revise
      </button>
      <button type="button" class="ppc-btn ppc-primary" onclick={accept} disabled={busy}>
        {busy ? "…" : "Accept"}
      </button>
    {:else}
      <button type="button" class="ppc-btn ppc-ghost" onclick={cancelRevise} disabled={busy}>
        Annuler
      </button>
      <button type="button" class="ppc-btn ppc-primary" onclick={submitRevise} disabled={busy || !revisedText.trim()}>
        {busy ? "…" : "Enregistrer revise"}
      </button>
    {/if}
  </footer>

  {#if error}
    <div class="ppc-error">{error}</div>
  {/if}
</article>

<style>
  .ppc {
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    padding: 12px 14px;
    background: var(--bg, #fff);
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 120ms ease, opacity 120ms ease;
  }
  .ppc.busy { opacity: 0.6; pointer-events: none; }
  .ppc.revising { border-color: var(--ink-40); }

  .ppc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ppc-tk {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-70);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    padding: 2px 6px;
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ppc-intent {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ppc-count {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    padding: 1px 5px;
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
  }
  /* Provenance issue d'un playbook source. Discret en mono-source.
     Vermillon + plus marqué quand convergence cross-source ≥ 2 sources
     (signal fort de doctrine commune à arbitrer en priorité). */
  .ppc-prov {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    padding: 1px 6px;
    border-radius: 2px;
    cursor: help;
    white-space: nowrap;
  }
  .ppc-prov.converge {
    color: var(--accent, #c8463a);
    background: color-mix(in srgb, var(--accent, #c8463a) 12%, transparent);
    font-weight: 500;
  }
  .ppc-conf {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 1px 6px;
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
  }
  .ppc-conf.high {
    color: #2e8a55;
    background: color-mix(in srgb, #2e8a55 14%, transparent);
  }
  .ppc-conf.med {
    color: #b08010;
    background: color-mix(in srgb, #d0a248 14%, transparent);
  }
  .ppc-conf.low {
    color: var(--ink-40);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .ppc-text {
    font-size: var(--fs-small);
    color: var(--ink);
    line-height: 1.5;
  }
  .ppc-rationale {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-style: italic;
  }
  .ppc-textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    padding: 8px 10px;
    font-family: var(--font);
    font-size: var(--fs-small);
    line-height: 1.5;
    color: var(--ink);
    background: var(--bg, #fff);
    resize: vertical;
  }
  .ppc-textarea:focus { outline: none; border-color: var(--ink-40); }

  .ppc-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .ppc-note {
    flex: 1;
    min-width: 140px;
    border: 1px solid var(--rule-strong);
    border-radius: 2px;
    padding: 4px 8px;
    font-family: var(--font);
    font-size: var(--fs-tiny);
    color: var(--ink);
    background: var(--bg, #fff);
  }
  .ppc-note:focus { outline: none; border-color: var(--ink-40); }
  .ppc-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 2px;
  }
  .ppc-btn:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--ink-40);
  }
  .ppc-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ppc-btn.ppc-primary {
    background: var(--ink);
    color: var(--bg, #fff);
    border-color: var(--ink);
  }
  .ppc-btn.ppc-primary:hover:not(:disabled) {
    background: var(--ink-70);
    border-color: var(--ink-70);
  }
  .ppc-btn.ppc-ghost {
    color: var(--ink-40);
  }
  .ppc-error {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--vermillon);
  }
</style>
