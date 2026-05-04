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
  import DoctrineGrid from "$lib/components/brain/DoctrineGrid.svelte";
  import SourcesTable from "$lib/components/brain/SourcesTable.svelte";
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

  // ── Batch confirm modal ──
  let batchModalOpen = $state(false);
  let batchModalAction = $state(null);     // 'accept' | 'reject'
  let batchModalLoading = $state(false);
  let batchModalMatched = $state(0);
  let batchModalSample = $state([]);
  let batchModalError = $state(null);
  // V1.1 batch accept : progress per-item pour la boucle séquentielle.
  // current=0/total=0 quand pas de batch en cours.
  let batchProgress = $state({ current: 0, total: 0 });
  let batchAcceptErrors = $state(/** @type {Array<{id: string, message: string}>} */ ([]));

  function closeBatchModal() {
    batchModalOpen = false;
    batchModalAction = null;
    batchModalMatched = 0;
    batchModalSample = [];
    batchModalError = null;
    batchProgress = { current: 0, total: 0 };
    batchAcceptErrors = [];
  }

  async function previewBatch(action) {
    batchModalAction = action;
    batchModalOpen = true;
    batchModalLoading = true;
    batchModalError = null;
    try {
      const data = await api(`/api/v2/propositions-batch`, {
        method: "POST",
        body: JSON.stringify({
          persona: personaUuid,
          filters: {
            target_kind: propFilters.target_kind || undefined,
            confidence_min: propFilters.confidence_min,
          },
          action,
          dry_run: true,
        }),
      });
      batchModalMatched = data.matched ?? 0;
      batchModalSample = data.sample || [];
    } catch (e) {
      console.error("[brain/batchPreview] failed:", e);
      batchModalError = e.message || "erreur";
    } finally {
      batchModalLoading = false;
    }
  }

  async function confirmBatch() {
    if (!batchModalAction) return;

    // ── REJECT : server-side bulk update (1 SQL) ──
    if (batchModalAction === "reject") {
      batchModalLoading = true;
      batchModalError = null;
      try {
        const data = await api(`/api/v2/propositions-batch`, {
          method: "POST",
          body: JSON.stringify({
            persona: personaUuid,
            filters: {
              target_kind: propFilters.target_kind || undefined,
              confidence_min: propFilters.confidence_min,
            },
            action: "reject",
          }),
        });
        showToast(`${data.applied ?? 0} propositions rejetées.`, "info");
        await Promise.all([loadCounts(), loadPropositions(), loadDistribution()]);
        closeBatchModal();
      } catch (e) {
        console.error("[brain/batchConfirm/reject] failed:", e);
        batchModalError = e.message || "erreur";
      } finally {
        batchModalLoading = false;
      }
      return;
    }

    // ── ACCEPT (V1.1) : boucle séquentielle client-side ──
    // On réutilise POST /api/v2/propositions { action:'accept' } unitaire
    // pour garantir l'identité des side-effects : patch prose, materialize
    // protocol_artifact (avec deriveCheckParams Haiku pour hard_check),
    // log extractor_training_example. Sequential car patchProse fait
    // read-modify-write sur protocol_section.prose sans lock.
    const targets = filteredProps().slice();
    if (targets.length === 0) {
      closeBatchModal();
      return;
    }
    batchModalLoading = true;
    batchModalError = null;
    batchAcceptErrors = [];
    batchProgress = { current: 0, total: targets.length };

    let acceptedCount = 0;
    for (const p of targets) {
      batchProgress.current = batchProgress.current + 1;
      try {
        await api(`/api/v2/propositions`, {
          method: "POST",
          body: JSON.stringify({ action: "accept", id: p.id }),
        });
        // Optimistic : retire de la liste pending locale (la PropositionsList
        // se met à jour au fur et à mesure si la modal est fermée).
        allPendingProps = allPendingProps.filter(x => x.id !== p.id);
        acceptedCount++;
      } catch (e) {
        batchAcceptErrors = [
          ...batchAcceptErrors,
          { id: p.id, message: e?.message || String(e) },
        ];
      }
    }

    batchModalLoading = false;
    batchProgress = { current: 0, total: 0 };

    // Refresh full state — le protocole a changé (prose patched), counts
    // et distribution aussi. loadProtocol() pour DoctrineGrid.prose_chars.
    await Promise.all([loadCounts(), loadPropositions(), loadDistribution(), loadProtocol()]);

    if (batchAcceptErrors.length === 0) {
      showToast(`${acceptedCount} propositions acceptées.`, "info");
      closeBatchModal();
    } else {
      showToast(`${acceptedCount} acceptées · ${batchAcceptErrors.length} erreurs`, "error");
      batchModalError = `${acceptedCount} acceptées, ${batchAcceptErrors.length} erreurs.`;
      // Modal reste ouverte pour que l'utilisateur voie le détail des erreurs.
    }
  }

  function handleBatchAccept() { previewBatch("accept"); }
  function handleBatchReject() { previewBatch("reject"); }

  // ── Protocol sections (DoctrineGrid) + Sources (SourcesTable) ──
  let protocolSections = $state([]);
  async function loadProtocol() {
    if (!personaUuid) return;
    try {
      const data = await api(`/api/v2/protocol?persona=${personaUuid}`);
      protocolSections = data.sections || [];
    } catch (e) {
      console.error("[brain/protocol] fetch failed:", e);
      // Pas de toast — DoctrineGrid affiche cells vides en degraded mode
    }
  }
  $effect(() => { if (personaUuid) loadProtocol(); });

  let sources = $state({ docs: [], playbooks: [] });
  async function loadSources() {
    if (!personaUuid) return;
    try {
      const data = await api(`/api/v2/sources?persona=${personaUuid}`);
      sources = { docs: data.docs || [], playbooks: data.playbooks || [] };
    } catch (e) {
      console.error("[brain/sources] fetch failed:", e);
    }
  }
  $effect(() => { if (personaUuid) loadSources(); });

  // DoctrineGrid : enrichir protocolSections avec pending_count par target_kind
  // (dérivé d'allPendingProps groupby target_kind)
  let pendingCountByKind = $derived(() => {
    const m = {};
    for (const p of allPendingProps) {
      m[p.target_kind] = (m[p.target_kind] || 0) + 1;
    }
    return m;
  });

  let doctrineCells = $derived(() => {
    return protocolSections.map(s => ({
      kind: s.kind,
      prose_chars: (s.prose || "").length,
      pending_count: pendingCountByKind()[s.kind] || 0,
    }));
  });

  function handleDoctrineCellClick(kind) {
    // V1 : juste expand la section Propositions filtrée par ce kind.
    propFilters = { ...propFilters, target_kind: kind };
    propsCollapsed = false;
    expandAndScrollTo("props");
  }

  // ── Resolve contradiction (Step 15/16) ──
  async function handleContraResolve(id, action, note) {
    try {
      await api(`/api/v2/contradictions-resolve`, {
        method: "POST",
        body: JSON.stringify({ id, action, ...(note ? { note } : {}) }),
      });
      // Optimistic : retirer la card de la liste open
      contradictions = contradictions.filter(c => c.id !== id);
      const verb = {
        keep_a: "Choix A enregistré",
        keep_b: "Choix B enregistré",
        both_false_positive: "Marquée faux-positif",
        reject_both: "Les deux rejetées",
        punt: "Mise de côté",
      }[action] || "Résolu";
      showToast(verb, "info");
      // Refresh counts + propositions (les rejets impactent les pending)
      Promise.all([loadCounts(), loadPropositions(), loadDistribution()]).catch(() => {});
    } catch (e) {
      console.error("[brain/contraResolve] failed:", e);
      showToast(`Résolution : ${e.message || "erreur"}`, "error");
      throw e;  // remonte pour que ContradictionsList reset son loading state
    }
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
    <ContradictionsList contradictions={contradictions} loading={contradictionsLoading} onResolve={handleContraResolve} />
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
    <DoctrineGrid sections={doctrineCells()} onCellClick={handleDoctrineCellClick} />
  </CollapsibleSection>

  <CollapsibleSection
    id="sources"
    title="Sources"
    count={sources.docs.length || sources.playbooks.length
      ? `${sources.docs.length} docs · ${sources.playbooks.length} playbooks`
      : null}
    bind:collapsed={sourcesCollapsed}
  >
    <SourcesTable docs={sources.docs} playbooks={sources.playbooks} />
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

{#if batchModalOpen}
  <div class="menu-overlay" role="dialog" aria-modal="true" onclick={closeBatchModal} onkeydown={(e) => e.key === "Escape" && closeBatchModal()}>
    <div class="batch-modal" onclick={(e) => e.stopPropagation()} role="document">
      <header class="batch-modal-head">
        <h3>
          {#if batchModalAction === "accept"}✓ Accepter en lot{:else}✗ Rejeter en lot{/if}
        </h3>
        <button class="menu-close" onclick={closeBatchModal} aria-label="Fermer">✕</button>
      </header>

      <div class="batch-modal-body">
        {#if batchModalLoading && batchModalMatched === 0 && batchProgress.total === 0}
          <p class="batch-loading">Calcul de l'aperçu…</p>
        {:else if batchProgress.total > 0}
          <p class="batch-progress">
            Acceptation en cours : <strong>{batchProgress.current}/{batchProgress.total}</strong>
            <span class="batch-progress-hint">— chaque acceptation patche le protocole et matérialise un artifact (Haiku derivation pour les hard_checks).</span>
          </p>
        {:else}
          <p class="batch-summary">
            <strong>{batchModalMatched}</strong> propositions matchent les filtres :
            <span class="batch-filters">
              section <em>{propFilters.target_kind || "toutes"}</em> · confidence ≥ <em>{propFilters.confidence_min.toFixed(2)}</em>
            </span>
          </p>
          {#if batchModalSample.length > 0}
            <div class="batch-sample">
              <p class="batch-sample-label">Aperçu ({batchModalSample.length}/{batchModalMatched}) :</p>
              <ul>
                {#each batchModalSample as s}
                  <li>
                    <span class="kind">{s.target_kind}</span>
                    <span class="text">{s.proposed_text}</span>
                    <span class="conf">conf {(s.confidence ?? 0).toFixed(2)}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if batchModalError}
            <p class="batch-error">{batchModalError}</p>
          {/if}
          {#if batchAcceptErrors.length > 0}
            <details class="batch-errs">
              <summary>{batchAcceptErrors.length} erreur{batchAcceptErrors.length > 1 ? "s" : ""}</summary>
              <ul>
                {#each batchAcceptErrors as err (err.id)}
                  <li><code>{err.id.slice(0, 8)}</code> · {err.message}</li>
                {/each}
              </ul>
            </details>
          {/if}
        {/if}
      </div>

      <footer class="batch-modal-foot">
        <button class="batch-btn" onclick={closeBatchModal} disabled={batchModalLoading}>annuler</button>
        <button
          class="batch-btn"
          class:primary={batchModalAction === "accept"}
          class:danger={batchModalAction === "reject"}
          onclick={confirmBatch}
          disabled={batchModalLoading || batchModalMatched === 0}
        >
          {#if batchProgress.total > 0}
            {batchProgress.current}/{batchProgress.total}…
          {:else if batchModalLoading}
            …
          {:else}
            confirmer ({batchModalMatched})
          {/if}
        </button>
      </footer>
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

  .batch-modal {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    border-radius: 4px;
    width: 100%;
    max-width: 640px;
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .batch-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--rule); }
  .batch-modal-head h3 { margin: 0; font-family: var(--font, Georgia, serif); font-weight: 500; font-size: 17px; letter-spacing: -0.01em; }
  .batch-modal-body { padding: 18px; overflow-y: auto; flex: 1 1 auto; }
  .batch-modal-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--rule); }
  .batch-modal-foot .batch-btn { font-family: var(--font-mono); font-size: 11px; padding: 8px 14px; border-radius: 2px; cursor: pointer; border: 1px solid var(--rule-strong); background: transparent; color: var(--ink); }
  .batch-modal-foot .batch-btn:hover:not(:disabled) { background: var(--paper-subtle, #ecebe4); }
  .batch-modal-foot .batch-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .batch-modal-foot .batch-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .batch-modal-foot .batch-btn.danger { color: var(--vermillon-dim, #b43b28); border-color: var(--vermillon-dim, #b43b28); }
  .batch-modal-foot .batch-btn.danger:hover:not(:disabled) { background: var(--vermillon); color: var(--paper); border-color: var(--vermillon); }

  .batch-loading, .batch-error { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); }
  .batch-error { color: var(--vermillon); }
  .batch-summary { font-family: var(--font, Georgia, serif); font-size: 14px; color: var(--ink); }
  .batch-summary strong { font-weight: 600; color: var(--ink); }
  .batch-filters { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); }
  .batch-filters em { font-style: normal; color: var(--ink-70); }
  .batch-sample { margin-top: 14px; }
  .batch-sample-label { font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-40); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
  .batch-sample ul { list-style: none; padding: 0; margin: 0; }
  .batch-sample li { display: grid; grid-template-columns: 100px 1fr 80px; gap: 12px; padding: 8px 10px; border-bottom: 1px solid var(--rule); align-items: baseline; }
  .batch-sample li:last-child { border-bottom: none; }
  .batch-sample .kind { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--ink-40); letter-spacing: 0.06em; }
  .batch-sample .text { font-family: var(--font, Georgia, serif); font-size: 13px; line-height: 1.4; color: var(--ink); }
  .batch-sample .conf { font-family: var(--font-mono); font-size: 11px; color: var(--ink-70); text-align: right; }
  .batch-progress { font-family: var(--font, Georgia, serif); font-size: 14px; color: var(--ink); margin: 0; }
  .batch-progress strong { font-family: var(--font-mono); font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  .batch-progress-hint { display: block; margin-top: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); line-height: 1.5; }

  .batch-errs { margin-top: 14px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-70); }
  .batch-errs summary { cursor: pointer; color: var(--vermillon); padding: 4px 0; }
  .batch-errs ul { margin: 4px 0 0; padding-left: 18px; list-style: square; }
  .batch-errs code { background: color-mix(in srgb, var(--ink) 6%, transparent); padding: 0 4px; border-radius: 2px; }

  @media (max-width: 700px) {
    .brain-page { padding: 16px 16px 60px; }
    .title h1 { font-size: 18px; }
  }
</style>
