# Intelligence comme lieu de croisement N1/N2/N3 — design

**Statut :** design draft, à raffiner — scope **post-beta**
**Date :** 2026-04-27
**Auteur :** AhmetA (vision produit), spec rédigée en session
**Précédents :** [protocole-vivant-design](2026-04-24-protocole-vivant-design.md), [review-deck-v0](2026-04-25-review-deck-v0-design.md)

## Contexte / problème

Aujourd'hui VoiceClone a deux pipelines d'apprentissage qui coexistent :

- **Protocole-v2 (Cerveau / Protocole)** — `feedback_events` → `proposition` → arbitrage user → `protocol_artifact` + mutation `protocol_section.prose`. Réactif, immédiat, chirurgical.
- **Legacy Intelligence** — `corrections` → `correction-consolidation.js` (cron 10min) → cluster ≥3 + Haiku synthèse → push dans `voice.writingRules`. Filtre du bruit par clustering, pas d'arbitrage humain.

L'onglet **Intelligence** dans l'UI surface aujourd'hui le legacy `voice.writingRules`. Ce qui le condamne à terme à être un **doublon partiel** du Cerveau. La migration de `voice.writingRules` (générées par `correction-consolidation.js`) vers le seed Intelligence n'est pas couverte dans le spec parent et doit être ajoutée comme **Phase 4-bis** distincte.

**Le problème de fond** : il manque dans l'architecture un **lieu de croisement** entre les sources de signaux. Aujourd'hui chaque source vit en silo :
- Documents uploadés (playbook, ICP)
- Retours du client final (médiés par l'agence en règles)
- Corrections setter au quotidien

Aucune vue ne montre où les 3 se renforcent, où elles se contredisent, où il y a des angles morts. C'est exactement ce que `feedback_every_action_trains.md` désigne par les 4 niveaux N1/N2/N3/N4 — mais aujourd'hui seuls N1 et N3 ont un pipeline propre, N2 est noyé dans N3, et il n'y a aucune couche de synthèse (N4).

## Vision

**Refonder l'onglet Intelligence comme la couche de croisement** — pas un dashboard de stats, pas un dérivé des corrections, mais le seul endroit où l'agence voit la cohérence (ou les contradictions) entre ce que dit le client, ce qui se passe en réalité, et ce qui ressort du quotidien setter.

### Les 3 sources qui doivent se croiser

```
N1 — Documents dans le dur
  Origine : upload playbook, ICP, doctrine extraite à l'onboarding
  Signal : "ce que le client a dit qu'il fait"
  Pipeline existant : protocol-v2 extracteur sur upload → sections + artifacts (author_kind=auto_extraction)

N2 — Retours client mécontents (médiés par l'agence)
  Origine : le client dit à l'agence "ton clone écrit pas comme moi sur ce point"
           → l'agence traduit en règle / instruction
  Signal : "ce que le client se découvre faire en se voyant représenté"
  Pipeline existant : AUCUN distinct — fond aujourd'hui dans les corrections setter
                      (problème majeur : on perd la traçabilité de la source)

N3 — Corrections setter au quotidien
  Origine : le setter corrige un message du clone dans le chat
  Signal : "ce que l'usage révèle de la voix réelle"
  Pipeline existant : feedback_events → proposition → artifact (protocol-v2)
```

### Les 4 zones de l'Intelligence refondue

L'algorithme de croisement produit pour chaque pattern/règle :

```
[ Patterns confirmés ]   pattern présent dans ≥2 couches
                         (ex : doctrine + corrections, ou client + setter)
                         → règle solide, stable

[ Contradictions ]       N1 dit X, N3 montre Y systématiquement
                         (ex : doctrine "tutoyer dès le début"
                          vs setter a corrigé 4 fois pour vouvoyer)
                         → arbitrage agence requis avec présentation au client

[ Angles morts ]         pattern récurrent dans N3 (≥3 occurrences)
                         qui n'a aucune trace dans N1 ni N2
                         (ex : 5 corrections sur le ton, 0 ligne dans la doctrine)
                         → demande de précision au client

[ Maturité par section ] niveau d'enrichissement de chaque section
                         N1 seul → "extraite" (jeune)
                         N1 + N3 → "en chemin" (rodée)
                         N1 + N2 + N3 → "consolidée" (mature)
                         → vue de la complétude de chaque clone
```

Cette vue est **différente du Review Deck** :
- Review Deck = **évolution dans le temps** (changelog des changements de version)
- Intelligence = **cohérence à un instant T** entre les 3 sources

Les deux sont des livrables agence complémentaires.

## Architecture / data model

### Gap 1 — N2 doit être tracé distinctement de N3

**Aujourd'hui** : un retour client transcrit par l'agence en correction est indistinguable d'une correction setter pure. Conséquence : impossible de croiser N2 vs N3.

**Patch proposé** : ajouter une colonne sur `feedback_events` (et symétriquement sur `corrections` legacy si encore actif) :

```sql
ALTER TABLE feedback_events
  ADD COLUMN source_actor text NOT NULL DEFAULT 'setter'
  CHECK (source_actor IN ('client_relay', 'agency', 'setter'));
```

- `client_relay` — l'agence transcrit littéralement un retour client
- `agency` — l'agence ajoute une règle de son propre chef (sans retour client direct)
- `setter` — correction quotidienne sur un message

L'UI de correction dans le chat doit ajouter un champ optionnel :
> "Origine de cette correction : ☐ moi (setter)  ☐ retour client  ☐ règle agence"

Default = setter. L'agency_admin peut surcharger.

### Gap 2 — Algorithme de croisement

Une fonction `lib/intelligence-crossing.js` :

```
buildIntelligenceView(personaId) → {
  reinforced: [
    { pattern, source_count, sources: ['N1', 'N3'], evidence: [...] }
  ],
  contradictions: [
    { n1_statement, n3_observation, occurrences, last_seen }
  ],
  blind_spots: [
    { pattern_from_n3, occurrences, sections_silent: ['scoring', 'process'] }
  ],
  maturity: [
    { section_kind, level: 'N1' | 'N1+N3' | 'N1+N2+N3', score: 0-100 }
  ]
}
```

Stratégie d'identification des patterns (à raffiner) :
- **Embedding-based clustering** sur tous les artifacts + propositions (toutes sources confondues)
- **Similarity ≥ 0.85** entre items de couches différentes → renforcement
- **Contradiction = embedding proche de N1 mais avec marqueur d'opposition** (négation, "jamais X" vs "toujours X" dans N1)
  — heuristique LLM-assistée pour détecter les vraies contradictions vs proches mais compatibles

### Gap 3 — UI 4 zones

Refonte de l'onglet Intelligence en 4 panneaux :

```
┌─ INTELLIGENCE ──────────────────────────────────────┐
│                                                      │
│ ┌── Patterns confirmés ─┐  ┌── Contradictions ────┐ │
│ │ N items renforcés     │  │ N alertes à arbitrer │ │
│ │ (badge stable)        │  │ (badge orange)       │ │
│ └───────────────────────┘  └──────────────────────┘ │
│                                                      │
│ ┌── Angles morts ───────┐  ┌── Maturité sections ─┐ │
│ │ N suggestions au      │  │ Heatmap par §        │ │
│ │ client                │  │ (jeune / rodée /     │ │
│ │                       │  │  consolidée)         │ │
│ └───────────────────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

Chaque panneau virtualisé, sortable par occurrences/recency.
Click sur un item → drawer qui montre les sources qui le portent (avec liens vers le doc / la conv / la proposition).

### Migration depuis legacy

`voice.writingRules` actuel (legacy) :
- Soit on le retire complètement quand l'Intelligence refondue ship — l'info utile est de toute façon dérivable des artifacts protocol-v2
- Soit on l'absorbe en seed initial des "Patterns confirmés" et on bascule
- Décision à trancher au moment de l'implem (probablement option 2 pour ne pas perdre l'historique de clustering)

Le `correction-consolidation.js` cron est retiré au même moment.

## Non-goals (V0 du nouveau Intelligence)

- Pas de prédiction proactive (N4 "IA qui anticipe") — c'est une couche au-dessus, à scoper séparément après Intelligence v2
- Pas d'auto-résolution des contradictions (LLM qui choisit) — toujours arbitrage agence
- Pas de notification push sur contradiction détectée — surface en pull seulement
- Pas de partage de patterns cross-personas via Intelligence (c'est le rôle des templates agence, scope distinct)

## Open questions à trancher avant implem

1. **Granularité du pattern matching** : embedding similarité brute ou structuration en `pattern.kind` (lexical / structurel / sémantique) avec algos différents par kind ?
2. **Seuil de "contradiction"** : à partir de combien d'occurrences N3 contredisant N1 on alerte ? (Hypothèse de départ : 3, à valider sur data réelle)
3. **Que fait-on des contradictions qui s'auto-résolvent** ? Ex. setter corrige 3 fois "vouvoie", agence répond au client, doctrine modifiée → la contradiction disparaît. La trace doit-elle rester archivée ?
4. **N4 (proactif)** : doit-il être dans cette spec ou un suivant ? (recommandé : suivant)
5. **Scope agence vs persona** : l'Intelligence est-elle uniquement par-persona, ou existe-t-il une vue agence-wide qui croise les patterns récurrents sur plusieurs clones ?
6. **N2 client direct** : si un jour un endpoint `/train/{token}` permet au client de pousser N2 directement (sans relais agence), faut-il distinguer `client_direct` de `client_relay` dans `source_actor` ?

## Critères de validation (mesurables)

- [ ] **Précision algo contradictions** : sur fixture de 50 propositions arbitrées (à constituer pré-implé), l'algo identifie ≥80% des contradictions identifiées par revue manuelle (gold standard à figer en début d'implé).
- [ ] **Latence calcul** : `buildIntelligenceView(personaId)` < 2s sur persona avec 200 artifacts (mesure : test perf sur fixture).
- [ ] **Pas de contradiction "ghost"** : 0 contradiction déjà résolue mais encore affichée après cycle complet d'arbitrage (test E2E sur scénario : créer contradiction → arbitrer → re-fetch view → assert absence).

## Mémoires utilisées

- [feedback_every_action_trains](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/feedback_every_action_trains.md) — N1/N2/N3/N4 framework
- [feedback_data_remontee_core](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/feedback_data_remontee_core.md) — feedback = spine du modèle
- [project_voiceclone_clone_maturity_levels](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/project_voiceclone_clone_maturity_levels.md) — 3 niveaux L1/L2/L3 dans la matière source
- [feedback_deliverable_is_object](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/feedback_deliverable_is_object.md) — l'Intelligence livre un objet (registre de croisement), pas un dashboard parallèle
- [feedback_real_conversations](../../../../../.claude/projects/C--Users-abrah-AhmetA/memory/feedback_real_conversations.md) — chaque pattern surfaceé doit pointer vers les conversations réelles qui le portent

## Liens implémentation

- Plan d'implémentation : à créer post-beta via skill `writing-plans`
- Dépendance forte : Phase 4 retrait legacy correction-consolidation (peut être anticipé)
- Dépendance souple : `feedback_event.source_actor` peut être ajouté plus tôt sans attendre la spec complète, ça commence à collecter la donnée

## Estimation

~1 semaine de dev :
- 1j data model + migration `source_actor`
- 2j algorithme de croisement + tests sur fixtures
- 2-3j UI 4 panneaux + intégration
- 1j migration legacy → seed Intelligence + retrait clustering

À ne pas démarrer avant la beta validée et **au moins 50 propositions arbitrées en conditions réelles** sur 2 clones — sinon l'algorithme de croisement n'aura pas de matière à se calibrer.

---

## Appendix — Audit 2026-04-28

Audit indépendant réalisé après le draft initial. Findings load-bearing à arbitrer avant implémentation :

### A1 — `proposition.source` couvre déjà 80% du gap N2/N3

`migration 038` introduit `proposition.source` avec valeurs `client_validation`, `agency_supervision`, `upload_batch`, `feedback_event`. Le croisement N2/N3 peut donc se faire **au niveau proposition** sans avoir besoin de la migration ALTER `feedback_events.source_actor` proposée Gap 1.

**Implication** : la migration Gap 1 est probablement évitable. Alternative légère : à l'insert dans `feedback-events.js`, dériver le rôle depuis `clients.role` (migration 048 : `agency_admin/setter/client`) + `is_admin` flag — pas de champ UI à ajouter, pas de migration table feedback_events.

**À trancher** : on garde la migration explicite pour clarté future, ou on dérive ?

### A2 — Collision sémantique avec `personas.maturity_level` (L1/L2/L3)

La spec `2026-04-27-clone-meta-rules-and-maturity.md` (mergée le même jour) introduit `personas.maturity_level ∈ {L1, L2, L3}` pour la maturité du **document source** d'un clone. Le panneau 4 du présent spec parle de "maturité par section" (N1 / N1+N3 / N1+N2+N3) — concept orthogonal mais lexique identique.

**Risque** : confusion dev + UI ambiguë.

**Suggestion** : renommer le panneau 4 en "**Couverture par section**" (N1 / N1+N3 / N1+N2+N3) pour réserver "maturité" à `maturity_level`.

### A3 — État initial / dégradé non spécifié

Pour un persona L1 (sans corpus N3) ou un persona neuf < 10 corrections, les 4 panneaux du panel Intelligence affichent quoi ? État vide silencieux = produit cassé sans alerte.

**À ajouter** : section "État initial" décrivant le rendu pour (a) persona neuf, (b) persona L1, (c) persona en cohabitation transitoire avec `correction-consolidation.js` actif.

### A4 — Backfill non spécifié

100% des `feedback_events` existants seront classés `source_actor='setter'` (default proposé) — mais une partie sont en réalité des retours clients transcrits historiquement. La spec ne propose ni heuristique ni audit pour reclassifier.

**À ajouter** : plan de backfill (heuristique sur `source_message_id` → `conv.client_id` ; ou flag manuel "à reclasser" sur les rows pré-migration).

### A5 — Pas d'observabilité

Combien de contradictions/semaine ? Taux d'arbitrage ? Time-to-resolve ? Sans métriques, impossible de calibrer le seuil "50 propositions arbitrées" mentionné en scope.

**À ajouter** : 3 métriques dans la doc Phase 4-bis : `intelligence_contradictions_count_weekly`, `intelligence_arbitration_rate`, `intelligence_arbitration_p50_latency`.

---

**Verdict appendix** : draft de design valide comme vision, **needs rework opérationnel** avant implé. Trancher A1 (migration ou dérivation) avant tout autre travail puisque ça change le scope.
