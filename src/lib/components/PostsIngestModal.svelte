<script>
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let { personaId, onClose, onSuccess } = $props();

  let postsText = $state("");
  let submitting = $state(false);

  async function submit() {
    if (!postsText.trim()) return;
    submitting = true;
    try {
      const result = await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ personaId, content: postsText.trim(), source_type: "linkedin_post" }),
      });
      showToast(`${result.chunk_count} posts indexes`);
      postsText = "";
      onSuccess?.();
      onClose?.();
    } catch {
      showToast("Erreur lors de l'indexation");
    } finally {
      submitting = false;
    }
  }
</script>

<div class="posts-modal-backdrop" onclick={onClose}>
  <div class="posts-modal" onclick={(e) => e.stopPropagation()}>
    <h4>Posts LinkedIn de reference</h4>
    <p class="posts-modal-hint">Collez les posts LinkedIn originaux, separes par --- sur une ligne seule.</p>
    <textarea
      class="posts-modal-textarea"
      bind:value={postsText}
      placeholder={"Premier post ici...\n\n---\n\nDeuxieme post ici...\n\n---\n\nTroisieme post..."}
      rows="12"
    ></textarea>
    <div class="posts-modal-actions">
      <button class="posts-modal-cancel" onclick={onClose}>Annuler</button>
      <button class="posts-modal-submit" onclick={submit} disabled={submitting || !postsText.trim()}>
        {submitting ? "Indexation..." : "Indexer les posts"}
      </button>
    </div>
  </div>
</div>

<style>
  .posts-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 26, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 40);
  }
  .posts-modal {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    padding: 16px 18px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    font-family: var(--font-ui);
    box-shadow: 0 12px 40px rgba(20, 20, 26, 0.12);
  }
  .posts-modal h4 {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
    color: var(--text);
  }
  .posts-modal-hint {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin: 0 0 0.75rem;
  }
  .posts-modal-textarea {
    width: 100%;
    background: var(--paper-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0.625rem;
    resize: vertical;
    min-height: 150px;
  }
  .posts-modal-textarea:focus { outline: none; border-color: var(--accent); }
  .posts-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .posts-modal-cancel, .posts-modal-submit {
    padding: 7px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .posts-modal-cancel {
    background: transparent;
    color: var(--ink-70);
  }
  .posts-modal-cancel:hover { color: var(--ink); border-color: var(--ink-40); }
  .posts-modal-submit {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .posts-modal-submit:hover:not(:disabled) {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .posts-modal-submit:disabled { opacity: 0.4; cursor: default; }
</style>
