<script>
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { accessCode, sessionToken, isAdmin } from "$lib/stores/auth.js";
  import { personas, canCreateClone, personaConfig, currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { api, authHeaders } from "$lib/api.js";
  import { track } from "$lib/tracking.js";
  import StyleFingerprint from "$lib/components/StyleFingerprint.svelte";

  /** @type {Array<{persona: any, config: any, scenarios: Array<{key: string, label: string, description: string}>}>} */
  let personaConfigs = $state([]);
  let loadingHub = $state(true);
  let fidelityScores = $state({});

  async function loadFidelityScores(configs) {
    const ids = configs.map(e => e.persona.id).filter(Boolean);
    if (ids.length === 0) return;
    try {
      const data = await api(`/api/fidelity?personas=${ids.join(",")}`);
      fidelityScores = data.scores || {};
    } catch {
      // Non-blocking — hub works fine without scores
    }
  }

  function gaugeArc(score) {
    const r = 14;
    const circumference = Math.PI * r;
    const offset = circumference * (1 - score / 100);
    return { r, circumference, offset };
  }

  // Per-persona theme overrides disabled — laboratoire owns the surface.
  function applyTheme(_theme) { /* no-op */ }

  onMount(async () => {
    if (!$accessCode && !$sessionToken) {
      goto("/");
      return;
    }
    try {
      const resp = await fetch("/api/personas", { headers: authHeaders() });
      if (!resp.ok) {
        goto("/");
        return;
      }
      const data = await resp.json();
      personas.set(data.personas);
      canCreateClone.set(data.canCreateClone || false);
      isAdmin.set(data.isAdmin || false);
      if (data.session?.token) sessionToken.set(data.session.token);
      await loadPersonaConfigs(data.personas);
    } catch {
      goto("/");
    }
  });

  async function loadPersonaConfigs(personaList) {
    const configs = [];
    for (const p of personaList) {
      try {
        const resp = await fetch(`/api/config?persona=${p.id}`, { headers: authHeaders() });
        if (!resp.ok) continue;
        const config = await resp.json();
        const scenarios = Object.entries(config.scenarios || {}).map(([key, val]) => ({
          key,
          label: val.label,
          description: val.description,
        }));
        configs.push({ persona: p, config, scenarios });
      } catch {
        // skip this persona
      }
    }
    personaConfigs = configs;
    loadFidelityScores(configs);
    loadingHub = false;
  }

  function openScenario(personaEntry, scenarioKey) {
    personaConfig.set(personaEntry.config);
    currentPersonaId.set(personaEntry.persona.id);
    applyTheme(personaEntry.config.theme || {});
    localStorage.setItem("vc_last_persona", JSON.stringify({
      id: personaEntry.persona.id,
      name: personaEntry.persona.name,
      avatar: personaEntry.persona.avatar,
    }));
    goto(`/chat/${personaEntry.persona.id}?scenario=${scenarioKey}`);
  }

  async function shareClone(personaId, event) {
    event.stopPropagation();
    try {
      const resp = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ persona_id: personaId }),
      });
      if (!resp.ok) throw new Error("Failed");
      const { token } = await resp.json();
      track("share_created", { persona_id: personaId });
      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url);
      showToast("Lien de partage copie !");
    } catch {
      showToast("Erreur lors du partage");
    }
  }

  function openPersona(personaEntry) {
    if (personaEntry.scenarios.length === 1) {
      openScenario(personaEntry, personaEntry.scenarios[0].key);
    } else {
      personaConfig.set(personaEntry.config);
      currentPersonaId.set(personaEntry.persona.id);
      applyTheme(personaEntry.config.theme || {});
      localStorage.setItem("vc_last_persona", JSON.stringify({
        id: personaEntry.persona.id,
        name: personaEntry.persona.name,
        avatar: personaEntry.persona.avatar,
      }));
      goto(`/chat/${personaEntry.persona.id}`);
    }
  }
</script>

<div class="hub-page">
  <header class="hub-head">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">VoiceClone</span>
      <span class="brand-sub">/ hub</span>
    </div>
    <nav class="head-meta mono">
      <span class="kv"><span class="k">clones</span><span class="v">{personaConfigs.length}</span></span>
      {#if $isAdmin}
        <span class="kv kv-admin"><span class="dot"></span><span class="v">admin</span></span>
      {/if}
      {#if $canCreateClone || $isAdmin}
        <button class="head-action" onclick={() => goto("/create")}>+ Créer</button>
      {/if}
    </nav>
  </header>

<div class="hub">
  {#if loadingHub}
    <p class="hub-loading mono">Chargement…</p>
  {:else}
    {#if personaConfigs.some(e => !e.persona._shared)}
      <section class="hub-section">
        <h2 class="hub-section-title">Mes clones</h2>
        {#each personaConfigs.filter(e => !e.persona._shared) as entry, i}
          <div class="clone-card" transition:fly={{ y: 12, delay: i * 80, duration: 200 }}>
            <button class="clone-header" onclick={() => openPersona(entry)}>
              <div class="clone-avatar">{entry.persona.avatar || "?"}</div>
              {#if fidelityScores[entry.persona.id]?.draft_style}
                <div class="clone-fingerprint">
                  <StyleFingerprint
                    draft={fidelityScores[entry.persona.id].draft_style}
                    source={fidelityScores[entry.persona.id].source_style}
                    size={34}
                    strokeWidth={1}
                    tooltip
                  />
                </div>
              {/if}
              <div class="clone-info">
                <strong>{entry.persona.name}</strong>
                {#if entry.persona.title}
                  <span class="clone-title">{entry.persona.title}</span>
                {/if}
              </div>
              {#if fidelityScores[entry.persona.id]}
                {@const fScore = fidelityScores[entry.persona.id]}
                <div
                  class="fidelity-chip mono"
                  title="Fidelity cosine: {typeof fScore.score_raw === 'number' ? fScore.score_raw.toFixed(3) : '—'} · composite: {fScore.score_global}"
                  class:fidelity-ok={fScore.score_global >= 75}
                  class:fidelity-warn={fScore.score_global >= 50 && fScore.score_global < 75}
                  class:fidelity-bad={fScore.score_global < 50}
                >
                  <span class="chip-k">fid</span>
                  <span class="chip-v">{typeof fScore.score_raw === 'number' ? fScore.score_raw.toFixed(2) : '—'}</span>
                </div>
              {/if}
            </button>
            <button class="share-btn" onclick={(e) => shareClone(entry.persona.id, e)} title="Partager">Partager</button>
            <a
              class="brain-link mono"
              href="/brain/{entry.persona.id}"
              onclick={(e) => e.stopPropagation()}
              title="Cerveau du clone — connaissance, intelligence, réglages"
              aria-label="Cerveau de {entry.persona.name}"
            >⚙ cerveau</a>
            {#if entry.scenarios.length > 1}
              <div class="clone-scenarios">
                {#each entry.scenarios as scenario}
                  <button class="scenario-btn" onclick={() => openScenario(entry, scenario.key)}>
                    <strong>{scenario.label}</strong>
                    <span>{scenario.description}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </section>
    {/if}

    {#if personaConfigs.some(e => e.persona._shared)}
      <section class="hub-section">
        <h2 class="hub-section-title">Clones partagés</h2>
        {#each personaConfigs.filter(e => e.persona._shared) as entry, i}
          <div class="clone-card" transition:fly={{ y: 12, delay: i * 80, duration: 200 }}>
            <button class="clone-header" onclick={() => openPersona(entry)}>
              <div class="clone-avatar">{entry.persona.avatar || "?"}</div>
              {#if fidelityScores[entry.persona.id]?.draft_style}
                <div class="clone-fingerprint">
                  <StyleFingerprint
                    draft={fidelityScores[entry.persona.id].draft_style}
                    source={fidelityScores[entry.persona.id].source_style}
                    size={34}
                    strokeWidth={1}
                    tooltip
                  />
                </div>
              {/if}
              <div class="clone-info">
                <strong>{entry.persona.name}</strong>
                <span class="shared-badge">Partage par {entry.persona._shared_by}</span>
              </div>
              {#if fidelityScores[entry.persona.id]}
                {@const fScore = fidelityScores[entry.persona.id]}
                <div
                  class="fidelity-chip mono"
                  title="Fidelity cosine: {typeof fScore.score_raw === 'number' ? fScore.score_raw.toFixed(3) : '—'} · composite: {fScore.score_global}"
                  class:fidelity-ok={fScore.score_global >= 75}
                  class:fidelity-warn={fScore.score_global >= 50 && fScore.score_global < 75}
                  class:fidelity-bad={fScore.score_global < 50}
                >
                  <span class="chip-k">fid</span>
                  <span class="chip-v">{typeof fScore.score_raw === 'number' ? fScore.score_raw.toFixed(2) : '—'}</span>
                </div>
              {/if}
            </button>
            {#if entry.scenarios.length > 1}
              <div class="clone-scenarios">
                {#each entry.scenarios as scenario}
                  <button class="scenario-btn" onclick={() => openScenario(entry, scenario.key)}>
                    <strong>{scenario.label}</strong>
                    <span>{scenario.description}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </section>
    {/if}

    {#if $isAdmin}
      <section class="hub-section">
        <h2 class="hub-section-title">Administration</h2>
        <a href="/admin" class="action-card" transition:fly={{ y: 12, delay: personaConfigs.length * 80 + 40, duration: 200 }}>
          <div class="action-icon">~</div>
          <div class="action-info">
            <strong>Dashboard admin</strong>
            <span>Monitoring clients, personas, activite</span>
          </div>
        </a>
      </section>
    {/if}

    <section class="hub-section">
      <h2 class="hub-section-title">Ressources</h2>
      <a href="/guide" class="action-card" transition:fly={{ y: 12, delay: personaConfigs.length * 80 + ($isAdmin ? 120 : 40), duration: 200 }}>
        <div class="action-icon">?</div>
        <div class="action-info">
          <strong>Guide d'onboarding</strong>
          <span>Process, base de connaissances, boucle de feedback</span>
        </div>
      </a>
    </section>
  {/if}
</div>
</div>

<style>
  .hub-page {
    min-height: 100dvh;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
  }

  .hub-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    gap: 20px;
    flex-wrap: wrap;
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
  }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: var(--fw-semi); color: var(--ink); }
  .brand-sub { color: var(--ink-40); }
  .head-meta {
    display: inline-flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: baseline;
  }
  .kv { display: inline-flex; gap: 6px; align-items: baseline; }
  .k { color: var(--ink-40); text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--fs-nano); }
  .v { color: var(--ink); font-variant-numeric: tabular-nums; }
  .kv-admin .dot {
    display: inline-block;
    width: 6px; height: 6px;
    background: var(--vermillon);
    transform: translateY(-1px);
    animation: admin-pulse 1.8s linear infinite;
  }
  @keyframes admin-pulse {
    0%, 60%, 100% { opacity: 1; }
    80% { opacity: 0.25; }
  }

  .head-action {
    padding: 2px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink);
    background: transparent;
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    line-height: 1.4;
  }
  .head-action:hover { border-color: var(--vermillon); color: var(--vermillon); }

  .hub {
    max-width: 620px;
    margin: 0 auto;
    padding: 36px 20px 56px;
  }

  .hub-loading {
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .hub-section { margin-bottom: 1.75rem; }

  .hub-section-title {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.5rem;
  }

  .clone-card {
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid transparent;
    overflow: hidden;
    margin-bottom: 4px;
    position: relative;
    transition: border-color var(--dur-fast) var(--ease);
  }
  .clone-card:hover { border-left-color: var(--vermillon); }

  .clone-header {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
    color: var(--ink);
    transition: background var(--dur-fast) var(--ease);
  }
  .clone-header:hover { background: var(--paper); }

  .clone-avatar {
    width: 34px; height: 34px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    font-weight: var(--fw-semi);
    flex-shrink: 0;
  }

  .clone-fingerprint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-right: -4px;
  }

  .clone-info { min-width: 0; flex: 1; }
  .clone-info strong {
    display: block;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--ink);
    letter-spacing: -0.01em;
  }

  .clone-title, .shared-badge {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    line-height: var(--lh-snug);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .shared-badge { color: var(--vermillon); }

  .share-btn {
    position: absolute;
    top: 0.75rem; right: 0.75rem;
    padding: 0.25rem 0.625rem;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--text-tertiary);
    background: transparent;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: color 0.08s linear, border-color 0.08s linear;
    z-index: 1;
  }
  .share-btn:hover { color: var(--text); border-color: var(--text-tertiary); }

  .brain-link {
    position: absolute;
    top: 0.75rem; right: 6rem;
    padding: 0.25rem 0.625rem;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--text-tertiary);
    background: transparent;
    border: 1px solid var(--border);
    cursor: pointer;
    text-decoration: none;
    transition: color 0.08s linear, border-color 0.08s linear;
    z-index: 1;
  }
  .brain-link:hover { color: var(--text); border-color: var(--text-tertiary); }

  .clone-scenarios {
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .scenario-btn {
    width: 100%;
    padding: 0.625rem 1rem 0.625rem 3.25rem;
    background: transparent;
    border: none;
    border-top: 1px solid var(--rule);
    text-align: left;
    cursor: pointer;
    font-family: var(--font);
    color: var(--text);
    transition: background 0.08s linear;
  }

  .scenario-btn:first-child { border-top: none; }
  .scenario-btn:hover { background: var(--surface-hover); }

  .scenario-btn strong {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    margin-bottom: 0.0625rem;
  }

  .scenario-btn span {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .action-card {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: 1px dashed var(--rule-strong);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
    color: var(--ink);
    text-decoration: none;
    transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
    margin-bottom: 4px;
  }

  .action-card:hover {
    border-color: var(--vermillon);
    border-style: solid;
    background: var(--paper-subtle);
  }

  .action-icon {
    width: 34px; height: 34px;
    border: 1px dashed var(--ink-40);
    color: var(--vermillon);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    font-weight: var(--fw-semi);
    flex-shrink: 0;
  }

  .action-info strong {
    display: block;
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--ink);
  }
  .action-info span {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    line-height: var(--lh-snug);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .fidelity-chip {
    margin-left: auto;
    flex-shrink: 0;
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 2px 7px;
    border: 1px solid var(--rule-strong);
    font-size: var(--fs-nano);
    font-variant-numeric: tabular-nums;
  }
  .fidelity-chip .chip-k {
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .fidelity-chip .chip-v {
    color: var(--ink);
    font-weight: var(--fw-semi);
  }
  .fidelity-ok { border-color: var(--ink-40); }
  .fidelity-warn { border-color: #b87300; }
  .fidelity-warn .chip-v { color: #b87300; }
  .fidelity-bad { border-color: var(--vermillon); }
  .fidelity-bad .chip-v { color: var(--vermillon); }

  @media (max-width: 480px) {
    .hub { padding: 24px 14px 40px; }
    .hub-head { padding: 8px 14px; }
  }
</style>
