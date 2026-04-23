<script>
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { getRelativeTime } from "$lib/utils.js";

  let { personaId } = $props();

  let protocols = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let busy = $state(null); // protocolId currently toggling

  let pollTimer = null;

  $effect(() => { if (personaId) load(); });
  $effect(() => () => { if (pollTimer) clearTimeout(pollTimer); });

  async function load() {
    loading = true;
    error = null;
    try {
      const data = await api(`/api/protocol?persona=${personaId}`);
      protocols = data.protocols || [];
      schedulePoll();
    } catch (e) {
      error = e.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  // Poll every 20s while any protocol is still parsing. Cron runs every 10 min,
  // so in the worst case we catch the flip within 20s after it happens — user
  // can leave the tab and come back, data is always fresh.
  function schedulePoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    const hasWork = protocols.some(p => p.status === "pending");
    if (!hasWork) return;
    pollTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/protocol?persona=${personaId}`);
        protocols = data.protocols || [];
      } catch { /* silent */ }
      schedulePoll();
    }, 20000);
  }

  async function toggle(p) {
    const action = p.is_active ? "deactivate" : "activate";
    busy = p.id;
    try {
      await api(`/api/protocol?id=${p.id}&action=${action}`, { method: "POST" });
      showToast(p.is_active ? "Protocole désactivé" : "Protocole activé");
      await load();
    } catch (e) {
      showToast(e.message || "Erreur");
    } finally {
      busy = null;
    }
  }

  async function remove(p) {
    if (!confirm("Supprimer ce protocole et ses règles ?")) return;
    busy = p.id;
    try {
      await api(`/api/protocol?id=${p.id}`, { method: "DELETE" });
      showToast("Protocole supprimé");
      await load();
    } catch (e) {
      showToast(e.message || "Erreur");
    } finally {
      busy = null;
    }
  }

  function statusLabel(p) {
    if (p.status === "pending") return "parsing en cours";
    if (p.status === "failed") return "parsing échoué";
    if (p.is_active) return "actif";
    return "prêt à activer";
  }

  function checkSummary(rule) {
    const p = rule.check_params || {};
    switch (rule.check_kind) {
      case "counter":    return `${p.what} ≤ ${p.max}`;
      case "max_length": return `${p.chars} chars max`;
      case "structural": return `deny ${p.deny}`;
      case "regex":      return `regex /${(p.pattern || "").slice(0, 28)}${(p.pattern || "").length > 28 ? "…" : ""}/`;
      default:           return rule.check_kind;
    }
  }
</script>

{#if loading}
  <div class="pp-loading">Chargement...</div>
{:else if error}
  <div class="pp-error">
    {error}
    <button class="pp-retry" onclick={load}>Réessayer</button>
  </div>
{:else if protocols.length === 0}
  <div class="pp-empty">
    Aucun protocole opérationnel. Uploadez un playbook dans l'onglet Connaissance
    en choisissant le type <strong>Protocole opérationnel</strong>.
  </div>
{:else}
  {#each protocols as p (p.id)}
    <div class="pp-proto" class:active={p.is_active}>
      <div class="pp-head">
        <div class="pp-head-info">
          <span class="pp-version">v{p.version}</span>
          <span class="pp-status" class:active={p.is_active} class:failed={p.status === 'failed'} class:pending={p.status === 'pending'}>
            {statusLabel(p)}
          </span>
          <span class="pp-meta">
            {p.rules.length} règles · {getRelativeTime(p.created_at)}
            {#if p.parser_confidence}· conf {Math.round(p.parser_confidence * 100)}%{/if}
          </span>
        </div>
        <div class="pp-actions">
          {#if p.status === "parsed"}
            <button class="pp-btn" disabled={busy === p.id} onclick={() => toggle(p)}>
              {p.is_active ? "Désactiver" : "Activer"}
            </button>
          {/if}
          <button class="pp-btn pp-btn-danger" disabled={busy === p.id} onclick={() => remove(p)}>Supprimer</button>
        </div>
      </div>

      {#if p.parse_error}
        <div class="pp-err" title={p.parse_error}>Erreur parsing : {p.parse_error}</div>
      {/if}

      {#if p.rules.length > 0}
        <ul class="pp-rules">
          {#each p.rules as r (r.rule_id)}
            <li class="pp-rule" class:light={r.severity === 'light'} class:strong={r.severity === 'strong'}>
              <div class="pp-rule-main">
                <span class="pp-rule-sev" title={r.severity}>
                  {r.severity === "hard" ? "●" : r.severity === "strong" ? "◐" : "○"}
                </span>
                <span class="pp-rule-desc">{r.description}</span>
              </div>
              <div class="pp-rule-meta">
                <code class="pp-rule-check">{checkSummary(r)}</code>
                {#if r.applies_to_scenarios?.length}
                  <span class="pp-rule-scope">{r.applies_to_scenarios.join(", ")}</span>
                {/if}
              </div>
              {#if r.source_quote}
                <div class="pp-rule-quote" title={r.source_quote}>&laquo; {r.source_quote.slice(0, 120)}{r.source_quote.length > 120 ? "…" : ""} &raquo;</div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/each}
{/if}

<style>
  .pp-loading, .pp-error, .pp-empty {
    padding: 14px;
    font-family: var(--font-mono);
    color: var(--ink-40);
    font-size: var(--fs-tiny);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .pp-empty { text-transform: none; letter-spacing: normal; text-align: left; line-height: 1.5; padding: 12px; }
  .pp-retry {
    display: block; margin: 8px auto 0;
    background: transparent; border: 1px solid var(--rule-strong); color: var(--ink-70);
    padding: 4px 10px; font-family: var(--font-mono); font-size: var(--fs-tiny); cursor: pointer;
  }
  .pp-proto {
    border: 1px solid var(--rule-strong);
    margin: 6px 2px 10px;
    padding: 10px;
    background: var(--paper-subtle);
  }
  .pp-proto.active { border-left: 3px solid var(--vermillon); }
  .pp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .pp-head-info { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: var(--fs-nano); }
  .pp-version { color: var(--ink); font-weight: var(--fw-semi); }
  .pp-status {
    color: var(--ink-40); text-transform: uppercase; letter-spacing: 0.08em;
    padding: 2px 6px; border: 1px solid var(--rule-strong);
  }
  .pp-status.active { color: var(--vermillon); border-color: var(--vermillon); }
  .pp-status.failed { color: var(--vermillon); }
  .pp-status.pending { font-style: italic; }
  .pp-meta { color: var(--ink-40); font-variant-numeric: tabular-nums; }
  .pp-actions { display: flex; gap: 6px; }
  .pp-btn {
    background: transparent; border: 1px solid var(--rule-strong); color: var(--ink-70);
    padding: 4px 10px; font-family: var(--font-mono); font-size: var(--fs-tiny); cursor: pointer;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .pp-btn:hover:not(:disabled) { color: var(--ink); border-color: var(--ink-40); }
  .pp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .pp-btn-danger:hover:not(:disabled) { color: var(--vermillon); border-color: var(--vermillon); }

  .pp-err {
    color: var(--vermillon);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 6px 0;
  }

  .pp-rules { list-style: none; margin: 0; padding: 0; }
  .pp-rule {
    padding: 6px 0;
    border-top: 1px solid var(--rule-strong);
  }
  .pp-rule.light { opacity: 0.7; }
  .pp-rule-main { display: flex; gap: 6px; align-items: flex-start; }
  .pp-rule-sev { font-family: var(--font-mono); color: var(--vermillon); flex-shrink: 0; }
  .pp-rule.strong .pp-rule-sev { color: var(--ink-70); }
  .pp-rule.light .pp-rule-sev { color: var(--ink-40); }
  .pp-rule-desc { font-size: var(--fs-small); color: var(--ink); }
  .pp-rule-meta {
    display: flex; gap: 8px; align-items: center;
    margin-top: 2px; padding-left: 14px;
    font-family: var(--font-mono); font-size: var(--fs-nano); color: var(--ink-40);
  }
  .pp-rule-check { color: var(--ink-70); }
  .pp-rule-scope {
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: 1px 5px; border: 1px solid var(--rule-strong);
  }
  .pp-rule-quote {
    font-family: var(--font);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    font-style: italic;
    padding-left: 14px;
    margin-top: 2px;
  }
</style>
