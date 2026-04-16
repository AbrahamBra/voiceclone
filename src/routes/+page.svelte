<script>
  import { goto } from "$app/navigation";
  import { fly, fade } from "svelte/transition";
  import { accessCode, sessionToken, isAdmin } from "$lib/stores/auth.js";
  import { personas, canCreateClone, personaConfig, currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { api, authHeaders } from "$lib/api.js";

  let state = $state("idle");
  let code = $state("");
  let error = $state("");
  let shaking = $state(false);
  let loading = $state(false);
  let inputEl = $state(undefined);

  // Hub state: persona configs loaded after login
  /** @type {Array<{persona: any, config: any, scenarios: Array<{key: string, label: string, description: string}>}>} */
  let personaConfigs = $state([]);
  let loadingHub = $state(false);

  // Auto-focus input on mount
  $effect(() => {
    if (state === "idle" && inputEl) {
      inputEl.focus();
    }
  });

  // If already authenticated, redirect
  $effect(() => {
    if ($accessCode && state === "idle") {
      handleSubmit();
    }
  });

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme.accent) root.style.setProperty("--accent", theme.accent);
    if (theme.background) root.style.setProperty("--bg", theme.background);
    if (theme.surface) root.style.setProperty("--surface", theme.surface);
    if (theme.text) root.style.setProperty("--text", theme.text);
  }

  async function handleSubmit() {
    const submitCode = code.trim() || $accessCode;
    if (!submitCode) return;

    error = "";
    loading = true;

    try {
      const resp = await fetch("/api/personas", {
        headers: { "x-access-code": submitCode },
      });

      if (resp.status === 403) {
        error = "Code d'acces invalide";
        shaking = true;
        setTimeout(() => { shaking = false; }, 400);
        loading = false;
        return;
      }

      if (!resp.ok) throw new Error("Server error");

      const data = await resp.json();

      accessCode.set(submitCode);
      if (data.session?.token) sessionToken.set(data.session.token);
      personas.set(data.personas);
      canCreateClone.set(data.canCreateClone || false);
      isAdmin.set(data.isAdmin || false);

      // Load all persona configs for the hub
      await loadPersonaConfigs(data.personas);

      state = "hub";
    } catch {
      error = "Erreur de connexion";
    } finally {
      loading = false;
    }
  }

  async function loadPersonaConfigs(personaList) {
    loadingHub = true;
    const configs = [];
    for (const p of personaList) {
      try {
        const resp = await fetch(`/api/config?persona=${p.id}`, {
          headers: authHeaders(),
        });
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
    loadingHub = false;
  }

  function onKeydown(e) {
    if (e.key === "Enter") handleSubmit();
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

<svelte:window onkeydown={state === "idle" ? onKeydown : undefined} />

<div class="page">
  {#if state === "idle"}
    <div class="center-wrap">
      <div class="access-card" transition:fade={{ duration: 150 }}>
        <h1>VoiceClone</h1>
        <p class="subtitle">Entrez votre code d'acces</p>
        <div class="access-form">
          <input
            type="password"
            autocomplete="off"
            placeholder="Code d'acces"
            class:shake={shaking}
            bind:value={code}
            bind:this={inputEl}
            disabled={loading}
          />
          <button onclick={handleSubmit} disabled={loading}>
            {loading ? "..." : "Entrer"}
          </button>
        </div>
        {#if error}
          <p class="error">{error}</p>
        {/if}
        <a href="/guide" class="guide-link">Guide d'onboarding</a>
      </div>
    </div>

  {:else if state === "hub"}
    <div class="hub" transition:fade={{ duration: 150 }}>
      <h1 class="hub-title">VoiceClone</h1>

      {#if loadingHub}
        <p class="hub-loading">Chargement...</p>
      {:else}
        <!-- Existing personas with inline scenarios -->
        {#if personaConfigs.length > 0}
          <section class="hub-section">
            <h2 class="hub-section-title">Mes clones</h2>
            {#each personaConfigs as entry, i}
              <div class="clone-card" transition:fly={{ y: 12, delay: i * 80, duration: 200 }}>
                <button class="clone-header" onclick={() => openPersona(entry)}>
                  <div class="clone-avatar">{entry.persona.avatar || "?"}</div>
                  <div class="clone-info">
                    <strong>{entry.persona.name}</strong>
                    {#if entry.persona.title}
                      <span class="clone-title">{entry.persona.title}</span>
                    {/if}
                  </div>
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

        <!-- Create clone -->
        {#if $canCreateClone || $isAdmin}
          <section class="hub-section">
            <h2 class="hub-section-title">Nouveau clone</h2>
            <button class="action-card" onclick={() => goto("/create")} transition:fly={{ y: 12, delay: personaConfigs.length * 80 + 40, duration: 200 }}>
              <div class="action-icon">+</div>
              <div class="action-info">
                <strong>Creer un clone</strong>
                <span>A partir d'un profil LinkedIn</span>
              </div>
            </button>
          </section>
        {/if}

        <!-- Guide -->
        <section class="hub-section">
          <h2 class="hub-section-title">Ressources</h2>
          <a href="/guide" class="action-card" transition:fly={{ y: 12, delay: personaConfigs.length * 80 + 120, duration: 200 }}>
            <div class="action-icon">?</div>
            <div class="action-info">
              <strong>Guide d'onboarding</strong>
              <span>Process, base de connaissances, boucle de feedback</span>
            </div>
          </a>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page {
    min-height: 100dvh;
  }

  /* ---- Login ---- */
  .center-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
  }

  .access-card {
    text-align: center;
    padding: 2.5rem 2rem;
    max-width: 380px;
    width: 100%;
  }

  .access-card h1 {
    font-size: 1.125rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--text);
    margin-bottom: 0.25rem;
  }

  .subtitle {
    font-size: 0.8125rem;
    color: var(--text-tertiary);
    margin-bottom: 2rem;
    font-weight: 400;
  }

  .access-form {
    display: flex;
    gap: 0.5rem;
  }

  .access-form input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s;
  }

  .access-form input:focus { border-color: var(--text-tertiary); }
  .access-form input::placeholder { color: var(--text-tertiary); }

  .access-form button {
    padding: 0.5rem 1rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: var(--radius);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .access-form button:hover { opacity: 0.85; }
  .access-form button:disabled { opacity: 0.4; cursor: not-allowed; }

  .error {
    color: var(--error);
    font-size: 0.75rem;
    margin-top: 0.75rem;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-4px); }
    40%, 80% { transform: translateX(4px); }
  }

  .shake { animation: shake 0.3s ease; }

  .guide-link {
    display: block;
    margin-top: 1.5rem;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    text-decoration: none;
    transition: color 0.15s;
  }

  .guide-link:hover { color: var(--text-secondary); }

  /* ---- Hub ---- */
  .hub {
    max-width: 440px;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
  }

  .hub-title {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--text);
    margin-bottom: 2rem;
  }

  .hub-loading {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }

  .hub-section {
    margin-bottom: 1.75rem;
  }

  .hub-section-title {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  /* Clone card */
  .clone-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: 0.375rem;
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
    transition: background 0.15s;
  }

  .clone-header:hover { background: rgba(255, 255, 255, 0.03); }

  .clone-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .clone-info strong {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .clone-title {
    display: block;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }

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
    border-top: 1px solid rgba(255, 255, 255, 0.03);
    text-align: left;
    cursor: pointer;
    font-family: var(--font);
    color: var(--text);
    transition: background 0.15s;
  }

  .scenario-btn:first-child { border-top: none; }
  .scenario-btn:hover { background: rgba(255, 255, 255, 0.03); }

  .scenario-btn strong {
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    margin-bottom: 0.0625rem;
  }

  .scenario-btn span {
    display: block;
    font-size: 0.625rem;
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  /* Action cards (create + guide) */
  .action-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
    text-decoration: none;
    transition: border-color 0.15s, background 0.15s;
    margin-bottom: 0.375rem;
  }

  .action-card:hover {
    border-color: var(--text-tertiary);
    background: #1f1f23;
  }

  .action-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: transparent;
    border: 1px dashed var(--text-tertiary);
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8125rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .action-info strong {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .action-info span {
    display: block;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }

  @media (max-width: 480px) {
    .access-card { padding: 2rem 1.25rem; }
    .hub { padding: 2rem 1rem 3rem; }
  }
</style>
