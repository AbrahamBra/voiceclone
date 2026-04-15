<script>
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { fly } from "svelte/transition";

  let step = $state(1);
  let direction = $state(1); // 1 = forward, -1 = back

  // Step 1
  let linkedinUrl = $state("");
  let scraping = $state(false);
  let scrapeStatus = $state("");
  let scrapeSuccess = $state(false);
  let scrapePreview = $state(null);

  // Step 2
  let profileText = $state("");
  let postsText = $state("");
  let docsText = $state("");
  let showDocs = $state(false);
  let fileTags = $state([]);
  let fileInputEl;

  // Text blocks
  let docBlocks = $state([]); // [{ title, content }]
  let currentDocTitle = $state("");
  let currentDocContent = $state("");

  function addDocBlock() {
    const content = currentDocContent.trim();
    if (!content) return;
    const title = currentDocTitle.trim() || `Texte ${docBlocks.length + 1}`;
    docBlocks = [...docBlocks, { title, content }];
    docsText = docBlocks.map(b => `## ${b.title}\n\n${b.content}`).join("\n\n---\n\n");
    currentDocTitle = "";
    currentDocContent = "";
  }

  function removeDocBlock(i) {
    docBlocks = docBlocks.filter((_, idx) => idx !== i);
    docsText = docBlocks.map(b => `## ${b.title}\n\n${b.content}`).join("\n\n---\n\n");
  }

  // Step 3
  let generating = $state(false);
  let generateStatus = $state("");

  // --- Step 1: Scrape ---
  async function scrapeLinkedIn() {
    const url = linkedinUrl.trim();
    if (!url) return;

    scraping = true;
    scrapeStatus = "Recuperation du profil et des posts...";
    scrapeSuccess = false;
    scrapePreview = null;

    try {
      const data = await api("/api/scrape", {
        method: "POST",
        body: JSON.stringify({ linkedin_url: url }),
      });

      profileText = data.profile.text;
      if (data.posts.length > 0) {
        postsText = data.posts.slice(0, 15).join("\n---\n");
      }

      scrapePreview = {
        name: data.profile.name,
        headline: data.profile.headline || "",
        postCount: data.postCount,
      };
      scrapeStatus = `${data.profile.name} — profil + ${data.postCount} posts recuperes`;
      scrapeSuccess = true;

      setTimeout(() => { goToStep(2); }, 1000);
    } catch (err) {
      if (err.status === 501) {
        scrapeStatus = "Scraping non disponible. Remplissez manuellement.";
      } else {
        scrapeStatus = err.data?.error || err.message || "Erreur de scraping";
      }
    } finally {
      scraping = false;
    }
  }

  // --- Step 2: File handling ---
  async function handleFiles(e) {
    const files = Array.from(e.target.files);

    for (const file of files) {
      const ext = file.name.split(".").pop().toLowerCase();
      let text = "";

      try {
        if (ext === "txt" || ext === "csv") {
          text = await file.text();
        } else if (ext === "pdf") {
          text = await extractPdfText(file);
        } else if (ext === "docx") {
          text = await extractDocxText(file);
        } else {
          continue;
        }

        if (text.trim()) {
          fileTags = [...fileTags, { name: file.name, chars: (text.length / 1000).toFixed(1) }];
          docsText += (docsText ? "\n\n--- " + file.name + " ---\n\n" : "") + text.trim();
        }
      } catch {
        fileTags = [...fileTags, { name: file.name, error: true }];
      }
    }
    e.target.value = "";
  }

  async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    if (window.pdfjsLib) {
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(" ") + "\n";
      }
      return text;
    }
    return new TextDecoder().decode(arrayBuffer);
  }

  async function extractDocxText(file) {
    const arrayBuffer = await file.arrayBuffer();
    try {
      const blob = new Blob([arrayBuffer]);
      const text = await blob.text();
      return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }

  // --- Step 3: Generate ---
  async function createClone() {
    const linkedin = profileText.trim();
    const postsRaw = postsText.trim();
    const docs = docsText.trim();

    if (linkedin.length < 50) {
      showToast("Profil LinkedIn trop court (min 50 caracteres)");
      return;
    }
    const posts = postsRaw.split(/\n---\n/).map(p => p.trim()).filter(p => p.length > 30);
    if (posts.length < 3) {
      showToast("Minimum 3 posts (separes par ---)");
      return;
    }

    generating = true;
    generateStatus = "Analyse du style en cours, ca prend 20-30 secondes...";

    try {
      const data = await api("/api/clone", {
        method: "POST",
        body: JSON.stringify({ linkedin_text: linkedin, posts, documents: docs || undefined }),
      });

      generateStatus = `Clone "${data.persona.name}" cree avec succes !`;
      setTimeout(() => {
        goto(`/calibrate/${data.persona.id}`);
      }, 1000);
    } catch (err) {
      if (err.status === 402) {
        generateStatus = "Budget depasse. Ajoutez votre cle API dans les parametres.";
      } else if (err.status === 403) {
        generateStatus = err.data?.error || "Limite de clones atteinte";
      } else {
        generateStatus = "Erreur: " + (err.message || "Server error");
      }
      generating = false;
    }
  }

  // --- Navigation ---
  function goToStep(n) {
    direction = n > step ? 1 : -1;
    step = n;
  }
</script>

<div class="create-page">
  <div class="create-container">
    <h2>Creer un clone</h2>
    <p class="create-subtitle">Importez un profil LinkedIn ou remplissez manuellement</p>

    {#key step}
      <div
        class="create-step-wrap"
        in:fly={{ x: 100 * direction, duration: 250 }}
        out:fly={{ x: -100 * direction, duration: 200 }}
      >
        {#if step === 1}
          <!-- Step 1: Source -->
          <div class="create-step">
            <label>URL LinkedIn</label>
            <div class="scrape-row">
              <input
                type="text"
                placeholder="Coller une URL LinkedIn"
                bind:value={linkedinUrl}
                disabled={scraping}
              />
              <button
                class="btn-secondary"
                onclick={scrapeLinkedIn}
                disabled={scraping || !linkedinUrl.trim()}
              >
                {scraping ? "Scraping..." : "Scraper"}
              </button>
            </div>

            {#if scrapeStatus}
              <div class="scrape-status" class:scrape-status-success={scrapeSuccess}>
                {scrapeStatus}
              </div>
            {/if}

            {#if scrapePreview}
              <div class="scrape-preview">
                <strong>{scrapePreview.name}</strong>
                {#if scrapePreview.headline}
                  <span class="scrape-preview-headline">{scrapePreview.headline}</span>
                {/if}
                <span class="scrape-preview-posts">{scrapePreview.postCount} posts</span>
              </div>
            {/if}

            <div class="create-divider">ou</div>

            <button class="btn-link" onclick={() => goToStep(2)}>
              Remplir manuellement
            </button>
          </div>

        {:else if step === 2}
          <!-- Step 2: Review & Enrich -->
          <div class="create-step">
            <div class="step-indicator">Etape 2/3</div>

            <label>Profil LinkedIn</label>
            <textarea rows="5" bind:value={profileText} placeholder="Bio, headline, experience..."></textarea>

            <label>Posts (separes par ---)</label>
            <textarea rows="8" bind:value={postsText} placeholder="Post 1&#10;---&#10;Post 2&#10;---&#10;Post 3"></textarea>

            <button class="btn-link" onclick={() => showDocs = !showDocs}>
              {showDocs ? "Masquer" : "Ajouter des documents"}
            </button>

            {#if showDocs}
              <div class="file-upload-zone">
                <label>Documents supplementaires</label>
                <button class="file-upload-btn" onclick={() => fileInputEl.click()}>
                  + Ajouter des fichiers (.txt, .pdf, .docx)
                </button>
                <input
                  type="file"
                  accept=".txt,.csv,.pdf,.docx"
                  multiple
                  hidden
                  bind:this={fileInputEl}
                  onchange={handleFiles}
                />
                {#if fileTags.length > 0 || docBlocks.length > 0}
                  <div class="file-list">
                    {#each fileTags as tag}
                      <div class="file-tag" class:file-tag-error={tag.error}>
                        {tag.error ? `${tag.name} — erreur` : `${tag.name} (${tag.chars}k)`}
                      </div>
                    {/each}
                    {#each docBlocks as block, i}
                      <div class="file-tag doc-block-tag">
                        {block.title}
                        <button class="doc-block-remove" onclick={() => removeDocBlock(i)}>×</button>
                      </div>
                    {/each}
                  </div>
                {/if}
                <input
                  type="text"
                  placeholder="Titre du texte (ex: Offre, Bio, Méthode...)"
                  bind:value={currentDocTitle}
                />
                <textarea rows="4" bind:value={currentDocContent} placeholder="Collez votre texte ici..."></textarea>
                <button
                  class="btn-add-block"
                  onclick={addDocBlock}
                  disabled={!currentDocContent.trim()}
                >
                  + Valider et ajouter ce texte
                </button>
              </div>
            {/if}

            <div class="create-actions">
              <button class="btn-secondary" onclick={() => goToStep(1)}>Retour</button>
              <button onclick={() => goToStep(3)}>Suivant</button>
            </div>
          </div>

        {:else if step === 3}
          <!-- Step 3: Generate -->
          <div class="create-step">
            <div class="step-indicator">Etape 3/3</div>

            <p class="generate-summary">
              Profil: {profileText.trim().length} caracteres
              &middot;
              Posts: {postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length}
              {#if docsText.trim()}
                &middot; Documents: {(docsText.trim().length / 1000).toFixed(1)}k chars
              {/if}
            </p>

            <button
              class="generate-btn"
              onclick={createClone}
              disabled={generating}
            >
              {generating ? "Generation en cours..." : "Generer le clone"}
            </button>

            {#if generateStatus}
              <div class="generate-status">{generateStatus}</div>
            {/if}

            <div class="create-actions">
              <button class="btn-secondary" onclick={() => goToStep(2)} disabled={generating}>Retour</button>
            </div>
          </div>
        {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  .create-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
  }

  .create-container {
    max-width: 520px;
    width: 100%;
  }

  .create-container h2 {
    font-size: 1.125rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    margin-bottom: 0.125rem;
  }

  .create-subtitle {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-bottom: 0.5rem;
  }

  .create-step-wrap {
    position: relative;
  }

  .create-step {
    margin-top: 1.25rem;
  }

  .create-step label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-bottom: 0.375rem;
    font-weight: 500;
  }

  .create-step textarea,
  .create-step input[type="text"] {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: var(--font);
    resize: vertical;
    outline: none;
    line-height: 1.5;
    transition: border-color 0.15s;
    margin-bottom: 0.75rem;
  }

  .create-step textarea:focus {
    border-color: var(--text-tertiary);
  }

  .scrape-row {
    display: flex;
    gap: 0.375rem;
  }

  .scrape-row input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s;
  }

  .scrape-row input:focus {
    border-color: var(--text-tertiary);
  }

  .scrape-row input::placeholder {
    color: var(--text-tertiary);
  }

  .btn-secondary {
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.75rem;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .btn-secondary:hover {
    border-color: var(--text-secondary);
    color: var(--text);
  }

  .scrape-status {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-top: 0.375rem;
  }

  .scrape-status-success {
    color: var(--success);
  }

  .scrape-preview {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .scrape-preview strong {
    font-size: 0.8125rem;
  }

  .scrape-preview-headline {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .scrape-preview-posts {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
  }

  .create-divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.25rem 0 0.25rem;
    color: var(--text-tertiary);
    font-size: 0.6875rem;
  }

  .create-divider::before,
  .create-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .btn-link {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.25rem 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .btn-link:hover {
    color: var(--text-secondary);
  }

  .step-indicator {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-bottom: 0.75rem;
    font-weight: 500;
  }

  .file-upload-zone {
    margin-bottom: 0.5rem;
  }

  .file-upload-btn {
    width: 100%;
    padding: 0.5rem;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-tertiary);
    font-size: 0.75rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    margin-bottom: 0.5rem;
  }

  .file-upload-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-secondary);
  }

  .file-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.375rem;
    margin-bottom: 0.5rem;
  }

  .file-tag {
    padding: 0.125rem 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
  }

  .file-tag-error {
    border-color: var(--error);
    color: var(--error);
  }

  .doc-block-tag {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .doc-block-remove {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0;
    line-height: 1;
  }

  .doc-block-remove:hover {
    color: var(--text);
  }

  .btn-add-block {
    width: 100%;
    padding: 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    margin-top: 0.375rem;
  }

  .btn-add-block:hover:not(:disabled) {
    border-color: var(--text-secondary);
    color: var(--text);
  }

  .btn-add-block:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .create-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }

  .generate-btn {
    margin-top: 1rem;
    width: 100%;
    padding: 0.625rem;
  }

  .generate-summary {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }

  .generate-status {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  @media (max-width: 640px) {
    .create-container {
      padding: 1.5rem;
    }
  }

  @media (max-width: 480px) {
    .create-page { padding: 1rem; }
    .create-container { padding: 1rem; }
    .scrape-row { flex-direction: column; }
    .scrape-row input { margin-bottom: 0; }
  }
</style>
