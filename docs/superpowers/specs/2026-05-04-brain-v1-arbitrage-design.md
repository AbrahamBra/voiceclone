# Brain V1 arbitrage — design spec

**Status:** approved 2026-05-04 (user validated scope verbally)
**Target ship:** Nicolas live test ~2026-05-11 (1 week)
**Predecessor:** mockup `docs/mockups/brain-refonte-2026-05-03.html` (PR #239)

## Pourquoi

L'écran cerveau actuel (`/brain/[persona]`, 5 onglets) est un **catalogue d'objets** : connaissance, protocole, intelligence, intégrations, réglages. Le user navigue par type de chose. Il ne voit pas où concentrer son attention quand il y a 232 propositions pending et 19 contradictions ouvertes — il doit chercher.

La V1 promeut l'**arbitrage en first-class workflow** :

1. Status banner top-of-page = état actionnable (counts cliquables).
2. Mode bar `🎯 Arbitrage` (queue) / `📚 Doctrine` (browse).
3. Mode Arbitrage = contradictions → propositions (filtre source `📄 doc / 💬 chat`) → auto-mergées (split-back).
4. Mode Doctrine = `Sections` (les 7 protocol_section) ; sous-vue `Concepts` (graphe entities) **différée V1.1**.
5. ⚙ menu (popover) regroupe `intégrations` + `réglages` (rare config).
6. `connaissance` (upload doc) reste accessible depuis le banner et depuis Sources collapsed.

L'objectif Nicolas est : **qu'il arbitre ses 19 contradictions + N batches de propositions sur la nouvelle UI** entre le 11 et le 19 mai.

## Scope V1

### In scope

- Refonte `/brain/[persona]/+page.svelte` : status banner + mode bar + composition.
- Nouveau composant `ContradictionsList.svelte` (cards A vs B, 5 actions).
- Nouveau composant `AutoMergedList.svelte` (collapsible, split-back).
- Nouveau composant `BatchPreviewModal.svelte` (sample 5 random avant accept batch).
- Extension `ProtocolPropositionsQueue.svelte` : filtre `source: doc / chat / tous`.
- Endpoints :
  - `GET /api/v2/brain-status?persona=` — counts banner en 1 fetch.
  - `GET /api/v2/contradictions?persona=&status=open|punted|resolved` — list paires.
  - `POST /api/v2/contradictions/:id/resolve` — actions A/B/les2/rejeter/punter.
  - `POST /api/v2/contradictions/scan?persona=` — déclenche détection sur un persona (wrap des scripts existants).
  - `GET /api/v2/propositions/auto-merged?persona=` — list merge_history.
  - `POST /api/v2/propositions/auto-merged/:id/split-back` — restaure le B mergé.
  - `POST /api/v2/propositions/batch-preview` — sample N matching filtres.
- Migration `071_brain_v1_arbitrage.sql` (déjà commitée — applied par user sur Supabase).
- Tests `node:test` pour chaque endpoint (DI pattern, comme `test/api-v2-propositions.test.js`).
- Re-écriture incrémentale de `scripts/merge-synonyms-and-list-contradictions.js` pour écrire dans `proposition_contradiction` (en plus du MD).

### Out of scope V1

- Mode Doctrine sous-vue `Concepts` (graphe `knowledge_entities`) — V1.1.
- Vital signs sparklines (regen rate, correction rate) — V1.1.
- Rappel auto sur contradictions punted — V1.1.
- Mobile responsive < 700px : stack vertical seulement (pas de redesign).
- L1/L2/L3 maturity-aware empty states — décoratif aujourd'hui (cf. `docs/decisions/2026-05-02-maturity-backfill.md`).
- Cron auto-scan contradictions périodique — V1.1 (V1 = scan on-demand via endpoint).
- Cross-persona view — hors-scope (cerveau strictement per-persona).
- Auto-merge → écriture rétrospective dans `proposition_merge_history` — pas de backfill, on accepte la perte d'info pré-mig 071.

## Data model — ce qui change

Migration `071_brain_v1_arbitrage.sql` ajoute 2 tables :

### `proposition_contradiction`

| col | type | notes |
|---|---|---|
| id | uuid PK | gen_random_uuid |
| persona_id | uuid FK personas | ON DELETE CASCADE |
| proposition_a_id | uuid FK proposition | A = LEAST(a,b) UUID — canonicalisation à l'insert |
| proposition_b_id | uuid FK proposition | B = GREATEST |
| kind | text | target_kind partagé (mêmes valeurs que proposition.target_kind) |
| cosine | numeric(4,3) | 0..1 |
| reason | text | "règle absolue vs conditionnelle", etc. (Haiku output) |
| status | text | open / resolved / punted |
| resolved_action | text | keep_a / keep_b / both_false_positive / reject_both |
| resolved_note | text | optional, mémo user |
| detected_at | timestamptz | now() |
| resolved_at | timestamptz | NULL tant que open/punted |

**Invariants** : A != B ; cohérence (status='resolved') ⇔ (resolved_action IS NOT NULL AND resolved_at IS NOT NULL) ; UNIQUE(a, b).

### `proposition_merge_history`

| col | type | notes |
|---|---|---|
| id | uuid PK | |
| persona_id | uuid FK personas | |
| kept_proposition_id | uuid FK proposition | celle qui a survécu |
| merged_proposition_text | text | snapshot B |
| merged_proposition_count | int | count de B |
| merged_provenance | jsonb | snapshot provenance B (peut être null) |
| merged_source_refs | uuid[] | snapshot source_refs B |
| merge_source | text | auto_synonym / user_arbitrage_keep_a / user_arbitrage_keep_b |
| merge_cosine | numeric(4,3) | NULL pour user_arbitrage |
| merged_at | timestamptz | |
| reverted_at | timestamptz | si split-back |
| reverted_to_proposition_id | uuid FK proposition | nouvelle prop ré-insérée |

## API contracts

### GET `/api/v2/brain-status?persona=<slug>`

Auth : access code OR session token (mêmes que `/api/v2/propositions`).

Response 200 :
```json
{
  "persona_id": "uuid",
  "persona_slug": "nicolas-lavall-e",
  "counts": {
    "contradictions_open": 19,
    "propositions_pending": 232,
    "propositions_pending_doc": 187,
    "propositions_pending_chat": 45,
    "auto_merged": 75,
    "doctrine_sections_filled": 6,
    "doctrine_sections_total": 7
  }
}
```

### GET `/api/v2/contradictions?persona=<slug>&status=open|punted|resolved`

Default `status=open`. Sort par cosine DESC (les plus serrées d'abord).

Response 200 :
```json
{
  "contradictions": [
    {
      "id": "uuid",
      "kind": "hard_rules",
      "cosine": 0.868,
      "reason": "règle absolue vs conditionnelle",
      "status": "open",
      "detected_at": "...",
      "a": {
        "id": "uuid",
        "text": "Jamais mentionner l'offre…",
        "count": 1,
        "intent": "add_rule",
        "confidence": 0.92,
        "sources": ["📄 Reflexion process setting + IA.docx.pdf p4 §2.1"]
      },
      "b": { "id": "uuid", "text": "Ne jamais mentionner…", "count": 2, ... }
    }
  ]
}
```

### POST `/api/v2/contradictions/:id/resolve`

Body :
```json
{ "action": "keep_a" | "keep_b" | "both_false_positive" | "reject_both" | "punt", "note": "optional" }
```

Side effects par action :
- `keep_a` : `proposition.b.status = 'rejected'` + ligne `proposition_merge_history` (merge_source='user_arbitrage_keep_a'). Contradiction → status='resolved'.
- `keep_b` : symétrique sur A.
- `both_false_positive` : aucune mutation des propositions, contradiction → status='resolved'. (V1.1 : feed ce signal au classifieur pour réduire faux positifs.)
- `reject_both` : `a.status = b.status = 'rejected'`, contradiction → status='resolved'.
- `punt` : aucune mutation, contradiction → status='punted'. La paire sort du fetch default `status=open` mais reste accessible.

Response 200 : la contradiction mise à jour (mêmes champs que GET).

### POST `/api/v2/contradictions/scan?persona=<slug>`

Body : `{ "force": false }` — si `false`, n'efface pas les contradictions punted/resolved existantes ; si `true`, repart à zéro.

Process : scan des propositions pending du persona, paires same-kind avec cosine ≥ 0.65 → Haiku classifie SYNONYM / CONTRADICTION / DISJOINT (logique existante de `merge-synonyms-and-list-contradictions.js`).
- SYNONYM avec cosine ≥ 0.85 → auto-merge + ligne dans `proposition_merge_history`.
- SYNONYM avec 0.65 ≤ cosine < 0.85 → laissé tel quel (V1 : pas de zone grise mergée auto).
- CONTRADICTION → upsert ligne dans `proposition_contradiction` (ON CONFLICT DO NOTHING grâce à UNIQUE(a,b)).
- DISJOINT → ignoré.

Response 200 : `{ scanned_pairs, auto_merged, contradictions_inserted, contradictions_existing }`.

### GET `/api/v2/propositions/auto-merged?persona=<slug>`

List `proposition_merge_history` WHERE persona AND `reverted_at IS NULL`. Sort `merged_at DESC`.

Response 200 :
```json
{
  "merges": [
    {
      "id": "uuid",
      "kept_proposition_id": "uuid",
      "kept_text": "(joined via FK)",
      "merged_text": "(snapshot)",
      "merged_count": 2,
      "merge_source": "auto_synonym",
      "merge_cosine": 0.91,
      "merged_at": "..."
    }
  ]
}
```

### POST `/api/v2/propositions/auto-merged/:id/split-back`

Side effect : crée une nouvelle proposition (nouveau UUID) avec `merged_proposition_text`, `merged_proposition_count`, `merged_provenance`, status='pending'. Met à jour la ligne `proposition_merge_history` : `reverted_at = now()`, `reverted_to_proposition_id = <new uuid>`. Décrémente `kept_proposition.count` du `merged_count`.

Response 200 : `{ new_proposition_id, kept_proposition_id }`.

### POST `/api/v2/propositions/batch-preview`

Body : `{ persona, filters: { kind?, source?, confidence_min?, ... }, sample_size: 5 }`

Response 200 : `{ matched: 108, sample: [proposition[]] }`.

Pas de mutation. Sert à alimenter la modale `BatchPreviewModal` avant que le user clique "✓ accepter (108)" pour de vrai.

## UI contract

### Page shell

```
src/routes/brain/[persona]/+page.svelte
├── BrainHeader (avatar, nom, niveau, ⚙ popover)
├── BrainStatusBanner (4 cells + bouton import)
├── BrainModeBar (Arbitrage | Doctrine)
└── slot par mode :
    ├── ArbitrageMode :
    │   ├── ContradictionsList
    │   ├── ProtocolPropositionsQueue (existing, étendu filtre source)
    │   └── AutoMergedList
    └── DoctrineMode :
        └── ProtocolDoctrine (existing) + ProtocolSectionEditor (existing)
```

### URL synchronisation

- `?mode=arbitrage` (default) ou `?mode=doctrine`
- Persistance par persona : remember last choice in localStorage `brain.mode.<persona_id>`
- Deep-link : `?mode=arbitrage&filter=hard_rules` pour preset filter sur queue

### Acceptance criteria (Nicolas test)

1. Status banner affiche les 4 counts avec valeurs réelles (vérifié `curl /api/v2/brain-status` puis cross-check Supabase).
2. Click sur cell `19 contradictions` scroll/focus la section Contradictions.
3. Click "garder A" sur une carte : prop B passe à `rejected` en BDD ; contradiction passe à `resolved` ; la card disparaît de la liste open.
4. Click "punter" : contradiction → `punted`, card disparaît de la list default mais réapparaît avec filtre `?status=punted`.
5. Slider conf à 0.95 + filtre `kind=hard_rules` → "✓ accepter (N)" ouvre modale avec 5 props random ; click "Confirmer" → toutes passent à `accepted`.
6. Dans Auto-mergées, click "split-back" sur une ligne → nouvelle prop pending réapparaît dans la queue ; ligne historique → reverted_at set.
7. Bascule mode Doctrine → 7 cards sections, click `hard_rules` ouvre l'éditeur prose existant.
8. URL `mode` synchronisé sur navigation.

### Reuse map (mockup zone → composant)

| Zone mockup                          | Existant                        | À écrire             |
|---                                   |---                              |---                   |
| Header avatar + nom + niveau         | repris du +page.svelte actuel  | refactor             |
| ⚙ popover menu                      | ApiKeysPanel + SettingsPanel    | wrapper popover      |
| Status banner 4 cells + import btn   | counts via brain-status         | `BrainStatusBanner.svelte` |
| Mode bar Arbitrage / Doctrine        | —                               | `BrainModeBar.svelte` |
| Section Contradictions               | —                               | `ContradictionsList.svelte` (cards A/B + 5 actions) |
| Section Propositions                 | `ProtocolPropositionsQueue` (PR #234)            | + filtre `source: doc/chat` |
| Section Auto-mergées                 | —                               | `AutoMergedList.svelte` |
| Modale batch preview                 | —                               | `BatchPreviewModal.svelte` |
| Mode Doctrine                        | `ProtocolDoctrine` + `ProtocolSectionEditor` | wrapper composition |
| Sources collapsed                    | `SourcePlaybooksPanel`          | toggle collapse      |

## Sequencing (1 semaine)

| Date          | Bloc                                              | Livrable vérifiable |
|---            |---                                                |---                  |
| **lun 4 mai (today)** | Spec + migration 071 + scaffold branche       | PR #240 draft, migration appliquée par user |
| **mar 5 mai** | Endpoints `brain-status` + `contradictions GET` (TDD) | `curl` retourne valeurs réelles Nicolas |
| **mer 6 mai** | Endpoint `contradictions/resolve` + `scan` (TDD)  | actions modifient DB |
| **jeu 7 mai** | Endpoints `auto-merged GET/split-back` + `batch-preview` (TDD) | tous endpoints couverts |
| **ven 8 mai** | UI shell + ContradictionsList + StatusBanner       | preview Vercel partielle |
| **sam 9 mai** | UI ProtocolPropositionsQueue ext + AutoMergedList + BatchPreviewModal | preview Vercel complète |
| **dim 10 mai**| Mode Doctrine wiring + smoke test sur Nicolas      | acceptance criteria 1-8 ✓ |
| **lun 11 mai**| **Test live Nicolas** sur preview Vercel           | il arbitre ses 19 contradictions |
| **mar–dim**   | Itérations selon retours, polish, merge sur master | go production |

## Risques connus et mitigation

1. **DDL = user side.** L'utilisateur applique `071_brain_v1_arbitrage.sql` sur Supabase prod. Les endpoints n'écriront pas tant que ce n'est pas fait. **Mitigation :** PR ouvert immédiatement avec migration en évidence ; je signale quand c'est en attente d'application.
2. **Re-scan contradictions sur Nicolas peut prendre du temps** (100+ paires × Haiku ~2s). Mitigation : endpoint scan retourne en streaming SSE ou async (decision pendant l'impl, par défaut synchrone avec timeout 60s).
3. **Conflit sur ProtocolPropositionsQueue** si une autre branche le touche en parallèle. **Mitigation :** rebase quotidien depuis master, watch open PRs.
4. **Nicolas découvre un cas d'arbitrage non prévu** (ex: il veut éditer A avant de keep_a). **Mitigation :** V1 = 5 actions strictes ; édition inline = V1.1 (post-test).

## Hors-livrable explicite

- Aucun changement à la table `proposition` (ses statuses pending/accepted/rejected/revised/merged sont déjà tous suffisants).
- Aucun changement à la table `corrections` ni `feedback_events`.
- Aucun changement aux pipelines `extractGraphKnowledge` / `extractEntitiesFromContent` (intelligence/graphe).
- Aucun changement aux cron jobs (cron drain ne touche pas contradictions ; le scan reste on-demand pour V1).
