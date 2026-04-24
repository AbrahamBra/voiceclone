<script>
  import { api } from "$lib/api.js";

  let { personaId, days = 7, pollMs = 15000 } = $props();

  let data = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let timer = null;

  async function load() {
    if (!personaId) return;
    try {
      data = await api(`/api/feedback-roi?persona=${personaId}&days=${days}`);
      error = null;
    } catch (e) {
      error = e?.message || "Erreur";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!personaId) return;
    load();
    timer = setInterval(load, pollMs);
    return () => { if (timer) clearInterval(timer); };
  });

  const POSITIVE_TYPES = new Set(["validated", "validated_edited", "excellent", "client_validated"]);

  function signalsBreakdown(d) {
    if (!d?.signals_in) return { positive: 0, corrections: 0, rules_saved: 0, dismissed: 0 };
    const t = d.signals_in.by_type || {};
    let positive = 0, corrections = 0, rules_saved = 0, dismissed = 0;
    for (const [k, v] of Object.entries(t)) {
      if (POSITIVE_TYPES.has(k)) positive += v;
      else if (k === "corrected") corrections += v;
      else if (k === "saved_rule") rules_saved += v;
      else if (k === "paste_zone_dismissed") dismissed += v;
    }
    return { positive, corrections, rules_saved, dismissed };
  }
</script>

<div class="roi">
  <div class="header">
    <h3>ROI du feedback</h3>
    <span class="window">sur {data?.window_days ?? days}j</span>
  </div>

  {#if loading && !data}
    <div class="muted">Chargement...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if data}
    {@const br = signalsBreakdown(data)}
    {#if data.signals_in.total === 0 && data.rules_graduated === 0}
      <div class="empty">
        Aucun signal cette semaine.<br />
        <span class="muted">Corrige ou valide un message pour alimenter le clone.</span>
      </div>
    {:else}
      <div class="flow">
        <div class="col">
          <div class="big">{data.signals_in.total}</div>
          <div class="lbl">signaux reçus</div>
          {#if data.signals_in.total > 0}
            <div class="sub">
              {#if br.positive}<span>✓ {br.positive} validations</span>{/if}
              {#if br.corrections}<span>✎ {br.corrections} corrections</span>{/if}
              {#if br.rules_saved}<span>💾 {br.rules_saved} règles</span>{/if}
              {#if br.dismissed}<span>⊘ {br.dismissed} dismiss</span>{/if}
            </div>
          {/if}
        </div>
        <div class="arrow">→</div>
        <div class="col">
          <div class="big">{data.rules_graduated}</div>
          <div class="lbl">règle{data.rules_graduated > 1 ? "s" : ""} graduée{data.rules_graduated > 1 ? "s" : ""}</div>
          {#if data.signals_out.entities_boosted > 0}
            <div class="sub"><span>✨ {data.signals_out.entities_boosted} entités boostées</span></div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .roi {
    padding: 0.75rem 0.875rem;
    border-radius: 8px;
    background: var(--bg-subtle, rgba(0,0,0,0.02));
    border: 1px solid var(--border, #e5e7eb);
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }
  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
  .header h3 { margin: 0; font-size: 0.875rem; font-weight: 600; }
  .window { color: var(--text-muted, #888); font-size: 0.75rem; }
  .muted { color: var(--text-muted, #888); }
  .error { color: #c44; padding: 0.5rem; }
  .empty { color: var(--text-muted, #888); text-align: center; padding: 0.5rem 0; font-size: 0.8125rem; }
  .flow { display: flex; align-items: center; gap: 0.75rem; }
  .col { flex: 1; text-align: center; }
  .big { font-size: 1.75rem; font-weight: 700; line-height: 1; color: var(--text-primary, #111); }
  .lbl { font-size: 0.75rem; color: var(--text-secondary, #555); margin-top: 0.125rem; }
  .sub {
    margin-top: 0.375rem; display: flex; flex-direction: column; gap: 0.125rem;
    font-size: 0.7rem; color: var(--text-muted, #888);
  }
  .arrow { font-size: 1.5rem; color: var(--text-muted, #aaa); font-weight: 300; }
</style>
