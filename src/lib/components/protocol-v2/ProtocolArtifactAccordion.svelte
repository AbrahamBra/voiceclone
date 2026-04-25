<script>
  // Inline accordion under a Doctrine paragraph that lists the artifacts
  // compiled from this section. Read-only in Chunk 3 ; Chunk 4 will add
  // accept/reject CTAs once the proposition acceptance flow lands.

  import { getRelativeTime } from "$lib/utils.js";

  /** @type {{ artifacts: Array<{id:string, kind:string, severity:string|null, content:object, stats:object, source_quote:string|null, scenarios:string[]|null, is_active:boolean}>, expanded?: boolean }} */
  let { artifacts = [], expanded = false } = $props();

  let isOpen = $state(expanded);

  // Group artifacts by kind for compact display.
  const byKind = $derived.by(() => {
    const groups = new Map();
    for (const a of artifacts || []) {
      if (!a || !a.is_active) continue;
      const key = a.kind || "custom";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  });

  const totalActive = $derived(byKind.reduce((sum, [, list]) => sum + list.length, 0));
  const totalFires = $derived(
    artifacts.reduce((sum, a) => sum + (a?.stats?.fires ?? 0), 0),
  );

  function severityIcon(sev) {
    if (sev === "hard") return "■";
    if (sev === "strong") return "▲";
    if (sev === "light") return "·";
    return "·";
  }

  function summarize(a) {
    // Compact one-line summary based on artifact kind.
    if (!a?.content) return a?.source_quote || "—";
    const c = a.content;
    if (a.kind === "hard_check" || a.kind === "soft_check") {
      return c.rule_text || c.description || JSON.stringify(c).slice(0, 80);
    }
    if (a.kind === "pattern") return c.name || c.signals?.join(", ") || "pattern";
    if (a.kind === "score_axis") return c.name || "axis";
    if (a.kind === "decision_row") return `score ≥ ${c.threshold ?? "?"} → ${c.action ?? "?"}`;
    if (a.kind === "state_transition") return `${c.from ?? "?"} → ${c.to ?? "?"}`;
    if (a.kind === "template_skeleton") return c.scenario || "template";
    return JSON.stringify(c).slice(0, 80);
  }
</script>

{#if totalActive > 0}
  <div class="paa">
    <button
      type="button"
      class="paa-toggle"
      onclick={() => (isOpen = !isOpen)}
      aria-expanded={isOpen}
    >
      <span class="paa-chevron" class:open={isOpen}>›</span>
      <span class="paa-count">{totalActive} artifact{totalActive > 1 ? "s" : ""}</span>
      {#if totalFires > 0}
        <span class="paa-fires">· {totalFires} tir{totalFires > 1 ? "s" : ""} 30j</span>
      {/if}
    </button>

    {#if isOpen}
      <div class="paa-body">
        {#each byKind as [kind, list] (kind)}
          <div class="paa-group">
            <div class="paa-group-head">{kind}</div>
            {#each list as a (a.id)}
              <div class="paa-row" class:hard={a.severity === "hard"} class:strong={a.severity === "strong"}>
                <span class="paa-sev" aria-label={a.severity || "neutral"}>{severityIcon(a.severity)}</span>
                <span class="paa-summary">{summarize(a)}</span>
                {#if a.stats?.last_fired_at}
                  <span class="paa-last">{getRelativeTime(a.stats.last_fired_at)}</span>
                {:else}
                  <span class="paa-last paa-muted">jamais</span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .paa {
    margin: 6px 0 14px;
    border-left: 2px solid var(--rule-strong);
    padding-left: 10px;
  }
  .paa-toggle {
    background: transparent;
    border: none;
    padding: 2px 0;
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .paa-toggle:hover { color: var(--ink-70); }
  .paa-chevron {
    display: inline-block;
    transition: transform 120ms ease;
    font-size: 14px;
    line-height: 1;
  }
  .paa-chevron.open { transform: rotate(90deg); }
  .paa-count { font-variant-numeric: tabular-nums; }
  .paa-fires { color: var(--ink-40); font-variant-numeric: tabular-nums; }
  .paa-body { margin-top: 6px; }
  .paa-group { margin-bottom: 8px; }
  .paa-group:last-child { margin-bottom: 0; }
  .paa-group-head {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
  }
  .paa-row {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    gap: 8px;
    align-items: baseline;
    padding: 3px 0;
    font-family: var(--font);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
    line-height: 1.5;
  }
  .paa-sev {
    font-family: var(--font-mono);
    color: var(--ink-40);
    text-align: center;
  }
  .paa-row.strong .paa-sev { color: var(--ink-70); }
  .paa-row.hard .paa-sev { color: var(--vermillon); }
  .paa-summary { color: var(--ink); }
  .paa-last {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .paa-muted { color: var(--ink-40); opacity: 0.6; }
</style>
