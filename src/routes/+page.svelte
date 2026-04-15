<script>
  import { goto } from "$app/navigation";
  import { fly, fade } from "svelte/transition";
  import { accessCode, sessionToken, isAdmin } from "$lib/stores/auth.js";
  import { personas, canCreateClone, personaConfig, currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { api, authHeaders } from "$lib/api.js";
  import PersonaCard from "$lib/components/PersonaCard.svelte";
  import ScenarioPill from "$lib/components/ScenarioPill.svelte";

  /** @type {"idle" | "personas" | "scenarios"} */
  let state = $state("idle");
  let code = $state("");
  let error = $state("");
  let shaking = $state(false);
  let loading = $state(false);

  /** @type {any} */
  let selectedPersona = $state(null);
  let scenarios = $state([]);

  let inputEl = $state(undefined);

  // Last persona from localStorage
  let lastPersona = $state(null);

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem("vc_last_persona");
        if (raw) lastPersona = JSON.parse(raw);
      } catch {
        // ignore
      }
    }
  });

  // Auto-focus input on mount
  $effect(() => {
    if (state === "idle" && inputEl) {
      inputEl.focus();
    }
  });

  // If already authenticated, redirect
  $effect(() => {
    if ($accessCode && state === "idle") {
      // Already logged in — fetch personas
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

      state = "personas";
    } catch {
      error = "Erreur de connexion";
    } finally {
      loading = false;
    }
  }

  function onKeydown(e) {
    if (e.key === "Enter") handleSubmit();
  }

  async function selectPersona(persona) {
    selectedPersona = persona;
    loading = true;

    try {
      const resp = await fetch(`/api/config?persona=${persona.id}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error("Failed to load config");

      const config = await resp.json();
      personaConfig.set(config);
      currentPersonaId.set(persona.id);
      applyTheme(config.theme || {});

      // Save to localStorage
      localStorage.setItem("vc_last_persona", JSON.stringify({
        id: persona.id,
        name: persona.name,
        avatar: persona.avatar,
      }));

      const keys = Object.keys(config.scenarios || {});
      if (keys.length === 1) {
        goto(`/chat/${persona.id}?scenario=${keys[0]}`);
      } else {
        scenarios = Object.entries(config.scenarios || {}).map(([key, val]) => ({
          key,
          label: val.label,
          description: val.description,
        }));
        state = "scenarios";
      }
    } catch {
      showToast("Erreur de chargement du client");
    } finally {
      loading = false;
    }
  }

  function selectScenario(key) {
    goto(`/chat/${selectedPersona.id}?scenario=${key}`);
  }

  async function resumeLastPersona() {
    if (!lastPersona) return;
    loading = true;

    try {
      const resp = await fetch(`/api/config?persona=${lastPersona.id}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) {
        localStorage.removeItem("vc_last_persona");
        lastPersona = null;
        showToast("Clone indisponible");
        loading = false;
        return;
      }

      const config = await resp.json();
      personaConfig.set(config);
      currentPersonaId.set(lastPersona.id);
      applyTheme(config.theme || {});

      goto(`/chat/${lastPersona.id}`);
    } catch {
      localStorage.removeItem("vc_last_persona");
      lastPersona = null;
      showToast("Clone indisponible");
    } finally {
      loading = false;
    }
  }
</script>

<svelte:window onkeydown={state === "idle" ? onKeydown : undefined} />

<div class="login-screen">
  {#if state === "idle"}
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
      {#if lastPersona}
        <button class="resume-btn" onclick={resumeLastPersona} disabled={loading}>
          Reprendre avec {lastPersona.name}
        </button>
      {/if}
    </div>
  {:else if state === "personas"}
    <div class="access-card" transition:fade={{ duration: 150 }}>
      <h1>Choisissez un client</h1>
      <div class="persona-list">
        {#each $personas as persona, i}
          <PersonaCard {persona} index={i} onclick={() => selectPersona(persona)} />
        {/each}
        {#if $canCreateClone}
          <button class="persona-card persona-card-create" transition:fly={{ y: 12, delay: $personas.length * 80, duration: 150 }} onclick={() => goto("/create")}>
            <div class="persona-card-avatar">+</div>
            <div>
              <strong>Creer un clone</strong>
              <span class="persona-card-title">A partir d'un profil LinkedIn</span>
            </div>
          </button>
        {/if}
      </div>
    </div>
  {:else if state === "scenarios"}
    <div class="access-card" transition:fade={{ duration: 150 }}>
      <h1>{selectedPersona?.name}</h1>
      <div class="scenario-list">
        {#each scenarios as scenario, i}
          <ScenarioPill {scenario} index={i} onclick={() => selectScenario(scenario.key)} />
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .login-screen {
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

  .access-form input:focus {
    border-color: var(--text-tertiary);
  }

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

  .resume-btn {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: var(--surface);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.75rem;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    width: 100%;
  }

  .resume-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text);
  }

  .resume-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .persona-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 1.5rem;
    text-align: left;
  }

  .persona-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
  }

  .persona-card:hover {
    border-color: var(--text-tertiary);
    background: #1f1f23;
  }

  .persona-card-create {
    border-style: dashed;
    border-color: var(--border);
  }

  .persona-card-create .persona-card-avatar {
    background: transparent;
    border: 1px dashed var(--text-tertiary);
    color: var(--text-tertiary);
    font-size: 0.875rem;
  }

  .persona-card-avatar {
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

  .persona-card strong {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text);
  }

  .persona-card-title {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }

  .scenario-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 1.25rem;
  }

  @media (max-width: 480px) {
    .access-card { padding: 2rem 1.25rem; }
  }
</style>
