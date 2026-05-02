<script>
  // Calibration view — what each imported doc produced.
  //
  // Reads /api/v2/protocol/import-batches?persona=X and renders one card
  // per batch with :
  //   - filename + doc_kind
  //   - identity-prose enrichment flag (if applicable to this kind)
  //   - props produced (created/merged/silenced) + their resolution
  //     status (pending/accepted/rejected) for accountability
  //   - overlap with other batches : when this batch's props ended up
  //     merging with another batch's, surface that as "fusionné avec X"
  //     so the user can see two docs said the same thing
  //
  // The view is read-only ; arbitration still happens in the
  // Propositions queue (PR 1) but with the doc-level breakdown the user
  // can decide which doc to trust if there's a contradiction.

  import { api } from "$lib/api.js";

  /** @type {{ personaId: string }} */
  let { personaId } = $props();

  let loading = $state(true);
  let error = $state(null);
  let batches = $state([]);

  $effect(() => {
    if (personaId) load();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const data = await api(`/api/v2/protocol/import-batches?persona=${personaId}`);
      batches = data?.batches || [];
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      loading = false;
    }
  }

  const KIND_LABEL = {
    persona_context: "contexte persona",
    operational_playbook: "playbook opérationnel",
    icp_audience: "ICP / audience",
    positioning: "positionnement",
    generic: "générique",
  };

  function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n) => `${n}`.padStart(2, "0");
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return iso;
    }
  }
</script>

<div class="cal">
  {#if loading}
    <div class="cal-msg">Chargement…</div>
  {:else if error}
    <div class="cal-error">Erreur : {error}</div>
  {:else if batches.length === 0}
    <div class="cal-empty">
      <p>Aucun import pour le moment.</p>
      <p class="cal-empty-hint">Utilise <strong>+ importer un doc</strong> en haut à droite. Chaque import apparaîtra ici avec ce qu'il a produit dans le protocole.</p>
    </div>
  {:else}
    <ul class="cal-list">
      {#each batches as b (b.id)}
        <li class="cal-card">
          <header class="cal-card-head">
            <div class="cal-card-title">
              <strong>{b.doc_filename || "(sans nom)"}</strong>
              <span class="cal-card-kind">{KIND_LABEL[b.doc_kind] || b.doc_kind}</span>
            </div>
            <span class="cal-card-date">{formatDate(b.created_at)}</span>
          </header>

          <div class="cal-card-body">
            {#if b.identity_appended}
              <span class="cal-pill cal-pill-identity">
                identité enrichie ({b.identity_chars_added} car.)
              </span>
            {/if}

            <span class="cal-pill" class:cal-pill-zero={b.propositions_created === 0}>
              {b.propositions_created} créée{b.propositions_created > 1 ? "s" : ""}
            </span>
            {#if b.propositions_merged > 0}
              <span class="cal-pill cal-pill-merged">
                {b.propositions_merged} fusionnée{b.propositions_merged > 1 ? "s" : ""}
              </span>
            {/if}
            {#if b.silenced > 0}
              <span class="cal-pill cal-pill-silenced">
                {b.silenced} silencée{b.silenced > 1 ? "s" : ""}
              </span>
            {/if}

            {#if b.pending_count + b.accepted_count + b.rejected_count > 0}
              <div class="cal-card-status">
                en attente {b.pending_count}
                {#if b.accepted_count > 0}· acceptées {b.accepted_count}{/if}
                {#if b.rejected_count > 0}· rejetées {b.rejected_count}{/if}
              </div>
            {/if}

            {#if b.overlap_with && b.overlap_with.length > 0}
              <div class="cal-card-overlap">
                Croisement avec
                {#each b.overlap_with as oid, i (oid)}
                  {@const other = batches.find((x) => x.id === oid)}
                  <span class="cal-card-overlap-item">
                    {other?.doc_filename || oid.slice(0, 8)}
                  </span>{i < b.overlap_with.length - 1 ? " · " : ""}
                {/each}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cal {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
  }
  .cal-msg, .cal-error, .cal-empty {
    padding: 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }
  .cal-error { color: var(--vermillon); }
  .cal-empty p { margin: 0 0 8px; }
  .cal-empty-hint { color: var(--ink-40); }

  .cal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cal-card {
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 12px;
    background: var(--bg, #fff);
  }
  .cal-card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
  }
  .cal-card-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .cal-card-title strong {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-card-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .cal-card-date {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    flex-shrink: 0;
  }

  .cal-card-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }

  .cal-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-70);
  }
  .cal-pill-zero { color: var(--ink-40); }
  .cal-pill-identity {
    color: var(--ink);
    border-color: var(--ink);
  }
  .cal-pill-merged {
    color: var(--ink-70);
    border-color: var(--ink-40);
  }
  .cal-pill-silenced {
    color: var(--ink-40);
    border-style: dashed;
  }

  .cal-card-status {
    flex-basis: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    margin-top: 4px;
  }
  .cal-card-overlap {
    flex-basis: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-70);
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--rule);
  }
  .cal-card-overlap-item {
    color: var(--ink);
  }
</style>
