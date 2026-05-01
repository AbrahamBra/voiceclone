<script>
  import { authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let { personaId } = $props();

  /** @type {{ id: string, label: string|null, created_at: string, last_used_at: string|null, revoked_at: string|null }[]} */
  let keys = $state([]);
  let loading = $state(false);
  let creating = $state(false);
  let newLabel = $state("");
  /** Raw key returned by POST — shown ONCE, then nulled when copied/dismissed. */
  let freshKey = $state(null);
  let revokeConfirmId = $state(null);

  async function load() {
    if (!personaId) return;
    loading = true;
    try {
      const resp = await fetch(`/api/v2/persona-api-keys?persona=${personaId}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const d = await resp.json();
      keys = d.keys || [];
    } catch (err) {
      showToast("Erreur de chargement des API keys");
      console.error(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (personaId) load();
  });

  async function createKey() {
    if (creating) return;
    creating = true;
    try {
      const resp = await fetch("/api/v2/persona-api-keys", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          persona_id: personaId,
          label: newLabel.trim() || null,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        showToast(`Erreur création : ${t.slice(0, 80)}`);
        return;
      }
      const d = await resp.json();
      freshKey = d.raw_key;
      newLabel = "";
      await load();
    } catch (err) {
      showToast("Erreur création API key");
      console.error(err);
    } finally {
      creating = false;
    }
  }

  async function copyFreshKey() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      showToast("Clé copiée. Sauvegarde-la maintenant.");
    } catch {
      showToast("Copie impossible — sélectionne et copie manuellement.");
    }
  }

  function dismissFreshKey() {
    freshKey = null;
  }

  async function revokeKey(id) {
    try {
      const resp = await fetch(`/api/v2/persona-api-keys?id=${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        showToast("Erreur de révocation");
        return;
      }
      revokeConfirmId = null;
      await load();
      showToast("Clé révoquée");
    } catch {
      showToast("Erreur de révocation");
    }
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return iso; }
  }
  function fmtUsed(iso) {
    if (!iso) return "jamais";
    return fmtDate(iso);
  }
</script>

<div class="api-keys-panel">
  <header class="panel-head">
    <h2>API keys</h2>
    <p class="lede">
      Clés pour les intégrations externes (Breakcold via n8n, Zapier, scripts custom).
      Chaque clé pointe sur ce clone uniquement. Donne un label par usage —
      "breakcold-prod", "n8n-test" — pour faciliter la rotation.
    </p>
  </header>

  {#if freshKey}
    <div class="fresh-key-card" role="alert">
      <div class="fresh-key-header">
        <strong>Clé générée — copie-la maintenant.</strong>
        <span class="warn">Tu ne la reverras plus jamais.</span>
      </div>
      <div class="fresh-key-row">
        <code class="fresh-key-value">{freshKey}</code>
        <button class="btn-primary" onclick={copyFreshKey}>Copier</button>
      </div>
      <button class="btn-link" onclick={dismissFreshKey}>J'ai sauvegardé la clé →</button>
    </div>
  {/if}

  <form class="create-form" onsubmit={(e) => { e.preventDefault(); createKey(); }}>
    <input
      type="text"
      placeholder="Label (ex: breakcold-prod)"
      maxlength="80"
      bind:value={newLabel}
      disabled={creating}
    />
    <button type="submit" class="btn-primary" disabled={creating}>
      {creating ? "Génération…" : "+ Nouvelle clé"}
    </button>
  </form>

  <div class="keys-list">
    {#if loading}
      <p class="empty">Chargement…</p>
    {:else if keys.length === 0}
      <p class="empty">Aucune clé pour le moment.</p>
    {:else}
      <table class="keys-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Créée le</th>
            <th>Dernier usage</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each keys as k (k.id)}
            <tr class:revoked={!!k.revoked_at}>
              <td class="cell-label">{k.label || "(sans label)"}</td>
              <td class="cell-date">{fmtDate(k.created_at)}</td>
              <td class="cell-date">{fmtUsed(k.last_used_at)}</td>
              <td class="cell-status">
                {#if k.revoked_at}
                  <span class="status status-revoked">révoquée {fmtDate(k.revoked_at)}</span>
                {:else}
                  <span class="status status-active">active</span>
                {/if}
              </td>
              <td class="cell-actions">
                {#if !k.revoked_at}
                  {#if revokeConfirmId === k.id}
                    <button class="btn-danger" onclick={() => revokeKey(k.id)}>Confirmer</button>
                    <button class="btn-link" onclick={() => (revokeConfirmId = null)}>Annuler</button>
                  {:else}
                    <button class="btn-link" onclick={() => (revokeConfirmId = k.id)}>Révoquer</button>
                  {/if}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <details class="usage-doc">
    <summary>Comment utiliser une clé</summary>
    <p>
      Inclus le header <code>x-api-key: sk_…</code> dans tes requêtes vers
      <code>POST /api/v2/draft</code>. La clé identifie le clone — pas besoin
      de passer <code>persona_id</code> dans le body, mais s'il est présent
      il doit matcher le clone de la clé.
    </p>
    <p>
      Voir <a href="/docs/integrations/breakcold-n8n">la doc Breakcold + n8n</a>
      pour le setup complet du workflow draft-on-list-add.
    </p>
  </details>
</div>

<style>
  .api-keys-panel {
    max-width: 720px;
    padding: 8px 0 24px;
    font-family: var(--font-ui);
  }
  .panel-head h2 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 500;
  }
  .lede {
    color: var(--ink-60);
    font-size: 12px;
    line-height: 1.55;
    margin: 0 0 18px;
  }

  .fresh-key-card {
    border: 2px solid var(--vermillon);
    background: var(--paper);
    padding: 14px 16px;
    margin-bottom: 18px;
  }
  .fresh-key-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .fresh-key-header strong {
    color: var(--vermillon);
    font-size: 13px;
  }
  .fresh-key-header .warn {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-60);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fresh-key-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
  }
  .fresh-key-value {
    flex: 1;
    background: var(--paper-subtle);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink);
    overflow-x: auto;
    user-select: all;
    word-break: break-all;
  }

  .create-form {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .create-form input {
    flex: 1;
    padding: 7px 10px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    color: var(--ink);
    font-family: var(--font-ui);
    font-size: 12px;
    outline: none;
    transition: border-color 0.1s;
  }
  .create-form input:focus { border-color: var(--vermillon); }

  .btn-primary {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    padding: 7px 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .btn-primary:hover { background: var(--vermillon); border-color: var(--vermillon); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-link {
    background: transparent;
    border: none;
    color: var(--ink-60);
    text-decoration: underline;
    text-underline-offset: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    padding: 4px 0;
  }
  .btn-link:hover { color: var(--ink); }
  .btn-danger {
    background: var(--vermillon);
    color: var(--paper);
    border: 1px solid var(--vermillon);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .keys-list { margin-bottom: 18px; }
  .empty {
    color: var(--ink-40);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 14px 0;
  }
  .keys-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .keys-table th {
    text-align: left;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid var(--rule-strong);
  }
  .keys-table td {
    padding: 10px;
    border-bottom: 1px solid var(--rule);
    vertical-align: middle;
  }
  .keys-table tr.revoked td { opacity: 0.55; }
  .cell-label { color: var(--ink); }
  .cell-date { font-family: var(--font-mono); font-size: 11px; color: var(--ink-60); }
  .cell-status { font-family: var(--font-mono); font-size: 10.5px; }
  .status {
    display: inline-block;
    padding: 2px 8px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .status-active { background: var(--paper-subtle); color: var(--ink); }
  .status-revoked { color: var(--ink-40); }
  .cell-actions { text-align: right; white-space: nowrap; }

  .usage-doc {
    margin-top: 24px;
    padding: 12px 14px;
    background: var(--paper-subtle);
    border-left: 2px solid var(--rule-strong);
  }
  .usage-doc summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-60);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .usage-doc summary:hover { color: var(--ink); }
  .usage-doc p {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--ink-70);
    line-height: 1.55;
  }
  .usage-doc code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--paper);
    padding: 1px 5px;
  }
  .usage-doc a { color: var(--vermillon); }
</style>
