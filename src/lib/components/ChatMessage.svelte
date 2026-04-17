<script>
  import { fly } from "svelte/transition";
  import { renderMarkdown } from "$lib/utils.js";
  import MessageMarginalia from "./MessageMarginalia.svelte";

  let { message, seq = null, prevFidelity = null, sourceStyle = null, onCorrect, onValidate, onSaveRule, onCopyBlock } = $props();

  let ruleSaved = $state(false);
  let showDiff = $state(false);

  let blocks = $derived(
    message.role === "bot" && message.content
      ? message.content.split(/\n\n+/).filter((b) => b.trim())
      : []
  );
  let isMultiBlock = $derived(blocks.length > 1);

  function copyFull() {
    navigator.clipboard.writeText(message.content);
  }

  function copyBlock(block, btnEl) {
    navigator.clipboard.writeText(block);
    onCopyBlock?.(block);
  }

  // Lab-notebook stamp: `[usr:001 14:42:17]` / `[bot:001 14:42:17]`
  function fmtClock(ts) {
    if (!ts) return "";
    const d = typeof ts === "number" ? new Date(ts) : ts;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fmtSeq(n) {
    if (n === null || n === undefined) return "";
    return String(n).padStart(3, "0");
  }

  let stamp = $derived(fmtClock(message.timestamp));
  let seqStr = $derived(fmtSeq(seq));
</script>

<article
  class="msg-row"
  class:msg-row-user={message.role === "user"}
  class:msg-row-bot={message.role === "bot"}
  transition:fly={{ y: 4, duration: 120 }}
>
  <!-- ── Message column ── -->
  <div class="msg-col">
    {#if seqStr && message.role === "bot"}
      <header class="msg-stamp mono narrow-only">
        <span class="stamp-tag">bot:{seqStr}</span>
        {#if stamp}<span class="stamp-time">{stamp}</span>{/if}
        {#if message.model}<span class="stamp-model">{message.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}</span>{/if}
      </header>
    {:else if seqStr && message.role === "user"}
      <header class="msg-stamp mono stamp-user narrow-only">
        <span class="stamp-tag">usr:{seqStr}</span>
        {#if stamp}<span class="stamp-time">{stamp}</span>{/if}
      </header>
    {/if}

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
          <button class="action-btn" onclick={copyFull}>Copier</button>
          <button class="action-btn" onclick={() => onCorrect?.(message)}>Corriger</button>
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

  <!-- ── Margin column ── -->
  <div class="margin-col">
    {#if message.role === "bot" && !message.typing && message.content}
      <MessageMarginalia
        {message}
        {stamp}
        {seq}
        {prevFidelity}
        {sourceStyle}
        bind:showDiff
      />
    {:else if message.role === "user" && seqStr}
      <div class="margin-user-stamp mono" aria-label="User message stamp">
        <span class="stamp-tag">usr:{seqStr}</span>
        {#if stamp}<span class="stamp-time">{stamp}</span>{/if}
      </div>
    {/if}
  </div>
</article>

<style>
  /* ── 2-col row: message | margin ── */
  .msg-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 16px;
    align-items: start;
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
    justify-self: end;
  }
  .msg-row-bot .msg-col {
    align-items: flex-start;
  }

  .margin-col {
    align-self: start;
    position: sticky;
    top: 8px;
  }

  /* Collapse to single column on narrow screens — margin drops below */
  @media (max-width: 1024px) {
    .msg-row {
      grid-template-columns: 1fr;
    }
    .margin-col { position: static; }
    .msg-row-user .margin-col { display: none; }
  }

  .msg-stamp {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 2px 4px;
    font-size: 9.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .msg-stamp.stamp-user { color: var(--ink-40); }
  .stamp-tag {
    font-weight: 600;
    color: var(--ink);
  }
  .stamp-time {
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
  }
  .stamp-model {
    color: var(--ink-30);
    font-size: 10px;
  }
  .msg-row-user .stamp-tag { color: var(--vermillon); }

  /* User-stamp block in the right margin (wide screens only) */
  .margin-user-stamp {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 10px 0 14px;
    border-left: 1px solid var(--rule-strong);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-40);
  }
  .margin-user-stamp .stamp-tag {
    color: var(--vermillon);
    font-weight: 600;
  }
  .margin-user-stamp .stamp-time {
    color: var(--ink-40);
    font-variant-numeric: tabular-nums;
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
