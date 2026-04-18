# Sprint 0 Split B — Ménage UI + Tracking produit

**Date** : 2026-04-18
**Scope** : Sprint 0.a (ménage 9 items) + 0.d (tracking Plausible)
**Durée cible** : ~16h (12h ménage + 4h tracking)
**Dépendance** : Split A livré (migrations foundation + scenario switcher)

---

## Objectif

Clore Sprint 0 en éliminant la friction UI facile identifiée dans les audits Phase 3 (9 quick wins répartis sur 5 écrans), puis brancher le tracking produit minimal (6 events) qui servira de baseline à tous les sprints suivants.

**Vendor tracking** : Plausible Cloud (validé). Rationale : setup 15 min, coût $9/mo, suffit aux 6 events visés. PostHog reporté à un sprint ultérieur si besoin de funnels/session replay.

**Ordre d'exécution** : ménage d'abord (6 commits), tracking en dernier (commit 7). Évite le bruit d'events déclenchés pendant les déplacements DOM.

---

## Découpe en 7 commits

| # | Commit | Effort |
|---|---|---|
| 1 | `chore(cleanup): remove dead PersonaCard, ScenarioPill` | 30min |
| 2 | `feat(create): kill calibration step, swap type to step 1, dedupe scrape input` | 2h |
| 3 | `feat(calibrate): 3-option rating + contextual header` | 2h |
| 4 | `feat(share): sharer identity + claimed → "Ouvrir chat direct"` | 2h |
| 5 | `feat(hub): promote "+ Créer" to header` | 1h |
| 6 | `feat(admin): personas sorted fidelity ASC + color badge` | 2h |
| 7 | `feat(tracking): Plausible + 6 custom events` | 4h |

---

## Commit 1 — Dead code cleanup

**Vérifié** : 0 imports de `PersonaCard` et `ScenarioPill` dans `src/` (confirmed via grep).

**Action** : suppression pure de :
- `src/lib/components/PersonaCard.svelte`
- `src/lib/components/ScenarioPill.svelte`

Aucune autre modification.

---

## Commit 2 — `/create` : swap type + dédup scrape

### État actuel (`src/routes/create/+page.svelte`)

Steps : `['calibration', 'type', 'info', ...posts, ...dm, 'docs']`

Le step `calibration` (pré-step) contient :
- Rubrique `01/02/03/04` (profil · posts · DMs · documents)
- Input scrape LinkedIn
- Bouton "Continuer sans scrape"

Le step `info` (lignes 365-370) contient **déjà** un input scrape LinkedIn (ligne "Auto-remplir"). Donc le scrape est dupliqué.

### Changement

1. **Supprimer** entièrement le step `'calibration'` (lignes 225-311) — y compris la rubrique 01/02/03/04.
2. **Nouveau ordre** : `steps = ['type', 'info', ...posts, ...dm, 'docs']`.
3. **`step` initial** : `$state('type')` au lieu de `'calibration'`.
4. **Supprimer** `BARRED_STEPS` — tous les steps sont désormais dans la barre de progression.
5. **Numérotation** : `Étape {steps.indexOf(step) + 1}/{steps.length}`.
6. **Input scrape** : reste dans `info` uniquement (source unique). Pas de déplacement.

### Rationale pour virer la rubrique

Elle expliquait "ce que le clone apprend et d'où" avant le choix de type. En tuant ce pré-step, la logique type → info porte déjà la progression conceptuelle ; les labels `Prénom / Titre & entreprise / Bio` sont auto-explicites. Une rubrique réinjectée plus loin serait redondante.

### CSS orphelin à supprimer

Classes `.rubric*`, `.calib-divider`, `.calib-primary`, `.calib-label`, `.calib-recap`, `.calib-secondary`, `.link-btn`, `.btn-primary` si non utilisée ailleurs, `.recap-line`, `.state-dot` (si défini pour ce step seulement).

### Vérification

- `npm run dev` : `/create` charge directement sur step type.
- Cliquer `posts` → step info → scrape → fonctionne.
- Cliquer `dm` → skip posts step → dm step.
- Retour arrière fonctionne sur toutes les transitions.

---

## Commit 3 — `/calibrate` : 3 options + header

### État actuel (`src/routes/calibrate/[persona]/+page.svelte`)

- Rating : 5 boutons `1 2 3 4 5` (ligne 140-149)
- Header : `VoiceClone / calibration` avec compteurs génériques (ligne 84-94)
- Pas de contexte persona/type

### Changement rating

Remplacer les 5 boutons numériques par 3 boutons emoji :

```svelte
{#each [['👎', 1], ['🤔', 3], ['👍', 5]] as [emoji, scoreValue]}
  <button
    class="rate-btn"
    class:selected={score === scoreValue}
    onclick={() => setRating(i, scoreValue)}
    aria-label={`Note ${emoji}`}
  >{emoji}</button>
{/each}
```

**Mapping storage** : 👎=1, 🤔=3, 👍=5. Zero migration backend (la colonne accepte toujours 1-5). Les scores existants restent lisibles.

**Affichage trial-score** : `{score === 5 ? '👍' : score === 3 ? '🤔' : '👎'}` au lieu de `{score}/5`. Classes `.high`/`.low` restent : `high` si `score === 5`, `low` si `score === 1`.

### Changement header

Charger le persona dans `loadCalibration` :

```js
const [calibData, personaData] = await Promise.all([
  api("/api/calibrate", { method: "POST", body: JSON.stringify({ persona: pid }) }),
  api(`/api/config?persona=${pid}`),
]);
persona = personaData.persona || {};
```

Rendre le header :

```
◎ VoiceClone / calibration
   {persona.name} · {persona.type}
```

`persona.type` est déjà 'post' | 'dm' | 'both' (cf. migration 008).

### Vérification

- Charger `/calibrate/[persona]` → header affiche nom + type.
- Cliquer 👍/🤔/👎 → sélection visuelle correcte, trial-score affiche l'emoji.
- Submit → backend reçoit les scores 1/3/5 comme avant.

---

## Commit 4 — `/share` : sharer identity + chat direct

### Backend (`api/share.js` GET)

**État actuel** : renvoie `{ persona, persona_id, already_shared }`. Pas d'info sharer.

**Changement** : étendre le SELECT et la réponse.

```js
// Avant
.select("persona_id, expires_at, personas(name, title, avatar)")

// Après
.select("persona_id, expires_at, personas(name, title, avatar), creator:clients!share_tokens_created_by_fkey(name)")
```

Réponse enrichie :

```js
res.json({
  persona: st.personas,
  persona_id: st.persona_id,
  shared_by_name: st.creator?.name || null,
  already_shared: alreadyShared,
});
```

**Note** : la FK `share_tokens.created_by → clients.id` est déjà dans `010_persona_shares.sql`. Vérifier le nom exact de la contrainte au moment de l'implémentation (peut nécessiter `clients!created_by` simple selon la convention Supabase du projet).

### Frontend (`src/routes/share/[token]/+page.svelte`)

**State `preview`** : ajouter sous le persona :

```svelte
{#if sharedByName}
  <p class="shared-by">Partagé par <strong>{sharedByName}</strong></p>
{/if}
```

Avec variable state `let sharedByName = $state(null);` remplie dans `loadPreview`.

**State `claimed`** :
- Remplacer texte "Clone ajoute !" et bouton `Aller au hub` par :

```svelte
{:else if state === "claimed"}
  <h2>Clone ajouté !</h2>
  <p class="muted">Tu peux commencer à l'utiliser directement.</p>
  <button class="btn-primary" onclick={() => goto(`/chat/${personaId}`)}>
    Ouvrir chat direct
  </button>
{/if}
```

Le bouton Hub est **supprimé** du state claimed (décision user). L'utilisateur peut toujours rejoindre le hub via nav normale.

### Vérification

- Generate share token comme user A.
- Ouvrir le lien comme user B → preview montre `Partagé par {name A}`.
- Claim → state claimed → bouton ouvre `/chat/[persona_id]`.

---

## Commit 5 — `/hub` : "+ Créer" en header

### État actuel (`src/routes/hub/+page.svelte`)

- Header `.hub-head` : brand + counters
- Section `Nouveau clone` en bas (lignes 252-263) avec action-card `+ Créer un clone`

### Changement

1. **Ajouter** bouton header à droite du `.head-meta`, visible si `$canCreateClone || $isAdmin` :

```svelte
{#if $canCreateClone || $isAdmin}
  <button class="head-action" onclick={() => goto("/create")}>
    + Créer
  </button>
{/if}
```

Style : mono, même taille que `.kv`, border minimal, hover vermillon (aligné avec le langage visuel existant).

2. **Supprimer** la section `Nouveau clone` en bas (lignes 252-263).

### Vérification

- Bouton visible en header si user a le droit.
- Click → redirige `/create`.
- Plus de doublon bas de page.

---

## Commit 6 — `/admin` : tri fidélité + badge couleur

### État actuel (`src/routes/admin/+page.svelte`)

- `personasList` affiché dans l'ordre reçu de l'API (lignes 167-195).
- Fidélité affichée en texte simple : `<div class="admin-fidelity">Fidelite: {p.fidelity.score_global}</div>`.

### Changement tri

Dans le rendu (dérivé), pas dans le fetch :

```js
let sortedPersonas = $derived(
  [...personasList].sort((a, b) => {
    const sa = a.fidelity?.score_global ?? 999;
    const sb = b.fidelity?.score_global ?? 999;
    return sa - sb;
  })
);
```

`{#each sortedPersonas as p}` au lieu de `personasList`. Les personas sans fidelity tombent en fin.

### Changement badge

Remplacer `admin-fidelity` par un chip positionné dans `.persona-header` (à côté du nom, pas en bas). Réutilise la palette du hub :

```svelte
{#if p.fidelity}
  <span class="fid-badge" class:fid-ok={p.fidelity.score_global >= 75}
                          class:fid-warn={p.fidelity.score_global >= 50 && p.fidelity.score_global < 75}
                          class:fid-bad={p.fidelity.score_global < 50}>
    {p.fidelity.score_global}
  </span>
{/if}
```

CSS :
```css
.fid-badge { padding: 1px 6px; border: 1px solid; font-size: 0.625rem; font-variant-numeric: tabular-nums; }
.fid-ok { border-color: var(--ink-40); color: var(--ink); }
.fid-warn { border-color: #b87300; color: #b87300; }
.fid-bad { border-color: var(--vermillon); color: var(--vermillon); }
```

Supprime le `.admin-fidelity` div existant.

### Vérification

- Personas triés du moins fidèle (top) au plus fidèle (bas).
- Badge rouge visible pour scores < 50.
- Badge ambre pour 50-74.
- Badge neutre pour ≥ 75.

---

## Commit 7 — Plausible + 6 events

### Setup script

**`src/app.html`** : ajout avant `</head>` :

```html
<script defer data-domain="%VITE_PLAUSIBLE_DOMAIN%" src="https://plausible.io/js/script.tagged-events.js"></script>
<script>window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }</script>
```

**`.env.example`** : ajouter `VITE_PLAUSIBLE_DOMAIN=app.voiceclone.xyz` (domaine exact à confirmer avant le commit).

### Helper `src/lib/tracking.js`

```js
export function track(event, props = {}) {
  if (typeof window === 'undefined' || !window.plausible) return;
  window.plausible(event, { props });
}
```

Noop en SSR et si script pas chargé (adblock, offline, etc.) — zero crash.

### 6 events · call sites

| # | Event | Fichier | Ligne d'insertion | Props |
|---|---|---|---|---|
| 1 | `clone_created` | `src/routes/create/+page.svelte` | Après `persona = data.persona;` ligne ~137 | `{ type: cloneType, has_docs: toUpload.length > 0 }` |
| 2 | `message_sent` | `src/routes/chat/[persona]/+page.svelte` | Dans le handler d'envoi user | `{ scenario_type, persona_id }` |
| 3 | `correction_submitted` | inline chat + `submitCalibration` | Après succès API | `{ source: 'chat' \| 'calibrate' }` |
| 4 | `share_created` | `src/routes/hub/+page.svelte` → `shareClone` | Après `const { token } = await resp.json();` | `{ persona_id }` |
| 5 | `share_claimed` | `src/routes/share/[token]/+page.svelte` → `claimShare` | Après `state = "claimed";` | `{}` |
| 6 | `scenario_switched` | `src/lib/components/ScenarioSwitcher.svelte` | Au onchange du dropdown | `{ from, to }` |

### Privacy

Plausible ne stocke pas de PII par défaut (pas de cookie, pas d'IP persistée). Les props listées ci-dessus ne contiennent **aucun contenu** (pas de texte message, pas d'email, pas de nom). `persona_id` est un UUID opaque acceptable.

### Vérification

- Déployer avec `VITE_PLAUSIBLE_DOMAIN` défini.
- Ouvrir `/create` + générer clone → event `clone_created` visible dans dashboard Plausible sous 30s.
- Répéter pour les 5 autres events sur leurs flows respectifs.
- Dashboard Plausible → onglet "Goals/Events" → 6 events listés.

---

## Non-objectifs

- Pas de refonte visuelle majeure des 5 écrans. Ménage surgical only.
- Pas de nouvelle feature produit. Tout est soit suppression, soit swap de composant.
- Pas de migration DB. Tout est UI + une petite extension SELECT sur `/api/share`.
- Pas de setup PostHog/funnels complexes. Plausible + 6 events plats.

---

## Risques & mitigations

| Risque | Mitigation |
|---|---|
| Suppression rubrique `/create` = perte d'info pédagogique | Les labels de champs sont auto-explicites. Guide `/guide` reste la source d'onboarding complète. |
| Script Plausible bloqué par adblock | Helper `track()` noop silencieusement. Zero dégradation UX. |
| Mapping 3 emoji → 1/3/5 illisible pour users existants | Les données existantes (scores 2, 4) restent stockées telles quelles. Affichage reste lisible via les seuils `low`/`high`. |
| `share_tokens.created_by` pointe vers un client supprimé | `shared_by_name` tombe à `null` → UI cache simplement la ligne `Partagé par`. |
| Tri admin place personas sans fidelity en fin, potentiellement gros volume | OK : l'agence-manager voit en priorité ceux à fidelity faible (action requise). Les sans-score sont neufs/vides. |

---

## Métriques de succès Split B

- **Ménage** : 9 items livrés, 0 régression fonctionnelle (smoke test manuel des 5 écrans).
- **Tracking** : les 6 events remontent dans Plausible sous 24h d'usage réel.
- **Baseline** : le dashboard Plausible montre des compteurs > 0 pour chaque event avant démarrage Sprint 1.

---

## Next step

Après validation user + commit de ce spec → invoquer `writing-plans` pour produire le plan d'exécution détaillé (ordre des TodoWrite, subagents de validation par commit).
