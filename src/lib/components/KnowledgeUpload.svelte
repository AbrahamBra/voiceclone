<script>
  // Upload section: doc-type selector + mode toggle + dropzone (file) or text form.
  // State like uploading/progress lives in the parent (KnowledgePanel); we receive
  // it as props and call back via onFilesSelected / onSubmitText.

  const DOC_TYPES = [
    { id: "generic",            label: "Générique" },
    { id: "voice_reference",    label: "Voix" },
    { id: "operating_protocol", label: "Protocole" },
  ];

  const STEPS = [
    { label: "Lecture du fichier",      icon: "◉" },
    { label: "Découpage en chunks",     icon: "◉" },
    { label: "Indexation sémantique",   icon: "◉" },
    { label: "Analyse des mots-clés",   icon: "◉" },
  ];

  let {
    uploading      = false,
    uploadCurrent  = 0,
    uploadTotal    = 0,
    currentStep    = -1,
    uploadDone     = false,
    mode           = $bindable("file"),
    docType        = $bindable("generic"),
    textName       = $bindable(""),
    textContent    = $bindable(""),
    onFilesSelected,
    onSubmitText,
  } = $props();

  let isDragging = $state(false);
  let fileInputEl = $state(undefined);

  function onFileInput(e) {
    if (e.target.files?.length) onFilesSelected?.(e.target.files);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer.files?.length) onFilesSelected?.(e.dataTransfer.files);
  }

  function submitText() {
    onSubmitText?.(textName.trim(), textContent.trim());
  }
</script>

<div class="kp-doc-type">
  <div class="kp-doc-type-label">Type de document</div>
  <div class="kp-doc-type-toggle">
    {#each DOC_TYPES as dt (dt.id)}
      <button
        class="kp-doc-type-btn"
        class:active={docType === dt.id}
        onclick={() => docType = dt.id}
        disabled={uploading}
      >{dt.label}</button>
    {/each}
  </div>
  {#if docType === "operating_protocol"}
    <div class="kp-doc-type-hint">
      Règles absolues extraites puis proposées à l'activation. Parsing async (cron 10 min).
    </div>
  {:else if docType === "voice_reference"}
    <div class="kp-doc-type-hint">
      Contenus stylistiques pour calibrer la voix (posts, DM de référence…).
    </div>
  {/if}
</div>

<div class="kp-mode-toggle">
  <button class="kp-mode-btn" class:active={mode === "file"} onclick={() => mode = "file"}>Fichier</button>
  <button class="kp-mode-btn" class:active={mode === "text"} onclick={() => mode = "text"}>Texte</button>
</div>

{#if mode === "file"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
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
        {#each STEPS as step, i (i)}
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
    <button class="kp-submit-btn" onclick={submitText} disabled={uploading || !textName.trim() || !textContent.trim()}>
      {uploading ? "Traitement..." : "Ajouter"}
    </button>
  </div>
{/if}

<style>
  .kp-doc-type { padding: 0 2px 8px; }
  .kp-doc-type-label {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }
  .kp-doc-type-toggle {
    display: flex;
    gap: 1px;
    background: var(--rule-strong);
    border: 1px solid var(--rule-strong);
  }
  .kp-doc-type-btn {
    flex: 1;
    padding: 5px 4px;
    background: var(--paper-subtle);
    border: none;
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
  }
  .kp-doc-type-btn:hover:not(:disabled) { color: var(--ink); }
  .kp-doc-type-btn.active { background: var(--ink); color: var(--paper); }
  .kp-doc-type-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .kp-doc-type-hint {
    font-family: var(--font-ui);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    line-height: 1.4;
    padding: 4px 2px 0;
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
  .kp-mode-btn.active { background: var(--ink); color: var(--paper); }

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

  .kp-steps { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 4px 0; }
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
  .kp-step.done   { opacity: 0.55; }
  .kp-step-dot {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--ink-40);
    width: 14px;
    text-align: center;
    flex-shrink: 0;
    transition: color 0.3s linear;
  }
  .kp-step.active .kp-step-dot,
  .kp-step.done   .kp-step-dot { color: var(--vermillon); }
  .kp-step-dot.pulse { animation: stepPulse 1.2s linear infinite; }
  @keyframes stepPulse {
    0%, 60%, 100% { opacity: 1; }
    80% { opacity: 0.3; }
  }
  .kp-step-label { font-family: var(--font-ui); font-size: var(--fs-tiny); color: var(--ink-70); }
  .kp-step.active .kp-step-label { color: var(--ink); font-weight: var(--fw-medium); }

  .kp-text-form { display: flex; flex-direction: column; gap: 6px; padding: 0 2px; }
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
  .kp-submit-btn:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .kp-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
