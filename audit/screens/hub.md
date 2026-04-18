# audit/screens/hub.md — `/hub`

**Écran** : porte d'entrée authentifiée. Dispatcher vers les clones + actions globales (create, admin, guide).
**Fichier** : `src/routes/hub/+page.svelte` (564 lignes).

---

## 1. IDENTITÉ

### Job-to-be-done (1 phrase)
> **Pour un opérateur d'agence : sélectionner en moins de 5 secondes le clone sur lequel je dois bosser maintenant, voir d'un coup d'œil lesquels demandent de l'attention, et rebondir sur les actions de portefeuille (new client, admin, guide).**

### Test des 3 secondes
- Pour 1-3 clones : **oui**, la page liste ce qu'il faut
- Pour 10+ clones : **non**, scroll infini sans filtre ni search
- Pour 20+ clones (cible agence) : **échec total**, l'opérateur perd 10-20 secondes à chaque switch

### Test de nécessité
À poser frontalement : **le hub doit-il continuer à exister comme "sélecteur de clone" si on livre le rail vertical proposé en Version B de `/chat` ?**

Deux postures possibles :
- **Posture 1** : garder hub comme sélecteur, le refondre pour scaler (Version A)
- **Posture 2** : migrer le sélecteur dans le rail `/chat`, faire du hub un **dashboard agence** orienté portefeuille (Version B)

La Posture 2 est probablement plus cohérente pour une agence multi-clients, mais elle dépend d'un arbitrage produit.

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 7/10 | "Mes clones", "Nouveau clone" — compréhensible au premier regard. |
| **Hiérarchie visuelle** | 6/10 | Sections titrées, cards alignées, MAIS aucune priorité entre clones (le dernier utilisé est noyé avec celui créé il y a 6 mois). |
| **Charge cognitive** | 5/10 | OK pour 3 clones. Au-delà de 10 : explose. Aucun filtre/search/groupement. |
| **Densité d'information** | 4/10 | **620px max-width** sur un écran desktop 1440px = ~60% de l'écran vide à droite. Gaspillage énorme. |
| **Microcopy & CTAs** | 7/10 | Direct et clair. "Créer un clone", "Partager", badges "Essentiel/Important" (dans guide) — pro. |
| **Cohérence globale** | 7/10 | Design system unifié (grid, mono, vermillon, dashed). |
| **Signal émotionnel** | 5/10 | Austère, pas de dynamisme. Même une fois 8 clients signés, la page ressemble à un fichier texte. |
| **Accessibilité** | 6/10 | Aria-labels présents, tab order OK, StyleFingerprint a un tooltip, MAIS aucun raccourci clavier pour aller direct à un clone. |

**Moyenne** : **6/10** pour une agence débutante avec 1-3 clones.
**Moyenne estimée à 20 clones** : **4/10**. Non-scalable par design.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Non-scalable au-delà de 10 clones (zero filter, zero search, zero grouping)
Une agence cible **20+ clients simultanés** sur 6-12 mois d'exploitation. Pour chaque client : 1 à 3 clones (post, DM, éventuellement scenario alternatif).

Aujourd'hui `/hub` empile tout ça en une liste verticale plate :
- Pas de filtre par type (posts / DMs / both)
- Pas de filtre par statut (actif / en pause / nouveau / en dérive)
- Pas de groupement par client
- Pas de search textuel
- Pas de tri (nom, dernière activité, fidélité)

Conséquence : au 15e clone, l'opérateur scroll-cherche à chaque switch. Un hub qui scale mal est un bouchon produit.

**Benchmark** : Linear `Cmd+K` universal switcher + filtres inline (assignee, team, priority). Arc "Spaces" pour séparer par contexte. Attio pour multi-accounts.

### 🔴 RF2 — Aucun tri "derniers utilisés" / "besoin d'attention"
Un opérateur d'agence revient de pause-dej. Il veut reprendre sur les 2-3 clones qu'il a touchés ce matin. Aujourd'hui : il doit se souvenir et scroller.

Il veut voir en top de page : **"Clones avec corrections en attente"**, **"Clones actifs aujourd'hui"**, **"Clones en dérive"** (fidélité qui chute).

Aucune de ces sections n'existe. Le hub est statique, indifférent à l'activité récente.

**Principe violé** : *match real world / recency bias* — l'outil doit refléter le tempo de l'opérateur, pas juste l'état du catalogue.

### 🔴 RF3 — Width 620px en plein desktop (Fitts + densité)
Le hub est centré à `max-width: 620px`. Sur un monitor 1440px ou 1920px, ça fait 60-70% d'écran vide à droite (grid pattern, rien d'autre).

Pour une liste avec 8 clients × 2 clones = 16 cards, le layout en **1 seule colonne** force un scroll vertical massif. Une grille 3-4 colonnes ferait tout tenir dans un écran.

**Cause probable** : design inspiré des settings pages (Linear, Notion) où 620px a du sens pour des formulaires. Mais `/hub` n'est PAS un formulaire — c'est un dashboard de catalogue. Mauvais template mental.

**Correctif** : breakpoints responsive avec grid 1 col (mobile) → 2 col (768px) → 3 col (1200px) → 4 col (1600px). Le nombre de clones visibles sans scroll passe de 4 à 12-16.

### 🔴 RF4 — Badges et état (fidelity-chip, StyleFingerprint) non actionnables
Chaque `.clone-card` montre :
- Un StyleFingerprint SVG 34px
- Un `fidelity-chip` "fid 0.73" avec code couleur ok/warn/bad

Ces signaux sont **informatifs mais pas actionnables**. Tu vois que "Lucile" est en fid=0.42 (bad) → si tu cliques la card, tu arrives sur le chat. Pas sur un écran "diagnostic clone", pas sur "recalibrer", pas sur "que s'est-il passé ?".

Conséquence : l'alerte visuelle existe, mais rien n'accompagne l'opérateur vers l'action corrective. Effet "tableau de bord passif".

**Correctif** : le badge fid-bad devient un bouton `⚠ Diagnostiquer` qui ouvre un panel (pas un redirect chat). Le fingerprint devient cliquable → ouvre IntelligencePanel avec la breakdown complète.

### 🔴 RF5 — "Nouveau clone" enterré en bas, partage surexposé
L'action primaire d'agence ("onboarder un nouveau client") est une `action-card` en bas de page, avec border **dashed** (= visuellement secondaire). L'action rare ("partager un clone avec un collaborateur") est un bouton **solid top-right** de chaque card.

Inversion des priorités :
- Pour une agence qui signe 2 clients/mois : créer > partager d'un ordre de grandeur
- "Partager" devrait vivre dans un menu `⋯` hover ou right-click
- "Créer" devrait vivre **en header**, pas en bas

**Principe** : *visibility ∝ frequency + importance.*

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (hub reste sélecteur, on le scale)

**Principe** : garder l'archi (hub = porte d'entrée sélection clone), mais le transformer pour tenir 20+ clones sans perdre l'opérateur.

#### Structure proposée (ASCII)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◎ VoiceClone / hub              [⌕ rechercher clone…]   [+ Créer]  [👤]  │
│                                                                          │
│ ▾ Récents (3)                    ▾ Filtres: Tous  Posts  DMs  ⚠ Attention│
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                             │
│ │ ◉ Lucile   │ │ ◉ Marc     │ │ ◉ Sophie   │                             │
│ │ Atomi ·POST│ │ Bolt   ·DM │ │ Cecil ·BOTH│                             │
│ │ fid 0.81   │ │ fid 0.74   │ │ fid 0.42 ⚠│                              │
│ │ il y a 12m │ │ il y a 2h  │ │ hier       │                             │
│ └────────────┘ └────────────┘ └────────────┘                             │
│                                                                          │
│ ▾ Atomi (1 clone)                                                        │
│ ┌────────────┐                                                           │
│ │ Lucile — CEO @Atomi · POST · fid 0.81 · 14 conv ·••3 corrections     │ │
│ └────────────┘                                                           │
│                                                                          │
│ ▾ Bolt (2 clones)                                                        │
│ ┌────────────┐ ┌────────────┐                                            │
│ │ Marc · DM  │ │ Paul · POST│                                            │
│ │ fid 0.74   │ │ fid 0.69   │                                            │
│ └────────────┘ └────────────┘                                            │
│                                                                          │
│ ▾ Cecil (1 clone ⚠)                                                      │
│ ...                                                                      │
│                                                                          │
│ ── partagés avec moi ───                                                 │
│ ...                                                                      │
│                                                                          │
│ ── agence ─── (si défini)                                                │
│ Clone agence (Atomi-Agency)                                              │
│                                                                          │
│                                                                          │
│ Ressources · Admin (si admin)                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Changements précis

1. **Header restructuré**, toujours visible :
   - Gauche : brand
   - Centre : **search bar** instant-filter (Cmd+K aussi supporté)
   - Droite : bouton primary `+ Créer` + avatar user (profil/logout)
   - Remplace le "compte de clones" + badge admin actuel (redistribués ailleurs)

2. **Section "Récents"** en tête (3-5 derniers utilisés, triés par `last_used DESC`) :
   - Layout **grille compacte** 3 colonnes en desktop
   - Chaque card mini-size avec : avatar, nom + client + type, fidelity chip, relative time
   - Les 3 premiers sont littéralement accessibles en 1 clic — c'est 80% des besoins quotidiens

3. **Filtres inline** au-dessus de la liste complète :
   - Pills `Tous` · `Posts` · `DMs` · `⚠ Attention` · `Récemment actif`
   - `⚠ Attention` = clones avec fidélité < 0.65 OU corrections en attente OU inactif depuis >14j avec nouvelles conv reçues

4. **Groupement par client** :
   - Si le champ `client` / `tag` est rempli (proposé dans audit `/create` #5), grouper les clones par client
   - Chaque groupe est collapsable `▾ / ▶`
   - Permet de scaler : 20 clients avec 1-3 clones chacun = 20 groupes navigables

5. **Grille responsive** :
   - Mobile : 1 colonne
   - 768px : 2 colonnes
   - 1200px : 3 colonnes
   - 1600px+ : 4 colonnes
   - Width max étendu à 1200-1400px (retire le `max-width: 620px`)

6. **Badges actionnables** :
   - `fidelity-chip` bad devient bouton `⚠ Diagnostiquer` → ouvre un overlay IntelligencePanel sans quitter le hub
   - StyleFingerprint cliquable → ouvre le même overlay
   - Badge "••3 corrections" cliquable → ouvre un panneau avec les corrections pendantes

7. **"Partager" migré en menu** :
   - Enlever le bouton solid top-right
   - Remplacer par un `⋯` menu au survol / droit-clic : `Partager` · `Renommer` · `Dupliquer` · `Archiver` · `Supprimer`
   - Libère l'espace visuel sur la card

8. **Section "agence"** explicite (si l'agence a un clone pour son propre compte) :
   - Séparée des clones clients
   - Visually demarked (border left vermillon)
   - Labelled clearly

9. **Empty state riche pour un nouveau hub** :
   - Si 0 clones : full-page empty state avec 3 pathways : "Créer mon 1er clone client", "Créer le clone de mon agence", "Importer depuis [future integration]"
   - Pas juste une card dashed isolée

10. **Keyboard shortcuts** :
    - `Cmd+K` : search/switcher
    - `Cmd+N` : nouveau clone
    - Arrow keys + Enter : navigation entre cards

#### CTA principal
`+ Créer` en header. Search bar centre.

#### Principes appliqués
- *Match real world* (recency, client grouping)
- *Fitts* (cards en grille, pas en liste verticale)
- *Progressive disclosure* (filtres, groupes collapsables)
- *Visibility ∝ frequency* (création promu, partage caché)

#### Benchmarks
- **Linear** projects/issues list with Cmd+K + filters inline
- **Attio** multi-account switcher with recents
- **Arc spaces** grouped workspace view
- **Notion workspace** with favorites + recents columns

#### Impact attendu
- **Temps de switch clone** (agence 8 clients) : ~8 sec → **~2 sec** via Récents + Cmd+K
- **Capacité scalable** : 5 → **40+ clones** sans perte d'UX
- **Signal "besoin d'attention"** : passif → actionnable, +30% de clones "récupérés à temps" avant dérive client-visible

---

### Version B — **Zéro compromis** (hub devient dashboard agence)

**Principe directeur** : si le rail vertical clones vit dans `/chat` (Version B audit chat), le sélecteur migre là-bas. `/hub` perd sa fonction de switcher et devient un **dashboard portefeuille** — une vue **manager** pour le directeur d'agence, pas pour l'opérateur en plein flow.

#### Structure proposée (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◎ VoiceClone / portefeuille           semaine du 14-20 avril    [+ Client]│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ┌── Vue d'ensemble ──────────────────────────────────────────────────┐ │
│ │  8          18          234        1 847       12        4.20 €    │ │
│ │  clients    clones      conv 7j    posts 7j    dérives   budget 7j │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌── Alertes (4) ─────────────────────────────────────────────────────┐ │
│ │ ⚠ Cecil / Sophie · fid en chute 0.78 → 0.42 · 3 corrections urgent │ │
│ │ ⚠ Atomi / Lucile · ghost 4 jours sur 2 relances                    │ │
│ │ ⚠ Bolt / Marc · budget client 80% épuisé                            │ │
│ │ ⚠ Inactif · Stellar / Anne · 21 jours sans activité                 │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌── Clients ──────────────────── [⌕ filter] ───────────────────────┐  │
│ │ Client         Clones  Activité 7j  Fidélité  Dérives  Budget    │  │
│ │ ──────────────────────────────────────────────────────────────── │  │
│ │ ▸ Atomi         1       42 msgs      0.81      0        3.10€    │  │
│ │ ▸ Bolt          2       67 msgs      0.72      1        9.80€    │  │
│ │ ▸ Cecil         1        8 msgs      0.42 ⚠    3        0.40€    │  │
│ │ ▸ Stellar       1        0 msgs      0.69      0        0.00€    │  │
│ │ ▸ Agence        1       45 msgs      0.77      0        2.40€    │  │
│ │ ...                                                              │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│ ┌── Activity timeline (7j) ──────────────────────────────────────────┐ │
│ │ ▂▂▃▅▇▇▅▃▂  posts générés                                           │ │
│ │ ▁▂▂▃▃▄▄▅▄  DMs envoyés                                             │ │
│ │ ▂▁▁▁▁▂▁▁▂  corrections                                              │ │
│ │ ▁▁▁▂▁▃▁▁▁  dérives                                                  │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Admin · Paramètres agence · Guide                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Détails

- **Portefeuille**, pas "Mes clones" : vocabulaire orienté gestion, pas consommation
- **Vue d'ensemble** : 6 métriques clés en bandeau, filtrables sur 24h / 7j / 30j
- **Alertes actionnables** : les 4-8 problèmes qui méritent attention **maintenant**, chaque ligne cliquable → navigue direct au clone concerné avec contexte
- **Table clients** : sortable, filterable. Cliquer un client = expand ses clones inline (≥ 1 clone par client) avec leurs stats individuelles
- **Activity timeline** : sparklines 7j pour les 4 métriques d'agence
- **Footer** : accès admin + paramètres + guide

Ce hub répond à **"comment va mon business ?"** et **"qu'est-ce qui nécessite mon intervention ?"** — pas **"lequel je vais utiliser maintenant ?"** (ça, c'est dans le rail `/chat`).

#### Composants supprimés
- `.clone-card` façon gallerie — remplacée par table
- StyleFingerprint sur hub — il reste dans le rail et le cockpit uniquement
- Bouton "Partager" sur chaque card — déplacé en action contextuelle

#### Composants ajoutés
- `DashboardHeader.svelte` — bandeau métriques
- `AlertsFeed.svelte` — alertes priorisées
- `ClientTable.svelte` — table clients sortable
- `ActivityTimeline.svelte` — sparklines

#### Principes appliqués
- *Information density* (grille tabulaire vs gallerie)
- *Actionable alerts* (rouge = click pour fixer)
- *Separation of concerns* (switch = rail chat, portefeuille = hub)

#### Benchmarks
- **Stripe dashboard** (vue agrégée + alerts + table filtrable)
- **Posthog project overview** (sparklines + metrics + table)
- **Linear project roadmap** (table dense, filter, sort)
- **Vercel project list** (grid de statuts + alerts top)

#### Impact attendu
- **Temps pour un directeur de dire "mon business va bien"** : 15 min (aujourd'hui) → **2 min**
- **Clones "récupérés à temps" avant dérive critique** : +50% grâce aux alertes priorisées
- **Délimitation UX claire** : opérateur vit dans `/chat`, directeur vit dans `/hub` (portefeuille)

#### Risque identifié
Si le rail `/chat` n'est **pas** livré (Version B audit chat non retenue), la Version B audit hub crée un trou UX : où est-ce qu'on sélectionne un clone ? Il faut les livrer ensemble ou retomber sur Version A.

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Search bar + Cmd+K switcher** | 9 | 3 | 🔥 P0 | Dev front | A |
| 2 | **Section "Récents"** (3-5 derniers) | 8 | 2 | 🔥 P0 | Dev front + BE | A |
| 3 | **Filtres inline (Posts/DMs/Attention)** | 7 | 3 | P1 | Dev front | A |
| 4 | **Width étendue + grille responsive 2-4 col** | 7 | 3 | P1 | Dev front | A |
| 5 | **Groupement par client** | 8 | 5 | P1 | Dev full-stack (dep. audit create #5) | A |
| 6 | **Badge fidélité actionnable (overlay diagnostic)** | 6 | 5 | P2 | Dev full-stack | A |
| 7 | **Menu `⋯` (migre Partager + Renommer + etc.)** | 5 | 3 | P2 | Dev front | A |
| 8 | **"+ Créer" promu en header** | 7 | 1 | 🔥 P0 | Dev front | A |
| 9 | **Empty state onboarding riche** | 6 | 3 | P2 | Dev front | A |
| 10 | **Dashboard portefeuille complet (Version B)** | 9 | 9 | P2-radical | Dev full-stack + design | B |
| 11 | **AlertsFeed priorisé** | 8 | 5 | P1-long | Dev full-stack | B |

### Quick wins flaggés
- 🔥 **#1 + #2 + #8** : search + recents + create promu. **Livrés ensemble = 1 semaine de dev**, sortent le hub de la friction pour 80% du quotidien opérateur.
- Le #5 (groupement par client) dépend du champ `client/tag` proposé dans l'audit `/create` #5 — **dépendance cross-écran à noter**.

---

## 6. NOTE TRANSVERSE — Arbitrage produit à faire

Le hub est le premier écran où Version A et Version B **divergent fondamentalement**. Version A : hub reste un sélecteur, on le rend scalable. Version B : hub devient un dashboard portefeuille, le sélecteur migre dans le rail `/chat`.

Pour trancher, une question produit : **qui est le user principal du hub dans 12 mois** ?
- Si c'est toujours l'**opérateur** (cas où le rail `/chat` n'est pas livré) → Version A
- Si l'opérateur vit dans `/chat` avec rail, et le hub devient l'espace du **directeur d'agence / lead** → Version B

Cette question n'est pas à trancher maintenant, mais à anticiper. Les changements Version A sont de toute façon utiles en attendant (quick wins indépendants) et ne bloquent pas Version B plus tard.

---

**Audit écran 3/8 terminé. Valide, conteste, ou demande à trancher l'arbitrage Version A/B avant `/calibrate`.**
