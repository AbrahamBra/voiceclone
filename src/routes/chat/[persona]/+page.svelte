<script>
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
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
  import { legacyKeyFor, isScenarioId, CANONICAL_SCENARIOS } from "$lib/scenarios.js";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import ChatInput from "$lib/components/ChatInput.svelte";
  import ScenarioSwitcher from "$lib/components/ScenarioSwitcher.svelte";
  import ConversationSidebar from "$lib/components/ConversationSidebar.svelte";
  import ChatCockpit from "$lib/components/ChatCockpit.svelte";
  import AuditStrip from "$lib/components/AuditStrip.svelte";
  import HeatThermometer from "$lib/components/HeatThermometer.svelte";
  import LiveMetricsStrip from "$lib/components/LiveMetricsStrip.svelte";
  // Secondary panels are lazy-loaded on first open — see $effect blocks below.

  let personaId = $derived($page.data.personaId);
  let scenario = $derived($page.data.scenario);
  let scenarioTypeFromUrl = $derived($page.data.scenarioType);

  // Lock the switcher to a single kind so a "qualification" entry never
  // surfaces post scenarios (and vice versa). Prefer the canonical id's
  // kind; fall back to the legacy key.
  let scenarioKind = $derived.by(() => {
    const t = $currentScenarioType;
    if (t && CANONICAL_SCENARIOS[t]) return CANONICAL_SCENARIOS[t].kind;
    const s = $currentScenario;
    if (s === "post") return "post";
    if (s === "qualification" || s === "dm") return "dm";
    return null;
  });

  let loading = $state(true);
  let sidebarOpen = $state(false);
  let messagesEl = $state(undefined);
  let scrollAnchor = $state(undefined);
  let thermRef = $state(null);

  // Panel state (demodalized)
  let feedbackTarget = $state(null);      // bot message to correct
  let feedbackOpen = $state(false);
  let leadOpen = $state(false);
  let showCommandPalette = $state(false);
  let switcherOpen = $state(false);
  let journalOpen = $state(false);
  // Unified persona-brain drawer replaces the former standalone RulesPanel +
  // SettingsPanel slide-overs. initialTab lets a pastille (e.g. the
  // style-health badge) deep-link directly to `règles` if needed later.
  let brainOpen = $state(false);
  let brainInitialTab = $state("règles");

  // Lazy-loaded secondary panels — module is fetched the first time its
  // open flag flips to true, then kept in memory for subsequent opens.
  let FeedbackPanel = $state(null);
  let PersonaBrainDrawer = $state(null);
  let LeadPanel = $state(null);
  let CommandPalette = $state(null);
  let LearningJournal = $state(null);

  $effect(() => {
    if (feedbackOpen && !FeedbackPanel) {
      import("$lib/components/FeedbackPanel.svelte").then(m => { FeedbackPanel = m.default; });
    }
  });
  $effect(() => {
    if (brainOpen && !PersonaBrainDrawer) {
      import("$lib/components/PersonaBrainDrawer.svelte").then(m => { PersonaBrainDrawer = m.default; });
    }
  });
  $effect(() => {
    if (leadOpen && !LeadPanel) {
      import("$lib/components/LeadPanel.svelte").then(m => { LeadPanel = m.default; });
    }
  });
  $effect(() => {
    if (showCommandPalette && !CommandPalette) {
      import("$lib/components/CommandPalette.svelte").then(m => { CommandPalette = m.default; });
    }
  });
  $effect(() => {
    if (journalOpen && !LearningJournal) {
      import("$lib/components/LearningJournal.svelte").then(m => { LearningJournal = m.default; });
    }
  });

  // Populate personas list for the inline clone switcher (cockpit dropdown).
  // Non-blocking: chat still renders without it.
  $effect(() => {
    if (typeof window === "undefined") return;
    if ($personas && $personas.length > 0) return;
    (async () => {
      try {
        const resp = await fetch("/api/personas", { headers: authHeaders() });
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data.personas)) personas.set(data.personas);
      } catch {
        // best-effort
      }
    })();
  });

  // Cockpit live readings — collapseIdx & fidelity from /api/fidelity,
  // updated after each message via breakdown + rewritten events.
  let collapseIdx = $state(null);
  let fidelity = $state(null);
  let breakdown = $state(null);
  let sourceStyle = $state(null);

  // Rule activation stats for this conversation
  /** @type {Record<string, { count: number, lastFiredAt: number|null, lastDetail: string|null, lastSeverity: string|null }>} */
  let ruleStats = $state({});
  let rulesActiveCount = $derived(
    Object.values(ruleStats).reduce((n, s) => n + (s.count > 0 ? 1 : 0), 0)
  );

  // Running totals for AuditStrip — accumulated across the current conversation.
  let sessionStart = $state(null);
  let sessionTotals = $state({
    msgCount: 0,
    rewriteCount: 0,
    driftCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    ruleFireCount: 0,
  });
  function resetSessionTotals() {
    sessionStart = null;
    sessionTotals = {
      msgCount: 0, rewriteCount: 0, driftCount: 0,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, ruleFireCount: 0,
    };
  }

  // Bot message sequence number generator (per conversation)
  let botSeq = $state(0);
  let userSeq = $state(0);
  function seqForMessage(msg, allMessages) {
    // Count messages of the same role up to and including this one
    let n = 0;
    for (const m of allMessages) {
      if (m.role !== msg.role) continue;
      if (m.id === "welcome") continue; // welcome isn't numbered
      n++;
      if (m.id === msg.id) return n;
    }
    return null;
  }

  // Previous bot message's fidelity — enables Δ display on each marginalia.
  function prevFidelityFor(msg, allMessages) {
    if (msg.role !== "bot") return null;
    let last = null;
    for (const m of allMessages) {
      if (m.id === msg.id) return last;
      if (m.role === "bot" && typeof m.fidelity?.similarity === "number") {
        last = m.fidelity.similarity;
      }
    }
    return last;
  }

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
        // draft_style carries ttr / kurtosis / avgSentenceLen / questionRatio
        // / signaturePresence / forbiddenHits — exactly what the hover tooltip
        // wants to show.
        breakdown = s.draft_style || null;
        sourceStyle = s.source_style || null;
      } else {
        fidelity = null;
        collapseIdx = null;
        breakdown = null;
        sourceStyle = null;
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

  $effect(() => {
    if (!loading && personaId) refreshFidelity();
  });

  // Scroll to bottom when messages change — coalesced to one rAF tick so
  // SSE token streams don't pile up concurrent smooth animations (previous
  // behavior spawned a new 1s smooth-scroll per chunk, visibly choppy).
  let scrollRaf = null;
  $effect(() => {
    const msgs = $messages;
    if (!scrollAnchor) return;
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => {
      scrollAnchor.scrollIntoView({ behavior: "auto", block: "end" });
      scrollRaf = null;
    });
  });

  // Initialize on mount / persona change
  $effect(() => {
    if (personaId) {
      init(personaId, scenario, scenarioTypeFromUrl);
    }
  });

  async function init(pid, scn, scnType) {
    loading = true;
    currentPersonaId.set(pid);
    currentScenario.set(scn);
    currentScenarioType.set(scnType || null);

    try {
      // Load config if not already loaded
      if (!$personaConfig || $personaConfig.id !== pid) {
        const resp = await fetch(`/api/config?persona=${pid}`, {
          headers: authHeaders(),
        });
        if (!resp.ok) throw new Error("Failed to load config");
        const config = await resp.json();
        personaConfig.set(config);
        applyTheme(config.theme || {});
      }

      // Load conversations
      try {
        const convResp = await fetch(`/api/conversations?persona=${pid}`, {
          headers: authHeaders(),
        });
        if (convResp.ok) {
          const d = await convResp.json();
          conversations.set(d.conversations || []);
        }
      } catch {}

      // Check for saved conversation
      const savedConvId = localStorage.getItem("conv_" + pid);
      if (savedConvId) {
        await loadConversation(savedConvId);
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

  async function loadConversation(convId) {
    try {
      const resp = await fetch(`/api/conversations?id=${convId}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) {
        showWelcome();
        return;
      }
      const data = await resp.json();
      const conv = data.conversation || data;
      const convMessages = conv.messages || data.messages || [];

      currentConversationId.set(convId);
      localStorage.setItem("conv_" + personaId, convId);

      const config = $personaConfig;
      const sc = config?.scenarios?.[conv.scenario || scenario] || config?.scenarios?.default;
      const welcome = sc?.welcome || `Bonjour, je suis ${config?.name || "le clone"}.`;

      const msgs = [{ id: "welcome", role: "bot", content: welcome }];
      for (const msg of convMessages) {
        msgs.push({
          id: msg.id || crypto.randomUUID(),
          role: msg.role === "user" ? "user" : "bot",
          content: msg.content,
        });
      }
      messages.set(msgs);

      // Refresh sidebar
      try {
        const convResp = await fetch(`/api/conversations?persona=${personaId}`, {
          headers: authHeaders(),
        });
        if (convResp.ok) {
          const d = await convResp.json();
          conversations.set(d.conversations || []);
        }
      } catch {}
    } catch {
      showWelcome();
    }
  }

  async function handleScenarioChange(scenarioType) {
    if (!scenarioType || !isScenarioId(scenarioType)) return;
    if (scenarioType === $currentScenarioType) return;

    // Sprint 0.b dual-write : both stores stay in sync. The legacy store keeps
    // driving persona.scenarios jsonb lookups (welcome, scenario file path)
    // since persona jsonb wasn't restructured. currentScenarioType is what we
    // persist to conversations.scenario_type on the next insert.
    const legacy = legacyKeyFor(scenarioType);
    currentScenarioType.set(scenarioType);
    currentScenario.set(legacy);

    // Update URL so refresh / share preserves the choice. Replace state to
    // avoid polluting browser history with every scenario flip.
    const url = new URL(window.location.href);
    url.searchParams.set("scenario_type", scenarioType);
    url.searchParams.set("scenario", legacy);
    await goto(url.pathname + "?" + url.searchParams.toString(), {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });

    // Switching scenario starts a fresh conversation — a conv is pinned to
    // one scenario_type for learning/analytics integrity.
    localStorage.removeItem("conv_" + personaId);
    currentConversationId.set(null);
    showWelcome();
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
      { id: botId, role: "bot", content: "", typing: true, timestamp: now },
    ]);

    track("message_sent", {
      scenario_type: $currentScenarioType || $currentScenario || "default",
      persona_id: personaId,
    });

    let botText = "";

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
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId ? { ...m, content: botText, typing: false } : m
            )
          );
        },
        onThinking() {
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId ? { ...m, status: "Analyse du contexte..." } : m
            )
          );
        },
        onRewriting(attempt) {
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId
                ? { ...m, status: `Amelioration (tentative ${attempt})...` }
                : m
            )
          );
        },
        onClear() {
          // Rewrite is about to start — preserve the pass-1 text as `original`
          const originalText = botText;
          botText = "";
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId
                ? { ...m, content: "", status: undefined, original: originalText || m.original }
                : m
            )
          );
        },
        onDone(evt) {
          // Attach per-message telemetry on the bot message for the
          // lab-notebook strip to consume.
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId
                ? {
                    ...m,
                    status: undefined,
                    rewritten: evt?.rewritten || false,
                    timing: evt?.timing || null,
                    tokens: evt?.tokens || null,
                    model: evt?.model || null,
                    fidelity: evt?.fidelity || null,
                    live_style: evt?.live_style || null,
                    violations: evt?.violations || [],
                    sources: evt?.sources || null,
                  }
                : m
            )
          );

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
          if (evt?.live_style) {
            breakdown = evt.live_style;
          }

          // AuditStrip running totals — accumulate per-message.
          const drift = (evt?.violations || []).some(v => v.type === "fidelity_drift");
          const ruleFireDelta = (evt?.violations || []).length;
          sessionTotals = {
            msgCount: sessionTotals.msgCount + 1,
            rewriteCount: sessionTotals.rewriteCount + (evt?.rewritten ? 1 : 0),
            driftCount: sessionTotals.driftCount + (drift ? 1 : 0),
            inputTokens: sessionTotals.inputTokens + (evt?.tokens?.input || 0),
            outputTokens: sessionTotals.outputTokens + (evt?.tokens?.output || 0),
            cacheReadTokens: sessionTotals.cacheReadTokens + (evt?.tokens?.cache_read || 0),
            ruleFireCount: sessionTotals.ruleFireCount + ruleFireDelta,
          };
        },
        onHeat(evt) {
          thermRef?.applyHeatEvent(evt);
        },
        onConversation(id) {
          if (id && !$currentConversationId) {
            currentConversationId.set(id);
            localStorage.setItem("conv_" + personaId, id);
            // Refresh conversations
            refreshConversations();
          }
        },
        onError(type, detail) {
          if (type === "rate_limit") {
            showToast("Trop de messages, patientez");
            messages.update((msgs) => msgs.filter((m) => m.id !== botId));
          } else if (type === "budget") {
            messages.update((msgs) =>
              msgs.map((m) =>
                m.id === botId
                  ? {
                      ...m,
                      typing: false,
                      content:
                        "**Budget depasse.** Ajoutez votre cle API Anthropic dans les parametres (&#9881;) pour continuer.",
                    }
                  : m
              )
            );
          } else if (type === "reconnecting") {
            messages.update((msgs) =>
              msgs.map((m) =>
                m.id === botId
                  ? { ...m, status: "Reconnexion..." }
                  : m
              )
            );
          } else if (type === "failed") {
            messages.update((msgs) =>
              msgs.map((m) =>
                m.id === botId
                  ? {
                      ...m,
                      typing: false,
                      content: "Connexion perdue. Reessayez.",
                    }
                  : m
              )
            );
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

  function handleCorrect(message) {
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

  function handleLeadAnalyzed(msg) {
    handleSend(msg);
  }

  function handleKeyboard(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      if (showCommandPalette) showCommandPalette = false;
      else if (feedbackOpen) { feedbackOpen = false; feedbackTarget = null; feedbackMessageId = null; }
      else if (brainOpen) brainOpen = false;
      else if (leadOpen) leadOpen = false;
      else if (journalOpen) journalOpen = false;
      return;
    }
    if (mod && e.key === "k") {
      e.preventDefault();
      showCommandPalette = !showCommandPalette;
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

  function handleSwitchClone() {
    currentConversationId.set(null);
    currentScenario.set("");
    messages.set([]);
    goto("/");
  }

  function handleSwitchToClone(newId) {
    if (!newId || newId === personaId) return;
    currentConversationId.set(null);
    currentScenario.set("");
    messages.set([]);
    goto(`/chat/${newId}`);
  }

  function handleBack() {
    currentConversationId.set(null);
    currentScenario.set("");
    messages.set([]);
    goto("/");
  }
</script>

<svelte:window onkeydown={handleKeyboard} />

{#if loading}
  <div class="loading-screen">
    <div class="loading-dot"></div>
  </div>
{:else}
  <div class="chat-layout">
    <ConversationSidebar
      {personaId}
      currentConvId={$currentConversationId}
      onselectconversation={handleSelectConversation}
      onnewconversation={handleNewConversation}
      onswitchclone={handleSwitchClone}
      open={sidebarOpen}
    />

    {#if sidebarOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="sidebar-backdrop" onclick={() => (sidebarOpen = false)}></div>
    {/if}

    <div class="chat-main">
      <ChatCockpit
        personaName={$personaConfig?.name || "Clone"}
        personaAvatar={$personaConfig?.avatar || "?"}
        scenario={$currentScenario || ""}
        {collapseIdx}
        {fidelity}
        {breakdown}
        {sourceStyle}
        personasList={$personas}
        currentPersonaId={personaId}
        bind:switcherOpen
        onSwitchClone={handleSwitchToClone}
        {rulesActiveCount}
        {leadOpen}
        {sidebarOpen}
        {journalOpen}
        {brainOpen}
        onBack={handleBack}
        onToggleSidebar={() => sidebarOpen = !sidebarOpen}
        onToggleLead={() => leadOpen = !leadOpen}
        onToggleJournal={() => journalOpen = !journalOpen}
        onToggleBrain={() => {
          if (!brainOpen) brainInitialTab = "règles";
          brainOpen = !brainOpen;
        }}
      />

      <div class="chat-body">
        <div class="chat-messages-col">
          <!-- Section heads mirror the landing's numbered pipeline (01-05) so
               the mental model formed on the landing carries into the chat:
               01 PROMPT (composer) → 02 SORTIE (messages) → 03 RÈGLES (drawer)
               → 04 MÉTRIQUES + 05 FIDÉLITÉ (strip below). Consistency drops
               cognitive load on first entry — "I've seen this layout before". -->
          <div class="sec-head mono">
            <span class="sec-idx">02</span>
            <span class="sec-name">sortie</span>
            <span class="sec-ctx">{$currentScenarioType || $currentScenario || "en direct"}</span>
          </div>
          <div class="chat-messages" bind:this={messagesEl}>
            {#each $messages as message (message.id)}
              <ChatMessage
                {message}
                seq={seqForMessage(message, $messages)}
                prevFidelity={prevFidelityFor(message, $messages)}
                {sourceStyle}
                onCorrect={handleCorrect}
                onSaveRule={handleSaveRule}
                onCopyBlock={() => {}}
              />
            {/each}
            <div bind:this={scrollAnchor}></div>
          </div>

          <div class="composer-toolbar">
            <span class="sec-tag mono">
              <span class="sec-idx">01</span>
              <span class="sec-name">prompt</span>
            </span>
            <ScenarioSwitcher
              persona={$personaConfig}
              value={$currentScenarioType}
              kind={scenarioKind}
              onchange={handleScenarioChange}
              disabled={$sending}
            />
          </div>
          <ChatInput onsend={handleSend} disabled={$sending} scenarioType={$currentScenarioType} />
          <LiveMetricsStrip {breakdown} {fidelity} {collapseIdx} />
          <AuditStrip totals={sessionTotals} {sessionStart} />
        </div>

        {#if ($currentScenarioType ?? '').startsWith('DM')}
          <HeatThermometer bind:this={thermRef} conversationId={$currentConversationId} />
        {/if}
      </div>
    </div>
  </div>

  {#if PersonaBrainDrawer}
    <PersonaBrainDrawer
      open={brainOpen}
      {personaId}
      {ruleStats}
      initialTab={brainInitialTab}
      onClose={() => brainOpen = false}
    />
  {/if}

  {#if FeedbackPanel}
    <FeedbackPanel
      open={feedbackOpen}
      botMessage={feedbackTarget || ""}
      onClose={() => { feedbackOpen = false; feedbackTarget = null; feedbackMessageId = null; }}
      onReplace={handleReplace}
    />
  {/if}

  {#if LeadPanel}
    <LeadPanel
      open={leadOpen}
      onClose={() => leadOpen = false}
      onAnalyzed={handleLeadAnalyzed}
    />
  {/if}

  {#if LearningJournal}
    <LearningJournal
      {personaId}
      open={journalOpen}
      onClose={() => journalOpen = false}
    />
  {/if}

  {#if showCommandPalette && CommandPalette}
    <CommandPalette
      conversations={$conversations}
      onselect={(id) => { showCommandPalette = false; handleSelectConversation(id); }}
      onclose={() => (showCommandPalette = false)}
    />
  {/if}
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
    display: grid;
    grid-template-columns: 1fr 300px;
    min-height: 0;
  }

  .chat-messages-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  @media (max-width: 1024px) {
    .chat-body { grid-template-columns: 1fr; }
    /* HeatThermometer's own mobile media query renders it as a compact bar below .chat-messages-col */
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  /* Composer toolbar — sits above the chat input. Hosts the 01 PROMPT
     section tag + scenario switcher. */
  .composer-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px 0;
    background: var(--paper);
  }
  @media (max-width: 480px) {
    .composer-toolbar { padding: 4px 8px 0; gap: 6px; }
  }

  /* Section heads — mirror landing's 01/02/03/04/05 typographic language.
     Mono, uppercase, vermillon index, ink label, optional ink-40 context. */
  .sec-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 6px 16px;
    border-bottom: 1px dashed var(--rule);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: var(--paper);
  }
  .sec-tag {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .sec-idx { color: var(--vermillon); font-weight: 600; }
  .sec-name { color: var(--ink); font-weight: 600; }
  .sec-ctx {
    color: var(--ink-40);
    text-transform: lowercase;
    letter-spacing: 0.02em;
    font-size: 10px;
    margin-left: auto;
  }
  @media (max-width: 480px) {
    .sec-head { padding: 6px 10px; }
    .sec-ctx { display: none; }
  }

  .loading-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100dvh;
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
</style>
