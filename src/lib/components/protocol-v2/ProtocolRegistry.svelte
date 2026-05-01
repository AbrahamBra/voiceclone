<script>
  // Vue Registre — tableau transversal de tous les artifacts compilés du
  // document. Permet filtrage par kind / severity / section / scenario,
  // recherche plein-texte locale, et navigation (clic ligne → emit
  // jump-to-section / select-artifact via les callbacks props).
  //
  // Performance : rendu naïf (pas de virtualization). Optimisable avec
  // TanStack Virtual si un protocole dépasse 500 artifacts en pratique.
  // Cible Sprint 3 originale (60fps à 1500 lignes) reportée — typique
  // VoiceClone : <100 artifacts/persona aujourd'hui.

  import { getRelativeTime } from "$lib/utils.js";
  import {
    flattenArtifacts,
    filterArtifacts,
    sortArtifactsForRegistry,
    collectFilterOptions,
  } from "$lib/protocol-v2-registry-filter.js";

  /**
   * @type {{
   *   sections: Array<object>,
   *   onJumpToSection?: (sectionId:string) => void,
   * }}
   */
  let { sections = [], onJumpToSection } = $props();

  let kindFilter = $state(/** @type {string[]} */ ([]));
  let sevFilter = $state(/** @type {string[]} */ ([]));
  let sectionFilter = $state("");
  let query = $state("");
  let scenarioInput = $state("");

  const allRows = $derived(flattenArtifacts(sections));
  const options = $derived(collectFilterOptions(allRows));
  const filtered = $derived(
    sortArtifactsForRegistry(
      filterArtifacts(allRows, {
        kinds: kindFilter,
        severities: sevFilter,
        sectionKind: sectionFilter,
        scenario: scenarioInput,
        query,
        activeOnly: true,
      }),
    ),
  );

  function toggle(arr, value) {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  function severityIcon(sev) {
    if (sev === "hard") return "■";
    if (sev === "strong") return "▲";
    if (sev === "light") return "·";
    return "·";
  }

  function summarize(a) {
    const c = a?.content;
    if (!c || typeof c !== "object") return a?.source_quote || "—";
    if (a.kind === "hard_check" || a.kind === "soft_check") {
      return c.rule_text || c.description || JSON.stringify(c).slice(0, 80);
    }
    if (a.kind === "pattern") return c.name || (c.signals || []).join(", ") || "pattern";
    if (a.kind === "score_axis") return c.name || "axis";
    if (a.kind === "decision_row") return `score ≥ ${c.threshold ?? "?"} → ${c.action ?? "?"}`;
    if (a.kind === "state_transition") return `${c.from ?? "?"} → ${c.to ?? "?"}`;
    if (a.kind === "template_skeleton") return c.scenario || "template";
    return JSON.stringify(c).slice(0, 80);
  }

  function fires(row) {
    return row?.stats?.fires ?? 0;
  }

  function clearFilters() {
    kindFilter = [];
    sevFilter = [];
    sectionFilter = "";
    query = "";
    scenarioInput = "";
  }
</script>

<div class="pr">
  <header class="pr-head">
    <div class="pr-stats">
      <span class="pr-count" class:filtered={filtered.length !== allRows.length}>
        {filtered.length}<span class="pr-count-sep">/</span>{allRows.length}
      </span>
      <span class="pr-count-label">artifacts</span>
    </div>
    <input
      type="search"
      class="pr-search"
      bind:value={query}
      placeholder="Rechercher dans la prose, scenarios…"
    />
    {#if kindFilter.length || sevFilter.length || sectionFilter || scenarioInput || query}
      <button type="button" class="pr-clear" onclick={clearFilters}>Reset</button>
    {/if}
  </header>

  <div class="pr-filters">
    <fieldset class="pr-fset">
      <legend>kind</legend>
      <div class="pr-pills">
        {#each options.kinds as k (k)}
          <button
            type="button"
            class="pr-pill"
            class:on={kindFilter.includes(k)}
            onclick={() => (kindFilter = toggle(kindFilter, k))}
          >{k}</button>
        {/each}
      </div>
    </fieldset>

    <fieldset class="pr-fset">
      <legend>severity</legend>
      <div class="pr-pills">
        {#each ["hard", "strong", "light"] as s (s)}
          {#if options.severities.includes(s)}
            <button
              type="button"
              class="pr-pill"
              class:on={sevFilter.includes(s)}
              onclick={() => (sevFilter = toggle(sevFilter, s))}
            >{s}</button>
          {/if}
        {/each}
      </div>
    </fieldset>

    <fieldset class="pr-fset">
      <legend>section</legend>
      <select class="pr-select" bind:value={sectionFilter}>
        <option value="">— toutes —</option>
        {#each options.sectionKinds as sk (sk)}
          <option value={sk}>{sk}</option>
        {/each}
      </select>
    </fieldset>

    <fieldset class="pr-fset">
      <legend>scenario</legend>
      <input
        type="text"
        class="pr-input"
        bind:value={scenarioInput}
        placeholder="ex: dm_cold"
      />
    </fieldset>
  </div>

  {#if filtered.length === 0}
    <div class="pr-empty">
      {allRows.length === 0
        ? "Aucun artifact compilé encore — édite la prose d'une section pour générer des candidats."
        : "Aucun artifact ne correspond aux filtres."}
    </div>
  {:else}
    <table class="pr-table">
      <thead>
        <tr>
          <th class="th-sev">sev</th>
          <th class="th-kind">kind</th>
          <th class="th-summary">contenu</th>
          <th class="th-section">section</th>
          <th class="th-fires">tirs</th>
          <th class="th-last">dernière</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as row (row.artifact_id)}
          <tr
            class="pr-row"
            class:hard={row.severity === "hard"}
            class:strong={row.severity === "strong"}
            onclick={() => onJumpToSection?.(row.section_id)}
          >
            <td class="td-sev">{severityIcon(row.severity)}</td>
            <td class="td-kind">{row.kind}</td>
            <td class="td-summary" title={row.source_quote || ""}>{summarize(row)}</td>
            <td class="td-section">
              <button
                type="button"
                class="pr-jump"
                onclick={(e) => { e.stopPropagation(); onJumpToSection?.(row.section_id); }}
                title="Aller à la section"
              >{row.section_kind}</button>
            </td>
            <td class="td-fires">{fires(row)}</td>
            <td class="td-last">
              {#if row.stats?.last_fired_at}
                {getRelativeTime(row.stats.last_fired_at)}
              {:else}
                <span class="pr-muted">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .pr {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 14px 18px;
    box-sizing: border-box;
  }

  .pr-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .pr-stats {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pr-count {
    font-family: var(--font-mono);
    font-size: var(--fs-small);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .pr-count.filtered { color: var(--vermillon); }
  .pr-count-sep { color: var(--ink-40); margin: 0 1px; }
  .pr-count-label {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pr-search {
    flex: 1;
    max-width: 320px;
    border: 1px solid var(--rule-strong);
    border-radius: 2px;
    padding: 4px 8px;
    font-family: var(--font);
    font-size: var(--fs-tiny);
    color: var(--ink);
    background: var(--bg, #fff);
  }
  .pr-search:focus { outline: none; border-color: var(--ink-40); }
  .pr-clear {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 3px 8px;
    cursor: pointer;
    border-radius: 2px;
  }
  .pr-clear:hover { color: var(--ink); border-color: var(--ink-40); }

  .pr-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .pr-fset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pr-fset legend {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pr-pills { display: flex; gap: 4px; flex-wrap: wrap; }
  .pr-pill {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 2px;
  }
  .pr-pill:hover { border-color: var(--ink-40); color: var(--ink); }
  .pr-pill.on {
    background: var(--ink);
    color: var(--bg, #fff);
    border-color: var(--ink);
  }
  .pr-select, .pr-input {
    border: 1px solid var(--rule-strong);
    border-radius: 2px;
    padding: 3px 6px;
    font-family: var(--font);
    font-size: var(--fs-tiny);
    color: var(--ink);
    background: var(--bg, #fff);
    min-width: 140px;
  }
  .pr-select:focus, .pr-input:focus { outline: none; border-color: var(--ink-40); }

  .pr-empty {
    padding: 20px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    text-align: center;
  }

  .pr-table {
    width: 100%;
    border-collapse: collapse;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    display: block;
    font-size: var(--fs-tiny);
  }
  .pr-table thead, .pr-table tbody { display: table; width: 100%; table-layout: fixed; }
  .pr-table thead {
    position: sticky;
    top: 0;
    background: var(--bg, #fff);
    z-index: 1;
  }
  .pr-table th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 6px 8px;
    border-bottom: 1px solid var(--rule-strong);
    font-weight: normal;
  }
  .th-sev { width: 36px; text-align: center; }
  .th-kind { width: 120px; }
  .th-section { width: 130px; }
  .th-fires { width: 60px; text-align: right; }
  .th-last { width: 100px; }
  .pr-row {
    cursor: pointer;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .pr-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
  .pr-row td { padding: 6px 8px; color: var(--ink-70); }
  .td-sev {
    text-align: center;
    font-family: var(--font-mono);
    color: var(--ink-40);
  }
  .pr-row.strong .td-sev { color: var(--ink-70); }
  .pr-row.hard .td-sev { color: var(--vermillon); }
  .td-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-70);
  }
  .td-summary {
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .td-section {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
  }
  .pr-jump {
    background: transparent;
    border: 1px solid transparent;
    color: var(--ink-70);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 1px 5px;
    cursor: pointer;
    border-radius: 2px;
  }
  .pr-jump:hover { border-color: var(--rule-strong); color: var(--ink); }
  .td-fires {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .td-last {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }
  .pr-muted { color: var(--ink-40); opacity: 0.5; }
</style>
