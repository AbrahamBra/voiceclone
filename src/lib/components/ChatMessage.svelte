<script>
  import { fly } from "svelte/transition";
  import { renderMarkdown } from "$lib/utils.js";

  let { message, onCorrect, onValidate, onSaveRule, onCopyBlock } = $props();

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
</script>

<div
  class="msg"
  class:msg-user={message.role === "user"}
  class:msg-bot={message.role === "bot"}
  transition:fly={{ y: 4, duration: 120 }}
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

  {#if message.rewritten}
    <div class="rewrite-line">
      {#if message.original}
        <button
          class="rewrite-toggle"
          class:open={showDiff}
          onclick={() => showDiff = !showDiff}
          aria-expanded={showDiff}
        >
          <span class="rt-badge">rewritten</span>
          <span class="rt-action">{showDiff ? "cacher l'original" : "voir l'original"}</span>
        </button>
      {:else}
        <span class="rewrite-badge mono">rewritten</span>
      {/if}
    </div>
    {#if showDiff && message.original}
      <details class="diff-inline" open>
        <summary class="diff-inline-head mono">pass 1 · original (overridden)</summary>
        <div class="diff-inline-body">{message.original}</div>
      </details>
    {/if}
  {/if}

  {#if message.status}
    <div class="status">{message.status}</div>
  {/if}
</div>

<style>
  .msg {
    max-width: 68ch;
    padding: 10px 14px;
    font-size: var(--fs-standout);
    line-height: var(--lh-normal);
    position: relative;
  }

  /* User message: ink-on-paper, right-aligned, mono for compact feel */
  .msg-user {
    align-self: flex-end;
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-ui);
    font-size: var(--fs-body);
    border-left: 2px solid var(--vermillon);
  }

  /* Bot message: serif prose on paper-subtle, lab-notebook feel */
  .msg-bot {
    align-self: flex-start;
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

  .rewrite-line {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 0.375rem;
  }
  .rewrite-badge {
    display: inline-block;
    padding: 1px 6px;
    background: color-mix(in srgb, var(--vermillon, #d64933) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--vermillon, #d64933) 35%, transparent);
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vermillon, #d64933);
  }
  .rewrite-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    color: var(--ink-40);
  }
  .rewrite-toggle .rt-badge {
    padding: 1px 6px;
    background: color-mix(in srgb, var(--vermillon, #d64933) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--vermillon, #d64933) 35%, transparent);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vermillon, #d64933);
  }
  .rewrite-toggle .rt-action {
    font-size: 10.5px;
    color: var(--ink-40);
    border-bottom: 1px dashed var(--ink-40);
    transition: color 0.08s linear, border-color 0.08s linear;
  }
  .rewrite-toggle:hover .rt-action,
  .rewrite-toggle.open .rt-action {
    color: var(--vermillon, #d64933);
    border-color: var(--vermillon, #d64933);
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
