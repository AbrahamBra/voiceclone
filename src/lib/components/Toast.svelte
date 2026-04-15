<script>
  import { fly } from "svelte/transition";
  import { toastMessage } from "$lib/stores/ui.js";
</script>

{#if $toastMessage}
  <div class="toast" transition:fly={{ y: 20, duration: 200 }}>
    {$toastMessage}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 4.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    font-size: 0.75rem;
    z-index: 100;
  }
</style>
