# Chat Composer — State Machine CTA + Zone Paste — Design Spec

**Date:** 2026-04-24
**Status:** Draft v1
**Chantier:** #1 d'une série de 4 chantiers UX issus du brainstorm 2026-04-24 (refonte du chat cockpit). Les 3 suivants (drawer cerveau, parler au clone, signal visuel transverse) font l'objet de specs distinctes.
**Relation avec specs existantes :**
- `2026-04-19-chat-dossier-prospect-2-zones-design.md` a introduit `ChatComposer`, `turn_kind`, `feedback_events`. Cette spec **modifie** `ChatComposer.svelte` et réutilise `feedback_events` tel que défini en 029 (puis étendu en 031/032).
- **Une migration ajoutée** : `033_feedback_paste_dismiss.sql` qui étend uniquement l'énumération `event_type` (aucune colonne ajoutée, pas d'index, pas de changement de RLS).
- Côté rail feedback (`FeedbackRail.svelte` issu de la spec 2026-04-19) : l'event `paste_zone_dismissed` est loggé en DB mais **non rendu dans le rail au MVP**. Le rail affiche aujourd'hui les events actionnables (`validated`/`corrected`/`saved_rule`/...) ; `paste_zone_dismissed` est un signal silencieux destiné aux analytics / prochaine iteration rail, pas au feedback journal visible. Si besoin de rendu, le faire dans un chantier de mise à jour du rail.

**Files:**
- modified `src/lib/components/ChatComposer.svelte` — refonte ligne d'actions + ajout zone paste conditionnelle + handler dismiss qui émet un signal
- modified `src/routes/chat/[persona]/+page.svelte` — ajout `$derived lastTurnKind`, nouveau prop passé au composer, handler `handlePasteDismiss` qui insère un `feedback_events` row
- new migration `supabase/033_feedback_paste_dismiss.sql` — étend le CHECK de `feedback_events.event_type` avec `'paste_zone_dismissed'` (suit la séquence 029/031/032 qui ont déjà étendu ce CHECK)
- new `test/composer-infer-primary.test.js` — unit tests inférence CTA
- new `test/composer-paste-zone.test.js` — unit tests visibilité zone paste + émission du signal dismiss
- new `e2e/chat-composer-paste-flow.spec.js` — smoke Playwright flow complet (draft → validate → paste prospect reply → draft suite)

## Problème

Le `ChatComposer` actuel (mode DM) affiche **5 CTAs de poids visuel égal** sur une seule ligne :

```
[ ✨ 1er message ] [ ✨ répondre ] [ ✨ relancer ] [ ✨ closer ] [ 📥 j'ai reçu ]
```

Trois problèmes concrets :

1. **Charge cognitive** : l'opérateur doit choisir mentalement l'action correspondant à l'état de la conversation. Aucun signal visuel ne suggère la "bonne" action pour l'état courant, alors que l'info (le `turn_kind` du dernier message) est déjà en DB.
2. **Label opaque** `📥 j'ai reçu` : ne dit pas *quoi* on a reçu. Le tooltip clarifie mais le label lu seul est incompréhensible. Le bouton est en fait un *toggle de mode* (entrer en `prospectMode` pour coller une réponse).
3. **Deux actions cachées dans un clic** : le bouton "j'ai reçu" fait à la fois "changer de contexte d'input" **et** "préparer la saisie de la réponse". Ça mérite une affordance dédiée, pas un bouton parmi d'autres.

En parallèle, le modèle de données permet déjà de savoir où on en est : `messages.turn_kind ∈ {prospect, clone_draft, toi, draft_rejected}`. On n'utilise pas cette info côté composer.

## Solution : CTA primaire inféré + menu secondaire + zone paste contextuelle

**Trois changements structurels :**

### 1. CTA primaire inféré depuis l'état de la conversation

Le composer reçoit `lastTurnKind` en prop (dérivé par le parent). Il calcule le CTA primaire selon cette table :

| État DM | CTA primaire |
|---|---|
| Conv vide (`isEmptyConversation === true`) | `✨ 1er message` |
| `lastTurnKind === 'toi'` (msg envoyé, en attente de réponse) | `✨ relancer` |
| `lastTurnKind === 'prospect'` (prospect a répondu) | `✨ répondre` |
| `lastTurnKind === 'clone_draft'` (draft en attente de validation) | **Aucun → fallback** (4 chips égaux) |
| `lastTurnKind === 'draft_rejected'` | Idem fallback |
| `lastTurnKind === null` (conv legacy) | Idem fallback |

`closer` **n'est jamais inféré** — décision manuelle uniquement, toujours dans le menu secondaire.

### 2. Menu secondaire "autre action ▾"

À droite du CTA primaire, dropdown simple (`<details><summary>` natif pour a11y gratuite) :
- Les 3 sous-modes DM qui ne sont pas le primaire (pour forcer manuellement si l'inférence rate).
- `✨ closer`.
- `💬 parler au clone` — **disabled**, tooltip "bientôt — entraîne ton clone en conversation directe". Placeholder pour le chantier #3.

Clic sur un item = comportement actuel (`draftDmSubmode(id)` : flip scenario_type si différent, puis draft).

### 3. Zone paste "réponse prospect" — conditionnelle

Apparaît **au-dessus** du composer uniquement quand `isDmMode && lastTurnKind === 'toi' && !pasteDismissed`.

```
┌─ 📥 Il a répondu ? ────────────────────────────┐
│ [textarea mince : "Colle sa réponse ici…"]     │
│ Cmd+Enter pour ajouter · annuler  ·  ×         │
└────────────────────────────────────────────────┘
```

- Input direct (pas de bouton toggle préalable).
- Cmd+Enter ou clic "ajouter" → `onAddProspectReply(content)` (handler existant, inchangé).
- Après ajout, `lastTurnKind` devient `prospect` → la zone disparaît automatiquement, le CTA primaire devient `✨ répondre`.
- `×` ou Escape → `pasteDismissed = true`. Reset automatique dès que `lastTurnKind` change (un nouveau `toi` fera réapparaître la zone).

## Pourquoi ce design

| Décision | Raison |
|---|---|
| Un CTA primaire dominant + menu secondaire plutôt que 4 chips égaux | Réduit la charge cognitive : l'état de la conv *implique* l'action la plus probable. Le menu garde une sortie pour les 5–10% de cas où l'inférence se trompe |
| Inférence calculée dans le composer (pas dans le parent) | Le parent n'a pas à connaître la sémantique UI. Il envoie l'info brute (`lastTurnKind`) ; le composer décide quoi afficher. Découplage propre |
| Zone paste au-dessus et non intégrée au composer | Matérialise visuellement l'état "j'attends une réponse". Sépare physiquement deux actions sémantiquement différentes (consigne pour le clone ≠ réponse du prospect). Supprime un clic (pas de mode toggle à activer) |
| Zone paste conditionnelle (vs toujours visible) | L'affichage *est* le signal. Si elle apparaît, c'est qu'on attend une réponse. Si tu as envoyé et qu'elle est là → paste direct. Pas besoin de formation |
| `closer` jamais inféré auto | Décision de fin de cycle commerciale — trop coûteux en faux-positifs (un prospect qui ne répond pas ≠ un prospect à closer). L'opérateur doit choisir explicitement |
| `💬 parler au clone` reservé en placeholder disabled | Cohérent avec le découpage en 4 chantiers : cette feature touche le backend (nouveau `turn_kind` coaching) + le cerveau. Hors scope de cette spec, mais réservation visuelle évite de re-dessiner le menu au chantier #3 |
| Zone paste apparaît sans voler le focus | L'opérateur peut être en train d'écrire une consigne au moment où il se rend compte qu'une réponse est arrivée. Le focus ne doit pas interrompre sa saisie |
| `<details>` natif pour le menu | A11y gratuite (focus management, Escape, click-outside via `toggle` event), pas de JS custom, pas de dépendance |
| Le dismiss (×) de la zone paste émet un `feedback_event` | Conviction produit : *"chaque action = data d'entraînement, si un bouton n'émet pas de signal, c'est un bug"*. Le dismiss dit quelque chose d'exploitable (la conv n'attend pas de réponse, ou l'opérateur ignore ce prospect). Signal minimal (event_type seulement, pas de payload riche) pour ne pas friccer l'action |
| Signal dismiss attaché au dernier message `toi` de la conv | La table `feedback_events` exige `message_id NOT NULL`. Attacher au dernier `toi` (le message qu'on attendait justement de voir recevoir une réponse) garde la sémantique propre — c'est *ce message-là* dont on dit "pas de réponse attendue". Aucune relaxation de contrainte DB |

## Spec détaillée

### Props de `ChatComposer`

```js
let {
  disabled = false,
  scenarioType = null,
  isEmptyConversation = false,
  lastTurnKind = null,              // NEW : 'toi'|'prospect'|'clone_draft'|'draft_rejected'|null
  onDraftNext,
  onAnalyzeProspect,
  onSwitchScenario,
  onIngestPost,
  onAddProspectReply,
  onPasteDismiss,                   // NEW : () => void — appelé quand l'user dismiss la zone paste (× ou Escape)
} = $props();
```

`lastTurnKind` et `onPasteDismiss` sont les deux additions.

### Dérivation dans le parent

Dans `src/routes/chat/[persona]/+page.svelte`, ajouter :

```js
let lastTurnKind = $derived.by(() => {
  const narrative = messages.filter(m =>
    ['toi', 'prospect', 'clone_draft', 'draft_rejected'].includes(m.turn_kind)
  );
  return narrative.at(-1)?.turn_kind ?? null;
});
```

Puis passer au composer : `<ChatComposer {lastTurnKind} onPasteDismiss={handlePasteDismiss} ... />`.

Les messages avec `turn_kind='meta'` ou `'legacy'` sont ignorés du calcul (ils ne représentent pas un tour narratif utilisable pour l'inférence).

**Handler `handlePasteDismiss`** (dans `+page.svelte`) :

```js
async function handlePasteDismiss() {
  // Trouve le dernier message 'toi' (celui qui a déclenché l'apparition de la zone)
  const lastToi = [...messages].reverse().find(m => m.turn_kind === 'toi');
  if (!lastToi) return; // defensive: zone paste ne devrait pas être visible sans 'toi'

  await fetch('/api/feedback-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      message_id: lastToi.id,
      persona_id: personaId,
      event_type: 'paste_zone_dismissed',
    }),
  });
  // Pas de toast, pas de re-fetch — signal silencieux côté UI
}
```

L'API `/api/feedback-events` existe déjà (cf. `api/feedback-events.js`) et est utilisée pour les event_types existants (`validated`, `corrected`, `client_validated`, `excellent`, `saved_rule`). Reuse direct du même endpoint, seul `event_type: 'paste_zone_dismissed'` est nouveau — c'est pourquoi la migration 033 est nécessaire pour étendre le CHECK.

### Dérivation dans le composer

```js
let inferredPrimary = $derived.by(() => {
  if (!isDmMode) return null;
  if (isEmptyConversation) return 'DM_1st';
  if (lastTurnKind === 'toi') return 'DM_relance';
  if (lastTurnKind === 'prospect') return 'DM_reply';
  return null; // clone_draft / draft_rejected / null → fallback
});
```

### Rendu — ligne d'actions (mode DM)

**Si `inferredPrimary !== null`** :

```svelte
<div class="actions">
  <button class="btn-primary-xl" onclick={() => draftDmSubmode(inferredPrimary)}>
    {DM_SUBMODES.find(s => s.id === inferredPrimary).label}
  </button>
  <details class="action-menu">
    <summary>autre action ▾</summary>
    <ul>
      {#each DM_SUBMODES.filter(s => s.id !== inferredPrimary) as sub (sub.id)}
        <li><button onclick={() => draftDmSubmode(sub.id)}>{sub.label}</button></li>
      {/each}
      <li><button disabled title="bientôt — entraîne ton clone en conversation directe">💬 parler au clone</button></li>
    </ul>
  </details>
</div>
```

**Si `inferredPrimary === null`** : rendu actuel (4 chips égaux, un marqué `aria-pressed` selon `scenarioType`), **moins le bouton "j'ai reçu"**.

### Rendu — zone paste

Composant inline (pas de fichier séparé, < 50 lignes) rendu **avant** le `.composer` quand `showPasteZone === true` :

```svelte
{#if showPasteZone}
  <div class="paste-zone" role="region" aria-label="Réponse du prospect">
    <header>
      📥 Il a répondu ?
      <button class="dismiss" onclick={dismissPaste} aria-label="Ignorer">×</button>
    </header>
    <textarea
      bind:value={pasteText}
      placeholder="Colle sa réponse ici…"
      onkeydown={handlePasteKeydown}
    ></textarea>
    <footer>
      <button onclick={submitPaste} disabled={pasteText.trim().length < PROSPECT_MIN}>
        ajouter au fil
      </button>
      <span class="hint">Cmd+Enter · Esc pour annuler</span>
    </footer>
  </div>
{/if}
```

Dérivation et handlers :

```js
let pasteDismissed = $state(false);
let pasteText = $state("");
let showPasteZone = $derived(
  isDmMode && lastTurnKind === 'toi' && !pasteDismissed
);
// Reset dismiss et text à chaque changement de lastTurnKind
$effect(() => { lastTurnKind; pasteDismissed = false; pasteText = ""; });

function dismissPaste() {
  pasteDismissed = true;
  pasteText = "";
  onPasteDismiss?.();  // signal d'entraînement (fire-and-forget côté composer)
}

async function submitPaste() {
  const content = pasteText.trim();
  if (content.length < PROSPECT_MIN) return;
  pasteText = "";
  // pasteDismissed reste false — mais la zone va disparaître dès que
  // lastTurnKind passe à 'prospect' (re-fetch après onAddProspectReply)
  await onAddProspectReply?.(content);
}

function handlePasteKeydown(e) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitPaste();
  } else if (e.key === "Escape") {
    e.preventDefault();
    dismissPaste();
  }
}
```

Le composer n'attend pas de confirmation : `onPasteDismiss?.()` est appelé en fire-and-forget. Si l'insert `feedback_events` côté parent échoue, on ne bloque pas l'UX. Le parent peut logger l'erreur mais ne remonte rien au composer.

### Keyboard

| Focus | Touche | Action |
|---|---|---|
| Textarea principal | `Cmd/Ctrl+Enter` | `draftNext()` (utilise le `scenarioType` actif ; si `inferredPrimary` diffère, Cmd+Enter NE switche PAS de sous-mode — l'user doit cliquer le CTA pour cela, pour éviter les switches accidentels) |
| Textarea principal | `Shift+Enter` | Newline |
| Textarea zone paste | `Cmd/Ctrl+Enter` | `submitPaste()` (si longueur >= `PROSPECT_MIN`) |
| Textarea zone paste | `Escape` | `dismissPaste()` |
| Menu ouvert | `↑`/`↓` | Navigation (skip disabled) |
| Menu ouvert | `Enter` | Sélectionne + ferme + exécute |
| Menu ouvert | `Escape` | Ferme sans sélectionner |

**Note sur Cmd+Enter dans le textarea principal** : il n'active PAS l'inférence. Si le CTA primaire inféré est `DM_relance` mais le `scenarioType` courant est `DM_1st` (par ex. l'user vient d'ouvrir la conv), Cmd+Enter draft en `DM_1st`. Pour drafter la relance, cliquer le bouton primaire. Cette décision évite les changements de contexte silencieux.

### Focus management

- Mount du composer : focus textarea principal (comportement actuel).
- `lastTurnKind` change vers `toi` → zone paste apparaît, **focus reste sur textarea principal** (pas de vol de focus). L'user tabule/clique dans la zone paste pour y écrire.
- `submitPaste` résolu → zone disparaît (car `lastTurnKind === 'prospect'`), focus revient sur textarea principal.

### Suppressions nettes dans `ChatComposer.svelte`

Pas de backcompat, pas de code mort (cf. convictions user `feedback_feature_pragmatism`) :
- `let prospectMode = $state(false);` + son `$effect` de reset (scenarioType)
- `PROSPECT_MIN` reste (réutilisé par la zone paste)
- Fonctions `startProspect`, `cancelProspect`, `addProspectReply` → logique inlinée dans la zone paste (`submitPaste`, `dismissPaste`)
- Branche `{#if prospectMode}` dans template
- Branche `prospectMode` dans `handleKeydown`, `placeholderText`, `countState`
- Bouton `📥 j'ai reçu` et ses styles `.btn-prospect-toggle` / `.btn-prospect`

### Conversations legacy

Les conv legacy (tous messages `turn_kind='legacy'`) → `lastTurnKind === null` → fallback 4 chips + pas de zone paste. Cohérent avec `2026-04-19-chat-dossier-prospect-2-zones-design.md` §6 du plan de déploiement : "legacy = pas d'actions ✓/✎". On respecte le principe : les conv legacy fonctionnent en mode dégradé.

### Migration 033 — signal paste_zone_dismissed

Fichier `supabase/033_feedback_paste_dismiss.sql` — suit la séquence 029 / 031 / 032 qui ont déjà étendu le CHECK :

```sql
-- 033_feedback_paste_dismiss.sql
-- Ajoute 'paste_zone_dismissed' aux event_types autorisés pour feedback_events.
-- Émis quand l'opérateur dismiss la zone paste "réponse prospect" dans le
-- composer, signal que la conv n'attend plus de réponse (ou que l'opérateur
-- ignore ce prospect pour l'instant). Attaché au dernier message 'toi' de la conv.

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN (
    'validated',
    'validated_edited',
    'corrected',
    'saved_rule',
    'excellent',
    'client_validated',
    'paste_zone_dismissed'
  ));
```

Pas de changement de colonnes. Pas d'index additionnel.

## Tests

### Unit — inférence CTA (`test/composer-infer-primary.test.js`)

Tester la fonction `inferPrimary(isDmMode, isEmptyConversation, lastTurnKind)` — extractable pour testabilité :

| Cas | Input | Expected |
|---|---|---|
| Non-DM (POST) | `isDmMode=false` | `null` |
| Conv DM vide | `isDmMode=true, isEmpty=true` | `'DM_1st'` |
| DM, dernier = toi | `isDmMode=true, lastTurnKind='toi'` | `'DM_relance'` |
| DM, dernier = prospect | `isDmMode=true, lastTurnKind='prospect'` | `'DM_reply'` |
| DM, dernier = clone_draft | `isDmMode=true, lastTurnKind='clone_draft'` | `null` |
| DM, dernier = draft_rejected | `isDmMode=true, lastTurnKind='draft_rejected'` | `null` |
| DM legacy (null) | `isDmMode=true, lastTurnKind=null, isEmpty=false` | `null` |

### Unit — visibilité zone paste + signal dismiss (`test/composer-paste-zone.test.js`)

| Cas | State | Expected |
|---|---|---|
| DM + dernier = toi + non dismissed | `isDmMode=true, lastTurnKind='toi', dismissed=false` | `showPasteZone === true` |
| DM + dernier = toi + dismissed | idem + `dismissed=true` | `false` |
| DM + dernier = prospect | `lastTurnKind='prospect'` | `false` |
| DM + dernier = clone_draft | `lastTurnKind='clone_draft'` | `false` |
| Non-DM | `isDmMode=false, lastTurnKind='toi'` | `false` |
| Transition : dismiss puis lastTurnKind change | dismissed=true puis `lastTurnKind='toi' → 'prospect' → 'toi'` | Après transition, `showPasteZone === true` (dismiss reset) |
| Signal dismiss émis via × | Clic sur `×` | `onPasteDismiss` appelé exactement 1 fois |
| Signal dismiss émis via Escape | `Escape` dans textarea paste | `onPasteDismiss` appelé exactement 1 fois |
| Signal dismiss non émis au submit | `submitPaste` résolu → zone disparaît | `onPasteDismiss` **non** appelé (dismiss ≠ submit) |
| Parent handler early-return sans `toi` | `messages = []` (ou sans aucun `toi`), `handlePasteDismiss()` appelé | Pas de `fetch` vers `/api/feedback-events` (assert via mock) |

### Smoke Playwright (`e2e/chat-composer-paste-flow.spec.js`)

**Non-négociable avant merge master** (cf. `feedback_prod_without_ui_test`).

Flow principal :
1. Se logger, ouvrir un clone DM, scénario `DM_1st`.
2. Tape une consigne + Cmd+Enter → voit un `clone_draft`.
3. Clic ✓ sur le draft → `turn_kind='toi'`, le message s'affiche en "envoyé".
4. **Assertion** : la zone paste apparaît au-dessus du composer avec "Il a répondu ?".
5. **Assertion** : le CTA primaire affiche "relancer".
6. Tape "Merci pour le message, je suis intéressé" dans la zone paste + Cmd+Enter.
7. **Assertion** : un nouveau message `prospect` apparaît dans le fil.
8. **Assertion** : la zone paste a disparu.
9. **Assertion** : le CTA primaire affiche maintenant "répondre".

Flow dismiss (secondaire, optionnel dans le smoke) :
1. Même flow jusqu'à l'étape 4 (zone paste visible après validation d'un `toi`).
2. Clic sur le `×` de la zone paste.
3. **Assertion UI** : la zone disparaît.
4. **Assertion DB** (via select Supabase dans le test) : une row `feedback_events` existe avec `event_type='paste_zone_dismissed'` attachée au message `toi` précédent. Pas d'assertion sur le rail (signal non rendu au MVP, cf. §Relation avec specs existantes).

### Non-régression (checklist dev, pas tests auto)

- Mode POST intact (la refonte touche uniquement la branche `isDmMode`).
- Mode ingest (`📝 j'ai écrit ce post`) intact.
- URL LinkedIn détectée dans textarea principal → banner inchangé.
- Starters (amorces de consigne) inchangés.
- Scénario manquant → scenario-gate inchangé.

## Out of scope

Ce qui **ne** fait **pas** partie de cette spec (chantiers à venir) :

- **Chantier #2 — Drawer cerveau latéral** : remplacer la navigation vers `/brain/[persona]` par un drawer côté chat.
- **Chantier #3 — "Parler au clone"** : implémenter le mode conversationnel meta (nouveau `turn_kind`, flow IA différent, remontée des règles extraites vers le cerveau). Le placeholder disabled dans le menu est réservé pour ce chantier.
- **Chantier #4 — Signal visuel transverse** : couleur d'accent pour les moments où la data bouge (drafting, règle apprise, fidelity grimpe), micro-animations utiles.

## Ordre de déploiement

1. Créer la branche, l'écrire, passer les tests unit.
2. Tester manuellement en local : flow DM complet.
3. Tester sur URL Preview Vercel avec le flow Playwright manuel (auth wall ok pour test).
4. Merge master **seulement si** le Playwright smoke passe et l'UI est validée visuellement.
