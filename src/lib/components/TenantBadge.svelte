<script>
  // Badge multi-tenant affiché dans la topbar.
  // Montre le rôle (Agence / Client) + le nom du compte connecté.
  // Invisible si clientName est vide (sessions non encore migrées).
  import { isAdmin, clientName } from "$lib/stores/auth.js";

  let roleLabel = $derived($isAdmin ? "Agence" : "Client");
  let name = $derived($clientName || "");
</script>

{#if name}
  <div class="tenant-badge" title="Connecté en tant que {roleLabel} · {name}">
    <span class="role">{roleLabel}</span>
    <span class="sep">·</span>
    <span class="name">{name}</span>
  </div>
{/if}

<style>
  .tenant-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--ink-40);
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    max-width: 160px;
  }

  .role {
    font-weight: 600;
    color: var(--ink-70);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .sep {
    color: var(--rule-strong);
    flex-shrink: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
