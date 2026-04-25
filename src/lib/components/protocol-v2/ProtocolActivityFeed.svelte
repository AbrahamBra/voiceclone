<script>
  // Activity feed live — consomme l'SSE /api/v2/protocol/stream (Task 3.5).
  //
  // Parse manuel via fetch + ReadableStream (vs EventSource natif) parce que
  // l'auth du repo est header-based (x-session-token) et EventSource n'accepte
  // pas les headers custom. Pattern aligné sur src/lib/api.js apiStream.
  //
  // Events consommés :
  //   init                  { recent: [...] }       — snapshot initial
  //   artifact_fired        { artifact_id, section_id, fired_at }
  //   proposition_created   { id, target_kind, count }
  //   proposition_resolved  { id, status }
  //   ping                  { t }                   — keep-alive (ignoré côté UI)
  //
  // Side-effect : appelle onArtifactFired(section_id) quand un artifact tire,
  // ce qui permet au parent (ProtocolDoctrine) de déclencher le pulse 2s.

  import { apiStream } from "$lib/api.js";
  import { getRelativeTime } from "$lib/utils.js";

  /** @type {{ documentId: string, onArtifactFired?: (sectionId:string) => void, maxEvents?: number }} */
  let { documentId, onArtifactFired, maxEvents = 50 } = $props();

  let events = $state([]); // most recent first
  let connected = $state(false);
  let error = $state(null);

  let abortCtrl = null;

  $effect(() => {
    if (documentId) connect();
    return () => disconnect();
  });

  function disconnect() {
    if (abortCtrl) {
      try { abortCtrl.abort(); } catch {}
      abortCtrl = null;
    }
    connected = false;
  }

  async function connect() {
    disconnect();
    abortCtrl = new AbortController();
    error = null;

    try {
      const resp = await apiStream(`/api/v2/protocol/stream?document=${encodeURIComponent(documentId)}`, {
        signal: abortCtrl.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!resp.ok || !resp.body) {
        error = `connection failed (${resp.status})`;
        return;
      }
      connected = true;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by \n\n.
        let sep;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          handleFrame(frame);
        }
      }
      connected = false;
    } catch (e) {
      // AbortError when unmounting is normal — don't treat as a real error.
      if (e?.name !== "AbortError") {
        error = e?.message || String(e);
      }
      connected = false;
    }
  }

  function handleFrame(frame) {
    let eventType = "message";
    let dataLines = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    let data = null;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    onEvent(eventType, data);
  }

  function onEvent(kind, data) {
    if (kind === "ping") return;
    if (kind === "init") {
      const recent = Array.isArray(data?.recent) ? data.recent : [];
      events = recent.slice(0, maxEvents);
      return;
    }

    // Live event — prepend, cap at maxEvents.
    const item = { kind, ...data, occurred_at: data?.occurred_at || data?.fired_at || new Date().toISOString() };
    events = [item, ...events].slice(0, maxEvents);

    if (kind === "artifact_fired" && data?.section_id) {
      onArtifactFired?.(data.section_id);
    }
  }

  function iconFor(kind) {
    if (kind === "artifact_fired") return "▶";
    if (kind === "proposition_created") return "+";
    if (kind === "proposition_resolved") return "✓";
    return "·";
  }

  function labelFor(item) {
    if (item.kind === "artifact_fired") {
      return `tir artifact`;
    }
    if (item.kind === "proposition_created") {
      return `proposition · ${item.target_kind || "—"}${item.count ? ` (×${item.count})` : ""}`;
    }
    if (item.kind === "proposition_resolved") {
      return `proposition ${item.status || "résolue"}`;
    }
    return item.kind;
  }
</script>

<div class="paf">
  <header class="paf-head">
    <span class="paf-title">Activité</span>
    <span class="paf-status" class:on={connected} class:off={!connected} aria-label={connected ? "live" : "offline"}>
      {connected ? "live" : "off"}
    </span>
  </header>

  {#if error}
    <div class="paf-error">{error}</div>
  {/if}

  {#if events.length === 0}
    <div class="paf-empty">Pas encore d'activité.</div>
  {:else}
    <ul class="paf-list">
      {#each events as ev, i (ev.artifact_id || ev.id || `${ev.kind}-${ev.occurred_at}-${i}`)}
        <li class="paf-row" class:fired={ev.kind === "artifact_fired"}>
          <span class="paf-icon" aria-hidden="true">{iconFor(ev.kind)}</span>
          <span class="paf-label">{labelFor(ev)}</span>
          <span class="paf-time">{getRelativeTime(ev.occurred_at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .paf {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .paf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .paf-title {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .paf-status {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    padding: 1px 6px;
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .paf-status.on {
    color: #2e8a55;
    background: color-mix(in srgb, #2e8a55 14%, transparent);
  }
  .paf-status.off {
    color: var(--ink-40);
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .paf-error {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--vermillon);
    padding: 4px 0;
  }
  .paf-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    opacity: 0.6;
    padding: 6px 0;
  }
  .paf-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-height: 0;
  }
  .paf-row {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    gap: 6px;
    align-items: baseline;
    padding: 4px 4px;
    border-radius: 2px;
    font-family: var(--font);
    font-size: var(--fs-tiny);
    color: var(--ink-70);
    line-height: 1.4;
  }
  .paf-row.fired {
    background: color-mix(in srgb, var(--vermillon) 6%, transparent);
  }
  .paf-icon {
    font-family: var(--font-mono);
    color: var(--ink-40);
    text-align: center;
  }
  .paf-row.fired .paf-icon { color: var(--vermillon); }
  .paf-label {
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .paf-time {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
