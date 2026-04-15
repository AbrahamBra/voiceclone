<script>
  import { fly } from "svelte/transition";
  import { api } from "$lib/api.js";
  import { authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let { onclose, onanalyzed } = $props();

  let url = $state("");
  let status = $state("");
  let statusError = $state(false);
  let submitting = $state(false);

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose();
  }

  function isValidLinkedIn(u) {
    return /linkedin\.com\/in\/[^/?#]+/.test(u);
  }

  async function analyze() {
    if (!url.trim() || submitting) return;

    if (!isValidLinkedIn(url.trim())) {
      status = "URL invalide. Format : linkedin.com/in/username";
      statusError = true;
      return;
    }

    submitting = true;
    statusError = false;
    status = "Recuperation du profil et des posts...";

    try {
      const resp = await fetch("/api/scrape", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ linkedin_url: url.trim() }),
      });

      if (resp.status === 501) {
        status = "Analyse non disponible (scraping non configure)";
        submitting = false;
        return;
      }
      if (!resp.ok) {
        const err = await resp.json();
        status = err.error || "Erreur d'analyse";
        statusError = true;
        submitting = false;
        return;
      }

      const data = await resp.json();
      const profile = data.profile;
      const posts = data.posts.slice(0, 3);

      let postSection = "";
      if (posts.length > 0) {
        const freq =
          data.postCount >= 10
            ? "actif (10+ posts)"
            : data.postCount >= 5
              ? "regulier (5-10 posts)"
              : data.postCount >= 2
                ? "occasionnel (2-4 posts)"
                : "rare (1 post)";
        postSection =
          "SUJETS DU MOMENT (priorite pour l'opening) :\n" +
          "Frequence de publication : " + freq + "\n" +
          "3 derniers posts :\n" +
          posts.map((p, i) => (i + 1) + ". " + p.slice(0, 250)).join("\n\n");
      }

      const leadMsg = [
        "[Contexte lead \u2014 " + profile.name + "]",
        postSection,
        "PROFIL :\nTitre: " + profile.headline + "\n" + profile.text.slice(0, 500),
        "Aide-moi a preparer une approche personnalisee pour ce prospect. Utilise ses sujets recents comme angle d'ouverture.",
      ]
        .filter(Boolean)
        .join("\n\n");

      onclose();
      onanalyzed(leadMsg);
    } catch {
      status = "Erreur de connexion";
      statusError = true;
      submitting = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleBackdrop} transition:fly={{ y: 0, duration: 150 }}>
  <div class="modal">
    <h3>Analyser un prospect</h3>
    <p class="hint">Collez un lien LinkedIn pour generer un contexte de prospection.</p>
    <input
      type="text"
      bind:value={url}
      placeholder="https://linkedin.com/in/username"
    />
    {#if status}
      <p class="status" class:status-error={statusError}>{status}</p>
    {/if}
    <div class="actions">
      <button class="btn-cancel" onclick={onclose}>Annuler</button>
      <button class="btn-submit" disabled={submitting} onclick={analyze}>
        {submitting ? "Analyse en cours..." : "Analyser"}
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

  input {
    width: 100%;
    padding: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.85rem;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .status {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0.5rem 0 0;
  }

  .status-error {
    color: var(--warning, #e5a249);
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
</style>
