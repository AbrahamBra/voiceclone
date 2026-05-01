<script>
  // Shim qui choisit entre l'UI Protocole legacy (rules atomiques) et la
  // nouvelle UI Doctrine + Registre (Chunk 3) selon la prop `useNewProtocolUi`.
  //
  // `useNewProtocolUi` est calculé côté serveur (+page.server.js) à partir
  // de l'env var NEW_PROTOCOL_UI_PERSONAS — voir lib/protocol-v2-feature-flag.js.
  //
  // Tab Doctrine = ProtocolDoctrine (TOC + prose + activity feed live).
  // Tab Registre = ProtocolRegistry (tableau transversal des artifacts).
  // Tab Propositions = ProtocolPropositionsQueue (Chunk 4 queue d'arbitrage).
  //
  // Quand le flag est off → on rend ProtocolPanelLegacy (zéro changement
  // de comportement pour les personas non-flaggées).

  import ProtocolPanelLegacy from "./ProtocolPanelLegacy.svelte";
  import ProtocolDoctrine from "./protocol-v2/ProtocolDoctrine.svelte";
  import ProtocolRegistry from "./protocol-v2/ProtocolRegistry.svelte";
  import ProtocolPropositionsQueue from "./protocol-v2/ProtocolPropositionsQueue.svelte";
  import SourcePlaybooksPanel from "./protocol-v2/SourcePlaybooksPanel.svelte";
  import { api } from "$lib/api.js";

  /** @type {{ personaId: string, useNewProtocolUi?: boolean }} */
  let { personaId, useNewProtocolUi = false } = $props();

  // New-UI tab state — lazy-initialised, only consumed when the flag is on.
  let activeView = $state("doctrine");

  // Shared lazy fetch of the protocol document : Registry needs sections,
  // Propositions tab needs document.id. We fetch once when the user switches
  // to either tab (Doctrine has its own internal fetch — too coupled to the
  // pulse / activity feed wiring to refactor right now).
  let docMeta = $state(/** @type {null | { id:string, sections:any[], pendingPropositionsCount:number }} */ (null));
  let metaLoading = $state(false);
  let metaError = $state(null);

  $effect(() => {
    if (useNewProtocolUi && (activeView === "registry" || activeView === "propositions") && personaId && !docMeta && !metaLoading) {
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

{#if !useNewProtocolUi}
  <ProtocolPanelLegacy {personaId} />
{:else}
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
      <span class="ppv2-flag" title="Nouveau Protocole — rollout flaggé">v2</span>
    </nav>

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
{/if}

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
  .ppv2-flag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--vermillon);
    background: color-mix(in srgb, var(--vermillon) 10%, transparent);
    padding: 1px 6px;
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
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
</style>
