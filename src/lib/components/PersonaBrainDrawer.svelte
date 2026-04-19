<script>
  // Persona-brain drawer — single right-side slide-over consolidating the 4
  // long-term persona-config surfaces that were previously scattered:
  //   - connaissance (was: sidebar left tab)
  //   - intelligence (was: sidebar left tab)
  //   - règles       (was: separate right slide-over)
  //   - réglages     (was: separate right slide-over)
  //
  // Collapsing them behind a single ⚙ cockpit trigger implements the Model A
  // recommendation from the design critique: primary action (drafting) stays
  // on-screen, config/knowledge lives in one drawer, one click away.

  import SidePanel from "./SidePanel.svelte";
  import RulesPanel from "./RulesPanel.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  import KnowledgePanel from "./KnowledgePanel.svelte";
  import IntelligencePanel from "./IntelligencePanel.svelte";

  let {
    open = false,
    personaId = null,
    ruleStats = {},
    initialTab = "règles",
    onClose,
  } = $props();

  // Tab order reflects expected access frequency for an agency operator —
  // règles first (daily glance), then the lower-frequency config/knowledge.
  const TABS = [
    { id: "règles",       label: "règles" },
    { id: "connaissance", label: "connaissance" },
    { id: "intelligence", label: "intelligence" },
    { id: "réglages",     label: "réglages" },
  ];

  let activeTab = $state(initialTab);

  // Reset to requested tab each time the drawer opens — lets the cockpit or
  // a pastille click deep-link to a specific section.
  $effect(() => {
    if (open) activeTab = initialTab;
  });

  let intelligenceExtracting = $state(false);

  function handleKnowledgeUpload() {
    intelligenceExtracting = true;
    setTimeout(() => { intelligenceExtracting = false; }, 15_000);
  }
</script>

<SidePanel {open} title="Cerveau du clone" width={420} {onClose}>
  <nav class="pb-tabs" role="tablist">
    {#each TABS as tab}
      <button
        class="pb-tab mono"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => activeTab = tab.id}
      >{tab.label}</button>
    {/each}
  </nav>

  <div class="pb-body" role="tabpanel">
    {#if activeTab === "règles"}
      <RulesPanel embedded={true} {ruleStats} />
    {:else if activeTab === "connaissance"}
      <div class="pb-scroll">
        <KnowledgePanel {personaId} onupload={handleKnowledgeUpload} />
      </div>
    {:else if activeTab === "intelligence"}
      <div class="pb-scroll">
        <IntelligencePanel {personaId} extracting={intelligenceExtracting} />
      </div>
    {:else if activeTab === "réglages"}
      <SettingsPanel embedded={true} {personaId} {onClose} />
    {/if}
  </div>
</SidePanel>

<style>
  .pb-tabs {
    display: flex;
    gap: 0;
    margin: -14px -16px 0;
    padding: 0 16px;
    border-bottom: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pb-tabs::-webkit-scrollbar { display: none; }

  .pb-tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-40);
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    cursor: pointer;
    transition: color 0.08s linear, border-color 0.08s linear;
    white-space: nowrap;
  }
  .pb-tab:hover { color: var(--ink); }
  .pb-tab.active {
    color: var(--ink);
    border-bottom-color: var(--vermillon);
    font-weight: 600;
  }

  .pb-body {
    margin: 0 -16px;
    padding: 14px 0 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  /* When the tab uses a wrapping component (KnowledgePanel/IntelligencePanel)
     we give it a little breathing room; règles and réglages own their padding. */
  .pb-scroll { padding: 0 16px; }
</style>
