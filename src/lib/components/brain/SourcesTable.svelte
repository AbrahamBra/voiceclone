<script>
  // SourcesTable — table des docs uploadés (protocol_import_batch) +
  // playbooks (protocol_document avec source_core != NULL).
  //
  // Props :
  //   docs : Array<{ id, filename, doc_kind, chunks_processed,
  //                  propositions_created, propositions_merged,
  //                  identity_chars_added, imported_at }>
  //   playbooks : Array<{ id, name, status, version, created_at }>

  let {
    docs = [],
    playbooks = [],
  } = $props();

  const DOC_KIND_LABEL = {
    persona_context: "context",
    operational_playbook: "playbook",
    icp_audience: "ICP",
    positioning: "positioning",
    generic: "generic",
  };

  const PB_STATUS_LABEL = {
    active: "active",
    draft: "draft",
    archived: "archivé",
  };

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    } catch { return "—"; }
  }

  function fmtChars(n) {
    if (!n) return "—";
    if (n >= 1000) return Math.round(n / 1000) + "k";
    return String(n);
  }
</script>

<div class="sources-wrap">
  {#if docs.length === 0 && playbooks.length === 0}
    <p class="empty">Aucune source. Importe un doc via le bouton "+ importer un doc" du banner.</p>
  {/if}

  {#if docs.length > 0}
    <div class="src-section">
      <p class="src-label">Documents importés ({docs.length})</p>
      <table class="src-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Type</th>
            <th class="num">Chunks</th>
            <th class="num">Props</th>
            <th class="num">Identity</th>
            <th>Importé</th>
          </tr>
        </thead>
        <tbody>
          {#each docs as d (d.id)}
            <tr>
              <td class="filename" title={d.filename}>{d.filename}</td>
              <td class="kind">{DOC_KIND_LABEL[d.doc_kind] || d.doc_kind}</td>
              <td class="num">{d.chunks_processed ?? "—"}</td>
              <td class="num">
                {d.propositions_created ?? "—"}
                {#if d.propositions_merged > 0}<span class="merged">−{d.propositions_merged}</span>{/if}
              </td>
              <td class="num">{fmtChars(d.identity_chars_added)}</td>
              <td class="date">{fmtDate(d.imported_at)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if playbooks.length > 0}
    <div class="src-section">
      <p class="src-label">Playbooks ({playbooks.length})</p>
      <table class="src-table">
        <thead>
          <tr>
            <th>Playbook</th>
            <th>Status</th>
            <th class="num">Version</th>
            <th>Créé</th>
          </tr>
        </thead>
        <tbody>
          {#each playbooks as p (p.id)}
            <tr>
              <td class="filename">{p.name}</td>
              <td class="kind">{PB_STATUS_LABEL[p.status] || p.status}</td>
              <td class="num">v{p.version}</td>
              <td class="date">{fmtDate(p.created_at)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .sources-wrap { margin-top: 14px; }
  .src-section + .src-section { margin-top: 24px; }
  .src-label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 8px;
  }
  .src-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid var(--rule);
    border-radius: 3px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .src-table thead {
    background: var(--paper-subtle, #ecebe4);
  }
  .src-table th {
    padding: 9px 12px;
    text-align: left;
    font-weight: 500;
    color: var(--ink-70);
    border-bottom: 1px solid var(--rule);
    text-transform: lowercase;
    letter-spacing: 0.04em;
    font-size: 10px;
  }
  .src-table th.num { text-align: right; }
  .src-table td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--rule);
    color: var(--ink);
  }
  .src-table tbody tr:last-child td { border-bottom: none; }
  .src-table tbody tr:hover { background: var(--paper-subtle, #ecebe4); }

  .filename {
    font-family: var(--font, Georgia, serif);
    font-size: 13px;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind { color: var(--ink-40); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .merged { color: var(--vermillon-dim, #b43b28); margin-left: 4px; }
  .date { color: var(--ink-40); }

  .empty {
    padding: 28px 16px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    border: 1px dashed var(--rule-strong);
    border-radius: 3px;
  }

  @media (max-width: 700px) {
    .src-table { font-size: 10.5px; }
    .filename { max-width: 180px; }
  }
</style>
