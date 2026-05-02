<script>
  // V1.0 — Panneau contextuel droit du chat affichant le playbook actif
  // pour la source en cours, avec timeline des toggles + détail du toggle
  // courant + règles d'or.
  //
  // Lecture seule : pas d'édition. Pas de migration. Parse la prose markdown
  // au render time (cf. $lib/playbook-parser.js).
  //
  // Toggle courant :
  //   - Si setter a cliqué un toggle dans la mini-timeline → currentToggleOverride
  //   - Sinon → dérivé de currentScenarioType via defaultToggleForScenario
  //   - Reset automatique de l'override au changement de conversation

  import { api } from "$lib/api.js";
  import {
    currentSourceCore,
    currentScenarioType,
    currentConversationId,
    currentToggleOverride,
  } from "$lib/stores/chat.js";
  import { findSourceCore } from "$lib/source-core.js";
  import {
    parsePlaybookProse,
    defaultToggleForScenario,
    shortLabelForToggle,
  } from "$lib/playbook-parser.js";

  /** @type {{ personaId: string | null }} */
  let { personaId } = $props();

  let loading = $state(false);
  let error = $state(/** @type {string | null} */(null));
  /** @type {{ id: string, sections: Array<{ id: string, prose: string, order: number }> } | null} */
  let playbook = $state(null);
  let lastFetchedKey = $state(/** @type {string | null} */(null));

  // Concat de toute la prose des sections (V2.2 supporte multi-sections par
  // playbook ; en V1.0 on les join simplement par double-newline pour parser
  // l'ensemble en un seul flux de toggles).
  let proseFull = $derived.by(() => {
    if (!playbook?.sections?.length) return "";
    return playbook.sections.map((s) => s.prose || "").join("\n\n");
  });

  let parsed = $derived(parsePlaybookProse(proseFull));

  // Toggle effectif = override manuel sinon default dérivé du scenario_type
  let activeToggleIdx = $derived.by(() => {
    if ($currentToggleOverride !== null) {
      const exists = parsed.toggles.some((t) => t.idx === $currentToggleOverride);
      if (exists) return $currentToggleOverride;
    }
    return defaultToggleForScenario($currentScenarioType, parsed.toggles);
  });

  let activeToggle = $derived.by(() => {
    if (activeToggleIdx === null) return null;
    return parsed.toggles.find((t) => t.idx === activeToggleIdx) || null;
  });

  // Reset override au changement de conversation (le default redevient pertinent
  // sur la nouvelle conv, qui a son propre scenario_type). L'effect ne lit
  // que $currentConversationId, donc le set sur currentToggleOverride ne
  // re-déclenche pas l'effect (pas de boucle).
  $effect(() => {
    const _convId = $currentConversationId;
    void _convId;
    currentToggleOverride.set(null);
  });

  // Fetch playbook quand persona ou source change
  $effect(() => {
    const pid = personaId;
    const src = $currentSourceCore;
    if (!pid || !src) {
      playbook = null;
      error = null;
      lastFetchedKey = null;
      return;
    }
    const key = `${pid}::${src}`;
    if (key === lastFetchedKey) return;
    lastFetchedKey = key;
    loadPlaybook(pid, src);
  });

  async function loadPlaybook(pid, src) {
    loading = true;
    error = null;
    playbook = null;
    try {
      const list = await api(`/api/v2/protocol/source-playbooks?persona=${encodeURIComponent(pid)}`);
      const match = (list?.playbooks || []).find((p) => p.source_core === src);
      if (!match) {
        playbook = null;
        return;
      }
      const detail = await api(`/api/v2/protocol/source-playbooks?id=${encodeURIComponent(match.id)}`);
      playbook = detail?.playbook || null;
    } catch (e) {
      error = e?.message || "Erreur de chargement";
      playbook = null;
    } finally {
      loading = false;
    }
  }

  function selectToggle(idx) {
    currentToggleOverride.set(idx);
  }

  let sourceLabel = $derived(findSourceCore($currentSourceCore)?.label || "—");
</script>

<aside class="playbook-panel" aria-label="Contexte playbook">
  <header class="panel-head mono">
    playbook · {sourceLabel}
    {#if playbook}
      <span class="panel-version mono">v{playbook.version || 1}</span>
    {/if}
  </header>

  {#if !$currentSourceCore}
    <div class="panel-empty">
      <p>Choisis une source pour voir le playbook associé.</p>
      <p class="hint">Le sélecteur est juste au-dessus du chat.</p>
    </div>
  {:else if loading}
    <div class="panel-empty">
      <p>chargement…</p>
    </div>
  {:else if error}
    <div class="panel-empty">
      <p>Erreur : {error}</p>
    </div>
  {:else if !playbook}
    <div class="panel-empty">
      <p>Pas encore de playbook pour <strong>{sourceLabel}</strong>.</p>
      {#if personaId}
        <a href={`/brain/${personaId}#reglages`} class="hint-link">Importer un playbook →</a>
      {/if}
    </div>
  {:else if parsed.toggles.length === 0}
    <div class="panel-empty">
      <p>Playbook vide.</p>
    </div>
  {:else}
    <nav class="toggle-timeline" aria-label="Étapes du playbook">
      {#each parsed.toggles as t (t.idx)}
        <button
          type="button"
          class="toggle-pill"
          class:active={t.idx === activeToggleIdx}
          onclick={() => selectToggle(t.idx)}
          title={t.title}
        >
          <span class="toggle-num mono">T{t.idx}</span>
          <span class="toggle-label">{shortLabelForToggle(t)}</span>
        </button>
      {/each}
    </nav>

    {#if !parsed.parsed}
      <p class="parser-warn mono">prose non structurée — affichage brut</p>
    {/if}

    <div class="toggle-detail">
      {#if activeToggle}
        <h3 class="toggle-title">{activeToggle.idx}. {activeToggle.title}</h3>
        <div class="toggle-prose">{activeToggle.prose}</div>
      {/if}
    </div>

    {#if parsed.goldenRules}
      <section class="golden-rules">
        <header class="rules-head mono">⛔ règles d'or (globales)</header>
        <div class="rules-prose">{parsed.goldenRules}</div>
      </section>
    {/if}
  {/if}
</aside>

<style>
  .playbook-panel {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--rule);
    background: var(--paper-subtle);
    font-size: 12px;
    color: var(--ink-80);
    overflow-y: auto;
    overflow-x: hidden;
  }

  .panel-head {
    padding: 10px 14px 6px;
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-60);
    border-bottom: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .panel-version {
    font-size: 9.5px;
    color: var(--ink-40, var(--ink-60));
  }

  .panel-empty {
    padding: 24px 16px;
    color: var(--ink-60);
    font-size: 12px;
    line-height: 1.5;
  }
  .panel-empty p { margin: 0 0 6px; }
  .panel-empty .hint { font-size: 11px; color: var(--ink-40, var(--ink-60)); }
  .hint-link {
    display: inline-block;
    margin-top: 6px;
    color: var(--accent, #c8463a);
    text-decoration: none;
    font-size: 11px;
  }
  .hint-link:hover { text-decoration: underline; }

  .toggle-timeline {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 10px 12px;
    border-bottom: 1px dashed var(--rule);
    flex-shrink: 0;
  }
  .toggle-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    color: var(--ink-60);
    font-size: 10.5px;
    font-family: inherit;
    transition: all 0.12s;
  }
  .toggle-pill:hover {
    color: var(--ink);
    border-color: var(--ink-40, var(--ink-60));
  }
  .toggle-pill.active {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .toggle-num {
    font-size: 9.5px;
    opacity: 0.7;
  }
  .toggle-pill.active .toggle-num { opacity: 0.9; }
  .toggle-label {
    text-transform: lowercase;
  }

  .parser-warn {
    padding: 6px 14px;
    font-size: 9.5px;
    color: var(--accent, #c8463a);
    border-bottom: 1px dashed var(--rule);
  }

  .toggle-detail {
    padding: 14px;
    flex: 1;
    min-height: 0;
  }
  .toggle-title {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.01em;
  }
  .toggle-prose {
    white-space: pre-wrap;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--ink-80);
    word-wrap: break-word;
  }

  .golden-rules {
    margin-top: 8px;
    border-top: 1px solid var(--rule);
    padding: 10px 14px 14px;
    background: color-mix(in srgb, var(--accent, #c8463a) 4%, transparent);
  }
  .rules-head {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-60);
    margin-bottom: 6px;
  }
  .rules-prose {
    white-space: pre-wrap;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink-80);
  }
</style>
