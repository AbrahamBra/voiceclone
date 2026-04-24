# Drawer cerveau latéral (chantier #2)

**Date:** 2026-04-24
**Status:** Draft v1
**Chantier:** #2 d'une série de 4 chantiers UX issus du brainstorm 2026-04-24 (refonte du chat cockpit). Les chantiers #1 (composer state machine, SHIPPED via PR #63/#67/#68) et #3 (Parler au clone) / #4 (Signal visuel transverse) font l'objet de specs distinctes.

## Relation avec specs existantes

- `2026-04-24-chat-composer-state-machine-design.md` (chantier #1) — ce chantier ajoute le bouton 🧠 dans la top-bar du chat et ne touche **pas** la logique composer / zone paste / signal `paste_zone_dismissed`. Le composer reste pleinement fonctionnel drawer ouvert.
- `2026-04-24-protocole-vivant-design.md` — la future vue Doctrine (Sprint 3 du roadmap protocole-v2) intégrera un **SSE activity feed** à l'intérieur du `ProtocolPanel`. Ce chantier **n'anticipe pas** cette intégration : il se contente de monter le `ProtocolPanel` actuel dans le drawer. Quand la v2 landera, le remplacement sera transparent.
- Chantier #4 (pas encore spec'd) — "Signal visuel transverse" : les pulses cross-UI arriveront via ce chantier ultérieur. Ce drawer reste une pure chrome sans bande activité propre (cf. section "Hors scope").

**Files (à créer / modifier / supprimer) :**
- new `src/lib/components/BrainDrawer.svelte` — shell drawer : tabs bar, slide animation, media query desktop/mobile, handlers ESC/✕, monte les 4 `Panel` existants
- new `src/lib/stores/brainDrawer.js` — store partagé `{ open, tab }` + API `open/close/toggle/setTab/openAt`, sync bidirectionnel avec `$page.url.searchParams`
- new `src/lib/api/brainEvents.js` — helper `emitBrainEvent(type, payload)` qui POST sur `/api/feedback-events` avec le dernier message narratif de la conv courante (ou skip silencieusement si aucun narratif — préserve l'invariant DB `message_id NOT NULL`)
- modified `src/lib/components/ProtocolPanel.svelte` — ajout d'un **prop callback optionnel** `onRuleAdded?: () => void` invoqué après un ajout de règle réussi. Prop optionnel → tests existants et usages legacy restent compatibles.
- modified `src/routes/chat/[persona]/+page.svelte` — ajout bouton 🧠 top-bar, mount `<BrainDrawer />`, remplacement du `goto('/brain/...')` dans ⌘K par `brainDrawer.openAt(tab)`, wrapper CSS pour side-by-side 60/40, `$effect` de sync URL→store, handler `celebrateRuleAdded` qui appelle `emitBrainEvent('brain_edit_during_draft', ...)` puis déclenche pulse + toast
- modified `api/feedback-events.js` — élargit la `VALID_TYPES` (ligne 3) en ajoutant `copy_paste_out`, `regen_rejection` (manquants depuis 040 — drift API vs DB), `brain_drawer_opened`, `brain_edit_during_draft`. Pas de changement de schéma, pas de relaxation du `message_id NOT NULL` (cf. "Hors scope" § 7 — le client skip l'émission si aucun message narratif existe).
- deleted `src/routes/brain/[persona]/+page.svelte` (163 lignes) — remplacé par `+page.server.js`
- deleted `src/routes/brain/[persona]/+page.js` — remplacé par `+page.server.js` (la logique côté client disparaît avec le redirect)
- new `src/routes/brain/[persona]/+page.server.js` — redirect 307 `/brain/[persona]` → `/chat/[persona]?brain=<tab>` (préserve hash legacy `#<tab>` et query legacy `?tab=<tab>`)
- new migration `supabase/041_feedback_brain_drawer.sql` — étend CHECK `feedback_events.event_type` avec `'brain_drawer_opened'` et `'brain_edit_during_draft'`. Numéro 041 car 038/039/040 sont déjà pris (038/039 = protocole-v2 core/hooks, 040 = training signal capture).
- new tests :
  - `test/brain-drawer-store.test.js` — open/close/toggle/setTab, openAt fallback sur lastTab, syncFromUrl bidirectionnel, précédence URL > localStorage > DEFAULT, persistence `brainDrawer:lastTab`.
  - `test/brain-drawer-url.test.js` — helpers URL : parse `?brain=<tab>`, fallback tab invalide → `connaissance`, build URL avec `replaceState:false`, serialisation avec et sans param.
  - `test/brain-redirect.test.js` — `+page.server.js` retourne 307, préserve `#protocole` legacy → `?brain=protocole`, préserve `?tab=X` legacy, fallback tab invalide → `connaissance`, params.persona invalide → propage 404 SvelteKit standard.
  - `test/brain-signals.test.js` — `emitBrainEvent` : source `top_button`/`cmd_k`/`url_redirect` passé correctement, skip silencieux si aucun message narratif dans la conv, `brain_edit_during_draft` seulement si `hasDraft === true`, best-effort (warn console sans bloquer UX) si le POST échoue.
  - `test/protocol-panel-callback.test.js` — ajout d'une règle dans `ProtocolPanel` déclenche `onRuleAdded` une seule fois si le save backend réussit (assert via mock), n'est **pas** appelé en cas d'erreur save (pas de célébration sur échec).
  - `test/migrations/041-brain-events.test.js` — CHECK accepte les 11 event_types valides (9 existants + 2 nouveaux), rejette un event inventé.

**Fichiers inchangés (réutilisation directe) :** `KnowledgePanel.svelte`, `IntelligencePanel.svelte`, `SettingsPanel.svelte`. Chaque Panel reçoit déjà `{personaId}` en prop et gère son fetch/save de manière autonome. Le drawer ne fait que les monter dans un nouveau container. `SettingsPanel` supporte déjà `embedded={true}` + `onClose` — comportement préservé (vérifié depuis `/brain/[persona]/+page.svelte` actuel, lignes 104-105).

## Convictions produit → décisions design

| Décision | Raison |
|---|---|
| Drawer = pure chrome, les Panels restent la source de vérité UI | Les 4 `Panel` sont déjà isolés, ont déjà leur fetch/save, sont déjà testés. Dupliquer leur contenu créerait une divergence à chaque edit (violation DRY). Le drawer orchestre, il n'affiche rien de propre. |
| Side-by-side push (60/40) sur desktop vs overlay modal | Le but du chantier est d'éditer le cerveau *pendant* qu'on drafte. L'overlay modal casserait cet objectif en masquant le composer. Le push rétrécit le chat sans le rendre inaccessible. |
| Full-screen slide-in sur mobile vs bottom sheet ou redirect | Le brain a du contenu dense (upload PDF, protocole multi-règles, réglages avec form). Le plein écran donne l'espace nécessaire. Le bottom sheet à hauteur partielle serait trop à l'étroit. Le redirect vers `/brain/[persona]` (comportement actuel) casserait la cohérence "mobile = expérience de 2e classe". |
| Query param `?brain=<tab>` vs param binaire `?brain=1` ou hash | Le shareability ("envoie-moi l'URL du protocole de ce clone") est un workflow agence réel (user a plusieurs setters, supervise). Un param identifiant l'onglet permet `?brain=protocole` copiable. SvelteKit `goto(url, { replaceState, noScroll, keepFocus })` évite le re-fetch à chaque toggle. |
| `/brain/[persona]` devient redirect 307 plutôt que route standalone préservée | Préserve les bookmarks existants (`#protocole` legacy converti en `?brain=protocole`) tout en unifiant l'UX. Zéro divergence entre deux surfaces qui montreraient les mêmes Panels. Un seul code-path pour les 4 tabs. |
| Drawer reste ouvert au switch de persona (⌘⇧C) vs se ferme | Workflow agence = édite plusieurs clones à la file. Les Panels sont réactifs à `{personaId}` → ils se re-fetch, drawer reste le bon container. Pas de "edits non sauvés" à protéger : les Panels sauvegardent au fur et à mesure (pas de bouton Save global). |
| Nouveau signal `brain_edit_during_draft` émis *seulement* si draft actif, via callback `onRuleAdded` sur ProtocolPanel | Aligne sur la conviction "chaque action = data d'entraînement". Le signal capture le moment le plus data-intéressant : user corrige le clone en cours d'échange. Hors draft, l'ajout reste un ajout normal (signal `saved_rule` existant). |
| Pulse visuel sur ↻ regénérer + toast "Règle apprise" quand `brain_edit_during_draft` | Aligne sur `project_voiceclone_celebrate_signals.md`. Rend la boucle visible : "tu as édité, le clone a appris, regénère pour voir la différence". Animation 1.5s non-bloquante. Pas de modal ni de confirmation — data-move célébrée, user continue de travailler. |
| Pas de bande activité transverse dans le drawer (vs strip SSE en bas) | Éviterait de dupliquer le feed SSE prévu dans la vue Doctrine (protocole-v2 Sprint 3) + les pulses cross-UI prévus au chantier #4. Le drawer est un container, les signaux live appartiennent aux chantiers dédiés. Ajout possible plus tard sans refactor (un simple slot dans `BrainDrawer.svelte`). |

## Spec détaillée

### Store `brainDrawer`

**Précédence de résolution du tab** (important pour la cohérence) :
1. **URL `?brain=<tab>`** — gagne toujours si présent et valide. Représente l'intention explicite user (lien partagé, deep-link, nav).
2. **`localStorage.brainDrawer:lastTab`** — si pas d'URL param, on réouvre sur le dernier onglet que le user a activement choisi.
3. **`DEFAULT_TAB = 'connaissance'`** — si ni URL ni localStorage.

**`toggle()` re-ouvre sur le dernier onglet** (pas sur `DEFAULT_TAB`). C'est l'intention : fermer+re-ouvrir = geste de dismiss, pas de reset.

```js
// src/lib/stores/brainDrawer.js
import { writable, get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/stores';

const VALID_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT_TAB = 'connaissance';
const STORAGE_KEY = 'brainDrawer:lastTab';

function createBrainDrawerStore() {
  const { subscribe, set, update } = writable({ open: false, tab: DEFAULT_TAB });

  function lastTab() {
    if (typeof localStorage === 'undefined') return DEFAULT_TAB;
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_TABS.includes(stored) ? stored : DEFAULT_TAB;
  }

  function rememberTab(tab) {
    if (typeof localStorage !== 'undefined' && VALID_TABS.includes(tab)) {
      localStorage.setItem(STORAGE_KEY, tab);
    }
  }

  return {
    subscribe,
    // open(undefined) → lastTab. open('protocole') → 'protocole'. Invalid → lastTab.
    open(tab) {
      const t = VALID_TABS.includes(tab) ? tab : lastTab();
      rememberTab(t);
      syncUrl(t);
      set({ open: true, tab: t });
    },
    openAt(tab) {
      return this.open(tab);
    },
    close() {
      syncUrl(null);
      update(s => ({ ...s, open: false }));
    },
    // toggle() → re-ouvre sur l'onglet *courant* (pas lastTab ni DEFAULT).
    // Si user avait navigué via URL `?brain=intelligence`, toggle off puis on garde 'intelligence'.
    toggle() {
      const s = get({ subscribe });
      if (s.open) {
        this.close();
      } else {
        const t = VALID_TABS.includes(s.tab) ? s.tab : lastTab();
        rememberTab(t);
        syncUrl(t);
        set({ open: true, tab: t });
      }
    },
    setTab(tab) {
      if (!VALID_TABS.includes(tab)) return;
      rememberTab(tab);
      syncUrl(tab);
      update(s => ({ ...s, tab }));
    },
    // Appelé depuis le layout chat (via $effect) pour réconcilier URL → store
    // au mount ET à chaque changement de $page.url.searchParams.
    // URL est la source de vérité ; localStorage n'intervient qu'à l'ouverture
    // explicite sans param.
    syncFromUrl(urlTab) {
      if (urlTab && VALID_TABS.includes(urlTab)) {
        rememberTab(urlTab);
        set({ open: true, tab: urlTab });
      } else {
        update(s => ({ ...s, open: false }));
      }
    },
  };
}

function syncUrl(tab) {
  const current = get(page);
  const url = new URL(current.url);
  if (tab) {
    url.searchParams.set('brain', tab);
  } else {
    url.searchParams.delete('brain');
  }
  goto(url, { replaceState: false, noScroll: true, keepFocus: true });
}

export const brainDrawer = createBrainDrawerStore();
export const VALID_BRAIN_TABS = VALID_TABS;
```

### Composant `BrainDrawer.svelte`

```svelte
<script>
  import { brainDrawer, VALID_BRAIN_TABS } from '$lib/stores/brainDrawer';
  import KnowledgePanel from './KnowledgePanel.svelte';
  import IntelligencePanel from './IntelligencePanel.svelte';
  import ProtocolPanel from './ProtocolPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';

  let { personaId, onRuleAddedWhileDrafting, hasActiveDraft = false } = $props();

  const TABS = [
    { id: 'connaissance', label: 'Connaissance' },
    { id: 'protocole',    label: 'Protocole'    },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'reglages',     label: 'Réglages'     },
  ];

  function handleKeydown(e) {
    if (e.key === 'Escape' && $brainDrawer.open) {
      // ESC ne ferme pas si focus dans composer (évite conflit Enter/Submit)
      const focused = document.activeElement;
      if (focused?.tagName === 'TEXTAREA' || focused?.tagName === 'INPUT') return;
      brainDrawer.close();
    }
  }

  function handleRuleAdded() {
    if (hasActiveDraft) {
      onRuleAddedWhileDrafting?.();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $brainDrawer.open}
  <aside class="brain-drawer" role="complementary" aria-label="Cerveau du clone">
    <header class="drawer-header">
      <div class="tabs" role="tablist">
        {#each TABS as tab}
          <button
            role="tab"
            class="tab"
            class:active={$brainDrawer.tab === tab.id}
            aria-selected={$brainDrawer.tab === tab.id}
            onclick={() => brainDrawer.setTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <button class="close" aria-label="Fermer le cerveau" onclick={() => brainDrawer.close()}>
        ✕
      </button>
    </header>

    <div class="panel-body" role="tabpanel">
      {#if $brainDrawer.tab === 'connaissance'}
        <KnowledgePanel {personaId} />
      {:else if $brainDrawer.tab === 'protocole'}
        <ProtocolPanel {personaId} onRuleAdded={handleRuleAdded} />
      {:else if $brainDrawer.tab === 'intelligence'}
        <IntelligencePanel {personaId} />
      {:else if $brainDrawer.tab === 'reglages'}
        <SettingsPanel embedded={true} {personaId} onClose={() => brainDrawer.close()} />
      {/if}
    </div>
  </aside>
{/if}

<style>
  .brain-drawer {
    display: flex;
    flex-direction: column;
    background: var(--surface-1, #fff);
    border-left: 1px solid var(--border, #e5e5e5);
    /* desktop: side-by-side géré par le parent via grid/flex */
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
  }

  .tab {
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
  }

  .tab.active {
    background: var(--surface-2);
    font-weight: 600;
  }

  .close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.2rem;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
  }

  @media (max-width: 899px) {
    .brain-drawer {
      position: fixed;
      inset: 0;
      z-index: 50;
      transform: translateX(0);
      transition: transform 180ms ease-out;
    }
  }
</style>
```

### Helper `emitBrainEvent`

`src/lib/api/brainEvents.js` — helper fire-and-forget qui encapsule la résolution `message_id` + le POST. Référencé par les 3 call sites décrits plus bas.

```js
// src/lib/api/brainEvents.js
import { get } from 'svelte/store';
import { messages, currentConversationId } from '$lib/stores/chat';  // stores existants
import { authHeaders } from '$lib/auth';  // helper existant utilisé par les autres appels feedback

const NARRATIVE_KINDS = ['toi', 'prospect', 'clone_draft', 'draft_rejected'];

/**
 * Émet un event brain sur /api/feedback-events, fire-and-forget.
 * Skip silencieusement si la conv n'a aucun message narratif (invariant message_id NOT NULL).
 *
 * @param {'brain_drawer_opened'|'brain_edit_during_draft'} type
 * @param {{source?: 'top_button'|'cmd_k'|'url_redirect', tab?: string, has_draft?: boolean}} payload
 */
export async function emitBrainEvent(type, payload = {}) {
  const convId = get(currentConversationId);
  if (!convId) return;  // pas de conv active → skip

  const narrative = get(messages).filter(m => NARRATIVE_KINDS.includes(m.turn_kind));
  const lastNarrative = narrative.at(-1);
  if (!lastNarrative) return;  // conv vierge → skip silencieux, UX préservée

  try {
    const res = await fetch('/api/feedback-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        conversation_id: convId,
        message_id: lastNarrative.id,
        event_type: type,
        // payload stocké dans un champ JSON existant sur feedback_events si présent,
        // sinon loggé côté console. Vérifier schema actuel lors de l'impl.
        meta: payload,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`${type} HTTP`, res.status, text);
    }
  } catch (err) {
    console.warn(`${type} network error:`, err);
  }
}
```

### Bouton top-bar + layout chat

Dans `src/routes/chat/[persona]/+page.svelte`, 3 zones à modifier (les variables `composerText`, `showToast`, `personaId`, `personaName`, `$messages`, `$currentConversationId` existent déjà dans le fichier, cf. chantier #1) :

**1. Import + bouton top-bar + handler célébration + emission `top_button` :**
```svelte
<script>
  import BrainDrawer from '$lib/components/BrainDrawer.svelte';
  import { brainDrawer } from '$lib/stores/brainDrawer';
  import { emitBrainEvent } from '$lib/api/brainEvents';
  import { page } from '$app/stores';

  // Sync URL → store au mount + à chaque nav.
  // Si ?brain arrive via URL (redirect legacy ou lien partagé), émet aussi le signal url_redirect.
  let lastEmittedTabForUrl = null;
  $effect(() => {
    const urlTab = $page.url.searchParams.get('brain');
    brainDrawer.syncFromUrl(urlTab);
    if (urlTab && urlTab !== lastEmittedTabForUrl) {
      emitBrainEvent('brain_drawer_opened', { source: 'url_redirect', tab: urlTab });
      lastEmittedTabForUrl = urlTab;
    } else if (!urlTab) {
      lastEmittedTabForUrl = null;  // reset pour pouvoir ré-émettre si re-ouvert via URL
    }
  });

  // Draft actif = textarea contient du texte non vide.
  let hasActiveDraft = $derived(composerText.trim().length > 0);

  // Source 1 : bouton 🧠 top-bar → toggle + émet 'top_button' à l'ouverture uniquement.
  function handleBrainToggle() {
    const wasClosed = !$brainDrawer.open;
    brainDrawer.toggle();
    if (wasClosed) {
      emitBrainEvent('brain_drawer_opened', { source: 'top_button', tab: $brainDrawer.tab });
    }
  }

  function celebrateRuleAdded() {
    regenPulseActive = true;
    setTimeout(() => { regenPulseActive = false; }, 1500);
    showToast("Règle apprise — ↻ regénère pour l'appliquer");
    emitBrainEvent('brain_edit_during_draft', { tab: $brainDrawer.tab, has_draft: true });
  }

  let regenPulseActive = $state(false);
</script>

<!-- Top-bar -->
<header class="chat-topbar">
  <span class="persona-name">{personaName}</span>
  <button
    class="brain-toggle"
    aria-label="Ouvrir le cerveau du clone"
    aria-pressed={$brainDrawer.open}
    onclick={handleBrainToggle}
  >
    🧠
  </button>
</header>
```

**2. Layout principal (flex/grid side-by-side) :**
```svelte
<main class="chat-shell" class:drawer-open={$brainDrawer.open}>
  <section class="chat-column">
    <!-- ... messages, composer, zone paste (inchangé) ... -->
  </section>

  <BrainDrawer
    {personaId}
    {hasActiveDraft}
    onRuleAddedWhileDrafting={celebrateRuleAdded}
  />
</main>

<style>
  .chat-shell {
    display: grid;
    grid-template-columns: 1fr 0;
    transition: grid-template-columns 180ms ease-out;
  }

  .chat-shell.drawer-open {
    grid-template-columns: 3fr 2fr; /* 60/40 */
  }

  @media (max-width: 899px) {
    .chat-shell.drawer-open {
      grid-template-columns: 1fr 0; /* drawer est position:fixed en mobile */
    }
  }
</style>
```

**3. Palette ⌘K (ligne 1397 actuelle) — source 2 : `cmd_k` :**
```diff
- { id: "open-brain", label: "Cerveau du clone", hint: "persona", action: () => goto(`/brain/${personaId}`) },
+ { id: "open-brain", label: "Cerveau du clone", hint: "persona", action: () => {
+     brainDrawer.openAt();  // openAt() sans arg → utilise lastTab ou DEFAULT
+     emitBrainEvent('brain_drawer_opened', { source: 'cmd_k', tab: $brainDrawer.tab });
+ } },
```

**Récapitulatif des 3 sources d'émission `brain_drawer_opened`** :
| Source | Call site | Condition d'émission |
|---|---|---|
| `top_button` | `handleBrainToggle()` dans `+page.svelte` (zone 1) | à l'ouverture uniquement (pas à la fermeture) |
| `cmd_k` | palette `open-brain` dans `+page.svelte` (zone 3) | toujours (la palette ne sert qu'à ouvrir) |
| `url_redirect` | `$effect` sync URL dans `+page.svelte` (zone 1) | à la première détection d'un `?brain=<tab>` dans l'URL (garde `lastEmittedTabForUrl` pour éviter les émissions répétées au même tab) |

### Redirect `/brain/[persona]` → `/chat/[persona]?brain=<tab>`

**Supprimer** `src/routes/brain/[persona]/+page.svelte` (163 lignes) et son contenu.

**Créer** `src/routes/brain/[persona]/+page.server.js` :

```js
import { redirect } from '@sveltejs/kit';

const VALID_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];

export function load({ params, url }) {
  // Préserve le hash legacy : /brain/X#protocole → /chat/X?brain=protocole
  const hashTab = url.hash.replace('#', '');
  const queryTab = url.searchParams.get('tab');
  const candidate = hashTab || queryTab || 'connaissance';
  const tab = VALID_TABS.includes(candidate) ? candidate : 'connaissance';

  throw redirect(307, `/chat/${params.persona}?brain=${tab}`);
}
```

Cascade : le layout parent `/chat/[persona]` se monte, lit `?brain=<tab>`, ouvre le drawer via `brainDrawer.syncFromUrl(tab)`, émet `brain_drawer_opened` avec `source: 'url_redirect'`.

### Migration 041 — nouveaux event_types

Fichier `supabase/041_feedback_brain_drawer.sql` — même pattern que 040 (dernier dans la séquence, n'a pas réutilisé 037/038/039 déjà pris) :

```sql
-- 041_feedback_brain_drawer.sql
--
-- Chantier #2 (drawer cerveau latéral) — ajoute deux event_types au pipeline
-- feedback :
--   • brain_drawer_opened       — user ouvre le drawer cerveau depuis le chat
--                                  (source: top_button | cmd_k | url_redirect)
--   • brain_edit_during_draft   — user ajoute/corrige une règle dans le drawer
--                                  pendant qu'un draft est actif dans le composer
--                                  (signal du moment data-move, cible prioritaire)
--
-- Attaché au dernier message narratif (`toi`/`prospect`/`clone_draft`/`draft_rejected`)
-- de la conv courante pour préserver l'invariant `message_id NOT NULL`. Si la conv
-- n'a aucun message narratif, le client skip l'émission silencieusement (cf.
-- §"Cas limites" du spec). Pas de relaxation DB.
--
-- Spec source : docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md.
-- Numéros 038/039 = protocole-v2 core/hooks (PR #79). 040 = training signal capture.
-- Additif uniquement — aucun DROP destructif.

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
    'paste_zone_dismissed',
    'copy_paste_out',
    'regen_rejection',
    'brain_drawer_opened',
    'brain_edit_during_draft'
  ));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. 11 event types: validated, validated_edited, corrected, saved_rule, excellent, client_validated, paste_zone_dismissed, copy_paste_out, regen_rejection, brain_drawer_opened, brain_edit_during_draft. See 041_feedback_brain_drawer.sql.';
```

**Invariants DB inchangés :** `conversation_id`, `message_id NOT NULL`, RLS par clone_id. Aucune relaxation DB.

**Policy `message_id` pour les deux nouveaux signaux (résolue côté client, pas DB) :**
Les deux events sont attachés au **dernier message narratif** (`turn_kind ∈ {'toi','prospect','clone_draft','draft_rejected'}`) de la conv courante, même logique que `paste_zone_dismissed` (chantier #1). Si aucun message narratif n'existe encore dans la conv (conv vierge) :
- `brain_drawer_opened` → **skip silencieux** (pas d'émission, pas d'erreur utilisateur). La télémétrie perd ces ouvertures-là ; c'est acceptable car le signal premier est `brain_edit_during_draft`, pas l'ouverture.
- `brain_edit_during_draft` → par définition exige `hasActiveDraft === true`, ce qui implique que le composer contient du texte. Mais un draft n'a pas encore de `turn_kind` tant qu'il n'est pas envoyé (pas de row `messages` pour le texte en cours). Donc : skip silencieux aussi si la conv n'a aucun message narratif déjà posé. Dans ce cas le pulse visuel + toast s'affichent quand même (UX intact) — seul le signal DB est skip.

Le skip est implémenté dans `src/lib/api/brainEvents.js` via une query `select("id").eq("conversation_id", convId).in("turn_kind", [...narrativeKinds]).order("created_at", { ascending: false }).limit(1)`. Pas de fetch si aucun retour → log `console.warn` + return.

### Cas limites

| Cas | Comportement |
|---|---|
| Drawer ouvert + persona switch | Drawer reste ouvert, Panels re-fetch sur nouveau `{personaId}`, URL passe à `/chat/<newPersonaId>?brain=<tab>`, `lastTab` localStorage inchangé (c'est une pref user, pas persona). |
| URL `?brain=invalid` | Fallback silencieux sur `'connaissance'`, drawer ouvert. Pas de log d'erreur. |
| User presse ESC en tapant dans le composer | Drawer ne se ferme pas (focus = textarea). ESC hors input → ferme. |
| User clique le bouton ↻ pendant le pulse celebration | Pulse s'interrompt naturellement (la regen déclenche son propre state). Pas de collision. |
| Aucun message narratif dans la conv + tentative d'émettre `brain_drawer_opened` ou `brain_edit_during_draft` | **Skip silencieux côté client** (cf. §"Policy message_id"). UX préservée (pulse/toast s'affichent quand même), signal DB non inséré. Pas de relaxation de l'invariant `message_id NOT NULL`. |
| Switch persona pendant que le drawer Settings est en cours d'édition | `SettingsPanel` perd son state éphémère (form en cours). Acceptable : les Settings sont sauvés au blur/submit, pas en auto-save. Documenté comme "known minor loss" — pas de garde pour ce cas edge. |
| Back browser après redirect `/brain/X` → `/chat/X?brain=<tab>` | Le redirect 307 côté serveur **ne crée pas** d'entrée historique pour `/brain/X` (le navigateur remplace par l'URL finale dans l'historique). Back retourne donc à la page précédant `/brain/X` (pas à `/chat/X` propre). Pour la navigation in-app (toggle drawer via `goto` avec `replaceState:false`), back ferme bien le drawer. Cas couvert par l'acceptance criterion #11 qui teste uniquement le toggle in-app. |
| Deep-link `/brain/X#intelligence` bookmarké | Redirect 307 → `/chat/X?brain=intelligence`, drawer ouvert directement sur onglet intelligence. 1 seul hop. |

## Out of scope

Ce qui **ne** fait **pas** partie de ce chantier :

- **Bande activité transverse dans le drawer** — pas de SSE feed au niveau drawer, pas de ticker bas. Le protocole-v2 Sprint 3 (vue Doctrine) ajoutera un feed SSE à l'intérieur de `ProtocolPanel` ; le chantier #4 ajoutera des pulses cross-UI. Ce drawer reste un container.
- **Édition cross-persona** — le drawer reste lié à 1 `personaId` à la fois. Pas de vue comparée clone A vs clone B.
- **Refonte des 4 Panels eux-mêmes** — le chantier monte les Panels actuels tels quels. Toute évolution interne (ex: protocole-v2 transformant ProtocolPanel en vue Doctrine) est un chantier séparé.
- **Notification "rule applied" du clone distant** — le pulse célèbre l'édition user-side. Confirmer que le backend a bien intégré la règle lors de la prochaine regen reste une concern du pipeline de génération, hors scope UI.
- **Gestion hors-ligne** — si `fetch` feedback_events échoue (offline ou 500), on log en console et on continue. Pas de queue locale, pas de retry.
- **A11y avancé au-delà du focus trap mobile** — le MVP fait ARIA basique (role=complementary, tablist, tabpanel, aria-selected). Pas de navigation clavier full entre tabs via flèches (nice-to-have v2).
- **Animations motion au-delà du slide drawer + pulse ↻** — pas de stagger des Panels qui arrivent, pas de parallaxe. Reste sobre.

## Acceptance criteria (tests manuels requis sur preview Vercel avant merge master)

1. **Bouton top-bar 🧠** visible dans le chat, toggle le drawer en side-by-side sur desktop ≥ 900px, full-screen sur mobile.
2. **Palette ⌘K → "Cerveau du clone"** ouvre le drawer (ne navigue plus vers `/brain/[persona]`).
3. **URL** `/chat/X?brain=protocole` ouvre directement le drawer sur l'onglet Protocole.
4. **Redirect** `/brain/X` → `/chat/X?brain=connaissance` en 1 hop (vérifier réseau : 307 puis 200).
5. **Redirect avec hash legacy** `/brain/X#intelligence` → `/chat/X?brain=intelligence` (tab préservé).
6. **Composer fonctionnel drawer ouvert** — tape un message, envoie, zone paste toujours visible/masquable, ↻ regen opère.
7. **Switch persona (⌘⇧C) drawer ouvert** — drawer reste ouvert, Panels re-fetch sur nouveau clone, URL met à jour `/chat/<newId>?brain=<tab>`.
8. **Célébration active** — tape un draft, ouvre drawer, ajoute une règle dans Protocole → bouton ↻ pulse 1.5s + toast "Règle apprise" → un row `feedback_events` avec `event_type='brain_edit_during_draft'` apparaît en DB.
9. **Pas de célébration sans draft** — drawer ouvert sans rien taper, ajoute règle → pas de pulse, pas de toast, pas d'event `brain_edit_during_draft` (mais `saved_rule` normal).
10. **ESC ferme le drawer sauf si focus composer** — ESC quand focus hors textarea ferme ; ESC pendant qu'on tape ne ferme pas.
11. **Back browser in-app** — depuis `/chat/X` (drawer fermé), ouvrir via bouton 🧠 → URL passe à `/chat/X?brain=<tab>`. Presser Back → retour à `/chat/X` drawer fermé (pas de re-redirect loop). N'inclut **pas** le back depuis une entrée initialement issue d'un redirect 307 `/brain/X` (cf. §"Cas limites") — ce cas est une limite connue du redirect serveur.
12. **Mobile < 900px** : drawer full-screen, body scroll locké, `✕` ferme, scroll dans Panel fonctionne.

## Non-régression (checklist dev, pas tests auto)

- Composer (chantier #1) intact : zone paste conditionnelle, primary CTA + menu, `paste_zone_dismissed`.
- `KnowledgePanel` upload docs fonctionnel drawer ouvert.
- `IntelligencePanel` liste extractions inchangée.
- `SettingsPanel` embedded prop déjà supporté (cf. `/brain/[persona]/+page.svelte` actuel), comportement identique.
- Onboarding first-run (persona fresh sans règle) : drawer ouvert sur `connaissance`, pas sur un onglet vide.
- Hooks `feedback_events → learning_events` bridge (#66) continuent de propager les events Panel existants.

## Ordre de déploiement

1. Créer branche `feat/brain-drawer` (already done during brainstorm).
2. Écrire migration 041 + `test/migrations/041-brain-events.test.js`.
3. Appliquer migration 041 sur DB Supabase dev (pas prod avant UI validée).
4. Ajouter `copy_paste_out` + `regen_rejection` + `brain_drawer_opened` + `brain_edit_during_draft` dans `VALID_TYPES` de `api/feedback-events.js` (ligne 3). Corrige le drift API↔DB hérité de 040.
5. Implémenter `src/lib/stores/brainDrawer.js` + tests store (TDD).
6. Implémenter `src/lib/api/brainEvents.js` + tests signals (TDD).
7. Implémenter `src/lib/components/BrainDrawer.svelte` + tests (TDD si tests rendering possibles, sinon tests manuels dans preview).
8. Modifier `ProtocolPanel.svelte` : ajout prop `onRuleAdded` + `test/protocol-panel-callback.test.js`.
9. Modifier `/chat/[persona]/+page.svelte` : top-bar button, mount drawer, wire ⌘K (avec `source: 'cmd_k'`), celebration handler.
10. Remplacer `/brain/[persona]/+page.svelte` + `+page.js` par `+page.server.js` redirect + `test/brain-redirect.test.js`.
11. Tous tests unit verts (`npm test`).
12. Push Preview Vercel → smoke manuel des 12 acceptance criteria.
13. Apply migration 041 sur prod Supabase via SQL editor (pattern chantier #1).
14. Merge master **seulement si** preview smoke validé (convention `feedback_prod_without_ui_test.md`).
