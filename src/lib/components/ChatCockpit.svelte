<script>
  // Cockpit header for the chat page.
  // Always-on readings: collapse_idx, fidelity, session-level rule count.
  // Hover on any metric reveals its mini-decomposition.

  import StyleFingerprint from "./StyleFingerprint.svelte";
  import ClonesDropdown from "./ClonesDropdown.svelte";

  let {
    personaName = "",
    personaAvatar = "?",
    scenario = "",
    // Live readings — parent page computes these from fidelity API + last SSE done event
    collapseIdx = null,     // number 0..100 or null if unknown
    fidelity = null,        // number 0..1 or null
    breakdown = null,       // { ttr, kurtosis, questionRatio, signaturePresence, forbiddenHits, avgSentenceLen }
    sourceStyle = null,     // baseline source_style for fingerprint ghost layer
    // Clone switcher
    personasList = [],      // Array of { id, name, avatar } for inline switcher
    currentPersonaId = null,
    switcherOpen = $bindable(false),
    onSwitchClone,
    // UI slots
    rulesActiveCount = 0,
    rulesPanelOpen = false,
    feedbackOpen = false,
    settingsOpen = false,
    leadOpen = false,
    sidebarOpen = false,
    // Callbacks
    onBack,
    onToggleSidebar,
    onToggleRules,
    onToggleFeedback,
    onToggleSettings,
    onToggleLead,
  } = $props();

  function fmt(n, d = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Number(n).toFixed(d);
  }

  // Fidelity threshold line (matches lib/fidelity.js default)
  const FIDELITY_THRESHOLD = 0.72;
  let fidelityState = $derived(
    fidelity === null ? "unknown" :
    fidelity >= FIDELITY_THRESHOLD ? "ok" : "drift"
  );

  let collapseState = $derived(
    collapseIdx === null ? "unknown" :
    collapseIdx >= 70 ? "ok" :
    collapseIdx >= 50 ? "warn" : "bad"
  );

  // Glossaire — visible au clic sur le bouton "?". Persisté en localStorage
  // pour que l'overlay s'ouvre automatiquement à la première visite seulement.
  let glossaryOpen = $state(false);
  let hintPulse = $state(false);
  if (typeof window !== "undefined") {
    try {
      if (!localStorage.getItem("cockpit_glossary_seen")) {
        hintPulse = true;
      }
    } catch {}
  }
  function toggleGlossary() {
    glossaryOpen = !glossaryOpen;
    hintPulse = false;
    try { localStorage.setItem("cockpit_glossary_seen", "1"); } catch {}
  }
</script>

<header class="cockpit">
  <!-- Left cluster — identity -->
  <div class="left">
    <button class="icon-btn mobile-menu" onclick={() => onToggleSidebar?.()} aria-label="Conversations">☰</button>
    <button class="icon-btn back" onclick={() => onBack?.()} aria-label="Retour à l'accueil">←</button>
    <div class="id-wrap">
      <button
        class="id id-btn"
        onclick={() => (switcherOpen = !switcherOpen)}
        aria-haspopup="listbox"
        aria-expanded={switcherOpen}
        aria-label="Changer de clone (Cmd+Shift+C)"
        title="Changer de clone · Cmd+Shift+C"
      >
        <span class="avatar">{personaAvatar}</span>
        <div class="fp-slot">
          <StyleFingerprint draft={breakdown} source={sourceStyle} size={32} strokeWidth={1} tooltip />
        </div>
        <div class="id-text">
          <span class="pname">{personaName}</span>
          {#if scenario}
            <span class="scenario mono">{scenario}</span>
          {/if}
        </div>
        <span class="chevron" aria-hidden="true">▾</span>
      </button>
      <ClonesDropdown
        personas={personasList}
        {currentPersonaId}
        open={switcherOpen}
        onSelect={(id) => onSwitchClone?.(id)}
        onClose={() => (switcherOpen = false)}
      />
    </div>
  </div>

  <!-- Center cluster — lectures en direct -->
  <div class="gauges" role="group" aria-label="Lectures pipeline en direct">
    <div
      class="gauge"
      data-state={collapseState}
      tabindex="0"
      aria-label="Indice collapse : {fmt(collapseIdx, 1)}"
    >
      <span class="g-key">collapse</span>
      <span class="g-val mono">{fmt(collapseIdx, 1)}</span>
      <div class="tip" role="tooltip">
        <div class="tip-head">indice collapse</div>
        <div class="tip-row"><span>score de préservation du style, 0–100</span></div>
        <div class="tip-row"><span>≥ 70</span><span class="tip-ok">sain</span></div>
        <div class="tip-row"><span>50–70</span><span class="tip-warn">alerte</span></div>
        <div class="tip-row"><span>&lt; 50</span><span class="tip-bad">effondré</span></div>
      </div>
    </div>

    <div
      class="gauge"
      data-state={fidelityState}
      tabindex="0"
      aria-label="Fidélité cosinus : {fmt(fidelity, 3)}, seuil {FIDELITY_THRESHOLD}"
    >
      <span class="g-key">fidélité</span>
      <span class="g-val mono">{fmt(fidelity, 3)}</span>
      <div class="tip" role="tooltip">
        <div class="tip-head">fidélité · cosinus au corpus source</div>
        {#if breakdown}
          <div class="tip-row"><span>ttr</span><span class="mono">{fmt(breakdown.ttr, 2)}</span></div>
          <div class="tip-row"><span>kurtosis</span><span class="mono">{fmt(breakdown.kurtosis, 2)}</span></div>
          <div class="tip-row"><span>ratio questions</span><span class="mono">{fmt(breakdown.questionRatio, 2)}</span></div>
          <div class="tip-row"><span>signature</span><span class="mono">{fmt(breakdown.signaturePresence, 2)}</span></div>
          <div class="tip-row"><span>interdits</span><span class="mono">{breakdown.forbiddenHits ?? 0}</span></div>
          <div class="tip-row"><span>phrase moy.</span><span class="mono">{fmt(breakdown.avgSentenceLen, 0)}</span></div>
        {:else}
          <div class="tip-row"><span>aucune décomposition — envoie un message</span></div>
        {/if}
        <div class="tip-row tip-thresh"><span>seuil</span><span class="mono">{FIDELITY_THRESHOLD.toFixed(3)}</span></div>
      </div>
    </div>

    <div
      class="gauge gauge-rules"
      data-state={rulesActiveCount > 0 ? "fired" : "idle"}
      aria-label="Règles déclenchées : {rulesActiveCount}"
    >
      <span class="g-key">règles</span>
      <span class="g-val mono">{rulesActiveCount}</span>
    </div>

    <button
      class="gauge-help"
      class:pulse={hintPulse}
      onclick={toggleGlossary}
      aria-label="Qu'est-ce que ces lectures ?"
      aria-expanded={glossaryOpen}
    >?</button>
  </div>

  {#if glossaryOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="glossary-backdrop" onclick={toggleGlossary}></div>
    <aside class="glossary" role="dialog" aria-label="Glossaire laboratoire">
      <header class="gl-head">
        <span class="gl-title mono">glossaire · lectures en direct</span>
        <button class="gl-close" onclick={toggleGlossary} aria-label="Fermer">×</button>
      </header>
      <dl class="gl-body">
        <dt class="mono">collapse</dt>
        <dd>Indice 0–100 mesurant la préservation du style du persona. <strong>≥ 70</strong> sain, <strong>50–70</strong> alerte, <strong>&lt; 50</strong> style effondré — le clone parle comme un LLM générique.</dd>

        <dt class="mono">fidélité</dt>
        <dd>Similarité cosinus entre la sortie et votre corpus de référence. <strong>1.000</strong> = identique, seuil minimum <strong>0.720</strong>. En dessous, la passe de réécriture se déclenche.</dd>

        <dt class="mono">règles</dt>
        <dd>Nombre de règles de style actuellement actives (anti-patterns détectés). Chaque règle bloque ou corrige une signature indésirable.</dd>

        <dt class="mono">ttr</dt>
        <dd>Type-Token Ratio — diversité du vocabulaire. Plus haut = lexique plus riche.</dd>

        <dt class="mono">kurtosis</dt>
        <dd>Concentration des phrases courtes/longues. Signature rythmique du persona.</dd>

        <dt class="mono">signature</dt>
        <dd>Présence de tournures idiomatiques propres au persona (expressions, tics, formules).</dd>
      </dl>
      <footer class="gl-foot mono">
        survolez n'importe quelle jauge pour le détail en direct
      </footer>
    </aside>
  {/if}

  <!-- Right cluster — actions -->
  <div class="right">
    <button
      class="tab-btn mono"
      class:active={rulesPanelOpen}
      onclick={() => onToggleRules?.()}
      aria-pressed={rulesPanelOpen}
    >règles</button>
    <button
      class="tab-btn mono"
      class:active={leadOpen}
      onclick={() => onToggleLead?.()}
      aria-pressed={leadOpen}
    >prospect</button>
    <button
      class="tab-btn mono"
      class:active={feedbackOpen}
      onclick={() => onToggleFeedback?.()}
      aria-pressed={feedbackOpen}
    >correction</button>
    <button
      class="tab-btn mono"
      class:active={settingsOpen}
      onclick={() => onToggleSettings?.()}
      aria-pressed={settingsOpen}
    >réglages</button>
  </div>
</header>

<style>
  .cockpit {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    background: var(--paper);
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    position: relative;
  }

  .left, .right { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .right { justify-content: flex-end; }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 6px;
    transition: color 0.08s linear;
  }
  .icon-btn:hover { color: var(--ink); }
  .mobile-menu { display: none; }

  .id-wrap { position: relative; min-width: 0; }
  .id { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .id-btn {
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    padding: 2px 6px;
    margin: -2px -6px;
    transition: border-color 0.08s linear, background 0.08s linear;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  .id-btn:hover {
    border-color: var(--rule-strong);
    background: var(--paper-subtle);
  }
  .id-btn[aria-expanded="true"] {
    border-color: var(--rule-strong);
    background: var(--paper-subtle);
  }
  .id-btn:focus-visible {
    outline: 1px solid var(--vermillon);
    outline-offset: 2px;
  }
  .chevron {
    font-size: 10px;
    color: var(--ink-40);
    margin-left: 2px;
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }
  .id-btn[aria-expanded="true"] .chevron {
    transform: rotate(180deg);
  }
  .avatar {
    width: 22px; height: 22px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    display: inline-flex; align-items: center; justify-content: center;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--ink-70);
  }
  .fp-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .id-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .pname {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.005em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .scenario {
    font-size: 10px;
    color: var(--ink-40);
    text-transform: lowercase;
  }

  /* ───── Gauges ───── */
  .gauges {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
  }
  .gauge {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 10px;
    border-right: 1px solid var(--rule-strong);
    cursor: default;
  }
  .gauge:last-child { border-right: none; }
  .g-key {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40);
  }
  .g-val {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    letter-spacing: -0.01em;
  }

  /* State colors */
  .gauge[data-state="drift"] .g-val,
  .gauge[data-state="bad"] .g-val,
  .gauge[data-state="fired"] .g-val { color: var(--vermillon); }
  .gauge[data-state="warn"] .g-val { color: #b87300; }
  .gauge[data-state="unknown"] .g-val,
  .gauge[data-state="idle"] .g-val { color: var(--ink-40); }

  /* Hover tooltip */
  .tip {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    min-width: 220px;
    background: var(--ink);
    color: var(--paper);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0;
    pointer-events: none;
    z-index: 20;
    transition: opacity 0.1s linear, transform 0.1s linear;
    box-shadow: 0 2px 8px rgba(20, 20, 26, 0.15);
  }
  .tip::before {
    content: "";
    position: absolute;
    top: -5px; left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-bottom-color: var(--ink);
    border-top: 0;
  }
  .gauge:hover .tip,
  .gauge:focus-within .tip {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    pointer-events: auto;
  }
  .tip-head {
    color: var(--paper);
    font-weight: 600;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(245, 242, 236, 0.12);
  }
  .tip-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
    color: rgba(245, 242, 236, 0.72);
  }
  .tip-row .mono { color: var(--paper); }
  .tip-ok { color: #9be38d; }
  .tip-warn { color: #f0b050; }
  .tip-bad { color: #ef7666; }
  .tip-thresh {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(245, 242, 236, 0.12);
  }

  /* ───── Right tabs ───── */
  .tab-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color 0.08s linear, border-color 0.08s linear, background 0.08s linear;
  }
  .tab-btn:hover { color: var(--ink); border-color: var(--ink-40); }
  .tab-btn.active {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }

  /* Rules gauge: when fired, flash vermillon */
  .gauge-rules[data-state="fired"] .g-val {
    color: var(--vermillon);
    font-weight: 700;
  }

  /* ── Help button & glossary ── */
  .gauge-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    padding: 0 6px;
    margin-left: -1px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    border-left: 0;
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.08s linear, background 0.08s linear;
  }
  .gauge-help:hover {
    color: var(--ink);
    background: var(--paper);
  }
  .gauge-help.pulse {
    color: var(--vermillon);
    border-color: var(--vermillon);
    animation: help-pulse 1.8s linear infinite;
  }
  @keyframes help-pulse {
    0%, 100% { background: var(--paper-subtle); }
    50% { background: color-mix(in srgb, var(--vermillon) 10%, transparent); }
  }

  .glossary-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 18%, transparent);
    z-index: 39;
  }
  .glossary {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 24px));
    max-height: 70vh;
    overflow-y: auto;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 8px 24px rgba(20, 20, 26, 0.12);
    z-index: 40;
    font-family: var(--font);
  }
  .gl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
  }
  .gl-title {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink);
  }
  .gl-close {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
    font-size: 14px;
    width: 24px; height: 24px;
    cursor: pointer;
    line-height: 1;
  }
  .gl-close:hover { color: var(--ink); border-color: var(--ink-40); }

  .gl-body {
    margin: 0;
    padding: 12px 16px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    font-size: 13px;
    line-height: 1.5;
  }
  .gl-body dt {
    color: var(--vermillon);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding-top: 2px;
    align-self: baseline;
  }
  .gl-body dd {
    color: var(--ink-70);
    margin: 0;
  }
  .gl-body dd strong {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .gl-foot {
    padding: 8px 14px 10px;
    border-top: 1px dashed var(--rule);
    font-size: 10px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-align: center;
  }

  @media (max-width: 768px) {
    .mobile-menu { display: block; }
    .cockpit { grid-template-columns: auto 1fr auto; padding: 6px 10px; gap: 8px; }
    .scenario { display: none; }
    .icon-btn {
      min-width: var(--touch-min);
      min-height: var(--touch-min);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tab-btn {
      padding: 10px 10px;
      font-size: 10px;
      min-height: var(--touch-min);
      min-width: var(--touch-min);
    }
    .gauge {
      padding: 10px 10px;
      min-height: var(--touch-min);
    }
  }
  @media (max-width: 560px) {
    .gauges { order: 3; grid-column: 1 / -1; justify-content: center; }
    .cockpit { grid-template-columns: auto 1fr auto; }
  }
</style>
