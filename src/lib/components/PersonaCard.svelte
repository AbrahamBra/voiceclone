<script>
  import { fly } from "svelte/transition";
  let { persona, index = 0, onclick } = $props();
</script>

<button class="persona-card" transition:fly={{ y: 12, delay: index * 80, duration: 150 }} {onclick}>
  <div class="persona-card-avatar">{persona.avatar}</div>
  <div>
    <strong>{persona.name}</strong>
    <span class="persona-card-title">{persona.title || ""}</span>
  </div>
</button>

<style>
  .persona-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
  }

  .persona-card:hover {
    border-color: var(--text-tertiary);
    background: #1f1f23;
  }

  .persona-card-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .persona-card strong {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text);
  }

  .persona-card-title {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.3;
  }
</style>
