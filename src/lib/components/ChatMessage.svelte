<script>
  import { fly } from "svelte/transition";
  import { renderMarkdown, toLinkedIn } from "$lib/utils.js";
  import MessageMarginalia from "./MessageMarginalia.svelte";

  let { message, seq = null, prevFidelity = null, sourceStyle = null, onCorrect, onSaveRule, onCopyBlock } = $props();

  let ruleSaved = $state(false);
  let showDiff = $state(false);
  let margOpen = $state(false);
  let copiedLabel = $state("");
  let copiedTimer;

  const COPY_MODE_KEY = "copy_mode_default";
  const COPY_MODES = [
    { id: "linkedin", label: "LinkedIn-ready", hint: "Unicode gras/italique, puces •" },
    { id: "markdown", label: "Markdown", hint: "texte brut avec ** et *" },
    { id: "plain", label: "Texte brut", hint: "supprime le markdown" },
  ];
  let copyMode = $state("linkedin");
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(COPY_MODE_KEY);
      if (saved && COPY_MODES.some((m) => m.id === saved)) copyMode = saved;
    } catch {}
  }

  let blocks = $derived(
    message.role === "bot" && message.content
      ? message.content.split(/\n\n+/).filter((b) => b.trim())
      : []
  );
  let isMultiBlock = $derived(blocks.length > 1);

  function stripMarkdown(md) {
    return md
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/^---+\s*$/gm, "")
      .replace(/^[-*•]\s+/gm, "")
      .replace(/^(\d+)[.)]\s+/gm, "$1. ");
  }

  function formatFor(mode, text) {
    if (mode === "linkedin") return toLinkedIn(text);
    if (mode === "plain") return stripMarkdown(text);
    return text; // markdown
  }

  function copyAs(mode, text) {
    navigator.clipboard.writeText(formatFor(mode, text));
    const modeObj = COPY_MODES.find((m) => m.id === mode);
    copiedLabel = modeObj?.label ?? "Copié";
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedLabel = ""), 1400);
  }

  function copyDefault() {
    copyAs(copyMode, message.content);
  }

  function copyBlock(block, btnEl) {
    navigator.clipboard.writeText(formatFor(copyMode, block));
    onCopyBlock?.(block);
  }

  // Lab-notebook stamp: `[usr:001 14:42:17]` / `[bot:001 14:42:17]`
  function fmtClock(ts) {
    if (!ts) return "";
    const d = typeof ts === "number" ? new Date(ts) : ts;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  let stamp = $derived(fmtClock(message.timestamp));
</script>

<article
  class="msg-row"
  class:msg-row-user={message.role === "user"}
  class:msg-row-bot={message.role === "bot"}
  transition:fly={{ y: 4, duration: 120 }}
>
  <!-- ── Message column ── -->
  <!-- msg-stamp (bot:001 14:42:17 sonnet) moved to marginalia (⋯ toggle).
       Keeps the DM thread clean for copy-paste — lab-notebook data on demand. -->
  <div class="msg-col">
    <div
      class="msg"
      class:msg-user={message.role === "user"}
      class:msg-bot={message.role === "bot"}
    >
      {#if message.role === "user"}
        {message.content}
        <div class="msg-actions user-actions">
          {#if ruleSaved}
            <span class="action-validated">Sauvegardé ✓</span>
          {:else}
            <button class="action-btn" onclick={() => { ruleSaved = true; onSaveRule?.(message); }}>Sauver comme règle</button>
          {/if}
        </div>
      {:else if message.typing}
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      {:else if isMultiBlock}
        {#each blocks as block}
          <div class="copyable-block">
            {@html renderMarkdown(block)}
            <button
              class="block-copy-btn"
              title="Copier ce bloc"
              onclick={(e) => { e.stopPropagation(); copyBlock(block, e.currentTarget); }}
            >&#10697;</button>
          </div>
        {/each}
      {:else}
        {@html renderMarkdown(message.content || "")}
      {/if}

      {#if message.role === "bot" && !message.typing && message.content}
        <div class="msg-actions">
          <!-- Single Copier button — uses persisted default (linkedin). Mode
               switch via a settings preference later, not per-message. -->
          <button
            class="action-btn"
            onclick={copyDefault}
            title="Copier — format LinkedIn"
          >{copiedLabel ? `${copiedLabel} ✓` : "Copier"}</button>
          <button class="action-btn action-btn-primary" onclick={() => onCorrect?.(message)}>Corriger</button>
        </div>
      {/if}

      {#if message.status}
        <div class="status">{message.status}</div>
      {/if}
    </div>

    <!-- Inline diff stays in the message column so the strike-through is
         right below the rewritten output (natural reading order). The
         toggle button lives in the marginalia. -->
    {#if showDiff && message.original}
      <details class="diff-inline" open>
        <summary class="diff-inline-head mono">pass 1 · original (overridden)</summary>
        <div class="diff-inline-body">{message.original}</div>
      </details>
    {/if}

    {#if message.role === "bot" && !message.typing && message.content}
      <button
        class="marg-toggle mono"
        aria-expanded={margOpen}
        aria-controls="marg-{message.id}"
        onclick={() => margOpen = !margOpen}
        title="Annotations labo"
      >
        {margOpen ? "×" : "⋯"}
      </button>
      {#if margOpen}
        <section id="marg-{message.id}" class="marg-inline">
          <MessageMarginalia
            {message}
            {stamp}
            {seq}
            {prevFidelity}
            {sourceStyle}
            bind:showDiff
          />
        </section>
      {/if}
    {/if}

  </div>
</article>

<style>
  /* ── Single-column row: message + inline marginalia toggle ── */
  .msg-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .msg-col {
    display: flex;
    flex-direction: column;
    max-width: 64ch;
    width: 100%;
  }
  .msg-row-user .msg-col {
    align-items: flex-end;
    align-self: flex-end;
  }
  .msg-row-bot .msg-col {
    align-items: flex-start;
  }

  .marg-toggle {
    align-self: flex-end;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--ink-30);
    font-size: 12px;
    padding: 2px 6px;
    transition: color 0.2s ease;
  }
  .marg-toggle:hover { color: var(--vermillon); }
  .marg-toggle:focus-visible { outline: 1px solid var(--vermillon); outline-offset: 2px; }

  .marg-inline {
    border-top: 1px dashed var(--rule);
    margin-top: 4px;
    padding-top: 6px;
  }

  .msg {
    padding: 10px 14px;
    font-size: var(--fs-standout);
    line-height: var(--lh-normal);
    position: relative;
    max-width: 100%;
  }

  /* User message: ink-on-paper, mono for compact feel */
  .msg-user {
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    border-left: 2px solid var(--vermillon);
  }

  /* Bot message: serif prose on paper-subtle, lab-notebook feel */
  .msg-bot {
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--ink);
    color: var(--ink);
    font-family: var(--font);
  }

  .msg-bot :global(strong) { font-weight: var(--fw-semi); }
  .msg-bot :global(em) { font-style: italic; color: var(--ink-70); }
  .msg-bot :global(hr) { border: none; border-top: 1px dashed var(--rule); margin: 10px 0; }
  .msg-bot :global(ul) { list-style: none; padding: 0; margin: 6px 0; }
  .msg-bot :global(li) {
    padding-left: 16px;
    position: relative;
    margin: 3px 0;
    color: var(--ink-70);
  }
  .msg-bot :global(li)::before {
    content: "→";
    position: absolute;
    left: 0;
    top: 0;
    color: var(--vermillon);
    font-family: var(--font-mono);
    font-size: var(--fs-small);
  }

  .msg-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity var(--dur-fast, 80ms) linear;
  }
  .msg:hover .msg-actions,
  .msg:focus-within .msg-actions { opacity: 1; }

  .user-actions { justify-content: flex-end; }
  .user-actions .action-btn {
    color: var(--paper);
    border-color: rgba(245, 242, 236, 0.3);
    background: transparent;
  }
  .user-actions .action-btn:hover {
    color: var(--paper);
    border-color: var(--vermillon);
  }
  .user-actions .action-validated { color: rgba(245, 242, 236, 0.7); }

  .action-btn {
    padding: 3px 8px;
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: color var(--dur-fast, 80ms) linear, border-color var(--dur-fast, 80ms) linear;
  }
  .action-btn:hover {
    color: var(--ink);
    border-color: var(--ink-40);
  }

  .action-btn-primary {
    background: var(--vermillon);
    border-color: var(--vermillon);
    color: var(--paper);
  }
  .action-btn-primary:hover {
    background: color-mix(in srgb, var(--vermillon) 88%, black);
    border-color: color-mix(in srgb, var(--vermillon) 88%, black);
    color: var(--paper);
  }

  .action-validated {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #2d7a3e;
    padding: 3px 8px;
  }

  .copyable-block {
    position: relative;
    padding-right: 28px;
  }

  .copyable-block + .copyable-block {
    margin-top: 0.5rem;
  }

  .block-copy-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 22px;
    height: 22px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--ink-40);
    font-size: var(--fs-small);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--dur-fast, 80ms) linear, border-color var(--dur-fast, 80ms) linear;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    user-select: none;
  }
  .copyable-block:hover .block-copy-btn {
    opacity: 0.7;
    border-color: var(--rule-strong);
  }
  .block-copy-btn:hover {
    opacity: 1 !important;
    color: var(--vermillon);
    border-color: var(--vermillon);
  }

  /* Rewrite badges moved into MessageMarginalia — only the inline diff block
     remains here, still rendered in the message column under the bubble. */

  .diff-inline {
    margin-top: 6px;
    border-left: 2px solid var(--vermillon, #d64933);
    padding: 4px 0 4px 10px;
    background: color-mix(in srgb, var(--vermillon, #d64933) 3%, transparent);
  }
  .diff-inline-head {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-40, #6f6f7a);
    padding: 2px 0 6px;
    cursor: pointer;
    list-style: none;
  }
  .diff-inline-head::-webkit-details-marker { display: none; }
  .diff-inline-body {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink-40, #6f6f7a);
    text-decoration: line-through;
    text-decoration-color: var(--vermillon, #d64933);
    white-space: pre-wrap;
    padding-top: 2px;
  }

  .status {
    font-family: var(--font-mono);
    font-size: var(--fs-nano);
    color: var(--ink-40);
    margin-top: 6px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 6px 0;
  }
  .typing-indicator span {
    width: 5px;
    height: 5px;
    background: var(--ink-40);
    animation: typing-pulse 1s linear infinite;
  }
  .typing-indicator span:nth-child(2) { animation-delay: 0.15s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing-pulse {
    0%, 60%, 100% { background: var(--ink-40); }
    30% { background: var(--vermillon); }
  }
</style>
