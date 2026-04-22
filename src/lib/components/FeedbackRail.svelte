<script>
  // Zone B : journal chrono-inverse des events feedback + pill "règles actives".
  // Hydratation: GET /api/feedback-events?conversation=<id>.
  // Append local via export appendEvent(ev) pour insertion optimiste.
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let {
    conversationId = null,
    activeRules = [],     // Array de { id, name, count }
    onHighlightMessage,   // (msgId) => void
  } = $props();

  let events = $state([]);
  let loading = $state(false);
  let rulesExpanded = $state(false);

  $effect(() => {
    if (!conversationId) { events = []; return; }
    loadEvents();
  });

  async function loadEvents() {
    if (!conversationId) return;
    loading = true;
    try {
      const data = await api(`/api/feedback-events?conversation=${conversationId}`);
      events = Array.isArray(data.events) ? data.events : [];
    } catch {
      showToast?.("Chargement feedback échoué");
    } finally {
      loading = false;
    }
  }

  // Exposé au parent (bind:this) pour append après POST success
  export function appendEvent(ev) {
    events = [ev, ...events];
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function truncate(s, n = 80) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function iconFor(type) {
    switch (type) {
      case "validated": return "✓";
      case "client_validated": return "✓✓";
      case "excellent": return "★";
      case "corrected": return "✎";
      case "saved_rule": return "📏";
      default: return "·";
    }
  }

  function labelFor(type) {
    switch (type) {
      case "validated": return "validé";
      case "client_validated": return "c'est ça";
      case "excellent": return "excellent";
      case "corrected": return "corrigé";
      case "saved_rule": return "règle enregistrée";
      default: return type;
    }
  }
</script>

<aside class="feedback-rail" aria-label="Journal feedback">
  <header class="rail-head mono">feedback</header>

  {#if activeRules.length > 0}
    <div class="rules-pill">
      <button
        class="pill-btn mono"
        aria-expanded={rulesExpanded}
        onclick={() => rulesExpanded = !rulesExpanded}
      >
        ● règles actives ({activeRules.length})
        <span class="caret">{rulesExpanded ? "▾" : "▸"}</span>
      </button>
      {#if rulesExpanded}
        <ul class="rules-list">
          {#each activeRules as rule (rule.id)}
            <li class="rule-item">
              <span class="rule-name">{rule.name}</span>
              {#if rule.count > 0}<span class="rule-count">{rule.count}×</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="rail-body">
    {#if loading && events.length === 0}
      <p class="rail-empty">chargement…</p>
    {:else if events.length > 0}
      <ul class="event-list">
        {#each events as ev (ev.id)}
          <li class="event" class:event-excellent={ev.event_type === "excellent"} class:event-client-validated={ev.event_type === "client_validated"}>
            <div class="event-head">
              <span class="event-icon">{iconFor(ev.event_type)}</span>
              <span class="event-time mono">{fmtTime(ev.created_at)}</span>
              <span class="event-label">{labelFor(ev.event_type)}</span>
            </div>
            {#if ev.correction_text}
              <div class="event-body">"{truncate(ev.correction_text)}"</div>
            {/if}
            {#if Array.isArray(ev.rules_fired) && ev.rules_fired.length > 0}
              <div class="event-rules mono">fired: {ev.rules_fired.join(", ")}</div>
            {/if}
            <button
              class="event-ref mono"
              type="button"
              onclick={() => onHighlightMessage?.(ev.message_id)}
              title="Voir le message dans le thread"
            >↖ msg</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>

<style>
  .feedback-rail {
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--rule);
    background: var(--paper-subtle);
    font-size: 12px;
    color: var(--ink-80);
    overflow: hidden;
  }
  .rail-head {
    padding: 10px 14px 6px;
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-60);
    border-bottom: 1px solid var(--rule);
  }
  .rules-pill {
    padding: 10px 14px;
    border-bottom: 1px dashed var(--rule);
  }
  .pill-btn {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--ink);
    font-size: 11px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .rules-list {
    list-style: none;
    padding: 6px 0 0;
    margin: 0;
  }
  .rule-item {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 11px;
    color: var(--ink-60);
  }
  .rule-count { color: var(--ink-40); }
  .rule-empty {
    color: var(--ink-40);
    font-style: italic;
    padding: 3px 0;
  }

  .rail-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px 16px;
  }
  .rail-empty {
    color: var(--ink-40);
    font-style: italic;
    font-size: 11px;
  }
  .event-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .event {
    border-left: 2px solid var(--rule);
    padding: 4px 8px;
  }
  /* Client-validated event: vermillon left-border — signal fort "c'est ça". */
  .event-client-validated {
    border-left-color: var(--vermillon);
  }
  .event-client-validated .event-icon { color: var(--vermillon); }
  /* Excellent event: gold left-border + gold icon — signals "pattern à multiplier". */
  .event-excellent {
    border-left-color: #b37e3b;
  }
  .event-excellent .event-icon { color: #b37e3b; }
  .event-head {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 11px;
  }
  .event-icon { font-weight: 600; color: var(--ink); }
  .event-time { color: var(--ink-40); font-size: 10px; }
  .event-label { color: var(--ink-60); }
  .event-body {
    margin-top: 3px;
    font-size: 11px;
    color: var(--ink-80);
  }
  .event-rules {
    margin-top: 3px;
    font-size: 10px;
    color: var(--ink-40);
  }
  .event-ref {
    margin-top: 4px;
    background: transparent;
    border: none;
    padding: 0;
    font-size: 10px;
    color: var(--ink-40);
    cursor: pointer;
    text-decoration: underline;
  }
  .event-ref:hover { color: var(--vermillon); }
</style>
