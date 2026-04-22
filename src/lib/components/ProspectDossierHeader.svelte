<script>
  // Header pinné du dossier prospect. Affiche meta éditable inline
  // (nom / stage / note) + dernier contact + heat + compteur corrections.
  // Le ScenarioSwitcher vit désormais dans ChatTopBar (scope persona, pas prospect).

  let {
    conversation = null,      // { id, prospect_name, stage, note, last_message_at, stage_auto, ... }
    feedbackCount = 0,        // dérivé (passé par parent depuis FeedbackRail)
    heat = null,              // { state: 'cold'|'warm'|'hot', delta: number|null }
    onUpdate,                 // (patch) => Promise — parent relais vers /api/conversations PATCH
    onToggleRail,             // callback pour toggler le rail feedback en mobile
  } = $props();

  // Slug→label map. Aligné sur les 5 slugs canoniques définis dans lib/stage.js
  // (source de vérité serveur). Un stage non-slug = override manuel texte libre.
  const STAGE_LABELS = {
    to_contact: "à contacter",
    first_message: "1er message",
    in_conv: "en conv",
    follow_up: "relance",
    closing: "closing",
  };
  function stageLabel(value) {
    if (!value) return "";
    return STAGE_LABELS[value] || value;
  }

  // Local editable state — synced on blur/enter.
  let localName = $state(conversation?.prospect_name || "");
  let localStage = $state(conversation?.stage || "");
  let localNote = $state(conversation?.note || "");
  let editingField = $state(null); // 'name' | 'stage' | 'note' | null
  let stageIsAuto = $derived(conversation?.stage_auto !== false);

  $effect(() => {
    // Re-sync if conversation prop changes (operator selected another conv)
    localName = conversation?.prospect_name || "";
    localStage = conversation?.stage || "";
    localNote = conversation?.note || "";
  });

  async function commit(field, value) {
    editingField = null;
    const trimmed = (value || "").trim();
    if (trimmed === (conversation?.[field] || "")) return;
    await onUpdate?.({ [field]: trimmed });
  }

  async function resetStageToAuto() {
    await onUpdate?.({ stage_auto: true });
  }

  function fmtRelative(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `il y a ${days}j`;
  }

  let heatLabel = $derived.by(() => {
    if (!heat?.state) return null;
    if (heat.state === "cold") return { emoji: "❄", text: "froid" };
    if (heat.state === "warm") return { emoji: "◐", text: "tiède" };
    if (heat.state === "hot")  return { emoji: "●", text: "chaud" };
    return null;
  });
</script>

<header class="dossier-head mono">
  <div class="row-1">
    {#if editingField === "name"}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field-input name"
        bind:value={localName}
        onblur={() => commit("prospect_name", localName)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { localName = conversation?.prospect_name || ""; editingField = null; } }}
        autofocus
      />
    {:else}
      <button class="field-display name" onclick={() => editingField = "name"}>
        {localName || "+ nom"}
      </button>
    {/if}

    <span class="sep">·</span>

    {#if editingField === "stage"}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field-input stage"
        bind:value={localStage}
        onblur={() => commit("stage", localStage)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { localStage = conversation?.stage || ""; editingField = null; } }}
        placeholder="stage…"
        autofocus
      />
    {:else if stageIsAuto}
      <!-- Badge auto : pas un bouton d'édition → l'operator doit expliciter
           l'override via double-click (l'UX commune "cliquer" sauvegarderait
           le label auto comme texte manuel, ce qui figerait le stage). -->
      <button
        class="field-display stage stage-auto"
        ondblclick={() => editingField = "stage"}
        title="Auto-dérivé. Double-click pour éditer manuellement."
      >
        {stageLabel(localStage) || "—"}
      </button>
    {:else}
      <button class="field-display stage stage-manual" onclick={() => editingField = "stage"}>
        {localStage || "+ stage"}
      </button>
      <button
        class="stage-reset mono"
        type="button"
        onclick={resetStageToAuto}
        title="Repasser en auto (dérivé des signaux de la conv)"
      >
        ↻ auto
      </button>
    {/if}

    {#if heatLabel}
      <span class="sep">·</span>
      <span class="heat heat-{heat.state}" aria-label="chaleur conversation">
        {heatLabel.emoji} {heatLabel.text}
      </span>
    {/if}

    <span class="sep">·</span>
    <span class="last">dernier : {fmtRelative(conversation?.last_message_at)}</span>
  </div>

  <div class="row-2">
    {#if editingField === "note"}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field-input note"
        bind:value={localNote}
        onblur={() => commit("note", localNote)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { localNote = conversation?.note || ""; editingField = null; } }}
        placeholder="note : ex: 'voit une démo lundi 17h'"
        autofocus
      />
    {:else}
      <button class="field-display note" onclick={() => editingField = "note"}>
        {localNote ? `note : ${localNote}` : "+ note"}
      </button>
    {/if}

    {#if feedbackCount > 0}
      {#if onToggleRail}
        <button class="fb-count-btn mono" type="button" onclick={onToggleRail} title="Voir journal feedback">
          {feedbackCount} correction{feedbackCount === 1 ? "" : "s"} ▸
        </button>
      {:else}
        <span class="fb-count">{feedbackCount} correction{feedbackCount === 1 ? "" : "s"}</span>
      {/if}
    {/if}
  </div>
</header>

<style>
  .dossier-head {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--ink-80);
  }
  .row-1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row-2 { display: flex; align-items: center; gap: 8px; color: var(--ink-60); font-size: 11px; }
  .sep { color: var(--ink-40); }
  .field-display,
  .field-input {
    background: transparent;
    border: none;
    padding: 2px 4px;
    font: inherit;
    color: inherit;
    cursor: text;
    border-bottom: 1px dashed transparent;
  }
  .field-display:hover { border-bottom-color: var(--ink-40); }
  .field-input:focus {
    outline: none;
    border-bottom-color: var(--vermillon);
  }
  .name.field-display,
  .name.field-input { font-weight: 600; color: var(--ink); }
  .stage-auto {
    color: var(--ink-60);
    font-variant: small-caps;
    letter-spacing: 0.04em;
    cursor: default;
    border-bottom-style: dotted;
  }
  .stage-auto:hover { border-bottom-color: var(--ink-40); }
  .stage-manual { color: var(--ink); font-weight: 500; }
  .stage-reset {
    background: transparent;
    border: none;
    padding: 0 4px;
    font-size: 10px;
    color: var(--ink-40);
    cursor: pointer;
  }
  .stage-reset:hover { color: var(--vermillon); }
  .note.field-input,
  .note.field-display { flex: 1; text-align: left; min-width: 0; }
  .heat { font-weight: 500; }
  .heat-cold { color: #4a6fa5; }
  .heat-warm { color: #b37e3b; }
  .heat-hot  { color: var(--vermillon); }
  .fb-count,
  .fb-count-btn { margin-left: auto; font-weight: 500; }
  .fb-count-btn {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .fb-count-btn:hover { color: var(--ink); }
</style>
