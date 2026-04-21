<script>
  // Lead scraping as a side panel (replaces LeadModal).
  // Same flow: paste a LinkedIn URL, scrape profile + posts, format into a
  // lead-context message, and dispatch onAnalyzed(msg) for the chat to send.

  import { authHeaders } from "$lib/api.js";
  import SidePanel from "./SidePanel.svelte";

  let { open = false, initialUrl = "", onClose, onAnalyzed } = $props();

  let url = $state("");
  let status = $state("");
  let statusError = $state(false);
  let submitting = $state(false);

  // Reset state when re-opening. If initialUrl is provided, pre-fill and
  // auto-trigger analyze (used by the composer's paste-detection banner).
  $effect(() => {
    if (open) {
      url = initialUrl || "";
      status = "";
      statusError = false;
      submitting = false;
      if (initialUrl) {
        // Defer so the panel renders before fetch starts.
        queueMicrotask(() => { if (open && url === initialUrl) analyze(); });
      }
    }
  });

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
    status = "Récupération du profil et des posts…";

    try {
      const resp = await fetch("/api/scrape", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ linkedin_url: url.trim() }),
      });

      if (resp.status === 501) {
        status = "Analyse non disponible (scraping non configuré)";
        statusError = true;
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
          data.postCount >= 10 ? "actif (10+ posts)"
          : data.postCount >= 5 ? "regulier (5-10 posts)"
          : data.postCount >= 2 ? "occasionnel (2-4 posts)"
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
        "CONSIGNE : Reponds dans ce format exact :\n\n" +
        "MESSAGE A ENVOYER :\n[Le message d'approche pret a copier/coller, en plusieurs messages courts style WhatsApp]\n\n" +
        "POURQUOI CETTE APPROCHE :\n[2-3 lignes max expliquant l'angle choisi et pourquoi il devrait accrocher ce prospect]\n\n" +
        "Utilise ses sujets recents comme angle d'ouverture.",
      ].filter(Boolean).join("\n\n");

      onClose?.();
      onAnalyzed?.(leadMsg);
    } catch {
      status = "Erreur de connexion";
      statusError = true;
      submitting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === "Enter" && url.trim() && !submitting) {
      e.preventDefault();
      analyze();
    }
  }
</script>

<SidePanel {open} title="Brief prospect" width={380} {onClose}>
  <section class="block">
    <p class="hint">
      Colle un lien LinkedIn. Le pipeline récupère le profil + 3 derniers posts
      et forge un contexte d'approche prêt à envoyer.
    </p>
  </section>

  <section class="block">
    <label class="field-label mono" for="lead-url">LinkedIn URL</label>
    <input
      id="lead-url"
      type="text"
      bind:value={url}
      placeholder="https://linkedin.com/in/username"
      spellcheck="false"
      autocomplete="off"
      disabled={submitting}
      onkeydown={handleKeydown}
    />
    {#if status}
      <p class="status mono" class:status-error={statusError}>{status}</p>
    {/if}
  </section>

  <section class="actions">
    <button class="btn-ghost mono" onclick={() => onClose?.()} disabled={submitting}>Annuler</button>
    <button class="btn-solid mono" disabled={submitting || !url.trim()} onclick={analyze}>
      {submitting ? "Analyse…" : "Analyser"}
    </button>
  </section>
</SidePanel>

<style>
  .block {
    padding: 10px 0 12px;
    border-bottom: 1px dashed var(--rule);
  }
  .block:first-child { padding-top: 0; }
  .block:last-of-type { border-bottom: 0; }

  .hint {
    font-size: var(--fs-small);
    color: var(--ink-70);
    line-height: var(--lh-normal);
    margin: 0;
  }

  .field-label {
    display: block;
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 6px;
  }

  input {
    width: 100%;
    padding: 8px 10px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease);
  }
  input:focus { border-color: var(--vermillon); }
  input:disabled { opacity: 0.6; cursor: wait; }
  input::placeholder { color: var(--ink-20); }

  .status {
    margin: 8px 0 0;
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .status-error { color: var(--vermillon); }

  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    padding-top: 12px;
    margin-top: 6px;
    border-top: 1px solid var(--rule-strong);
  }
  .btn-ghost, .btn-solid {
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease);
  }
  .btn-ghost { background: transparent; color: var(--ink-70); }
  .btn-ghost:hover:not(:disabled) { color: var(--ink); border-color: var(--ink-40); }
  .btn-solid { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn-solid:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .btn-solid:disabled, .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
