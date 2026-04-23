<script>
  // Composer hybride : paste d'un message prospect (pas de draft auto) OU
  // déclenchement du draft clone (textarea = consigne optionnelle).
  // Remplace ChatInput + l'ex-composer-toolbar.
  import { CANONICAL_SCENARIOS } from "$lib/scenarios.js";
  import { inferPrimary, shouldShowPasteZone } from "$lib/composer-state.js";

  let {
    disabled = false,
    scenarioType = null,
    isEmptyConversation = false,
    onDraftNext,          // ({ consigne }) => void
    onAnalyzeProspect,    // (url: string) => void — called when user confirms paste-detected LinkedIn URL
    onSwitchScenario,     // (scenarioId) => Promise<void> — flip scenario_type before drafting (DM sub-mode)
    onIngestPost,         // (post: string) => void — called when user submits a hand-written post to ingest as rules
    onAddProspectReply,   // (content: string) => Promise<void> — DM only, logs prospect message with turn_kind='prospect'
    lastTurnKind = null,              // NEW : 'toi'|'prospect'|'clone_draft'|'draft_rejected'|null
    onPasteDismiss,                   // NEW : () => void — appelé au dismiss de la zone paste
  } = $props();

  // DM sub-modes exposed as CTAs in the composer. Clicking one switches
  // scenario_type (same kind = no conv reset) then drafts.
  const DM_SUBMODES = [
    { id: "DM_1st", label: "✨ 1er message" },
    { id: "DM_reply", label: "✨ répondre" },
    { id: "DM_relance", label: "✨ relancer" },
    { id: "DM_closing", label: "✨ closer" },
  ];
  let isDmMode = $derived(scenarioType?.startsWith("DM") ?? false);
  let isPostMode = $derived(scenarioType?.startsWith("post") ?? false);

  // Ingest mode : user wants to paste a hand-written post to teach the clone.
  // Flip les CTA + placeholder. Reset à chaque changement de scénario.
  let ingestMode = $state(false);
  // Prospect-reply mode : user a reçu une réponse DM qu'il veut logger
  // (turn_kind='prospect'). Pas d'appel LLM — juste un INSERT message.
  let prospectMode = $state(false);
  $effect(() => { scenarioType; ingestMode = false; prospectMode = false; });

  // --- Zone paste (réponse prospect) — NEW ---
  let pasteDismissed = $state(false);
  let pasteText = $state("");
  let showPasteZone = $derived(
    shouldShowPasteZone({ isDmMode, lastTurnKind, pasteDismissed })
  );
  // Reset dismiss + text quand lastTurnKind change (nouvel envoi → re-propose la zone)
  $effect(() => { lastTurnKind; pasteDismissed = false; pasteText = ""; });

  // --- CTA primaire inféré — NEW ---
  let inferredPrimary = $derived(
    inferPrimary({ isDmMode, isEmptyConversation, lastTurnKind })
  );

  const LINKEDIN_URL_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s/?#]+/i;

  let starters = $derived(
    (scenarioType && CANONICAL_SCENARIOS[scenarioType]?.starters) || []
  );

  // Bloque le composer tant que l'opérateur n'a pas choisi de scénario.
  // Le scénario est le seul switch de contexte qui oriente vraiment le draft
  // (DM, post, relance…) — le laisser vide = LLM qui part de zéro.
  let scenarioMissing = $derived(!scenarioType);
  let effectiveDisabled = $derived(disabled || scenarioMissing);

  let text = $state("");
  let textareaEl = $state(undefined);

  // Charcount target (POST/DM) — repris de ChatInput.svelte
  const POST_RANGE = { min: 1200, max: 1500 };
  const DM_RANGE = { min: 150, max: 280 };
  const INGEST_MIN = 50;

  let target = $derived(
    !scenarioType ? null :
    scenarioType.startsWith("DM") ? DM_RANGE :
    scenarioType.startsWith("post") ? POST_RANGE :
    null
  );
  let chars = $derived(text.length);
  const PROSPECT_MIN = 3;
  let countState = $derived(
    prospectMode
      ? (chars === 0 ? "idle" : chars < PROSPECT_MIN ? "under" : "ok")
      : ingestMode
      ? (chars === 0 ? "idle" : chars < INGEST_MIN ? "under" : "ok")
      : !target || chars === 0 ? "idle"
      : chars < target.min ? "under"
      : chars > target.max ? "over" : "ok"
  );

  let ctaLabel = $derived.by(() => {
    if (!scenarioType) return "✨ draft la suite";
    if (scenarioType.startsWith("post")) return "✨ écrire le post";
    if (scenarioType === "DM_1st") return "✨ envoyer le 1er message";
    if (scenarioType === "DM_relance") return "✨ relancer";
    if (scenarioType === "DM_reply") return "✨ répondre";
    if (scenarioType === "DM_closing") return "✨ closer";
    return "✨ draft la suite";
  });

  let placeholderText = $derived(
    scenarioMissing
      ? "Sélectionne un scénario pour débloquer le composer"
      : prospectMode
        ? "Colle la réponse de ton prospect — elle sera ajoutée au fil (pas de draft auto)"
        : ingestMode
          ? "Colle ton post ici — on en extraira des règles à valider (min 50 caractères)"
          : scenarioType?.startsWith("post")
            ? "Décris le sujet du post ou colle une inspiration (Cmd+Enter = générer)"
            : "Tape une consigne pour draft la suite (Cmd+Enter). Réponse reçue → bouton 📥"
  );

  // Paste-detected LinkedIn URL → inline "Analyser" banner. Dismissable.
  let detectedUrl = $state(null);
  let urlDismissed = $state(false);
  $effect(() => {
    if (urlDismissed) return;
    const match = text.match(LINKEDIN_URL_RE);
    detectedUrl = match ? match[0] : null;
  });

  // Empty-state hint: guide l'user DM vers le scrape LinkedIn quand conv vierge.
  // Masqué dès qu'une URL est collée (banner prend le relai) ou qu'un message part.
  let showLeadHint = $derived(
    isEmptyConversation && !scenarioMissing && isDmMode && text.length === 0 && !detectedUrl
  );

  function analyzeDetected() {
    if (!detectedUrl) return;
    const url = detectedUrl;
    text = "";
    detectedUrl = null;
    urlDismissed = false;
    if (textareaEl) textareaEl.style.height = "auto";
    onAnalyzeProspect?.(url);
  }

  function dismissDetected() {
    urlDismissed = true;
    detectedUrl = null;
  }

  $effect(() => { if (textareaEl) textareaEl.focus(); });

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 180) + "px";
  }

  function draftNext() {
    if (disabled) return;
    const consigne = text.trim() || null;
    text = "";
    urlDismissed = false;
    if (textareaEl) textareaEl.style.height = "auto";
    onDraftNext?.({ consigne });
  }

  // DM sub-mode CTA: flip scenario_type (if different) then draft.
  async function draftDmSubmode(subModeId) {
    if (effectiveDisabled) return;
    if (subModeId !== scenarioType) {
      await onSwitchScenario?.(subModeId);
    }
    draftNext();
  }

  function applyStarter(/** @type {string} */ template) {
    if (effectiveDisabled) return;
    text = template;
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      autoResize();
    });
  }

  function handleKeydown(e) {
    // Cmd/Ctrl+Enter = action primaire du mode courant
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (prospectMode) addProspectReply();
      else if (ingestMode) ingestPost();
      else draftNext();
    }
    // Shift+Enter = newline (default)
  }

  function startIngest() {
    if (effectiveDisabled) return;
    ingestMode = true;
    text = "";
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      autoResize();
    });
  }

  function cancelIngest() {
    ingestMode = false;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
  }

  function ingestPost() {
    if (effectiveDisabled) return;
    const post = text.trim();
    if (post.length < 50) return;
    text = "";
    ingestMode = false;
    if (textareaEl) textareaEl.style.height = "auto";
    onIngestPost?.(post);
  }

  function startProspect() {
    if (effectiveDisabled) return;
    prospectMode = true;
    text = "";
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      autoResize();
    });
  }

  function cancelProspect() {
    prospectMode = false;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
  }

  async function addProspectReply() {
    if (effectiveDisabled) return;
    const content = text.trim();
    if (content.length < PROSPECT_MIN) return;
    text = "";
    prospectMode = false;
    if (textareaEl) textareaEl.style.height = "auto";
    await onAddProspectReply?.(content);
  }
</script>

<div class="composer" class:composer-locked={scenarioMissing}>
  {#if scenarioMissing}
    <div class="scenario-gate mono" role="status">
      → Choisis un scénario (haut de la page) avant d'écrire — le draft en dépend.
    </div>
  {:else if prospectMode}
    <div class="char-counter mono" data-state={countState} aria-live="polite">
      <span class="count">{chars}</span>
      <span class="sep"> · </span>
      <span class="target">
        {chars < PROSPECT_MIN ? "colle la réponse reçue" : "prêt à ajouter"}
      </span>
    </div>
  {:else if ingestMode}
    <div class="char-counter mono" data-state={countState} aria-live="polite">
      <span class="count">{chars}</span>
      <span class="sep"> · </span>
      <span class="target">
        {chars < INGEST_MIN
          ? `encore ${INGEST_MIN - chars} car. avant d'ingérer`
          : "prêt à ingérer"}
      </span>
    </div>
  {:else if target}
    <div class="char-counter mono" data-state={countState} aria-live="polite">
      <span class="count">{chars}</span>
      <span class="sep"> · </span>
      <span class="target">cible {target.min}–{target.max}</span>
    </div>
  {/if}

  {#if detectedUrl && onAnalyzeProspect}
    <div class="lead-detected mono" role="status">
      <span class="lead-label">🔗 URL LinkedIn détectée</span>
      <div class="lead-actions">
        <button type="button" class="lead-analyse" onclick={analyzeDetected} disabled={disabled}>
          Analyser ce prospect
        </button>
        <button type="button" class="lead-dismiss" onclick={dismissDetected} aria-label="Ignorer">
          ×
        </button>
      </div>
    </div>
  {:else if showLeadHint && onAnalyzeProspect}
    <div class="lead-hint mono" role="note">
      🔗 Colle une URL LinkedIn pour démarrer — on extrait le profil + posts
    </div>
  {/if}

  {#if !scenarioMissing && starters.length > 0 && text.length === 0}
    <div class="starters" role="group" aria-label="Amorces de consigne">
      {#each starters as s (s.label)}
        <button
          type="button"
          class="starter-chip mono"
          onclick={() => applyStarter(s.template)}
          disabled={effectiveDisabled}
          title={s.template}
        >
          {s.label}
        </button>
      {/each}
    </div>
  {/if}

  <textarea
    bind:this={textareaEl}
    bind:value={text}
    oninput={autoResize}
    onkeydown={handleKeydown}
    placeholder={placeholderText}
    rows="2"
    disabled={effectiveDisabled}
  ></textarea>

  <div class="actions">
    {#if prospectMode}
      <button
        class="btn-primary btn-prospect"
        type="button"
        onclick={addProspectReply}
        disabled={effectiveDisabled || text.trim().length < PROSPECT_MIN}
        title="Ajoute la réponse du prospect au fil (turn_kind=prospect). Cmd+Enter"
      >
        📥 ajouter la réponse
      </button>
      <button class="btn-cancel-ingest" type="button" onclick={cancelProspect}>
        annuler
      </button>
    {:else if ingestMode}
      <button
        class="btn-primary btn-ingest"
        type="button"
        onclick={ingestPost}
        disabled={effectiveDisabled || text.trim().length < 50}
        title="Extrait des règles candidates depuis ton post. Cmd+Enter"
      >
        📝 ingérer ce post
      </button>
      <button class="btn-cancel-ingest" type="button" onclick={cancelIngest}>
        annuler
      </button>
    {:else if isDmMode}
      <!-- 4 sub-mode CTAs replace the single adaptive button. Each click
           switches scenario_type (same kind = no conv reset) then drafts.
           The currently active sub-mode is visually marked. Cmd+Enter still
           drafts in the active sub-mode. -->
      {#each DM_SUBMODES as sub (sub.id)}
        <button
          class="btn-dm"
          class:btn-dm-active={sub.id === scenarioType}
          type="button"
          onclick={() => draftDmSubmode(sub.id)}
          disabled={effectiveDisabled}
          aria-pressed={sub.id === scenarioType}
          title="{sub.label} — bascule en mode {sub.id}"
        >
          {sub.label}
        </button>
      {/each}
      {#if onAddProspectReply}
        <button
          class="btn-prospect-toggle"
          type="button"
          onclick={startProspect}
          disabled={effectiveDisabled}
          title="Ton prospect vient de répondre ? Colle sa réponse pour la logger dans le fil."
        >
          📥 j'ai reçu
        </button>
      {/if}
    {:else}
      <button class="btn-primary" type="button" onclick={draftNext} disabled={effectiveDisabled} title="Génère un clone_draft (textarea = consigne optionnelle). Cmd+Enter">
        {ctaLabel}
      </button>
      {#if isPostMode && onIngestPost}
        <button
          class="btn-ingest-toggle"
          type="button"
          onclick={startIngest}
          disabled={effectiveDisabled}
          title="Ingère un post que le client a écrit à la main — on en extrait des règles pour le cerveau"
        >
          📝 j'ai écrit ce post
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--rule);
    background: var(--paper);
  }
  .char-counter {
    font-size: 10.5px;
    color: var(--ink-40);
  }
  .char-counter[data-state="under"] { color: #b37e3b; }
  .char-counter[data-state="over"]  { color: var(--vermillon); }
  .char-counter[data-state="ok"]    { color: #3b8a5c; }

  .lead-detected {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px dashed var(--rule);
    font-size: 11px;
    color: var(--ink-70);
  }
  .lead-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lead-actions { display: flex; gap: 6px; align-items: center; }
  .lead-analyse {
    font-family: var(--font-mono);
    font-size: 10.5px;
    padding: 3px 10px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    cursor: pointer;
  }
  .lead-analyse:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .lead-analyse:disabled { opacity: 0.5; cursor: not-allowed; }
  .lead-dismiss {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 14px;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
  }
  .lead-dismiss:hover { color: var(--ink); }

  .lead-hint {
    padding: 6px 10px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px dashed var(--rule);
    font-size: 11px;
    color: var(--ink-60, #666);
  }

  .composer-locked textarea { background: var(--paper-subtle, #f6f5f1); }
  .scenario-gate {
    font-size: 11px;
    color: var(--vermillon);
    padding: 2px 0;
  }

  .starters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 4px;
  }
  .starter-chip {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px solid var(--rule);
    color: var(--ink);
    cursor: pointer;
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease),
      background var(--dur-fast, 120ms) var(--ease, ease);
  }
  .starter-chip:hover:not(:disabled) {
    border-color: var(--vermillon);
    background: var(--paper, #fff);
  }
  .starter-chip:disabled { opacity: 0.5; cursor: not-allowed; }

  textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-sans, system-ui);
    font-size: 13px;
    padding: 8px 10px;
    min-height: 46px;
  }
  textarea:focus { outline: none; border-color: var(--ink); }

  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .btn-primary {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid var(--vermillon);
    background: var(--vermillon);
    color: var(--paper);
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-ingest-toggle {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    cursor: pointer;
    border: 1px dashed var(--rule-strong);
    background: var(--paper);
    color: var(--ink-70);
  }
  .btn-ingest-toggle:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
  .btn-ingest-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-ingest { background: var(--ink); border-color: var(--ink); }
  .btn-ingest:disabled {
    background: var(--paper);
    color: var(--ink-40);
    border: 1px dashed var(--rule-strong);
    opacity: 1;
  }
  .btn-cancel-ingest {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    cursor: pointer;
    border: none;
    background: transparent;
    color: var(--ink-40);
  }
  .btn-cancel-ingest:hover { color: var(--ink); }

  /* Mode "j'ai reçu" : toggle dashed en mode DM, puis bouton plein en mode prospect. */
  .btn-prospect-toggle {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    cursor: pointer;
    border: 1px dashed var(--rule-strong);
    background: var(--paper);
    color: var(--ink-70);
  }
  .btn-prospect-toggle:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
  .btn-prospect-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-prospect { background: var(--ink); border-color: var(--ink); }
  .btn-prospect:disabled {
    background: var(--paper);
    color: var(--ink-40);
    border: 1px dashed var(--rule-strong);
    opacity: 1;
  }

  /* DM sub-mode CTAs. Row of 4 compact buttons. Active sub-mode is filled
     vermillon to signal "this is what will fire on Cmd+Enter", inactive ones
     are outlined but still clickable (one click = switch + draft). */
  .actions { flex-wrap: wrap; }
  .btn-dm {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink-70);
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease),
      background var(--dur-fast, 120ms) var(--ease, ease),
      color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .btn-dm:hover:not(:disabled) {
    border-color: var(--vermillon);
    color: var(--ink);
  }
  .btn-dm-active {
    background: var(--vermillon);
    color: var(--paper);
    border-color: var(--vermillon);
  }
  .btn-dm-active:hover:not(:disabled) {
    color: var(--paper);
    opacity: 0.9;
  }
  .btn-dm:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Under 480px, the 4 DM sub-mode CTAs wrap into a 2×2 grid rather than
     flexwrapping (which leaves a visually orphaned 4th button on its own
     row). Grid = equal widths, clean alignment on narrow screens. */
  @media (max-width: 480px) {
    .actions:has(.btn-dm) {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .btn-dm { width: 100%; }
  }
</style>
