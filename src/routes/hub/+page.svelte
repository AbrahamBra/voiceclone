<script>
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import { accessCode, sessionToken, isAdmin } from "$lib/stores/auth.js";
  import { personas, canCreateClone, personaConfig, currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { api, authHeaders } from "$lib/api.js";
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

<div class="hub">
  <h1 class="hub-title">VoiceClone</h1>

  {#if loadingHub}
    <p class="hub-loading">Chargement...</p>
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
                {@const g = gaugeArc(fScore.score_global)}
                <div class="fidelity-gauge" title="Fidelite vocale: {fScore.score_global}%">
                  <svg viewBox="0 0 36 20" width="36" height="20">
                    <path d="M 4 18 A 14 14 0 0 1 32 18" fill="none"
                      stroke="var(--border)" stroke-width="2.5" stroke-linecap="round" />
                    <path d="M 4 18 A 14 14 0 0 1 32 18" fill="none"
                      stroke={fScore.score_global >= 75 ? 'var(--success)' : fScore.score_global >= 50 ? 'var(--warning)' : 'var(--error)'}
                      stroke-width="2.5" stroke-linecap="round"
                      stroke-dasharray={g.circumference} stroke-dashoffset={g.offset} />
                  </svg>
                  <span class="fidelity-score">{fScore.score_global}</span>
                </div>
              {/if}
            </button>
            <button class="share-btn" onclick={(e) => shareClone(entry.persona.id, e)} title="Partager">Partager</button>
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
        <h2 class="hub-section-title">Clones partages</h2>
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
                  />
                </div>
              {/if}
              <div class="clone-info">
                <strong>{entry.persona.name}</strong>
                <span class="shared-badge">Partage par {entry.persona._shared_by}</span>
              </div>
              {#if fidelityScores[entry.persona.id]}
                {@const fScore = fidelityScores[entry.persona.id]}
                {@const g = gaugeArc(fScore.score_global)}
                <div class="fidelity-gauge" title="Fidelite vocale: {fScore.score_global}%">
                  <svg viewBox="0 0 36 20" width="36" height="20">
                    <path d="M 4 18 A 14 14 0 0 1 32 18" fill="none"
                      stroke="var(--border)" stroke-width="2.5" stroke-linecap="round" />
                    <path d="M 4 18 A 14 14 0 0 1 32 18" fill="none"
                      stroke={fScore.score_global >= 75 ? 'var(--success)' : fScore.score_global >= 50 ? 'var(--warning)' : 'var(--error)'}
                      stroke-width="2.5" stroke-linecap="round"
                      stroke-dasharray={g.circumference} stroke-dashoffset={g.offset} />
                  </svg>
                  <span class="fidelity-score">{fScore.score_global}</span>
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

    {#if $canCreateClone || $isAdmin}
      <section class="hub-section">
        <h2 class="hub-section-title">Nouveau clone</h2>
        <button class="action-card" onclick={() => goto("/create")} transition:fly={{ y: 12, delay: personaConfigs.length * 80 + 40, duration: 200 }}>
          <div class="action-icon">+</div>
          <div class="action-info">
            <strong>Creer un clone</strong>
            <span>A partir d'un profil de reseau social</span>
          </div>
        </button>
      </section>
    {/if}

    {#if $isAdmin}
      <section class="hub-section">
        <h2 class="hub-section-title">Administration</h2>
        <a href="/admin" class="action-card" transition:fly={{ y: 12, delay: personaConfigs.length * 80 + 120, duration: 200 }}>
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
      <a href="/guide" class="action-card" transition:fly={{ y: 12, delay: personaConfigs.length * 80 + ($isAdmin ? 200 : 120), duration: 200 }}>
        <div class="action-icon">?</div>
        <div class="action-info">
          <strong>Guide d'onboarding</strong>
          <span>Process, base de connaissances, boucle de feedback</span>
        </div>
      </a>
    </section>
  {/if}
</div>

<style>
  .hub {
    max-width: 440px;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
    min-height: 100dvh;
  }

  .hub-title {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-bottom: 2rem;
  }

  .hub-loading {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-tertiary);
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
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
    margin-bottom: 0.375rem;
    position: relative;
  }

  .clone-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
    transition: background 0.08s linear;
  }

  .clone-header:hover { background: var(--surface-hover); }

  .clone-avatar {
    width: 32px; height: 32px;
    background: var(--border);
    color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .clone-fingerprint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-right: -4px;
  }

  .clone-info strong {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .clone-title, .shared-badge {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }
  .shared-badge { color: var(--accent); }

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
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px dashed var(--border);
    cursor: pointer;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
    text-decoration: none;
    transition: border-color 0.08s linear, background 0.08s linear;
    margin-bottom: 0.375rem;
  }

  .action-card:hover {
    border-color: var(--text-tertiary);
    background: var(--surface-hover);
  }

  .action-icon {
    width: 32px; height: 32px;
    border: 1px dashed var(--text-tertiary);
    color: var(--text-tertiary);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .action-info strong { display: block; font-size: 0.8125rem; font-weight: 500; }
  .action-info span {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }

  .fidelity-gauge {
    position: relative;
    flex-shrink: 0;
    margin-left: auto;
    width: 36px; height: 24px;
    display: flex; align-items: flex-end; justify-content: center;
  }
  .fidelity-gauge svg { position: absolute; top: 0; left: 0; }
  .fidelity-score {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    position: relative;
    line-height: 1;
  }

  @media (max-width: 480px) {
    .hub { padding: 2rem 1rem 3rem; }
  }
</style>
