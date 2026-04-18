<script>
  import HeatThermometer from "$lib/components/HeatThermometer.svelte";
  let ref = $state(null);

  const fixtures = {
    empty: { current: { heat: null, delta: null, state: null, direction: null }, signals: [], total_signals: 0 },
    tiede: {
      current: { heat: 0.55, delta: 0.08, state: "tiède", direction: "montant" },
      signals: [
        { kind: "positive_interest", label: "Verbalise intérêt", quote: "Intéressée par un échange avec toi.", polarity: "pos", delta: 0.08, when: new Date(Date.now() - 120000).toISOString(), message_id: "u1" },
        { kind: "question_back", label: "Pose une question en retour", quote: "Comment tu vois les choses ?", polarity: "pos", delta: 0.06, when: new Date(Date.now() - 300000).toISOString(), message_id: "u2" },
      ],
      total_signals: 5,
    },
    chaud: {
      current: { heat: 0.82, delta: 0.22, state: "chaud", direction: "montant" },
      signals: [
        { kind: "accept_call", label: "Accepte le call", quote: "Yes pas de soucis.", polarity: "pos", delta: 0.22, when: new Date().toISOString(), message_id: "u1" },
        { kind: "gives_email", label: "Donne son email", quote: "av…@gmail.com", polarity: "pos", delta: 0.15, when: new Date(Date.now() - 60000).toISOString(), message_id: "u2" },
        { kind: "relance_unanswered", label: "2 relances sans réponse", quote: "2 messages envoyés, pas de retour", polarity: "neg", delta: 0.08, when: new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString(), message_id: null },
      ],
      total_signals: 24,
    },
  };

  let selected = $state("chaud");

  $effect(() => {
    const f = fixtures[selected];
    if (ref && f) ref.applyHeatEvent({ current: f.current, new_signal: null, total_signals: f.total_signals });
  });
</script>

<div class="labo">
  <nav>
    {#each Object.keys(fixtures) as k}
      <button class:active={selected === k} onclick={() => selected = k}>{k}</button>
    {/each}
  </nav>

  <div class="preview">
    <HeatThermometer bind:this={ref} />
  </div>
</div>

<style>
  .labo { display: grid; grid-template-columns: 200px 340px; gap: 24px; padding: 24px; min-height: 100dvh; }
  nav { display: flex; flex-direction: column; gap: 4px; }
  nav button {
    text-align: left; font-family: var(--font-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 8px 12px; border: 1px solid var(--rule-strong); background: var(--paper);
    cursor: pointer;
  }
  nav button.active { background: var(--ink); color: var(--paper); }
  .preview { border: 1px solid var(--rule-strong); background: var(--paper); }
</style>
