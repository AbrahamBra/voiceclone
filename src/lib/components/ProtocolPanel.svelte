<script>
  // Vue Protocole v2 : Doctrine + Registre + Propositions + Playbooks.
  // Tab Doctrine = ProtocolDoctrine (TOC + prose + activity feed live).
  // Tab Registre = ProtocolRegistry (tableau transversal des artifacts).
  // Tab Propositions = ProtocolPropositionsQueue (queue d'arbitrage).
  // Tab Playbooks = SourcePlaybooksPanel (playbooks par source).

  import ProtocolDoctrine from "./protocol-v2/ProtocolDoctrine.svelte";
  import ProtocolRegistry from "./protocol-v2/ProtocolRegistry.svelte";
  import ProtocolPropositionsQueue from "./protocol-v2/ProtocolPropositionsQueue.svelte";
  import SourcePlaybooksPanel from "./protocol-v2/SourcePlaybooksPanel.svelte";
  import { api } from "$lib/api.js";
  import { extractFileText } from "$lib/file-extraction.js";
  import { showToast } from "$lib/stores/ui.js";

  /** @type {{ personaId: string }} */
  let { personaId } = $props();

  let activeView = $state("doctrine");

  // ── Import document → propositions across all 6 sections ──────────
  // Drives the "Importer un doc" button in the header. Two-step UX :
  //   1. Click "+ importer un doc" → opens a doc-kind picker (5 options
  //      mapped to KIND_ROUTING in api/v2/protocol/import-doc.js).
  //   2. Pick a kind → file picker. Reads file (txt / md / pdf / docx /
  //      odt), POSTs to /api/v2/protocol/import-doc, then jumps to the
  //      Propositions tab so the user can arbitrate.
  // Doc-kind drives where the content lands :
  //   persona_context     → identity prose direct, 0 propositions
  //   operational_playbook→ all 6 extractors via LLM router (default)
  //   icp_audience        → only icp_patterns + process extractors
  //   positioning         → identity prose AND process + icp_patterns
  //   generic             → router decides (same as operational_playbook)
  const DOC_KINDS = [
    { value: "operational_playbook", label: "Playbook opérationnel",  hint: "Process setting / procédure DM. Tape les 6 sections." },
    { value: "persona_context",      label: "Contexte persona",       hint: "Bio / parcours / convictions / ton. Atterrit dans Identité." },
    { value: "icp_audience",         label: "ICP / audience cible",   hint: "P1/P2, exclusions, secteurs. Cible icp_patterns + process." },
    { value: "positioning",          label: "Positionnement",         hint: "USP, pain points, offre. Identité + process + icp." },
    { value: "generic",              label: "Autre / je ne sais pas", hint: "Le routeur LLM décide chunk par chunk." },
  ];

  let importInputEl;
  let importing = $state(false);
  let pendingDocKind = $state(/** @type {string|null} */(null));
  let kindPickerOpen = $state(false);
  let importBatchSummary = $state(/** @type {null|{filename:string, kind:string, created:number, merged:number, silenced:number, identity:boolean}} */(null));

  function onImportClick() {
    if (importing) return;
    kindPickerOpen = true;
  }

  function onCancelKindPicker() {
    kindPickerOpen = false;
    pendingDocKind = null;
  }

  function onPickKind(kind) {
    pendingDocKind = kind;
    kindPickerOpen = false;
    // Defer to the next tick so the modal close paints before the OS file
    // dialog steals focus — feels less abrupt to the user.
    setTimeout(() => importInputEl?.click(), 30);
  }

  async function onImportFile(e) {
    const file = e.target?.files?.[0];
    e.target.value = "";
    if (!file) {
      pendingDocKind = null;
      return;
    }
    const docKind = pendingDocKind || "generic";
    pendingDocKind = null;
    importing = true;
    importBatchSummary = null;
    try {
      const text = await extractFileText(file);
      if (!text || !text.trim()) {
        showToast("Document vide ou illisible");
        return;
      }
      const out = await api("/api/v2/protocol/import-doc", {
        method: "POST",
        body: JSON.stringify({
          persona_id: personaId,
          doc_text: text,
          doc_filename: file.name,
          doc_kind: docKind,
        }),
      });
      importBatchSummary = {
        filename: file.name,
        kind: out.doc_kind || docKind,
        created: out.propositions_created || 0,
        merged: out.propositions_merged || 0,
        silenced: out.silenced || 0,
        identity: !!out.identity_appended,
      };
      // Refresh meta so the Propositions badge picks up the new pending count.
      docMeta = null;
      await loadMeta();
      // For pure persona_context (0 propositions, only identity append) we
      // want the user to see the doctrine view, not an empty queue.
      activeView = importBatchSummary.created > 0 ? "propositions" : "doctrine";
    } catch (err) {
      showToast(`Import échoué : ${err?.message || "erreur inconnue"}`);
    } finally {
      importing = false;
    }
  }

  // Shared lazy fetch of the protocol document : Registry needs sections,
  // Propositions tab needs document.id. We fetch once when the user switches
  // to either tab (Doctrine has its own internal fetch — too coupled to the
  // pulse / activity feed wiring to refactor right now).
  let docMeta = $state(/** @type {null | { id:string, sections:any[], pendingPropositionsCount:number }} */ (null));
  let metaLoading = $state(false);
  let metaError = $state(null);

  $effect(() => {
    if ((activeView === "registry" || activeView === "propositions") && personaId && !docMeta && !metaLoading) {
      loadMeta();
    }
  });

  async function loadMeta() {
    metaLoading = true;
    metaError = null;
    try {
      const data = await api(`/api/v2/protocol?persona=${personaId}`);
      docMeta = {
        id: data?.document?.id || null,
        sections: data?.sections || [],
        pendingPropositionsCount: data?.pendingPropositionsCount || 0,
      };
    } catch (e) {
      metaError = e?.message || String(e);
    } finally {
      metaLoading = false;
    }
  }

  function jumpToSection(sectionId) {
    activeView = "doctrine";
    setTimeout(() => {
      const el = window.document.getElementById(`pd-section-${sectionId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

</script>

<div class="ppv2">
  <nav class="ppv2-tabs" aria-label="Vue protocole">
    <button
      type="button"
      class="ppv2-tab"
      class:active={activeView === "doctrine"}
      onclick={() => (activeView = "doctrine")}
    >Doctrine</button>
    <button
      type="button"
      class="ppv2-tab"
      class:active={activeView === "registry"}
      onclick={() => (activeView = "registry")}
    >Registre</button>
    <button
      type="button"
      class="ppv2-tab"
      class:active={activeView === "propositions"}
      onclick={() => (activeView = "propositions")}
    >
      Propositions
      {#if docMeta?.pendingPropositionsCount}
        <span class="ppv2-tab-count">{docMeta.pendingPropositionsCount}</span>
      {/if}
    </button>
    <button
      type="button"
      class="ppv2-tab"
      class:active={activeView === "playbooks"}
      onclick={() => (activeView = "playbooks")}
    >Playbooks</button>

    <span class="ppv2-spacer"></span>

    <button
      type="button"
      class="ppv2-import"
      disabled={importing}
      onclick={onImportClick}
      title="Lit un .txt / .md / .pdf / .docx / .odt et l'éclate en propositions par section"
    >
      {importing ? "Import en cours…" : "+ importer un doc"}
    </button>
    <input
      type="file"
      bind:this={importInputEl}
      accept=".txt,.md,.csv,.pdf,.docx,.odt"
      style="display:none"
      onchange={onImportFile}
    />
  </nav>

  {#if kindPickerOpen}
    <div class="ppv2-kind-picker" role="dialog" aria-label="Type de document">
      <p class="ppv2-kind-picker-title">De quel type de document s'agit-il ?</p>
      <p class="ppv2-kind-picker-hint">Le type guide l'extraction — où chaque morceau atterrit dans le protocole.</p>
      <ul class="ppv2-kind-list">
        {#each DOC_KINDS as k (k.value)}
          <li>
            <button type="button" class="ppv2-kind-item" onclick={() => onPickKind(k.value)}>
              <span class="ppv2-kind-label">{k.label}</span>
              <span class="ppv2-kind-hint">{k.hint}</span>
            </button>
          </li>
        {/each}
      </ul>
      <button type="button" class="ppv2-kind-cancel" onclick={onCancelKindPicker}>annuler</button>
    </div>
  {/if}

  {#if importBatchSummary}
    <div class="ppv2-import-summary" role="status" aria-live="polite">
      <strong>{importBatchSummary.filename}</strong> ({importBatchSummary.kind}) —
      {#if importBatchSummary.identity}
        identité enrichie ·
      {/if}
      {importBatchSummary.created} proposition{importBatchSummary.created > 1 ? "s" : ""} créée{importBatchSummary.created > 1 ? "s" : ""},
      {importBatchSummary.merged} fusionnée{importBatchSummary.merged > 1 ? "s" : ""},
      {importBatchSummary.silenced} silencée{importBatchSummary.silenced > 1 ? "s" : ""} (confiance trop basse).
      <button type="button" class="ppv2-import-summary-close" onclick={() => (importBatchSummary = null)} aria-label="Fermer">×</button>
    </div>
  {/if}

  <div class="ppv2-body">
    {#if activeView === "doctrine"}
      <ProtocolDoctrine {personaId} />
    {:else if activeView === "playbooks"}
      <SourcePlaybooksPanel {personaId} />
    {:else if metaLoading}
      <div class="ppv2-loading">Chargement…</div>
    {:else if metaError}
      <div class="ppv2-error">Erreur : {metaError}</div>
    {:else if !docMeta}
      <div class="ppv2-loading">Initialisation…</div>
    {:else if activeView === "registry"}
      <ProtocolRegistry
        sections={docMeta.sections}
        onJumpToSection={jumpToSection}
      />
    {:else if activeView === "propositions"}
      {#if docMeta.id}
        <ProtocolPropositionsQueue
          documentId={docMeta.id}
          onResolved={() => {
            // Decrement the pending counter shown on the tab badge so it
            // stays in sync with the queue after each accept/revise/reject.
            if (docMeta && docMeta.pendingPropositionsCount > 0) {
              docMeta.pendingPropositionsCount = docMeta.pendingPropositionsCount - 1;
            }
          }}
        />
      {:else}
        <div class="ppv2-error">Aucun document de protocole actif pour cette persona.</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .ppv2 {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .ppv2-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .ppv2-tab {
    background: transparent;
    border: 1px solid transparent;
    border-bottom: 2px solid transparent;
    padding: 4px 12px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ppv2-tab:hover { color: var(--ink-70); }
  .ppv2-tab.active {
    color: var(--ink);
    border-bottom-color: var(--ink);
  }
  .ppv2-tab-count {
    display: inline-block;
    margin-left: 4px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--vermillon);
    color: var(--bg, #fff);
    font-size: var(--fs-nano);
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }
  .ppv2-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ppv2-loading, .ppv2-error {
    padding: 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .ppv2-error { color: var(--vermillon); }
  .ppv2-spacer { flex: 1; }
  .ppv2-import {
    background: transparent;
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ppv2-import:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--ink);
  }
  .ppv2-import:disabled { opacity: 0.55; cursor: progress; }
  .ppv2-import-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--bg-soft, rgba(0,0,0,0.04));
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
  }
  .ppv2-import-summary strong { color: var(--ink); font-weight: 600; }
  .ppv2-import-summary-close {
    margin-left: auto;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--ink-40);
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
  }
  .ppv2-import-summary-close:hover { color: var(--ink); }

  .ppv2-kind-picker {
    border-bottom: 1px solid var(--rule);
    padding: 14px 16px;
    background: var(--bg-soft, rgba(0,0,0,0.03));
  }
  .ppv2-kind-picker-title {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    color: var(--ink);
  }
  .ppv2-kind-picker-hint {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .ppv2-kind-list {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ppv2-kind-item {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ppv2-kind-item:hover {
    background: var(--bg, #fff);
    border-color: var(--ink);
  }
  .ppv2-kind-label {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    color: var(--ink);
  }
  .ppv2-kind-hint {
    font-family: var(--font-sans, system-ui);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .ppv2-kind-cancel {
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 0;
  }
  .ppv2-kind-cancel:hover { color: var(--ink); }
</style>
