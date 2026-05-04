<script>
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  // Cockpit V2 — décisions à gauche (60%), construction à droite (40%),
  // strip activité setters au-dessus.
  // Spec : docs/superpowers/specs/2026-05-04-brain-v2-cockpit-design.md

  import SetterActivityStrip from "$lib/components/brain/SetterActivityStrip.svelte";
  import ContradictionsList from "$lib/components/brain/ContradictionsList.svelte";
  import BatchBar from "$lib/components/brain/BatchBar.svelte";
  import PropositionsList from "$lib/components/brain/PropositionsList.svelte";
  import OutcomeHero from "$lib/components/brain/OutcomeHero.svelte";
  import TrajectoryBlock from "$lib/components/brain/TrajectoryBlock.svelte";
  import DoctrineFoundation from "$lib/components/brain/DoctrineFoundation.svelte";

  let { data } = $props();
  let personaSlug = $derived(data.personaId);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  // Persona config
  let lastFetchedSlug = $state(null);
  let personaConfigError = $state(null);
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!personaSlug || lastFetchedSlug === personaSlug) return;
    lastFetchedSlug = personaSlug;
    personaConfigError = null;
    fetch(`/api/config?persona=${personaSlug}`, { headers: authHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error(`/api/config ${r.status}`);
        return r.json();
      })
      .then(cfg => personaConfig.set(cfg))
      .catch(e => {
        console.error("[brain-v2/personaConfig]", e);
        personaConfigError = e.message;
      });
  });
  let personaUuid = $derived($personaConfig?.id || null);

  // ── Loaders ──
  let counts = $state(null);
  let documentId = $state(null);
  let contradictions = $state([]);
  let allPendingProps = $state([]);
  let distribution = $state(null);
  let setterActivity = $state(null);
  let trajectory = $state(null);
  let outcomes = $state(null);
  let protocolSections = $state([]);

  async function safeApi(path, label) {
    try { return await api(path); }
    catch (e) {
      console.error(`[brain-v2/${label}]`, e);
      showToast(`${label} : ${e.message || "erreur"}`, "error");
      return null;
    }
  }

  $effect(() => {
    if (!personaUuid) return;
    (async () => {
      const status = await safeApi(`/api/v2/brain-status?persona=${personaUuid}`, "status");
      if (status) { counts = status.counts; documentId = status.document_id; }
    })();
    safeApi(`/api/v2/contradictions?persona=${personaUuid}&status=open`, "contradictions").then(d => { if (d) contradictions = d.contradictions || []; });
    safeApi(`/api/v2/propositions-distribution?persona=${personaUuid}`, "distribution").then(d => { if (d) distribution = d.distribution; });
    safeApi(`/api/v2/setter-activity?persona=${personaUuid}&period=week`, "setters").then(d => { if (d) setterActivity = d; });
    safeApi(`/api/v2/clone-trajectory?persona=${personaUuid}&weeks=8`, "trajectory").then(d => { if (d) trajectory = d; });
    safeApi(`/api/v2/clone-outcomes?persona=${personaUuid}&period=week`, "outcomes").then(d => { if (d) outcomes = d; });
    safeApi(`/api/v2/protocol?persona=${personaUuid}`, "protocol").then(d => { if (d) protocolSections = d.sections || []; });
  });

  $effect(() => {
    if (!documentId) return;
    safeApi(`/api/v2/propositions?document=${documentId}&status=pending`, "propositions").then(d => { if (d) allPendingProps = d.propositions || []; });
  });

  // ── Filters + filtered props (BatchBar) ──
  let propFilters = $state({ target_kind: null, source_group: null, confidence_min: 0.85 });
  const PROPS_DISPLAY_LIMIT = 5;        // cockpit : top-5 only, focus mode V2.1 = "Tout arbitrer"
  const CONTRAS_DISPLAY_LIMIT = 3;       // cockpit : top-3 contradictions par kind avec le plus de match
  let filteredProps = $derived(() => allPendingProps
    .filter(p => (!propFilters.target_kind || p.target_kind === propFilters.target_kind)
              && (p.confidence ?? 0) >= propFilters.confidence_min - 1e-9)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)));
  let displayedProps = $derived(() => filteredProps().slice(0, PROPS_DISPLAY_LIMIT));

  // Top-3 contradictions : par cosine desc (les plus crédibles en haut).
  let displayedContras = $derived(() => contradictions.slice(0, CONTRAS_DISPLAY_LIMIT));

  // ── Doctrine cells ──
  let pendingCountByKind = $derived(() => {
    const m = {};
    for (const p of allPendingProps) m[p.target_kind] = (m[p.target_kind] || 0) + 1;
    return m;
  });
  let doctrineCells = $derived(() => protocolSections.map(s => ({
    kind: s.kind,
    prose_chars: (s.prose || "").length,
    pending_count: pendingCountByKind()[s.kind] || 0,
  })));

  // ── Actions ──
  async function handlePropAction(id, action) {
    try {
      await api(`/api/v2/propositions`, { method: "POST", body: JSON.stringify({ action, id }) });
      allPendingProps = allPendingProps.filter(p => p.id !== id);
      showToast(`Proposition ${action === "accept" ? "acceptée" : action === "reject" ? "rejetée" : "à éditer"}.`, "info");
    } catch (e) {
      console.error("[brain-v2/propAction]", e);
      showToast(`Erreur action : ${e.message}`, "error");
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
      console.error("[brain-v2/contraResolve]", e);
      showToast(`Erreur : ${e.message}`, "error");
      throw e;
    }
  }

  function handleDoctrineCellClick(kind) {
    propFilters = { ...propFilters, target_kind: kind };
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => document.getElementById("propositions")?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  function goToTeam() {
    if (personaUuid) goto(`/persona/${personaUuid}/team`);
  }

  function goToCerveau() {
    if (personaUuid) goto(`/persona/${personaUuid}/cerveau`);
  }

  function goBack() {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) history.back();
    else goto(`/chat/${personaSlug}`);
  }

  function startFocusMode() {
    showToast("Mode focus arbitrage arrive en V2.1 — pour l'instant, scroll dans la liste.", "info");
  }
</script>

<svelte:head><title>Cockpit · clone de {$personaConfig?.name || "?"}</title></svelte:head>

<div class="cockpit">
  <header class="cockpit-head">
    <button class="back-btn" onclick={goBack}>← retour</button>
    <div class="title">
      <span class="avatar">{$personaConfig?.avatar || "?"}</span>
      <h1>Cockpit · <span class="clone-of">clone de</span> {$personaConfig?.name || "?"}</h1>
    </div>
    <div class="head-actions">
      <button class="head-btn" onclick={goToCerveau} title="Cerveau — protocole + intelligence détaillés">
        🧠 cerveau
      </button>
      <button class="head-btn" onclick={goToTeam} title="Team — activité détaillée des setters">
        👥 team
      </button>
    </div>
  </header>

  {#if personaConfigError}
    <div class="error-banner">Persona introuvable : {personaConfigError}</div>
  {/if}

  <SetterActivityStrip activity={setterActivity} loading={!setterActivity && !!personaUuid} onTeamClick={goToTeam} />

  <div class="grid">
    <section class="decisions">
      <h2 class="zone-label">Décisions</h2>

      <div class="block">
        <h3 class="block-title">
          ⚡ Contradictions à arbitrer
          {#if counts}<span class="count" class:alert={counts.contradictions_open > 0}>{counts.contradictions_open}</span>{/if}
          {#if contradictions.length > 0}
            <button class="focus-btn" onclick={startFocusMode}>tout arbitrer →</button>
          {/if}
        </h3>
        <ContradictionsList contradictions={displayedContras()} loading={false} onResolve={handleContraResolve} />
        {#if contradictions.length > CONTRAS_DISPLAY_LIMIT}
          <p class="more-hint">
            + {contradictions.length - CONTRAS_DISPLAY_LIMIT} autres contradictions ·
            <button class="link-btn" onclick={startFocusMode}>tout arbitrer en mode focus →</button>
          </p>
        {/if}
      </div>

      <div class="block" id="propositions">
        <h3 class="block-title">
          📋 Propositions à reviewer
          {#if counts}<span class="count">{counts.propositions_pending}</span>{/if}
        </h3>
        <BatchBar
          filters={propFilters}
          {distribution}
          onFilterChange={(f) => propFilters = f}
          onBatchAccept={() => showToast("Batch accept arrive en V2.1", "info")}
          onBatchReject={() => showToast("Batch reject arrive en V2.1", "info")}
        />
        <PropositionsList
          propositions={displayedProps()}
          total={filteredProps().length}
          onAction={handlePropAction}
          onSeeAll={() => showToast("Vue paginée arrive en V2.1", "info")}
        />
      </div>
    </section>

    <aside class="construction">
      <h2 class="zone-label">Construction</h2>
      <OutcomeHero outcomes={outcomes} loading={!outcomes && !!personaUuid} />
      <TrajectoryBlock trajectory={trajectory} loading={!trajectory && !!personaUuid} />
      <DoctrineFoundation sections={doctrineCells()} onCellClick={handleDoctrineCellClick} />
    </aside>
  </div>
</div>

<style>
  .cockpit { max-width: 1280px; margin: 0 auto; padding: 16px 20px 60px; }
  .cockpit-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--rule); margin-bottom: 12px; gap: 12px; }
  .title { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; }
  .avatar { font-size: 22px; }
  h1 { margin: 0; font-size: 20px; font-weight: 500; font-family: var(--font, Georgia, serif); }
  .clone-of { font-family: var(--font-mono); font-size: 12px; font-weight: normal; color: var(--ink-40); letter-spacing: 0.02em; }

  .back-btn, .head-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
    color: var(--ink-40);
  }
  .back-btn:hover, .head-btn:hover { color: var(--ink); background: var(--paper-subtle, #ecebe4); }
  .head-actions { display: flex; gap: 8px; }

  .focus-btn {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
    border-radius: 2px;
    margin-left: auto;
    font-weight: 500;
  }
  .focus-btn:hover { background: var(--vermillon, #c45339); border-color: var(--vermillon, #c45339); }

  .more-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    padding: 10px 14px;
    background: var(--paper-subtle, #ecebe4);
    border-left: 3px solid var(--ink-30, #aaa);
    margin: 8px 0 0;
  }
  .link-btn {
    background: transparent;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .link-btn:hover { color: var(--vermillon); }

  .error-banner { padding: 10px 14px; background: var(--paper-subtle, #ecebe4); border-left: 3px solid var(--vermillon); font-family: var(--font-mono); font-size: 11px; margin-bottom: 12px; }

  .grid { display: grid; grid-template-columns: 60% 40%; gap: 1px; background: var(--rule); margin-top: 1px; }
  .decisions { background: var(--paper); padding: 14px 16px; }
  .construction { background: var(--paper-subtle, #faf9f4); padding: 0; }

  .zone-label { font-family: var(--font-mono); font-size: 10px; color: var(--ink-40); text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 12px; padding-top: 4px; }
  .construction .zone-label { padding: 12px 14px 8px; margin: 0; }

  .block { margin-bottom: 24px; }
  .block-title { font-family: var(--font, Georgia, serif); font-weight: 500; font-size: 18px; margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); display: flex; align-items: center; gap: 8px; }
  .count { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); font-weight: normal; }
  .count.alert { color: var(--vermillon); font-weight: 600; }

  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
