# audit/screens/landing.md — `/`

**Écran** : landing publique. Démo scriptée du pipeline + porte d'auth.
**Fichiers** : `src/routes/+page.svelte` (900 L) + `src/lib/landing-demo.js` (3 scenarios hardcoded).

---

## 1. IDENTITÉ

### Job-to-be-done (selon la mission réelle)
> **Convaincre un prospect agence (client potentiel de l'agence AhmetA) que cet outil est rigoureux — pas un ChatGPT déguisé — et pousser vers une action commerciale : book demo, contact, ou code d'accès.**

### JTBD actuel (ce que l'écran fait en pratique)
> **Afficher une démo technique impressionnante pendant 30s en boucle + recevoir un code d'accès utilisateur.**

### Gap entre les deux
**Énorme.** La landing actuelle est un **portfolio technique** (démo + code d'auth). Elle est parfaite pour recruter un dev ou impressionner un investor technique. Pour un prospect d'agence qui cherche à externaliser son ghostwriting LinkedIn avec rigueur, elle ne remplit aucune case de conversion.

### Test des 3 secondes
**Non.** Un prospect voit :
- Une animation de pipeline qui génère du texte avec des chiffres qui bougent
- Des mots techniques qu'il ne connaît pas (`collapse_idx`, `TTR`, `kurtosis`, `q_ratio`)
- Un accent italique vermillon "observable en direct"
- Pas de "ce que c'est, pour qui, combien ça coûte"

Il sait **que c'est sérieux**. Il ne sait **pas ce qu'il achète**.

### Test de nécessité
Absolument oui. Mais elle doit changer de rôle : de **portfolio technique** à **asset commercial orienté prospect agence**.

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note (usage actuel = portfolio) | Note (usage voulu = commercial) | Justification |
|---|---|---|---|
| **Clarté d'intention** | 6/10 | 3/10 | On comprend le produit, pas l'offre, pas le public cible. |
| **Hiérarchie visuelle** | 8/10 | 7/10 | Design labo maîtrisé, focus sur les panels. Mais aucune hiérarchie orientée conversion. |
| **Charge cognitive** | 4/10 pour non-tech | 3/10 | TTR, kurtosis, q_ratio = opaque pour un prospect agence. |
| **Densité d'information** | 7/10 | 4/10 | Tout tient dans une page, MAIS zéro info commerciale utile. |
| **Microcopy & CTAs** | 5/10 | 2/10 | "laboratoire" attractif, "chatbot de plus" dévalue la concurrence sans vendre. "code" caché. Zéro CTA commercial. |
| **Cohérence globale** | 9/10 | 9/10 | Design impeccable. |
| **Signal émotionnel** | 6/10 | 5/10 | "Sérieux et cool" mais froid. Zéro invitation, zéro aspiration. |
| **Accessibilité** | 7/10 | 7/10 | Skip-link présent, aria OK, contrastes corrects. |
| **Conversion (présence funnel commercial)** | — | **1/10** | Aucun CTA commercial, aucun tracking conversion, aucun social proof. |

**Moyenne usage actuel (portfolio) : 6.5/10.**
**Moyenne usage voulu (commercial) : 3.5/10.** Échec produit.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Aucun CTA commercial
Le footer propose `[code] [→]` (auth d'utilisateur) + lien "guide". **Aucun bouton** pour :
- "Voir un cas client"
- "Réserver une démo"
- "Contactez-nous"
- "Testez 7 jours gratuits"
- "Tarifs"

Pour un prospect d'agence qui arrive ici via un lien LinkedIn, un outbound ou un post de blog : **il n'a nulle part où cliquer** sinon rebondir ou scroller en bas chercher le code d'auth (qu'il n'a pas).

**Résultat** : taux de rebond ~100% pour tout prospect non-équipé d'un code.

**Correctif** : hero secondaire sous la démo (ou au-dessus) avec 2 CTA :
- Primary : `📅 Réserver 20 min de démo`
- Secondary : `▶ Voir un cas client`

### 🔴 RF2 — 3 scenarios hardcoded sur des situations GÉNÉRIQUES
`landing-demo.js` propose 3 cas :
1. CTO fintech série B — relance froide (passe propre)
2. Prospect e-commerce — relance 7j (rewrite)
3. Appel découverte — CR 3 bullets (drift)

**Problèmes** :
- Aucun est ancré dans les **vrais clients de l'agence** (memory #1 : "refuse métriques génériques, exige scénarios réels"). Les fixtures backend `test/fixtures/heat-conversations/` ont **10 conversations réelles** (cecilia-bluecoders, edwige-maveilleia, olga-maveilleia, daniel-immostates, hassan-immostates…). Le frontend ne les utilise pas.
- Les contextes sont neutres ("CTO fintech série B") au lieu d'être **évocateurs pour un prospect** ("CEO B2B SaaS qui fait un 10€k MRR mais ses posts LinkedIn ne ramènent pas de pipe").
- Un seul cas suffirait s'il était puissant. Trois cas moyens = 30s de brouillon.

**Correctif** : réécrire les 3 scenarios en s'appuyant sur des **vraies conversations anonymisées** des fixtures backend (ou de clients réels de l'agence avec autorisation). Choisir 3 cas qui racontent une **progression** :
- CAS 1 : un 1er message DM qui passe propre (démontre le contrôle)
- CAS 2 : un cas de rewrite qui sauve d'une dérive IA-générique (démontre la boucle)
- CAS 3 : un cas de ghost + relance (démontre que le clone détecte et s'adapte)

Et le reformuler avec un **vocabulaire métier**, pas juridique-tech.

### 🔴 RF3 — Zéro social proof
- Pas de logos de clients ("ils l'utilisent")
- Pas de métriques d'impact de l'agence ("120 posts générés/mois, 87% fidélité moyenne, X clients signés")
- Pas de testimonial ("depuis que j'utilise VoiceClone via AhmetA, mes posts font 3× plus de portée")
- Pas de case study ("cliquez pour lire comment Client X a généré Y leads")

**Pour une agence qui vend un service**, c'est le carburant principal du funnel. Absent.

### 🔴 RF4 — Pas de pricing / offre visible
Un prospect qui veut savoir "c'est combien" doit deviner. L'app a pourtant des tiers (`tier` client dans `admin`, `budget_cents` par client). Rien de tout ça n'est exposé en vitrine.

Même si le prix est sur devis, il faut au minimum une **grille tarifaire indicative** ou "à partir de X €/mois" pour filtrer les curieux des prospects qualifiés.

**Correctif** : section "Offres" avec 3 packs (Starter / Growth / Scale) + pricing indicatif + "sur devis pour volume".

### 🔴 RF5 — Métriques techniques affichées à un public non-technique
Pour le prospect agence, voir `collapse_idx · ttr · kurtosis · q_ratio` en live = 4 mots qu'il ne connaît pas = friction cognitive + sentiment "ce n'est pas pour moi".

Pour la démo commerciale, ces métriques sont **secondaires**. Ce qui compte : **"tu vois ? le clone rattrape un message IA-générique en live"** — pas les chiffres.

**Correctif** :
- Défaut : masquer les 4 métriques numériques, afficher seulement fidélité + barre de progression colorée (vert/jaune/rouge)
- Toggle "mode tech" en bas pour afficher le détail (curieux dev)
- Principe : *progressive disclosure*

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (garder la démo labo, ajouter un étage commercial)

**Principe** : la démo labo est un asset précieux — visuellement différenciateur, raconte le pipeline. On ne la jette pas. On **encadre** avec un funnel commercial en amont et en aval.

#### Structure proposée (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◎ VoiceClone / atelier d'AhmetA            [ Tarifs ] [ Démo ] [ Login ]│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ HERO COMMERCIAL (above the fold)                                        │
│ Votre voix LinkedIn, préservée. Sans dérive IA.                         │
│ Agence de ghostwriting + setting, propulsée par un clone stylistique   │
│ entraîné sur vos vrais posts et DMs. On produit, vous validez.          │
│                                                                         │
│   [ 📅 Réserver 20 min ]   [ ▶ Voir un cas client ]                     │
│                                                                         │
│ ───────── ils nous font confiance ─────────                             │
│  [logo] [logo] [logo] [logo] [logo]                                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ PIPELINE OBSERVABLE (la démo actuelle, ré-ancrée sur vrais cas)         │
│ ── Comment on préserve votre voix : le pipeline en direct               │
│                                                                         │
│ [animation 3 cas · Cecilia · Edwige · Daniel · cycle 30s]               │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ NOTRE PROCESS EN 4 ÉTAPES                                               │
│ 01  On clone votre voix (posts + DMs + docs métier) · 5 jours           │
│ 02  On calibre ensemble sur 15 corrections · 1 semaine                  │
│ 03  On produit votre contenu chaque semaine · en continu                │
│ 04  Vous validez, on livre sur LinkedIn · 48h de cycle                  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ MÉTRIQUES AGENCE                                                        │
│ 23 clients  ·  1.8k posts/mois  ·  0.83 fidélité moyenne  ·  92% resigne│
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ OFFRES (3 cards)                                                        │
│ Starter 1.5k€/m · Growth 3k€/m · Scale 6k€/m · Custom (sur devis)      │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ CAS CLIENT (1 testimonial + story · option vidéo)                       │
│ « Thomas, CEO Atomi · 40k impressions/post vs 2k avant »                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ FAQ                                                                     │
│ ▸ Est-ce que je garde la propriété de mes clones ?                      │
│ ▸ Combien de temps pour voir un 1er post ?                              │
│ ▸ Vous fournissez aussi les DMs ?                                       │
│ ▸ Confidentialité des données ?                                         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ FOOTER                                                                  │
│ ◎ AhmetA · l'agence · Paris · contact@… · [code d'accès client]        │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Changements précis

1. **Header commercial** — navbar avec `Tarifs · Démo · Login (code)`. Login devient une page dédiée `/login` minimaliste pour les clients existants qui ont un code.

2. **Hero commercial above-the-fold** :
   - Headline orienté bénéfice agence : "Votre voix LinkedIn, préservée. Sans dérive IA."
   - Sub : "Agence de ghostwriting + setting, propulsée par un clone stylistique. On produit, vous validez."
   - 2 CTAs : `📅 Réserver 20 min` (primary vermillon) + `▶ Voir un cas client` (secondary ghost)
   - Bandeau logos clients

3. **Démo pipeline** gardée en section 2 — ré-ancrée sur 3 cas réels anonymisés (idéalement tirés des `test/fixtures/heat-conversations/*.json`) :
   - **Cecilia / Thomas** (Bluecoders) : prospect propose le call — pipeline passe propre
   - **Edwige / Adrien** (Maveilleia) : prospect demande visio dès msg 2 — pipeline détecte rewrite
   - **Daniel / Thierry** (Immostates) : ghost 87j, revival, RDV — pipeline détecte dérive + réadapte
   - Sous-titres humains, pas "CAS 01 / PASSE PROPRE" mais "Thomas, CEO B2B SaaS — relance après levée de fonds"

4. **Simplifier la démo pour un prospect non-tech** :
   - Cacher par défaut TTR / kurtosis / q_ratio (ces métriques restent dans le cockpit interne)
   - Afficher uniquement : fidélité + barre de progression colorée + nombre de règles déclenchées
   - Toggle `[mode tech ⋯]` en bas droit de la démo pour afficher le détail (curieux dev)

5. **Section process en 4 étapes** — le funnel que l'agence propose, visible, clair, temps estimé

6. **Métriques agence** — social proof numérique (X clients, Y posts/mois, Z fidélité moyenne)

7. **Offres tarifées** — 3 cards, pricing affiché, bouton "Choisir ce pack"

8. **Cas client** — 1-2 témoignages avec photo, chiffres, lien vers une étude de cas détaillée (ou vidéo courte)

9. **FAQ** — 5-8 questions couvrant les objections classiques

10. **Footer élargi** :
    - Contact agence (email, LinkedIn AhmetA)
    - Link `/guide` (tech deep-dive, toujours utile)
    - Code d'accès client (section discrète "déjà client ?")
    - Mentions légales, privacy

#### CTA principal
`📅 Réserver 20 min` — primary vermillon en hero + repeat en cas client + repeat en footer.

#### Principes appliqués
- *Goal-directed design* (landing = conversion, pas portfolio)
- *Social proof* (logos + métriques + testimonials)
- *Progressive disclosure* (mode tech pour les curieux)
- *Anchoring on real cases* (vraies conversations en démo)

#### Benchmarks
- **Stripe landing** (hero bénéfice + social proof + product demo + case studies + pricing + FAQ)
- **Linear landing** (headline fort + animation + social proof + CTA)
- **Attio landing** (use-case-driven, pas feature-listing)
- **Superhuman landing** (métriques impact + testimonial vidéo)

#### Impact attendu
- **Taux de conversion prospect → démo bookée** : de ~0% (actuel) à **2-5%** (standard SaaS)
- **Clarté offre** : "c'est quoi / pour qui / combien" répondu en < 10s
- **Signal de crédibilité agence** : logos + métriques + cas clients = argument vente démultiplié

---

### Version B — **Zéro compromis** (séparer les surfaces)

**Principe directeur** : vouloir qu'une seule page serve 3 publics (prospect agence / utilisateur existant / curieux dev) = on les rate tous. On **sépare** les surfaces.

#### Trois pages distinctes

**1. `/` = landing commerciale pure** (structure Version A hero + process + pricing + cas + FAQ, MAIS sans la démo pipeline dans la landing).

**2. `/lab` = la démo labo actuelle**, en asset différenciateur pour les curieux tech ou pour les prospects qui veulent "voir comment ça marche sous le capot".
- Linké depuis la landing via un lien contextuel ("▶ voir le pipeline en action")
- Garde la démo scriptée actuelle, enrichie avec les **vraies conversations** (fixtures)
- Ajoute un bouton "comment on lit ces métriques" qui ouvre un mini-glossaire
- Plus riche : 6-8 cas au lieu de 3, navigation manuelle possible (← → pour switcher de cas)

**3. `/login` = page auth minimaliste pour clients existants**
- Juste un input code + bouton → redirect `/hub`
- Pas de démo, pas de distractions
- Lien retour landing + lien "j'ai oublié mon code, contactez l'agence"

#### Rationale

- **Landing commerciale** a un job unique : convertir un prospect froid en démo bookée. Tout ce qui ne sert pas cette mission est supprimé.
- **`/lab`** a un job unique : impressionner un prospect **qualifié** qui veut la preuve technique. La démo actuelle n'est plus un obstacle de la landing, elle devient un asset approfondi.
- **`/login`** a un job unique : récupérer un user existant. Pas de pollution.

#### Composants supprimés (sur `/`)
- La démo pipeline dans la landing — déplacée dans `/lab`
- Le code d'accès dans le footer — déplacé dans `/login`

#### Composants ajoutés
- `LandingHero.svelte`, `ProcessSteps.svelte`, `MetricsBar.svelte`, `OffersGrid.svelte`, `ClientCase.svelte`, `FAQ.svelte`, `LandingFooter.svelte`
- Page `/lab/+page.svelte` — la démo actuelle étoffée
- Page `/login/+page.svelte` — minimaliste
- Route `layout.svelte` : redirect `/` → `/hub` disparaît (seul `/login` doit le faire)

#### Principes appliqués
- *Separation of concerns* — une page, un job
- *Don't make me think* — le prospect ne devrait jamais se demander "qu'est-ce qu'on attend de moi ici"
- *Accessible entry points* — login et lab ont leurs URLs dédiées

#### Benchmarks
- **Posthog** (`/` commercial + `/product` deep-dive + `/app` app)
- **Linear** (`/` commercial + `/linear-method` method deep-dive + app séparée)
- **Arc** (`/` commercial + `/max` pour l'AI feature deep-dive)

#### Impact attendu
- **Taux de conversion landing → démo** : **3-7%** (vs 0% actuel)
- **Qualité des prospects qui arrivent en démo** : meilleure (ils ont vu le `/lab` volontairement = déjà éduqués)
- **Taux de rebond `/login`** : réduit (plus de friction "j'ai pas de code mais je veux juste tester")

#### Risque identifié
Passer de 1 à 3 pages marketing = plus de content à maintenir. Solution : le lab est quasi déjà construit (90% du travail est fait via la landing actuelle), le login est trivial, et la landing commerciale doit juste être écrite une fois.

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Ajouter 2 CTA commerciaux** (Démo + Cas client) dans un hero au-dessus de la démo | 9 | 2 | 🔥 P0 | Dev front + copy | A |
| 2 | **Remplacer les 3 scenarios par 3 vrais cas anonymisés** (fixtures heat-conversations) | 8 | 3 | 🔥 P0 | Dev front + agence | A + B |
| 3 | **Masquer TTR/kurtosis/q_ratio par défaut** (toggle "mode tech") | 6 | 2 | P1 | Dev front | A + B |
| 4 | **Ajouter bandeau logos clients + section métriques agence** | 8 | 3 | P1 | Design + copy | A + B |
| 5 | **Section process 4 étapes + pricing + cas client** | 9 | 6 | P1 | Design + dev + copy | A + B |
| 6 | **FAQ** | 6 | 3 | P2 | Copy + dev | A + B |
| 7 | **Navbar `Tarifs · Démo · Login`** | 7 | 2 | P1 | Dev front | A + B |
| 8 | **Séparer `/` / `/lab` / `/login`** | 8 | 5 | P2-radical | Dev full-stack | B |

### Quick wins flaggés
- 🔥 **#1** : 2 CTA commerciaux + headline agence dans un hero = **demi-journée de dev**. Transformation conversion de 0% à 1-2% immédiate.
- 🔥 **#2** : remplacer les 3 scenarios par des vrais cas. **1 journée de dev + 1 validation AhmetA** sur les cas à anonymiser.

---

## 6. NOTE TRANSVERSE — Conflit avec l'audit chat

La landing utilise `landing-demo.js` qui embarque les 4 métriques techniques (`collapse_idx, ttr, kurtosis, q_ratio`). L'audit `/chat` a proposé (Q3 thermomètre) de compacter ces mêmes métriques en un badge "style health" dans le cockpit.

**Cohérence nécessaire** : si le chat masque ces métriques derrière un badge + tooltip, la landing doit idéalement faire pareil (mode par défaut simplifié, mode tech optionnel). Sinon un prospect voit 4 chiffres en démo landing puis ne les retrouve pas dans l'outil → signal "bait and switch".

Recommandation : changer la démo landing **après** la refonte du cockpit (ou en même temps), pour garantir la continuité visuelle prospect → utilisateur.

---

**Audit écran 5/8 terminé. Valide, conteste, ou passe à `/guide`.**
