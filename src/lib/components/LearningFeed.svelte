<script>
  import { api } from "$lib/api.js";
  import { getRelativeTime } from "$lib/utils.js";

  let { personaId, pollMs = 8000, limit = 30 } = $props();

  let events = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let pollTimer = null;

  async function load() {
    if (!personaId) return;
    try {
      const res = await api(`/api/learning-events?persona=${personaId}&limit=${limit}`);
      events = res.events || [];
      error = null;
    } catch (e) {
      error = e?.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!personaId) return;
    load();
    pollTimer = setInterval(load, pollMs);
    return () => { if (pollTimer) clearInterval(pollTimer); };
  });

  /** Build a human-readable line per event type. */
  function eventLabel(ev) {
    const p = ev.payload || {};
    switch (ev.event_type) {
      case "rule_added": {
        const n = p.count || 1;
        return { icon: "✨", title: n === 1 ? "Règle ajoutée" : `${n} règles ajoutées`, detail: p.source_message };
      }
      case "rule_weakened": {
        const first = (p.corrections || [])[0] || "";
        return { icon: "⚠️", title: p.demoted === 1 ? "Règle affaiblie" : `${p.demoted} règles affaiblies`, detail: first };
      }
      case "correction_saved": {
        const n = p.count || 1;
        const src = p.source || "chat";
        return { icon: "💬", title: n === 1 ? `Correction captée (${src})` : `${n} corrections captées (${src})`, detail: p.text };
      }
      case "consolidation_run": {
        const n = p.promoted || 0;
        const rules = (p.rules || []).slice(0, 2).join(" · ");
        return { icon: "🧠", title: n === 1 ? "Règle consolidée" : `${n} règles consolidées`, detail: rules };
      }
      case "consolidation_reverted": {
        return { icon: "↩️", title: "Consolidation annulée", detail: `raison : ${p.reason || "inconnue"}` };
      }
      default:
        return { icon: "•", title: ev.event_type, detail: null };
    }
  }

  function fidelityDelta(ev) {
    if (ev.fidelity_before == null || ev.fidelity_after == null) return null;
    const d = ev.fidelity_after - ev.fidelity_before;
    return { before: ev.fidelity_before, after: ev.fidelity_after, delta: d };
  }
</script>

<div class="feed">
  <div class="header">
    <h3>Flux d'apprentissage</h3>
    {#if loading && events.length === 0}
      <span class="muted">Chargement...</span>
    {/if}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {:else if events.length === 0 && !loading}
    <div class="empty">
      Aucun apprentissage pour le moment.<br />
      <span class="muted">Corrige un message pour voir le clone apprendre en direct.</span>
    </div>
  {:else}
    <ul>
      {#each events as ev (ev.id)}
        {@const lbl = eventLabel(ev)}
        {@const fid = fidelityDelta(ev)}
        <li class="event" data-type={ev.event_type}>
          <div class="row">
            <span class="icon">{lbl.icon}</span>
            <span class="title">{lbl.title}</span>
            <span class="time muted">{getRelativeTime(ev.created_at)}</span>
          </div>
          {#if lbl.detail}
            <div class="detail">{lbl.detail}</div>
          {/if}
          {#if fid}
            <div class="fidelity">
              Fidélité <strong>{fid.before} → {fid.after}</strong>
              <span class:up={fid.delta > 0} class:down={fid.delta < 0} class:flat={fid.delta === 0}>
                {fid.delta > 0 ? "+" : ""}{fid.delta}
              </span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .feed { display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.875rem; }
  .header { display: flex; justify-content: space-between; align-items: baseline; }
  .header h3 { margin: 0; font-size: 0.875rem; font-weight: 600; }
  .muted { color: var(--text-muted, #888); font-size: 0.75rem; }
  .error { color: #c44; padding: 0.5rem; border: 1px solid #e99; border-radius: 4px; }
  .empty { padding: 1rem 0.5rem; color: var(--text-muted, #888); text-align: center; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .event {
    padding: 0.5rem 0.625rem; border-radius: 6px;
    background: var(--bg-subtle, rgba(0,0,0,0.02));
    border-left: 2px solid var(--border, #ddd);
  }
  .event[data-type="rule_added"]           { border-left-color: #3b82f6; }
  .event[data-type="rule_weakened"]        { border-left-color: #f59e0b; }
  .event[data-type="correction_saved"]     { border-left-color: #8b5cf6; }
  .event[data-type="consolidation_run"]    { border-left-color: #10b981; }
  .event[data-type="consolidation_reverted"]{ border-left-color: #ef4444; }
  .row { display: flex; align-items: baseline; gap: 0.5rem; }
  .icon { flex-shrink: 0; }
  .title { font-weight: 500; flex: 1; }
  .time { flex-shrink: 0; }
  .detail {
    margin-top: 0.25rem; font-size: 0.8125rem;
    color: var(--text-secondary, #555);
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .fidelity { margin-top: 0.25rem; font-size: 0.75rem; color: var(--text-muted, #888); }
  .fidelity .up { color: #10b981; font-weight: 600; }
  .fidelity .down { color: #ef4444; font-weight: 600; }
  .fidelity .flat { color: var(--text-muted, #888); }
</style>
