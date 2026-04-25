<script>
  import { brainDrawer, VALID_BRAIN_TABS } from '$lib/stores/brainDrawer';
  import KnowledgePanel from './KnowledgePanel.svelte';
  import IntelligencePanel from './IntelligencePanel.svelte';
  import ProtocolPanel from './ProtocolPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';

  let { personaId, onRuleAddedWhileDrafting, hasActiveDraft = false } = $props();

  const TABS = [
    { id: 'connaissance', label: 'Connaissance' },
    { id: 'protocole',    label: 'Protocole'    },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'reglages',     label: 'Réglages'     },
  ];

  function handleKeydown(e) {
    if (e.key === 'Escape' && $brainDrawer.open) {
      const focused = document.activeElement;
      if (focused?.tagName === 'TEXTAREA' || focused?.tagName === 'INPUT') return;
      brainDrawer.close();
    }
  }

  function handleRuleAdded() {
    if (hasActiveDraft) {
      onRuleAddedWhileDrafting?.();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $brainDrawer.open}
  <aside class="brain-drawer" role="complementary" aria-label="Cerveau du clone">
    <header class="drawer-header">
      <div class="tabs" role="tablist">
        {#each TABS as tab}
          <button
            role="tab"
            class="tab"
            class:active={$brainDrawer.tab === tab.id}
            aria-selected={$brainDrawer.tab === tab.id}
            onclick={() => brainDrawer.setTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <button class="close" aria-label="Fermer le cerveau" onclick={() => brainDrawer.close()}>
        ✕
      </button>
    </header>

    <div class="panel-body" role="tabpanel">
      {#if $brainDrawer.tab === 'connaissance'}
        <KnowledgePanel {personaId} />
      {:else if $brainDrawer.tab === 'protocole'}
        <ProtocolPanel {personaId} onRuleAdded={handleRuleAdded} />
      {:else if $brainDrawer.tab === 'intelligence'}
        <IntelligencePanel {personaId} />
      {:else if $brainDrawer.tab === 'reglages'}
        <SettingsPanel embedded={true} {personaId} onClose={() => brainDrawer.close()} />
      {/if}
    </div>
  </aside>
{/if}

<style>
  .brain-drawer {
    display: flex;
    flex-direction: column;
    background: var(--surface-1, #fff);
    border-left: 1px solid var(--border, #e5e5e5);
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
  }

  .tab {
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
  }

  .tab.active {
    background: var(--surface-2);
    font-weight: 600;
  }

  .close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.2rem;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
  }

  @media (max-width: 899px) {
    .brain-drawer {
      position: fixed;
      inset: 0;
      z-index: 50;
      transform: translateX(0);
      transition: transform 180ms ease-out;
    }
  }
</style>
