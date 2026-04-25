<script>
  import { getRelativeTime } from "$lib/utils.js";

  let {
    files = [],
    onConfirmDelete,
  } = $props();

  let confirmingDelete = $state(null);

  function docTypeBadge(type) {
    if (type === "operating_protocol") return "protocole";
    if (type === "voice_reference")    return "voix";
    return null;
  }

  function extractionLabel(status) {
    if (status === "pending")    return "extraction en attente";
    if (status === "processing") return "extraction en cours";
    if (status === "failed")     return "extraction échouée";
    return null;
  }

  function displayName(f) {
    return f.displayName || f.path.replace(/-\d{13}(\.[^.]+)?$/, "$1").replace(/^.*\//, "");
  }

  function startDelete(path) {
    confirmingDelete = path;
    setTimeout(() => { if (confirmingDelete === path) confirmingDelete = null; }, 4000);
  }

  function confirmDelete(path) {
    confirmingDelete = null;
    onConfirmDelete?.(path);
  }
</script>

{#if files.length === 0}
  <p class="kp-empty">Aucun document. Uploadez des fichiers ou collez du texte ci-dessous.</p>
{:else}
  {#each files as f (f.path)}
    <div class="kp-file">
      <div class="kp-file-info">
        <span class="kp-file-name">{displayName(f)}</span>
        <span class="kp-file-meta">
          {f.chunk_count} chunks · {getRelativeTime(f.created_at)}
          {#if docTypeBadge(f.document_type)}
            <span class="kp-doc-badge" class:protocol={f.document_type === "operating_protocol"} class:voice={f.document_type === "voice_reference"}>
              {docTypeBadge(f.document_type)}
            </span>
          {/if}
          {#if extractionLabel(f.extraction_status)}
            <span class="kp-ext-badge" class:failed={f.extraction_status === "failed"} title={f.extraction_error || ""}>
              · {extractionLabel(f.extraction_status)}
            </span>
          {/if}
        </span>
      </div>
      {#if confirmingDelete === f.path}
        <button class="kp-delete confirming" onclick={() => confirmDelete(f.path)}>Supprimer ?</button>
      {:else}
        <button class="kp-delete" onclick={() => startDelete(f.path)}>&times;</button>
      {/if}
    </div>
  {/each}
{/if}

<style>
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
  .kp-ext-badge { color: var(--ink-70); font-style: italic; }
  .kp-ext-badge.failed { color: var(--vermillon); font-style: normal; cursor: help; }
  .kp-doc-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 0 5px;
    border: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-70);
  }
  .kp-doc-badge.protocol { color: var(--vermillon); border-color: var(--vermillon); }
  .kp-doc-badge.voice    { color: var(--ink); border-color: var(--ink-40); }

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
</style>
