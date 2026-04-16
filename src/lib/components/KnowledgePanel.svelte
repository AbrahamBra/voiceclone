<script>
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { getRelativeTime } from "$lib/utils.js";

  let { personaId, onupload } = $props();

  let files = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let confirmingDelete = $state(null);

  let mode = $state("file"); // "file" | "text"
  let uploading = $state(false);
  let uploadProgress = $state("");
  let uploadCurrent = $state(0);
  let uploadTotal = $state(0);

  // Text mode fields
  let textName = $state("");
  let textContent = $state("");

  // File mode
  let isDragging = $state(false);
  let fileInputEl = $state(undefined);

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
    uploadProgress = "Traitement";

    try {
      const data = await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ personaId, filename, content }),
      });
      uploadProgress = "Enregistré";
      await new Promise(r => setTimeout(r, 400));
      // Store original filename alongside server path for display
      files = [{ ...data.file, displayName: filename }, ...files];
      const entitiesMsg = data.entities_added > 0
        ? ` · ${data.entities_added} entités extraites`
        : data._debug ? ` · Intelligence: ${data._debug}` : "";
      showToast(`Document ajouté${entitiesMsg}`);
      onupload?.();
    } catch (e) {
      showToast(e.message || "Erreur lors de l'upload");
    } finally {
      uploading = false;
      uploadProgress = "";
      uploadCurrent = 0;
      uploadTotal = 0;
    }
  }

  async function handleFile(file, current = 1, total = 1) {
    uploading = true;
    uploadCurrent = current;
    uploadTotal = total;
    uploadProgress = "Extraction";
    let text = "";

    try {
      if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
        text = await file.text();
      } else if (file.name.endsWith(".pdf")) {
        const pdfjsLib = await import("pdfjs-dist");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url
          ).href;
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const pageContent = await page.getTextContent();
          pages.push(pageContent.items.map(item => item.str).join(" "));
        }
        text = pages.join("\n\n");
      } else if (file.name.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else {
        showToast("Format non supporté (.txt, .pdf, .docx uniquement)");
        uploading = false;
        uploadProgress = "";
        uploadCurrent = 0;
        uploadTotal = 0;
        return;
      }
    } catch {
      showToast("Erreur de lecture. Essayez de copier-coller le texte.");
      uploading = false;
      uploadProgress = "";
      uploadCurrent = 0;
      uploadTotal = 0;
      return;
    }

    if (!text.trim()) {
      showToast("Document vide ou illisible");
      uploading = false;
      uploadProgress = "";
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
          <span class="kp-progress">{uploadTotal > 1 ? `Doc ${uploadCurrent}/${uploadTotal} · ` : ""}{uploadProgress}...</span>
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
          {uploading ? uploadProgress + "..." : "Ajouter"}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .kp-loading, .kp-error {
    padding: 1rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-align: center;
  }
  .kp-retry {
    display: block;
    margin: 0.5rem auto 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    cursor: pointer;
    font-family: inherit;
  }
  .kp-retry:hover { color: var(--text); border-color: var(--text-tertiary); }

  .kp-section { padding: 0.5rem; }
  .kp-section-title {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.5rem;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .kp-count {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .kp-empty {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    padding: 0.5rem;
    margin: 0;
  }

  .kp-file {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius);
    transition: background 0.1s;
  }
  .kp-file:hover { background: rgba(255, 255, 255, 0.03); }
  .kp-file-info { flex: 1; overflow: hidden; }
  .kp-file-name {
    display: block;
    font-size: 0.6875rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kp-file-meta {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
  }
  .kp-delete {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0 0.25rem;
    flex-shrink: 0;
    transition: color 0.15s;
    font-family: inherit;
  }
  .kp-delete:hover { color: var(--error); }
  .kp-delete.confirming {
    color: var(--error);
    font-size: 0.625rem;
  }

  .kp-add {
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
  }
  .kp-mode-toggle {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
    padding: 0 0.5rem;
  }
  .kp-mode-btn {
    flex: 1;
    padding: 0.3rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-tertiary);
    font-size: 0.6875rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    font-family: inherit;
  }
  .kp-mode-btn:hover { color: var(--text-secondary); }
  .kp-mode-btn.active {
    background: var(--bg);
    color: var(--text);
    border-color: var(--text-tertiary);
  }

  .kp-dropzone {
    margin: 0 0.5rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 1.25rem 1rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .kp-dropzone:hover, .kp-dropzone.dragging {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.02);
  }
  .kp-dropzone.uploading { cursor: default; opacity: 0.7; }
  .kp-dropzone-text {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  .kp-dropzone-text small { font-size: 0.5625rem; }
  .kp-browse-btn {
    padding: 0.3rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: 0.6875rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    font-family: inherit;
  }
  .kp-browse-btn:hover { border-color: var(--text-tertiary); color: var(--text); }
  .kp-progress {
    font-size: 0.6875rem;
    color: var(--accent);
  }

  .kp-text-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.5rem;
  }
  .kp-input, .kp-textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.6875rem;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .kp-input:focus, .kp-textarea:focus { border-color: var(--text-tertiary); }
  .kp-input::placeholder, .kp-textarea::placeholder { color: var(--text-tertiary); }
  .kp-textarea { resize: vertical; }
  .kp-submit-btn {
    padding: 0.4rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    font-size: 0.6875rem;
    cursor: pointer;
    transition: opacity 0.15s;
    font-family: inherit;
  }
  .kp-submit-btn:hover { opacity: 0.85; }
  .kp-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
