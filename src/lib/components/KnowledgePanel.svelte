<script>
  // Orchestrator — manages all async state and delegates UI to sub-components.
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { extractFileText } from "$lib/file-extraction.js";
  import KnowledgeFileList from "./KnowledgeFileList.svelte";
  import KnowledgeUpload from "./KnowledgeUpload.svelte";

  let { personaId, onupload } = $props();

  // ── File list state ──────────────────────────────────────────────────────────
  let files       = $state([]);
  let loading     = $state(true);
  let error       = $state(null);
  let pollTimer   = null;

  // ── Upload state ─────────────────────────────────────────────────────────────
  let uploading     = $state(false);
  let uploadCurrent = $state(0);
  let uploadTotal   = $state(0);
  let currentStep   = $state(-1);
  let stepTimers    = [];
  let uploadDone    = $state(false);

  // ── Upload form state (bound to KnowledgeUpload) ─────────────────────────────
  let mode        = $state("file");
  let docType     = $state("generic");
  let textName    = $state("");
  let textContent = $state("");

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  $effect(() => { if (personaId) loadFiles(); });
  $effect(() => () => { if (pollTimer) clearTimeout(pollTimer); });

  async function loadFiles() {
    loading = true;
    error = null;
    try {
      const data = await api(`/api/knowledge?persona=${personaId}`);
      files = data.files || [];
      schedulePoll();
    } catch (e) {
      error = e.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  function schedulePoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    const hasWork = files.some(f => f.extraction_status === "pending" || f.extraction_status === "processing");
    if (!hasWork) return;
    pollTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/knowledge?persona=${personaId}`);
        files = data.files || [];
      } catch { /* silent */ }
      schedulePoll();
    }, 20000);
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function confirmDelete(path) {
    try {
      await api(`/api/knowledge?persona=${personaId}&file=${encodeURIComponent(path)}`, { method: "DELETE" });
      files = files.filter(f => f.path !== path);
      showToast("Fichier supprimé");
    } catch {
      showToast("Erreur lors de la suppression");
    }
  }

  // ── Upload ───────────────────────────────────────────────────────────────────
  function startFakeProgress(contentLength) {
    currentStep = 0;
    uploadDone = false;
    const factor = Math.min(contentLength / 50_000, 1);
    const timings = [300, 800 + factor * 1200, 3000 + factor * 7000, 1500 + factor * 2500];
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
    currentStep = 4; // past last = done
    uploadDone = true;
    setTimeout(() => { uploadDone = false; currentStep = -1; }, 1200);
  }

  async function processAndUpload(filename, content) {
    if (content.length > 200_000) {
      content = content.slice(0, 200_000);
      showToast("Document tronqué à 200 000 caractères");
    }
    uploading = true;
    startFakeProgress(content.length);
    try {
      const data = await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ personaId, filename, content, document_type: docType }),
      });
      stopFakeProgress();
      await new Promise(r => setTimeout(r, 600));
      files = [{ ...data.file, displayName: filename }, ...files];
      showToast(data.protocol ? "Protocole importé — parsing en cours" : "Document ajouté");
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
      showToast(/unsupported/i.test(err?.message || "")
        ? "Format non supporté (.txt, .pdf, .docx uniquement)"
        : "Erreur de lecture. Essayez de copier-coller le texte.");
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

  async function submitText(name, content) {
    if (!name || !content) { showToast("Nom et contenu requis"); return; }
    await processAndUpload(name, content);
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
    <KnowledgeFileList {files} onConfirmDelete={confirmDelete} />
  </div>

  <div class="kp-section kp-add">
    <KnowledgeUpload
      {uploading}
      {uploadCurrent}
      {uploadTotal}
      {currentStep}
      {uploadDone}
      bind:mode
      bind:docType
      bind:textName
      bind:textContent
      onFilesSelected={handleFiles}
      onSubmitText={submitText}
    />
  </div>
{/if}

<style>
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
  .kp-add {
    border-top: 1px solid var(--rule-strong);
    padding-top: 10px;
    margin-top: 6px;
  }
</style>
