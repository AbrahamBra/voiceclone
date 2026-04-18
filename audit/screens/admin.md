# audit/screens/admin.md — `/admin`

**Écran** : dashboard admin multi-client, admin-only (isAdmin guard).
**Fichier** : `src/routes/admin/+page.svelte` (541 lignes). Read-only strict.

---

## 1. IDENTITÉ

### Job-to-be-done (1 phrase)
> **Pour le directeur d'agence : voir en 30 secondes l'état du portefeuille (clients actifs, budget, qualité des clones), identifier les problèmes qui méritent intervention, agir sur les clients problématiques.**

### Test des 3 secondes
**Moyen.** Un directeur voit :
- 6 stat-cards en grid (personas, clients, conversations, coût, corrections, entités)
- Une table clients avec budget
- Une grid de personas
- Un feed d'activité

Il sait **où il est** (admin dashboard). Il ne sait **pas par où commencer** — aucune priorisation, rien qui dit "regarde ça d'abord".

### Test de nécessité
Obligatoire pour un multi-tenant agence. Mais aujourd'hui il souffre du même syndrome que `/hub` : **surveillance passive**, pas d'alertes priorisées ni d'actions possibles.

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 6/10 | Sections titrées, compréhensible. Mais pas de "priorité d'action". |
| **Hiérarchie visuelle** | 6/10 | Ordre fixe : Overview → Clients → Personas → Activité. Aucune ne dit "commence ici". |
| **Charge cognitive** | 6/10 | OK pour 3-5 clients, dégrade au-delà de 15 (table non filtrable). |
| **Densité d'information** | 4/10 | **max-width: 720px** sur un dashboard — gaspillage énorme. Un vrai dashboard manager = 1400-1800px. |
| **Microcopy & CTAs** | 5/10 | "Rafraichir" seul bouton. Zéro verbe d'action métier. |
| **Cohérence globale** | 7/10 | Même langage visuel que `/hub`. Trop similaire — pas de registre "manager dense". |
| **Signal émotionnel** | 4/10 | Froid et passif. Un dashboard manager doit avoir un rythme (alertes qui clignotent, trends qui bougent). |
| **Accessibilité** | 6/10 | Table scrollable horizontal sur mobile, mais sans `aria-label` explicites sur budget bars. |
| **Actionabilité (propre à admin)** | **2/10** | **Read-only strict**. Aucun reset budget, aucun drill-down, aucun message à un user, aucun export. |
| **Discoverability des problèmes** | **2/10** | Il faut scanner visuellement pour voir qu'un clone a fid=0.42. Pas d'alertes en tête, pas de tri par priorité. |

**Moyenne : 5/10.** Un dashboard manager qui ne permet pas de manager.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Zéro action possible depuis admin
Aujourd'hui, ce qu'un directeur **ne peut pas faire** depuis `/admin` :
- Réinitialiser le budget d'un client dont le crédit est épuisé
- Suspendre un clone qui a dérivé
- Envoyer un message au propriétaire d'un clone
- Archiver un client en pause ou churné
- Exporter la liste clients pour facturation
- Forcer une recalibration
- Créer un nouveau code d'accès pour un client qui signe

Pour chaque action, il doit aller dans la base de données Supabase directement ou bidouiller. **Dashboard manager sans actions = dashboard décoratif.**

### 🔴 RF2 — Aucune alerte priorisée
Le directeur doit scanner 6 stat-cards + une table + une grid + un feed pour voir qu'un clone a dérivé ou qu'un budget est à 98%. Pour 20 clients : ~60 secondes de scanning avant de voir le problème critique.

Les vrais dashboards managers (Stripe, Posthog, Vercel) ont toujours une **section "Alertes" en tête**, avec priorité colorée, cliquable pour action. Ici : absente.

**Correctif** : bandeau `Alertes (N)` en tête du dashboard, listant en priorité décroissante :
- 🔴 Clones avec fidélité < 0.50 ET activité >5 conv/semaine
- 🟡 Budgets client > 80% (risque coupure service)
- 🟡 Clones inactifs 21+ jours avec nouvelles conv reçues
- 🟢 Corrections urgentes en attente sur clone actif

Chaque ligne → clic = ouvre la vue détaillée + actions contextuelles.

### 🔴 RF3 — Table clients non triable/filtrable, non drill-downable
`<table class="data-table">` statique. Pas de `sortable`, pas de filtre par tier, statut, période. Cliquer une ligne = rien.

Pour une agence à 20+ clients, c'est un wall of rows sans navigation.

**Correctif** :
- Columns sortables (click header pour trier asc/desc)
- Pills filter en haut : `Tous · Actifs · Trial · Churn · Budget critique · Agence interne`
- Click row → expand inline (stats détaillées du client) OU ouvre un drawer/page `/admin/client/[id]`

### 🔴 RF4 — Fidélité par persona enterrée
`<div class="admin-fidelity">Fidelite: {p.fidelity.score_global}</div>` — affichée en petit texte en bas de chaque persona card. Pas de couleur, pas de tri.

Un directeur qui veut "quels clones sont en danger" doit lire mentalement les 20 cards.

**Correctif** :
- Chaque persona card : badge fidélité couleur (vert ≥75 / jaune 50-74 / rouge <50) **en haut à droite**
- Ordre des cards : **par fidélité ASC** (les pires remontent) par défaut
- Filter toggle : `Tout · En danger · Sain`

### 🔴 RF5 — Pas de trends / time-series
Les 6 stat-cards affichent des snapshots :
- "Conversations 7j : 234"
- "Coût 24h : 3.10€"
- "Corrections : 87"

Aucun **comparatif** vs semaine précédente, aucune **sparkline** de tendance, aucun **benchmark**. Un directeur qui veut "est-ce que le business accélère ou ralentit" n'a aucun signal.

**Correctif** : chaque stat-card gagne :
- Un comparatif delta : `234 (+12% vs 7j préc)`
- Une mini-sparkline sur 30j en fond de la card
- Un click → ouvre une vue détaillée avec graph temps-série zoomable

### 🔴 RF6 — Activity feed brut, non exploitable
Le feed liste les N derniers events avec `title · persona · client · scenario · timestamp`. Pas de :
- Filtre par type d'event (correction, conv nouvelle, budget update, dérive détectée)
- Filtre par client / persona / scenario
- Search textuel
- Pagination (on voit les N premiers, et puis ?)

Pour debugger un incident ("qu'est-ce qui s'est passé sur Atomi hier entre 14h et 16h"), impossible.

**Correctif** : feed avec filtres + search + pagination infinite-scroll + click event = drill-down vers la conversation/persona concernée.

### 🔴 RF7 — Width 720px sur un dashboard manager
Même problème que `/hub` : dashboard sérieux ne tient pas dans 720px. La grid personas devient 2 cards max en largeur, la table clients scrollable horizontale.

Un dashboard manager mérite **1400-1800px avec grid multi-colonnes**.

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (garde la structure, ajoute priorisation + actions)

**Principe** : le dashboard reste sur la même route, même sections, mais chaque section gagne en actionnabilité et priorisation.

#### Structure proposée (ASCII)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Hub         Admin · portefeuille AhmetA       semaine 14-20 avril 2026│
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ⚠ ALERTES (4)                                                            │
│ 🔴 Cecil · Sophie · fid en chute 0.78 → 0.42 · 3 corrections urgentes   │
│    [ Ouvrir le clone → ] [ Recalibrer ] [ Message au propriétaire ]     │
│ 🟡 Bolt · budget 85% atteint · resto 4.20€ · dernière alerte il y a 2j  │
│    [ Réinitialiser budget ] [ Contacter ]                                │
│ 🟡 Stellar · 21j sans activité · 5 DM prospects reçus non répondus      │
│    [ Relancer l'opérateur ] [ Archiver ]                                 │
│ 🟢 Atomi · 4 corrections en attente sur Lucile (fid 0.81 OK)            │
│    [ Ouvrir le clone → ]                                                 │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ VUE D'ENSEMBLE                                                           │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────┐│
│ │ 8        │ │ 18       │ │ 234      │ │ 21.40€   │ │ 87       │ │ 14  ││
│ │ clients  │ │ clones   │ │ conv 7j  │ │ cost 7j  │ │ corrs    │ │ der.││
│ │ +1 (7j)  │ │ +2 (7j)  │ │ +12%     │ │ +3.8%    │ │ +5       │ │ -2  ││
│ │ ▂▃▃▅▇▇▅ │ │ ▁▂▂▂▃▅▇ │ │ ▂▃▅▇▇▅▃ │ │ ▁▂▃▃▄▄▅ │ │ ▂▂▃▃▄▅▄ │ │ ▂▁▁▂││
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────┘│
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ CLIENTS  [⌕] [Tous] [Actifs] [Trial] [Churn] [Budget crit.] [Agence]    │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Nom      ↕│Dern. actif│Conv 7j│Tokens 7j│Budget      │Tier │Actions││ │
│ │ ──────────┼───────────┼───────┼─────────┼────────────┼─────┼───────│ │
│ │ Cecil    ⚠│il y a 3h  │  8   │ 2.1k    │▓▓▓▓▓▓▓▓░ 95%│Pro  │ ⋯    ││ │
│ │ Bolt     🟡│il y a 5h  │ 67   │12.4k    │▓▓▓▓▓▓▓░░ 85%│Scale│ ⋯    ││ │
│ │ Atomi    ✓│il y a 12m │ 42   │ 7.8k    │▓▓▓▓░░░░░ 42%│Scale│ ⋯    ││ │
│ │ Stellar  ·│21j        │  0   │    0    │░░░░░░░░░  5%│Trial│ ⋯    ││ │
│ │ ...                                                                │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ [⬇ Exporter CSV]                                                         │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ PERSONAS (triés par fidélité ASC)        [ Tout ] [ En danger ] [ Sain ] │
│ ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐       │
│ │ Sophie  fid 0.42 🔴│ │ Paul   fid 0.69 🟡│ │ Marc    fid 0.74 🟢│      │
│ │ Cecil · DM · 8cnv │ │ Bolt · POST · 22cv│ │ Bolt · DM · 45cnv│       │
│ │ 3 corr. urgentes  │ │ 1 correction pend │ │ 0 corr. pend     │       │
│ │ [ Diagnostiquer ⋯ ]│ │ [ Ouvrir ⋯ ]     │ │ [ Ouvrir ⋯ ]     │       │
│ └───────────────────┘ └───────────────────┘ └───────────────────┘       │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ACTIVITÉ  [⌕ search] [Event ▼] [Client ▼] [Période: 7j ▼]               │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ ◉ Correction  · Atomi/Lucile   · "trop d'emojis" · il y a 5 min  │   │
│ │ ◉ Nouvelle conv · Bolt/Marc    · DM-1st scenario  · il y a 12 min │   │
│ │ 🔴 Dérive détectée · Cecil/Sophie · fid 0.42     · il y a 1 h     │   │
│ │ ◉ Post généré  · Atomi/Lucile  · 1340 chars      · il y a 1 h     │   │
│ │ ... [infinite scroll]                                              │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│ [⬇ Exporter activité CSV]                                                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Changements précis

1. **Bandeau "Alertes" en tête de page**
   - Top 4-8 items à priorité décroissante
   - Chaque item : icône couleur + contexte + 1-3 actions inline
   - Alertes types : fid en chute, budget > 80%, inactivité + conv non répondues, corrections urgentes accumulées
   - Logic backend à coder : endpoint `/api/admin/alerts` agrégeant ces signaux

2. **Stat-cards enrichies**
   - Delta vs période précédente (`+12% vs 7j préc`)
   - Mini-sparkline sur 30 jours en fond ou dessous
   - Click = ouvre une vue time-series zoomable (par ex en modal/sheet)

3. **Table clients actionnable**
   - Colonnes sortables (header click)
   - Pills filter : `Tous / Actifs / Trial / Churn / Budget crit / Agence interne`
   - Search inline
   - Colonne `Actions` avec menu `⋯` : `Drill-down`, `Réinitialiser budget`, `Message propriétaire`, `Archiver`, `Exporter stats client`
   - Row click = expand inline avec stats détaillées (ou drawer)
   - Bouton `⬇ Exporter CSV` en bas

4. **Personas grid priorisée**
   - Tri par défaut : **fidélité ASC** (les pires remontent)
   - Badge fidélité coloré top-right visible d'un coup d'œil
   - Filter toggle : `Tout / En danger / Sain`
   - Corrections urgentes count en rouge si > 3
   - Action `Diagnostiquer` ouvre IntelligencePanel dédié au clone

5. **Activity feed avec filtres + search**
   - Filter par type d'event (correction / nouvelle conv / dérive / génération / budget)
   - Filter par client + par période (24h / 7j / 30j)
   - Search textuel (match dans content/metadata)
   - Infinite scroll ou pagination
   - Events rouges (dérive) visuellement distincts
   - Click event → navigate vers la conversation/persona concerné

6. **Width étendue à 1400-1600px** avec grid responsive (mobile reste OK car table horizontal-scrollable)

7. **Breadcrumb + période contextuelle** en header : `← Hub · Admin · portefeuille · semaine 14-20 avril`
   - Période switchable : `24h · 7j · 30j · 90j`
   - Tous les compteurs se recalculent en fonction

8. **Bouton `+ Inviter un client`** en header (génère un code d'accès pour un nouveau client qui signe)

9. **Export mensuel** : bouton en bas de page `📄 Rapport mensuel PDF` qui génère un PDF par client (à donner à l'agence pour sa facturation ou aux clients pour preuve d'usage)

10. **Keyboard shortcuts** :
    - `Cmd+K` : search universelle admin (client, persona, event)
    - `1-6` : focus sur une stat-card (montre le détail)
    - `G` + `A/C/P/F` : goto alerts/clients/personas/feed

#### CTA principal
Le bouton par alerte (`Ouvrir le clone →`, `Réinitialiser budget`, etc.) est le vrai CTA. `Rafraichir` devient secondaire (ou auto-refresh).

#### Principes appliqués
- *Priorization first* (alertes en tête)
- *Drill-down from summary to detail* (stat-card → trend, row → client detail, event → conv)
- *Direct manipulation* (actions contextuelles, pas de manipulation DB)
- *Signal discoverability* (fidélité promue, couleurs, tri ASC)

#### Benchmarks
- **Stripe dashboard** (stat-cards avec deltas + sparklines, table sortable, activity feed filterable)
- **Posthog project insights** (alerts banner top, time-series, dashboards)
- **Vercel project list** (status colored + actions per project)
- **Linear admin settings** (actions contextuelles par team)

#### Impact attendu
- **Temps pour détecter un incident** : ~60s (scan visuel) → **~5s** (alerte en tête)
- **Taux d'action sur alertes détectées** : 30% (read-only rend l'action coûteuse) → **80%** (action in-dashboard)
- **Churn early-detection** : +40% (alerts sur inactivité + conv non répondues)
- **Temps de facturation mensuelle** : -60% (export CSV/PDF automatisé)

---

### Version B — **Zéro compromis** (cockpit manager 3-colonnes + actions profondes)

**Principe directeur** : un vrai cockpit manager est **asymétrique**, avec des zones dédiées à des usages distincts. Ici : alertes/incidents à gauche en permanence, métriques + table au centre, activity timeline à droite, et drill-down sur page dédiée.

#### Structure proposée (ASCII)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◎ AhmetA / cockpit                period: 7j ▾   search [⌕]       [👤]  │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ ┌──────────────┬──────────────────────────────────────┬──────────────────┐│
│ │ INCIDENTS    │  VUE D'ENSEMBLE (6 cards + sparks)   │  TIMELINE LIVE   ││
│ │ ────────     │                                      │                  ││
│ │ 🔴 Cecil     │  [8 clients] [18 clones] [234 conv]  │ il y a 2 min     ││
│ │ drift 0.42   │  [21.40€]    [87 corr]   [14 dérive] │ ◉ Bolt/Marc      ││
│ │ 3 corrs pend │                                      │   correction      ││
│ │ → open       │  CLIENTS       [filter] [⬇ export]  │                  ││
│ │              │  ──────                              │ il y a 5 min     ││
│ │ 🟡 Bolt      │  Cecil      ⚠  8 conv  95% budget   │ ◉ Atomi/Lucile   ││
│ │ budget 85%   │  Bolt       🟡 67 conv 85% budget   │   post généré    ││
│ │ → reset      │  Atomi      ✓  42 conv 42% budget   │                  ││
│ │              │  Stellar    ·  0 conv  5% budget    │ il y a 1 h       ││
│ │ 🟡 Stellar   │  ...                                 │ 🔴 Cecil/Sophie  ││
│ │ 21j inactif  │                                      │   DRIFT detected ││
│ │ → relancer   │  PERSONAS (fid ASC)                  │                  ││
│ │              │  Sophie  🔴 Paul  🟡 Marc  🟢 Lucile │ ...              ││
│ │ 🟢 Atomi     │  0.42    0.69    0.74    0.81       │                  ││
│ │ 4 corrs OK   │  ⋯       ⋯     ⋯      ⋯         │ [filter ▼]       ││
│ │ → open       │                                      │                  ││
│ │              │                                      │                  ││
│ │ [ Tout voir ]│                                      │                  ││
│ └──────────────┴──────────────────────────────────────┴──────────────────┘│
│                                                                            │
│ [ + Inviter un client ]  [ 📄 Rapport mensuel ]  [ ⚙ Paramètres agence ]  │
└────────────────────────────────────────────────────────────────────────────┘

         ↓ click sur un client / persona ouvre une PAGE DÉDIÉE :

         /admin/client/[id]
         ┌──────────────────────────────────────────────────────────┐
         │ ← Cockpit   Atomi                                        │
         │                                                          │
         │ Stats agrégées 30j · sparkline · budget · cycle factur.  │
         │                                                          │
         │ Clones (1)   Personnes qui corrigent (2)   Livraisons    │
         │                                                          │
         │ Timeline complète · filtres                              │
         │                                                          │
         │ Actions : Message client · Facturer · Suspendre clones   │
         └──────────────────────────────────────────────────────────┘
```

#### Détails

- **3 colonnes** sur desktop large :
  - **Gauche** (280px) : feed incidents priorisés, sticky, toujours visible même en scrollant
  - **Centre** (flex) : stats + cards + tables + personas
  - **Droite** (280px) : activity timeline live, auto-refresh toutes les 30s, filterable
- **Drill-down profond** :
  - Click client dans table/alerte → `/admin/client/[id]` (page dédiée)
  - Click persona → `/admin/persona/[id]`
  - Click event → `/admin/event/[id]` ou drawer
- **Actions profondes** disponibles sur chaque entité :
  - Client : message, suspend, reset budget, upgrade tier, facturer, archiver
  - Persona : recalibrer, suspendre, archiver, diagnostiquer (ouvre IntelligencePanel)
  - Event : annoter, escalader à l'équipe
- **Modes de vue sauvegardés** :
  - "Incidents focus" (3 colonnes, feed en avant)
  - "Facturation mensuelle" (export-friendly, tables uniquement)
  - "Growth tracking" (sparklines + trends mises en avant)
  - Le directeur switch selon son besoin du moment

#### Composants supprimés
- L'ancienne structure linéaire 4-sections

#### Composants ajoutés
- `AdminLayoutThreeCol.svelte`
- `IncidentsFeed.svelte`
- `TimelineLive.svelte` (avec SSE / polling auto)
- `ClientDetailPage.svelte` (sur `/admin/client/[id]`)
- `PersonaDetailPage.svelte` (sur `/admin/persona/[id]`)
- `MonthlyReportPDF.svelte` (génération rapport)

#### Principes appliqués
- *Asymmetric information density* (3 colonnes avec poids distincts)
- *Always-visible signals* (incidents sticky gauche)
- *Deep navigation* (page dédiée par client/persona)
- *Saved views* (flexibilité selon rôle)

#### Benchmarks
- **Stripe dashboard** (3 colonnes, event timeline à droite)
- **Linear project view** (incident feed gauche, main center, activity right)
- **Posthog insights** (layout dense avec colonnes dédiées)
- **Vercel observability** (logs stream sticky)

#### Impact attendu
- **Temps de détection incident** : ~5s (Version A) → **~1s** (Version B, feed toujours visible)
- **Temps de résolution d'incident** : -60% (actions contextuelles profondes)
- **Capacité à gérer >20 clients** : Version A scale jusqu'à ~30, Version B scale à 100+
- **Facturation mensuelle automatisée** : temps par client 20 min → 2 min (PDF pre-rempli)

#### Risque identifié
Complexité UX élevée pour un user peu technique. Solution : onboarding progressif avec "mode simple" (Version A layout) vs "mode avancé" (Version B 3-col).

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Bandeau alertes priorisées en tête** | 9 | 5 | 🔥 P0 | Dev full-stack (API alerts) | A + B |
| 2 | **Stat-cards avec delta + sparkline** | 7 | 4 | P1 | Dev full-stack | A + B |
| 3 | **Table clients sortable + filtrable + actions** | 9 | 6 | P1 | Dev full-stack | A + B |
| 4 | **Personas triées par fidélité ASC + badge couleur** | 7 | 2 | 🔥 P0 | Dev front | A + B |
| 5 | **Activity feed filtrable + searchable** | 7 | 5 | P1 | Dev full-stack | A + B |
| 6 | **Actions (reset budget, suspend, message, archive)** | 9 | 7 | P1-long | Dev full-stack | A + B |
| 7 | **Width étendue + responsive** | 6 | 2 | P1 | Dev front | A + B |
| 8 | **Période contextuelle (7j/30j/90j switch)** | 6 | 3 | P2 | Dev full-stack | A |
| 9 | **Export CSV clients + activité** | 7 | 3 | P1 | Dev BE | A + B |
| 10 | **Export PDF rapport mensuel par client** | 8 | 7 | P2 | Dev full-stack | A + B |
| 11 | **Bouton `+ Inviter un client`** | 7 | 4 | P1 | Dev full-stack | A + B |
| 12 | **Pages dédiées `/admin/client/[id]` + `/admin/persona/[id]`** | 8 | 8 | P2-long | Dev full-stack | B |
| 13 | **Layout 3 colonnes avec incidents sticky + timeline right** | 8 | 8 | P2-radical | Design + dev | B |
| 14 | **Saved views (Incidents / Facturation / Growth)** | 6 | 5 | P3 | Dev full-stack | B |

### Quick wins flaggés
- 🔥 **#1 + #4** : alertes en tête + personas triées par fidélité ASC. **3-4 jours de dev**. Transforme le dashboard de passif à actif.
- 🔥 **#9 Export CSV** : 1 journée, énorme gain pour la facturation mensuelle agence.

---

## 6. NOTE TRANSVERSE — Cohérence avec `/hub` Version B

L'audit `/hub` Version B proposait de transformer le hub en dashboard portefeuille (alerts feed + table clients + sparklines). La Version A/B de `/admin` ici fait **quasi la même chose**.

**Question à trancher** : si on va vers `/hub` Version B (portefeuille manager) + `/admin` refondu, on a **deux dashboards qui se chevauchent**. Un seul suffirait.

Deux options :
- **Merge** : fusionner `/hub` et `/admin` en une seule route `/dashboard` (admin-only), et le hub des opérateurs devient le rail `/chat` (cohérent avec audit `/chat` Version B)
- **Séparation stricte** : `/hub` reste pour **tous les users** (opérateurs et admins) avec features limitées pour opérateurs ; `/admin` garde le monopole des actions manager (facturation, reset budget, etc.)

La merge est plus cohérente si le rail `/chat` est livré. Sinon, séparation stricte.

---

**Audit écran 7/8 terminé. Valide, conteste, ou passe à `/share` (dernier).**
