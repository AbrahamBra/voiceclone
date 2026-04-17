<script>
  // Persistent rules panel. Not a modal. Slides in from the right, stays pinned
  // while the chat continues underneath.
  //
  // Parent passes:
  //   - ruleStats: { [ruleName]: { count: number, lastFiredAt: number|null, lastDetail: string|null, lastSeverity: string|null } }
  //   - open: boolean
  //   - onClose: () => void

  let { open = false, ruleStats = {}, onClose } = $props();

  // Catalogue des règles tracées par lib/checks.js + lib/fidelity.js
  // (le nom reste en anglais car c'est l'identifiant technique envoyé par le
  // pipeline — mais label et desc sont en français pour l'UI.)
  const RULE_CATALOG = [
    { name: "forbidden_word",  severity: "hard",   label: "mot interdit",     desc: "mot banni par le persona" },
    { name: "self_reveal",     severity: "hard",   label: "auto-révélation",  desc: "admet être une IA" },
    { name: "prompt_leak",     severity: "hard",   label: "fuite de prompt",  desc: "révèle ses instructions" },
    { name: "ai_cliches",      severity: "light",  label: "clichés IA",       desc: "crucial · n'hésitez pas · etc." },
    { name: "ai_patterns_fr",  severity: "light",  label: "patterns IA fr",   desc: "formules LLM françaises" },
    { name: "markdown",        severity: "light",  label: "markdown",         desc: "**gras** / #titres / listes" },
    { name: "fidelity_drift",  severity: "strong", label: "dérive fidélité",  desc: "cosinus < 0.72 vs corpus" },
  ];

  let now = $state(Date.now());
  let timer;
  $effect(() => {
    if (open) {
      timer = setInterval(() => { now = Date.now(); }, 1000);
      return () => clearInterval(timer);
    }
  });

  function relTime(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  }

  let totalFirings = $derived(
    RULE_CATALOG.reduce((n, r) => n + (ruleStats[r.name]?.count || 0), 0)
  );
</script>

{#if open}
  <aside class="rules-panel" aria-label="Règles actives">
    <header class="rp-head">
      <div class="rp-title mono">MOTEUR DE RÈGLES</div>
      <div class="rp-meta mono">
        <span>{totalFirings} déclenchements</span>
        <span class="sep">·</span>
        <span>{RULE_CATALOG.length} règles</span>
      </div>
      <button class="rp-close mono" onclick={() => onClose?.()} aria-label="Fermer">✕</button>
    </header>

    <ul class="rp-list">
      {#each RULE_CATALOG as rule}
        {@const stats = ruleStats[rule.name] || { count: 0, lastFiredAt: null, lastDetail: null, lastSeverity: null }}
        {@const fired = stats.count > 0}
        {@const sevLabel = rule.severity === "hard" ? "dur" : rule.severity === "strong" ? "fort" : "léger"}
        <li class="rp-rule" class:fired>
          <div class="rp-rule-head">
            <span class="rp-rule-tick" aria-hidden="true">{fired ? "●" : "○"}</span>
            <span class="rp-rule-name mono">{rule.label}</span>
            <span class="rp-rule-sev mono sev-{rule.severity}">{sevLabel}</span>
            <span class="rp-rule-count mono">{stats.count}</span>
          </div>
          <div class="rp-rule-desc">{rule.desc}</div>
          {#if fired}
            <div class="rp-rule-last">
              <span class="rp-rule-when mono">{relTime(stats.lastFiredAt)}</span>
              {#if stats.lastDetail}
                <span class="rp-rule-detail mono">{stats.lastDetail}</span>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <footer class="rp-foot mono">
      <span>compteurs remis à zéro par conversation</span>
    </footer>
  </aside>
{/if}

<style>
  .rules-panel {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: 320px;
    max-width: 90vw;
    background: var(--paper);
    border-left: 1px solid var(--rule-strong);
    z-index: 30;
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    animation: slide-in 0.14s linear;
    box-shadow: -6px 0 24px rgba(20, 20, 26, 0.05);
  }
  @keyframes slide-in {
    from { transform: translateX(12px); opacity: 0.6; }
    to   { transform: translateX(0);    opacity: 1;   }
  }

  .rp-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .rp-title {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--ink);
  }
  .rp-meta {
    font-size: 10.5px;
    color: var(--ink-40);
    justify-self: end;
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
  }
  .rp-meta .sep { opacity: 0.4; }
  .rp-close {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 14px;
    cursor: pointer;
    padding: 8px 10px;
    min-width: var(--touch-min);
    min-height: var(--touch-min);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.08s linear;
  }
  .rp-close:hover { color: var(--vermillon); }

  .rp-list {
    flex: 1;
    list-style: none;
    padding: 4px 0;
    overflow-y: auto;
  }

  .rp-rule {
    padding: 10px 16px 10px;
    border-bottom: 1px dashed var(--rule);
    color: var(--ink-40);
  }
  .rp-rule:last-child { border-bottom: none; }

  .rp-rule-head {
    display: grid;
    grid-template-columns: 14px auto auto 1fr;
    align-items: baseline;
    gap: 8px;
  }
  .rp-rule-tick { color: var(--ink-20); font-size: 10px; line-height: 1; }
  .rp-rule-name { color: var(--ink-70); font-size: 12px; }
  .rp-rule-sev {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 1px 5px;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
  }
  .sev-hard   { }
  .sev-strong { }
  .sev-light  { }
  .rp-rule-count {
    justify-self: end;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink-40);
  }

  .rp-rule-desc {
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--ink-40);
    margin-top: 4px;
    padding-left: 22px;
    line-height: 1.4;
  }

  .rp-rule-last {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 4px 0 0 22px;
    font-size: 10.5px;
  }
  .rp-rule-when { color: var(--vermillon); font-weight: 600; }
  .rp-rule-detail {
    color: var(--ink-70);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .rp-rule.fired {
    background: color-mix(in srgb, var(--vermillon) 3%, transparent);
  }
  .rp-rule.fired .rp-rule-tick { color: var(--vermillon); }
  .rp-rule.fired .rp-rule-name { color: var(--vermillon); font-weight: 600; }
  .rp-rule.fired .rp-rule-sev  { color: var(--vermillon); border-color: var(--vermillon); }
  .rp-rule.fired .rp-rule-count { color: var(--vermillon); }

  .rp-foot {
    padding: 10px 16px;
    border-top: 1px solid var(--rule-strong);
    font-size: 10px;
    color: var(--ink-40);
    letter-spacing: 0.04em;
  }

  @media (max-width: 560px) {
    .rules-panel { width: 100%; }
  }
</style>
