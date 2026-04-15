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
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }

  .chat-input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: var(--font);
    resize: none;
    outline: none;
    max-height: 120px;
    line-height: 1.5;
    transition: border-color 0.15s;
  }

  .chat-input:focus { border-color: var(--text-tertiary); }
  .chat-input::placeholder { color: var(--text-tertiary); }

  .chat-send {
    padding: 0.5rem 0.875rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: var(--radius);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .chat-send:hover { opacity: 0.85; }
  .chat-send:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 768px) {
    .chat-input-bar {
      position: sticky;
      bottom: 0;
      padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }
  }

  @media (max-width: 480px) {
    .chat-input-bar { padding: 0.5rem; }
    .chat-send { padding: 0.5rem 0.625rem; font-size: 0.75rem; }
  }
</style>
