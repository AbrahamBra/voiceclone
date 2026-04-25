<script>
  // Prospect-reply paste zone.
  // Parent controls visibility ({#if showPasteZone}). Owns pasteText state internally.

  const PROSPECT_MIN = 3;

  let {
    onDismiss,  // () => void
    onSubmit,   // (content: string) => Promise<void>
  } = $props();

  let pasteText = $state("");

  function dismiss() {
    pasteText = "";
    onDismiss?.();
  }

  async function submit() {
    const content = pasteText.trim();
    if (content.length < PROSPECT_MIN) return;
    pasteText = "";
    await onSubmit?.(content);
  }

  function handleKeydown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  }
</script>

<div class="paste-zone" role="region" aria-label="Réponse du prospect">
  <header class="paste-header">
    <span class="paste-label">📥 Il a répondu ?</span>
    <button class="paste-dismiss" type="button" onclick={dismiss} aria-label="Ignorer"><span aria-hidden="true">×</span></button>
  </header>
  <textarea
    class="paste-textarea"
    bind:value={pasteText}
    onkeydown={handleKeydown}
    placeholder="Colle sa réponse ici…"
    rows="2"
  ></textarea>
  <footer class="paste-footer">
    <button
      class="paste-submit"
      type="button"
      onclick={submit}
      disabled={pasteText.trim().length < PROSPECT_MIN}
    >
      ajouter au fil
    </button>
    <span class="paste-hint">Cmd+Enter · Esc pour annuler</span>
  </footer>
</div>

<style>
  .paste-zone {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 16px;
    padding: 10px 12px;
    border: 1px dashed var(--rule-strong);
    border-bottom: none;
    background: var(--paper-subtle, #f6f5f1);
  }
  .paste-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .paste-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-70);
  }
  .paste-dismiss {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
  }
  .paste-dismiss:hover { color: var(--ink); }
  .paste-textarea {
    width: 100%;
    min-height: 42px;
    max-height: 120px;
    resize: vertical;
    padding: 6px 8px;
    border: 1px solid var(--rule);
    background: var(--paper);
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
  }
  .paste-textarea:focus { outline: 1px solid var(--ink); outline-offset: -1px; }
  .paste-footer {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .paste-submit {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 14px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    cursor: pointer;
  }
  .paste-submit:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .paste-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .paste-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
  }
</style>
