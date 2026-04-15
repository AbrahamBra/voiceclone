<script>
  import { fly } from "svelte/transition";
  import { api } from "$lib/api.js";
  import { currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { get } from "svelte/store";

  let { botMessage, onclose, onreplace } = $props();

  let correction = $state("");
  let submitting = $state(false);
  let alternatives = $state(null); // null = not generated, [] = generating, [...] = ready
  let picking = $state(false);

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose();
  }

  async function submit() {
    if (!correction.trim() || submitting) return;
    submitting = true;
    alternatives = []; // show loading

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

      if (resp.alternatives?.length > 0) {
        alternatives = resp.alternatives;
      } else {
        // Fallback: no alternatives generated, just save correction
        await saveCorrectionOnly();
      }
    } catch {
      // Fallback: just save the correction
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
      showToast("Clone ameliore ;)");
      if (onreplace) onreplace(alt);
      onclose();
    } catch {
      showToast("Erreur — correction enregistree quand meme");
      onclose();
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
      showToast("Correction enregistree ;)");
      onclose();
    } catch {
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleBackdrop} transition:fly={{ y: 0, duration: 150 }}>
  <div class="modal">
    {#if alternatives === null}
      <!-- Step 1: Enter correction -->
      <h3>Corriger cette reponse</h3>
      <p class="hint">Decris ce qui ne va pas. Le clone va proposer 2 alternatives.</p>
      <textarea
        bind:value={correction}
        placeholder="Ex: Trop formel, pas assez direct..."
        rows="3"
      ></textarea>
      <div class="actions">
        <button class="btn-cancel" onclick={onclose}>Annuler</button>
        <button class="btn-submit" disabled={submitting} onclick={submit}>
          {submitting ? "Generation..." : "Corriger"}
        </button>
      </div>
    {:else if alternatives.length === 0}
      <!-- Loading alternatives -->
      <h3>Generation des alternatives...</h3>
      <p class="hint">Le clone prepare 2 versions corrigees.</p>
      <div class="loading">
        <span></span><span></span><span></span>
      </div>
    {:else}
      <!-- Step 2: Pick an alternative -->
      <h3>Choisis la meilleure version</h3>
      <p class="hint">Clique sur celle que tu preferes. Le clone apprendra.</p>
      {#each alternatives as alt, i}
        <button
          class="alt-card"
          class:picking
          onclick={() => pickAlternative(alt)}
          disabled={picking}
          transition:fly={{ y: 8, delay: i * 100, duration: 150 }}
        >
          <span class="alt-label">Option {i + 1}</span>
          <span class="alt-text">{alt}</span>
        </button>
      {/each}
      <div class="actions">
        <button class="btn-cancel" onclick={onclose}>Aucune — garder l'original</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
    max-width: 480px;
    width: 90%;
  }

  h3 {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    color: var(--text);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0 0 0.75rem;
  }

  textarea {
    width: 100%;
    padding: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
    resize: vertical;
    font-family: inherit;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .btn-cancel,
  .btn-submit {
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius);
    border: none;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .btn-cancel {
    background: transparent;
    color: var(--text-secondary);
  }

  .btn-cancel:hover {
    color: var(--text);
  }

  .btn-submit {
    background: var(--accent);
    color: #fff;
  }

  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alt-card {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    font-family: inherit;
    color: var(--text);
  }

  .alt-card:hover:not(:disabled) {
    border-color: var(--accent);
    background: #1f1f23;
  }

  .alt-card:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .alt-label {
    display: block;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-bottom: 0.25rem;
    font-weight: 500;
  }

  .alt-text {
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .loading {
    display: flex;
    gap: 4px;
    padding: 1rem 0;
    justify-content: center;
  }

  .loading span {
    width: 6px;
    height: 6px;
    background: var(--text-tertiary);
    border-radius: 50%;
    animation: pulse 1s infinite;
  }

  .loading span:nth-child(2) { animation-delay: 0.15s; }
  .loading span:nth-child(3) { animation-delay: 0.3s; }

  @keyframes pulse {
    0%, 60%, 100% { opacity: 0.25; }
    30% { opacity: 0.8; }
  }

  @media (max-width: 480px) {
    .modal { width: 95%; }
  }
</style>
