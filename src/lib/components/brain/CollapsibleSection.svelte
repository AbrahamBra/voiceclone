<script>
  let {
    title,
    count = null,
    countAlert = false,
    defaultCollapsed = false,
    id = null,
    children,
    actions,
    onToggle = () => {},
    collapsed = $bindable(defaultCollapsed),
  } = $props();

  function toggle(e) {
    if (e?.target?.closest && e.target.closest("button, select, input, a, [data-no-toggle]")) return;
    collapsed = !collapsed;
    onToggle(collapsed);
  }

  function onKey(e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); }
  }
</script>

<section class="section" {id}>
  <div
    class="section-head"
    class:collapsed
    role="button"
    tabindex="0"
    aria-expanded={!collapsed}
    onclick={toggle}
    onkeydown={onKey}
  >
    <div class="left">
      <h2>{title}</h2>
      {#if count !== null && count !== undefined}
        <span class="count" class:alert={countAlert}>{count}</span>
      {/if}
    </div>
    <div class="right">
      {#if actions}<div class="actions" data-no-toggle>{@render actions()}</div>{/if}
      <span class="toggle">{collapsed ? "déplier" : "replier"}</span>
    </div>
  </div>
  {#if !collapsed}
    <div class="section-body">
      {@render children?.()}
    </div>
  {/if}
</section>

<style>
  .section { margin-top: 36px; }
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
    cursor: pointer;
    user-select: none;
  }
  .section-head:focus-visible { outline: 2px solid var(--vermillon); outline-offset: 2px; }
  .section-head h2 {
    display: inline;
    font-family: var(--font, Georgia, serif);
    font-weight: 500;
    font-size: 21px;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .left .count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    margin-left: 10px;
  }
  .left .count.alert { color: var(--vermillon); font-weight: 600; }
  .right { display: flex; gap: 14px; align-items: baseline; }
  .actions { display: flex; gap: 8px; align-items: baseline; }
  .toggle {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
  }
  .toggle::before { content: "▾ "; }
  .section-head.collapsed .toggle::before { content: "▸ "; }
  .section-body { /* renders flush to head */ }
</style>
