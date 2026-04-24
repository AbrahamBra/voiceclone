# Protocole vivant — design

**Statut :** design approuvé, à implémenter
**Date :** 2026-04-24
**Auteur :** AhmetA (brainstorming), rédaction assistée
**Input référence :** `Reflexion process setting + IA.docx.pdf` (doc de cadrage Nicolas Lavallée — 13 pages, 7 sections, utilisé comme cas d'usage cible)

## Contexte & problème

L'onglet `Protocole` de VoiceClone affiche aujourd'hui ~5 règles atomiques extraites d'un playbook uploadé (hard_check, max_length, regex, structural). Ces règles correspondent à une seule section du playbook source (`§6 règles absolues` dans le doc de Nicolas) — le parser actuel ignore 80% de la matière :

- Identité / offre (contexte narratif)
- ICP + patterns de douleur (taxonomie d'analyse)
- Scoring 3-axes + table de décision (framework décisionnel)
- Process 6 étapes (state machine)
- Templates de structure message
- Table erreurs classiques

**Impact :** le user perçoit le protocole comme "5 puces de config froides" alors qu'il attend le **wahou de l'intelligence vivante** — la promesse centrale du produit. Le protocole est identifié comme le différenciateur principal VoiceClone ([project_voiceclone_protocol_differentiator.md]).

## Principes de design

### 1. Unbounded & flow-first (Karpathy / software 2.0)

L'architecture EST la boucle d'apprentissage. Aucun plafond sur le nombre d'artifacts, de propositions, de sections. Une persona mature à 6 mois porte **300 à 800 artifacts**, pas 5. Chaque signal reshape le doc + recompile les artifacts en continu. L'UI doit absorber ce volume gracefully (filter, search, taxonomy, virtualisation, stats d'usage) — jamais un scroll plat.

### 2. Doctrine-first, règles compilées

Le doc narratif est la source de vérité lisible. Les artifacts exécutables (hard_checks, patterns, scoring, state transitions, templates, soft_checks) sont dérivés et regénérés à chaque save. Une source, deux lunettes (Doctrine / Registre).

### 3. Chaque action est data d'entraînement

Correction chat, rewrite accepté, édit manuel, validation "c'est ça", dismiss message, tir de règle contesté → tout alimente la queue de propositions OU renforce les stats d'artifacts existants. Aligné sur [feedback_every_action_trains.md].

### 4. Extracteurs auto-améliorants (N3→N4)

Chaque accept/reject de proposition entre dans le corpus d'entraînement de l'extracteur correspondant. Tous les 50-100 exemples, le prompt de l'extracteur est régénéré avec few-shots équilibrés. Le système apprend à mieux proposer à mesure que l'utilisateur arbitre.

### 5. Célébration visible du signal

Chaque tir d'artifact en prod pulse le paragraphe source dans l'UI. Activity feed SSE en direct. Badge de propositions. Toasts de capture. Aligné sur [project_voiceclone_celebrate_signals.md].

---

## Section 1 — Modèle de données

### Table `protocol_document`

Un doc vivant par persona (ou template agence). Versions monotones, jamais supprimées.

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | PK |
| `owner_kind` | enum | `persona` \| `template` |
| `owner_id` | uuid | persona_id OU template_id |
| `version` | int | monotone, auto-incrémenté |
| `status` | enum | `draft` \| `active` \| `archived` |
| `parent_template_id` | uuid? | FK nullable — si inherit d'un template agence |
| `diverged_from_template_at` | timestamp? | marqué dès qu'une section est forkée |
| `created_at`, `updated_at` | timestamps | — |

### Table `protocol_section`

Les sections typées qui composent le doc. Le `prose` est canonique (édité par user) ; le `structured` est dérivé (regénéré par extracteur).

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | PK |
| `document_id` | uuid | FK |
| `order` | int | ordre d'affichage |
| `kind` | enum | `identity` \| `icp_patterns` \| `scoring` \| `process` \| `templates` \| `hard_rules` \| `errors` \| `custom` |
| `heading` | text | "2. Nos clients idéaux" |
| `prose` | text | la prose FR éditable |
| `structured` | jsonb? | shape typée selon `kind`, regénérée par extracteur |
| `inherited_from_section_id` | uuid? | FK nullable — si héritée d'un template |
| `client_visible` | bool | par défaut true (cf. hooks client) |
| `client_editable` | bool | par défaut false |
| `author_kind` | enum | `user` \| `auto_extraction` \| `proposition_accepted` |
| `updated_at` | timestamp | — |

**Shapes `structured` par kind :**

| `kind` | shape |
|---|---|
| `identity` | — (prose-only, contexte prompt) |
| `icp_patterns` | `{ patterns: [{ name, signals, question_clé }] }` |
| `scoring` | `{ axes: [{ name, levels: [0..3] }], decision_table: [[score, action]] }` |
| `process` | `{ steps: [{ id, name, prereqs, actions, outputs }] }` |
| `templates` | `{ skeletons: [{ scenario, structure: [slots] }] }` |
| `hard_rules` | `[{ rule_text, check_kind, check_params }]` |
| `errors` | `{ pairs: [{ avoid, prefer }] }` |
| `custom` | libre |

### Table `protocol_artifact`

La couche exécutable/interrogeable. Tes règles actuelles = artifacts `hard_check`.

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | PK |
| `source_section_id` | uuid | FK — chaque artifact trace son paragraphe d'origine |
| `source_quote` | text | la phrase exacte qui l'a engendré |
| `kind` | enum | `hard_check` \| `soft_check` \| `pattern` \| `score_axis` \| `decision_row` \| `state_transition` \| `template_skeleton` |
| `content` | jsonb | polymorphe selon `kind` (pour `hard_check` : `{ check_kind, check_params }`) |
| `severity` | enum? | `hard` \| `strong` \| `light` (pour check_kinds) |
| `scenarios` | text[]? | scope — ex. `['DM_1ST']` |
| `is_active` | bool | par défaut true |
| `is_manual_override` | bool | si l'user a override manuellement, survit aux re-extractions |
| `content_hash` | text | normalisé — utilisé pour préserver les stats cross-version |
| `stats` | jsonb | `{ fires, last_fired_at, accuracy_from_feedback }` |
| `created_at` | timestamp | — |

### Table `proposition`

Queue d'arbitrage. Une correction produit une proposition.

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | PK |
| `document_id` | uuid | FK — doc visé |
| `source` | enum | `feedback_event` \| `learning_event` \| `chat_rewrite` \| `manual` \| `client_validation` \| `agency_supervision` \| `upload_batch` \| `analytics_cron` |
| `source_ref` | uuid? | id de l'event déclencheur |
| `source_refs` | uuid[] | si merge — tous les events qui ont contribué |
| `count` | int | nombre de signaux dédupliqués |
| `intent` | enum | `add_paragraph` \| `amend_paragraph` \| `add_rule` \| `refine_pattern` \| `remove_rule` |
| `target_kind` | enum | kind de section visé |
| `target_section_id` | uuid? | si amendement d'une section existante |
| `proposed_text` | text | texte final (candidat pour prose ou rule_text) |
| `rationale` | text | "corrigé dans conv #234, user a écrit 'fait pressant'" |
| `confidence` | float | 0.0-1.0, score de l'extracteur |
| `status` | enum | `pending` \| `accepted` \| `rejected` \| `revised` \| `merged` |
| `user_note` | text? | optionnel |
| `created_at`, `resolved_at` | timestamps | — |

### Table `extractor_training_example`

Corpus d'entraînement des extracteurs (N3→N4).

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | PK |
| `scope` | enum | `persona` \| `template` |
| `scope_id` | uuid | — |
| `extractor_kind` | enum | quel extracteur (`add_rule`, `refine_pattern`, …) |
| `input_signal` | jsonb | ce que l'extracteur a lu |
| `proposed` | jsonb | ce qu'il a sorti |
| `outcome` | enum | `accepted` \| `revised` \| `rejected` |
| `revised_text` | text? | si revised |
| `user_note` | text? | optionnel |
| `created_at` | timestamp | — |

### Table `persona` — hooks client-facing ajoutés

| Champ ajouté | Type | Rôle |
|---|---|---|
| `client_share_token` | uuid? | token de partage `/train/{token}` — nullable |
| `client_user_id` | uuid? | user client rattaché |

### Table `user` — hook rôle

| Champ ajouté | Type | Rôle |
|---|---|---|
| `role` | enum | `agency_admin` \| `setter` \| `client` — par défaut `setter` |

---

## Section 2 — UX lecture + édition

### Trois surfaces, une seule source

**A. Vue Doctrine (default)** — lecture continue
Layout : TOC à gauche (avec indicateur de santé par §), prose au centre avec accordéons inline sous chaque paragraphe portant des artifacts, activity feed SSE toujours visible à droite.

- Chaque `section_heading` affiche : `§kind · N artifacts · M tirs 7j · santé 🟢🟡⚪`
- Sous chaque paragraphe qui porte des artifacts : fine ligne *"3 hard_checks · 2 patterns · 14 tirs 7j"* → accordéon (virtualisé si >20)
- Live pulse 2s du paragraphe source quand un artifact tire en prod (fond vermillon 8% fade)

**B. Vue Registre (toggle)** — transversale
Tableau virtualisé (TanStack Virtual), filtrable par : `kind`, `severity`, `scenario`, `source §`, `tirs 30j`, `dernière`. Recherche plein-texte local (Fuse.js) sur `prose + description + source_quote`. Clic sur ligne → scroll+highlight au §source dans vue Doctrine.

**C. Vue Propositions (badge [N])**
Détaillée en section 3.

### Mode édition

**Niveau paragraphe (prose) :** clic → éditeur inline contenteditable. Save → extraction spinner (3-8s) → diff *"✚ 2 nouveaux · ✎ 1 amendé · ✕ 0 supprimé"* avec boutons `Appliquer` / `Réviser artifact par artifact` / `Annuler`.

**Timeout & fallback extraction :** si l'extracteur dépasse 15s ou renvoie une erreur, la save du prose est **persistée quand même** (le user ne perd pas son édit), un marker *"extraction en attente"* s'affiche sur le §, et un cron retry (toutes les 5 min, max 3 essais) relance l'extraction en arrière-plan. Le kill-switch env var `PROTOCOL_V2_EXTRACTION=false` désactive complètement l'extraction auto — les paragraphes sont sauvés, les artifacts restent inchangés, l'user peut les overrider manuellement.

**Niveau artifact (override manuel) :** bouton `override manuellement` → détache l'artifact du prose (`is_manual_override: true`), survit aux re-extractions, badge *"maintenu manuel"*.

### Comportements critiques

1. **Live pulse SSE** sur tir d'artifact.
2. **Test global du doc** — le bouton `Tester sur historique` existant passe au niveau doc entier (tous artifacts sur 200 derniers messages sortants), résultats agrégés par §chapter.
3. **Scroll anchors stables** — `#§6.rule_id` permalink.
4. **Draft/active/archive** — édit n'affecte jamais la version active ; `Publier v8` remplace atomiquement.
5. **Responsive** : mobile → TOC en drawer, activity feed en sheet, lecture seule (pas d'édit mobile).

### Scale tactics pour 500-1000+ artifacts

- Accordéons inline par §paragraph, jamais tout déplié
- Registre virtualisé (60fps à 1500 lignes)
- Recherche full-text indexée local
- Pagination activity feed (50 récents + paginé)

---

## Section 3 — Signaux & queue de propositions

### Signaux qui alimentent la queue

| Signal | Source existante | Intent proposition |
|---|---|---|
| Correction explicite | `FeedbackPanel → type:regenerate` | `add_rule` \| `amend_paragraph` |
| Rewrite accepté | `FeedbackPanel → type:accept` | `refine_pattern` |
| Édition manuelle draft | Composer diff | `add_rule` (soft_check) |
| Validation "c'est ça" | Chat action | **pas de proposition** — stats++ sur artifacts matchés |
| Message dismissé | Chat action | `add_rule` négatif |
| Tir contesté | Protocol stats | `amend_paragraph` (rétrograder) |
| Upload playbook | Connaissance tab | `upload_batch` (bulk propositions) |
| Pattern récurrent détecté | Cron analytique | `add_rule` si N≥3 occurrences |

Tous pluggent sur `proposition.source`. Chaque source a un extracteur LLM dédié.

### Pipeline proposition

```
Signal → Extracteur LLM spécialisé (un par target_kind)
         prompt = source_type + doc current state + 20 props récentes pour dédup
  → Candidat { intent, target_kind, proposed_text, rationale, confidence }
  → Dédup sémantique (embedding similarity >= 0.85 → MERGE count++, source_refs appended)
  → Filtre bruit (confidence >= 0.75 OU count >= 2)
  → Queue pending
```

**Un extracteur par `target_kind`** (hard_rules, errors, patterns, scoring, process, templates, custom). Chaque extracteur a son propre prompt, son propre corpus few-shot (`extractor_training_example.extractor_kind`), et peut être régénéré indépendamment. Le routage `signal → extracteur` est décidé par un premier LLM call léger (classifier) ou par règle statique selon la source.

**Embedding model pour dédup :** `text-embedding-3-small` (OpenAI) stocké dans pgvector. Latence ~200ms, budget tient dans le spinner de 3-8s annoncé côté édition. Les embeddings des propositions pending sont maintenus en cache Postgres — dédup = single query `ORDER BY embedding <=> new_embedding LIMIT 5`.

**Invariant `source_ref` vs `source_refs` :** à la création, `source_ref = source_refs[0]` (l'event déclencheur unique). Quand une proposition sémantiquement proche est merge (similarity ≥ 0.85), le nouvel event est append à `source_refs`, `source_ref` reste figé sur l'event canonique originel, `count = len(source_refs)`.

**Filtre bruit `OR` intentionnel :** une prop confidence=0.90 count=1 (extracteur sûr dès le premier signal) mérite d'être vue. Une prop confidence=0.50 count=3 (signal faible mais récurrent) mérite aussi. AND éliminerait les deux types. Les propositions silenced (ni seuil atteint) restent stockées et remontent si un 2e signal arrive.

Aucun cap sur le nombre de propositions. Onboarding d'une persona : 30-80 props/sem attendues.

### UX de la queue

Onglet `propositions [12]` dans le header Protocole. Groupées par `§target_kind`, triées par `confidence × count`.

Chaque proposition affiche : intent, target, proposed_text, count + source refs cliquables, source_quote, confidence.

Actions : `Accepter` / `Réviser` (inline edit avant accept) / `Rejeter` (→ corpus extracteur) / `Voir N cas` (lightbox).

Actions batch en bas : `Accepter top-5 (≥90%)` / `Rejeter tout <60%`.

### Accept → mutation du doc

L'accept :
1. Crée/amende l'artifact
2. Écrit/patche le paragraphe dans `prose` du §target (LLM compose au style du chapitre)
3. Affiche un diff final de prose avant validation
4. Passe la proposition à `status: accepted`
5. Écrit un `extractor_training_example` positif

### Feedback loop sur l'extracteur (N3→N4)

Tous les 50-100 `extractor_training_example`, le prompt de l'extracteur correspondant est régénéré (cron hebdo ou manuel) avec few-shots positifs/négatifs équilibrés. **Le système apprend à mieux proposer à mesure que tu arbitres.**

### Consolidation Chat page

- Retirer `FeedbackPanel` latéral de la page Chat (télémétrie brute exposée par erreur)
- Garder les actions sous chaque message (corriger / valider / régénérer)
- Ajouter badge compact top-right chat : *"3 signaux → Protocole · 2 propositions créées"* → clic vers onglet Propositions
- Toast micro-célébration sur action : *"+1 apprentissage capturé"*

### Volume attendu

| Phase persona | Prop/sem | Temps arbitrage |
|---|---|---|
| Onboarding (0-2s) | 30-80 | 10-15 min/j |
| Maturation (2-8s) | 10-25 | 5 min/j |
| Stable (>2m) | 2-10 | hebdo |

### Perf targets UI

- Queue propositions : virtualisée, **60fps avec 500 pending** (test perf sur fixture synthétique dans Sprint 4)
- Registre artifacts : virtualisé, **60fps avec 1500 artifacts** (test perf Sprint 3)
- Activity feed SSE : 100 derniers événements en DOM + scroll infini paginé
- Vue Doctrine : prose complète chargée en 1 fetch ; accordéons artifacts chargés on-demand par §section (lazy)

---

## Section 4 — Versioning + scope agence + hooks client

### Versioning

- Versions monotones, jamais supprimées
- `draft` unique en parallèle du `active`
- Édits + propositions acceptées écrivent dans draft
- `Publier` → switch atomique, previous active → archived
- Rollback = activer une archive

### Préservation stats cross-version

Chaque artifact a `content_hash` (normalisé sur le sens). Lors du publish :

```
FOR each artifact of v_new:
  IF content_hash exists in v_prev:
    inherit stats.fires, last_fired_at, accuracy
  ELSE:
    stats = 0 (courbe neuve)
```

### Scope agence — templates + inheritance par section

Trois niveaux d'ownership : `agence` (templates) / `persona` (clones) / `client` (hooks seulement).

**Inheritance granulaire par section :**
- Section héritée → grisée + verrouillée, badge "hérité de [template]"
- Bouton `Éditer localement` → copie au draft, `inherited_from = null`, devient indépendante
- Template évolue → notification par persona héritée → accept/reject par section

**Vue merge 3-way (v_prev hérité / v_new template / v_local persona) :** UX détaillée **déférée à un sous-spec** `2026-MM-DD-template-merge-ux-design.md` à produire avant le Sprint 5. Pour ce spec-ci, on scope uniquement la data : colonne `pending_template_version` sur `protocol_document` + endpoint de calcul du diff (3 versions vs. current draft). La décision UX (inline diff / side-by-side / section-by-section walk-through) n'affecte pas le modèle de données.

**Mutabilité opt-in (décision brainstorm) :** les personas n'héritent **pas automatiquement** des nouvelles versions de template. Agence pousse, setter valide. Évite qu'une modif template casse la voix d'un setter senior.

### Propagation agency-wide

| Origine | Remonte vers | Arbitre |
|---|---|---|
| Chat persona A | doc persona A | user persona A (setter) |
| Signal récurrent ≥3 personas | **template agence** | agence |
| Contradiction persona vs template | alerte agence | agence |
| Feedback client | doc persona + flag agence | setter + agence |

Cron d'agrégation sémantique des propositions cross-personas → escalade au template quand N≥3.

### Reporting

**Dashboard agence (in-scope) :**
- Portefeuille personas + health + version template
- Agrégats : props/sem moyen, accept rate, signaux agency-wide
- Top artifacts qui tirent
- Propositions agency-wide en attente

### Hooks client-facing (in-scope — data seulement, pas d'UI)

- `user.role: agency_admin | setter | client`
- `persona.client_share_token: uuid?`
- `persona.client_user_id: uuid?`
- `proposition.source` étendu : `client_validation`, `agency_supervision`
- `section.client_visible: bool`, `section.client_editable: bool`

**Lifecycle `client_share_token` / `client_user_id` :**
1. Agence génère le token (POST agency endpoint) → `client_share_token` set, `client_user_id` reste null.
2. Agence partage le lien `/train/{token}` au client.
3. Client clique → flow signup/auth → une fois authentifié, `client_user_id` est set à l'user créé/retrouvé, le token reste valide (permet des ré-accès depuis d'autres devices).
4. Agence peut révoquer : set `client_share_token = null`. L'user client perd l'accès à la persona. `client_user_id` conservé pour historique.
5. **Invariant :** `client_user_id != null ⇒ client_share_token était set à un moment` (jamais de pré-provisioning direct de `client_user_id`).

**Out-of-scope de ce spec (phase 2 dédiée) :**
- UI `/train/{token}` côté client
- Écran supervision async agence→setter
- Digest DM côté client
- Import Breakcold (cf. [project_voiceclone_integrations.md])

---

## Section 5 — Migration

Phasée, zéro downtime, réversible à chaque étape.

### Phase 0 — Ajout en parallèle (1-2j)

- Migration SQL : nouvelles tables créées
- `/api/protocol` legacy intact
- UI `ProtocolPanel.svelte` intacte
- Aucune écriture dans le nouveau modèle encore

### Phase 1 — Backfill idempotent

Script Node qui pour chaque `protocols` existant :
- Crée un `protocol_document` (version, status, owner_kind='persona')
- Crée une section `hard_rules` avec `prose = source_text OU résumé auto des rules`
- Crée les `protocol_artifact` (`kind=hard_check`) avec `content_hash` pour préservation stats
- Idempotent via `content_hash` (rejouable)

**Bonus opportuniste :** pour les personas avec playbook source brut disponible, lancer **tous les nouveaux extracteurs** sur le prose complet → propositions (non auto-activées) dans la queue. Sur le doc de Nicolas : ~30-50 propositions émergent le 1er jour.

**Fallback quand le playbook source brut n'existe pas :** aujourd'hui, le source text n'est pas toujours persisté (`protocols.source_text` peut être null pour de vieux protocols). Dans ce cas, la migration :
1. Crée la section `hard_rules` avec `prose = résumé auto-généré` des rules existantes (LLM call : "résume en prose FR ces règles atomiques comme si c'était une section de doc").
2. Ne lance PAS les autres extracteurs (pas de matière neuve à extraire au-delà des hard_checks déjà présents).
3. Affiche un bandeau dans l'UI : *"Ce protocole a été migré depuis un format précédent. Upload un playbook complet pour activer patterns/scoring/process."*

### Phase 2 — API v2 + shim

- Nouvelle `/api/v2/protocol/*` (CRUD complet)
- Ancienne `/api/protocol` devient shim read-only (lit nouvelle DB, formate legacy)
- Écriture legacy retirée
- `ProtocolPanel.svelte` continue à fonctionner via shim

### Phase 3 — UI cutover par persona (feature flag)

- Flag `flags.new_protocol_ui: persona_ids[]`
- Nouvelle UI visible uniquement pour personas flaggées
- Test sur 1 persona pilote d'abord
- Exercise du flow bout-en-bout sur Vercel preview URL **avant merge master** ([feedback_prod_without_ui_test.md])
- Rollout progressif

### Phase 4 — Cleanup

- Suppression ancien `ProtocolPanel.svelte`
- Archivage `/api/protocol`
- Tables `protocols` / `rules` → gardées read-only archive (pas de suppression)

### Garde-fous

| Risque | Mitigation |
|---|---|
| Re-extraction sort artifacts faux | Rien n'est auto-activé → queue Propositions arbitrable |
| Stats perdues | `content_hash` + test unitaire idempotence |
| Régression UI legacy | Feature flag par persona, tests smoke parallèles |
| Playbook source perdu | Fallback prose-résumé des rules existantes |
| Bug extracteur casse génération chat | Kill-switch `PROTOCOL_V2_GENERATION=false` |

### Ordre de construction (6 sprints)

| Sprint | Contenu | Vérif concrète |
|---|---|---|
| 1 | Infra data (migrations, backfill, API v2 read-only) | Persona existant lu via new API |
| 2 | Extracteurs + queue propositions (hard_rules, errors d'abord) + branchement signaux | Correction chat crée proposition pending |
| 3 | UI Doctrine + Registre + édition prose + SSE live | Flow complet sur 1 persona flaggée |
| 4 | UI propositions + versioning draft/active + stats preservation | Version bump préserve stats inchangées |
| 5 | Scope agence (templates, inheritance, dashboard, 4 hooks client) | Template v+1 notifie personas héritées |
| 6 | Extracteur self-improvement (training_example, cron régénération) | Test e2e : injecter 20 signaux jumeaux (embedding similarity ≥ 0.92) rejetés de suite → vérifier qu'un 21e signal identique produit une proposition avec `confidence < 0.5` (l'extracteur a appris à doubter) |

Chaque sprint = verif concrète sur Vercel preview + smoke test end-to-end avant merge master.

---

## Non-goals (dans le périmètre de ce spec)

Pour éviter la dérive pendant le planning/implémentation :

- **Pas d'offline mode** — l'UI suppose connexion (SSE activity feed, extraction LLM)
- **Pas d'export PDF** du doctrine (la surface principale reste l'app)
- **Pas d'i18n** au-delà du français
- **Pas de commentaires / review flow** sur les propositions (accept/reject/revise, point). Les discussions se passent hors outil.
- **Pas de diffing prose caractère-par-caractère** entre versions — on affiche sections ajoutées/modifiées/supprimées au niveau section, pas en mode word-diff.
- **Pas d'edit collaborative temps réel** sur le prose (un seul éditeur à la fois par draft, lock soft).
- **Pas d'A/B test intégré** d'artifacts (activer/désactiver reste binaire ; pas de "tester v5 sur 50% du trafic").
- **Pas de rollback automatique** sur régression statistique (si accuracy chute après publish, le user rollbacke manuellement).

Tout ce qui sort de cette liste mais apparaît pertinent pendant le planning = signal d'arrêt, on discute avant d'ajouter au spec.

## Décisions tranchées pendant le brainstorm

| Choix | Décision | Motivation |
|---|---|---|
| Structure protocol | Vues synchronisées (doc + rules) | Wahou bidirectionnel — doc grandit + règles s'activent |
| Croissance du doc | Propositions à arbitrer (B) | Doctrine signée = autorité ; aligne sur "every action trains" |
| Activity feed | Toujours visible à droite sur page Protocole | Wahou continu > bruit brut du FeedbackPanel actuel |
| "c'est ça" | Stats only, pas proposition | Évite queue polluée |
| Template mutabilité | Opt-in avec notification | Protège la voix des setters seniors |
| Phase 2 client UI | Scope data hooks only | Pas peindre le coin, laisser le vrai UI à un spec dédié |

## Mémoires utilisées

- [project_voiceclone_protocol_differentiator.md]
- [project_voiceclone_celebrate_signals.md]
- [project_voiceclone_supervision.md]
- [feedback_every_action_trains.md]
- [feedback_data_remontee_core.md]
- [feedback_unbounded_scale_by_design.md] (créée pendant ce brainstorm)
- [feedback_prod_without_ui_test.md]
- [feedback_clarity_in_guidance.md]

## Liens implémentation (à créer après)

- Plan d'implémentation détaillé : `docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md` (via skill `writing-plans`)
- Phase 2 client UI spec : `docs/superpowers/specs/YYYY-MM-DD-protocole-client-access-design.md` (spec ultérieur)
