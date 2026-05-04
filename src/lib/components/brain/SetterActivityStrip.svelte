<script>
  // Strip noir hero compact en haut du cockpit V2.
  // Affiche l'activité agrégée des setters cette semaine + lien drill-down
  // vers /persona/[id]/team.
  //
  // Props :
  //   activity : { total_corrections, propositions_generated, by_setter: [{ name, corrections }] }
  //   loading : bool
  //   onTeamClick : () => void

  let {
    activity = null,
    loading = false,
    onTeamClick = () => {},
  } = $props();

  let setterSummary = $derived(() => {
    if (!activity || !activity.by_setter || activity.by_setter.length === 0) {
      return "Aucun setter actif cette semaine";
    }
    return activity.by_setter.map(s => `${s.name} ${s.corrections}`).join(" · ");
  });
</script>

<div
  class="strip"
  role="button"
  tabindex="0"
  onclick={onTeamClick}
  onkeydown={(e) => e.key === "Enter" && onTeamClick()}
  aria-label="Voir l'activité détaillée des setters"
>
  <div class="left">
    <span class="label">Cette semaine</span>
    {#if loading}
      <span class="phrase loading">Chargement…</span>
    {:else if activity}
      <span class="phrase">
        Tes <strong>{activity.by_setter.length}</strong> setters ont corrigé
        <strong>{activity.total_corrections}</strong> messages →
        <strong>{activity.propositions_generated}</strong> propositions à reviewer
      </span>
    {:else}
      <span class="phrase loading">—</span>
    {/if}
  </div>
  {#if activity && activity.by_setter.length > 0}
    <div class="right">{setterSummary()} →</div>
  {/if}
</div>

<style>
  .strip {
    background: #1a1a1a;
    color: #f5f3e8;
    padding: 10px 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    border: none;
    width: 100%;
    text-align: left;
  }
  .strip:hover { background: #2a2a2a; }
  .strip:focus-visible { outline: 2px solid var(--vermillon); outline-offset: -2px; }

  .label {
    font-size: 9.5px;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: block;
    margin-bottom: 3px;
  }
  .phrase { font-size: 13px; }
  .phrase strong { font-weight: 600; }
  .phrase.loading { opacity: 0.5; }

  .right {
    font-size: 10px;
    opacity: 0.7;
    white-space: nowrap;
    margin-left: 16px;
  }

  @media (max-width: 700px) {
    .strip { flex-direction: column; align-items: flex-start; gap: 6px; }
    .right { margin-left: 0; }
  }
</style>
