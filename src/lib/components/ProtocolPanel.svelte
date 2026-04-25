<script>
  // Shim qui choisit entre l'UI Protocole legacy (rules atomiques) et la
  // nouvelle UI Doctrine + Registre (Chunk 3) selon la prop `useNewProtocolUi`.
  //
  // `useNewProtocolUi` est calculé côté serveur (+page.server.js) à partir
  // de l'env var NEW_PROTOCOL_UI_PERSONAS — voir lib/protocol-v2-feature-flag.js.
  //
  // Tab Doctrine = ProtocolDoctrine (TOC + prose + activity feed live).
  // Tab Registre = ProtocolRegistry (tableau transversal des artifacts).
  //
  // Quand le flag est off → on rend ProtocolPanelLegacy (zéro changement
  // de comportement pour les personas non-flaggées).

  import ProtocolPanelLegacy from "./ProtocolPanelLegacy.svelte";
  import ProtocolDoctrine from "./protocol-v2/ProtocolDoctrine.svelte";
  import ProtocolRegistry from "./protocol-v2/ProtocolRegistry.svelte";
  import { api } from "$lib/api.js";

  /** @type {{ personaId: string, useNewProtocolUi?: boolean }} */
  let { personaId, useNewProtocolUi = false } = $props();

  // New-UI tab state — lazy-initialised, only consumed when the flag is on.
  let activeView = $state("doctrine");

  // Registry needs the sections+artifacts list. We fetch it here once when
  // the user switches to Registry view to avoid duplicating the doctrine
  // fetch (which has its own internal load).
  let registrySections = $state(null);
  let registryLoading = $state(false);
  let registryError = $state(null);

  $effect(() => {
    if (useNewProtocolUi && activeView === "registry" && personaId && !registrySections && !registryLoading) {
      loadRegistry();
    }
  });

  async function loadRegistry() {
    registryLoading = true;
    registryError = null;
    try {
      const data = await api(`/api/v2/protocol?persona=${personaId}`);
      registrySections = data.sections || [];
    } catch (e) {
      registryError = e?.message || String(e);
    } finally {
      registryLoading = false;
    }
  }

  function jumpToSection(sectionId) {
    activeView = "doctrine";
    setTimeout(() => {
      const el = window.document.getElementById(`pd-section-${sectionId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function selectArtifact(_artifactId) {
    // Future hook for Chunk 4 — pour l'instant on ne fait rien (le clic
    // sur une row du Registre ne devrait pas ouvrir un panel détail
    // tant que celui-ci n'existe pas).
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
      <span class="ppv2-flag" title="Nouveau Protocole — rollout flaggé">v2</span>
    </nav>

    <div class="ppv2-body">
      {#if activeView === "doctrine"}
        <ProtocolDoctrine {personaId} />
      {:else if registryLoading}
        <div class="ppv2-loading">Chargement du registre…</div>
      {:else if registryError}
        <div class="ppv2-error">Erreur : {registryError}</div>
      {:else if registrySections}
        <ProtocolRegistry
          sections={registrySections}
          onJumpToSection={jumpToSection}
          onSelectArtifact={selectArtifact}
        />
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
