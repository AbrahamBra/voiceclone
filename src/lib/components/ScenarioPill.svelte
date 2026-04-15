<script>
  import { fly } from "svelte/transition";
  let { scenario, index = 0, onclick } = $props();
</script>

<button class="scenario-pill" transition:fly={{ y: 8, delay: index * 60, duration: 150 }} {onclick}>
  <strong>{scenario.label}</strong>
  <span>{scenario.description}</span>
</button>

<style>
  .scenario-pill {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.875rem 1rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    font-family: var(--font);
    color: var(--text);
  }

  .scenario-pill:hover {
    border-color: var(--text-tertiary);
    background: #1f1f23;
  }

  .scenario-pill strong {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 0.125rem;
  }

  .scenario-pill span {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.4;
  }
</style>
