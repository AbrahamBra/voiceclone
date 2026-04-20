<script>
  // Menu ⋯ top-right : raccourcis globaux sans écran "hub".
  // Guide, Admin (si admin), + Nouveau clone, Logout.
  import { fly } from "svelte/transition";
  import { goto } from "$app/navigation";
  import { isAdmin, logout } from "$lib/stores/auth.js";

  let { open = $bindable(false) } = $props();

  let containerEl = $state();

  $effect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (containerEl && !containerEl.contains(e.target)) open = false;
    }
    const t = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  });

  function go(path) {
    open = false;
    goto(path);
  }

  function handleLogout() {
    open = false;
    logout();
    goto("/");
  }
</script>

<div class="wrap" bind:this={containerEl}>
  <button
    class="trigger"
    type="button"
    onclick={() => (open = !open)}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Menu"
    title="Menu"
  >⋯</button>

  {#if open}
    <div class="menu" role="menu" transition:fly={{ y: -4, duration: 120 }}>
      <button class="item" role="menuitem" onclick={() => go("/create")}>
        <span class="icon">＋</span> Nouveau clone
      </button>
      <button class="item" role="menuitem" onclick={() => go("/guide")}>
        <span class="icon">📖</span> Guide
      </button>
      {#if $isAdmin}
        <button class="item" role="menuitem" onclick={() => go("/admin")}>
          <span class="icon">⚙</span> Admin
        </button>
      {/if}
      <div class="divider"></div>
      <button class="item danger" role="menuitem" onclick={handleLogout}>
        <span class="icon">⎋</span> Déconnexion
      </button>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .trigger {
    background: transparent;
    border: 1px solid var(--rule-strong);
    color: var(--ink-40);
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.08s linear, border-color 0.08s linear;
  }
  .trigger:hover { color: var(--ink); border-color: var(--ink-40); }
  .trigger[aria-expanded="true"] {
    color: var(--ink);
    border-color: var(--ink);
    background: var(--paper-subtle);
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 190px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 50;
    padding: 4px 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--ink);
  }
  .item:hover { background: var(--paper-subtle); }
  .item .icon {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-40);
    width: 14px;
    flex-shrink: 0;
  }
  .item.danger { color: var(--vermillon); }
  .item.danger .icon { color: var(--vermillon); }
  .divider {
    height: 1px;
    background: var(--rule);
    margin: 4px 0;
  }
</style>
