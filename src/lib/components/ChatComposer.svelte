<script>
  // Composer hybride : paste d'un message prospect (pas de draft auto) OU
  // déclenchement du draft clone (textarea = consigne optionnelle).
  // Remplace ChatInput + l'ex-composer-toolbar.
  let {
    disabled = false,
    scenarioType = null,
    onAddProspect,   // (text) => void
    onDraftNext,     // ({ consigne }) => void
  } = $props();

  let text = $state("");
  let textareaEl = $state(undefined);

  // Charcount target (POST/DM) — repris de ChatInput.svelte
  const POST_RANGE = { min: 1200, max: 1500 };
  const DM_RANGE = { min: 150, max: 280 };

  let target = $derived(
    !scenarioType ? null :
    scenarioType.startsWith("DM") ? DM_RANGE :
    scenarioType.startsWith("post") ? POST_RANGE :
    null
  );
  let chars = $derived(text.length);
  let countState = $derived(
    !target || chars === 0 ? "idle" :
    chars < target.min ? "under" :
    chars > target.max ? "over" : "ok"
  );

  $effect(() => { if (textareaEl) textareaEl.focus(); });

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 180) + "px";
  }

  function addProspect() {
    const msg = text.trim();
    if (!msg || disabled) return;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
    onAddProspect?.(msg);
  }

  function draftNext() {
    if (disabled) return;
    const consigne = text.trim() || null;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
    onDraftNext?.({ consigne });
  }

  function handleKeydown(e) {
    // Cmd/Ctrl+Enter = draft la suite (action fréquente en itération)
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      draftNext();
    }
    // Shift+Enter = newline (default)
  }
</script>

<div class="composer">
  {#if target}
    <div class="char-counter mono" data-state={countState} aria-live="polite">
      <span class="count">{chars}</span>
      <span class="sep"> · </span>
      <span class="target">cible {target.min}–{target.max}</span>
    </div>
  {/if}

  <textarea
    bind:this={textareaEl}
    bind:value={text}
    oninput={autoResize}
    onkeydown={handleKeydown}
    placeholder="Paste le prochain msg prospect, ou tape une consigne de draft (Cmd+Enter = draft)"
    rows="2"
    {disabled}
  ></textarea>

  <div class="actions">
    <button class="btn-ghost" type="button" onclick={addProspect} {disabled} title="Ajoute le texte comme message prospect (pas de draft auto)">
      📥 ajouter prospect
    </button>
    <button class="btn-primary" type="button" onclick={draftNext} {disabled} title="Génère un clone_draft (textarea = consigne optionnelle). Cmd+Enter">
      ✨ draft la suite
    </button>
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--rule);
    background: var(--paper);
  }
  .char-counter {
    font-size: 10.5px;
    color: var(--ink-40);
  }
  .char-counter[data-state="under"] { color: #b37e3b; }
  .char-counter[data-state="over"]  { color: var(--vermillon); }
  .char-counter[data-state="ok"]    { color: #3b8a5c; }

  textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-sans, system-ui);
    font-size: 13px;
    padding: 8px 10px;
    min-height: 46px;
  }
  textarea:focus { outline: none; border-color: var(--ink); }

  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .btn-ghost,
  .btn-primary {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink);
  }
  .btn-primary {
    background: var(--vermillon);
    color: var(--paper);
    border-color: var(--vermillon);
  }
  .btn-ghost:hover { background: var(--paper-subtle); }
  .btn-primary:hover { opacity: 0.9; }
  .btn-ghost:disabled,
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
