# audit/screens/create.md — `/create`

**Écran** : funnel de création d'un clone. 6 étapes (2 pré-steps + 4 visibles).
**Fichier** : `src/routes/create/+page.svelte` (1000 lignes — le plus gros fichier de routes du repo).

---

## 1. IDENTITÉ

### Job-to-be-done (1 phrase)
> **Setup un nouveau clone client, avec le plus de données de qualité possible, en quelques minutes, pour que l'opérateur puisse commencer à produire dès le chat.**

### Test des 3 secondes
**Moyen.** Un opérateur qui arrive sur `/create` voit un écran `calibration` qui ne dit **pas** "Voici ce que tu vas faire", mais "Voici ce que le clone apprend et d'où". C'est pédagogique, pas actionnable. Un nouvel opérateur lit la rubric, un opérateur expérimenté la skippe mentalement mais doit quand même cliquer "Continuer →".

### Test de nécessité
Obligatoire. Chaque nouveau client signé = un clone à monter. La question vraie : **peut-on passer de 6 étapes à 1 page unique avec autosave ?** Hypothèse : oui, et ça double probablement la vitesse de setup pour un opérateur qui monte son 10e clone.

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 6/10 | Funnel linéaire compréhensible MAIS le step `calibration` mélange pédagogie et action — ambigu. |
| **Hiérarchie visuelle** | 7/10 | Step-bar fonctionne, titres clairs, transitions fly OK. |
| **Charge cognitive** | 6/10 | 4 steps visibles, 2 pré-steps invisibles. Progress bar ment : "Étape 1/4" au step `info` alors qu'on a déjà fait 2 steps. |
| **Densité d'information** | 7/10 | Bien aéré. Pas de sur-charge par écran. |
| **Microcopy & CTAs** | 6/10 | "Continuer sans scrape →" clair. "Générer le clone" OK. MAIS "Scraper" puis "Auto-remplir" pour le même bouton à 2 endroits = incohérent. |
| **Cohérence globale** | 5/10 | 3 systèmes visuels co-existent : rubric en mode laboratoire (mono + borders dashed), type-cards en mode app classique (emoji + surface), forms en mode form standard (labels + inputs). Pas unifié. |
| **Signal émotionnel** | 5/10 | Zéro célébration à la création. "Clone '{name}' créé !" + redirect brutal. |
| **Accessibilité** | 6/10 | Labels OK, step-bar a `aria-hidden` en pré-step, mais pas de keyboard shortcut (Tab + Enter pour avancer rapidement absent). |

**Moyenne : 6/10.** Meilleur que `/chat` mais loin d'être irréprochable pour un funnel qu'un opérateur va traverser 20+ fois.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — L'étape "type" devrait être la PREMIÈRE étape
Aujourd'hui : `calibration` (rubric pédagogique) → `type` (choix Posts/DM/Both) → `info` → `posts` (conditionnel) → `dm` (conditionnel) → `docs`.

Le choix Posts/DM/Both **conditionne TOUS les steps suivants** : visibilité des sections posts/dm, format attendu, taille du corpus. C'est littéralement la première décision structurelle. La mettre en step 2, après un écran pédagogique, est un anti-pattern.

Ordre logique : **type → info → (posts | dm | both) → docs**. Le step `calibration` devient soit une mini-intro au step 1 (tooltip), soit disparaît.

**Impact** : l'opérateur qui sait ce qu'il veut (20e clone) gagne 1 clic + 1 lecture inutile × 20 = 20× 10 secondes = **3 min/semaine** économisées. Petit gain unitaire, mais réduit la friction sur l'étape à plus haute fréquence.

### 🔴 RF2 — Le scrape LinkedIn est proposé DEUX fois
Step `calibration` a un input + bouton `Scraper` avec status + recap success. Step `info` a **exactement le même** input avec bouton `Auto-remplir`. L'opérateur qui vient de scraper au step 1 voit le même champ au step 3 : "j'ai raté un truc ? Faut le refaire ?"

Causes probables :
- Héritage d'un design antérieur (calibration a été ajouté après)
- Peur que l'utilisateur veuille scraper plus tard

Conséquence : incohérence visible, méfiance du flow.

**Correctif** : scrape une seule fois (au step `info`, après le choix de type). Le bouton `Auto-remplir` devient **secondary action** du step `info`, pas un step à part.

### 🔴 RF3 — Pas de "dupliquer depuis un clone existant"
Une agence gère N clients similaires. Deux PME B2B SaaS cheminent souvent sur les mêmes scenarios, mêmes services, mêmes docs métier types. L'opérateur qui monte le clone #15 redémarre from scratch à chaque fois.

Manque : bouton `📋 Dupliquer depuis…` en haut de `/create` → overlay sélection d'un clone existant → pré-remplit le scenario, le type, les options, les templates de docs. Vide les données spécifiques (nom, posts, DMs, bio).

**Impact** : pour une agence qui monte 2-3 clones/mois avec des niches similaires, ~40% du temps de setup économisé. C'est l'équivalent des "templates" Linear ou "dupliquer base" Airtable.

### 🔴 RF4 — Format `---` manuel pour les posts / DMs
Step `posts` : textarea vide, l'opérateur doit coller 10-20 posts en insérant `---` sur une ligne seule entre chaque. Pour 20 posts = 19 séparateurs à insérer manuellement.

Ce que les opérateurs font réellement (anticipation) :
- Export LinkedIn : pas de format `---` natif
- Scraping de Taplio ou Authore → export CSV ou JSON
- Copier depuis Sales Navigator ou Notion

Aucun de ces formats n'est supporté. Le seul upload accepté est le step `docs` (final) et il ne mappe pas vers posts/DMs.

**Correctif** :
- Accepter upload d'un fichier texte où 2+ newlines consécutives = séparateur (fallback intelligent)
- Accepter upload d'un CSV avec colonne `post` ou JSON array
- Supporter un paste direct depuis l'export LinkedIn officiel (quand/si il existe un format standard)
- Garder `---` manuel comme option

### 🔴 RF5 — Aucun preview / dry-run avant "Générer"
L'opérateur remplit 4 écrans, clique "Générer", attend 20-30 secondes, consomme du budget token, et découvre le résultat dans `/calibrate`. Zero aperçu avant consommation.

Pour un clone de qualité, il veut savoir **avant de payer** :
- Quel style a été détecté (ton, longueur moyenne, ratio questions)
- Est-ce que ses 12 posts sont assez variés (distribution thématique)
- Est-ce que son corpus fait converger vers un clone robuste ou incertain

**Correctif** : une section "Aperçu du style détecté" sur le dernier step (`docs`), qui fait un LLM call **léger** (Haiku, pas Sonnet) sur le corpus pour afficher :
- 3 métriques stylométriques (longueur moyenne, ratio questions, TTR estimé)
- 1-2 posts "brouillons" générés dans le style détecté, pour feel
- Un score de confiance baseline (0-100) avec hints d'amélioration ("ajoutez 5 posts de plus pour +15 pts")

Avant "Générer" le vrai clone, l'opérateur sait à quoi s'attendre.

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (garde le funnel)

**Principe** : réordonner, dédupliquer, ajouter les garde-fous qui manquent. Pas de refonte structurelle.

#### Changements précis

1. **Swap order** : `type` devient step 1, `calibration` disparaît en tant que step dédié.
   - L'info de la rubric (ce que le clone apprend) migre en **tooltip `?`** à côté de chaque section du step suivant (info, posts, dm, docs)
   - Gain : −1 step, −1 lecture de contexte, +0 perte d'info
   - Principe : *recognition not recall*

2. **Un seul scrape input, au step `info`**. Retirer complètement le bloc scrape du step `calibration` (et donc le step lui-même). Le scrape devient une action optionnelle au step `info` : champ "URL LinkedIn (optionnel — auto-remplit tout)" + bouton `Auto-remplir`.
   - Gain : -1 redondance, -1 point de confusion

3. **Bouton `📋 Dupliquer depuis un clone existant`** en haut de page, juste après le titre "Créer un clone".
   - Click → overlay qui liste les clones existants avec dernière modif + fidelity score
   - Sélection → funnel pré-rempli avec : type, scenario, options, prénom/titre vidés, posts/dms vidés, docs (templates) en recap
   - Principe : *templates > blank slate*
   - Benchmark : Linear duplicate issue, Notion duplicate page

4. **Upload fichier sur posts + DMs** :
   - Au step `posts`, ajouter en plus de la textarea un bouton `📄 Importer un fichier` (accepte .txt, .md, .csv)
   - Parser côté client : 2+ newlines consécutives = séparateur. CSV avec colonne `post` détectée auto. Fallback textarea affichée avec le contenu parsé pour review.
   - Idem sur DMs avec .csv/.txt supporté (conversations séparées par 2+ newlines, messages par 1 newline)
   - Gain : pour un opérateur qui exporte ses posts d'un autre outil, 0 manipulation `---`

5. **Section "Aperçu du style"** au step `docs`, au-dessus du bouton `Générer` :
   - 3 métriques auto-calculées côté client (longueur moyenne, ratio questions, nombre de `?`, ratio d'emoji) — pas d'LLM
   - Un bouton `🔮 Générer un aperçu` (optionnel) qui fait 1 LLM call léger Haiku pour produire 2 brouillons de post dans le style détecté (coût : <1 centime)
   - Score de confiance baseline 0-100 avec suggestions ("+ 5 posts pour +15 pts")
   - Après aperçu, bouton `Générer le clone` reste primary

6. **Champ `client` / `tag` dans le step `info`** :
   - Sous "Titre & entreprise", ajouter champ optionnel "Client (tag agence)" + dropdown (clients existants dérivés des personas précédents) ou "+ nouveau client"
   - Ce tag alimente ensuite l'organisation dans `/hub` et les filtres dans `/chat` (cf. RF5 audit chat)

7. **Unifier le design system** :
   - Step `type` cards actuelles en mode "card classique" avec emoji → refaire en mode laboratoire : borders dashed, mono pour le meta, vermillon comme accent
   - Step `info` / `posts` / `dm` forms : garder inputs simples mais avec la même typographie mono pour les labels
   - Objectif : visuellement, traverser les 4 steps ressemble à traverser 4 pages d'un même carnet

8. **Progress bar honnête** : `Étape 1/4` dès le step type (puisqu'il est le 1er). Disparaît totalement du pré-step supprimé.

9. **Célébration à la génération** :
   - Au lieu du toast `Clone "{name}" créé !` + redirect brut, afficher 2 secondes un écran de feedback : "✓ Clone créé. 12 posts analysés · fidélité baseline : 0.81 · 14 entités détectées." + bouton primary `Calibrer maintenant →` / link secondary `Plus tard (aller direct au chat)`
   - Micro-moment positif qui confirme la valeur de ce qui vient d'être créé

10. **Raccourcis clavier dans le funnel** :
    - `Tab` + `Enter` avance au step suivant quand conditions OK
    - `Cmd+Enter` dans une textarea = submit vers step suivant
    - `Cmd+←` pour back

#### CTA principal
`Générer le clone` — gardé, mais **précédé d'un écran d'aperçu** (point 5) qui réduit l'incertitude avant le coût.

#### Impact attendu
- **Temps médian de création** : ~4 min aujourd'hui → ~2.5 min (swap, dédup, raccourcis)
- **Temps médian pour un clone "similaire"** : ~4 min → ~1 min via dupliquer
- **Taux de clones "manqués" / refaits** : -50% via l'aperçu (l'opérateur voit tôt qu'il manque de posts)

---

### Version B — **Zéro compromis** (fiche client unique)

**Principe directeur** : un funnel linéaire à 4-6 steps est un anti-pattern pour une action à **haute fréquence**. Pour une agence qui monte 2-3 clones/mois, le funnel force un parcours unique alors que les opérateurs expérimentés veulent remplir dans leur ordre, voir le résultat en direct, ajuster à la volée.

On remplace le funnel par **une page unique "Fiche client"** avec autosave et preview live.

#### Structure proposée (ASCII)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Créer un clone                              [📋 Dupliquer] [✕ Annul]│
│ brouillon · modifié il y a 3s                                       │
├───────────────────────────────────────────────────────┬─────────────┤
│                                                       │             │
│  ┌── Services ──────────────────────────────────────┐ │ APERÇU      │
│  │ ( ) Posts LinkedIn                               │ │             │
│  │ ( ) DMs LinkedIn                                 │ │ style       │
│  │ (•) Les deux — flow complet                      │ │ ─────────── │
│  └──────────────────────────────────────────────────┘ │ longueur    │
│                                                       │ moy: 148 m  │
│  ┌── Identité                              [ ▼ ] ─┐  │             │
│  │ 🔗 linkedin.com/in/lucile-dupont   [Scraper]   │  │ ratio ?     │
│  │ Nom: Lucile Dupont · CEO @Atomi                │  │ 0.22        │
│  │ Bio: Expert GTM B2B, accompagne...             │  │             │
│  │ Client: [ Atomi (nouveau) ▼ ]                  │  │ 12 posts    │
│  └────────────────────────────────────────────────┘  │ ─────────── │
│                                                       │             │
│  ┌── Corpus posts (14 posts)               [ ▼ ] ─┐   │ brouillon   │
│  │ [paste direct] [📄 import .csv/.txt]            │   │ style Lucile│
│  │                                                 │   │ ─────────── │
│  │ Premier post ici...                             │   │ "Salut Marc,│
│  │ ---                                             │   │ j'ai vu ta  │
│  │ Deuxième post ici...                            │   │ levée — …"  │
│  │ ✓ 14 posts détectés                             │   │             │
│  └────────────────────────────────────────────────┘   │ confiance   │
│                                                       │ baseline    │
│  ┌── Corpus DMs (optionnel)              [ ▶ ] ──┐   │ 74/100      │
│  │ [paste direct] [📄 import .csv]                │   │ +5 posts    │
│  └────────────────────────────────────────────────┘   │ pour 85     │
│                                                       │             │
│  ┌── Documents métier                      [ ▼ ] ┐   │             │
│  │ Drag & drop fichiers ici                      │   │             │
│  │ .txt .md .pdf .docx .csv .json                │   │             │
│  └────────────────────────────────────────────────┘   │             │
│                                                       │             │
│  ┌── Options avancées                    [ ▶ ] ──┐   │             │
│  │ Scenario preset · Tag · Budget · ...          │   │             │
│  └────────────────────────────────────────────────┘   │             │
│                                                       │             │
│         [ 🔮 Générer le clone (24s · ≈0.12€) ]        │             │
└───────────────────────────────────────────────────────┴─────────────┘
```

#### Détails

- **Autosave localStorage** : chaque frappe/upload est sauvegardé en brouillon. L'opérateur peut fermer la page et reprendre. Header affiche `modifié il y a 3s`. Badge de rétention visible pour rassurer.
- **Sections collapsables** : chaque bloc a un `[▼]` / `[▶]` pour plier/déplier. Les sections non pertinentes (DMs si service = Posts only) sont pliées par défaut. Drag & drop pour réordonner (nice-to-have v2).
- **Panneau latéral droit "Aperçu"** (~320px), sticky, affiche en temps réel à mesure que l'opérateur colle du contenu :
  - **Style** : 3 métriques stylométriques calculées client-side (longueur moyenne, ratio questions, TTR approximé)
  - **Brouillon live** : 1-2 posts "comme le clone les écrirait" (LLM call Haiku léger, debounced 2s après inactivité, coût ~0.01€)
  - **Confiance baseline** : score 0-100 + suggestion d'amélioration la plus impactante
- **Dupliquer en haut** : bouton permanent, remplit la fiche depuis un clone existant
- **Bouton Générer** : affiche le coût estimé (`24s · ≈0.12€`) avant click. Transparence budget = reassurance pour agences qui facturent à la conso.
- **Plus de step "calibration" dédié** : la pédagogie vit en 4 tooltips discrets `?` à côté de chaque header de section

#### Composants supprimés
- `step-bar` (`.step-bar-item` × 4) — remplacé par progression implicite via sections remplies
- Logic fly-transition between steps — remplacé par scroll + collapse

#### Composants ajoutés
- `CloneDraftPage.svelte` — nouvelle page unique
- `StylePreview.svelte` — panneau droite live
- `DuplicateFromOverlay.svelte` — overlay sélection clone template

#### Principes appliqués
- *Moins de clics* — une page vs 4+ steps
- *Progressive disclosure* — sections collapsables, tooltips à la demande
- *Direct manipulation* — autosave, feedback live via aperçu
- *Recognition not recall* — dupliquer depuis existing

#### Benchmarks
- **Linear new issue modal** — une fiche, tous les champs visibles, submit en une fois
- **Airtable create record** — tableau grid edit en place, autosave
- **Notion /template command** — duplicate-from-template pattern
- **Stripe dashboard form** — préview live à droite des configs tarifaires

#### Impact attendu
- **Temps médian** : ~4 min → **~90 secondes** pour un opérateur expérimenté
- **Temps médian "clone similaire" via dupliquer** : ~30 secondes
- **Taux de clones regénérés** : −70% (l'aperçu tue le besoin de refaire)
- **Taux d'abandon de funnel** : −40% (pas de frustration step-par-step quand tu veux juste taper tes posts et lancer)

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Swap "type" → step 1 + suppression step calibration** | 7 | 1 | 🔥 P0 | Dev front | A |
| 2 | **Un seul scrape input (step info)** | 6 | 1 | 🔥 P0 | Dev front | A + B |
| 3 | **Upload fichier pour posts/DMs** (.txt/.csv/.md) | 8 | 4 | P1 | Dev front | A + B |
| 4 | **"Dupliquer depuis un clone existant"** | 8 | 5 | P1 | Dev full-stack | A + B |
| 5 | **Champ `client` / `tag` dans info** | 7 | 3 | P1 | Dev full-stack | A + B |
| 6 | **Aperçu du style avant "Générer"** (LLM léger) | 9 | 6 | P1 | Dev front + BE | A + B |
| 7 | **Unifier design system (all labo)** | 5 | 4 | P2 | Design + dev | A |
| 8 | **Célébration + bouton "Calibrer maintenant"** | 5 | 2 | P2 | Dev front | A + B |
| 9 | **Raccourcis clavier (Tab/Cmd+Enter)** | 4 | 2 | P2 | Dev front | A |
| 10 | **Fiche client unique + autosave + live preview** | 9 | 9 | P2-radical | Dev full-stack + design | B |
| 11 | **Estimation coût (€) avant "Générer"** | 6 | 3 | P1 | Dev BE | A + B |

### Quick wins flaggés
- 🔥 **#1 + #2** : 2 heures de dev combinées, suppriment 1 step + 1 redondance. Gain immédiat de friction.
- 🔥 **#6 Aperçu style** : le seul changement qui évite le "j'ai généré à l'aveugle et c'est raté". Il finance le reste par les tokens économisés sur les regénérations.

---

**Audit écran 2/8 terminé. Valide ou conteste avant `/hub`.**
