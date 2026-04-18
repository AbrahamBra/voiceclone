# audit/screens/chat.md — `/chat/[persona]`

**Écran** : cœur de l'app. Le lieu où l'opérateur d'agence passe 80% de son temps.
**Fichiers** : `src/routes/chat/[persona]/+page.svelte` (720 L) + 10 composants imbriqués (~3300 L cumulées).

---

## 1. IDENTITÉ

### Job-to-be-done (1 phrase)
> **Générer, corriger et exporter du contenu dans la voix d'un client donné, le plus vite possible, en gardant l'historique de travail par client.**

### Test des 3 secondes pour un first-time user
**Non.** Un opérateur qui arrive pour la première fois voit :
- Un header dense (cockpit) avec 3 jauges chiffrées qu'il ne sait pas interpréter (`collapse 87.2`, `fidélité 0.834`, `règles 0`)
- Une sidebar gauche avec 3 onglets (Connaissance / Intelligence / Conversations) où "Connaissance" est actif par défaut et montre un uploader de fichiers — pas un chat
- Un message de welcome générique et 4 tab-btns à droite (règles / prospect / correction / réglages)
- Un footer mono avec 7 compteurs

Il cherche **la zone "écris ici"** — elle est là, mais noyée dans 6 systèmes de navigation concurrents.

### Test de nécessité
Obligatoire — c'est le produit. Mais la question vraie : **que se passe-t-il si on vire la moitié des pièces autour du chat ?** (Gauges cockpit, marginalia par message, AuditStrip, sidebar "Connaissance" en tab primaire.) Hypothèse : l'opérateur gagne en vitesse, le prospect agence perd un argument commercial. Ces deux besoins doivent vivre dans deux surfaces différentes.

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 4/10 | L'écran hésite entre "outil de travail" et "tableau de bord observable". Aucune primary action n'est visuellement prioritaire. |
| **Hiérarchie visuelle** | 3/10 | Cockpit → 11 zones interactives dans 60px. Sidebar + messages + marginalia + 4 panels + audit strip = 6 hiérarchies parallèles, aucune ne gagne. |
| **Charge cognitive** | 2/10 | Miller (7±2) explosé. Un nouvel opérateur compte ~20 éléments actifs au premier regard. |
| **Densité d'information** | 4/10 | Paradoxe : le contenu (le message) est **étroit**, l'instrumentation autour est **dense**. Inversé. |
| **Microcopy & CTAs** | 5/10 | Vocabulaire cohérent (mono lowercase, vermillon) mais **aucune distinction action primaire / secondaire**. "Envoyer" / "Corriger" / "Copier" / "Sauver comme règle" au même poids. |
| **Cohérence globale** | 6/10 | Système visuel (grid, mono, vermillon, dashed) cohérent. Système d'interaction non : 2 nav concurrentes (sidebar 3 tabs + cockpit 4 tabs) pour le même objet. |
| **Signal émotionnel** | 3/10 | Austère, laboratoire, pas de chaleur. Sur 6h/jour = fatigue visuelle. Aucune micro-récompense après un message validé. |
| **Accessibilité** | 5/10 | Aria-labels OK sur cockpit, skip-link manquant, taille tab-btns 11px mono, contraste `ink-40` sur `paper-subtle` limite, zero keyboard shortcut visible sauf Cmd+K conv. |

**Moyenne : 4/10.** Acceptable pour une démo, invivable pour un usage 6h/jour × 5 jours.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Le switch multi-clones coûte 3 écrans
Pour passer du clone client A au clone client B, l'opérateur doit :
1. Cliquer `← back` dans le cockpit OU ouvrir la sidebar et cliquer "← Changer de clone"
2. Atterrir sur `/` (landing) qui redirect via layout vers `/hub`
3. Scroller sa liste, cliquer le clone B

**3 étapes × ~20 switchs/jour = ~2 min de nav pure perdues/jour × N opérateurs.** Pour une agence avec 8 clients actifs, c'est le premier motif de "je rage-quit l'app et je reviens à mes Google Docs".

**Source du problème** : le hub est traité comme une page, pas comme une vue. Linear/Arc traitent le switch comme une action (Cmd+K, sidebar persistante). VoiceClone traite ça comme un retour à l'accueil.

### 🔴 RF2 — Le cockpit est une instrumentation de laboratoire placée dans un outil de travail
Les 3 jauges `collapse / fidélité / règles` sont pertinentes **1 fois par semaine** pour debugger un clone qui déraille. Mais elles sont **permanentes au centre du header** — l'endroit avec la plus forte demande d'attention à chaque message.

- L'opérateur expert finit par les ignorer (blind spot).
- Le nouvel opérateur s'y perd (`Qu'est-ce que 0.834 signifie ? C'est bien ? C'est mal ?`).
- **Zéro action** ne découle d'une lecture de ces jauges sauf "peut-être ouvrir le panel correction".

Hick's Law : plus tu montres d'options, plus tu ralentis la décision. Ces jauges ralentissent chaque message.

### 🔴 RF3 — La boucle de feedback (différenciateur produit #1) est un tab comme les autres
"Correction" est **LE** mécanisme qui fait que ton clone s'améliore. C'est vendu dans le guide ("Plus vous le corrigez, plus il vous ressemble"). C'est le seul truc qui distingue VoiceClone d'un ChatGPT wrapper.

Dans l'UI actuelle : bouton "Corriger" discret sous chaque message bot, + un tab `correction` à droite au même poids que `règles` (consulté <1%) et `réglages` (consulté <1%). **Rien ne hurle "corrige-moi".**

Principe Nielsen #1 (Visibility of system status) : l'état "ce clone a besoin de corrections" devrait être un signal omniprésent, pas une action enfouie.

### 🔴 RF4 — Aucun export / copy optimisé LinkedIn
L'opérateur copie-colle 20-30 fois par jour vers LinkedIn. Aujourd'hui : bouton "Copier" → clipboard brut. LinkedIn a ses propres quirks (line breaks, hashtags en fin, gestion emoji). Pas de :
- "Copier version LinkedIn-ready"
- "Copier comme draft" (avec placeholders client)
- Export d'un pack de N posts pour livraison client
- Plain / markdown / rich options

C'est un trou opérationnel majeur pour une agence — ils livrent du contenu, pas des conversations.

### 🔴 RF5 — Pas d'organisation des conversations par client / par type
La sidebar liste les conv groupées par date seulement. Pour un opérateur gérant 200 conversations réparties sur 8 clients × 2 services (posts + DM), retrouver `"les 5 DM envoyés pour Client C la semaine dernière"` est impossible. Pas de tags, pas de filtres par type (post/DM), pas de groupe par client (puisqu'une conversation = une persona et une persona = un clone = un client).

Attendu : filtres + tags + segments sauvegardés, comme Superhuman le fait pour les emails.

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (sans casser la stack actuelle)

**Principe directeur** : garder l'architecture (cockpit + sidebar + panels + audit strip), **redistribuer la hiérarchie** pour que l'action primaire reprenne sa place.

#### Structure proposée (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [☰] ◎ Lucile (Client: Atomi) ● sain   [CLONE ▼] ····· [régler] [?]    │ ← 44px cockpit
├───────────────┬─────────────────────────────────────────────┬───────────┤
│               │                                             │           │
│ Conversations │              MESSAGES                       │  Corriger │
│ [+] nouvelle  │                                             │ (primary, │
│               │    [user] Écris un post sur X.              │ inline    │
│ aujourd'hui   │                                             │ sous msg) │
│ ─ Post CTO    │    [bot]  [Lucile · 14:42]                  │           │
│ ─ DM Pierre   │           Lorem ipsum dolor sit amet...     │           │
│               │           [◼ Copier] [✎ Corriger] [⚐ Autre] │           │
│ hier          │                                             │           │
│ ─ Post series │                                             │           │
│ ─ DM Marc     │                                             │           │
│               ├─────────────────────────────────────────────┤           │
│ filtres       │  [Écris ton message...]          [Envoyer]  │           │
│ · posts       │                                             │           │
│ · DMs         │                                             │           │
│ · flagged     │                                             │           │
│ tags: [+]     │                                             │           │
└───────────────┴─────────────────────────────────────────────┴───────────┘
 audit strip — 1 ligne · 12px · replié par défaut, hover pour déplier
```

#### Changements précis

1. **Cockpit compacté** : retirer les 3 jauges du centre. Les remplacer par **UN** seul badge "style health" à côté du nom persona : rond coloré (vert/jaune/rouge) + "sain" / "alerte" / "dérive". Hover → tooltip avec les 3 métriques d'origine. Gagné : ~200px d'espace header + -1 décision cognitive par coup d'œil.
   - Principe : *progressive disclosure*
   - Benchmark : Linear status dot sur chaque issue

2. **Switch clones dans le cockpit** : ajouter un dropdown `[CLONE ▼]` juste après le nom qui liste les clones récents + "Tous les clones →" (pas besoin d'aller sur `/hub`). Cmd+Shift+C ouvre le même dropdown.
   - Principe : *Recognition not recall*
   - Benchmark : Linear workspace switcher, Arc spaces

3. **Tab "Correction" promu en action inline** : retirer le tab `correction` du cockpit. Sous chaque message bot, rendre `[✎ Corriger]` en bouton **solid vermillon** (actuellement ghost). Quand l'opérateur clique, le panel slide-in (comme aujourd'hui) mais **déjà pré-rempli** avec le message visé. Économie : -1 clic, +5x visibilité.
   - Principe : *Fitts (taille)*
   - Benchmark : Notion block actions

4. **3 tabs restants** (règles / prospect / réglages) **demi-demotés** : transformer en `[⋯]` menu (More) dans le cockpit droite. Gardés mais un niveau de profondeur en plus — cohérent avec leur usage <5% du temps.

5. **Sidebar gauche** : supprimer l'onglet "Connaissance" comme tab primaire. Faire "Conversations" le seul état par défaut. Ajouter **en bas** de la sidebar deux liens secondaires `📁 docs` et `◇ intelligence` qui ouvrent le tab correspondant au clic (mais conversations reste la vue par défaut).
   - Principe : *Fréquence d'usage = hiérarchie*

6. **Filtres + tags conversations** : en-dessous de `[+] nouvelle conversation`, ajouter une ligne de pills filter : `Tout` `Posts` `DMs` `✦ Flag`. Et dans chaque conv, un bouton `+ tag` qui ajoute une étiquette libre. Aujourd'hui les DMs sont déjà typés par scenario — il suffit d'exposer le filtre.

7. **Copier → Copier LinkedIn + menu secondaire** : le bouton `Copier` propose 1 action par défaut (LinkedIn-ready : line breaks doublés, emoji préservé, hashtags en fin) + un chevron `▼` pour choisir `plain`, `markdown`, `export pack` (multi-message).

8. **AuditStrip replié par défaut** : 12px, affiche juste `session 12m · 8 msgs · cache 82%`. Cliquer l'expand → déploie les 7 métriques + la narrative. Récupère 28px d'espace vertical + -1 élément en compétition d'attention.

9. **Input enrichi** : ajouter à droite du textarea un compteur discret `char 842 · 🎯 post idéal 1200-1500`. Pour une conv de type DM : `char 96 · 🎯 DM idéal 150-280`. L'opérateur sait s'il est dans la bonne fourchette.

10. **Micro-récompense après validate** : quand le user clique "Valider ✓" sur une réponse, subtle toast + le style-fingerprint de la clone-card "pulse" une fois vert. C'est le seul endroit où l'app peut se permettre une émotion positive dans la chrome austère.

#### CTA principal
`[Envoyer]` inchangé, mais **visuellement aligné au vermillon** (aujourd'hui `--ink`, solid noir). Signal : c'est l'action primaire, pas "Corriger".

#### Impact attendu sur le KPI (UX/fluidité/efficience)
- **Switch inter-clones** : 3 clics → 2 clics (dropdown inline) → 1 raccourci clavier. **−60 secondes/opérateur/jour pour 20 switchs.**
- **Corriger un message** : même nombre de clics mais visibilité 5×. **Probablement +30% de corrections par opérateur** (plus il corrige, plus le clone s'améliore — c'est le flywheel business).
- **Charge cognitive cockpit** : 11 zones → 6. Miller respecté.
- **Vitesse de reconnaissance contexte** : -40% (l'opérateur voit "Lucile · client Atomi · sain" d'un coup d'œil vs. calcul mental).

---

### Version B — **Zéro compromis** (reparti de zéro)

**Principe directeur** : le chat est **le** produit. Tout ce qui ne sert pas à écrire/corriger/exporter dégage. Le pipeline observable vit ailleurs (landing démo + lab mode opt-in).

#### Structure proposée (ASCII)

```
┌──┬────────────────────────────────────────────────────────────────────┐
│  │ Lucile (Atomi) · scenario: post                                    │ ← 36px
│◎ ├────────────────────────────────────────────────────────────────────┤
│  │                                                                    │
│Ⓛ │   Drafts (3) — pending review                       [Export pack] │
│  │   ─ Post CTO fintech              · 1340 char · brouillon 3       │
│Ⓐ │   ─ DM Marc @Bolt                 ·   232 char · brouillon 2       │
│  │   ─ Post levée de fonds           ·  980 char · à relire           │
│Ⓜ │                                                                    │
│  │   Conversation active                                              │
│Ⓟ │   ─────────────────                                                │
│+ │   [user] Écris un post sur X.                                      │
│  │                                                                    │
│  │   [Lucile]                                                         │
│  │   Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed    │
│  │   do eiusmod tempor incididunt ut labore et dolore magna aliqua.  │
│  │                                                                    │
│  │   [◼ Copier LinkedIn]  [✎ Corriger]  [+ Draft]  [⚐ Autre version] │
│  │   ─ fidélité 0.83 · 2 règles · 1.8s · 420t         [ᨓ détails]    │ ← marginalia INLINE, pas en marge
│  │                                                                    │
│  ├────────────────────────────────────────────────────────────────────┤
│  │ Scenario: post ▾  [Écris ton message...]        🎯 1200-1500 char │
│  │                                                          [Envoyer] │
└──┴────────────────────────────────────────────────────────────────────┘
```

Détails :
- **Rail vertical 44px à gauche** : icône-avatar par clone actif. Badge rouge = corrections en attente. Switch 1-clic entre clones. `+` en bas = nouveau clone. Le hub disparaît.
- **Pas de cockpit** : la seule info permanente = "Lucile (Atomi) · scenario: post" en une ligne 36px. Le reste vit ailleurs.
- **Bloc "Drafts"** en haut du content pane : les posts/DMs que l'opérateur a marqués `+ Draft` et qui attendent relecture/export. Remplace la notion informelle de "conversations". Un post peut vivre en brouillon plusieurs jours avant d'être envoyé/livré.
- **"Export pack"** : un bouton qui prend X drafts cochés → compile en un PDF / doc Notion / copie multi-bloc prête à coller dans un email client.
- **Marginalia → inline, optionnelle** : par défaut, une ligne résumée `fidélité 0.83 · 2 règles · 1.8s · 420t` sous chaque message bot. Cliquer `[ᨓ détails]` → déplie le bloc complet (diff pass1, fingerprint, live_style breakdown, timing). Opt-in — l'opérateur choisit.
- **Switch scenario dans l'input lui-même** : `Scenario: post ▾` juste à gauche de l'input. Pour passer de mode "post" à mode "DM", 1 clic. Actuellement c'est un param URL (`?scenario=X`) invisible dans l'UI.
- **Compteur cible contextuel** : `🎯 1200-1500 char` pour post, `🎯 150-280 char` pour DM, adapté au scenario.
- **Command palette (Cmd+K) universel** : switch clone, nouveau draft, go to conv, search message, open correction panel, settings — tout. Remplace les 4 tab-btns droite.
- **Panels droite = 1 seul panel contextuel** : ouvre uniquement quand l'opérateur invoque une action précise ("Corriger" sur un msg, "Prospect" depuis le menu, "Doc" depuis le menu). Jamais 4 tabs en compétition.
- **Pas d'AuditStrip permanente** : un `Cmd+Shift+A` → ouvre un overlay "session audit" avec les 7 métriques + la narrative. Off par défaut. Visible quand l'opérateur en a besoin (rare).
- **Emoji state subtle** : un seul signal émotionnel discret. Après 10 msgs sans rewrite, une micro-animation de la couronne fingerprint. Les opérateurs qui bossent 6h dans l'app méritent 2 secondes de récompense.

#### CTA principal
`[Envoyer]` solid vermillon. `[Corriger]` et `[+ Draft]` juste en-dessous du message bot en actions secondaires visibles.

#### Composants supprimés
- `/hub` — remplacé par le rail vertical
- `ChatCockpit` — réduit à un breadcrumb 36px
- `RulesPanel` — migré en overlay Cmd+Shift+R (power-user only)
- `AuditStrip` — migré en overlay Cmd+Shift+A
- `IntelligencePanel` full tab — réduit à une icône dans le rail (ouvre un overlay)
- `ScenarioPill.svelte` et `PersonaCard.svelte` — dead code, kill

#### Composants ajoutés
- `CloneRail.svelte` — rail vertical 44px
- `DraftsBoard.svelte` — bloc pending drafts top of content
- `ExportPack.svelte` — export multi-draft
- `ScenarioSwitcher.svelte` — dropdown inline input

#### Principes appliqués
- *Fitts (taille + distance)* — rail large, actions inline sous msg
- *Recognition not recall* — drafts visibles avant la conv
- *Progressive disclosure* — marginalia opt-in, métriques overlay
- *Match real world* — "post" / "DM" / "draft" / "export pack" = vocabulaire d'agence, pas de laboratoire

#### Benchmarks concurrents précis
- **Linear** — rail vertical + command palette universel + status dots
- **Superhuman** — drafts board + raccourcis clavier omniprésents + catégorisation (posts/DM = split inbox)
- **Notion** — inline block actions sous chaque contenu
- **Arc** — spaces (= clients ici) + compactness par défaut
- **Attio** — multi-accounts switch 1-click dans la sidebar

#### Impact attendu sur KPI
- **Switch clones** : 1 clic au lieu de 3. **~30 secondes/switch × 20 switchs = 10 min/jour récupérées.**
- **Nombre de posts livrés/semaine** : +25-40% (drafts + export pack éliminent le friction de livraison)
- **Corrections par message** : +50% (Corriger est primary, pas secondary)
- **Onboarding nouvel opérateur** : passe de ~30 min à ~5 min (1 écran clair, pas 6 systèmes à apprendre)

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui fait | Version |
|---|---|---|---|---|---|---|
| 1 | **Switch clone dans cockpit** (dropdown + raccourci) | 9 | 3 | 🔥 P0 | Dev front | A + B |
| 2 | **Corriger promu en action primaire inline** | 9 | 2 | 🔥 P0 | Dev front | A + B |
| 3 | **Compacter les 3 jauges en un badge `style health`** | 7 | 3 | P1 | Dev front | A |
| 4 | **Copier LinkedIn-ready + menu copy** | 7 | 4 | P1 | Dev front | A + B |
| 5 | **Filtres conversations (post / DM / flag / tags)** | 8 | 5 | P1 | Dev full-stack | A + B |
| 6 | **AuditStrip repliée par défaut** | 5 | 2 | P2 | Dev front | A |
| 7 | **Compteur cible char contextuel** (post vs DM) | 6 | 2 | P2 | Dev front | A + B |
| 8 | **Scenario switcher inline sous input** | 7 | 4 | P2 | Dev front + BE | A + B |
| 9 | **Drafts board + export pack** | 10 | 8 | P1-long | Dev full-stack + design | B |
| 10 | **Rail vertical clones → kill `/hub`** | 10 | 9 | P2-radical | Dev full-stack + design | B |

### Quick wins à flagger
- 🔥 **#1 Switch clone inline** — 3j dev, dépasse la moitié du gain UX pour l'opérateur d'agence
- 🔥 **#2 Corriger promu** — 1j dev, débloque le flywheel business du feedback loop

Ces deux-là livrés cette semaine = ton agence voit une différence palpable.

---

**Audit écran 1/8 terminé. Valide, conteste, ou demande un zoom sur un point précis avant que je passe à `/create`.**

---

## 6. ADDENDUM — infos ajoutées après rédaction initiale

### 6.1 Intégration Breakcold / sales engagement (roadmap)

**Contexte** : AhmetA a partagé l'intention d'intégrer à terme VoiceClone avec Breakcold (ou équivalents : Lemlist, Waalaxy, HeyReach) pour remonter automatiquement :
- Lien LinkedIn du prospect
- Historique complet de conversation
- Position dans le pipeline
- Signal "cette conv a mené à un RDV ou pas" → scoring interne de ce qui marche

**Impact direct sur l'audit `/chat`** — trois conséquences immédiates :

1. **Le scenario actuel doit être retypé**. Aujourd'hui c'est un paramètre URL libre (`?scenario=X`). Pour coller aux use-cases agence DM, il faudrait 4 scenarios canoniques :
   - `post` (contenu éditorial long-form)
   - `DM-1st` (premier message à un prospect froid)
   - `DM-relance` (séquence automatisée, 2e-3e-4e message sans réponse)
   - `DM-reply` (répondre à un prospect qui a mordu)

   Chacun a des contraintes de longueur, de ton, et une source de données différente — `DM-*` lisent depuis Breakcold, `post` est pur créatif.

2. **Le pane de conversation doit accepter une source externe**. Aujourd'hui chaque conversation est interne à VoiceClone. Avec Breakcold, l'opérateur doit voir :
   ```
   [Source: Breakcold · Thread avec Marc Dupont · statut: lead chaud · 4 msgs échangés]
   ────────────────────────────────────────────────
   [Marc, J-3]    "Intéressant, on peut caler un call ?"
   [Lucile, J-3]  "Oui, voici mon cal.com : ..."
   [Marc, J-1]    "Finalement on reporte la semaine prochaine."
   ────────────────────────────────────────────────
   [Écris la relance...]
   ```
   Le clone voit tout le contexte, génère la relance adaptée, l'opérateur copie → Breakcold (ou push-to-Breakcold directement si l'API permet).

3. **Les "drafts" de la Version B prennent leur vrai sens**. Un draft posté = un message à injecter dans Breakcold. Un draft validé peut déclencher un push API (quand l'intégration existera).

**Ce que ça change dans la priorisation de la Version B (ci-dessus)** :
- Le draft board n'est plus un "nice-to-have" mais un **pré-requis d'intégration** — sans lui, le workflow push-back vers Breakcold est artisanal.
- Le rail vertical clones devient plus pertinent encore : chaque clone a son propre stream de DMs externes.
- L'export pack multi-drafts devient potentiellement un "sync batch → Breakcold" (livraison programmée).

**Ce que l'audit Phase 3 pour `/chat` garde** : rien à revoir sur les red flags et la structure proposée. Au contraire, ils deviennent encore plus évidents. Un opérateur qui paste des conv Breakcold manuellement aujourd'hui perd 10× ce que les red flags identifient.

**Ajout à la table de priorisation** :

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui fait | Version |
|---|---|---|---|---|---|---|
| 11 | **Retyper scenario en {post, DM-1st, DM-relance, DM-reply}** | 8 | 5 | P1 | Dev full-stack | A + B |
| 12 | **Pane "source externe" pour conversation importée** | 9 | 7 | P1-long | Dev full-stack | A + B |
| 13 | **Intégration Breakcold API read-only (MVP)** | 10 | 8 | P2-major | Dev BE + agence biz | A + B |
| 14 | **Push draft → Breakcold (action depuis draft board)** | 8 | 7 | P3 | Dev BE | B |

### 6.2 Coordination avec le spec parallèle `thermometre-rail-design.md`

AhmetA m'indique qu'il écrit en parallèle `docs/superpowers/specs/2026-04-18-thermometre-rail-design.md`. Le fichier n'existe pas encore dans le repo au moment de cet audit.

**Hypothèse** — le nom "thermomètre-rail" suggère fortement qu'il s'agit soit :
- d'un **rail vertical clones** (cohérent avec la Version B proposée ici)
- d'un **thermomètre de fidélité / santé clone** (cohérent avec le "style health badge" proposé en Version A)
- ou les deux combinés

**Recommandation** : ne pas finaliser Version A#3 (badge style health) et Version B rail vertical avant d'avoir pu lire ce spec. Les deux documents doivent converger avant implémentation. Dès que le spec est prêt, je peux le lire et raccorder l'audit en conséquence.

**Risque à éviter** : produire un design A + B ici qui soit contradictoire avec une direction déjà arbitrée côté spec. Si le spec est très divergent, je repasse l'audit au filtre du spec avant l'écran suivant.

### 6.3 Raccord avec `thermometre-rail-design.md` (lu après commits)

Spec lu, impl `HeatThermometer.svelte` en code. Verdict : **le spec est solide et résout une partie de mes RF. Il reste aligné avec la plupart de mes propositions, mais en invalide certaines et en soulève de nouvelles.**

#### Ce que le spec résout vs. mon audit

| Red flag audit | Spec thermomètre | Statut |
|---|---|---|
| RF2 (cockpit labo) | `MessageMarginalia` déplacée en toggle opt-in sous bot msg | ✅ Partiellement résolu — mais les 3 jauges cockpit restent |
| Version B "marginalia opt-in inline" | Spec fait exactement ça | ✅ Alignés, spec **supérieur** : il ajoute en plus le thermomètre business à droite |
| Version A "retirer les 3 jauges cockpit en badge" | Non traité | ⚠️ À rediscuter à la lumière du spec |
| RF1 (switch multi-clones) | Hors scope | 🟥 Non résolu — reste prioritaire |
| RF3 (Corriger relégué) | Hors scope | 🟥 Non résolu — reste prioritaire |
| RF4 (export LinkedIn) | Hors scope | 🟥 Non résolu |
| RF5 (organisation conv) | Hors scope | 🟥 Non résolu |

**Conclusion** : le spec thermomètre rail **complète** mon audit plutôt que le contredire. Il traite un red flag que j'avais **sous-estimé** : la colonne droite ne servait à rien en mode vente, mais c'était un gaspillage d'espace plus qu'un blocage actif. Le spec transforme ce gaspillage en **valeur vente** (temperature prospect + signaux narratifs = outil de qualification en direct). C'est meilleur que ma proposition.

#### Tranches validées (2026-04-18)

**→ Q1 — Thermomètre conditionnel au scenario.** Affiché si `scenario ∈ {DM-1st, DM-relance, DM-reply}`, caché si `post`. Raison : signaux = détecteurs sales, incompatibles avec rédaction éditoriale. Forme suit fonction.

**→ Q2 — En mode post, colonne droite disparaît.** Content prend la pleine largeur. Les posts longs lisent mieux à ~900px qu'à 600px. Pas de remplacement v1 par un autre instrument — ne pas combler un espace juste parce qu'il existe.

**→ Q3 — 3 jauges cockpit → un badge "style health" partout, indépendant du scenario.** Vert/jaune/rouge visible en permanence, détail à la demande via tooltip/click. Non-redondance avec la marginalia opt-in, cohérence structurelle inter-scenarios, charge cognitive minimale. *Progressive disclosure.*

**→ Q4 — LeadPanel gardé, renommé `brief`.** Rôles distincts : brief = avant (préparation contexte), thermomètre = pendant/après (monitoring signaux). Post-Breakcold sa portée rétrécit aux conv créées en interne + au mode post pour briefer un clone sur un ICP. Revisit si usage <5% après intégration.

---

#### Détail complet des questions avant tranche (pour traçabilité)

**Q1 — Le thermomètre est-il affiché sur TOUS les chats, ou seulement sur les chats de type DM ?**
Le rail, le score, les signaux (`accept_call`, `books_slot`, `ghost_2days`, `cold_lexical`…) n'ont **aucun sens** sur un chat de rédaction de post éditorial. Sur un persona en mode "post LinkedIn", le prospect n'existe pas — il n'y a qu'un opérateur et un clone qui co-écrivent du contenu.

Deux options :
- **A** : thermomètre **conditionnel au scenario** (affiché si `scenario ∈ {DM-1st, DM-relance, DM-reply}`, caché sinon)
- **B** : thermomètre **conditionnel à la présence de messages "user" sémantiquement prospects** (le backend détermine si une conv est DM-like)

Option A est plus simple et cohérente avec ma proposition de retyper les scenarios (§6.1).

**Q2 — Que devient la colonne droite quand le thermomètre est caché ?**
Si le thermomètre disparaît en mode post, la colonne droite redevient vide. Deux options :
- **A** : elle disparaît, le content prend toute la largeur (post a besoin de plus de largeur pour bien lire des paragraphes longs de 1200-1500 char)
- **B** : elle est remplacée par un autre instrument mode-post (ex : compteur hook/body/CTA, references aux posts similaires, etc.)

Option A recommandée pour v1. Les instruments post-mode viendront plus tard.

**Q3 — Que deviennent les 3 jauges du cockpit (`collapse / fidélité / règles actives`) ?**
Elles restent dans le spec (pas touchées). Elles étaient déjà mon RF2. Proposition revisée à la lumière du spec :
- En **mode DM** : déjà deux systèmes d'observabilité (journal narrative + marginalia opt-in). Les 3 jauges cockpit deviennent redondantes et gaspillent du prime real estate cockpit. → **À compacter en badge** comme proposé en Version A#3.
- En **mode post** : le thermomètre disparaît (cf. Q1), la marginalia reste opt-in. Les jauges cockpit sont le seul indicateur stylistique permanent. → **Garder visible** pour ce mode.

Solution : les 3 jauges cockpit sont **conditionnelles au scenario**. Visibles en mode post, compactées en badge en mode DM.

**Q4 — Le panel "prospect" (`LeadPanel`) devient-il redondant ?**
Aujourd'hui le LeadPanel scrape une URL LinkedIn d'un prospect et injecte un message "contexte prospect" dans le chat. Le thermomètre analyse les conversations existantes.

Les deux sont complémentaires mais pas redondants :
- LeadPanel = **avant** la conversation (préparation du 1er message avec contexte prospect)
- Thermomètre = **pendant/après** la conversation (monitoring de la progression)

À garder tel quel. Peut-être renommer le tab `prospect` en `brief` pour éviter la confusion avec le thermomètre.

**Q5 — Impact sur l'intégration Breakcold future (§6.1)**
Très positif : quand Breakcold alimentera les messages prospect via API, le `logProspectHeat` déclenchera automatiquement la heat update + SSE event → `HeatThermometer` se met à jour. Le spec est donc **forward-compatible** avec la roadmap intégrations.

Mon ajout : le panel devrait à terme afficher aussi la provenance (`Source: Breakcold` / `Source: interne`) et lier vers la conversation externe. Pas dans le scope du spec actuel, mais à anticiper dans la structure de données.

#### Table de priorisation mise à jour

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui fait | Version | Statut spec thermo |
|---|---|---|---|---|---|---|---|
| 1 | **Switch clone dans cockpit** (dropdown + raccourci) | 9 | 3 | 🔥 P0 | Dev front | A + B | Indépendant |
| 2 | **Corriger promu en action primaire inline** | 9 | 2 | 🔥 P0 | Dev front | A + B | Indépendant |
| 3 | **3 jauges cockpit → conditionnel scenario** (badge en DM, full en post) | 7 | 3 | P1 | Dev front | A | Complète le spec |
| 4 | **Copier LinkedIn-ready + menu copy** | 7 | 4 | P1 | Dev front | A + B | Indépendant |
| 5 | **Filtres conversations (post / DM / flag / tags)** | 8 | 5 | P1 | Dev full-stack | A + B | Indépendant |
| 6 | **AuditStrip repliée par défaut** | 5 | 2 | P2 | Dev front | A | Indépendant |
| 7 | **Compteur cible char contextuel** (post vs DM) | 6 | 2 | P2 | Dev front | A + B | Indépendant |
| 8 | **Scenario switcher inline sous input** | 7 | 4 | P2 | Dev front + BE | A + B | **Pré-requis** au rendering conditionnel du thermo |
| 9 | **Drafts board + export pack** | 10 | 8 | P1-long | Dev full-stack + design | B | Indépendant |
| 10 | **Rail vertical clones → kill `/hub`** | 10 | 9 | P2-radical | Dev full-stack + design | B | Indépendant |
| 11 | **Retyper scenario en {post, DM-1st, DM-relance, DM-reply}** | 8 | 5 | P1 | Dev full-stack | A + B | **Pré-requis** au rendering conditionnel du thermo |
| 12 | **Pane "source externe" pour conversation importée** | 9 | 7 | P1-long | Dev full-stack | A + B | Forward-compat thermo |
| 13 | **Intégration Breakcold API read-only (MVP)** | 10 | 8 | P2-major | Dev BE + agence biz | A + B | Forward-compat thermo |
| 14 | **Push draft → Breakcold (action depuis draft board)** | 8 | 7 | P3 | Dev BE | B | Indépendant |
| 15 | **Thermomètre rail (spec AhmetA)** | 9 | 6 | 🔥 P0 | Dev full-stack | Parallèle | Spec écrit, impl en cours |
| 16 | **Rendre thermomètre conditionnel au scenario** | 6 | 2 | P1 | Dev front | Parallèle | Complète le spec sur mode post |

**Nouveau quick win ajouté** : #3 (jauges cockpit conditionnelles) + #16 (thermomètre conditionnel) — les deux vont ensemble et résolvent définitivement la question "quelle observabilité sur quel écran" en faisant du scenario le pivot.

**Révision après tranches Q1-Q4** :
- Ligne #3 (jauges conditionnelles) → **simplifiée** : juste "3 jauges cockpit → un badge style health partout, pas de conditionnel". Effort /10 : 2 (plus simple). Impact /10 : 7 (gain cohérence).
- Ligne #16 (thermomètre conditionnel) → **gardée** telle quelle. Effort /10 : 2 (juste un `{#if}` autour de `<HeatThermometer>`).
- Ligne de plus : **#17 Renommer tab `prospect` → `brief`** — effort 1, impact 3, P3 (cosmétique, utile post-Breakcold).
