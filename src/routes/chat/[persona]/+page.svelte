<script>
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { untrack } from "svelte";
  import { get } from "svelte/store";
  import { accessCode } from "$lib/stores/auth.js";
  import { personaConfig, currentPersonaId, personas } from "$lib/stores/persona.js";
  import {
    messages,
    currentConversationId,
    conversations,
    currentScenario,
    currentScenarioType,
    sending,
  } from "$lib/stores/chat.js";
  import { showToast } from "$lib/stores/ui.js";
  import { api, authHeaders } from "$lib/api.js";
  import { track } from "$lib/tracking.js";
  import { streamChat } from "$lib/sse.js";
  import { legacyKeyFor, isScenarioId } from "$lib/scenarios.js";
  import {
    getFidelityBatch,
    prefetchConversation,
    prefetchFeedbackEvents,
    takeConversation,
    takeFeedbackEvents,
  } from "$lib/prefetchCache.js";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import ChatComposer from "$lib/components/ChatComposer.svelte";
  import ProspectDossierHeader from "$lib/components/ProspectDossierHeader.svelte";
  import FeedbackRail from "$lib/components/FeedbackRail.svelte";
  import ConversationSidebar from "$lib/components/ConversationSidebar.svelte";
  import ChatTopBar from "$lib/components/ChatTopBar.svelte";
  // Modals lazy-loaded : tous optionnels / ouverts via interaction utilisateur.
  // Les sortir du bundle initial allège le chunk /chat/[persona] de ~30-40%.
  // Chaque panel est chargé on-demand la 1re fois qu'il est invoqué, puis
  // gardé en mémoire pour les ouvertures suivantes.
  let FeedbackPanel = $state(/** @type {any} */ (null));
  let LeadPanel = $state(/** @type {any} */ (null));
  let CommandPalette = $state(/** @type {any} */ (null));
  let IngestPreviewBubble = $state(/** @type {any} */ (null));
  function loadFeedbackPanel() {
    if (FeedbackPanel) return Promise.resolve();
    return import("$lib/components/FeedbackPanel.svelte").then((m) => { FeedbackPanel = m.default; });
  }
  function loadLeadPanel() {
    if (LeadPanel) return Promise.resolve();
    return import("$lib/components/LeadPanel.svelte").then((m) => { LeadPanel = m.default; });
  }
  function loadCommandPalette() {
    if (CommandPalette) return Promise.resolve();
    return import("$lib/components/CommandPalette.svelte").then((m) => { CommandPalette = m.default; });
  }
  function loadIngestPreviewBubble() {
    if (IngestPreviewBubble) return Promise.resolve();
    return import("$lib/components/IngestPreviewBubble.svelte").then((m) => { IngestPreviewBubble = m.default; });
  }

  let personaId = $derived($page.data.personaId);
  let scenario = $derived($page.data.scenario);
  let scenarioTypeFromUrl = $derived($page.data.scenarioType);

  let loading = $state(true);
  let sidebarOpen = $state(false);
  let railOpen = $state(false);  // mobile-only: toggles feedback rail drawer below 900px
  let messagesEl = $state(undefined);
  let scrollAnchor = $state(undefined);

  // Panel state (demodalized)
  let feedbackTarget = $state(null);      // bot message to correct
  let feedbackOpen = $state(false);
  let leadOpen = $state(false);
  let leadInitialUrl = $state("");
  let pendingProspectName = $state(null); // set on lead scrape; auto-PATCHed once conv exists
  let showCommandPalette = $state(false);
  let switcherOpen = $state(false);
  let pendingScenarioType = $state(/** @type {string|null} */(null));

  // Ingest post flow : paste un post écrit à la main → extraire règles candidates
  // → user valide celles qu'il veut push dans le cerveau. Preview uniquement côté
  // bubble, pas persisté tant que validé.
  let ingestPending = $state(/** @type {{sourcePost: string, rules: Array<{text: string, rationale: string}>}|null} */(null));
  let ingesting = $state(false);

  // Populate personas list for the inline clone switcher (top-bar dropdown).
  // triage=true attache last_message_at → point de triage par clone dans le menu.
  // Non-blocking: chat still renders without it.
  $effect(() => {
    if (typeof window === "undefined") return;
    if ($personas && $personas.length > 0) return;
    (async () => {
      try {
        const resp = await fetch("/api/personas?triage=true", { headers: authHeaders() });
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data.personas)) personas.set(data.personas);
      } catch {
        // best-effort
      }
    })();
  });

  // Fidelity scores for the triage dot (drift = rouge). Batch appel une fois
  // la liste de personas disponible — best-effort, mute silencieusement.
  let fidelityByPersona = $state(/** @type {Record<string, any>} */ ({}));
  $effect(() => {
    if (typeof window === "undefined") return;
    const list = $personas;
    if (!list || list.length === 0) return;
    const ids = list.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) return;
    (async () => {
      try {
        fidelityByPersona = await getFidelityBatch(ids);
      } catch {
        // best-effort
      }
    })();
  });

  // Clone list enrichie avec triage pour le dropdown (drift / stale / never / warn / ok).
  // Même logique que hub/triageOf : dette d'abord (score < 50 = drift, >3j = stale…).
  function triageFor(p) {
    const scoreGlobal = fidelityByPersona[p.id]?.score_global;
    const lastAt = p.last_message_at;
    const daysSince = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000) : null;
    if (typeof scoreGlobal === "number" && scoreGlobal < 50) return { kind: "drift", label: "en dérive" };
    if (daysSince === null) return { kind: "never", label: "jamais utilisé" };
    if (daysSince >= 3) return { kind: "stale", label: `${daysSince}j d'absence` };
    if (typeof scoreGlobal === "number" && scoreGlobal < 75) return { kind: "warn", label: "alerte" };
    return { kind: "ok", label: "actif" };
  }
  let personasListEnriched = $derived(
    ($personas || []).map((p) => {
      const t = triageFor(p);
      return { ...p, triage: t.kind, triageLabel: t.label };
    })
  );

  // Live readings — collapseIdx & fidelity from /api/fidelity,
  // refreshed after each assistant message. Consolidated into `styleHealth` below.
  let collapseIdx = $state(null);
  let fidelity = $state(null);

  // Rule activation stats for this conversation
  /** @type {Record<string, { count: number, lastFiredAt: number|null, lastDetail: string|null, lastSeverity: string|null }>} */
  let ruleStats = $state({});
  let rulesActiveCount = $derived(
    Object.values(ruleStats).reduce((n, s) => n + (s.count > 0 ? 1 : 0), 0)
  );

  // Consolidated style-health state for the cockpit badge (ok | warn | drift | unknown).
  // Matches the semantics of the tooltip glossary that used to live in cockpit.
  const FIDELITY_THRESHOLD = 0.72;
  let styleHealth = $derived.by(() => {
    const collapseBad = collapseIdx !== null && collapseIdx < 50;
    const collapseWarn = collapseIdx !== null && collapseIdx >= 50 && collapseIdx < 70;
    const fidelityDrift = fidelity !== null && fidelity < FIDELITY_THRESHOLD;
    if (collapseBad || fidelityDrift) return "drift";
    if (collapseWarn || rulesActiveCount > 0) return "warn";
    if (collapseIdx !== null && fidelity !== null) return "ok";
    return "unknown";
  });

  // Session totals removed with AuditStrip — AuditStrip migrated to /admin.
  // SSE still reports tokens/rewrites; we just don't render them in chat.
  let sessionStart = $state(null);
  function resetSessionTotals() { sessionStart = null; }

  // New 2-zone state
  let currentConversation = $state(null);  // { id, prospect_name, stage, note, last_message_at, ... }
  let feedbackRailRef = $state(null);
  let feedbackCount = $state(0);

  // Règles actives du clone = voice.writingRules (direct instructions + promoted
  // consolidations). Pas de compteur "fired par conversation" pour l'instant —
  // les count resteront à 0 (cachés dans la pill). À câbler plus tard via
  // feedback_events.rules_fired si le signal devient utile.
  let activeRules = $derived(
    Array.isArray($personaConfig?.voice?.writingRules)
      ? $personaConfig.voice.writingRules.map((r, i) => ({ id: `wr-${i}`, name: r, count: 0 }))
      : []
  );
  let heatSignal = $state(null);  // { state: 'cold'|'warm'|'hot', delta }

  // Sequence numbers per role, precomputed once per $messages change. Avant :
  // seqForMessage(msg, all) parcourait `all` pour CHAQUE msg du {#each} —
  // O(n²) recalculé à chaque delta SSE (sur thread 50+ msgs × 200 deltas =
  // 500k ops/s). Map id→seq = O(n) build, O(1) lookup au render.
  let seqByMessageId = $derived.by(() => {
    const map = new Map();
    let userN = 0;
    let botN = 0;
    for (const m of $messages) {
      if (m.id === "welcome") continue;
      if (m.role === "user") map.set(m.id, ++userN);
      else map.set(m.id, ++botN);
    }
    return map;
  });

  async function refreshFidelity() {
    if (!personaId) return;
    try {
      // Singular endpoint returns the full latest row (including collapse_index
      // and draft_style breakdown). The batch ?personas= variant only projects
      // score_global so we can't use it here.
      const data = await api(`/api/fidelity?persona=${personaId}`);
      const s = data?.current;
      if (s) {
        // score_raw is the raw cosine similarity [0..1], same scale as
        // pipeline.js inlineFidelityCheck threshold (0.72). score_global is a
        // 0-100 composite — don't mix the two.
        fidelity = typeof s.score_raw === "number" ? s.score_raw : null;
        collapseIdx = typeof s.collapse_index === "number" ? s.collapse_index : null;
      } else {
        fidelity = null;
        collapseIdx = null;
      }
    } catch {
      // fidelity is best-effort
    }
  }

  // Reset per-conversation stats when conversation changes
  $effect(() => {
    const _cid = $currentConversationId;
    ruleStats = {};
    resetSessionTotals();
  });

  // Events feedback pré-chargés pendant init() pour éviter que FeedbackRail
  // n'attende la fin de loadConversation avant de lancer son fetch. Format :
  // { convId, events?, promise? } — FeedbackRail n'utilise le cache que si
  // convId match. `events` prêts = hydratation instantanée ; `promise` in-flight
  // = rail attend la résolution sans déclencher son propre fetch.
  let preloadedFeedbackEvents = $state(
    /** @type {{convId:string, events?:any[]|null, promise?:Promise<any[]>}|null} */ (null)
  );

  // Scroll to bottom when messages change. During an SSE stream we get a scroll
  // per delta — `smooth` queues up dozens of concurrent smooth-scrolls and
  // janks. Use `auto` while streaming, `smooth` only once idle.
  $effect(() => {
    const msgs = $messages;
    if (!scrollAnchor) return;
    const behavior = get(sending) ? "auto" : "smooth";
    requestAnimationFrame(() => {
      scrollAnchor.scrollIntoView({ behavior, block: "end" });
    });
  });

  // Initialize on mount / persona change only. URL changes from
  // applyScenarioChange() update $page.data.scenario/scenarioType — we do NOT
  // want those to re-run init(), which would reload the last conversation from
  // localStorage and override the scenario the user just picked. Scenario
  // changes are already handled inline by applyScenarioChange.
  let initedPersonaId = $state(/** @type {string|null} */ (null));
  $effect(() => {
    if (!personaId || personaId === initedPersonaId) return;
    initedPersonaId = personaId;
    // Read scenario/scenarioTypeFromUrl untracked so later URL updates don't
    // retrigger this effect.
    init(personaId, untrack(() => scenario), untrack(() => scenarioTypeFromUrl));
  });

  async function init(pid, scn, scnType) {
    loading = true;
    // Switching personas : flush stale chrome so the previous clone's name,
    // conv list and thread don't flash under the new clone's URL during the
    // init fetches.
    if ($personaConfig && $personaConfig.id !== pid) {
      personaConfig.set(null);
      conversations.set([]);
      messages.set([]);
    }
    currentPersonaId.set(pid);
    currentScenario.set(scn);
    currentScenarioType.set(scnType || null);

    // Mémorise le dernier clone visité pour rerouter ici au prochain login.
    // Si le clone n'existe plus, pickPersona() côté landing nettoie l'id.
    try { localStorage.setItem("vc_last_persona", pid); } catch {}

    // Score fidelity : fire-and-forget pendant init() (au lieu d'attendre
    // loading=false via $effect, ce qui ajoutait ~1s de décalage). Le state
    // `fidelity`/`collapseIdx` se met à jour quand le fetch revient.
    refreshFidelity();

    // Reprise de fil : d'abord le pointeur localStorage (dernière conv
    // consultée sur CE device), sinon fallback sur la conv la plus récente
    // de l'historique DB. Évite le "j'ai plus rien en revenant" quand le
    // localStorage a été perdu (autre device, nettoyage navigateur, logout).
    // Comme on connaît savedConvId avant tout fetch, on peut lancer config +
    // liste + conv-by-id + feedback-events en parallèle (au lieu de 3+
    // round-trips séquentiels).
    const savedConvId = localStorage.getItem("conv_" + pid);
    const needsConfig = !$personaConfig || $personaConfig.id !== pid;

    try {
      // Hover-prefetch from the clones dropdown : best-effort optimization.
      // Si le prefetch a échoué (réseau flaky, 401 transient pendant qu'on
      // hovait), on DOIT retomber sur un fetch frais — sinon init() throw
      // "Failed to load config" alors que l'API marche très bien maintenant.
      const prefetched = takePersonaPrefetch(pid);
      const jsonOrNull = (r) => (r && r.ok ? r.json() : null);
      const fetchConfig = () => fetch(`/api/config?persona=${pid}`, { headers: authHeaders() }).then(jsonOrNull).catch(() => null);
      const fetchConvs = () => fetch(`/api/conversations?persona=${pid}`, { headers: authHeaders() }).then(jsonOrNull).catch(() => null);

      const configPromise = !needsConfig ? Promise.resolve(null) : (prefetched?.config || fetchConfig());
      const convsPromise = prefetched?.convs || fetchConvs();
      const savedConvPromise = savedConvId
        ? fetch(`/api/conversations?id=${savedConvId}`, { headers: authHeaders() }).then(jsonOrNull).catch(() => null)
        : Promise.resolve(null);
      const savedEventsPromise = savedConvId
        ? fetch(`/api/feedback-events?conversation=${savedConvId}`, { headers: authHeaders() }).then(jsonOrNull).catch(() => null)
        : Promise.resolve(null);

      let [config, convData, savedConvData, savedEventsData] = await Promise.all([
        configPromise, convsPromise, savedConvPromise, savedEventsPromise,
      ]);

      // Prefetch fallback : si le hover-fetch a résolu null, on relance frais.
      if (needsConfig && !config && prefetched?.config) config = await fetchConfig();
      if (!convData && prefetched?.convs) convData = await fetchConvs();

      if (savedConvId && savedEventsData) {
        preloadedFeedbackEvents = {
          convId: savedConvId,
          events: Array.isArray(savedEventsData.events) ? savedEventsData.events : [],
        };
      }

      if (needsConfig) {
        if (!config) throw new Error("Failed to load config");
        personaConfig.set(config);
        applyTheme(config.theme || {});
      }

      let convList = [];
      if (convData) {
        convList = convData.conversations || [];
        conversations.set(convList);
      }

      if (savedConvData) {
        await loadConversation(savedConvId, savedConvData);
      } else if (convList[0]?.id) {
        await loadConversation(convList[0].id);
      } else {
        showWelcome();
      }
    } catch {
      showToast("Erreur de chargement du client");
    } finally {
      loading = false;
    }
  }

  // NOTE: per-persona theme override disabled. The laboratoire design system
  // owns the surface colors globally — we no longer override bg/surface/text/
  // accent per persona. If persona-level accenting comes back, it should be
  // scoped to a single signal (e.g. a persona badge), not the whole chrome.
  function applyTheme(_theme) { /* no-op */ }

  function showWelcome() {
    const config = $personaConfig;
    if (!config) return;
    const sc = config.scenarios?.[scenario] || config.scenarios?.default;
    const welcome = sc?.welcome || `Bonjour, je suis ${config.name}. Comment puis-je vous aider ?`;
    messages.set([
      { id: "welcome", role: "bot", content: welcome },
    ]);
    currentConversationId.set(null);
  }

  // Guards against the "fast-switch race" : click A (slow) → click B (fast)
  // → A resolves second and overwrites B. AbortController cancels A before B
  // fires so only the freshest switch wins.
  let convLoadController = /** @type {AbortController|null} */ (null);
  async function loadConversation(convId, preloadedData = null) {
    if (convLoadController) convLoadController.abort();
    convLoadController = new AbortController();
    const signal = convLoadController.signal;
    try {
      let data = preloadedData;
      // Hover-prefetch cache : if the sidebar warmed this conv, reuse its
      // promise ; otherwise start a fresh fetch. Both conv payload and events
      // are kicked off *before* the atomic flip so they overlap with the
      // effects Svelte runs in response.
      let eventsPromise = takeFeedbackEvents(personaId, convId);
      if (!eventsPromise) {
        eventsPromise = fetch(`/api/feedback-events?conversation=${convId}`, {
          headers: authHeaders(),
          signal,
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d && Array.isArray(d.events) ? d.events : []))
          .catch(() => []);
      }
      const cachedConvPromise = !data ? takeConversation(personaId, convId) : null;

      // Atomic flip : update preloadedFeedbackEvents + currentConversationId in
      // the same sync block (no awaits between) so FeedbackRail's $effect sees
      // both new values in a single flush cycle. Otherwise the rail would see
      // new-convId-with-stale-preload (or vice-versa), fire a redundant fetch,
      // and race with the preloaded promise.
      preloadedFeedbackEvents = { convId, events: null, promise: eventsPromise };
      currentConversationId.set(convId);
      localStorage.setItem("conv_" + personaId, convId);

      if (!data && cachedConvPromise) {
        data = await cachedConvPromise;
      }
      if (!data) {
        const resp = await fetch(`/api/conversations?id=${convId}`, {
          headers: authHeaders(),
          signal,
        });
        if (!resp.ok) {
          showWelcome();
          return;
        }
        data = await resp.json();
      }
      const conv = data.conversation || data;
      const convMessages = conv.messages || data.messages || [];

      // Sync scenario stores with the conversation's stored values so the
      // composer unlocks (scenario-gate) and the ScenarioSwitcher reflects
      // the right pick. Canonical enum wins; legacy text is dual-written.
      if (isScenarioId(conv.scenario_type)) currentScenarioType.set(conv.scenario_type);
      if (conv.scenario) currentScenario.set(conv.scenario);

      const config = $personaConfig;
      const sc = config?.scenarios?.[conv.scenario || scenario] || config?.scenarios?.default;
      const welcome = sc?.welcome || `Bonjour, je suis ${config?.name || "le clone"}.`;

      const msgs = [{ id: "welcome", role: "bot", content: welcome }];
      for (const msg of convMessages) {
        msgs.push({
          id: msg.id || crypto.randomUUID(),
          role: msg.role === "user" ? "user" : "bot",
          content: msg.content,
          // turn_kind drives the action buttons in ChatMessage (✓ c'est ça,
          // ★ excellent, ✎ corriger, ↻ regen sur clone_draft). Sans cette
          // ligne, les messages rechargés tombent sur le fallback legacy
          // avec seulement "Corriger".
          turn_kind: msg.turn_kind,
        });
      }
      messages.set(msgs);
    } catch (e) {
      if (e?.name === "AbortError") return; // superseded by another switch
      showWelcome();
    }
  }

  async function handleScenarioChange(scenarioType) {
    if (!scenarioType || !isScenarioId(scenarioType)) return;
    if (scenarioType === $currentScenarioType) return;

    // Kind change = post↔dm, forces a new thread (different rule set, analytics
    // bucket). If the user has an active conversation, ask before wiping it —
    // the conv is persisted server-side but disappears from the current view
    // and comes back as a surprise via the sidebar.
    const legacy = legacyKeyFor(scenarioType);
    const kindChanged = legacy !== $currentScenario;
    if (kindChanged && $currentConversationId) {
      pendingScenarioType = scenarioType;
      return;
    }

    await applyScenarioChange(scenarioType);
  }

  async function applyScenarioChange(scenarioType) {
    const legacy = legacyKeyFor(scenarioType);
    const kindChanged = legacy !== $currentScenario;

    currentScenarioType.set(scenarioType);
    currentScenario.set(legacy);

    const url = new URL(window.location.href);
    url.searchParams.set("scenario_type", scenarioType);
    url.searchParams.set("scenario", legacy);
    await goto(url.pathname + "?" + url.searchParams.toString(), {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });

    if (kindChanged) {
      localStorage.removeItem("conv_" + personaId);
      currentConversationId.set(null);
      showWelcome();
    }
  }

  async function confirmScenarioSwitch() {
    if (!pendingScenarioType) return;
    const target = pendingScenarioType;
    pendingScenarioType = null;
    await applyScenarioChange(target);
  }

  function cancelScenarioSwitch() {
    pendingScenarioType = null;
  }

  async function handleSend(text) {
    if ($sending) return;
    sending.set(true);

    // Add user message
    const userId = crypto.randomUUID();
    const botId = crypto.randomUUID();
    const now = Date.now();

    // Start the session clock on the first user message.
    if (!sessionStart) sessionStart = now;

    messages.update((msgs) => [
      ...msgs,
      { id: userId, role: "user", content: text, timestamp: now },
      // turn_kind: 'clone_draft' → débloque ✓/★/✎/↻ dans ChatMessage dès que
      // le stream est fini (sinon fallback legacy avec seulement "Corriger").
      { id: botId, role: "bot", content: "", typing: true, timestamp: now, turn_kind: "clone_draft" },
    ]);

    track("message_sent", {
      scenario_type: $currentScenarioType || $currentScenario || "default",
      persona_id: personaId,
    });

    let botText = "";
    // Delta coalescing : SSE chunks arrive faster than the display can refresh
    // (often 10+ per 16ms). Batch writes to the store via rAF so we do at most
    // 1 messages.update per frame — same visual result, ~10× fewer Svelte
    // reactivity passes during a stream. patchBot() also avoids the .map(...)
    // over the whole array : findIndex + spread touches one slot.
    let deltaRafId = /** @type {number|null} */ (null);
    function patchBot(patch) {
      messages.update((msgs) => {
        const idx = msgs.findIndex((m) => m.id === botId);
        if (idx === -1) return msgs;
        const next = msgs.slice();
        next[idx] = { ...msgs[idx], ...patch };
        return next;
      });
    }
    function flushDelta() {
      if (deltaRafId !== null) {
        cancelAnimationFrame(deltaRafId);
        deltaRafId = null;
      }
    }
    function scheduleDeltaFlush() {
      if (deltaRafId !== null) return;
      deltaRafId = requestAnimationFrame(() => {
        deltaRafId = null;
        patchBot({ content: botText, typing: false });
      });
    }

    await streamChat(
      {
        message: text,
        scenario: $currentScenario,
        scenarioType: $currentScenarioType || undefined,
        personaId,
        conversationId: $currentConversationId || undefined,
      },
      {
        onDelta(chunk) {
          botText += chunk;
          scheduleDeltaFlush();
        },
        onThinking() {
          patchBot({ status: "Analyse du contexte..." });
        },
        onRewriting(attempt) {
          patchBot({ status: `Amelioration (tentative ${attempt})...` });
        },
        onClear() {
          flushDelta();
          const originalText = botText;
          botText = "";
          messages.update((msgs) => {
            const idx = msgs.findIndex((m) => m.id === botId);
            if (idx === -1) return msgs;
            const next = msgs.slice();
            const prev = msgs[idx];
            next[idx] = { ...prev, content: "", status: undefined, original: originalText || prev.original };
            return next;
          });
        },
        onDone(evt) {
          // Cancel any pending rAF delta flush — otherwise it could race
          // against this final patch and overwrite the telemetry fields with
          // just {content, typing}.
          flushDelta();
          // Attach per-message telemetry (and the final content) on the bot
          // message. `content: botText` guards against the case where onDone
          // arrives before the last rAF fired.
          patchBot({
            content: botText,
            typing: false,
            status: undefined,
            rewritten: evt?.rewritten || false,
            timing: evt?.timing || null,
            tokens: evt?.tokens || null,
            model: evt?.model || null,
            fidelity: evt?.fidelity || null,
            live_style: evt?.live_style || null,
            violations: evt?.violations || [],
            sources: evt?.sources || null,
          });

          // Bump rule activation counters from the SSE violations payload
          const now = Date.now();
          if (evt?.violations?.length) {
            const next = { ...ruleStats };
            for (const v of evt.violations) {
              const prev = next[v.type] || { count: 0, lastFiredAt: null, lastDetail: null, lastSeverity: null };
              next[v.type] = {
                count: prev.count + 1,
                lastFiredAt: now,
                lastDetail: v.detail || prev.lastDetail,
                lastSeverity: v.severity || prev.lastSeverity,
              };
            }
            ruleStats = next;
          }

          // Live per-message readings from the pipeline. These override the
          // persisted (cron-computed) aggregate for this turn — the cockpit
          // should feel live, not stuck on yesterday's score.
          if (evt?.fidelity && typeof evt.fidelity.similarity === "number") {
            fidelity = evt.fidelity.similarity;
          }

          // AuditStrip removed from chat — session totals are no longer tracked here.
          // Tokens/rewrites/drift metrics remain available via SSE telemetry
          // and /api/fidelity for the /brain#intelligence view.
        },
        onHeat(evt) {
          // Heat signal feeds the inline indicator in ProspectDossierHeader.
          if (evt && typeof evt.state === "string") {
            heatSignal = { state: evt.state, delta: evt.delta ?? null };
          }
        },
        onConversation(id) {
          if (id && !$currentConversationId) {
            currentConversationId.set(id);
            localStorage.setItem("conv_" + personaId, id);
            // Refresh conversations
            refreshConversations();
          }
        },
        // Bug #1 — rebind temporary client-generated UUIDs to the real DB
        // message IDs. Without this, PATCH /api/messages?id=X and POST
        // /api/feedback-events (FK on message_id) fail silently and no
        // feedback event ever reaches the FeedbackRail.
        onIds({ user_message_id, bot_message_id }) {
          messages.update((msgs) =>
            msgs.map((m) => {
              if (user_message_id && m.id === userId) return { ...m, id: user_message_id };
              if (bot_message_id && m.id === botId) return { ...m, id: bot_message_id };
              return m;
            })
          );
          // Keep feedbackMessageId in sync if the panel was opened against
          // the pre-rebind bot UUID.
          if (bot_message_id && feedbackMessageId === botId) {
            feedbackMessageId = bot_message_id;
          }
        },
        onError(type, detail) {
          flushDelta();
          if (type === "rate_limit") {
            showToast("Trop de messages, patientez");
            messages.update((msgs) => msgs.filter((m) => m.id !== botId));
          } else if (type === "budget") {
            patchBot({
              typing: false,
              content: "**Budget depasse.** Ajoutez votre cle API Anthropic dans les parametres (&#9881;) pour continuer.",
            });
          } else if (type === "reconnecting") {
            patchBot({ status: "Reconnexion..." });
          } else if (type === "failed") {
            patchBot({ typing: false, content: "Connexion perdue. Reessayez." });
          }
        },
      }
    );

    sending.set(false);
  }

  async function refreshConversations() {
    try {
      const resp = await fetch(`/api/conversations?persona=${personaId}`, {
        headers: authHeaders(),
      });
      if (resp.ok) {
        const d = await resp.json();
        conversations.set(d.conversations || []);
      }
    } catch {}
  }

  let feedbackMessageId = $state(null);

  async function handleCorrect(message) {
    await loadFeedbackPanel();
    feedbackTarget = message.content;
    feedbackMessageId = message.id;
    feedbackOpen = true;
  }

  async function handleSaveRule(message) {
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "save_rule",
          persona: get(currentPersonaId),
          userMessage: message.content,
        }),
      });
      // Log dans le journal feedback pour qu'il apparaisse dans FeedbackRail.
      try {
        const resp = await fetch("/api/feedback-events", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            conversation_id: $currentConversationId,
            message_id: message.id,
            event_type: "saved_rule",
          }),
        });
        if (resp.ok) {
          const ev = await resp.json();
          feedbackRailRef?.appendEvent?.({
            id: ev.id,
            message_id: message.id,
            event_type: "saved_rule",
            created_at: ev.created_at,
            rules_fired: [],
          });
        }
      } catch { /* best-effort */ }
      showToast("Règle sauvegardée ✓");
    } catch {
      showToast("Erreur lors de la sauvegarde");
    }
  }

  function handleReplace(newText) {
    // Replace the bot message in the messages list with the accepted alternative
    if (feedbackMessageId) {
      messages.update(msgs => msgs.map(m =>
        m.id === feedbackMessageId ? { ...m, content: newText } : m
      ));
    }
  }

  function handleLeadAnalyzed(msg, prospectName) {
    // Auto-fill dossier header: scraped profile name → prospect_name on the conv.
    // Cleared once the conv exists and has been PATCHed (see $effect below).
    if (prospectName) pendingProspectName = prospectName;
    handleSend(msg);
  }

  // ── 2-zone layout handlers ──

  // "✨ draft la suite" — reuse existing streamChat flow. Optional consigne prefixed.
  function handleDraftNext({ consigne }) {
    const text = consigne || "Génère la réponse suivante en tenant compte du thread.";
    handleSend(text);
  }

  // "📝 j'ai écrit ce post" — user colle un post écrit main, on extrait des règles
  // candidates et on ouvre la bulle de validation. Aucune écriture DB à ce stade.
  // 📥 "j'ai reçu" : log la réponse prospect en DB (turn_kind='prospect'),
  // sans appeler le LLM. Pré-requis : conv déjà créée (1er draft envoyé).
  // Signal clef pour l'auto-stage ("en conv") — voir Bloc 2.
  async function handleAddProspectReply(content) {
    const convId = $currentConversationId;
    if (!convId) {
      showToast("Envoie un premier message avant de logger une réponse");
      return;
    }
    try {
      const resp = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          conversation_id: convId,
          role: "user",
          content,
          turn_kind: "prospect",
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showToast("Ajout échoué : " + (err.error || resp.statusText));
        return;
      }
      const saved = await resp.json();
      messages.update((msgs) => [
        ...msgs,
        {
          id: saved.id,
          role: "user",
          content: saved.content,
          turn_kind: "prospect",
          timestamp: new Date(saved.created_at).getTime(),
        },
      ]);
      // Sidebar last_message_at is already bumped server-side; refresh local view.
      if (currentConversation && currentConversation.id === convId) {
        currentConversation = { ...currentConversation, last_message_at: saved.created_at };
      }
    } catch (e) {
      showToast("Ajout échoué : " + (e?.message || "erreur réseau"));
    }
  }

  async function handleIngestPost(post) {
    ingesting = true;
    ingestPending = null;
    // Load the preview bubble in parallel with the extraction request — by the
    // time rules come back, the component is ready.
    loadIngestPreviewBubble();
    try {
      const result = await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "extract_rules_from_post",
          post,
          persona: get(currentPersonaId),
        }),
      });
      ingestPending = { sourcePost: post, rules: result.rules || [] };
      if (!result.rules || result.rules.length === 0) {
        showToast("Rien d'actionnable à extraire de ce post");
      }
    } catch (e) {
      showToast("Erreur extraction : " + (e.message || "inconnue"));
    } finally {
      ingesting = false;
    }
  }

  // Validation d'une règle candidate → push dans le cerveau via save_rule_direct.
  async function handleValidateIngestRule(ruleText) {
    await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        type: "save_rule_direct",
        ruleText,
        sourcePost: ingestPending?.sourcePost?.slice(0, 200) || "",
        persona: get(currentPersonaId),
      }),
    });
    showToast("Règle ajoutée au cerveau ✓");
  }

  function handleDismissIngest() {
    ingestPending = null;
  }

  // ✓ valider : PATCH message turn_kind='toi' + POST feedback-events.
  // Also fires the legacy /api/feedback validate signal so detect-validate
  // pipeline (positive feedback loop) keeps working.
  async function handleValidate(message) {
    try {
      // Legacy positive-feedback signal — best effort, non-blocking
      api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "validate",
          botMessage: message.content,
          persona: get(currentPersonaId),
        }),
      }).catch(() => { /* ignored: secondary signal */ });

      await fetch(`/api/messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ turn_kind: "toi" }),
      });
      const resp = await fetch("/api/feedback-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          conversation_id: $currentConversationId,
          message_id: message.id,
          event_type: "validated",
        }),
      });
      if (resp.ok) {
        const ev = await resp.json();
        feedbackRailRef?.appendEvent?.({
          id: ev.id,
          message_id: message.id,
          event_type: "validated",
          created_at: ev.created_at,
          rules_fired: [],
        });
        feedbackCount++;
      }
      messages.update(msgs => msgs.map(m =>
        m.id === message.id ? { ...m, turn_kind: "toi" } : m
      ));
    } catch {
      showToast?.("Validation échouée");
    }
  }

  // ✓ c'est ça : explicit client approval. Flips turn_kind to 'toi' like
  // validate, but fires /api/feedback type=client_validate (stronger entity
  // boost +0.12) and logs feedback_events as 'client_validated'.
  async function handleClientValidate(message) {
    try {
      api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "client_validate",
          botMessage: message.content,
          persona: get(currentPersonaId),
        }),
      }).catch(() => { /* secondary signal; non-blocking */ });

      await fetch(`/api/messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ turn_kind: "toi" }),
      });

      const resp = await fetch("/api/feedback-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          conversation_id: $currentConversationId,
          message_id: message.id,
          event_type: "client_validated",
        }),
      });
      if (resp.ok) {
        const ev = await resp.json();
        feedbackRailRef?.appendEvent?.({
          id: ev.id,
          message_id: message.id,
          event_type: "client_validated",
          created_at: ev.created_at,
          rules_fired: [],
        });
        feedbackCount++;
      }
      messages.update(msgs => msgs.map(m =>
        m.id === message.id ? { ...m, turn_kind: "toi" } : m
      ));
    } catch {
      showToast?.("Validation échouée");
    }
  }

  // ★ excellent : même flow que validate mais event_type='excellent' —
  // split du signal pour distinguer "passable" vs "pattern à multiplier".
  // Voir migration 031_feedback_excellent.sql.
  async function handleExcellent(message) {
    try {
      api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "excellent",
          botMessage: message.content,
          persona: get(currentPersonaId),
        }),
      }).catch(() => { /* ignored: secondary signal */ });

      await fetch(`/api/messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ turn_kind: "toi" }),
      });
      const resp = await fetch("/api/feedback-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          conversation_id: $currentConversationId,
          message_id: message.id,
          event_type: "excellent",
        }),
      });
      if (resp.ok) {
        const ev = await resp.json();
        feedbackRailRef?.appendEvent?.({
          id: ev.id,
          message_id: message.id,
          event_type: "excellent",
          created_at: ev.created_at,
          rules_fired: [],
        });
        feedbackCount++;
      }
      messages.update(msgs => msgs.map(m =>
        m.id === message.id ? { ...m, turn_kind: "toi" } : m
      ));
    } catch {
      showToast?.("Marquage excellent échoué");
    }
  }

  // ↻ regen : mark current draft as rejected, relaunch last send.
  async function handleRegen(message) {
    try {
      await fetch(`/api/messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ turn_kind: "draft_rejected" }),
      });
      messages.update(msgs => msgs.filter(m => m.id !== message.id));
      handleSend("Regenère la réponse.");
    } catch {
      showToast?.("Regen échoué");
    }
  }

  // Conversation dossier fields update (name / stage / note) from header
  async function handleConversationUpdate(patch) {
    if (!$currentConversationId) return;
    try {
      const resp = await fetch(`/api/conversations?id=${$currentConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      currentConversation = { ...(currentConversation || {}), ...patch };
    } catch {
      showToast?.("Mise à jour dossier échouée");
    }
  }

  // Click on a rail entry → scroll + pulse the message in the thread
  function handleHighlightMessage(msgId) {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("msg-highlight");
    setTimeout(() => el.classList.remove("msg-highlight"), 2000);
  }

  // Keep currentConversation in sync with the conversation store
  $effect(() => {
    const convId = $currentConversationId;
    if (!convId) { currentConversation = null; return; }
    const conv = ($conversations || []).find(c => c.id === convId);
    if (conv) currentConversation = conv;
  });

  // Auto-fill prospect_name after a lead scrape.
  // Runs once the conv is materialized: if it has no prospect_name yet, PATCH it.
  // If the operator already set one, we don't overwrite — just clear the pending.
  $effect(() => {
    if (!pendingProspectName) return;
    const conv = currentConversation;
    if (!conv) return;
    const name = pendingProspectName;
    pendingProspectName = null;
    if (!conv.prospect_name) handleConversationUpdate({ prospect_name: name });
  });

  function handleKeyboard(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      if (showCommandPalette) showCommandPalette = false;
      else if (feedbackOpen) { feedbackOpen = false; feedbackTarget = null; feedbackMessageId = null; }
      else if (leadOpen) leadOpen = false;
      else if (railOpen) railOpen = false;
      return;
    }
    if (mod && e.key === "k") {
      e.preventDefault();
      if (!showCommandPalette) {
        loadCommandPalette().then(() => { showCommandPalette = true; });
      } else {
        showCommandPalette = false;
      }
    }
    if (mod && e.key === "n") {
      e.preventDefault();
      handleNewConversation();
    }
    if (mod && e.shiftKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      switcherOpen = !switcherOpen;
    }
  }

  function handleNewConversation() {
    currentConversationId.set(null);
    localStorage.removeItem("conv_" + personaId);
    showWelcome();
    sidebarOpen = false;
  }

  function handleSelectConversation(convId) {
    loadConversation(convId);
    sidebarOpen = false;
  }

  function handleSwitchToClone(newId) {
    if (!newId || newId === personaId) return;
    currentConversationId.set(null);
    currentScenario.set("");
    messages.set([]);
    goto(`/chat/${newId}`);
  }

  async function handleDeletePersona() {
    const name = $personaConfig?.name || "ce clone";
    if (!window.confirm(`Supprimer le clone "${name}" ? Cette action est irréversible.`)) return;
    try {
      await api(`/api/personas?id=${personaId}`, { method: "DELETE" });
      goto("/");
    } catch {
      showToast("Erreur lors de la suppression");
    }
  }
</script>

<svelte:window onkeydown={handleKeyboard} />

  <div class="chat-layout">
    <ConversationSidebar
      {personaId}
      currentConvId={$currentConversationId}
      onselectconversation={handleSelectConversation}
      onnewconversation={handleNewConversation}
      open={sidebarOpen}
    />

    {#if sidebarOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="sidebar-backdrop" onclick={() => (sidebarOpen = false)}></div>
    {/if}

    <div class="chat-main">
      <ChatTopBar
        personaName={$personaConfig?.name || "Clone"}
        personaAvatar={$personaConfig?.avatar || "?"}
        personasList={personasListEnriched}
        currentPersonaId={personaId}
        persona={$personaConfig}
        scenarioType={$currentScenarioType}
        onScenarioChange={handleScenarioChange}
        onSwitchClone={handleSwitchToClone}
        onToggleSidebar={() => sidebarOpen = !sidebarOpen}
        onDeletePersona={$personaConfig?._shared ? null : handleDeletePersona}
        bind:switcherOpen
      />

      <div class="chat-body" class:rail-open={railOpen}>
        <div class="chat-messages-col">
          <!-- Le dossier prospect n'a de sens qu'en DM (pipeline lead). En mode
               post, stage/note/heat/dernier contact ne veulent rien dire. -->
          {#if $currentScenario === "dm"}
            <ProspectDossierHeader
              conversation={currentConversation}
              {feedbackCount}
              heat={heatSignal}
              onUpdate={handleConversationUpdate}
              onToggleRail={() => railOpen = !railOpen}
            />
          {/if}

          <div class="chat-messages" bind:this={messagesEl}>
            {#if loading && $messages.length === 0}
              <div class="thread-skeleton"><div class="loading-dot"></div></div>
            {/if}
            {#each $messages as message (message.id)}
              <ChatMessage
                {message}
                seq={seqByMessageId.get(message.id) ?? null}
                onCorrect={handleCorrect}
                onValidate={handleValidate}
                onClientValidate={handleClientValidate}
                onExcellent={handleExcellent}
                onRegen={handleRegen}
                onSaveRule={handleSaveRule}
                onCopyBlock={() => {}}
              />
            {/each}
            {#if ingesting}
              <div class="ingest-loading mono">📝 Extraction des règles…</div>
            {/if}
            {#if ingestPending && IngestPreviewBubble}
              <IngestPreviewBubble
                rules={ingestPending.rules}
                sourcePost={ingestPending.sourcePost}
                onValidate={handleValidateIngestRule}
                onDismiss={handleDismissIngest}
              />
            {/if}
            <div bind:this={scrollAnchor}></div>
          </div>

          <ChatComposer
            disabled={$sending}
            scenarioType={$currentScenarioType}
            isEmptyConversation={$messages.length === 0}
            onDraftNext={handleDraftNext}
            onSwitchScenario={handleScenarioChange}
            onAnalyzeProspect={(url) => { loadLeadPanel().then(() => { leadInitialUrl = url; leadOpen = true; }); }}
            onIngestPost={handleIngestPost}
            onAddProspectReply={handleAddProspectReply}
          />
        </div>

        <FeedbackRail
          bind:this={feedbackRailRef}
          conversationId={$currentConversationId}
          preloadedEvents={preloadedFeedbackEvents}
          {activeRules}
          onHighlightMessage={handleHighlightMessage}
        />

        {#if railOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="rail-backdrop" onclick={() => (railOpen = false)}></div>
        {/if}
      </div>
    </div>
  </div>

  {#if feedbackOpen && FeedbackPanel}
    <FeedbackPanel
      open={feedbackOpen}
      botMessage={feedbackTarget || ""}
      onClose={() => { feedbackOpen = false; feedbackTarget = null; feedbackMessageId = null; }}
      onReplace={handleReplace}
      onCorrected={async (correctionText) => {
        if (!feedbackMessageId || !$currentConversationId) return;
        try {
          const resp = await fetch("/api/feedback-events", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              conversation_id: $currentConversationId,
              message_id: feedbackMessageId,
              event_type: "corrected",
              correction_text: correctionText,
            }),
          });
          if (resp.ok) {
            const ev = await resp.json();
            feedbackRailRef?.appendEvent?.({
              id: ev.id,
              message_id: feedbackMessageId,
              event_type: "corrected",
              correction_text: correctionText,
              created_at: ev.created_at,
              rules_fired: [],
            });
          }
        } catch { /* best-effort */ }
      }}
    />
  {/if}

  {#if leadOpen && LeadPanel}
    <LeadPanel
      open={leadOpen}
      initialUrl={leadInitialUrl}
      onClose={() => { leadOpen = false; leadInitialUrl = ""; }}
      onAnalyzed={handleLeadAnalyzed}
    />
  {/if}

  {#if showCommandPalette && CommandPalette}
    <CommandPalette
      conversations={$conversations}
      commands={[
        { id: "new-conv", label: "Nouvelle conversation", hint: "⌘N", action: handleNewConversation },
        { id: "analyse-prospect", label: "Analyser un prospect", hint: "URL LinkedIn", action: () => { loadLeadPanel().then(() => { leadInitialUrl = ""; leadOpen = true; }); } },
        { id: "open-brain", label: "Cerveau du clone", hint: "persona", action: () => goto(`/brain/${personaId}`) },
        { id: "switch-clone", label: "Changer de clone", hint: "⌘⇧C", action: () => { switcherOpen = true; } },
      ]}
      onselect={(id) => { showCommandPalette = false; handleSelectConversation(id); }}
      onclose={() => (showCommandPalette = false)}
    />
  {/if}

  {#if pendingScenarioType}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scenario-confirm-backdrop" onclick={cancelScenarioSwitch}>
      <div class="scenario-confirm" onclick={(e) => e.stopPropagation()}>
        <h4>Changer de scenario ?</h4>
        <p>Cette conversation va etre mise de cote et un nouveau thread demarrera.</p>
        <p class="scenario-confirm-hint">Tu pourras la retrouver dans l'historique (☰ en haut a gauche).</p>
        <div class="scenario-confirm-actions">
          <button class="scenario-confirm-cancel" onclick={cancelScenarioSwitch}>Annuler</button>
          <button class="scenario-confirm-ok" onclick={confirmScenarioSwitch}>Continuer</button>
        </div>
      </div>
    </div>
  {/if}

<style>
  .chat-layout {
    display: flex;
    height: 100dvh;
    overflow: hidden;
    position: relative;
  }

  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .chat-body {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }

  .chat-messages-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .rail-backdrop {
    display: none;
  }

  @media (max-width: 900px) {
    /* Mobile: rail becomes an overlay drawer. Hidden by default, slides in
       when the parent gets .rail-open (toggled from the header's correction
       count button). Backdrop click or ESC closes it. */
    .chat-body :global(.feedback-rail) {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      width: min(320px, 85vw);
      transform: translateX(100%);
      transition: transform 0.18s ease-out;
      box-shadow: -2px 0 12px rgba(20, 20, 26, 0.08);
    }
    .chat-body.rail-open :global(.feedback-rail) {
      transform: translateX(0);
    }
    .chat-body.rail-open .rail-backdrop {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 29;
      background: color-mix(in srgb, var(--ink) 18%, transparent);
    }
    .chat-body { position: relative; }
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  /* ScenarioSwitcher relocated to ProspectDossierHeader; composer-toolbar CSS removed. */

  .thread-skeleton {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 120px;
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    background: var(--text-tertiary);
    border-radius: 50%;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 60%, 100% { opacity: 0.25; }
    30% { opacity: 0.8; }
  }

  .sidebar-backdrop {
    display: none;
  }

  @media (max-width: 768px) {
    .sidebar-backdrop {
      display: block;
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 40;
    }
  }

  @media (max-width: 480px) {
    .chat-messages { padding: 0.75rem; }
  }

  .ingest-loading {
    align-self: flex-start;
    font-size: 11px;
    color: var(--ink-40);
    padding: 8px 12px;
    border: 1px dashed var(--rule);
    background: var(--paper-subtle, #f6f5f1);
  }

  .scenario-confirm-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 26, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .scenario-confirm {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    padding: 18px 20px;
    width: 90%;
    max-width: 420px;
    font-family: var(--font-ui);
    box-shadow: 0 12px 40px rgba(20, 20, 26, 0.12);
  }
  .scenario-confirm h4 {
    margin: 0 0 0.5rem;
    font-size: 0.9375rem;
    color: var(--text);
  }
  .scenario-confirm p {
    margin: 0 0 0.375rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .scenario-confirm-hint {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }
  .scenario-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .scenario-confirm-cancel,
  .scenario-confirm-ok {
    padding: 7px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .scenario-confirm-cancel {
    background: transparent;
    color: var(--ink-70);
  }
  .scenario-confirm-cancel:hover {
    color: var(--ink);
    border-color: var(--ink-40);
  }
  .scenario-confirm-ok {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .scenario-confirm-ok:hover {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
</style>
