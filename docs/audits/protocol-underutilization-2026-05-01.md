# Audit — Protocol underutilization (2026-05-01)

> **Correction 2026-05-01 (Sprint A préparation)** : la section §3 "Mort certain à couper" listait `Source-specific playbooks (mig 055) — 0 rows`. **C'est faux.** La requête initiale cherchait `owner_kind=source` mais les playbooks sont en fait stockés comme `protocol_document` avec `owner_kind=persona, source_core=<X>, status=active`. Nicolas a 5 playbooks source-specific actifs (dr_recue, interaction_contenu, premier_degre, spyer, visite_profil), seedés via PR #189 + #158, lus par `getActivePlaybookForSource` depuis chat.js et draft.js. **À conserver — Sprint A ne touche pas cette infra.**

**Contexte** : ta mémoire dit "~30% du layer protocole utilisé". J'ai inventorié toutes les surfaces (DB + code) et requêté la prod pour confirmer/infirmer. Ce doc est le matériau d'entrée pour la design V3.

**Méthode** :
- Mapping code via subagent Explore (50+ fichiers protocole sur lib/, api/, scripts/, src/lib/components/).
- Queries directes contre Supabase prod sur 5 personas (Nicolas L2 actif, Boni-yai L3 actif, Adrien/Mohamed/Thomas inactifs).
- Croisement avec les commits récents (mig 055/057 récentes vs 015/016/017 anciennes).

---

## TL;DR — la formule "30%" sous-estime le problème

Le layer protocole a **3 réalités distinctes**, pas un seul taux d'usage :

1. **Pipeline protocole-vivant (drain → propositions → publish)** : tourne, mais sur **un seul persona** (Thomas-Abdelhay, inactif). 11 propositions, 2 publish events, 11 training examples — toute la boucle a fait ses preuves *là*. Mais elle n'est jamais sortie de cette sandbox vers les personas actifs (Nicolas, Boni-yai).

2. **Surfaces dormantes "logées mais consommées par personne"** : `rhythm_shadow` (180 rows et personne ne lit), `fidelity_scores` (11 rows en tout), source-specific playbooks (mig 055 → 0 rows), v1 `operating_protocols` (1 row), `protocol_hard_rules` v1 (schema sans persona_id). Pure dette + coût d'exécution.

3. **Bug silencieux sur Nicolas** : ses 6 artifacts ont `content.params = {}` — les règles n'ont aucun paramètre exécutable. Conséquence : 0 firing sur 7 conversations malgré 6 hard_checks "actifs". Le contrôle qualité ne tourne pas, et personne ne le voit parce que tout est en SHADOW ou silencieux.

Recommandation globale : **ne pas faire un V3** avant d'avoir (a) propagé le pilote Thomas → Nicolas avec params réels, (b) coupé le mort certain (rhythm_shadow, fidelity, v1 operating_protocols), (c) tranché sur source playbooks.

---

## 1. Ce qui marche — réellement, en prod

### Le pipeline protocole-vivant fonctionne (sur Thomas)

| Surface | Mesure | Évidence |
|---|---|---|
| `feedback_events → proposition` (cron drain) | 11 propositions générées, toutes acceptées | toutes sur `document_id=30dfee04` (Thomas) |
| Versioning publish | 2 événements (v2, v3 de la doctrine Thomas) | `protocol_publish_event` rows avec `summary_narrative` LLM |
| Extractor training capture | 11 exemples | `extractor_training_example`, dernier 2026-04-26 |
| Stats migration cross-version | Implémenté `lib/protocol-v2-versioning.js`, `content_hash` matching | infra présente, exécutée lors des publishes Thomas |

**Implication** : la mécanique est éprouvée. Le problème n'est pas "ça ne marche pas", c'est "ça ne tourne que pour un persona qu'on n'utilise plus".

### Génération + injection des artifacts en chat

`api/chat.js` charge `getActiveHardRules` (v1) **ET** `getActiveArtifactsForPersona` (v2) — hybride v1+v2 toujours en place. `api/v2/draft.js` aussi. Les artifacts atterrissent dans le system prompt. Vérifié sur Nicolas : 6 artifacts actifs, tous injectés.

### UI doctrine

Les composants Svelte (`ProtocolDoctrine`, `ProtocolPropositionsQueue`, `ProtocolSectionEditor`, `ProtocolArtifactAccordion`, `ProtocolPropositionCard`) sont câblés et appelés depuis `brain/[persona]/+page.svelte`. UI usable.

---

## 2. Ce qui ne marche pas — par persona

### Recensement (5 personas ciblés)

| Persona | Active | maturity | sections | artifacts | propositions | firings | feedback_events | corrections | learning_events 30j |
|---|---|---|---|---|---|---|---|---|---|
| **nicolas-lavall-e** | ✓ | L2 | 6 (6 filled) | **6** (5 hard / 1 soft) | **0** | **0** | 1 (drained, 0 prop) | 2 | 13 |
| **boni-yai** | ✓ | L3 | 6 (0 filled) | 0 | 0 | 0 | 0 | 0 | 0 |
| **thomas-abdelhay** | ✗ | (null) | 6 (3 filled) | 0 | **11 accepted** | 0 | 0 | 22 | 5 |
| **adrien-fernandez** | ✗ | (null) | 6 (3 filled) | 0 | 0 | 0 | 0 | 2 | 0 |
| **mohamed-camara** | ✗ | (null) | **0 (no doc)** | 0 | 0 | 0 | 0 | 0 | 0 |

### Lectures clés

- **`maturity_level` n'est tagué que sur 2 personas** (Nicolas L2, Boni-yai L3). La taxonomie L1/L2/L3 mémoire est *informelle*, pas instanciée. Une décision V3 honnête doit soit la formaliser (back-fill), soit l'abandonner comme axe.
- **Le seul persona qui a réellement fait tourner la boucle protocole-vivant est Thomas (inactif)**. Donc tes preuves d'apprentissage live sont stockées sur un clone que tu n'utilises plus.
- **Boni-yai (L3 actif) a un scaffold vide** : 6 sections, 0 prose remplie, 0 artifact. Sa présence sur la liste "actif" est trompeuse — il n'a aucune doctrine.
- **Mohamed n'a même pas de protocol_document**. Le bootstrap n'a jamais tourné pour lui.

### Le drama Nicolas — bug silencieux

Nicolas a 6 artifacts marqués `is_active=true`, `severity=hard`, `kind=hard_check`. Quotes nettes (« Jamais de liste à puces », « Jamais deux questions… », « Jamais plus de 8 lignes »). Mais **`content.check_params = {}`** sur les 6 — pas de regex, pas de counter, pas de longueur cible.

Conséquence : `lib/protocolChecks.js` reçoit un check sans params, ne peut rien tester, retourne 0 violation. Donc 0 firing. La QA voiture roule à vide.

Et au-dessus de ça : la dernière conv de Nicolas (`scenario=dm`, sans `external_lead_ref`) montre le clone qui dérape ("Yo.", "j'ai déraillé") sans qu'aucune règle ne se déclenche. Le user a corrigé inline ("non c'est pas ma voix") mais **seulement 1 feedback_event a été émis** sur toute la conversation (event "excellent"). Le bouton "regen_rejection" a tapé une correction mais pas un feedback_event.

→ **Le canal de capture des signaux négatifs depuis le chat UI fuit.** C'est probablement la cause #1 de la sous-utilisation perçue : la matière première (feedback) ne remonte pas. Sans matière, pas de propositions. Sans propositions, le pipeline tourne à vide.

---

## 3. Ce qui est mort — à couper sans débat

| Surface | Évidence morte | Coût gardé |
|---|---|---|
| **`rhythm_shadow` table + critic SHADOW** | 180 rows écrites, 0 promotion `GUARD`, aucune surface UI ne les affiche, l'audit cross-persona a déjà conclu "détecte LLM déraillé, pas dérive de voix" | Cron + writes en chaque chat |
| **`fidelity_scores` + cron-fidelity** | 11 rows total prod, Nicolas a 2, lib/fidelity-math.js (Mahalanobis, clustering) jamais appelé inline | Cron quotidien qui ne sert à rien |
| **`operating_protocols` (v1) + `cron-consolidate.js` + `lib/protocol-parser.js`** | 1 row total prod (`parsed`, Nicolas) | Code v1 qu'on charge au démarrage de chaque chat (`getActiveHardRules` v1) |
| **`protocol_hard_rules` (v1)** | Schema sans `persona_id` (probablement keyé via doc/section), inconsistent avec v2 | Charge dans le pipeline chat |
| **Source-specific playbooks (mig 055)** | 0 rows en prod | Code v2 qui filtre + compute artifact stack pour rien |
| **`api/protocol-test.js`** | endpoint de dry-run v1, pas dans CLAUDE.md, pas appelé par UI | Endpoint orphelin |
| **`scripts/backfill-protocol-v2.js`, `reset-drain-flags-bootstrapped.js`** | Scripts one-shot, déjà exécutés | Maintenance morte |

**Action immédiate proposée** : 1 PR "purge dead protocol surfaces" qui supprime ces 7 surfaces + leurs migrations descendantes. Estimation : -1500 LOC, 0 régression utilisateur (rien ne consomme).

---

## 4. Ce qui est ambigu — à trancher avant V3

| Surface | État | Question à trancher |
|---|---|---|
| **Hybride v1/v2 dans chat.js** | les deux loaders coexistent | v2 est canon. Couper le path v1 quand on purge `operating_protocols` / `protocol_hard_rules`. |
| **Source-specific playbooks (mig 055)** | infra présente, 0 row | est-ce qu'on relance avec les 5 sections playbook Nicolas seedées par PR #189, ou on tue la feature et on revient à protocole global ? |
| **rhythm critic v3-voice (SHADOW)** | logique en place, jamais promue | est-ce qu'on tente de promouvoir avec un seuil tuné sur les baselines existantes (24 baselines en DB), ou on coupe ? |
| **Fidelity scoring** | cron daily, sortie quasi-nulle | est-ce qu'on resurrecte avec un trigger inline (par message) ou on retire ? |
| **`maturity_level` column** | renseigné 2/N personas | back-fill auto via heuristique (count corrections + volume convs) ou on retire la colonne ? |

---

## 5. Le vrai problème : le canal feedback chat → corrections

Au-delà des coupes, la **cause racine** de "30% utilisé" n'est pas la pléthore de features, c'est la pénurie de signal d'entrée. Évidence :

- Nicolas : 16 messages dans sa dernière conv, 4 corrections explicites en dialogue (« non », « pas dans ma voix », « j'ai dérapé »). Résultat DB : 1 feedback_event + 2 corrections. Taux de capture estimé : **<25%**.
- Adrien : 2 corrections totales sur l'ensemble de son histoire.
- Mohamed : 0 corrections, 0 feedback_events.

**Avant de redessigner le protocole, instrumenter le canal de capture.** Sans ça, n'importe quel pipeline V3 va tourner à vide pareil.

Pistes (non bloquantes pour ce doc) :
- chat composer : un signal négatif implicite par défaut quand le user reformule (déjà partiellement présent via `implicit_accept`, mais pas son symétrique `implicit_correct`).
- post-message hook : détecter "non / pas / arrête / j'ai déraillé" dans la 1ère phrase d'un user-turn et émettre un `feedback_event` avec le message bot précédent comme `bot_message`.
- regen_rejection actuel n'émet PAS de feedback_event (juste correction). À normaliser.

---

## 6. Recommandation V3 — séquence proposée

Avant V3 design conceptuel, **3 sprints courts dans cet ordre** :

### Sprint A — Couper le mort (1-2 jours)
1. PR purge : `rhythm_shadow`, `fidelity_scores`, `cron-fidelity`, `operating_protocols`, `protocol_hard_rules`, `cron-consolidate`, `lib/protocol-parser.js`, `api/protocol-test.js`, `scripts/backfill-protocol-v2.js`.
2. Migration : drop tables + drop colonnes liées dans personas si présentes.
3. Vérification : tests + 1 conv chat manuel par persona actif.

### Sprint B — Réparer le canal feedback (3-5 jours)
1. Instrumenter `regen_rejection` côté chat UI pour émettre un feedback_event en plus de la correction (sans casser le store de correction).
2. Ajouter un détecteur "negation-in-first-line" sur les user-turns → feedback_event implicite avec le message bot précédent comme cible.
3. Backfill Nicolas : reparser ses convs récentes pour générer rétroactivement les feedback_events qu'on aurait dû capturer (one-shot script).

### Sprint C — Rejouer le pipeline sur Nicolas (2-3 jours)
1. Vérifier que les artifacts Nicolas reçoivent des `check_params` non-vides (le bug actuel). Probablement un correctif dans `extract.js` ou dans le proposition-accept handler qui oublie de propager les params.
2. Tourner le drain manuellement avec `--extended-lookback` pour résorber les feedback_events backfillés.
3. Mesurer : combien de propositions émergent, combien sont acceptables, le verdict V3 émerge naturellement de cette mesure.

**Après ces 3 sprints**, on a (a) une codebase 30% plus petite, (b) des données qui circulent vraiment, (c) un terrain mesurable pour décider du V3 (vs un V3 spéculatif sur une infra qui ne tourne pas).

---

## Appendice A — Scripts de réplication

Tous les scripts d'audit sont dans `scripts/tmp-protocol-audit.mjs` et `scripts/tmp-audit-deep.mjs` (de la session 2026-05-01). À relancer pour rafraîchir les chiffres avant chaque sprint.

## Appendice B — Hors scope explicite

- Pas de proposition de redesign V3 dans ce doc. Volontaire — voir Sprint C avant.
- Pas d'audit du système d'embedding voyage / dédup propositions (threshold 0.85). Stable, pas de signal de problème.
- Pas d'audit du critic-voice/setterBaseline. Marche, mais peut être revu plus tard.
