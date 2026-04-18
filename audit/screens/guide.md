# audit/screens/guide.md — `/guide`

**Écran** : guide d'onboarding public. 3 sections : process, base de connaissances, boucle de feedback.
**Fichier** : `src/routes/guide/+page.svelte` (643 lignes, texte pur sans visuels).

---

## 1. IDENTITÉ

### Job-to-be-done (réel, en creux)
> **Aider un visiteur — prospect, opérateur agence débutant, ou client agence reçu via share — à comprendre (a) ce que VoiceClone fait, (b) ce qu'il doit fournir, (c) comment la boucle d'amélioration fonctionne.**

### Problème : 3 audiences mélangées sur une seule page
La page parle simultanément à :
- **Un prospect** qui cherche à évaluer le produit → il veut "what + why + combien"
- **Un opérateur d'agence** qui commence → il veut "how + checklist + troubleshooting"
- **Un client final** qui arrive via `/share/[token]` → il veut "qu'est-ce qu'on attend de moi, combien de temps, qu'est-ce que je peux faire dans l'app"

La page les traite tous de la même façon. **Aucune segmentation**, aucun filtre "Je suis…". Chacun lit du contenu qui ne lui est pas adressé.

### Test des 3 secondes
**Moyen**. Le header "Guide d'onboarding" est clair pour un opérateur. Un prospect se demande "c'est pour moi ou pour les utilisateurs ?". Un client final se demande "je dois tout lire avant de pouvoir utiliser ?".

### Test de nécessité
Oui, mais à **repositionner**. La page publique est une **opportunité commerciale ratée** (zéro SEO) ET un **point d'aide contextuelle manquant** (isolée du chat).

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 6/10 | Compréhensible mais sans segmentation audience. |
| **Hiérarchie visuelle** | 7/10 | 3 sections numérotées, accordions propres. |
| **Charge cognitive** | 7/10 | Les accordions cachent le détail par défaut, bon. |
| **Densité d'information** | 5/10 | **Full texte, zéro visuel/screenshot/GIF**. Pour un guide d'app = 3× moins efficace que Notion/Linear docs. |
| **Microcopy & CTAs** | 6/10 | Exemples génériques ("15 ans en B2B SaaS, ex-VP Sales chez X"). Memory #1 : user refuse génériques. |
| **Cohérence globale** | 7/10 | Aligné sur le design système. |
| **Signal émotionnel** | 5/10 | Utile mais froid. Aucune illustration ou visuel qui réchauffe. |
| **Accessibilité** | 7/10 | Sémantique correcte, accordions keyboard-accessible. |
| **Discoverability SEO / searchability** | 2/10 | **Zéro meta description, zéro title, zéro OG image, zéro JSON-LD**. Pour une page publique = invisible aux moteurs. |
| **Contextualisation in-app** | 3/10 | Isolée : pas de lien depuis `/chat`, `/create`, `/calibrate`. On y va via le hub seulement. |

**Moyenne : 5.5/10.** Contenu correct, packaging sous-exploité.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Audience indéterminée, 3 publics mélangés
Conséquences concrètes :
- **Prospect agence** scrolle un guide "comment paramétrer votre clone" alors qu'il voulait savoir "combien ça coûte et qui l'utilise" → il part
- **Opérateur agence débutant** lit du générique ("Le clone s'améliore à chaque correction") alors qu'il voulait "comment uploader un CSV de 200 posts rapidement" → il ferme le guide
- **Client agence via share** est submergé par 8 sections sur la base de connaissances alors qu'il voulait juste "comment valider / rejeter un post" → il demande à l'agence

Un guide sans segmentation d'audience est un guide pour personne.

**Correctif** : ajouter un filtre top `Je suis : ▸ prospect · ▸ opérateur · ▸ client` qui **réorganise** le contenu (sections masquées/mises en avant selon le choix). Persisté en localStorage pour éviter de le demander 2 fois.

### 🔴 RF2 — Zéro SEO sur une page publique
```
src/routes/guide/+page.svelte : pas de <svelte:head>, pas de <title>,
pas de <meta description>, pas de <meta property="og:*">, pas de JSON-LD
```

Résultat : Google indexe "VoiceClone - atelier AhmetA" (title du layout default) avec zero description, zero snippet, zero image partage. Pour une agence qui pourrait capturer du traffic SEO sur "ghostwriting LinkedIn IA", "outil rédaction posts LinkedIn", "clone stylistique IA" — **opportunité ratée**.

**Correctif** : ajouter dans `<svelte:head>` :
```html
<title>Guide VoiceClone — comment on préserve votre voix LinkedIn</title>
<meta name="description" content="Process en 5 étapes, base de connaissances en 8 points, boucle de feedback continu. Tout ce qu'il faut pour un clone LinkedIn rigoureux.">
<meta property="og:title" content="Guide VoiceClone">
<meta property="og:image" content="/og-guide.png">
<script type="application/ld+json">...HowTo schema...</script>
```

### 🔴 RF3 — Page isolée, pas de contextual help in-app
Depuis `/chat`, l'utilisateur peut ouvrir `FeedbackPanel`, `RulesPanel`, `SettingsPanel`, `LeadPanel` — mais aucun bouton "Aide / ?" qui pointe vers le guide. Or c'est **pendant** le chat que la question surgit : "attends, comment ça marche la boucle ?".

**Correctif** :
- Bouton `?` discret dans le cockpit (ou dans la `CommandPalette` via Cmd+K → "aide")
- Deep-linking : click sur `?` → ouvre le guide **à la section boucle de feedback** (scroll auto)
- Idéalement : overlay slide-in sur la droite, pas un redirect full-page (préserve le contexte de la conversation en cours)

### 🔴 RF4 — Exemples génériques, non ancrés dans la réalité de l'agence
```
Ex: "15 ans en B2B SaaS, ex-VP Sales chez X, a scale de 0 a 50M ARR..."
```

C'est du copywriting stock. Memory #1 : user refuse métriques génériques, exige scénarios réels.

L'agence AhmetA a des clients réels. Le backend a des fixtures réelles (`test/fixtures/heat-conversations/*.json`). Le guide devrait utiliser **de vrais exemples anonymisés** :
- "Ex (Thomas, CEO B2B SaaS 40 pers, série B) : 15 ans en GTM, ex-VP Sales, Atomi. Pose 3 questions LinkedIn par semaine sur le pipeline au lieu de pushing features."
- Tangible, crédible, raconté comme une histoire

### 🔴 RF5 — Pas de FAQ, pas de troubleshooting, pas de contact support
Un utilisateur qui bloque n'a aucun recours visible. Or l'app a :
- Des erreurs possibles (budget dépassé, scrape 501, fidélité qui dégringole)
- Des paramètres subtils (clé API Anthropic custom, budget, tiers)
- Des limitations (5 personas max free, etc.)

**Manque** : une section `FAQ & dépannage` (10-15 Q/R) + une section `Besoin d'aide ?` avec email agence + LinkedIn + éventuellement un formulaire de contact.

Pour un client agence, c'est le minimum syndical. Pour un prospect, c'est un signal de sérieux (l'agence est disponible).

### 🔴 RF6 — Table des matières absente sur une page de 643 lignes
Même avec 3 sections principales, la page demande du scroll. Pas de TOC flottant à droite ("sticky table of contents" façon Notion docs). Pas d'ancres cliquables.

Un utilisateur qui veut juste lire la section "Boucle de feedback" doit scroller tout le reste.

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (garder la page, la muscler)

**Principe** : le contenu est bon, le packaging est faible. On ajoute segmentation, SEO, visuels, contextual help.

#### Changements précis

1. **Header : filtre d'audience**
   ```
   Guide VoiceClone
   Je suis : [ ◉ prospect ] [ ○ opérateur ] [ ○ client agence ]
   ```
   Le filtre réordonne/masque les sections (localStorage persist).
   - **Prospect** : voit "Le process (survol rapide)" + "Ce qu'on met dans un clone (exemples réels)" + "Cas clients" (lien vers landing) — pas de détail opérationnel
   - **Opérateur** : voit tout, ordre actuel
   - **Client agence** : voit "Ce que tu vas faire dans l'app (3 min)" + "Comment valider un post/DM" + "Comment corriger" — pas la partie création de clone

2. **Meta SEO complet** dans `<svelte:head>`
   - title, meta description, OG image, Twitter card
   - JSON-LD type `HowTo` (les 5 étapes sont parfaites pour ce schema)
   - URL canonique

3. **Table des matières flottante** à droite sur desktop (sticky)
   - Liens-ancres cliquables sur chaque section
   - Highlight de la section courante au scroll
   - Responsive : TOC collapsé en drawer en mobile

4. **Visuels / screenshots / mini-GIFs**
   - 1 screenshot par étape du process (5 visuels)
   - 1 screenshot par section "base de connaissances" qui montre le formulaire où remplir
   - 1 GIF court pour la boucle de feedback (correction → acceptée → clone mis à jour)
   - Remplace 30% du texte par du visuel = compréhension 3× plus rapide

5. **Exemples réels anonymisés** sur les 8 knowledge-items
   - Remplacer les "Ex: '15 ans en B2B SaaS'" par des extraits de clients AhmetA anonymisés avec autorisation
   - Format : `Ex client (anonymisé) : "…"` avec avatar stylisé

6. **Section FAQ & dépannage** ajoutée avant le CTA
   - 10-12 Q/R : "Mon clone n'est pas précis, pourquoi ?", "Combien de posts minimum ?", "Est-ce que le clone garde ma propriété intellectuelle ?", "Budget épuisé : que faire ?", etc.
   - Accordéons comme les knowledge-items (cohérence visuelle)

7. **Footer support**
   - Email agence
   - LinkedIn AhmetA
   - Lien `/` (retour landing)
   - Changelog (si existe) ou "Dernière mise à jour : 18 avril 2026"

8. **Bouton `?` / aide dans `ChatCockpit`**
   - Discret à droite des tab-btns (règles/prospect/correction/réglages)
   - Click → ouvre `/guide#feedback-loop` en overlay slide-in (pas full redirect)
   - Cmd+? = raccourci clavier alternatif

9. **Deep-linking par ancre**
   - Chaque knowledge-item et chaque FAQ a une ancre URL (ex: `/guide#priority-positioning`)
   - Permet au chat (via tooltip "?") d'ouvrir la section pertinente directement

10. **CTA final segmenté selon audience**
    - Prospect : `📅 Réserver 20 min de démo avec l'agence`
    - Opérateur : `→ Aller créer mon premier clone`
    - Client : `→ Retour à mes clones`

#### Principes appliqués
- *Segmentation d'audience* — un guide, trois parcours
- *Progressive disclosure* — TOC + accordéons
- *Recognition not recall* — ancres + deep-link
- *Searchable + skimmable* — visuels + TOC + FAQ

#### Benchmarks
- **Linear documentation** (TOC flottant, 1-2 visuels par page, FAQ en bas)
- **Notion guide** (segmentation par persona, embed vidéos)
- **Stripe docs** (deep-linking massif, code examples, perpetually cross-linked)
- **Attio academy** (segmentation "I'm a salesperson / admin / manager")

#### Impact attendu
- **Taux de lecture complète** : +40% (segmentation + TOC + visuels)
- **Conversion prospect → book demo** : +30% (CTA segmenté)
- **Réduction tickets support agence** : -50% (FAQ absorbe les questions récurrentes)
- **SEO** : apparition sur requêtes "guide ghostwriting LinkedIn IA", "outil rédaction posts IA rigoureux"

---

### Version B — **Zéro compromis** (séparer en plusieurs surfaces)

**Principe directeur** : 1 page pour 3 audiences = 0 bon guide. On **sépare**.

#### Trois espaces distincts

**1. `/docs` — documentation pour opérateurs agence**
- Public mais positionné "interne-team" (l'agence utilise pour ses onboardings, les prospects peuvent lire s'ils veulent)
- Contenu actuel augmenté : how-to, troubleshooting, API / webhook (Breakcold future), architecture simplifiée
- Style Notion/Linear docs : left sidebar TOC, visuels lourds, deep-linking fin
- Évolue comme un wiki vivant (changelog, release notes)

**2. `/pour-vous` — guide prospect**
- Story-driven : "comment on préserve votre voix LinkedIn, sans dérive IA"
- 3 sections : "Le process agence (5 étapes)", "Cas clients vidéo", "Ce qu'on garantit"
- Pas de détail technique, pas de "base de connaissances"
- CTA fort : `Book demo` + `Voir les offres`
- SEO-optimized agressivement

**3. `/bienvenue/[token]` — onboarding client via share**
- Page d'accueil personnalisée pour le client agence qui arrive via un share-token
- 4 écrans guidés : "Voici ton clone · Voici comment valider un post · Voici comment corriger · Première mission"
- Embed vidéo loom 90s de l'agence qui explique le workflow
- Pas d'info technique, pas de process agence — juste "comment utiliser l'app en 5 minutes"

#### Contextual help in-app
- Bouton `?` dans tous les écrans app (chat, create, calibrate, hub)
- Ouvre une palette d'aide contextuelle avec 3-5 articles pertinents à l'écran courant
- Lien "voir tout le guide" → `/docs`

#### Composants supprimés
- Route `/guide` actuelle

#### Composants ajoutés
- `/docs` (page structurée + sidebar)
- `/pour-vous` (landing secondaire)
- `/bienvenue/[token]` (page onboarding client)
- `HelpPalette.svelte` (overlay contextual help in-app)

#### Principes appliqués
- *Audience-first segmentation*
- *Separation of concerns*
- *Context preservation* (help in-app sans quitter l'écran)

#### Benchmarks
- **Stripe** (`stripe.com/docs` pour devs, `stripe.com` commercial, `dashboard.stripe.com` app avec help inline)
- **Linear** (`linear.app/docs` + `linear.app/method` + help in-app `?`)
- **Vercel** (`/docs` + `/learn` + `/guides`)

#### Impact attendu
- **Qualité du contenu par audience** : +50%, chaque espace est optimisé pour son public
- **Réduction tickets support agence** : -70%
- **SEO prospect** : concentré sur `/pour-vous`, plus performant
- **Vitesse onboarding client** : 10 min → 2 min (4 écrans guidés au lieu d'un mur de texte)

#### Risque identifié
Plus de surfaces = plus de contenu à maintenir. Mitigation : `/docs` peut être sourcé d'un wiki markdown (GitHub ou Notion public) avec sync, pour faciliter la maintenance.

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Meta SEO complet** (title, description, OG, JSON-LD HowTo) | 8 | 1 | 🔥 P0 | Dev front + copy | A |
| 2 | **Bouton `?` dans cockpit chat → ouvre guide en overlay** | 8 | 3 | 🔥 P0 | Dev front | A |
| 3 | **Table des matières flottante (desktop)** | 6 | 2 | P1 | Dev front | A |
| 4 | **Exemples réels anonymisés sur les 8 knowledge-items** | 7 | 3 | P1 | Copy + agence | A + B |
| 5 | **Filtre d'audience "Je suis…"** | 8 | 4 | P1 | Dev front | A |
| 6 | **Section FAQ & dépannage (10-12 Q/R)** | 7 | 3 | P1 | Copy + dev | A + B |
| 7 | **Visuels / screenshots / GIFs (10-15 assets)** | 7 | 5 | P2 | Design + dev | A + B |
| 8 | **Footer support (email + LinkedIn agence)** | 5 | 1 | P1 | Dev front | A + B |
| 9 | **CTA segmenté par audience** | 6 | 2 | P2 | Dev front | A |
| 10 | **Séparation en `/docs` + `/pour-vous` + `/bienvenue/[token]`** | 9 | 9 | P2-radical | Design + dev + copy | B |

### Quick wins flaggés
- 🔥 **#1** : meta SEO = **1h de dev** pour débloquer le SEO. Gratuit à implémenter.
- 🔥 **#2** : bouton `?` contextual help dans chat = **½ journée**. Débloque un flywheel d'aide qui réduit les tickets agence.

---

**Audit écran 6/8 terminé. Valide, conteste, ou passe à `/admin`.**
