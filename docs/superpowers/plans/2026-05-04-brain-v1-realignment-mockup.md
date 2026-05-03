# Brain V1 — réalignement sur le mockup

**Status:** plan, à exécuter
**Date:** 2026-05-04 (rédigé après le ship raté du soir 2026-05-03)
**Supersede:** `docs/superpowers/specs/2026-05-04-brain-v1-arbitrage-design.md` (parties UI de la spec)
**Mockup canonique:** `docs/mockups/brain-refonte-2026-05-03.html` (PR #239)

## Pourquoi ce plan existe

Le ship du 2026-05-03 (PR #240, mergé) a livré une page `/brain/[persona]` avec une **mode bar Arbitrage / Doctrine** qui bascule entre 2 vues, chacune embarquant le `<ProtocolPanel>` entier. Quand le user a ouvert la page, il a vu :

- Counts à `—` (problème de fetch — voir Action 0)
- Section "Propositions" affichant un sous-menu interne `DOCTRINE / REGISTRE / PROPOSITIONS / PLAYBOOKS / CALIBRAGE` ouvert par défaut sur Doctrine — donc dans le mode Arbitrage, section Propositions, on voit la doctrine
- Section "Auto-mergées" en placeholder texte
- Mode Doctrine identique à Mode Arbitrage section Propositions (même ProtocolPanel embarqué)

Le mockup ne demande **rien** de tout ça. Le mockup est :

> **Une seule page qui scroll, avec 4 sections empilées :** Arbitrages → Propositions → Doctrine → Sources. Doctrine et Sources sont **collapsed par défaut**, click sur le header = expand. Pas de mode bar.

C'est une UX scroll-and-collapse, pas une UX modale. La V1 spec a inventé la mode bar par-dessus la validation user "option C" (qui voulait juste dire : on garde la doctrine accessible, pas qu'on en fasse un mode séparé). Cette confusion m'incombe.

## État actuel (post-ship 2026-05-03)

### Ce qui est sur master et qu'on garde

- Migration `071_brain_v1_arbitrage.sql` appliquée Supabase ✓
- `GET /api/v2/brain-status` (test 7/7 ✓)
- `GET /api/v2/contradictions` (test 10/10 ✓)
- `BrainStatusBanner.svelte` — structure 4 cells + import button ✓ (labels à corriger, voir Étape 1)
- `ContradictionsList.svelte` — cards A vs B avec 5 actions ✓ (note strip à ajouter, voir Étape 2)

### Ce qui est sur master et qu'on retire

- `BrainModeBar.svelte` — composant entier à supprimer (la mode bar n'existe pas dans le mockup)
- Logique mode + localStorage `brain.mode.<persona>` dans `+page.svelte` — supprimer
- Embedding de `<ProtocolPanel>` dans la section Propositions du mode Arbitrage — supprimer (remplacé par BatchBar + PropositionsList plats)
- Embedding de `<ProtocolPanel>` dans le mode Doctrine — supprimer (remplacé par DoctrineGrid)
- ⚙ menu popover dans `+page.svelte` — garder mais simplifier (c'est OK, mockup le mentionne en footer)

### Ce qu'il faut créer

- Composant `BrainNoteStrip.svelte` — bandeau vermillon-left "Pourquoi cette liste ?"
- Composant `BatchBar.svelte` — toolbar filter section + slider confidence + matched count + boutons accept/reject batch
- Composant `PropositionsList.svelte` — flat list 5-col (kind / text / src / conf / actions)
- Composant `DoctrineGrid.svelte` — grille 7 cells (identity / hard_rules / errors / icp_patterns / scoring / process / templates)
- Composant `SourcesTable.svelte` — table docs uploadés
- Composant `CollapsibleSection.svelte` — wrapper section + header click-to-collapse (default-collapsed prop)
- Endpoint `GET /api/v2/sources?persona=<uuid>` — list docs + counts pour SourcesTable
- Endpoint `POST /api/v2/contradictions/:id/resolve` — pour wirer les actions A/B/les2/rejeter/punter
- Endpoint `POST /api/v2/propositions/batch?persona=<uuid>` — body `{ filters, action: 'accept'|'reject' }` pour les batch buttons

## Architecture cible

```
/brain/[persona]/+page.svelte
├── BrainHeader (avatar + nom + level + ⚙ popover)
├── BrainStatusBanner (4 cells + import button)
└── scroll vertical :
    ├── <CollapsibleSection title="Arbitrages" countAlert={n}>
    │     <BrainNoteStrip>Pourquoi cette liste ?</BrainNoteStrip>
    │     <ContradictionsList />
    │     <a class="see-all">+ N autres contradictions · tout voir →</a>
    │
    ├── <CollapsibleSection title="Propositions" count={n}>
    │     <BatchBar />            ← filter section + slider conf + boutons batch
    │     <p class="hint">Bouge le slider à 0.95 pour les ultra-fiables…</p>
    │     <PropositionsList />    ← flat 5-col, échantillon top-N + "+M autres" row
    │
    ├── <CollapsibleSection title="Doctrine" count="7 sections · X remplies" defaultCollapsed>
    │     <DoctrineGrid />        ← 7 cells avec name + num + meta
    │
    └── <CollapsibleSection title="Sources" count="X docs · Y playbooks" defaultCollapsed>
          <SourcesTable />        ← table docs uploadés + extracted/identity counts

(footer)
```

⚙ menu : pour V1 on **retire le popover** et on met un lien `⚙ réglages + intégrations → page séparée` en footer (le mockup le suggère explicitement). Décision : ne pas reconstruire un popover qui multiplie le code à entretenir, faire une vraie route `/persona/[id]/settings` plus tard si besoin. Pour V1 on bouton dans le header qui amène à `/persona/[id]?tab=integrations` (route à créer en V1.1, en attendant le ⚙ ouvre la page actuelle ApiKeysPanel/SettingsPanel via un overlay basique).

## Status banner — labels à corriger

Mockup :

| cell | num | lbl (en haut) | meta (en bas) |
|---|---|---|---|
| 1 | 19 (alert) | `à arbitrer` | `contradictions` |
| 2 | 232 | `à reviewer` | `propositions pending` |
| 3 | 75 | `auto-mergées` | `aujourd'hui · synonymes` |
| 4 | 7 | `sections actives` | `doctrine remplie 2/7` |

Ce qui est shippé (à inverser) : lbl=`contradictions`/`propositions`/`auto-mergées`/`doctrine`, meta=`à arbitrer`/`pending`/`synonymes`/`sections remplies`.

## Endpoints additionnels (besoin pour réalignement)

### `GET /api/v2/sources?persona=<uuid>` (nouveau)

Pour `SourcesTable.svelte`. Lit `protocol_document.documents_imported` (table à créer? ou champ jsonb sur protocol_document?) ou re-derive depuis `proposition.source_ref` group by `source_filename`. À investiguer.

Réponse :
```json
{
  "docs": [
    {
      "filename": "Reflexion process setting + IA.docx.pdf",
      "doc_kind": "operational_playbook",
      "chunks_proto": 4,
      "propositions_extracted": 177,
      "identity_chars": 0,
      "imported_at": "2026-05-03T10:00:00Z",
      "char_count": 16157
    }
  ],
  "playbooks": [
    {
      "name": "visite_profil",
      "kind": "source_core",
      "status": "scaffold|seeded|empty",
      "propositions_extracted": 0
    }
  ]
}
```

### `POST /api/v2/contradictions/:id/resolve` (déjà spec'é)

Body : `{ action: keep_a|keep_b|both_false_positive|reject_both|punt, note? }`. Side effects décrits dans le spec V1. À implémenter en TDD.

### `POST /api/v2/propositions/batch` (nouveau, simplifie le batch-preview de la spec V1)

Body : `{ persona, filters: { target_kind?, source_group?, confidence_min }, action: 'accept'|'reject', dry_run?: true }`.

Si `dry_run=true`, ne mute rien, retourne `{ matched: N, sample: proposition[5] }`. Sinon mute toutes les props matching → `accepted` ou `rejected`.

Cette version unifie batch-preview + batch-apply en un endpoint avec un flag, plus simple que les 2 endpoints séparés de la spec V1.

## Composants — détails de chaque

### `CollapsibleSection.svelte`

Props : `title`, `count` (string ou number), `countAlert` (bool), `defaultCollapsed` (bool, default false), `id` (pour scroll-to), `actions` (slot pour boutons header).

State : `collapsed` (init = defaultCollapsed). Click sur header toggle. Slot default = body. Body hidden quand collapsed.

Style mockup : `.section-head` avec `h2 (Newsreader, 21px)` + `.count` à droite, `▾` / `▸` toggle.

### `BrainNoteStrip.svelte`

Props : `tone` (`info|alert|hint`, default info). Slot = body markdown.
Style : background paper-subtle, border-left 3px vermillon, padding 11x14, font-mono 11px.

### `BatchBar.svelte`

Props :
- `filters` : `{ target_kind, source_group, confidence_min }` (state owned by parent)
- `distribution` : `{ all: [[1.00, 0], [0.95, 97], ...], hard_rules: [...] , ... }` — résultat d'un fetch précomputé sur le persona, calcul du `matched` côté client (instantané au move du slider)
- `onFilterChange(filters)` — émis sur chaque changement
- `onBatchAccept()` / `onBatchReject()` — émis sur click bouton

Le composant calcule `matched = countAt(filters.target_kind, filters.confidence_min)` à partir du `distribution`. Pas de fetch par move-slider.

### `PropositionsList.svelte`

Props : `propositions` (Array max ~30 pour la perf), `total` (number), `onAction(id, action)`, `onSeeAll()`.

Layout : grid 5 colonnes (90px / 1fr / 1fr / 110px / 130px) :
- `kind` (uppercase mono)
- `text` (Newsreader 14px)
- `src` (mono 10.5px : "Reflexion process · count 1 · 0.95")
- `conf` (mono 11px : "conf 0.95")
- `actions` : ✓ accept / éditer / ✗ reject (btn-small)

Dernière row : "+ N autres propositions · [tout voir]" (background paper-subtle, ink-30 color).

### `DoctrineGrid.svelte`

Props : `sections` (array de 7 entries) : `{ kind, prose_chars, pending_count }`.

Layout : grid 7 cells (1fr each), each cell :
- `name` (mono uppercase 10px) — kind name
- `num` (Newsreader 22px) — `prose_chars` formaté (23k, 518, 0)
- `meta` (mono 9.5px) — `prose · positionnement + bg` (si rempli) ou `vide · pending N` (si vide)

Click sur cell = drill (V1.1, juste console.log pour V1).

### `SourcesTable.svelte`

Props : `docs` (array), `playbooks` (array).

Table 6 colonnes : Document / Type / Chunks proto / Propositions extraites / Identity append / Importé. Bordure subtile, header background paper-subtle, ligne séparation entre docs et playbooks.

### `+page.svelte` final

```svelte
<script>
  // Auth + personaConfig (inchangé)
  // Fetch en parallèle sur mount :
  //   - GET /api/v2/brain-status
  //   - GET /api/v2/contradictions?status=open
  //   - GET /api/v2/propositions?persona=&status=pending&limit=30 (existing endpoint)
  //   - GET /api/v2/propositions/distribution?persona= (nouveau, retourne le DIST shape)
  //   - GET /api/v2/protocol?persona= (existing) pour les sections doctrine
  //   - GET /api/v2/sources?persona= (nouveau)
</script>

<BrainHeader … />
<BrainStatusBanner counts={status?.counts} … />

<CollapsibleSection id="arb" title="Arbitrages" count={status?.counts.contradictions_open} countAlert>
  <BrainNoteStrip>Pourquoi cette liste ?…</BrainNoteStrip>
  <ContradictionsList contradictions={contras} onResolve={resolveContra} />
  {#if contras.length > 5}
    <a class="see-all">+ {contras.length - 5} autres contradictions · tout voir →</a>
  {/if}
</CollapsibleSection>

<CollapsibleSection id="props" title="Propositions" count={status?.counts.propositions_pending}>
  <BatchBar bind:filters={propFilters} {distribution} onBatchAccept={handleBatchAccept} onBatchReject={handleBatchReject} />
  <p class="hint">Bouge le slider à 0.95 pour les ultra-fiables…</p>
  <PropositionsList propositions={filteredProps} total={propFilters.matched} onAction={handlePropAction} />
</CollapsibleSection>

<CollapsibleSection id="doctrine" title="Doctrine" count="…" defaultCollapsed>
  <DoctrineGrid sections={protocolSections} />
</CollapsibleSection>

<CollapsibleSection id="sources" title="Sources" count="…" defaultCollapsed>
  <SourcesTable docs={sources?.docs} playbooks={sources?.playbooks} />
</CollapsibleSection>

<footer>
  4 sections · 1 page · scroll
  ⚙ réglages + intégrations → <a href="/persona/{personaUuid}/settings">page séparée</a>
</footer>
```

## Séquencing TDD

| Étape | Bloc | Estimé | Test/check |
|---|---|---|---|
| **0** | Debug pourquoi `brain-status` renvoie counts à `—` (probablement fetch trop tôt avant `personaConfig.id` chargé, ou auth header) | 15 min | curl + console : counts non-null sur Nicolas |
| **1** | Corriger labels banner (lbl ↔ meta swap) | 5 min | screenshot match mockup |
| **2** | Ajouter `BrainNoteStrip.svelte` + l'inclure en haut de Contradictions list | 10 min | visible sur preview |
| **3** | Créer `CollapsibleSection.svelte` + tests `composer-state-style` (toggle state) | 30 min | tests unit pure JS pass |
| **4** | Refactor `+page.svelte` : supprimer mode bar + localStorage logic, wrapper sections dans `<CollapsibleSection>`, default-collapsed Doctrine et Sources | 30 min | manuel : scroll + collapse fonctionne |
| **5** | Supprimer `BrainModeBar.svelte` + son import | 5 min | grep clean |
| **6** | Endpoint `GET /api/v2/propositions/distribution?persona=` (TDD) — retourne le shape `{ all: [...], hard_rules: [...], … }` à partir des propositions pending | 45 min | tests 5/5 |
| **7** | Composant `BatchBar.svelte` (filter + slider + matched count + boutons) — état parent | 30 min | démo : déplacer slider met à jour `matched` instantanément |
| **8** | Composant `PropositionsList.svelte` (flat 5-col grid + actions ✓/éditer/✗) | 45 min | démo : top-30 props + "+N autres" row |
| **9** | Wire BatchBar + PropositionsList dans la section Propositions du `+page.svelte`, remplaçant l'ancien embed `<ProtocolPanel>` | 20 min | preview montre toolbar + flat list |
| **10** | Endpoint `POST /api/v2/propositions/batch` (dry_run + apply) — TDD | 1h | tests 6/6 |
| **11** | Wire boutons batch accept/reject avec confirm modal sur dry_run sample | 30 min | preview : click accept → modal preview → confirm → batch executed |
| **12** | Composant `DoctrineGrid.svelte` (7 cells) | 30 min | preview : cells correctes vs Nicolas data |
| **13** | Endpoint `GET /api/v2/sources?persona=` (TDD) | 45 min | tests 4/4 |
| **14** | Composant `SourcesTable.svelte` | 30 min | preview : table docs + playbooks |
| **15** | Endpoint `POST /api/v2/contradictions/:id/resolve` (TDD) — voir spec V1 §API | 1h | tests 7/7 |
| **16** | Wire `onResolve` dans `ContradictionsList` (passer la fonction au lieu de `null`) | 10 min | preview : click "garder A" → card disparaît, count décrémente |
| **17** | Lien footer ⚙ → route `/persona/[id]/settings` (créer la route, simple wrapper de SettingsPanel + ApiKeysPanel) | 30 min | navigation OK |
| **18** | Smoke test sur Nicolas via preview Vercel : (a) banner counts cohérents avec Supabase ; (b) collapse/expand sections ; (c) slider conf met à jour matched ; (d) accepter une prop la fait disparaître ; (e) garder A sur une contradiction décrémente count ; (f) ⚙ navigue | 30 min | acceptance criteria 1-6 ✓ |
| **19** | Run `merge-synonyms-and-list-contradictions.js --apply` sur Nicolas (avec re-écriture pour DB write — voir Étape 19a) | 1h | proposition_contradiction et proposition_merge_history populées |
| **19a** | Re-éditer le script pour qu'il écrive aussi dans `proposition_contradiction` + `proposition_merge_history` (mes edits avaient été reverted par session parallèle) | 30 min | dry-run montre les inserts attendus |
| **20** | Push final + merge à master + deploy preview → prod | 15 min | URL prod montre le mockup live sur Nicolas |

**Estimé total : 9-10h de coding focalisé.** Faisable en 1.5 journée si pas d'interruption.

## Risques

1. **`GET /api/v2/sources` peut nécessiter un nouveau schéma BDD.** `protocol_document` n'a pas de champ `chunks_proto` ou `propositions_extracted` agrégé, il faut soit derive depuis `proposition.source_ref` group by, soit ajouter une vue matérialisée. À investiguer Étape 13. **Mitigation V1 minimal :** retourner uniquement `{ filename, doc_kind, imported_at, char_count }` lus directement de `protocol_document` sans agrégation, et ajouter les colonnes count en V1.1.

2. **Distribution endpoint perf.** Sur Nicolas avec 232 props, calcul O(232) côté serveur, OK. Sur un persona à 5000 props ce sera plus lourd → cache 5min sur Vercel edge. **Mitigation V1 :** pas de cache, tester sur Nicolas, voir si latence acceptable (<500ms).

3. **Édition d'une proposition (bouton "éditer") pas dans le mockup en détail.** Décision V1 : `éditer` ouvre une textarea inline + bouton save → met à jour `proposition.proposed_text` via `POST /api/v2/propositions` action `revise`. Endpoint déjà existant. UI inline simple.

4. **Drill-down sur cell DoctrineGrid pas montré dans le mockup.** V1 : click sur cell scroll vers une sous-section dépliée qui affiche la prose éditable + count pending. Ou plus simple : click ouvre un side-drawer avec `<ProtocolSectionEditor>` (existing). À décider Étape 12.

## Hors-scope V1 (deferred)

- Drag-drop d'un doc sur la SourcesTable pour upload — restera bouton "+ importer un doc" dans banner uniquement
- Édition multi-ligne riche (markdown) sur Doctrine — V1 = textarea simple
- Auto-scan contradictions périodique (cron) — V1 = on-demand via script `--apply`
- Vital signs sparklines (regen rate, correction rate) — V1.1
- Mode mobile détaillé < 700px — V1 = stack vertical par défaut, pas de redesign
- Cell DoctrineGrid drill-down avec inline editor full-featured — V1.1
- Footer "page séparée" → vraie route /persona/[id]/settings standalone — V1 = bouton overlay, V1.1 vraie route

## Ce qui change vs spec `2026-05-04-brain-v1-arbitrage-design.md`

La spec V1 disait :
- ❌ Mode bar Arbitrage / Doctrine → **supprimé**
- ❌ DoctrineMode = ProtocolDoctrine + ProtocolSectionEditor → **remplacé par DoctrineGrid simple**
- ❌ Concepts sub-view différée V1.1 → **supprimé tout court** (mockup ne les a jamais demandées)
- ✅ Status banner 4 cells → **conservé** (avec labels corrigés)
- ✅ ContradictionsList cards A/B → **conservé** (+ note strip ajoutée)
- ❌ ProtocolPropositionsQueue (avec sub-tabs) embarqué → **remplacé par BatchBar + PropositionsList plats**
- ➕ **Ajouté** : SourcesTable, DoctrineGrid simple, CollapsibleSection, BrainNoteStrip
- ❌ Endpoints `auto-merged GET` + `split-back` + `batch-preview` → **différés V1.1** (le mockup montre juste un count "75 auto-mergées" dans banner sans surface dédiée)
- ➕ **Ajouté** : `GET /api/v2/sources`, `GET /api/v2/propositions/distribution`, `POST /api/v2/propositions/batch` (unifié)

## Notes implémentation

- Pas de mode bar = pas de localStorage `brain.mode.<persona>` à persister.
- Pas de query string `?mode=` dans l'URL.
- Sections collapsed/expanded peuvent être persistées en URL hash (`#arb`, `#props`, `#doctrine`, `#sources` qui scroll-to + force expand) pour deep-link friendly.
- Les fetches initiaux sont en parallèle (Promise.all) pour minimiser le TTFB perçu.
- Le BatchBar reçoit la `distribution` précomputée, donc le slider n'a aucun fetch à faire — instantané.

## Une fois fini : que voit le user

Sur `https://ahmet-a.vercel.app/brain/nicolas-lavall-e` (assuming Vercel deploy works) :

- Banner top : `19 à arbitrer / 232 à reviewer / 75 auto-mergées / 7 sections actives` (Nicolas data réelle)
- Section Arbitrages dépliée par défaut : note strip + 19 cards A vs B (5 visibles + lien "+14 autres")
- Section Propositions dépliée : batch toolbar avec slider à 0.85 → "108 matchent" + boutons rejeter (108) / accepter (108), puis 5 propositions sample, puis "+ 168 autres propositions"
- Section Doctrine collapsed (click pour expand) : grille 7 cells montrant identity 23k / hard_rules 0 vide pending 52 / etc.
- Section Sources collapsed : table 7 docs + 4 playbooks avec leurs counts
- Footer : "4 sections · 1 page · scroll" + lien "page séparée"

Identique au mockup, sur la vraie data Nicolas.
