# /create — refonte "laboratoire persistant" (design)

**Date** : 2026-04-19
**Auteur** : Abraham + Claude
**Statut** : spec validée, en attente de plan d'implémentation
**Scope** : refonte visuelle et structurelle de la route `/create` (SvelteKit, `src/routes/create/+page.svelte`)

---

## 1 — Problème

La landing (`/`) présente un "laboratoire éditorial" (panneaux numérotés `01…05`, grille, mono/vermillon, pipeline live). L'app derrière le login ne tient pas cette promesse :

- **/hub** — liste plate en colonne 620px, `action-card` pour admin/ressources, écart structurel.
- **/create** — **pire écart** : wizard SaaS classique (`step-bar` linéaire, `type-card` avec emojis ✍️💬⚡, transitions `fly`, `btn-secondary`). Un user qui vient de la landing se croit sur un autre produit.
- **/chat** — déjà proche de la landing (Cockpit, RulesPanel, AuditStrip, HeatThermometer). Pas prioritaire.

Priorité choisie : **/create d'abord**. C'est la deuxième impression après le hub, et c'est là qu'on perd la cohérence "laboratoire".

## 2 — Ambition retenue

**Option B** parmi trois niveaux envisagés :
- A. Reskin mono (cosmétique, rejeté : écart structurel non résolu).
- **B. Refonte structurelle** : passage d'un wizard linéaire à un **formulaire-laboratoire persistant** sur une seule page.
- C. B + pré-pipeline de signaux live sur le corpus (rejeté pour l'instant : risque "métriques génériques" tant que le vrai pipeline d'ingestion n'est pas branché — feedback mémoire user).

## 3 — Arbitrages verrouillés

| # | arbitrage | choix |
|---|---|---|
| 3.1 | layout | **2 colonnes** (main 1.45fr / side 1fr), pas de retractable |
| 3.2 | gating | **hybride** : `01 type` = gate strict, `02/03a/03b/04` = libres une fois 01 choisi |
| 3.3 | contenu side | **B** : checklist structurelle + comptes bruts + warnings non-bloquants (*pas de métriques calculées, pas de prédiction*) |
| 3.4 | panneau 04 | **C** : `04 génération` est un panneau-action en bas de la col main (recap + docs + CTA phase-driven). Pas de CTA-miroir dans la side. |
| 3.5 | headline | **fil d'ariane mono sobre** `PROTOCOLE · CRÉATION CLONE`, pas de titre éditorial (le manifest émotionnel reste propre à la landing) |
| 3.6 | numérotation | `01 type` · `02 info` · `03a posts` · `03b dm` · `04 génération` (posts + dm = même phase "corpus") |
| 3.7 | label segment type "both" | `posts + dm` (lowercase technique, aligné landing) |
| 3.8 | glyphes d'état | `◯ ◐ ● ✗` + légende one-shot en pied de side |
| 3.9 | nav side | clic sur ligne checklist = scroll vers panneau correspondant |
| 3.10 | docs (panneau 04) | exposés par défaut (toggle `+ Ajouter des documents` viré) |
| 3.11 | label CTA | `générer le clone →` (lowercase, verbiage complet) |
| 3.12 | post-succès | label `✓ clone prêt — ouvrir →` pendant 1.5s avant redirection auto + lien mono `+ nouveau clone` pour le batch agence |

## 4 — Squelette de page

```
┌────────────────────────────────────────────────────────────┐
│ HEADER (réutilise lab-head de la landing)                  │
│ ◎ VoiceClone / création   heure · clones=N · [admin]       │
├────────────────────────────────────────────────────────────┤
│ PROTOCOLE · CRÉATION CLONE            (bande mono pleine)   │
├──────────────────────────────────┬─────────────────────────┤
│ COL MAIN (1.45fr)                │ COL SIDE (1fr, sticky)  │
│                                  │                         │
│ 01 TYPE  [posts][dm][posts+dm]   │ 06 CHECKLIST            │
│                                  │ ● 01 type               │
│ 02 INFORMATIONS                  │ ● 02 info               │
│ ─── inputs ───                   │ ◐ 03a posts · 4 collés  │
│                                  │ ◯ 03b dm                │
│ 03a POSTS                        │ ◯ 04 docs               │
│ ─── textarea ───                 │                         │
│                                  │ 07 AVERTISSEMENTS       │
│ 03b DMs (si type ≠ posts)        │ ⚠ 03b conv #2 monologue │
│ ─── textarea + exemple ───       │                         │
│                                  │ ── légende glyphes ──   │
│ 04 GÉNÉRATION                    │                         │
│ recap + docs + [CTA phase-driven]│                         │
├──────────────────────────────────┴─────────────────────────┤
│ FOOTER (kv mono, lien /guide, retour /hub)                 │
└────────────────────────────────────────────────────────────┘
```

## 5 — Composants

### 5.1 — Header (`.lab-head`)

Réutilise exactement le header de `src/routes/+page.svelte` (landing) :
- brand `◎ VoiceClone / création`
- kv mono : `heure`, `clones={count}`, `admin` (si applicable)
- border-bottom `1px solid var(--rule-strong)`

### 5.2 — Bande protocole

```html
<div class="protocol-strip">
  <span class="strip-label">PROTOCOLE · CRÉATION CLONE</span>
  <span class="strip-meta">étape libre · {n_ready}/{n_required} panneaux prêts</span>
</div>
```
- Font mono 11px uppercase, letter-spacing 0.12em
- Pleine largeur, border-top + border-bottom `1px solid var(--rule-strong)`
- Remplace le `<h2>Créer un clone</h2>` + `<p class="create-subtitle">Étape 1/5</p>` actuels

### 5.3 — Sélecteur `01 type` (bande segmented)

- Trois segments : `posts` · `dm` · `posts + dm`
- Style : `border 1px solid var(--rule-strong)`, `padding 6px 14px`, `font-mono 12px`, label lowercase
- Sélectionné → `background var(--vermillon)`, `color var(--paper)`
- Pas d'emoji, pas d'icône, pas de sous-titre
- Tant que rien choisi : panneaux en dessous `opacity 0.35`, inputs `disabled`
- Changement de type ne vide pas les champs remplis ailleurs
- Pas dans l'état "panneau" — c'est une bande compacte

### 5.4 — Panneau générique (`02`, `03a`, `03b`, `04`)

Anatomie :
```
┌──────────────────────────────────────────────────────────────┐
│ {glyphe} {index} {NOM}               {p-meta live}           │
│ ························ (dashed rule) ······················
│                                                              │
│ {body: inputs ou contenu spécifique}                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```
- `p-head` : `glyphe` (12px mono) · `index` (vermillon 600) · `NOM` (uppercase, ink 600, letter-spacing 0.08em) · `p-meta` (right-aligned, ink-40, tabular-nums, change live)
- `border-bottom 1px dashed var(--rule)` sous le header
- `border-left 2px transparent` — devient `vermillon` quand n'importe quel input/textarea du panneau a le focus
- Pas de `step-header strong + span` (viré, redondant avec `p-head`)

### 5.5 — Side column (sticky top 20px)

**Panneau `06 CHECKLIST`**
```
06  CHECKLIST        protocole / {n_ready}/{n_required}
● 01 type           posts + dm
● 02 info           Thomas · CEO @Offbound
◐ 03a posts         4 collés · 1.2k moy
◯ 03b dm            non renseigné
◯ 04 docs           optionnel
```
- Lignes cliquables : scroll (behavior: smooth) vers panneau correspondant via `id="panel-{index}"` sur le panneau main
- Ligne d'un panneau non-applicable (ex: `03b` si type=posts) : texte barré + grisé, non-cliquable, meta = `— non applicable`
- Flash vermillon 200ms sur glyphe qui passe `●`

**Panneau `07 AVERTISSEMENTS`** (collapse complet si `warnings.length === 0`)
```
07  AVERTISSEMENTS   {n} actifs
⚠ 03b conv #2 monologue
⚠ 02  bio vide — résultat dégradé
```
- Même comportement clic → scroll vers panneau fautif
- Sources : `dmIssues` (existant), `posts ∈ {1,2}`, `info sans bio`
- Jamais bloquants — uniquement informatifs

**Footer side** (mono 10px, color ink-40)
```
── ◯ vide · ◐ en cours · ● prêt · ✗ invalide
```
Pas de CTA-miroir.

### 5.6 — Panneau `04 génération`

Trois zones empilées dans le body :

**Zone recap** (fiche mono tabulée)
```
01 type    posts + dm
02 info    Thomas · CEO @Offbound
03a posts  4 collés · 1.2k chars moy
03b dm     2 conversations · 1 monologue
04 docs    2 fichiers en file
```
Pas de glyphe d'état ici (redondant avec la side).

**Zone documents** (exposée par défaut, plus de toggle)
- Bouton `+ ajouter fichiers (.txt .md .pdf .docx)` visible même quand la liste est vide
- Liste `pendingFiles` (logique existante gardée)
- `upload-hint` gardé : "Chaque fichier sera absorbé individuellement après création du clone."

**Zone CTA phase-driven** — un seul bouton, label et état dépendent de `phase` :

| phase | label | état visuel |
|---|---|---|
| `idle` + gates OK | `générer le clone →` | bordure ink, cliquable |
| `idle` + gates KO | `générer le clone →` | opacity 0.4, cursor not-allowed |
| `creating` | `création persona…` | bordure pulse vermillon |
| `ingesting {i}/{total}` | `absorption {i}/{total} · {filename}` | bordure pulse vermillon |
| `computing` | `calcul fidélité…` | bordure pulse vermillon |
| `done` | `✓ clone prêt — ouvrir →` | bordure vermillon pleine, cliquable 1.5s |
| `error` | `✗ erreur — réessayer` | bordure vermillon, fond `color-mix(vermillon 4%)` |

Sous le CTA, en état `done` uniquement : lien mono `+ nouveau clone` (reset du state local sans navigation).

La `p-meta` du panneau `04` miroir la phase : `repos / en attente` → `absorption 2/5` → `calcul fidélité` → `✓ prêt`.

## 6 — Règles de validation (source de vérité pour les glyphes et les gates)

| panneau | `◯` vide | `◐` en cours | `●` prêt | `✗` invalide | requis si |
|---|---|---|---|---|---|
| `01 type` | pas de choix | — | un segment choisi | — | toujours |
| `02 info` | tout vide | name OU title OU bio non vide, mais name vide | `personaName.trim()` non vide | — | toujours |
| `03a posts` | 0 bloc `>30 chars` | 1-2 blocs | ≥3 blocs | — | `type ∈ {posts, both}` |
| `03b dm` | vide | non vide + `dmIssues.length > 0` | non vide + `dmIssues.length === 0` | — | `type ∈ {dm, both}` |
| `04 docs` | 0 fichier | — | ≥1 fichier | au moins un file en status `error` | jamais |

**CTA `générer` actif** ⇔ tous les panneaux requis (selon `type`) sont à l'état `●`.

**Warnings** (remontent dans `07 AVERTISSEMENTS`) :
- `dmIssues` pour chaque conv monologue (existe déjà dans le code)
- `02` : `personaName.trim()` OK mais `profileText.trim()` vide → "bio vide — résultat dégradé"
- `03a` : `posts.length ∈ {1,2}` → "posts < 3 — corpus trop court"

## 7 — Responsive

**≤ 900px** :
- Grid passe en 1 colonne
- La col side disparaît de sa position normale et devient une **bande sticky bottom** :
  ```
  [ protocole 3/4 ▾ ]   ← collapsé par défaut
  ```
  Déplie checklist + warnings + légende en bottom-sheet au clic. Max-height 60vh, scroll interne si dépassement.
- Le sticky top de la side normale est retiré dans ce mode.

**≤ 480px** :
- Segments de `01 type` passent en colonne verticale (3 lignes)
- Padding horizontal `hub` réduit à 14px
- Textareas gardent leur `rows` actuel (14)

## 8 — Transitions / microinteractions

**Registre** : froid, direct, fonctionnel. Pas de `svelte/transition` (`fly`, `fade`, `slide`, etc.) entre panneaux — les panneaux sont statiques. Pas de `cubic-bezier` exotique.

**Règles** :
- Dormant → actif (passage après `01 type` choisi) : `opacity 0.35 → 1` sur inputs disabled → enabled, `transition: opacity 120ms linear`
- Glyphe qui devient `●` : flash vermillon 200ms (background ou color, via `@keyframes glyph-ready`), puis retour à la couleur cible stable
- Focus d'un input/textarea : `border-left` du panneau parent passe en `2px solid var(--vermillon)` instantané (pas de transition)
- CTA phase-driven : label swap **instant** (pas de fade de texte). Bordure pulse vermillon via `@keyframes pulse` (déjà définie dans la landing, `1.6s infinite linear`)
- Scroll intra-page depuis la checklist : `scrollBehavior: 'smooth'`, `block: 'start'`, avec offset de `80px` pour laisser le header visible

## 9 — Mapping du code existant

Tout ce qui reste / change :

**Gardé (logique métier, non visuel)** :
- `scrapeLinkedIn()` — panneau `02`, logique inchangée
- `extractFileText()` + `handleFiles()` + `pendingFiles` — panneau `04`, logique inchangée
- `createClone()` + `ingestProgress` — panneau `04`, logique inchangée
- `dmIssues` (derived) — remonté dans `07 AVERTISSEMENTS`
- Split `postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30)` — source de vérité pour `03a`

**Viré** :
- `direction`, `prevStep()`, `nextStep()` — plus de navigation séquentielle
- `<div class="step-bar">` — remplacé par la bande `PROTOCOLE`
- `transition:fly` autour de `.create-step-wrap` — viré
- `type-card` avec emojis — remplacé par segments mono
- `.btn-secondary` (classe) — remplacée par style unifié des `.head-action` de la landing
- Toggle `showDocs` — docs exposés par défaut
- `step === 'type' | 'info' | 'posts' | 'dm' | 'docs'` — plus de `step` state (tous les panneaux coexistent)

**Nouveau state** :
```js
let focusedPanel = $state(null); // 'info' | 'posts' | 'dm' | 'docs' — pour border-left vermillon
let generationPhase = $state('idle'); // 'idle' | 'creating' | 'ingesting' | 'computing' | 'done' | 'error'
let sideCollapsed = $state(true); // mobile only
```

**Derived** :
```js
const panelStates = $derived({ type: ..., info: ..., posts: ..., dm: ..., docs: ... });
const requiredPanels = $derived.by(() => {
  if (cloneType === 'posts') return ['type', 'info', 'posts'];
  if (cloneType === 'dm')    return ['type', 'info', 'dm'];
  if (cloneType === 'both')  return ['type', 'info', 'posts', 'dm'];
  return ['type'];
});
const canGenerate = $derived(requiredPanels.every(p => panelStates[p] === 'ready'));
const warnings = $derived.by(() => [...dmIssues, ...bioWarning, ...postsTooFewWarning]);
```

## 10 — Tokens CSS réutilisés

Tous via `var(--*)`, déjà définis globalement (cf. `+page.svelte` landing + hub) :
- `--paper`, `--paper-subtle`, `--ink`, `--ink-70`, `--ink-40`, `--ink-20`
- `--vermillon`
- `--rule`, `--rule-strong`, `--grid`
- `--font`, `--font-mono`, `--font-ui`
- `--fs-tiny`, `--fs-nano`, `--fs-body`
- `--dur-fast`, `--ease`
- `--touch-min` (mobile)

**Aucun nouveau token.** Si un besoin émerge (ex: `--panel-dormant-opacity`), le discuter avant de l'ajouter.

## 11 — Non-scope (explicite)

- **Pas de métriques calculées** dans la side (pas de kurtosis, pas de collapse_idx preview, pas de fidélité simulée). On compte, on ne prédit pas.
- **Pas de preview de génération fake**. Le CTA phase-driven reflète l'état réel de `createClone()`.
- **Pas de refonte de `/hub` ni de `/chat`** dans cette itération — sujets séparés, à traiter ensuite.
- **Pas de changement d'API** — toutes les routes backend (`/api/scrape`, `/api/personas`, ingestion) restent inchangées.
- **Pas de nouveaux tokens CSS**. Réutilisation stricte.
- **Pas de changement de logique métier** (dedup, validation serveur, etc.).

## 12 — Critères d'acceptation

1. `/create` sert une seule page, tous les panneaux coexistent dans le DOM dès le mount.
2. Le sélecteur `01 type` gate les autres panneaux (opacity 0.35 + disabled) tant qu'aucun type n'est choisi.
3. Choisir un type `posts` ou `dm` masque (ou marque non-applicable) le panneau inverse.
4. La side checklist reflète en temps réel l'état des 5 lignes, avec comptes bruts à jour à chaque frappe.
5. Cliquer sur une ligne checklist scrolle vers le panneau correspondant (smooth, offset header).
6. Les warnings apparaissent / disparaissent dynamiquement selon `dmIssues`, `posts < 3`, `bio vide`.
7. Le CTA `générer le clone →` reste disabled tant que `canGenerate === false`.
8. Pendant la génération, le label du CTA et la `p-meta` du panneau `04` miroirent la phase.
9. Après succès, le label affiche `✓ clone prêt — ouvrir →` pendant 1.5s avant redirection `/chat/{id}`.
10. Un lien `+ nouveau clone` apparaît sous le CTA en état `done` et permet de réinitialiser le state local sans navigation.
11. Aucune transition `fly`/`fade`/`slide` entre états. Seules `opacity`, `color`, `border-color` transitent (120-200ms linear).
12. Aucun emoji dans l'UI finale (✍️💬⚡ virés).
13. Responsive ≤900px : 1 colonne, side en bottom-sheet collapsable.
14. Logique métier de création (scrape, ingest, createClone) strictement inchangée — seul le visuel + le state UI change.

---

**Fin du spec.** Prochaines étapes : spec review (subagent) → relecture user → plan d'implémentation (writing-plans).
