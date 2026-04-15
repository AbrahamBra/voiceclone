<script>
  import { fly } from "svelte/transition";
  import { renderMarkdown } from "$lib/utils.js";

  let { message, onCorrect, onCopyBlock } = $props();

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
    <div class="rewrite-badge">Corrige automatiquement</div>
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
  }

  .copyable-block:hover .block-copy-btn {
    opacity: 0.7;
    border-color: var(--border);
  }

  .block-copy-btn:hover {
    opacity: 1 !important;
    color: var(--text-secondary);
  }

  .rewrite-badge {
    display: inline-block;
    margin-top: 0.375rem;
    padding: 0.125rem 0.5rem;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: var(--radius);
    font-size: 0.6875rem;
    color: var(--warning);
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
