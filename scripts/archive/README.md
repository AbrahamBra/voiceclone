# scripts/archive/

Scripts one-off — déjà exécutés, liés à un incident clos, à une migration appliquée, ou à un persona supprimé. **Ne pas relancer sans avoir lu le code.** Conservés pour archive (git history) et reproductibilité d'investigation, mais hors du scope opérationnel courant.

Si tu veux re-runner un de ces scripts, vérifie d'abord :
1. Que la migration / le contexte n'a pas évolué depuis (regarde `git log` sur le fichier).
2. Qu'aucun script vivant dans `scripts/` ne fait déjà la même chose en mieux.

## Inventaire

### Bootstrap / migrations one-shot (déjà exécutés)
- `add-identity-section-existing-docs.js` — bootstrap de la section identity sur les docs existants (PR #225 scaffold).
- `apply-gold-ids.js` — apply IDs sur le dataset gold (eval).
- `apply-mig-069-backfill-source-channel.js` — backfill `corrections.source_channel` après migration 069.
- `bootstrap-protocol-doc-existing.js` — création initiale des `protocol_document` pour les personas pré-existants.
- `bootstrap-protocol-doc-mohamed.js` — bootstrap spécifique Mohamed (persona inactif).
- `migrate-to-supabase.js` — migration historique filesystem → Supabase (legacy, projet déjà entièrement sur Supabase).
- `restructure-protocol-v2-content.js` — restructure `personas.voice` → sections protocol v2 (one-shot deterministic).

### Backfills (appliqués, table à jour)
- `backfill-artifact-check-params.js` — backfill `params={}` sur les artefacts protocole.
- `backfill-feedback-bridge.js` — backfill du bridge `feedback_events` pré-existants.
- `backfill-nicolas-maturity.js` — set `maturity_level` sur le persona Nicolas.
- `backfill-scenario-type.js` — backfill `scenario_type` sur conversations existantes.

### Diagnostics post-incident (clos)
- `audit-three-personas-state.js` — état post-PR #219 sur Nicolas/Boni-yai/Mohamed (Boni-yai et Mohamed inactifs).
- `baseline-queries-pre-nicolas.js` — baseline avant onboarding Nicolas.
- `check-bridge-post-deploy.js` — split feedback_events pre/post-deploy `d2993a4` (incident bridging 7.1% confirmé legacy).
- `diag-boni-yai-orphan.js` — diag du persona orphelin Boni-yai (résolu).
- `diag-entity-boost.js` — diag d'une expérimentation entity_boost.
- `diag-feedback-validate.js` — diag handler `/api/feedback?type=validate` → learning_events.
- `diag-migration-056.js` — diag spécifique migration 056 (corrections_kind).
- `diag-nicolas-yo.js` — diag d'un message "yo" spécifique chez Nicolas.
- `drain-once-extended-lookback.js` — drain manuel one-shot avec lookback étendu.

### Cleanup / soft-delete one-shot (exécutés)
- `cleanup-personas-keep-nicolas.js` — purge des personas non-Nicolas (exécutée).
- `migrate-thomas-data.js` — migration Thomas (persona supprimé).
- `soft-delete-thomas-1.js` — soft-delete Thomas (exécuté).

### Seeds one-shot (faits une fois)
- `seed-nicolas-source-playbooks.js` — seed des 4 playbooks source-specific Nicolas depuis Notion.
- `seed-visite-profil-playbook.js` — seed playbook `visite_profil` (V1 vertical slice).
- `set-tutoiement-defaults.js` — set tutoiement par défaut (note : memory `feedback_protocol_extraction_linkedin_defaults` a depuis acté vouvoiement par défaut sur LinkedIn).

### Génération narrative spécifique
- `generate-narrative-immostates.js` — narrative Immostates (persona spécifique, voir `generate-narrative-all.js` pour usage générique).

### Smoke tests obsolètes
- `smoke-feedback-refactor.js` — smoke du refactor feedback (refactor mergé, smoke obsolète).

### Tests one-off
- `test-import-nicolas-process.js` — test du process d'import Nicolas (one-shot, l'import passe maintenant par `/api/v2/protocol/import-doc`).
