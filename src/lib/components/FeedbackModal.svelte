<script>
  import { fly } from "svelte/transition";
  import { api } from "$lib/api.js";
  import { currentPersonaId } from "$lib/stores/persona.js";
  import { showToast } from "$lib/stores/ui.js";
  import { get } from "svelte/store";

  let { botMessage, onclose } = $props();

  let correction = $state("");
  let submitting = $state(false);

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose();
  }

  async function submit() {
    if (!correction.trim() || submitting) return;
    submitting = true;
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
      submitting = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleBackdrop} transition:fly={{ y: 0, duration: 150 }}>
  <div class="modal">
    <h3>Corriger cette reponse</h3>
    <p class="hint">Le clone apprendra de cette correction.</p>
    <textarea
      bind:value={correction}
      placeholder="Ex: Trop formel, pas assez direct..."
      rows="3"
    ></textarea>
    <div class="actions">
      <button class="btn-cancel" onclick={onclose}>Annuler</button>
      <button class="btn-submit" disabled={submitting} onclick={submit}>
        {submitting ? "Envoi..." : "Envoyer"}
      </button>
    </div>
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
    max-width: 400px;
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

  @media (max-width: 480px) {
    .modal { width: 95%; }
  }
</style>
