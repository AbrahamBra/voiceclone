<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  // Brain V1 — workflow arbitrage-first.
  //
  // Layout : header / status banner / mode bar (Arbitrage | Doctrine).
  //   Mode Arbitrage : Contradictions + Propositions (queue) + Auto-mergées
  //   Mode Doctrine  : Sections (= ProtocolPanel embarqué pour V1, sous-vue
  //                    Concepts différée V1.1)
  //   ⚙ menu : ApiKeys + Settings (popover)
  //
  // Spec : docs/superpowers/specs/2026-05-04-brain-v1-arbitrage-design.md

  import BrainStatusBanner from "$lib/components/brain/BrainStatusBanner.svelte";
  import BrainModeBar from "$lib/components/brain/BrainModeBar.svelte";
  import ContradictionsList from "$lib/components/brain/ContradictionsList.svelte";
  import ProtocolPanel from "$lib/components/ProtocolPanel.svelte";
  import ApiKeysPanel from "$lib/components/ApiKeysPanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";

  let { data } = $props();
  let personaSlug = $derived(data.personaId);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!personaSlug) return;
    if ($personaConfig && $personaConfig.slug === personaSlug) return;
    fetch(`/api/config?persona=${personaSlug}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) personaConfig.set(cfg); })
      .catch(() => {});
  });

  let personaUuid = $derived($personaConfig?.id || null);

  function modeKey(uuid) { return `brain.mode.${uuid}`; }
  let mode = $state("arbitrage");

  $effect(() => {
    if (typeof window === "undefined") return;
    const urlMode = $page.url.searchParams.get("mode");
    if (urlMode === "arbitrage" || urlMode === "doctrine") { mode = urlMode; return; }
    if (personaUuid) {
      const stored = localStorage.getItem(modeKey(personaUuid));
      if (stored === "arbitrage" || stored === "doctrine") mode = stored;
    }
  });

  function selectMode(next) {
    mode = next;
    if (typeof window === "undefined") return;
    if (personaUuid) localStorage.setItem(modeKey(personaUuid), next);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", next);
    history.replaceState(null, "", url.toString());
  }

  let counts = $state(null);
  let countsLoading = $state(false);
  async function loadCounts() {
    if (!personaUuid) return;
    countsLoading = true;
    try {
      const data = await api(`/api/v2/brain-status?persona=${personaUuid}`);
      counts = data.counts;
    } catch (e) { showToast(`Status banner : ${e.message || "erreur"}`, "error"); }
    finally { countsLoading = false; }
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
    } catch (e) { showToast(`Contradictions : ${e.message || "erreur"}`, "error"); }
    finally { contradictionsLoading = false; }
  }
  $effect(() => { if (personaUuid && mode === "arbitrage") loadContradictions(); });

  function handleCellClick(cellId) {
    if (cellId === "doctrine") { selectMode("doctrine"); return; }
    if (mode !== "arbitrage") selectMode("arbitrage");
    const id = { contradictions: "section-contradictions", propositions: "section-propositions", merged: "section-merged" }[cellId];
    if (id && typeof window !== "undefined") {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function handleImportClick() {
    selectMode("doctrine");
    showToast("Bascule mode Doctrine — clique '+ importer un doc' dans le panneau Protocole.", "info");
  }

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

  <BrainStatusBanner {counts} loading={countsLoading} onCellClick={handleCellClick} onImportClick={handleImportClick} />

  <BrainModeBar {mode} {counts} onChange={selectMode} />

  {#if mode === "arbitrage"}
    <section id="section-contradictions" class="section">
      <h2 class="section-title">Contradictions {#if counts}<span class="count" class:alert={counts.contradictions_open > 0}>{counts.contradictions_open}</span>{/if}</h2>
      <ContradictionsList {contradictions} loading={contradictionsLoading} onResolve={null} />
    </section>

    <section id="section-propositions" class="section">
      <h2 class="section-title">Propositions {#if counts}<span class="count">{counts.propositions_pending}</span>{/if}</h2>
      <p class="section-hint">La queue d'arbitrage existante. Tri convergence + filtres + slider confidence sont déjà branchés (PR #234).</p>
      {#if personaUuid}<ProtocolPanel personaId={personaUuid} />{:else}<p class="empty-block">chargement…</p>{/if}
    </section>

    <section id="section-merged" class="section">
      <h2 class="section-title">Auto-mergées {#if counts}<span class="count">{counts.auto_merged}</span>{/if}</h2>
      <p class="section-hint">
        {#if (counts?.auto_merged ?? 0) > 0}
          Synonymes auto-fusionnés. Le composant de vérification + split-back arrive dans le prochain commit.
        {:else}
          Aucune auto-fusion enregistrée. Le scan synonymes n'a pas encore tourné en mode --apply sur cette persona.
        {/if}
      </p>
    </section>
  {:else if mode === "doctrine"}
    <section class="section">
      <h2 class="section-title">Doctrine</h2>
      <p class="section-hint">Sections du protocole (identity / hard_rules / icp_patterns / process / templates / errors / scoring). Sous-vue Concepts (graphe d'entités) arrive en V1.1.</p>
      {#if personaUuid}<ProtocolPanel personaId={personaUuid} />{:else}<p class="empty-block">chargement…</p>{/if}
    </section>
  {/if}
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

  .section { margin-top: 36px; }
  .section-title { margin: 0; padding-bottom: 10px; border-bottom: 1px solid var(--rule); font-family: var(--font, Georgia, serif); font-weight: 500; font-size: 21px; letter-spacing: -0.01em; display: flex; align-items: baseline; gap: 10px; }
  .count { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); font-weight: normal; letter-spacing: 0.04em; }
  .count.alert { color: var(--vermillon); font-weight: 600; }
  .section-hint { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); margin: 10px 0 0; letter-spacing: 0.02em; }
  .empty-block { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); padding: 20px 0; }

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
