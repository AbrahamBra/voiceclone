# Clone meta-rules & maturity framework — focused note

**Date** : 2026-04-27
**Status** : focused contributions surviving the 2026-04-26 audit
**Scope** : DM LinkedIn setting — inbound + outbound. POSTs explicitly out of scope ([memory `project_voiceclone_scope_dm_and_maturity_first_class.md`](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/project_voiceclone_scope_dm_and_maturity_first_class.md)).
**Replaces** : draft `2026-04-25-protocole-vivant-3-clones-validation.md` (deleted — 70% superseded by the 2026-04-26 specs below).

## Goal

Build the **meta-rules** that let us recognize different formats of client framing docs for DM LinkedIn setting, so each new clone onboards faster and produces sharper extraction.

Iterative — new client docs arrive over time, each potentially revealing a new format pattern → enrich the meta-knowledge.

## What's already done (don't redo)

The 2026-04-26 chantier shipped most of what was needed for the *per-clone* layer :

- **Doc ingestion discipline** : 12 rules R1-R12 in [`2026-04-26-doc-ingestion-rules.md`](2026-04-26-doc-ingestion-rules.md) — categorization, authority detection, constraint extraction, anonymization, multi-context entities, snapshot/rollback. Backed by migration 053 + skill `protocol-doc-ingestion`.
- **Phase axis + dynamic rule scoping** : [`2026-04-26-phase-axis-dynamic-rule-scoping-design.md`](2026-04-26-phase-axis-dynamic-rule-scoping-design.md) — 6 phases × 4 sources (visite_profil / connexion_entrante / interaction_contenu / outbound), filtered injection. Migration 054 in flight.
- **Wave 2 push** : Nicolas's 44 hard_rules + 35 entities materialized in production.
- **Upload playbook → propositions** : specced in `eloquent-brattain-2418de` worktree (commit `81cb529`).

This note covers **only** what these don't address.

## Contributions still unique

### 1. Maturity tier as a first-class persona attribute

Validated on 4 docs (Nicolas, Mohamed, Adrien, Thierry — see [memory `project_voiceclone_clone_maturity_levels.md`](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/project_voiceclone_clone_maturity_levels.md)) :

- **L1** — positionnement + ICP + voix + matière. Pas de scripts DM. Ex : Adrien, Thierry.
- **L2** — opérationnel mono-scenario (un type de DM bien outillé : icebreaker outbound chez Nicolas). Hard_rules + scoring + 1 set de templates.
- **L3** — opérationnel multi-scenario (icebreaker × multi-source + creusement + call_proposal + graceful_exit tous outillés). Voix imposée + matière de contenu réutilisable.

**Proposal data model** :
```sql
ALTER TABLE personas ADD COLUMN maturity_level text
  CHECK (maturity_level IN ('L1', 'L2', 'L3'));
```

**Implications produit** :
- Onboarding : la première question après création du persona = "tu as un doc de positionnement seul (L1), un playbook DM mono-scenario chirurgical (L2), ou un playbook DM multi-scenario complet (L3) ?"
- Extracteurs allowlist : un persona L1 ne lance pas l'extracteur `templates` (ne trouvera rien) — économie de cycles + moins de faux positifs
- UI brain drawer : tabs/sections actifs varient par tier (L1 ne montre pas la section Templates ou Phases tant que matière insuffisante)
- Migration L1 → L2 → L3 : explicite, déclenchée user ou suggérée auto quand corpus atteint un seuil

**Coût** : ~3-5h migration + persona attribute + onboarding question + extractor allowlist. UI surfacing à part.

### 2. `voice_signature` — kind dédié vs `identity` actuel

Question ouverte, pas une décision. Problème observé sur les 4 docs :
- Mohamed §6.5 a une section "sound like Mohamed" très formalisée (mots-marqueurs, registre)
- Adrien décrit sa voix dans "Style de communication" (anti-bullshit, attaque > défense)
- Thierry n'a pas de section dédiée — la voix est à inférer depuis la prose narrative

Aujourd'hui ça atterrit en `kind='identity'` (R5 du doc-ingestion-rules). Mais `identity` mélange "qui je suis / ce que je vends" et "comment je parle". À l'extraction, ça crée du flou : le prompt extracteur d'`identity` ne sait pas s'il cherche du positionnement business ou des marqueurs lexicaux.

**Option** : créer `kind='voice_signature'` avec shape structuré `{markers: [{token, scope:'use'|'avoid', register?}], tone: [{trait, examples[]}]}`. Extracteur dédié qui sait ratisser des listes de mots/tournures + inférer depuis la prose si pas de section dédiée.

**Coût** : ~6-8h (migration enum + extracteur + tests). À discuter avec l'équipe protocol-v2 — peut-être que l'extracteur `identity` peut juste être upgrade pour distinguer les 2 sub-types sans nouveau kind. Plus léger.

### 3. `content_asset` avec sous-types riches

Aujourd'hui : matière de contenu réutilisable (USP, ennemis, objections, anecdotes founder, comparaisons concurrents chiffrées, signature quotes, métaphores, vision marché, verbatims clients) tombe en `kind='custom'` avec heading explicite (R5).

Le problème : ces 10 sous-types ont des **structures distinctes** et des **usages différents** au runtime (objection_handler s'utilise en réponse à une objection détectée ; signature_quote peut être ponctuellement injecté ; competitor_analysis sert quand le prospect cite un concurrent). Tout en `custom` = pas de routage runtime possible.

**Sous-types observés sur les 4 docs** :
- `case_study` (Mohamed × 5, Adrien × 0, Thierry × 5+ deals)
- `usp` (tous, avec différents niveaux de structure)
- `enemy` (Adrien explicite × 3, Mohamed implicite, Thierry × 6 concurrents)
- `objection_handler` (Adrien × 7 paires, Thierry × ~7 implicites)
- `personal_anecdote` (Thierry × 10+, Adrien × 2, Mohamed × 0)
- `competitor_analysis` chiffrée (Thierry, Adrien)
- `signature_quote` (Thierry × 5+, Mohamed × 1-2)
- `metaphor` (Mohamed "Excalibur")
- `market_vision` (Adrien sur GEO/AI search)
- `verbatim` client (Mohamed × beaucoup, Thierry × beaucoup)

**Option** : `protocol_artifact.kind='content_asset'` avec `content.asset_kind` discriminé. Pas de nouveau `section.kind` — on enrichit l'extracteur custom pour produire des content_asset typés.

**Coût** : ~6-8h (extracteur + shape jsonb + tests) — plus léger qu'un nouveau section.kind.

### 4. Meta-extraction layer (interne, RGPD-safe)

**Constraint dure** ([memory `project_voiceclone_cross_clone_learning.md`](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/project_voiceclone_cross_clone_learning.md)) : aucune propagation cross-persona livrée à un user. Les règles d'un client ne nourrissent pas le runtime d'un autre client.

**Ce qu'on FAIT au lieu** : équipe interne extrait des **meta-règles de format** depuis l'analyse de N docs clients :
- Patterns de structure de doc (sections récurrentes, ordre, conventions de nommage)
- Distribution maturité L1/L2/L3 observée
- Sous-types `content_asset` rencontrés et leur fréquence
- Patterns d'expression de voix (formalisée vs implicite)
- Phases du setting réellement décrites par les clients (pour valider/étendre la phase taxonomy de [phase-axis spec](2026-04-26-phase-axis-dynamic-rule-scoping-design.md))

**Usage interne uniquement** :
- Calibration des prompts des extracteurs
- Onboarding question : "tu as un L1/L2/L3 ?" — auto-classifié si le doc est uploadé
- Suggestions de sections à compléter pour aider le client à monter en maturité (sans surfacer de contenu d'autres clients)
- Détection auto du format du doc reçu (avant lancement R1-R12 du doc-ingestion-rules)

**Pas de surface produit** côté user. Pas de "Inspiré d'un autre clone". Pas de pré-remplissage avec le contenu d'un autre client.

**Coût** : pas une feature à coder mais un **process d'équipe** — analyse régulière des docs reçus → enrichissement d'un doc interne `meta-format-rules.md`. Outillage léger (script `scripts/meta-doc-analysis.js` qui produit un rapport JSON sur structure/maturité/sub-types). ~4-6h pour le script + le doc-template, le reste = travail récurrent humain.

## Priorisation suggérée

1. **Maturity tier first-class** — bénéfice immédiat pour l'onboarding + UI ; bloquant pour bien différencier L1 et L3 dans l'app.
2. **content_asset sous-types** — déblocant pour absorber les Adrien-types (matière >> règles).
3. **Meta-extraction layer** — démarre dès aujourd'hui (analyse manuelle) ; outillage léger après que 2-3 nouveaux docs arrivent.
4. **voice_signature kind** — à discuter avec l'équipe avant ; possiblement résolu par enrichissement de `identity` plutôt qu'un nouveau kind.

## Iteration plan

À mesure que de nouveaux docs clients arrivent :
1. Catégoriser via R1 (doc-ingestion-rules)
2. Classer L1/L2/L3
3. Lister les `content_asset.asset_kind` rencontrés (en particulier ceux pas dans la liste actuelle)
4. Repérer toute structure récurrente entre clients
5. Mettre à jour le doc interne `meta-format-rules.md` (à créer)

Pas de spec finale. Doc vivant.

## References

- Parent : [`2026-04-24-protocole-vivant-design.md`](2026-04-24-protocole-vivant-design.md)
- Implemented overlap : [`2026-04-26-doc-ingestion-rules.md`](2026-04-26-doc-ingestion-rules.md)
- Implemented overlap : [`2026-04-26-phase-axis-dynamic-rule-scoping-design.md`](2026-04-26-phase-axis-dynamic-rule-scoping-design.md)
- Memories: `project_voiceclone_clone_maturity_levels.md`, `project_voiceclone_cross_clone_learning.md`, `project_voiceclone_scope_dm_and_maturity_first_class.md`
