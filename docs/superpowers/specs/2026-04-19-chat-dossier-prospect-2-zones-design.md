# Chat — Dossier prospect à 2 zones — Design Spec

**Date:** 2026-04-19
**Status:** Draft
**Supersedes partially:** `2026-04-18-thermometre-rail-design.md` (le rail heat est démoli au profit d'un rail feedback ; le signal heat migre en indicateur dans le header dossier)
**Files:**
- modified `src/routes/chat/[persona]/+page.svelte` — layout repensé (header dossier pinné + thread + rail feedback)
- new `src/lib/components/ProspectDossierHeader.svelte` — header pinné (nom, stage, dernier contact, note, chaleur)
- new `src/lib/components/FeedbackRail.svelte` — zone B (journal feedback + pill règles actives)
- new `src/lib/components/ChatComposer.svelte` — composer hybride (ajouter prospect / draft la suite) remplace ChatInput
- modified `src/lib/components/ChatMessage.svelte` — rendu par types `prospect` / `clone_draft` / `toi`, actions ✓/✎/↻/📋 sur drafts uniquement
- modified `src/lib/components/ChatCockpit.svelte` — allégé (identité + pill style-health + ⚙ brain link), métriques dégagées
- deleted `src/lib/components/LiveMetricsStrip.svelte` — 100% doublon
- deleted `src/lib/components/AuditStrip.svelte` côté chat (déplacé dans /admin si pas déjà)
- deleted `src/lib/components/HeatThermometer.svelte` panel → fusionné comme indicateur dans ProspectDossierHeader
- deleted `src/lib/components/MessageMarginalia.svelte` côté chat (migré dans `/brain/[persona]` onglet intelligence)
- new route `src/routes/brain/[persona]/+page.svelte` — page plein écran (connaissance + intelligence + réglages)
- removed `src/lib/components/PersonaBrainDrawer.svelte` (drawer) après migration vers route
- new migration `supabase/NNN_feedback_events.sql` — table `feedback_events` (ou réutilisation `learning_events` selon shape)
- new migration `supabase/NNN_message_types.sql` — ajout colonnes/valeurs `role` pour `prospect` / `clone_draft` / `toi`
- new migration `supabase/NNN_prospect_dossier.sql` — colonnes `prospect_name`, `stage`, `note` sur `conversations`

## Problème

Le chat actuel (`/chat/[persona]`) est conçu comme un prompt/réponse de labo : `ChatInput` = prompt, `ChatMessage` bot = réponse, métriques diverses empilées autour. Ça convient pour tester un clone, pas pour le **workflow réel d'une agence LinkedIn**.

La réalité de l'opérateur agence :
- Il gère **10+ prospects en parallèle**, répartis sur **plusieurs clones** (1 clone par client)
- Il saute de clone à clone toute la journée
- Quand il revient sur un prospect 3h plus tard, il doit **retrouver le fil en 5 secondes** : qu'est-ce que le prospect a dit en dernier, qu'est-ce que j'ai envoyé, qu'est-ce que j'ai corrigé la dernière fois
- Aujourd'hui cette remise en contexte coûte : il faut relire tous les messages, les corrections sont noyées dans l'historique, aucun résumé du stage/état du prospect

En parallèle, l'observabilité actuelle (style metrics, fidelity, collapse_idx) est **daily noise** : ça n'aide pas à reprendre un dossier. Ces métriques sont du diagnostic, pas du feedback actionnable.

## Solution : chat à 2 zones (dossier prospect + journal feedback)

Le chat devient un **dossier prospect** structuré. Layout layout permanent (breakpoint desktop ≥ 900px) :

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

3 types de turns dans le thread. Legacy messages (role `user` / `bot`) restent rendus tels quels pour les conversations existantes ; nouvelles conversations utilisent les nouveaux types.

| Type | Source | Rendu visuel | Actions disponibles |
|------|--------|--------------|---------------------|
| `prospect` | paste opérateur ou auto-import Breakcold (roadmap) | bulle gauche, couleur neutre | aucune (read-only) |
| `clone_draft` | génération LLM via `/api/chat` SSE | bulle droite, teinte "en attente" (ex: fond #f5efe4 ou équivalent paper pâle avec bordure left ocre) | **✓ valider** · **✎ corriger** · **↻ regen** · **📋 copier** |
| `toi` | résultat d'une validation (directe ou après édition) | bulle droite, neutre | aucune (read-only après envoi) |

**Règle d'état** : au plus un `clone_draft` actif à la fin du thread. Valider → bascule en `toi`. Corriger → nouveau `clone_draft` généré, remplace l'ancien. Les drafts rejetés ne subsistent pas dans A, seulement comme entrées `✎` dans B.

**Edition manuelle avant validation** : si l'opérateur édite le texte d'un `clone_draft` puis clique ✓, l'entrée feedback est marquée `✓ validé (édité)` avec le diff conservé. Distingue la validation pure du tweak pre-envoi (utile pour l'intelligence).

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

**Persistence** : table `feedback_events` (ou `learning_events` existante si shape compatible — vérifier au plan).

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
4. **Clic sur règle firing** dans rail feedback → `/brain/[persona]#règles` (si règles restent aussi navigables ici, sinon on route vers le scroll de la pill du rail)

**Sortie** : bouton back standard → retour vers la provenance (hub ou chat).

**Composant `PersonaBrainDrawer.svelte`** supprimé après migration. Les tests qui le référencent sont migrés vers des tests de la nouvelle route.

## Data model impact

### `conversations` (table existante)
Ajouter colonnes :
- `prospect_name TEXT NULL` — nom du prospect (éditable dans header)
- `stage TEXT NULL` — tag freeform (éditable dans header)
- `note TEXT NULL` — note 1-ligne (éditable dans header)

*Les conversations existantes conservent `prospect_name = NULL` ; le header affiche alors "prospect sans nom" ou le `name` legacy si présent. Édition inline au premier clic.*

### `messages` (table existante)
Colonne `role` existe aujourd'hui avec valeurs `user` / `bot`. Étendre à `prospect` / `clone_draft` / `toi`. Valeurs `user` / `bot` conservées pour compatibilité legacy (rendues telles quelles dans `ChatMessage`).

Ajouter colonne :
- `draft_of_message_id UUID NULL` — pointe vers le `prospect` auquel le draft répond (pour traçabilité, utile pour l'intelligence)
- `edited_before_send BOOLEAN DEFAULT FALSE` — pour distinguer `toi` pur vs `toi` édité

### `feedback_events` (nouvelle ou réuse `learning_events`)
Shape minimum :
```
id UUID
conversation_id UUID → conversations
message_id UUID → messages (le draft ciblé)
persona_id UUID
type TEXT  -- 'validated' | 'validated_edited' | 'corrected' | 'saved_rule'
correction_text TEXT NULL  -- pour 'corrected' / 'saved_rule'
diff_before TEXT NULL  -- pour 'validated_edited'
diff_after TEXT NULL
rules_fired JSONB  -- array de rule_ids
created_at TIMESTAMPTZ
```

Au plan d'implémentation, vérifier si `learning_events` (supabase/017) couvre déjà ces besoins ; sinon créer `feedback_events`.

## Migration

**Pas de backfill destructif** :
- Conversations existantes : `prospect_name/stage/note` = NULL, rendus avec fallback
- Messages existants (role `user`/`bot`) : rendus tels quels, pas de remapping
- Les nouveaux types `prospect`/`clone_draft`/`toi` ne s'appliquent qu'aux conversations créées après la migration (ou aux nouveaux messages de conversations existantes si on décide de flipper le flag par-conv)

**Flag de migration par conversation** : ajouter `conversations.layout_v2 BOOLEAN DEFAULT FALSE`. Conversations créées après deploy = `TRUE`, rendues avec la nouvelle UI. Conversations legacy = `FALSE`, rendues avec l'ancienne UI (à garder temporairement dans un composant `ChatLegacy.svelte` splitté de `+page.svelte`). Au bout de N semaines sans accès legacy, on supprime le legacy renderer.

**Alternative plus simple** : tout flip. Les conversations legacy s'affichent "cassées" (messages `user`/`bot` rendus comme `toi`/`clone_draft` sans typologie fine) mais fonctionnelles. À décider au plan (dépend du volume de convs legacy actives).

## Non-goals

- **Pas d'auto-draft sur paste prospect** — explicitement rejeté pour coût tokens et intrusivité
- **Pas de sparkline heat dans le header** — indicateur texte+icône suffit (cohérent avec le feedback 2026-04-18 "sparkline apporte rien")
- **Pas de filtres sur le rail feedback** pour v1 — chrono brut. Si le rail devient trop long en usage réel, on ajoutera filtres (par type, par date)
- **Pas de suppression d'entrées feedback** — log immuable
- **Pas d'enum structuré pour `stage`** — freeform pour v1. Si patterns clairs émergent (ex: "J+3 relance" utilisé par 80% des users), on structurera
- **Pas de multi-prospect par conversation** — une conv = un prospect. Workflows multi-personnes sortent du scope
- **Pas de reprise des convs legacy en nouveau layout** — convs legacy restent en ancien renderer ou affichent dégradé

## Open questions pour le plan d'implémentation

1. **Table feedback_events vs learning_events** : vérifier shape de `learning_events` (supabase/017) ; si compatible, étendre avec colonnes manquantes ; sinon créer nouvelle table
2. **Flag `layout_v2` ou migration "tout flip"** : arbitrage au début du plan selon volume de convs actives
3. **Transition `FeedbackPanel` actuel → entrée directe dans rail** : garder le slide-over pour les corrections longues, ou inline input dans le rail ? Arbitrage UX à valider en prototype
4. **Heat indicator design** : copie directe de l'état actuel (ok/warn/bad en icône+couleur) suffit, ou on design un traitement spécifique pour le header ?
5. **Breakpoint responsive** : confirmer 900px comme bascule drawer-mode pour zone B, ou aller plus bas (700px) pour garder le rail sur tablette landscape

## Testing strategy

- **Unit** : nouveau composants (`ProspectDossierHeader`, `FeedbackRail`, `ChatComposer`) avec vitest
- **Intégration** : flow complet "paste prospect → draft → corriger → valider édité → save rule" via test E2E existant (Playwright si en place)
- **Visual regression** : snapshots avant/après pour chat page (voir si outil en place dans le projet)
- **Smoke test API** : test node sur `api/chat.js` + nouveaux endpoints feedback (per mémoire `project_voiceclone_stack` : "vite dev ne sert pas api/", utiliser vercel dev ou node tests)
- **Critic prod usage** : avant merge, vérifier `critic_commit_date vs last_prod_message_date` pour ce chemin (per mémoire `feedback_critic_verify_prod_usage`) — si zéro trafic sur chat depuis N jours, pas la peine de planifier cette refonte, générer du trafic d'abord
