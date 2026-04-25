<script>
  // Barre supérieure unifiée — remplace ChatCockpit après suppression du hub.
  // Left : burger mobile + ClonesDropdown (avec points de triage par clone).
  // Center : pill scenario + badge style-health.
  // Right : bouton cerveau + UserMenu ⋯.
  //
  // Pas de flèche "back" ni bouton "changer de clone" : la nav se fait via
  // le dropdown et le menu ⋯ (nouveau clone / admin / guide / logout).
  import { goto } from "$app/navigation";
  import ClonesDropdown from "./ClonesDropdown.svelte";
  import ScenarioSwitcher from "./ScenarioSwitcher.svelte";
  import TenantBadge from "./TenantBadge.svelte";
  import UserMenu from "./UserMenu.svelte";
  import {
    CANONICAL_SCENARIOS,
    supportedCanonicalScenarios,
  } from "$lib/scenarios.js";

  let {
    personaName = "",
    personaAvatar = "?",
    personasList = [],       // enrichies par parent avec { triage, triageLabel }
    currentPersonaId = null,
    persona = null,          // pour ScenarioSwitcher (type + scenarios)
    scenarioType = null,
    onScenarioChange,
    onSwitchClone,
    onToggleSidebar,
    onDeletePersona = null,
    switcherOpen = $bindable(false),   // Cmd+Shift+C toggle depuis le parent
  } = $props();

  let menuOpen = $state(false);

  // Mode courant (post/dm) dérivé du scenario_type actif. Null tant que rien
  // n'est choisi (première visite sur un clone multi-mode).
  let currentKind = $derived(
    scenarioType && CANONICAL_SCENARIOS[scenarioType]
      ? CANONICAL_SCENARIOS[scenarioType].kind
      : null
  );

  // Quels kinds ce clone supporte-t-il ? On lit supportedCanonicalScenarios
  // (même logique que ScenarioSwitcher) pour rester cohérent avec persona.type.
  let availableKinds = $derived.by(() => {
    if (!persona) return /** @type {('post'|'dm')[]} */ ([]);
    const ids = supportedCanonicalScenarios(persona);
    /** @type {('post'|'dm')[]} */
    const kinds = [];
    if (ids.some((id) => CANONICAL_SCENARIOS[id].kind === "post")) kinds.push("post");
    if (ids.some((id) => CANONICAL_SCENARIOS[id].kind === "dm")) kinds.push("dm");
    return kinds;
  });

  // Tabs affichés seulement si le clone supporte réellement les deux modes.
  // Pour un clone mono-mode (posts-only ou dm-only), les tabs seraient du
  // bruit — on retombe sur le dropdown seul (même UX qu'avant).
  let showKindTabs = $derived(availableKinds.length > 1);

  // Valeur par défaut de scenario_type quand on bascule de kind via les tabs.
  // post_autonome et DM_1st sont les scénarios "neutres" de chaque mode.
  const DEFAULT_SCENARIO_BY_KIND = {
    post: "post_autonome",
    dm: "DM_1st",
  };

  /** @param {'post'|'dm'} kind */
  function pickKind(kind) {
    if (kind === currentKind) return;
    const defaultId = DEFAULT_SCENARIO_BY_KIND[kind];
    // Le parent gère la confirmation conv-active via pendingScenarioType.
    onScenarioChange?.(defaultId);
  }

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
    {#if persona}
      {#if showKindTabs}
        <div class="kind-tabs" role="tablist" aria-label="Mode de sortie">
          <button
            type="button"
            role="tab"
            class="kind-tab"
            class:active={currentKind === "post"}
            aria-selected={currentKind === "post"}
            onclick={() => pickKind("post")}
            title="Mode Post — contenu diffusé sur le feed"
          >
            Post
          </button>
          <button
            type="button"
            role="tab"
            class="kind-tab"
            class:active={currentKind === "dm"}
            aria-selected={currentKind === "dm"}
            onclick={() => pickKind("dm")}
            title="Mode DM — conversation privée (sous-modes au composer)"
          >
            DM
          </button>
        </div>
        {#if currentKind === "post"}
          <ScenarioSwitcher
            {persona}
            value={scenarioType}
            onchange={onScenarioChange}
            direction="down"
            kind="post"
          />
        {/if}
      {:else}
        <!-- Clone mono-mode : dropdown seul, comportement inchangé. -->
        <ScenarioSwitcher
          {persona}
          value={scenarioType}
          onchange={onScenarioChange}
          direction="down"
        />
      {/if}
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

  /* KindTabs — segmented Post / DM au centre de la topbar. Visible seulement
     pour les clones multi-mode. L'actif est rempli vermillon (même code
     visuel que les btn-dm du composer) pour rester cohérent. */
  .kind-tabs {
    display: inline-flex;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
  }
  .kind-tab {
    background: transparent;
    border: none;
    border-right: 1px solid var(--rule-strong);
    color: var(--ink-40);
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    cursor: pointer;
    min-height: var(--touch-min);
    transition: color 0.08s linear, background 0.08s linear;
  }
  .kind-tab:last-child { border-right: none; }
  .kind-tab:hover:not(.active) {
    color: var(--ink);
    background: var(--paper-subtle);
  }
  .kind-tab:focus-visible {
    outline: 2px solid var(--vermillon);
    outline-offset: -2px;
  }
  .kind-tab.active {
    background: var(--vermillon);
    color: var(--paper);
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
