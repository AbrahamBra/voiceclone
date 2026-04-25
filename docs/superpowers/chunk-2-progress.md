# Chunk 2 — CLOSED ✅

**Plan source :** [2026-04-24-protocole-vivant-plan.md §Chunk 2](plans/2026-04-24-protocole-vivant-plan.md)
**Spec source :** [2026-04-24-protocole-vivant-design.md](specs/2026-04-24-protocole-vivant-design.md)
**Fermé le :** 2026-04-25

> **Sprint 2 — Extractors + propositions queue : terminé.**
> Toutes les tâches 2.1 → 2.9 mergées sur master. 214 tests passent, 0 régression.
> La boucle d'apprentissage est désormais fonctionnelle bout-en-bout en local
> (cron + endpoints + dédup), prête à être exposée par l'UI Chunk 3.

## Tableau de bord final

| Task | Livrable | PR | État |
|---|---|---|---|
| 2.1 | `lib/protocol-v2-embeddings.js` + RPC `match_propositions` | [#81](https://github.com/AbrahamBra/voiceclone/pull/81) → refactor Voyage [#82](https://github.com/AbrahamBra/voiceclone/pull/82) | ✅ |
| 2.2 | `lib/protocol-v2-extractors/hard_rules.js` | [#83](https://github.com/AbrahamBra/voiceclone/pull/83) | ✅ |
| 2.3 | `lib/protocol-v2-extractors/errors.js` | [#88](https://github.com/AbrahamBra/voiceclone/pull/88) | ✅ |
| 2.4a | `lib/protocol-v2-extractors/patterns.js` | [#90](https://github.com/AbrahamBra/voiceclone/pull/90) | ✅ |
| 2.4b | `lib/protocol-v2-extractors/scoring.js` | [#89](https://github.com/AbrahamBra/voiceclone/pull/89) | ✅ |
| 2.4c | `lib/protocol-v2-extractors/process.js` | [#91](https://github.com/AbrahamBra/voiceclone/pull/91) | ✅ |
| 2.4d | `lib/protocol-v2-extractors/templates.js` | [#93](https://github.com/AbrahamBra/voiceclone/pull/93) | ✅ |
| 2.5 | `lib/protocol-v2-extractor-router.js` + `lib/protocol-v2-extractors/index.js` | [#94](https://github.com/AbrahamBra/voiceclone/pull/94) | ✅ |
| 2.6 | `api/v2/propositions.js` (CRUD) | [#85](https://github.com/AbrahamBra/voiceclone/pull/85) | ✅ |
| 2.7 | `scripts/feedback-event-to-proposition.js` (cron) + migration 046 | [#95](https://github.com/AbrahamBra/voiceclone/pull/95) | ✅ |
| 2.8 | `api/v2/protocol/extract.js` (save-prose-and-extract) | [#96](https://github.com/AbrahamBra/voiceclone/pull/96) | ✅ |
| 2.9 | `test/protocol-v2-e2e.test.js` (wiring + live scaffold) | [#97](https://github.com/AbrahamBra/voiceclone/pull/97) | ✅ |

**Migrations DB appliquées :** 045 (proposition.embedding → vector(1024)).
**Migrations DB à appliquer en prod :** 046 (`feedback_events.drained_at` + index partiel) — SQL prêt, voir doc PR #95.

## Décisions actées (référence pour Chunk 3+)

- Embeddings via **Voyage-3 (1024 dims)**. `VOYAGE_API_KEY` configurée. Pas de dépendance OpenAI.
- API propositions : single-file dispatch par `body.action`, aligné sur `api/v2/protocol.js`.
- Modèle Anthropic : `claude-sonnet-4-6` pour les extracteurs, `claude-haiku-4-6` pour le router classifier léger.
- Timeouts : 15 000 ms extracteurs, 2 000 ms router, 12 000 ms extraction inline (dans 15 000 ms maxDuration endpoint).
- Threshold dédup : `SEMANTIC_DEDUP_THRESHOLD = 0.85` (cosine 1 - distance).
- Filtre bruit insert : `confidence ≥ 0.75` OU merge dans une prop existante.
- Migrations 041-043 restent réservées paper-space aux follow-ups Chunk 2.5. 044 supersédée par 045. 046 utilisé. Prochaine libre : **047**.
- `lib/protocol-v2-extractors/index.js` exporte la map `EXTRACTORS` keyed par `target_kind` (`icp_patterns` map vers `extractPattern`). `TARGET_KINDS = ['hard_rules','errors','icp_patterns','scoring','process','templates']`.

## Ce qui n'est PAS dans Chunk 2 (follow-ups identifiés)

- **Bridge corrections → cron (Task 2.5.11)** — le cron 2.7 ne consomme que `feedback_events`. Pour absorber aussi les `corrections` avec `source_channel IN ('copy_paste_out', 'regen_rejection', ...)`, il faut décider d'une colonne d'idempotence (probablement `corrections.proposition_drained_at TIMESTAMPTZ`, séparée de la `promoted_to_rule_index` réservée). À planifier.
- **UI Doctrine + Registre (Chunk 3)** — `ProtocolDoctrine.svelte`, `ProtocolArtifactAccordion.svelte`, `ProtocolRegistry.svelte`, `ProtocolSectionEditor.svelte`, SSE stream. C'est la surface user-facing du protocole vivant.
- **Acceptance flow (Task 4.3)** — quand un utilisateur accepte une proposition via `POST /api/v2/propositions { action: 'accept' }`, le code actuel ne fait que mettre à jour `status`. Task 4.3 ajoutera le patch automatique de `protocol_section.prose` + l'émission d'un `extractor_training_example` (corpus d'auto-amélioration).
- **Live E2E test** — `test/protocol-v2-e2e.test.js` contient un placeholder gated sur `SUPABASE_TEST_URL`. À implémenter quand une DB de test sera provisionnée.
- **Vercel cron config** — le cron `scripts/feedback-event-to-proposition.js` tourne en local mais n'est pas encore wiré dans `vercel.json`. À ajouter quand le flow sera testé en preview.

## Comment tourner le cron en local (smoke test)

Avec `.env.local` qui contient `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY` :

```bash
node scripts/feedback-event-to-proposition.js --dry-run --limit 5
```

Affiche le summary `{ processed, merged, inserted, silenced, skipped, results }`. `--dry-run` empêche les inserts/updates DB.

## Ce qu'a livré le Chunk 2 en une phrase

> Une correction posée dans le chat alimente automatiquement la queue d'apprentissage du protocole : routée vers le bon extracteur, dédupliquée sémantiquement, et exposée via API pour validation utilisateur.

C'est la première fois que la boucle d'apprentissage tourne sans copy-paste manuel. Le différenciateur "protocole vivant" est désormais ancré côté backend.

---

## Pour reprendre sur Chunk 3+

Pas de prompts copy-paste ici — Chunk 3 (UI Doctrine + Registre) est une autre dimension. Voir le plan source :
- [Chunk 3](plans/2026-04-24-protocole-vivant-plan.md) — Sprint 3 (UI Doctrine + Registre)
- [Chunk 4](plans/2026-04-24-protocole-vivant-plan.md) — Sprint 4 (Acceptance flow + training examples)
- [Chunk 5](plans/2026-04-24-protocole-vivant-plan.md) — Sprint 5 (auto-amélioration extracteurs)
- [Chunk 6](plans/2026-04-24-protocole-vivant-plan.md) — Sprint 6 (templates agence + supervision client)
