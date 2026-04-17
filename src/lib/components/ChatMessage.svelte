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
    max-width: 85%;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .msg-user {
    align-self: flex-end;
    background: var(--text);
    color: var(--bg);
    border-radius: var(--radius) var(--radius) 2px var(--radius);
  }

  .msg-bot {
    align-self: flex-start;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius) var(--radius) var(--radius) 2px;
    color: var(--text);
  }

  .msg-bot :global(strong) { font-weight: 600; }
  .msg-bot :global(em) { font-style: italic; color: var(--text-secondary); }
  .msg-bot :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.5rem 0; }
  .msg-bot :global(ul) { list-style: none; padding: 0; margin: 0.25rem 0; }
  .msg-bot :global(li) {
    padding-left: 0.875rem;
    position: relative;
    margin: 0.125rem 0;
    color: var(--text-secondary);
  }
  .msg-bot :global(li)::before {
    content: "\2192";
    position: absolute;
    left: 0;
    color: var(--text-tertiary);
    font-size: 0.75rem;
  }

  .msg-actions {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.5rem;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .msg:hover .msg-actions { opacity: 1; }

  .user-actions {
    justify-content: flex-end;
  }

  .user-actions .action-btn {
    color: var(--bg);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .user-actions .action-btn:hover {
    color: var(--bg);
    border-color: rgba(255, 255, 255, 0.6);
  }

  .user-actions .action-validated {
    color: rgba(255, 255, 255, 0.8);
  }

  .action-btn {
    padding: 0.25rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-tertiary);
    font-size: 0.6875rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .action-btn:hover {
    color: var(--text-secondary);
    border-color: var(--text-tertiary);
  }

  .action-validated {
    font-size: 0.6875rem;
    color: var(--success);
    padding: 0.25rem 0.5rem;
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
    border-radius: 4px;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, border-color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    user-select: none;
  }

  .copyable-block:hover .block-copy-btn {
    opacity: 0.7;
    border-color: var(--border);
  }

  .block-copy-btn:hover {
    opacity: 1 !important;
    color: var(--text-secondary);
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
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    margin-top: 0.375rem;
  }

  .typing-indicator {
    display: flex;
    gap: 3px;
    padding: 0.375rem 0;
  }

  .typing-indicator span {
    width: 4px;
    height: 4px;
    background: var(--text-tertiary);
    border-radius: 50%;
    animation: pulse 1s infinite;
  }

  .typing-indicator span:nth-child(2) { animation-delay: 0.15s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.3s; }

  @keyframes pulse {
    0%, 60%, 100% { opacity: 0.25; }
    30% { opacity: 0.8; }
  }
</style>
