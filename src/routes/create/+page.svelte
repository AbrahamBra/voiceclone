<script>
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { fly } from "svelte/transition";

  let cloneType = $state(null); // 'posts' | 'dm' | 'both'
  let step = $state('type');
  let direction = $state(1);

  const steps = $derived([
    'type',
    'info',
    ...(cloneType !== 'dm'    ? ['posts'] : []),
    ...(cloneType !== 'posts' ? ['dm']    : []),
    'docs',
  ]);
  const TOTAL = $derived(steps.length);

  // Step 1: Infos générales
  let linkedinUrl = $state("");
  let scraping = $state(false);
  let scrapeStatus = $state("");
  let scrapeSuccess = $state(false);
  let personaName = $state("");
  let personaTitle = $state("");
  let profileText = $state("");

  // Step 2: Posts LinkedIn
  let postsText = $state("");

  // Step 3: DMs LinkedIn
  let dmsText = $state("");

  // Step 4: Documents + Génération
  let docsText = $state("");
  let showDocs = $state(false);
  let fileTags = $state([]);
  let fileInputEl;
  let docBlocks = $state([]);
  let currentDocTitle = $state("");
  let currentDocContent = $state("");
  let generating = $state(false);
  let generateStatus = $state("");

  // --- Scrape ---
  async function scrapeLinkedIn() {
    const url = linkedinUrl.trim();
    if (!url) return;
    scraping = true;
    scrapeStatus = "Récupération du profil et des posts...";
    scrapeSuccess = false;
    try {
      const data = await api("/api/scrape", {
        method: "POST",
        body: JSON.stringify({ linkedin_url: url }),
      });
      personaName = data.profile.name || "";
      personaTitle = data.profile.headline || "";
      profileText = data.profile.text || "";
      if (data.posts.length > 0) {
        postsText = data.posts.slice(0, 15).join("\n---\n");
      }
      scrapeStatus = `${data.profile.name} — profil + ${data.postCount} posts récupérés`;
      scrapeSuccess = true;
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

  // --- Doc blocks ---
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

  // --- File handling ---
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
        } else { continue; }
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
    } catch { return ""; }
  }

  // --- Generate ---
  async function createClone() {
    const linkedin = [
      personaName.trim() && `Nom: ${personaName.trim()}`,
      personaTitle.trim() && `Titre: ${personaTitle.trim()}`,
      profileText.trim(),
    ].filter(Boolean).join("\n\n");

    const posts = postsText.trim().split(/\n---\n/).map(p => p.trim()).filter(p => p.length > 30);
    if (cloneType !== 'dm' && posts.length < 3) {
      showToast("Minimum 3 posts (séparés par ---)");
      return;
    }

    const dms = dmsText.trim()
      ? dmsText.trim().split(/\n---\n/).map(d => d.trim()).filter(d => d.length > 20)
      : [];

    generating = true;
    generateStatus = "Analyse du style en cours, ça prend 20-30 secondes...";

    try {
      const data = await api("/api/clone", {
        method: "POST",
        body: JSON.stringify({
          linkedin_text: linkedin,
          posts: cloneType !== 'dm' ? posts : undefined,
          dms: dms.length > 0 ? dms : undefined,
          documents: docsText.trim() || undefined,
          name: personaName.trim() || undefined,
          cloneType,
        }),
      });

      generateStatus = `Clone "${data.persona.name}" créé avec succès !`;
      setTimeout(() => { goto(`/calibrate/${data.persona.id}`); }, 1000);
    } catch (err) {
      if (err.status === 402) {
        generateStatus = "Budget dépassé. Ajoutez votre clé API dans les paramètres.";
      } else if (err.status === 403) {
        generateStatus = err.data?.error || "Limite de clones atteinte";
      } else {
        generateStatus = "Erreur: " + (err.message || "Server error");
      }
      generating = false;
    }
  }

  function setCloneType(value) {
    cloneType = value;
    if (value === 'dm')    postsText = '';
    if (value === 'posts') dmsText = '';
  }

  function nextStep() {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) {
      direction = 1;
      step = steps[idx + 1];
    }
  }

  function prevStep() {
    const idx = steps.indexOf(step);
    if (idx > 0) {
      direction = -1;
      step = steps[idx - 1];
    }
  }


</script>

<div class="create-page">
  <div class="create-container">
    <h2>Créer un clone</h2>
    <p class="create-subtitle">
      {#if step !== 'type'}Étape {steps.indexOf(step)}/{TOTAL - 1}{/if}
    </p>
    <div class="step-bar">
      {#each steps.slice(1) as s, i}
        <div class="step-bar-item" class:active={steps.indexOf(step) > i}></div>
      {/each}
    </div>

    {#key step}
      <div
        class="create-step-wrap"
        in:fly={{ x: 100 * direction, duration: 250 }}
        out:fly={{ x: -100 * direction, duration: 200 }}
      >
        {#if step === 'type'}
          <div class="create-step">
            <div class="step-header">
              <strong>Pourquoi créer ce clone ?</strong>
              <span>Le flow de création s'adapte selon ton choix.</span>
            </div>

            <div class="type-cards">
              <button
                class="type-card"
                class:type-card-selected={cloneType === 'posts'}
                onclick={() => setCloneType('posts')}
              >
                <span class="type-card-icon">✍️</span>
                <strong>Posts LinkedIn</strong>
                <span>Génère du contenu écrit, hooks, carrousels</span>
              </button>
              <button
                class="type-card"
                class:type-card-selected={cloneType === 'dm'}
                onclick={() => setCloneType('dm')}
              >
                <span class="type-card-icon">💬</span>
                <strong>DMs LinkedIn</strong>
                <span>Répond en prospection et qualification</span>
              </button>
              <button
                class="type-card"
                class:type-card-selected={cloneType === 'both'}
                onclick={() => setCloneType('both')}
              >
                <span class="type-card-icon">⚡</span>
                <strong>Les deux</strong>
                <span>Flow complet, 5 étapes</span>
              </button>
            </div>

            <div class="create-actions">
              <button onclick={nextStep} disabled={!cloneType}>
                Continuer →
              </button>
            </div>
          </div>

        {:else if step === 'info'}
          <!-- Step 1: Infos générales -->
          <div class="create-step">
            <div class="step-header">
              <strong>Informations générales</strong>
              <span>Qui est ce clone ?</span>
            </div>

            <div class="scrape-row">
              <input type="text" placeholder="URL LinkedIn (optionnel — auto-remplit tout)" bind:value={linkedinUrl} disabled={scraping} />
              <button class="btn-secondary" onclick={scrapeLinkedIn} disabled={scraping || !linkedinUrl.trim()}>
                {scraping ? "..." : "Auto-remplir"}
              </button>
            </div>
            {#if scrapeStatus}
              <div class="scrape-status" class:scrape-status-success={scrapeSuccess}>{scrapeStatus}</div>
            {/if}

            <label>Prénom</label>
            <input type="text" placeholder="Ex: Thomas" bind:value={personaName} />

            <label>Titre & entreprise</label>
            <input type="text" placeholder="Ex: CEO @Offbound · GTM LinkedIn" bind:value={personaTitle} />

            <label>Bio & positionnement</label>
            <textarea rows="4" bind:value={profileText} placeholder="Expertise, thèmes abordés, valeur ajoutée..."></textarea>

            <div class="create-actions">
              <button onclick={nextStep} disabled={!personaName.trim() && !profileText.trim()}>
                Suivant →
              </button>
            </div>
          </div>

        {:else if step === 'posts'}
          <!-- Step 2: Posts LinkedIn -->
          <div class="create-step">
            <div class="step-header">
              <strong>Posts LinkedIn de référence</strong>
              <span>Le style d'écriture public du clone</span>
            </div>
            <p class="step-desc">
              Copiez-collez les meilleurs posts. Séparez chaque post par <code>---</code> sur une ligne seule. Minimum 3 posts, idéalement 10-20.
            </p>

            <textarea rows="14" bind:value={postsText} placeholder="Premier post ici...&#10;---&#10;Deuxième post ici...&#10;---&#10;Troisième post ici..."></textarea>

            <div class="count-badge" class:count-ok={postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length >= 3}>
              {postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length} post(s) détecté(s)
              {#if postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length < 3}— minimum 3{/if}
            </div>

            <div class="create-actions">
              <button class="btn-secondary" onclick={prevStep}>← Retour</button>
              <button onclick={nextStep} disabled={postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length < 3}>
                Suivant →
              </button>
            </div>
          </div>

        {:else if step === 'dm'}
          <!-- Step 3: DMs LinkedIn -->
          <div class="create-step">
            <div class="step-header">
              <strong>DMs LinkedIn de référence</strong>
              <span>Le style de conversation 1:1 du clone</span>
            </div>
            <p class="step-desc">
              Copiez-collez des échanges DM réels. Séparez chaque conversation par <code>---</code>. Cette étape génère une intelligence séparée pour les scénarios de prospection et de qualification.
            </p>

            <textarea rows="14" bind:value={dmsText} placeholder="[Conversation 1]&#10;Prospect: Bonjour, j'ai vu votre post sur...&#10;Moi: Salut ! Oui exactement, ...&#10;---&#10;[Conversation 2]&#10;..."></textarea>

            {#if dmsText.trim()}
              <div class="count-badge count-ok">
                {dmsText.trim().split(/\n---\n/).filter(d => d.trim().length > 20).length} conversation(s) détectée(s)
              </div>
            {/if}

            <div class="create-actions">
              <button class="btn-secondary" onclick={prevStep}>← Retour</button>
              {#if cloneType === 'both'}
                <button class="btn-secondary" onclick={nextStep}>Passer</button>
              {/if}
              <button onclick={nextStep} disabled={cloneType === 'dm' && !dmsText.trim()}>Suivant →</button>
            </div>
          </div>

        {:else if step === 'docs'}
          <!-- Step 4: Documents + Génération -->
          <div class="create-step">
            <div class="step-header">
              <strong>Documents & Génération</strong>
              <span>Enrichissez la base de connaissances (optionnel)</span>
            </div>

            <button class="btn-link" onclick={() => showDocs = !showDocs}>
              {showDocs ? "Masquer les documents" : "+ Ajouter des documents (offre, méthode, bio longue...)"}
            </button>

            {#if showDocs}
              <div class="file-upload-zone">
                <button class="file-upload-btn" onclick={() => fileInputEl.click()}>
                  + Ajouter des fichiers (.txt, .pdf, .docx)
                </button>
                <input type="file" accept=".txt,.csv,.pdf,.docx" multiple hidden bind:this={fileInputEl} onchange={handleFiles} />
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
                <input type="text" placeholder="Titre du texte (ex: Offre, Méthode...)" bind:value={currentDocTitle} />
                <textarea rows="4" bind:value={currentDocContent} placeholder="Collez votre texte ici..."></textarea>
                <button class="btn-add-block" onclick={addDocBlock} disabled={!currentDocContent.trim()}>
                  + Valider et ajouter ce texte
                </button>
              </div>
            {/if}

            <div class="generate-recap">
              <div class="recap-item">
                <span class="recap-label">Infos</span>
                <span>{personaName || "—"}{personaTitle ? ` · ${personaTitle}` : ""}</span>
              </div>
              {#if cloneType !== 'dm'}
                <div class="recap-item">
                  <span class="recap-label">Posts</span>
                  <span>{postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length} posts</span>
                </div>
              {/if}
              {#if cloneType !== 'posts'}
                <div class="recap-item">
                  <span class="recap-label">DMs</span>
                  <span>{dmsText.trim() ? `${dmsText.trim().split(/\n---\n/).filter(d => d.trim().length > 20).length} conversations` : "non renseigné"}</span>
                </div>
              {/if}
              {#if docsText.trim()}
                <div class="recap-item">
                  <span class="recap-label">Docs</span>
                  <span>{(docsText.trim().length / 1000).toFixed(1)}k chars</span>
                </div>
              {/if}
            </div>

            <button class="generate-btn" onclick={createClone} disabled={generating}>
              {generating ? "Génération en cours..." : "Générer le clone"}
            </button>

            {#if generateStatus}
              <div class="generate-status">{generateStatus}</div>
            {/if}

            <div class="create-actions">
              <button class="btn-secondary" onclick={prevStep} disabled={generating}>← Retour</button>
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
    margin-bottom: 0.625rem;
  }

  .step-bar {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .step-bar-item {
    flex: 1;
    height: 2px;
    background: var(--border);
    border-radius: 2px;
    transition: background 0.2s;
  }

  .step-bar-item.active {
    background: var(--text-secondary);
  }

  .create-step-wrap {
    position: relative;
  }

  .create-step {
    margin-top: 1.25rem;
  }

  .step-header {
    margin-bottom: 1rem;
  }

  .step-header strong {
    display: block;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-bottom: 0.125rem;
  }

  .step-header span {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }

  .step-desc {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
    line-height: 1.5;
  }

  .step-desc code {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.05em 0.35em;
    font-size: 0.7rem;
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

  .create-step textarea:focus,
  .create-step input[type="text"]:focus {
    border-color: var(--text-tertiary);
  }

  .scrape-row {
    display: flex;
    gap: 0.375rem;
    margin-bottom: 0.375rem;
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

  .scrape-row input:focus { border-color: var(--text-tertiary); }
  .scrape-row input::placeholder { color: var(--text-tertiary); }

  .scrape-status {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-bottom: 0.75rem;
  }

  .scrape-status-success { color: var(--success); }

  .count-badge {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-top: -0.375rem;
    margin-bottom: 0.75rem;
  }

  .count-badge.count-ok { color: var(--success, #4ade80); }

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

  .btn-secondary:hover { border-color: var(--text-secondary); color: var(--text); }

  .btn-link {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.25rem 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    margin-bottom: 0.5rem;
    display: block;
  }

  .btn-link:hover { color: var(--text-secondary); }

  .file-upload-zone {
    margin-bottom: 0.5rem;
    margin-top: 0.5rem;
  }

  .file-upload-btn {
    width: 100%;
    padding: 0.5rem;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-tertiary);
    font-size: 0.75rem;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    margin-bottom: 0.5rem;
  }

  .file-upload-btn:hover { border-color: var(--text-secondary); color: var(--text-secondary); }

  .file-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
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

  .file-tag-error { border-color: var(--error); color: var(--error); }

  .doc-block-tag { display: flex; align-items: center; gap: 0.25rem; }

  .doc-block-remove {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0;
    line-height: 1;
  }

  .doc-block-remove:hover { color: var(--text); }

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

  .btn-add-block:hover:not(:disabled) { border-color: var(--text-secondary); color: var(--text); }
  .btn-add-block:disabled { opacity: 0.4; cursor: default; }

  .generate-recap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .recap-item {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .recap-label {
    color: var(--text-tertiary);
    font-weight: 500;
    min-width: 3.5rem;
  }

  .recap-item span:last-child {
    color: var(--text-secondary);
    text-align: right;
  }

  .create-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }

  .generate-btn {
    width: 100%;
    padding: 0.625rem;
  }

  .generate-status {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  @media (max-width: 480px) {
    .create-page { padding: 1rem; }
    .scrape-row { flex-direction: column; }
  }

  .type-cards {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .type-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
    transition: border-color 0.15s;
    width: 100%;
  }

  .type-card:hover {
    border-color: var(--text-tertiary);
  }

  .type-card-selected {
    border-color: var(--text-secondary);
    background: var(--surface);
  }

  .type-card-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .type-card strong {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .type-card span:last-child {
    display: block;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-top: 0.125rem;
  }
</style>
