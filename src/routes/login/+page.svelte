<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isAdmin, clientName } from "$lib/stores/auth.js";

  let codeInput = $state("");
  let authLoading = $state(false);
  let authError = $state("");
  let authShake = $state(false);

  function pickPersona(personas) {
    if (!Array.isArray(personas) || personas.length === 0) return null;
    try {
      const lastId = localStorage.getItem("setclone_last_persona") || localStorage.getItem("vc_last_persona");
      if (lastId) {
        const match = personas.find((p) => p.id === lastId);
        if (match) return match;
        localStorage.removeItem("setclone_last_persona");
        localStorage.removeItem("vc_last_persona");
      }
    } catch {}
    return personas[0];
  }

  async function resolveHome() {
    try {
      const headers = {};
      if ($accessCode) headers["x-access-code"] = $accessCode;
      if ($sessionToken) headers["x-session-token"] = $sessionToken;
      const resp = await fetch("/api/personas", { headers });
      if (!resp.ok) return "/create";
      const data = await resp.json();
      isAdmin.set(!!data.isAdmin);
      if (data.clientName) clientName.set(data.clientName);
      const target = pickPersona(data.personas);
      return target ? `/chat/${target.id}` : "/create";
    } catch {
      return "/create";
    }
  }

  onMount(async () => {
    if ($accessCode || $sessionToken) {
      const dest = await resolveHome();
      goto(dest);
    }
  });

  async function submitCode(e) {
    e?.preventDefault?.();
    const code = codeInput.trim();
    if (!code) return;
    authError = "";
    authLoading = true;
    try {
      const resp = await fetch("/api/personas", { headers: { "x-access-code": code } });
      if (resp.status === 403) {
        authError = "code refusé";
        authShake = true;
        setTimeout(() => { authShake = false; }, 300);
        authLoading = false;
        return;
      }
      if (!resp.ok) throw new Error("server");
      const data = await resp.json();
      accessCode.set(code);
      if (data.session?.token) sessionToken.set(data.session.token);
      isAdmin.set(!!data.isAdmin);
      if (data.clientName) clientName.set(data.clientName);
      const target = pickPersona(data.personas);
      goto(target ? `/chat/${target.id}` : "/create");
    } catch {
      authError = "erreur réseau";
      authLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Setclone — accès client</title>
  <meta name="description" content="Accès client Setclone." />
</svelte:head>

<main class="login-page">
  <a class="brand" href="/">
    <span class="brand-mark">◎</span>
    <span class="brand-name">Setclone</span>
  </a>

  <section class="login-card">
    <h1 class="login-title">accès client</h1>
    <p class="login-sub">Entrez votre code pour rejoindre votre cockpit.</p>

    <form class="access" onsubmit={submitCode} aria-label="Accès client">
      <input
        type="password"
        autocomplete="off"
        placeholder="votre code d'accès"
        bind:value={codeInput}
        class:shake={authShake}
        disabled={authLoading}
        aria-label="Code d'accès"
      />
      <button type="submit" disabled={authLoading}>
        {authLoading ? "…" : "entrer →"}
      </button>
      {#if authError}<span class="access-err mono">{authError}</span>{/if}
    </form>

    <div class="login-foot">
      <a class="muted-link" href="/">← retour</a>
      <span class="muted-sep">·</span>
      <a class="muted-link" href="mailto:contact@setclone.app?subject=Code%20d'acc%C3%A8s%20oubli%C3%A9">code oublié</a>
    </div>
  </section>
</main>

<style>
  .login-page {
    min-height: 100dvh;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px;
    gap: 40px;
  }

  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 14px;
  }
  .brand-mark { color: var(--vermillon); font-size: 16px; }
  .brand-name { font-weight: 600; color: var(--ink); letter-spacing: 0.01em; }

  .login-card {
    width: 100%;
    max-width: 420px;
    padding: 32px 28px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 8px 32px rgba(0,0,0,0.04);
  }

  .login-title {
    font-family: var(--font);
    font-weight: 400;
    font-style: italic;
    font-size: 24px;
    color: var(--ink);
    margin: 0 0 6px;
  }
  .login-sub {
    font-size: 13.5px;
    color: var(--ink-70);
    line-height: 1.5;
    margin: 0 0 22px;
  }

  .access {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .access input {
    flex: 1;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px solid var(--rule);
    color: var(--ink);
    outline: none;
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .access input:focus { border-color: var(--vermillon); }
  .access input.shake { animation: shake 0.3s ease; }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
  .access button {
    padding: 10px 14px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-family: var(--font-mono);
    font-size: 13px;
    cursor: pointer;
    transition: background var(--dur-fast, 120ms) var(--ease, ease);
  }
  .access button:hover:not(:disabled) {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .access button:disabled { opacity: 0.5; cursor: wait; }
  .access-err {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--vermillon);
  }

  .login-foot {
    margin-top: 20px;
    display: flex;
    gap: 10px;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ink-40);
  }
  .muted-link {
    color: var(--ink-70);
    text-decoration: none;
    border-bottom: 1px dashed var(--ink-40);
    padding-bottom: 1px;
    transition: color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .muted-link:hover { color: var(--vermillon); border-bottom-color: var(--vermillon); }
  .muted-sep { color: var(--ink-40); }
</style>
