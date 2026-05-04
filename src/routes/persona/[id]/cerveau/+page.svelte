<script>
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  // Page /persona/[id]/cerveau — vue détaillée du clone : protocole prose
  // éditable + intelligence (entities). Complément du cockpit (qui affiche
  // les summaries + queue d'action). Ici tu LIS et MODIFIES ce que ton clone
  // sait, vs le cockpit où tu DÉCIDES et OBSERVES la trajectoire.
  //
  // V2 minimal :
  //   - Protocole : ProtocolPanel existant embarqué (5 tabs internes :
  //     doctrine, registre, propositions, playbooks, calibrage)
  //   - Intelligence : count entités groupées par type, placeholder graphe V2.1
  //
  // Spec : docs/superpowers/specs/2026-05-04-brain-v2-cockpit-design.md
  // Section "Pages séparées" — /cerveau ajouté en patch post-V2 (user request).

  import ProtocolPanel from "$lib/components/ProtocolPanel.svelte";

  let { data } = $props();
  let personaUuid = $derived(data.personaId);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  // Persona config (pour le titre header)
  let lastFetchedId = $state(null);
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!personaUuid || lastFetchedId === personaUuid) return;
    lastFetchedId = personaUuid;
    if ($personaConfig?.id === personaUuid) return;
    fetch(`/api/config?persona=${personaUuid}`, { headers: authHeaders() })
      .then(async r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) personaConfig.set(cfg); })
      .catch(e => console.error("[cerveau/personaConfig]", e));
  });

  // ── Intelligence : entities groupées par type ──
  let entities = $state([]);
  let entitiesLoading = $state(false);
  let entitiesError = $state(null);

  async function loadEntities() {
    if (!personaUuid) return;
    entitiesLoading = true;
    entitiesError = null;
    try {
      const data = await api(`/api/knowledge?persona=${personaUuid}`);
      entities = data.entities || data.knowledge || [];
    } catch (e) {
      console.error("[cerveau/entities]", e);
      entitiesError = e.message || "erreur";
    } finally { entitiesLoading = false; }
  }
  $effect(() => { if (personaUuid) loadEntities(); });

  let entitiesByType = $derived(() => {
    const m = {};
    for (const e of entities) {
      const t = e.type || "autre";
      (m[t] ||= []).push(e);
    }
    return m;
  });

  let entityTypeOrder = ["concept", "framework", "person", "company", "metric", "belief", "tool", "autre"];
  let entityTypeLabel = {
    concept: "Concepts",
    framework: "Frameworks",
    person: "Personnes",
    company: "Entreprises",
    metric: "Metrics",
    belief: "Convictions",
    tool: "Outils",
    autre: "Autres",
  };

  function goBack() {
    if (personaUuid) goto(`/brain/${personaUuid}`);
    else if (typeof window !== "undefined" && window.history.length > 1) history.back();
  }
</script>

<svelte:head><title>Cerveau · clone de {$personaConfig?.name || "?"}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <button class="back-btn" onclick={goBack}>← cockpit</button>
    <div class="title">
      <span class="avatar">{$personaConfig?.avatar || "?"}</span>
      <h1>Cerveau · <span class="clone-of">clone de</span> {$personaConfig?.name || "?"}</h1>
    </div>
  </header>

  <p class="intro">
    <strong>Le contenu structuré de ton clone :</strong> protocole (doctrine, règles, patterns) et intelligence (entités, frameworks, convictions).
    Pour les <strong>décisions</strong> à prendre (arbitrage, validation propositions), retourne au <button class="link-btn" onclick={goBack}>cockpit</button>.
  </p>

  <section class="section">
    <h2 class="section-title">📚 Protocole</h2>
    {#if personaUuid}
      <ProtocolPanel personaId={personaUuid} />
    {:else}
      <p class="loading">Chargement…</p>
    {/if}
  </section>

  <section class="section">
    <h2 class="section-title">🧠 Intelligence — entités du clone</h2>
    {#if entitiesLoading && entities.length === 0}
      <p class="loading">Chargement des entités…</p>
    {:else if entitiesError}
      <p class="error">Erreur chargement : {entitiesError}</p>
    {:else if entities.length === 0}
      <p class="empty">Aucune entité reconnue. Le clone identifie automatiquement concepts / personnes / metrics / convictions au fil des conversations et docs importés.</p>
    {:else}
      <p class="meta">{entities.length} entités identifiées · groupées par type ci-dessous</p>
      {#each entityTypeOrder as type}
        {@const list = entitiesByType()[type] || []}
        {#if list.length > 0}
          <div class="type-group">
            <h3 class="type-title">{entityTypeLabel[type]} <span class="count">{list.length}</span></h3>
            <div class="chips">
              {#each list as e (e.id || e.name)}
                <span class="chip" title={e.description || ""}>{e.name}</span>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
    <p class="hint">Vue graphe / drill-down par entité arrive en V2.1.</p>
  </section>
</div>

<style>
  .page { max-width: 1180px; margin: 0 auto; padding: 24px 28px 80px; min-height: 100dvh; }
  .page-head { display: flex; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--rule); margin-bottom: 18px; }
  .title { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; }
  .avatar { font-size: 22px; }
  h1 { margin: 0; font-family: var(--font, Georgia, serif); font-size: 22px; font-weight: 500; }
  .clone-of { font-family: var(--font-mono); font-size: 12px; font-weight: normal; color: var(--ink-40); letter-spacing: 0.02em; }

  .back-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
    color: var(--ink-40);
  }
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
  .intro strong { color: var(--ink); font-weight: 600; }

  .link-btn {
    background: transparent;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .link-btn:hover { color: var(--vermillon); }

  .section { margin-top: 36px; }
  .section-title {
    font-family: var(--font, Georgia, serif);
    font-weight: 500;
    font-size: 21px;
    letter-spacing: -0.01em;
    margin: 0 0 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule);
  }

  .loading, .empty, .error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    padding: 16px 0;
  }
  .error { color: var(--vermillon); }
  .meta {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    margin: 8px 0 16px;
  }

  .type-group { margin-bottom: 18px; }
  .type-title {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-70);
    margin: 0 0 8px;
    font-weight: 500;
  }
  .type-title .count {
    color: var(--ink-40);
    font-weight: normal;
    margin-left: 6px;
  }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font-family: var(--font, Georgia, serif);
    font-size: 13px;
    padding: 4px 10px;
    background: var(--paper-subtle, #ecebe4);
    border: 1px solid var(--rule);
    border-radius: 12px;
    color: var(--ink);
    cursor: default;
  }
  .chip:hover { background: var(--paper); border-color: var(--rule-strong); }

  .hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    margin-top: 14px;
    font-style: italic;
  }
</style>
