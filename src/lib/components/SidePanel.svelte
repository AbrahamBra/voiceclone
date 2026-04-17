<script>
  // Generic right-side slide-in panel — the non-modal replacement for our
  // FeedbackModal / SettingsModal. No backdrop: the chat stays visible and
  // usable underneath.

  let { open = false, title = "", width = 380, onClose, children } = $props();

  function handleKey(e) {
    if (e.key === "Escape" && open) onClose?.();
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <aside class="side-panel" style="--panel-w: {width}px" aria-label={title || "Panneau"}>
    {#if title}
      <header class="sp-head">
        <span class="sp-title mono">{title}</span>
        <button class="sp-close mono" onclick={() => onClose?.()} aria-label="Fermer">✕</button>
      </header>
    {/if}
    <div class="sp-body">
      {@render children?.()}
    </div>
  </aside>
{/if}

<style>
  .side-panel {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: var(--panel-w, 380px);
    max-width: 90vw;
    background: var(--paper);
    border-left: 1px solid var(--rule-strong);
    z-index: 35;
    display: flex;
    flex-direction: column;
    font-family: var(--font-ui);
    animation: slide 0.14s linear;
    box-shadow: -6px 0 24px rgba(20, 20, 26, 0.06);
  }
  @keyframes slide {
    from { transform: translateX(12px); opacity: 0.7; }
    to   { transform: translateX(0);    opacity: 1;   }
  }

  .sp-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
  }
  .sp-title {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .sp-close {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 14px;
    cursor: pointer;
    padding: 8px 10px;
    min-width: var(--touch-min);
    min-height: var(--touch-min);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.08s linear;
  }
  .sp-close:hover { color: var(--vermillon); }

  .sp-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
  }

  @media (max-width: 560px) {
    .side-panel { width: 100%; }
  }
</style>
