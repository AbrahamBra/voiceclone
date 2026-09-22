<script>
  // /clones — liste de tous les clones accessibles (admin : tous les clients,
  // client : les siens + partagés). Remplace la navigation via /admin, qui est
  // un dashboard de stats sans action. Tri par dette (triage), recherche par
  // nom / client, accès direct cockpit + cerveau.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { isAdmin, sessionToken } from "$lib/stores/auth.js";
  import { personas, canCreateClone } from "$lib/stores/persona.js";
  import { api, authHeaders } from "$lib/api.js";
  import { triageOf, byTriage, relTime } from "$lib/triage.js";
  import TenantBadge from "$lib/components/TenantBadge.svelte";
  import UserMenu from "$lib/components/UserMenu.svelte";

  let loading = $state(true);
  let error = $state("");
  let query = $state("");
  let scores = $state(/** @type {Record<string, any>} */ ({}));
  let menuOpen = $state(false);

  onMount(async () => {
    try {
      const resp = await fetch("/api/personas?triage=true", { headers: authHeaders() });
      if (resp.status === 401 || resp.status === 403) {
        goto("/login");
        return;
      }
      if (!resp.ok) throw new Error("server");
      const data = await resp.json();
      personas.set(Array.isArray(data.personas) ? data.personas : []);
      canCreateClone.set(!!data.canCreateClone);
      isAdmin.set(!!data.isAdmin);
      if (data.session?.token) sessionToken.set(data.session.token);
      loadScores(data.personas || []);
    } catch {
      error = "impossible de charger les clones";
    } finally {
      loading = false;
    }
  });

  async function loadScores(list) {
    const ids = list.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) return;
    try {
      const data = await api(`/api/fidelity?personas=${ids.join(",")}`);
      scores = data?.scores || {};
    } catch {
      // best-effort — la page fonctionne sans scores
    }
  }

  function ownerOf(p) {
    if (p._shared) return `partagé par ${p._shared_by}`;
    return p.client_label || "";
  }

  let visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = ($personas || []).filter((p) => {
      if (!q) return true;
      return [p.name, p.title, p.client_label, p._shared_by]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
    return list.slice().sort(byTriage(scores));
  });

  let summary = $derived.by(() => {
    const counts = { drift: 0, inactive: 0, warn: 0, ok: 0 };
    for (const p of $personas || []) {
      const k = triageOf(p, scores[p.id]).kind;
      if (k === "drift") counts.drift++;
      else if (k === "stale" || k === "never") counts.inactive++;
      else if (k === "warn") counts.warn++;
      else counts.ok++;
    }
    const parts = [];
    if (counts.drift) parts.push({ kind: "drift", text: `${counts.drift} en dérive` });
    if (counts.inactive)
      parts.push({ kind: "stale", text: `${counts.inactive} inactif${counts.inactive > 1 ? "s" : ""}` });
    if (counts.warn) parts.push({ kind: "warn", text: `${counts.warn} en alerte` });
    if (counts.ok) parts.push({ kind: "ok", text: `${counts.ok} actif${counts.ok > 1 ? "s" : ""}` });
    return parts;
  });

  function openChat(p) {
    try {
      localStorage.setItem("setclone_last_persona", p.id);
    } catch {
      // ignore
    }
    goto(`/chat/${p.id}`);
  }
</script>

<svelte:head>
  <title>Setclone — clones</title>
</svelte:head>

<main class="clones-page">
  <header class="topbar">
    <div class="left">
      <a class="brand" href="/">
        <span class="brand-mark">◎</span>
        <span class="brand-name">Setclone</span>
      </a>
      <span class="crumb mono">clones</span>
    </div>
    <div class="right">
      <TenantBadge />
      {#if $canCreateClone || $isAdmin}
        <a class="tab-btn mono" href="/create">+ nouveau clone</a>
      {/if}
      <UserMenu bind:open={menuOpen} />
    </div>
  </header>

  <section class="head">
    <h1>Mes clones</h1>
    {#if summary.length > 0}
      <p class="summary mono" aria-live="polite">
        {#each summary as part, i (part.kind)}
          <span class="sum" data-kind={part.kind}>{part.text}</span>{#if i < summary.length - 1}<span class="sep"
              >·</span
            >{/if}
        {/each}
      </p>
    {/if}
    <input
      class="search"
      type="search"
      placeholder="filtrer par nom ou client…"
      bind:value={query}
      aria-label="Filtrer les clones"
    />
  </section>

  {#if loading}
    <p class="state mono">chargement…</p>
  {:else if error}
    <p class="state mono err">{error}</p>
  {:else if ($personas || []).length === 0}
    <p class="state mono">aucun clone. <a href="/create">créer le premier →</a></p>
  {:else if visible.length === 0}
    <p class="state mono">aucun clone ne correspond à « {query} »</p>
  {:else}
    <ul class="grid" aria-label="Liste des clones">
      {#each visible as p (p.id)}
        {@const t = triageOf(p, scores[p.id])}
        {@const score = scores[p.id]?.score_global}
        <li class="card" data-kind={t.kind}>
          <button
            class="card-main"
            type="button"
            onclick={() => openChat(p)}
            aria-label={`Ouvrir le cockpit de ${p.name}`}
          >
            <span class="avatar">{p.avatar || "?"}</span>
            <span class="id">
              <strong class="name">{p.name}</strong>
              {#if p.title}<span class="title">{p.title}</span>{/if}
              {#if ownerOf(p)}<span class="owner mono">{ownerOf(p)}</span>{/if}
            </span>
            <span class="meta mono">
              <span class="triage" data-kind={t.kind}>
                <span class="dot" aria-hidden="true"></span>{t.label}
              </span>
              <span class="last">{relTime(p.last_message_at)}</span>
              {#if typeof score === "number"}
                <span class="score" title="Fidélité composite">fid {Math.round(score)}</span>
              {/if}
            </span>
          </button>
          <div class="actions">
            <button class="act mono" type="button" onclick={() => openChat(p)}>cockpit →</button>
            <a class="act mono" href={`/brain/${p.id}`}>cerveau</a>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .clones-page {
    min-height: 100dvh;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--rule-strong);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    color: var(--ink);
    font-weight: 600;
    font-size: 14px;
  }
  .brand-mark {
    color: var(--vermillon);
  }
  .crumb {
    font-size: 11px;
    color: var(--ink-40);
  }
  .tab-btn {
    font-size: 11px;
    text-decoration: none;
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    padding: 4px 8px;
    background: transparent;
    text-transform: lowercase;
  }
  .tab-btn:hover {
    background: var(--paper-subtle);
  }

  .head {
    max-width: 1100px;
    margin: 0 auto;
    padding: 28px 16px 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 12px 20px;
  }
  h1 {
    font-family: var(--font);
    font-weight: 500;
    font-size: var(--fs-h2);
    margin: 0;
  }
  .summary {
    margin: 0;
    font-size: 11px;
    color: var(--ink-40);
    display: flex;
    gap: 6px;
  }
  .sum[data-kind="drift"] {
    color: var(--vermillon);
  }
  .sum[data-kind="stale"],
  .sum[data-kind="warn"] {
    color: var(--warning);
  }
  .sum[data-kind="ok"] {
    color: var(--success);
  }
  .sep {
    color: var(--ink-20);
  }
  .search {
    margin-left: auto;
    min-width: 240px;
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 6px 10px;
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--rule-strong);
  }
  .search:focus {
    outline: 1px solid var(--vermillon);
    outline-offset: 0;
  }

  .state {
    max-width: 1100px;
    margin: 24px auto;
    padding: 0 16px;
    font-size: 12px;
    color: var(--ink-40);
  }
  .state.err {
    color: var(--vermillon);
  }
  .state a {
    color: var(--ink);
  }

  .grid {
    list-style: none;
    margin: 0 auto;
    padding: 8px 16px 48px;
    max-width: 1100px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    transition: background 0.08s linear;
  }
  .card:hover {
    background: var(--paper-subtle);
  }
  .card[data-kind="drift"] {
    border-left: 3px solid var(--vermillon);
  }
  .card[data-kind="stale"],
  .card[data-kind="never"] {
    border-left: 3px solid var(--warning);
  }
  .card-main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: 12px;
    row-gap: 8px;
    align-items: start;
    width: 100%;
    padding: 12px 12px 8px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--ink);
    font-family: inherit;
  }
  .avatar {
    width: 32px;
    height: 32px;
    grid-row: span 2;
    background: var(--paper-subtle);
    border: 1px solid var(--rule-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .id {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-size: 12px;
    color: var(--ink-70);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .owner {
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .meta {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
    color: var(--ink-40);
  }
  .triage {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
  }
  .triage[data-kind="drift"] {
    color: var(--vermillon);
  }
  .triage[data-kind="drift"] .dot {
    background: var(--vermillon);
  }
  .triage[data-kind="stale"],
  .triage[data-kind="never"],
  .triage[data-kind="warn"] {
    color: var(--warning);
  }
  .triage[data-kind="stale"] .dot,
  .triage[data-kind="never"] .dot,
  .triage[data-kind="warn"] .dot {
    background: var(--warning);
  }
  .actions {
    display: flex;
    border-top: 1px dashed var(--rule);
  }
  .act {
    flex: 1;
    padding: 7px 12px;
    font-size: 11px;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--ink);
    text-decoration: none;
    cursor: pointer;
  }
  .act + .act {
    border-left: 1px dashed var(--rule);
  }
  .act:hover {
    background: var(--paper);
    color: var(--vermillon);
  }

  @media (max-width: 600px) {
    .search {
      margin-left: 0;
      width: 100%;
    }
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
