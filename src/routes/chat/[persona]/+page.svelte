<script>
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { get } from "svelte/store";
  import { accessCode } from "$lib/stores/auth.js";
  import { personaConfig, currentPersonaId } from "$lib/stores/persona.js";
  import {
    messages,
    currentConversationId,
    conversations,
    currentScenario,
    sending,
  } from "$lib/stores/chat.js";
  import { showToast } from "$lib/stores/ui.js";
  import { authHeaders } from "$lib/api.js";
  import { streamChat } from "$lib/sse.js";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import ChatInput from "$lib/components/ChatInput.svelte";
  import ConversationSidebar from "$lib/components/ConversationSidebar.svelte";
  import FeedbackModal from "$lib/components/FeedbackModal.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import LeadModal from "$lib/components/LeadModal.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";

  let personaId = $derived($page.data.personaId);
  let scenario = $derived($page.data.scenario);

  let loading = $state(true);
  let sidebarOpen = $state(false);
  let messagesEl = $state(undefined);
  let scrollAnchor = $state(undefined);

  // Modal state
  let feedbackTarget = $state(null);
  let showSettings = $state(false);
  let showLead = $state(false);
  let showCommandPalette = $state(false);

  // Scroll to bottom when messages change
  $effect(() => {
    // Subscribe to messages store reactively
    const msgs = $messages;
    if (scrollAnchor) {
      // Small delay so DOM renders first
      requestAnimationFrame(() => {
        scrollAnchor.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  });

  // Initialize on mount / persona change
  $effect(() => {
    if (personaId) {
      init(personaId, scenario);
    }
  });

  async function init(pid, scn) {
    loading = true;
    currentPersonaId.set(pid);
    currentScenario.set(scn);

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

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme.accent) root.style.setProperty("--accent", theme.accent);
    if (theme.background) root.style.setProperty("--bg", theme.background);
    if (theme.surface) root.style.setProperty("--surface", theme.surface);
    if (theme.text) root.style.setProperty("--text", theme.text);
  }

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

  async function handleSend(text) {
    if ($sending) return;
    sending.set(true);

    // Add user message
    const userId = crypto.randomUUID();
    const botId = crypto.randomUUID();

    messages.update((msgs) => [
      ...msgs,
      { id: userId, role: "user", content: text },
      { id: botId, role: "bot", content: "", typing: true },
    ]);

    let botText = "";

    await streamChat(
      {
        message: text,
        scenario: $currentScenario,
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
          botText = "";
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId ? { ...m, content: "", status: undefined } : m
            )
          );
        },
        onDone(evt) {
          messages.update((msgs) =>
            msgs.map((m) =>
              m.id === botId
                ? { ...m, status: undefined, rewritten: evt?.rewritten || false }
                : m
            )
          );
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
  }

  async function handleValidate(message) {
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "validate",
          botMessage: message.content,
          persona: get(currentPersonaId),
        }),
      });
      showToast("Noté ✓");
    } catch {}
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
      else if (feedbackTarget) feedbackTarget = null;
      else if (showSettings) showSettings = false;
      else if (showLead) showLead = false;
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
      <div class="chat-header">
        <button class="mobile-menu-btn" onclick={() => (sidebarOpen = !sidebarOpen)}>
          &#9776;
        </button>
        <button class="back-btn" onclick={handleBack}>&larr;</button>
        <div class="chat-avatar">{$personaConfig?.avatar || "?"}</div>
        <div class="chat-name">{$personaConfig?.name || "Clone"}</div>
        <button class="lead-btn" title="Analyser un prospect" onclick={() => (showLead = true)}>&#128269;</button>
        <a href="/guide" class="guide-btn" title="Guide d'onboarding">?</a>
        <button class="settings-btn" title="Parametres" onclick={() => (showSettings = true)}>&#9881;</button>
      </div>

      <div class="chat-messages" bind:this={messagesEl}>
        {#each $messages as message (message.id)}
          <ChatMessage
            {message}
            onCorrect={handleCorrect}
            onValidate={handleValidate}
            onSaveRule={handleSaveRule}
            onCopyBlock={() => {}}
          />
        {/each}
        <div bind:this={scrollAnchor}></div>
      </div>

      <ChatInput onsend={handleSend} disabled={$sending} />
    </div>
  </div>

  {#if feedbackTarget}
    <FeedbackModal botMessage={feedbackTarget} onclose={() => { feedbackTarget = null; feedbackMessageId = null; }} onreplace={handleReplace} />
  {/if}

  {#if showSettings}
    <SettingsModal onclose={() => (showSettings = false)} {personaId} />
  {/if}

  {#if showLead}
    <LeadModal onclose={() => (showLead = false)} onanalyzed={handleLeadAnalyzed} />
  {/if}

  {#if showCommandPalette}
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

  .chat-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .chat-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 600;
  }

  .chat-name {
    font-weight: 500;
    font-size: 0.8125rem;
    color: var(--text);
  }

  .back-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius);
    transition: color 0.15s;
    flex-shrink: 0;
  }

  .back-btn:hover { color: var(--text); }

  .lead-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    margin-left: auto;
    transition: color 0.15s;
  }

  .lead-btn:hover { color: var(--text); }

  .guide-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-tertiary);
    font-size: 0.6875rem;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    width: 1.375rem;
    height: 1.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: color 0.15s, border-color 0.15s;
    text-decoration: none;
  }

  .guide-btn:hover { color: var(--text-secondary); border-color: var(--text-tertiary); }

  .settings-btn {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    font-size: 1rem;
    cursor: pointer;
    padding: 0.25rem;
    transition: color 0.15s;
  }

  .settings-btn:hover { color: var(--text-secondary); }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
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

  .mobile-menu-btn {
    display: none;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem;
  }

  .sidebar-backdrop {
    display: none;
  }

  @media (max-width: 768px) {
    .mobile-menu-btn {
      display: block;
    }

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
