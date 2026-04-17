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
    background: var(--ink);
    border: 1px solid var(--ink);
    color: var(--paper);
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-tiny);
    letter-spacing: 0.02em;
    z-index: var(--z-toast, 50);
    box-shadow: 0 4px 14px rgba(20, 20, 26, 0.18);
  }
</style>
