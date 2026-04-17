<script>
  let { onsend, disabled = false } = $props();

  let text = $state("");
  let textareaEl = $state(undefined);

  $effect(() => {
    if (textareaEl) textareaEl.focus();
  });

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + "px";
  }

  function handleKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const msg = text.trim();
    if (!msg || disabled) return;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
    onsend?.(msg);
  }
</script>

<div class="chat-input-bar">
  <textarea
    class="chat-input"
    placeholder="Ecrivez votre message..."
    rows="1"
    bind:value={text}
    bind:this={textareaEl}
    oninput={autoResize}
    onkeydown={handleKeydown}
    {disabled}
  ></textarea>
  <button class="chat-send" onclick={send} disabled={disabled || !text.trim()}>
    Envoyer
  </button>
</div>

<style>
  .chat-input-bar {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--rule-strong);
    background: var(--paper);
  }

  .chat-input {
    flex: 1;
    padding: 10px 12px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font);
    font-size: var(--fs-body);
    resize: none;
    outline: none;
    max-height: 120px;
    line-height: var(--lh-normal);
    transition: border-color var(--dur-fast) var(--ease);
  }
  .chat-input:focus { border-color: var(--vermillon); }
  .chat-input::placeholder { color: var(--ink-40); font-family: var(--font-ui); }

  .chat-send {
    padding: 10px 16px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.04em;
    min-height: var(--touch-min);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    white-space: nowrap;
  }
  .chat-send:hover:not(:disabled) {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .chat-send:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 768px) {
    .chat-input-bar {
      position: sticky;
      bottom: 0;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
    }
  }
  @media (max-width: 480px) {
    .chat-input-bar { padding: 8px; }
    .chat-send { padding: 10px; font-size: var(--fs-nano); }
  }
</style>
