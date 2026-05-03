<script>
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  // Brain V1 — single page scroll, 4 sections empilées :
  //   Arbitrages → Propositions → Doctrine (collapsed) → Sources (collapsed)
  // Plan : docs/superpowers/plans/2026-05-04-brain-v1-realignment-mockup.md
  // Mockup canonique : docs/mockups/brain-refonte-2026-05-03.html

  import BrainStatusBanner from "$lib/components/brain/BrainStatusBanner.svelte";
  import BrainNoteStrip from "$lib/components/brain/BrainNoteStrip.svelte";
  import CollapsibleSection from "$lib/components/brain/CollapsibleSection.svelte";
  import ContradictionsList from "$lib/components/brain/ContradictionsList.svelte";
  import BatchBar from "$lib/components/brain/BatchBar.svelte";
  import PropositionsList from "$lib/components/brain/PropositionsList.svelte";
  import ApiKeysPanel from "$lib/components/ApiKeysPanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";

  let { data } = $props();
  let personaSlug = $derived(data.personaId);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  // personaConfig : si déjà set pour ce slug, skip ; sinon fetch.
  // Note : /api/config response n'inclut pas `slug` → on stocke le slug en clé locale.
  let personaConfigLoading = $state(false);
  let personaConfigError = $state(null);
  let lastFetchedSlug = $state(null);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!personaSlug) return;
    if (lastFetchedSlug === personaSlug) return;
    lastFetchedSlug = personaSlug;
    personaConfigLoading = true;
    personaConfigError = null;
    fetch(`/api/config?persona=${personaSlug}`, { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`/api/config ${r.status} : ${txt.slice(0, 200) || r.statusText}`);
        }
        return r.json();
      })
      .then(cfg => { personaConfig.set(cfg); })
      .catch(e => {
        console.error("[brain/personaConfig] fetch failed:", e);
        personaConfigError = e.message || "fetch failed";
        showToast(`Persona config : ${personaConfigError}`, "error");
      })
      .finally(() => { personaConfigLoading = false; });
  });

  let personaUuid = $derived($personaConfig?.id || null);

  // ── State : counts, contradictions, propositions, distribution, protocol, sources ──

  let counts = $state(null);
  let documentId = $state(null);
  let countsLoading = $state(false);
  let countsError = $state(null);
  async function loadCounts() {
    if (!personaUuid) return;
    countsLoading = true;
    countsError = null;
    try {
      const data = await api(`/api/v2/brain-status?persona=${personaUuid}`);
      counts = data.counts;
      documentId = data.document_id || null;
    } catch (e) {
      console.error("[brain/counts] fetch failed:", e, "personaUuid=", personaUuid);
      countsError = e.message || "erreur";
      showToast(`Status banner : ${countsError}`, "error");
    } finally { countsLoading = false; }
  }
  $effect(() => { if (personaUuid) loadCounts(); });

  let contradictions = $state([]);
  let contradictionsLoading = $state(false);
  async function loadContradictions() {
    if (!personaUuid) return;
    contradictionsLoading = true;
    try {
      const data = await api(`/api/v2/contradictions?persona=${personaUuid}&status=open`);
      contradictions = data.contradictions || [];
    } catch (e) {
      console.error("[brain/contradictions] fetch failed:", e);
      showToast(`Contradictions : ${e.message || "erreur"}`, "error");
    } finally { contradictionsLoading = false; }
  }
  $effect(() => { if (personaUuid) loadContradictions(); });

  // ── Propositions : pending list (filtered client-side via BatchBar) ──
  let allPendingProps = $state([]);
  let propsLoading = $state(false);
  async function loadPropositions() {
    if (!documentId) return;
    propsLoading = true;
    try {
      const data = await api(`/api/v2/propositions?document=${documentId}&status=pending`);
      allPendingProps = data.propositions || [];
    } catch (e) {
      console.error("[brain/propositions] fetch failed:", e);
      showToast(`Propositions : ${e.message || "erreur"}`, "error");
    } finally { propsLoading = false; }
  }
  $effect(() => { if (documentId) loadPropositions(); });

  // ── Distribution (precomputed buckets pour le slider BatchBar) ──
  let distribution = $state(null);
  async function loadDistribution() {
    if (!personaUuid) return;
    try {
      const data = await api(`/api/v2/propositions-distribution?persona=${personaUuid}`);
      distribution = data.distribution;
    } catch (e) {
      console.error("[brain/distribution] fetch failed:", e);
      // Pas de toast — la BatchBar fonctionne en mode dégradé sans distribution
    }
  }
  $effect(() => { if (personaUuid) loadDistribution(); });

  // ── Filters (parent-owned) ──
  let propFilters = $state({ target_kind: null, source_group: null, confidence_min: 0.85 });
  const PROPS_DISPLAY_LIMIT = 30;

  let filteredProps = $derived(() => {
    if (!allPendingProps.length) return [];
    return allPendingProps
      .filter(p => {
        if (propFilters.target_kind && p.target_kind !== propFilters.target_kind) return false;
        if ((p.confidence ?? 0) < propFilters.confidence_min - 1e-9) return false;
        return true;
      })
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  });

  let displayedProps = $derived(() => filteredProps().slice(0, PROPS_DISPLAY_LIMIT));
  let filteredTotal = $derived(() => filteredProps().length);

  async function handlePropAction(id, action) {
    try {
      const body = { action, id };
      await api(`/api/v2/propositions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      // Optimistic : retirer de la liste pending locale
      allPendingProps = allPendingProps.filter(p => p.id !== id);
      showToast(`Proposition ${action === "accept" ? "acceptée" : action === "reject" ? "rejetée" : "à éditer"}.`, "info");
      // Refresh counts en background
      loadCounts();
      loadDistribution();
    } catch (e) {
      console.error("[brain/propAction] failed:", e);
      showToast(`Action proposition : ${e.message || "erreur"}`, "error");
    }
  }

  function handleBatchAccept() {
    showToast("Batch accept : confirm modal arrive en Step 11.", "info");
  }
  function handleBatchReject() {
    showToast("Batch reject : confirm modal arrive en Step 11.", "info");
  }
  function handleSeeAllProps() {
    propsCollapsed = false;
    showToast(`${filteredTotal()} propositions au total. Vue paginée arrive en V1.1.`, "info");
  }

  // Section navigation (cell click = scroll to + force expand).
  // Each CollapsibleSection has an id ; scrollIntoView gère le scroll.
  // Pour expand depuis collapsed, on relit l'URL hash plus tard. V1 minimal :
  // les sections sont default-expanded sauf Doctrine et Sources, et le banner
  // ne scrolle que vers les 2 premières (qui sont toujours expanded).
  function handleCellClick(cellId) {
    const targetId = {
      contradictions: "arb",
      propositions: "props",
      merged: "props",
      doctrine: "doctrine",
    }[cellId];
    if (!targetId) return;
    expandAndScrollTo(targetId);
  }

  function handleImportClick() {
    showToast("Upload doc : ouvre le panneau Sources ou utilise ⚙ → Sources.", "info");
  }

  // ── URL hash deep linking : #arb / #props / #doctrine / #sources ──
  // Bindable collapsed state per section + initial hash override.
  let arbCollapsed = $state(false);
  let propsCollapsed = $state(false);
  let doctrineCollapsed = $state(true);
  let sourcesCollapsed = $state(true);

  $effect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    if (hash === "arb") { arbCollapsed = false; }
    else if (hash === "props") { propsCollapsed = false; }
    else if (hash === "doctrine") { doctrineCollapsed = false; }
    else if (hash === "sources") { sourcesCollapsed = false; }
    requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Status banner cell click → force-expand target + scroll.
  function expandAndScrollTo(targetId) {
    if (typeof window === "undefined") return;
    if (targetId === "arb") arbCollapsed = false;
    else if (targetId === "props") propsCollapsed = false;
    else if (targetId === "doctrine") doctrineCollapsed = false;
    else if (targetId === "sources") sourcesCollapsed = false;
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ── ⚙ menu (popover existant V1 — décision plan v2 patché : pas de route /settings) ──
  let menuOpen = $state(false);
  let menuTab = $state(null);
  function openMenu(tab) { menuTab = tab; menuOpen = true; }
  function closeMenu() { menuOpen = false; menuTab = null; }

  function goBack() {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) history.back();
    else goto(`/chat/${personaSlug}`);
  }
</script>

<svelte:head><title>Cerveau de {$personaConfig?.name || "Clone"}</title></svelte:head>

<div class="brain-page">
  <header class="brain-head">
    <button class="back-btn" onclick={goBack} aria-label="Retour">← retour</button>
    <div class="title">
      <span class="avatar">{$personaConfig?.avatar || "?"}</span>
      <h1>Cerveau de {$personaConfig?.name || "Clone"}</h1>
      {#if $personaConfig?.maturity_level}<span class="level">{$personaConfig.maturity_level}</span>{/if}
    </div>
    <div class="head-actions">
      <button class="gear" onclick={() => openMenu("integrations")} title="Intégrations + réglages" aria-label="Menu">⚙</button>
    </div>
  </header>

  {#if personaConfigError}
    <div class="page-error">
      <strong>Persona config introuvable.</strong> {personaConfigError}
      <button class="retry" onclick={() => { lastFetchedSlug = null; }}>réessayer</button>
    </div>
  {/if}

  <BrainStatusBanner {counts} loading={countsLoading} onCellClick={handleCellClick} onImportClick={handleImportClick} />

  {#if countsError && !counts}
    <div class="page-error subtle">
      <strong>Counts banner :</strong> {countsError}
      <button class="retry" onclick={loadCounts}>réessayer</button>
    </div>
  {/if}

  <CollapsibleSection
    id="arb"
    title="Arbitrages"
    count={counts ? `${counts.contradictions_open} contradictions` : null}
    countAlert={counts ? counts.contradictions_open > 0 : false}
    bind:collapsed={arbCollapsed}
  >
    <BrainNoteStrip>
      <strong>Pourquoi cette liste ?</strong> Pour chaque paire ci-dessous, le système a détecté que les 2 propositions disent l'inverse. Si tu acceptes les 2, le clone reçoit des règles incompatibles. Choisis laquelle garder.
    </BrainNoteStrip>
    <ContradictionsList contradictions={contradictions} loading={contradictionsLoading} onResolve={null} />
  </CollapsibleSection>

  <CollapsibleSection
    id="props"
    title="Propositions"
    count={counts ? `${counts.propositions_pending} pending · ${counts.auto_merged} auto-mergées` : null}
    bind:collapsed={propsCollapsed}
  >
    <BatchBar
      filters={propFilters}
      {distribution}
      onFilterChange={(f) => propFilters = f}
      onBatchAccept={handleBatchAccept}
      onBatchReject={handleBatchReject}
    />
    <p class="hint">
      Bouge le slider à 0.95 pour les ultra-fiables, ou descend à 0.70 pour élargir.
      {#if counts}Les paires synonymes déjà mergées ({counts.auto_merged}) ne sont pas comptées.{/if}
    </p>
    {#if propsLoading && allPendingProps.length === 0}
      <p class="placeholder">Chargement des propositions…</p>
    {:else}
      <PropositionsList
        propositions={displayedProps()}
        total={filteredTotal()}
        onAction={handlePropAction}
        onSeeAll={handleSeeAllProps}
      />
    {/if}
  </CollapsibleSection>

  <CollapsibleSection
    id="doctrine"
    title="Doctrine"
    count={counts ? `${counts.doctrine_sections_total} sections · ${counts.doctrine_sections_filled} remplies` : null}
    bind:collapsed={doctrineCollapsed}
  >
    <p class="placeholder">
      DoctrineGrid (7 cells) arrive dans Step 12 (plan v2).
    </p>
  </CollapsibleSection>

  <CollapsibleSection
    id="sources"
    title="Sources"
    count={null}
    bind:collapsed={sourcesCollapsed}
  >
    <p class="placeholder">
      SourcesTable arrive dans Step 13-14 (plan v2).
    </p>
  </CollapsibleSection>

  <footer class="brain-footer">
    <span class="footer-meta">4 sections · 1 page · scroll</span>
    <button class="footer-link" onclick={() => openMenu("integrations")}>⚙ réglages + intégrations</button>
  </footer>
</div>

{#if menuOpen}
  <div class="menu-overlay" role="dialog" aria-modal="true" onclick={closeMenu} onkeydown={(e) => e.key === "Escape" && closeMenu()}>
    <div class="menu-panel" onclick={(e) => e.stopPropagation()} role="document">
      <header class="menu-head">
        <div class="menu-tabs">
          <button class="menu-tab" class:active={menuTab === "integrations"} onclick={() => menuTab = "integrations"}>intégrations</button>
          <button class="menu-tab" class:active={menuTab === "reglages"} onclick={() => menuTab = "reglages"}>réglages</button>
        </div>
        <button class="menu-close" onclick={closeMenu} aria-label="Fermer">✕</button>
      </header>
      <div class="menu-body">
        {#if menuTab === "integrations"}<ApiKeysPanel personaId={personaUuid} />
        {:else if menuTab === "reglages"}<SettingsPanel embedded={true} personaId={personaUuid} onClose={closeMenu} />{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .brain-page { max-width: 1180px; margin: 0 auto; padding: 24px 28px 80px; min-height: 100dvh; }
  .brain-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid var(--rule); gap: 16px; }
  .brain-head .title { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; }
  .title .avatar { font-size: 24px; }
  .title h1 { margin: 0; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; font-family: var(--font, Georgia, serif); }
  .level { font-family: var(--font-mono); font-size: 10px; color: var(--ink-40); padding: 2px 6px; border: 1px solid var(--rule-strong); border-radius: 2px; }
  .back-btn { background: transparent; border: 1px solid var(--rule-strong); padding: 6px 10px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); cursor: pointer; border-radius: 2px; }
  .back-btn:hover { color: var(--ink); }
  .gear { background: transparent; border: 1px solid var(--rule-strong); padding: 7px 9px; cursor: pointer; border-radius: 2px; font-size: 14px; }
  .gear:hover { background: var(--paper-subtle, #ecebe4); }

  .page-error {
    margin-top: 14px;
    padding: 11px 14px;
    background: var(--paper-subtle, #ecebe4);
    border-left: 3px solid var(--vermillon);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-70);
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }
  .page-error.subtle { border-left-color: var(--ink-40); }
  .page-error .retry {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
    border-radius: 2px;
    color: var(--ink-70);
  }
  .page-error .retry:hover { background: var(--paper); color: var(--ink); }

  .placeholder {
    margin: 14px 0 0;
    padding: 18px;
    background: var(--paper-subtle, #ecebe4);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    text-align: center;
    border: 1px dashed var(--rule-strong);
  }

  .hint {
    margin-top: 8px;
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    letter-spacing: 0.02em;
  }

  .brain-footer {
    margin-top: 60px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
  }
  .footer-link {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
    color: var(--ink-70);
  }
  .footer-link:hover { background: var(--paper-subtle, #ecebe4); color: var(--ink); }

  .menu-overlay { position: fixed; inset: 0; background: rgba(20, 20, 26, 0.4); display: flex; align-items: flex-start; justify-content: center; padding: 60px 16px; z-index: 100; }
  .menu-panel { background: var(--paper); border: 1px solid var(--rule-strong); border-radius: 4px; width: 100%; max-width: 720px; max-height: 80dvh; display: flex; flex-direction: column; overflow: hidden; }
  .menu-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--rule); }
  .menu-tabs { display: flex; gap: 12px; }
  .menu-tab { background: transparent; border: none; padding: 6px 8px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); cursor: pointer; border-bottom: 2px solid transparent; }
  .menu-tab.active { color: var(--ink); border-bottom-color: var(--vermillon); font-weight: 600; }
  .menu-close { background: transparent; border: 1px solid var(--rule-strong); padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 12px; color: var(--ink-40); }
  .menu-close:hover { color: var(--ink); }
  .menu-body { padding: 16px; overflow-y: auto; }

  @media (max-width: 700px) {
    .brain-page { padding: 16px 16px 60px; }
    .title h1 { font-size: 18px; }
  }
</style>
