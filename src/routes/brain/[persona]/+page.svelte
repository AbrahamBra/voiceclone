<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import { authHeaders } from "$lib/api.js";
  import KnowledgePanel from "$lib/components/KnowledgePanel.svelte";
  import IntelligencePanel from "$lib/components/IntelligencePanel.svelte";
  import ProtocolPanel from "$lib/components/ProtocolPanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";

  let { data } = $props();
  let personaId = $derived(data.personaId);

  const TABS = [
    { id: "connaissance", label: "connaissance" },
    { id: "protocole",    label: "protocole" },
    { id: "intelligence", label: "intelligence" },
    { id: "reglages",     label: "réglages" },
  ];

  // Read the tab from the URL hash (#connaissance / #intelligence / #reglages),
  // default to connaissance. Keep the hash in sync as the user switches tabs
  // so deep-links from cockpit/hub land on the correct section.
  let activeTab = $state("connaissance");

  $effect(() => {
    const hash = ($page.url.hash || "").replace(/^#/, "");
    if (TABS.some(t => t.id === hash)) activeTab = hash;
  });

  function selectTab(id) {
    activeTab = id;
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  }

  let intelligenceExtracting = $state(false);
  function handleKnowledgeUpload() {
    intelligenceExtracting = true;
    setTimeout(() => { intelligenceExtracting = false; }, 15_000);
  }

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      history.back();
    } else {
      goto(`/chat/${personaId}`);
    }
  }

  // Client-side auth guard (the parent +layout.svelte also guards but we
  // early-return if the user landed here directly without a session).
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  // Load persona config when user lands here directly (bookmark/refresh) —
  // the chat page normally populates this store, but brain can be reached
  // without visiting chat first. Without this, header shows "? / Clone".
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!personaId) return;
    if ($personaConfig && $personaConfig.id === personaId) return;
    fetch(`/api/config?persona=${personaId}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) personaConfig.set(cfg); })
      .catch(() => {});
  });
</script>

<svelte:head><title>Cerveau — {$personaConfig?.name || "Clone"}</title></svelte:head>

<div class="brain-page">
  <header class="brain-head">
    <button class="back-btn" onclick={goBack} aria-label="Retour">← retour</button>
    <div class="title">
      <span class="avatar">{$personaConfig?.avatar || "?"}</span>
      <h1>Cerveau — {$personaConfig?.name || "Clone"}</h1>
    </div>
  </header>

  <div class="tabs" role="tablist">
    {#each TABS as tab}
      <button
        class="tab mono"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => selectTab(tab.id)}
      >{tab.label}</button>
    {/each}
  </div>

  <div class="tab-body" role="tabpanel">
    {#if activeTab === "connaissance"}
      <KnowledgePanel {personaId} onupload={handleKnowledgeUpload} />
    {:else if activeTab === "protocole"}
      <ProtocolPanel {personaId} />
    {:else if activeTab === "intelligence"}
      <IntelligencePanel {personaId} extracting={intelligenceExtracting} />
    {:else if activeTab === "reglages"}
      <SettingsPanel embedded={true} {personaId} onClose={goBack} />
    {/if}
  </div>
</div>

<style>
  .brain-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 24px 64px;
    min-height: 100dvh;
  }
  .brain-head {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }
  .back-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-60);
    cursor: pointer;
  }
  .back-btn:hover { color: var(--ink); }
  .title { display: flex; align-items: center; gap: 10px; }
  .title .avatar { font-size: 22px; }
  .title h1 { margin: 0; font-size: 18px; font-weight: 500; }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--rule-strong);
    margin-bottom: 16px;
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-40);
    padding: 10px 14px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }
  .tab:hover { color: var(--ink); }
  .tab.active {
    color: var(--ink);
    border-bottom-color: var(--vermillon);
    font-weight: 600;
  }
  .tab-body {
    padding: 0;
  }
</style>
