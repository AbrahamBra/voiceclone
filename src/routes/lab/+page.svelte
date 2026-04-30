<script>
  // Landing — cible agence ghostwriting LinkedIn multi-clients.
  // Angle : setter augmenté (pas remplacé). Vitesse + base de connaissance
  // client + entraînement par feedback. Trois écrans : hero / preuve / moat.
  //
  // Auth flow inchangé : si déjà authentifié, redirect direct vers
  // /chat/<persona>. Sinon, la landing s'affiche ; le code d'accès en
  // topbar permet aux clients existants de rentrer sans scroll.

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isAdmin, clientName, logout } from "$lib/stores/auth.js";

  // TODO swap par ton lien Typeform / Tally / form waitlist quand tu l'as.
  const DEMO_CTA_HREF = "mailto:a.brakha@challengerslab.com?subject=Waitlist%20Setclone%20(20%20premiers%20clients)";

  // ───────── Access form ─────────
  let codeInput = $state("");
  let authLoading = $state(false);
  let authError = $state("");
  let authShake = $state(false);

  // Pick the landing persona: last-used if still accessible, else first.
  // Stale ids (clone supprimé entre sessions) sont nettoyés du localStorage.
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

  // Resolve the post-auth destination: last/first persona → /chat/<id>, or
  // /create if the account has no clone yet.
  async function resolveHome(codeOverride) {
    try {
      const headers = codeOverride ? { "x-access-code": codeOverride } : {};
      if (!codeOverride && $accessCode) headers["x-access-code"] = $accessCode;
      if (!codeOverride && $sessionToken) headers["x-session-token"] = $sessionToken;
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
    // Already authenticated → jump straight into the cockpit.
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
      isAdmin.set(!!data.isAdmin);
      if (data.clientName) clientName.set(data.clientName);
      const target = pickPersona(data.personas);
      goto(target ? `/chat/${target.id}` : "/create");
    } catch {
      authError = "erreur réseau";
      authLoading = false;
    }
  }

  // Click "voir la démo" → log in with the public demo access code and jump
  // straight into the demo persona cockpit. Seeded via supabase/033_demo_persona.sql.
  //
  // SECURITY — the real root cause of the "redirected to another client"
  // bug was that authHeaders() (used by every /chat fetch) sends BOTH
  // x-session-token AND x-access-code when both stores are set. The server
  // prefers the session token (lib/supabase.js authenticateRequest). So an
  // admin user clicking "demo" without clearing their session would still
  // auth as admin on every subsequent /chat API call, exposing cross-client
  // data under the demo URL. Fix : call logout() first to wipe every auth
  // trace (stores + localStorage + vc_last_persona), THEN authenticate as
  // demo. Also hard-code the expected persona id — never trust pickPersona
  // on a public CTA.
  const DEMO_PERSONA_ID = "00000000-0000-0000-0000-00000000d002";
  let demoLoading = $state(false);
  async function openDemo() {
    if (demoLoading) return;
    demoLoading = true;
    // Full auth wipe before authenticating as demo — closes every leak path
    // (session token, access code, last persona, admin flag).
    logout();
    try {
      const resp = await fetch("/api/personas", { headers: { "x-access-code": "demo" } });
      if (!resp.ok) throw new Error("demo unavailable");
      const data = await resp.json();
      // Strict scoping : only accept the known demo persona from the response.
      const target = (data.personas || []).find((p) => p.id === DEMO_PERSONA_ID);
      if (!target) throw new Error("demo persona missing in response");
      accessCode.set("demo");
      if (data.session?.token) sessionToken.set(data.session.token);
      isAdmin.set(!!data.isAdmin);
      if (data.clientName) clientName.set(data.clientName);
      goto(`/chat/${target.id}`);
    } catch {
      demoLoading = false;
      // Silent fail → fall back to waitlist CTA next to this button.
    }
  }
</script>

<svelte:head>
  <title>Setclone — pipeline observable (laboratoire)</title>
  <meta name="description" content="Le pipeline Setclone vu de l'intérieur : règles, corrections, fidélité, garde-fous. Pour les curieux qui veulent voir comment le clone apprend." />
</svelte:head>

<a href="#hero" class="skip-link">Aller au contenu</a>

<main class="landing">

  <!-- ═══════ Top bar — brand + code d'accès + demo ═══════ -->
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">Setclone</span>
    </div>
    <div class="topbar-right">
      <form class="access access-top" onsubmit={submitCode} aria-label="Accès client">
        <span class="access-k mono">déjà dans l'outil ?</span>
        <input
          type="password"
          autocomplete="off"
          placeholder="ton code"
          bind:value={codeInput}
          class:shake={authShake}
          disabled={authLoading}
          aria-label="Code d'accès"
        />
        <button type="submit" disabled={authLoading}>
          {authLoading ? "…" : "→"}
        </button>
        {#if authError}<span class="access-err mono">{authError}</span>{/if}
      </form>
      <a class="top-cta" href="/demo">essaie en 5 min →</a>
    </div>
  </header>

  <!-- ═══════ Écran 1 — Hero ═══════ -->
  <section class="hero" id="hero">
    <div class="overline mono">
      ◇ pour les agences ghostwriting qui pilotent 5+ clients
    </div>

    <h1 class="headline">
      <span>10 clients. 10 façons de DM. Un setter qui tient la ligne.</span>
      <span>Ton setter colle le DM d'un prospect.</span>
      <span class="accent">Le draft sort comme <em>ton client</em> l'écrirait.</span>
    </h1>

    <p class="sub">
      Un client = sa façon de faire : règles, ouvertures, cadence, signature.
      Écrites dès l'onboarding. Ton setter tape dedans. Le même cerveau drafte
      aussi les <em>posts LinkedIn</em> — DM et posts, une seule ligne.
    </p>

    <ul class="triptyque" aria-label="Ce que Setclone fait concrètement">
      <li class="beat">
        <h3 class="beat-title">ses règles, écrites dès l'onboarding</h3>
        <p class="beat-body">
          Sa façon de DM, ses ouvertures interdites, sa cadence de relance,
          sa signature. Noir sur blanc dès la création du clone.
          Ton setter tape dedans, pas à côté.
        </p>
      </li>
      <li class="beat">
        <h3 class="beat-title">corrige une fois, explique au clone</h3>
        <p class="beat-body">
          Tu vires un mot, le clone demande <em class="quoted">« pourquoi »</em>.
          La règle rentre avec son contexte. Le setter junior
          qui arrive dans 3 mois n'y retape pas deux fois.
        </p>
      </li>
      <li class="beat">
        <h3 class="beat-title">DM et posts, un seul cerveau</h3>
        <p class="beat-body">
          Même base pour les DM prospects et les posts LinkedIn.
          Ton setter passe d'un canal à l'autre sans reconfigurer.
          La ligne tient partout.
        </p>
      </li>
    </ul>

    <div class="hero-cta" id="cta">
      <a class="btn-primary" href="/demo">→ Essaie ton clone en 5 min.</a>
      <div class="sub-ctas">
        <button type="button" class="demo-link mono" onclick={openDemo} disabled={demoLoading}>
          {demoLoading ? "chargement…" : "ou fouille une démo pré-entraînée →"}
        </button>
        <a class="demo-link mono" href={DEMO_CTA_HREF}>waitlist →</a>
      </div>
    </div>
  </section>

  <!-- ═══════ Écran 2 — Preuve, le cockpit en action ═══════ -->
  <section class="proof" aria-labelledby="proof-title">
    <div class="section-kicker mono">◇ dans le cockpit</div>
    <h2 class="section-title" id="proof-title">
      Ce que ton setter voit, toute la journée.
    </h2>

    <div class="captures">
      <figure class="capture">
        <div class="capture-frame" aria-hidden="true">
          <div class="frame-bar mono"><span>◎</span><span>onboarding · setup du clone</span></div>
          <div class="frame-body">
            <div class="frame-stub setup-stub">
              <div class="setup-block">
                <span class="setup-label mono">ouvertures interdites</span>
                <span class="setup-detail">jamais « Bonjour ». jamais « J'espère que… »</span>
              </div>
              <div class="setup-block">
                <span class="setup-label mono">cadence de relance</span>
                <span class="setup-detail">J+3 → J+7 → on coupe</span>
              </div>
              <div class="setup-block">
                <span class="setup-label mono">signature</span>
                <span class="setup-detail">« — A. » sans formule</span>
              </div>
              <div class="setup-block">
                <span class="setup-label mono">process closing</span>
                <span class="setup-detail">pas de call avant 3 échanges</span>
              </div>
            </div>
          </div>
        </div>
        <figcaption>
          <span class="cap-num mono">01</span>
          Pas besoin que le clone devine la façon de ton client à partir de 3 posts.<br />
          Ton client écrit ses règles une fois. Le clone les exécute dès le 1er draft.
        </figcaption>
      </figure>

      <figure class="capture">
        <div class="capture-frame" aria-hidden="true">
          <div class="frame-bar mono"><span>◎</span><span>cockpit · correction</span></div>
          <div class="frame-body">
            <div class="frame-stub">
              <span class="stub-meta mono">setter vire « n'hésitez pas »</span>
              <div class="dialogue-row dialogue-clone">
                <span class="dialogue-who mono">clone</span>
                <span class="dialogue-body">Pourquoi tu vires ça ?</span>
              </div>
              <div class="dialogue-row dialogue-setter">
                <span class="dialogue-who mono">setter</span>
                <span class="dialogue-body">trop soft, on ferme, on propose pas</span>
              </div>
              <div class="dialogue-row dialogue-clone">
                <span class="dialogue-who mono">clone</span>
                <span class="dialogue-body">noté, règle ajoutée. plus jamais dans un DM closing.</span>
              </div>
            </div>
          </div>
        </div>
        <figcaption>
          <span class="cap-num mono">02</span>
          Tu corriges une fois. Tu expliques une fois.<br />
          Le clone retient le pourquoi. La règle vaut pour toute l'équipe.
        </figcaption>
      </figure>

      <figure class="capture">
        <div class="capture-frame" aria-hidden="true">
          <div class="frame-bar mono"><span>◎</span><span>cockpit · Post | DM</span></div>
          <div class="frame-body">
            <div class="frame-stub tabs-stub">
              <div class="tabs-row mono">
                <span class="tab">Post</span>
                <span class="tab tab-active">DM</span>
              </div>
              <div class="tabs-panels">
                <div class="tab-panel tab-panel-muted">
                  <span class="stub-meta mono">post · brouillon</span>
                  <p class="mini-draft">3 questions à se poser avant de relancer un prospect silencieux. — A.</p>
                </div>
                <div class="tab-panel">
                  <span class="stub-meta mono">dm · draft</span>
                  <p class="mini-draft">Sophie, 2 lignes pile : on mappe ta stack jeudi. — A.</p>
                </div>
              </div>
              <span class="brain-badge mono">même base · 2 canaux</span>
            </div>
          </div>
        </div>
        <figcaption>
          <span class="cap-num mono">03</span>
          Ton setter drafte les DM. Le ghostwriter drafte les posts.<br />
          Un seul cerveau, deux onglets.
        </figcaption>
      </figure>
    </div>
  </section>

  <!-- ═══════ Écran 3 — Moat ═══════ -->
  <section class="moat" aria-labelledby="moat-title">
    <div class="section-kicker mono">◇ le moat</div>
    <h2 class="section-title" id="moat-title">
      Le process tient. Même quand ton équipe change.
    </h2>

    <div class="moat-body">
      <p class="moat-para">
        Setter senior qui part, junior qui arrive : même draft, même voix, même cadence.
        Le process du client ne vit pas dans la tête d'un humain. Il est écrit,
        et chaque correction le précise. Quand un nouveau rejoint l'équipe, il écrit
        dans la bonne ligne dès son premier draft. Plus de semaine à relire les archives.
      </p>
      <p class="moat-punch">
        Tes setters changent. Le process reste. Les corrections aussi.
      </p>
    </div>

    <div class="moat-cta">
      <a class="btn-primary" href="/demo">→ Essaie le clone en 5 min.</a>
      <a class="demo-link mono" href={DEMO_CTA_HREF}>ou rejoins la waitlist →</a>
    </div>
  </section>

  <!-- ═══════ Footer minimal ═══════ -->
  <footer class="foot">
    <span class="foot-brand mono">
      <span class="brand-mark">◎</span>
      Setclone
    </span>
    <a class="foot-link" href="/">← retour landing</a>
    <a class="foot-link" href="/guide">guide</a>
  </footer>
</main>

<style>
  /* ────────────────────────────────────────────────────────────
     Global canvas — aesthetic "laboratoire" préservé
     (papier, vermillon, serif headline, mono labels)
     ──────────────────────────────────────────────────────────── */
  .landing {
    min-height: 100dvh;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
  }

  .skip-link {
    position: absolute; left: -9999px; top: 0;
    background: var(--ink); color: var(--paper);
    padding: 8px 12px; font-family: var(--font-mono); font-size: 12px;
  }
  .skip-link:focus { left: 12px; top: 12px; z-index: 100; }

  /* ────────────────────────────────────────────────────────────
     Topbar
     ──────────────────────────────────────────────────────────── */
  .topbar {
    display: flex; justify-content: space-between; align-items: center;
    gap: 20px;
    padding: 10px 28px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .brand { display: inline-flex; align-items: baseline; gap: 8px; }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: 600; color: var(--ink); letter-spacing: 0.01em; }

  .topbar-right {
    display: inline-flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .top-cta {
    color: var(--ink);
    border-bottom: 1px solid var(--vermillon);
    text-decoration: none;
    padding-bottom: 2px;
    font-family: var(--font-mono);
    transition: color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .top-cta:hover { color: var(--vermillon); }

  /* Compact variant of .access dans la topbar */
  .access-top { gap: 6px; }
  .access-top input { width: 90px; padding: 5px 8px; font-size: 11.5px; }
  .access-top button { padding: 5px 8px; font-size: 11.5px; }
  .access-top .access-k { display: none; }
  @media (min-width: 760px) {
    .access-top .access-k { display: inline; }
  }

  /* ────────────────────────────────────────────────────────────
     Shared section primitives
     ──────────────────────────────────────────────────────────── */
  .section-kicker {
    font-size: 11px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 12px;
  }
  .section-title {
    font-family: var(--font);
    font-weight: 400;
    font-size: clamp(24px, 3.2vw, 36px);
    line-height: 1.12;
    letter-spacing: -0.018em;
    color: var(--ink);
    margin: 0 0 24px;
    max-width: 22ch;
  }

  .btn-primary {
    display: inline-block;
    padding: 14px 22px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.01em;
    transition: background var(--dur-fast, 120ms) var(--ease, ease),
                border-color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .btn-primary:hover {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }

  /* ────────────────────────────────────────────────────────────
     Écran 1 — Hero
     ──────────────────────────────────────────────────────────── */
  .hero {
    padding: 48px 28px 40px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
  }
  .overline {
    font-size: 11px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 16px;
  }
  .headline {
    font-family: var(--font);
    font-weight: 400;
    font-size: clamp(32px, 5.2vw, 60px);
    line-height: 1.05;
    letter-spacing: -0.022em;
    color: var(--ink);
    margin: 0 0 20px;
    max-width: 20ch;
  }
  .headline span { display: block; }
  .headline .accent {
    font-style: italic;
    color: var(--ink);
  }
  .headline .accent em {
    color: var(--vermillon);
    font-style: italic;
    position: relative;
  }
  .headline .accent em::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: -2px;
    height: 1px;
    background: var(--vermillon);
    opacity: 0.4;
  }

  .sub {
    font-size: 16px;
    color: var(--ink-70);
    line-height: 1.55;
    max-width: 62ch;
    margin: 0 0 28px;
  }
  .sub em {
    color: var(--ink);
    font-style: italic;
  }

  /* Triptyque — 3 beats côte à côte sur desktop, stack sur narrow */
  .triptyque {
    list-style: none;
    padding: 0;
    margin: 0 0 28px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    border-top: 1px solid var(--rule-strong);
    border-bottom: 1px solid var(--rule-strong);
  }
  .beat {
    padding: 18px 18px;
    border-right: 1px solid var(--rule);
  }
  .beat:last-child { border-right: none; }

  .beat-title {
    font-family: var(--font);
    font-weight: 500;
    font-style: italic;
    font-size: 17px;
    color: var(--vermillon);
    line-height: 1.2;
    margin: 0 0 10px;
    letter-spacing: -0.005em;
  }
  .beat-body {
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink-70);
    margin: 0;
  }
  .beat-body strong {
    color: var(--ink);
    font-weight: 500;
  }
  .beat-body em.quoted {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
    font-style: normal;
    background: var(--paper-subtle, #f6f5f1);
    padding: 1px 6px;
  }

  .hero-cta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .demo-link {
    padding: 3px 0;
    background: none;
    border: none;
    border-bottom: 1px dashed var(--ink-40);
    color: var(--ink-70);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    cursor: pointer;
    align-self: flex-start;
    text-decoration: none;
    transition: color var(--dur-fast, 120ms) var(--ease, ease),
                border-color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .sub-ctas {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    margin-top: 0;
  }
  .demo-link:hover:not(:disabled) {
    color: var(--vermillon);
    border-bottom-color: var(--vermillon);
  }
  .demo-link:disabled { opacity: 0.5; cursor: wait; }
  .moat-cta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  /* ────────────────────────────────────────────────────────────
     Écran 2 — Preuve
     ──────────────────────────────────────────────────────────── */
  .proof {
    padding: 48px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }

  .captures {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }
  .capture { margin: 0; }
  .capture-frame {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 6px 24px rgba(0,0,0,0.04);
    overflow: hidden;
    margin-bottom: 12px;
    min-height: 180px;
    display: flex;
    flex-direction: column;
  }
  .frame-bar {
    display: flex; gap: 8px; align-items: center;
    padding: 7px 12px;
    border-bottom: 1px dashed var(--rule);
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .frame-bar span:first-child { color: var(--vermillon); }
  .frame-body {
    padding: 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .frame-stub {
    display: flex; flex-direction: column; gap: 10px;
  }
  .stub-meta {
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .stub-bubble {
    padding: 9px 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink);
    border: 1px solid var(--rule);
  }
  .stub-prospect {
    background: var(--paper-subtle, #f6f5f1);
    font-style: italic;
    color: var(--ink-70);
    align-self: flex-start;
    max-width: 85%;
  }
  .stub-draft {
    background: var(--paper);
    border-left: 2px solid var(--vermillon);
    align-self: flex-end;
    max-width: 95%;
  }
  .stub-tag {
    font-size: 10.5px;
    color: var(--vermillon);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    align-self: flex-end;
  }
  /* Capture 01 — setup onboarding */
  .setup-stub { gap: 8px; }
  .setup-block {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    background: var(--paper-subtle, #f6f5f1);
  }
  .setup-label {
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .setup-detail {
    font-size: 13px;
    color: var(--ink);
    line-height: 1.4;
  }

  /* Capture 02 — dialogue méta */
  .dialogue-row {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    align-items: baseline;
  }
  .dialogue-clone {
    background: var(--paper);
    border-left: 2px solid var(--vermillon);
  }
  .dialogue-setter {
    background: var(--paper-subtle, #f6f5f1);
    margin-left: 16px;
  }
  .dialogue-who {
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding-top: 2px;
  }
  .dialogue-clone .dialogue-who { color: var(--vermillon); }
  .dialogue-body {
    font-size: 13px;
    color: var(--ink);
    line-height: 1.5;
  }

  /* Capture 03 — tabs Post|DM */
  .tabs-stub { gap: 10px; }
  .tabs-row {
    display: inline-flex;
    gap: 18px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  .tab {
    font-size: 11.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding-bottom: 4px;
    position: relative;
  }
  .tab-active { color: var(--ink); }
  .tab-active::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: -7px;
    height: 1px;
    background: var(--vermillon);
  }
  .tabs-panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 4px;
  }
  .tab-panel {
    padding: 8px 10px;
    border: 1px solid var(--rule);
    background: var(--paper);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tab-panel-muted { opacity: 0.55; }
  .mini-draft {
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink);
    margin: 0;
  }
  .brain-badge {
    align-self: center;
    font-size: 10.5px;
    color: var(--vermillon);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 8px;
    border: 1px dashed var(--vermillon);
    margin-top: 2px;
  }

  .capture figcaption {
    font-size: 14px;
    color: var(--ink-70);
    line-height: 1.55;
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .cap-num {
    color: var(--vermillon);
    font-size: 11px;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  /* ────────────────────────────────────────────────────────────
     Écran 3 — Moat
     ──────────────────────────────────────────────────────────── */
  .moat {
    padding: 48px 28px 40px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper-subtle, #f6f5f1);
  }
  .moat-body {
    max-width: 56ch;
    margin-bottom: 24px;
  }
  .moat-para {
    font-family: var(--font);
    font-size: 18px;
    line-height: 1.5;
    color: var(--ink);
    margin: 0 0 16px;
  }
  .moat-punch {
    font-family: var(--font);
    font-style: italic;
    font-size: 16px;
    color: var(--ink-70);
    line-height: 1.5;
    margin: 0;
    max-width: 48ch;
  }

  /* ────────────────────────────────────────────────────────────
     Footer
     ──────────────────────────────────────────────────────────── */
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 28px;
    border-top: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-top: auto;
    color: var(--ink-40);
  }
  .foot-brand {
    display: inline-flex; gap: 6px; align-items: baseline;
    color: var(--ink);
  }
  .foot-link {
    color: var(--ink-40);
    text-decoration: none;
    border-bottom: 1px dashed var(--rule);
    padding-bottom: 1px;
  }
  .foot-link:hover { color: var(--ink); border-bottom-color: var(--ink-40); }

  .access {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .access-k { color: var(--ink-40); }
  .access input {
    padding: 6px 10px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    width: 110px;
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .access input:focus { border-color: var(--vermillon); }
  .access input.shake { animation: shake 0.3s; }
  .access input::placeholder { color: var(--ink-40); }
  .access button {
    padding: 6px 10px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: background var(--dur-fast, 120ms) var(--ease, ease);
  }
  .access button:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .access button:disabled { opacity: 0.4; cursor: wait; }
  .access-err { color: var(--vermillon); }

  @keyframes shake {
    10%, 90% { transform: translateX(-1px); }
    20%, 80% { transform: translateX(2px); }
    30%, 50%, 70% { transform: translateX(-4px); }
    40%, 60% { transform: translateX(4px); }
  }

  /* ────────────────────────────────────────────────────────────
     Responsive — stack below 900px
     ──────────────────────────────────────────────────────────── */
  @media (max-width: 900px) {
    .triptyque {
      grid-template-columns: 1fr;
    }
    .beat {
      border-right: none;
      border-bottom: 1px solid var(--rule);
    }
    .beat:last-child { border-bottom: none; }

    .captures {
      grid-template-columns: 1fr;
      gap: 40px;
    }
  }

  @media (max-width: 600px) {
    .hero { padding: 36px 20px 32px; }
    .proof { padding: 36px 20px; }
    .moat { padding: 36px 20px 32px; }
    .topbar { padding: 10px 20px; gap: 12px; flex-wrap: wrap; }
    .topbar-right { gap: 12px; }
    .foot { padding: 12px 20px; gap: 12px; }

    .headline { font-size: clamp(28px, 8vw, 40px); }
    .section-title { font-size: clamp(22px, 6vw, 28px); }
    .moat-para { font-size: 16px; }
  }
</style>
