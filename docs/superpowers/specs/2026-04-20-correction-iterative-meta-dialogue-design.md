# Correction itérative + dialogue méta — Design Spec

**Date:** 2026-04-20
**Status:** Draft v1
**Relation avec specs existantes :**
- Dépend de `2026-04-19-chat-dossier-prospect-2-zones-design.md` (mergée PR #24) — layout 2-zones, `messages.turn_kind`, table `feedback_events`
- Dépend de `2026-04-20-chat-client-validation.md` (mergée PR #25) — `event_type='client_validated'`, signal d'apprentissage fort (+0.12 entity boost)
- Orthogonal à `2026-04-20-feedback-excellent.md` (mergée PR #26) — `event_type='excellent'`

**Files:**
- modified `src/lib/components/FeedbackPanel.svelte` — state machine étendue (2 rounds, bouton "aucune ne convient →", escalation)
- modified `src/lib/components/ChatMessage.svelte` — rendu `clone_reflect` / `operator_reflect` (bordure dashed, label "↔ debug", collapse auto, composer inline sous le dernier clone_reflect)
- modified `src/routes/chat/[persona]/+page.svelte` — carte "j'ai retenu ça" entre thread et composer principal, passage de l'escalation au thread
- modified `src/lib/components/FeedbackRail.svelte` — affichage des nouvelles entrées journal (`reflect_started`, `synthesis_saved`, etc.)
- modified `api/feedback.js` — 3 nouveaux `type` (`reflect`, `synthesize_reflect`, `accept_reflect_rule`) + extension `regenerate` avec `iteration_history`
- new migration `supabase/033_reflect.sql` — étend `turn_kind` et `feedback_events.event_type`, ajoute colonne `feedback_events.payload jsonb`

## Problème

Le flow de correction actuel ([`FeedbackPanel.svelte`](../../src/lib/components/FeedbackPanel.svelte) côté master) fonctionne ainsi :

1. Opérateur clique ✎ sur un `clone_draft` → drawer 420px s'ouvre
2. Textarea "ce qui ne va pas" → submit → API `feedback` type `regenerate` → 2 alternatives générées par Claude
3. Opérateur clique une alternative → `type: accept` → correction enregistrée, message remplacé

**Le point mort** : si aucune des 2 alternatives ne convient, le seul chemin de sortie est *"Garder l'original"*. L'opérateur est bloqué — il doit soit valider un message qu'il n'aime pas, soit abandonner complètement. Aucun mécanisme pour :
- donner du feedback supplémentaire et itérer ("les deux sont trop formels")
- creuser *pourquoi* le clone rate son coup (désalignement ton ? angle ? registre ?)
- capitaliser le diagnostic dans l'intelligence persistante

Dans un workflow d'agence LinkedIn (cf. spec 2-zones), l'opérateur peut corriger un draft 3-5 fois sur un prospect délicat. Avec le flow actuel, ces itérations répétées restent invisibles — on sauve juste la dernière correction réussie, sans comprendre pourquoi le clone a pris 4 essais.

## Solution : flow en 3 phases

**Phase 1 — Itération bornée dans le drawer (2 rounds max)**
Si la première proposition échoue, l'opérateur peut demander "aucune ne convient →", fournit un complément de feedback, et reçoit 2 nouvelles alternatives. Un seul niveau d'itération suffit à résoudre la majorité des cas courants (formulation qui tombe pas juste du premier coup). Au-delà, on escalade.

**Phase 2 — Dialogue méta dans le chat**
Après le round 2 échoué, le drawer se ferme et le clone entame un échange **explicatif** dans le thread : il verbalise *ce qu'il a cru comprendre* et pose *où il coince*. L'opérateur répond en langage libre. Le clone introspecte, questionne encore. Ces échanges sont visuellement distincts des vrais drafts prospect (bordure dashed, pas de bouton ✓) pour qu'ils ne puissent jamais être envoyés par erreur.

**Phase 3 — Reprise ou abandon**
À tout moment pendant le dialogue méta, l'opérateur peut :
- cliquer "réessaie →" → drawer rouvre sur un round 1 neuf, pré-rempli avec une synthèse du dialogue, contexte entier injecté dans le prompt LLM
- cliquer "abandonne, garde l'original" → le clone_draft initial reste intact

Dans les deux cas, si le clone a identifié une règle durable pendant le dialogue (confiance > 0.6), une carte discrète *"j'ai retenu ça"* propose à l'opérateur de la sauver dans l'intelligence persistante — explicite, jamais silencieux.

## Pourquoi ce design

| Décision | Raison |
|----------|--------|
| **2 rounds** dans le drawer (pas 3, pas illimité) | Un round = latence (~2s) + coût LLM + fatigue attentionnelle. Si le round 2 échoue aussi, le problème n'est plus de formulation mais de désalignement — il faut changer d'outil (dialogue), pas insister avec la même mécanique. |
| **Compteur visible** `round 1/2` → `round 2/2` | L'opérateur sait qu'il approche de l'escalation. Sans compteur, il se demande "ça va durer longtemps ?" et abandonne préventivement. |
| **Escalation automatique** au round 2 échoué (pas un clic "j'abandonne le drawer") | L'opérateur vient de cliquer "aucune ne convient" après 2 rounds — forcer un clic supplémentaire pour "ouvrir le dialogue méta" = friction inutile. On le téléporte directement dans la bonne interface. |
| **Dialogue méta dans le thread**, pas dans un drawer dédié | (a) continuité contextuelle — l'opérateur voit le clone_draft original pendant la discussion ; (b) le rail feedback (zone B) journalise déjà les événements du thread, réutilisation naturelle ; (c) si l'opérateur revient sur le dossier 3h plus tard, la trace du désalignement est là. |
| **2 turn_kind dédiés** (`clone_reflect` + `operator_reflect`) | Distinction sémantique claire dans la DB (queries d'audit, filtres). Distinction visuelle forcée (impossible d'envoyer au prospect par erreur). Coût de schéma nul (juste 2 valeurs ajoutées à un CHECK). |
| **Bordure dashed + pas de ✓** pour les turn_kind reflect | Sécurité forte : un dashed border signale visuellement "not for prospect". L'absence de bouton ✓ rend l'envoi techniquement impossible, pas juste improbable. |
| **Composer inline sous le dernier `clone_reflect`** (pas le composer principal) | Le composer principal sert à draft des messages prospect ; le détourner en mode "réponse méta" crée un mode-switch confus et risque de confusion. Un composer inline minimal = sans ambiguïté sur le rôle. |
| **Structure forcée "ce que j'ai cru / où je coince"** pour le premier `clone_reflect` | L'intérêt du dialogue méta est diagnostic. Sans structure, le clone reformule ses alts ou demande vaguement "qu'est-ce que tu veux" — on reste dans le problème initial. Obliger l'introspection + la question crée la tension productive. |
| **Garde-fou à 10 échanges méta** | Filet de sécurité contre boucle infinie (clone qui n'arrive pas à comprendre). Pas contraignant en pratique (la plupart des discussions convergent en 2-4 tours). Message *"ça traîne — prends 5 min, reprends plus tard"* + bouton d'abandon. |
| **Bouton explicite "réessaie →"** au lieu de re-génération auto après N tours | La décision de re-tenter appartient à l'opérateur. Auto = recréer le problème initial (2 alts possiblement mauvaises) sans qu'il ait validé l'alignement. |
| **Pré-remplissage du textarea** par synthèse auto de la discussion méta | Sinon l'opérateur retape l'essentiel de ce qu'il vient d'expliquer — frustrant. Synthèse auto = continuité. Modifiable avant submit pour le cas où la synthèse capture mal. |
| **Collapse auto des `clone_reflect`** après 30s de calme | Le thread reste lisible comme un fil prospect. La trace reste (dépliable) pour l'audit et le retour 3h plus tard. |
| **Carte "j'ai retenu ça" inline** (pas modal, pas toast silencieux) | Modal = bloquant et autoritaire. Toast silencieux = ignoré. Carte inline [éditer/ignorer/sauver] = visible, non-bloquante, 1 clic pour sauver. |
| **Seuil `confidence > 0.6`** avant d'afficher la carte | Si le clone n'est pas convaincu d'avoir compris, le proposer polluerait l'intelligence. Mieux se taire que sauver "j'ai pas bien compris". |
| **Validation explicite** de la règle synthétisée (sauvée seulement sur clic ✓) | Principe : *jamais de learning silencieux sans opt-in*. L'opérateur est fatigué après 2 rounds + N tours méta — lui écrire 3 règles en base sans demander = pourrir son cerveau persona. |
| **Règle persona-scoped** (pas conversation-scoped) | C'est tout l'intérêt. Une leçon apprise sur ce prospect doit bénéficier aux futurs prospects du même clone. Pipeline existant (`corrections` table chargée dans le prompt) fait déjà ça, donc write-in cost = zéro. |
| **Pas de modification auto de `voice.writingRules` YAML** | Ces règles sont le core identity du persona, modifiables uniquement via `/brain/[persona]` > règles. Le flow de correction écrit dans `corrections` (layer dynamique), pas dans le YAML (layer identitaire). |
| **3 niveaux d'écriture** (trace auto / correction classique / règle synthétisée opt-in) | Séparer audit (niveau 1, gratuit, pour détection de patterns) de learning léger (niveau 2, implicite via clic alt) de learning durable (niveau 3, explicite via carte). Chaque niveau a un coût différent — sémantique et cognitif. |

## Architecture

### Section 1 — Data model

#### Migration `supabase/033_reflect.sql`

```sql
-- 033_reflect.sql
-- Étend turn_kind (028) et feedback_events.event_type (029/031/032) pour
-- couvrir le flow de correction itérative + dialogue méta.
-- Spec: docs/superpowers/specs/2026-04-20-correction-iterative-meta-dialogue-design.md

-- ── 1. turn_kind : +2 valeurs ─────────────────────────────────────────
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_turn_kind_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_turn_kind_check
  CHECK (turn_kind IN (
    'prospect','clone_draft','toi','draft_rejected','legacy','meta',
    'clone_reflect','operator_reflect'
  ));

COMMENT ON COLUMN messages.turn_kind IS
  'Narrative role axis. clone_reflect/operator_reflect = méta-dialogue post-escalation de correction, jamais envoyé au prospect. Voir spec 2026-04-20-correction-iterative-meta-dialogue-design.';

-- ── 2. feedback_events.event_type : +7 valeurs ────────────────────────
ALTER TABLE feedback_events DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN (
    -- existants (029/031/032)
    'validated','validated_edited','corrected','saved_rule','excellent','client_validated',
    -- nouveaux (correction itérative)
    'correction_rejected_round',  -- round 1 ou 2 rejeté dans le drawer
    'reflect_started',             -- escalation au round 2 échoué
    'reflect_turn',                -- chaque tour du dialogue méta (clone ou operator)
    'synthesis_proposed',          -- carte "j'ai retenu ça" affichée
    'synthesis_saved',             -- opérateur a cliqué "sauver ✓" (écrit aussi dans corrections)
    'synthesis_ignored',           -- opérateur a cliqué "ignorer"
    'reflect_exit'                 -- sortie du dialogue méta ('retry' ou 'abandon')
  ));

-- ── 3. Colonne payload jsonb pour les event_types qui ont besoin de plus
--    que les champs typés existants (round_index, confidence, etc.) ───
ALTER TABLE feedback_events
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN feedback_events.payload IS
  'Event-specific fields for reflect flow events. Voir 033_reflect.sql pour shape par event_type.';
```

**Payload shape par event_type** (documenté dans la migration, enforced côté API) :

| event_type | payload fields |
|------------|----------------|
| `correction_rejected_round` | `{ round: 1\|2, correction: string, alternatives: string[], why_bad: string }` |
| `reflect_started` | `{ round_2_correction: string, rejected_alternatives: string[] }` |
| `reflect_turn` | `{ turn_index: number, role: 'clone'\|'operator', content: string }` |
| `synthesis_proposed` | `{ rule_candidate: string, confidence: number, meta_turns: number }` |
| `synthesis_saved` | `{ rule_text: string, edited_from: string\|null }` (correction_id via `learning_event_id` FK) |
| `synthesis_ignored` | `{ rule_candidate: string }` |
| `reflect_exit` | `{ exit: 'retry'\|'abandon', total_meta_turns: number }` |

**Pas de nouvelle table.** Tout passe par `messages` + `feedback_events` + `corrections` (existants).

### Section 2 — API surface (`api/feedback.js`)

4 changements, aucun breaking.

#### Extension de `type: "regenerate"` (existant)

Ajout d'un champ optionnel `iteration_history` dans le payload :

```js
{
  type: "regenerate",
  correction: string,                    // correction du round courant
  botMessage: string,
  persona: string,
  iteration_history?: [                  // absent au round 1
    { correction: string, alternatives: string[], rejected: true }
  ]
}
```

Si `iteration_history` présent, le prompt LLM est enrichi :
```
Tu as déjà essayé cette correction : "<iteration_history[0].correction>"
et proposé ces alternatives qui ont été rejetées : ...
L'opérateur demande maintenant : "<correction>"
Génère 2 NOUVELLES alternatives qui évitent explicitement les écueils précédents.
```

Backend side-effect : insert dans `feedback_events` avec `event_type: 'correction_rejected_round'` pour le round précédent (payload: round, correction, alternatives, why_bad=correction courante).

#### Nouveau `type: "reflect"`

Génère un message `clone_reflect` (premier ou suivant).

```js
// Request
{
  type: "reflect",
  botMessage: string,                    // clone_draft original
  iteration_history: [...],              // 2 rounds échoués
  reflect_history?: [                    // tours méta existants, vide au premier
    { role: 'clone'|'operator', content: string }
  ],
  persona: string,
  conversation_id: string,
  message_id: string                     // clone_draft cible
}

// Response
{
  ok: true,
  reflect_message: {
    explanation: string,                 // "j'ai lu tes corrections comme 'plus direct'..."
    questions: string[]                  // ["est-ce le ton ou l'angle ?", ...]
  }
}
```

Structure de prompt :
- Si `reflect_history` vide → structure forcée en JSON `{explanation, questions}` (premier tour, introspection + question)
- Sinon → format libre mais consigne système rappelle de rester focalisé sur le diagnostic (pas de resolution tant que l'opérateur n'a pas cliqué "réessaie →")

Backend side-effects :
- Au premier tour : insert `feedback_events` type `reflect_started`
- À chaque tour : insert `feedback_events` type `reflect_turn` avec role='clone', turn_index

#### Nouveau `type: "synthesize_reflect"`

Appelé au clic de "réessaie →" ou "abandonne". Produit le candidat de règle.

```js
// Request
{
  type: "synthesize_reflect",
  botMessage: string,
  iteration_history: [...],
  reflect_history: [...],
  persona: string,
  conversation_id: string,
  message_id: string
}

// Response
{
  ok: true,
  rule_candidate: string,                // "préférer un ton ironique-tranchant..."
  confidence: number                     // 0-1
}
```

Backend side-effect : insert `feedback_events` type `synthesis_proposed` (payload: rule_candidate, confidence, meta_turns).

#### Nouveau `type: "accept_reflect_rule"`

Écrit la règle validée par l'opérateur.

```js
// Request
{
  type: "accept_reflect_rule",
  rule_text: string,                     // éventuellement édité par l'opérateur
  rule_candidate_original: string,       // tel que proposé (pour tracer l'édition)
  persona: string,
  source_conversation_id: string,
  source_message_id: string
}

// Response
{ ok: true, correction_id: uuid }
```

Backend :
1. Insert dans `corrections` avec `correction: rule_text`, `bot_message: "[reflect-synthesis]"`, flag `source: 'reflect_synthesis'` (stocké dans `metadata` jsonb si la colonne existe, sinon dans `user_message`)
2. `logLearningEvent(persona, 'rule_added', { from: 'reflect', rule: rule_text })`
3. `extractGraphKnowledge(persona, rule_text, null, null, client)`
4. Insert `feedback_events` type `synthesis_saved` avec `learning_event_id` FK pointant sur l'event créé à l'étape 2
5. `clearIntelligenceCache(intellId)`

Même pipeline que `type: save_rule` existant — juste un marqueur de source différent pour que les patterns analytics puissent distinguer.

#### Endpoint silencieux pour `synthesis_ignored` et `reflect_exit`

Pas de nouveau `type` — un simple `type: "reflect_event"` avec `event_type: 'synthesis_ignored' | 'reflect_exit'` et le payload approprié. Écriture bête dans `feedback_events`, pas de side-effect.

### Section 3 — Frontend : FeedbackPanel state machine

Le composant [`FeedbackPanel.svelte`](../../src/lib/components/FeedbackPanel.svelte) passe d'une logique implicite à une state machine explicite.

#### States

```
idle                   → panel fermé
round1_input           → textarea "ce qui ne va pas" (round 1)
round1_loading         → API regenerate round 1 en cours
round1_picking         → 2 alternatives affichées, attente choix
round2_input           → textarea "pourquoi ces 2 ne vont pas" (round 2)
round2_loading         → API regenerate round 2
round2_picking         → 2 nouvelles alternatives
escalating             → fermeture drawer + toast + focus chat
```

Transitions :
- `idle → round1_input` : ouverture panel via clic ✎
- `round1_input → round1_loading → round1_picking` : clic "Corriger"
- `round1_picking → round2_input` : clic "aucune ne convient →"
- `round1_picking → idle` : clic sur une alt (accept) OU "Garder l'original"
- `round2_picking → escalating → idle` : clic "aucune ne convient →" → ferme drawer, dispatch event `onEscalate` au parent
- `round2_picking → idle` : clic sur une alt OU "Garder l'original"

#### UI par state

**round1_input** (existant, inchangé sauf micro-copy) :
- Textarea `ce qui ne va pas`
- Bouton `Corriger` (primaire) + `Annuler` (ghost)

**round1_picking** / **round2_picking** (nouveau : bouton escalation) :
- 2 alternatives (cards cliquables, existant)
- **Nouveau bouton ghost** : `aucune ne convient →` (sous les alts, avant "Garder l'original")
- Compteur discret en haut-droite : `round 1/2` ou `round 2/2`

**round2_input** (nouveau) :
- Rappel des 2 alts rejetées (texte raccourci, 1 ligne chacune, pliables)
- Textarea `pourquoi ces 2 ne vont pas ?` (placeholder : *"Trop formel dans les deux, j'ai besoin d'ironie…"*)
- Bouton `Nouvelles alternatives` (primaire) + `Annuler` (ghost)
- Compteur `round 2/2`

**escalating** (transition) :
- Fade-out drawer 150ms
- Toast mini : *"On en parle dans le chat."*
- Scroll chat vers le bas (voir Section 4)

### Section 4 — Frontend : thread-embedded meta dialogue

Après escalation, la suite vit dans [`ChatMessage.svelte`](../../src/lib/components/ChatMessage.svelte) et [`src/routes/chat/[persona]/+page.svelte`](../../src/routes/chat/[persona]/+page.svelte).

#### Rendu `clone_reflect`

Dans `ChatMessage.svelte`, nouveau cas dans le dérivé `kind` :
```js
let isReflect = $derived(kind === "clone_reflect" || kind === "operator_reflect");
let isCloneReflect = $derived(kind === "clone_reflect");
let isOpReflect = $derived(kind === "operator_reflect");
```

Style :
- Bulle avec `border: 1px dashed var(--rule-strong)` (pas solide)
- Background `var(--paper-subtle)` (distinct des drafts teintés)
- Label `"↔ debug"` en mono 9.5px en haut (au lieu du seq `[bot:001]`)
- Aucun bouton d'action (`✓` `✎` `↻` `📋` tous absents) — impossible à envoyer au prospect
- `clone_reflect` : bulle gauche ou centrée (pas côté droit des drafts envoyables)
- `operator_reflect` : bulle droite neutre, bordure dashed aussi

Contenu rendu (pour `clone_reflect`) :
- Premier tour : parse du JSON `{explanation, questions}` → rendu en 2 sections visuelles ("Ce que j'ai cru comprendre" / "Où je coince")
- Tours suivants : plain text markdown

#### Composer inline

Sous le **dernier** `clone_reflect` uniquement (pas sous chaque) :
- Mini-textarea 2 lignes, bordure dashed (cohérence visuelle)
- Bouton `Répondre →` + lien-texte `Je veux qu'on réessaie →`
- Si clic `Répondre →` : POST `/api/feedback` type `reflect` avec `reflect_history` enrichi → insert `operator_reflect` dans la DB → nouveau `clone_reflect` en réponse → composer inline se déplace sous le nouveau dernier
- Si clic `Je veux qu'on réessaie →` : flow de reprise (Section 5)

Après 30 secondes sans interaction, les échanges `reflect` du dialogue courant se collapsent :
```
┌─ ↔ debug ─────────────────────────────┐
│ 8 échanges · déplier ▾                │
└───────────────────────────────────────┘
```
Clic → tout se déplie. La bordure dashed reste sur le bloc collapsed.

#### Compteur et garde-fou

Après le 10ᵉ tour de reflect_turn, sous le composer inline :
```
ça traîne — prends 5 min, reprends plus tard
[abandonne, garde l'original]
```
Bouton réel, cliquable, déclenche la sortie "abandon" (Section 5).

### Section 5 — Sortie du dialogue méta

Deux bouts de sortie, tous deux hébergés dans `src/routes/chat/[persona]/+page.svelte` (parent qui orchestre entre le thread et le drawer).

#### Sortie A — "réessaie →"

1. POST `/api/feedback` type `synthesize_reflect` → récupère `{rule_candidate, confidence}`
2. Si `confidence > 0.6` → affiche la carte "j'ai retenu ça" (Section 6) **avant** d'ouvrir le drawer
3. Ferme visuellement le dialogue méta (les clone_reflect restent dans le thread)
4. Rouvre `FeedbackPanel` avec :
   - State = `round1_input`
   - Textarea pré-rempli par une synthèse auto du dialogue méta (récupérée via une sous-requête à l'API synthesize_reflect, champ `retry_prompt_prefill`)
   - Context entier (iteration_history + reflect_history) injecté dans le prompt `regenerate` via un nouveau champ `meta_context` (n'apparaît pas dans l'UI, transparent pour l'opérateur)
5. Opérateur peut éditer le pré-remplissage avant de soumettre
6. Nouveau cycle 2-rounds. Si ce cycle escalade à nouveau, le nouveau dialogue méta a accès à l'ancien (continuité).

Insert `feedback_events` type `reflect_exit` avec `exit: 'retry'`.

#### Sortie B — "abandonne, garde l'original"

Bouton disponible depuis :
- Composer inline sous le dernier `clone_reflect` (petit lien texte)
- La bannière du garde-fou 10 tours

Actions :
1. POST `/api/feedback` type `synthesize_reflect` (pareil que sortie A)
2. Si `confidence > 0.6` → affiche la carte "j'ai retenu ça"
3. Pas de réouverture du drawer ; le `clone_draft` original reste intact dans le thread
4. Insert `feedback_events` type `reflect_exit` avec `exit: 'abandon'`

L'opérateur peut ensuite valider le clone_draft (✓), l'éditer manuellement avant envoi (`edited_before_send`), ou le rejeter plus tard.

### Section 6 — Carte "j'ai retenu ça"

Composant inline dans `src/routes/chat/[persona]/+page.svelte`, affichée **au-dessus du composer principal** (pas dans le thread, pas modal).

```
┌─────────────────────────────────────────────────┐
│ j'ai retenu ça :                                │
│                                                 │
│ ▸ ton ironique-tranchant, pas juste "direct"   │
│ ▸ éviter questions rhétoriques en ouverture    │
│                                                 │
│ [ éditer ] [ ignorer ] [ sauver ✓ ]           │
└─────────────────────────────────────────────────┘
```

Comportement :
- **sauver ✓** (bouton primaire, focus par défaut) → POST `type: accept_reflect_rule` → toast `"règle ajoutée au cerveau"` → carte disparaît
- **éditer** → textarea inline remplace l'affichage read-only, boutons deviennent [annuler] [sauver ✓] ; submit envoie `rule_text: <version éditée>` + `rule_candidate_original: <version initiale>` pour tracer l'édition
- **ignorer** → POST `type: reflect_event` event_type `synthesis_ignored` → carte disparaît sans écriture dans corrections

Si `confidence ≤ 0.6` depuis `synthesize_reflect` → carte **jamais affichée**. POST `type: reflect_event` event_type `synthesis_ignored` (avec marker `confidence_too_low: true`) pour le tracking.

### Section 7 — FeedbackRail (rail feedback, zone B)

Le composant `FeedbackRail.svelte` existant affiche déjà les entrées `feedback_events`. Il doit rendre les nouveaux event_types :

| event_type | Affichage dans le rail |
|------------|------------------------|
| `correction_rejected_round` | `✎ round X · "why_bad" (16 mots)` |
| `reflect_started` | `↔ debug ouvert · escalation round 2` |
| `reflect_turn` | **non affiché individuellement** (trop verbeux, déjà dans le thread) |
| `synthesis_proposed` | **non affiché individuellement** (signal transitoire) |
| `synthesis_saved` | `📏 règle sauvée · "rule_text" (20 mots)` + FK au `learning_event` |
| `synthesis_ignored` | **non affiché** (non-event) |
| `reflect_exit` | **non affiché** (déjà implicite via visibilité du dialogue méta) |

Critère : chaque entrée du rail doit être **actionnable ou informative au retour sur dossier 3h plus tard**. Les tours intermédiaires d'un dialogue méta et les événements transitoires sont du bruit à cette échelle.

## Flow end-to-end (schéma)

```
[opérateur clique ✎ sur clone_draft]
   ↓
[FeedbackPanel: round1_input]
   ↓ "Corriger"
[round1_loading → round1_picking] ─── clic alt ──→ [accept] ──→ ✅ résolu
   ↓ "aucune ne convient →"                      (flow existant)
[round2_input: textarea "pourquoi"]
   ↓ "Nouvelles alternatives"
[round2_loading → round2_picking] ─── clic alt ──→ [accept] ──→ ✅ résolu
   ↓ "aucune ne convient →"
[escalating: fade drawer + toast]
   ↓
[thread: clone_reflect #1 (explanation + questions)]
   ↓ ┌─────────────────────────────────────┐
     │ [composer inline] ────┐             │
     │   ↓ "Répondre →"     │             │
     │ [operator_reflect]    │  boucle     │
     │   ↓                   │  (max 10)   │
     │ [clone_reflect #N]   ←┘             │
     └─────────────────────────────────────┘
   ↓ "Je veux qu'on réessaie →"       ↓ "abandonne, garde l'original"
[API synthesize_reflect]           [API synthesize_reflect]
   ↓                                   ↓
 carte "j'ai retenu ça" (si conf>0.6, dans les 2 cas)
   ↓ sauver / éditer / ignorer
[FeedbackPanel rouvert             [clone_draft original intact
 round1_input pré-rempli]           opérateur décide: ✓ / ✎ / laisser]
   ↓ nouveau cycle 2-rounds
 ...
```

## Testing & vérification

### Tests unitaires (côté lib/API)

- [ ] `regenerate` avec `iteration_history` non-vide : vérifier que les alternatives générées diffèrent textuellement des rejetées (test sur 5 samples)
- [ ] `reflect` sans `reflect_history` : réponse parse bien en `{explanation, questions}` JSON
- [ ] `reflect` avec `reflect_history` : pas de JSON forcé, texte libre
- [ ] `synthesize_reflect` : retourne `{rule_candidate, confidence}` bien typés
- [ ] `accept_reflect_rule` : écrit bien dans `corrections` + `learning_events` + `feedback_events` avec FK cohérente
- [ ] `synthesize_reflect` avec `reflect_history` vide (cas pathologique : "réessaie" cliqué direct sans dialogue) : `confidence < 0.6` attendu (le clone n'a rien appris)

### Tests E2E (smoke, flow complet)

- [ ] **Path A — résolution round 1** : ouvrir drawer, taper correction, recevoir 2 alts, cliquer la 1ère → message remplacé, drawer fermé, toast. (Non-regression du flow actuel.)
- [ ] **Path B — résolution round 2** : round 1 fail (clic "aucune ne convient"), round 2 taper why_bad, recevoir 2 nouvelles alts, cliquer la 2ème → résolu.
- [ ] **Path C — escalation complète retry** : round 1 + 2 fail, escalation, 3 tours méta, clic "réessaie", carte "j'ai retenu ça" sauvée, drawer rouvert avec textarea pré-rempli, nouveau round 1 qui résout.
- [ ] **Path D — escalation abandon** : même setup jusqu'à escalation, dialogue 2 tours, clic "abandonne", carte "j'ai retenu ça" ignorée, clone_draft original intact, aucune écriture dans `corrections`.
- [ ] **Path E — garde-fou 10 tours** : simuler 10 `reflect_turn` → bannière + bouton abandon apparaissent.

### Tests data integrity

- [ ] Après un path C complet : requête `SELECT event_type, COUNT(*) FROM feedback_events WHERE conversation_id = $1 GROUP BY event_type;` → shape attendue : 2× `correction_rejected_round`, 1× `reflect_started`, N× `reflect_turn`, 1× `synthesis_proposed`, 1× `synthesis_saved`, 1× `reflect_exit`, 1× `corrected` (final).
- [ ] Insert de `clone_reflect` avec `turn_kind` : constraint check passe, `draft_of_message_id` optionnel pointe sur le clone_draft original (tracé de pourquoi ce reflect existe).

## Hors scope

- **Patterns inter-sessions** : si 5 prospects différents génèrent chacun une règle "ton trop formel", le système `correction-consolidation.js` (cron existant) les détectera et fusionnera. Rien à changer ici — les règles synthétisées sont écrites au même endroit que les corrections normales.
- **Modification de `voice.writingRules` YAML** : uniquement via `/brain/[persona]` > onglet règles. Le flow de correction ne touche jamais au YAML.
- **Auto-import Breakcold** (roadmap) : compatible tel quel — les `clone_reflect` sont juste des messages avec un turn_kind spécifique, ne cassent rien dans le pipeline d'import.
- **Mode mobile** : le composer inline et la carte "j'ai retenu ça" doivent fonctionner mobile (< 900px), mais pas de design spécifique ici — on hérite du responsive existant de `FeedbackPanel` et du thread.
- **Undo d'une règle synthétisée sauvée** : passe par `/brain/[persona]` > règles > supprimer. Pas de bouton undo dans la carte (ça complique et la carte disparaît de toute façon après 1 clic, le bouton serait inatteignable).

## Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| Coût LLM élevé si un opérateur fait 10 tours méta chaque correction | Garde-fou 10 tours + UX qui pousse à abandonner ("ça traîne — prends 5 min"). Monitoring côté `logLearningEvent` pour détecter si le pattern devient fréquent. |
| Messages `clone_reflect` envoyés par erreur au prospect | **Impossible par design** : pas de bouton ✓, bordure dashed, label "↔ debug". Un opérateur qui voudrait vraiment copier-coller le contenu vers LinkedIn doit le faire manuellement (et voir le label). |
| Règles synthétisées de mauvaise qualité polluent l'intelligence | Seuil `confidence > 0.6` + validation explicite opérateur + édition possible avant sauvegarde. 3 filets de sécurité. |
| Dialogue méta qui ne converge pas, opérateur bloqué dans une conversation infinie | Garde-fou 10 tours + bouton abandon toujours visible dans le composer inline. |
| Régression sur le path A (résolution round 1 direct) | Tests E2E explicites sur path A non-regression. State machine explicite rend plus visible tout changement comportemental sur le path existant. |
| Collision avec la colonne `payload jsonb` si une migration future l'utilise différemment | Nommage spécifique (`payload` générique volontairement, convention documentée par event_type dans la migration 033). Les futures migrations devraient soit étendre les payload shapes documentés, soit ajouter une colonne spécifique. |
