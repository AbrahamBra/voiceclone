<script>
  // Hero outcome — le big number "X RDV pris" en haut de la zone construction.
  // Background gradient sombre, font-size 32px serif, delta inline.
  //
  // Props :
  //   outcomes : { rdv_count, rdv_delta }
  //   loading : bool

  let {
    outcomes = null,
    loading = false,
  } = $props();

  let deltaLabel = $derived(() => {
    if (!outcomes) return "";
    const d = outcomes.rdv_delta || 0;
    if (d === 0) return "stable vs semaine dernière";
    const sign = d > 0 ? "+" : "";
    return `${sign}${d} vs semaine dernière`;
  });
</script>

<div class="hero">
  <div class="label">Cette semaine</div>
  {#if loading}
    <div class="big loading">…</div>
  {:else if outcomes}
    <div class="big">{outcomes.rdv_count} RDV pris</div>
    <div class="delta">{deltaLabel()}</div>
  {:else}
    <div class="big loading">—</div>
  {/if}
  {#if outcomes && outcomes.rdv_count === 0}
    <div class="empty-hint">Aucun RDV marqué cette semaine. Tes setters peuvent en marquer depuis la conversation.</div>
  {/if}
</div>

<style>
  .hero {
    background: linear-gradient(135deg, #222, #3a3a3a);
    color: #f5f3e8;
    padding: 18px 14px;
  }
  .label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .big {
    font-family: var(--font, Georgia, serif);
    font-size: 32px;
    font-weight: 500;
    line-height: 1;
    margin: 6px 0 4px;
    letter-spacing: -0.02em;
  }
  .big.loading { opacity: 0.4; }
  .delta {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.8;
  }
  .empty-hint {
    font-family: var(--font-mono);
    font-size: 9.5px;
    opacity: 0.6;
    line-height: 1.5;
    margin-top: 8px;
    font-style: italic;
  }
</style>
