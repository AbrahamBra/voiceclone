<script>
  // Bulle d'aperçu des règles extraites d'un post écrit à la main.
  // Chaque règle = ✓ valider (POST save_rule_direct) ou ✗ ignorer (local only).
  // Pas de persistance tant que l'user n'a pas validé — preview uniquement.
  import { fly } from "svelte/transition";

  let {
    rules = [],          // Array<{ text, rationale }>
    sourcePost = "",     // pour traçabilité dans /api/feedback save_rule_direct
    onValidate,          // (ruleText) => Promise<void>
    onDismiss,           // () => void — ferme la bulle
  } = $props();

  // Per-rule state machine: pending | saving | saved | ignored
  let states = $state(rules.map(() => "pending"));
  let bulkInProgress = $state(false);

  let pendingCount = $derived(states.filter(s => s === "pending").length);
  let savedCount = $derived(states.filter(s => s === "saved").length);

  async function validateOne(idx) {
    if (states[idx] !== "pending") return;
    states[idx] = "saving";
    try {
      await onValidate?.(rules[idx].text);
      states[idx] = "saved";
    } catch {
      states[idx] = "pending"; // rollback on error
    }
  }

  function ignoreOne(idx) {
    if (states[idx] !== "pending") return;
    states[idx] = "ignored";
  }

  async function validateAll() {
    bulkInProgress = true;
    for (let i = 0; i < rules.length; i++) {
      if (states[i] === "pending") {
        await validateOne(i);
      }
    }
    bulkInProgress = false;
  }

  function dismissAll() {
    // Marque toutes les pending comme ignorées, puis ferme la bulle.
    states = states.map(s => s === "pending" ? "ignored" : s);
    onDismiss?.();
  }
</script>

<article class="ingest-bubble" transition:fly={{ y: 4, duration: 120 }}>
  <header class="ingest-header mono">
    📝 Post analysé — {rules.length} règle{rules.length > 1 ? "s" : ""} candidate{rules.length > 1 ? "s" : ""}
    {#if savedCount > 0}
      <span class="ingest-saved">· {savedCount} sauvée{savedCount > 1 ? "s" : ""}</span>
    {/if}
  </header>

  {#if rules.length === 0}
    <p class="ingest-empty mono">
      Rien d'actionnable à extraire de ce post. Trop court ou trop générique ?
    </p>
  {:else}
    <ul class="ingest-rules">
      {#each rules as rule, idx (idx)}
        <li class="ingest-rule" data-state={states[idx]}>
          <div class="ingest-rule-body">
            <div class="ingest-rule-text">{rule.text}</div>
            {#if rule.rationale}
              <div class="ingest-rule-rationale mono">→ {rule.rationale}</div>
            {/if}
          </div>
          <div class="ingest-rule-actions">
            {#if states[idx] === "pending"}
              <button
                type="button"
                class="ingest-btn ingest-btn-validate"
                onclick={() => validateOne(idx)}
                disabled={bulkInProgress}
                title="Ajouter au cerveau"
              >✓ valider</button>
              <button
                type="button"
                class="ingest-btn ingest-btn-ignore"
                onclick={() => ignoreOne(idx)}
                disabled={bulkInProgress}
                title="Ne pas ingérer"
              >✗ ignorer</button>
            {:else if states[idx] === "saving"}
              <span class="ingest-status mono">…</span>
            {:else if states[idx] === "saved"}
              <span class="ingest-status ingest-status-saved mono">✓ dans le cerveau</span>
            {:else if states[idx] === "ignored"}
              <span class="ingest-status ingest-status-ignored mono">ignorée</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <footer class="ingest-footer">
    {#if pendingCount > 0}
      <button
        type="button"
        class="ingest-btn ingest-btn-validate"
        onclick={validateAll}
        disabled={bulkInProgress}
      >
        ✓ tout valider ({pendingCount})
      </button>
    {/if}
    <button
      type="button"
      class="ingest-btn ingest-btn-dismiss"
      onclick={dismissAll}
      disabled={bulkInProgress}
    >
      {pendingCount > 0 ? "rien de plus" : "fermer"}
    </button>
  </footer>
</article>

<style>
  .ingest-bubble {
    align-self: flex-start;
    max-width: 720px;
    margin: 12px 0;
    padding: 12px 14px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle, #f6f5f1);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ingest-header {
    font-size: 11px;
    color: var(--ink-70);
    letter-spacing: 0.02em;
  }
  .ingest-saved { color: var(--success, #2a7f4e); margin-left: 4px; }

  .ingest-empty {
    font-size: 12px;
    color: var(--ink-40);
    margin: 0;
  }

  .ingest-rules {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ingest-rule {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    background: var(--paper);
  }
  .ingest-rule[data-state="ignored"] { opacity: 0.45; }
  .ingest-rule[data-state="saved"] { border-color: var(--success, #2a7f4e); }

  .ingest-rule-body { flex: 1; min-width: 0; }
  .ingest-rule-text {
    font-size: 13px;
    color: var(--ink);
    line-height: 1.4;
  }
  .ingest-rule-rationale {
    margin-top: 4px;
    font-size: 10.5px;
    color: var(--ink-40);
    font-style: italic;
  }

  .ingest-rule-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }

  .ingest-btn {
    font-family: var(--font-mono);
    font-size: 10.5px;
    padding: 4px 10px;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink-70);
    white-space: nowrap;
  }
  .ingest-btn:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
  .ingest-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .ingest-btn-validate { border-color: var(--ink); background: var(--ink); color: var(--paper); }
  .ingest-btn-validate:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }

  .ingest-btn-ignore:hover:not(:disabled) { border-color: var(--ink-40); }

  .ingest-btn-dismiss {
    border: none;
    background: transparent;
    color: var(--ink-40);
  }
  .ingest-btn-dismiss:hover:not(:disabled) { color: var(--ink); background: transparent; }

  .ingest-status {
    font-size: 10.5px;
    color: var(--ink-40);
    padding: 4px 0;
  }
  .ingest-status-saved { color: var(--success, #2a7f4e); }
  .ingest-status-ignored { color: var(--ink-40); text-decoration: line-through; }

  .ingest-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
    border-top: 1px dashed var(--rule);
    margin-top: 2px;
  }
</style>
