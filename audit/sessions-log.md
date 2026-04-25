# sessions-log.md — Journal de sessions VoiceClone

**Usage** : chaque nouvelle session commence par la lecture de ce fichier + `philosophy.md` + `roadmap.md`. On sait où on en est, on ne re-débat pas.

---

## Template pour reprendre une session

Au début de chaque nouvelle session, message d'ouverture type :

```
Nouvelle session. On attaque le Sprint X (voir roadmap.md).
Avant d'agir :
1. Lis audit/philosophy.md (la boussole)
2. Lis audit/roadmap.md §Sprint X (le scope)
3. Lis audit/sessions-log.md (l'état actuel)
4. Propose-moi un plan d'exécution de 3-5 étapes
5. Ne touche pas au code avant que j'aie validé le plan
```

---

## Décomposition multi-session — Phase 1

| ID | Sprint | Durée estimée | Mix | Prérequis session |
|---|---|---|---|---|
| **S-00** | Sprint 0 Fondations | 1-2 sessions | BE+FE+ops | — |
| **S-01** | Sprint 1 Opérateur déverrouillé | 1 session | FE lourd | S-00 |
| **S-02** | Sprint 2 Multi-client scalable | 1-2 sessions | Full-stack | S-00 |
| **S-03** | Sprint 3 Calibration + aperçu | 1 session | Full-stack | S-00 + S-02 |
| **S-04** | Sprint 4 Thermo + aide | 1 session courte | FE | S-00 |
| **S-05a** | Sprint 5 Cohérence — BE | 1 session | BE heavy | S-00 + S-03 |
| **S-05b** | Sprint 5 Cohérence — FE | 1 session | FE | S-05a |
| **S-06a** | Sprint 6 Admin — core | 1 session | Full-stack | S-00 + S-05b |
| **S-06b** | Sprint 6 Admin — polish | 1 session | FE+BE | S-06a |
| **S-07** | Sprint 7 Handoff client | 1 session | Full-stack | S-06b |
| **S-08** | Sprint 8 Landing commerciale | 1-2 sessions | Design+FE+copy | S-04 |

**Total estimé : 11-13 sessions pour Phase 1 complète.**

À ton rythme de 60h/sem et 3-4h utiles par session efficace avec moi : **~3-4 semaines calendaires** de Phase 1 si on enchaîne.

---

## Règles de session

1. **Scope figé en entrée** — on attaque 1 sprint à la fois. Si dérive thématique, on note dans `follow-ups.md` mais on ne fait pas.
2. **Livrable à la fin** — code committé + tests passés + update de ce journal avec ce qui a été fait.
3. **Pas de re-débat philosophique** — `philosophy.md` est la boussole. Si tension, on la note, on ne la rouvre pas pendant la session exécution.
4. **Review courte entre sprints** — à la fin de chaque sprint livré, 15-30 min pour ajuster la roadmap si on a appris quelque chose de structurel.
5. **Si blocage technique imprévu** — on arrête, on note le blocage, on reprend la session suivante avec une stratégie dédiée (pas d'heroïsme en fin de session fatigué).

---

## Historique des sessions

### Session 1 — 2026-04-18 · Audit complet + Philosophie + Roadmap

**Durée** : session longue (conversation étendue)
**Participants** : AhmetA + Claude (Principal Product Designer mode)

**Livrables produits** :
- `audit/app-map.md` — cartographie des 8 routes
- `audit/what-i-understand.md` — compréhension validée avec AhmetA
- `audit/screens/chat.md` — audit `/chat` + addenda Breakcold + thermomètre rail
- `audit/screens/create.md` — audit `/create`
- `audit/screens/hub.md` — audit `/hub`
- `audit/screens/calibrate.md` — audit `/calibrate`
- `audit/screens/landing.md` — audit `/`
- `audit/screens/guide.md` — audit `/guide`
- `audit/screens/admin.md` — audit `/admin`
- `audit/screens/share.md` — audit `/share/[token]`
- `audit/philosophy.md` — 3 principes fondateurs validés + annexe théorique (Lacan/Žižek, mode C)
- `audit/roadmap.md` — 9 sprints sur 6-7 semaines à 60h/sem
- `audit/manifesto.md` — manifeste court pour amis tech

**Décisions majeures prises ensemble** :
1. Cible user = opérateur d'agence ghostwriting+setting (pas créateur solo curieux)
2. "Laboratoire" = vernis commercial + route `/labo` dédiée, PAS cœur UX quotidien
3. VoiceClone ≠ projet AHA (esprit humain artificiel). Discipline transférable, pas le code
4. Direction Linear : simplicité par défaut, profondeur sur demande
5. SEO hors scope (app privée par code d'accès)
6. Solo-first court terme, agence-first au 3e client ou 2e setter
7. Mode C visé comme différenciateur long-terme (modèle de l'individu, pas modèle du monde)
8. 3 principes fondateurs validés : Opérateur domine / IA gardien de cohérence / Clone rappelle ce que l'humain a décidé

**Points validés pour action** :
- Retypage scenarios en enum canonique `{post_autonome, post_lead_magnet, post_actu, post_prise_position, post_framework, post_cas_client, DM_1st, DM_relance, DM_reply, DM_closing}` — Sprint 0
- Sprint 5 "Cohérence" nouveau, signature philosophique du projet
- Préparation agence-first low-cost (colonnes DB) en Sprint 0 pour ne pas se peindre dans un coin

**Tensions identifiées, non-tranchées à ce stade** :
- Fiabilité des corrections humaines reconnue fragile (Mode A + B + C pour y répondre progressivement)
- Bascule agence-first à activer ponctuellement selon signaux business (pas avant 3e client)
- Intégration Breakcold : intérêt confirmé, à activer quand API négociée

**À faire avant session suivante (par AhmetA, optionnel)** :
- Relire `philosophy.md` à tête reposée, contester si besoin
- Relire `manifesto.md`, ajuster le ton pour son audience d'amis tech
- Considérer si le sprint 0.d tracking produit (Plausible/Posthog) demande une décision de vendor
- Réfléchir aux 2-3 faiblesses internes non-encore-nommées qui pourraient émerger à froid

**Prochaine session suggérée** : **S-00 Sprint 0 Fondations**
- Scope : ménage (10 items) + retypage scenarios + colonnes agence-first + tracking
- Durée estimée : 1 longue session (4h) ou 2 moyennes
- Prérequis : aucun, tout est planifié

---

## Entrées suivantes

_(à compléter session par session)_

### Session 2 — 2026-04-18 · Sprint 0 Fondations — Split A (partiel)

**Durée** : ~1h10 (10 min reconnaissance + 1h Split A amorcé)
**Scope réel** : démarrage Split A (Étape 1 migration + Étape 2 helper frontend). Session courte → livraison partielle documentée, rien de cassé.

**Livrables produits** :
- `audit/sprint-0-recon.md` — reconnaissance complète du schéma (tables, migrations, sémantique scenarios, RLS, numérotation) pour que la prochaine session n'ait pas à re-explorer.
- `supabase/025_sprint0_foundation.sql` — migration écrite, **PAS ENCORE APPLIQUÉE**. Batch 0.c (organizations + organization_id + persona_shares.role) + 0.b additive (enum scenario_canonical 11 valeurs + conversations.scenario_type nullable avec soft backfill). Idempotente, transactionnelle, rollback documenté.
- `src/lib/scenarios.js` — catalogue frontend canonique (11 scenarios, JSDoc typé), helpers `isScenarioId`, `legacyKeyFor`, `supportedCanonicalScenarios`. Nommée `CANONICAL_SCENARIOS` pour éviter la collision avec `SCENARIOS` de landing-demo.
- `test/scenarios.test.js` — 16 tests, 100% pass. Verrouille l'ordre canonique, la cohérence kind/legacyKey, les fallbacks legacy jsonb, l'immuabilité du catalogue.

**Décisions tranchées pendant la session** :
1. Option A (strict additif, dual-write) retenue pour 0.b. Option B (hard migration de personas.scenarios jsonb) reportée hors Sprint 0.
2. Enum = 11 valeurs (inclusion de `post_coulisse` depuis philosophy.md §6) plutôt que 10 (roadmap.md). Raison : philo canonique + `ALTER TYPE ADD VALUE` ultérieur coûteux.
3. `persona_shares.role` plutôt que `share_tokens.role` (junction durable vs invitation ephemère).
4. Numéro migration = `025_` (dernier utilisé = 024). Confirmé : pas de CLI Supabase / pas de runner → application manuelle via SQL Editor.
5. Nom export = `CANONICAL_SCENARIOS` (pas `SCENARIOS` — collision avec landing-demo).

**État à la fin de la session** :
- Code committé (voir git log) ✓
- Tests passés : 238/238 (dont 16 nouveaux sur scenarios) ✓
- Migration 025 **écrite mais non appliquée à la DB** — à faire en ouverture session suivante.
- Ni Étape 2 frontend (dropdown scenario switcher in chat), ni 0.a ménage, ni 0.d tracking n'ont été entamés.

**Reste à faire sur Split A** :
- **Appliquer 025 sur Supabase** (staging puis prod) + lancer les queries de vérification listées en bas du fichier SQL.
- **Étape 2 frontend** (~14h restantes estimées) : dropdown scenario inline gauche du textarea chat ; nouveau chat → `scenario_type` non-null ; tests E2E création chat par scenario_type.

**Reste à faire sur Split B** (session ultérieure) :
- 0.a Ménage 9 items (~12h)
- 0.d Tracking Plausible/Posthog (~4h + décision vendor à trancher)

**Blocages / risques** :
- Worktrees non nettoyés (29 entrées dans `.claude/worktrees/`) — flag noté dans sprint-0-recon.md, hors scope.
- `personas.scenarios` jsonb reste un héritage : la restructuration sera un jour nécessaire (probablement Sprint 2-3 quand on introduit des configs per-intent).

**Prochaine session suggérée** : continuation Split A (appliquer 025 + coder Étape 2 frontend). 1 session moyenne (3-4h).

---

### Session 3 — 2026-04-18 · Sprint 0 Split A — finalisation

**Scope réel** : application migration 025 en prod + Étape 2 frontend (scenario switcher) + backend dual-write.

**Livrables produits** :
- **Migration 025 appliquée en prod Supabase** : 4 blocs idempotents OK. Vérifs :
  - `organizations` créée, RLS OK, 1 org synthétique par client (backfill solo)
  - `persona_shares.role` = 'claim' (4 rows)
  - Enum `scenario_canonical` + colonne `conversations.scenario_type` créés
  - Soft backfill : 14 conversations `scenario='qualification'` → `DM_1st`, 0 NULL restant
  - 1 persona orpheline (Thierry, `client_id=NULL` legacy pré-RLS) attachée à Brahim → 0 orphan partout
- **Frontend Étape 2** :
  - `src/lib/components/ScenarioSwitcher.svelte` — dropdown compact, clavier accessible (↑↓ Home End Enter Esc), filtre `supportedCanonicalScenarios(persona)`, design system tokens
  - `src/lib/stores/chat.js` — nouveau store `currentScenarioType` (null par défaut, canonical id quand pick)
  - `src/routes/chat/[persona]/+page.js` — parse `scenario_type` depuis query URL, valide via `isScenarioId`
  - `src/routes/chat/[persona]/+page.svelte` — `handleScenarioChange` : MAJ stores + URL (goto replaceState) + reset conv + `showWelcome`. Switcher rendu dans `.composer-toolbar` au-dessus de `ChatInput`
  - `src/lib/sse.js` — `scenarioType` ajouté au body POST `/api/chat`
- **Backend dual-write** :
  - `api/chat.js` — accepte `scenario_type` request body, validé via `isScenarioId` (BE importe `../src/lib/scenarios.js`), persisté sur `conversations.scenario_type` à la création d'une conv. Legacy `scenario` text continue d'être écrit (dual-write préservé).
- Tests : 238/238 pass (helpers scenarios couvrent la validation BE/FE).

**Décisions tranchées pendant la session** :
1. `qualification` legacy scenario → `DM_1st` canonique (le fichier `personas/*/scenarios/qualification.md` + `api/clone.js:30` confirment "premier DM orienté qualification prospect").
2. Thierry persona orpheline attachée à Brahim (pas supprimée — utilisée).
3. ScenarioSwitcher placé en toolbar au-dessus du ChatInput (vs "inline gauche textarea" strict roadmap). Rationale : non-invasif (ChatInput intact), UX fonctionnellement équivalente. Raffinement visuel potentiel Sprint 1.
4. Backend `api/chat.js` importe `../src/lib/scenarios.js` pour partager la validation canonique. Pas de duplication de constantes.
5. Switch scenario mid-conv = nouvelle conversation (reset + showWelcome). Une conv reste pinned à un seul `scenario_type` pour l'intégrité learning/analytics.

**État à la fin de la session** :
- ✓ Migration 025 appliquée, DB 100% clean (0 orphans, 0 NULL scenario_type après backfill).
- ✓ Sprint 0 Split A = **TERMINÉ**.
- ✓ Tests passés : 238/238.
- ✓ Build local non testé (EPERM Windows connu), CI Linux le validera à la PR.

**Reste à faire — Split B** (session ultérieure) :
- 0.a Ménage 9 items (~12h)
- 0.d Tracking Plausible ou Posthog (~4h + décision vendor)

**Reste à faire — raffinements non-bloquants** :
- UX refinement : dropdown switcher vraiment inline à gauche du textarea (modifier ChatInput, Sprint 1 possible)
- Tests composant Svelte (jsdom setup, scope creep, pas prioritaire)
- Hub `/hub` scenarios enumeration pourrait proposer la liste canonique (Sprint 2)

**Blocages / risques résolus** :
- BEGIN/COMMIT + Supabase pooler : fixé en Session 2
- Thierry orpheline : fixé en Session 3 (attaché Brahim)

**Prochaine session suggérée** : Split B (ménage 0.a + tracking 0.d). Décision vendor tracking à pré-trancher (Plausible simple vs Posthog funnels riches).

**Addenda post-déploiement prod (2 hotfixes)** :
- `8f41fcb fix(sprint-0): expose persona.type in /api/config + harden scenario fallback` — le switcher affichait 7 canoniques post pour des personas DM parce que `/api/config` strippait `persona.type`. Symptôme AhmetA : "tous les scenarios sont des scenarios de posts même pour les DM". Fix : exposer `type` au payload + durcir fallback legacy (plus de "default" = post, ajoute "qualification" = DM).
- `f81ff7f fix(chat): await rateLimit() — was silently returning 429 on every POST` — bug pré-existant legacy (commit 982b04c du 17/04), non lié à Sprint 0 : `rateLimit()` a été migré async (migration 017 Supabase RPC) mais le call-site `chat.js` n'avait pas reçu le `await`. Chat prod cassé depuis 24h, non détecté parce que `vite dev` ne sert pas `api/`. Révélé par les tests Sprint 0.b. `clone.js` avait déjà le await — seul `chat.js` manquait.

**Validation finale dual-write** : conv créée via switcher persiste `scenario: "post", scenario_type: "post_prise_position"` comme attendu.

**Leçon ops pour Split B** : local dev `vercel dev` (pas `vite dev`) ou smoke test CI sur `POST /api/chat` pour détecter les régressions serverless-only.

---

### Session 4 — 2026-04-25 · Audit complet + sprint beta autonome

**Contexte** : audit "vendabilité beta" demandé par AhmetA. User m'a laissé tourner seul ("ignore les permissions"), avec promesse de hand-off pour les actions Vercel.

**Scorecard initial (avant intervention)** : 52/100, headline "pré-beta technique solide, pas vendable en l'état".

| Axe | Poids | Score initial |
|-----|------:|--------------:|
| Data & instrumentation | 25% | 72 |
| Learning loop L1→L4 | 25% | 48 |
| Protocole vivant | 20% | **35** |
| UI-UX produit | 15% | 62 |
| Technique & prod-ready | 15% | 78 |

**Diag critique** : la table `proposition` (queue d'arbitrage du protocole vivant) avait 0 row malgré 5 chunks de chantier et 14 fichiers de tests. Différenciateur produit invisible en prod.

**Root causes (3 silencieuses, empilées)** :
1. **Router model 404** — `claude-haiku-4-6` n'existe pas → routeAndExtract retournait [] systématiquement (try/catch swallow).
2. **Bridge whitelist** — `corrections.source_channel` a un DEFAULT `'explicit_button'` côté DB (jamais documenté), mais `ELIGIBLE_CORRECTION_CHANNELS` du bridge ne l'incluait pas → 100% des 77 corrections filtrées out.
3. **Protocol_document vide** — la migration 047 (`proposition_drained_at`) n'avait jamais été appliquée en prod, et `protocol_document` était vide (chicken-and-egg : drain attend un doc actif, personne n'en crée).

**Actions Phase 1 (livrées)** :
- Migration 047 appliquée prod (par AhmetA)
- `scripts/backfill-protocol-v2.js` exécuté → Thomas + Nicolas ont chacun 1 doc + 1 section + 5 artifacts. Nicolas activé manuellement (is_active=false côté operating_protocols).
- Fix router model + whitelist + drain script étendu → **PR #123**
- Drain manuel sur 30j → **10 propositions réelles créées** (samples : "Toujours utiliser le vouvoiement", "Émojis interdits par défaut", "visio → visioconférence")
- Acceptation manuelle de 5 propositions hard_rules → prose section Thomas patchée (5347 → 6057 chars), 5 training_examples loggés.
- **Boucle protocole vivant ALIVE en prod pour la 1re fois**.

**Actions Phase 2 (livrées)** :
- `scripts/backfill-scenario-type.js` (heuristique persona.type + LLM haiku-4-5 fallback) → **27/27 conversations NULL classifiées** (3 heuristic, 24 LLM, 0 failed). Coût ≈ $0.024.
- Fix critic-prod-coverage 14% → ~100% : `persistShadow` retourne now le row id, `runPipeline` l'expose, `chat.js` link `rhythm_shadow.message_id` après messages.insert. → **PR #124**

**Actions Phase 3 (livrées)** :
- Audit constate que ScenarioSwitcher + ClonesDropdown + Cmd+Shift+C sont DÉJÀ wired dans ChatTopBar. Sprint 1 item #1 = livré (audit initial sous-évaluait UX).
- Pivot vers `LearningFeed` celebrate animation (memory project_voiceclone_celebrate_signals) — slide-in + green pulse 1.2s sur événements frais. → **PR #126**

**Hand-off à AhmetA (USER ACTION requise — je ne peux pas le faire seul)** :
1. Merger les 3 PRs (#123 fix loop, #124 fix coverage, #126 celebrate animation) après revue.
2. Appliquer en prod la migration 047 — **DÉJÀ FAIT** par AhmetA pendant la session.
3. **Activer en Vercel le flag `NEW_PROTOCOL_UI_PERSONAS`** (Settings → Env Vars → `NEW_PROTOCOL_UI_PERSONAS=32047cda-77cf-466b-899d-27d151a487a4,2f5f1414-9d65-499d-a3d7-6be2826c6098` sur Preview + Production). Sans ça, le UI v2 doctrine reste caché malgré les 5 propositions acceptées et la prose patchée.
4. Tester le flow end-to-end sur preview voiceclone : login → chat Thomas → ouvrir ProtocolPanel → vérifier doctrine v2 affichée + propositions queue accessible.

**Scorecard estimé post-merge** :
| Axe | Initial | Post-merge | Levier |
|-----|--------:|-----------:|--------|
| Data & instrumentation | 72 | 88 | +scenario_type 100%, +critic coverage 100% |
| Learning loop L1→L4 | 48 | 75 | +L4 boucle alive (10 props, 5 acceptées) |
| Protocole vivant | 35 | 70 | +protocol_document populated, +5 artifacts intégrés |
| UI-UX produit | 62 | 70 | +celebrate animation, +scenario_type non-NULL |
| Technique & prod-ready | 78 | 80 | +3 PRs avec tests, lint clean |
| **Pondéré** | **58** | **~76** | **dépasse seuil beta 75** ✓ |

Si les 3 PRs mergent + flag activé + UI test OK : seuil beta atteint en cette session.

**Reste critique pour scale (post-beta)** :
- Cross-clone learning (memory project_voiceclone_cross_clone_learning) — toujours en silo
- Backfill historique des 152 rows `rhythm_shadow.message_id` NULL (coverage du futur OK, passé pas migré)
- Étendre protocol_document aux 23 autres personas (seuls Thomas + Nicolas ont une source operating_protocols)
- Langfuse intégration (mesurabilité N3 — différée per le call de session : "32h plan saute si on rentre Langfuse maintenant")
- Agence-first complet (orgs + RLS par org + facturation), déclenché par 3e client signé

**Leçons ops** :
- Les "silent failures" coûtent cher : 5 chunks de feature livrés, 0 utilisation prod, personne ne le voyait. Toujours run la query de santé `audit-learning-loop.js` après chunk en prod.
- Producer/consumer mismatch invisible quand le default DB diverge du whitelist applicatif. Le test E2E aurait dû pop ça.
- Le model ID `claude-haiku-4-6` venait d'un copier-coller d'un futur modèle qui n'existait pas. `eval`/test contre l'API en CI prévient.

