<script>
  // Doctrine view — la source de vérité narrative du protocole d'une persona.
  //
  // Layout 3 zones :
  //   TOC gauche (avec indicateur santé par §) | prose centrale | slot droit (Activity feed Task 3.6)
  //
  // Live pulse 2s sur le paragraphe d'une section quand un artifact tire en prod.
  // L'appelant (page chat ou Task 3.7 shim) déclenche le pulse via la fonction
  // `triggerPulse(sectionId)` exposée. Task 3.6 wirera l'SSE à cet entrypoint.

  import { api } from "$lib/api.js";
  import ProtocolArtifactAccordion from "./ProtocolArtifactAccordion.svelte";

  /** @type {{ personaId: string }} */
  let { personaId } = $props();

  let document = $state(null);
  let sections = $state([]);
  let pendingPropositionsCount = $state(0);
  let loading = $state(true);
  let error = $state(null);
  let activeSectionId = $state(null);
  let pulsedSectionId = $state(null);

  let pulseTimer = null;

  $effect(() => {
    if (personaId) load();
  });
  $effect(() => () => {
    if (pulseTimer) clearTimeout(pulseTimer);
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const data = await api(`/api/v2/protocol?persona=${personaId}`);
      document = data.document;
      sections = data.sections || [];
      pendingPropositionsCount = data.pendingPropositionsCount || 0;
      if (!activeSectionId && sections[0]) activeSectionId = sections[0].id;
    } catch (e) {
      error = e?.message || String(e);
    } finally {
      loading = false;
    }
  }

  // Public API — called by parent (eventually wired to SSE in Task 3.6).
  export function triggerPulse(sectionId) {
    pulsedSectionId = sectionId;
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      pulsedSectionId = null;
      pulseTimer = null;
    }, 2000);
  }

  // Health indicator per section : computed from artifacts stats.
  // Conventions :
  //   green  — at least one artifact fired in the last 30 days
  //   amber  — has artifacts but none fired recently
  //   gray   — section has no compiled artifacts (prose only)
  function healthOf(section) {
    const artifacts = section.artifacts || [];
    if (artifacts.length === 0) return "gray";
    const now = Date.now();
    const recent = artifacts.some((a) => {
      const last = a?.stats?.last_fired_at;
      if (!last) return false;
      return now - new Date(last).getTime() < 30 * 24 * 60 * 60 * 1000;
    });
    return recent ? "green" : "amber";
  }

  function scrollToSection(id) {
    activeSectionId = id;
    const el = window.document.getElementById(`pd-section-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<div class="pd">
  {#if loading}
    <div class="pd-loading">Chargement du protocole…</div>
  {:else if error}
    <div class="pd-error">Erreur : {error}</div>
  {:else if !document}
    <div class="pd-empty">Aucun protocole actif pour cette persona.</div>
  {:else}
    <aside class="pd-toc" aria-label="Table des matières">
      <div class="pd-toc-head">
        <span class="pd-toc-title">Doctrine</span>
        {#if pendingPropositionsCount > 0}
          <span class="pd-pending">{pendingPropositionsCount} prop.</span>
        {/if}
      </div>
      <ul class="pd-toc-list">
        {#each sections as section (section.id)}
          <li>
            <button
              type="button"
              class="pd-toc-item"
              class:active={activeSectionId === section.id}
              onclick={() => scrollToSection(section.id)}
            >
              <span class="pd-health" data-health={healthOf(section)} aria-hidden="true"></span>
              <span class="pd-toc-label">{section.heading || section.kind}</span>
              <span class="pd-toc-kind">{section.kind}</span>
            </button>
          </li>
        {/each}
      </ul>
    </aside>

    <main class="pd-prose">
      {#each sections as section (section.id)}
        <section
          id="pd-section-{section.id}"
          class="pd-section"
          class:pulsed={pulsedSectionId === section.id}
        >
          {#if section.heading}
            <h2 class="pd-h">{section.heading}</h2>
          {/if}
          <div class="pd-kind-badge">{section.kind}</div>
          {#if section.prose}
            <div class="pd-text">
              {#each section.prose.split(/\n\n+/) as para}
                <p>{para}</p>
              {/each}
            </div>
          {:else}
            <div class="pd-empty-prose">— prose vide —</div>
          {/if}
          <ProtocolArtifactAccordion artifacts={section.artifacts || []} />
        </section>
      {/each}
    </main>

    <aside class="pd-side" aria-label="Activity feed">
      <div class="pd-side-head">Activité</div>
      <div class="pd-side-placeholder">
        feed live arrive Task 3.6
      </div>
    </aside>
  {/if}
</div>

<style>
  .pd {
    display: grid;
    grid-template-columns: 220px 1fr 260px;
    gap: 24px;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .pd-loading, .pd-error, .pd-empty {
    grid-column: 1 / -1;
    padding: 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
  }

  .pd-error { color: var(--vermillon); }

  /* TOC */
  .pd-toc {
    border-right: 1px solid var(--rule-strong);
    padding: 14px 12px;
    overflow-y: auto;
  }
  .pd-toc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .pd-toc-title {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .pd-pending {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--vermillon);
    background: color-mix(in srgb, var(--vermillon) 12%, transparent);
    padding: 1px 6px;
    border-radius: 2px;
  }
  .pd-toc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .pd-toc-item {
    width: 100%;
    background: transparent;
    border: none;
    padding: 6px 6px;
    text-align: left;
    cursor: pointer;
    display: grid;
    grid-template-columns: 8px 1fr auto;
    gap: 8px;
    align-items: baseline;
    border-radius: 2px;
    color: var(--ink-70);
    font-size: var(--fs-tiny);
    font-family: var(--font);
  }
  .pd-toc-item:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink); }
  .pd-toc-item.active {
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    color: var(--ink);
  }
  .pd-health {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-40);
    align-self: center;
  }
  .pd-health[data-health="green"] { background: #4caf78; }
  .pd-health[data-health="amber"] { background: #d0a248; }
  .pd-health[data-health="gray"]  { background: var(--ink-40); opacity: 0.5; }
  .pd-toc-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pd-toc-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
  }

  /* Prose */
  .pd-prose {
    overflow-y: auto;
    padding: 18px 24px;
    max-width: 760px;
  }
  .pd-section {
    padding: 14px 0;
    border-bottom: 1px solid var(--rule-strong);
    transition: background-color 280ms ease-out;
    border-radius: 4px;
    padding-left: 12px;
    padding-right: 12px;
  }
  .pd-section:last-child { border-bottom: none; }
  .pd-section.pulsed {
    background: color-mix(in srgb, var(--vermillon) 8%, transparent);
    transition: background-color 80ms ease-in;
  }
  .pd-h {
    font-size: var(--fs-h2, 18px);
    color: var(--ink);
    margin: 0 0 4px;
    line-height: 1.2;
  }
  .pd-kind-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
  }
  .pd-text p {
    margin: 0 0 10px;
    color: var(--ink);
    font-size: var(--fs-small);
    line-height: 1.6;
  }
  .pd-text p:last-child { margin-bottom: 0; }
  .pd-empty-prose {
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    color: var(--ink-40);
    padding: 6px 0;
  }

  /* Activity feed slot (Task 3.6 will fill this) */
  .pd-side {
    border-left: 1px solid var(--rule-strong);
    padding: 14px 12px;
    overflow-y: auto;
  }
  .pd-side-head {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
  }
  .pd-side-placeholder {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    opacity: 0.6;
    padding: 8px 0;
  }

  /* Responsive : mobile = TOC en drawer (caché en lecture seule, pas d'édit mobile) */
  @media (max-width: 900px) {
    .pd { grid-template-columns: 1fr; }
    .pd-toc, .pd-side { display: none; }
    .pd-prose { max-width: 100%; padding: 14px; }
  }
</style>
