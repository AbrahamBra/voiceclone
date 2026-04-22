<script>
  // Landing — cible agence ghostwriting LinkedIn multi-clients.
  // Angle : setter augmenté (pas remplacé). Vitesse + base de connaissance
  // client + entraînement par feedback. Trois écrans : hero / preuve / moat.
  //
  // Auth flow inchangé : si déjà authentifié, redirect direct vers
  // /chat/<persona>. Sinon, la landing s'affiche ; le code d'accès sous
  // footer permet aux clients existants de rentrer.

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isAdmin } from "$lib/stores/auth.js";

  // TODO swap par ton lien Typeform / Tally / form waitlist quand tu l'as.
  const DEMO_CTA_HREF = "mailto:a.brakha@challengerslab.com?subject=Waitlist%20VoiceClone%20(20%20premiers%20clients)";
  // TODO remplacer par le chiffre réel d'un client pilote une fois mesuré.
  const PILOT_RULES_COUNT = 147;

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
      const target = pickPersona(data.personas);
      goto(target ? `/chat/${target.id}` : "/create");
    } catch {
      authError = "erreur réseau";
      authLoading = false;
    }
  }

  // Click "voir la démo" → log in with the public demo access code and jump
  // straight into the demo persona cockpit. Seeded via supabase/033_demo_persona.sql.
  let demoLoading = $state(false);
  async function openDemo() {
    if (demoLoading) return;
    demoLoading = true;
    try {
      const resp = await fetch("/api/personas", { headers: { "x-access-code": "demo" } });
      if (!resp.ok) throw new Error("demo unavailable");
      const data = await resp.json();
      accessCode.set("demo");
      if (data.session?.token) sessionToken.set(data.session.token);
      isAdmin.set(!!data.isAdmin);
      const target = pickPersona(data.personas);
      if (target) goto(`/chat/${target.id}`);
      else throw new Error("no demo persona");
    } catch {
      demoLoading = false;
      // Silent fail → fall back to waitlist CTA next to this button.
    }
  }
</script>

<svelte:head>
  <title>VoiceClone — Setter IA pour DM prospects + posts LinkedIn (agences ghostwriting)</title>
  <meta name="description" content="Le setter drafte les DM prospects en secondes dans la voix de ton client. Pour les agences ghostwriting : le même cerveau drafte aussi les posts LinkedIn de tes clients, avec la même base de connaissance." />
</svelte:head>

<a href="#hero" class="skip-link">Aller au contenu</a>

<main class="landing">

  <!-- ═══════ Top bar minimal ═══════ -->
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">VoiceClone</span>
    </div>
    <a class="top-cta" href={DEMO_CTA_HREF}>liste d'attente →</a>
  </header>

  <!-- ═══════ Écran 1 — Hero ═══════ -->
  <section class="hero" id="hero">
    <div class="overline mono">
      ◇ pour les agences ghostwriting qui pilotent 5+ clients
    </div>

    <h1 class="headline">
      <span>10 clients. 10 voix. Un setter.</span>
      <span>Ton setter colle le DM d'un prospect.</span>
      <span class="accent">Le draft sort dans la voix de ton <em>client</em>.</span>
    </h1>

    <p class="sub">
      Un client = son cerveau à lui. Son style, ses tics, ses dossiers prospects.
      Ton setter écrit avec lui, pas à sa place.
      <br /><br />
      Tu tiens une agence ghostwriting ? Le même clone drafte aussi les
      <em>posts LinkedIn</em> de tes clients. DM et posts, une seule voix.
    </p>

    <ul class="triptyque" aria-label="Ce que VoiceClone fait concrètement">
      <li class="beat">
        <h3 class="beat-title">son cerveau à lui</h3>
        <p class="beat-body">
          Les posts qu'il a écrits. Les mots qu'il évite.
          Les prospects qu'il suit. VoiceClone garde tout
          en tête. Ton setter zappe entre 5 clients
          sans perdre la voix.
        </p>
      </li>
      <li class="beat">
        <h3 class="beat-title">DM au cœur. Posts inclus.</h3>
        <p class="beat-body">
          Conçu pour les DM : 1er message, relance, reply, closing.
          Ton setter passe de
          <strong>30 minutes à 30 secondes par draft</strong>.
          Les agences ghostwriting activent aussi les posts
          LinkedIn. Un seul clone pour les deux canaux.
        </p>
      </li>
      <li class="beat">
        <h3 class="beat-title">corrige une fois. Jamais deux.</h3>
        <p class="beat-body">
          Le <em class="quoted">« n'hésitez pas »</em> qui traîne dans un draft ?
          Tu le vires une fois, la règle s'ajoute. Le setter
          junior qui arrive dans 3 mois ne le tapera même plus.
        </p>
      </li>
    </ul>

    <div class="hero-cta">
      <a class="btn-primary" href={DEMO_CTA_HREF}>
        → Rejoindre la liste d'attente. 20 premiers clients.
      </a>
      <p class="cta-sub mono">on t'ouvre l'accès + 20 min pour te brancher sur un de tes clients.</p>
      <button type="button" class="demo-link mono" onclick={openDemo} disabled={demoLoading}>
        {demoLoading ? "chargement…" : "ou fouiller dans la démo →"}
      </button>
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
          <div class="frame-bar mono"><span>◎</span><span>cockpit · DM</span></div>
          <div class="frame-body">
            <div class="frame-stub">
              <span class="stub-meta mono">prospect · Sophie · signal chaud</span>
              <div class="stub-bubble stub-prospect">« Ok envoie ton process en 2 lignes. »</div>
              <div class="stub-bubble stub-draft">
                Sophie, 2 lignes pile : on mappe ta stack aujourd'hui
                (15 min), tu reçois le gap-report demain. Si ça accroche
                on pose un call. Sinon on coupe ici. OK pour l'appel à 14h ?
              </div>
              <span class="stub-tag mono">draft · voix reconnue</span>
            </div>
          </div>
        </div>
        <figcaption>
          <span class="cap-num mono">01</span>
          Ton setter colle le message d'un prospect.<br />
          Le draft arrive dans la voix que ton client signe.
        </figcaption>
      </figure>

      <figure class="capture">
        <div class="capture-frame" aria-hidden="true">
          <div class="frame-bar mono"><span>◎</span><span>règle détectée</span></div>
          <div class="frame-body">
            <div class="frame-stub">
              <span class="stub-meta mono">moteur de règles · 1 violation</span>
              <div class="rule-row">
                <span class="rule-dot">●</span>
                <span class="rule-label mono">ai_pattern_fr</span>
                <span class="rule-detail">« n'hésitez pas »</span>
              </div>
              <div class="rule-action">
                <button type="button" class="rule-btn mono" disabled>virer + saved</button>
                <span class="rule-hint">la règle reste sauvée pour les 500 prochains drafts</span>
              </div>
            </div>
          </div>
        </div>
        <figcaption>
          <span class="cap-num mono">02</span>
          Un mot interdit traîne dans le draft ?<br />
          Un clic pour le virer. La règle reste pour toujours.
        </figcaption>
      </figure>

      <figure class="capture">
        <div class="capture-frame" aria-hidden="true">
          <div class="frame-bar mono"><span>◎</span><span>rail feedback</span></div>
          <div class="frame-body">
            <div class="frame-stub">
              <span class="stub-meta mono">5 dernières corrections · client A.</span>
              <ul class="fb-list">
                <li><span class="fb-date mono">mar.</span> « fondamentalement » → virer</li>
                <li><span class="fb-date mono">mar.</span> ouvrir par une question, pas une affirmation</li>
                <li><span class="fb-date mono">lun.</span> signature : « — A. » pas « Cdt, »</li>
                <li><span class="fb-date mono">ven.</span> jamais commencer par « Bonjour »</li>
                <li><span class="fb-date mono">jeu.</span> relance à J+5, pas J+3</li>
              </ul>
            </div>
          </div>
        </div>
        <figcaption>
          <span class="cap-num mono">03</span>
          Le journal des corrections du client, sous la main.<br />
          Ton setter voit les 5 derniers ajustements et s'aligne.
        </figcaption>
      </figure>
    </div>
  </section>

  <!-- ═══════ Écran 3 — Moat ═══════ -->
  <section class="moat" aria-labelledby="moat-title">
    <div class="section-kicker mono">◇ le moat</div>
    <h2 class="section-title" id="moat-title">
      Le cerveau tient. Même quand ton équipe change.
    </h2>

    <div class="moat-body">
      <p class="moat-para">
        Trois mois d'utilisation sur un client pilote.
        <strong class="big-num">{PILOT_RULES_COUNT}</strong>
        règles apprises à partir de tes corrections.
        Quand un setter rejoint l'équipe, il écrit dans
        la bonne voix dès son premier draft. Plus de semaine
        à relire les archives du client.
      </p>
      <p class="moat-punch">
        Tes setters changent. Le clone reste. Les règles apprises aussi.
      </p>
    </div>

    <div class="moat-cta">
      <a class="btn-primary" href={DEMO_CTA_HREF}>
        → Rejoindre la liste d'attente.
      </a>
      <p class="cta-sub mono">20 premiers clients. On calibre avec toi.</p>
    </div>
  </section>

  <!-- ═══════ Footer ═══════ -->
  <footer class="foot">
    <div class="foot-left">
      <span class="foot-brand mono">
        <span class="brand-mark">◎</span>
        VoiceClone
      </span>
      <a class="foot-link" href="/guide">guide</a>
    </div>

    <form class="access" onsubmit={submitCode} aria-label="Accès client">
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
    padding: 14px 28px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .brand { display: inline-flex; align-items: baseline; gap: 8px; }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: 600; color: var(--ink); letter-spacing: 0.01em; }

  .top-cta {
    color: var(--ink);
    border-bottom: 1px solid var(--vermillon);
    text-decoration: none;
    padding-bottom: 2px;
    font-family: var(--font-mono);
    transition: color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .top-cta:hover { color: var(--vermillon); }

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
    font-size: clamp(28px, 3.8vw, 44px);
    line-height: 1.1;
    letter-spacing: -0.018em;
    color: var(--ink);
    margin: 0 0 40px;
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
    padding: 80px 28px 72px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
  }
  .overline {
    font-size: 11px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 24px;
  }
  .headline {
    font-family: var(--font);
    font-weight: 400;
    font-size: clamp(36px, 6vw, 72px);
    line-height: 1.04;
    letter-spacing: -0.022em;
    color: var(--ink);
    margin: 0 0 32px;
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
    font-size: 17px;
    color: var(--ink-70);
    line-height: 1.55;
    max-width: 58ch;
    margin: 0 0 56px;
  }
  .sub em {
    color: var(--ink);
    font-style: italic;
  }

  /* Triptyque — 3 beats côte à côte sur desktop, stack sur narrow */
  .triptyque {
    list-style: none;
    padding: 0;
    margin: 0 0 56px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    border-top: 1px solid var(--rule-strong);
    border-bottom: 1px solid var(--rule-strong);
  }
  .beat {
    padding: 28px 24px;
    border-right: 1px solid var(--rule);
  }
  .beat:last-child { border-right: none; }

  .beat-title {
    font-family: var(--font);
    font-weight: 500;
    font-style: italic;
    font-size: 20px;
    color: var(--vermillon);
    line-height: 1.2;
    margin: 0 0 14px;
    letter-spacing: -0.005em;
  }
  .beat-body {
    font-size: 14.5px;
    line-height: 1.6;
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
    gap: 10px;
  }
  .cta-sub {
    font-size: 11.5px;
    color: var(--ink-40);
    margin: 0;
    letter-spacing: 0.02em;
  }
  .demo-link {
    margin-top: 4px;
    padding: 4px 0;
    background: none;
    border: none;
    border-bottom: 1px dashed var(--ink-40);
    color: var(--ink-70);
    font-size: 12px;
    letter-spacing: 0.02em;
    cursor: pointer;
    align-self: flex-start;
    transition: color var(--dur-fast, 120ms) var(--ease, ease),
                border-color var(--dur-fast, 120ms) var(--ease, ease);
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
    padding: 80px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }

  .captures {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 32px;
  }
  .capture { margin: 0; }
  .capture-frame {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 6px 24px rgba(0,0,0,0.04);
    overflow: hidden;
    margin-bottom: 18px;
    min-height: 240px;
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
  .rule-row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 8px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px dashed var(--rule);
  }
  .rule-dot { color: var(--vermillon); font-size: 10px; }
  .rule-label { font-size: 11px; color: var(--ink-70); }
  .rule-detail {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--ink);
    background: var(--paper-subtle, #f6f5f1);
    padding: 1px 6px;
  }
  .rule-action {
    display: flex; align-items: center; gap: 10px;
    margin-top: 6px;
  }
  .rule-btn {
    padding: 4px 10px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-size: 10.5px;
    letter-spacing: 0.02em;
    cursor: not-allowed;
  }
  .rule-hint {
    font-size: 11px;
    color: var(--ink-40);
    font-style: italic;
  }
  .fb-list {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 6px;
    font-size: 13px;
    color: var(--ink-70);
  }
  .fb-list li {
    padding: 4px 0;
    border-bottom: 1px dashed var(--rule);
    display: grid;
    grid-template-columns: 42px 1fr;
    gap: 10px;
  }
  .fb-list li:last-child { border-bottom: none; }
  .fb-date {
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding-top: 2px;
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
    padding: 96px 28px 80px;
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
    margin-bottom: 40px;
  }
  .moat-para {
    font-family: var(--font);
    font-size: 22px;
    line-height: 1.5;
    color: var(--ink);
    margin: 0 0 24px;
  }
  .big-num {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 1.3em;
    color: var(--vermillon);
    font-variant-numeric: tabular-nums;
    margin: 0 2px;
  }
  .moat-punch {
    font-family: var(--font);
    font-style: italic;
    font-size: 18px;
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
    gap: 20px;
    padding: 18px 28px;
    border-top: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    flex-wrap: wrap;
    margin-top: auto;
  }
  .foot-left {
    display: inline-flex;
    gap: 20px;
    align-items: center;
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
    .hero { padding: 56px 20px 48px; }
    .proof { padding: 56px 20px; }
    .moat { padding: 64px 20px 48px; }
    .topbar { padding: 12px 20px; }
    .foot { padding: 14px 20px; gap: 12px; }

    .headline { font-size: clamp(32px, 9vw, 44px); }
    .section-title { font-size: clamp(24px, 6.5vw, 32px); }
    .moat-para { font-size: 18px; }
  }
</style>
