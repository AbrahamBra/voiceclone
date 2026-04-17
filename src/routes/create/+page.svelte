<script>
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { extractFileText } from "$lib/file-extraction.js";
  import { fly } from "svelte/transition";

  let cloneType = $state(null); // 'posts' | 'dm' | 'both'
  let step = $state('calibration');
  let direction = $state(1);

  const steps = $derived([
    'calibration',
    'type',
    'info',
    ...(cloneType !== 'dm'    ? ['posts'] : []),
    ...(cloneType !== 'posts' ? ['dm']    : []),
    'docs',
  ]);
  const TOTAL = $derived(steps.length);
  // Steps that appear in the visible progress bar (exclude pre-steps)
  const BARRED_STEPS = $derived(steps.filter(s => s !== 'calibration' && s !== 'type'));

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
  // pendingFiles: [{ name, content, status: 'pending'|'uploading'|'done'|'error', error? }]
  let pendingFiles = $state([]);
  let showDocs = $state(false);
  let fileInputEl;
  let generating = $state(false);
  let generateStatus = $state("");
  let ingestProgress = $state({ current: 0, total: 0 });

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

  // --- File handling: extract text client-side, queue for post-creation ingestion ---
  async function handleFiles(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      try {
        const content = await extractFileText(file);
        if (!content.trim()) {
          pendingFiles = [...pendingFiles, { name: file.name, content: "", status: "error", error: "vide" }];
          continue;
        }
        pendingFiles = [...pendingFiles, { name: file.name, content, status: "pending" }];
      } catch (err) {
        const msg = /unsupported/i.test(err?.message || "") ? "format" : "illisible";
        pendingFiles = [...pendingFiles, { name: file.name, content: "", status: "error", error: msg }];
      }
    }
    e.target.value = "";
  }

  function removePendingFile(i) {
    pendingFiles = pendingFiles.filter((_, idx) => idx !== i);
  }

  // --- Generate (two-phase: create persona, then ingest each file) ---
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
    generateStatus = "Création du clone (20-30 s)…";
    ingestProgress = { current: 0, total: 0 };

    // Phase 1: create the persona (no documents)
    let persona;
    try {
      const data = await api("/api/clone", {
        method: "POST",
        body: JSON.stringify({
          linkedin_text: linkedin,
          posts: cloneType !== 'dm' ? posts : undefined,
          dms: dms.length > 0 ? dms : undefined,
          name: personaName.trim() || undefined,
          cloneType,
        }),
      });
      persona = data.persona;
    } catch (err) {
      if (err.status === 402) {
        generateStatus = "Budget dépassé. Ajoutez votre clé API dans les paramètres.";
      } else if (err.status === 403) {
        generateStatus = err.data?.error || "Limite de clones atteinte";
      } else {
        generateStatus = "Erreur: " + (err.message || "Server error");
      }
      generating = false;
      return;
    }

    // Phase 2: absorb each queued file via /api/knowledge (sequential — each call is LLM-heavy)
    const toUpload = pendingFiles.filter(f => f.status === "pending" && f.content.trim());
    ingestProgress = { current: 0, total: toUpload.length };

    for (let i = 0; i < toUpload.length; i++) {
      const f = toUpload[i];
      const idx = pendingFiles.indexOf(f);
      pendingFiles[idx] = { ...f, status: "uploading" };
      pendingFiles = [...pendingFiles];
      try {
        await api("/api/knowledge", {
          method: "POST",
          body: JSON.stringify({
            personaId: persona.id,
            filename: f.name,
            content: f.content.slice(0, 200_000),
          }),
        });
        pendingFiles[idx] = { ...f, status: "done" };
      } catch (err) {
        pendingFiles[idx] = { ...f, status: "error", error: err?.message || "upload" };
      }
      pendingFiles = [...pendingFiles];
      ingestProgress = { current: i + 1, total: toUpload.length };
    }

    generateStatus = `Clone "${persona.name}" créé !`;
    setTimeout(() => { goto(`/calibrate/${persona.id}`); }, 800);
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
      {#if step !== 'calibration' && step !== 'type'}
        Étape {BARRED_STEPS.indexOf(step) + 1}/{BARRED_STEPS.length}
      {/if}
    </p>
    <div class="step-bar" aria-hidden={step === 'calibration' || step === 'type'}>
      {#each BARRED_STEPS as s, i}
        <div class="step-bar-item" class:active={BARRED_STEPS.indexOf(step) >= i}></div>
      {/each}
    </div>

    {#key step}
      <div
        class="create-step-wrap"
        in:fly={{ x: 100 * direction, duration: 250 }}
        out:fly={{ x: -100 * direction, duration: 200 }}
      >
        {#if step === 'calibration'}
          <!-- Step 0: Calibration — rubric + scrape-first -->
          <div class="create-step">
            <div class="step-header">
              <strong>Calibration du clone</strong>
              <span>Avant de commencer, voici ce que le clone apprend — et d'où.</span>
            </div>

            <ol class="rubric">
              <li class="rubric-row">
                <span class="rubric-idx mono">01</span>
                <div class="rubric-body">
                  <div class="rubric-name">Profil</div>
                  <div class="rubric-desc">Nom, poste, bio. Sert de baseline d'identité et de positionnement.</div>
                </div>
                <span class="rubric-src mono">LinkedIn /in/&lt;toi&gt;</span>
              </li>
              <li class="rubric-row">
                <span class="rubric-idx mono">02</span>
                <div class="rubric-body">
                  <div class="rubric-name">Posts publics</div>
                  <div class="rubric-desc">Style d'écriture long-form : rythme, ponctuation, mots signature, forbidden words détectés.</div>
                </div>
                <span class="rubric-src mono">tes posts LinkedIn</span>
              </li>
              <li class="rubric-row">
                <span class="rubric-idx mono">03</span>
                <div class="rubric-body">
                  <div class="rubric-name">DMs 1:1 (optionnel)</div>
                  <div class="rubric-desc">Style conversationnel : longueur, informalité, patterns de questions.</div>
                </div>
                <span class="rubric-src mono">copier-coller tes DMs</span>
              </li>
              <li class="rubric-row">
                <span class="rubric-idx mono">04</span>
                <div class="rubric-body">
                  <div class="rubric-name">Documents métier (optionnel)</div>
                  <div class="rubric-desc">Offre, méthode, cas client. Alimente le retrieval au moment de répondre.</div>
                </div>
                <span class="rubric-src mono">txt · pdf · docx</span>
              </li>
            </ol>

            <div class="calib-divider" role="separator"></div>

            <div class="calib-primary">
              <label class="calib-label mono" for="calib-url">LinkedIn URL — auto-remplit profil et posts</label>
              <div class="scrape-row">
                <input
                  id="calib-url"
                  type="text"
                  placeholder="linkedin.com/in/..."
                  bind:value={linkedinUrl}
                  disabled={scraping}
                  onkeydown={(e) => { if (e.key === 'Enter' && linkedinUrl.trim() && !scraping) scrapeLinkedIn(); }}
                />
                <button
                  class="btn-primary"
                  onclick={scrapeLinkedIn}
                  disabled={scraping || !linkedinUrl.trim()}
                >
                  {scraping ? "Récupération…" : "Scraper"}
                </button>
              </div>
              {#if scrapeStatus}
                <div class="scrape-status" class:scrape-status-success={scrapeSuccess}>{scrapeStatus}</div>
              {/if}
              {#if scrapeSuccess}
                <div class="calib-recap">
                  <div class="recap-line"><span class="mono">profil</span> <span>{personaName}{personaTitle ? ` · ${personaTitle}` : ''}</span></div>
                  {#if postsText}
                    <div class="recap-line"><span class="mono">posts</span> <span>{postsText.split(/\n---\n/).filter(p => p.trim().length > 30).length} détectés</span></div>
                  {/if}
                </div>
              {/if}
            </div>

            <div class="calib-secondary mono">
              Pas de LinkedIn ? <button class="link-btn" onclick={() => { nextStep(); }}>Continuer sans scrape →</button>
            </div>

            <div class="create-actions">
              <button onclick={nextStep} disabled={scraping}>
                {scrapeSuccess ? "Continuer →" : "Continuer sans scrape"}
              </button>
            </div>
          </div>

        {:else if step === 'type'}
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
                  + Ajouter des fichiers (.txt, .md, .pdf, .docx)
                </button>
                <input type="file" accept=".txt,.md,.csv,.pdf,.docx" multiple hidden bind:this={fileInputEl} onchange={handleFiles} />
                <p class="upload-hint">Chaque fichier sera absorbé individuellement après création du clone.</p>
                {#if pendingFiles.length > 0}
                  <ul class="pending-files">
                    {#each pendingFiles as f, i}
                      <li class="pending-file" class:pending-file-error={f.status === 'error'} class:pending-file-done={f.status === 'done'}>
                        <span class="pf-name">{f.name}</span>
                        {#if f.status === 'pending'}
                          <span class="pf-meta mono">{(f.content.length / 1000).toFixed(1)}k chars</span>
                          <button class="pf-remove" onclick={() => removePendingFile(i)} aria-label="Retirer">×</button>
                        {:else if f.status === 'uploading'}
                          <span class="pf-meta mono">absorption…</span>
                        {:else if f.status === 'done'}
                          <span class="pf-meta mono">✓</span>
                        {:else if f.status === 'error'}
                          <span class="pf-meta mono">✗ {f.error || 'erreur'}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
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
              {#if pendingFiles.length > 0}
                <div class="recap-item">
                  <span class="recap-label">Docs</span>
                  <span>{pendingFiles.filter(f => f.status !== 'error').length} fichier(s) en file</span>
                </div>
              {/if}
            </div>

            <button class="generate-btn" onclick={createClone} disabled={generating}>
              {generating ? "Génération en cours..." : "Générer le clone"}
            </button>

            {#if generating && ingestProgress.total > 0}
              <div class="generate-status">Absorption {ingestProgress.current}/{ingestProgress.total}…</div>
            {:else if generateStatus}
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
    background: var(--vermillon);
  }

  .create-step-wrap {
    position: relative;
  }

  /* ─── Calibration step (step 0) ─────────────────── */
  .rubric {
    list-style: none;
    padding: 0;
    margin: 8px 0 12px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
  }
  .rubric-row {
    display: grid;
    grid-template-columns: 32px 1fr auto;
    align-items: baseline;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px dashed var(--rule);
  }
  .rubric-row:last-child { border-bottom: 0; }
  .rubric-idx {
    font-size: var(--fs-micro);
    font-weight: var(--fw-semi);
    color: var(--vermillon);
  }
  .rubric-body { min-width: 0; }
  .rubric-name {
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    font-weight: var(--fw-medium);
    color: var(--ink);
    margin-bottom: 2px;
  }
  .rubric-desc {
    font-family: var(--font-ui);
    font-size: var(--fs-small);
    color: var(--ink-70);
    line-height: var(--lh-snug);
  }
  .rubric-src {
    justify-self: end;
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: var(--ls-caps);
    color: var(--ink-40);
    white-space: nowrap;
  }

  .calib-divider {
    height: 1px;
    background: var(--rule-strong);
    margin: 16px 0 12px;
  }
  .calib-primary { margin-bottom: 8px; }
  .calib-label {
    display: block;
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: var(--ls-caps);
    color: var(--ink-40);
    margin-bottom: 6px;
  }

  .btn-primary {
    padding: 10px 16px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    min-height: var(--touch-min);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .calib-recap {
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--paper-subtle);
    border-left: 2px solid var(--vermillon);
    font-size: var(--fs-small);
  }
  .recap-line {
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: 10px;
    padding: 2px 0;
    color: var(--ink-70);
  }
  .recap-line .mono {
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: var(--ls-caps);
    color: var(--ink-40);
  }

  .calib-secondary {
    margin-top: 10px;
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .link-btn {
    background: transparent;
    border: none;
    color: var(--vermillon);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    padding: 4px 0;
    cursor: pointer;
    border-bottom: 1px dashed var(--vermillon);
    min-height: var(--touch-min);
    display: inline-flex;
    align-items: center;
  }
  .link-btn:hover { color: var(--vermillon-dim); }

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

  .upload-hint {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin: 0 0 0.5rem 0;
  }

  .pending-files {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .pending-file {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .pending-file-done { border-color: var(--text-tertiary); opacity: 0.75; }
  .pending-file-error { border-color: var(--error); color: var(--error); }

  .pf-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pf-meta { color: var(--text-tertiary); font-size: 0.6875rem; }

  .pf-remove {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 0.875rem;
    padding: 0;
    line-height: 1;
  }

  .pf-remove:hover { color: var(--text); }

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
