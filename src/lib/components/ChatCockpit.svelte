<script>
  // Cockpit header — minimal identity strip for the chat page.
  // The style-health badge deep-links to /brain#intelligence for full diagnostic;
  // the ⚙ cerveau button deep-links to /brain#reglages.
  // All lab metrics (collapse / fidelity / rules) live under /brain/[persona].

  import { goto } from "$app/navigation";
  import ClonesDropdown from "./ClonesDropdown.svelte";

  let {
    personaName = "",
    personaAvatar = "?",
    // Consolidated state pre-derived by the parent (ok | warn | drift | unknown)
    styleHealth = "unknown",
    // Clone switcher
    personasList = [],
    currentPersonaId = null,
    switcherOpen = $bindable(false),
    onSwitchClone,
    // Callbacks
    onBack,
    onToggleSidebar,
    onToggleLead,
    onOpenBrain,
  } = $props();

  let styleHealthLabel = $derived(
    styleHealth === "drift" ? "style dérive" :
    styleHealth === "warn" ? "style alerte" :
    styleHealth === "ok" ? "style sain" :
    "style —"
  );

  function openBrainIntelligence() {
    if (onOpenBrain) return onOpenBrain("intelligence");
    if (currentPersonaId) goto(`/brain/${currentPersonaId}#intelligence`);
  }
  function openBrainReglages() {
    if (onOpenBrain) return onOpenBrain("reglages");
    if (currentPersonaId) goto(`/brain/${currentPersonaId}#reglages`);
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
        <div class="id-text">
          <span class="pname">{personaName}</span>
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

  <!-- Center cluster — style health badge. Click routes to /brain#intelligence. -->
  <div class="gauges" role="group" aria-label="Santé du style">
    <button
      class="gauge style-health"
      type="button"
      data-state={styleHealth}
      onclick={openBrainIntelligence}
      aria-label="{styleHealthLabel}. Clic : diagnostic complet dans le cerveau du clone."
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="g-val">{styleHealthLabel}</span>
    </button>
  </div>

  <!-- Right cluster — actions -->
  <div class="right">
    <button
      class="tab-btn mono"
      onclick={() => onToggleLead?.()}
      aria-label="Brief du prospect"
    >brief</button>
    <button
      class="tab-btn mono"
      onclick={openBrainReglages}
      aria-label="Ouvrir le cerveau du clone"
    >cerveau</button>
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
  .id-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .pname {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.005em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* ───── Style-health badge ───── */
  .gauges {
    display: inline-flex;
    align-items: stretch;
  }
  .style-health {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    cursor: pointer;
    font-family: var(--font-mono);
    transition: border-color 0.08s linear, background 0.08s linear;
  }
  .style-health:hover {
    border-color: var(--ink-40);
    background: var(--paper);
  }
  .style-health:focus-visible {
    outline: 1px solid var(--vermillon);
    outline-offset: 2px;
  }
  .style-health .g-val {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.005em;
    color: var(--ink);
  }
  .style-health .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-30);
    flex-shrink: 0;
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

  @media (max-width: 768px) {
    .mobile-menu { display: block; }
    .cockpit { grid-template-columns: auto 1fr auto; padding: 6px 10px; gap: 8px; }
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
    .style-health {
      padding: 10px 10px;
      min-height: var(--touch-min);
    }
  }
  @media (max-width: 560px) {
    .gauges { order: 3; grid-column: 1 / -1; justify-content: center; }
    .cockpit { grid-template-columns: auto 1fr auto; }
  }
</style>
