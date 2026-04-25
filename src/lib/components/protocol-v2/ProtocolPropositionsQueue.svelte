<script>
  // Queue des propositions pending pour un document — groupée par §target_kind,
  // avec filtres et option "voir tout / par groupe".
  //
  // Appelle GET /api/v2/propositions?document=<uuid>&status=pending. Au accept/
  // revise/reject d'une card, on retire la proposition de la liste localement
  // (optimiste, le backend a déjà répondu OK).

  import { api } from "$lib/api.js";
  import ProtocolPropositionCard from "./ProtocolPropositionCard.svelte";

  /** @type {{ documentId: string }} */
  let { documentId } = $props();

  let propositions = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let kindFilter = $state(/** @type {string[]} */ ([]));
  let intentFilter = $state(/** @type {string[]} */ ([]));
  let sortBy = $state("priority"); // priority | recent

  $effect(() => {
    if (documentId) load();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const data = await api(
        `/api/v2/propositions?document=${encodeURIComponent(documentId)}&status=pending`,
      );
      propositions = Array.isArray(data?.propositions) ? data.propositions : [];
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      loading = false;
    }
  }

  function toggle(arr, value) {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  function handleResolved(propositionId) {
    propositions = propositions.filter((p) => p.id !== propositionId);
  }

  // Compute available filter options from current data.
  const availableKinds = $derived.by(() => {
    const set = new Set();
    for (const p of propositions) if (p?.target_kind) set.add(p.target_kind);
    return Array.from(set).sort();
  });
  const availableIntents = $derived.by(() => {
    const set = new Set();
    for (const p of propositions) if (p?.intent) set.add(p.intent);
    return Array.from(set).sort();
  });

  // Filter then sort.
  const filtered = $derived.by(() => {
    const kindSet = kindFilter.length ? new Set(kindFilter) : null;
    const intentSet = intentFilter.length ? new Set(intentFilter) : null;
    return propositions.filter((p) => {
      if (kindSet && !kindSet.has(p.target_kind)) return false;
      if (intentSet && !intentSet.has(p.intent)) return false;
      return true;
    });
  });

  const sorted = $derived.by(() => {
    const list = [...filtered];
    if (sortBy === "recent") {
      list.sort((a, b) => {
        const ta = new Date(a.created_at || 0).getTime();
        const tb = new Date(b.created_at || 0).getTime();
        return tb - ta;
      });
    } else {
      // priority = confidence × count, DESC
      list.sort((a, b) => {
        const sa = (a.confidence || 0) * (a.count || 1);
        const sb = (b.confidence || 0) * (b.count || 1);
        return sb - sa;
      });
    }
    return list;
  });

  // Group by target_kind for display headers.
  const grouped = $derived.by(() => {
    const map = new Map();
    for (const p of sorted) {
      const key = p.target_kind || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return Array.from(map.entries());
  });

  function clearFilters() {
    kindFilter = [];
    intentFilter = [];
  }
</script>

<div class="ppq">
  <header class="ppq-head">
    <div class="ppq-stats">
      <span class="ppq-count" class:filtered={sorted.length !== propositions.length}>
        {sorted.length}<span class="ppq-sep">/</span>{propositions.length}
      </span>
      <span class="ppq-label">propositions pending</span>
    </div>
    <div class="ppq-sort">
      <button
        type="button"
        class="ppq-sort-btn"
        class:on={sortBy === "priority"}
        onclick={() => (sortBy = "priority")}
      >priorité</button>
      <button
        type="button"
        class="ppq-sort-btn"
        class:on={sortBy === "recent"}
        onclick={() => (sortBy = "recent")}
      >récent</button>
    </div>
    <button type="button" class="ppq-refresh" onclick={load} disabled={loading} title="Recharger">
      ↻
    </button>
  </header>

  {#if availableKinds.length > 1 || availableIntents.length > 1}
    <div class="ppq-filters">
      {#if availableKinds.length > 1}
        <fieldset class="ppq-fset">
          <legend>kind</legend>
          <div class="ppq-pills">
            {#each availableKinds as k (k)}
              <button
                type="button"
                class="ppq-pill"
                class:on={kindFilter.includes(k)}
                onclick={() => (kindFilter = toggle(kindFilter, k))}
              >{k}</button>
            {/each}
          </div>
        </fieldset>
      {/if}
      {#if availableIntents.length > 1}
        <fieldset class="ppq-fset">
          <legend>intent</legend>
          <div class="ppq-pills">
            {#each availableIntents as i (i)}
              <button
                type="button"
                class="ppq-pill"
                class:on={intentFilter.includes(i)}
                onclick={() => (intentFilter = toggle(intentFilter, i))}
              >{i}</button>
            {/each}
          </div>
        </fieldset>
      {/if}
      {#if kindFilter.length || intentFilter.length}
        <button type="button" class="ppq-clear" onclick={clearFilters}>Reset</button>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="ppq-state">Chargement…</div>
  {:else if error}
    <div class="ppq-state ppq-error">Erreur : {error}</div>
  {:else if propositions.length === 0}
    <div class="ppq-state">
      Aucune proposition pending. Le cron va déposer ici les apprentissages
      extraits des feedbacks et corrections.
    </div>
  {:else if sorted.length === 0}
    <div class="ppq-state">Aucune proposition ne correspond aux filtres.</div>
  {:else}
    <div class="ppq-groups">
      {#each grouped as [kind, list] (kind)}
        <section class="ppq-group">
          <h3 class="ppq-gh">
            <span>{kind}</span>
            <span class="ppq-gh-count">{list.length}</span>
          </h3>
          <div class="ppq-cards">
            {#each list as p (p.id)}
              <ProtocolPropositionCard
                proposition={p}
                onResolved={() => handleResolved(p.id)}
              />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ppq {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 14px 18px;
    box-sizing: border-box;
    overflow-y: auto;
  }
  .ppq-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .ppq-stats {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .ppq-count {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .ppq-count.filtered { color: var(--vermillon); }
  .ppq-sep { color: var(--ink-40); margin: 0 1px; }
  .ppq-label {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ppq-sort {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .ppq-sort-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
  }
  .ppq-sort-btn:hover { border-color: var(--ink-40); color: var(--ink); }
  .ppq-sort-btn.on {
    background: var(--ink);
    color: var(--bg, #fff);
    border-color: var(--ink);
  }
  .ppq-refresh {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
  }
  .ppq-refresh:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--ink-40);
  }
  .ppq-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

  .ppq-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .ppq-fset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ppq-fset legend {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ppq-pills { display: flex; gap: 4px; flex-wrap: wrap; }
  .ppq-pill {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
  }
  .ppq-pill:hover { border-color: var(--ink-40); color: var(--ink); }
  .ppq-pill.on {
    background: var(--ink);
    color: var(--bg, #fff);
    border-color: var(--ink);
  }
  .ppq-clear {
    align-self: flex-end;
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
  }
  .ppq-clear:hover { color: var(--ink); border-color: var(--ink-40); }

  .ppq-state {
    padding: 24px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    text-align: center;
  }
  .ppq-error { color: var(--vermillon); }

  .ppq-groups {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .ppq-group { display: flex; flex-direction: column; gap: 10px; }
  .ppq-gh {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: normal;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .ppq-gh-count {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .ppq-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
