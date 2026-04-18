<script>
  import { authHeaders } from "$lib/api.js";

  /** @typedef {{heat: number|null, delta: number|null, state: string|null, direction: string|null}} Current */
  /** @typedef {{kind: string, label: string, quote: string, polarity: "pos"|"neg", delta: number, when: string, message_id: string|null}} Signal */

  // One-way prop from parent. The parent owns the current conversation id.
  // Parent uses `bind:this={thermRef}` to call applyHeatEvent imperatively.
  let { conversationId = null } = $props();

  let current = $state(null);
  let signals = $state([]);
  let totalSignals = $state(0);
  let loading = $state(false);
  let error = $state(null);

  let sheetOpen = $state(false);
  function toggleSheet() { sheetOpen = !sheetOpen; }
  function closeSheet() { sheetOpen = false; }

  // Fetch on mount / on conversationId change
  $effect(() => {
    const id = conversationId;
    if (!id) {
      current = null;
      signals = [];
      totalSignals = 0;
      return;
    }
    loading = true;
    error = null;
    (async () => {
      try {
        const resp = await fetch(`/api/heat?conversation_id=${encodeURIComponent(id)}`, {
          headers: authHeaders(),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        current = data.current;
        signals = data.signals || [];
        totalSignals = data.total_signals || 0;
      } catch (e) {
        error = e.message;
      } finally {
        loading = false;
      }
    })();
  });

  /**
   * Update from an SSE `heat` event. Parent calls this imperatively.
   * @param {{current: Current, new_signal: Signal|null, total_signals: number}} payload
   */
  export function applyHeatEvent(payload) {
    if (payload.current) current = payload.current;
    if (payload.new_signal) {
      signals = [payload.new_signal, ...signals].slice(0, 8);
    }
    if (typeof payload.total_signals === "number") totalSignals = payload.total_signals;
  }

  // Derived display values
  let stateClass = $derived(
    current?.state === "glacé" || current?.state === "froid" ? "froid" :
    current?.state === "tiède" ? "tiede" :
    current?.state === "chaud" || current?.state === "brûlant" ? "chaud" :
    "neutral"
  );
  let stateLabel = $derived(
    current?.state && current?.direction
      ? `${current.state}, ${current.direction}`
      : "en attente"
  );
  let deltaClass = $derived(current?.delta == null ? "" : current.delta >= 0 ? "pos" : "neg");
  let deltaSign = $derived(current?.delta == null ? "" : current.delta >= 0 ? "▲ +" : "▼ ");
  let fillHeight = $derived(current?.heat != null ? Math.round(current.heat * 100) : 0);

  function formatRelative(iso) {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const ms = now - then;
    const mins = Math.round(ms / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    return `il y a ${days} j`;
  }
</script>

<svelte:window onkeydown={(e) => { if (sheetOpen && e.key === "Escape") closeSheet(); }} />

<aside class="therm" aria-label="Thermomètre conversation">
  <div
    class="therm-compact"
    role="button"
    tabindex="0"
    onclick={toggleSheet}
    onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSheet(); } }}
    aria-expanded={sheetOpen}
    aria-controls="heat-sheet"
  >
    <header class="therm-head">
      <span class="therm-title mono">Thermomètre</span>
      <span class="therm-count mono">{totalSignals} signaux</span>
    </header>

    <div class="rail-wrap">
      <div class="rail" aria-hidden="true">
        <div class="rail-fill" style:height="{fillHeight}%"></div>
        <div class="rail-ticks mono">
          <span>1.0</span><span>.75</span><span>.50</span><span>.25</span><span>0</span>
        </div>
      </div>
      <div class="rail-data">
        <div class="rail-score mono">
          {#if current?.heat != null}
            {current.heat.toFixed(2)}<span class="unit">/1</span>
          {:else}
            —<span class="unit">/1</span>
          {/if}
        </div>
        <div class="rail-state {stateClass}">{stateLabel}</div>
        {#if current?.delta != null}
          <div class="rail-delta mono {deltaClass}">
            {deltaSign}{Math.abs(current.delta).toFixed(2)} ce msg
          </div>
        {/if}
      </div>
    </div>
  </div>

  <section class="signals-block">
    <div class="signals-title mono">
      {#if signals.length === 0}
        aucun signal pour l'instant
      {:else}
        journal · {Math.min(signals.length, 8)} derniers
      {/if}
    </div>
    {#each signals as s (s.kind + s.when + (s.message_id || ""))}
      <div class="sig {s.polarity}">
        <div class="text">
          <strong>{s.label}</strong>
          <div class="quote">{s.quote}</div>
        </div>
        <div class="meta">
          <div class="when mono">{formatRelative(s.when)}</div>
          <div class="delta mono">{s.polarity === "pos" ? "+" : "−"}{s.delta.toFixed(2)}</div>
        </div>
      </div>
    {/each}
  </section>

  {#if sheetOpen}
    <div id="heat-sheet" class="sheet" role="dialog" aria-label="Journal des signaux">
      <button class="sheet-close mono" onclick={closeSheet}>fermer</button>
      <section class="signals-block signals-block--sheet">
        <div class="signals-title mono">
          {#if signals.length === 0}
            aucun signal pour l'instant
          {:else}
            journal · {Math.min(signals.length, 8)} derniers
          {/if}
        </div>
        {#each signals as s (s.kind + s.when + (s.message_id || ""))}
          <div class="sig {s.polarity}">
            <div class="text">
              <strong>{s.label}</strong>
              <div class="quote">{s.quote}</div>
            </div>
            <div class="meta">
              <div class="when mono">{formatRelative(s.when)}</div>
              <div class="delta mono">{s.polarity === "pos" ? "+" : "−"}{s.delta.toFixed(2)}</div>
            </div>
          </div>
        {/each}
      </section>
    </div>
  {/if}

  {#if error}
    <p class="err mono">Erreur : {error}</p>
  {/if}
</aside>

<style>
  .therm {
    padding: 18px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--paper);
    font-family: var(--font-ui);
    font-size: 13.5px;
  }
  .mono { font-family: var(--font-mono); }
  .therm-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
  }
  .therm-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-40); }
  .therm-count { font-size: 9.5px; color: var(--ink-30); }

  .rail-wrap { display: grid; grid-template-columns: auto 1fr; gap: 20px; align-items: stretch; padding: 4px 4px 4px 0; }
  .rail { position: relative; width: 3px; height: 210px; background: var(--ink-10); margin-left: 8px; }
  .rail-fill {
    position: absolute; left: -1px; right: -1px; bottom: 0; width: 5px;
    background: var(--ink);
    transition: height 0.6s cubic-bezier(.2,.8,.2,1);
  }
  .rail-ticks {
    position: absolute; right: -22px; top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end;
    font-size: 8.5px; color: var(--ink-30);
  }
  .rail-data { display: flex; flex-direction: column; padding-top: 4px; }
  .rail-score { font-size: 40px; color: var(--ink); line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .rail-score .unit { font-size: 14px; color: var(--ink-40); margin-left: 2px; }
  .rail-state { font-family: var(--font); font-size: 16px; font-style: italic; margin-top: 10px; }
  .rail-state.froid { color: var(--ink-40); }
  .rail-state.tiede { color: var(--warning); }
  .rail-state.chaud { color: var(--vermillon); }
  .rail-state.neutral { color: var(--ink-30); }
  .rail-delta { font-size: 10.5px; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .rail-delta.pos { color: var(--success); }
  .rail-delta.neg { color: var(--vermillon); }

  .signals-block { display: flex; flex-direction: column; gap: 4px; }
  .signals-title {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-40);
    margin-bottom: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--rule);
  }
  .sig {
    display: grid; grid-template-columns: 1fr auto; gap: 8px;
    padding: 8px 0; border-bottom: 1px dotted var(--rule);
    font-family: var(--font); font-size: 13px; align-items: baseline;
  }
  .sig .text strong { color: var(--ink); font-weight: 500; }
  .sig.pos .text strong::before { content: "▲ "; color: var(--success); font-size: 9.5px; }
  .sig.neg .text strong::before { content: "▼ "; color: var(--vermillon); font-size: 9.5px; }
  .sig .quote { color: var(--ink-40); font-style: italic; font-size: 12.5px; margin-top: 2px; }
  .sig .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; }
  .sig .when { font-size: 9px; color: var(--ink-30); text-transform: uppercase; letter-spacing: 0.04em; }
  .sig .delta { font-size: 11px; font-variant-numeric: tabular-nums; }
  .sig.pos .delta { color: var(--success); }
  .sig.neg .delta { color: var(--vermillon); }

  .err { color: var(--vermillon); font-size: 10px; margin-top: auto; }

  /* Mobile: compact horizontal row; signals open in a bottom sheet */
  @media (max-width: 768px) {
    .therm { padding: 8px 12px; gap: 6px; flex-direction: row; align-items: center; border-top: 1px solid var(--rule); }
    .therm-head { padding-bottom: 0; border-bottom: none; flex: 0 0 auto; }
    .therm-compact { cursor: pointer; display: contents; }
    .rail-wrap { display: contents; }
    .rail { display: none; }
    .rail-data { flex-direction: row; align-items: baseline; gap: 10px; padding: 0; }
    .rail-score { font-size: 18px; }
    .rail-state { font-size: 13px; margin-top: 0; }
    .rail-delta { font-size: 10px; margin-top: 0; }
    .signals-block { display: none; }
    .sheet {
      position: fixed; inset: auto 0 0 0;
      background: var(--paper);
      border-top: 1px solid var(--rule-strong);
      padding: 14px 16px 24px;
      max-height: 70vh; overflow-y: auto;
      z-index: 40;
      box-shadow: 0 -8px 24px rgba(0,0,0,0.08);
    }
    .sheet-close {
      background: transparent; border: none; cursor: pointer;
      font-size: 10px; text-transform: uppercase; color: var(--ink-40);
      margin-bottom: 8px;
      letter-spacing: 0.12em;
    }
    .sheet .signals-block--sheet { display: flex; flex-direction: column; }
  }

  @media (min-width: 769px) {
    .sheet { display: none; } /* never shown on desktop */
    .signals-block--sheet { display: none; } /* desktop uses the main signals-block */
  }
</style>
