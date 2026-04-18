<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { renderMarkdown } from "$lib/utils.js";
  import { track } from "$lib/tracking.js";

  let personaId = $derived($page.data.personaId);

  let loading = $state(true);
  let loadError = $state("");
  let messages = $state([]);
  let ratings = $state([]);
  let submitting = $state(false);
  let persona = $state(null);

  $effect(() => {
    if (personaId) loadCalibration(personaId);
  });

  async function loadCalibration(pid) {
    loading = true;
    loadError = "";

    // Persona fetch is non-blocking: if it fails, calibration still works,
    // header just falls back to "VoiceClone / calibration" without context.
    api(`/api/config?persona=${pid}`)
      .then((personaData) => { persona = personaData.persona || personaData || null; })
      .catch(() => { /* silent — header falls back */ });

    try {
      const calibData = await api("/api/calibrate", {
        method: "POST",
        body: JSON.stringify({ persona: pid }),
      });
      messages = calibData.messages;
      ratings = calibData.messages.map(() => ({ score: 0, correction: "" }));
    } catch {
      loadError = "Calibration indisponible. Vous pouvez passer.";
    } finally {
      loading = false;
    }
  }

  function setRating(index, score) {
    ratings[index] = { ...ratings[index], score };
  }

  function setCorrection(index, value) {
    ratings[index] = { ...ratings[index], correction: value };
  }

  async function submitCalibration() {
    submitting = true;

    const payload = messages.map((msg, i) => ({
      index: i,
      score: ratings[i].score || 3,
      correction: ratings[i].correction.trim(),
      response: msg.response?.slice(0, 300) || "",
    }));

    try {
      const data = await api("/api/calibrate", {
        method: "PATCH",
        body: JSON.stringify({ persona: personaId, ratings: payload }),
      });
      if (data.message) showToast(data.message);
      track("correction_submitted", { source: "calibrate" });
    } catch {
      // silent
    }

    setTimeout(() => {
      goto(`/chat/${personaId}`);
    }, 500);
  }

  function skip() {
    goto(`/chat/${personaId}`);
  }

  let scoredCount = $derived(ratings.filter(r => r.score > 0).length);
  let pad2 = (n) => String(n).padStart(2, "0");
</script>

<svelte:head>
  <title>VoiceClone — calibration</title>
</svelte:head>

<div class="cal-page">
  <header class="cal-head">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">VoiceClone</span>
      <span class="brand-sub">/ calibration</span>
      {#if persona}
        <span class="brand-context">· {persona.name}{persona.type ? ` · ${persona.type}` : ''}</span>
      {/if}
    </div>
    <nav class="head-meta mono">
      <span class="kv"><span class="k">essais</span><span class="v">{messages.length || "—"}</span></span>
      <span class="kv"><span class="k">notés</span><span class="v">{scoredCount}/{messages.length || "—"}</span></span>
    </nav>
  </header>

  <main class="cal-main">
    <section class="manifest">
      <h1 class="headline">
        <span class="h-lead">Calibration</span>
        <span class="h-accent">— étalonne le clone sur ton jugement.</span>
      </h1>
      <p class="sub">
        Le pipeline génère des réponses sur <span class="mono">n</span> scénarios types.
        Tu notes chaque sortie <span class="mono">1–5</span> et tu laisses une correction si besoin.
        Le clone apprend ce que <em>toi</em> considères bon — pas un benchmark générique.
      </p>
    </section>

    {#if loading}
      <div class="cal-state mono">
        <span class="state-dot"></span>
        génération des essais…
      </div>
    {:else if loadError}
      <div class="cal-state cal-state-error mono">
        <span class="state-dot"></span>
        {loadError}
      </div>
    {:else}
      <ul class="cal-trials">
        {#each messages as msg, i}
          {@const score = ratings[i].score}
          <li class="trial" class:scored={score > 0}>
            <header class="trial-head mono">
              <span class="trial-tag">essai:{pad2(i + 1)}</span>
              {#if msg.context}<span class="trial-context">{msg.context}</span>{/if}
              {#if score > 0}
                <span class="trial-score" class:high={score === 5} class:low={score === 1}>
                  {score === 5 ? '👍' : score === 3 ? '🤔' : '👎'}
                </span>
              {/if}
            </header>

            <div class="trial-response">
              {@html renderMarkdown(msg.response)}
            </div>

            <div class="trial-controls">
              <div class="cal-rating" role="radiogroup" aria-label="Note {i + 1}">
                {#each [['👎', 1, 'Note négative'], ['🤔', 3, 'Note mitigée'], ['👍', 5, 'Note positive']] as [emoji, scoreValue, aria]}
                  <button
                    class="rate-btn"
                    class:selected={score === scoreValue}
                    onclick={() => setRating(i, scoreValue)}
                    aria-label={aria}
                    aria-pressed={score === scoreValue}
                  >{emoji}</button>
                {/each}
              </div>
              <textarea
                class="cal-correction"
                placeholder="correction (optionnel) — dis ce qui cloche, le clone l'intègre"
                rows="2"
                value={ratings[i].correction}
                oninput={(e) => setCorrection(i, e.target.value)}
              ></textarea>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="cal-actions">
      <button class="btn-ghost mono" onclick={skip}>Passer</button>
      <button class="btn-solid mono" onclick={submitCalibration} disabled={submitting || loading}>
        {submitting ? "envoi…" : "valider la calibration →"}
      </button>
    </div>
  </main>
</div>

<style>
  .cal-page {
    min-height: 100dvh;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
  }

  .cal-head {
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
  .brand { display: inline-flex; align-items: baseline; gap: 8px; }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: var(--fw-semi); color: var(--ink); }
  .brand-sub { color: var(--ink-40); }
  .brand-context {
    color: var(--ink-70);
    font-size: var(--fs-tiny);
    margin-left: 6px;
  }
  .head-meta { display: inline-flex; gap: 16px; flex-wrap: wrap; }
  .kv { display: inline-flex; gap: 6px; align-items: baseline; }
  .k { color: var(--ink-40); text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--fs-nano); }
  .v { color: var(--ink); font-variant-numeric: tabular-nums; }

  .cal-main {
    max-width: 720px;
    margin: 0 auto;
    padding: 36px 20px 80px;
  }

  /* ── Manifest ── */
  .manifest {
    margin-bottom: 32px;
  }
  .headline {
    font-family: var(--font);
    font-size: clamp(26px, 3.6vw, 40px);
    font-weight: 400;
    line-height: 1.1;
    letter-spacing: -0.022em;
    color: var(--ink);
    margin-bottom: 16px;
    max-width: 22ch;
  }
  .h-lead { display: inline; }
  .h-accent {
    display: inline;
    font-style: italic;
    color: var(--vermillon);
  }
  .sub {
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    color: var(--ink-70);
    max-width: 56ch;
    line-height: var(--lh-normal);
  }
  .sub em { font-style: italic; color: var(--ink); }

  /* ── State ── */
  .cal-state {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .cal-state-error { border-color: var(--vermillon); color: var(--vermillon); }
  .state-dot {
    display: inline-block;
    width: 6px; height: 6px;
    background: var(--vermillon);
    animation: state-pulse 1.4s linear infinite;
  }
  @keyframes state-pulse {
    0%, 60%, 100% { opacity: 1; }
    80% { opacity: 0.2; }
  }

  /* ── Trials list ── */
  .cal-trials {
    list-style: none;
    padding: 0;
    margin: 24px 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .trial {
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--ink-20);
    padding: 12px 14px 10px;
    transition: border-color var(--dur-fast) var(--ease);
  }
  .trial.scored { border-left-color: var(--vermillon); }

  .trial-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--rule);
    margin-bottom: 10px;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-40);
  }
  .trial-tag {
    color: var(--ink);
    font-weight: var(--fw-semi);
  }
  .trial-context {
    color: var(--ink-40);
    text-transform: none;
    letter-spacing: 0;
    font-size: 10.5px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trial-score {
    margin-left: auto;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    font-weight: var(--fw-semi);
    padding: 1px 6px;
    border: 1px solid var(--rule-strong);
  }
  .trial-score.high { color: #2d7a3e; border-color: #2d7a3e; }
  .trial-score.low { color: var(--vermillon); border-color: var(--vermillon); }

  .trial-response {
    font-family: var(--font);
    font-size: var(--fs-standout);
    line-height: var(--lh-normal);
    color: var(--ink);
    padding: 4px 0 10px;
  }
  .trial-response :global(strong) { font-weight: var(--fw-semi); }
  .trial-response :global(em) { font-style: italic; color: var(--ink-70); }

  .trial-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--rule);
  }

  .cal-rating {
    display: flex;
    gap: 3px;
  }
  .rate-btn {
    width: 44px;
    height: 36px;
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-size: 18px;
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease);
  }
  .rate-btn:hover { border-color: var(--ink-40); transform: translateY(-1px); }
  .rate-btn.selected {
    background: var(--paper-subtle);
    border-color: var(--ink);
  }

  .cal-correction {
    width: 100%;
    padding: 8px 10px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--fs-small);
    resize: vertical;
    outline: none;
    transition: border-color var(--dur-fast) var(--ease);
  }
  .cal-correction:focus { border-color: var(--vermillon); }
  .cal-correction::placeholder { color: var(--ink-40); font-family: var(--font-mono); font-size: var(--fs-tiny); }

  /* ── Actions ── */
  .cal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--rule-strong);
  }

  .btn-ghost, .btn-solid {
    padding: 10px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.04em;
    border: 1px solid var(--rule-strong);
    min-height: var(--touch-min);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease);
  }
  .btn-ghost {
    background: transparent;
    color: var(--ink-70);
  }
  .btn-ghost:hover { color: var(--ink); border-color: var(--ink-40); }
  .btn-solid {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .btn-solid:hover:not(:disabled) {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .btn-solid:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 640px) {
    .cal-main { padding: 24px 16px 60px; }
    .trial { padding: 10px 12px; }
    .rate-btn { width: 44px; height: 44px; }
  }
</style>
