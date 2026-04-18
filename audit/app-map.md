# app-map.md — VoiceClone

Source : audit code-based du worktree `gifted-snyder-43a617`, branch `claude/gifted-snyder-43a617`, commit `bc2b548`.

---

## 0. Stack & portée

- **Stack** : SvelteKit 2 + Svelte 5 (runes), Vercel serverless, Supabase Postgres + pgvector, Anthropic Claude (Sonnet/Haiku routé), embeddings Voyage-3.
- **Design system** : un seul, global (laboratoire). Les thèmes par persona sont explicitement désactivés (`applyTheme` = no-op dans `hub` et `chat`).
- **Auth** : code d'accès (`x-access-code`) + session token. Stores `accessCode`, `sessionToken`, `isAdmin` (`src/lib/stores/auth.js`). Pas de signup, pas de mot de passe, pas d'OAuth.
- **Landing publique** : `/` et `/guide`. Tout le reste gardé derrière l'auth (layout redirect, ligne `+layout.svelte:12-15`).

---

## 1. Routes (8 écrans)

### 1.1 `/` — Landing "laboratoire"
**Fichier** : `src/routes/+page.svelte` (900 lignes)
**But apparent** : démontrer le pipeline generate→check→rewrite→fidelity en boucle scriptée + porte d'entrée auth par code.
**Éléments** :
- Header : brand VoiceClone + heure UTC live + version build-hash + statut "en direct"
- Hero : headline italique vermillon + pitch
- Grid 2 colonnes :
  - Col 1 (main) : panel `01 prompt` (typewriter) + panel `02 sortie` (streaming pass1→checks→rewrite→stream2)
  - Col 2 (side) : panel `03 moteur de règles` (liste 6 règles) + `04 métriques en direct` (collapse_idx, ttr, kurtosis, q_ratio) + `05 fidélité` (score cosinus + seuil 0.720)
- Case-strip : pastilles de scénarios (3 scripts déroulés en boucle depuis `src/lib/landing-demo.js`)
- Footer : "accès" (input password code + flèche submit) + lien `/guide`

**Actions détectées** :
- Soumettre un code d'accès → redirect `/hub` (ou erreur "refusé")
- Cliquer "guide" → `/guide`
- Observer la démo (passive, 3 scénarios : passe propre, rewrite, drift — ~30s loop)

**Note** : si déjà auth, redirect automatique `/hub` au mount. Donc pour un user revenant, la landing ne s'affiche jamais.

---

### 1.2 `/hub` — Hub authentifié
**Fichier** : `src/routes/hub/+page.svelte` (564 lignes)
**But apparent** : choisir un clone parmi les siens ou les partagés, créer un nouveau clone, accéder admin/guide.
**Éléments** :
- Header minimal : brand "VoiceClone / hub" + compte de clones + badge admin si applicable
- Section "Mes clones" : liste de `.clone-card` (avatar + style-fingerprint SVG + nom + titre + `fidelity-chip` avec code couleur ok/warn/bad) + bouton "Partager" en haut à droite
- Section "Clones partagés" (si existants) : même format + badge "Partagé par X"
- Section "Nouveau clone" : card dashed action-card (visible seulement si `canCreateClone || isAdmin`)
- Section "Administration" : card action-card vers `/admin` (admin only)
- Section "Ressources" : card action-card vers `/guide`

**Actions détectées** :
- Clic sur une clone-card → `/chat/[id]` (ou premier scénario si un seul)
- Clic scenario dans card → `/chat/[id]?scenario=X`
- Clic "Partager" → POST `/api/share` → clipboard URL
- Clic "Créer un clone" → `/create`
- Clic "Dashboard admin" → `/admin`

**Note** : width maxi 620px — c'est une page centrée étroite, pas un dashboard.

---

### 1.3 `/create` — Funnel de création de clone (5-6 étapes)
**Fichier** : `src/routes/create/+page.svelte` (1000 lignes)
**But apparent** : collecter les données d'entraînement d'un nouveau clone et le générer.
**Structure flow** :
1. `calibration` : rubric 4 lignes (Profil, Posts, DMs, Docs) + input LinkedIn URL + bouton "Scraper" + lien "Continuer sans scrape →"
2. `type` : 3 type-cards (Posts / DMs / Les deux) avec emoji ✍️💬⚡
3. `info` : URL LinkedIn bis + prénom + titre & entreprise + bio textarea
4. `posts` (si type ≠ dm) : textarea 14 lignes avec format `---` séparateur + count-badge live (min 3)
5. `dm` (si type ≠ posts) : textarea 14 lignes format conversations `---`
6. `docs` : bouton lien "+ Ajouter des documents" → file input (.txt, .md, .csv, .pdf, .docx) + liste pending-files + recap final + bouton "Générer le clone"

**Actions détectées** :
- Scrape LinkedIn (POST `/api/scrape`)
- Auto-fill profil + 15 premiers posts
- Upload files (extraction client-side via `lib/file-extraction.js`)
- POST `/api/clone` (création persona)
- POST `/api/knowledge` (ingestion séquentielle de chaque fichier, LLM-heavy)
- Redirect `/calibrate/[id]` à la fin

**Progress bar** : affichée uniquement pour les steps `info` → `docs` (4 étapes visibles), `calibration` et `type` sont pré-steps invisibles.

---

### 1.4 `/calibrate/[persona]` — Calibration manuelle
**Fichier** : `src/routes/calibrate/[persona]/+page.svelte` (420 lignes)
**But apparent** : étalonner le clone juste après sa création en notant n essais générés par l'API.
**Éléments** :
- Header "VoiceClone / calibration" + compteurs `essais` et `notés`
- Manifest : headline "Calibration — étalonne le clone sur ton jugement"
- Liste `.trial` : pour chaque essai (POST `/api/calibrate` renvoie n messages) :
  - Header mono `essai:01` + contexte + badge score
  - Response markdown
  - 5 boutons 1-5 (rating) + textarea de correction optionnelle
- Actions : "Passer" (ghost) + "Valider la calibration →" (solid, PATCH `/api/calibrate`)

**Actions détectées** :
- Noter 1-5 chaque essai
- Laisser une correction textuelle
- Passer sans noter (ghost)
- Submit → redirect `/chat/[id]`

**Note** : le flow create pousse automatiquement vers cette page. Mais rien n'empêche de la quitter immédiatement.

---

### 1.5 `/chat/[persona]` — Chat (cœur de l'app)
**Fichier** : `src/routes/chat/[persona]/+page.svelte` (720 lignes) + 10 composants importés
**But apparent** : converser avec le clone, observer le pipeline en direct, corriger, ingérer de la connaissance, tester sur un prospect.
**Layout** :
- **ConversationSidebar** (gauche, 260px) avec 3 onglets :
  - `Connaissance` → `KnowledgePanel` (upload files + liste fichiers + chunks)
  - `Intelligence` → `IntelligencePanel` (fidélité score + thèmes + sparkline history + stats corrections/entités/relations/contradictions + LearningFeed)
  - `Conversations` → liste groupée par date + search + rename/delete + "Nouvelle conversation" + "← Changer de clone"
- **ChatCockpit** (header) :
  - Gauche : hamburger mobile + back + avatar persona + StyleFingerprint SVG + nom + scenario
  - Centre : 3 jauges (collapse_idx, fidélité cosinus, règles actives) + bouton "?" glossaire
  - Droite : 4 tab-btns : `règles`, `prospect`, `correction`, `réglages`
- **chat-messages** : stream de `ChatMessage` (user + bot) avec `MessageMarginalia` en colonne droite (stamp, timing, tokens, fidelity, rules fired, style fingerprint, toggle diff pass1)
- **ChatInput** : textarea Enter-to-send + bouton Envoyer
- **AuditStrip** (bottom) : session totals (elapsed, msgs, rewrites, drifts, tokens, cache rate) + narrative auto-générée

**4 panels latéraux** (right side drawers) :
- `RulesPanel` : catalogue complet `RULE_CATALOG` avec count/lastFired/detail par règle
- `FeedbackPanel` : correction → POST `/api/feedback type=regenerate` → 3 alternatives à picker
- `SettingsPanel` : budget + input clé API Anthropic custom + liste contributeurs
- `LeadPanel` : input URL LinkedIn → POST `/api/scrape` → injecte un message "contexte prospect" dans le chat

**CommandPalette** (overlay Cmd+K) : fuzzy search sur les conversations seulement.

**Raccourcis** :
- Cmd/Ctrl+K : palette
- Cmd/Ctrl+N : nouvelle conversation
- Esc : ferme le panel le plus récemment ouvert

**Actions détectées par message bot** :
- "Copier" (clipboard full message)
- "Corriger" → ouvre FeedbackPanel
- Par-bloc : "Copier ce bloc" si message multi-paragraphe
- Dans la marginalia : toggle diff pass1 si rewritten
- Validate via… pas visible dans ChatMessage user-side — seulement via l'action "Sauver comme règle" sur le message utilisateur (appelé `handleSaveRule` mais exposé juste dans chat/[persona] code)

**Actions sur message user** :
- "Sauver comme règle" (POST `/api/feedback type=save_rule`)

**Streaming** : via SSE, `src/lib/sse.js`, events : delta, thinking, rewriting, clear, done (avec telemetry violations/tokens/fidelity/live_style/model), conversation, error.

---

### 1.6 `/admin` — Dashboard admin
**Fichier** : `src/routes/admin/+page.svelte` (541 lignes)
**But apparent** : monitoring multi-client (tu es admin de la plateforme, pas l'utilisateur lambda).
**Éléments** :
- Header : back hub + "Admin" + bouton Rafraichir
- Section "Vue d'ensemble" : 6 stat-cards (Personas, Clients, Conversations 7j, Coût 24h, Corrections, Entités)
- Section "Clients" : data-table (Nom + tier, Dernier actif, Conv 7j, Tokens 7j, Budget avec barre)
- Section "Personas" : grid de cards (avatar + nom + client + stats conv/corrections/entités + fidélité)
- Section "Activité récente" : feed

**Actions** : refresh seulement. Read-only. Pas d'actions destructives (pas de ban, pas de reset budget).

**Auth guard** : redirect `/` si `!isAdmin`.

---

### 1.7 `/guide` — Guide d'onboarding
**Fichier** : `src/routes/guide/+page.svelte` (643 lignes)
**But apparent** : expliquer le produit à un nouvel utilisateur (ou à un prospect — la page est publique).
**Éléments** :
- Header : back + "Guide d'onboarding" + subtitle
- Section 01 "Le process d'onboarding" : timeline 5 étapes avec temps estimés (15+5+5+10 min + continu)
- Section 02 "Quoi mettre dans la base de connaissances" : 8 knowledge-cards collapsibles (Background, Positionnement, Audience, Offre, Lead magnets, Posts, DMs, Méthode) avec priority-badge (Essentiel/Important/Recommandé)
- Section 03 "La boucle de feedback" : 3 feedback-steps (Validez / Corrigez / S'améliore) + bloc "Conseils pour un clone au top" (5 bullets)
- CTA : "Commencer →" (vers `/` — landing) ou "Se connecter →" (même destination)

**Note** : page publique, accessible même non auth.

---

### 1.8 `/share/[token]` — Accepter un clone partagé
**Fichier** : `src/routes/share/[token]/+page.svelte`
**But apparent** : accepter un clone partagé via lien.
**États machine** : `loading` | `login` (code access requis) | `preview` (avatar + nom + "Ajouter à mes clones") | `already` ("Ce clone est deja dans votre liste") | `claimed` | `error`
**Actions** :
- Login (même code que landing)
- PUT `/api/share?token=X` → redirect ou affiche "claimed"

---

## 2. Composants dead code

Deux composants créés mais jamais importés (trouvés dans `docs/superpowers/plans/` comme spec d'un redesign antérieur) :
- `src/lib/components/PersonaCard.svelte` (61 lignes) — remplacé par les `.clone-card` inline dans `/hub`
- `src/lib/components/ScenarioPill.svelte` (43 lignes) — scenarios sont gérés inline dans `/hub` et le cockpit

À signaler — pas à supprimer sans demande explicite (cf. règles CLAUDE.md).

---

## 3. Architecture de données observée (via imports API)

| Ressource | Endpoint | Consommé par |
|---|---|---|
| Auth / personas list | `GET /api/personas` (header `x-access-code`) | landing, hub, share |
| Persona config + scenarios | `GET /api/config?persona=X` | hub, chat |
| Conversations CRUD | `/api/conversations` | chat sidebar + CommandPalette |
| Chat streaming | SSE `/api/chat` | chat |
| Fidelity score (single + batch) | `GET /api/fidelity?persona=X` ou `?personas=a,b,c` + `POST` recalc | hub, chat cockpit, IntelligencePanel |
| Knowledge files | `/api/knowledge` GET/POST/DELETE | create step docs, KnowledgePanel |
| Feedback / corrections / entities | `/api/feedback` | FeedbackPanel, IntelligencePanel, chat (validate/save_rule) |
| LinkedIn scrape | `POST /api/scrape` | create calibration/info, LeadPanel |
| Clone creation | `POST /api/clone` | create |
| Calibration trials | `POST /api/calibrate`, `PATCH /api/calibrate` | calibrate |
| Share | `POST /api/share` (create), `GET /api/share?token=X`, `PUT /api/share?token=X` | hub, share |
| Usage / budget | `GET /api/usage` | admin, SettingsPanel |
| Settings (own API key) | `POST /api/settings` | SettingsPanel |
| Contributors | `GET /api/contributors?persona=X` | SettingsPanel |

---

## 4. Navigation inter-écrans

```
/  (landing, auth)
├── [auth ok] → /hub
│
/hub
├── click clone → /chat/[id]
├── "+ Créer" → /create → [success] → /calibrate/[id] → "Valider" → /chat/[id]
│                                                     └── "Passer" → /chat/[id]
├── "Admin" (si admin) → /admin → "← Hub" → /hub
├── "Guide" → /guide
├── "Partager" → copy clipboard → destinataire ouvre /share/[token] → "Ajouter" → /hub

/chat/[id]
├── ← (onBack) → /  (puis layout redirect → /hub)
├── ConversationSidebar "← Changer de clone" → / (puis redirect /hub)
├── Cmd+K → CommandPalette → sélection → /chat/[id] (même chat, autre conv)
└── Aucun lien direct vers /admin, /guide, /create
```

**Point notable** : depuis le chat, pas de lien direct vers le hub (il faut passer par la flèche back qui retourne à `/` puis redirect). Pas de lien vers /create pour créer un second clone sans passer par le hub.

---

## 5. Checkpoints phase 1

- ✅ `/` — landing lab avec démo scriptée + auth footer — 5+ zones interactives
- ✅ `/hub` — liste clones + 4 sections (Mes / Partagés / Nouveau / Admin / Ressources) — max ~6 actions
- ✅ `/create` — funnel 6 étapes (2 pré + 4 visibles) — dépend du type choisi
- ✅ `/calibrate/[persona]` — n essais × (5 boutons + textarea) + 2 actions bas — ~12 actions sur un flow de 5 essais
- ✅ `/chat/[persona]` — 10 composants, 4 panels right, 1 sidebar left 3 onglets, 1 CommandPalette — **l'écran le plus dense de loin**
- ✅ `/admin` — 4 sections read-only + refresh — 1 action
- ✅ `/guide` — 3 sections marketing/pédagogie + CTA — ~10 knowledge-cards à déplier
- ✅ `/share/[token]` — 5 états + login fallback — 2 actions

**Écrans explorés : 8/8. Composants dead signalés : 2.**
