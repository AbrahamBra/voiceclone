<script>
  // Brain page sub-panel : list + create source-specific playbooks.
  // Cf docs/superpowers/specs/2026-04-30-three-axes-protocol-design.md
  // V2 of the upload flow ; addresses the gap "no UI to add playbooks beyond
  // running scripts/seed-visite-profil-playbook.js manually".

  import { authHeaders } from "$lib/api.js";
  import { SOURCE_CORES, findSourceCore } from "$lib/source-core.js";

  /** @type {{ personaId: string }} */
  let { personaId } = $props();

  /** @type {Array<{ id:string, source_core:string, version:number, artifacts_count:number, sections_count:number, pending_propositions_count:number, created_at:string }> } */
  let playbooks = $state([]);
  let loading = $state(true);
  let listError = $state(null);

  let formOpen = $state(false);
  let formSourceCore = $state("");
  let formHeading = $state("");
  let formProse = $state("");
  let formSubmitting = $state(false);
  let formError = $state(null);
  let formResult = $state(/** @type {null | { document_id, artifacts_created, candidates_total, low_confidence_dropped, extraction_error?, extraction_skipped? }} */ (null));

  $effect(() => {
    if (!personaId) return;
    loadPlaybooks();
  });

  async function loadPlaybooks() {
    loading = true;
    listError = null;
    try {
      const resp = await fetch(`/api/v2/protocol/source-playbooks?persona=${personaId}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        listError = body.error || `HTTP ${resp.status}`;
        return;
      }
      const data = await resp.json();
      playbooks = data.playbooks || [];
    } catch (e) {
      listError = e?.message || String(e);
    } finally {
      loading = false;
    }
  }

  function openForm() {
    formOpen = true;
    formSourceCore = "";
    formHeading = "";
    formProse = "";
    formError = null;
    formResult = null;
  }

  function closeForm() {
    formOpen = false;
    formError = null;
    formResult = null;
  }

  async function submitForm() {
    formError = null;
    formResult = null;
    if (!formSourceCore) {
      formError = "Choisis une source.";
      return;
    }
    if (!formProse.trim()) {
      formError = "Colle le contenu du playbook (texte, markdown, doc Notion exporté…).";
      return;
    }
    formSubmitting = true;
    try {
      const resp = await fetch("/api/v2/protocol/source-playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          persona_id: personaId,
          source_core: formSourceCore,
          heading: formHeading || undefined,
          prose: formProse,
        }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        formError = body.error || `HTTP ${resp.status}`;
        if (resp.status === 409 && body.document_id) {
          formError += " (le document existant doit être archivé d'abord)";
        }
        return;
      }
      formResult = body;
      // Refresh the list so the new playbook appears.
      await loadPlaybooks();
    } catch (e) {
      formError = e?.message || String(e);
    } finally {
      formSubmitting = false;
    }
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  }

  function sourceLabel(id) {
    return findSourceCore(id)?.label || id;
  }
  function sourceHint(id) {
    return findSourceCore(id)?.hint || "";
  }
</script>

<div class="src-playbooks">
  <header class="src-head">
    <h2 class="src-title">Playbooks par source</h2>
    <p class="src-sub">
      Process opérationnel par origine de lead. S'ajoute au protocole global au moment du chat
      quand la conversation est taguée avec la même source.
    </p>
  </header>

  {#if !formOpen}
    <button type="button" class="cta" onclick={openForm} disabled={loading}>
      + Ajouter un playbook
    </button>
  {/if}

  {#if formOpen}
    <section class="form" aria-label="Nouveau playbook">
      <h3 class="form-h">Nouveau playbook</h3>

      <label class="field">
        <span class="field-label">Source</span>
        <select bind:value={formSourceCore} disabled={formSubmitting}>
          <option value="" disabled>— choisis une source —</option>
          {#each SOURCE_CORES as sc (sc.id)}
            <option value={sc.id}>{sc.label}</option>
          {/each}
        </select>
        {#if formSourceCore}
          <span class="field-hint">{sourceHint(formSourceCore)}</span>
        {/if}
      </label>

      <label class="field">
        <span class="field-label">Titre (optionnel)</span>
        <input
          type="text"
          bind:value={formHeading}
          disabled={formSubmitting}
          placeholder={formSourceCore ? `Playbook ${sourceLabel(formSourceCore)}` : "Playbook visite de profil"}
          maxlength="200"
        />
      </label>

      <label class="field">
        <span class="field-label">Contenu du playbook</span>
        <textarea
          bind:value={formProse}
          disabled={formSubmitting}
          placeholder="Colle le contenu de ton playbook (Notion exporté en markdown, texte libre…). L'extracteur en tirera des règles, templates, patterns. ~50k caractères max."
          rows="14"
        ></textarea>
        <span class="field-hint">{formProse.length} caractères</span>
      </label>

      {#if formError}
        <div class="form-err">{formError}</div>
      {/if}

      {#if formResult}
        <div class="form-ok">
          <strong>Playbook créé.</strong>
          {formResult.candidates_total} candidats extraits,
          <strong>{formResult.artifacts_created}</strong> artifacts persistés (confiance ≥ 0.75),
          {formResult.low_confidence_dropped} ignorés (confiance &lt; 0.75).
          {#if formResult.extraction_error}
            <br><span class="warn">⚠ Erreur extraction : {formResult.extraction_error} — le doc + le texte ont été sauvegardés. Tu peux ré-éditer plus tard.</span>
          {/if}
          {#if formResult.extraction_skipped}
            <br><span class="warn">Extraction désactivée (kill-switch). Doc + section sauvegardés sans artifacts.</span>
          {/if}
        </div>
      {/if}

      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick={closeForm} disabled={formSubmitting}>
          {formResult ? "Fermer" : "Annuler"}
        </button>
        {#if !formResult}
          <button type="button" class="btn-primary" onclick={submitForm} disabled={formSubmitting}>
            {formSubmitting ? "Création + extraction…" : "Créer le playbook"}
          </button>
        {/if}
      </div>
    </section>
  {/if}

  <section class="list" aria-label="Playbooks existants">
    {#if loading}
      <div class="loading">Chargement…</div>
    {:else if listError}
      <div class="err">Erreur : {listError}</div>
    {:else if playbooks.length === 0}
      <div class="empty">
        Aucun playbook source-spécifique pour l'instant. Le chat utilise le protocole global seul.
      </div>
    {:else}
      <ul class="rows">
        {#each playbooks as pb (pb.id)}
          <li class="row">
            <div class="row-main">
              <div class="row-label">{sourceLabel(pb.source_core)}</div>
              <div class="row-hint">{sourceHint(pb.source_core)}</div>
            </div>
            <div class="row-meta">
              <span class="meta">v{pb.version}</span>
              <span class="meta">{pb.artifacts_count} artifacts</span>
              {#if pb.pending_propositions_count > 0}
                <span class="meta meta-warn">{pb.pending_propositions_count} en attente</span>
              {/if}
              <span class="meta meta-date">{fmtDate(pb.created_at)}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .src-playbooks {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 14px 16px;
    font-family: var(--font-ui);
    color: var(--ink);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .src-head {
    border-bottom: 1px solid var(--rule);
    padding-bottom: 10px;
  }
  .src-title {
    font-family: var(--font);
    font-size: var(--fs-h3);
    font-weight: var(--fw-semi);
    margin: 0 0 4px;
  }
  .src-sub {
    margin: 0;
    font-size: var(--fs-small);
    color: var(--ink-70);
    line-height: var(--lh-normal);
  }

  .cta {
    align-self: flex-start;
    padding: 6px 12px;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-small);
    cursor: pointer;
    transition: background 0.08s linear;
  }
  .cta:hover:not(:disabled) {
    background: var(--paper-subtle);
  }
  .cta:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
  }
  .form-h {
    margin: 0;
    font-family: var(--font);
    font-size: var(--fs-standout);
    font-weight: var(--fw-semi);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font-size: var(--fs-small);
    color: var(--ink-70);
    font-weight: var(--fw-medium);
  }
  .field-hint {
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .field select,
  .field input,
  .field textarea {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink);
    border-radius: 0;
  }
  .field textarea {
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    line-height: var(--lh-normal);
    resize: vertical;
    min-height: 200px;
  }

  .form-err {
    font-size: var(--fs-small);
    color: var(--vermillon);
    background: color-mix(in srgb, var(--vermillon) 8%, transparent);
    padding: 8px;
    border-left: 2px solid var(--vermillon);
  }
  .form-ok {
    font-size: var(--fs-small);
    color: var(--ink);
    background: color-mix(in srgb, var(--success, #2d7a3e) 10%, transparent);
    padding: 8px;
    border-left: 2px solid var(--success, #2d7a3e);
    line-height: var(--lh-normal);
  }
  .form-ok .warn {
    color: var(--warning, #b87300);
  }
  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .btn-primary,
  .btn-secondary {
    padding: 6px 14px;
    font: inherit;
    font-size: var(--fs-small);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    transition: background 0.08s linear;
  }
  .btn-primary {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--ink-70);
  }
  .btn-secondary {
    background: var(--paper);
    color: var(--ink);
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--paper-subtle);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .list {
    display: flex;
    flex-direction: column;
  }
  .loading, .err, .empty {
    padding: 12px;
    font-size: var(--fs-small);
    color: var(--ink-40);
    font-style: italic;
  }
  .err { color: var(--vermillon); }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--rule);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 4px;
    border-bottom: 1px dashed var(--rule);
  }
  .row-main {
    flex: 1;
    min-width: 0;
  }
  .row-label {
    font-weight: var(--fw-medium);
  }
  .row-hint {
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .row-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-70);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .meta-warn {
    color: var(--warning, #b87300);
  }
  .meta-date {
    color: var(--ink-40);
  }
</style>
