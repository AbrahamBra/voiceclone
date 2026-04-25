<script>
  // Édit prose d'une section + extraction inline.
  //
  // Flow :
  //   1. User édite le prose (textarea autosize)
  //   2. Save → POST /api/v2/protocol/extract { document_id, section_id, prose }
  //   3. Affiche le spinner pendant l'extraction (3-15s)
  //   4. Affiche les candidats retournés (target_kind, intent, proposed_text,
  //      rationale, confidence) — l'acceptance proper viendra Task 4.3.
  //   5. Le prose est PERSISTÉ même si l'extraction time out — on signale
  //      juste l'extraction_error sans bloquer.
  //
  // L'appelant (Task 3.7 shim ou page chat) est responsable d'inclure ce
  // composant dans une zone d'édition, par ex. en mode 'edit' déclenché
  // depuis ProtocolDoctrine.

  import { api } from "$lib/api.js";

  /** @type {{ documentId: string, section: {id:string, kind:string, heading:string|null, prose:string}, onSaved?: (result:{saved:boolean, candidates:any[]}) => void, onCancel?: () => void }} */
  let { documentId, section, onSaved, onCancel } = $props();

  let prose = $state(section?.prose ?? "");
  let saving = $state(false);
  let error = $state(null);
  let candidates = $state(null);
  let extractionError = $state(null);

  // Track when section changes (parent rebinds) → reset state.
  $effect(() => {
    if (section) {
      prose = section.prose ?? "";
      candidates = null;
      extractionError = null;
      error = null;
    }
  });

  const dirty = $derived(prose !== (section?.prose ?? ""));
  const charCount = $derived(prose.length);
  const tooLong = $derived(charCount > 20000);

  async function save() {
    if (!documentId || !section?.id) {
      error = "Section invalide";
      return;
    }
    if (tooLong) {
      error = `Prose trop longue (${charCount}/20000 chars)`;
      return;
    }
    saving = true;
    error = null;
    candidates = null;
    extractionError = null;
    try {
      const res = await api("/api/v2/protocol/extract", {
        method: "POST",
        body: JSON.stringify({
          document_id: documentId,
          section_id: section.id,
          prose,
        }),
      });
      candidates = Array.isArray(res?.candidates) ? res.candidates : [];
      extractionError = res?.extraction_error || null;
      onSaved?.(res);
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      saving = false;
    }
  }

  function cancel() {
    prose = section?.prose ?? "";
    error = null;
    candidates = null;
    extractionError = null;
    onCancel?.();
  }

  function confidenceBadgeClass(c) {
    if (typeof c !== "number") return "low";
    if (c >= 0.85) return "high";
    if (c >= 0.7) return "med";
    return "low";
  }
</script>

<div class="pse">
  <header class="pse-head">
    <div class="pse-section-meta">
      <span class="pse-kind">{section?.kind || "—"}</span>
      {#if section?.heading}
        <span class="pse-heading">{section.heading}</span>
      {/if}
    </div>
    <div class="pse-counter" class:over={tooLong}>
      {charCount} / 20000
    </div>
  </header>

  <textarea
    class="pse-textarea"
    class:dirty
    bind:value={prose}
    rows="14"
    placeholder="Écris la prose de cette section. Les artifacts (hard_check, pattern, etc.) seront recompilés à la sauvegarde."
    disabled={saving}
  ></textarea>

  <footer class="pse-actions">
    {#if error}
      <div class="pse-error">{error}</div>
    {/if}
    <div class="pse-spacer"></div>
    <button type="button" class="pse-btn" onclick={cancel} disabled={saving || !dirty}>
      Annuler
    </button>
    <button
      type="button"
      class="pse-btn pse-primary"
      onclick={save}
      disabled={saving || !dirty || tooLong}
    >
      {#if saving}
        <span class="pse-spinner" aria-hidden="true"></span>
        Extraction…
      {:else}
        Save + Extract
      {/if}
    </button>
  </footer>

  {#if candidates}
    <section class="pse-candidates" aria-label="Candidats extraits">
      <header class="pse-cand-head">
        <span>Candidats extraits</span>
        <span class="pse-cand-count">{candidates.length}</span>
        {#if extractionError}
          <span class="pse-cand-err">extraction partielle : {extractionError}</span>
        {/if}
      </header>
      {#if candidates.length === 0}
        <div class="pse-cand-empty">
          {extractionError ? "Aucun candidat (extraction a échoué)" : "Aucun candidat extrait — la prose est trop courte ou pas extractible."}
        </div>
      {:else}
        <ul class="pse-cand-list">
          {#each candidates as c (c.proposed_text)}
            <li class="pse-cand">
              <div class="pse-cand-row">
                <span class="pse-cand-tk">{c.target_kind}</span>
                <span class="pse-cand-intent">{c.intent}</span>
                <span class="pse-conf {confidenceBadgeClass(c.confidence)}">
                  {(c.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div class="pse-cand-text">{c.proposed_text}</div>
              {#if c.rationale}
                <div class="pse-cand-rationale">{c.rationale}</div>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="pse-cand-note">
          Acceptation explicite arrivera Task 4.3. Pour l'instant, le prose est sauvé ;
          ces candidats sont pour info.
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .pse {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    background: color-mix(in srgb, var(--ink) 2%, transparent);
  }
  .pse-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .pse-section-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .pse-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .pse-heading {
    font-size: var(--fs-small);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pse-counter {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }
  .pse-counter.over { color: var(--vermillon); }

  .pse-textarea {
    width: 100%;
    min-height: 220px;
    font-family: var(--font);
    font-size: var(--fs-small);
    line-height: 1.55;
    color: var(--ink);
    background: var(--bg, #fff);
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    padding: 10px 12px;
    resize: vertical;
    box-sizing: border-box;
  }
  .pse-textarea:focus {
    outline: none;
    border-color: var(--ink-40);
  }
  .pse-textarea.dirty {
    border-color: var(--ink-40);
  }

  .pse-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pse-spacer { flex: 1; }
  .pse-error {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--vermillon);
  }
  .pse-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    padding: 5px 12px;
    cursor: pointer;
    border-radius: 2px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .pse-btn:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--ink-40);
  }
  .pse-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .pse-btn.pse-primary {
    background: var(--ink);
    color: var(--bg, #fff);
    border-color: var(--ink);
  }
  .pse-btn.pse-primary:hover:not(:disabled) {
    background: var(--ink-70);
    border-color: var(--ink-70);
  }

  .pse-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: pse-spin 0.8s linear infinite;
  }
  @keyframes pse-spin {
    to { transform: rotate(360deg); }
  }

  /* Candidates */
  .pse-candidates {
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--rule-strong);
  }
  .pse-cand-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
  }
  .pse-cand-count {
    font-variant-numeric: tabular-nums;
    color: var(--ink-70);
  }
  .pse-cand-err {
    margin-left: auto;
    color: var(--vermillon);
    text-transform: none;
    letter-spacing: 0;
  }
  .pse-cand-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    padding: 8px 0;
  }
  .pse-cand-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pse-cand {
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    padding: 8px 10px;
    background: var(--bg, #fff);
  }
  .pse-cand-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .pse-cand-tk {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-70);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    padding: 1px 6px;
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pse-cand-intent {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
  }
  .pse-conf {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 1px 6px;
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
  }
  .pse-conf.high {
    color: #2e8a55;
    background: color-mix(in srgb, #2e8a55 14%, transparent);
  }
  .pse-conf.med {
    color: #b08010;
    background: color-mix(in srgb, #d0a248 14%, transparent);
  }
  .pse-conf.low {
    color: var(--ink-40);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .pse-cand-text {
    font-size: var(--fs-small);
    color: var(--ink);
    line-height: 1.5;
  }
  .pse-cand-rationale {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-style: italic;
  }
  .pse-cand-note {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    opacity: 0.8;
    font-style: italic;
  }
</style>
