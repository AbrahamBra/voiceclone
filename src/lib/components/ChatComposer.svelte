<script>
  // Composer hybride : paste d'un message prospect (pas de draft auto) OU
  // déclenchement du draft clone (textarea = consigne optionnelle).
  // Remplace ChatInput + l'ex-composer-toolbar.
  import { CANONICAL_SCENARIOS } from "$lib/scenarios.js";

  let {
    disabled = false,
    scenarioType = null,
    onDraftNext,     // ({ consigne }) => void
  } = $props();

  let starters = $derived(
    (scenarioType && CANONICAL_SCENARIOS[scenarioType]?.starters) || []
  );

  // Bloque le composer tant que l'opérateur n'a pas choisi de scénario.
  // Le scénario est le seul switch de contexte qui oriente vraiment le draft
  // (DM, post, relance…) — le laisser vide = LLM qui part de zéro.
  let scenarioMissing = $derived(!scenarioType);
  let effectiveDisabled = $derived(disabled || scenarioMissing);

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

  function draftNext() {
    if (disabled) return;
    const consigne = text.trim() || null;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
    onDraftNext?.({ consigne });
  }

  function applyStarter(/** @type {string} */ template) {
    if (effectiveDisabled) return;
    text = template;
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      autoResize();
    });
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

<div class="composer" class:composer-locked={scenarioMissing}>
  {#if scenarioMissing}
    <div class="scenario-gate mono" role="status">
      → Choisis un scénario (haut de la page) avant d'écrire — le draft en dépend.
    </div>
  {:else if target}
    <div class="char-counter mono" data-state={countState} aria-live="polite">
      <span class="count">{chars}</span>
      <span class="sep"> · </span>
      <span class="target">cible {target.min}–{target.max}</span>
    </div>
  {/if}

  {#if !scenarioMissing && starters.length > 0 && text.length === 0}
    <div class="starters" role="group" aria-label="Amorces de consigne">
      {#each starters as s (s.label)}
        <button
          type="button"
          class="starter-chip mono"
          onclick={() => applyStarter(s.template)}
          disabled={effectiveDisabled}
          title={s.template}
        >
          {s.label}
        </button>
      {/each}
    </div>
  {/if}

  <textarea
    bind:this={textareaEl}
    bind:value={text}
    oninput={autoResize}
    onkeydown={handleKeydown}
    placeholder={scenarioMissing
      ? "Sélectionne un scénario pour débloquer le composer"
      : "Colle la réponse du prospect ou tape une consigne (Cmd+Enter = draft la suite)"}
    rows="2"
    disabled={effectiveDisabled}
  ></textarea>

  <div class="actions">
    <button class="btn-primary" type="button" onclick={draftNext} disabled={effectiveDisabled} title="Génère un clone_draft (textarea = consigne optionnelle). Cmd+Enter">
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

  .composer-locked textarea { background: var(--paper-subtle, #f6f5f1); }
  .scenario-gate {
    font-size: 11px;
    color: var(--vermillon);
    padding: 2px 0;
  }

  .starters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 4px;
  }
  .starter-chip {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px solid var(--rule);
    color: var(--ink);
    cursor: pointer;
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease),
      background var(--dur-fast, 120ms) var(--ease, ease);
  }
  .starter-chip:hover:not(:disabled) {
    border-color: var(--vermillon);
    background: var(--paper, #fff);
  }
  .starter-chip:disabled { opacity: 0.5; cursor: not-allowed; }

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
  .btn-primary {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid var(--vermillon);
    background: var(--vermillon);
    color: var(--paper);
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
