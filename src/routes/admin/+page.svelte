<script>
  import { goto } from "$app/navigation";
  import { isAdmin } from "$lib/stores/auth.js";
  import { api } from "$lib/api.js";

  let loading = $state(true);
  let error = $state(null);

  let metrics = $state(null);
  let clients = $state([]);
  let personasList = $state([]);
  let activity = $state([]);

  // Auth guard
  $effect(() => {
    if (!$isAdmin) goto("/");
  });

  // Load all data
  $effect(() => {
    if ($isAdmin) loadData();
  });

  async function loadData() {
    loading = true;
    error = null;
    try {
      const [m, c, p, a] = await Promise.all([
        api("/api/usage?view=metrics"),
        api("/api/usage?view=clients"),
        api("/api/usage?view=personas"),
        api("/api/usage?view=activity"),
      ]);
      metrics = m;
      clients = c.clients || [];
      personasList = p.personas || [];
      activity = a.activity || [];
    } catch (e) {
      error = e.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  function relativeTime(dateStr) {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "a l'instant";
    if (mins < 60) return `il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "hier";
    return `il y a ${days}j`;
  }

  function formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
    return String(n);
  }

  function budgetPercent(spent, budget) {
    if (!budget || budget <= 0) return 0;
    return Math.min(100, Math.round((spent / budget) * 100));
  }
</script>

<div class="admin">
  <header class="admin-header">
    <a href="/" class="back-link">&larr; Hub</a>
    <h1>Admin</h1>
    {#if !loading}
      <button class="refresh-btn" onclick={loadData}>Rafraichir</button>
    {/if}
  </header>

  {#if loading}
    <p class="loading-text">Chargement...</p>
  {:else if error}
    <p class="error-text">{error}</p>
  {:else}

    <!-- Overview cards -->
    <section class="section">
      <h2 class="section-title">Vue d'ensemble</h2>
      <div class="stat-grid">
        <div class="stat-card">
          <span class="stat-value">{metrics.overview.personas}</span>
          <span class="stat-label">Personas</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{metrics.overview.clients}</span>
          <span class="stat-label">Clients</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{metrics.overview.conversations_7d}</span>
          <span class="stat-label">Conversations 7j</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{(metrics.usage_24h?.cost_eur ?? 0).toFixed(2)}&euro;</span>
          <span class="stat-label">Cout 24h</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{metrics.quality.total_corrections}</span>
          <span class="stat-label">Corrections</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{metrics.quality.knowledge_entities}</span>
          <span class="stat-label">Entites</span>
        </div>
      </div>
    </section>

    <!-- Clients -->
    <section class="section">
      <h2 class="section-title">Clients</h2>
      {#if clients.length === 0}
        <p class="empty-text">Aucun client</p>
      {:else}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Dernier actif</th>
                <th>Conv. 7j</th>
                <th>Tokens 7j</th>
                <th>Budget</th>
              </tr>
            </thead>
            <tbody>
              {#each clients as c}
                <tr>
                  <td>
                    <span class="client-name">{c.name || "—"}</span>
                    <span class="client-tier">{c.tier}</span>
                  </td>
                  <td class="td-secondary">{relativeTime(c.last_active)}</td>
                  <td>{c.conversations_7d}</td>
                  <td>{formatTokens(c.tokens_7d)}</td>
                  <td>
                    <div class="budget-cell">
                      <div class="budget-bar">
                        <div
                          class="budget-fill"
                          class:budget-warn={budgetPercent(c.spent_cents, c.budget_cents) > 80}
                          style="width: {budgetPercent(c.spent_cents, c.budget_cents)}%"
                        ></div>
                      </div>
                      <span class="budget-text">{((c.remaining_cents || 0) / 100).toFixed(2)}&euro;</span>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- Personas -->
    <section class="section">
      <h2 class="section-title">Personas</h2>
      <div class="persona-grid">
        {#each personasList as p}
          <div class="persona-card">
            <div class="persona-header">
              <span class="persona-avatar">{p.avatar || "?"}</span>
              <div>
                <strong class="persona-name">{p.name}</strong>
                <span class="persona-owner">{p.client_name}</span>
              </div>
            </div>
            <div class="persona-stats">
              <div class="persona-stat">
                <span class="persona-stat-val">{p.conversations}</span>
                <span class="persona-stat-lbl">conv.</span>
              </div>
              <div class="persona-stat">
                <span class="persona-stat-val">{p.corrections}</span>
                <span class="persona-stat-lbl">corrections</span>
              </div>
              <div class="persona-stat">
                <span class="persona-stat-val">{p.entities}</span>
                <span class="persona-stat-lbl">entites</span>
              </div>
            </div>
            {#if p.fidelity}
              <div class="admin-fidelity">Fidelite: {p.fidelity.score_global}</div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Activity feed -->
    <section class="section">
      <h2 class="section-title">Activite recente</h2>
      {#if activity.length === 0}
        <p class="empty-text">Aucune activite</p>
      {:else}
        <div class="activity-list">
          {#each activity as item}
            <div class="activity-row">
              <span class="activity-avatar">{item.persona_avatar}</span>
              <div class="activity-info">
                <span class="activity-title">{item.title}</span>
                <span class="activity-meta">
                  {item.persona_name} &middot; {item.client_name} &middot; {item.scenario}
                </span>
              </div>
              <span class="activity-time">{relativeTime(item.last_message_at)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>

  {/if}
</div>

<style>
  .admin {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  .admin-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .admin-header h1 {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--text);
    flex: 1;
  }

  .back-link {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    text-decoration: none;
    transition: color 0.15s;
  }
  .back-link:hover { color: var(--text); }

  .refresh-btn {
    padding: 0.25rem 0.625rem;
    font-size: 0.625rem;
    font-family: var(--font);
    color: var(--text-tertiary);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all 0.15s;
  }
  .refresh-btn:hover { color: var(--text); border-color: var(--text-tertiary); }

  .loading-text, .error-text, .empty-text {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }
  .error-text { color: var(--error); }

  /* Sections */
  .section { margin-bottom: 2rem; }

  .section-title {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.625rem;
  }

  /* Stat grid */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.375rem;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.025em;
  }

  .stat-label {
    display: block;
    font-size: 0.5625rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 0.125rem;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }

  .data-table th {
    text-align: left;
    font-size: 0.5625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .data-table td {
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text);
    white-space: nowrap;
  }

  .data-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .client-name {
    font-weight: 500;
  }

  .client-tier {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
    margin-left: 0.375rem;
  }

  .td-secondary {
    color: var(--text-secondary);
  }

  /* Budget bar */
  .budget-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .budget-bar {
    width: 48px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .budget-fill {
    height: 100%;
    background: var(--success);
    border-radius: 2px;
    transition: width 0.3s;
  }

  .budget-fill.budget-warn {
    background: var(--warning);
  }

  .budget-text {
    font-size: 0.625rem;
    color: var(--text-secondary);
  }

  /* Persona grid */
  .persona-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.375rem;
  }

  .persona-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.75rem;
  }

  .persona-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.625rem;
  }

  .persona-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    flex-shrink: 0;
  }

  .persona-name {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
  }

  .persona-owner {
    display: block;
    font-size: 0.5625rem;
    color: var(--text-tertiary);
  }

  .persona-stats {
    display: flex;
    gap: 0.75rem;
  }

  .persona-stat {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .persona-stat-val {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text);
  }

  .persona-stat-lbl {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
  }

  .admin-fidelity {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }

  /* Activity feed */
  .activity-list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .activity-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .activity-row:last-child { border-bottom: none; }

  .activity-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .activity-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.5625rem;
    flex-shrink: 0;
  }

  .activity-info {
    flex: 1;
    min-width: 0;
  }

  .activity-title {
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-meta {
    display: block;
    font-size: 0.5625rem;
    color: var(--text-tertiary);
  }

  .activity-time {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  @media (max-width: 480px) {
    .admin { padding: 1.5rem 1rem 3rem; }
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .persona-grid { grid-template-columns: 1fr; }
  }
</style>
