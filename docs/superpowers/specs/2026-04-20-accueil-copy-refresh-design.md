# Accueil — Copy refresh + démo killée — Design Spec

**Date:** 2026-04-20
**Status:** Draft v1
**Scope:** refonte ciblée de `src/routes/+page.svelte` — copy + structure visible aux logged-out. Le chemin auth (auto-redirect vers `/chat/<lastPersona>` ou `/create`) reste intact.

**Files:**
- modified `src/routes/+page.svelte` — suppression démo scriptée, nouveau hero, formulaire d'accès promu, footer slim
- modified `src/lib/landing-demo.js` — **deleted** (plus utilisé après cette spec)
- new `src/lib/build-info.js` (ou équivalent) — exporte le vrai hash commit court, remplace `BUILD_HASH` hardcodé

## Problème

La page `/` actuelle fait deux jobs incohérents avec ce qu'est devenue l'app :

1. **Le pitch raconte un produit qui n'existe plus.** Le hero parle de *"pipeline 4 étapes : Generate → check → rewrite → fidelity"* avec une démo scriptée centrale (panels 01–05 : prompt, sortie, moteur de règles, métriques live, score de fidélité). Mais le chat shippé (commits `16a5a54`, `fb4d7a6`, `2d07f9d`) c'est : 2-zones avec dossier prospect + rail feedback, validation explicite `✓ c'est ça` / `★ même mieux`. Aucun rapport.

2. **Le hash de version est menteur.** `BUILD_HASH = "25e585b"` est codé en dur dans le `<script>` (`+page.svelte:10`). Les derniers commits sont sur `f35262a`. La page se présente comme un labo "en direct" mais affiche une version figée.

Le visiteur cible n'est pas un prospect froid (pas de canal d'acquisition actif) — c'est un setter ou un client qui revient logged-out. Il doit reconnaître l'app qu'il utilise, pas découvrir une démo abstraite. La page n'a pas besoin de vendre, juste d'être **cohérente**.

## Solution

Page courte, sobre, honnête. Trois zones : header allégé, hero recentré, formulaire d'accès promu. Le footer garde juste un lien `/guide`.

```
┌──────────────────────────────────────────────────────┐
│ ◎ VoiceClone           heure · version              │ ← header (allégé)
├──────────────────────────────────────────────────────┤
│                                                      │
│              ◎ VoiceClone                            │ ← hero (centré)
│   Un clone d'écriture qui apprend de tes corrections.│
│                                                      │
│   Tu lui parles d'un prospect, il propose un message.│
│   Tu valides, ou tu le reprends en deux mots.        │
│   La fois d'après, il a retenu. Au bout de cent      │
│   corrections, il écrit comme toi.                   │
│                                                      │
│        ┌──────────────────────────────┐              │
│        │ ◇ accès   [code...]    →    │              │ ← formulaire promu
│        └──────────────────────────────┘              │
│                                                      │
├──────────────────────────────────────────────────────┤
│ guide                                                │ ← footer slim
└──────────────────────────────────────────────────────┘
```

### Hero — copy retenu

```
◎ VoiceClone
Un clone d'écriture qui apprend de tes corrections.

Tu lui parles d'un prospect, il propose un message. Tu valides, ou tu le
reprends en deux mots. La fois d'après, il a retenu. Au bout de cent
corrections, il écrit comme toi.
```

Validé en brainstorming après passage par le skill `humanizer`. Critères : pas d'em dash, pas de copula avoidance ("serves as"), pas de superficial -ing, ancrage concret (`prospect`, `deux mots`, `cent corrections`), une phrase finale qui prend position plutôt qu'un fade-out marketing.

### Header — indicators

| Conserver | Supprimer |
|-----------|-----------|
| `◎ VoiceClone` (sans sous-titre `/ laboratoire`) | `pipeline 4 étapes` (faux) |
| `heure` + clock UTC | `en direct` + dot pulse (plus de live) |
| `version` + **vrai** hash commit | `BUILD_HASH` hardcodé `"25e585b"` |

Le sous-titre `/ laboratoire` part avec le reste : la démo est ce qui justifiait le mot, sans elle ça devient prétentieux.

### Formulaire d'accès — promotion

Aujourd'hui dans le footer, écrit petit, `<input width: 90px>`. Devient un bloc centré sous le hero, lisible, c'est l'action visible #1.

Pas de changement de comportement : POST `/api/personas` avec `x-access-code`, redirect vers `/chat/<lastPersona>` ou `/create` selon résultat. La logique `submitCode()` reste identique, seul le styling change.

## Pourquoi ce design

| Décision | Raison |
|----------|--------|
| Kill total de la démo scriptée plutôt que la refaire pour matcher le vrai produit | Le visiteur cible (setter/client revenant) n'a pas besoin de démo — il connaît. Refaire une démo "honnête" coûterait des heures pour quelque chose que personne ne regarde. |
| Hero court (4 phrases) plutôt que long pitch | Cohérent avec un visiteur qui sait déjà ; un long pitch supposerait qu'on convainc, pas qu'on accueille. |
| Promotion du formulaire d'accès en bloc central | Aujourd'hui caché en footer typographie petite — friction inutile pour l'action principale de la page. |
| Garder header (heure + version) plutôt que sabrer aussi | Garde l'identité visuelle "lab/observable" sans la trahir. La pulse "en direct" était la seule chose qui mentait — le reste est factuel. |
| Vrai hash commit injecté au build, plutôt que constant manuelle | Une constante manuelle se désynchronise (déjà arrivé). Build-time = jamais menteur. |

## Ce qui dégage du code

Imports à supprimer dans `+page.svelte` :
- `SCENARIOS, TYPE_SPEED_OUTPUT, PHASE_DELAYS` depuis `$lib/landing-demo.js`

État à supprimer :
- `scenarioIdx, current, phase, promptTyped, outputTyped, firesAt, showDiff, metricsProgress, fidelityProgress, counter`
- `timers, running, clearTimers, t, typewriter, runScenario, scheduleNext`
- `liveMetrics, liveFidelity, lerp, fmtNum`

DOM à supprimer :
- `<section class="manifest">` complet
- `<section class="grid">` complet (5 panels)
- `<div class="case-strip">` complet

CSS à supprimer (sections de styles correspondantes) :
- `.manifest`, `.headline`, `.h-lead`, `.h-accent`, `.h-tail`, `.sub`, `.arrow`
- `.grid`, `.col`, `.col-main`, `.col-side`, `.panel`, `.p-head`, `.p-idx`, `.p-name`, `.p-meta`, `.p-body`
- `.prompt-body`, `.caret`, `.output-body`, `.output-text`, `.thinking`, `.dot-seq`, `.diff-wrap`, `.diff-badge`, `.diff-old`
- `.rules`, `.rule`, `.rule-tick`, `.rule-name`, `.rule-sev`, `.rule-detail`, `.rule.fired` (et variantes severity)
- `.metrics`, `.metric`, `.m-head`, `.m-name`, `.m-val`, `.m-bar`, `.m-bar-fill`
- `.panel-fidelity`, `.fidelity`, `.fid-legend`, `.fid-big`, `.fid-delta`, `.fid-threshold`, `.fid-bar`, `.fid-bar-fill`, `.fid-bar-threshold`
- `.case-strip`, `.case-label`, `.case-dots`, `.case-dot`

Fichier à supprimer :
- `src/lib/landing-demo.js` (plus de consommateur après cette spec)

## Ce qui reste

- Header (`.lab-head`, `.brand`, `.brand-mark`, `.brand-name`, `.head-meta`, `.kv`, `.k`, `.v`) — supprimer juste `.brand-sub` et `.status-on` + `.dot` + `@keyframes pulse`
- Auth path complet : `pickPersona`, `resolveHome`, `submitCode`, le `onMount` qui redirect si déjà authed
- Footer access form (logique inchangée, styles à refondre pour la promotion centrale)
- Skip-link, `<svelte:head>` (titre `<title>` à raccourcir : `VoiceClone — accès` au lieu de `VoiceClone — laboratoire`)

## Vrai hash de version — option d'implémentation

À choisir au moment de l'implémentation, décision pas critique :

**Option 1** — `vite.config.js` injecte `__BUILD_HASH__` via `define`, lu depuis `git rev-parse --short HEAD` à build time.
**Option 2** — script `npm run build` génère `src/lib/build-info.js` exportant `{ hash, builtAt }`.
**Option 3** — variable d'env `VITE_BUILD_HASH` injectée par CI (Vercel expose `VERCEL_GIT_COMMIT_SHA`).

Recommandation : **Option 3** sur prod (Vercel le fournit gratos), fallback `'dev'` en local. Pas de complexité de build pour une chaîne de 7 caractères.

## Hors scope

- Refonte des routes `/guide`, `/create` — pas touché.
- Nouvelle page marketing pour prospects froids — décidé : on ne le fait pas tant que la douleur d'acquisition n'est pas validée (cf. mémoire `feedback_critic_verify_prod_usage`).
- Mockups visuels via brainstorming visual companion — abandonné car instable sur Windows ; refonte text-driven suffit ici.

## Questions ouvertes

- Le `/guide` survit-il vraiment, ou il faut aussi le retoucher ? **À vérifier** avant l'implémentation que la route existe et raconte une histoire à jour. Si pas, on l'enlève du footer ou on l'ajoute à la backlog.
- L'animation `@keyframes pulse` est-elle réutilisée ailleurs ? **À grep** avant suppression.

## Critères de succès

1. Aucune mention dans le DOM final de `pipeline`, `Generate → check → rewrite → fidelity`, `BUILD_HASH`, `laboratoire`, `pas un chatbot de plus`.
2. Le hash de version affiché correspond à `git rev-parse --short HEAD` du déploiement courant.
3. Le formulaire d'accès est visuellement le bloc principal sous le hero (taille input ≥ celle du hero, pas <100px de large).
4. La page rendue à froid (sans JS) reste lisible et présente le formulaire (pas de dépendance au scenario runner).
5. Le bundle JS de la route `/` perd au moins le poids de `landing-demo.js` + le runner scripté.
