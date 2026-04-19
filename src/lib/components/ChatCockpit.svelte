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

  // Single "style health" badge consolidating collapse + fidelity + rules.
  // Priority : drift (collapse<50 or fidelity<seuil) > warn (collapse 50-70 or rules fired) > ok > unknown.
  let styleHealth = $derived.by(() => {
    if (collapseState === "bad" || fidelityState === "drift") return "drift";
    if (collapseState === "warn" || rulesActiveCount > 0) return "warn";
    if (collapseState === "ok" && fidelityState === "ok") return "ok";
    return "unknown";
  });
  let styleHealthLabel = $derived(
    styleHealth === "drift" ? "style dérive" :
    styleHealth === "warn" ? "style alerte" :
    styleHealth === "ok" ? "style sain" :
    "style —"
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

  <!-- Center cluster — style health badge (collapse + fidélité + règles consolidés) -->
  <div class="gauges" role="group" aria-label="Santé du style">
    <div
      class="gauge style-health"
      data-state={styleHealth}
      tabindex="0"
      aria-label="{styleHealthLabel} · collapse {fmt(collapseIdx, 1)} · fidélité {fmt(fidelity, 3)} · {rulesActiveCount} règle{rulesActiveCount > 1 ? 's' : ''}"
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="g-val">{styleHealthLabel}</span>
      <div class="tip" role="tooltip">
        <div class="tip-head">santé du style</div>
        <div class="tip-row"><span>collapse</span><span class="mono" data-state={collapseState}>{fmt(collapseIdx, 1)}</span></div>
        <div class="tip-row"><span>fidélité</span><span class="mono" data-state={fidelityState}>{fmt(fidelity, 3)}</span></div>
        <div class="tip-row"><span>règles actives</span><span class="mono">{rulesActiveCount}</span></div>
        {#if breakdown}
          <div class="tip-row tip-thresh"><span>ttr</span><span class="mono">{fmt(breakdown.ttr, 2)}</span></div>
          <div class="tip-row"><span>kurtosis</span><span class="mono">{fmt(breakdown.kurtosis, 2)}</span></div>
          <div class="tip-row"><span>ratio questions</span><span class="mono">{fmt(breakdown.questionRatio, 2)}</span></div>
          <div class="tip-row"><span>signature</span><span class="mono">{fmt(breakdown.signaturePresence, 2)}</span></div>
          <div class="tip-row"><span>interdits</span><span class="mono">{breakdown.forbiddenHits ?? 0}</span></div>
        {/if}
        <div class="tip-row tip-thresh"><span>seuil fidélité</span><span class="mono">{FIDELITY_THRESHOLD.toFixed(3)}</span></div>
      </div>
    </div>

    <button
      class="gauge-help"
      class:pulse={hintPulse}
      onclick={toggleGlossary}
      aria-label="Aide — lire les métriques, corriger, changer de clone"
      aria-expanded={glossaryOpen}
    >?</button>
  </div>

  {#if glossaryOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="glossary-backdrop" onclick={toggleGlossary}></div>
    <aside class="glossary" role="dialog" aria-label="Aide contextuelle">
      <header class="gl-head">
        <span class="gl-title mono">aide · rapide</span>
        <button class="gl-close" onclick={toggleGlossary} aria-label="Fermer">×</button>
      </header>

      <div class="gl-section">
        <h3 class="gl-sec-title mono">santé du style</h3>
        <dl class="gl-body">
          <dt class="mono">style sain</dt>
          <dd>Collapse ≥ 70 <strong>et</strong> fidélité ≥ 0.720 <strong>et</strong> aucune règle d'anti-pattern active.</dd>

          <dt class="mono">style alerte</dt>
          <dd>Collapse 50–70, <strong>ou</strong> règles actives. Signal faible, à surveiller.</dd>

          <dt class="mono">style dérive</dt>
          <dd>Collapse &lt; 50 <strong>ou</strong> fidélité &lt; 0.720. Une passe de réécriture est déclenchée.</dd>
        </dl>
      </div>

      <div class="gl-section">
        <h3 class="gl-sec-title mono">métriques</h3>
        <dl class="gl-body">
          <dt class="mono">collapse</dt>
          <dd>Indice 0–100 de préservation du style du persona.</dd>

          <dt class="mono">fidélité</dt>
          <dd>Similarité cosinus vs. corpus source. Seuil 0.720.</dd>

          <dt class="mono">règles</dt>
          <dd>Tournures indésirables détectées (markdown, auto-référence, clichés FR).</dd>
        </dl>
      </div>

      <div class="gl-section">
        <h3 class="gl-sec-title mono">flux quotidien</h3>
        <dl class="gl-body">
          <dt class="mono">corriger un message</dt>
          <dd>Clic sur <code>corriger</code> sous le message bot. Ta correction nourrit les règles du clone. <a class="gl-link" href="/guide#feedback" target="_blank" rel="noopener">voir le guide →</a></dd>

          <dt class="mono">changer de clone</dt>
          <dd>Clic sur l'avatar du cockpit, ou <code>Cmd+Shift+C</code>. Le contexte conversation est préservé par clone.</dd>

          <dt class="mono">alimenter la base</dt>
          <dd>Plus le clone a de contexte (posts, DMs, docs métier), plus il est précis. <a class="gl-link" href="/guide#knowledge" target="_blank" rel="noopener">voir le guide →</a></dd>
        </dl>
      </div>

      <footer class="gl-foot mono">
        <a class="gl-foot-link" href="/guide" target="_blank" rel="noopener">guide complet →</a>
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
    >brief</button>
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

  /* Style-health badge: single consolidated indicator */
  .style-health {
    padding: 6px 12px;
    gap: 8px;
  }
  .style-health .g-val {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
    text-transform: none;
  }
  .style-health .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-30);
    flex-shrink: 0;
    align-self: center;
  }
  .style-health[data-state="ok"] .dot { background: #2d7a3e; }
  .style-health[data-state="warn"] .dot { background: #b87300; }
  .style-health[data-state="drift"] .dot {
    background: var(--vermillon);
    animation: sh-pulse 1.2s linear infinite;
  }
  .style-health[data-state="ok"] .g-val { color: var(--ink); }
  .style-health[data-state="warn"] .g-val { color: #b87300; }
  .style-health[data-state="drift"] .g-val { color: var(--vermillon); }
  .style-health[data-state="unknown"] .g-val { color: var(--ink-40); }
  @keyframes sh-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.3); opacity: 0.6; }
  }

  /* Tooltip row mini-states (inherited color from main palette) */
  .tip-row .mono[data-state="drift"],
  .tip-row .mono[data-state="bad"] { color: #ef7666; }
  .tip-row .mono[data-state="warn"] { color: #f0b050; }
  .tip-row .mono[data-state="ok"] { color: #9be38d; }

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

  .gl-section {
    padding: 4px 0;
    border-bottom: 1px dashed var(--rule);
  }
  .gl-section:last-of-type { border-bottom: 0; }
  .gl-sec-title {
    margin: 0;
    padding: 10px 16px 2px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-40);
    font-weight: 600;
  }
  .gl-body {
    margin: 0;
    padding: 6px 16px 10px;
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
  .gl-body dd code {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 5px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule);
    color: var(--ink);
    border-radius: 2px;
  }
  .gl-link {
    color: var(--vermillon);
    text-decoration: none;
    border-bottom: 1px dashed var(--vermillon);
    font-size: 11px;
    margin-left: 4px;
    white-space: nowrap;
  }
  .gl-link:hover { color: var(--ink); border-bottom-color: var(--ink); }
  .gl-foot {
    padding: 10px 14px;
    border-top: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    font-size: 11px;
    text-align: center;
  }
  .gl-foot-link {
    color: var(--vermillon);
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    font-size: 10.5px;
  }
  .gl-foot-link:hover { color: var(--ink); }

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
