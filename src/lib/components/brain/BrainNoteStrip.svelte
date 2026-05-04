<script>
  let { tone = "info", children } = $props();
</script>

<div class="note" class:alert={tone === "alert"} class:hint={tone === "hint"}>
  {@render children?.()}
</div>

<style>
  .note {
    margin-top: 14px;
    padding: 11px 14px;
    background: var(--paper-subtle, #ecebe4);
    border-left: 3px solid var(--vermillon);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-70);
    line-height: 1.6;
  }
  .note :global(strong) { color: var(--ink); font-weight: 600; }
  .note.alert { border-left-color: var(--vermillon); }
  .note.hint { border-left-color: var(--ink-30); color: var(--ink-40); }
</style>
