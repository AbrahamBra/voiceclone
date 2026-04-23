# Chat Composer State Machine + Zone Paste — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-24-chat-composer-state-machine-design.md`

**Goal:** Remplacer la ligne de 5 CTAs égaux (dont le `📥 j'ai reçu` opaque) par un CTA primaire inféré depuis le `turn_kind` du dernier message, un menu secondaire pour les alternatives, et une zone paste contextuelle qui apparaît uniquement quand on attend une réponse prospect. Le dismiss de cette zone émet un `feedback_event` pour respecter la règle "chaque action = data d'entraînement".

**Architecture:** Extraction de la logique d'état (`inferPrimary`, `shouldShowPasteZone`) dans un module JS pur testable, pendant que le composant Svelte se contente du rendu réactif. Une seule migration DB (étend l'enum `event_type`). Parent `+page.svelte` dérive `lastTurnKind` depuis `messages` et insère le signal dismiss via l'API `/api/feedback-events` existante.

**Tech Stack:** Svelte 5 (runes `$state` / `$derived` / `$effect`), SvelteKit 2, Supabase (migration SQL), `node:test` pour les unit tests. Pas de framework E2E côté repo — le smoke de bout en bout se fait manuellement sur URL Preview Vercel (cf. règle `feedback_prod_without_ui_test`).

---

## File Structure

**New:**
- `supabase/033_feedback_paste_dismiss.sql` — étend CHECK sur `feedback_events.event_type`.
- `src/lib/composer-state.js` — module JS pur : `inferPrimary(args)`, `shouldShowPasteZone(args)`. Testable hors Svelte.
- `test/composer-state.test.js` — unit tests des deux fonctions (node:test).

**Modified:**
- `src/lib/components/ChatComposer.svelte` — refonte template actions (DM), ajout zone paste, suppressions `prospectMode`, import des helpers depuis `composer-state.js`.
- `src/routes/chat/[persona]/+page.svelte` — `$derived lastTurnKind`, handler `handlePasteDismiss`, passage des props.

**Unchanged but referenced:**
- `api/feedback-events.js` — reuse direct, aucun changement.
- `src/lib/components/ChatMessage.svelte` — aucune modif, continue de rendre `turn_kind` inchangé.

---

## Chunk 1: Migration DB

### Task 1.1: Créer la migration 033

**Files:**
- Create: `supabase/033_feedback_paste_dismiss.sql`

- [ ] **Step 1: Créer le fichier SQL**

```sql
-- 033_feedback_paste_dismiss.sql
-- Ajoute 'paste_zone_dismissed' aux event_types autorisés pour feedback_events.
-- Émis quand l'opérateur dismiss la zone paste "réponse prospect" dans le
-- composer chat. Signal que la conv n'attend plus de réponse (ou que
-- l'opérateur ignore ce prospect pour l'instant). Attaché au dernier message
-- 'toi' de la conv. Suit la séquence 029 → 031 ('excellent') → 032
-- ('client_validated') qui ont déjà étendu ce CHECK.

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

- [ ] **Step 2: Vérifier la syntaxe en comparant avec 032**

Run: `diff supabase/032_feedback_client_validated.sql supabase/033_feedback_paste_dismiss.sql`
Expected: différences = commentaire en-tête + valeur ajoutée dans le CHECK (pattern identique sinon).

- [ ] **Step 3: Commit**

```bash
git add supabase/033_feedback_paste_dismiss.sql
git commit -m "feat(db): migration 033 ajoute paste_zone_dismissed à feedback_events"
```

### Task 1.2: Déploiement migration (instructions non-tech pour l'opérateur)

**Files:** aucun fichier à modifier — action manuelle.

- [ ] **Step 1: Lire la migration avant déploiement**

Ouvrir `supabase/033_feedback_paste_dismiss.sql` et vérifier qu'elle ne supprime que l'ancien CHECK et en crée un nouveau (aucune DROP TABLE, aucune DROP COLUMN).

- [ ] **Step 2: Déployer sur Supabase**

Option A (CLI) : `supabase db push` si configuré.
Option B (Dashboard) :
1. Aller sur https://supabase.com/dashboard/project/<project>/sql/new
2. Coller le contenu de `033_feedback_paste_dismiss.sql`
3. Cliquer "Run"
4. Vérifier qu'il n'y a pas d'erreur rouge en bas.

- [ ] **Step 3: Vérifier en DB**

Dans le SQL Editor du dashboard, exécuter :

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'feedback_events_event_type_check';
```

Expected : la définition contient `'paste_zone_dismissed'` dans la liste.

---

## Chunk 2: Logique pure + tests unit

### Task 2.1: Écrire les tests en premier (TDD)

**Files:**
- Create: `test/composer-state.test.js`

- [ ] **Step 1: Écrire les tests — fonction `inferPrimary`**

```js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { inferPrimary, shouldShowPasteZone } from "../src/lib/composer-state.js";

describe("inferPrimary", () => {
  it("returns null when not DM mode", () => {
    assert.equal(inferPrimary({ isDmMode: false, isEmptyConversation: false, lastTurnKind: 'toi' }), null);
  });

  it("returns DM_1st when conv is empty in DM mode", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: true, lastTurnKind: null }), 'DM_1st');
  });

  it("returns DM_relance when last turn is 'toi'", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'toi' }), 'DM_relance');
  });

  it("returns DM_reply when last turn is 'prospect'", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'prospect' }), 'DM_reply');
  });

  it("returns null when last turn is 'clone_draft' (fallback)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'clone_draft' }), null);
  });

  it("returns null when last turn is 'draft_rejected' (fallback)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'draft_rejected' }), null);
  });

  it("returns null for legacy conv (lastTurnKind=null, not empty)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: null }), null);
  });

  it("prioritizes isEmptyConversation over lastTurnKind (defensive)", () => {
    // Cas non-réaliste mais ordre des if doit être clair
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: true, lastTurnKind: 'toi' }), 'DM_1st');
  });
});
```

- [ ] **Step 2: Écrire les tests — fonction `shouldShowPasteZone`**

```js
describe("shouldShowPasteZone", () => {
  it("returns true when DM + last='toi' + not dismissed", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'toi', pasteDismissed: false }), true);
  });

  it("returns false when dismissed", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'toi', pasteDismissed: true }), false);
  });

  it("returns false when last turn is 'prospect'", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'prospect', pasteDismissed: false }), false);
  });

  it("returns false when last turn is 'clone_draft'", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'clone_draft', pasteDismissed: false }), false);
  });

  it("returns false when not in DM mode", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: false, lastTurnKind: 'toi', pasteDismissed: false }), false);
  });
});
```

- [ ] **Step 3: Run les tests — ils doivent échouer (module pas créé)**

Run: `npm test -- test/composer-state.test.js`
Expected: FAIL — `Cannot find module '../src/lib/composer-state.js'`.

### Task 2.2: Implémenter `composer-state.js` pour faire passer les tests

**Files:**
- Create: `src/lib/composer-state.js`

- [ ] **Step 1: Créer le module avec implémentation minimale**

```js
// Pure state helpers for ChatComposer. Extracted to stay testable without Svelte.
// See spec: docs/superpowers/specs/2026-04-24-chat-composer-state-machine-design.md

/**
 * Infère le CTA DM primaire depuis l'état conv.
 * @param {{ isDmMode: boolean, isEmptyConversation: boolean, lastTurnKind: string|null }} args
 * @returns {'DM_1st'|'DM_relance'|'DM_reply'|null}
 */
export function inferPrimary({ isDmMode, isEmptyConversation, lastTurnKind }) {
  if (!isDmMode) return null;
  if (isEmptyConversation) return 'DM_1st';
  if (lastTurnKind === 'toi') return 'DM_relance';
  if (lastTurnKind === 'prospect') return 'DM_reply';
  return null;
}

/**
 * Décide si la zone paste "réponse prospect" doit être visible.
 * @param {{ isDmMode: boolean, lastTurnKind: string|null, pasteDismissed: boolean }} args
 * @returns {boolean}
 */
export function shouldShowPasteZone({ isDmMode, lastTurnKind, pasteDismissed }) {
  return isDmMode && lastTurnKind === 'toi' && !pasteDismissed;
}
```

- [ ] **Step 2: Run les tests — tout passe**

Run: `npm test -- test/composer-state.test.js`
Expected: PASS pour les 13 cas (8 inferPrimary + 5 shouldShowPasteZone).

- [ ] **Step 3: Commit**

```bash
git add src/lib/composer-state.js test/composer-state.test.js
git commit -m "feat(composer): extraire inferPrimary + shouldShowPasteZone en helpers testables"
```

---

## Chunk 3: Refonte UI ChatComposer

### Task 3.1: Ajouter les nouvelles props + import helpers

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<script>`, props + import)

- [ ] **Step 1: Ajouter l'import en haut du `<script>`**

Juste après `import { CANONICAL_SCENARIOS } from "$lib/scenarios.js";` :

```js
import { inferPrimary, shouldShowPasteZone } from "$lib/composer-state.js";
```

- [ ] **Step 2: Ajouter les deux nouveaux props dans le bloc `$props()`**

Dans la destructuration actuelle, ajouter en fin de liste (avant la closing brace) :

```js
    lastTurnKind = null,              // NEW : 'toi'|'prospect'|'clone_draft'|'draft_rejected'|null
    onPasteDismiss,                   // NEW : () => void — appelé au dismiss de la zone paste
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "feat(composer): ajoute props lastTurnKind + onPasteDismiss"
```

### Task 3.2: Ajouter dérivation `inferredPrimary` et état zone paste

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<script>`, ajout de state + derived)

- [ ] **Step 1: Ajouter les `$state` et `$derived` pour la zone paste**

Juste après `let prospectMode = $state(false);` (qu'on supprimera à la task 3.6) — pour l'instant, ajouter **en parallèle** :

```js
  // --- Zone paste (réponse prospect) — NEW ---
  let pasteDismissed = $state(false);
  let pasteText = $state("");
  let showPasteZone = $derived(
    shouldShowPasteZone({ isDmMode, lastTurnKind, pasteDismissed })
  );
  // Reset dismiss + text quand lastTurnKind change (nouvel envoi → re-propose la zone)
  $effect(() => { lastTurnKind; pasteDismissed = false; pasteText = ""; });

  // --- CTA primaire inféré — NEW ---
  let inferredPrimary = $derived(
    inferPrimary({ isDmMode, isEmptyConversation, lastTurnKind })
  );
```

- [ ] **Step 2: Vérifier qu'il n'y a pas de Svelte compile error**

Run: `npm run build` (ou `npm run dev` et check dans le terminal).
Expected: pas d'erreur de compile. L'UI n'utilise pas encore les nouvelles dérivations, donc visuellement rien ne change.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "feat(composer): ajoute derivations inferredPrimary et showPasteZone"
```

### Task 3.3: Ajouter les handlers de la zone paste

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<script>`, ajout fonctions)

- [ ] **Step 1: Ajouter les 3 handlers**

Quelque part dans la section fonctions (ex. juste après `handleKeydown`) :

```js
  function dismissPaste() {
    pasteDismissed = true;
    pasteText = "";
    onPasteDismiss?.();  // signal fire-and-forget vers le parent
  }

  async function submitPaste() {
    const content = pasteText.trim();
    if (content.length < PROSPECT_MIN) return;
    pasteText = "";
    // pasteDismissed reste false — la zone va disparaître quand lastTurnKind
    // passe à 'prospect' (re-fetch après onAddProspectReply).
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

- [ ] **Step 2: Run dev server — vérifier compile**

Run: `npm run dev` (si pas déjà lancé).
Expected: pas d'erreur de compile Svelte. Fonctions pas encore appelées, rien à tester visuellement.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "feat(composer): ajoute handlers dismissPaste, submitPaste, handlePasteKeydown"
```

### Task 3.4: Rendu template — zone paste au-dessus du composer

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<template>`, insert avant `.composer`)

- [ ] **Step 1: Insérer la zone paste juste avant `<div class="composer" ...>`**

```svelte
{#if showPasteZone}
  <div class="paste-zone" role="region" aria-label="Réponse du prospect">
    <header class="paste-header">
      <span class="paste-label">📥 Il a répondu ?</span>
      <button class="paste-dismiss" type="button" onclick={dismissPaste} aria-label="Ignorer">×</button>
    </header>
    <textarea
      class="paste-textarea"
      bind:value={pasteText}
      onkeydown={handlePasteKeydown}
      placeholder="Colle sa réponse ici…"
      rows="2"
    ></textarea>
    <footer class="paste-footer">
      <button
        class="paste-submit"
        type="button"
        onclick={submitPaste}
        disabled={pasteText.trim().length < PROSPECT_MIN}
      >
        ajouter au fil
      </button>
      <span class="paste-hint">Cmd+Enter · Esc pour annuler</span>
    </footer>
  </div>
{/if}

<div class="composer" class:composer-locked={scenarioMissing}>
```

(La ligne `<div class="composer" ...>` existait déjà — ne la dupliquer pas, insérer la zone paste juste avant.)

- [ ] **Step 2: Tester manuellement en dev**

Run: `npm run dev`, ouvrir une conv DM avec au moins un message validé `toi`.
Expected: une bande apparaît au-dessus du composer avec "📥 Il a répondu ?" et un textarea. Cliquer × → la bande disparaît. Rafraîchir → elle réapparaît (car `pasteDismissed` n'est pas persisté, reset au mount).

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "feat(composer): rendu template zone paste conditionnelle"
```

### Task 3.5: Styles CSS de la zone paste

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<style>`, ajout)

- [ ] **Step 1: Ajouter les styles à la fin du bloc `<style>`**

```css
  /* Zone paste "réponse prospect" — apparaît quand on attend une réponse */
  .paste-zone {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 16px;
    padding: 10px 12px;
    border: 1px dashed var(--rule-strong);
    border-bottom: none; /* colle au composer en-dessous */
    background: var(--paper-subtle, #f6f5f1);
  }
  .paste-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .paste-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-70);
  }
  .paste-dismiss {
    background: transparent;
    border: none;
    color: var(--ink-40);
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
  }
  .paste-dismiss:hover { color: var(--ink); }
  .paste-textarea {
    width: 100%;
    min-height: 42px;
    max-height: 120px;
    resize: vertical;
    padding: 6px 8px;
    border: 1px solid var(--rule);
    background: var(--paper);
    font-family: inherit;
    font-size: 13px;
    color: var(--ink);
  }
  .paste-textarea:focus { outline: 1px solid var(--ink); outline-offset: -1px; }
  .paste-footer {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .paste-submit {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 14px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    cursor: pointer;
  }
  .paste-submit:hover:not(:disabled) { background: var(--vermillon); border-color: var(--vermillon); }
  .paste-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .paste-hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
  }
```

- [ ] **Step 2: Visual check manuel**

Dev server tourne, conv avec `lastTurnKind='toi'`. Vérifier :
- Bordure dashed, fond subtle.
- Le textarea est focusable et accepte du texte.
- Le bouton "ajouter au fil" est disabled tant que < `PROSPECT_MIN` caractères.
- Une fois le seuil passé, clic → le message prospect apparaît dans le fil, la zone disparaît.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "style(composer): zone paste dashed subtle pour matérialiser l'attente"
```

### Task 3.6: Refonte ligne d'actions — CTA primaire + menu

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<template>`, bloc `<div class="actions">` mode DM uniquement)

- [ ] **Step 1: Remplacer la branche `isDmMode` de `.actions`**

Dans le template, repérer le bloc :
```svelte
    {:else if isDmMode}
      <!-- 4 sub-mode CTAs replace the single adaptive button... -->
      {#each DM_SUBMODES as sub (sub.id)}
        <button class="btn-dm" ...>
          {sub.label}
        </button>
      {/each}
      {#if onAddProspectReply}
        <button class="btn-prospect-toggle" ...>📥 j'ai reçu</button>
      {/if}
```

Le remplacer entièrement par :

```svelte
    {:else if isDmMode}
      {#if inferredPrimary}
        <!-- État inféré : 1 CTA primaire dominant + menu secondaire -->
        {@const primary = DM_SUBMODES.find(s => s.id === inferredPrimary)}
        <button
          class="btn-primary btn-dm-primary"
          type="button"
          onclick={() => draftDmSubmode(primary.id)}
          disabled={effectiveDisabled}
          title="{primary.label} — Cmd+Enter sur le textarea draft en mode actif"
        >
          {primary.label}
        </button>
        <details class="action-menu">
          <summary>autre action ▾</summary>
          <ul>
            {#each DM_SUBMODES.filter(s => s.id !== inferredPrimary) as sub (sub.id)}
              <li>
                <button
                  type="button"
                  onclick={() => draftDmSubmode(sub.id)}
                  disabled={effectiveDisabled}
                >
                  {sub.label}
                </button>
              </li>
            {/each}
            <li>
              <button
                type="button"
                disabled
                title="bientôt — entraîne ton clone en conversation directe"
              >
                💬 parler au clone
              </button>
            </li>
          </ul>
        </details>
      {:else}
        <!-- Fallback (clone_draft/draft_rejected/legacy) : 4 chips égaux -->
        {#each DM_SUBMODES as sub (sub.id)}
          <button
            class="btn-dm"
            class:btn-dm-active={sub.id === scenarioType}
            type="button"
            onclick={() => draftDmSubmode(sub.id)}
            disabled={effectiveDisabled}
            aria-pressed={sub.id === scenarioType}
            title="{sub.label} — bascule en mode {sub.id}"
          >
            {sub.label}
          </button>
        {/each}
      {/if}
```

**Noter** : on ne réintroduit PAS le bouton `📥 j'ai reçu` dans le fallback — la zone paste conditionnelle au-dessus le remplace dans tous les états où elle est utile. En fallback (dernier = `clone_draft`), la zone paste est de toute façon cachée (logique attendue : l'opérateur valide le draft d'abord).

- [ ] **Step 2: Tester manuellement les 3 états UI**

Run dev server, ouvrir trois conv DM différentes :
1. **Conv vide** (nouveau prospect) → CTA primaire `✨ 1er message`, menu contient `✨ répondre / ✨ relancer / ✨ closer / 💬 parler au clone (disabled)`.
2. **Conv avec dernier = `toi`** (validé, en attente) → CTA primaire `✨ relancer`, menu contient les 3 autres + closer + parler au clone. Zone paste visible au-dessus.
3. **Conv avec dernier = `clone_draft`** (draft pas encore validé) → pas de CTA primaire, les 4 chips égaux s'affichent. Pas de zone paste.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "feat(composer): refonte ligne actions DM en primaire+menu secondaire"
```

### Task 3.7: Styles CSS du CTA primaire et du menu

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (section `<style>`)

- [ ] **Step 1: Ajouter les styles à la fin du bloc `<style>`**

```css
  /* CTA primaire inféré (dominant) */
  .btn-dm-primary {
    font-size: 13px;
    padding: 10px 20px;
    min-width: 180px;
    font-weight: 500;
  }

  /* Menu secondaire "autre action ▾" (native <details>) */
  .action-menu {
    position: relative;
    font-family: var(--font-mono);
  }
  .action-menu summary {
    font-size: 11px;
    padding: 8px 12px;
    cursor: pointer;
    list-style: none;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink-70);
    user-select: none;
  }
  .action-menu summary::-webkit-details-marker { display: none; }
  .action-menu summary:hover { border-color: var(--ink); color: var(--ink); }
  .action-menu[open] summary { background: var(--paper-subtle, #f6f5f1); }
  .action-menu ul {
    position: absolute;
    right: 0;
    bottom: 100%;
    margin: 0 0 4px 0;
    padding: 4px 0;
    min-width: 200px;
    list-style: none;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    z-index: 10;
  }
  .action-menu li { margin: 0; padding: 0; }
  .action-menu li button {
    width: 100%;
    text-align: left;
    padding: 8px 14px;
    background: transparent;
    border: none;
    font-family: inherit;
    font-size: 11px;
    color: var(--ink);
    cursor: pointer;
  }
  .action-menu li button:hover:not(:disabled) { background: var(--paper-subtle, #f6f5f1); }
  .action-menu li button:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 2: Visual check manuel**

Dans une conv où CTA primaire est actif :
- Bouton primaire clairement plus grand et contrasté que "autre action ▾".
- Clic sur "autre action ▾" → menu s'ouvre au-dessus du bouton (bottom: 100%) pour ne pas dépasser du viewport.
- Clic extérieur ferme le menu (comportement natif `<details>` + listener sur `document` si besoin — voir step 3).
- Item `💬 parler au clone` visible en grisé avec tooltip au hover.

- [ ] **Step 3: Ajouter la fermeture au clic extérieur**

Comme `<details>` ne se ferme pas tout seul au clic extérieur, ajouter dans `<script>` :

```js
  // Close action-menu on outside click
  let actionMenuEl = $state(undefined);
  $effect(() => {
    function onDocClick(e) {
      if (actionMenuEl && !actionMenuEl.contains(e.target)) {
        actionMenuEl.open = false;
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });
```

Et bind l'element dans le template :
```svelte
<details class="action-menu" bind:this={actionMenuEl}>
```

Vérifier : menu ouvert, clic n'importe où dans la page hors menu → ferme.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "style(composer): CTA primaire dominant + dropdown autre-action"
```

### Task 3.8: Suppressions nettes de `prospectMode` et cortège

**Files:**
- Modify: `src/lib/components/ChatComposer.svelte` (suppressions multiples)

- [ ] **Step 1: Supprimer `let prospectMode = $state(false);`**

Repérer la ligne ~34 `let prospectMode = $state(false);` et la supprimer.

- [ ] **Step 2: Supprimer le reset de `prospectMode` dans le `$effect`**

Ligne ~35 : `$effect(() => { scenarioType; ingestMode = false; prospectMode = false; });`
Devient :
```js
$effect(() => { scenarioType; ingestMode = false; });
```

- [ ] **Step 3: Supprimer les 3 fonctions `startProspect`, `cancelProspect`, `addProspectReply`**

Retirer le bloc entier (lignes ~201-226). Les handlers de la zone paste (`dismissPaste`, `submitPaste`) les remplacent.

- [ ] **Step 4: Supprimer les branches `prospectMode` dans `handleKeydown`**

```js
function handleKeydown(e) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (prospectMode) addProspectReply();  // ← supprimer cette ligne
    else if (ingestMode) ingestPost();
    else draftNext();
  }
}
```
Devient :
```js
function handleKeydown(e) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (ingestMode) ingestPost();
    else draftNext();
  }
}
```

- [ ] **Step 5: Supprimer les branches `prospectMode` dans `countState` et `placeholderText`**

`countState` (ligne ~65-73) :
```js
let countState = $derived(
  prospectMode
    ? (chars === 0 ? "idle" : chars < PROSPECT_MIN ? "under" : "ok")  // ← supprimer cette branche
    : ingestMode
    ? ...
);
```
Retirer la branche `prospectMode`.

`placeholderText` (ligne ~85-95) :
```js
let placeholderText = $derived(
  scenarioMissing
    ? "..."
    : prospectMode
      ? "Colle la réponse de ton prospect — ..."  // ← supprimer cette branche
      : ingestMode ? ...
);
```
Retirer la branche `prospectMode`. Le placeholder principal peut être ajusté : `"Tape une consigne pour draft la suite (Cmd+Enter)"` (retirer le `"Réponse reçue → bouton 📥"` qui n'a plus de sens).

- [ ] **Step 6: Supprimer la branche `{#if prospectMode}` du template**

Repérer le bloc (~lignes 234-241 puis ~305-317) :
```svelte
{:else if prospectMode}
  <div class="char-counter" ...>
    ...
  </div>
...
{#if prospectMode}
  <button class="btn-primary btn-prospect" ...>📥 ajouter la réponse</button>
  <button class="btn-cancel-ingest" ...>annuler</button>
{:else if ingestMode}
```

Retirer entièrement la branche `prospectMode` dans les deux endroits. Le `{:else if prospectMode}` de `char-counter` devient juste `{:else if ingestMode}`.

- [ ] **Step 7: Supprimer les styles CSS `.btn-prospect-toggle` et `.btn-prospect`**

Repérer dans `<style>` les blocs commentés `/* Mode "j'ai reçu" : toggle dashed... */` et supprimer jusqu'à la fin de `.btn-prospect:disabled`. Le commentaire de section entier disparaît.

- [ ] **Step 8: Vérifier compilation + comportements conservés**

Run: `npm run dev`.
Expected:
- Pas d'erreur de compile.
- Mode POST : inchangé (1 CTA + `📝 j'ai écrit ce post`).
- Mode ingest : inchangé (toggle `ingestMode` via `startIngest`/`cancelIngest`, bouton `📝 ingérer ce post`).
- Mode DM : CTA primaire + menu si inférence, 4 chips sinon. Zone paste au-dessus si `lastTurnKind='toi'`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "refactor(composer): supprime prospectMode et bouton 'j'ai reçu' opaque"
```

---

## Chunk 4: Wiring parent + signal dismiss

### Task 4.1: Ajouter `$derived lastTurnKind` dans le parent

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte` (section `<script>`)

- [ ] **Step 1: Repérer où `messages` est déclaré**

Chercher `let messages = $state(` dans le fichier (ou équivalent Svelte 5 runes).

- [ ] **Step 2: Ajouter la dérivation juste après**

```js
let lastTurnKind = $derived.by(() => {
  const narrative = messages.filter(m =>
    ['toi', 'prospect', 'clone_draft', 'draft_rejected'].includes(m.turn_kind)
  );
  return narrative.at(-1)?.turn_kind ?? null;
});
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte
git commit -m "feat(chat): derivation lastTurnKind depuis messages narratifs"
```

### Task 4.2: Ajouter le handler `handlePasteDismiss`

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte` (section `<script>`)

- [ ] **Step 1: Repérer comment `authHeaders()` et les autres handlers `feedback-events` sont utilisés**

Chercher `POST feedback-events` dans le fichier (ex. ligne ~827 `fetch("/api/feedback-events", { method: "POST", headers: { ..., ...authHeaders() }, ... })`). Noter la shape exacte des headers et du body.

- [ ] **Step 2: Ajouter le handler — suivre le pattern existant**

Quelque part à côté des autres handlers de feedback (après les existants validated/corrected). Exemple de structure à adapter au pattern observé en step 1 :

```js
  // Signal silencieux — pas de toast, pas de re-fetch. Respecte "chaque action = data".
  async function handlePasteDismiss() {
    // Defensive : la zone paste ne devrait pas être visible sans 'toi', mais on vérifie.
    const lastToi = [...messages].reverse().find(m => m.turn_kind === 'toi');
    if (!lastToi) return;

    try {
      await fetch("/api/feedback-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          conversation_id: currentConvId,  // adapter au nom exact dans le fichier
          message_id: lastToi.id,
          persona_id: personaId,            // adapter au nom exact
          event_type: 'paste_zone_dismissed',
        }),
      });
    } catch (err) {
      // Silent fail — l'UX ne doit pas dépendre du signal
      console.warn("paste_zone_dismissed signal failed:", err);
    }
  }
```

**Action** : ajuster les noms de variables (`currentConvId`, `personaId`) selon ce qui existe déjà dans le fichier. Regarder un autre handler `feedback-events` à côté pour le copier-pattern.

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte
git commit -m "feat(chat): handler handlePasteDismiss emits paste_zone_dismissed signal"
```

### Task 4.3: Passer les nouvelles props au `ChatComposer`

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte` (section template, bloc `<ChatComposer ... />`)

- [ ] **Step 1: Repérer l'invocation actuelle**

Ligne ~1144 : `<ChatComposer ...`

- [ ] **Step 2: Ajouter les deux props**

```svelte
<ChatComposer
  ...props existantes...
  {lastTurnKind}
  onPasteDismiss={handlePasteDismiss}
/>
```

- [ ] **Step 3: Run dev + test manuel flow complet**

Run: `npm run dev`, ouvrir une conv DM vide.
1. Taper une consigne → draft → ✓ valider → le msg passe en `toi`.
2. **Assertion visuelle** : zone paste apparaît au-dessus du composer.
3. **Assertion visuelle** : CTA primaire = `✨ relancer`.
4. Coller "Merci pour le message" dans la zone paste → Cmd+Enter.
5. **Assertion visuelle** : nouveau message `prospect` dans le fil.
6. **Assertion visuelle** : zone paste disparue, CTA primaire = `✨ répondre`.
7. Revenir à l'étape 2, mais cette fois cliquer `×` sur la zone paste.
8. **Assertion visuelle** : zone disparue, pas de message ajouté.
9. **Assertion DB** (via Supabase dashboard) :
```sql
SELECT event_type, created_at FROM feedback_events
WHERE conversation_id = '<conv-id>'
ORDER BY created_at DESC LIMIT 3;
```
Doit contenir une row `paste_zone_dismissed`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte
git commit -m "feat(chat): wire lastTurnKind + onPasteDismiss au ChatComposer"
```

---

## Chunk 5: Smoke manuel + merge

### Task 5.1: Smoke test complet sur URL Preview Vercel

**Files:** aucun fichier — test manuel (non-négociable avant merge master, cf. règle `feedback_prod_without_ui_test`).

- [ ] **Step 1: Push la branche, laisser Vercel builder le preview**

```bash
git push -u origin claude/musing-ellis-01c7d0
```

Attendre 2-3 min que Vercel build et donne l'URL Preview (visible dans les checks de la PR ou dans le dashboard Vercel).

- [ ] **Step 2: Exécuter le flow principal sur l'URL Preview**

Sur `https://voiceclone-<preview>.vercel.app/chat/<persona-id>` :
1. Login normal avec un clone DM existant (si besoin créer un clone + conv vide pour le test).
2. Conv vide : vérifier `inferredPrimary === 'DM_1st'` → bouton primaire `✨ 1er message`.
3. Draft + valider ✓ : bouton primaire devient `✨ relancer`, zone paste apparaît.
4. Coller une "réponse prospect" dans la zone paste, submit : le message prospect s'affiche dans le fil, zone paste disparaît, bouton primaire devient `✨ répondre`.
5. Draft une réponse, valider ✓ : revient en mode "attente" avec zone paste + `✨ relancer`.
6. Cliquer `×` sur la zone paste : disparaît, conversation utilisable normalement.

- [ ] **Step 3: Vérifier DB**

Sur Supabase dashboard, table `feedback_events`, filtrer par `conversation_id` du test et vérifier la présence de la row `paste_zone_dismissed` après l'étape 6.

- [ ] **Step 4: Checker les non-régressions**

Toujours sur l'URL Preview, mais en mode POST :
- Le CTA adaptatif et le bouton `📝 j'ai écrit ce post` sont intacts.
- Collage d'URL LinkedIn → banner "🔗 URL LinkedIn détectée" s'affiche correctement.

- [ ] **Step 5: Si tout est vert → créer la PR**

```bash
gh pr create --title "feat(chat): composer state machine + zone paste" --body "$(cat <<'EOF'
## Summary
- Remplace le bouton opaque `📥 j'ai reçu` par une zone paste contextuelle au-dessus du composer
- CTA primaire DM inféré depuis le `turn_kind` du dernier message, menu secondaire pour forcer une alternative
- Signal `paste_zone_dismissed` émis dans `feedback_events` au dismiss de la zone paste (respecte "chaque action = data")
- Réserve un placeholder `💬 parler au clone` (disabled) pour chantier #3 à venir

Spec : [docs/superpowers/specs/2026-04-24-chat-composer-state-machine-design.md](docs/superpowers/specs/2026-04-24-chat-composer-state-machine-design.md)

## Test plan
- [ ] Unit tests `composer-state.test.js` passent (`npm test`)
- [ ] Smoke manuel sur URL Preview Vercel : flow principal DM (empty → 1er msg → validate → paste prospect reply → reply → validate → relance)
- [ ] Smoke dismiss : zone paste → × → row `paste_zone_dismissed` en DB
- [ ] Non-régression mode POST (CTA + j'ai écrit ce post)
- [ ] Non-régression mode ingest + URL LinkedIn detection

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Appliquer la migration 033 sur prod AVANT merge master**

Comme la migration 033 étend un CHECK et que le handler parent va POSTer `paste_zone_dismissed`, si on merge master **sans** avoir appliqué 033 en prod d'abord, le POST va 500 (contrainte violée). Donc :

1. Appliquer 033 sur le Supabase prod (dashboard SQL editor ou `supabase db push`).
2. Vérifier que le CHECK est bien en place (SELECT sur `pg_constraint` comme en Task 1.2).
3. **Ensuite** merger la PR master.

- [ ] **Step 7: Merger + surveiller**

Après merge, vérifier en prod :
- Pas d'erreur 500 sur `/api/feedback-events` dans les logs Vercel.
- Faire le flow complet 1 fois en prod pour valider.

---

## Récap commits

Ordre chronologique attendu :

1. `feat(db): migration 033 ajoute paste_zone_dismissed à feedback_events`
2. `feat(composer): extraire inferPrimary + shouldShowPasteZone en helpers testables`
3. `feat(composer): ajoute props lastTurnKind + onPasteDismiss`
4. `feat(composer): ajoute derivations inferredPrimary et showPasteZone`
5. `feat(composer): ajoute handlers dismissPaste, submitPaste, handlePasteKeydown`
6. `feat(composer): rendu template zone paste conditionnelle`
7. `style(composer): zone paste dashed subtle pour matérialiser l'attente`
8. `feat(composer): refonte ligne actions DM en primaire+menu secondaire`
9. `style(composer): CTA primaire dominant + dropdown autre-action`
10. `refactor(composer): supprime prospectMode et bouton 'j'ai reçu' opaque`
11. `feat(chat): derivation lastTurnKind depuis messages narratifs`
12. `feat(chat): handler handlePasteDismiss emits paste_zone_dismissed signal`
13. `feat(chat): wire lastTurnKind + onPasteDismiss au ChatComposer`

Soit 13 commits atomiques, chacun correspondant à une étape testable indépendamment.
