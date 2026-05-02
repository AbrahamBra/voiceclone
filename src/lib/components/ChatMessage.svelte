<script>
  import { fly } from "svelte/transition";
  import { renderMarkdown, toLinkedIn } from "$lib/utils.js";

  let {
    message, seq = null,
    onCorrect, onValidate, onClientValidate, onExcellent, onRegen, onSaveRule, onCopyBlock, onCopyOut,
  } = $props();

  // Narrative kind derived from message.turn_kind (new axis from migration 028),
  // with fallback for legacy rows that still use only role.
  let kind = $derived(
    message.turn_kind
    || (message.role === "user" ? "legacy-user" : "legacy-assistant")
  );
  let isDraft = $derived(kind === "clone_draft");
  let isSent = $derived(kind === "toi");
  let isProspect = $derived(kind === "prospect");
  let isLegacy = $derived(kind === "legacy-user" || kind === "legacy-assistant" || kind === "legacy");

  let ruleSaved = $state(false);
  let showDiff = $state(false);
  let copied = $state(false);
  let copiedTimer;

  let blocks = $derived(
    message.role === "bot" && message.content
      ? message.content.split(/\n\n+/).filter((b) => b.trim())
      : []
  );
  let isMultiBlock = $derived(blocks.length > 1);

  function copyDefault() {
    navigator.clipboard.writeText(toLinkedIn(message.content));
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1400);
    onCopyOut?.(message.content);
  }

  function copyBlock(block) {
    navigator.clipboard.writeText(toLinkedIn(block));
    onCopyBlock?.(block);
    onCopyOut?.(block);
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
  class:msg-row-bot={message.role === "assistant" || message.role === "bot"}
  class:msg-row-draft={isDraft}
  class:msg-row-sent={isSent}
  class:msg-row-prospect={isProspect}
  data-msg-id={message.id}
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
        {#if !isProspect}
          <div class="msg-actions user-actions">
            {#if ruleSaved}
              <span class="action-validated">Sauvegardé ✓</span>
            {:else}
              <button class="action-btn" onclick={() => { ruleSaved = true; onSaveRule?.(message); }}>Sauver comme règle</button>
            {/if}
          </div>
        {/if}
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
              onclick={(e) => { e.stopPropagation(); copyBlock(block); }}
            >&#10697;</button>
          </div>
        {/each}
      {:else}
        {@html renderMarkdown(message.content || "")}
      {/if}

      {#if message.role === "bot" && !message.typing && message.content}
        <div class="msg-actions">
          <button
            class="action-btn"
            onclick={copyDefault}
            title="Copier le message en version LinkedIn"
          >{copied ? "Copié ✓" : (isDraft ? "📋 copier" : "Copier")}</button>

          {#if isDraft}
            <!-- Draft actions: c'est ça (validation client explicite, signal fort
                 → +0.12 entity boost) / excellent (pattern à multiplier).
                 corriger → FeedbackPanel ; regen → retry sans signal.
                 Hiérarchie visuelle : ★ excellent = rouge plein (signal le plus
                 fort), ✓ c'est ça = rouge clair (validation courante). -->
            <button class="action-btn action-btn-soft" onclick={() => onClientValidate?.(message)} title="C'est ça — signal d'apprentissage fort">✓ c'est ça</button>
            <button class="action-btn action-btn-excellent" onclick={() => onExcellent?.(message)} title="Excellent — pattern à multiplier">★ excellent</button>
            <button class="action-btn" onclick={() => onCorrect?.(message)} title="Corriger">✎ corriger</button>
            <button class="action-btn" onclick={() => onRegen?.(message)} title="Regénérer sans correction">↻ regen</button>
          {:else if isSent}
            <!-- Sent message (toi): read-only, only copy remains. -->
          {:else}
            <!-- Legacy fallback (pre-migration assistant messages or missing turn_kind) -->
            <button class="action-btn action-btn-primary" onclick={() => onCorrect?.(message)}>Corriger</button>
          {/if}
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

  /* Draft (clone_draft): paper-pâle teinted + ocre border-left — signals "pending". */
  .msg-row-draft :global(.msg-bot) {
    background: #f5efe4;
    border-left-color: #b37e3b;
  }
  /* Sent (toi): back to neutral — indistinguishable from a historical sent message. */
  .msg-row-sent :global(.msg-bot) {
    background: var(--paper);
  }
  /* Prospect (incoming reply): left-aligned, paper-subtle bg, grey border —
     visuellement distinct des consignes user (dark-right) et des drafts clone. */
  .msg-row-prospect .msg-col {
    align-self: flex-start;
    align-items: flex-start;
  }
  .msg-row-prospect .msg-user {
    background: var(--paper-subtle);
    color: var(--ink);
    font-family: var(--font);
    font-size: var(--fs-standout);
    border-left: 2px solid var(--ink-40);
  }
  /* Highlight animation triggered when rail feedback entry is clicked */
  :global(.msg-highlight) {
    animation: highlightPulse 2s ease-out;
  }
  @keyframes highlightPulse {
    0% { background-color: #fffbe6; }
    100% { background-color: transparent; }
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

  /* Soft: rouge clair pour ✓ c'est ça — validation courante (vs excellent = pattern à multiplier). */
  .action-btn-soft {
    background: color-mix(in srgb, var(--vermillon) 14%, var(--paper));
    border-color: color-mix(in srgb, var(--vermillon) 40%, var(--paper));
    color: var(--vermillon);
  }
  .action-btn-soft:hover {
    background: color-mix(in srgb, var(--vermillon) 22%, var(--paper));
    border-color: var(--vermillon);
    color: var(--vermillon);
  }

  /* Excellent: rouge plein — signal le plus fort, pattern à multiplier. */
  .action-btn-excellent {
    background: var(--vermillon);
    border-color: var(--vermillon);
    color: var(--paper);
  }
  .action-btn-excellent:hover {
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
