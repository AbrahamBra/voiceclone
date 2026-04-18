# audit/roadmap.md — Plan incrémental VoiceClone (révisé post-philosophie)

**Source** : synthèse des 8 audits Phase 3 + [philosophy.md](philosophy.md).
**Horizon** : 9 sprints sur ~5-6 semaines à 60h/sem (ton budget confirmé).
**Adjacence** : Phase 2 optionnelle derrière (axe intents posts, agence-first complet, mode C signatures implicites).

---

## Principes directeurs

1. **Chaque feature passe le filtre philosophy.md** : sert l'opérateur quotidien ? respecte la voix ? supporte l'incohérence humaine ? laisse auditer/révoquer ? Si non → reformuler ou reporter.
2. **Un sprint = un bundle cohérent livrable indépendamment.**
3. **Chaque sprint doit améliorer l'app, même si on s'arrête là.**
4. **Quick wins avant refontes radicales.** Version A avant Version B.
5. **Ne pas déclencher un sprint qui dépend d'un autre non-livré.** (Les dépendances sont marquées.)
6. **Mesurer avant/après.** Chaque sprint a une métrique. Tracking produit en Sprint 0.

---

## Sprint 0 — Fondations (5 jours à 12h/jour = 1 semaine)

**Objectif** : éliminer la friction facile, préparer l'avenir structurel, brancher la mesure.

### 0.a — Ménage (10 items, ~12h)

| Item | Écran | Effort |
|---|---|---|
| Swap "type" step 1 + kill step calibration | /create | 1h |
| Un seul scrape input (supprimer doublon) | /create | 1h |
| Personas triées fidélité ASC + badge couleur | /admin | 2h |
| Rating 3 options (👍/🤔/👎) | /calibrate | 1h |
| Header contextualisé (client/type) | /calibrate | 1h |
| Identité du partageur visible | /share | 1h |
| État `claimed` → "Ouvrir chat direct" | /share | 1h |
| "+ Créer" promu en header hub | /hub | 1h |
| Supprimer `PersonaCard`, `ScenarioPill` (dead) | src/lib | 30min |
| ~~Meta SEO complet~~ | ~~retirée~~ | SEO hors scope |

### 0.b — Retypage scenarios canoniques (~16h)

Pré-requis pour Sprint 4 (thermo conditionnel) et la future architecture intents posts.

- Backend : migrer `scenarios` libre → enum canonique `{post_autonome, post_lead_magnet, post_actu, post_prise_position, post_framework, post_cas_client, DM_1st, DM_relance, DM_reply, DM_closing}`. Migration douce (existing personas gardent leur scenario libre, mappé au plus proche).
- Frontend : scenario switcher inline dans l'input chat (dropdown à gauche du textarea).
- Métrique : tout nouveau chat est créé dans un scenario typé.

### 0.c — Préparation agence-first (low-cost) (~8h)

Ne PAS livrer l'agence-first complet maintenant — juste ne pas se peindre dans un coin.

- Ajouter colonne `organization_id` (default = une org par user solo) sur `personas`, `clients`, `conversations`
- Ajouter colonne `role` sur `shares` (default = "claim")
- Pas de logique UI encore. Juste du schéma qui attend.
- Justification : quand tu signes ton 3e client ou recrutes ton 2e setter, tu auras juste à **activer** la logique, pas refactorer partout.

### 0.d — Tracking produit (~4h)

- Brancher Plausible ou Posthog self-hosted (~1h setup)
- Events custom sur les 5-6 flows critiques : `clone_created`, `message_sent`, `correction_submitted`, `share_created`, `share_claimed`, `scenario_switched`
- Dashboard simple pour mesurer les sprints suivants
- **Sinon on vole à l'aveugle et on ne sait jamais si un sprint a servi à quelque chose.**

**Total Sprint 0 : ~40h ≈ 1 semaine à ton rythme.**

---

## Sprint 1 — Opérateur déverrouillé (5 jours)

**Objectif** : le quotidien de l'opérateur cesse de saigner.
**Philo** : Principe #1 (opérateur domine).

1. **Switch clones inline dans cockpit** — dropdown + raccourci Cmd+Shift+C (12h)
2. **"Corriger" promu en action primaire inline** — bouton solid vermillon sous chaque message bot (6h)
3. **Copier LinkedIn-ready + menu copy** — plain / markdown / linkedin-ready par défaut (6h)
4. **Compteur cible char contextuel** — `🎯 1200-1500` post / `🎯 150-280` DM (2h)
5. **AuditStrip repliée par défaut** (2h)
6. **3 jauges cockpit → un badge `style health` unique** (4h)

**Dépendance** : aucune.
**Métrique** : switch clone de 3 clics → 1 clic. Taux corrections par conv bot ×2.

---

## Sprint 2 — Multi-client scalable (5 jours)

**Objectif** : tenir à 20+ clients. Base de l'agence.
**Philo** : Principe #1 + dette agence-first à rembourser.

1. **Champ `client` / `tag` dans `/create` step info** (6h : 3 BE + 3 FE)
2. **Hub Version A : search + Cmd+K + récents + filtres + grille responsive** (20h)
3. **"Dupliquer depuis clone existant"** — overlay template (10h)
4. **Upload fichier pour posts/DMs** — .txt .csv .md parsing (10h)
5. **Filtres conversations dans `/chat` sidebar** — pills posts/DMs/flag (4h)

**Dépendance** : Sprint 0.c (colonnes org).
**Métrique** : switch clone à 8 clients de ~8s à ~2s. Capacité scalable jusqu'à 40 clones.

---

## Sprint 3 — Calibration + aperçu style (4 jours)

**Objectif** : clones de qualité dès la sortie, pas au 3e retry.
**Philo** : Principe #2 (l'IA gardien, pas obéissant aveugle) + Principe #3 (auditabilité).

1. **Aperçu du style avant "Générer"** dans /create — 3 métriques client-side + bouton "🔮 Aperçu" Haiku (12h)
2. **Contextes calibration dérivés du type + domaine** — remplacer les 5 contextes hardcoded (8h BE)
3. **Split view corpus source dans `/calibrate`** — RAG Voyage-3 existant (12h)
4. **Régénération par essai** — bouton `↺`, hard-cap 3 (4h)
5. **Rollback de règles** (nouvelle feature) — dans IntelligencePanel, liste règles actives + bouton révoquer (8h)

**Dépendance** : Sprint 0.b (scenarios typés).
**Métrique** : clones regénérés <24h après création -50%. Taux essais calibration corrigés +35 pts.

---

## Sprint 4 — Thermomètre conditionnel + aide contextuelle (3 jours)

**Objectif** : finir le thermomètre, brancher l'aide in-app.
**Philo** : Principe #1 (vernis hors de la route productive).

1. **Thermomètre conditionnel au scenario** — `{#if scenario.startsWith('DM')}` (1h — trivial avec scenarios typés)
2. **Bouton `?` contextual help dans cockpit chat** — overlay slide-in sur `/guide#ancre` (4h)
3. **Renommer tab `prospect` → `brief`** (30min)
4. **Guide : filtre audience + TOC flottante + FAQ + exemples réels** (16h)

**Dépendance** : Sprint 0.b (scenarios typés).
**Métrique** : tickets support opérateur -30%.

---

## Sprint 5 — Cohérence (NOUVEAU, 5 jours)

**Objectif** : faire exister le Principe #2 et #3 dans le code. C'est **le sprint signature du projet**.
**Philo** : Principes #2 et #3, Mode A + embryon Mode B de l'annexe théorique.

1. **Tagger chaque correction par contexte** — ajouter `{intent, scenario, persona_state_snapshot}` au stockage (6h BE + migration)
2. **Détecteur de contradictions** — cron hebdo qui cherche les paires de corrections contradictoires par embedding similaire + verdict opposé (16h BE)
3. **Dashboard `Cohérence` dans IntelligencePanel** — liste des contradictions détectées, bouton "trancher" (8h FE)
4. **Mode B embryonnaire : abstraction active** — quand 3+ corrections atomiques similaires détectées, proposer règle abstraite à valider (12h full-stack)
5. **Historique + audit trail des règles** — qui / quand / dans quel contexte / taux d'application (8h)

**Dépendance** : Sprint 0.b (scenarios typés, pour le tagging contexte) + Sprint 3 (calibration pour alimenter en données).
**Métrique** : contradictions détectées (signal de santé du feedback loop). Taux de règles révoquées volontairement (signal d'honnêteté de l'humain qui revisit).

**Commentaire** : c'est ici que VoiceClone devient **vraiment** différent d'un wrapper Claude. Sans ce sprint, tout le discours sur "l'IA maintient la cohérence que l'humain ne maintient pas" reste vaporeux.

---

## Sprint 6 — Admin manager (7 jours)

**Objectif** : directeur d'agence sort du chaos.
**Philo** : Principe #3 (auditabilité) + rôle secondaire lead agence.

1. **Bandeau alertes priorisées + endpoint `/api/admin/alerts`** — drift, budget >80%, inactivité, contradictions non-tranchées (Sprint 5) (16h)
2. **Stat-cards avec delta + sparkline** (10h)
3. **Table clients sortable + filtrable + actions** — reset budget, message, archive, drill-down (20h)
4. **Export CSV clients + activité** (6h BE)
5. **Width étendue + responsive** (6h)
6. **Bouton `+ Inviter un client`** (10h)

**Dépendance** : Sprint 0.c (colonnes org) + Sprint 5 (alertes cohérence).
**Métrique** : temps détection incident 60s → 5s.

---

## Sprint 7 — Handoff client (4 jours)

**Objectif** : le client final qui reçoit un share-link a un vrai onboarding.
**Philo** : Principe #1 (opérateur) étendu au client final — simplicité maximale.

1. **Flow signup nouveau client via token** — sans code préalable (14h)
2. **Preview enrichie** — stats + échantillons (10h)
3. **Token expiration + affichage** (8h)
4. **Révocation depuis admin** (10h)
5. **État `error` actionnable + contact agence** (4h)

**Dépendance** : Sprint 6 (admin avec actions pour révoquer).

---

## Sprint 8 — Landing commerciale (5 jours)

**Objectif** : convertir des prospects agence, pas juste impressionner des devs.
**Philo** : séparation lab / produit rappelée dans philosophy.md §2.

1. **Hero commercial + 2 CTA + navbar** (10h)
2. **3 scenarios remplacés par 3 vrais cas anonymisés** — tirer des fixtures heat (10h)
3. **Masquer TTR/kurtosis par défaut + toggle "mode tech"** (4h)
4. **Bandeau logos clients + métriques agence** (6h, assets agence)
5. **Section process + pricing + cas client + FAQ + footer support** (20h)

**Dépendance** : Sprint 4 (badge style health cohérent entre app et landing).
**Métrique** : taux clic CTA "Book demo" > 2%.

---

## Récap temporel — Phase 1

| # | Sprint | Durée | Dépendance | Livrable |
|---|---|---|---|---|
| 0 | Fondations | 5j | — | Ménage + scenarios typés + tracking + prépa agence-first |
| 1 | Opérateur déverrouillé | 5j | 0 | Switch + Corriger + Export |
| 2 | Multi-client scalable | 5j | 0c | Hub + client tag + dupliquer |
| 3 | Calibration + aperçu | 4j | 0b | Clones bons dès la sortie |
| 4 | Thermo conditionnel + aide | 3j | 0b | UI cohérente + help |
| 5 | **Cohérence** | 5j | 0b + 3 | **Mode A + B détection + abstraction** |
| 6 | Admin manager | 7j | 0c + 5 | Cockpit actif |
| 7 | Handoff client | 4j | 6 | Onboarding client |
| 8 | Landing commerciale | 5j | 4 | Conversion prospect |

**Phase 1 totale : ~43 jours = 6-7 semaines à 60h/sem.**

---

## Phase 2 — Montée en profondeur (optionnel, déclenchable)

À déclencher **après** Phase 1 livrée ET stabilisée (1-2 mois d'usage réel).

### Axe "Intents posts — profondeur architecturale"
Le retypage Sprint 0 a déjà fait les enum. Phase 2 = construire autour :
- Sources différenciées par intent (RSS news pour `post_actu`, lead magnet library, frameworks doc, etc.)
- Critics per intent (pas de CTA sur post_autonome, CTA obligatoire sur lead_magnet, etc.)
- Scoring performance per intent
- ~15 jours dev

### Axe "Agence-first — activation complète"
Déclencheur : 3e client signé ou 2e setter recruté.
- Organizations + rôles (owner / operator / client_viewer) activés
- RLS Postgres par org
- UI multi-org (switcher, permissions visibles)
- Facturation par organization
- ~10 jours dev

### Axe "Mode C — découverte signatures implicites"
Déclencheur : Sprint 5 Cohérence stabilisé + corpus de données suffisant.
- Extraction de patterns statistiques dans le corpus source non-capturés par TTR/kurtosis
- Détection de signatures latentes (position des questions rhétoriques, alternance rythmique, etc.)
- Proposition à l'humain de nommer/préserver/contrer
- Extension du RhythmCritic Mahalanobis
- ~15-20 jours dev

### Axe "Intégration Breakcold / sales engagement"
Déclencheur : négociation API + volume DM suffisant.
- Import conversations DM depuis Breakcold
- Push draft → Breakcold (action depuis chat)
- Scoring performance via callbacks Breakcold (RDV booké, lead converti)
- ~10 jours dev + intégration

### Refontes Version B des audits
Déclenchables une par une, si Version A ne scale plus :
- Rail vertical clones dans /chat (kill hub comme sélecteur)
- Fiche client unique `/create` avec autosave
- Dissolution `/calibrate` dans chat
- Dashboard portefeuille `/hub` = `/admin` mergé
- Onboarding client 4 écrans `/bienvenue/[token]`

---

## Métriques à tracker en continu (branchées Sprint 0.d)

| Métrique | Cible | Lecture |
|---|---|---|
| Temps switch clone | < 3s | Event timing |
| Taux corrections / bot msg | > 0.3 | Event ratio |
| Nombre clones actifs / opérateur | Seuil scalabilité | Count distinct |
| Clones regénérés < 24h après création | < 10% | Timeline events |
| Taux claim → first message < 10min | > 50% | Event funnel |
| Contradictions détectées / semaine (Sprint 5+) | — | Baseline à établir |
| Règles révoquées volontairement | — | Baseline à établir |

---

**Roadmap vivante. Re-évaluer après chaque sprint : est-ce qu'on apprend quelque chose qui change le suivant ?**
