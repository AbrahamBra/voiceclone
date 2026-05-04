# Brain V2 — Cockpit design spec

**Status:** approved 2026-05-04 (validé par user en brainstorm visuel)
**Target ship:** ~2026-05-14 (10 jours)
**Predecessor:** [2026-05-04-brain-v1-realignment-mockup.md](../plans/2026-05-04-brain-v1-realignment-mockup.md) (V1 actuel en prod, reste live pendant le développement V2)
**Mockups validés:** `.superpowers/brainstorm/533-1777856044/content/` (A2 layout + D2 cards + trajectoire reframe)

## Pourquoi V2

V1 (mergée 2026-05-04) reproduit le mockup PR #239 fidèlement (4 sections empilées scroll-collapse) mais le client trouve la page **illisible** : "0 contradictions, 379 props collapsed, doctrine 7 cells incompréhensibles, sources 9 lignes dont 6 dupes". Pas de récit, pas de causalité, pas de "next step" évident.

Le client a articulé une vision claire : **un cockpit qui sépare action et observation**, où le client voit ses **décisions** d'un côté et **son clone qui se construit** de l'autre, avec une **pédagogie inline** qui rend explicite le lien entre les deux.

L'objectif : que Nicolas (et tout client) comprenne en 5 secondes (a) ce qu'il a à faire, (b) ce que ça produit, (c) que son clone progresse.

## Vision

**Le cockpit raconte une chaîne causale** : `setters corrigent → propositions à arbitrer → décisions du client → fondation doctrine se remplit → trajectoire performance monte → résultats (RDV pris)`.

Chaque zone du cockpit est un maillon de cette chaîne, lisible d'un coup d'œil.

L'idéal du clone n'est pas "accumuler du knowledge" mais **atteindre la stabilité opérationnelle** : moins de corrections → plus de RDV → l'asymptote où le clone produit seul.

## Architecture

**4 endroits distincts**, chacun a un rôle clair :

| Route | Rôle | Fréquence d'usage |
|---|---|---|
| `/brain/[persona]` | **Cockpit** — décide + observe | Quotidien |
| `/persona/[id]/team` | Détail per-setter (corrections, performance) | Hebdomadaire |
| `/persona/[id]/sources` | Gestion docs (import/archive/supprimer/preview) | Mensuel |
| `/persona/[id]/settings` | Intégrations + réglages (API keys, voix) | Rare |

Le brain devient un **pur cockpit** : pas de gestion docs inline, pas de settings popover, pas de mode bar. Tout ce qui n'est pas action quotidienne vit ailleurs.

## Layout cockpit

Validé en brainstorm visuel : **layout A2** = strip top + split horizontal 60/40.

```
┌─────────────────────────────────────────────────────────┐
│ STRIP NOIR (full-width)                                 │
│ "Cette semaine — tes 3 setters → 47 corrections →       │
│  23 propositions générées"   [Alec · Henry · Marc →]    │
├──────────────────────────────────┬──────────────────────┤
│ DÉCISIONS (60%)                  │ CONSTRUCTION (40%)   │
│ ─────────────                    │ ─────────────────    │
│                                  │                      │
│ ⚡ 19 contradictions à arbitrer   │ 💡 3 RDV pris       │
│   (cards D2 stacked)             │    (hero outcome)    │
│                                  │                      │
│ 📋 379 propositions à reviewer   │ 📈 Trajectoire       │
│   (BatchBar + queue D2-style)    │    Corrections ↘     │
│                                  │    Autonomie ↗       │
│                                  │                      │
│                                  │ 📚 Fondation         │
│                                  │    7 bars doctrine   │
│                                  │    + pédago inline   │
└──────────────────────────────────┴──────────────────────┘
```

**Mobile** (< 700px) : tout en stack vertical (strip → décisions → construction). Pas de redesign mobile ambitieux V2.

## Zones — détail

### Strip setter activity (top)

**Composant:** `SetterActivityStrip.svelte`
**Style:** background `#1a1a1a`, color `#f5f3e8`, padding 10-12px, font-size 11px. Hero compact.
**Données:** `GET /api/v2/setter-activity?persona=<uuid>&period=week` (nouveau)
**Contenu:**
- Gauche : phrase synthèse `"Cette semaine — tes 3 setters ont corrigé 47 messages → 23 propositions à reviewer"`
- Droite : drill-down `"Alec 23 · Henry 18 · Marc 6 →"` qui linke vers `/persona/[id]/team`

**Click** sur le strip → `/persona/[id]/team`.

### Zone Décisions (60% gauche)

#### Bloc 1 — Contradictions à arbitrer

**Composant:** `ContradictionsList.svelte` (existant, refondu en traitement D2)
**Données:** `GET /api/v2/contradictions?persona=&status=open` (existant)

**Card design D2** (validé en brainstorm) :
- Header : `KIND · reason` à gauche, `cosine X.XX` à droite, sur background `paper-subtle`
- Body : A et B **stacked** (pas side-by-side V1) avec source visible
  - `A — Reflexion process.pdf · 1 mention` (font-mono 10px, ink-40)
  - Texte du A en font serif 14px line-height 1.4
  - `B — Correction Alec · 2 mentions setters` (font-mono 10px, ink-40)
  - Texte du B en font serif 14px line-height 1.4
- Footer : 5 boutons d'action sur background `paper-subtle`
  - `garder A` / `garder B` (primaires, fond #222)
  - `les 2 OK` / `rejeter` / `plus tard` (secondaires, fond transparent)

**Source visible** (le gain principal vs V1) : afficher d'où vient chaque proposition (`<doc_filename>`, `<correction_setter_name>`, `<event_type>`) aide le client à décider sans drill-down. Souvent la décision tombe juste en lisant la source.

**Action** : `POST /api/v2/contradictions-resolve` (existant, déjà implémenté en V1).

#### Bloc 2 — Propositions à reviewer

**Composants:** `BatchBar.svelte` + `PropositionsList.svelte` (existants, BatchBar gardée telle quelle, PropositionsList ajoute colonne source en style D2)

**BatchBar** : inchangée vs V1 — slider confidence + filter target_kind + matched count + boutons batch accept/reject. L'histogramme micro-bar (bonus serendipity V1) est conservé.

**PropositionsList rows enrichies** :
- Layout 5-col existant : `kind / text / src / conf / actions`
- Colonne `src` : étoffée avec source contextualisée (`Reflexion process · 1 mention` ou `Correction Alec · 2 mentions setters`)
- Click sur la row source → drill-down (V2.1, juste console.log V2)

**Action** : `POST /api/v2/propositions` (action accept/reject/revise — existant) ou batch via `POST /api/v2/propositions-batch` (existant).

### Zone Construction (40% droite)

Lue **de haut en bas** : résultat → tendance → fondation. La causalité narrative remonte de l'effet à la cause.

#### Bloc 1 — Hero outcome

**Composant:** `OutcomeHero.svelte` (nouveau)
**Données:** `GET /api/v2/clone-outcomes?persona=&period=week` (nouveau)
**Contenu:**
- Background gradient sombre (`linear-gradient(135deg, #222, #3a3a3a)`)
- Label uppercase mono : `"Cette semaine"`
- Big number serif 32px : `"3 RDV pris"`
- Delta inline 10px opacity 0.8 : `"+2 vs semaine dernière"`

#### Bloc 2 — Trajectoire

**Composant:** `TrajectoryBlock.svelte` (nouveau)
**Données:** `GET /api/v2/clone-trajectory?persona=&period=8weeks` (nouveau)
**Contenu:**
- Label `"TRAJECTOIRE"` (uppercase mono 10px)
- 2 metrics avec sparklines SVG :
  - `Corrections setters / sem. : 47 ↘` + sparkline 8 points
  - `Autonomie msg. : 73% ↗` + sparkline 8 points
- Pédagogie inline (italique mono 9.5px ink-40) : `"Ton clone produit 73% de messages sans correction. Il y a 4 sem. : 41%."`

#### Bloc 3 — Fondation (doctrine)

**Composant:** `DoctrineFoundation.svelte` (refonte de `DoctrineGrid.svelte`)
**Données:** `GET /api/v2/protocol?persona=` (existant) + `allPendingProps` côté client pour pending counts par kind.
**Contenu:**
- Label `"FONDATION (DOCTRINE)"`
- 7 bars horizontales représentant les 7 sections (filled = `#222`, empty = `#ddd`)
- Hover sur une bar = tooltip avec kind + chars
- Sous-texte mono 9.5px : `"2/7 sections · +1.4k chars cette semaine"`
- Pédagogie actionnable : `"5 sections vides + 138 props pending sur hard_rules → arbitrer là baisserait le plus tes corrections."` (phrase générée côté serveur ou règle simple front : trouver le kind avec le plus de pending props et le plus de prose vide)

**Click sur une bar** → expand & scroll vers la section Propositions du cockpit avec filtre `target_kind` appliqué (V2). V2.1 : drawer avec `ProtocolSectionEditor` pour éditer la prose inline.

## Pages séparées

### `/persona/[id]/team` (nouvelle)

**Composant page:** `src/routes/persona/[id]/team/+page.svelte`
**Données:** `GET /api/v2/setter-activity?persona=<uuid>&period=...` étendu

**Contenu V2 minimal:**
- Liste des setters (table)
- Par setter : `name | corrections this week | total corrections | last activity`
- Click sur un setter → drawer ou sub-page avec liste des corrections récentes (message avant/après + proposition générée)
- Filtre par période (semaine / mois / total)

**V2.1 deferred:** outcomes par setter (RDV pris attribuables), patterns de correction, alignement avec doctrine.

### `/persona/[id]/sources` (nouvelle)

**Composant page:** `src/routes/persona/[id]/sources/+page.svelte`
**Données:** `GET /api/v2/sources?persona=` (existant) + actions à étendre

**Contenu V2 minimal:**
- Liste docs avec actions inline : `[archiver] [supprimer] [voir chunks]`
- Bouton `+ importer un doc` (déclenche flow upload existant)
- Liste playbooks séparée
- Dedup par filename optionnel (UI toggle "Grouper par doc" qui collapse les 3 imports du même background.odt)

**Endpoints à ajouter:**
- `POST /api/v2/sources/:id/archive` (set status='archived')
- `DELETE /api/v2/sources/:id` (soft delete = `protocol_import_batch.status='archived'` ; hard delete out-of-scope V2)
- `GET /api/v2/sources/:id/chunks` (preview)

### `/persona/[id]/settings` (déjà spawned)

Cf. chip task spawned côté V1. Migrer ApiKeysPanel + SettingsPanel ici, retirer le popover du brain.

## Flux de données — endpoints

### Existants (réutilisés sans changement)

- `GET /api/v2/brain-status?persona=` → counts banner (V1, étendu avec document_id)
- `GET /api/v2/contradictions?persona=&status=open` → cards arbitrage
- `POST /api/v2/contradictions-resolve` → résoudre une contradiction
- `GET /api/v2/propositions?document=&status=pending` → liste propositions
- `POST /api/v2/propositions` (action accept/reject/revise) → muter une proposition
- `POST /api/v2/propositions-batch` → batch reject (accept différé V1.1)
- `GET /api/v2/propositions-distribution?persona=` → buckets pour le slider
- `GET /api/v2/sources?persona=` → docs + playbooks
- `GET /api/v2/protocol?persona=` → sections doctrine

### Nouveaux endpoints (à créer)

#### `GET /api/v2/setter-activity?persona=<uuid>&period=week|month`

**Output:**
```json
{
  "persona_id": "<uuid>",
  "period": "week",
  "since": "2026-04-27T00:00:00Z",
  "total_corrections": 47,
  "propositions_generated": 23,
  "propositions_accepted": 12,
  "by_setter": [
    { "client_id": "<uuid>", "name": "Alec", "corrections": 23, "last_activity": "2026-05-04T..." },
    { "client_id": "<uuid>", "name": "Henry", "corrections": 18, "last_activity": "2026-05-03T..." },
    { "client_id": "<uuid>", "name": "Marc", "corrections": 6, "last_activity": "2026-05-02T..." }
  ]
}
```

**Source data:** `feedback_events` table where `event_type IN ('corrected', 'validated_edited')`, joined to `messages` and/or `conversations` to extract who posted the corrected message (the setter). Group by setter identifier.

**Note implémentation:** `feedback_events` n'a pas de `client_id` direct (cf migration 029). Le setter est inféré via `messages.client_id` ou `conversations.owner_id` — à investiguer Step 1 du plan d'implémentation. Si la mapping setter→nom n'existe pas, V2 affiche un placeholder type `"Setter #1"` indexé par UUID.

#### `GET /api/v2/clone-trajectory?persona=<uuid>&period=8weeks`

**Output:**
```json
{
  "persona_id": "<uuid>",
  "period": "8weeks",
  "correction_rate": {
    "current_value": 47,
    "delta": -42,
    "series": [89, 76, 68, 60, 55, 52, 49, 47]
  },
  "autonomy_pct": {
    "current_value": 0.73,
    "delta": 0.32,
    "series": [0.41, 0.45, 0.52, 0.58, 0.62, 0.66, 0.70, 0.73]
  }
}
```

**Source data:**
- `correction_rate` : count `feedback_events.event_type IN ('corrected', 'validated_edited')` par semaine sur 8 semaines glissantes
- `autonomy_pct` : `1 - (corrections / total_messages_drafted)` par semaine

**Volume:** ~50 events/semaine sur Nicolas, 8 semaines = ~400 events scannés. OK.

#### `GET /api/v2/clone-outcomes?persona=<uuid>&period=week`

**Output:**
```json
{
  "persona_id": "<uuid>",
  "period": "week",
  "rdv_count": 3,
  "rdv_delta": 2
}
```

**Source data:** `feedback_events.event_type = 'appointment_booked'` (NOUVEAU type, voir migration ci-dessous).

**V2 minimal:** si `appointment_booked` n'a aucune ligne (aucun setter ne l'a encore utilisé), afficher `0` avec note pédago : *"Aucun RDV marqué cette semaine. Tes setters peuvent marquer un RDV depuis la conversation."*

## Migration

### `072_appointment_booked_event_type.sql`

```sql
-- Étend feedback_events.event_type pour tracker les RDV pris.
-- Le setter marque manuellement depuis la conversation (bouton "RDV pris" à
-- ajouter dans /chat/[persona] — out of scope V2 cockpit, in scope V2.1 ou
-- piloté par une issue parallèle).

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN ('validated', 'validated_edited', 'corrected',
                        'saved_rule', 'appointment_booked'));

COMMENT ON CONSTRAINT feedback_events_event_type_check ON feedback_events IS
  'Type d''événement feedback. appointment_booked ajouté par mig 072 — '
  'utilisé par /api/v2/clone-outcomes pour tracker les RDV pris.';
```

**Note client:** la migration est purement additive (étend un CHECK), aucune donnée existante affectée. Idempotent par DROP IF EXISTS + ADD CONSTRAINT.

## Composants — récap

### Nouveaux

- `src/lib/components/brain/SetterActivityStrip.svelte`
- `src/lib/components/brain/OutcomeHero.svelte`
- `src/lib/components/brain/TrajectoryBlock.svelte`
- `src/lib/components/brain/DoctrineFoundation.svelte` (refonte de `DoctrineGrid.svelte` ; on garde le folder `brain/` puisque la route reste `/brain/[persona]`)

### Réutilisés (avec retouches)

- `src/lib/components/brain/ContradictionsList.svelte` → traitement D2 (sources visibles, stacked layout)
- `src/lib/components/brain/PropositionsList.svelte` → ajout colonne source enrichie

### Réutilisés (inchangés)

- `src/lib/components/brain/BatchBar.svelte` (incluant histogramme micro-bar V1)
- `src/lib/components/brain/BrainStatusBanner.svelte` (utilisable mais probablement remplacé par les zones du cockpit qui contiennent les counts disséminés ; le banner global devient redondant. **Décision:** retirer du cockpit V2, ses 4 cells s'intègrent dans les sections.)

### Pages

- `src/routes/brain/[persona]/+page.svelte` → réécrit en cockpit V2 (utilise `CockpitLayout` ou inline)
- `src/routes/persona/[id]/team/+page.svelte` (nouveau)
- `src/routes/persona/[id]/sources/+page.svelte` (nouveau, hors-scope cette PR — issue séparée déjà spawned)
- `src/routes/persona/[id]/settings/+page.svelte` (nouveau, déjà spawned)

## Pédagogie inline — phrases templates

3 phrases-clés à des points stratégiques. Pas de Haiku call V2, juste interpolation côté serveur ou front.

### Sur la trajectoire

```
Ton clone produit {autonomy_pct}% de messages sans correction. Il y a 4 sem. : {autonomy_4w_ago}%.
```

### Sur la fondation

Phrase priorisée selon le kind avec le plus de potentiel de réduction de corrections :

```
{n_empty} sections vides + {top_kind_pending} props pending sur "{top_kind}" → arbitrer là baisserait le plus tes corrections.
```

Logique : `top_kind = argmax(pending_count_per_kind WHERE prose_chars=0)`.

### Sur le strip setter

```
Cette semaine — tes {n_setters} setters ont corrigé {total_corrections} messages → {props_generated} propositions à reviewer.
```

## Error handling

- **Endpoints 500/404** : zone affiche un état d'erreur inline (style "page-error" du V1) avec bouton "réessayer".
- **Données vides** : empty state pédagogique (ex: "Aucun RDV cette semaine — tes setters peuvent en marquer depuis la conversation"), pas un blank.
- **Persona introuvable** : redirect vers `/` ou page 404 avec message clair.
- **Setter sans nom** : fallback "Setter #1" / "Setter #2" si client_id ne mappe pas vers un nom.

## Testing

### Endpoint TDD (pattern V1)

- `test/api-v2-setter-activity.test.js` (5-6 tests)
- `test/api-v2-clone-trajectory.test.js` (5-6 tests)
- `test/api-v2-clone-outcomes.test.js` (4-5 tests)

DI pattern aligné `test/api-v2-brain-status.test.js`. Mocks Supabase via `makeSupabase` config.

### Tests régression

- Les tests existants `api-v2-brain-status`, `api-v2-propositions-distribution`, `api-v2-propositions-batch`, `api-v2-contradictions-resolve` doivent rester verts (régressions du `source_core IS NULL` filter notamment).

### Tests UI

- Pas de tests unitaires composants Svelte (codebase n'en a aucun).
- **Smoke test** : Vercel preview sur Nicolas, checklist :
  - Strip affiche corrections this week
  - Décisions zone : contradictions cards D2 lisibles avec sources
  - Construction zone : RDV count + sparklines + doctrine bars
  - Click strip → `/team` charge
  - Click bar doctrine → scroll vers Propositions filtré
  - Mobile < 700px : stack vertical fonctionne

## Hors-scope V2 (deferred V2.1)

- **Drill-down ProtocolSectionEditor** (édition prose inline depuis DoctrineFoundation cells) — V2.1
- **Phrases pédagogie générées par Haiku** (au lieu de templates) — V2.1
- **Outcomes par setter sur /team page** (RDV attribuables) — V2.1
- **Drag-drop docs sur sources** — V2.1
- **Cron auto-scan contradictions** — V2.1 (V2 = scan on-demand via script)
- **Mobile redesign ambitieux** — V2 = stack vertical par défaut
- **Bouton "RDV pris" dans /chat/[persona]** — issue séparée (côté chat, pas brain)

## Risques

1. **`client_id → setter_name` resolution** : si la table `personas` ou autre n'a pas la mapping setter, le strip et la /team page affichent des UUID. Mitigation V2 : fallback `"Setter #N"` indexé par UUID hash. À investiguer dès Step 1 du plan.

2. **`appointment_booked` n'aura aucune donnée au launch** (mig juste appliquée, aucun setter n'a encore le bouton). Mitigation : afficher `0` + note pédago, et créer une issue parallèle pour ajouter le bouton dans `/chat/[persona]` (out of scope cette spec).

3. **Sparklines sur 8 semaines** demandent 8 weeks de data. Sur Nicolas qui a démarré récemment, certaines semaines seront à 0. Mitigation : sparkline démarre à la première semaine non-vide, label `"depuis {date}"`.

4. **Migration de feedback_events** : juste un CHECK étendu, mais affecter des conventions existantes (chat-side qui INSERT des events). Vérifier que le INSERT côté `/api/feedback` n'utilise pas un kind hardcodé non-listé. Mitigation : grep `event_type` côté code avant migration.

5. **Régression sur cockpit user-facing** : on remplace une UI live (V1) par une nouvelle. Mitigation : feature flag ou route alternative (`/brain/[persona]/v2`) pour smoke-test avec Nicolas avant de cut over.

## Rollback

Si V2 casse, revert le merge commit. V1 reste fonctionnel comme fallback. La migration 072 est additive — pas besoin de rollback DDL.

## Acceptance criteria (smoke test)

À valider sur Nicolas via preview Vercel avant merge prod :

1. Strip top affiche "X setters · Y corrections cette semaine" avec drill-down link vers `/team`
2. Zone décisions : contradictions cards D2 lisibles avec source par option (A et B)
3. Zone décisions : propositions queue avec BatchBar + rows enrichies source
4. Zone construction : RDV count en hero (même si 0)
5. Zone construction : 2 sparklines (corrections ↘, autonomie ↗) avec valeurs
6. Zone construction : 7 bars doctrine + phrase pédago actionnable
7. Click bar doctrine → expand & scroll vers Propositions filtré par kind
8. Click strip → `/persona/[id]/team` charge sans 404
9. Mobile < 700px : tout stack verticalement, lisible
10. Tests : 1106+/1106 pass (V1 + nouveaux endpoints), svelte-check 0 errors

## Sequencing (10 jours)

Estimé en jours de coding focalisé. Détail dans le plan d'implémentation (à venir).

| Bloc | Estimé | Contenu |
|---|---|---|
| 1 | 2j | Migration 072 + 3 endpoints TDD (setter-activity, trajectory, outcomes) |
| 2 | 2j | Composants nouveaux (SetterActivityStrip, OutcomeHero, TrajectoryBlock, DoctrineFoundation) |
| 3 | 1j | Refonte ContradictionsList et PropositionsList en D2 (source visible) |
| 4 | 2j | Réécriture `/brain/[persona]/+page.svelte` cockpit + responsive |
| 5 | 1j | Page `/persona/[id]/team` (V2 minimal — table + drawer) |
| 6 | 1j | Smoke test, fixes, polish, deploy preview, validation user |
| 7 | 1j | Merge prod + monitoring 24h |

**Total : 10 jours**, ship before 2026-05-14. Pages `/sources` et `/settings` couvertes par chips déjà spawned (parallel work).
