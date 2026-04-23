<script>
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { extractFileText } from "$lib/file-extraction.js";
  import { track } from "$lib/tracking.js";
  import { fly } from "svelte/transition";

  let cloneType = $state(null); // 'posts' | 'dm' | 'both'
  let step = $state('type');
  let direction = $state(1);

  const steps = $derived([
    'type',
    'info',
    ...(cloneType !== 'dm'    ? ['posts'] : []),
    ...(cloneType !== 'posts' ? ['dm']    : []),
    'protocol',
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
  let clientLabel = $state("");

  // Step 2: Posts LinkedIn
  let postsText = $state("");

  // Step 3: DMs LinkedIn
  let dmsText = $state("");

  // Step 4: Protocole opérationnel (optionnel — parsed async après création)
  let protocolFile = $state(/** @type {{name: string, content: string}|null} */(null));
  let protoFileInputEl;
  async function handleProtocolFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const content = await extractFileText(file);
      if (!content.trim()) {
        showToast("Document vide ou illisible");
        return;
      }
      protocolFile = { name: file.name, content };
    } catch (err) {
      showToast(/unsupported/i.test(err?.message || "") ? "Format non supporté (.txt .md .pdf .docx)" : "Erreur de lecture");
    }
  }
  function removeProtocolFile() { protocolFile = null; }

  // Detect conversations with < 2 distinct speakers (monologue = useless for cloning turn-taking).
  // A "speaker" = a line starting with "Name:" (letters up to 30 chars then colon).
  let dmIssues = $derived.by(() => {
    if (!dmsText.trim()) return [];
    const convs = dmsText.trim().split(/\n---\n/);
    const issues = [];
    convs.forEach((conv, i) => {
      if (conv.trim().length < 20) return;
      const speakers = new Set();
      const lineRegex = /^([A-Za-zÀ-ÿ][^:\n]{0,30}):/gm;
      let m;
      while ((m = lineRegex.exec(conv)) !== null) speakers.add(m[1].trim());
      if (speakers.size < 2) issues.push({ idx: i + 1, speakers: speakers.size });
    });
    return issues;
  });

  // Step 4: Documents + Génération
  // pendingFiles: [{ name, content, status: 'pending'|'uploading'|'done'|'error', error? }]
  let pendingFiles = $state([]);
  let showDocs = $state(false);
  let fileInputEl;
  let generating = $state(false);
  let generatingPhase = $state(""); // "clone" | "files" | ""
  let generateStatus = $state("");
  let ingestProgress = $state({ current: 0, total: 0 });
  let cloneStepMessage = $state("");
  let currentFileLabel = $state("");

  // Messages temporisés calés sur le timing réel mesuré de /api/clone
  // (config+style+DM parallèle ~10-25s, ontologie ~25-45s, extraction doc ~45-60s)
  const CLONE_STEPS = [
    { at: 0,     msg: "Analyse du profil et des posts…" },
    { at: 10000, msg: "Construction de la voix et du style d'écriture…" },
    { at: 25000, msg: "Extraction des entités et relations (intelligence)…" },
    { at: 50000, msg: "Finalisation et enregistrement…" },
  ];

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
    generatingPhase = "clone";
    generateStatus = "";
    cloneStepMessage = CLONE_STEPS[0].msg;
    ingestProgress = { current: 0, total: 0 };

    // Timer qui fait avancer les messages selon le temps écoulé
    const startedAt = Date.now();
    const stepTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const current = [...CLONE_STEPS].reverse().find(s => elapsed >= s.at);
      if (current) cloneStepMessage = current.msg;
    }, 1000);

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
          client_label: clientLabel.trim() || undefined,
        }),
      });
      persona = data.persona;
      track("clone_created", {
        type: cloneType,
        has_docs: pendingFiles.filter(f => f.status === "pending").length > 0,
        has_protocol: !!protocolFile,
      });
    } catch (err) {
      clearInterval(stepTimer);
      if (err.status === 402) {
        generateStatus = "Budget dépassé. Ajoutez votre clé API dans les paramètres.";
      } else if (err.status === 403) {
        generateStatus = err.data?.error || "Limite de clones atteinte";
      } else {
        generateStatus = "Erreur: " + (err.message || "Server error");
      }
      generating = false;
      generatingPhase = "";
      return;
    }
    clearInterval(stepTimer);

    // Phase 1.5: upload protocole si fourni. Le parsing tourne async côté cron
    // (10 min), donc on n'attend pas ici — juste l'insert DB.
    if (protocolFile && protocolFile.content.trim()) {
      generatingPhase = "protocol";
      currentFileLabel = protocolFile.name;
      try {
        await api("/api/knowledge", {
          method: "POST",
          body: JSON.stringify({
            personaId: persona.id,
            filename: protocolFile.name,
            content: protocolFile.content.slice(0, 200_000),
            document_type: "operating_protocol",
          }),
        });
      } catch (err) {
        // Ne pas bloquer la création — l'utilisateur pourra re-uploader depuis
        // Cerveau → Protocole si l'API a foiré.
        console.warn("protocol upload failed", err);
      }
    }

    // Phase 2: absorb each queued file via /api/knowledge (sequential — each call is LLM-heavy)
    const toUpload = pendingFiles.filter(f => f.status === "pending" && f.content.trim());
    ingestProgress = { current: 0, total: toUpload.length };
    generatingPhase = toUpload.length > 0 ? "files" : "";

    const BLOCK_SIZE = 20_000;
    for (let i = 0; i < toUpload.length; i++) {
      const f = toUpload[i];
      const idx = pendingFiles.indexOf(f);
      pendingFiles[idx] = { ...f, status: "uploading" };
      pendingFiles = [...pendingFiles];
      try {
        const content = f.content.slice(0, 200_000);
        const blocks = [];
        for (let j = 0; j < content.length; j += BLOCK_SIZE) blocks.push(content.slice(j, j + BLOCK_SIZE));
        for (let b = 0; b < blocks.length; b++) {
          const blockName = blocks.length > 1 ? `${f.name} (${b + 1}/${blocks.length})` : f.name;
          currentFileLabel = blocks.length > 1
            ? `${f.name} — bloc ${b + 1}/${blocks.length}`
            : f.name;
          await api("/api/knowledge", {
            method: "POST",
            body: JSON.stringify({ personaId: persona.id, filename: blockName, content: blocks[b] }),
          });
        }
        pendingFiles[idx] = { ...f, status: "done" };
      } catch (err) {
        pendingFiles[idx] = { ...f, status: "error", error: err?.data?.detail || err?.message || "upload" };
      }
      pendingFiles = [...pendingFiles];
      ingestProgress = { current: i + 1, total: toUpload.length };
    }

    generatingPhase = "";
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
      Étape {steps.indexOf(step) + 1}/{TOTAL}
    </p>
    <div class="step-bar">
      {#each steps as _, i}
        <div class="step-bar-item" class:active={steps.indexOf(step) >= i}></div>
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

            <label>Client <span class="label-optional">(optionnel)</span></label>
            <input type="text" placeholder="Ex: Marie Dupont — BeautyCorp" bind:value={clientLabel} maxlength="120" />

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
              Colle des conversations <strong>complètes</strong> — les deux côtés, du premier message au dernier. Un monologue unilatéral ne sert à rien : le clone apprend comment tu <em>relances</em>, <em>réponds</em>, <em>clôtures</em>. Sépare chaque conversation par <code>---</code>.
            </p>

            <details class="dm-example">
              <summary class="dm-example-sum mono">Voir un exemple de conversation bien formatée</summary>
              <pre class="dm-example-body">[Conversation 1]
Prospect: Bonjour, j'ai vu ton post sur le GTM B2B — t'en penses quoi du PLG pur pour un SaaS vertical ?
Moi: Salut Marc ! Pour un vertical, le PLG pur est rare — la plupart mixent. T'es à quel stade ?
Prospect: Pre-seed, on finalise le MVP. 2 early users.
Moi: OK donc pas encore le signal d'usage pour du PLG. Sales-led les 6 premiers mois. DM si tu veux creuser.</pre>
            </details>

            <textarea rows="14" bind:value={dmsText} placeholder="[Conversation 1]&#10;Prospect: ...&#10;Moi: ...&#10;Prospect: ...&#10;Moi: ...&#10;---&#10;[Conversation 2]&#10;..."></textarea>

            {#if dmsText.trim()}
              <div class="count-badge count-ok">
                {dmsText.trim().split(/\n---\n/).filter(d => d.trim().length > 20).length} conversation(s) détectée(s)
              </div>
            {/if}

            {#if dmIssues.length > 0}
              <div class="dm-warn">
                ⚠ {dmIssues.length === 1 ? "Conversation" : "Conversations"}
                {dmIssues.map(i => i.idx).join(", ")} :
                un seul interlocuteur détecté. Chaque réplique doit commencer par "Prénom:" pour que le clone apprenne la dynamique. Ex : "Alice: Bonjour\nBob: Salut"
              </div>
            {/if}

            <div class="create-actions">
              <button class="btn-secondary" onclick={prevStep}>← Retour</button>
              {#if cloneType === 'both'}
                <button class="btn-secondary" onclick={nextStep} disabled={dmIssues.length > 0}>Passer</button>
              {/if}
              <button onclick={nextStep} disabled={(cloneType === 'dm' && !dmsText.trim()) || dmIssues.length > 0}>
                {dmIssues.length > 0 ? "Corrige les conversations ci-dessus" : "Suivant →"}
              </button>
            </div>
          </div>

        {:else if step === 'protocol'}
          <!-- Step: Protocole opérationnel (optionnel) -->
          <div class="create-step">
            <div class="step-header">
              <strong>Protocole opérationnel</strong>
              <span>Les règles absolues du clone — optionnel</span>
            </div>

            <p class="step-desc">
              Si votre méthode suit un playbook précis (<em>jamais 2 questions</em>, <em>max 8 lignes</em>, <em>pas de mention d'offre</em>…), uploadez-le ici. Le clone <strong>appliquera ces règles en dur</strong> à chaque message : il réécrira automatiquement tout draft qui les viole. Sans protocole, le clone reste stylistiquement fidèle mais ne bloque rien.
            </p>

            <div class="protocol-zone">
              {#if !protocolFile}
                <button class="file-upload-btn" onclick={() => protoFileInputEl.click()}>
                  + Uploader le protocole (.txt .md .pdf .docx)
                </button>
                <input type="file" accept=".txt,.md,.pdf,.docx" hidden bind:this={protoFileInputEl} onchange={handleProtocolFile} />
                <p class="upload-hint">Pas de protocole ? Passez cette étape — vous pourrez l'ajouter plus tard depuis Cerveau → Protocole.</p>
              {:else}
                <div class="protocol-uploaded">
                  <span class="proto-check">✓</span>
                  <span class="proto-name">{protocolFile.name}</span>
                  <span class="proto-size mono">{(protocolFile.content.length / 1000).toFixed(1)}k chars</span>
                  <button class="pf-remove" onclick={removeProtocolFile} aria-label="Retirer">×</button>
                </div>
                <p class="upload-hint">Parsing automatique après création (≈ 10 min). Vous validerez les règles extraites avant activation depuis Cerveau → Protocole.</p>
              {/if}
            </div>

            <div class="create-actions">
              <button class="btn-secondary" onclick={prevStep}>← Retour</button>
              <button onclick={nextStep}>
                {protocolFile ? "Suivant →" : "Passer →"}
              </button>
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
              {#if clientLabel.trim()}
                <div class="recap-item">
                  <span class="recap-label">Client</span>
                  <span>{clientLabel.trim()}</span>
                </div>
              {/if}
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
              {#if protocolFile}
                <div class="recap-item">
                  <span class="recap-label">Protocole</span>
                  <span>{protocolFile.name}</span>
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

            {#if generatingPhase === "clone"}
              <div class="generate-status generating-active">
                <span class="gen-spinner" aria-hidden="true"></span>
                <span>{cloneStepMessage}</span>
              </div>
            {:else if generatingPhase === "protocol"}
              <div class="generate-status generating-active">
                <span class="gen-spinner" aria-hidden="true"></span>
                <span>Importation du protocole — {currentFileLabel}</span>
              </div>
            {:else if generatingPhase === "files"}
              <div class="generate-status generating-active">
                <span class="gen-spinner" aria-hidden="true"></span>
                <span>
                  Absorption {ingestProgress.current}/{ingestProgress.total}
                  {#if currentFileLabel} — {currentFileLabel}{/if}
                </span>
              </div>
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

  .label-optional {
    color: var(--text-tertiary);
    opacity: 0.65;
    font-weight: 400;
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

  .step-desc strong { color: var(--text); font-weight: 600; }
  .step-desc em { font-style: italic; color: var(--text-secondary); }

  .dm-example {
    margin-bottom: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .dm-example-sum {
    cursor: pointer;
    padding: 0.5rem 0.75rem;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    list-style: none;
  }
  .dm-example-sum::-webkit-details-marker { display: none; }
  .dm-example-sum:hover { color: var(--text-secondary); }
  .dm-example[open] .dm-example-sum { border-bottom: 1px dashed var(--border); }
  .dm-example-body {
    margin: 0;
    padding: 0.75rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    line-height: 1.55;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .dm-warn {
    font-size: 0.6875rem;
    color: #b87300;
    padding: 6px 10px;
    border-left: 2px solid #b87300;
    background: rgba(184, 115, 0, 0.08);
    margin-top: 0.5rem;
    line-height: 1.4;
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

  .protocol-zone {
    margin-bottom: 0.5rem;
  }
  .protocol-uploaded {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--vermillon);
    border-radius: var(--radius);
    font-size: 0.8125rem;
    margin-bottom: 0.5rem;
  }
  .proto-check {
    color: var(--vermillon);
    font-weight: 700;
    flex-shrink: 0;
  }
  .proto-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .proto-size {
    color: var(--text-tertiary);
    font-size: 0.6875rem;
  }

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
  .generating-active {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gen-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--rule-strong, #ddd);
    border-top-color: var(--ink, #111);
    border-radius: 50%;
    animation: gen-spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes gen-spin {
    to { transform: rotate(360deg); }
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
