# Plan sessions parallèles — roadmap "1er vrai client sans fuite"

**Date :** 2026-04-25 18:45 GMT+2
**Source :** session sad-shockley-97a39a (audit roadmap protocol-v2 + sprint 5 réduit + Review Deck)
**Objectif :** mettre 1er vrai client (cas Nicolas Lavallée du spec) en conditions réelles sans risque de fuite (data, signal, regression, ops, confidentialité)

---

## État courant par item (2026-04-25 18:45)

| # | Item | État | Branches/PRs concernées |
|---|---|---|---|
| 1 | Finir chunk 4 (versioning + propositions arbitrables) | Versioning lib **mergé** via PR #114 ; **PR #116 publish endpoint fermée sans merge** ; **PR #117 E2E versioning fermée sans merge** — investiguer raison avant relance | feat/protocol-v2-publish-endpoint, feat/protocol-v2-versioning-e2e |
| 2 | Câbler `PROTOCOL_V2_GENERATION` | Non fait — kill switch documenté ligne 426 du spec, jamais câblé | — |
| 3 | Audit RLS v2 + enforcement API | **Partiel via PR #120** : IDOR feedback_events fixé, share tokens masqués dans logs. RLS sur tables protocol_v2 (`protocol_document`, `protocol_section`, `protocol_artifact`, `proposition`) **non fait** | PR #120 ouverte |
| 4 | Sprint 5 réduit — hooks isolation client | Data ✓ (migration 039 ajoute `client_share_token`, `client_user_id`, `user.role`). **Enforcement API absent** | — |
| 5 | Review Deck v0 mécanique | Rien | — |
| 6 | Test E2E bout-en-bout sur Preview | Wiring smoke ✓ ([test/protocol-v2-e2e.test.js](../../../test/protocol-v2-e2e.test.js)). **Flow réel jamais exercé** | — |
| 7 | Doc opérateur 1-pager | Rien | — |

---

## Conflits de fichiers

| Fichier | Modifié par | Risque |
|---|---|---|
| `api/chat.js` | PR #120 (en cours) + item 2 | Attendre merge #120 avant item 2 |
| `api/v2/protocol/*` | items 3 + 4 | Sequential préférable, ou coordination |
| `api/feedback-events.js`, `api/share.js` | PR #120 | Hands off jusqu'à merge |
| `lib/correction-consolidation.js` | "recency fix" inexistant (cf. note PR #120) | Skip — substrat manque |

---

## Vagues recommandées

### Vague 1 — démarrer MAINTENANT (zéro conflit, indépendantes)

#### Session A — Reprendre chunk 4 (publish + E2E versioning)

**Branche :** `feat/protocol-v2-chunk4-resume` (nouveau worktree)

**Première étape obligatoire :** investiguer pourquoi PR #116 et #117 ont été fermées. Commande :
```bash
gh pr view 116 --comments
gh pr view 117 --comments
```
Si rejetées par review → comprendre les commentaires avant de réécrire.
Si superseded → trouver la PR qui les remplace.
Si abandonnées → reprendre la matière des branches `feat/protocol-v2-publish-endpoint` et `feat/protocol-v2-versioning-e2e` dans une seule PR finale.

**Fichiers principaux à toucher :**
- `api/v2/protocol/publish.js` (atomic switch draft → active)
- `lib/protocol-v2-versioning.js` (helpers déjà mergés via #114)
- `test/protocol-v2-e2e.test.js` (étendre pour couvrir publish flow)
- `src/lib/components/protocol/PropositionsQueue.svelte` (ajustements UI éventuels)

**Verif chunk :** publier une v2 préserve les stats des artifacts inchangés (content_hash), nouvel artifact a stats=0.

**Effort :** 4-6h.

---

#### Session B — Review Deck v0 mécanique

**Branche :** `feat/review-deck-v0` (nouveau worktree)

**Scope strict (mécanique, pas LLM) :**
- Endpoint `GET /api/v2/review-deck?persona_id=X`
- Renvoie JSON :
  ```
  {
    persona: { name, version_active },
    sections: [{ kind, heading, prose }],
    top_artifacts: [{ kind, content, fires_7d }, ...5 max],
    recent_propositions: [{ intent, proposed_text, status, count, resolved_at }, ...10 max]
  }
  ```
- Composant Svelte `src/lib/components/ReviewDeck.svelte` qui formate ça en livrable lisible (Markdown style)
- Bouton "Exporter Review Deck" depuis page Protocole

**Aucun appel LLM, juste assembly DB.**

**Verif :** sur persona seedée Nicolas, le deck affiche §identity + scoring + top 5 hard_rules tirées + 10 dernières propositions.

**Effort :** 3-4h.

---

#### Session C — Doc opérateur 1-pager

**Branche :** `docs/operator-runbook`

**Fichier :** `docs/OPERATOR.md`

**Structure (style non-tech, registre `feedback_guide_non_tech_ops.md`) :**
- 5 étapes setup d'un nouveau client (commande → résultat attendu → screenshot si possible)
- 5 vérifications post-setup (persona créée, protocole non vide, premier chat fonctionne, propositions queue vide, kill switches off)
- 5 cas "que faire si" (pas de propositions après 1 semaine, fidelity collapse, doublon persona, client perd le lien `/train/`, extraction qui timeout)

**Effort :** 1h.

---

### Vague 2 — démarrer quand PR #120 merge

#### Session D — Câbler `PROTOCOL_V2_GENERATION`

**Branche :** `fix/v2-generation-killswitch`

**Pattern à copier :** `api/v2/protocol/extract.js:48` (kill switch `PROTOCOL_V2_EXTRACTION`).

**À faire :**
- Localiser le path de génération chat qui consomme protocol-v2 artifacts (probablement `api/chat.js` ou `lib/generate*.js` — chercher où `protocol_artifact` est lu)
- Si env var `PROTOCOL_V2_GENERATION === "off"` → bypass artifacts v2, fallback sur legacy `writingRules` ou prompt sans contraintes
- Test unitaire : env="off" → renvoie generation sans appliquer artifacts

**Effort :** 1h.

---

### Vague 3 — démarrer quand A + D mergés

#### Session E — Audit RLS + enforcement API v2

**Branche :** `feat/v2-rls-and-hooks`

**Migration SQL :** nouvelle (042 ou disponible) avec :
- `ENABLE ROW LEVEL SECURITY` sur `protocol_document`, `protocol_section`, `protocol_artifact`, `proposition`, `extractor_training_example`
- Policies basées sur `auth.uid()` + lookup persona ownership
- Test SQL : `SET ROLE` simulé persona A, lecture persona B → 0 rows

**Enforcement API :** middleware ou check dans chaque endpoint `api/v2/protocol/*`
- `agency_admin` → toutes personas de l'agence
- `setter` → seulement les personas qu'il gère
- `client` → seulement la persona via son `client_share_token`/`client_user_id`

**Test cross-persona explicite :**
- Créer 2 personas (A et B), 2 users (setterA et setterB)
- Tenter chaque endpoint v2 avec mauvais user → 403 attendu
- Logger ces tests dans `test/protocol-v2-cross-tenant.test.js`

**Effort :** 3-4h.

---

### Vague 4 — validation finale (après vague 3)

#### Session F — Test E2E bout-en-bout sur Preview avec persona seedée

**Pas une branche code, opérationnel.**

**Steps :**
1. Configurer `SUPABASE_TEST_URL` + `SUPABASE_TEST_SERVICE_ROLE_KEY` sur instance Preview Vercel
2. Seeder une persona "Nicolas" avec le PDF de cadrage du spec (`Reflexion process setting + IA.docx.pdf`)
3. Lancer extraction full pipeline → propositions devraient émerger
4. Exercer flow manuel via UI Preview :
   - Envoi DM test
   - Correction d'un message bot
   - Vérifier proposition pending créée
   - Accept proposition
   - Vérifier prose mutée
   - Vérifier artifact créé / amendé
   - Re-envoyer DM → vérifier que l'artifact tire (live pulse SSE)
   - Vérifier `stats.fires++`
5. Documenter chaque step dans le runbook opérateur (rétro-alimente Session C)

**Effort :** 1-2h.

---

## Action immédiate recommandée

**Lance Vague 1 (3 sessions parallèles) maintenant :**
- Session A : `feat/protocol-v2-chunk4-resume`
- Session B : `feat/review-deck-v0`
- Session C : `docs/operator-runbook`

**Attendre merge PR #120, puis :**
- Session D : `fix/v2-generation-killswitch`

**Quand A + D mergés :**
- Session E : `feat/v2-rls-and-hooks`

**Validation finale :**
- Session F : E2E Preview persona Nicolas

---

## Estimations totales

| Vague | Sessions | Effort | Calendrier |
|---|---|---|---|
| 1 | A + B + C | 8-11h en parallèle | ~6h calendaire |
| 2 | D | 1h | 1h après #120 |
| 3 | E | 3-4h | après A + D mergés |
| 4 | F | 1-2h | après E mergé |

**Total ~12-18h calendaire jusqu'au 1er vrai client.**

---

## Hors scope explicite

- Chunk 6 self-improvement extracteur
- UI client `/train/{token}`
- Wiki exportable
- Templates agence inheritance complet
- Voice Health / ROI Impact reports
- Intégration Breakcold
- Thread context summary 3-5 messages
- Recency weighting legacy (substrat manque, cf. note PR #120)

À reconsidérer après le 1er client en cond réelles.
