<script>
  // Journal d'apprentissage — chronological log of rule changes.
  //
  // Purpose: now that INSTRUCTION/NEGATIVE shortcut confirmations no longer
  // appear in the DM-simulation thread (migration 027 + api/chat.js flag),
  // the operator needs a persistent "where did my rules go?" view. This is it.
  //
  // Data source: /api/learning-events?persona=<id> (reads learning_events).
  // The user's triggering instruction + system confirmation are ALSO available
  // via /api/conversations?id=<id>&include_meta=true but learning_events is
  // the cleaner canonical source — it has the full payload with source_message.
  //
  // Slides from right, same pattern as RulesPanel, same 320px width.
  // Parent passes:
  //   - personaId: string
  //   - open: boolean
  //   - onClose: () => void

  import { authHeaders } from "$lib/api.js";

  let { personaId = null, open = false, onClose } = $props();

  /** @type {Array<{id: string, event_type: string, payload: any, created_at: string, fidelity_before: number|null, fidelity_after: number|null}>} */
  let events = $state([]);
  let loading = $state(false);
  let error = $state(null);

  let now = $state(Date.now());
  let tickTimer;
  $effect(() => {
    if (open) {
      tickTimer = setInterval(() => { now = Date.now(); }, 30_000); // refresh relative time every 30s
      return () => clearInterval(tickTimer);
    }
  });

  // Fetch on open + persona change. No debounce needed — opens are user actions.
  $effect(() => {
    if (!open || !personaId) return;
    fetchEvents();
  });

  async function fetchEvents() {
    loading = true;
    error = null;
    try {
      const resp = await fetch(`/api/learning-events?persona=${personaId}&limit=100`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      events = Array.isArray(data.events) ? data.events : [];
    } catch (e) {
      error = e.message || "Erreur de chargement";
      events = [];
    } finally {
      loading = false;
    }
  }

  function relTime(iso) {
    if (!iso) return "—";
    const t = typeof iso === "string" ? Date.parse(iso) : iso;
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}j`;
  }

  // Event type → display config. Fallback covers unknown types that may
  // appear over time without requiring this file to know every taxonomy entry.
  function displayFor(eventType) {
    switch (eventType) {
      case "rule_added":    return { glyph: "+", label: "règle ajoutée",    tone: "add" };
      case "rule_weakened": return { glyph: "−", label: "règle affaiblie",  tone: "sub" };
      case "rule_removed":  return { glyph: "×", label: "règle retirée",    tone: "sub" };
      case "rule_graduated":return { glyph: "↑", label: "règle graduée",    tone: "add" };
      case "correction":    return { glyph: "✎", label: "correction",       tone: "neutral" };
      default:              return { glyph: "·", label: eventType.replace(/_/g, " "), tone: "neutral" };
    }
  }

  // Extract a one-line summary from the payload. Each event type stores
  // slightly different shape — we normalize here rather than branching in markup.
  function summarize(evt) {
    const p = evt.payload || {};
    if (evt.event_type === "rule_added") {
      const rules = Array.isArray(p.rules) ? p.rules : [];
      const n = p.count || rules.length || 1;
      // Prefer the synthesized rule text; fall back to source_message for legacy events
      // written before the payload included { rules } (pre-2026-04-20).
      const first = rules[0] || p.source_message || "";
      const trimmed = first.length > 80 ? first.slice(0, 80) + "…" : first;
      return n > 1 ? `${n} règles — "${trimmed}"` : `"${trimmed}"`;
    }
    if (evt.event_type === "rule_weakened") {
      const first = Array.isArray(p.corrections) && p.corrections.length ? p.corrections[0] : "";
      const trimmed = first.length > 80 ? first.slice(0, 80) + "…" : first;
      const n = p.demoted || 1;
      return n > 1 ? `${n} règles affaiblies` : `"${trimmed}"`;
    }
    if (evt.event_type === "correction" && p.correction) {
      const trimmed = p.correction.length > 80 ? p.correction.slice(0, 80) + "…" : p.correction;
      return `"${trimmed}"`;
    }
    // Fallback: compact JSON preview
    const keys = Object.keys(p).filter(k => p[k] !== null && p[k] !== undefined);
    if (!keys.length) return "—";
    return keys.map(k => `${k}: ${String(p[k]).slice(0, 30)}`).join(" · ");
  }

  function fmtDelta(before, after) {
    if (before === null || before === undefined || after === null || after === undefined) return null;
    const d = after - before;
    if (Math.abs(d) < 0.001) return null;
    return `Δfidélité ${d >= 0 ? "+" : ""}${d.toFixed(3)}`;
  }
</script>

{#if open}
  <aside class="journal-panel" aria-label="Journal d'apprentissage">
    <header class="jp-head">
      <div class="jp-title mono">JOURNAL D'APPRENTISSAGE</div>
      <div class="jp-meta mono">
        {#if loading}
          <span>chargement…</span>
        {:else if error}
          <span class="jp-err">{error}</span>
        {:else}
          <span>{events.length} événement{events.length > 1 ? "s" : ""}</span>
        {/if}
      </div>
      <button class="jp-close mono" onclick={() => onClose?.()} aria-label="Fermer">✕</button>
    </header>

    <ol class="jp-list">
      {#if !loading && events.length === 0 && !error}
        <li class="jp-empty">
          <div class="jp-empty-title mono">aucun apprentissage encore</div>
          <div class="jp-empty-desc">
            Chaque règle que tu ajoutes ou affaiblis apparaîtra ici, chronologiquement.
            Les corrections à chaud sont accessibles depuis chaque message via
            <span class="mono">⋯</span>.
          </div>
        </li>
      {/if}

      {#each events as evt (evt.id)}
        {@const d = displayFor(evt.event_type)}
        {@const summary = summarize(evt)}
        {@const delta = fmtDelta(evt.fidelity_before, evt.fidelity_after)}
        <li class="jp-entry" data-tone={d.tone}>
          <div class="jp-entry-head">
            <span class="jp-glyph mono" aria-hidden="true">{d.glyph}</span>
            <span class="jp-label mono">{d.label}</span>
            <span class="jp-when mono" title={evt.created_at}>{relTime(evt.created_at)}</span>
          </div>
          <div class="jp-summary">{summary}</div>
          {#if delta}
            <div class="jp-delta mono">{delta}</div>
          {/if}
        </li>
      {/each}
    </ol>

    <footer class="jp-foot mono">
      <span>historique complet · trié du plus récent au plus ancien</span>
    </footer>
  </aside>
{/if}

<style>
  .journal-panel {
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
    animation: jp-slide-in 0.14s linear;
    box-shadow: -6px 0 24px rgba(20, 20, 26, 0.05);
  }
  @keyframes jp-slide-in {
    from { transform: translateX(12px); opacity: 0.6; }
    to   { transform: translateX(0);    opacity: 1;   }
  }

  .jp-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .jp-title {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--ink);
  }
  .jp-meta {
    font-size: 10.5px;
    color: var(--ink-40);
    justify-self: end;
  }
  .jp-err { color: var(--vermillon); }
  .jp-close {
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
  .jp-close:hover { color: var(--vermillon); }

  .jp-list {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
  }

  .jp-empty {
    padding: 24px 16px;
    border-bottom: none;
  }
  .jp-empty-title {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40);
    margin-bottom: 6px;
  }
  .jp-empty-desc {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--ink-70);
    line-height: 1.5;
  }
  .jp-empty-desc .mono {
    font-family: var(--font-mono);
    background: var(--paper-subtle);
    padding: 0 4px;
  }

  .jp-entry {
    padding: 10px 16px;
    border-bottom: 1px dashed var(--rule);
  }
  .jp-entry:last-child { border-bottom: none; }

  .jp-entry-head {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    gap: 8px;
    align-items: baseline;
  }
  .jp-glyph {
    font-size: 13px;
    line-height: 1;
    color: var(--ink-40);
    text-align: center;
  }
  .jp-entry[data-tone="add"] .jp-glyph { color: var(--vermillon); }
  .jp-entry[data-tone="sub"] .jp-glyph { color: var(--ink-40); }

  .jp-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink);
    font-weight: 600;
  }
  .jp-entry[data-tone="add"] .jp-label { color: var(--vermillon); }

  .jp-when {
    font-size: 10px;
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .jp-summary {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--ink-70);
    line-height: 1.45;
    margin-top: 3px;
    padding-left: 22px;
  }

  .jp-delta {
    font-size: 10px;
    color: var(--ink-40);
    margin-top: 3px;
    padding-left: 22px;
    font-variant-numeric: tabular-nums;
  }

  .jp-foot {
    padding: 10px 16px;
    border-top: 1px solid var(--rule-strong);
    font-size: 10px;
    color: var(--ink-40);
    letter-spacing: 0.04em;
  }

  @media (max-width: 560px) {
    .journal-panel { width: 100%; }
  }
</style>
