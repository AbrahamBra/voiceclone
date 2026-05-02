<script>
  // Barre supérieure unifiée — remplace ChatCockpit après suppression du hub.
  // Left : burger mobile + ClonesDropdown (avec points de triage par clone).
  // Center : badge style-health.
  // Right : bouton cerveau + UserMenu ⋯.
  //
  // DM-only depuis 2026-04-28 — plus de scenario picker (le composer expose
  // déjà les 4 sous-modes DM en CTA). Plus de kind-tabs (un seul kind).
  import { goto } from "$app/navigation";
  import ClonesDropdown from "./ClonesDropdown.svelte";
  import TenantBadge from "./TenantBadge.svelte";
  import UserMenu from "./UserMenu.svelte";

  let {
    personaName = "",
    personaAvatar = "?",
    personasList = [],       // enrichies par parent avec { triage, triageLabel }
    currentPersonaId = null,
    styleHealth = "unknown", // ok | warn | drift | unknown — vue d'ensemble cockpit
    onSwitchClone,
    onToggleSidebar,
    onDeletePersona = null,
    switcherOpen = $bindable(false),   // Cmd+Shift+C toggle depuis le parent
  } = $props();

  let menuOpen = $state(false);

  // Pulse vermillon quand l'état santé change — célèbre le signal d'apprentissage
  // (transitions ok/warn/drift). Ne pulse pas vers/depuis "unknown" (état initial).
  let healthPulse = $state(false);
  let prevHealth = "unknown";
  /** @type {ReturnType<typeof setTimeout> | null} */
  let healthPulseTimer = null;
  $effect(() => {
    const current = styleHealth;
    if (current !== prevHealth && current !== "unknown" && prevHealth !== "unknown") {
      healthPulse = false;
      requestAnimationFrame(() => { healthPulse = true; });
      if (healthPulseTimer) clearTimeout(healthPulseTimer);
      healthPulseTimer = setTimeout(() => { healthPulse = false; }, 700);
    }
    prevHealth = current;
  });

  const HEALTH_LABEL = {
    ok: "voix calibrée",
    warn: "voix à surveiller",
    drift: "voix qui dérive",
  };
  const HEALTH_TITLE = {
    ok: "Le clone reste fidèle à ta voix sur les derniers drafts.",
    warn: "Quelques drafts s'écartent un peu de ta voix — corrige si besoin.",
    drift: "Les drafts récents s'éloignent franchement de ta voix — ouvre le cerveau pour ajuster.",
  };

  function openBrain() {
    if (currentPersonaId) goto(`/brain/${currentPersonaId}`);
  }
</script>

<header class="topbar">
  <div class="left">
    <button class="icon-btn mobile-menu" onclick={() => onToggleSidebar?.()} aria-label="Conversations">☰</button>

    <div class="id-wrap">
      <button
        class="id-btn"
        onclick={() => (switcherOpen = !switcherOpen)}
        aria-haspopup="listbox"
        aria-expanded={switcherOpen}
        aria-label="Changer de clone (Cmd+Shift+C)"
        title="Changer de clone · Cmd+Shift+C"
      >
        <span class="avatar">{personaAvatar}</span>
        <span class="pname">{personaName}</span>
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

  <div class="center">
    {#if styleHealth !== "unknown"}
      <button
        type="button"
        class="style-health"
        class:health-ok={styleHealth === "ok"}
        class:health-warn={styleHealth === "warn"}
        class:health-drift={styleHealth === "drift"}
        class:pulse={healthPulse}
        title={HEALTH_TITLE[styleHealth]}
        onclick={openBrain}
        aria-live="polite"
      >
        <span class="health-dot" aria-hidden="true"></span>
        <span class="health-label">{HEALTH_LABEL[styleHealth]}</span>
      </button>
    {/if}
  </div>

  <div class="right">
    <TenantBadge />
    <button class="tab-btn mono" onclick={openBrain} aria-label="Ouvrir le cerveau du clone">cerveau</button>
    <UserMenu bind:open={menuOpen} {onDeletePersona} />
  </div>
</header>

<style>
  .topbar {
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
  .center { display: flex; align-items: center; gap: 10px; justify-content: center; }

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
  .id-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
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
  .id-btn:hover,
  .id-btn[aria-expanded="true"] {
    border-color: var(--rule-strong);
    background: var(--paper-subtle);
  }
  .id-btn:focus-visible {
    outline: 1px solid var(--vermillon);
    outline-offset: 2px;
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
    flex-shrink: 0;
  }
  .pname {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.005em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .chevron {
    font-size: 10px;
    color: var(--ink-40);
    margin-left: 2px;
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }
  .id-btn[aria-expanded="true"] .chevron { transform: rotate(180deg); }

  .tab-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color 0.08s linear, border-color 0.08s linear;
  }
  .tab-btn:hover { color: var(--ink); border-color: var(--ink-40); }

  /* Style-health badge — synthèse santé du clone (collapse + fidelity + rules
     actives). Marche avec le styleHealth dérivé côté parent. */
  .style-health {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink-60);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    line-height: 1;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .style-health:hover { color: var(--ink); }
  .style-health:focus-visible {
    outline: 1px solid var(--vermillon);
    outline-offset: 2px;
  }
  .style-health .health-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }
  .style-health.health-ok {
    color: var(--ink-60);
    border-color: var(--rule-strong);
  }
  .style-health.health-warn {
    color: var(--vermillon);
    border-color: var(--vermillon);
  }
  .style-health.health-drift {
    color: var(--paper);
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  /* Pulse à la transition d'état — célèbre que la santé du clone bouge. */
  .style-health.pulse {
    animation: stylehealthpulse 700ms ease-out;
  }
  @keyframes stylehealthpulse {
    0%   { box-shadow: 0 0 0 0 rgba(214, 73, 51, 0.55); }
    100% { box-shadow: 0 0 0 10px rgba(214, 73, 51, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .style-health.pulse { animation: none; }
  }

  @media (max-width: 768px) {
    .mobile-menu { display: block; }
    .topbar { grid-template-columns: auto 1fr auto; padding: 6px 10px; gap: 8px; }
    .icon-btn {
      min-width: var(--touch-min);
      min-height: var(--touch-min);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tab-btn,
    .style-health { padding: 10px 10px; min-height: var(--touch-min); font-size: 10px; }
  }
  @media (max-width: 560px) {
    .center { order: 3; grid-column: 1 / -1; justify-content: center; flex-wrap: wrap; }
    .topbar { grid-template-columns: auto 1fr auto; }
  }
</style>
