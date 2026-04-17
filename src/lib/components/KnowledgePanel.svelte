<script>
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { getRelativeTime } from "$lib/utils.js";
  import { extractFileText } from "$lib/file-extraction.js";

  let { personaId, onupload } = $props();

  let files = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let confirmingDelete = $state(null);

  let mode = $state("file"); // "file" | "text"
  let uploading = $state(false);
  let uploadCurrent = $state(0);
  let uploadTotal = $state(0);

  // Text mode fields
  let textName = $state("");
  let textContent = $state("");

  // File mode
  let isDragging = $state(false);
  let fileInputEl = $state(undefined);

  // Upload progress steps
  const STEPS = [
    { label: "Lecture du fichier", icon: "◉" },
    { label: "Analyse des mots-clés", icon: "◉" },
    { label: "Découpage en chunks", icon: "◉" },
    { label: "Indexation sémantique", icon: "◉" },
    { label: "Extraction intelligence", icon: "◉" },
  ];
  let currentStep = $state(-1);
  let stepTimers = [];
  let uploadDone = $state(false);

  function startFakeProgress(contentLength) {
    currentStep = 0;
    uploadDone = false;
    // Timings scale with content size (base + proportional)
    const factor = Math.min(contentLength / 50_000, 1);
    const timings = [
      300,                        // lecture: instant
      2000 + factor * 3000,       // mots-clés: 2-5s
      800 + factor * 1200,        // chunks: 0.8-2s
      3000 + factor * 7000,       // embeddings: 3-10s
      3000 + factor * 12000,      // intelligence: 3-15s
    ];
    stepTimers = [];
    let cumulative = 0;
    for (let i = 1; i < timings.length; i++) {
      cumulative += timings[i - 1];
      const step = i;
      stepTimers.push(setTimeout(() => { currentStep = step; }, cumulative));
    }
  }

  function stopFakeProgress() {
    for (const t of stepTimers) clearTimeout(t);
    stepTimers = [];
    currentStep = STEPS.length; // past last = done
    uploadDone = true;
    setTimeout(() => { uploadDone = false; currentStep = -1; }, 1200);
  }

  $effect(() => {
    if (personaId) loadFiles();
  });

  // Derive display name: strip the -TIMESTAMP suffix added server-side
  function displayName(f) {
    return f.displayName || f.path.replace(/-\d{13}(\.[^.]+)?$/, '$1').replace(/^.*\//, '');
  }

  async function loadFiles() {
    loading = true;
    error = null;
    try {
      const data = await api(`/api/knowledge?persona=${personaId}`);
      files = data.files || [];
    } catch (e) {
      error = e.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  function startDelete(path) {
    confirmingDelete = path;
    setTimeout(() => { if (confirmingDelete === path) confirmingDelete = null; }, 4000);
  }

  async function confirmDelete(path) {
    try {
      await api(`/api/knowledge?persona=${personaId}&file=${encodeURIComponent(path)}`, { method: "DELETE" });
      files = files.filter(f => f.path !== path);
      confirmingDelete = null;
      showToast("Fichier supprimé");
    } catch {
      showToast("Erreur lors de la suppression");
      confirmingDelete = null;
    }
  }

  async function processAndUpload(filename, content) {
    // Enforce 200k limit client-side before POST
    if (content.length > 200_000) {
      content = content.slice(0, 200_000);
      showToast("Document tronqué à 200 000 caractères");
    } else if (content.length > 50_000) {
      showToast("Document volumineux — l'extraction intelligence peut être partielle");
    }

    uploading = true;
    startFakeProgress(content.length);

    try {
      const data = await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ personaId, filename, content }),
      });
      stopFakeProgress();
      await new Promise(r => setTimeout(r, 600));
      // Store original filename alongside server path for display
      files = [{ ...data.file, displayName: filename }, ...files];
      const entitiesMsg = data.entities_added > 0
        ? ` · ${data.entities_added} entités extraites`
        : data._debug ? ` · Intelligence: ${data._debug}` : "";
      showToast(`Document ajouté${entitiesMsg}`);
      onupload?.();
    } catch (e) {
      for (const t of stepTimers) clearTimeout(t);
      stepTimers = [];
      currentStep = -1;
      showToast(e.message || "Erreur lors de l'upload");
    } finally {
      uploading = false;
      uploadCurrent = 0;
      uploadTotal = 0;
    }
  }

  async function handleFile(file, current = 1, total = 1) {
    uploading = true;
    uploadCurrent = current;
    uploadTotal = total;
    currentStep = 0;
    uploadDone = false;
    let text = "";

    try {
      text = await extractFileText(file);
    } catch (err) {
      if (/unsupported/i.test(err?.message || "")) {
        showToast("Format non supporté (.txt, .pdf, .docx uniquement)");
      } else {
        showToast("Erreur de lecture. Essayez de copier-coller le texte.");
      }
      uploading = false;
      currentStep = -1;
      uploadCurrent = 0;
      uploadTotal = 0;
      return;
    }

    if (!text.trim()) {
      showToast("Document vide ou illisible");
      uploading = false;
      currentStep = -1;
      uploadCurrent = 0;
      uploadTotal = 0;
      return;
    }

    await processAndUpload(file.name, text);
  }

  async function handleFiles(fileList) {
    const list = Array.from(fileList);
    if (!list.length) return;
    for (let i = 0; i < list.length; i++) {
      await handleFile(list[i], i + 1, list.length);
    }
  }

  function onFileInput(e) {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  async function submitText() {
    if (!textName.trim() || !textContent.trim()) {
      showToast("Nom et contenu requis");
      return;
    }
    await processAndUpload(textName.trim(), textContent.trim());
    textName = "";
    textContent = "";
  }
</script>

{#if loading}
  <div class="kp-loading">Chargement...</div>
{:else if error}
  <div class="kp-error">
    {error}
    <button class="kp-retry" onclick={loadFiles}>Réessayer</button>
  </div>
{:else}
  <div class="kp-section">
    <h4 class="kp-section-title">Documents <span class="kp-count">{files.length}</span></h4>
    {#if files.length === 0}
      <p class="kp-empty">Aucun document. Uploadez des fichiers ou collez du texte ci-dessous.</p>
    {:else}
      {#each files as f (f.path)}
        <div class="kp-file">
          <div class="kp-file-info">
            <span class="kp-file-name">{displayName(f)}</span>
            <span class="kp-file-meta">{f.chunk_count} chunks · {getRelativeTime(f.created_at)}</span>
          </div>
          {#if confirmingDelete === f.path}
            <button class="kp-delete confirming" onclick={() => confirmDelete(f.path)}>Supprimer ?</button>
          {:else}
            <button class="kp-delete" onclick={() => startDelete(f.path)}>&times;</button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="kp-section kp-add">
    <div class="kp-mode-toggle">
      <button class="kp-mode-btn" class:active={mode === "file"} onclick={() => mode = "file"}>Fichier</button>
      <button class="kp-mode-btn" class:active={mode === "text"} onclick={() => mode = "text"}>Texte</button>
    </div>

    {#if mode === "file"}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="kp-dropzone"
        class:dragging={isDragging}
        class:uploading
        ondragover={(e) => { e.preventDefault(); isDragging = true; }}
        ondragleave={() => isDragging = false}
        ondrop={onDrop}
        onclick={() => !uploading && fileInputEl?.click()}
      >
        <input
          type="file"
          accept=".txt,.pdf,.docx,.md"
          multiple
          style="display:none"
          bind:this={fileInputEl}
          onchange={onFileInput}
        />
        {#if uploading}
          <div class="kp-steps">
            {#if uploadTotal > 1}
              <span class="kp-step-counter">Doc {uploadCurrent}/{uploadTotal}</span>
            {/if}
            {#each STEPS as step, i}
              <div class="kp-step" class:active={currentStep === i} class:done={currentStep > i || uploadDone}>
                <span class="kp-step-dot" class:pulse={currentStep === i}>{currentStep > i || uploadDone ? "✓" : step.icon}</span>
                <span class="kp-step-label">{step.label}</span>
              </div>
            {/each}
            {#if uploadDone}
              <div class="kp-step done">
                <span class="kp-step-dot">✓</span>
                <span class="kp-step-label">Terminé</span>
              </div>
            {/if}
          </div>
        {:else}
          <span class="kp-dropzone-text">Glisser un fichier ici<br><small>.txt · .pdf · .docx</small></span>
          <button class="kp-browse-btn" onclick={(e) => { e.stopPropagation(); fileInputEl?.click(); }}>Parcourir</button>
        {/if}
      </div>
    {:else}
      <div class="kp-text-form">
        <input
          class="kp-input"
          type="text"
          placeholder="Nom du document"
          bind:value={textName}
          disabled={uploading}
        />
        <textarea
          class="kp-textarea"
          placeholder="Collez votre contenu ici..."
          bind:value={textContent}
          rows="5"
          disabled={uploading}
        ></textarea>
        <button class="kp-submit-btn" onclick={submitText} disabled={uploading}>
          {uploading ? "Traitement..." : "Ajouter"}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ─── Laboratoire Knowledge panel ─── */
  .kp-loading, .kp-error {
    padding: 14px;
    font-family: var(--font-mono);
    color: var(--ink-40);
    font-size: var(--fs-tiny);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .kp-retry {
    display: block;
    margin: 8px auto 0;
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .kp-retry:hover { color: var(--ink); border-color: var(--ink-40); }

  .kp-section { padding: 6px 10px; }
  .kp-section-title {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    font-weight: var(--fw-semi);
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 8px 2px 4px;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kp-count {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
  }
  .kp-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    padding: 8px 2px;
    margin: 0;
  }

  .kp-file {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-left: 2px solid transparent;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .kp-file:hover { background: var(--paper); border-left-color: var(--vermillon); }
  .kp-file-info { flex: 1; overflow: hidden; min-width: 0; }
  .kp-file-name {
    display: block;
    font-size: var(--fs-tiny);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kp-file-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }
  .kp-delete {
    background: transparent;
    border: 1px solid transparent;
    color: var(--ink-40);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    padding: 2px 6px;
    flex-shrink: 0;
    transition: color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .kp-delete:hover { color: var(--vermillon); border-color: var(--vermillon); }
  .kp-delete.confirming {
    color: var(--vermillon);
    border-color: var(--vermillon);
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .kp-add {
    border-top: 1px solid var(--rule-strong);
    padding-top: 10px;
    margin-top: 6px;
  }
  .kp-mode-toggle {
    display: flex;
    gap: 1px;
    margin-bottom: 10px;
    padding: 0 2px;
    background: var(--rule-strong);
    border: 1px solid var(--rule-strong);
  }
  .kp-mode-btn {
    flex: 1;
    padding: 6px 4px;
    background: var(--paper-subtle);
    border: none;
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
  }
  .kp-mode-btn:hover { color: var(--ink); }
  .kp-mode-btn.active {
    background: var(--ink);
    color: var(--paper);
  }

  .kp-dropzone {
    margin: 0 2px;
    border: 1px dashed var(--rule-strong);
    padding: 18px 14px;
    text-align: center;
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .kp-dropzone:hover, .kp-dropzone.dragging {
    border-color: var(--vermillon);
    background: color-mix(in srgb, var(--vermillon) 4%, transparent);
  }
  .kp-dropzone.uploading { cursor: default; }
  .kp-dropzone-text {
    font-family: var(--font-ui);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
    line-height: var(--lh-snug);
  }
  .kp-dropzone-text small {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
  }
  .kp-browse-btn {
    padding: 5px 12px;
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  .kp-browse-btn:hover { border-color: var(--ink-40); color: var(--ink); }

  .kp-steps {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 4px 0;
  }
  .kp-step-counter {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .kp-step {
    display: flex;
    align-items: center;
    gap: 6px;
    opacity: 0.35;
    transition: opacity 0.3s linear;
  }
  .kp-step.active { opacity: 1; }
  .kp-step.done { opacity: 0.55; }
  .kp-step-dot {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--ink-40);
    width: 14px;
    text-align: center;
    flex-shrink: 0;
    transition: color 0.3s linear;
  }
  .kp-step.active .kp-step-dot { color: var(--vermillon); }
  .kp-step.done .kp-step-dot { color: var(--vermillon); }
  .kp-step-dot.pulse { animation: stepPulse 1.2s linear infinite; }
  @keyframes stepPulse {
    0%, 60%, 100% { opacity: 1; }
    80% { opacity: 0.3; }
  }
  .kp-step-label {
    font-family: var(--font-ui);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
  }
  .kp-step.active .kp-step-label { color: var(--ink); font-weight: var(--fw-medium); }

  .kp-text-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 2px;
  }
  .kp-input, .kp-textarea {
    width: 100%;
    padding: 7px 9px;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: var(--fs-small);
    outline: none;
    box-sizing: border-box;
    transition: border-color var(--dur-fast) var(--ease);
  }
  .kp-input:focus, .kp-textarea:focus { border-color: var(--vermillon); }
  .kp-input::placeholder, .kp-textarea::placeholder {
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
  }
  .kp-textarea { resize: vertical; font-family: var(--font); }
  .kp-submit-btn {
    padding: 8px 12px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .kp-submit-btn:hover:not(:disabled) {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .kp-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
