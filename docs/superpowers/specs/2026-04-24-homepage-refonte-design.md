# Refonte homepage — design

**Date:** 2026-04-24
**Scope:** `src/routes/+page.svelte` (landing publique, non-auth)
**Approche:** évolution ciblée de la structure existante, pas rewrite

---

## Contexte

La homepage actuelle date de la v1 « voix clonée ». Depuis, le produit a bougé :

| Commit | Évolution non reflétée dans la landing |
|---|---|
| #54 | Operating protocols MVP (hard rules enforcées) |
| #55 | Onboarding exige un protocole à la création du clone |
| #29 | Correction itérative + dialogue méta (clone demande « pourquoi ») |
| #52 | Tabs Post / DM dans le cockpit — même cerveau, deux canaux |

La landing vend toujours « une voix clonée qui écrit vite ». Le produit est devenu « le process du client, écrit à l'onboarding, exécuté par le setter, précisé par les corrections ».

## Cible

Agences ghostwriting + setting LinkedIn qui pilotent 5+ clients (cf `project_voiceclone.md`). Vocabulaire quotidien : DM, prospect, relance, process, closing. Pas tech.

## Approche retenue : évolution

Structure gardée (topbar / hero / preuve / moat / footer). Esthétique laboratoire gardée (paper, vermillon, serif headline, mono labels, grid background). Copy et captures remplacés pour refléter la réalité produit.

Alternatives écartées :
- **Pivot complet autour d'« OS »** : rupture avec la v1, vocabulaire corporate inadapté à la cible agence
- **Ajout discret d'une section protocole** : minimal, rate l'occasion de repositionner

## Principes transverses

1. **Pas de label abstrait** (« protocole », « OS », « playbook »). Décrire concret : règles, ouvertures, cadence de relance, signature, process closing.
2. **Surfaces publiques = contenu 100% synthétique** (cf `feedback_public_surfaces_synthetic_only.md`). Toutes les captures sont des mockups. Prénoms génériques, phrases plausibles mais fictives, aucun chiffre de pilote réel.
3. **Aesthetic préservée**. Seuls le copy et le contenu des captures changent. Palette, fonts, grid, spacing restent.

## Copy humanisée

Pass humanizer appliquée : em-dashes coupés, négative parallélisme viré, redondances de fin supprimées.

### Section 1 — Hero

**Overline** (inchangé) :
```
◇ pour les agences ghostwriting qui pilotent 5+ clients
```

**H1** :
```
10 clients. 10 façons de DM. Un setter qui tient la ligne.
Ton setter colle le DM d'un prospect.
Le draft sort comme ton client l'écrirait. Avec ses règles, sa cadence, sa voix.
```
→ accent italique vermillon sur « ton client l'écrirait ».

**Sub** :
```
Un client = sa façon de faire. Ses règles, ses ouvertures, sa cadence
de relance, écrites noir sur blanc dès l'onboarding. Ton setter tape
dedans, pas à côté. Quand il corrige, le clone demande pourquoi.
La règle rentre avec son contexte.

Tu tiens une agence ghostwriting ? Le même cerveau drafte aussi les
posts LinkedIn de tes clients. DM et posts, une seule ligne.
```

**3 beats** :

**Beat 1 — « ses règles, écrites dès l'onboarding »**
> Sa façon de DM, ses ouvertures interdites, sa cadence de relance, sa signature. Noir sur blanc dès la création du clone. Ton setter tape dedans, pas à côté.

**Beat 2 — « corrige une fois, explique au clone »**
> Tu vires un mot, le clone demande *« pourquoi »*. La règle rentre avec son contexte. Le setter junior qui arrive dans 3 mois n'y retape pas deux fois.

**Beat 3 — « DM et posts, un seul cerveau »**
> Même base pour les DM prospects et les posts LinkedIn. Ton setter passe d'un canal à l'autre sans reconfigurer. La ligne tient partout.

**CTA** : inchangé
```
→ Essaie ton clone en 5 min.
colle 3 posts, un brief prospect, le DM sort dans ta voix. pas de compte, pas de stockage.
[fouiller une démo pré-entraînée →]  [rejoindre la waitlist →]
```

### Section 2 — Preuve (cockpit en action)

**Kicker + title** :
```
◇ dans le cockpit
Ce que ton setter voit, toute la journée.
```

Les 3 captures s'alignent sur les 3 beats. **Toutes sont des mockups fictifs** (pas de screenshot prod, pas de donnée client réelle).

#### Capture 01 — Le setup, écrit noir sur blanc
**Frame bar :** `◎ onboarding · setup du clone`

**Contenu (liste structurée) :**
- « ouvertures interdites » → *jamais « Bonjour ». jamais « J'espère que... »*
- « cadence de relance » → *J+3 → J+7 → on coupe*
- « signature » → *« — A. » sans formule*
- « process closing » → *pas de call avant 3 échanges*

**Figcaption :**
> **01** — Pas besoin que le clone « devine » la façon de ton client à partir de 3 posts. Ton client écrit ses règles une fois. Le clone les exécute dès le 1er draft.

#### Capture 02 — Corriger = expliquer
**Frame bar :** `◎ cockpit · correction`

**Contenu (mini-dialogue) :**
- Draft avec *« n'hésitez pas »* surligné, setter clique
- Bulle clone (vermillon) : *« Pourquoi tu vires ça ? »*
- Réponse setter (mono) : *« trop soft, on ferme, on propose pas »*
- Bulle clone : *« noté, règle ajoutée. plus jamais dans un DM closing. »*

**Figcaption :**
> **02** — Tu corriges une fois. Tu expliques une fois. Le clone retient le pourquoi. La règle vaut pour toute l'équipe.

#### Capture 03 — DM et posts, même cerveau
**Frame bar :** `◎ cockpit · Post | DM`

**Contenu :**
- Topbar avec tabs `Post` / `DM` (DM actif, trait vermillon sous l'onglet actif)
- Côté gauche : mini-stub DM (« Sophie, 2 lignes pile… »)
- Côté droit (tab Post grisé) : mini-stub post LinkedIn (même signature, même cadence)
- Badge discret au centre : `même base · 2 canaux`

**Figcaption :**
> **03** — Ton setter drafte les DM. Le ghostwriter drafte les posts. Un seul cerveau, deux onglets.

### Section 3 — Moat

**Kicker + title** :
```
◇ le moat
Le process tient. Même quand ton équipe change.
```

**Paragraphe principal** (sans chiffre, pas de pilote réel à citer) :
> Setter senior qui part, junior qui arrive : même draft, même voix, même cadence. Le process du client ne vit pas dans la tête d'un humain. Il est écrit, et chaque correction le précise. Quand un nouveau rejoint l'équipe, il écrit dans la bonne ligne dès son premier draft. Plus de semaine à relire les archives.

**Punchline** (gardée, user la kiffe) :
> *Tes setters changent. Le process reste. Les corrections aussi.*

**CTA moat** :
```
→ Essaie le clone en 5 min.
stateless. pas de compte. tu colles, tu vois.
[ou rejoins la waitlist →]
```

### Section 4 — Footer

**Inchangé.** Brand + lien `/guide` + formulaire code d'accès.

## Meta tags (`<svelte:head>`)

**Nouveaux** :
```html
<title>VoiceClone — Le process de ton client, exécuté par ton setter (agences ghostwriting)</title>
<meta name="description" content="Les règles de ton client, écrites dès l'onboarding. Tes setters draftent dedans. Quand ils corrigent, le clone apprend. DM + posts LinkedIn, un seul cerveau." />
```

## Impact code

### Fichiers modifiés
- `src/routes/+page.svelte` — markup + copy + CSS ajustements

### Suppressions markup
- `PILOT_RULES_COUNT` constant (plus utilisée)
- Span `.big-num` dans le moat
- Capture #2 actuelle (`.rule-row`, `.rule-dot`, `.rule-label`, `.rule-detail`, `.rule-action`, `.rule-btn`, `.rule-hint`) remplacée par un dialogue méta (nouveau markup, réutilise les bubbles).
- Capture #3 actuelle (`.fb-list`, `.fb-date`) remplacée par un layout Post/DM (nouveau markup).
- Capture #1 actuelle (bubbles prospect/draft) remplacée par un bloc « setup onboarding » (nouveau markup, liste structurée).

### Ajouts CSS
- Styles pour les 3 nouvelles captures :
  - `.setup-block` — bloc d'une règle d'onboarding (label mono vermillon + détail)
  - `.dialogue-row` — ligne du dialogue méta (bulle clone vermillon vs bulle setter mono)
  - `.tabs-row` — rangée onglets Post/DM avec trait vermillon sous l'actif
  - `.brain-badge` — badge discret central « même base · 2 canaux »

### Inchangé
- `onMount` / auth flow (accessCode, sessionToken)
- `resolveHome`, `pickPersona`, `submitCode`, `openDemo`
- Palette CSS (var `--paper`, `--ink`, `--vermillon`, `--rule`, etc.)
- Fonts, grid background, responsive breakpoints (900px, 600px)
- Footer + code d'accès form
- CTA URLs (`DEMO_CTA_HREF`, `/demo`)

## Non-objectifs

- Pas de refonte visuelle (palette, typo, grid)
- Pas de changement auth / accès / demo
- Pas de nouveaux composants Svelte réutilisables (tout reste local à `+page.svelte`)
- Pas de changement de structure globale (topbar / hero / proof / moat / footer)
- Pas de nouveau CTA flow

## Vérification

**Avant merge master** (cf `feedback_prod_without_ui_test.md`) :
1. Ouvrir l'URL Preview Vercel de la PR
2. Landing doit charger en non-auth (pas de redirect)
3. Click « fouiller une démo pré-entraînée » → entre dans la démo persona, pas dans un autre clone
4. Code d'accès valide → redirect `/chat/<persona>`
5. Code invalide → « refusé » + shake
6. Responsive : checker 600px (stack), 900px (stack triptyque + captures), desktop (3 colonnes)
7. Meta title + description corrects dans le `<head>` rendu

## Implémentation

Plan d'implémentation à générer séparément via skill `writing-plans`.
