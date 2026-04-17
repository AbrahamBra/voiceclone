<script>
  // Feedback as a right-side panel (replaces FeedbackModal).
  // Same pipeline: describe the correction → generate alternatives → pick one.
  // The chat remains visible and interactive underneath.

  import { fly } from "svelte/transition";
  import { api } from "$lib/api.js";
  import { currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { get } from "svelte/store";
  import SidePanel from "./SidePanel.svelte";

  let { open = false, botMessage = "", onClose, onReplace } = $props();

  let correction = $state("");
  let submitting = $state(false);
  let alternatives = $state(null); // null | [] (loading) | [alts]
  let picking = $state(false);

  // Reset state when re-opening for a different message
  $effect(() => {
    if (open) {
      correction = "";
      alternatives = null;
      picking = false;
      submitting = false;
    }
  });

  async function submit() {
    if (!correction.trim() || submitting) return;
    submitting = true;
    alternatives = [];
    try {
      const resp = await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "regenerate",
          correction: correction.trim(),
          botMessage,
          persona: get(currentPersonaId),
        }),
      });
      if (resp.alternatives?.length > 0) alternatives = resp.alternatives;
      else await saveCorrectionOnly();
    } catch {
      await saveCorrectionOnly();
    }
    submitting = false;
  }

  async function pickAlternative(alt) {
    picking = true;
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "accept",
          correction: correction.trim(),
          accepted: alt,
          botMessage,
          persona: get(currentPersonaId),
        }),
      });
      showToast("Clone amélioré ;)");
      onReplace?.(alt);
      onClose?.();
    } catch {
      showToast("Erreur — correction enregistrée quand même");
      onClose?.();
    }
  }

  async function saveCorrectionOnly() {
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          correction: correction.trim(),
          botMessage,
          persona: get(currentPersonaId),
        }),
      });
      showToast("Correction enregistrée ;)");
      onClose?.();
    } catch {
      onClose?.();
    }
  }
</script>

<SidePanel {open} title="Feedback" width={420} {onClose}>
  {#if botMessage}
    <section class="target">
      <div class="target-label mono">message corrigé</div>
      <blockquote class="target-quote">{botMessage}</blockquote>
    </section>
  {/if}

  {#if alternatives === null}
    <section class="step">
      <label class="field-label mono" for="fb-correction">ce qui ne va pas</label>
      <textarea
        id="fb-correction"
        bind:value={correction}
        placeholder="Trop formel, pas assez direct…"
        rows="4"
      ></textarea>
      <p class="hint">Le clone générera 2 alternatives à partir de ta correction, tu choisiras la bonne.</p>
      <div class="actions">
        <button class="btn-ghost mono" onclick={() => onClose?.()}>Annuler</button>
        <button class="btn-solid mono" disabled={submitting || !correction.trim()} onclick={submit}>
          {submitting ? "Génération…" : "Corriger"}
        </button>
      </div>
    </section>
  {:else if alternatives.length === 0}
    <section class="step">
      <div class="loading" aria-label="Génération des alternatives">
        <span></span><span></span><span></span>
      </div>
      <p class="hint">Le clone prépare 2 versions corrigées…</p>
    </section>
  {:else}
    <section class="step">
      <div class="field-label mono">choisis la meilleure</div>
      <p class="hint">Clique sur la version que tu préfères. Le clone apprendra.</p>
      {#each alternatives as alt, i}
        <button
          class="alt"
          class:picking
          onclick={() => pickAlternative(alt)}
          disabled={picking}
          transition:fly={{ y: 6, delay: i * 80, duration: 140 }}
        >
          <span class="alt-label mono">option 0{i + 1}</span>
          <span class="alt-text">{alt}</span>
        </button>
      {/each}
      <div class="actions">
        <button class="btn-ghost mono" onclick={() => onClose?.()}>Garder l'original</button>
      </div>
    </section>
  {/if}
</SidePanel>

<style>
  .target {
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px dashed var(--rule);
  }
  .target-label {
    font-size: 9.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 6px;
  }
  .target-quote {
    font-family: var(--font);
    font-size: 13px;
    color: var(--ink-70);
    line-height: 1.5;
    margin: 0;
    padding-left: 10px;
    border-left: 2px solid var(--rule-strong);
  }

  .step { display: flex; flex-direction: column; gap: 10px; }
  .field-label {
    font-size: 9.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  textarea {
    width: 100%;
    padding: 8px 10px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font);
    font-size: 13.5px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
    transition: border-color 0.08s linear;
  }
  textarea:focus { border-color: var(--vermillon); }

  .hint {
    font-size: 11.5px;
    color: var(--ink-40);
    line-height: 1.5;
  }

  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 8px;
  }
  .btn-ghost, .btn-solid {
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 11px;
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    transition: all 0.08s linear;
  }
  .btn-ghost { background: transparent; color: var(--ink-70); }
  .btn-ghost:hover { color: var(--ink); border-color: var(--ink-40); }
  .btn-solid { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn-solid:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .btn-solid:disabled { opacity: 0.4; cursor: not-allowed; }

  .alt {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    padding: 10px 12px;
    margin-bottom: 6px;
    cursor: pointer;
    font-family: var(--font);
    color: var(--ink);
    transition: border-color 0.08s linear, background 0.08s linear;
  }
  .alt:hover:not(:disabled) { border-color: var(--vermillon); }
  .alt:disabled { opacity: 0.5; cursor: wait; }
  .alt-label {
    display: block;
    font-size: 9.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 4px;
  }
  .alt-text { display: block; font-size: 13.5px; line-height: 1.5; }

  .loading {
    display: flex;
    gap: 5px;
    padding: 14px 0 4px;
  }
  .loading span {
    width: 6px; height: 6px;
    background: var(--ink-40);
    animation: dot 1s infinite linear;
  }
  .loading span:nth-child(2) { animation-delay: 0.15s; }
  .loading span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes dot {
    0%, 60%, 100% { background: var(--ink-40); }
    30% { background: var(--vermillon); }
  }
</style>
