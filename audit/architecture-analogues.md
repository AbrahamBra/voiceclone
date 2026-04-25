# audit/architecture-analogues.md — Analogues structurels au protocole vivant

**Date** : 2026-04-25 · **Source** : recherche dispatch + lectures READMEs/papers (ace, GEPA, Hermes, Sudowrite, Jasper, graphify-novel).
**Usage** : référence pour décisions d'archi futures + pitch ("voici ce qui s'approche, voici ce qui reste notre territoire").

---

## Les 5 traits distinctifs de VoiceClone

| # | Trait | État VoiceClone |
|---|---|---|
| 1 | **Living document per entity** — un doc structuré par clone, qui évolue auto | ✅ implémenté (protocol_document + sections + artifacts) |
| 2 | **Feedback drains into proposed updates** — corrections → propositions reviewables, jamais d'edit direct | ✅ implémenté (cron `feedback-event-to-proposition.js` + queue `proposition`) |
| 3 | **Versioning explicite avec changelog narratif** — chaque publication = v(N+1) avec commentaire lisible non-tech | ⚠️ partiel : versioning DB ok, narratif pas calibré |
| 4 | **Multi-tenant agence à 3 niveaux** — agence > setters > clients-finaux, chaîne d'arbitrage | ⚠️ schéma prêt (orgs nullable migration 025), pas activé |
| 5 | **Cross-entity learning** — enseignements clone A → propositions clones B/C | ❌ pas implémenté |

---

## Analogues trouvés (vérifiés via gh API + WebFetch)

### 🎯 TIER A — matchs sur ≥3 traits

#### 1. [ace-agent/ace](https://github.com/ace-agent/ace) — ~993★, papier arXiv:2510.04618
**Traits matchés : 1, 2, partiellement 3.**

Architecture **Generator → Reflector → Curator**. README parle de *"contexts as evolving playbooks that accumulate, refine, and organize strategies"*. Le Curator *"converts lessons into structured delta updates with helpful/harmful counters, using deterministic merging with de-duplication and pruning"*.

Sections du document maintenu : `STRATEGIES & INSIGHTS` / `COMMON MISTAKES TO AVOID`.

**À piquer** : compteurs `helpful_count` / `harmful_count` par règle (artifact). Permet de décider quand retirer une règle qui ne sert plus, ou qui dégrade les générations.

**Limites** : Curator entièrement automatique (pas de review humain), pas de versioning narratif, pas de multi-tenant.

---

#### 2. [NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution) — ~2254★
**Traits matchés : 1, partiellement 2.**

Self-improving skills/prompts/code via DSPy + GEPA. **Skill comme unité atomique** (pas un seul gros prompt).

**À piquer** : décomposer le protocole en *skills indépendantes versionnées* plutôt qu'en règles plates. Une skill = compétence opérationnelle (ex : "qualifier un lead par engagement faible") avec règles + exemples + anti-patterns.

---

#### 3. [gepa-ai/gepa](https://github.com/gepa-ai/gepa) — ~4006★
**Traits matchés : 2 (partiellement).**

GEPA = "Reflective Text Evolution" : LLM lit traces d'exécution, diagnostique les échecs, propose mutations, sélectionne via Pareto. **100-500 évals au lieu de 25k+ pour RL** — viable économiquement par tenant.

**À piquer** : appelable par tenant. On peut lancer GEPA par clone en pointant sur ses traces de corrections, et récupérer des mutations textuelles du protocole. Moteur de drain corrections→propositions plus sophistiqué que celui actuel.

---

### 📐 TIER B — partiels mais transposables

#### 4. Sudowrite Story Bible (commercial, propriétaire)
**Traits matchés : 1, partiellement 4.**

7 sections interconnectées (braindump, synopsis, genre/style, characters, worldbuilding, outline, scenes), chaque section feed la suivante en cascade. Update manuel aujourd'hui (users demandent l'auto : https://feedback.sudowrite.com/p/automatically-update-the-story-bible).

**À piquer** :
- **Structure en cascade** : synopsis → ton de voix → règles → exemples (héritage entre sections)
- **Changelog public** lisible non-tech : https://feedback.sudowrite.com/changelog — calibre le ton du Trait 3.

---

#### 5. Jasper Brand Voice / Brand IQ (commercial)
**Traits matchés : 1, partiellement 4.**

Architecture deux composants : **Memory** (produits/audience/infos) + **Tone & Style** (règles/formatage).

**À piquer** : split Memory vs Tone & Style. VoiceClone mélange aujourd'hui faits (CTA = lien Calendly) et style (ton direct) dans le même doc. Splitter clarifie + permet au drain de router différemment selon la nature du signal.

📄 https://www.jasper.ai/blog/llm-optimized-architecture

---

#### 6. [Anshler/graphify-novel](https://github.com/Anshler/graphify-novel) — ~45★
**Traits matchés : 1, 2.**

Maintient une story bible (KG) extraite d'un manuscrit. **Flag les contradictions et continuity gaps comme propositions** ("findings are proposals only") — l'auteur approuve avant intégration.

**À piquer** : **détection de contradictions**. Quand un signal contredit une règle existante, le router en `edit_paragraph` (ou `remove_rule`) plutôt qu'en `add_rule`. Aujourd'hui le drain est aveugle à ça : deux règles contradictoires peuvent coexister.

---

#### 7. [GODGOD126/self-improving-for-codex](https://github.com/GODGOD126/self-improving-for-codex) — 100★
**Traits matchés : 1, 2 (light).**

`AGENTS.md` auto-mis-à-jour via "nightly review automation". Le pattern *cron de drain* en miniature, mono-tenant, pour coding agent.

---

### 🔍 TIER C — mention seulement

- **SillyTavern lorebooks** (`mia13165/SillyTavern-BotBrowser` 123★, `bmen25124/lorecard` 68★) — format Character Card V2 worth a look pour structure d'une "fiche d'entité riche".
- **Lavender** — doc publique trop marketing, rien d'exploitable.

---

## Catégories vides (honnêteté)

- **Multi-tenant agence 3-tier (Trait 4)** : zero match. Langfuse/PromptHub versionnent mais pas de chaîne agence→setter→client.
- **Cross-entity learning (Trait 5)** : zero match. Memory frameworks partagent à plat, jamais en mécanique explicite "learning A → proposition B/C".
- **Legal/medical policy doc evolutif** : Vanta/Drata font policy versioning, sans évolution auto par feedback IA.
- **Twain.ai, Magai, Castmagic, Lex.page** : pas de doc tech publique exploitable.

**Conclusion** : Traits 4 et 5 restent l'angle propre de VoiceClone à ce jour.

---

## Recos d'intégration (par ordre d'impact / coût)

### Reco A — `helpful_count` / `harmful_count` par artifact (ace pattern)
**Effort** : ~6h. **Impact** : décide quand retirer une règle qui dégrade.

**Mécanique** :
1. Quand le système génère un message, log les artifacts qui ont "fired" (déjà partiellement dans `protocol_artifact.stats.fires`).
2. Quand le user accepte/copie/publie le message → tous les artifacts firés +1 helpful.
3. Quand le user corrige/rejette → +1 harmful.
4. Curator job (cron quotidien) : si un artifact a `harmful >= 6` et `harmful/fires >= 0.6` → propose un `remove_rule` ou `amend_paragraph` dans la queue `proposition`.

**Migration prévue** : `supabase/049_rule_firing_counters.sql` — table `protocol_rule_firing` + extension du `stats` jsonb.
**Helper** : `lib/protocol-v2-rule-counters.js` — API `recordFiring`, `resolveFirings`, `proposeRetirement`. Stub posé, callers à wirer en follow-up.

---

### Reco B — Changelog narratif Sudowrite-style (Trait 3)
**Effort** : ~4h. **Impact** : différenciateur de pitch agence + outil non-tech.

**Mécanique** :
- À chaque publish (v1 → v2), générer via LLM un résumé narratif lisible non-tech : `"Cette semaine on a appris que Thomas refuse les emojis sauf si le prospect en envoie. On a ajouté la règle, et retiré la formule "à votre disposition" qui ne marchait pas."`
- Stocké sur `protocol_versions.summary_narrative` (column déjà à ajouter, pas encore présente).
- Affiché dans `/clones/[id]/protocole/changelog` côté client.

**Migration** : ajouter `summary_narrative text` sur `protocol_versions` (1 ALTER, additif).
**Lib** : `lib/protocol-v2-changelog-narrator.js` — compose un prompt à partir des propositions accepted/rejected/revised + diff sections.

**À calibrer en lisant** : 5-10 entrées de https://feedback.sudowrite.com/changelog — ton à reproduire.

---

### Reco C — Détection de contradictions (graphify-novel pattern)
**Effort** : ~8h. **Impact** : qualité du protocole sur le long terme (évite la dérive).

**Mécanique** :
- Avant que le router classifie un signal comme `add_rule`, embed le `proposed_text` et chercher les artifacts existants similaires (cosine ≥ 0.75) dont le sens contredit.
- Si contradiction détectée (LLM-judge mini-call binaire "contradicts ?") → router en `edit_paragraph` ou `remove_rule` avec rationale "conflit avec règle existante 'XYZ'".
- Bonus : flagger explicitement les artifacts qui se contredisent dans la doctrine view (UI) pour arbitrage agence.

**Touche** : `lib/protocol-v2-extractor-router.js` (DIRECT CONFLICT avec PR #123 en cours). À faire **après merge PR #123**.

---

## Décisions adoptées (à logger dans `decisions.md`)

| Date | Décision | Source |
|---|---|---|
| 2026-04-25 | Adopter le pattern ace `helpful_count` / `harmful_count` par artifact pour piloter le retrait de règles | ace-agent/ace |
| 2026-04-25 | Trait 3 — changelog narratif lisible non-tech (Sudowrite-style), à publier à chaque publish v(N+1) | Sudowrite |
| 2026-04-25 | Détection de contradictions au routing (semantic + LLM-judge), reportée à après merge PR #123 | graphify-novel |

---

## Pour la session parallèle

**Cette PR ne touche PAS** :
- `lib/protocol-v2-extractor-router.js` (la PR #123 le modifie)
- `scripts/feedback-event-to-proposition.js` (la PR #123 le modifie)
- Les fichiers de Chunk 5 (PR #122 — migration 048)

**Cette PR ajoute** :
- `audit/architecture-analogues.md` (ce doc)
- `supabase/049_rule_firing_counters.sql` (purement additive)
- `lib/protocol-v2-rule-counters.js` (nouveau, no callers)
- Mise à jour `audit/decisions.md` + `audit/sessions-log.md`

**Pas d'application de migration** : 049 attend qu'un humain coche le bouton dans Supabase SQL Editor (cohérent avec la convention migrations à plat documentée). Doit être appliquée **après** 048 (PR #122).

**Wiring des callers** (intégration helpful/harmful dans le pipeline chat) : follow-up PR séparée, après merge PR #123 + #122 + cette PR.
