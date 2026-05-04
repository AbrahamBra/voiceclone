<script>
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  // Page /persona/[id]/arbitrage — vue plein-écran de toutes les contradictions
  // ouvertes + toutes les propositions pending (sans top-N comme dans le cockpit).
  // Cible des boutons "tout arbitrer →" et "tout voir" du cockpit.

  import ContradictionsList from "$lib/components/brain/ContradictionsList.svelte";
  import BatchBar from "$lib/components/brain/BatchBar.svelte";
  import PropositionsList from "$lib/components/brain/PropositionsList.svelte";

  let { data } = $props();
  let personaUuid = $derived(data.personaId);
  let initialFocus = $derived(data.focus);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  // Persona config (pour titre)
  let lastFetchedId = $state(null);
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!personaUuid || lastFetchedId === personaUuid) return;
    lastFetchedId = personaUuid;
    if ($personaConfig?.id === personaUuid) return;
    fetch(`/api/config?persona=${personaUuid}`, { headers: authHeaders() })
      .then(async r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) personaConfig.set(cfg); })
      .catch(e => console.error("[arbitrage/personaConfig]", e));
  });

  // Loaders
  let documentId = $state(null);
  let contradictions = $state([]);
  let allPendingProps = $state([]);
  let distribution = $state(null);

  async function safeApi(path, label) {
    try { return await api(path); }
    catch (e) {
      console.error(`[arbitrage/${label}]`, e);
      showToast(`${label} : ${e.message || "erreur"}`, "error");
      return null;
    }
  }

  $effect(() => {
    if (!personaUuid) return;
    safeApi(`/api/v2/brain-status?persona=${personaUuid}`, "status").then(d => { if (d) documentId = d.document_id; });
    safeApi(`/api/v2/contradictions?persona=${personaUuid}&status=open`, "contradictions").then(d => { if (d) contradictions = d.contradictions || []; });
    safeApi(`/api/v2/propositions-distribution?persona=${personaUuid}`, "distribution").then(d => { if (d) distribution = d.distribution; });
  });

  $effect(() => {
    if (!documentId) return;
    safeApi(`/api/v2/propositions?document=${documentId}&status=pending`, "propositions").then(d => { if (d) allPendingProps = d.propositions || []; });
  });

  // Scroll to focus section on mount
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!initialFocus) return;
    requestAnimationFrame(() => {
      const id = initialFocus === "props" ? "section-props" : "section-contras";
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Filters
  let propFilters = $state({ target_kind: null, source_group: null, confidence_min: 0.85 });
  let filteredProps = $derived(() => allPendingProps
    .filter(p => (!propFilters.target_kind || p.target_kind === propFilters.target_kind)
              && (p.confidence ?? 0) >= propFilters.confidence_min - 1e-9)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)));

  // Actions
  async function handlePropAction(id, action) {
    try {
      await api(`/api/v2/propositions`, { method: "POST", body: JSON.stringify({ action, id }) });
      allPendingProps = allPendingProps.filter(p => p.id !== id);
      showToast(`Proposition ${action === "accept" ? "acceptée" : action === "reject" ? "rejetée" : "à éditer"}.`, "info");
    } catch (e) {
      console.error("[arbitrage/propAction]", e);
      showToast(`Erreur : ${e.message}`, "error");
    }
  }

  async function handleContraResolve(id, action, note) {
    try {
      await api(`/api/v2/contradictions-resolve`, {
        method: "POST",
        body: JSON.stringify({ id, action, ...(note ? { note } : {}) }),
      });
      contradictions = contradictions.filter(c => c.id !== id);
      showToast("Contradiction résolue.", "info");
    } catch (e) {
      console.error("[arbitrage/contraResolve]", e);
      showToast(`Erreur : ${e.message}`, "error");
      throw e;
    }
  }

  // ── Batch confirm modal (V1.1 implementation reused) ──
  let batchModalOpen = $state(false);
  let batchModalAction = $state(null);
  let batchModalLoading = $state(false);
  let batchModalMatched = $state(0);
  let batchModalSample = $state([]);
  let batchModalError = $state(null);
  let batchProgress = $state({ current: 0, total: 0 });
  let batchAcceptErrors = $state([]);

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
          filters: { target_kind: propFilters.target_kind || undefined, confidence_min: propFilters.confidence_min },
          action,
          dry_run: true,
        }),
      });
      batchModalMatched = data.matched ?? 0;
      batchModalSample = data.sample || [];
    } catch (e) {
      console.error("[arbitrage/previewBatch]", e);
      batchModalError = e.message || "erreur";
    } finally {
      batchModalLoading = false;
    }
  }

  async function confirmBatch() {
    if (!batchModalAction) return;

    if (batchModalAction === "reject") {
      batchModalLoading = true;
      batchModalError = null;
      try {
        const data = await api(`/api/v2/propositions-batch`, {
          method: "POST",
          body: JSON.stringify({
            persona: personaUuid,
            filters: { target_kind: propFilters.target_kind || undefined, confidence_min: propFilters.confidence_min },
            action: "reject",
          }),
        });
        showToast(`${data.applied ?? 0} propositions rejetées.`, "info");
        // Refresh
        const newProps = await safeApi(`/api/v2/propositions?document=${documentId}&status=pending`, "propositions");
        if (newProps) allPendingProps = newProps.propositions || [];
        closeBatchModal();
      } catch (e) {
        console.error("[arbitrage/batchReject]", e);
        batchModalError = e.message || "erreur";
      } finally {
        batchModalLoading = false;
      }
      return;
    }

    // ── ACCEPT : client-side loop over filtered props ──
    const targets = filteredProps();
    if (targets.length === 0) { closeBatchModal(); return; }

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
        allPendingProps = allPendingProps.filter(x => x.id !== p.id);
        acceptedCount++;
      } catch (e) {
        batchAcceptErrors = [...batchAcceptErrors, { id: p.id, message: e?.message || String(e) }];
      }
    }

    batchModalLoading = false;
    showToast(`${acceptedCount}/${targets.length} propositions acceptées${batchAcceptErrors.length ? ` (${batchAcceptErrors.length} erreurs)` : ""}.`, "info");
    if (batchAcceptErrors.length === 0) closeBatchModal();
  }

  function goBack() {
    if (personaUuid) goto(`/brain/${personaUuid}`);
  }
</script>

<svelte:head><title>Arbitrage · clone de {$personaConfig?.name || "?"}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <button class="back-btn" onclick={goBack}>← cockpit</button>
    <div class="title">
      <span class="avatar">{$personaConfig?.avatar || "?"}</span>
      <h1>Arbitrage · <span class="clone-of">clone de</span> {$personaConfig?.name || "?"}</h1>
    </div>
  </header>

  <p class="intro">
    Vue plein-écran de toutes les <strong>contradictions ouvertes</strong> et <strong>propositions pending</strong>.
    Le cockpit montre seulement le top, ici tu as tout pour arbitrer en série.
  </p>

  <section id="section-contras" class="section">
    <h2 class="section-title">⚡ Contradictions <span class="count">{contradictions.length}</span></h2>
    <ContradictionsList contradictions={contradictions} loading={false} onResolve={handleContraResolve} />
  </section>

  <section id="section-props" class="section">
    <h2 class="section-title">📋 Propositions <span class="count">{allPendingProps.length} pending · {filteredProps().length} matchent les filtres</span></h2>
    <BatchBar
      filters={propFilters}
      {distribution}
      onFilterChange={(f) => propFilters = f}
      onBatchAccept={() => previewBatch("accept")}
      onBatchReject={() => previewBatch("reject")}
    />
    <PropositionsList
      propositions={filteredProps()}
      total={filteredProps().length}
      onAction={handlePropAction}
      onSeeAll={() => {}}
    />
  </section>
</div>

{#if batchModalOpen}
  <div class="modal-overlay" role="dialog" aria-modal="true" onclick={closeBatchModal} onkeydown={(e) => e.key === "Escape" && closeBatchModal()}>
    <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
      <header class="modal-head">
        <h3>{batchModalAction === "accept" ? "✓ Accepter en lot" : "✗ Rejeter en lot"}</h3>
        <button class="close" onclick={closeBatchModal} aria-label="Fermer">✕</button>
      </header>

      <div class="modal-body">
        {#if batchModalLoading && batchProgress.total > 0}
          <div class="progress">
            <p>Traitement : <strong>{batchProgress.current}/{batchProgress.total}</strong></p>
            <div class="progress-bar"><div class="progress-fill" style="width: {(batchProgress.current / batchProgress.total) * 100}%"></div></div>
          </div>
        {:else if batchModalLoading}
          <p class="loading-text">Calcul de l'aperçu…</p>
        {:else if batchModalError}
          <p class="error-text">{batchModalError}</p>
        {:else}
          <p class="summary">
            <strong>{batchModalMatched}</strong> propositions matchent :
            section <em>{propFilters.target_kind || "toutes"}</em> · conf ≥ <em>{propFilters.confidence_min.toFixed(2)}</em>
          </p>
          {#if batchModalSample.length > 0}
            <ul class="sample">
              {#each batchModalSample as s}
                <li>
                  <span class="kind">{s.target_kind}</span>
                  <span class="text">{s.proposed_text}</span>
                  <span class="conf">{(s.confidence ?? 0).toFixed(2)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}

        {#if batchAcceptErrors.length > 0}
          <div class="errors">
            <p><strong>{batchAcceptErrors.length} erreurs :</strong></p>
            <ul>
              {#each batchAcceptErrors as e}
                <li><code>{e.id.slice(0,8)}</code> : {e.message}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      <footer class="modal-foot">
        <button class="btn" onclick={closeBatchModal} disabled={batchModalLoading}>annuler</button>
        <button
          class="btn"
          class:primary={batchModalAction === "accept"}
          class:danger={batchModalAction === "reject"}
          onclick={confirmBatch}
          disabled={batchModalLoading || batchModalMatched === 0}
        >
          {batchModalLoading ? "…" : `confirmer (${batchModalMatched})`}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .page { max-width: 1180px; margin: 0 auto; padding: 24px 28px 80px; min-height: 100dvh; }
  .page-head { display: flex; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--rule); margin-bottom: 18px; }
  .title { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; }
  .avatar { font-size: 22px; }
  h1 { margin: 0; font-family: var(--font, Georgia, serif); font-size: 22px; font-weight: 500; }
  .clone-of { font-family: var(--font-mono); font-size: 12px; font-weight: normal; color: var(--ink-40); letter-spacing: 0.02em; }
  .back-btn { background: transparent; border: 1px solid var(--rule-strong); padding: 6px 10px; font-family: var(--font-mono); font-size: 11px; cursor: pointer; border-radius: 2px; color: var(--ink-40); }
  .back-btn:hover { color: var(--ink); background: var(--paper-subtle, #ecebe4); }

  .intro {
    padding: 12px 16px;
    background: var(--paper-subtle, #ecebe4);
    border-left: 3px solid var(--ink);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink-70);
    margin: 0 0 24px;
  }
  .intro strong { color: var(--ink); }

  .section { margin-top: 36px; }
  .section-title {
    font-family: var(--font, Georgia, serif);
    font-weight: 500;
    font-size: 21px;
    letter-spacing: -0.01em;
    margin: 0 0 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule);
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .count { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); font-weight: normal; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(20, 20, 26, 0.4); display: flex; align-items: flex-start; justify-content: center; padding: 60px 16px; z-index: 100; }
  .modal { background: var(--paper); border: 1px solid var(--rule-strong); border-radius: 4px; width: 100%; max-width: 640px; max-height: 80dvh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--rule); }
  .modal-head h3 { margin: 0; font-family: var(--font, Georgia, serif); font-weight: 500; font-size: 17px; }
  .close { background: transparent; border: 1px solid var(--rule-strong); padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 12px; }
  .modal-body { padding: 18px; overflow-y: auto; flex: 1 1 auto; }
  .modal-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--rule); }

  .summary { font-family: var(--font, Georgia, serif); font-size: 14px; color: var(--ink); }
  .summary em { font-style: normal; color: var(--ink-70); font-family: var(--font-mono); font-size: 11px; }
  .summary strong { font-weight: 600; }

  .progress p { font-family: var(--font-mono); font-size: 12px; margin-bottom: 8px; }
  .progress-bar { height: 6px; background: var(--paper-subtle, #ecebe4); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--ink); transition: width 0.2s; }

  .loading-text { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); }
  .error-text { font-family: var(--font-mono); font-size: 11px; color: var(--vermillon); }

  .sample { list-style: none; padding: 0; margin: 14px 0 0; }
  .sample li { display: grid; grid-template-columns: 100px 1fr 60px; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--rule); align-items: baseline; }
  .sample li:last-child { border-bottom: none; }
  .sample .kind { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--ink-40); }
  .sample .text { font-family: var(--font, Georgia, serif); font-size: 13px; line-height: 1.4; }
  .sample .conf { font-family: var(--font-mono); font-size: 11px; color: var(--ink-70); text-align: right; }

  .errors { margin-top: 14px; padding: 10px 12px; background: var(--paper-subtle, #ecebe4); border-left: 3px solid var(--vermillon); font-family: var(--font-mono); font-size: 10.5px; }
  .errors ul { margin: 6px 0 0; padding-left: 18px; }
  .errors code { font-size: 10px; background: var(--paper); padding: 1px 4px; }

  .btn { font-family: var(--font-mono); font-size: 11px; padding: 8px 14px; border-radius: 2px; cursor: pointer; border: 1px solid var(--rule-strong); background: transparent; color: var(--ink); }
  .btn:hover:not(:disabled) { background: var(--paper-subtle, #ecebe4); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn.danger { color: var(--vermillon-dim, #b43b28); border-color: var(--vermillon-dim, #b43b28); }
  .btn.danger:hover:not(:disabled) { background: var(--vermillon); color: var(--paper); border-color: var(--vermillon); }
</style>
