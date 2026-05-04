<script>
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  // Page /persona/[id]/team — vue per-setter agrégée (corrections + last activity).
  // V2 minimal : table par setter, drawer drill-down V2.1.
  // Spec : docs/superpowers/specs/2026-05-04-brain-v2-cockpit-design.md (§4 Pages séparées)

  let { data } = $props();
  let personaUuid = $derived(data.personaId);

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });

  let period = $state("week");
  let activity = $state(null);
  let loading = $state(false);
  let error = $state(null);

  async function load() {
    if (!personaUuid) return;
    loading = true;
    error = null;
    try {
      activity = await api(`/api/v2/setter-activity?persona=${personaUuid}&period=${period}`);
    } catch (e) {
      console.error("[team/load]", e);
      error = e.message || "erreur";
      showToast(`Activité setters : ${error}`, "error");
    } finally { loading = false; }
  }
  $effect(() => { if (personaUuid) load(); });

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch { return "—"; }
  }

  function goBack() { goto(`/brain/${personaUuid}`); }
</script>

<svelte:head><title>Activité setters</title></svelte:head>

<div class="page">
  <header>
    <button class="back-btn" onclick={goBack}>← cockpit</button>
    <h1>Activité setters</h1>
    <div class="period">
      <button class:active={period === "week"} onclick={() => period = "week"}>semaine</button>
      <button class:active={period === "month"} onclick={() => period = "month"}>mois</button>
    </div>
  </header>

  {#if error}
    <div class="error-banner">
      <strong>Erreur :</strong> {error}
      <button class="retry" onclick={load}>réessayer</button>
    </div>
  {/if}

  {#if loading}
    <p class="loading">Chargement…</p>
  {:else if !activity || activity.by_setter.length === 0}
    <p class="empty">Aucune correction sur cette période.</p>
  {:else}
    <table class="setters">
      <thead>
        <tr>
          <th>Setter</th>
          <th class="num">Corrections</th>
          <th>Dernière activité</th>
        </tr>
      </thead>
      <tbody>
        {#each activity.by_setter as s (s.client_id)}
          <tr>
            <td class="name">{s.name}</td>
            <td class="num">{s.corrections}</td>
            <td class="date">{fmtDate(s.last_activity)}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <p class="totals">
      Total : <strong>{activity.total_corrections}</strong> corrections ·
      <strong>{activity.propositions_generated}</strong> propositions générées ·
      <strong>{activity.propositions_accepted}</strong> acceptées
    </p>
  {/if}
</div>

<style>
  .page { max-width: 900px; margin: 0 auto; padding: 24px 28px 60px; }
  header { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--rule); margin-bottom: 20px; }
  h1 { margin: 0; font-family: var(--font, Georgia, serif); font-size: 22px; font-weight: 500; flex: 1 1 auto; }
  .back-btn { background: transparent; border: 1px solid var(--rule-strong); padding: 6px 10px; font-family: var(--font-mono); font-size: 11px; cursor: pointer; border-radius: 2px; color: var(--ink-40); }
  .back-btn:hover { color: var(--ink); }

  .period { display: flex; gap: 4px; }
  .period button { font-family: var(--font-mono); font-size: 11px; padding: 6px 10px; border: 1px solid var(--rule-strong); background: transparent; cursor: pointer; border-radius: 2px; }
  .period button.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

  .loading, .empty { font-family: var(--font-mono); font-size: 11px; color: var(--ink-40); padding: 24px 0; text-align: center; }

  .error-banner {
    padding: 11px 14px;
    background: var(--paper-subtle, #ecebe4);
    border-left: 3px solid var(--vermillon);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .retry {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
    border-radius: 2px;
  }

  .setters { width: 100%; border-collapse: collapse; border: 1px solid var(--rule); font-family: var(--font-mono); font-size: 12px; }
  .setters thead { background: var(--paper-subtle, #ecebe4); }
  .setters th { padding: 10px 14px; text-align: left; font-weight: 500; color: var(--ink-70); border-bottom: 1px solid var(--rule); font-size: 10px; text-transform: lowercase; letter-spacing: 0.04em; }
  .setters th.num { text-align: right; }
  .setters td { padding: 12px 14px; border-bottom: 1px solid var(--rule); }
  .setters tbody tr:last-child td { border-bottom: none; }
  .setters tbody tr:hover { background: var(--paper-subtle, #ecebe4); cursor: pointer; }
  .name { font-family: var(--font, Georgia, serif); font-size: 14px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .date { color: var(--ink-40); }

  .totals {
    margin-top: 20px;
    padding: 12px 14px;
    background: var(--paper-subtle, #ecebe4);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-70);
    border-left: 3px solid var(--ink);
  }
</style>
