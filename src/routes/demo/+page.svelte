<script>
  // Public demo — "clone-toi en 5 min".
  //
  // 3-step stateless flow :
  //   1. Colle 3 de tes posts LinkedIn
  //   2. Colle le contexte du prospect + son dernier message
  //   3. Stream un DM drafté dans ta voix (Haiku + baseline FR anti-IA)
  //
  // Aucune donnée n'est persistée côté serveur. sessionStorage garde le
  // progrès à travers un reload ; "recommencer" wipe tout. Rate-limité
  // à 3 drafts / IP / 24h (POST /api/demo-draft).

  import { onMount } from "svelte";

  const STORAGE_KEY = "setclone_demo_v1";
  const POST_MIN = 60;
  const POST_MAX = 3000;
  const BRIEF_MIN = 20;
  const BRIEF_MAX = 1500;

  // ───────── State ─────────
  let step = $state(1); // 1 = posts, 2 = brief, 3 = draft
  let posts = $state(["", "", ""]);
  let brief = $state("");
  let draft = $state("");
  let streaming = $state(false);
  let errorMsg = $state("");
  let rateLimited = $state(false);
  let copied = $state(false);
  let msFirstToken = $state(/** @type {number|null} */ (null));

  // ───────── Derived ─────────
  let postsReady = $derived(
    posts.every((p) => p.trim().length >= POST_MIN && p.trim().length <= POST_MAX),
  );
  let briefReady = $derived(
    brief.trim().length >= BRIEF_MIN && brief.trim().length <= BRIEF_MAX,
  );
  let postsLen = $derived(posts.map((p) => p.trim().length));
  let briefLen = $derived(brief.trim().length);

  // ───────── Persistence ─────────
  onMount(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.posts) && s.posts.length === 3) posts = s.posts;
        if (typeof s.brief === "string") brief = s.brief;
        if ([1, 2, 3].includes(s.step)) step = s.step;
        // Never restore a streamed draft — regenerate on demand
      }
    } catch {}
  });

  $effect(() => {
    // Persist only the inputs (not the draft or streaming state)
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ posts, brief, step: step === 3 ? 2 : step }),
      );
    } catch {}
  });

  // ───────── Actions ─────────
  function reset() {
    posts = ["", "", ""];
    brief = "";
    draft = "";
    errorMsg = "";
    rateLimited = false;
    copied = false;
    msFirstToken = null;
    step = 1;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function goTo(n) {
    errorMsg = "";
    step = n;
    // Scroll top on step change
    queueMicrotask(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  async function generate() {
    if (!postsReady || !briefReady || streaming) return;
    errorMsg = "";
    rateLimited = false;
    draft = "";
    streaming = true;
    msFirstToken = null;
    step = 3;
    const startedAt = performance.now();

    try {
      const resp = await fetch("/api/demo-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posts: posts.map((p) => p.trim()),
          brief: brief.trim(),
        }),
      });

      if (resp.status === 429) {
        const body = await resp.json().catch(() => ({}));
        rateLimited = true;
        errorMsg = body.error || "Limite démo atteinte.";
        streaming = false;
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        errorMsg = body.error || `Erreur ${resp.status}`;
        streaming = false;
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) { errorMsg = "Stream indisponible"; streaming = false; return; }
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const block of lines) {
          if (!block.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(block.slice(6));
            if (evt.type === "token" && typeof evt.text === "string") {
              if (msFirstToken === null) {
                msFirstToken = Math.round(performance.now() - startedAt);
              }
              draft += evt.text;
            } else if (evt.type === "error") {
              errorMsg = evt.error || "Erreur inconnue";
            }
          } catch {}
        }
      }
    } catch (err) {
      errorMsg = err?.message || "Connexion interrompue";
    } finally {
      streaming = false;
    }
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      copied = true;
      setTimeout(() => { copied = false; }, 1800);
    } catch {
      errorMsg = "Copie impossible — sélectionne manuellement.";
    }
  }

  // Map a length to a health class for the counter
  function lengthClass(len, min, max) {
    if (len === 0) return "count-empty";
    if (len < min) return "count-low";
    if (len > max) return "count-over";
    return "count-ok";
  }
</script>

<svelte:head>
  <title>Essaie en 5 min — Setclone</title>
  <meta name="description" content="Collez 3 de vos posts LinkedIn, un brief prospect, recevez un DM drafté dans votre voix. Sans inscription, pas de stockage." />
</svelte:head>

<div class="demo-root">
  <header class="demo-header">
    <a class="back" href="/" aria-label="Retour landing">← Setclone</a>
    <div class="step-meta mono">
      étape {step}/3 · démo éphémère · aucune donnée stockée
    </div>
  </header>

  <main class="demo-main">

    <!-- ═══════ STEP 1 : 3 posts ═══════ -->
    {#if step === 1}
      <section class="step">
        <div class="kicker mono">◇ étape 1</div>
        <h1 class="title">Collez 3 de vos posts LinkedIn.</h1>
        <p class="sub">
          N'importe lesquels, du moment qu'ils sonnent <em>vous</em>.
          Le clone apprend votre rythme, votre vocabulaire, vos tics.
          Le copier-coller suffit, pas de scraping.
        </p>

        <div class="posts-grid">
          {#each posts as _, i}
            <label class="post-field">
              <span class="post-label mono">post {i + 1}</span>
              <textarea
                bind:value={posts[i]}
                rows="7"
                maxlength={POST_MAX + 200}
                placeholder="Collez le texte brut de votre post ici…"
                class="post-textarea"
              ></textarea>
              <span class="count mono {lengthClass(postsLen[i], POST_MIN, POST_MAX)}">
                {postsLen[i]} / {POST_MAX}
                {#if postsLen[i] > 0 && postsLen[i] < POST_MIN}
                  · trop court (min {POST_MIN})
                {:else if postsLen[i] > POST_MAX}
                  · trop long (max {POST_MAX})
                {/if}
              </span>
            </label>
          {/each}
        </div>

        <div class="actions">
          <button
            class="btn-primary"
            onclick={() => goTo(2)}
            disabled={!postsReady}
          >
            continuer →
          </button>
          {#if !postsReady}
            <span class="hint mono">chaque post doit faire {POST_MIN}–{POST_MAX} caractères</span>
          {/if}
        </div>
      </section>
    {/if}

    <!-- ═══════ STEP 2 : brief prospect ═══════ -->
    {#if step === 2}
      <section class="step">
        <div class="kicker mono">◇ étape 2</div>
        <h1 class="title">Le contexte prospect.</h1>
        <p class="sub">
          Deux lignes qui suffisent : qui est le prospect, où vous en êtes, et
          (si pertinent) son dernier message. Le clone ne l'invente pas.
        </p>

        <label class="brief-field">
          <span class="post-label mono">brief</span>
          <textarea
            bind:value={brief}
            rows="8"
            maxlength={BRIEF_MAX + 100}
            placeholder={`Ex :\nProspect : Sophie, head of sales, SaaS 40 pers.\nContexte : 1er message envoyé il y a 3j, elle répond "Ok envoie ton process en 2 lignes."\nObjectif : caler un call.`}
            class="post-textarea"
          ></textarea>
          <span class="count mono {lengthClass(briefLen, BRIEF_MIN, BRIEF_MAX)}">
            {briefLen} / {BRIEF_MAX}
            {#if briefLen > 0 && briefLen < BRIEF_MIN}
              · trop court (min {BRIEF_MIN})
            {:else if briefLen > BRIEF_MAX}
              · trop long (max {BRIEF_MAX})
            {/if}
          </span>
        </label>

        <div class="actions">
          <button class="btn-ghost mono" onclick={() => goTo(1)}>← retour</button>
          <button
            class="btn-primary"
            onclick={generate}
            disabled={!briefReady || streaming}
          >
            {streaming ? "génération…" : "drafte le DM →"}
          </button>
        </div>
      </section>
    {/if}

    <!-- ═══════ STEP 3 : draft ═══════ -->
    {#if step === 3}
      <section class="step">
        <div class="kicker mono">
          ◇ étape 3
          {#if msFirstToken !== null && !streaming}
            · premier token en {msFirstToken} ms
          {/if}
        </div>
        <h1 class="title">
          {#if streaming}
            Il drafte…
          {:else if errorMsg}
            Problème.
          {:else}
            Le draft.
          {/if}
        </h1>

        {#if rateLimited}
          <div class="error-box">
            <p class="error-text">{errorMsg}</p>
            <p class="error-sub mono">
              La démo est limitée à 3 essais / 24h pour cadrer les coûts.
              Pour y accéder sans limite, rejoignez la waitlist.
            </p>
            <a class="btn-primary" href="/#cta">rejoindre la waitlist →</a>
          </div>
        {:else if errorMsg && !streaming && !draft}
          <div class="error-box">
            <p class="error-text">{errorMsg}</p>
            <button class="btn-ghost mono" onclick={() => goTo(2)}>← revenir au brief</button>
          </div>
        {:else}
          <div class="draft-frame" class:streaming>
            <pre class="draft-text">{draft}{#if streaming}<span class="cursor">▊</span>{/if}</pre>
          </div>

          {#if !streaming && draft}
            <div class="actions-col">
              <div class="actions">
                <button class="btn-primary" onclick={copyDraft}>
                  {copied ? "copié ✓" : "copier le DM"}
                </button>
                <button class="btn-ghost mono" onclick={() => goTo(2)}>
                  ← retoucher le brief
                </button>
              </div>

              <div class="post-demo-cta">
                <p class="post-demo-text">
                  Ce draft est généré avec les règles anti-IA FR <em>universelles</em>.
                  Votre vrai clone apprend <em>vos</em> corrections à vous,
                  retient les règles, et ne vous les redemande jamais.
                </p>
                <div class="actions">
                  <a class="btn-primary" href="/#cta">rejoindre la waitlist →</a>
                  <button class="btn-ghost mono" onclick={reset}>recommencer</button>
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    <footer class="foot mono">
      <span>démo stateless · haiku-4-5 · règles anti-IA FR baseline</span>
      <span class="privacy">vos posts quittent votre navigateur le temps d'une requête, puis sont effacés</span>
    </footer>
  </main>
</div>

<style>
  .demo-root {
    min-height: 100vh;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
  }

  .demo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 28px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .back {
    color: var(--ink);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.04em;
  }
  .back:hover { color: var(--vermillon); }
  .step-meta {
    font-size: 10.5px;
    color: var(--ink-40);
    letter-spacing: 0.04em;
  }

  .demo-main {
    flex: 1;
    max-width: 780px;
    width: 100%;
    margin: 0 auto;
    padding: 48px 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .kicker {
    font-size: var(--fs-micro);
    color: var(--ink-40);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .title {
    font-family: var(--font);
    font-size: clamp(28px, 4.6vw, 44px);
    font-weight: 500;
    line-height: 1.12;
    margin: 0;
    color: var(--ink);
  }

  .sub {
    font-family: var(--font);
    font-size: var(--fs-standout);
    color: var(--ink-70);
    line-height: 1.5;
    margin: 0;
    max-width: 60ch;
  }
  .sub em { font-style: italic; }

  /* ─── Posts + brief inputs ─── */
  .posts-grid {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .post-field,
  .brief-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .post-label {
    font-size: 10.5px;
    color: var(--ink-40);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .post-textarea {
    width: 100%;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    line-height: 1.55;
    padding: 14px 16px;
    resize: vertical;
    outline: none;
    transition: border-color 120ms ease;
  }
  .post-textarea:focus {
    border-color: var(--ink-70);
  }

  .count {
    align-self: flex-end;
    font-size: 10.5px;
    letter-spacing: 0.04em;
  }
  .count-empty { color: var(--ink-30); }
  .count-low   { color: var(--warning); }
  .count-over  { color: var(--vermillon); }
  .count-ok    { color: var(--success); }

  /* ─── Actions ─── */
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .actions-col {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .btn-primary {
    display: inline-block;
    background: var(--ink);
    color: var(--paper);
    border: none;
    padding: 13px 20px;
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.02em;
    cursor: pointer;
    text-decoration: none;
    transition: background 120ms ease;
  }
  .btn-primary:hover:not(:disabled) { background: var(--vermillon); }
  .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

  .btn-ghost {
    background: none;
    border: none;
    border-bottom: 1px dashed var(--ink-40);
    color: var(--ink-70);
    padding: 4px 0;
    font-size: 12px;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .btn-ghost:hover { color: var(--vermillon); border-bottom-color: var(--vermillon); }

  .hint {
    font-size: 11px;
    color: var(--ink-40);
    letter-spacing: 0.02em;
  }

  /* ─── Draft + error ─── */
  .draft-frame {
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    padding: 22px 24px;
    min-height: 180px;
    position: relative;
  }
  .draft-frame.streaming {
    border-color: var(--vermillon);
  }
  .draft-text {
    margin: 0;
    font-family: var(--font);
    font-size: var(--fs-standout);
    line-height: 1.6;
    white-space: pre-wrap;
    color: var(--ink);
  }
  .cursor {
    display: inline-block;
    color: var(--vermillon);
    animation: blink 900ms steps(2) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }

  .error-box {
    border: 1px solid var(--vermillon);
    background: color-mix(in srgb, var(--vermillon) 8%, transparent);
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }
  .error-text {
    margin: 0;
    font-family: var(--font);
    font-size: var(--fs-standout);
    color: var(--ink);
  }
  .error-sub {
    margin: 0;
    font-size: 11.5px;
    color: var(--ink-70);
    letter-spacing: 0.02em;
  }

  .post-demo-cta {
    border-top: 1px solid var(--rule-strong);
    padding-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .post-demo-text {
    margin: 0;
    font-family: var(--font);
    font-size: var(--fs-body);
    color: var(--ink-70);
    line-height: 1.55;
    max-width: 58ch;
  }
  .post-demo-text em { color: var(--ink); font-style: italic; }

  /* ─── Footer ─── */
  .foot {
    margin-top: auto;
    padding-top: 32px;
    border-top: 1px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 10.5px;
    color: var(--ink-40);
    letter-spacing: 0.04em;
  }
  .privacy { color: var(--ink-30); }

  @media (max-width: 640px) {
    .demo-header { padding: 16px 20px; }
    .demo-main { padding: 32px 20px 24px; gap: 24px; }
    .actions { gap: 12px; }
  }
</style>
