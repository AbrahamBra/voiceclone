# Chunk 2 Progress — Protocole vivant (Sprint 2 — Extractors + propositions queue)

**Plan source :** [2026-04-24-protocole-vivant-plan.md §Chunk 2](plans/2026-04-24-protocole-vivant-plan.md)
**Spec source :** [2026-04-24-protocole-vivant-design.md](specs/2026-04-24-protocole-vivant-design.md)
**Dernière mise à jour :** 2026-04-25

Ce doc est le **point de reprise** si tu changes de session. Pas besoin de rebrancher tout le plan — lis ce fichier.

## État (vague 1 livrée ✅)

| Task | Fichier principal | PR | Migration DB |
|---|---|---|---|
| 2.1 | `lib/protocol-v2-embeddings.js` + RPC `match_propositions` | [#81](https://github.com/AbrahamBra/voiceclone/pull/81) puis refactor Voyage [#82](https://github.com/AbrahamBra/voiceclone/pull/82) | **045** appliquée (vector 1024) |
| 2.2 | `lib/protocol-v2-extractors/hard_rules.js` | [#83](https://github.com/AbrahamBra/voiceclone/pull/83) | — |
| 2.6 | `api/v2/propositions.js` (single-file, `body.action`) | [#85](https://github.com/AbrahamBra/voiceclone/pull/85) | — |

**Décisions actées :**
- Embeddings via **Voyage-3 (1024 dims)**, pas OpenAI. Réutilise `VOYAGE_API_KEY` existante. Migration 045 a resizé `proposition.embedding` de 1536 → 1024.
- API propositions : **single-file dispatch** par `body.action` (pas de sous-routes), aligné sur `api/v2/protocol.js`.
- Sessions parallèles : chaque task = nouvelle worktree + nouvelle branche `feat/protocol-v2-*`. PR autonomes.
- Extracteurs : **pas de `lib/protocol-v2-extractors/index.js` pour l'instant** — sera créé par Task 2.5 (router).
- Migrations : 041-043 restent réservées paper-space aux follow-ups Chunk 2.5. Ne pas les consommer.

## Reste à faire

### Sous-vague 2a — parallélisable (5 sessions, greenfield)

Tous fichiers neufs dans `lib/protocol-v2-extractors/`. Mêmes guardrails que Task 2.2 (aucune session ne crée `index.js`, aucune ne touche `package.json`).

- **Session I — Task 2.3** `lib/protocol-v2-extractors/errors.js`
- **Session J — Task 2.4a** `lib/protocol-v2-extractors/patterns.js` (ICP)
- **Session K — Task 2.4b** `lib/protocol-v2-extractors/scoring.js`
- **Session L — Task 2.4c** `lib/protocol-v2-extractors/process.js`
- **Session M — Task 2.4d** `lib/protocol-v2-extractors/templates.js`

Référence pour le contrat d'interface et le style prompt : [lib/protocol-v2-extractors/hard_rules.js](../../lib/protocol-v2-extractors/hard_rules.js) (Task 2.2, mergée).

### Sous-vague 2b — séquentielle

- **Task 2.5** `lib/protocol-v2-extractor-router.js` + `lib/protocol-v2-extractors/index.js` — classifier signal → extracteur. Dépend des 6 extracteurs (2.2 + 2.3 + 2.4a-d).
- **Task 2.7** `scripts/feedback-event-to-proposition.js` — cron drain `feedback_events` → `proposition` avec bridge 2.5.11 (consume aussi `corrections` avec `source_channel IN ('copy_paste_out', 'regen_rejection', 'edit_diff', 'chat_correction')`). Dépend de 2.1 + 2.5.
- **Task 2.8** `api/v2/protocol/extract.js` — endpoint `POST save-prose` extraction inline 15s + kill-switch `PROTOCOL_V2_EXTRACTION`. Dépend de 2.5.
- **Task 2.9** tests E2E : correction chat → event → proposition pending → accept → artifact visible via API v2.

### Vérif finale du Chunk

Une correction chat produit une proposition pending visible via `GET /api/v2/propositions?document=<id>&status=pending`.

## Prompts pour la sous-vague 2a

Chaque session = nouvelle fenêtre Claude Code à la racine `C:\Users\abrah\AhmetA\`. Chacune copie le contrat structured de la section `protocol_section.kind` correspondante (voir spec §4 table "structured par kind"). Branch par session, PR autonome.

Structured schema rappel (spec §4) :
- `errors` → `{ pairs: [{ avoid, prefer }] }`
- `icp_patterns` → `{ patterns: [{ name, signals, question_clé }] }`
- `scoring` → `{ axes: [{ name, levels: [0..3] }], decision_table: [[score, action]] }`
- `process` → `{ steps: [{ id, name, prereqs, actions, outputs }] }`
- `templates` → `{ skeletons: [{ scenario, structure: [slots] }] }`

### Session I — Task 2.3 `errors.js`

```
Chunk 2 Task 2.3 du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/errors.js.

Contrat identique à hard_rules.js (Task 2.2, mergée PR #83) — lis-le comme modèle.

Input : { source_type, source_text, context }
Output : { intent, target_kind: 'errors', proposed_text, rationale, confidence } | null

Ce que cet extracteur capture (section "errors" = do/don't) :
- Des paires "avoid → prefer" : ce que le clone doit arrêter de dire ET ce qu'il doit dire à la place.
- Exemples : "n'écris jamais 'n'hésitez pas' → préfère 'dis-moi'" ;
  "évite 'parfait' en début de message → préfère rebondir sur du fond".

NE PAS capturer : règles testables programmatiquement (→ hard_rules), patterns ICP, étapes process.

intent ∈ {"add_paragraph", "amend_paragraph"} — "add_paragraph" pour nouvelle paire
avoid/prefer, "amend_paragraph" pour reformuler une paire existante.

proposed_text : prose française concise qui contient l'avoid ET le prefer
(ex: "Évite 'n'hésitez pas à me contacter' — préfère 'dis-moi si ça te parle'").

- Prompt Anthropic (claude-sonnet-4-6)
- parseJsonFromText + normalizeProposal exportée pure
- Tests node:test avec stub client dans test/protocol-v2-extractor-errors.test.js
- 6+ fixtures : paires claires, signaux de tonalité ambigus (→ null), validations ("c'est top" → null)
- NE PAS créer lib/protocol-v2-extractors/index.js (Task 2.5 le fera)
- NE PAS modifier package.json
- Branch: feat/protocol-v2-extractor-errors, PR autonome

Lis le spec docs/superpowers/specs/2026-04-24-protocole-vivant-design.md §4 table structured
(pairs: [{ avoid, prefer }]).
```

### Session J — Task 2.4a `patterns.js`

```
Chunk 2 Task 2.4a du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/patterns.js.

Contrat identique à hard_rules.js (Task 2.2, mergée PR #83) — lis-le comme modèle.

Input : { source_type, source_text, context }
Output : { intent, target_kind: 'icp_patterns', proposed_text, rationale, confidence } | null

Ce que cet extracteur capture (section "icp_patterns" = taxonomie des profils prospects) :
- Des patterns ICP nommés avec leurs signaux et la question-clé qui les qualifie.
- Exemples : "Pattern: fondateur SaaS B2B seed — signaux: 10-30 employés, annonce levée, CEO linkedin actif — question-clé: 'tu gères toi-même ta prospection ou tu as un SDR ?'".

NE PAS capturer : règles d'écriture (→ errors/hard_rules), axes de scoring (→ scoring).

intent ∈ {"add_paragraph", "amend_paragraph", "refine_pattern"}.

proposed_text : prose descriptive d'un pattern (nom + signaux + question-clé), concise.

- Prompt Anthropic (claude-sonnet-4-6)
- parseJsonFromText + normalizeProposal exportée pure
- Tests node:test dans test/protocol-v2-extractor-patterns.test.js
- 6+ fixtures : pattern clairement nommé, pattern implicite à nommer, noise générique (→ null)
- NE PAS créer lib/protocol-v2-extractors/index.js
- NE PAS modifier package.json
- Branch: feat/protocol-v2-extractor-patterns, PR autonome

Lis le spec §4 : structured = { patterns: [{ name, signals, question_clé }] }.
```

### Session K — Task 2.4b `scoring.js`

```
Chunk 2 Task 2.4b du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/scoring.js.

Contrat identique à hard_rules.js (Task 2.2, mergée PR #83) — lis-le comme modèle.

Input : { source_type, source_text, context }
Output : { intent, target_kind: 'scoring', proposed_text, rationale, confidence } | null

Ce que cet extracteur capture (section "scoring" = moteur de score prospect) :
- Des axes de scoring avec leurs niveaux 0-3, et/ou des lignes de decision table "score → action".
- Exemples : "Ajouter un axe 'urgence perçue' — 0: aucun signal, 1: vague, 2: mentionne un
  deadline, 3: délai < 30 jours" ; "Si score global ≥ 7 → envoyer DM direct sans qualifier".

NE PAS capturer : règles d'écriture, patterns ICP (→ patterns), étapes process.

intent ∈ {"add_paragraph", "amend_paragraph"}.

proposed_text : prose décrivant soit un axe (nom + 4 niveaux), soit une règle de décision
basée sur le score. Format FR prose, pas JSON.

- Prompt Anthropic (claude-sonnet-4-6)
- parseJsonFromText + normalizeProposal exportée pure
- Tests node:test dans test/protocol-v2-extractor-scoring.test.js
- 6+ fixtures : axe proposé explicitement, seuil chiffré dans un signal, noise (→ null)
- NE PAS créer lib/protocol-v2-extractors/index.js
- NE PAS modifier package.json
- Branch: feat/protocol-v2-extractor-scoring, PR autonome

Lis le spec §4 : structured = { axes: [{ name, levels: [0..3] }], decision_table: [[score, action]] }.
```

### Session L — Task 2.4c `process.js`

```
Chunk 2 Task 2.4c du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/process.js.

Contrat identique à hard_rules.js (Task 2.2, mergée PR #83) — lis-le comme modèle.

Input : { source_type, source_text, context }
Output : { intent, target_kind: 'process', proposed_text, rationale, confidence } | null

Ce que cet extracteur capture (section "process" = state machine du setting) :
- Des étapes du process commercial avec prérequis, actions, outputs.
- Transitions d'état : quand passer d'une étape à l'autre.
- Exemples : "Étape 'qualification' : prérequis = première réponse, actions = poser 2
  questions métier max, output = lead scoré 0-3" ; "Ne pas passer à 'pitch' tant que
  le prospect n'a pas confirmé son pain point".

NE PAS capturer : règles d'écriture, axes de scoring (→ scoring), templates (→ templates).

intent ∈ {"add_paragraph", "amend_paragraph"}.

proposed_text : prose FR concise décrivant une étape (avec id mnémotechnique) ou une
transition.

- Prompt Anthropic (claude-sonnet-4-6)
- parseJsonFromText + normalizeProposal exportée pure
- Tests node:test dans test/protocol-v2-extractor-process.test.js
- 6+ fixtures : étape explicite, transition conditionnelle, noise générique (→ null)
- NE PAS créer lib/protocol-v2-extractors/index.js
- NE PAS modifier package.json
- Branch: feat/protocol-v2-extractor-process, PR autonome

Lis le spec §4 : structured = { steps: [{ id, name, prereqs, actions, outputs }] }.
```

### Session M — Task 2.4d `templates.js`

```
Chunk 2 Task 2.4d du plan docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md :
crée lib/protocol-v2-extractors/templates.js.

Contrat identique à hard_rules.js (Task 2.2, mergée PR #83) — lis-le comme modèle.

Input : { source_type, source_text, context }
Output : { intent, target_kind: 'templates', proposed_text, rationale, confidence } | null

Ce que cet extracteur capture (section "templates" = skeletons de messages) :
- Des structures de message par scénario : open, relance, closing, objection-handling.
- Définis par des slots ordonnés (ouverture / hook / question / call-to-action...).
- Exemples : "Template 'premier DM cold' : slot1=mention signal concret observé, slot2=
  question ouverte sur leur process, slot3=pas de pitch en premier DM" ; "Template
  'relance J+3' : référer au signal cité au DM1, reposer la question sans pression".

NE PAS capturer : hard rules de format (→ hard_rules : "max 8 lignes"), paires do/don't (→ errors).

intent ∈ {"add_paragraph", "amend_paragraph"}.

proposed_text : prose décrivant un skeleton avec scenario nommé et structure des slots.

- Prompt Anthropic (claude-sonnet-4-6)
- parseJsonFromText + normalizeProposal exportée pure
- Tests node:test dans test/protocol-v2-extractor-templates.test.js
- 6+ fixtures : skeleton complet, slot partiel sur template existant, règle de format isolée (→ null, renvoie à hard_rules)
- NE PAS créer lib/protocol-v2-extractors/index.js
- NE PAS modifier package.json
- Branch: feat/protocol-v2-extractor-templates, PR autonome

Lis le spec §4 : structured = { skeletons: [{ scenario, structure: [slots] }] }.
```

## Règles communes à toutes les sessions parallèles

1. **Une worktree par session** (`C:\Users\abrah\AhmetA\.claude\worktrees\<nom>`).
2. **Une branche par session** (`feat/protocol-v2-extractor-<kind>`).
3. **Base off `origin/master` à jour** au moment où la session démarre.
4. **Jamais toucher `package.json`** — dépendances déjà en place (`@anthropic-ai/sdk`).
5. **Jamais créer `lib/protocol-v2-extractors/index.js`** — Task 2.5 s'en charge.
6. **PR autonome** avec titre `feat(protocol-v2): Chunk 2 Task 2.X — extractor <kind>`.
7. **Tests node:test** au standard `test/protocol-v2-extractor-<kind>.test.js` avec stub du client Anthropic.
8. **Modèle** : `claude-sonnet-4-6` (même choix que Task 2.2).
9. **Timeout** : 15 000 ms (même choix que Task 2.2).
10. **Retry** : 1× sur parse fail uniquement (pas sur timeout/réseau).
