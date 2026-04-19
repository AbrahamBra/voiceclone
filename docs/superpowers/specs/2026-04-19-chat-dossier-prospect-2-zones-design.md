# Chat — Dossier prospect à 2 zones — Design Spec

**Date:** 2026-04-19
**Status:** Draft v2 (revu après spec-review 2026-04-19)
**Supersedes partially:** `2026-04-18-thermometre-rail-design.md` (le rail heat est démoli au profit d'un rail feedback ; le signal heat migre en indicateur dans le header dossier)
**Relation avec migrations existantes :**
- `supabase/027_message_type.sql` (déjà déployée) introduit `messages.message_type` ∈ {`chat`, `meta`} pour séparer la DM simulation des confirmations système. **Orthogonal à cette spec** — on ne touche pas à 027. Le nouveau champ `turn_kind` (ci-dessous) vit sur l'axe "rôle narratif" (prospect/draft/envoyé) et ne remplace ni ne redéfinit `message_type`.
- `supabase/021_prospect_heat.sql` calcule la heat sur `role='user'`. Comme on garde `role` intact (user/assistant) et qu'on ajoute `turn_kind` orthogonal, le calcul heat existant reste valide (`role='user' AND turn_kind='prospect'`).
- `supabase/017_learning_events.sql` (table `learning_events`) est **persona-scoped**, pas conversation-scoped, payload très typé (rule_added/consolidation_run). **Pas adapté** au feedback-rail conversation-scoped : on crée une nouvelle table `feedback_events` conversation-scoped qui référence `learning_events` par FK quand une correction déclenche un rule_added.

**Files:**
- modified `src/routes/chat/[persona]/+page.svelte` — layout repensé (header dossier pinné + thread + rail feedback)
- new `src/lib/components/ProspectDossierHeader.svelte` — header pinné (nom, stage, dernier contact, note, chaleur, ScenarioSwitcher)
- new `src/lib/components/FeedbackRail.svelte` — zone B (journal feedback + pill règles actives)
- new `src/lib/components/ChatComposer.svelte` — composer hybride (ajouter prospect / draft la suite) remplace ChatInput
- modified `src/lib/components/ChatMessage.svelte` — rendu par `turn_kind` (`prospect`/`clone_draft`/`toi`/legacy fallback), actions ✓/✎/↻/📋 sur drafts uniquement
- modified `src/lib/components/ChatCockpit.svelte` — allégé (identité + pill style-health + ⚙ brain link), métriques dégagées
- modified `src/lib/components/FeedbackPanel.svelte` — reste le slide-over pour corrections longues + picker 3 alternatives, triggered par clic ✎ sur un `clone_draft` ; sa soumission crée une entrée `feedback_events` type `corrected`
- modified `src/lib/components/ScenarioSwitcher.svelte` — déplacé dans `ProspectDossierHeader` (plus dans composer-toolbar)
- deleted `src/lib/components/LiveMetricsStrip.svelte` — 100% doublon
- deleted `src/lib/components/AuditStrip.svelte` côté chat (supprimé de `+page.svelte`) ; déplacement vers `/admin` hors scope de cette spec
- deleted `src/lib/components/HeatThermometer.svelte` panel → logique de signal réutilisée comme indicateur inline dans ProspectDossierHeader (le composant fichier peut être supprimé ou réduit à un indicator-only)
- deleted `src/lib/components/MessageMarginalia.svelte` côté chat (migré dans `/brain/[persona]` onglet intelligence comme timeline par-msg)
- new route `src/routes/brain/[persona]/+page.svelte` — page plein écran (connaissance + intelligence + réglages — 3 onglets, PAS de règles ici)
- deleted `src/lib/components/PersonaBrainDrawer.svelte` après migration vers route
- new migration `supabase/028_turn_kind.sql` — ajout colonne `messages.turn_kind` orthogonale à `role` et `message_type`
- new migration `supabase/029_feedback_events.sql` — nouvelle table `feedback_events` conversation-scoped
- new migration `supabase/030_prospect_dossier.sql` — colonnes `prospect_name`, `stage`, `note` sur `conversations`

## Problème

Le chat actuel (`/chat/[persona]`) est conçu comme un prompt/réponse de labo : `ChatInput` = prompt, `ChatMessage` bot = réponse, métriques diverses empilées autour. Ça convient pour tester un clone, pas pour le **workflow réel d'une agence LinkedIn**.

La réalité de l'opérateur agence :
- Il gère **10+ prospects en parallèle**, répartis sur **plusieurs clones** (1 clone par client)
- Il saute de clone à clone toute la journée
- Quand il revient sur un prospect 3h plus tard, il doit **retrouver le fil en 5 secondes** : qu'est-ce que le prospect a dit en dernier, qu'est-ce que j'ai envoyé, qu'est-ce que j'ai corrigé la dernière fois
- Aujourd'hui cette remise en contexte coûte : il faut relire tous les messages, les corrections sont noyées dans l'historique, aucun résumé du stage/état du prospect

En parallèle, l'observabilité actuelle (style metrics, fidelity, collapse_idx) est **daily noise** : ça n'aide pas à reprendre un dossier. Ces métriques sont du diagnostic, pas du feedback actionnable.

## Solution : chat à 2 zones (dossier prospect + journal feedback)

Le chat devient un **dossier prospect** structuré. Layout permanent (breakpoint desktop ≥ 900px) :

```
┌──────────────────────────────────────────────────┬──────────────┐
│ [ProspectDossierHeader — nom, stage, heat,       │ FEEDBACK     │
│  dernier contact, note, N corrections]           │ RAIL         │
├──────────────────────────────────────────────────┤              │
│                                                  │ ● règles (3) │
│ Thread (prospect / clone_draft / toi)            │              │
│                                                  │ ✎ 14:58      │
│                                                  │  "plus direct"│
│                                                  │              │
│                                                  │ ✓ 14:41      │
│                                                  │              │
│                                                  │ 📏 14:30     │
│                                                  │  règle saved │
│                                                  │              │
│ [ChatComposer — textarea + ajouter / draft]      │ ✎ 14:12      │
└──────────────────────────────────────────────────┴──────────────┘
```

**Zone A (gauche, 1fr)** : workspace du dossier.
- Header pinné avec meta du prospect (permanent, toujours visible)
- Thread central scrollable, messages typés visuellement
- Composer hybride en bas

**Zone B (droite, 280px fixe)** : journal feedback + pill règles.
- Chrono-inverse, scroll interne
- Clic sur une entrée → scroll+highlight message correspondant dans A

**Mobile (<900px)** : Zone B passe en drawer ouvrable par bouton "N corr ▸" dans le header.

## Pourquoi ce design

| Décision | Raison |
|----------|--------|
| Layout A (chat + rail feedback fixe) plutôt que split 50/50 ou feedback inline | Équilibre entre "reprendre vite" (rail visible d'un coup d'œil) et "rédiger confortable" (thread large). Split 50/50 rend le thread trop étroit, feedback inline enterre l'historique |
| Paradigme hybride (draft manuel, pas auto) | Auto-draft à chaque paste prospect = cher en tokens + intrusif quand l'opérateur relit un vieux thread. Le bouton "draft la suite" garde l'opérateur en contrôle |
| Messages typés `prospect` / `clone_draft` / `toi` | Data model identique à l'auto-import Breakcold (roadmap) : le jour où l'import arrive, zéro refonte UI |
| `clone_draft` ephemeral (remplacé à chaque correction, pas accumulé) | Le thread doit rester lisible comme une vraie conversation. Les drafts rejetés vivent comme entrées feedback dans B, pas comme messages dans A |
| Règles en pill dans le rail B (pas dans le drawer) | Règles = feedback live, leur place est avec le feedback. Les règles firing par draft apparaissent **inline** dans les entrées feedback correspondantes |
| Heat thermo fusionné dans header (plus un panel de 300px) | Le signal heat n'a jamais rempli 300px, et la colonne de droite vaut plus comme rail feedback. Le signal reste en indicateur dans le header dossier (dégradé froid/tiède/chaud) |
| Métriques style (collapse_idx, fidelity, breakdown) déplacées dans `/brain/[persona]` > intelligence | Ces métriques sont du diagnostic, pas de l'aide à la décision daily. Les garder dans le chat = bruit |
| `connaissance` / `intelligence` / `réglages` sortent du drawer → route `/brain/[persona]` plein écran | Ces surfaces ne sont pas daily, elles n'ont rien à faire coincées dans un drawer 420px. Route dédiée = espace pour être bien faites, sortie consciente de contexte |
| Règles restent proches du chat (pill dans rail) | Seule des 4 surfaces de l'ex-drawer qui soit réellement daily. Migration par cohérence fonctionnelle, pas par loyauté à l'ancien groupement |

## Architecture

### Section 1 — Message model

Clarification du data model actuel (à corriger dans la tête du lecteur) :
- `messages.role` ∈ {`user`, `assistant`} (pas `bot`)
- Aujourd'hui `role='user'` est **surchargé** : il désigne à la fois l'opérateur qui tape un prompt et les messages prospect copié-collés (cf. commentaire 021_prospect_heat qui traite `role='user'` comme inbound prospect). Cette surcharge est une source de bugs subtils — cette spec la **résout** en introduisant un axe orthogonal `turn_kind`.

**Nouvelle colonne `messages.turn_kind`** (via migration 028) — indépendante de `role` et `message_type` :

| `turn_kind` | `role` typique | `message_type` | Rendu visuel | Actions disponibles |
|-------------|----------------|----------------|--------------|---------------------|
| `prospect` | `user` | `chat` | bulle gauche, couleur neutre | aucune (read-only) |
| `clone_draft` | `assistant` | `chat` | bulle droite, teinte "en attente" (fond paper pâle + bordure-left ocre) | **✓ valider** · **✎ corriger** · **↻ regen** · **📋 copier** |
| `toi` | `assistant` | `chat` | bulle droite, neutre | aucune (read-only après envoi) |
| `draft_rejected` | `assistant` | `chat` | masqué du thread par défaut (reste pour audit) | — |
| `legacy` | `user` ou `assistant` | `chat` | rendu par compatibilité selon `role` (user → gauche neutre, assistant → droite neutre) | aucune action nouvelle |
| `meta` (hérité de 027) | `assistant`/`user` | `meta` | filtré hors du thread principal (cf. comportement actuel 027) | — |

**Règle d'état** : au plus un `turn_kind='clone_draft'` actif (le dernier) par conversation. Valider → UPDATE le message vers `turn_kind='toi'` (optionnellement `content` édité + flag). Corriger → INSERT nouveau `clone_draft`, l'ancien est marqué `turn_kind='draft_rejected'` (soft-delete, reste pour audit mais n'est pas affiché dans le thread par défaut).

**Edition manuelle avant validation** : si l'opérateur édite le texte d'un `clone_draft` puis clique ✓, le message bascule en `turn_kind='toi'` avec flag `edited_before_send=TRUE` et `draft_original` conservé. L'entrée feedback correspondante est marquée `validated_edited` avec diff (utile pour l'intelligence qui apprend la patte opérateur).

**Legacy fallback** : messages existants avant déploiement reçoivent `turn_kind='legacy'` via backfill. `ChatMessage.svelte` détecte `turn_kind='legacy'` et garde le rendu simple actuel (pas d'actions ✓/✎/↻, pas de bulle teintée). Les nouvelles conversations créées après migration utilisent les 3 types fins dès le premier message.

### Section 2 — Zone A : ProspectDossierHeader + thread + ChatComposer

**ProspectDossierHeader** (pinné, `position: sticky; top: 0`) :

```
╭───────────────────────────────────────────────────────────╮
│ [avatar] Marie D. ▾    J+3 relance ▾    heat: ↑ tiède    │
│ note: "voit une démo lundi 17h"              4 corrections │
╰───────────────────────────────────────────────────────────╯
```

Champs :
- **prospect_name** (éditable inline, required, stocké sur `conversations.prospect_name`)
- **stage** (tag freeform éditable, optionnel, stocké sur `conversations.stage`)
- **heat** (dérivé — reuse existing heat computation, affichage texte+icône dégradé froid/tiède/chaud ; clic révèle trajectoire récente)
- **dernier contact** (dérivé — timestamp du dernier message `prospect` ou `toi`)
- **n_corrections** (dérivé — count d'entrées feedback pour ce dossier, cliquable pour toggle rail en mobile)
- **note** (freeform 1 ligne éditable, stocké sur `conversations.note`)
- **scenario switcher** (post/DM/autre) — placé ici (propriété du dossier, pas du prochain message)

**Thread** : liste des messages selon types section 1. Scroll auto en bas sur nouveau message. Transitions douces (fade/slide existant préservé).

**ChatComposer** (remplace `ChatInput` + `ScenarioSwitcher` + `LiveMetricsStrip` + `AuditStrip`) :

```
┌──────────────────────────────────────────────────┐
│ [textarea — paste prospect OU consigne de draft] │
├──────────────────────────────────────────────────┤
│ [📥 ajouter prospect]     [✨ draft la suite →]  │
└──────────────────────────────────────────────────┘
```

- **📥 ajouter prospect** : insère le contenu textarea comme message `prospect`, vide la textarea, aucun draft auto.
- **✨ draft la suite** : déclenche génération LLM. Si textarea vide = draft sur la base du thread seul. Si textarea rempli = contenu envoyé comme consigne (system/user instruction) pour orienter le draft (ex: "plus direct", "mentionne qu'on a un call dispo").
- Enter = submit vers bouton focus. Shift+Enter = newline. Pas de toggle de mode visible : les 2 boutons cohabitent, l'opérateur choisit par le bouton cliqué.

### Section 3 — Zone B : FeedbackRail

**Structure** (largeur fixe 280px) :

```
┌────────────────────────────┐
│ FEEDBACK                   │
│                            │
│ ● règles actives (3) ▾    │  ← pill collapsible, expand = liste
│                            │
│ ────────────               │
│                            │
│ ✎ 14:58                    │
│   "plus direct, coupe…"    │
│   ↖ msg #4                 │
│   fired: no-smiley         │
│                            │
│ ✓ 14:41                    │
│   (validé)                 │
│   ↖ msg #3                 │
│   fired: mirror-length     │
│                            │
│ 📏 14:30                   │
│   règle enregistrée        │
│   "pas de smiley en…"      │
│                            │
│ ✎ 14:12                    │
│   "trop formel"            │
│   ↖ msg #2                 │
│                            │
└────────────────────────────┘
```

**Types d'entrées** (4) :
- **✓ validé** — draft accepté tel quel → devient `toi`
- **✓ validé (édité)** — draft édité manuellement avant validation → devient `toi` avec diff conservé (expandable dans l'entrée)
- **✎ corrigé** — draft refusé avec consigne/rewrite, texte de la correction affiché tronqué (expandable)
- **📏 règle enregistrée** — promotion d'une correction en règle persistante (POST `/api/feedback type=save_rule`)

**Regenerate sans correction** ne crée pas d'entrée (retry, pas signal).

**Règles firing inline** : chaque entrée ✓/✎ affiche les règles déclenchées sur le draft correspondant (compact : `fired: no-smiley, mirror-length`).

**Interactions** :
- Clic sur une entrée → `scrollIntoView` + highlight temporaire (2s) du message correspondant dans A
- Clic sur règle fired → ouvre `/brain/[persona]#règles` filtré sur la règle
- Pill "règles actives (N)" → expand/collapse de la liste des règles actives pour ce dossier
- Entrées non supprimables (log immuable)

**Persistence** : table `feedback_events` (nouvelle, migration 029 — schema complet ci-dessous).

### Section 4 — Cleanup des surfaces existantes

| Surface | Action |
|---------|--------|
| `ChatCockpit` identité (avatar, nom, scenario, switcher clones) | Reste — barre chrome minimal en haut |
| `ChatCockpit` badge style-health | Reste réduit — pastille unique, clic = redirige vers `/brain/[persona]#intelligence` |
| `ChatCockpit` jauges collapse/fidelity/breakdown + compteur règles | Supprimées du chat — migrées dans `/brain/[persona]#intelligence` et `/brain/[persona]#règles` |
| `LiveMetricsStrip` | Supprimé (doublon complet) |
| `AuditStrip` | Supprimé côté chat. Si pas déjà présent côté `/admin`, y migrer (session totals = vue admin) |
| `HeatThermometer` panel | Supprimé en tant que colonne 300px. Signal heat fusionné comme indicateur dans `ProspectDossierHeader` |
| `MessageMarginalia` (tokens, fidelity, rules fired par msg) | Supprimé du rendu chat par défaut. Timeline par-msg migrée dans `/brain/[persona]#intelligence` |
| Boutons ChatMessage "Corriger" / "Save rule" | Restent mais remappés : ils déclenchent maintenant des entrées ✎/📏 dans `FeedbackRail` (zone B). Ne s'affichent que sur les `clone_draft`, pas sur `toi` ni `prospect` |
| `FeedbackPanel` (slide-over) | Reste mais repensé : ouvre plus petit, inline-friendly. Target est toujours un `clone_draft`. Sur validation de la correction, entrée créée dans zone B |

**Gain écran** : ~220px verticaux récupérés sous le thread + 300px horizontaux libérés (ex-thermo) → respirations significatives pour la lecture du thread.

### Section 5 — Route `/brain/[persona]`

Nouvelle route plein écran pour les surfaces non-daily. Héritage du `PersonaBrainDrawer` actuel, 3 onglets au lieu de 4 (règles migrées vers rail chat) :

**Structure** :
```
/brain/[persona]
├── tab connaissance — upload docs, liste, chunks (KnowledgePanel existant)
├── tab intelligence — fidelity history + themes + sparkline + metrics per-msg timeline + learning feed (IntelligencePanel étendu)
└── tab réglages — budget, clé API custom, contributeurs (SettingsPanel existant)
```

Les composants `KnowledgePanel`, `IntelligencePanel`, `SettingsPanel` ont déjà un mode `embedded` — ce mode devient le mode de rendu par défaut dans la nouvelle route (le drawer shell est supprimé).

**Points d'entrée** :
1. **`/hub`** — sur chaque `.clone-card`, lien discret "⚙ cerveau" à côté de la `fidelity-chip` existante
2. **`/chat/[persona]`** — icône ⚙ dans la chrome du cockpit (à droite du nom persona), redirect vers `/brain/[persona]`
3. **Clic sur pastille style-health** dans cockpit → `/brain/[persona]#intelligence`
4. **Clic sur règle firing** dans entrée feedback rail → scroll + highlight de la règle dans la **pill "règles actives"** en haut du rail (pas de navigation vers `/brain` ; les règles n'existent que dans le rail chat dans cette nouvelle architecture)

**Sortie** : bouton back standard → retour vers la provenance (hub ou chat).

**Composant `PersonaBrainDrawer.svelte`** supprimé après migration. Les tests qui le référencent sont migrés vers des tests de la nouvelle route.

### Unités et interfaces

Les unités définies par cette spec et leurs responsabilités isolées :

| Unité | Responsabilité | Interface publique | Dépendances |
|-------|----------------|--------------------|-------------|
| `ProspectDossierHeader.svelte` | Afficher + éditer la meta du dossier | props: `{conversation, onUpdate}`. Emit: `update` (partial patch sur conversation) | `ScenarioSwitcher` (slot), icône heat (interne) |
| `FeedbackRail.svelte` | Afficher + filtrer le journal feedback, gérer pill règles | props: `{conversationId, activeRules, onHighlightMessage}`. Emit: `highlightMessage(msgId)` | API: `GET /api/feedback-events?conv=X` |
| `ChatComposer.svelte` | Capter saisie + déclencher "ajouter prospect" ou "draft la suite" | props: `{disabled, scenarioType}`. Emit: `addProspect(text)` + `draftNext({consigne})` | aucune (contrôleur = `+page.svelte`) |
| `ChatMessage.svelte` (modifié) | Rendu d'un message selon `turn_kind`, actions sur drafts | props: `{message, onValidate, onCorrect, onRegen, onCopy, onSaveRule}` | aucune directe |
| Route `/brain/[persona]` | Shell 3-onglets pour surfaces non-daily | URL: `/brain/[persona]#<tab>` avec tab ∈ {connaissance, intelligence, réglages} | Composants `KnowledgePanel`, `IntelligencePanel`, `SettingsPanel` en mode `embedded` |
| Table `feedback_events` | Persister les événements feedback conversation-scoped | Schema ci-dessous. Accès via `GET /api/feedback-events?conv=X`, `POST /api/feedback-events` | Réf FK `conversations`, `messages`, `learning_events` (optionnel) |

Chaque unité peut être comprise sans lire les internes des autres et testée isolément.

## Data model impact

*(Bloc `conversations` déplacé sous la section migration 030 pour éviter la duplication — voir plus bas.)*

### `messages` (table existante, migration 028)
`role` et `message_type` restent tels quels. On ajoute :
- `turn_kind TEXT NOT NULL DEFAULT 'legacy' CHECK (turn_kind IN ('prospect','clone_draft','toi','draft_rejected','legacy','meta'))`
- `draft_of_message_id UUID NULL REFERENCES messages(id)` — pointe vers le `prospect` auquel le draft répond
- `edited_before_send BOOLEAN NOT NULL DEFAULT FALSE`
- `draft_original TEXT NULL` — contenu brut du draft si `edited_before_send=TRUE`

Backfill : tous les messages existants reçoivent `turn_kind='legacy'` (déjà le défaut). Les messages avec `message_type='meta'` reçoivent `turn_kind='meta'` pour cohérence.

Index : `CREATE INDEX idx_messages_conv_turn_kind ON messages(conversation_id, turn_kind, created_at)` pour accélérer le filtre "dernier clone_draft actif par conv".

### `feedback_events` (nouvelle table, migration 029)
Conversation-scoped, distincte de `learning_events` (persona-scoped).

```sql
CREATE TABLE feedback_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule')),
  correction_text TEXT,           -- pour 'corrected' et 'saved_rule'
  diff_before TEXT,               -- pour 'validated_edited'
  diff_after TEXT,                -- pour 'validated_edited'
  rules_fired JSONB DEFAULT '[]'::jsonb,  -- [rule_id, ...]
  learning_event_id UUID REFERENCES learning_events(id), -- FK quand saved_rule déclenche un learning_events
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_events_conv_created ON feedback_events(conversation_id, created_at DESC);
CREATE INDEX idx_feedback_events_persona_created ON feedback_events(persona_id, created_at DESC);
```

**API endpoints** (nouveaux) :
- `GET /api/feedback-events?conversation=<uuid>` — liste chrono-inverse des events pour une conv (rail)
- `POST /api/feedback-events` — body `{conversation_id, message_id, event_type, correction_text?, diff_before?, diff_after?}` — crée une entrée, et si `event_type='saved_rule'` insert aussi dans `learning_events` et retourne le `learning_event_id`
- (existant) `POST /api/feedback` reste pour les corrections longues via `FeedbackPanel` ; sa soumission produit un `feedback_events` côté serveur

### `conversations` (table existante, migration 030)
Ajouter :
- `prospect_name TEXT NULL` — nom du prospect (éditable dans header)
- `stage TEXT NULL` — tag freeform (éditable dans header)
- `note TEXT NULL` — note 1-ligne (éditable dans header)

*Les conversations existantes conservent `prospect_name = NULL` ; le header affiche alors "prospect sans nom" ou le `name` legacy si présent. Édition inline au premier clic.*

## Migration

**Décision : "flip all" unique layout, fallback par `turn_kind='legacy'`.** Pas de double rendu, pas de `ChatLegacy.svelte`, pas de flag `layout_v2`. Rationale : la complexité de maintenir deux renderers en parallèle dépasse le coût d'une transition où les convs legacy sont un peu moins lisibles pendant quelques jours.

**Étapes** :
1. Migration 028 (turn_kind) déployée, backfill tous messages existants → `turn_kind='legacy'` sauf `message_type='meta'` → `turn_kind='meta'`
2. Migration 029 (feedback_events) déployée
3. Migration 030 (prospect_dossier sur conversations) déployée, `prospect_name/stage/note = NULL` partout
4. Déploiement front : nouveau layout 2-zones, route `/brain/[persona]`, suppression des composants obsolètes
5. **Conversations legacy** : ouvrable, messages rendus avec rendu simple (prospect/clone_draft indistinguables → s'affichent selon `role` comme aujourd'hui), pas d'actions ✓/✎. Header prospect affiche "prospect sans nom" éditable. Rail feedback vide au départ (historique legacy non rétro-tagué).
6. **Conversations nouvelles** (après migration front) : tous les nouveaux messages créés avec `turn_kind` correct. `/api/chat` est modifié pour taguer les output assistant → `clone_draft` ; l'utilisateur tague → `prospect` via le bouton "ajouter prospect" du composer.

**Pas de rétro-tagging automatique** : les conversations legacy ne sont pas backportées en `prospect/clone_draft/toi` (ambigu, coûteux, pas essentiel pour la reprise). Elles vivent avec `turn_kind='legacy'`.

## Non-goals

- **Pas d'auto-draft sur paste prospect** — explicitement rejeté pour coût tokens et intrusivité
- **Pas de sparkline heat dans le header** — indicateur texte+icône suffit (cohérent avec le feedback 2026-04-18 "sparkline apporte rien")
- **Pas de filtres sur le rail feedback** pour v1 — chrono brut. Si le rail devient trop long en usage réel, on ajoutera filtres (par type, par date)
- **Pas de suppression d'entrées feedback** — log immuable
- **Pas d'enum structuré pour `stage`** — freeform pour v1. Si patterns clairs émergent (ex: "J+3 relance" utilisé par 80% des users), on structurera
- **Pas de multi-prospect par conversation** — une conv = un prospect. Workflows multi-personnes sortent du scope
- **Pas de reprise des convs legacy en nouveau layout** — convs legacy restent en ancien renderer ou affichent dégradé

## Open questions pour le plan d'implémentation

Les décisions majeures (feedback table, migration strategy, FeedbackPanel fate) sont **résolues dans cette spec**. Restent quelques détails d'implémentation à arbitrer au plan :

1. **Heat indicator design dans le header** : copie directe de l'état actuel (ok/warn/bad en icône+couleur) suffit, ou on design un traitement visuel spécifique ? (esthétique uniquement, pas de blocage fonctionnel)
2. **Breakpoint responsive** : confirmer 900px comme bascule drawer-mode pour zone B, ou aller plus bas (700px) pour garder le rail sur tablette landscape (test sur devices réels au plan)
3. **Suppression vs réduction de `HeatThermometer.svelte`** : supprimer complètement et refaire l'indicator dans le header, ou garder le composant en mode `inline-indicator` plus compact et l'embed dans `ProspectDossierHeader` ? (choix d'implémentation, ne change pas la fonctionnalité)
4. **Séquencement de déploiement** : `/brain/[persona]` extraction et `/chat/[persona]` refonte peuvent être shippés séparément (la route /brain est self-contained). Le plan devrait les découper en 2 phases pour permettre un rollback partiel

## Testing strategy

- **Unit** : nouveaux composants (`ProspectDossierHeader`, `FeedbackRail`, `ChatComposer`) avec vitest — rendu conditionnel par `turn_kind`, actions émises, états edit inline
- **Intégration** : flow complet "paste prospect → draft → corriger → valider édité → save rule" via test E2E (Playwright si en place, sinon node-based)
- **Visual regression** : snapshots avant/après pour `/chat/[persona]` et `/brain/[persona]` (voir si outil en place dans le projet)
- **Smoke test API** : test node sur `api/chat.js` (taggage `turn_kind='clone_draft'` en sortie) + nouveaux endpoints `/api/feedback-events` — per mémoire `project_voiceclone_stack` "vite dev ne sert pas api/", utiliser vercel dev ou node tests

## Pre-merge gate

Avant merge, vérifier `critic_commit_date vs last_prod_message_date` sur le chemin `/chat/[persona]` (per mémoire `feedback_critic_verify_prod_usage`) — si zéro trafic prod sur chat depuis N jours, pas la peine de planifier cette refonte, générer du trafic d'abord. Le script existant `scripts/critic-prod-check.js` (déjà présent en untracked) peut servir.
