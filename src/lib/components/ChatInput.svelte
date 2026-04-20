<script>
  let { onsend, disabled = false, scenarioType = null } = $props();

  let text = $state("");
  let textareaEl = $state(undefined);

  const POST_RANGE = { min: 1200, max: 1500 };
  const DM_RANGE = { min: 150, max: 280 };

  let target = $derived(
    !scenarioType ? null :
    scenarioType.startsWith("DM") ? DM_RANGE :
    scenarioType.startsWith("post") ? POST_RANGE :
    null
  );

  let placeholder = $derived(
    scenarioType?.startsWith("DM")
      ? "Colle le message du prospect, ou corrige le style du clone…"
      : scenarioType?.startsWith("post")
      ? "Colle un brief ou un contexte, ou corrige le style du clone…"
      : "Écris un message, corrige le style, ou donne une règle au clone…"
  );
  let chars = $derived(text.length);
  let countState = $derived(
    !target || chars === 0 ? "idle" :
    chars < target.min ? "under" :
    chars > target.max ? "over" : "ok"
  );

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

{#if target}
  <div class="char-counter mono" data-state={countState} aria-live="polite">
    <span class="count">{chars}</span>
    <span class="sep"> · </span>
    <span class="target">cible {target.min}–{target.max}</span>
  </div>
{/if}

<div class="chat-input-bar">
  <textarea
    class="chat-input"
    placeholder={placeholder}
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

  .char-counter {
    padding: 2px 16px 0;
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
    display: flex;
    gap: 2px;
    align-items: baseline;
  }
  .char-counter[data-state="ok"] .count { color: #2d7a3e; }
  .char-counter[data-state="over"] .count { color: var(--vermillon); }
  .char-counter[data-state="under"] .count { color: var(--ink-40); }
  .char-counter .target { color: var(--ink-40); }

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
