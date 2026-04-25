# Chunk 2 Progress — Protocole vivant (Sprint 2 — Extractors + propositions queue)

**Plan source :** [2026-04-24-protocole-vivant-plan.md §Chunk 2](plans/2026-04-24-protocole-vivant-plan.md)
**Spec source :** [2026-04-24-protocole-vivant-design.md](specs/2026-04-24-protocole-vivant-design.md)
**Dernière mise à jour :** 2026-04-25

> **Point de reprise.** Si tu changes de session (ou d'agent LLM), lis juste ce fichier — pas besoin de relire le plan complet. Tous les prompts copy-paste pour les tâches restantes sont en bas.

## État livré ✅

### Vague 1 (extractors socle + plumbing)

| Task | Fichier principal | PR | Migration DB |
|---|---|---|---|
| 2.1 | `lib/protocol-v2-embeddings.js` + RPC `match_propositions` | [#81](https://github.com/AbrahamBra/voiceclone/pull/81) puis refactor Voyage [#82](https://github.com/AbrahamBra/voiceclone/pull/82) | **045** appliquée (vector 1024) |
| 2.2 | `lib/protocol-v2-extractors/hard_rules.js` | [#83](https://github.com/AbrahamBra/voiceclone/pull/83) | — |
| 2.6 | `api/v2/propositions.js` (single-file, `body.action`) | [#85](https://github.com/AbrahamBra/voiceclone/pull/85) | — |

### Sous-vague 2a (extractors par target_kind)

| Task | Fichier | PR |
|---|---|---|
| 2.3 | `lib/protocol-v2-extractors/errors.js` | [#88](https://github.com/AbrahamBra/voiceclone/pull/88) |
| 2.4a | `lib/protocol-v2-extractors/patterns.js` | [#90](https://github.com/AbrahamBra/voiceclone/pull/90) |
| 2.4b | `lib/protocol-v2-extractors/scoring.js` | [#89](https://github.com/AbrahamBra/voiceclone/pull/89) |
| 2.4c | `lib/protocol-v2-extractors/process.js` | [#91](https://github.com/AbrahamBra/voiceclone/pull/91) |
| 2.4d | `lib/protocol-v2-extractors/templates.js` | **TODO** — prompt ci-dessous |

**Décisions actées (à respecter pour la suite) :**
- Embeddings via **Voyage-3 (1024 dims)**, pas OpenAI. `VOYAGE_API_KEY` déjà configurée.
- API propositions : **single-file dispatch** par `body.action`, aligné sur `api/v2/protocol.js`.
- Sessions parallèles : chaque task = nouvelle worktree + nouvelle branche `feat/protocol-v2-*`. PRs autonomes mergées en squash.
- Extracteurs : **pas de `lib/protocol-v2-extractors/index.js`** tant que Task 2.5 n'est pas faite.
- Migrations : 041-043 réservées paper-space aux follow-ups Chunk 2.5 (`rule_proposals`, `n4_paused`, `promoted_rule_index`). 044 supersédée par 045. Prochaine libre : **046**.
- Modèle Anthropic pour tous les extracteurs : `claude-sonnet-4-6`.
- Tous les extracteurs suivent le même contrat : `(signal, opts?)` → `{ intent, target_kind, proposed_text, rationale, confidence } | null`. Modèle de référence : [`lib/protocol-v2-extractors/hard_rules.js`](../../lib/protocol-v2-extractors/hard_rules.js).

## Reste à faire

### Sous-vague 2a (1 dernière)
- **Task 2.4d** `templates.js` (prompt ci-dessous, paragraphe "Session M")

### Sous-vague 2b — séquentiel (dépend de 2a complète)
- **Task 2.5** `lib/protocol-v2-extractor-router.js` + `lib/protocol-v2-extractors/index.js`
- **Task 2.7** `scripts/feedback-event-to-proposition.js` (cron drain events → propositions)
- **Task 2.8** `api/v2/protocol/extract.js` (endpoint save-prose extraction inline 15s)
- **Task 2.9** tests E2E

### Vérif finale du Chunk
Une correction chat produit une proposition pending visible via `GET /api/v2/propositions?document=<id>&status=pending`.

---

## Prompts copy-paste pour les sessions suivantes

> Chaque session = nouvelle fenêtre Claude Code à la racine `C:\Users\abrah\AhmetA\`. Une worktree, une branche, une PR. Je commit + push + merge en autonome (autorisé par mémoire).

### Session M — Task 2.4d `templates.js`

```
Chunk 2 Task 2.4d du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/templates.js.

Contrat identique à hard_rules.js / errors.js / patterns.js / scoring.js / process.js
(toutes mergées sur master) — lis-en au moins un comme modèle.

Input : { source_type, source_text, context }
Output : { intent, target_kind: 'templates', proposed_text, rationale, confidence } | null

Ce que cet extracteur capture (section "templates" = skeletons de messages) :
- Des structures de message par scénario : open, relance, closing, objection-handling.
- Définies par des slots ordonnés (ouverture / hook / question / call-to-action...).
- Exemples : "Template 'premier DM cold' : slot1=mention signal concret observé, slot2=question ouverte sur leur process, slot3=pas de pitch en premier DM" ; "Template 'relance J+3' : référer au signal cité au DM1, reposer la question sans pression".

NE PAS capturer :
- Hard rules de format ("max 8 lignes", "jamais > 2 questions") → null, route vers hard_rules
- Paires do/don't → null, route vers errors
- Patterns ICP → null, route vers patterns
- Étapes d'un process commercial global → null, route vers process

intent ∈ {"add_paragraph", "amend_paragraph"}.

proposed_text : prose décrivant un skeleton avec scenario nommé et structure ordonnée des slots.

- Anthropic SDK, claude-sonnet-4-6, 15s timeout, 1× retry sur parse fail
- parseJsonFromText + normalizeProposal exportée pure
- Tests node:test avec stub client dans test/protocol-v2-extractor-templates.test.js (vise 18-22 tests)
- 6+ fixtures : skeleton complet, slot partiel sur template existant, règle de format isolée (→ null), paire do/don't (→ null), pattern ICP (→ null), validation noise (→ null), parse-fail retry, parse-fail exhaustion
- NE PAS créer lib/protocol-v2-extractors/index.js (Task 2.5 le fera)
- NE PAS modifier package.json
- Branch: feat/protocol-v2-extractor-templates, PR autonome

Spec §4 : structured = { skeletons: [{ scenario, structure: [slots] }] }.
```

### Session N — Task 2.5 `extractor-router.js` + `index.js`

> **Pré-requis** : Task 2.4d (templates.js) doit être mergée. Vérifier que les 6 extracteurs sont sur master :
> `ls lib/protocol-v2-extractors/` doit montrer `errors.js hard_rules.js patterns.js process.js scoring.js templates.js`

```
Chunk 2 Task 2.5 du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/index.js + lib/protocol-v2-extractor-router.js.

Pré-requis : les 6 extracteurs (hard_rules, errors, patterns, scoring, process, templates) doivent exister sur master. Vérifier d'abord.

## Fichier 1 : lib/protocol-v2-extractors/index.js

Re-export les 6 extracteurs et leurs prompts pour permettre l'import unique :
- export { extractHardRule, normalizeProposal as normalizeHardRule, HARD_RULES_SYSTEM_PROMPT } from './hard_rules.js'
- ... idem pour errors, patterns, scoring, process, templates
- export const EXTRACTORS = { hard_rules: extractHardRule, errors: extractError, icp_patterns: extractPattern, scoring: extractScoring, process: extractProcess, templates: extractTemplate }
  (vérifie les noms exacts dans chaque fichier — peut être 'extractError' ou 'extractErrors', etc.)
- export const TARGET_KINDS = ['hard_rules', 'errors', 'icp_patterns', 'scoring', 'process', 'templates']

## Fichier 2 : lib/protocol-v2-extractor-router.js

Classifier qui prend un signal et décide quel extracteur appeler. Deux modes :
1. Statique : si signal.source_type ∈ certaines valeurs → un seul extracteur (ex: 'rule_saved' → hard_rules direct).
2. LLM-light : sinon, un appel claude-haiku-4-6 (modèle léger, ≤500 tokens, ≤2s timeout) avec un prompt court qui retourne juste {target_kind} ou {target_kinds: [...]} si plusieurs.

Output de routeSignal(signal) :
  Promise<Array<{target_kind, confidence}>>  — peut renvoyer 0, 1, ou 2 target_kinds (un signal peut alimenter plusieurs sections, ex: une correction "max 2 questions et utilise 'dis-moi' au lieu de 'n'hésitez pas'" → hard_rules + errors).

Puis runExtractors(signal, routes, opts) appelle les extracteurs en parallèle (Promise.all) et retourne {target_kind, proposal}[].

- Tests node:test dans test/protocol-v2-extractor-router.test.js (vise 12-15 tests)
- Stubs : factor pour passer extractors mockés via opts.extractors
- Cas : signal hard_rules-only, signal multi-target, signal validation (→ []), signal vide (→ []), router LLM timeout (→ fallback statique ou [])
- Branch: feat/protocol-v2-extractor-router, PR autonome
- NE PAS modifier package.json
```

### Session O — Task 2.7 `feedback-event-to-proposition.js` (cron)

> **Pré-requis** : Task 2.5 (router) mergée + Task 2.1 (embeddings) mergée (déjà fait).

```
Chunk 2 Task 2.7 du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée scripts/feedback-event-to-proposition.js.

Cron qui drain feedback_events → proposition. Tourne périodiquement (Vercel cron 5 min ou similaire).

Logique :
1. Lire les feedback_events non traités (ajouter colonne `drained_at TIMESTAMPTZ` via migration 046 — voir Task 2.7.0 ci-dessous) depuis lookback de 30 min, ordonnés par created_at ASC.
2. Pour chaque event, construire le signal { source_type, source_text, context } à partir de event.payload + contexte conversation.
3. Bridge 2.5.11 : consommer aussi les `corrections` avec source_channel IN ('copy_paste_out', 'regen_rejection', 'edit_diff', 'chat_correction', 'client_validated', 'negative_feedback', 'direct_instruction', 'coaching_correction') où promoted_to_rule_index IS NULL.
4. Router via lib/protocol-v2-extractor-router.js (Task 2.5).
5. Pour chaque {target_kind, proposal} : embed proposed_text via lib/protocol-v2-embeddings.js → findSimilarProposition() pour le doc actif.
   - Si match similarity ≥ 0.85 : MERGE — append source_ref à source_refs, count++.
   - Sinon : INSERT nouvelle proposition avec embedding stocké.
6. Filtre bruit final avant insert : confidence ≥ 0.75 OR count_after ≥ 2.
7. Mark event.drained_at = now() et corrections.promoted_to_rule_index = -1 (sentinel "drained, not yet promoted") pour ne pas re-traiter.

## Task 2.7.0 — petite migration 046

supabase/046_feedback_events_drained.sql :
- ALTER TABLE feedback_events ADD COLUMN IF NOT EXISTS drained_at TIMESTAMPTZ;
- INDEX partiel ON feedback_events(created_at) WHERE drained_at IS NULL;

## Tests

scripts/feedback-event-to-proposition.test.js (run via node --test) :
- Stub Supabase client (pattern de api/v2/protocol.js)
- Stub router (renvoie {target_kind: 'hard_rules', confidence: 0.9})
- Stub embeddings (embedForProposition + findSimilarProposition)
- Cas : single new event → 1 insert ; event match similarité existante → merge count ; event extractable:false → 0 insert + drained ; confidence < 0.75 et count=1 → silenced (insert mais pas remonté) ; corrections via bridge ; idempotence (rerun ne re-traite pas)

- Branch: feat/protocol-v2-cron-events-to-propositions, PR autonome
- NE PAS modifier package.json
- À lancer en local avec node scripts/feedback-event-to-proposition.js (Vercel cron config = follow-up)
```

### Session P — Task 2.8 `api/v2/protocol/extract.js`

> **Pré-requis** : Task 2.5 (router) mergée.

```
Chunk 2 Task 2.8 du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée api/v2/protocol/extract.js.

Endpoint POST save-prose-and-extract — l'utilisateur édite la prose d'une section dans l'UI Doctrine (Chunk 3), on save + on lance les extracteurs synchronement pendant un spinner (3-15s).

Body : { section_id: uuid, prose: string, document_id: uuid }
Réponse : { saved: true, candidates: [{ target_kind, kind, proposed_text, confidence, ... }] }

Logique :
1. Auth (authenticateRequest + hasPersonaAccess via document → owner_id, comme api/v2/protocol.js).
2. UPDATE protocol_section SET prose = $prose WHERE id = $section_id (avec assertion que la section appartient bien au document).
3. Kill-switch : si process.env.PROTOCOL_V2_EXTRACTION === 'off' → renvoyer { saved: true, candidates: [] }.
4. Construire un signal { source_type: 'prose_edit', source_text: prose, context: { section_kind, ... } }.
5. Router → liste de target_kinds (Task 2.5).
6. Promise.all les extracteurs avec un timeout global de 12s (laisse 3s de marge sur les 15s de maxDuration).
7. Pour chaque candidat retourné : embed + findSimilar — mais NE PAS encore insérer (laisser le user voir le diff dans l'UI Chunk 3 et confirmer). Renvoyer juste les candidats au front.
8. maxDuration = 15.

## Tests

test/api-v2-protocol-extract.test.js :
- Stub deps (authenticateRequest, supabase, hasPersonaAccess, router, extractors, embeddings)
- Cas : prose édit avec extractors qui répondent → renvoie candidates ; kill-switch ON → renvoie [] sans appeler extractors ; timeout 12s déclenche partial response ; section pas dans le document → 403 ; auth fail → 401.

- Branch: feat/protocol-v2-extract-endpoint, PR autonome
- NE PAS modifier package.json
```

### Session Q — Task 2.9 tests E2E

> **Pré-requis** : Tasks 2.7 et 2.8 mergées.

```
Chunk 2 Task 2.9 du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée test/protocol-v2-e2e.test.js.

Test bout-en-bout du flow : correction chat → feedback_event → cron drain → proposition pending → accept via API v2.6 → vérifier section.prose mise à jour.

Le test peut tourner contre un Supabase preview (env SUPABASE_TEST_URL + KEY) ou être skipped si l'env n'est pas set. Ne PAS tourner contre prod.

Étapes :
1. SETUP : créer un persona test, un protocol_document, des sections.
2. Insérer un feedback_event qui simule une correction "ne dépasse pas 2 questions par message".
3. Run scripts/feedback-event-to-proposition.js manuellement (importer la fonction main).
4. ASSERT : une proposition pending existe dans `proposition` avec target_kind='hard_rules', confidence ≥ 0.75.
5. Call POST /api/v2/propositions { action:'accept', id:<prop.id> } via supertest ou fetch local.
6. ASSERT : la section.prose contient maintenant le proposed_text appended.
7. TEARDOWN : delete persona test (CASCADE).

Skip gracefully si SUPABASE_TEST_URL absent (ne fail pas la CI).

- Branch: feat/protocol-v2-e2e-test, PR autonome
- NE PAS modifier package.json sauf pour ajouter `node:test` watch script si nécessaire (à éviter)
```

---

## Règles communes (toutes sessions)

1. **Worktree dédiée** par session (`C:\Users\abrah\AhmetA\.claude\worktrees\<nom>`).
2. **Branche dédiée** : `feat/protocol-v2-<task-id>` ou `docs/protocol-v2-<topic>`.
3. **Base off `origin/master` à jour** au moment où la session démarre. Toujours `git fetch origin master` puis `git checkout -b <branch> origin/master`.
4. **Jamais toucher `package.json`** — toutes les deps sont en place (`@anthropic-ai/sdk`, `@supabase/supabase-js`, `dotenv`).
5. **Tests node:test** avec stubs (jamais de vraies API calls dans les tests).
6. **Modèle Anthropic** : `claude-sonnet-4-6` pour les extracteurs ; `claude-haiku-4-6` ok pour le router classifier léger.
7. **Timeouts** : 15 000 ms pour extracteurs, 2 000 ms pour router classifier.
8. **PR autonomes** avec titre `feat(protocol-v2): Chunk 2 Task 2.X — <résumé>`.
9. **Migration numbering** : prochaine libre = 046. 041-043 sont réservées paper-space.
10. **Verif côté DB** : si une migration tourne en prod, demander à l'humain de la coller dans Supabase SQL Editor (les migrations dans `supabase/` ne sont pas auto-appliquées).

## Réf : table `protocol_section.kind` (spec §4)

| kind | structured shape (compilé à l'accept, pas à l'extraction) |
|---|---|
| `identity` | — (prose-only) |
| `icp_patterns` | `{ patterns: [{ name, signals, question_clé }] }` |
| `scoring` | `{ axes: [{ name, levels: [0..3] }], decision_table: [[score, action]] }` |
| `process` | `{ steps: [{ id, name, prereqs, actions, outputs }] }` |
| `templates` | `{ skeletons: [{ scenario, structure: [slots] }] }` |
| `hard_rules` | `[{ rule_text, check_kind, check_params }]` |
| `errors` | `{ pairs: [{ avoid, prefer }] }` |
| `custom` | libre |

## Réf : `proposition` schema (migration 038, embedding redim 045)

```
id uuid PK
document_id uuid FK
source text CHECK (source IN ('feedback_event','learning_event','chat_rewrite','manual','client_validation','agency_supervision','upload_batch','analytics_cron'))
source_ref uuid          -- canonical first event
source_refs uuid[]       -- all contributing events
count int                -- = source_refs.length
intent text CHECK (...)
target_kind text CHECK (...)
target_section_id uuid?
proposed_text text
rationale text
confidence numeric(3,2)
embedding vector(1024)   -- voyage-3
status text CHECK (IN 'pending','accepted','rejected','revised','merged')
user_note text
created_at timestamptz
resolved_at timestamptz
```

RPC dispo : `match_propositions(match_document_id, match_target_kind, query_embedding, match_threshold, match_count)` → top-K pending propositions ranked by cosine similarity.
