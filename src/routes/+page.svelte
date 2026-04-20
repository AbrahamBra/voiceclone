<script>
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";

  // Live clock — petit clin d'œil "lab" qui ne ment pas.
  let now = $state(new Date());
  let clockInterval;
  const BUILD_HASH = import.meta.env.VITE_BUILD_HASH ?? "dev";

  // Access form state
  let codeInput = $state("");
  let authLoading = $state(false);
  let authError = $state("");
  let authShake = $state(false);

  function pickPersona(personas) {
    if (!Array.isArray(personas) || personas.length === 0) return null;
    try {
      const lastId = localStorage.getItem("vc_last_persona");
      if (lastId) {
        const match = personas.find((p) => p.id === lastId);
        if (match) return match;
        localStorage.removeItem("vc_last_persona");
      }
    } catch {}
    return personas[0];
  }

  async function resolveHome(codeOverride) {
    try {
      const headers = codeOverride ? { "x-access-code": codeOverride } : {};
      if (!codeOverride && $accessCode) headers["x-access-code"] = $accessCode;
      if (!codeOverride && $sessionToken) headers["x-session-token"] = $sessionToken;
      const resp = await fetch("/api/personas", { headers });
      if (!resp.ok) return "/create";
      const data = await resp.json();
      const target = pickPersona(data.personas);
      return target ? `/chat/${target.id}` : "/create";
    } catch {
      return "/create";
    }
  }

  onMount(async () => {
    clockInterval = setInterval(() => { now = new Date(); }, 1000);
    if ($accessCode || $sessionToken) {
      const dest = await resolveHome();
      goto(dest);
    }
  });

  onDestroy(() => {
    clearInterval(clockInterval);
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
        authError = "refusé";
        authShake = true;
        setTimeout(() => { authShake = false; }, 300);
        authLoading = false;
        return;
      }
      if (!resp.ok) throw new Error("server");
      const data = await resp.json();
      accessCode.set(code);
      if (data.session?.token) sessionToken.set(data.session.token);
      const target = pickPersona(data.personas);
      goto(target ? `/chat/${target.id}` : "/create");
    } catch {
      authError = "erreur réseau";
      authLoading = false;
    }
  }

  function fmtClock(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
</script>

<svelte:head>
  <title>VoiceClone — accès</title>
</svelte:head>

<a href="#main" class="skip-link">Aller au contenu principal</a>

<main class="page" id="main">
  <header class="head">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">VoiceClone</span>
    </div>
    <nav class="head-meta">
      <span class="kv"><span class="k">heure</span><span class="v">{fmtClock(now)}</span></span>
      <span class="kv"><span class="k">version</span><span class="v">{BUILD_HASH}</span></span>
    </nav>
  </header>

  <section class="hero">
    <h1 class="hero-mark">◎ VoiceClone</h1>
    <p class="hero-tag">Un clone d'écriture qui apprend de tes corrections.</p>
    <p class="hero-body">
      Tu lui parles d'un prospect, il propose un message. Tu valides, ou tu le
      reprends en deux mots. La fois d'après, il a retenu. Au bout de cent
      corrections, il écrit comme toi.
    </p>

    <form class="access" onsubmit={submitCode}>
      <span class="access-k">◇ accès</span>
      <input
        type="password"
        autocomplete="off"
        placeholder="code"
        bind:value={codeInput}
        class:shake={authShake}
        disabled={authLoading}
      />
      <button type="submit" disabled={authLoading}>
        {authLoading ? "…" : "→"}
      </button>
      {#if authError}<span class="access-err">{authError}</span>{/if}
    </form>
  </section>

  <footer class="foot">
    <a class="foot-link" href="/guide">guide</a>
  </footer>
</main>

<style>
  .page {
    min-height: 100dvh;
    padding: 0;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    gap: 20px;
    flex-wrap: wrap;
  }
  .brand { display: inline-flex; align-items: baseline; gap: 8px; letter-spacing: 0.01em; }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: 600; color: var(--ink); }
  .head-meta { display: inline-flex; gap: 20px; flex-wrap: wrap; }
  .kv { display: inline-flex; gap: 6px; align-items: baseline; }
  .k { color: var(--ink-40); }
  .v { color: var(--ink); font-variant-numeric: tabular-nums; }

  .hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 20px;
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
    gap: 20px;
    text-align: center;
  }
  .hero-mark {
    font-family: var(--font);
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 500;
    color: var(--ink);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .hero-tag {
    font-family: var(--font);
    font-size: clamp(18px, 2.4vw, 22px);
    font-style: italic;
    color: var(--vermillon);
    margin: 0;
    line-height: 1.3;
    max-width: 38ch;
  }
  .hero-body {
    font-family: var(--font-ui);
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-70);
    margin: 0;
    max-width: 50ch;
  }

  .access {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
    padding: 14px 18px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle, transparent);
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-40);
  }
  .access-k { color: var(--ink-40); }
  .access input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--ink-20);
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
    width: 140px;
    transition: border-color 0.08s linear;
    outline: none;
  }
  .access input:focus { border-bottom-color: var(--vermillon); }
  .access input::placeholder { color: var(--ink-20); }
  .access button {
    background: transparent;
    border: 1px solid var(--ink-20);
    padding: 4px 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
    cursor: pointer;
    transition: border-color 0.08s linear, color 0.08s linear;
  }
  .access button:hover { border-color: var(--vermillon); color: var(--vermillon); }
  .access button:disabled { opacity: 0.4; cursor: not-allowed; }
  .access-err { color: var(--vermillon); margin-left: 4px; }

  .shake { animation: shake 0.28s linear; }
  @keyframes shake {
    20%, 60% { transform: translateX(-3px); }
    40%, 80% { transform: translateX(3px); }
  }

  .foot {
    display: flex;
    justify-content: center;
    padding: 20px;
    border-top: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
  }
  .foot-link {
    color: var(--ink-70);
    text-decoration: none;
    border-bottom: 1px dashed var(--ink-40);
  }
  .foot-link:hover { color: var(--vermillon); border-bottom-color: var(--vermillon); }

  @media (max-width: 480px) {
    .head-meta .kv:nth-child(1) { display: none; }
    .access {
      flex-wrap: wrap;
      width: 100%;
      max-width: 320px;
    }
    .access input {
      width: 100%;
      min-height: var(--touch-min);
      font-size: var(--fs-small);
    }
    .access button {
      min-height: var(--touch-min);
      min-width: var(--touch-min);
      font-size: var(--fs-small);
    }
  }
</style>
