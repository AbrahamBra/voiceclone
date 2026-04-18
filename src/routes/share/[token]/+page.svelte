<script>
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { fade } from "svelte/transition";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { authHeaders } from "$lib/api.js";
  import { track } from "$lib/tracking.js";

  let state = $state("loading"); // loading | login | preview | already | claimed | error
  let persona = $state(null);
  let personaId = $state(null);
  let errorMsg = $state("");
  let code = $state("");
  let claiming = $state(false);
  let sharedByName = $state(null);

  const token = $page.params.token;

  $effect(() => {
    if ($accessCode) {
      loadPreview();
    } else {
      state = "login";
    }
  });

  async function loadPreview() {
    try {
      const resp = await fetch(`/api/share?token=${token}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        errorMsg = data.error || "Lien invalide";
        state = "error";
        return;
      }
      const data = await resp.json();
      persona = data.persona;
      personaId = data.persona_id;
      sharedByName = data.shared_by_name || null;
      state = data.already_shared ? "already" : "preview";
    } catch {
      errorMsg = "Erreur de connexion";
      state = "error";
    }
  }

  async function handleLogin() {
    const submitCode = code.trim();
    if (!submitCode) return;
    try {
      const resp = await fetch("/api/personas", {
        headers: { "x-access-code": submitCode },
      });
      if (!resp.ok) { errorMsg = "Code invalide"; return; }
      const data = await resp.json();
      accessCode.set(submitCode);
      if (data.session?.token) sessionToken.set(data.session.token);
      await loadPreview();
    } catch {
      errorMsg = "Erreur de connexion";
    }
  }

  async function claimShare() {
    claiming = true;
    try {
      const resp = await fetch(`/api/share?token=${token}`, {
        method: "PUT",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        errorMsg = data.error || "Erreur";
        state = "error";
        return;
      }
      state = "claimed";
      track("share_claimed", {});
    } catch {
      errorMsg = "Erreur de connexion";
      state = "error";
    } finally {
      claiming = false;
    }
  }
</script>

<div class="page" transition:fade={{ duration: 150 }}>
  <div class="card">
    {#if state === "loading"}
      <p class="muted">Chargement...</p>

    {:else if state === "login"}
      <h2>Connectez-vous</h2>
      <p class="muted">Entrez votre code d'acces pour accepter le partage</p>
      <div class="form">
        <input type="password" placeholder="Code d'acces" bind:value={code} onkeydown={(e) => e.key === "Enter" && handleLogin()} />
        <button onclick={handleLogin}>Entrer</button>
      </div>
      {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

    {:else if state === "preview"}
      <div class="persona-preview">
        <div class="avatar">{persona?.avatar || "?"}</div>
        <h2>{persona?.name || "Clone"}</h2>
        {#if persona?.title}<p class="muted">{persona.title}</p>{/if}
        {#if sharedByName}
          <p class="shared-by">Partagé par <strong>{sharedByName}</strong></p>
        {/if}
      </div>
      <p>On vous partage ce clone. Voulez-vous l'ajouter a votre compte ?</p>
      <button class="btn-primary" onclick={claimShare} disabled={claiming}>
        {claiming ? "..." : "Ajouter a mes clones"}
      </button>

    {:else if state === "already"}
      <div class="persona-preview">
        <div class="avatar">{persona?.avatar || "?"}</div>
        <h2>{persona?.name || "Clone"}</h2>
      </div>
      <p class="muted">Ce clone est deja dans votre liste.</p>
      <button class="btn-primary" onclick={() => goto("/")}>Retour</button>

    {:else if state === "claimed"}
      <h2>Clone ajouté !</h2>
      <p class="muted">Tu peux commencer à l'utiliser directement.</p>
      <button class="btn-primary" onclick={() => goto(`/chat/${personaId}`)}>
        Ouvrir chat direct
      </button>

    {:else if state === "error"}
      <h2>Erreur</h2>
      <p class="error">{errorMsg}</p>
      <button class="btn-primary" onclick={() => goto("/")}>Retour</button>
    {/if}
  </div>
</div>

<style>
  .page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 2rem;
    max-width: 360px;
    width: 100%;
    text-align: center;
  }

  h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  .muted {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin: 0 0 1rem;
  }

  .persona-preview {
    margin-bottom: 1rem;
  }

  .avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0 auto 0.75rem;
  }

  .form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font);
    font-size: 0.8125rem;
  }

  button {
    padding: 0.5rem 1rem;
    font-family: var(--font);
    font-size: 0.8125rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    transition: all 0.15s;
  }

  .btn-primary {
    width: 100%;
    margin-top: 1rem;
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-primary:hover { opacity: 0.9; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .error {
    font-size: 0.75rem;
    color: #f87171;
    margin: 0.5rem 0 0;
  }

  p {
    font-size: 0.8125rem;
    line-height: 1.5;
    margin: 0 0 0.5rem;
  }

  .shared-by {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin: 0.25rem 0 0.75rem;
  }
  .shared-by strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
</style>
